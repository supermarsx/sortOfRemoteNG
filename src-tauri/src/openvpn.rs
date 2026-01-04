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

    pub async fn parse_ovpn_file(&self, ovpn_content: &str) -> Result<OpenVPNConfig, String> {
        let mut config = OpenVPNConfig {
            config_file: None,
            auth_file: None,
            ca_cert: None,
            client_cert: None,
            client_key: None,
            username: None,
            password: None,
            remote_host: None,
            remote_port: None,
            protocol: None,
            cipher: None,
            auth: None,
            tls_auth: None,
            tls_crypt: None,
            compression: None,
            mss_fix: None,
            tun_mtu: None,
            fragment: None,
            mtu_discover: None,
            keep_alive: None,
            route_no_pull: None,
            routes: Vec::new(),
            dns_servers: Vec::new(),
            custom_options: Vec::new(),
        };

        let lines: Vec<&str> = ovpn_content.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i].trim();

            // Skip comments and empty lines
            if line.starts_with('#') || line.starts_with(';') || line.is_empty() {
                i += 1;
                continue;
            }

            // Parse remote directive
            if line.starts_with("remote ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.remote_host = Some(parts[1].to_string());
                    if parts.len() >= 3 {
                        config.remote_port = parts[2].parse().ok();
                    }
                }
            }
            // Parse port directive
            else if line.starts_with("port ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.remote_port = parts[1].parse().ok();
                }
            }
            // Parse proto directive
            else if line.starts_with("proto ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.protocol = Some(parts[1].to_string());
                }
            }
            // Parse cipher directive
            else if line.starts_with("cipher ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.cipher = Some(parts[1].to_string());
                }
            }
            // Parse auth directive
            else if line.starts_with("auth ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.auth = Some(parts[1].to_string());
                }
            }
            // Parse tls-auth directive
            else if line == "tls-auth ta.key" || line == "tls-auth ta.key 1" {
                config.tls_auth = Some(true);
            }
            // Parse tls-crypt directive
            else if line.starts_with("tls-crypt ") {
                config.tls_crypt = Some(true);
            }
            // Parse compress directive
            else if line.starts_with("compress ") || line == "compress" {
                config.compression = Some(true);
            }
            // Parse mssfix directive
            else if line.starts_with("mssfix ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.mss_fix = parts[1].parse().ok();
                }
            }
            // Parse tun-mtu directive
            else if line.starts_with("tun-mtu ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.tun_mtu = parts[1].parse().ok();
                }
            }
            // Parse fragment directive
            else if line.starts_with("fragment ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.fragment = parts[1].parse().ok();
                }
            }
            // Parse mtu-disc directive
            else if line.starts_with("mtu-disc ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    config.mtu_discover = Some(parts[1] == "yes");
                }
            }
            // Parse keepalive directive
            else if line.starts_with("keepalive ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.keep_alive = Some(KeepAliveConfig {
                        interval: parts[1].parse().unwrap_or(10),
                        timeout: parts[2].parse().unwrap_or(60),
                    });
                }
            }
            // Parse route-no-pull directive
            else if line == "route-no-pull" {
                config.route_no_pull = Some(true);
            }
            // Parse route directive
            else if line.starts_with("route ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.routes.push(RouteConfig {
                        network: parts[1].to_string(),
                        netmask: parts[2].to_string(),
                        gateway: parts.get(3).map(|s| s.to_string()),
                    });
                }
            }
            // Parse dhcp-option DNS directive
            else if line.starts_with("dhcp-option DNS ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    config.dns_servers.push(DNSConfig {
                        server: parts[2].to_string(),
                        domain: None,
                    });
                }
            }
            // Parse dhcp-option DOMAIN directive
            else if line.starts_with("dhcp-option DOMAIN ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 && !config.dns_servers.is_empty() {
                    if let Some(dns) = config.dns_servers.last_mut() {
                        dns.domain = Some(parts[2].to_string());
                    }
                }
            }
            // Handle inline certificates and keys
            else if line == "<ca>" {
                let mut cert_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</ca>" {
                    cert_content.push_str(lines[i]);
                    cert_content.push('\n');
                    i += 1;
                }
                // In a real implementation, you'd save this to a temp file
                config.ca_cert = Some("inline_ca_cert".to_string());
            }
            else if line == "<cert>" {
                let mut cert_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</cert>" {
                    cert_content.push_str(lines[i]);
                    cert_content.push('\n');
                    i += 1;
                }
                config.client_cert = Some("inline_client_cert".to_string());
            }
            else if line == "<key>" {
                let mut key_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</key>" {
                    key_content.push_str(lines[i]);
                    key_content.push('\n');
                    i += 1;
                }
                config.client_key = Some("inline_client_key".to_string());
            }
            else if line == "<tls-auth>" {
                let mut tls_auth_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</tls-auth>" {
                    tls_auth_content.push_str(lines[i]);
                    tls_auth_content.push('\n');
                    i += 1;
                }
                config.tls_auth = Some(true);
            }
            else if line == "<tls-crypt>" {
                let mut tls_crypt_content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "</tls-crypt>" {
                    tls_crypt_content.push_str(lines[i]);
                    tls_crypt_content.push('\n');
                    i += 1;
                }
                config.tls_crypt = Some(true);
            }
            // Add other directives as custom options
            else if !line.is_empty() {
                config.custom_options.push(line.to_string());
            }

            i += 1;
        }

        Ok(config)
    }

    pub async fn create_connection_from_ovpn(&mut self, name: String, ovpn_content: String) -> Result<String, String> {
        let config = self.parse_ovpn_file(&ovpn_content).await?;
        self.create_connection(name, config).await
    }

    pub async fn update_connection_auth(&mut self, connection_id: &str, username: Option<String>, password: Option<String>) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;

        connection.config.username = username;
        connection.config.password = password;
        Ok(())
    }

    pub async fn set_connection_key_files(&mut self, connection_id: &str, ca_cert: Option<String>, client_cert: Option<String>, client_key: Option<String>, tls_auth: Option<String>) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "OpenVPN connection not found".to_string())?;

        connection.config.ca_cert = ca_cert;
        connection.config.client_cert = client_cert;
        connection.config.client_key = client_key;

        if tls_auth.is_some() {
            connection.config.tls_auth = Some(true);
        }

        Ok(())
    }

    pub async fn validate_ovpn_config(&self, ovpn_content: &str) -> Result<Vec<String>, String> {
        let mut warnings = Vec::new();
        let mut errors = Vec::new();

        let lines: Vec<&str> = ovpn_content.lines().collect();

        let mut has_remote = false;
        let mut has_ca = false;
        let mut has_cert = false;
        let mut has_key = false;

        for line in lines {
            let line = line.trim();

            if line.starts_with("remote ") {
                has_remote = true;
            } else if line == "<ca>" {
                has_ca = true;
            } else if line == "<cert>" {
                has_cert = true;
            } else if line == "<key>" {
                has_key = true;
            } else if line.starts_with("cipher ") {
                // Check if cipher is supported
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let cipher = parts[1];
                    if !["AES-256-GCM", "AES-128-GCM", "AES-256-CBC", "AES-128-CBC", "BF-CBC"].contains(&cipher) {
                        warnings.push(format!("Potentially unsupported cipher: {}", cipher));
                    }
                }
            }
        }

        if !has_remote {
            errors.push("No remote server specified".to_string());
        }

        if !has_ca {
            warnings.push("No CA certificate specified - connection may not be secure".to_string());
        }

        if !has_cert && !has_key {
            warnings.push("No client certificate or key specified - will use password authentication only".to_string());
        }

        if !errors.is_empty() {
            return Err(errors.join("; "));
        }

        Ok(warnings)
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

#[tauri::command]
pub async fn create_openvpn_connection_from_ovpn(
    name: String,
    ovpn_content: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection_from_ovpn(name, ovpn_content).await
}

#[tauri::command]
pub async fn update_openvpn_connection_auth(
    connection_id: String,
    username: Option<String>,
    password: Option<String>,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection_auth(&connection_id, username, password).await
}

#[tauri::command]
pub async fn set_openvpn_connection_key_files(
    connection_id: String,
    ca_cert: Option<String>,
    client_cert: Option<String>,
    client_key: Option<String>,
    tls_auth: Option<String>,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.set_connection_key_files(&connection_id, ca_cert, client_cert, client_key, tls_auth).await
}

#[tauri::command]
pub async fn validate_ovpn_config(
    ovpn_content: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service.validate_ovpn_config(&ovpn_content).await
}