use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::net::SocketAddr;
use std::collections::HashMap;
use tokio::time::{timeout, Duration};

pub type ProxyServiceState = Arc<Mutex<ProxyService>>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ProxyConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: String, // "http", "https", "socks4", "socks5"
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConnection {
    pub id: String,
    pub target_host: String,
    pub target_port: u16,
    pub proxy_config: ProxyConfig,
    pub local_port: Option<u16>,
    pub status: ProxyConnectionStatus,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChainLayer {
    pub id: String,
    pub proxy_config: ProxyConfig,
    pub position: usize,
    pub status: ProxyConnectionStatus,
    pub local_port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChain {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layers: Vec<ProxyChainLayer>,
    pub status: ProxyConnectionStatus,
    pub created_at: String,
    pub connected_at: Option<String>,
    pub final_local_port: Option<u16>,
    pub error: Option<String>,
}

pub struct ProxyService {
    connections: HashMap<String, ProxyConnection>,
    chains: HashMap<String, ProxyChain>,
}

impl ProxyService {
    pub fn new() -> ProxyServiceState {
        Arc::new(Mutex::new(ProxyService {
            connections: HashMap::new(),
            chains: HashMap::new(),
        }))
    }

    pub async fn create_proxy_connection(
        &mut self,
        target_host: String,
        target_port: u16,
        proxy_config: ProxyConfig,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();

        let connection = ProxyConnection {
            id: id.clone(),
            target_host,
            target_port,
            proxy_config,
            local_port: None,
            status: ProxyConnectionStatus::Disconnected,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect_via_proxy(&mut self, connection_id: &str) -> Result<u16, String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "Proxy connection not found".to_string())?;

        connection.status = ProxyConnectionStatus::Connecting;

        let result = match connection.proxy_config.proxy_type.as_str() {
            "http" | "https" => {
                Self::connect_http_proxy_static(connection).await
            }
            "socks4" => {
                Self::connect_socks4_proxy_static(connection).await
            }
            "socks5" => {
                Self::connect_socks5_proxy_static(connection).await
            }
            _ => {
                Err(format!("Unsupported proxy type: {}", connection.proxy_config.proxy_type))
            }
        };

        match result {
            Ok(local_port) => {
                connection.local_port = Some(local_port);
                connection.status = ProxyConnectionStatus::Connected;
                Ok(local_port)
            }
            Err(e) => {
                connection.status = ProxyConnectionStatus::Error(e.clone());
                Err(e)
            }
        }
    }

    async fn connect_http_proxy_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // For HTTP proxies, we need to establish a CONNECT tunnel
        let proxy_addr = format!("{}:{}", connection.proxy_config.host, connection.proxy_config.port);
        let proxy_socket_addr: SocketAddr = proxy_addr.parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(proxy_socket_addr))
            .await
            .map_err(|_| "Proxy connection timeout".to_string())?
            .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // Send CONNECT request
        let connect_request = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
            connection.target_host, connection.target_port,
            connection.target_host, connection.target_port
        );

        let mut request = connect_request;

        // Add proxy authentication if provided
        if let (Some(username), Some(password)) = (
            &connection.proxy_config.username,
            &connection.proxy_config.password
        ) {
            let auth = base64::encode(format!("{}:{}", username, password));
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
        }

        request.push_str("Connection: close\r\n\r\n");

        stream.write_all(request.as_bytes()).await
            .map_err(|e| format!("Failed to send CONNECT request: {}", e))?;

        // Read response
        let mut buffer = [0; 1024];
        let n = stream.read(&mut buffer).await
            .map_err(|e| format!("Failed to read proxy response: {}", e))?;

        let response = String::from_utf8_lossy(&buffer[..n]);
        if !response.contains("200") {
            return Err(format!("Proxy CONNECT failed: {}", response));
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the proxy tunnel
        tokio::spawn(async move {
            Self::handle_proxy_tunnel(listener, stream).await;
        });

        Ok(local_port)
    }

    async fn connect_socks4_proxy_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        let proxy_addr = format!("{}:{}", connection.proxy_config.host, connection.proxy_config.port);
        let proxy_socket_addr: SocketAddr = proxy_addr.parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(proxy_socket_addr))
            .await
            .map_err(|_| "Proxy connection timeout".to_string())?
            .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // SOCKS4 request format:
        // +----+----+----+----+----+----+----+----+----+----+....+----+
        // | VN | CD | DSTPORT |      DSTIP        | USERID       |NULL|
        // +----+----+----+----+----+----+----+----+----+----+....+----+

        let mut request = vec![0x04, 0x01]; // VN=4, CD=1 (CONNECT)

        // DSTPORT (big endian)
        request.extend_from_slice(&(connection.target_port as u16).to_be_bytes());

        // DSTIP - resolve hostname to IP
        let target_ip = tokio::net::lookup_host(&format!("{}:{}", connection.target_host, connection.target_port))
            .await
            .map_err(|e| format!("Failed to resolve target host: {}", e))?
            .next()
            .ok_or("No IP address found for target host")?
            .ip();

        match target_ip {
            std::net::IpAddr::V4(ipv4) => {
                request.extend_from_slice(&ipv4.octets());
            }
            std::net::IpAddr::V6(_) => {
                return Err("SOCKS4 does not support IPv6".to_string());
            }
        }

        // USERID (empty for no auth)
        request.push(0x00);

        stream.write_all(&request).await
            .map_err(|e| format!("Failed to send SOCKS4 request: {}", e))?;

        // Read response
        let mut response = [0; 8];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS4 response: {}", e))?;

        if response[1] != 0x5A {
            return Err(format!("SOCKS4 connection failed: reply code {}", response[1]));
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the proxy tunnel
        tokio::spawn(async move {
            Self::handle_proxy_tunnel(listener, stream).await;
        });

        Ok(local_port)
    }

    async fn connect_socks5_proxy_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        let proxy_addr = format!("{}:{}", connection.proxy_config.host, connection.proxy_config.port);
        let proxy_socket_addr: SocketAddr = proxy_addr.parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(proxy_socket_addr))
            .await
            .map_err(|_| "Proxy connection timeout".to_string())?
            .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // SOCKS5 handshake
        let mut auth_methods = vec![0x00]; // No authentication
        if connection.proxy_config.username.is_some() && connection.proxy_config.password.is_some() {
            auth_methods.push(0x02); // Username/password authentication
        }

        let greeting = [0x05, auth_methods.len() as u8];
        let mut greeting_msg = greeting.to_vec();
        greeting_msg.extend_from_slice(&auth_methods);

        stream.write_all(&greeting_msg).await
            .map_err(|e| format!("Failed to send SOCKS5 greeting: {}", e))?;

        let mut response = [0; 2];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS5 greeting response: {}", e))?;

        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 response".to_string());
        }

        let chosen_method = response[1];
        match chosen_method {
            0x00 => {
                // No authentication required
            }
            0x02 => {
                // Username/password authentication
                if let (Some(username), Some(password)) = (
                    &connection.proxy_config.username,
                    &connection.proxy_config.password
                ) {
                    let username_bytes = username.as_bytes();
                    let password_bytes = password.as_bytes();

                    let auth_request = [
                        0x01,
                        username_bytes.len() as u8,
                    ];
                    let mut auth_msg = auth_request.to_vec();
                    auth_msg.extend_from_slice(username_bytes);
                    auth_msg.push(password_bytes.len() as u8);
                    auth_msg.extend_from_slice(password_bytes);

                    stream.write_all(&auth_msg).await
                        .map_err(|e| format!("Failed to send SOCKS5 auth: {}", e))?;

                    let mut auth_response = [0; 2];
                    stream.read_exact(&mut auth_response).await
                        .map_err(|e| format!("Failed to read SOCKS5 auth response: {}", e))?;

                    if auth_response[1] != 0x00 {
                        return Err("SOCKS5 authentication failed".to_string());
                    }
                } else {
                    return Err("SOCKS5 authentication required but no credentials provided".to_string());
                }
            }
            0xFF => {
                return Err("No acceptable SOCKS5 authentication methods".to_string());
            }
            _ => {
                return Err(format!("Unsupported SOCKS5 auth method: {}", chosen_method));
            }
        }

        // Send CONNECT request
        let mut connect_request = vec![0x05, 0x01, 0x00]; // VER, CMD(CONNECT), RSV

        // Add target address
        let target_host_bytes = connection.target_host.as_bytes();
        if let Ok(target_ip) = connection.target_host.parse::<std::net::IpAddr>() {
            match target_ip {
                std::net::IpAddr::V4(ipv4) => {
                    connect_request.push(0x01); // IPv4
                    connect_request.extend_from_slice(&ipv4.octets());
                }
                std::net::IpAddr::V6(ipv6) => {
                    connect_request.push(0x04); // IPv6
                    connect_request.extend_from_slice(&ipv6.octets());
                }
            }
        } else {
            connect_request.push(0x03); // Domain name
            connect_request.push(target_host_bytes.len() as u8);
            connect_request.extend_from_slice(target_host_bytes);
        }

        // Add target port
        connect_request.extend_from_slice(&(connection.target_port as u16).to_be_bytes());

        stream.write_all(&connect_request).await
            .map_err(|e| format!("Failed to send SOCKS5 CONNECT: {}", e))?;

        // Read response
        let mut connect_response = [0; 4];
        stream.read_exact(&mut connect_response).await
            .map_err(|e| format!("Failed to read SOCKS5 CONNECT response: {}", e))?;

        if connect_response[1] != 0x00 {
            return Err(format!("SOCKS5 CONNECT failed: reply code {}", connect_response[1]));
        }

        // Skip the bound address/port in response
        let mut addr_type = [0; 1];
        stream.read_exact(&mut addr_type).await
            .map_err(|e| format!("Failed to read address type: {}", e))?;

        match addr_type[0] {
            0x01 => {
                // IPv4
                let mut ipv4 = [0; 4];
                stream.read_exact(&mut ipv4).await
                    .map_err(|e| format!("Failed to read IPv4: {}", e))?;
            }
            0x03 => {
                // Domain name
                let mut len = [0; 1];
                stream.read_exact(&mut len).await
                    .map_err(|e| format!("Failed to read domain length: {}", e))?;
                let mut domain = vec![0; len[0] as usize];
                stream.read_exact(&mut domain).await
                    .map_err(|e| format!("Failed to read domain: {}", e))?;
            }
            0x04 => {
                // IPv6
                let mut ipv6 = [0; 16];
                stream.read_exact(&mut ipv6).await
                    .map_err(|e| format!("Failed to read IPv6: {}", e))?;
            }
            _ => {
                return Err(format!("Unknown address type: {}", addr_type[0]));
            }
        }

        // Skip port
        let mut port = [0; 2];
        stream.read_exact(&mut port).await
            .map_err(|e| format!("Failed to read port: {}", e))?;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the proxy tunnel
        tokio::spawn(async move {
            Self::handle_proxy_tunnel(listener, stream).await;
        });

        Ok(local_port)
    }

    async fn handle_proxy_tunnel(listener: tokio::net::TcpListener, mut proxy_stream: TcpStream) {
        // For simplicity, we'll handle only one connection at a time
        // In a production implementation, you'd want to handle multiple concurrent connections
        if let Ok((mut client_stream, _)) = listener.accept().await {
            if let Err(e) = tokio::io::copy_bidirectional(&mut client_stream, &mut proxy_stream).await {
                eprintln!("Proxy tunnel error: {}", e);
            }
        }
    }

    pub async fn disconnect_proxy(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.get_mut(connection_id)
            .ok_or_else(|| "Proxy connection not found".to_string())?;

        connection.status = ProxyConnectionStatus::Disconnected;
        connection.local_port = None;
        Ok(())
    }

    pub async fn get_proxy_connection(&self, connection_id: &str) -> Result<ProxyConnection, String> {
        self.connections.get(connection_id)
            .cloned()
            .ok_or_else(|| "Proxy connection not found".to_string())
    }

    pub async fn list_proxy_connections(&self) -> Vec<ProxyConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_proxy_connection(&mut self, connection_id: &str) -> Result<(), String> {
        self.connections.remove(connection_id);
        Ok(())
    }

    // Proxy Chain Management Methods
    pub async fn create_proxy_chain(
        &mut self,
        name: String,
        layers: Vec<ProxyConfig>,
        description: Option<String>,
    ) -> Result<String, String> {
        let chain_id = uuid::Uuid::new_v4().to_string();

        let chain_layers: Vec<ProxyChainLayer> = layers
            .into_iter()
            .enumerate()
            .map(|(index, proxy_config)| ProxyChainLayer {
                id: format!("{}_layer_{}", chain_id, index),
                proxy_config,
                position: index,
                status: ProxyConnectionStatus::Disconnected,
                local_port: None,
                error: None,
            })
            .collect();

        let chain = ProxyChain {
            id: chain_id.clone(),
            name,
            description,
            layers: chain_layers,
            status: ProxyConnectionStatus::Disconnected,
            created_at: chrono::Utc::now().to_rfc3339(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };

        self.chains.insert(chain_id.clone(), chain);
        Ok(chain_id)
    }

    pub async fn connect_proxy_chain(
        &mut self,
        chain_id: &str,
        target_host: String,
        target_port: u16,
    ) -> Result<u16, String> {
        // Check if chain exists first
        if !self.chains.contains_key(chain_id) {
            return Err("Proxy chain not found".to_string());
        }

        let mut current_target_host = target_host;
        let mut current_target_port = target_port;
        let mut previous_local_port: Option<u16> = None;
        let mut connection_ids = Vec::new();

        // Get chain layers without borrowing mutably
        let layers_config: Vec<(usize, ProxyConfig)> = {
            let chain = self.chains.get(chain_id).unwrap();
            chain.layers.iter().map(|layer| (layer.position, layer.proxy_config.clone())).collect()
        };

        // Connect layers in sequence
        for (position, proxy_config) in layers_config {
            // Create a proxy connection for this layer
            let connection_id = self.create_proxy_connection(
                current_target_host.clone(),
                current_target_port,
                proxy_config,
            ).await?;

            connection_ids.push((position, connection_id.clone()));

            // Connect via proxy and get the local port
            let local_port = self.connect_via_proxy(&connection_id).await?;

            // Update targets for next layer (if any)
            current_target_host = "127.0.0.1".to_string();
            current_target_port = local_port;
            previous_local_port = Some(local_port);
        }

        // Now update the chain status and layer information
        {
            let chain = self.chains.get_mut(chain_id).unwrap();
            chain.status = ProxyConnectionStatus::Connected;
            chain.connected_at = Some(chrono::Utc::now().to_rfc3339());
            chain.final_local_port = previous_local_port;

            // Update layer statuses
            for (position, connection_id) in connection_ids {
                if let Some(layer) = chain.layers.iter_mut().find(|l| l.position == position) {
                    layer.status = ProxyConnectionStatus::Connected;
                    // Find the local port from the connection
                    if let Some(conn) = self.connections.get(&connection_id) {
                        layer.local_port = conn.local_port;
                    }
                }
            }
        }

        Ok(previous_local_port.unwrap_or(target_port))
    }

    pub async fn disconnect_proxy_chain(&mut self, chain_id: &str) -> Result<(), String> {
        // Check if chain exists
        if !self.chains.contains_key(chain_id) {
            return Err("Proxy chain not found".to_string());
        }

        // Collect local ports to disconnect
        let local_ports: Vec<u16> = {
            let chain = self.chains.get(chain_id).unwrap();
            chain.layers.iter()
                .filter_map(|layer| layer.local_port)
                .collect()
        };

        // Collect connection IDs to disconnect
        let connection_ids_to_disconnect: Vec<String> = local_ports.iter()
            .filter_map(|&local_port| {
                self.connections.iter()
                    .find(|(_, connection)| connection.local_port == Some(local_port))
                    .map(|(conn_id, _)| conn_id.clone())
            })
            .collect();

        // Disconnect connections
        for conn_id in connection_ids_to_disconnect {
            let _ = self.disconnect_proxy(&conn_id).await;
        }

        // Update chain status
        {
            let chain = self.chains.get_mut(chain_id).unwrap();
            chain.status = ProxyConnectionStatus::Disconnected;

            // Update layer statuses
            for layer in &mut chain.layers {
                layer.status = ProxyConnectionStatus::Disconnected;
                layer.local_port = None;
            }

            chain.connected_at = None;
            chain.final_local_port = None;
        }

        Ok(())
    }

    pub async fn get_proxy_chain(&self, chain_id: &str) -> Result<ProxyChain, String> {
        self.chains.get(chain_id)
            .cloned()
            .ok_or_else(|| "Proxy chain not found".to_string())
    }

    pub async fn list_proxy_chains(&self) -> Vec<ProxyChain> {
        self.chains.values().cloned().collect()
    }

    pub async fn delete_proxy_chain(&mut self, chain_id: &str) -> Result<(), String> {
        // First disconnect if connected
        if let Some(chain) = self.chains.get(chain_id) {
            if matches!(chain.status, ProxyConnectionStatus::Connected) {
                let _ = self.disconnect_proxy_chain(chain_id).await;
            }
        }

        self.chains.remove(chain_id);
        Ok(())
    }

    pub async fn get_proxy_chain_health(&self, chain_id: &str) -> Result<serde_json::Value, String> {
        let chain = self.chains.get(chain_id)
            .ok_or_else(|| "Proxy chain not found".to_string())?;

        let mut layer_health = Vec::new();
        let mut healthy_count = 0;

        for layer in &chain.layers {
            let healthy = matches!(layer.status, ProxyConnectionStatus::Connected);
            if healthy {
                healthy_count += 1;
            }

            layer_health.push(serde_json::json!({
                "id": layer.id,
                "position": layer.position,
                "status": format!("{:?}", layer.status),
                "healthy": healthy,
                "local_port": layer.local_port,
                "error": layer.error
            }));
        }

        let overall_health = if healthy_count == chain.layers.len() {
            "healthy"
        } else if healthy_count > 0 {
            "degraded"
        } else {
            "failed"
        };

        Ok(serde_json::json!({
            "chain_id": chain.id,
            "overall_health": overall_health,
            "healthy_layers": healthy_count,
            "total_layers": chain.layers.len(),
            "layers": layer_health
        }))
    }
}

