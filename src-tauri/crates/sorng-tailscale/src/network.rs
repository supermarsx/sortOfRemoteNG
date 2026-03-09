//! # Tailscale Network Operations
//!
//! Netcheck execution and parsing, DERP region enumeration and latency probing,
//! peer path monitoring, MagicSock stats.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Netcheck result from `tailscale netcheck`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetcheckReport {
    pub udp: bool,
    pub ipv4: bool,
    pub ipv6: bool,
    pub mapping_varies_by_dest_ip: Option<bool>,
    pub hair_pinning: Option<bool>,
    pub portmap_probe: Option<PortMapProbe>,
    pub preferred_derp: Option<u32>,
    pub region_latency: HashMap<u32, f64>,
    pub region_v4_latency: HashMap<u32, f64>,
    pub region_v6_latency: HashMap<u32, f64>,
    pub global_v4: Option<String>,
    pub global_v6: Option<String>,
    pub captive_portal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapProbe {
    pub upnp: bool,
    pub pmp: bool,
    pub pcp: bool,
}

/// DERP region detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerpRegionDetail {
    pub region_id: u32,
    pub region_code: String,
    pub region_name: String,
    pub avoid: bool,
    pub nodes: Vec<DerpNodeDetail>,
    pub latency_ms: Option<f64>,
    pub is_preferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerpNodeDetail {
    pub name: String,
    pub region_id: u32,
    pub host_name: String,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub stun_port: u16,
    pub stun_only: bool,
    pub derp_port: u16,
    pub insecure_for_tests: bool,
    pub can_port80: bool,
}

/// Peer path information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerPath {
    pub peer_id: String,
    pub peer_name: String,
    pub is_direct: bool,
    pub current_addr: Option<String>,
    pub derp_region: Option<String>,
    pub latency_ms: Option<f64>,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub last_seen: Option<String>,
    pub endpoints: Vec<String>,
}

/// MagicSock statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicSockStats {
    pub derp_home_region: Option<u32>,
    pub derp_connections: u32,
    pub direct_connections: u32,
    pub total_peers: u32,
    pub active_peers: u32,
    pub total_tx_bytes: u64,
    pub total_rx_bytes: u64,
}

/// Build the netcheck command.
pub fn netcheck_command(verbose: bool) -> Vec<String> {
    let mut cmd = vec![
        "tailscale".to_string(),
        "netcheck".to_string(),
        "--format=json".to_string(),
    ];
    if verbose {
        cmd.push("--verbose".to_string());
    }
    cmd
}

/// Parse netcheck JSON output.
pub fn parse_netcheck_json(json: &str) -> Result<NetcheckReport, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse netcheck: {}", e))
}

/// Build ping command to specific peer.
pub fn ping_command(target: &str, count: u32, via_derp: bool) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "ping".to_string()];
    if count > 0 {
        cmd.push(format!("--c={}", count));
    }
    if via_derp {
        cmd.push("--until-direct=false".to_string());
    }
    cmd.push(target.to_string());
    cmd
}

/// Extract peer paths from status JSON.
pub fn extract_peer_paths(peers: &HashMap<String, super::daemon::PeerJson>) -> Vec<PeerPath> {
    peers
        .iter()
        .map(|(key, p)| {
            let is_direct = p.cur_addr.is_some() && p.cur_addr.as_deref() != Some("");
            PeerPath {
                peer_id: key.clone(),
                peer_name: p.host_name.clone().unwrap_or_default(),
                is_direct,
                current_addr: p.cur_addr.clone(),
                derp_region: p.relay.clone(),
                latency_ms: None, // requires ping
                tx_bytes: p.tx_bytes.unwrap_or(0),
                rx_bytes: p.rx_bytes.unwrap_or(0),
                last_seen: None,
                endpoints: p.addrs.clone().unwrap_or_default(),
            }
        })
        .collect()
}

/// Compute aggregate MagicSock stats from peer data.
pub fn compute_magicsock_stats(
    peers: &HashMap<String, super::daemon::PeerJson>,
    preferred_derp: Option<u32>,
) -> MagicSockStats {
    let mut direct = 0u32;
    let mut derp = 0u32;
    let mut active = 0u32;
    let mut total_tx = 0u64;
    let mut total_rx = 0u64;

    for p in peers.values() {
        let is_direct = p.cur_addr.is_some() && p.cur_addr.as_deref() != Some("");
        if is_direct {
            direct += 1;
        } else if p.online == Some(true) {
            derp += 1;
        }
        if p.active == Some(true) {
            active += 1;
        }
        total_tx += p.tx_bytes.unwrap_or(0);
        total_rx += p.rx_bytes.unwrap_or(0);
    }

    MagicSockStats {
        derp_home_region: preferred_derp,
        derp_connections: derp,
        direct_connections: direct,
        total_peers: peers.len() as u32,
        active_peers: active,
        total_tx_bytes: total_tx,
        total_rx_bytes: total_rx,
    }
}

/// Classify peer connection quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionQuality {
    Excellent,
    Good,
    Fair,
    Poor,
    Offline,
}

pub fn classify_connection_quality(
    latency_ms: Option<f64>,
    is_direct: bool,
    is_online: bool,
) -> ConnectionQuality {
    if !is_online {
        return ConnectionQuality::Offline;
    }
    match (is_direct, latency_ms) {
        (true, Some(l)) if l < 20.0 => ConnectionQuality::Excellent,
        (true, Some(l)) if l < 80.0 => ConnectionQuality::Good,
        (true, _) => ConnectionQuality::Fair,
        (false, Some(l)) if l < 100.0 => ConnectionQuality::Good,
        (false, Some(l)) if l < 250.0 => ConnectionQuality::Fair,
        (false, _) => ConnectionQuality::Poor,
    }
}
