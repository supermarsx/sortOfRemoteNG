//! Passive, fixed-schema observations. No peer addresses or authentication data.
use super::types::{ChainHop, SshConnectionConfig, SshSession};
use sorng_core::route_health::*;

fn proxy_endpoint(proxy: &super::types::ProxyConfig) -> Option<HopEndpoint> {
    use super::types::ProxyType;
    HopEndpoint::new(
        &proxy.host,
        proxy.port,
        match proxy.proxy_type {
            ProxyType::Http => HopProtocol::HttpConnect,
            ProxyType::Https => HopProtocol::HttpsConnect,
            ProxyType::Socks4 => HopProtocol::Socks4,
            ProxyType::Socks5 => HopProtocol::Socks5,
        },
    )
}
fn endpoint(config: &SshConnectionConfig, index: usize) -> Option<HopEndpoint> {
    if let Some(chain) = &config.mixed_chain {
        return match chain.hops.get(index)? {
            ChainHop::SshJump(jump) => HopEndpoint::new(&jump.host, jump.port, HopProtocol::Ssh),
            ChainHop::Proxy(proxy) => proxy_endpoint(proxy),
        };
    }
    if let Some(chain) = &config.proxy_chain {
        return proxy_endpoint(chain.proxies.get(index)?);
    }
    if let Some(proxy) = &config.proxy_config {
        return proxy_endpoint(proxy);
    }
    let jump = config.jump_hosts.get(index)?;
    HopEndpoint::new(&jump.host, jump.port, HopProtocol::Ssh)
}

pub(crate) fn initialize(config: &SshConnectionConfig, health: &RouteHealth) -> usize {
    let mut kinds: Vec<_> = if config
        .proxy_command
        .as_ref()
        .is_some_and(|c| c.command.is_some() || c.template.is_some())
    {
        vec![HopKind::ProxyCommand]
    } else if let Some(chain) = &config.mixed_chain {
        chain
            .hops
            .iter()
            .take(63)
            .map(|hop| match hop {
                ChainHop::SshJump(_) => HopKind::SshJump,
                ChainHop::Proxy(_) => HopKind::Proxy,
            })
            .collect()
    } else if config.proxy_command.is_some() {
        // The existing empty-ProxyCommand branch explicitly falls back to
        // direct transport when no mixed chain exists; do not invent hops.
        Vec::new()
    } else if let Some(chain) = &config.proxy_chain {
        vec![HopKind::Proxy; chain.proxies.len().min(63)]
    } else if config.proxy_config.is_some() {
        vec![HopKind::Proxy]
    } else {
        vec![HopKind::SshJump; config.jump_hosts.len().min(63)]
    };
    if config.openvpn_config.is_some() {
        kinds.insert(0, HopKind::Vpn);
    }
    if kinds.len() > 62 {
        health.mark_truncated();
    }
    for (index, kind) in kinds.iter().take(62).enumerate() {
        health.record(
            index,
            *kind,
            HopStage::Transport,
            HopState::Unknown,
            HopEvidence::NotObserved,
        );
        if !matches!(kind, HopKind::Vpn | HopKind::ProxyCommand) {
            let offset = usize::from(config.openvpn_config.is_some());
            health.set_endpoint(index, endpoint(config, index.saturating_sub(offset)));
        }
    }
    let final_index = kinds.len().min(62);
    health.record(
        final_index,
        HopKind::Ssh,
        HopStage::Transport,
        HopState::Unknown,
        HopEvidence::NotObserved,
    );
    health.set_endpoint(
        final_index,
        HopEndpoint::new(&config.host, config.port, HopProtocol::Ssh),
    );
    final_index
}

