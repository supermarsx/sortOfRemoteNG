use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::collections::HashMap;
use tokio::fs;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use tauri;

#[tauri::command]
pub async fn create_wireguard_connection(
    name: String,
    config: WireGuardConfig,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<String, String> {
    let mut service = wireguard_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<WireGuardConnection, String> {
    let service = wireguard_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_wireguard_connections(
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<Vec<WireGuardConnection>, String> {
    let service = wireguard_service.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.delete_connection(&connection_id).await
}

pub type WireGuardServiceState = Arc<Mutex<WireGuardService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConnection {
    pub id: String,
    pub name: String,
    pub config: WireGuardConfig,
    pub status: WireGuardStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub interface_name: Option<String>,
    pub local_ip: Option<String>,
    pub peer_ip: Option<String>,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum WireGuardStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardConfig {
    pub private_key: Option<String>,
    pub public_key: Option<String>,
    pub preshared_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u16>,
    pub listen_port: Option<u16>,
    pub dns_servers: Vec<String>,
    pub mtu: Option<u16>,
    pub table: Option<String>,
    pub fwmark: Option<u32>,
    pub config_file: Option<String>,
    pub interface_name: Option<String>,
}

pub struct WireGuardService {
    connections: HashMap<String, WireGuardConnection>,
}

impl WireGuardService {
    pub fn new() -> WireGuardServiceState {
        Arc::new(Mutex::new(WireGuardService {
            connections: HashMap::new(),
        }))
    }

    pub async fn create_connection(&mut self, name: String, config: WireGuardConfig) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = WireGuardConnection {
            id: id.clone(),
            name,
            config,
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        // Check if connection exists first
        if !self.connections.contains_key(connection_id) {
            return Err("WireGuard connection not found".to_string());
        }

        // Get the config before borrowing mutably
        let config = self.connections[connection_id].config.clone();
        let interface_name = config.interface_name.clone()
            .unwrap_or_else(|| format!("wg_{}", &connection_id[..8]));

        // Generate config content before borrowing mutably
        let config_content = self.generate_config(&config, &interface_name)?;

        // Bring up WireGuard interface before borrowing mutably
        let config_path = format!("/tmp/wg_{}.conf", connection_id);
        fs::write(&config_path, config_content).await
            .map_err(|e| format!("Failed to write config file: {}", e))?;

        let output = Command::new("wg-quick")
            .arg("up")
            .arg(&config_path)
            .output()
            .await
            .map_err(|e| format!("Failed to execute wg-quick: {}", e))?;

        // Get interface information before borrowing mutably
        let iface_info_result = if output.status.success() {
            self.get_interface_info(&interface_name).await.ok()
        } else {
            None
        };

        // Now borrow mutably
        let connection = self.connections.get_mut(connection_id).unwrap();

        if let WireGuardStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = WireGuardStatus::Connecting;
        connection.interface_name = Some(interface_name.clone());

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = WireGuardStatus::Error(stderr.to_string());
            return Err(format!("WireGuard connection failed: {}", stderr));
        }

        // Set interface information
        if let Some(iface_info) = iface_info_result {
            connection.local_ip = iface_info.local_ip;
            connection.peer_ip = iface_info.peer_ip;
        }

        connection.status = WireGuardStatus::Connected;
        connection.connected_at = Some(Utc::now());

        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "WireGuard connection not found".to_string())?;

        if let WireGuardStatus::Disconnected = connection.status {
            return Ok(());
        }

        connection.status = WireGuardStatus::Disconnecting;

        let config_path = format!("/tmp/wg_{}.conf", connection_id);

        // Bring down WireGuard interface
        let output = Command::new("wg-quick")
            .arg("down")
            .arg(&config_path)
            .output()
            .await
            .map_err(|e| format!("Failed to execute wg-quick: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            connection.status = WireGuardStatus::Error(stderr.to_string());
            return Err(format!("WireGuard disconnection failed: {}", stderr));
        }

        // Clean up config file
        let _ = fs::remove_file(&config_path).await;

        connection.status = WireGuardStatus::Disconnected;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.peer_ip = None;

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<WireGuardConnection, String> {
        self.connections.get(connection_id)
            .cloned()
            .ok_or_else(|| "WireGuard connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<WireGuardConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let WireGuardStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    fn generate_config(&self, config: &WireGuardConfig, interface_name: &str) -> Result<String, String> {
        let mut lines = Vec::new();

        lines.push(format!("[Interface]"));
        if let Some(private_key) = &config.private_key {
            lines.push(format!("PrivateKey = {}", private_key));
        }
        if let Some(listen_port) = config.listen_port {
            lines.push(format!("ListenPort = {}", listen_port));
        }
        if !config.dns_servers.is_empty() {
            lines.push(format!("DNS = {}", config.dns_servers.join(",")));
        }
        if let Some(mtu) = config.mtu {
            lines.push(format!("MTU = {}", mtu));
        }
        if let Some(table) = &config.table {
            lines.push(format!("Table = {}", table));
        }
        if let Some(fwmark) = config.fwmark {
            lines.push(format!("FwMark = {}", fwmark));
        }

        lines.push(format!(""));
        lines.push(format!("[Peer]"));
        if let Some(public_key) = &config.public_key {
            lines.push(format!("PublicKey = {}", public_key));
        }
        if let Some(preshared_key) = &config.preshared_key {
            lines.push(format!("PresharedKey = {}", preshared_key));
        }
        if let Some(endpoint) = &config.endpoint {
            lines.push(format!("Endpoint = {}", endpoint));
        }
        if !config.allowed_ips.is_empty() {
            lines.push(format!("AllowedIPs = {}", config.allowed_ips.join(",")));
        }
        if let Some(persistent_keepalive) = config.persistent_keepalive {
            lines.push(format!("PersistentKeepalive = {}", persistent_keepalive));
        }

        Ok(lines.join("\n"))
    }

    async fn get_interface_info(&self, interface_name: &str) -> Result<InterfaceInfo, String> {
        let output = Command::new("ip")
            .args(&["addr", "show", interface_name])
            .output()
            .await
            .map_err(|e| format!("Failed to get interface info: {}", e))?;

        if !output.status.success() {
            return Err("Failed to get interface information".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let local_ip = self.extract_ip_from_output(&stdout)?;

        // Get peer information from wg show
        let wg_output = Command::new("wg")
            .args(&["show", interface_name])
            .output()
            .await
            .map_err(|e| format!("Failed to get wg info: {}", e))?;

        let peer_ip = if wg_output.status.success() {
            let wg_stdout = String::from_utf8_lossy(&wg_output.stdout);
            self.extract_peer_ip_from_wg(&wg_stdout)
        } else {
            None
        };

        Ok(InterfaceInfo {
            local_ip: Some(local_ip),
            peer_ip,
        })
    }

    fn extract_ip_from_output(&self, output: &str) -> Result<String, String> {
        for line in output.lines() {
            if line.trim().starts_with("inet ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    return Ok(parts[1].split('/').next().unwrap_or(parts[1]).to_string());
                }
            }
        }
        Err("No IP address found".to_string())
    }

    fn extract_peer_ip_from_wg(&self, output: &str) -> Option<String> {
        for line in output.lines() {
            if line.contains("endpoint:") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    return Some(parts[1].trim().to_string());
                }
            }
        }
        None
    }
}

#[derive(Debug)]
struct InterfaceInfo {
    local_ip: Option<String>,
    peer_ip: Option<String>,
}