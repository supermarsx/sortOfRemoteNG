//! # NetBird Service
//!
//! Central orchestrator for all NetBird operations — manages connections,
//! peers, groups, routes, policies, DNS, setup keys, and diagnostics state.

use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type NetBirdServiceState = Arc<Mutex<NetBirdService>>;

/// The NetBird service — one-stop shop for the NetBird integration.
pub struct NetBirdService {
    connections: HashMap<String, NetBirdConnection>,
    peers: HashMap<String, NetBirdPeer>,
    groups: HashMap<String, NetBirdGroup>,
    routes: HashMap<String, NetBirdRoute>,
    policies: HashMap<String, NetBirdPolicy>,
    nameserver_groups: HashMap<String, NameserverGroup>,
    setup_keys: HashMap<String, SetupKey>,
    posture_checks: HashMap<String, PostureCheck>,
    users: HashMap<String, NetBirdUser>,
    turn_relays: Vec<TurnRelay>,
    signal_server: Option<SignalServer>,
    management_server: Option<ManagementServer>,
    health: Option<HealthCheck>,
    daemon_running: bool,
    daemon_version: Option<String>,
    event_log: Vec<NetBirdEvent>,
}

impl NetBirdService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            peers: HashMap::new(),
            groups: HashMap::new(),
            routes: HashMap::new(),
            policies: HashMap::new(),
            nameserver_groups: HashMap::new(),
            setup_keys: HashMap::new(),
            posture_checks: HashMap::new(),
            users: HashMap::new(),
            turn_relays: Vec::new(),
            signal_server: None,
            management_server: None,
            health: None,
            daemon_running: false,
            daemon_version: None,
            event_log: Vec::new(),
        }
    }

    // ── Connection Management ──────────────────────────────────

    pub fn create_connection(
        &mut self,
        name: &str,
        config: NetBirdConfig,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let connection = NetBirdConnection {
            id: id.clone(),
            name: name.to_string(),
            config,
            status: NetBirdStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            ip: None,
            ipv6: None,
            fqdn: None,
            hostname: None,
            public_key: None,
            process_id: None,
            version: self.daemon_version.clone(),
            management_url: None,
            signal_connected: false,
            management_connected: false,
            relays_connected: 0,
        };
        self.connections.insert(id.clone(), connection);
        info!("Created NetBird connection {} ({})", name, id);
        Ok(id)
    }

    pub fn get_connection(&self, id: &str) -> Option<&NetBirdConnection> {
        self.connections.get(id)
    }

    pub fn get_connection_mut(&mut self, id: &str) -> Option<&mut NetBirdConnection> {
        self.connections.get_mut(id)
    }

    pub fn list_connections(&self) -> Vec<&NetBirdConnection> {
        self.connections.values().collect()
    }

    pub fn delete_connection(&mut self, id: &str) -> bool {
        self.connections.remove(id).is_some()
    }

    pub fn update_connection_status(&mut self, id: &str, status: NetBirdStatus) {
        if let Some(conn) = self.connections.get_mut(id) {
            if status == NetBirdStatus::Connected {
                conn.connected_at = Some(Utc::now());
            }
            conn.status = status;
        }
    }

    // ── Peer Management ────────────────────────────────────────

    pub fn update_peers(&mut self, peers: Vec<NetBirdPeer>) {
        self.peers.clear();
        for peer in peers {
            self.peers.insert(peer.id.clone(), peer);
        }
    }

    pub fn get_peer(&self, id: &str) -> Option<&NetBirdPeer> {
        self.peers.get(id)
    }

    pub fn list_peers(&self) -> Vec<&NetBirdPeer> {
        self.peers.values().collect()
    }

    pub fn connected_peers(&self) -> Vec<&NetBirdPeer> {
        self.peers.values().filter(|p| p.connected).collect()
    }

    pub fn direct_peers(&self) -> Vec<&NetBirdPeer> {
        self.peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Direct)
            .collect()
    }

    pub fn relayed_peers(&self) -> Vec<&NetBirdPeer> {
        self.peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Relayed)
            .collect()
    }

    pub fn peers_in_group(&self, group_id: &str) -> Vec<&NetBirdPeer> {
        self.peers
            .values()
            .filter(|p| p.groups.iter().any(|g| g.id == group_id))
            .collect()
    }

    // ── Group Management ───────────────────────────────────────

    pub fn update_groups(&mut self, groups: Vec<NetBirdGroup>) {
        self.groups.clear();
        for group in groups {
            self.groups.insert(group.id.clone(), group);
        }
    }

    pub fn get_group(&self, id: &str) -> Option<&NetBirdGroup> {
        self.groups.get(id)
    }

    pub fn list_groups(&self) -> Vec<&NetBirdGroup> {
        self.groups.values().collect()
    }

    pub fn find_group_by_name(&self, name: &str) -> Option<&NetBirdGroup> {
        self.groups.values().find(|g| g.name == name)
    }

    // ── Route Management ───────────────────────────────────────

    pub fn update_routes(&mut self, routes: Vec<NetBirdRoute>) {
        self.routes.clear();
        for route in routes {
            self.routes.insert(route.id.clone(), route);
        }
    }

    pub fn get_route(&self, id: &str) -> Option<&NetBirdRoute> {
        self.routes.get(id)
    }

    pub fn list_routes(&self) -> Vec<&NetBirdRoute> {
        self.routes.values().collect()
    }

    pub fn enabled_routes(&self) -> Vec<&NetBirdRoute> {
        self.routes.values().filter(|r| r.enabled).collect()
    }

    // ── Policy / ACL ───────────────────────────────────────────

    pub fn update_policies(&mut self, policies: Vec<NetBirdPolicy>) {
        self.policies.clear();
        for policy in policies {
            self.policies.insert(policy.id.clone(), policy);
        }
    }

    pub fn get_policy(&self, id: &str) -> Option<&NetBirdPolicy> {
        self.policies.get(id)
    }

    pub fn list_policies(&self) -> Vec<&NetBirdPolicy> {
        self.policies.values().collect()
    }

    pub fn enabled_policies(&self) -> Vec<&NetBirdPolicy> {
        self.policies.values().filter(|p| p.enabled).collect()
    }

    // ── DNS ────────────────────────────────────────────────────

    pub fn update_nameserver_groups(&mut self, groups: Vec<NameserverGroup>) {
        self.nameserver_groups.clear();
        for g in groups {
            self.nameserver_groups.insert(g.id.clone(), g);
        }
    }

    pub fn get_nameserver_group(&self, id: &str) -> Option<&NameserverGroup> {
        self.nameserver_groups.get(id)
    }

    pub fn list_nameserver_groups(&self) -> Vec<&NameserverGroup> {
        self.nameserver_groups.values().collect()
    }

    // ── Setup Keys ─────────────────────────────────────────────

    pub fn update_setup_keys(&mut self, keys: Vec<SetupKey>) {
        self.setup_keys.clear();
        for key in keys {
            self.setup_keys.insert(key.id.clone(), key);
        }
    }

    pub fn get_setup_key(&self, id: &str) -> Option<&SetupKey> {
        self.setup_keys.get(id)
    }

    pub fn list_setup_keys(&self) -> Vec<&SetupKey> {
        self.setup_keys.values().collect()
    }

    pub fn valid_setup_keys(&self) -> Vec<&SetupKey> {
        self.setup_keys
            .values()
            .filter(|k| k.valid && !k.revoked)
            .collect()
    }

    // ── Posture Checks ─────────────────────────────────────────

    pub fn update_posture_checks(&mut self, checks: Vec<PostureCheck>) {
        self.posture_checks.clear();
        for check in checks {
            self.posture_checks.insert(check.id.clone(), check);
        }
    }

    pub fn get_posture_check(&self, id: &str) -> Option<&PostureCheck> {
        self.posture_checks.get(id)
    }

    pub fn list_posture_checks(&self) -> Vec<&PostureCheck> {
        self.posture_checks.values().collect()
    }

    // ── User Management ────────────────────────────────────────

    pub fn update_users(&mut self, users: Vec<NetBirdUser>) {
        self.users.clear();
        for user in users {
            self.users.insert(user.id.clone(), user);
        }
    }

    pub fn get_user(&self, id: &str) -> Option<&NetBirdUser> {
        self.users.get(id)
    }

    pub fn list_users(&self) -> Vec<&NetBirdUser> {
        self.users.values().collect()
    }

    pub fn current_user(&self) -> Option<&NetBirdUser> {
        self.users.values().find(|u| u.is_current)
    }

    // ── Relay / Signal / Management Server ─────────────────────

    pub fn set_turn_relays(&mut self, relays: Vec<TurnRelay>) {
        self.turn_relays = relays;
    }

    pub fn turn_relays(&self) -> &[TurnRelay] {
        &self.turn_relays
    }

    pub fn available_relays(&self) -> Vec<&TurnRelay> {
        self.turn_relays.iter().filter(|r| r.available).collect()
    }

    pub fn set_signal_server(&mut self, server: SignalServer) {
        self.signal_server = Some(server);
    }

    pub fn signal_server(&self) -> Option<&SignalServer> {
        self.signal_server.as_ref()
    }

    pub fn set_management_server(&mut self, server: ManagementServer) {
        self.management_server = Some(server);
    }

    pub fn management_server(&self) -> Option<&ManagementServer> {
        self.management_server.as_ref()
    }

    // ── Health / Diagnostics ───────────────────────────────────

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

    // ── Events ─────────────────────────────────────────────────

    pub fn push_event(&mut self, event: NetBirdEvent) {
        self.event_log.push(event);
    }

    pub fn events(&self) -> &[NetBirdEvent] {
        &self.event_log
    }

    pub fn clear_events(&mut self) {
        self.event_log.clear();
    }

    // ── Statistics ─────────────────────────────────────────────

    pub fn peer_stats(&self) -> PeerStats {
        let total = self.peers.len() as u32;
        let connected = self.peers.values().filter(|p| p.connected).count() as u32;
        let direct = self
            .peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Direct)
            .count() as u32;
        let relayed = self
            .peers
            .values()
            .filter(|p| p.connection_type == PeerConnectionType::Relayed)
            .count() as u32;
        let total_rx: u64 = self.peers.values().map(|p| p.rx_bytes).sum();
        let total_tx: u64 = self.peers.values().map(|p| p.tx_bytes).sum();

        PeerStats {
            total,
            connected,
            direct,
            relayed,
            total_rx_bytes: total_rx,
            total_tx_bytes: total_tx,
        }
    }
}