pub(crate) fn phase_operation(
    health: &RouteHealth,
    phase: &str,
    final_index: usize,
    proxy_index: usize,
) -> Option<HopOperation> {
    let stage = if phase.ends_with("dns-resolution") {
        HopStage::Dns
    } else if phase.ends_with("authentication") {
        HopStage::SshAuthentication
    } else if phase.ends_with("handshake") {
        HopStage::SshHandshake
    } else if phase.ends_with("channel-open") {
        HopStage::ChannelOpen
    } else if phase.ends_with("negotiation") {
        HopStage::ProxyNegotiation
    } else if phase.ends_with("tcp") || phase.ends_with("tcp-connect") {
        HopStage::Tcp
    } else if phase == "proxy-command-spawn" {
        HopStage::Transport
    } else {
        return None;
    };
    let snapshot = health.snapshot("");
    let offset = usize::from(
        snapshot
            .hops
            .first()
            .is_some_and(|hop| hop.kind == HopKind::Vpn),
    );
    let indexed = ["jump-hop-", "mixed-chain-hop-", "proxy-chain-hop-"]
        .iter()
        .find_map(|prefix| {
            phase
                .strip_prefix(prefix)
                .and_then(|rest| rest.split('-').next()?.parse::<usize>().ok())
                .and_then(|index| index.checked_sub(1))
                .map(|index| index + offset)
        });
    if indexed.is_some_and(|index| index >= final_index) {
        return None;
    }
    if snapshot.truncated
        && matches!(
            phase,
            "jump-final-channel-open" | "proxy-chain-final-negotiation"
        )
    {
        return None;
    }
    let index = indexed.unwrap_or_else(|| {
        if phase.starts_with("final-") || phase.starts_with("direct-") {
            final_index
        } else if matches!(
            phase,
            "jump-final-channel-open" | "proxy-chain-final-negotiation"
        ) {
            final_index.saturating_sub(1)
        } else {
            proxy_index + offset
        }
    });
    let kind = snapshot.hops.iter().find(|hop| hop.index == index)?.kind;
    Some(health.begin(index, kind, stage))
}

fn retain_active_proxy(
    snapshot: &mut RouteHealthSnapshot,
    config: &SshConnectionConfig,
    selected_index: usize,
) {
    // These modes choose one candidate, unlike a strict chain. Failed/unused
    // alternatives are establishment history, not components of the live route.
    if config.proxy_command.is_some() || config.mixed_chain.is_some() {
        return;
    }
    if !config.proxy_chain.as_ref().is_some_and(|chain| {
        matches!(
            chain.mode,
            super::types::ProxyChainMode::Dynamic | super::types::ProxyChainMode::Random
        )
    }) {
        return;
    }
    let selected_index = selected_index + usize::from(config.openvpn_config.is_some());
    snapshot
        .hops
        .retain(|hop| hop.kind != HopKind::Proxy || hop.index == selected_index);
    for (index, hop) in snapshot.hops.iter_mut().enumerate() {
        hop.index = index;
    }
}

