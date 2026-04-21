//! # Tunnel Manager
//!
//! SSH and TCP tunnel management for forwarding connections through
//! intermediate hosts. Creates, tracks, and tears down dynamic tunnels.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A managed tunnel through the gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayTunnel {
    /// Unique tunnel ID
    pub id: String,
    /// Tunnel type
    pub tunnel_type: TunnelType,
    /// Local bind address
    pub local_addr: String,
    /// Local bind port
    pub local_port: u16,
    /// Remote target address
    pub remote_addr: String,
    /// Remote target port
    pub remote_port: u16,
    /// SSH jump host (for SSH tunnels)
    pub jump_host: Option<String>,
    /// User who created the tunnel
    pub created_by: String,
    /// Whether the tunnel is active
    pub active: bool,
    /// When the tunnel was created
    pub created_at: DateTime<Utc>,
    /// Number of connections routed through this tunnel
    pub connection_count: u64,
    /// Bytes forwarded
    pub bytes_forwarded: u64,
}

/// Types of tunnels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TunnelType {
    /// Local port forward (listen locally, forward to remote)
    LocalForward,
    /// Remote port forward (listen on remote, forward to local)
    RemoteForward,
    /// Dynamic SOCKS proxy
    DynamicSocks,
    /// Direct TCP relay (no SSH)
    TcpRelay,
}

/// Manages all active tunnels for the gateway.
pub struct TunnelManager {
    /// Active tunnels indexed by tunnel ID
    tunnels: HashMap<String, GatewayTunnel>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: HashMap::new(),
        }
    }

    /// Create a new tunnel.
    #[allow(clippy::too_many_arguments)]
    pub fn create_tunnel(
        &mut self,
        tunnel_type: TunnelType,
        local_addr: &str,
        local_port: u16,
        remote_addr: &str,
        remote_port: u16,
        jump_host: Option<String>,
        created_by: &str,
    ) -> Result<GatewayTunnel, String> {
        // Check for port conflicts
        let port_in_use = self
            .tunnels
            .values()
            .any(|t| t.active && t.local_port == local_port && t.local_addr == local_addr);
        if port_in_use {
            return Err(format!(
                "Port {}:{} is already in use by another tunnel",
                local_addr, local_port
            ));
        }

        let tunnel = GatewayTunnel {
            id: uuid::Uuid::new_v4().to_string(),
            tunnel_type,
            local_addr: local_addr.to_string(),
            local_port,
            remote_addr: remote_addr.to_string(),
            remote_port,
            jump_host,
            created_by: created_by.to_string(),
            active: true,
            created_at: Utc::now(),
            connection_count: 0,
            bytes_forwarded: 0,
        };

        self.tunnels.insert(tunnel.id.clone(), tunnel.clone());
        log::info!(
            "[TUNNEL] Created {:?} tunnel: {}:{} -> {}:{} (ID: {})",
            tunnel.tunnel_type,
            local_addr,
            local_port,
            remote_addr,
            remote_port,
            tunnel.id
        );
        Ok(tunnel)
    }

    /// Close a tunnel.
    pub fn close_tunnel(&mut self, tunnel_id: &str) -> Result<(), String> {
        let tunnel = self.tunnels.get_mut(tunnel_id).ok_or("Tunnel not found")?;
        tunnel.active = false;
        log::info!("[TUNNEL] Closed tunnel {}", tunnel_id);
        Ok(())
    }

    /// Get a tunnel by ID.
    pub fn get_tunnel(&self, tunnel_id: &str) -> Option<&GatewayTunnel> {
        self.tunnels.get(tunnel_id)
    }

    /// List all active tunnels.
    pub fn list_active(&self) -> Vec<&GatewayTunnel> {
        self.tunnels.values().filter(|t| t.active).collect()
    }

    /// List tunnels created by a specific user.
    pub fn list_by_user(&self, user_id: &str) -> Vec<&GatewayTunnel> {
        self.tunnels
            .values()
            .filter(|t| t.created_by == user_id && t.active)
            .collect()
    }

    /// Record traffic through a tunnel.
    pub fn record_traffic(&mut self, tunnel_id: &str, bytes: u64) -> Result<(), String> {
        let tunnel = self.tunnels.get_mut(tunnel_id).ok_or("Tunnel not found")?;
        tunnel.bytes_forwarded += bytes;
        Ok(())
    }

    /// Record a new connection through a tunnel.
    pub fn record_connection(&mut self, tunnel_id: &str) -> Result<(), String> {
        let tunnel = self.tunnels.get_mut(tunnel_id).ok_or("Tunnel not found")?;
        tunnel.connection_count += 1;
        Ok(())
    }

    /// Get the count of active tunnels.
    pub fn active_count(&self) -> usize {
        self.tunnels.values().filter(|t| t.active).count()
    }

    /// Clean up closed tunnels from memory.
    pub fn cleanup_closed(&mut self) {
        self.tunnels.retain(|_, t| t.active);
    }
}
