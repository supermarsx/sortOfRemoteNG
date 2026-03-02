//! # Tailscale Service
//!
//! Central orchestrator for all Tailscale operations.

use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type TailscaleServiceState = Arc<Mutex<TailscaleService>>;

/// The Tailscale service — manages connections, peers, and all TS features.
pub struct TailscaleService {
    connections: HashMap<String, TailscaleConnection>,
    peers: HashMap<String, TailscalePeer>,
    derp_regions: Vec<DerpRegion>,
    derp_status: Vec<DerpStatus>,
    serve_config: Option<ServeConfig>,
    funnel_config: Option<FunnelConfig>,
    acl_policy: Option<AclPolicy>,
    exit_nodes: Vec<ExitNodeInfo>,
    taildrop_transfers: HashMap<String, TaildropTransfer>,
    cached_netcheck: Option<NetcheckResult>,
    health: Option<HealthCheck>,
    daemon_running: bool,
    daemon_version: Option<String>,
}

impl TailscaleService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            peers: HashMap::new(),
            derp_regions: Vec::new(),
            derp_status: Vec::new(),
            serve_config: None,
            funnel_config: None,
            acl_policy: None,
            exit_nodes: Vec::new(),
            taildrop_transfers: HashMap::new(),
            cached_netcheck: None,
            health: None,
            daemon_running: false,
            daemon_version: None,
        }
    }

    // ── Connection Management ──────────────────────────────────

    pub fn create_connection(&mut self, name: &str, config: TailscaleConfig) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let connection = TailscaleConnection {
            id: id.clone(),
            name: name.to_string(),
            config,
            status: TailscaleStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            tailnet_ip: None,
            tailnet_ipv6: None,
            hostname: None,
            tailnet_name: None,
            dns_name: None,
            process_id: None,
            version: self.daemon_version.clone(),
            backend_state: None,
            auth_url: None,
        };
        self.connections.insert(id.clone(), connection);
        info!("Created Tailscale connection {} ({})", name, id);
        Ok(id)
    }

    pub fn get_connection(&self, id: &str) -> Option<&TailscaleConnection> {
        self.connections.get(id)
    }

    pub fn get_connection_mut(&mut self, id: &str) -> Option<&mut TailscaleConnection> {
        self.connections.get_mut(id)
    }

    pub fn list_connections(&self) -> Vec<&TailscaleConnection> {
        self.connections.values().collect()
    }

    pub fn delete_connection(&mut self, id: &str) -> bool {
        self.connections.remove(id).is_some()
    }

    pub fn update_connection_status(&mut self, id: &str, status: TailscaleStatus) {
        if let Some(conn) = self.connections.get_mut(id) {
            conn.status = status;
        }
    }

    // ── Peer Management ────────────────────────────────────────

    pub fn update_peers(&mut self, peers: Vec<TailscalePeer>) {
        self.peers.clear();
        for peer in peers {
            self.peers.insert(peer.id.clone(), peer);
        }
    }

    pub fn get_peer(&self, id: &str) -> Option<&TailscalePeer> {
        self.peers.get(id)
    }

    pub fn list_peers(&self) -> Vec<&TailscalePeer> {
        self.peers.values().collect()
    }

    pub fn online_peers(&self) -> Vec<&TailscalePeer> {
        self.peers.values().filter(|p| p.online).collect()
    }

    pub fn direct_peers(&self) -> Vec<&TailscalePeer> {
        self.peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Direct)
            .collect()
    }

    pub fn relayed_peers(&self) -> Vec<&TailscalePeer> {
        self.peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Relay)
            .collect()
    }

    // ── DERP ───────────────────────────────────────────────────

    pub fn set_derp_regions(&mut self, regions: Vec<DerpRegion>) {
        self.derp_regions = regions;
    }

    pub fn derp_regions(&self) -> &[DerpRegion] {
        &self.derp_regions
    }

    pub fn set_derp_status(&mut self, status: Vec<DerpStatus>) {
        self.derp_status = status;
    }

    pub fn derp_status(&self) -> &[DerpStatus] {
        &self.derp_status
    }

    pub fn preferred_derp(&self) -> Option<&DerpStatus> {
        self.derp_status.iter().find(|d| d.preferred)
    }

    // ── Netcheck ───────────────────────────────────────────────

    pub fn set_netcheck(&mut self, result: NetcheckResult) {
        self.cached_netcheck = Some(result);
    }

    pub fn netcheck(&self) -> Option<&NetcheckResult> {
        self.cached_netcheck.as_ref()
    }

    // ── Serve & Funnel ─────────────────────────────────────────

    pub fn set_serve_config(&mut self, config: ServeConfig) {
        self.serve_config = Some(config);
    }

    pub fn serve_config(&self) -> Option<&ServeConfig> {
        self.serve_config.as_ref()
    }

    pub fn set_funnel_config(&mut self, config: FunnelConfig) {
        self.funnel_config = Some(config);
    }

    pub fn funnel_config(&self) -> Option<&FunnelConfig> {
        self.funnel_config.as_ref()
    }

    // ── ACL ────────────────────────────────────────────────────

    pub fn set_acl_policy(&mut self, policy: AclPolicy) {
        self.acl_policy = Some(policy);
    }

    pub fn acl_policy(&self) -> Option<&AclPolicy> {
        self.acl_policy.as_ref()
    }

    // ── Exit Nodes ─────────────────────────────────────────────

    pub fn set_exit_nodes(&mut self, nodes: Vec<ExitNodeInfo>) {
        self.exit_nodes = nodes;
    }

    pub fn exit_nodes(&self) -> &[ExitNodeInfo] {
        &self.exit_nodes
    }

    pub fn current_exit_node(&self) -> Option<&ExitNodeInfo> {
        self.exit_nodes.iter().find(|n| n.currently_using)
    }

    // ── Taildrop ───────────────────────────────────────────────

    pub fn add_transfer(&mut self, transfer: TaildropTransfer) {
        self.taildrop_transfers.insert(transfer.id.clone(), transfer);
    }

    pub fn get_transfer(&self, id: &str) -> Option<&TaildropTransfer> {
        self.taildrop_transfers.get(id)
    }

    pub fn list_transfers(&self) -> Vec<&TaildropTransfer> {
        self.taildrop_transfers.values().collect()
    }

    pub fn update_transfer_progress(&mut self, id: &str, bytes: u64) {
        if let Some(t) = self.taildrop_transfers.get_mut(id) {
            t.progress_bytes = bytes;
        }
    }

    pub fn complete_transfer(&mut self, id: &str) {
        if let Some(t) = self.taildrop_transfers.get_mut(id) {
            t.state = TransferState::Completed;
            t.completed_at = Some(Utc::now());
        }
    }

    // ── Health ─────────────────────────────────────────────────

    pub fn set_health(&mut self, health: HealthCheck) {
        self.health = Some(health);
    }

    pub fn health(&self) -> Option<&HealthCheck> {
        self.health.as_ref()
    }

    // ── Daemon ─────────────────────────────────────────────────

    pub fn set_daemon_running(&mut self, running: bool) {
        self.daemon_running = running;
    }

    pub fn is_daemon_running(&self) -> bool {
        self.daemon_running
    }

    pub fn set_daemon_version(&mut self, version: &str) {
        self.daemon_version = Some(version.to_string());
    }

    pub fn daemon_version(&self) -> Option<&str> {
        self.daemon_version.as_deref()
    }
}

impl Default for TailscaleService {
    fn default() -> Self {
        Self::new()
    }
}
