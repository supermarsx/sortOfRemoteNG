use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use std::process::Stdio;
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;
use chrono::{DateTime, Utc};

pub type OpenVPNServiceState = Arc<Mutex<OpenVPNService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConnection {
    pub id: String,
    pub name: String,
    pub config: OpenVPNConfig,
    pub status: OpenVPNStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub process_id: Option<u32>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum OpenVPNStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConfig {
    pub config_file: Option<String>,
    pub auth_file: Option<String>,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub protocol: Option<String>, // "udp" or "tcp"
    pub cipher: Option<String>,
    pub auth: Option<String>,
    pub tls_auth: Option<bool>,
    pub tls_crypt: Option<bool>,
    pub compression: Option<bool>,
    pub mss_fix: Option<u16>,
    pub tun_mtu: Option<u16>,
    pub fragment: Option<u16>,
    pub mtu_discover: Option<bool>,
    pub keep_alive: Option<KeepAliveConfig>,
    pub route_no_pull: Option<bool>,
    pub routes: Vec<RouteConfig>,
    pub dns_servers: Vec<DNSConfig>,
    pub custom_options: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KeepAliveConfig {
    pub interval: u16,
    pub timeout: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RouteConfig {
    pub network: String,
    pub netmask: String,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DNSConfig {
    pub server: String,
    pub domain: Option<String>,
}

pub struct OpenVPNService {
    connections: HashMap<String, OpenVPNConnection>,
}

impl OpenVPNService {
    pub fn new() -> OpenVPNServiceState {
        Arc::new(Mutex::new(OpenVPNService {
            connections: HashMap::new(),
        }))
    }

    pub async fn create_connection(&mut self, name: String, config: OpenVPNConfig) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let connection = OpenVPNConnection {
            id: id.clone(),
            name,
            config,
            status: OpenVPNStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            process_id: None,
            local_ip: None,
            remote_ip: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;

        if let OpenVPNStatus::Connected = connection.status {
            return Ok(());
        }

        connection.status = OpenVPNStatus::Connecting;

        // Build OpenVPN command arguments
        let mut args = vec!["--client".to_string(), "--dev".to_string(), "tun".to_string()];

        // Add configuration file if provided
        if let Some(config_file) = &connection.config.config_file {
            if Path::new(config_file).exists() {
                args.push("--config".to_string());
                args.push(config_file.clone());
            }
        }

        // Add individual options
        if let Some(remote_host) = &connection.config.remote_host {
            args.push("--remote".to_string());
            args.push(remote_host.clone());
        }

        if let Some(remote_port) = connection.config.remote_port {
            args.push("--port".to_string());
            args.push(remote_port.to_string());
        }

        if let Some(protocol) = &connection.config.protocol {
            args.push("--proto".to_string());
            args.push(protocol.clone());
        }

        if let Some(cipher) = &connection.config.cipher {
            args.push("--cipher".to_string());
            args.push(cipher.clone());
        }

        if let Some(auth) = &connection.config.auth {
            args.push("--auth".to_string());
            args.push(auth.clone());
        }

        if connection.config.tls_auth.unwrap_or(false) {
            args.push("--tls-auth".to_string());
            args.push("ta.key".to_string()); // Assume ta.key file exists
        }

        if connection.config.tls_crypt.unwrap_or(false) {
            args.push("--tls-crypt".to_string());
            args.push("tls-crypt.key".to_string()); // Assume tls-crypt.key file exists
        }

        if connection.config.compression.unwrap_or(false) {
            args.push("--compress".to_string());
            args.push("lz4".to_string());
        }

        if let Some(mss_fix) = connection.config.mss_fix {
            args.push("--mssfix".to_string());
            args.push(mss_fix.to_string());
        }

        if let Some(tun_mtu) = connection.config.tun_mtu {
            args.push("--tun-mtu".to_string());
            args.push(tun_mtu.to_string());
        }

        if let Some(fragment) = connection.config.fragment {
            args.push("--fragment".to_string());
            args.push(fragment.to_string());
        }

        if connection.config.mtu_discover.unwrap_or(false) {
            args.push("--mtu-disc".to_string());
            args.push("yes".to_string());
        }

        if let Some(keep_alive) = &connection.config.keep_alive {
            args.push("--keepalive".to_string());
            args.push(keep_alive.interval.to_string());
            args.push(keep_alive.timeout.to_string());
        }

        if connection.config.route_no_pull.unwrap_or(false) {
            args.push("--route-no-pull".to_string());
        }

        // Add routes
        for route in &connection.config.routes {
            args.push("--route".to_string());
            args.push(route.network.clone());
            args.push(route.netmask.clone());
            if let Some(gateway) = &route.gateway {
                args.push(gateway.clone());
            }
        }

        // Add DNS servers
        for dns in &connection.config.dns_servers {
            args.push("--dhcp-option".to_string());
            args.push("DNS".to_string());
            args.push(dns.server.clone());
            if let Some(domain) = &dns.domain {
                args.push("--dhcp-option".to_string());
                args.push("DOMAIN".to_string());
                args.push(domain.clone());
            }
        }

        // Add custom options
        for option in &connection.config.custom_options {
            args.push(option.clone());
        }

        // Add management interface
        args.push("--management".to_string());
        args.push("127.0.0.1".to_string());
        args.push("7505".to_string());
        args.push("--management-client".to_string());

        // Add daemon mode
        args.push("--daemon".to_string());

        // Start OpenVPN process
        let mut child = Command::new("openvpn")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start OpenVPN: {}", e))?;

        let pid = child.id().ok_or("Failed to get process ID")?;
        connection.process_id = Some(pid);
        connection.connected_at = Some(Utc::now());

        // Wait a bit for connection to establish
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        // Check if process is still running
        if let Ok(Some(_)) = child.try_wait() {
            connection.status = OpenVPNStatus::Error("OpenVPN process exited early".to_string());
            return Err("OpenVPN connection failed".to_string());
        }

        connection.status = OpenVPNStatus::Connected;
        Ok(())
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;

        if let Some(pid) = connection.process_id {
            // Kill the OpenVPN process
            let _ = Command::new("kill")
                .arg(pid.to_string())
                .status()
                .await;
        }

        connection.status = OpenVPNStatus::Disconnected;
        connection.process_id = None;
        connection.connected_at = None;
        connection.local_ip = None;
        connection.remote_ip = None;

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<OpenVPNConnection, String> {
        self.connections.get(connection_id)
            .cloned()
            .ok_or_else(|| "OpenVPN connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<OpenVPNConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let OpenVPNStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        self.connections.remove(connection_id);
        Ok(())
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<OpenVPNStatus, String> {
        let connection = self.connections.get(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    pub async fn is_connection_active(&self, connection_id: &str) -> bool {
        if let Some(connection) = self.connections.get(connection_id) {
            matches!(connection.status, OpenVPNStatus::Connected)
        } else {
            false
        }
    }
}

#[tauri::command]
pub async fn create_openvpn_connection(
    name: String,
    config: OpenVPNConfig,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_openvpn(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_openvpn(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_openvpn_connections(
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<Vec<OpenVPNConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn get_openvpn_status(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNStatus, String> {
    let service = state.lock().await;
    service.get_status(&connection_id).await
}