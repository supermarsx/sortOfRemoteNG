use crate::platform;
use chrono::{DateTime, Utc};
use serde_json;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type ZeroTierServiceState = Arc<Mutex<ZeroTierService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConnection {
    pub id: String,
    pub name: String,
    pub config: ZeroTierConfig,
    pub status: ZeroTierStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub network_id: Option<String>,
    pub assigned_ips: Vec<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ZeroTierStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZeroTierConfig {
    pub network_id: String,
    pub identity_secret: Option<String>,
    pub identity_public: Option<String>,
    pub allow_managed: Option<bool>,
    pub allow_global: Option<bool>,
    pub allow_default: Option<bool>,
    pub allow_dns: Option<bool>,
    pub zerotier_home: Option<String>,
    pub authtoken_secret: Option<String>,
}

pub struct ZeroTierService {
    connections: HashMap<String, ZeroTierConnection>,
    #[allow(dead_code)]
    emitter: Option<DynEventEmitter>,
}

impl ZeroTierService {
    pub fn new() -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> ZeroTierServiceState {
        Arc::new(Mutex::new(ZeroTierService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    #[allow(dead_code)]
    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "zerotier",
                "status": status,
            });
            if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
                for (k, v) in ext {
                    base.insert(k.clone(), v.clone());
                }
            }
            let _ = emitter.emit_event("vpn::status-changed", payload);
        }
    }

    pub async fn create_connection(
        &mut self,
        name: String,
        config: ZeroTierConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = ZeroTierConnection {
            id: id.clone(),
            name,
            config,
            status: ZeroTierStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            network_id: None,
            assigned_ips: Vec::new(),
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        // Check if connection exists first
        if !self.connections.contains_key(connection_id) {
            return Err("ZeroTier connection not found".to_string());
        }

        // Get the network_id before borrowing mutably
        let network_id = self.connections[connection_id].config.network_id.clone();

        // Get network information before borrowing mutably
        let network_info_result = self.get_network_info(&network_id).await;

        // Now borrow mutably
        let connection = self.connections.get_mut(connection_id).expect("connection_id passed to function");

        if let ZeroTierStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = ZeroTierStatus::Connecting;

        // Join the ZeroTier network
        let binary = platform::resolve_binary("zerotier-cli")
            .map_err(|e| format!("Failed to find zerotier-cli binary: {}", e))?;
        let output = Command::new(&binary)
            .args(["join", &network_id])
            .output()
            .await
            .map_err(|e| format!("Failed to execute zerotier-cli: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = ZeroTierStatus::Error(stderr.to_string());
            return Err(format!("ZeroTier join failed: {}", stderr));
        }

        connection.network_id = Some(network_id.clone());
        connection.status = ZeroTierStatus::Connected;
        connection.connected_at = Some(Utc::now());

        // Set assigned IPs if we got network info
        if let Ok(network_info) = network_info_result {
            connection.assigned_ips = network_info.assigned_ips;
        }

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "ZeroTier connection not found".to_string())?;

        if let ZeroTierStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = ZeroTierStatus::Disconnecting;

        if let Some(network_id) = &connection.network_id {
            // Leave the ZeroTier network
            let binary = platform::resolve_binary("zerotier-cli")
                .map_err(|e| format!("Failed to find zerotier-cli binary: {}", e))?;
            let output = Command::new(&binary)
                .args(["leave", network_id])
                .output()
                .await
                .map_err(|e| format!("Failed to execute zerotier-cli: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                connection.status = ZeroTierStatus::Error(stderr.to_string());
                return Err(format!("ZeroTier leave failed: {}", stderr));
            }
        }

        connection.status = ZeroTierStatus::Disconnected;
        connection.connected_at = None;
        connection.network_id = None;
        connection.assigned_ips.clear();

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<ZeroTierConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "ZeroTier connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<ZeroTierConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn is_connection_active(&self, connection_id: &str) -> bool {
        if let Some(connection) = self.connections.get(connection_id) {
            matches!(connection.status, ZeroTierStatus::Connected)
        } else {
            false
        }
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let ZeroTierStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<ZeroTierConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "ZeroTier connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }

    async fn get_network_info(&self, network_id: &str) -> Result<NetworkInfo, String> {
        let binary = platform::resolve_binary("zerotier-cli")
            .map_err(|e| format!("Failed to find zerotier-cli binary: {}", e))?;
        let output = Command::new(&binary)
            .args(["listnetworks", "-j"])
            .output()
            .await
            .map_err(|e| format!("Failed to get network info: {}", e))?;

        if !output.status.success() {
            return Err("Failed to get network information".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let networks: Vec<serde_json::Value> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse network info: {}", e))?;

        for network in networks {
            if let Some(nwid) = network.get("nwid").and_then(|v| v.as_str()) {
                if nwid == network_id {
                    let assigned_ips = network
                        .get("assignedAddresses")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|ip| ip.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();

                    return Ok(NetworkInfo { assigned_ips });
                }
            }
        }

        Err("Network not found".to_string())
    }
}

#[derive(Debug)]
struct NetworkInfo {
    assigned_ips: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_zt_config() -> ZeroTierConfig {
        ZeroTierConfig {
            network_id: "8056c2e21c000001".to_string(),
            identity_secret: None,
            identity_public: None,
            allow_managed: Some(true),
            allow_global: Some(false),
            allow_default: Some(false),
            allow_dns: Some(true),
            zerotier_home: None,
            authtoken_secret: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn zerotier_status_serde_roundtrip() {
        let variants: Vec<ZeroTierStatus> = vec![
            ZeroTierStatus::Disconnected,
            ZeroTierStatus::Connecting,
            ZeroTierStatus::Connected,
            ZeroTierStatus::Disconnecting,
            ZeroTierStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: ZeroTierStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn zerotier_config_serde_roundtrip() {
        let cfg = default_zt_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: ZeroTierConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.network_id, "8056c2e21c000001");
        assert_eq!(back.allow_managed, Some(true));
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test ZT".to_string(), default_zt_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, ZeroTierStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        svc.create_connection("ZT1".to_string(), default_zt_config())
            .await
            .unwrap();
        svc.create_connection("ZT2".to_string(), default_zt_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_zt_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Original".to_string(), default_zt_config()).await.unwrap();

        svc.update_connection(&id, Some("Updated Name".to_string()), None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Updated Name");
    }

    #[tokio::test]
    async fn update_connection_config() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_zt_config()).await.unwrap();

        let mut new_config = default_zt_config();
        new_config.network_id = "aaaaaaaaaaaaaaaa".to_string();
        new_config.allow_global = Some(true);

        svc.update_connection(&id, None, Some(new_config)).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.network_id, "aaaaaaaaaaaaaaaa");
        assert_eq!(conn.config.allow_global, Some(true));
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_zt_config()).await.unwrap();

        let mut new_config = default_zt_config();
        new_config.allow_default = Some(true);

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config)).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.allow_default, Some(true));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let result = svc.update_connection("nonexistent", Some("Name".to_string()), None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_zt_config()).await.unwrap();

        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = ZeroTierService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_zt_config()).await.unwrap();
        assert!(!svc.is_connection_active(&id).await);
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = ZeroTierService::new();
        let svc = state.lock().await;
        assert!(!svc.is_connection_active("nonexistent").await);
    }
}

