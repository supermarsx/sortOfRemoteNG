//! # Tailscale Peer Management
//!
//! Detailed peer information parsing, direct/relay detection,
//! latency measurement, ping operations, peer grouping.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Extended peer information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDetail {
    pub id: String,
    pub public_key: String,
    pub hostname: String,
    pub dns_name: String,
    pub os: String,
    pub tailscale_ips: Vec<String>,
    pub allowed_ips: Vec<String>,
    pub connection: PeerConnectionInfo,
    pub capabilities: PeerCapabilities,
    pub tags: Vec<String>,
    pub last_seen: Option<String>,
    pub created: Option<String>,
    pub online: bool,
    pub is_self: bool,
}

/// Connection details for a specific peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerConnectionInfo {
    pub connection_type: PeerConnectionType,
    pub current_address: Option<String>,
    pub derp_region: Option<String>,
    pub endpoints: Vec<String>,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub latency_ms: Option<f64>,
    pub last_handshake: Option<String>,
    pub in_network_map: bool,
    pub in_magic_sock: bool,
    pub in_engine: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerConnectionType {
    Direct,
    Relay,
    Offline,
    Unknown,
}

/// Peer capabilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerCapabilities {
    pub is_exit_node: bool,
    pub offers_exit_node: bool,
    pub has_ssh: bool,
    pub has_taildrop: bool,
    pub supports_funnel: bool,
    pub advertised_routes: Vec<String>,
}

/// Parse detailed peer info from status JSON peer.
pub fn parse_peer_detail(key: &str, peer: &super::daemon::PeerJson, is_self: bool) -> PeerDetail {
    let has_direct_addr = peer.cur_addr.is_some()
        && peer.cur_addr.as_deref() != Some("")
        && peer.cur_addr.as_deref().is_some();
    let is_online = peer.online.unwrap_or(false);

    let connection_type = if !is_online {
        PeerConnectionType::Offline
    } else if has_direct_addr {
        PeerConnectionType::Direct
    } else if peer.relay.is_some() {
        PeerConnectionType::Relay
    } else {
        PeerConnectionType::Unknown
    };

    let has_ssh = peer
        .ssh_host_keys
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    PeerDetail {
        id: peer.id.clone().unwrap_or_else(|| key.to_string()),
        public_key: peer.public_key.clone().unwrap_or_default(),
        hostname: peer.host_name.clone().unwrap_or_default(),
        dns_name: peer.dns_name.clone().unwrap_or_default(),
        os: peer.os.clone().unwrap_or_default(),
        tailscale_ips: peer.tailscale_ips.clone().unwrap_or_default(),
        allowed_ips: peer.allowed_ips.clone().unwrap_or_default(),
        connection: PeerConnectionInfo {
            connection_type,
            current_address: peer.cur_addr.clone(),
            derp_region: peer.relay.clone(),
            endpoints: peer.addrs.clone().unwrap_or_default(),
            tx_bytes: peer.tx_bytes.unwrap_or(0),
            rx_bytes: peer.rx_bytes.unwrap_or(0),
            latency_ms: None, // requires ping
            last_handshake: None,
            in_network_map: peer.in_network_map.unwrap_or(false),
            in_magic_sock: peer.in_magic_sock.unwrap_or(false),
            in_engine: peer.in_engine.unwrap_or(false),
        },
        capabilities: PeerCapabilities {
            is_exit_node: peer.exit_node == Some(true),
            offers_exit_node: peer.exit_node_option == Some(true),
            has_ssh,
            has_taildrop: is_online,       // generally available if online
            supports_funnel: false,        // requires ACL check
            advertised_routes: Vec::new(), // not in basic status
        },
        tags: peer.tags.clone().unwrap_or_default(),
        last_seen: None,
        created: None,
        online: is_online,
        is_self,
    }
}

