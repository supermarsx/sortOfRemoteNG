//! # Teleport Service
//!
//! Central orchestrator for all Teleport operations — manages connection
//! profiles, nodes, clusters, databases, apps, desktops, sessions, roles,
//! audit events, and cluster health.

use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type TeleportServiceState = Arc<Mutex<TeleportService>>;

/// The Teleport service — central hub for the Teleport integration.
pub struct TeleportService {
    connections: HashMap<String, TeleportConnection>,
    nodes: HashMap<String, TeleportNode>,
    kube_clusters: HashMap<String, TeleportKubeCluster>,
    databases: HashMap<String, TeleportDatabase>,
    apps: HashMap<String, TeleportApp>,
    desktops: HashMap<String, TeleportDesktop>,
    roles: HashMap<String, TeleportRole>,
    active_sessions: HashMap<String, TeleportSession>,
    recordings: Vec<SessionRecording>,
    audit_events: Vec<AuditEvent>,
    access_requests: HashMap<String, AccessRequest>,
    trusted_clusters: HashMap<String, TrustedCluster>,
    locks: HashMap<String, TeleportLock>,
    mfa_devices: Vec<MfaDevice>,
    user_cert: Option<UserCertificate>,
    health: Option<ClusterHealthCheck>,
    event_log: Vec<TeleportEvent>,
}

