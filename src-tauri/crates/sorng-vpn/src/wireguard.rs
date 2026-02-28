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

    fn generate_config(&self, config: &WireGuardConfig, _interface_name: &str) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn default_wg_config() -> WireGuardConfig {
        WireGuardConfig {
            private_key: Some("cHJpdmF0ZWtleQ==".to_string()),
            public_key: Some("cHVibGlja2V5".to_string()),
            preshared_key: None,
            endpoint: Some("vpn.example.com:51820".to_string()),
            allowed_ips: vec!["0.0.0.0/0".to_string()],
            persistent_keepalive: Some(25),
            listen_port: None,
            dns_servers: vec!["1.1.1.1".to_string()],
            mtu: Some(1420),
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        }
    }

    // ── Serde ───────────────────────────────────────────────────────────

    #[test]
    fn wireguard_status_serde_roundtrip() {
        let variants: Vec<WireGuardStatus> = vec![
            WireGuardStatus::Disconnected,
            WireGuardStatus::Connecting,
            WireGuardStatus::Connected,
            WireGuardStatus::Disconnecting,
            WireGuardStatus::Error("test".to_string()),
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: WireGuardStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", v), format!("{:?}", back));
        }
    }

    #[test]
    fn wireguard_config_serde_roundtrip() {
        let cfg = default_wg_config();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: WireGuardConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.endpoint, Some("vpn.example.com:51820".to_string()));
        assert_eq!(back.mtu, Some(1420));
        assert_eq!(back.allowed_ips, vec!["0.0.0.0/0"]);
    }

    #[test]
    fn wireguard_connection_serde_roundtrip() {
        let conn = WireGuardConnection {
            id: "wg1".to_string(),
            name: "Test WG".to_string(),
            config: default_wg_config(),
            status: WireGuardStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            interface_name: None,
            local_ip: None,
            peer_ip: None,
            process_id: None,
        };
        let json = serde_json::to_string(&conn).unwrap();
        let back: WireGuardConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "wg1");
        assert_eq!(back.name, "Test WG");
    }

    // ── Connection CRUD ─────────────────────────────────────────────────

    #[tokio::test]
    async fn create_connection_returns_uuid() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test WG".to_string(), default_wg_config()).await.unwrap();
        assert_eq!(id.len(), 36);
    }

    #[tokio::test]
    async fn create_connection_default_status() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_wg_config()).await.unwrap();
        let conn = svc.get_connection(&id).await.unwrap();
        assert!(matches!(conn.status, WireGuardStatus::Disconnected));
        assert!(conn.connected_at.is_none());
    }

    #[tokio::test]
    async fn list_connections_empty() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.list_connections().await.is_empty());
    }

    #[tokio::test]
    async fn list_connections_after_create() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        svc.create_connection("WG1".to_string(), default_wg_config()).await.unwrap();
        svc.create_connection("WG2".to_string(), default_wg_config()).await.unwrap();
        assert_eq!(svc.list_connections().await.len(), 2);
    }

    #[tokio::test]
    async fn get_connection_not_found() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        assert!(svc.get_connection("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn delete_connection_removes_it() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        let id = svc.create_connection("Test".to_string(), default_wg_config()).await.unwrap();
        svc.delete_connection(&id).await.unwrap();
        assert!(svc.get_connection(&id).await.is_err());
    }

    #[tokio::test]
    async fn delete_nonexistent_is_ok() {
        let state = WireGuardService::new();
        let mut svc = state.lock().await;
        // delete_connection just removes from HashMap, doesn't error on missing
        svc.delete_connection("nonexistent").await.unwrap();
    }

    // ── Config generation ───────────────────────────────────────────────

    #[tokio::test]
    async fn generate_config_has_interface_section() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
    }

    #[tokio::test]
    async fn generate_config_with_keys() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("PrivateKey = cHJpdmF0ZWtleQ=="));
        assert!(content.contains("PublicKey = cHVibGlja2V5"));
    }

    #[tokio::test]
    async fn generate_config_with_endpoint() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("Endpoint = vpn.example.com:51820"));
    }

    #[tokio::test]
    async fn generate_config_with_dns() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("DNS = 1.1.1.1"));
    }

    #[tokio::test]
    async fn generate_config_with_mtu() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("MTU = 1420"));
    }

    #[tokio::test]
    async fn generate_config_with_keepalive() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("PersistentKeepalive = 25"));
    }

    #[tokio::test]
    async fn generate_config_with_allowed_ips() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = default_wg_config();
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("AllowedIPs = 0.0.0.0/0"));
    }

    #[tokio::test]
    async fn generate_config_minimal() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let cfg = WireGuardConfig {
            private_key: None,
            public_key: None,
            preshared_key: None,
            endpoint: None,
            allowed_ips: Vec::new(),
            persistent_keepalive: None,
            listen_port: None,
            dns_servers: Vec::new(),
            mtu: None,
            table: None,
            fwmark: None,
            config_file: None,
            interface_name: None,
        };
        let content = svc.generate_config(&cfg, "wg0").unwrap();
        assert!(content.contains("[Interface]"));
        assert!(content.contains("[Peer]"));
        // Should not contain optional fields
        assert!(!content.contains("PrivateKey"));
    }

    // ── Helper methods ──────────────────────────────────────────────────

    #[tokio::test]
    async fn extract_ip_from_output_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output = "3: wg0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420\n    inet 10.0.0.1/24 scope global wg0\n";
        let ip = svc.extract_ip_from_output(output).unwrap();
        assert_eq!(ip, "10.0.0.1");
    }

    #[tokio::test]
    async fn extract_ip_from_output_no_ip() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let result = svc.extract_ip_from_output("no ip info here");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_valid() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let output = "interface: wg0\n  public key: abc=\n  peer: xyz=\n    endpoint: 1.2.3.4:51820\n";
        let peer = svc.extract_peer_ip_from_wg(output);
        assert!(peer.is_some());
    }

    #[tokio::test]
    async fn extract_peer_ip_from_wg_none() {
        let state = WireGuardService::new();
        let svc = state.lock().await;
        let peer = svc.extract_peer_ip_from_wg("no endpoint here");
        assert!(peer.is_none());
    }
}