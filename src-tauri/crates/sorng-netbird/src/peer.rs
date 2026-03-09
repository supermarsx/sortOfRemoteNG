//! # NetBird Peer Management
//!
//! Peer lifecycle helpers: approve/reject, block/unblock, label, SSH toggle,
//! connectivity probes, and connection quality classification.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Request body for updating a peer via the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerUpdateRequest {
    pub name: Option<String>,
    pub ssh_enabled: Option<bool>,
    pub login_expiration_enabled: Option<bool>,
    pub approval_required: Option<bool>,
}

/// Peer approval action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerApprovalAction {
    Approve,
    Reject,
}

/// Classify connection quality based on latency and connection type.
pub fn classify_connection_quality(
    latency_ms: Option<f64>,
    connection_type: PeerConnectionType,
    connected: bool,
) -> ConnectionQuality {
    if !connected {
        return ConnectionQuality::Offline;
    }
    match (connection_type, latency_ms) {
        (PeerConnectionType::Direct, Some(l)) if l < 10.0 => ConnectionQuality::Excellent,
        (PeerConnectionType::Direct, Some(l)) if l < 50.0 => ConnectionQuality::Good,
        (PeerConnectionType::Direct, _) => ConnectionQuality::Fair,
        (PeerConnectionType::Relayed, Some(l)) if l < 80.0 => ConnectionQuality::Good,
        (PeerConnectionType::Relayed, Some(l)) if l < 200.0 => ConnectionQuality::Fair,
        (PeerConnectionType::Relayed, _) => ConnectionQuality::Poor,
        _ => ConnectionQuality::Unknown,
    }
}

/// Connection quality classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionQuality {
    Excellent,
    Good,
    Fair,
    Poor,
    Offline,
    Unknown,
}

/// Compute per-peer connection summaries.
pub fn summarize_peers(peers: &[&NetBirdPeer]) -> Vec<PeerSummary> {
    peers
        .iter()
        .map(|p| PeerSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            ip: p.ip.clone(),
            connected: p.connected,
            connection_type: p.connection_type,
            quality: classify_connection_quality(p.latency_ms, p.connection_type, p.connected),
            latency_ms: p.latency_ms,
            rx_bytes: p.rx_bytes,
            tx_bytes: p.tx_bytes,
            os: p.os.clone(),
            version: p.version.clone(),
            groups: p.groups.iter().map(|g| g.name.clone()).collect(),
        })
        .collect()
}

/// A summarized view of a peer for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerSummary {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub connected: bool,
    pub connection_type: PeerConnectionType,
    pub quality: ConnectionQuality,
    pub latency_ms: Option<f64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub os: String,
    pub version: String,
    pub groups: Vec<String>,
}

/// Group peers by their connection type.
pub fn group_by_connection_type(peers: &[&NetBirdPeer]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for p in peers {
        let key = format!("{:?}", p.connection_type);
        map.entry(key).or_default().push(p.id.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_peer(
        id: &str,
        connected: bool,
        ct: PeerConnectionType,
        latency: Option<f64>,
    ) -> NetBirdPeer {
        NetBirdPeer {
            id: id.to_string(),
            name: id.to_string(),
            ip: "100.64.0.1".into(),
            ipv6: None,
            fqdn: None,
            hostname: id.to_string(),
            os: "linux".into(),
            version: "0.28.0".into(),
            ui_version: None,
            kernel_version: None,
            connected,
            last_seen: Utc::now(),
            last_login: None,
            login_expired: false,
            login_expiration_enabled: false,
            connection_ip: None,
            groups: vec![],
            accessible_peers: vec![],
            accessible_peers_count: 0,
            user_id: None,
            ssh_enabled: false,
            approval_required: false,
            country_code: None,
            city_name: None,
            serial_number: None,
            dns_label: None,
            connection_type: ct,
            latency_ms: latency,
            rx_bytes: 0,
            tx_bytes: 0,
            wireguard_pubkey: None,
        }
    }

    #[test]
    fn test_classify_connection_quality_direct_excellent() {
        assert_eq!(
            classify_connection_quality(Some(5.0), PeerConnectionType::Direct, true),
            ConnectionQuality::Excellent
        );
    }

    #[test]
    fn test_classify_connection_quality_offline() {
        assert_eq!(
            classify_connection_quality(Some(5.0), PeerConnectionType::Direct, false),
            ConnectionQuality::Offline
        );
    }

    #[test]
    fn test_classify_connection_quality_relayed_poor() {
        assert_eq!(
            classify_connection_quality(Some(300.0), PeerConnectionType::Relayed, true),
            ConnectionQuality::Poor
        );
    }

    #[test]
    fn test_summarize_peers() {
        let p = make_peer("a", true, PeerConnectionType::Direct, Some(8.0));
        let summaries = summarize_peers(&[&p]);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].quality, ConnectionQuality::Excellent);
    }

    #[test]
    fn test_group_by_connection_type() {
        let p1 = make_peer("a", true, PeerConnectionType::Direct, None);
        let p2 = make_peer("b", true, PeerConnectionType::Relayed, None);
        let map = group_by_connection_type(&[&p1, &p2]);
        assert_eq!(map.len(), 2);
    }
}
