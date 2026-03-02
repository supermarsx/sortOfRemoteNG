//! # WireGuard Service
//!
//! Orchestrates WireGuard operations: connection lifecycle, config
//! management, interface control, peer monitoring.

use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type WireGuardServiceState = Arc<Mutex<WireGuardService>>;

pub struct WireGuardService {
    pub connections: HashMap<String, WgConnection>,
    pub default_dns: Vec<String>,
    pub default_mtu: u16,
    pub default_keepalive: u16,
    pub config_dir: Option<String>,
}

impl WireGuardService {
    pub fn new() -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
            default_dns: vec!["1.1.1.1".to_string(), "8.8.8.8".to_string()],
            default_mtu: 1420,
            default_keepalive: 25,
            config_dir: None,
        }))
    }

    /// Set configuration directory.
    pub fn set_config_dir(&mut self, dir: String) {
        self.config_dir = Some(dir);
    }

    /// Create a connection from a WgConfig.
    pub fn create_connection(&mut self, name: String, config: WgConfig) -> String {
        let id = Uuid::new_v4().to_string();
        let connection = WgConnection {
            id: id.clone(),
            name,
            config,
            status: WgConnectionStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            stats: None,
        };
        self.connections.insert(id.clone(), connection);
        info!("Created WireGuard connection: {}", id);
        id
    }

    /// Import a connection from INI config string.
    pub fn import_config(&mut self, name: String, config_str: &str) -> Result<String, String> {
        let config = super::config::parse_config(config_str)?;
        Ok(self.create_connection(name, config))
    }

    /// Get connection.
    pub fn get_connection(&self, id: &str) -> Option<&WgConnection> {
        self.connections.get(id)
    }

    /// Get mutable connection.
    pub fn get_connection_mut(&mut self, id: &str) -> Option<&mut WgConnection> {
        self.connections.get_mut(id)
    }

    /// List all connections.
    pub fn list_connections(&self) -> Vec<&WgConnection> {
        self.connections.values().collect()
    }

    /// Remove a connection.
    pub fn remove_connection(&mut self, id: &str) -> Option<WgConnection> {
        self.connections.remove(id)
    }

    /// Update connection status.
    pub fn update_status(&mut self, id: &str, status: WgConnectionStatus) {
        if let Some(conn) = self.connections.get_mut(id) {
            if status == WgConnectionStatus::Connected
                && conn.status != WgConnectionStatus::Connected
            {
                conn.connected_at = Some(Utc::now());
            }
            conn.status = status;
        }
    }

    /// Update runtime stats for a connection.
    pub fn update_stats(&mut self, id: &str, stats: WgInterfaceStats) {
        if let Some(conn) = self.connections.get_mut(id) {
            conn.stats = Some(stats);
        }
    }

    /// Get connections by status.
    pub fn connections_by_status(&self, status: &WgConnectionStatus) -> Vec<&WgConnection> {
        self.connections
            .values()
            .filter(|c| &c.status == status)
            .collect()
    }

    /// Get active connections.
    pub fn active_connections(&self) -> Vec<&WgConnection> {
        self.connections_by_status(&WgConnectionStatus::Connected)
    }

    /// Generate a new keypair and create a blank config.
    pub fn generate_new_config(&self) -> WgConfig {
        let keypair = super::key::generate_keypair();
        WgConfig {
            interface: WgInterfaceConfig {
                private_key: keypair.private_key,
                address: vec!["10.0.0.2/32".to_string()],
                listen_port: None,
                dns: self.default_dns.clone(),
                mtu: Some(self.default_mtu),
                table: None,
                pre_up: None,
                post_up: None,
                pre_down: None,
                post_down: None,
                save_config: None,
                fwmark: None,
            },
            peers: Vec::new(),
        }
    }

    /// Get the config file path for a connection.
    pub fn config_path(&self, id: &str) -> Option<String> {
        let dir = self.config_dir.as_ref()?;
        Some(format!("{}/{}.conf", dir, id))
    }

    /// Get aggregate stats.
    pub fn aggregate_stats(&self) -> WgAggregateStats {
        let total = self.connections.len();
        let connected = self
            .connections
            .values()
            .filter(|c| c.status == WgConnectionStatus::Connected)
            .count();

        let mut total_rx = 0u64;
        let mut total_tx = 0u64;
        let mut peer_count = 0usize;
        let mut handshake_ok = 0usize;

        for conn in self.connections.values() {
            if let Some(stats) = &conn.stats {
                for peer in &stats.peers {
                    peer_count += 1;
                    total_rx += peer.transfer_rx;
                    total_tx += peer.transfer_tx;
                    if peer.latest_handshake.unwrap_or(0) > 0 {
                        handshake_ok += 1;
                    }
                }
            }
        }

        WgAggregateStats {
            total_connections: total,
            connected_count: connected,
            total_peers: peer_count,
            peers_with_handshake: handshake_ok,
            total_rx_bytes: total_rx,
            total_tx_bytes: total_tx,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgAggregateStats {
    pub total_connections: usize,
    pub connected_count: usize,
    pub total_peers: usize,
    pub peers_with_handshake: usize,
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
}
