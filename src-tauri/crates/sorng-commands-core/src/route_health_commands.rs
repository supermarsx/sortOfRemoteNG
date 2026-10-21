//! Read-only projection from the concrete RDP actor to its native registered tunnel.
#[cfg(feature = "rdp")]
use crate::*;
use sorng_core::route_health::*;

#[cfg(feature = "rdp")]
fn prepend_upstream(snapshot: &mut RouteHealthSnapshot, mut upstream: RouteHealthSnapshot) {
    if snapshot.hops.len() > 64 {
        snapshot.hops.truncate(64);
        snapshot.truncated = true;
    }
    let capacity = 64 - snapshot.hops.len();
    if upstream.hops.len() > capacity {
        upstream.hops.truncate(capacity);
        snapshot.truncated = true;
    }
    snapshot.truncated |= upstream.truncated;
    upstream.hops.append(&mut snapshot.hops);
    for (index, hop) in upstream.hops.iter_mut().enumerate() {
        hop.index = index;
    }
    snapshot.hops = upstream.hops;
}

#[cfg(feature = "rdp")]
fn same_endpoint(
    host: &str,
    port: u16,
    target: &rdp::settings::RdpTargetIdentity,
    tunnel: &ssh::RdpTunnelStatus,
) -> bool {
    // Never match only a destination or accept a renderer-supplied SSH actor ID.
    host.parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
        && tunnel.bind_address == host
        && tunnel.local_port == port
        && tunnel.remote_rdp_host == target.host
        && tunnel.remote_rdp_port == target.port
}

#[tauri::command]
#[cfg(feature = "rdp")]
pub async fn get_rdp_route_health(
    rdp_state: tauri::State<'_, rdp::RdpServiceState>,
    ssh_state: tauri::State<'_, ssh::SshServiceState>,
    session_id: String,
) -> Result<RouteHealthSnapshot, String> {
    let (session, stats, mut snapshot) = {
        let service = rdp_state.lock().await;
        let actor = service
            .connections
            .get(&session_id)
            .ok_or("RDP route actor is unavailable")?;
        (
            actor.session.clone(),
            actor.stats.clone(),
            actor.stats.route_health.snapshot(&session_id),
        )
    };
    let bindings: Vec<_> = ssh::RDP_TUNNELS
        .lock()
        .map_err(|_| "RDP route observations are unavailable")?
        .values()
        .filter(|tunnel| {
            session
                .target_identity
                .as_ref()
                .is_some_and(|target| same_endpoint(&session.host, session.port, target, tunnel))
        })
        .cloned()
        .collect();
    if let Some(hop) = snapshot
        .hops
        .iter_mut()
        .find(|hop| hop.kind == HopKind::Rdp)
    {
        let (host, port) = session
            .target_identity
            .as_ref()
            .map(|target| (target.host.as_str(), target.port))
            .unwrap_or((session.host.as_str(), session.port));
        hop.endpoint = HopEndpoint::new(host, port, HopProtocol::Rdp);
    }
    if bindings.len() == 1 {
        let binding = &bindings[0];
        let service = ssh_state.lock().await;
        // A registry entry alone is insufficient: attest its current native forward.
        if let Ok(info) = service.get_port_forward_info(&binding.session_id, &binding.forward_id) {
            if info.config.local_host == session.host
                && info.config.local_port == session.port
                && info.config.remote_host == binding.remote_rdp_host
                && info.config.remote_port == binding.remote_rdp_port
                && matches!(info.config.direction, ssh::PortForwardDirection::Local)
            {
                if let Ok(upstream) = service.route_health(&binding.session_id) {
                    prepend_upstream(&mut snapshot, upstream);
                }
            }
        }
    }
    // Own transport state never implies every upstream component is healthy.
    if let Some(target) = &session.target_identity {
        if (target.host != session.host || target.port != session.port)
            && !snapshot
                .hops
                .iter()
                .any(|hop| hop.kind == HopKind::LocalForward)
        {
            if snapshot.hops.len() >= 64 {
                snapshot.truncated = true;
            }
            let index = snapshot.hops.len();
            if index < 64 {
                snapshot.hops.push(HopObservation {
                    index,
                    kind: HopKind::LocalForward,
                    state: HopState::Unknown,
                    evidence: HopEvidence::NotObserved,
                    stage: HopStage::ForwardListener,
                    updated_at_unix_ms: None,
                    endpoint: HopEndpoint::new(&session.host, session.port, HopProtocol::Tcp),
                });
            }
        }
    }
    if !rdp_state
        .lock()
        .await
        .connections
        .get(&session_id)
        .is_some_and(|actor| std::sync::Arc::ptr_eq(&actor.stats, &stats))
    {
        return Err("RDP route actor is unavailable".into());
    }
    snapshot.observed_at_unix_ms = now_unix_ms();
    Ok(snapshot)
}

#[cfg(not(feature = "rdp"))]
#[tauri::command]
pub async fn get_rdp_route_health() -> Result<RouteHealthSnapshot, String> {
    Err("RDP feature is not enabled".into())
}

#[cfg(all(test, feature = "rdp"))]
mod tests {
    use super::*;
    #[test]
    fn combined_chain_reserves_own_actor_and_explicitly_reports_truncation() {
        let upstream = RouteHealth::default();
        for index in 0..64 {
            upstream.record(
                index,
                HopKind::Proxy,
                HopStage::ProxyNegotiation,
                HopState::Failed,
                HopEvidence::NegotiationFailed,
            );
        }
        let own = RouteHealth::default();
        own.record(
            0,
            HopKind::Rdp,
            HopStage::Transport,
            HopState::Connected,
            HopEvidence::RuntimeActive,
        );
        let mut snapshot = own.snapshot("rdp-actor");
        prepend_upstream(&mut snapshot, upstream.snapshot("ssh-actor"));
        assert_eq!(snapshot.session_id, "rdp-actor");
        assert_eq!(snapshot.hops.len(), 64);
        assert!(snapshot.truncated);
        assert_eq!(snapshot.hops[0].state, HopState::Failed);
        assert_eq!(snapshot.hops[63].kind, HopKind::Rdp);
        assert!(snapshot
            .hops
            .iter()
            .enumerate()
            .all(|(index, hop)| index == hop.index));
    }
    #[test]
    fn tunnel_binding_requires_actual_local_endpoint_and_logical_target() {
        let target = rdp::settings::RdpTargetIdentity {
            host: "target.test".into(),
            port: 3389,
        };
        let tunnel = ssh::RdpTunnelStatus {
            tunnel_id: "private".into(),
            session_id: "private-actor".into(),
            local_port: 4567,
            remote_rdp_host: target.host.clone(),
            remote_rdp_port: target.port,
            forward_id: "private-forward".into(),
            bind_address: "127.0.0.1".into(),
            label: None,
            nla_enabled: true,
            enable_udp: false,
            connection_string: String::new(),
            created_at: chrono::Utc::now(),
        };
        assert!(same_endpoint("127.0.0.1", 4567, &target, &tunnel));
        assert!(!same_endpoint("127.0.0.1", 4568, &target, &tunnel));
        assert!(!same_endpoint("remote.test", 4567, &target, &tunnel));
        let other = rdp::settings::RdpTargetIdentity {
            host: "other.test".into(),
            port: 3389,
        };
        assert!(!same_endpoint("127.0.0.1", 4567, &other, &tunnel));
    }
}