impl TeleportService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            nodes: HashMap::new(),
            kube_clusters: HashMap::new(),
            databases: HashMap::new(),
            apps: HashMap::new(),
            desktops: HashMap::new(),
            roles: HashMap::new(),
            active_sessions: HashMap::new(),
            recordings: Vec::new(),
            audit_events: Vec::new(),
            access_requests: HashMap::new(),
            trusted_clusters: HashMap::new(),
            locks: HashMap::new(),
            mfa_devices: Vec::new(),
            user_cert: None,
            health: None,
            event_log: Vec::new(),
        }
    }

    // ── Connection Management ──────────────────────────────────

    pub fn create_connection(&mut self, name: &str, config: TeleportConfig) -> Result<String, String> {
        if config.proxy.is_empty() {
            return Err("Proxy address is required".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let connection = TeleportConnection {
            id: id.clone(),
            name: name.to_string(),
            config,
            status: TeleportStatus::LoggedOut,
            created_at: Utc::now(),
            logged_in_at: None,
            cluster_name: None,
            proxy_address: None,
            username: None,
            roles: Vec::new(),
            traits: HashMap::new(),
            cert_expires: None,
            tsh_version: None,
            cluster_version: None,
        };
        self.connections.insert(id.clone(), connection);
        info!("Created Teleport connection {} ({})", name, id);
        Ok(id)
    }

    pub fn get_connection(&self, id: &str) -> Option<&TeleportConnection> {
        self.connections.get(id)
    }

    pub fn get_connection_mut(&mut self, id: &str) -> Option<&mut TeleportConnection> {
        self.connections.get_mut(id)
    }

    pub fn list_connections(&self) -> Vec<&TeleportConnection> {
        self.connections.values().collect()
    }

    pub fn delete_connection(&mut self, id: &str) -> bool {
        self.connections.remove(id).is_some()
    }

    pub fn update_connection_status(&mut self, id: &str, status: TeleportStatus) {
        if let Some(conn) = self.connections.get_mut(id) {
            if status == TeleportStatus::LoggedIn {
                conn.logged_in_at = Some(Utc::now());
            }
            conn.status = status;
        }
    }

    // ── Node Management ────────────────────────────────────────

    pub fn update_nodes(&mut self, nodes: Vec<TeleportNode>) {
        self.nodes.clear();
        for node in nodes {
            self.nodes.insert(node.id.clone(), node);
        }
    }

    pub fn get_node(&self, id: &str) -> Option<&TeleportNode> {
        self.nodes.get(id)
    }

    pub fn list_nodes(&self) -> Vec<&TeleportNode> {
        self.nodes.values().collect()
    }

    pub fn nodes_by_label(&self, key: &str, value: &str) -> Vec<&TeleportNode> {
        self.nodes
            .values()
            .filter(|n| n.labels.get(key).map(|v| v == value).unwrap_or(false))
            .collect()
    }

    pub fn nodes_in_cluster(&self, cluster: &str) -> Vec<&TeleportNode> {
        self.nodes
            .values()
            .filter(|n| n.cluster_name == cluster)
            .collect()
    }

    // ── Kubernetes Cluster Management ──────────────────────────

    pub fn update_kube_clusters(&mut self, clusters: Vec<TeleportKubeCluster>) {
        self.kube_clusters.clear();
        for c in clusters {
            self.kube_clusters.insert(c.id.clone(), c);
        }
    }

    pub fn get_kube_cluster(&self, id: &str) -> Option<&TeleportKubeCluster> {
        self.kube_clusters.get(id)
    }

    pub fn list_kube_clusters(&self) -> Vec<&TeleportKubeCluster> {
        self.kube_clusters.values().collect()
    }

    // ── Database Management ────────────────────────────────────

    pub fn update_databases(&mut self, dbs: Vec<TeleportDatabase>) {
        self.databases.clear();
        for db in dbs {
            self.databases.insert(db.id.clone(), db);
        }
    }

    pub fn get_database(&self, id: &str) -> Option<&TeleportDatabase> {
        self.databases.get(id)
    }

    pub fn list_databases(&self) -> Vec<&TeleportDatabase> {
        self.databases.values().collect()
    }

    pub fn databases_by_protocol(&self, protocol: DatabaseProtocol) -> Vec<&TeleportDatabase> {
        self.databases
            .values()
            .filter(|d| d.protocol == protocol)
            .collect()
    }

    // ── Application Management ─────────────────────────────────

    pub fn update_apps(&mut self, apps: Vec<TeleportApp>) {
        self.apps.clear();
        for app in apps {
            self.apps.insert(app.id.clone(), app);
        }
    }

    pub fn get_app(&self, id: &str) -> Option<&TeleportApp> {
        self.apps.get(id)
    }

    pub fn list_apps(&self) -> Vec<&TeleportApp> {
        self.apps.values().collect()
    }

    // ── Desktop Management ─────────────────────────────────────

    pub fn update_desktops(&mut self, desktops: Vec<TeleportDesktop>) {
        self.desktops.clear();
        for d in desktops {
            self.desktops.insert(d.id.clone(), d);
        }
    }

    pub fn get_desktop(&self, id: &str) -> Option<&TeleportDesktop> {
        self.desktops.get(id)
    }

    pub fn list_desktops(&self) -> Vec<&TeleportDesktop> {
        self.desktops.values().collect()
    }

    // ── Role Management ────────────────────────────────────────

    pub fn update_roles(&mut self, roles: Vec<TeleportRole>) {
        self.roles.clear();
        for role in roles {
            self.roles.insert(role.name.clone(), role);
        }
    }

    pub fn get_role(&self, name: &str) -> Option<&TeleportRole> {
        self.roles.get(name)
    }

    pub fn list_roles(&self) -> Vec<&TeleportRole> {
        self.roles.values().collect()
    }

    // ── Session Management ─────────────────────────────────────

    pub fn update_sessions(&mut self, sessions: Vec<TeleportSession>) {
        self.active_sessions.clear();
        for s in sessions {
            self.active_sessions.insert(s.id.clone(), s);
        }
    }

    pub fn get_session(&self, id: &str) -> Option<&TeleportSession> {
        self.active_sessions.get(id)
    }

    pub fn list_sessions(&self) -> Vec<&TeleportSession> {
        self.active_sessions.values().collect()
    }

    pub fn sessions_by_type(&self, st: SessionType) -> Vec<&TeleportSession> {
        self.active_sessions
            .values()
            .filter(|s| s.session_type == st)
            .collect()
    }

    // ── Recordings ─────────────────────────────────────────────

    pub fn set_recordings(&mut self, recordings: Vec<SessionRecording>) {
        self.recordings = recordings;
    }

    pub fn list_recordings(&self) -> &[SessionRecording] {
        &self.recordings
    }

    // ── Audit Events ───────────────────────────────────────────

    pub fn set_audit_events(&mut self, events: Vec<AuditEvent>) {
        self.audit_events = events;
    }

    pub fn list_audit_events(&self) -> &[AuditEvent] {
        &self.audit_events
    }

    // ── Access Requests ────────────────────────────────────────

    pub fn update_access_requests(&mut self, requests: Vec<AccessRequest>) {
        self.access_requests.clear();
        for r in requests {
            self.access_requests.insert(r.id.clone(), r);
        }
    }

    pub fn get_access_request(&self, id: &str) -> Option<&AccessRequest> {
        self.access_requests.get(id)
    }

    pub fn list_access_requests(&self) -> Vec<&AccessRequest> {
        self.access_requests.values().collect()
    }

    pub fn pending_access_requests(&self) -> Vec<&AccessRequest> {
        self.access_requests
            .values()
            .filter(|r| r.state == AccessRequestState::Pending)
            .collect()
    }

    // ── Trusted Clusters ───────────────────────────────────────

    pub fn update_trusted_clusters(&mut self, clusters: Vec<TrustedCluster>) {
        self.trusted_clusters.clear();
        for c in clusters {
            self.trusted_clusters.insert(c.name.clone(), c);
        }
    }

    pub fn list_trusted_clusters(&self) -> Vec<&TrustedCluster> {
        self.trusted_clusters.values().collect()
    }

    pub fn online_trusted_clusters(&self) -> Vec<&TrustedCluster> {
        self.trusted_clusters
            .values()
            .filter(|c| c.status == TrustedClusterStatus::Online)
            .collect()
    }

    // ── Locks ──────────────────────────────────────────────────

    pub fn update_locks(&mut self, locks: Vec<TeleportLock>) {
        self.locks.clear();
        for lock in locks {
            self.locks.insert(lock.name.clone(), lock);
        }
    }

    pub fn list_locks(&self) -> Vec<&TeleportLock> {
        self.locks.values().collect()
    }

    // ── MFA ────────────────────────────────────────────────────

    pub fn set_mfa_devices(&mut self, devices: Vec<MfaDevice>) {
        self.mfa_devices = devices;
    }

    pub fn list_mfa_devices(&self) -> &[MfaDevice] {
        &self.mfa_devices
    }

    // ── Certificate ────────────────────────────────────────────

    pub fn set_user_cert(&mut self, cert: UserCertificate) {
        self.user_cert = Some(cert);
    }

    pub fn user_cert(&self) -> Option<&UserCertificate> {
        self.user_cert.as_ref()
    }

    pub fn is_cert_valid(&self) -> bool {
        self.user_cert
            .as_ref()
            .map(|c| c.valid_before > Utc::now())
            .unwrap_or(false)
    }

    // ── Health ─────────────────────────────────────────────────

    pub fn set_health(&mut self, health: ClusterHealthCheck) {
        self.health = Some(health);
    }

    pub fn health(&self) -> Option<&ClusterHealthCheck> {
        self.health.as_ref()
    }

    // ── Events ─────────────────────────────────────────────────

    pub fn push_event(&mut self, event: TeleportEvent) {
        self.event_log.push(event);
    }

    pub fn events(&self) -> &[TeleportEvent] {
        &self.event_log
    }

    pub fn clear_events(&mut self) {
        self.event_log.clear();
    }

    // ── Statistics ─────────────────────────────────────────────

    pub fn resource_counts(&self) -> ResourceCounts {
        ResourceCounts {
            nodes: self.nodes.len() as u32,
            kube_clusters: self.kube_clusters.len() as u32,
            databases: self.databases.len() as u32,
            apps: self.apps.len() as u32,
            desktops: self.desktops.len() as u32,
            roles: self.roles.len() as u32,
            active_sessions: self.active_sessions.len() as u32,
            access_requests_pending: self.pending_access_requests().len() as u32,
            trusted_clusters: self.trusted_clusters.len() as u32,
            locks: self.locks.len() as u32,
        }
    }
}

/// Aggregate resource counts for the UI/dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceCounts {
    pub nodes: u32,
    pub kube_clusters: u32,
    pub databases: u32,
    pub apps: u32,
    pub desktops: u32,
    pub roles: u32,
    pub active_sessions: u32,
    pub access_requests_pending: u32,
    pub trusted_clusters: u32,
    pub locks: u32,
}

