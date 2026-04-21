use crate::platform;
use chrono::{DateTime, Utc};
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type TailscaleServiceState = Arc<Mutex<TailscaleService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TailscaleConnection {
    pub id: String,
    pub name: String,
    pub config: TailscaleConfig,
    pub status: TailscaleStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub tailnet_ip: Option<String>,
    pub hostname: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TailscaleStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TailscaleConfig {
    pub auth_key: Option<String>,
    pub login_server: Option<String>,
    pub accept_routes: Option<bool>,
    pub accept_dns: Option<bool>,
    pub advertise_routes: Vec<String>,
    pub advertise_tags: Vec<String>,
    pub hostname: Option<String>,
    pub exit_node: Option<String>,
    pub exit_node_allow_lan_access: Option<bool>,
    pub ssh: Option<bool>,
    pub funnel: Option<bool>,
    pub state_dir: Option<String>,
    pub socket: Option<String>,
}

pub struct TailscaleService {
    connections: HashMap<String, TailscaleConnection>,
    #[allow(dead_code)]
    emitter: Option<DynEventEmitter>,
}

impl TailscaleService {
    pub fn new() -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    #[allow(dead_code)]
    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "tailscale",
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
        config: TailscaleConfig,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = TailscaleConnection {
            id: id.clone(),
            name,
            config,
            status: TailscaleStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            tailnet_ip: None,
            hostname: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        if let TailscaleStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = TailscaleStatus::Connecting;

        // Build tailscale up command with options
        let mut args = vec!["up"];

        // auth_key is passed via environment variable to avoid leaking it in
        // process argument lists visible through `ps` / task-manager.
        let auth_key_env = connection.config.auth_key.clone();

        if let Some(login_server) = &connection.config.login_server {
            args.push("--login-server");
            args.push(login_server);
        }

        if let Some(accept_routes) = connection.config.accept_routes {
            if accept_routes {
                args.push("--accept-routes");
            } else {
                args.push("--accept-routes=false");
            }
        }

        if let Some(accept_dns) = connection.config.accept_dns {
            if accept_dns {
                args.push("--accept-dns");
            } else {
                args.push("--accept-dns=false");
            }
        }

        let advertise_routes = connection.config.advertise_routes.join(",");
        let advertise_tags = connection.config.advertise_tags.join(",");

        if !connection.config.advertise_routes.is_empty() {
            args.push("--advertise-routes");
            args.push(&advertise_routes);
        }

        if !connection.config.advertise_tags.is_empty() {
            args.push("--advertise-tags");
            args.push(&advertise_tags);
        }

        if let Some(hostname) = &connection.config.hostname {
            args.push("--hostname");
            args.push(hostname);
        }

        if let Some(exit_node) = &connection.config.exit_node {
            args.push("--exit-node");
            args.push(exit_node);
        }

        if let Some(exit_node_allow_lan_access) = connection.config.exit_node_allow_lan_access {
            if exit_node_allow_lan_access {
                args.push("--exit-node-allow-lan-access");
            } else {
                args.push("--exit-node-allow-lan-access=false");
            }
        }

        if let Some(ssh) = connection.config.ssh {
            if ssh {
                args.push("--ssh");
            } else {
                args.push("--ssh=false");
            }
        }

        if let Some(funnel) = connection.config.funnel {
            if funnel {
                args.push("--funnel");
            } else {
                args.push("--funnel=false");
            }
        }

        // Execute tailscale up
        let binary = platform::resolve_binary("tailscale")
            .map_err(|e| format!("Failed to find tailscale binary: {}", e))?;
        let mut command = Command::new(&binary);
        command.args(&args);

        // Pass auth key via TS_AUTHKEY env var instead of CLI arg
        if let Some(ref key) = auth_key_env {
            command.env("TS_AUTHKEY", key);
        }

        let output = command
            .output()
            .await
            .map_err(|e| format!("Failed to execute tailscale: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = TailscaleStatus::Error(stderr.to_string());
            return Err(format!("Tailscale connection failed: {}", stderr));
        }

        connection.status = TailscaleStatus::Connected;
        connection.connected_at = Some(Utc::now());

        // Get connection information
        if let Ok(status_info) = self.get_status_info().await {
            let connection = self.connections.get_mut(connection_id).expect("connection_id passed to function");
            connection.tailnet_ip = status_info.tailnet_ip;
            connection.hostname = status_info.hostname;
        }

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        if let TailscaleStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = TailscaleStatus::Disconnecting;

        // Execute tailscale down
        let binary = platform::resolve_binary("tailscale")
            .map_err(|e| format!("Failed to find tailscale binary: {}", e))?;
        let output = Command::new(&binary)
            .arg("down")
            .output()
            .await
            .map_err(|e| format!("Failed to execute tailscale: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = TailscaleStatus::Error(stderr.to_string());
            return Err(format!("Tailscale disconnection failed: {}", stderr));
        }

        connection.status = TailscaleStatus::Disconnected;
        connection.connected_at = None;
        connection.tailnet_ip = None;
        connection.hostname = None;

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<TailscaleConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Tailscale connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<TailscaleConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn is_connection_active(&self, connection_id: &str) -> bool {
        if let Some(connection) = self.connections.get(connection_id) {
            matches!(connection.status, TailscaleStatus::Connected)
        } else {
            false
        }
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let TailscaleStatus::Connected = connection.status {
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
        config: Option<TailscaleConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            connection.config = new_config;
        }
        Ok(())
    }

    async fn get_status_info(&self) -> Result<StatusInfo, String> {
        let binary = platform::resolve_binary("tailscale")
            .map_err(|e| format!("Failed to find tailscale binary: {}", e))?;
        let output = Command::new(&binary)
            .args(["status", "--json"])
            .output()
            .await
            .map_err(|e| format!("Failed to get status: {}", e))?;

        if !output.status.success() {
            return Err("Failed to get status information".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let status: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse status: {}", e))?;

        let tailnet_ip = status
            .get("TailscaleIPs")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|ip| ip.as_str())
            .map(|s| s.to_string());

        let hostname = status
            .get("User")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|u| u.get("LoginName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(StatusInfo {
            tailnet_ip,
            hostname,
        })
    }
}

#[derive(Debug)]
struct StatusInfo {
    tailnet_ip: Option<String>,
    hostname: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_ts_config() -> TailscaleConfig {
        TailscaleConfig {
            auth_key: Some("tskey-auth-xxx".to_string()),
            login_server: None,
            accept_routes: Some(true),
            accept_dns: Some(true),
            advertise_routes: Vec::new(),
            advertise_tags: Vec::new(),
            hostname: Some("test-node".to_string()),
            exit_node: None,
            exit_node_allow_lan_access: None,
            ssh: None,
            funnel: None,
            state_dir: None,
            socket: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn tailscale_status_serde_roundtrip() {
        let variants: Vec<TailscaleStatus> = vec![
            TailscaleStatus::Disconnected,
            TailscaleStatus::Connecting,
            TailscaleStatus::Connected,
            TailscaleStatus::Disconnecting,
            TailscaleStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: TailscaleStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn tailscale_config_serde_roundtrip() {
        let cfg = default_ts_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: TailscaleConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.hostname, Some("test-node".to_string()));
        assert_eq!(back.accept_routes, Some(true));
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test TS".to_string(), default_ts_config())
            .await
            .unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, TailscaleStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = TailscaleService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        svc.create_connection("TS1".to_string(), default_ts_config())
            .await
            .unwrap();
        svc.create_connection("TS2".to_string(), default_ts_config())
            .await
            .unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = TailscaleService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection("Test".to_string(), default_ts_config())
            .await
            .unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    // ── update_connection ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_connection_name() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Original".to_string(), default_ts_config()).await.unwrap();

        svc.update_connection(&id, Some("Updated Name".to_string()), None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Updated Name");
    }

    #[tokio::test]
    async fn update_connection_config() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_ts_config()).await.unwrap();

        let mut new_config = default_ts_config();
        new_config.hostname = Some("new-hostname".to_string());
        new_config.accept_dns = Some(false);

        svc.update_connection(&id, None, Some(new_config)).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.config.hostname, Some("new-hostname".to_string()));
        assert_eq!(conn.config.accept_dns, Some(false));
    }

    #[tokio::test]
    async fn update_connection_both() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_ts_config()).await.unwrap();

        let mut new_config = default_ts_config();
        new_config.exit_node = Some("exit-node-1".to_string());

        svc.update_connection(&id, Some("Renamed".to_string()), Some(new_config)).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Renamed");
        assert_eq!(conn.config.exit_node, Some("exit-node-1".to_string()));
    }

    #[tokio::test]
    async fn update_connection_not_found() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let result = svc.update_connection("nonexistent", Some("Name".to_string()), None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn update_connection_no_changes() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_ts_config()).await.unwrap();

        svc.update_connection(&id, None, None).await.unwrap();

        let conn = svc.get_connection(&id).await.unwrap();
        assert_eq!(conn.name, "Test");
    }

    // ── is_connection_active ───────────────────────────────────────────

    #[tokio::test]
    async fn is_connection_active_disconnected() {
        let state = TailscaleService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_ts_config()).await.unwrap();
        assert!(!svc.is_connection_active(&id).await);
    }

    #[tokio::test]
    async fn is_connection_active_nonexistent() {
        let state = TailscaleService::new();
        let svc = state.lock().await;
        assert!(!svc.is_connection_active("nonexistent").await);
    }
}