#[tauri::command]
pub async fn create_proxy_connection(
    target_host: String,
    target_port: u16,
    proxy_config: ProxyConfig,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_proxy_connection(target_host, target_port, proxy_config).await
}

#[tauri::command]
pub async fn connect_via_proxy(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<u16, String> {
    let mut service = state.lock().await;
    service.connect_via_proxy(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_proxy(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_proxy(&connection_id).await
}

#[tauri::command]
pub async fn get_proxy_connection(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<ProxyConnection, String> {
    let service = state.lock().await;
    service.get_proxy_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_proxy_connections(
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<Vec<ProxyConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_proxy_connections().await)
}

#[tauri::command]
pub async fn delete_proxy_connection(
    connection_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_proxy_connection(&connection_id).await
}

#[tauri::command]
pub async fn create_proxy_chain(
    name: String,
    layers: Vec<ProxyConfig>,
    description: Option<String>,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_proxy_chain(name, layers, description).await
}

#[tauri::command]
pub async fn connect_proxy_chain(
    chain_id: String,
    target_host: String,
    target_port: u16,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<u16, String> {
    let mut service = state.lock().await;
    service.connect_proxy_chain(&chain_id, target_host, target_port).await
}

#[tauri::command]
pub async fn disconnect_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<ProxyChain, String> {
    let service = state.lock().await;
    service.get_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn list_proxy_chains(
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<Vec<ProxyChain>, String> {
    let service = state.lock().await;
    Ok(service.list_proxy_chains().await)
}

#[tauri::command]
pub async fn delete_proxy_chain(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_proxy_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_proxy_chain_health(
    chain_id: String,
    state: tauri::State<'_, ProxyServiceState>,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service.get_proxy_chain_health(&chain_id).await
}