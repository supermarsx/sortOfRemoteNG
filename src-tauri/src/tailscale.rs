use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use tauri;

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
}

impl TailscaleService {
    pub fn new() -> TailscaleServiceState {
        Arc::new(Mutex::new(TailscaleService {
            connections: HashMap::new(),
        }))
    }

    pub async fn create_connection(&mut self, name: String, config: TailscaleConfig) -> Result<String, String> {
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
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        if let TailscaleStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = TailscaleStatus::Connecting;

        // Build tailscale up command with options
        let mut args = vec!["up"];

        if let Some(auth_key) = &connection.config.auth_key {
            args.push("--auth-key");
            args.push(auth_key);
        }

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
        let output = Command::new("tailscale")
            .args(&args)
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
            let connection = self.connections.get_mut(connection_id).unwrap();
            connection.tailnet_ip = status_info.tailnet_ip;
            connection.hostname = status_info.hostname;
        }

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "Tailscale connection not found".to_string())?;

        if let TailscaleStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = TailscaleStatus::Disconnecting;

        // Execute tailscale down
        let output = Command::new("tailscale")
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
        self.connections.get(connection_id)
            .cloned()
            .ok_or_else(|| "Tailscale connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<TailscaleConnection> {
        self.connections.values().cloned().collect()
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

    async fn get_status_info(&self) -> Result<StatusInfo, String> {
        let output = Command::new("tailscale")
            .args(&["status", "--json"])
            .output()
            .await
            .map_err(|e| format!("Failed to get status: {}", e))?;

        if !output.status.success() {
            return Err("Failed to get status information".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let status: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse status: {}", e))?;

        let tailnet_ip = status.get("TailscaleIPs")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|ip| ip.as_str())
            .map(|s| s.to_string());

        let hostname = status.get("User")
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

#[tauri::command]
pub async fn create_tailscale_connection(
    name: String,
    config: TailscaleConfig,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<String, String> {
    let mut service = tailscale_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<TailscaleConnection, String> {
    let service = tailscale_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_tailscale_connections(
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<Vec<TailscaleConnection>, String> {
    let service = tailscale_service.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.delete_connection(&connection_id).await
}