impl Default for TeleportService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_connection() {
        let mut svc = TeleportService::new();
        let config = TeleportConfig {
            proxy: "teleport.example.com:443".into(),
            ..Default::default()
        };
        let id = svc.create_connection("test", config).unwrap();
        assert!(svc.get_connection(&id).is_some());
        assert_eq!(svc.list_connections().len(), 1);
    }

    #[test]
    fn test_create_connection_requires_proxy() {
        let mut svc = TeleportService::new();
        let config = TeleportConfig::default();
        assert!(svc.create_connection("test", config).is_err());
    }

    #[test]
    fn test_update_connection_status() {
        let mut svc = TeleportService::new();
        let config = TeleportConfig {
            proxy: "tp.example.com:443".into(),
            ..Default::default()
        };
        let id = svc.create_connection("test", config).unwrap();
        svc.update_connection_status(&id, TeleportStatus::LoggedIn);
        let conn = svc.get_connection(&id).unwrap();
        assert_eq!(conn.status, TeleportStatus::LoggedIn);
        assert!(conn.logged_in_at.is_some());
    }

    #[test]
    fn test_resource_counts() {
        let svc = TeleportService::new();
        let counts = svc.resource_counts();
        assert_eq!(counts.nodes, 0);
        assert_eq!(counts.databases, 0);
    }

    #[test]
    fn test_nodes_by_label() {
        let mut svc = TeleportService::new();
        let mut labels = HashMap::new();
        labels.insert("env".into(), "prod".into());
        svc.update_nodes(vec![
            TeleportNode {
                id: "n1".into(),
                hostname: "host1".into(),
                address: "10.0.0.1:3022".into(),
                labels: labels.clone(),
                tunnel: false,
                sub_kind: NodeSubKind::Regular,
                namespace: "default".into(),
                cluster_name: "root".into(),
                version: None,
                os: None,
                public_addrs: vec![],
                peer_addr: None,
                rotation: None,
            },
            TeleportNode {
                id: "n2".into(),
                hostname: "host2".into(),
                address: "10.0.0.2:3022".into(),
                labels: HashMap::new(),
                tunnel: false,
                sub_kind: NodeSubKind::Regular,
                namespace: "default".into(),
                cluster_name: "root".into(),
                version: None,
                os: None,
                public_addrs: vec![],
                peer_addr: None,
                rotation: None,
            },
        ]);
        assert_eq!(svc.nodes_by_label("env", "prod").len(), 1);
    }
}