/// Parse all peers from status JSON.
pub fn parse_all_peers(status: &super::daemon::TailscaleStatusJson) -> Vec<PeerDetail> {
    let mut peers = Vec::new();

    // Add self
    if let Some(self_info) = &status.self_info {
        peers.push(PeerDetail {
            id: self_info.id.clone().unwrap_or_default(),
            public_key: self_info.public_key.clone().unwrap_or_default(),
            hostname: self_info.host_name.clone().unwrap_or_default(),
            dns_name: self_info.dns_name.clone().unwrap_or_default(),
            os: self_info.os.clone().unwrap_or_default(),
            tailscale_ips: self_info.tailscale_ips.clone().unwrap_or_default(),
            allowed_ips: Vec::new(),
            connection: PeerConnectionInfo {
                connection_type: PeerConnectionType::Direct,
                current_address: None,
                derp_region: None,
                endpoints: Vec::new(),
                tx_bytes: 0,
                rx_bytes: 0,
                latency_ms: Some(0.0),
                last_handshake: None,
                in_network_map: true,
                in_magic_sock: true,
                in_engine: true,
            },
            capabilities: PeerCapabilities {
                is_exit_node: false,
                offers_exit_node: false,
                has_ssh: false,
                has_taildrop: true,
                supports_funnel: false,
                advertised_routes: Vec::new(),
            },
            tags: Vec::new(),
            last_seen: None,
            created: None,
            online: self_info.online.unwrap_or(true),
            is_self: true,
        });
    }

    // Add remote peers
    if let Some(peer_map) = &status.peer {
        for (key, peer) in peer_map {
            peers.push(parse_peer_detail(key, peer, false));
        }
    }

    peers
}

/// Filter peers by connection type.
pub fn filter_by_connection(
    peers: &[PeerDetail],
    conn_type: PeerConnectionType,
) -> Vec<&PeerDetail> {
    peers
        .iter()
        .filter(|p| p.connection.connection_type == conn_type)
        .collect()
}

/// Filter peers by tag.
pub fn filter_by_tag<'a>(peers: &'a [PeerDetail], tag: &str) -> Vec<&'a PeerDetail> {
    peers
        .iter()
        .filter(|p| p.tags.iter().any(|t| t == tag))
        .collect()
}

/// Filter to only online peers.
pub fn filter_online(peers: &[PeerDetail]) -> Vec<&PeerDetail> {
    peers.iter().filter(|p| p.online).collect()
}

/// Group peers by OS.
pub fn group_by_os(peers: &[PeerDetail]) -> HashMap<String, Vec<&PeerDetail>> {
    let mut groups: HashMap<String, Vec<&PeerDetail>> = HashMap::new();
    for peer in peers {
        groups.entry(peer.os.clone()).or_default().push(peer);
    }
    groups
}

/// Group peers by DERP region (relay).
pub fn group_by_derp_region(peers: &[PeerDetail]) -> HashMap<String, Vec<&PeerDetail>> {
    let mut groups: HashMap<String, Vec<&PeerDetail>> = HashMap::new();
    for peer in peers {
        let region = peer
            .connection
            .derp_region
            .clone()
            .unwrap_or_else(|| "none".to_string());
        groups.entry(region).or_default().push(peer);
    }
    groups
}

/// Build ping command to measure peer latency.
pub fn ping_command(target: &str, count: u32, timeout_secs: u32) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "ping".to_string()];
    if count > 0 {
        cmd.push(format!("--c={}", count));
    }
    if timeout_secs > 0 {
        cmd.push(format!("--timeout={}s", timeout_secs));
    }
    cmd.push(target.to_string());
    cmd
}

/// Parse ping output to extract latency.
pub fn parse_ping_output(output: &str) -> Option<f64> {
    // Format: "pong from hostname (100.x.y.z) via DERP(nyc) in 42ms"
    // or: "pong from hostname (100.x.y.z) via 1.2.3.4:41641 in 5ms"
    for line in output.lines() {
        if let Some(idx) = line.rfind(" in ") {
            let rest = &line[idx + 4..];
            let ms_str = rest.trim_end_matches("ms").trim();
            if let Ok(ms) = ms_str.parse::<f64>() {
                return Some(ms);
            }
        }
    }
    None
}

/// Compute network summary stats.
pub fn compute_network_summary(peers: &[PeerDetail]) -> NetworkSummary {
    let total = peers.len();
    let online = peers.iter().filter(|p| p.online).count();
    let direct = peers
        .iter()
        .filter(|p| p.connection.connection_type == PeerConnectionType::Direct)
        .count();
    let relayed = peers
        .iter()
        .filter(|p| p.connection.connection_type == PeerConnectionType::Relay)
        .count();
    let exit_nodes = peers
        .iter()
        .filter(|p| p.capabilities.offers_exit_node)
        .count();
    let ssh_hosts = peers.iter().filter(|p| p.capabilities.has_ssh).count();

    NetworkSummary {
        total_peers: total,
        online_peers: online,
        direct_connections: direct,
        relayed_connections: relayed,
        exit_nodes_available: exit_nodes,
        ssh_hosts_available: ssh_hosts,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkSummary {
    pub total_peers: usize,
    pub online_peers: usize,
    pub direct_connections: usize,
    pub relayed_connections: usize,
    pub exit_nodes_available: usize,
    pub ssh_hosts_available: usize,
}
