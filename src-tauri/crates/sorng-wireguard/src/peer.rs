//! # WireGuard Peer Management
//!
//! Peer configuration, handshake monitoring, transfer stats,
//! endpoint resolution.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Extended peer info with computed metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDetail {
    pub public_key: String,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub handshake_status: HandshakeStatus,
    pub handshake_age_secs: Option<u64>,
    pub transfer_rx: u64,
    pub transfer_tx: u64,
    pub persistent_keepalive: Option<u16>,
    pub has_preshared_key: bool,
    pub is_full_tunnel: bool,
    pub is_reachable: bool,
}

/// Build peer details from stats.
pub fn build_peer_detail(stats: &WgPeerStats, now_epoch: u64) -> PeerDetail {
    let handshake_age = stats
        .latest_handshake
        .map(|ts| now_epoch.saturating_sub(ts));

    let handshake_status = match handshake_age {
        None | Some(0) if stats.latest_handshake.is_none() => HandshakeStatus::None,
        Some(age) if age < 180 => HandshakeStatus::Active,
        Some(_) => HandshakeStatus::Stale,
        None => HandshakeStatus::None,
    };

    let is_full_tunnel = stats
        .allowed_ips
        .iter()
        .any(|a| a == "0.0.0.0/0" || a == "::/0");

    let is_reachable = handshake_status == HandshakeStatus::Active;

    PeerDetail {
        public_key: stats.public_key.clone(),
        endpoint: stats.endpoint.clone(),
        allowed_ips: stats.allowed_ips.clone(),
        handshake_status,
        handshake_age_secs: handshake_age,
        transfer_rx: stats.transfer_rx,
        transfer_tx: stats.transfer_tx,
        persistent_keepalive: stats.persistent_keepalive,
        has_preshared_key: stats.preshared_key.is_some(),
        is_full_tunnel,
        is_reachable,
    }
}

/// Build all peer details.
pub fn build_all_peer_details(stats: &WgInterfaceStats, now_epoch: u64) -> Vec<PeerDetail> {
    stats
        .peers
        .iter()
        .map(|p| build_peer_detail(p, now_epoch))
        .collect()
}

/// Get the transfer summary for all peers.
pub fn transfer_summary(peers: &[PeerDetail]) -> TransferSummary {
    let total_rx: u64 = peers.iter().map(|p| p.transfer_rx).sum();
    let total_tx: u64 = peers.iter().map(|p| p.transfer_tx).sum();
    let active_peers = peers
        .iter()
        .filter(|p| p.handshake_status == HandshakeStatus::Active)
        .count();

    TransferSummary {
        total_rx_bytes: total_rx,
        total_tx_bytes: total_tx,
        active_peers,
        total_peers: peers.len(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferSummary {
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub active_peers: usize,
    pub total_peers: usize,
}

/// Truncate a public key for display (first 8 chars + ...).
pub fn short_key(key: &str) -> String {
    if key.len() > 8 {
        format!("{}...", &key[..8])
    } else {
        key.to_string()
    }
}

/// Format transfer bytes to human-readable.
pub fn format_transfer(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GiB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

/// Format handshake age.
pub fn format_handshake_age(age_secs: Option<u64>) -> String {
    match age_secs {
        None => "never".to_string(),
        Some(0) => "just now".to_string(),
        Some(s) if s < 60 => format!("{} seconds ago", s),
        Some(s) if s < 3600 => format!("{} minutes ago", s / 60),
        Some(s) if s < 86400 => format!("{} hours ago", s / 3600),
        Some(s) => format!("{} days ago", s / 86400),
    }
}

/// Check if a peer needs attention (stale handshake, no traffic).
pub fn needs_attention(detail: &PeerDetail) -> Vec<String> {
    let mut issues = Vec::new();

    if detail.handshake_status == HandshakeStatus::None && detail.endpoint.is_some() {
        issues.push("No handshake established — check endpoint reachability".to_string());
    }

    if detail.handshake_status == HandshakeStatus::Stale {
        issues.push(format!(
            "Handshake is stale ({})",
            format_handshake_age(detail.handshake_age_secs)
        ));
    }

    if detail.is_full_tunnel && !detail.is_reachable {
        issues.push("Full tunnel peer is unreachable — internet access may be affected".to_string());
    }

    if detail.endpoint.is_none() && detail.persistent_keepalive.is_none() {
        issues.push("No endpoint and no keepalive — this peer can only receive connections".to_string());
    }

    issues
}

/// Resolve endpoint to IP:port for display.
pub fn parse_endpoint(endpoint: &str) -> Option<(String, u16)> {
    // Handle IPv6: [::1]:51820
    if endpoint.starts_with('[') {
        if let Some(bracket_end) = endpoint.find("]:") {
            let host = endpoint[1..bracket_end].to_string();
            let port = endpoint[bracket_end + 2..].parse::<u16>().ok()?;
            return Some((host, port));
        }
    }

    // Handle IPv4: 1.2.3.4:51820
    if let Some(colon) = endpoint.rfind(':') {
        let host = endpoint[..colon].to_string();
        let port = endpoint[colon + 1..].parse::<u16>().ok()?;
        return Some((host, port));
    }

    None
}
