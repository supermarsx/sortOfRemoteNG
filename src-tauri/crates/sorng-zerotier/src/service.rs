//! # ZeroTier Service
//!
//! Orchestrates ZeroTier operations: connections, peers, networks,
//! controller, diagnostics.

use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type ZeroTierServiceState = Arc<Mutex<ZeroTierService>>;

pub struct ZeroTierService {
    pub connections: HashMap<String, ZtConnection>,
    pub cached_status: Option<ZtServiceStatus>,
    pub cached_peers: Vec<ZtPeer>,
    pub controller_url: Option<String>,
    pub authtoken: Option<String>,
    pub api_port: u16,
}

impl ZeroTierService {
    pub fn new() -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            cached_status: None,
            cached_peers: Vec::new(),
            controller_url: None,
            authtoken: None,
            api_port: 9993,
        }))
    }

    /// Configure the local API connection.
    pub fn configure_api(&mut self, authtoken: String, port: u16) {
        self.authtoken = Some(authtoken);
        self.api_port = port;
    }

    /// Configure controller URL for self-hosted controller operations.
    pub fn configure_controller(&mut self, url: String) {
        self.controller_url = Some(url);
    }

    /// Create a new network connection entry.
    pub fn create_connection(&mut self, name: String, config: ZtNetworkConfig) -> String {
        let id = Uuid::new_v4().to_string();
        let connection = ZtConnection {
            id: id.clone(),
            name,
            network_id: config.network_id.clone(),
            config,
            status: ZtConnectionStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            assigned_ips: Vec::new(),
            mac_address: None,
            mtu: 2800,
            bridge: false,
            broadcast_enabled: true,
            dns_domain: None,
            dns_servers: Vec::new(),
        };
        self.connections.insert(id.clone(), connection);
        info!("Created ZeroTier connection: {}", id);
        id
    }

    /// Get connection by ID.
    pub fn get_connection(&self, id: &str) -> Option<&ZtConnection> {
        self.connections.get(id)
    }

    /// Get mutable connection by ID.
    pub fn get_connection_mut(&mut self, id: &str) -> Option<&mut ZtConnection> {
        self.connections.get_mut(id)
    }

    /// List all connections.
    pub fn list_connections(&self) -> Vec<&ZtConnection> {
        self.connections.values().collect()
    }

    /// Remove a connection entry.
    pub fn remove_connection(&mut self, id: &str) -> Option<ZtConnection> {
        self.connections.remove(id)
    }

    /// Update connection status from CLI output.
    pub fn update_connection_status(&mut self, id: &str, status: ZtConnectionStatus) {
        if let Some(conn) = self.connections.get_mut(id) {
            if status == ZtConnectionStatus::Connected && conn.status != ZtConnectionStatus::Connected {
                conn.connected_at = Some(Utc::now());
            }
            conn.status = status;
        }
    }

    /// Update connection with network detail data.
    pub fn update_from_network_detail(&mut self, id: &str, detail: &ZtNetworkDetail) {
        if let Some(conn) = self.connections.get_mut(id) {
            conn.assigned_ips = detail.assigned_addresses.clone();
            conn.mac_address = Some(detail.mac.clone());
            conn.mtu = detail.mtu;
            conn.bridge = detail.bridge;
            conn.broadcast_enabled = detail.broadcast_enabled;
            if let Some(dns) = &detail.dns {
                conn.dns_domain = Some(dns.domain.clone());
                conn.dns_servers = dns.servers.clone();
            }
            conn.status = match detail.status {
                ZtNetworkStatus::Ok => ZtConnectionStatus::Connected,
                ZtNetworkStatus::Requesting => ZtConnectionStatus::Requesting,
                ZtNetworkStatus::AccessDenied => ZtConnectionStatus::AccessDenied,
                ZtNetworkStatus::NotFound => ZtConnectionStatus::NotFound,
                _ => ZtConnectionStatus::Error("Network error".to_string()),
            };
        }
    }

    /// Update cached peers.
    pub fn update_peers(&mut self, peers: Vec<ZtPeer>) {
        self.cached_peers = peers;
    }

    /// Update cached service status.
    pub fn update_status(&mut self, status: ZtServiceStatus) {
        self.cached_status = Some(status);
    }

    /// Get online peers.
    pub fn online_peers(&self) -> Vec<&ZtPeer> {
        self.cached_peers
            .iter()
            .filter(|p| p.paths.iter().any(|path| path.active))
            .collect()
    }

    /// Get peers with direct paths.
    pub fn direct_peers(&self) -> Vec<&ZtPeer> {
        self.cached_peers
            .iter()
            .filter(|p| {
                p.paths.iter().any(|path| path.active && path.preferred)
            })
            .collect()
    }

    /// Get peers by role.
    pub fn peers_by_role(&self, role: ZtPeerRole) -> Vec<&ZtPeer> {
        self.cached_peers
            .iter()
            .filter(|p| p.role == role)
            .collect()
    }

    /// Get aggregate network statistics.
    pub fn network_stats(&self) -> ZtNetworkStats {
        let active_connections = self
            .connections
            .values()
            .filter(|c| c.status == ZtConnectionStatus::Connected)
            .count();
        let total_peers = self.cached_peers.len();
        let active_peers = self.online_peers().len();
        let planet_roots = self.peers_by_role(ZtPeerRole::Planet).len();
        let moon_roots = self.peers_by_role(ZtPeerRole::Moon).len();

        let avg_latency = if !self.cached_peers.is_empty() {
            let sum: i32 = self.cached_peers.iter().map(|p| p.latency.max(0)).sum();
            sum as f64 / self.cached_peers.len() as f64
        } else {
            0.0
        };

        ZtNetworkStats {
            active_connections,
            total_peers,
            active_peers,
            planet_roots,
            moon_roots,
            average_latency_ms: avg_latency,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZtNetworkStats {
    pub active_connections: usize,
    pub total_peers: usize,
    pub active_peers: usize,
    pub planet_roots: usize,
    pub moon_roots: usize,
    pub average_latency_ms: f64,
}
