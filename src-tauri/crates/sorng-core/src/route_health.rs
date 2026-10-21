//! Credential-free observations of owned route components. Never authorizes or probes traffic.
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HopKind {
    Ssh,
    SshJump,
    Proxy,
    ProxyCommand,
    Vpn,
    LocalForward,
    Rdp,
    PrivateRelay,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HopState {
    Waiting,
    Connected,
    Failed,
    Disconnected,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HopEvidence {
    Negotiating,
    Negotiated,
    NegotiationFailed,
    RuntimeActive,
    RuntimeEnded,
    ChannelUnavailable,
    NotObserved,
    ForwardActive,
    ForwardEnded,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HopStage {
    Dns,
    Tcp,
    ProxyNegotiation,
    SshHandshake,
    SshAuthentication,
    ChannelOpen,
    ForwardListener,
    RdpHandshake,
    Transport,
    Relay,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HopProtocol {
    Ssh,
    Socks4,
    Socks5,
    HttpConnect,
    HttpsConnect,
    Rdp,
    Tcp,
    Openvpn,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HopEndpoint {
    pub host: String,
    pub port: u16,
    pub protocol: HopProtocol,
}
impl HopEndpoint {
    pub fn new(host: &str, port: u16, protocol: HopProtocol) -> Option<Self> {
        if host.is_empty()
            || host.len() > 253
            || port == 0
            || host.chars().any(|c| c.is_control() || c.is_whitespace())
            || host.contains(['/', '\\', '@', '?', '#', '"', '\''])
        {
            return None;
        }
        let host = if host.starts_with('[') || host.ends_with(']') {
            let host = host.strip_prefix('[')?.strip_suffix(']')?;
            host.parse::<std::net::Ipv6Addr>().ok()?;
            host
        } else {
            host
        };
        if host.contains(':') {
            host.parse::<std::net::Ipv6Addr>().ok()?;
        }
        Some(Self {
            host: host.to_owned(),
            port,
            protocol,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HopObservation {
    pub index: usize,
    pub kind: HopKind,
    pub state: HopState,
    pub evidence: HopEvidence,
    pub stage: HopStage,
    /// Event time, not snapshot receipt time; absent if the clock is invalid.
    pub updated_at_unix_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<HopEndpoint>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteHealthSnapshot {
    pub session_id: String,
    pub observed_at_unix_ms: Option<u64>,
    pub hops: Vec<HopObservation>,
    pub truncated: bool,
}
pub type RouteHealthReader = Arc<dyn Fn(&str) -> RouteHealthSnapshot + Send + Sync>;
type HopRows = BTreeMap<usize, (HopObservation, Arc<()>)>;
pub fn now_unix_ms() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}
#[derive(Clone, Default, Debug)]
pub struct RouteHealth {
    rows: Arc<Mutex<HopRows>>,
    truncated: Arc<AtomicBool>,
}
impl RouteHealth {
    pub fn set_endpoint(&self, index: usize, endpoint: Option<HopEndpoint>) {
        if let Ok(mut rows) = self.rows.lock() {
            if let Some((row, _)) = rows.get_mut(&index) {
                row.endpoint = endpoint;
            }
        }
    }
    pub fn mark_truncated(&self) {
        self.truncated.store(true, Ordering::Relaxed);
    }
    pub fn record(
        &self,
        index: usize,
        kind: HopKind,
        stage: HopStage,
        state: HopState,
        evidence: HopEvidence,
    ) {
        if index >= 64 {
            self.mark_truncated();
            return;
        }
        if let Ok(mut rows) = self.rows.lock() {
            let endpoint = rows.get(&index).and_then(|(row, _)| row.endpoint.clone());
            rows.insert(
                index,
                (
                    HopObservation {
                        index,
                        kind,
                        stage,
                        state,
                        evidence,
                        updated_at_unix_ms: now_unix_ms(),
                        endpoint,
                    },
                    Arc::new(()),
                ),
            );
        }
    }
    pub fn snapshot(&self, session_id: &str) -> RouteHealthSnapshot {
        let hops = self
            .rows
            .lock()
            .map(|rows| rows.values().map(|(row, _)| row.clone()).collect())
            .unwrap_or_default();
        RouteHealthSnapshot {
            session_id: session_id.to_owned(),
            observed_at_unix_ms: now_unix_ms(),
            hops,
            truncated: self.truncated.load(Ordering::Relaxed),
        }
    }
    /// A dropped in-flight operation is cancellation, never successful negotiation.
    pub fn begin(&self, index: usize, kind: HopKind, stage: HopStage) -> HopOperation {
        let token = Arc::new(());
        if index < 64 {
            if let Ok(mut rows) = self.rows.lock() {
                let endpoint = rows.get(&index).and_then(|(row, _)| row.endpoint.clone());
                rows.insert(
                    index,
                    (
                        HopObservation {
                            index,
                            kind,
                            stage,
                            state: HopState::Waiting,
                            evidence: HopEvidence::Negotiating,
                            updated_at_unix_ms: now_unix_ms(),
                            endpoint,
                        },
                        token.clone(),
                    ),
                );
            }
        } else {
            self.mark_truncated();
        }
        HopOperation {
            health: self.clone(),
            index,
            stage,
            settled: false,
            token,
        }
    }
}
pub struct HopOperation {
    health: RouteHealth,
    index: usize,
    stage: HopStage,
    settled: bool,
    token: Arc<()>,
}
impl HopOperation {
    pub fn set_endpoint(&self, endpoint: Option<HopEndpoint>) {
        if let Ok(mut rows) = self.health.rows.lock() {
            if let Some((row, token)) = rows.get_mut(&self.index) {
                if Arc::ptr_eq(token, &self.token) {
                    row.endpoint = endpoint;
                }
            }
        }
    }
    fn update(&self, state: HopState, evidence: HopEvidence) {
        if let Ok(mut rows) = self.health.rows.lock() {
            if let Some((row, token)) = rows.get_mut(&self.index) {
                if Arc::ptr_eq(token, &self.token) {
                    row.state = state;
                    row.evidence = evidence;
                    row.updated_at_unix_ms = now_unix_ms();
                }
            }
        }
    }
    pub fn finish(mut self, success: bool) {
        let terminal_stage = matches!(
            self.stage,
            HopStage::SshAuthentication
                | HopStage::ProxyNegotiation
                | HopStage::ChannelOpen
                | HopStage::Transport
        );
        self.update(
            if success && !terminal_stage {
                HopState::Waiting
            } else if success {
                HopState::Connected
            } else {
                HopState::Failed
            },
            if success && !terminal_stage {
                HopEvidence::Negotiating
            } else if success {
                HopEvidence::Negotiated
            } else {
                HopEvidence::NegotiationFailed
            },
        );
        self.settled = true;
    }
}
impl Drop for HopOperation {
    fn drop(&mut self) {
        if !self.settled {
            self.update(HopState::Disconnected, HopEvidence::RuntimeEnded);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_metadata_is_safe_preserved_and_bound_to_its_operation() {
        for host in [
            "user@host",
            "host/path",
            "https://host",
            "host?token",
            "host#secret",
            "host\nsecret",
            "[invalid]",
            "host:22",
        ] {
            assert!(HopEndpoint::new(host, 22, HopProtocol::Ssh).is_none());
        }
        assert!(HopEndpoint::new("host", 0, HopProtocol::Ssh).is_none());
        let health = RouteHealth::default();
        let old = health.begin(0, HopKind::Proxy, HopStage::ProxyNegotiation);
        old.set_endpoint(HopEndpoint::new("old.test", 443, HopProtocol::HttpsConnect));
        let latest = health.begin(0, HopKind::Proxy, HopStage::ProxyNegotiation);
        latest.set_endpoint(HopEndpoint::new("[::1]", 443, HopProtocol::HttpsConnect));
        old.set_endpoint(HopEndpoint::new(
            "stale.test",
            443,
            HopProtocol::HttpsConnect,
        ));
        old.finish(false);
        latest.finish(true);
        assert_eq!(
            health.snapshot("actor").hops[0]
                .endpoint
                .as_ref()
                .unwrap()
                .host,
            "::1"
        );
    }
    #[test]
    fn distinct_hops_preserve_failures_and_order_without_outer_success_inference() {
        let health = RouteHealth::default();
        health
            .begin(1, HopKind::Ssh, HopStage::SshAuthentication)
            .finish(true);
        health
            .begin(0, HopKind::Proxy, HopStage::ProxyNegotiation)
            .finish(false);
        let snapshot = health.snapshot("actor");
        assert_eq!(snapshot.hops.len(), 2);
        assert_eq!(snapshot.hops[0].state, HopState::Failed);
        assert_eq!(snapshot.hops[1].evidence, HopEvidence::Negotiated);
        assert!(snapshot.hops[0].updated_at_unix_ms.is_some());
    }
    #[test]
    fn cancellation_and_bounds_cannot_fabricate_success() {
        let health = RouteHealth::default();
        drop(health.begin(0, HopKind::SshJump, HopStage::Tcp));
        health.record(
            128,
            HopKind::Proxy,
            HopStage::Tcp,
            HopState::Connected,
            HopEvidence::Negotiated,
        );
        let snapshot = health.snapshot("actor");
        assert_eq!(snapshot.hops.len(), 1);
        assert_eq!(snapshot.hops[0].state, HopState::Disconnected);
    }
    #[test]
    fn stale_parallel_completion_cannot_overwrite_a_newer_hop_operation() {
        let health = RouteHealth::default();
        let old = health.begin(0, HopKind::Proxy, HopStage::ProxyNegotiation);
        health
            .begin(0, HopKind::Proxy, HopStage::ProxyNegotiation)
            .finish(false);
        old.finish(true);
        assert_eq!(health.snapshot("actor").hops[0].state, HopState::Failed);
    }
    #[test]
    fn partial_handshake_success_is_not_component_negotiation_success() {
        let health = RouteHealth::default();
        for stage in [HopStage::Dns, HopStage::Tcp, HopStage::SshHandshake] {
            health.begin(0, HopKind::Ssh, stage).finish(true);
            assert_eq!(health.snapshot("actor").hops[0].state, HopState::Waiting);
        }
        health
            .begin(0, HopKind::Ssh, HopStage::SshAuthentication)
            .finish(true);
        assert_eq!(
            health.snapshot("actor").hops[0].evidence,
            HopEvidence::Negotiated
        );
    }
}