/// Aggregate peer statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerStats {
    pub total: u32,
    pub connected: u32,
    pub direct: u32,
    pub relayed: u32,
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
}

impl Default for NetBirdService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_connection() {
        let mut svc = NetBirdService::new();
        let id = svc
            .create_connection("test", NetBirdConfig::default())
            .unwrap();
        assert!(svc.get_connection(&id).is_some());
        assert_eq!(svc.list_connections().len(), 1);
    }

    #[test]
    fn test_delete_connection() {
        let mut svc = NetBirdService::new();
        let id = svc
            .create_connection("test", NetBirdConfig::default())
            .unwrap();
        assert!(svc.delete_connection(&id));
        assert!(svc.get_connection(&id).is_none());
    }

    #[test]
    fn test_update_connection_status() {
        let mut svc = NetBirdService::new();
        let id = svc
            .create_connection("test", NetBirdConfig::default())
            .unwrap();
        svc.update_connection_status(&id, NetBirdStatus::Connected);
        let conn = svc.get_connection(&id).unwrap();
        assert_eq!(conn.status, NetBirdStatus::Connected);
        assert!(conn.connected_at.is_some());
    }

    #[test]
    fn test_peer_filtering() {
        let mut svc = NetBirdService::new();
        let now = Utc::now();
        let make_peer = |id: &str, connected: bool, ct: PeerConnectionType| NetBirdPeer {
            id: id.to_string(),
            name: id.to_string(),
            ip: "100.64.0.1".to_string(),
            ipv6: None,
            fqdn: None,
            hostname: id.to_string(),
            os: "linux".to_string(),
            version: "0.28.0".to_string(),
            ui_version: None,
            kernel_version: None,
            connected,
            last_seen: now,
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
            latency_ms: None,
            rx_bytes: 100,
            tx_bytes: 200,
            wireguard_pubkey: None,
        };
        svc.update_peers(vec![
            make_peer("a", true, PeerConnectionType::Direct),
            make_peer("b", true, PeerConnectionType::Relayed),
            make_peer("c", false, PeerConnectionType::Disconnected),
        ]);
        assert_eq!(svc.connected_peers().len(), 2);
        assert_eq!(svc.direct_peers().len(), 1);
        assert_eq!(svc.relayed_peers().len(), 1);
        let stats = svc.peer_stats();
        assert_eq!(stats.total, 3);
        assert_eq!(stats.connected, 2);
        assert_eq!(stats.total_rx_bytes, 300);
    }

    #[test]
    fn test_valid_setup_keys() {
        let mut svc = NetBirdService::new();
        let now = Utc::now();
        svc.update_setup_keys(vec![
            SetupKey {
                id: "1".into(),
                key: "key1".into(),
                name: "valid".into(),
                key_type: SetupKeyType::Reusable,
                expires: now + chrono::Duration::hours(24),
                revoked: false,
                used_times: 0,
                last_used: None,
                auto_groups: vec![],
                usage_limit: 0,
                valid: true,
                state: SetupKeyState::Valid,
                ephemeral: false,
            },
            SetupKey {
                id: "2".into(),
                key: "key2".into(),
                name: "revoked".into(),
                key_type: SetupKeyType::OneOff,
                expires: now + chrono::Duration::hours(24),
                revoked: true,
                used_times: 1,
                last_used: None,
                auto_groups: vec![],
                usage_limit: 1,
                valid: false,
                state: SetupKeyState::Revoked,
                ephemeral: false,
            },
        ]);
        assert_eq!(svc.valid_setup_keys().len(), 1);
    }
}