pub(crate) fn snapshot(session: &SshSession, alive: bool) -> RouteHealthSnapshot {
    let mut snapshot = session.route_health.snapshot(&session.id);
    retain_active_proxy(
        &mut snapshot,
        &session.config,
        session.selected_health_proxy_index,
    );
    if let Some(hop) = snapshot
        .hops
        .iter_mut()
        .find(|hop| hop.kind == HopKind::ProxyCommand)
    {
        if let Ok(status) = super::proxy_command::get_proxy_command_status(&session.id) {
            let active = status.is_some_and(|status| status.alive);
            hop.state = if active {
                HopState::Connected
            } else {
                HopState::Disconnected
            };
            hop.evidence = if active {
                HopEvidence::RuntimeActive
            } else {
                HopEvidence::RuntimeEnded
            };
            hop.updated_at_unix_ms = None;
        }
    }
    let jump_indices: Vec<_> = snapshot
        .hops
        .iter()
        .filter(|hop| hop.kind == HopKind::SshJump)
        .map(|hop| hop.index)
        .collect();
    for (position, index) in jump_indices.into_iter().enumerate() {
        let ended = session
            .bridge_handles
            .get(position)
            .map(std::thread::JoinHandle::is_finished);
        if let Some(ended) = ended {
            if let Some(hop) = snapshot.hops.iter_mut().find(|hop| hop.index == index) {
                hop.state = if ended {
                    HopState::Disconnected
                } else {
                    HopState::Connected
                };
                hop.evidence = if ended {
                    HopEvidence::RuntimeEnded
                } else {
                    HopEvidence::RuntimeActive
                };
                hop.updated_at_unix_ms = None;
                // This is a current snapshot, not a newly recorded transition.
            }
        }
    }
    if let Some(hop) = snapshot
        .hops
        .iter_mut()
        .find(|hop| hop.kind == HopKind::Ssh)
    {
        hop.state = if alive {
            HopState::Connected
        } else {
            HopState::Disconnected
        };
        hop.evidence = if alive {
            HopEvidence::RuntimeActive
        } else {
            HopEvidence::ChannelUnavailable
        };
        hop.updated_at_unix_ms = None;
    }
    let mut forwards: Vec<_> = session.port_forwards.values().collect();
    forwards.sort_by(|a, b| a.id.cmp(&b.id));
    if forwards.len() > 64usize.saturating_sub(snapshot.hops.len()) {
        snapshot.truncated = true;
    }
    for forward in forwards
        .into_iter()
        .take(64usize.saturating_sub(snapshot.hops.len()))
    {
        let ended = forward.handle.is_finished();
        snapshot.hops.push(HopObservation {
            index: snapshot.hops.len(),
            kind: HopKind::LocalForward,
            state: if ended {
                HopState::Disconnected
            } else {
                HopState::Connected
            },
            evidence: if ended {
                HopEvidence::ForwardEnded
            } else {
                HopEvidence::ForwardActive
            },
            stage: HopStage::ForwardListener,
            updated_at_unix_ms: None,
            endpoint: HopEndpoint::new(
                &forward.config.local_host,
                forward.config.local_port,
                HopProtocol::Tcp,
            ),
        });
    }
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_fallback_proxy_excludes_failed_alternatives_from_current_route() {
        for mode in ["Dynamic", "Random"] {
            let mut config: SshConnectionConfig = serde_json::from_value(serde_json::json!({
                "host":"target.test","port":22,"username":"private-account",
                "strict_host_key_checking":true,"jump_hosts":[],
                "proxy_chain":{"mode":mode,"proxies":[
                    {"proxy_type":"socks5","host":"failed.test","port":1080},
                    {"proxy_type":"http","host":"selected.test","port":8080},
                    {"proxy_type":"socks4","host":"unused.test","port":1080}
                ]}
            }))
            .unwrap();
            let health = RouteHealth::default();
            initialize(&config, &health);
            health.begin(0, HopKind::Proxy, HopStage::Tcp).finish(false);
            health
                .begin(1, HopKind::Proxy, HopStage::ProxyNegotiation)
                .finish(true);
            health
                .begin(3, HopKind::Ssh, HopStage::SshAuthentication)
                .finish(true);
            let original = health.snapshot("actor");
            let mut active = original.clone();
            retain_active_proxy(&mut active, &config, 1);
            assert_eq!(active.hops.len(), 2);
            assert_eq!(
                active.hops[0].endpoint.as_ref().unwrap().host,
                "selected.test"
            );
            assert!(active.hops.iter().all(|hop| hop.state != HopState::Failed));
            assert_eq!(active.hops[1].kind, HopKind::Ssh);
            assert_eq!(active.hops[1].index, 1);
            // Selection is captured, not inferred from which candidate succeeded.
            let mut selected_failure = original.clone();
            retain_active_proxy(&mut selected_failure, &config, 0);
            assert_eq!(selected_failure.hops[0].state, HopState::Failed);
            config.proxy_chain.as_mut().unwrap().mode = super::super::types::ProxyChainMode::Strict;
            let mut strict = original.clone();
            retain_active_proxy(&mut strict, &config, 1);
            assert_eq!(strict.hops.len(), original.hops.len());
            assert_eq!(strict.hops[0].state, HopState::Failed);
        }
    }
    #[tokio::test]
    async fn ended_bridge_is_reported_independently_of_an_active_final_actor() {
        let config: SshConnectionConfig = serde_json::from_value(serde_json::json!({
            "host":"private.test","port":22,"username":"account","strict_host_key_checking":true,"jump_hosts":[]
        })).unwrap();
        let health = RouteHealth::default();
        health
            .begin(0, HopKind::SshJump, HopStage::SshAuthentication)
            .finish(true);
        health
            .begin(1, HopKind::Ssh, HopStage::SshAuthentication)
            .finish(true);
        let bridge = std::thread::spawn(|| {});
        for _ in 0..100 {
            if bridge.is_finished() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert!(bridge.is_finished());
        let mut session = SshSession {
            route_health: health,
            selected_health_proxy_index: 0,
            id: "actor".into(),
            session: ssh2::Session::new().unwrap(),
            channel_open: std::sync::Arc::new(super::super::service::ChannelOpenGate::default()),
            config,
            connected_at: chrono::Utc::now(),
            last_activity: chrono::Utc::now(),
            port_forwards: Default::default(),
            keep_alive_handle: None,
            intermediate_sessions: vec![],
            bridge_handles: vec![bridge],
            compression_stats: Default::default(),
        };
        let result = snapshot(&session, true);
        assert_eq!(result.hops[0].evidence, HopEvidence::RuntimeEnded);
        assert_eq!(result.hops[1].evidence, HopEvidence::RuntimeActive);
        assert_eq!(result.hops[0].updated_at_unix_ms, None);
        for index in 0..63 {
            session.route_health.record(
                index,
                HopKind::Proxy,
                HopStage::ProxyNegotiation,
                HopState::Connected,
                HopEvidence::Negotiated,
            );
        }
        for index in 0..2 {
            let id = format!("forward-{index}");
            session.port_forwards.insert(
                id.clone(),
                super::super::types::PortForwardHandle {
                    id,
                    config: super::super::types::PortForwardConfig {
                        local_host: "127.0.0.1".into(),
                        local_port: 4000 + index,
                        remote_host: "remote.test".into(),
                        remote_port: 22,
                        direction: super::super::types::PortForwardDirection::Local,
                        allow_non_loopback_bind: false,
                    },
                    handle: tokio::spawn(std::future::pending::<
                        Result<(), Box<dyn std::error::Error + Send + Sync>>,
                    >()),
                },
            );
        }
        let result = snapshot(&session, true);
        assert_eq!(result.hops.len(), 64);
        assert!(
            result.truncated,
            "a second forward must not disappear silently"
        );
        for forward in session.port_forwards.values() {
            forward.handle.abort();
        }
    }
    #[test]
    fn empty_proxy_command_and_vpn_inventory_match_actual_transport_selection() {
        let config: SshConnectionConfig = serde_json::from_value(serde_json::json!({
            "host":"private.test","port":22,"username":"private-account","strict_host_key_checking":true,
            "jump_hosts":[],"proxy_command":{},"proxy_config":{"proxy_type":"socks5","host":"ignored.test","port":1080},
            "openvpn_config":{"connection_id":"private-vpn"}
        })).unwrap();
        let health = RouteHealth::default();
        let final_index = initialize(&config, &health);
        let snapshot = health.snapshot("actor");
        assert_eq!(final_index, 1);
        assert_eq!(
            snapshot.hops.iter().map(|hop| hop.kind).collect::<Vec<_>>(),
            vec![HopKind::Vpn, HopKind::Ssh]
        );
        assert!(snapshot
            .hops
            .iter()
            .all(|hop| hop.evidence == HopEvidence::NotObserved));
        phase_operation(&health, "direct-tcp-connect", final_index, 0)
            .unwrap()
            .finish(true);
        assert_eq!(health.snapshot("actor").hops[0].state, HopState::Unknown);
        assert_eq!(health.snapshot("actor").hops[1].state, HopState::Waiting);
    }
    #[test]
    fn phase_mapping_preserves_each_hop_and_never_stores_peer_text() {
        let health = RouteHealth::default();
        for index in 0..3 {
            health.record(
                index,
                if index == 2 {
                    HopKind::Ssh
                } else {
                    HopKind::SshJump
                },
                HopStage::Transport,
                HopState::Unknown,
                HopEvidence::NotObserved,
            );
        }
        phase_operation(&health, "jump-hop-2-authentication", 2, 0)
            .unwrap()
            .finish(true);
        phase_operation(&health, "final-ssh-handshake", 2, 0)
            .unwrap()
            .finish(false);
        assert!(phase_operation(&health, "private-host-with-password", 2, 0).is_none());
        let snapshot = health.snapshot("actor");
        assert_eq!(snapshot.hops[0].state, HopState::Unknown);
        assert_eq!(snapshot.hops[1].evidence, HopEvidence::Negotiated);
        assert_eq!(snapshot.hops[2].state, HopState::Failed);
        assert!(!serde_json::to_string(&snapshot)
            .unwrap()
            .contains("private-host"));
    }
}
