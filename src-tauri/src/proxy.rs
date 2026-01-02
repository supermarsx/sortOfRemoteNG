use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::net::SocketAddr;
use std::collections::HashMap;
use tokio::time::{timeout, Duration};
use tokio::process::Command;
use futures::SinkExt;

pub type ProxyServiceState = Arc<Mutex<ProxyService>>;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ProxyConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: String, // "http", "https", "socks4", "socks5", "ssh", "dns-tunnel", "icmp-tunnel", "websocket", "quic", "tcp-over-dns", "http-connect", "shadowsocks"
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,

    // SSH-specific options
    pub ssh_key_file: Option<String>,
    pub ssh_key_passphrase: Option<String>,
    pub ssh_host_key_verification: Option<bool>,
    pub ssh_known_hosts_file: Option<String>,

    // Advanced tunneling options
    pub tunnel_domain: Option<String>, // For DNS tunneling
    pub tunnel_key: Option<String>, // Encryption key for tunneling
    pub tunnel_method: Option<String>, // "direct", "fragmented", "obfuscated"
    pub custom_headers: Option<std::collections::HashMap<String, String>>, // For HTTP-based tunneling
    pub websocket_path: Option<String>, // For WebSocket tunneling
    pub quic_cert_file: Option<String>, // For QUIC tunneling
    pub shadowsocks_method: Option<String>, // Shadowsocks encryption method
    pub shadowsocks_plugin: Option<String>, // Shadowsocks plugin
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
            "ssh" => {
                Self::connect_ssh_tunnel_static(connection).await
            }
            "dns-tunnel" => {
                Self::connect_dns_tunnel_static(connection).await
            }
            "icmp-tunnel" => {
                Self::connect_icmp_tunnel_static(connection).await
            }
            "websocket" => {
                Self::connect_websocket_tunnel_static(connection).await
            }
            "quic" => {
                Self::connect_quic_tunnel_static(connection).await
            }
            "tcp-over-dns" => {
                Self::connect_tcp_over_dns_static(connection).await
            }
            "http-connect" => {
                Self::connect_http_connect_tunnel_static(connection).await
            }
            "shadowsocks" => {
                Self::connect_shadowsocks_static(connection).await
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

    async fn connect_ssh_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // SSH tunneling implementation
        // This creates an SSH tunnel using the system's ssh command
        use tokio::process::Command;

        let local_forward = format!("127.0.0.1:0:{}:{}", connection.target_host, connection.target_port);
        let remote_user_host = format!("{}@{}", connection.proxy_config.username.as_deref().unwrap_or("root"), connection.proxy_config.host);
        let ssh_args = vec![
            "-L", &local_forward,
            "-N", // Don't execute remote command
            "-o", "StrictHostKeyChecking=no", // Skip host key verification for simplicity
            &remote_user_host,
        ];

        let mut command = Command::new("ssh");
        command.args(&ssh_args);

        if let Some(key_file) = &connection.proxy_config.ssh_key_file {
            command.arg("-i").arg(key_file);
        }

        let mut child = command.spawn()
            .map_err(|e| format!("Failed to spawn SSH process: {}", e))?;

        // Wait a moment for the tunnel to establish
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Check if the process is still running
        if let Ok(Some(_)) = child.try_wait() {
            return Err("SSH tunnel failed to establish".to_string());
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the SSH tunnel
        tokio::spawn(async move {
            Self::handle_ssh_tunnel(listener, child).await;
        });

        Ok(local_port)
    }

    async fn connect_dns_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // DNS tunneling implementation
        // This is a simplified implementation - real DNS tunneling would be more complex
        use tokio::process::Command;

        let domain = connection.proxy_config.tunnel_domain.as_deref()
            .unwrap_or("tunnel.example.com");

        // Use a DNS tunneling tool like dnscat2 or iodine
        // For this example, we'll use a simple implementation
        let mut command = Command::new("iodine");
        command.args(&[
            "-f", // foreground mode
            "-P", connection.proxy_config.password.as_deref().unwrap_or("password"),
            connection.proxy_config.host.as_str(),
            domain,
        ]);

        let mut child = command.spawn()
            .map_err(|e| format!("Failed to spawn DNS tunnel process: {}", e))?;

        // Wait for tunnel to establish
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the DNS tunnel
        tokio::spawn(async move {
            Self::handle_dns_tunnel(listener, child).await;
        });

        Ok(local_port)
    }

    async fn connect_icmp_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // ICMP tunneling implementation
        // This would typically use tools like hping3 or custom ICMP tunneling software
        use tokio::process::Command;

        let mut command = Command::new("hping3");
        command.args(&[
            "--icmp",
            "-d", "100", // data size
            "--spoof", &connection.proxy_config.host,
            connection.target_host.as_str(),
        ]);

        let mut child = command.spawn()
            .map_err(|e| format!("Failed to spawn ICMP tunnel process: {}", e))?;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the ICMP tunnel
        tokio::spawn(async move {
            Self::handle_icmp_tunnel(listener, child).await;
        });

        Ok(local_port)
    }

    async fn connect_websocket_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // WebSocket tunneling implementation
        // This would use WebSocket connections to tunnel traffic
        use tokio_tungstenite::{connect_async, tungstenite::Message};
        use futures_util::{SinkExt, StreamExt};

        let ws_url = format!("ws://{}:{}{}",
            connection.proxy_config.host,
            connection.proxy_config.port,
            connection.proxy_config.websocket_path.as_deref().unwrap_or("/")
        );

        let (ws_stream, _) = connect_async(ws_url).await
            .map_err(|e| format!("Failed to connect to WebSocket: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the WebSocket tunnel
        tokio::spawn(async move {
            Self::handle_websocket_tunnel(listener, write, read).await;
        });

        Ok(local_port)
    }

    async fn connect_quic_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // QUIC tunneling implementation
        // This would use QUIC protocol for tunneling
        // For now, this is a placeholder implementation
        Err("QUIC tunneling not yet implemented".to_string())
    }

    async fn connect_tcp_over_dns_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // TCP-over-DNS tunneling implementation
        // This encodes TCP traffic as DNS queries
        use tokio::process::Command;

        let mut command = Command::new("tcp-over-dns");
        command.args(&[
            "--server", &connection.proxy_config.host,
            "--port", &connection.proxy_config.port.to_string(),
            "--domain", connection.proxy_config.tunnel_domain.as_deref().unwrap_or("example.com"),
        ]);

        let mut child = command.spawn()
            .map_err(|e| format!("Failed to spawn TCP-over-DNS process: {}", e))?;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the TCP-over-DNS tunnel
        tokio::spawn(async move {
            Self::handle_tcp_over_dns_tunnel(listener, child).await;
        });

        Ok(local_port)
    }

    async fn connect_http_connect_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // Enhanced HTTP CONNECT tunneling with custom headers and obfuscation
        let proxy_addr = format!("{}:{}", connection.proxy_config.host, connection.proxy_config.port);
        let proxy_socket_addr: SocketAddr = proxy_addr.parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(proxy_socket_addr))
            .await
            .map_err(|_| "Proxy connection timeout".to_string())?
            .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // Build CONNECT request with custom headers
        let mut connect_request = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
            connection.target_host, connection.target_port,
            connection.target_host, connection.target_port
        );

        // Add custom headers for obfuscation
        if let Some(custom_headers) = &connection.proxy_config.custom_headers {
            for (key, value) in custom_headers {
                connect_request.push_str(&format!("{}: {}\r\n", key, value));
            }
        }

        // Add proxy authentication if provided
        if let (Some(username), Some(password)) = (
            &connection.proxy_config.username,
            &connection.proxy_config.password
        ) {
            let auth = base64::encode(format!("{}:{}", username, password));
            connect_request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
        }

        connect_request.push_str("Connection: close\r\n\r\n");

        stream.write_all(connect_request.as_bytes()).await
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

    async fn connect_shadowsocks_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // Shadowsocks proxy implementation
        use tokio::process::Command;

        let method = connection.proxy_config.shadowsocks_method.as_deref()
            .unwrap_or("aes-256-gcm");

        let mut command = Command::new("ss-local");
        command.args(&[
            "-s", &connection.proxy_config.host,
            "-p", &connection.proxy_config.port.to_string(),
            "-k", connection.proxy_config.password.as_deref().unwrap_or("password"),
            "-m", method,
            "-l", "0", // Let system assign port
        ]);

        if let Some(plugin) = &connection.proxy_config.shadowsocks_plugin {
            command.arg("-plugin").arg(plugin);
        }

        let mut child = command.spawn()
            .map_err(|e| format!("Failed to spawn Shadowsocks process: {}", e))?;

        // Wait for Shadowsocks to start
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let local_port = local_addr.port();
        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a task to handle the Shadowsocks tunnel
        tokio::spawn(async move {
            Self::handle_shadowsocks_tunnel(listener, child).await;
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

    async fn handle_ssh_tunnel(listener: tokio::net::TcpListener, mut child: tokio::process::Child) {
        // Monitor the SSH process and handle connections
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // For SSH tunnels, the local port forwarding is handled by ssh itself
            // We just need to keep the process alive
            let _ = child.wait().await;
        }
    }

    async fn handle_dns_tunnel(listener: tokio::net::TcpListener, mut child: tokio::process::Child) {
        // Monitor the DNS tunnel process
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // DNS tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    async fn handle_icmp_tunnel(listener: tokio::net::TcpListener, mut child: tokio::process::Child) {
        // Monitor the ICMP tunnel process
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // ICMP tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    async fn handle_websocket_tunnel(
        listener: tokio::net::TcpListener,
        mut write: futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
            tokio_tungstenite::tungstenite::Message
        >,
        mut read: futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
        >
    ) {
        // Handle WebSocket tunneling
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // Bridge TCP and WebSocket traffic
            tokio::spawn(async move {
                use futures_util::StreamExt;
                use tokio::io::AsyncReadExt;

                let mut buf = [0; 1024];
                loop {
                    tokio::select! {
                        result = client_stream.read(&mut buf) => {
                            match result {
                                Ok(0) => break,
                                Ok(n) => {
                                    if let Err(_) = write.send(tokio_tungstenite::tungstenite::Message::Binary(buf[..n].to_vec())).await {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                        Some(message) = read.next() => {
                            match message {
                                Ok(tokio_tungstenite::tungstenite::Message::Binary(data)) => {
                                    if let Err(_) = client_stream.write_all(&data).await {
                                        break;
                                    }
                                }
                                Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
                                _ => {}
                            }
                        }
                    }
                }
            });
        }
    }

    async fn handle_tcp_over_dns_tunnel(listener: tokio::net::TcpListener, mut child: tokio::process::Child) {
        // Monitor the TCP-over-DNS tunnel process
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // TCP-over-DNS tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    async fn handle_shadowsocks_tunnel(listener: tokio::net::TcpListener, mut child: tokio::process::Child) {
        // Monitor the Shadowsocks process
        if let Ok((mut client_stream, _)) = listener.accept().await {
            // Shadowsocks handles the traffic encryption/decryption
            let _ = child.wait().await;
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
        if self.connections.remove(connection_id).is_none() {
            return Err("Proxy connection not found".to_string());
        }
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

        if self.chains.remove(chain_id).is_none() {
            return Err("Proxy chain not found".to_string());
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_test_proxy_config(proxy_type: &str) -> ProxyConfig {
        ProxyConfig {
            proxy_type: proxy_type.to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            username: Some("testuser".to_string()),
            password: Some("testpass".to_string()),
            ssh_key_file: None,
            ssh_key_passphrase: None,
            ssh_host_key_verification: None,
            ssh_known_hosts_file: None,
            tunnel_domain: None,
            tunnel_key: None,
            tunnel_method: None,
            custom_headers: None,
            websocket_path: None,
            quic_cert_file: None,
            shadowsocks_method: None,
            shadowsocks_plugin: None,
        }
    }

    #[tokio::test]
    async fn test_new_proxy_service() {
        let service = ProxyService::new();
        
        // Service should be created successfully
        assert!(service.lock().await.connections.is_empty());
        assert!(service.lock().await.chains.is_empty());
    }

    #[tokio::test]
    async fn test_create_proxy_connection() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("http");
        
        let result = service.lock().await.create_proxy_connection(
            "example.com".to_string(),
            80,
            proxy_config,
        ).await;
        
        assert!(result.is_ok());
        let connection_id = result.unwrap();
        
        // Verify connection was created
        let connections = &service.lock().await.connections;
        assert!(connections.contains_key(&connection_id));
        
        let connection = connections.get(&connection_id).unwrap();
        assert_eq!(connection.target_host, "example.com");
        assert_eq!(connection.target_port, 80);
        assert_eq!(connection.proxy_config.proxy_type, "http");
        assert_eq!(connection.status, ProxyConnectionStatus::Disconnected);
        assert!(connection.local_port.is_none());
    }

    #[tokio::test]
    async fn test_get_proxy_connection_existing() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("socks5");
        
        let connection_id = service.lock().await.create_proxy_connection(
            "test.com".to_string(),
            443,
            proxy_config,
        ).await.unwrap();
        
        let result = service.lock().await.get_proxy_connection(&connection_id).await;
        assert!(result.is_ok());
        
        let connection = result.unwrap();
        assert_eq!(connection.id, connection_id);
        assert_eq!(connection.target_host, "test.com");
        assert_eq!(connection.target_port, 443);
    }

    #[tokio::test]
    async fn test_get_proxy_connection_nonexistent() {
        let service = ProxyService::new();
        
        let result = service.lock().await.get_proxy_connection("nonexistent").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Proxy connection not found");
    }

    #[tokio::test]
    async fn test_list_proxy_connections() {
        let service = ProxyService::new();
        
        // Initially empty
        let connections = service.lock().await.list_proxy_connections().await;
        assert!(connections.is_empty());
        
        // Add some connections
        let config1 = create_test_proxy_config("http");
        let config2 = create_test_proxy_config("socks5");
        
        service.lock().await.create_proxy_connection(
            "host1.com".to_string(),
            80,
            config1,
        ).await.unwrap();
        
        service.lock().await.create_proxy_connection(
            "host2.com".to_string(),
            443,
            config2,
        ).await.unwrap();
        
        let connections = service.lock().await.list_proxy_connections().await;
        assert_eq!(connections.len(), 2);
        
        // Check that both connections are present
        let hosts: Vec<String> = connections.iter().map(|c| c.target_host.clone()).collect();
        assert!(hosts.contains(&"host1.com".to_string()));
        assert!(hosts.contains(&"host2.com".to_string()));
    }

    #[tokio::test]
    async fn test_delete_proxy_connection_existing() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("ssh");
        
        let connection_id = service.lock().await.create_proxy_connection(
            "ssh.example.com".to_string(),
            22,
            proxy_config,
        ).await.unwrap();
        
        // Verify connection exists
        assert!(service.lock().await.connections.contains_key(&connection_id));
        
        // Delete connection
        let result = service.lock().await.delete_proxy_connection(&connection_id).await;
        assert!(result.is_ok());
        
        // Verify connection is gone
        assert!(!service.lock().await.connections.contains_key(&connection_id));
    }

    #[tokio::test]
    async fn test_delete_proxy_connection_nonexistent() {
        let service = ProxyService::new();
        
        let result = service.lock().await.delete_proxy_connection("nonexistent").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Proxy connection not found");
    }

    #[tokio::test]
    async fn test_connect_via_proxy_unsupported_type() {
        let service = ProxyService::new();
        let mut proxy_config = create_test_proxy_config("unsupported");
        
        let connection_id = service.lock().await.create_proxy_connection(
            "example.com".to_string(),
            80,
            proxy_config,
        ).await.unwrap();
        
        let result = service.lock().await.connect_via_proxy(&connection_id).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported proxy type"));
        
        // Check that status was updated to error
        let service_guard = service.lock().await;
        let connection = service_guard.connections.get(&connection_id).unwrap();
        match &connection.status {
            ProxyConnectionStatus::Error(_) => {},
            _ => panic!("Expected error status"),
        }
    }

    #[tokio::test]
    async fn test_disconnect_proxy_connection() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("http");
        
        let connection_id = service.lock().await.create_proxy_connection(
            "example.com".to_string(),
            80,
            proxy_config,
        ).await.unwrap();
        
        // Disconnect (should work even if not connected)
        let result = service.lock().await.disconnect_proxy(&connection_id).await;
        assert!(result.is_ok());
        
        // Verify status is disconnected
        let service_guard = service.lock().await;
        let connection = service_guard.connections.get(&connection_id).unwrap();
        assert!(matches!(connection.status, ProxyConnectionStatus::Disconnected));
    }

    #[tokio::test]
    async fn test_create_proxy_chain() {
        let service = ProxyService::new();
        
        let layers = vec![
            create_test_proxy_config("http"),
            create_test_proxy_config("socks5"),
        ];
        
        let result = service.lock().await.create_proxy_chain(
            "Test Chain".to_string(),
            layers,
            Some("A test proxy chain".to_string()),
        ).await;
        
        assert!(result.is_ok());
        let chain_id = result.unwrap();
        
        // Verify chain was created
        let chains = &service.lock().await.chains;
        assert!(chains.contains_key(&chain_id));
        
        let chain = chains.get(&chain_id).unwrap();
        assert_eq!(chain.name, "Test Chain");
        assert_eq!(chain.description, Some("A test proxy chain".to_string()));
        assert_eq!(chain.layers.len(), 2);
        assert!(matches!(chain.status, ProxyConnectionStatus::Disconnected));
    }

    #[tokio::test]
    async fn test_get_proxy_chain_existing() {
        let service = ProxyService::new();
        
        let layers = vec![create_test_proxy_config("http")];
        
        let chain_id = service.lock().await.create_proxy_chain(
            "Test Chain".to_string(),
            layers,
            None,
        ).await.unwrap();
        
        let result = service.lock().await.get_proxy_chain(&chain_id).await;
        assert!(result.is_ok());
        
        let chain = result.unwrap();
        assert_eq!(chain.id, chain_id);
        assert_eq!(chain.name, "Test Chain");
    }

    #[tokio::test]
    async fn test_get_proxy_chain_nonexistent() {
        let service = ProxyService::new();
        
        let result = service.lock().await.get_proxy_chain("nonexistent").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Proxy chain not found");
    }

    #[tokio::test]
    async fn test_list_proxy_chains() {
        let service = ProxyService::new();
        
        // Initially empty
        let chains = service.lock().await.list_proxy_chains().await;
        assert!(chains.is_empty());
        
        // Add chains
        let layers1 = vec![create_test_proxy_config("http")];
        let layers2 = vec![create_test_proxy_config("socks5")];
        
        service.lock().await.create_proxy_chain(
            "Chain 1".to_string(),
            layers1,
            None,
        ).await.unwrap();
        
        service.lock().await.create_proxy_chain(
            "Chain 2".to_string(),
            layers2,
            None,
        ).await.unwrap();
        
        let chains = service.lock().await.list_proxy_chains().await;
        assert_eq!(chains.len(), 2);
        
        let names: Vec<String> = chains.iter().map(|c| c.name.clone()).collect();
        assert!(names.contains(&"Chain 1".to_string()));
        assert!(names.contains(&"Chain 2".to_string()));
    }

    #[tokio::test]
    async fn test_delete_proxy_chain_existing() {
        let service = ProxyService::new();
        
        let layers = vec![create_test_proxy_config("http")];
        let chain_id = service.lock().await.create_proxy_chain(
            "Test Chain".to_string(),
            layers,
            None,
        ).await.unwrap();
        
        // Verify chain exists
        assert!(service.lock().await.chains.contains_key(&chain_id));
        
        // Delete chain
        let result = service.lock().await.delete_proxy_chain(&chain_id).await;
        assert!(result.is_ok());
        
        // Verify chain is gone
        assert!(!service.lock().await.chains.contains_key(&chain_id));
    }

    #[tokio::test]
    async fn test_delete_proxy_chain_nonexistent() {
        let service = ProxyService::new();
        
        let result = service.lock().await.delete_proxy_chain("nonexistent").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Proxy chain not found");
    }

    #[tokio::test]
    async fn test_proxy_config_serialization() {
        let config = ProxyConfig {
            proxy_type: "websocket".to_string(),
            host: "ws.example.com".to_string(),
            port: 443,
            username: Some("wsuser".to_string()),
            password: Some("wspass".to_string()),
            ssh_key_file: Some("/path/to/key".to_string()),
            ssh_key_passphrase: Some("keypass".to_string()),
            ssh_host_key_verification: Some(true),
            ssh_known_hosts_file: Some("/path/to/known_hosts".to_string()),
            tunnel_domain: Some("tunnel.example.com".to_string()),
            tunnel_key: Some("tunnelkey123".to_string()),
            tunnel_method: Some("obfuscated".to_string()),
            custom_headers: Some({
                let mut headers = HashMap::new();
                headers.insert("X-Custom".to_string(), "value".to_string());
                headers
            }),
            websocket_path: Some("/ws".to_string()),
            quic_cert_file: Some("/path/to/cert.pem".to_string()),
            shadowsocks_method: Some("aes-256-gcm".to_string()),
            shadowsocks_plugin: Some("v2ray-plugin".to_string()),
        };
        
        // Test serialization
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.proxy_type, config.proxy_type);
        assert_eq!(deserialized.host, config.host);
        assert_eq!(deserialized.port, config.port);
        assert_eq!(deserialized.username, config.username);
        assert_eq!(deserialized.password, config.password);
        assert_eq!(deserialized.websocket_path, config.websocket_path);
        assert_eq!(deserialized.shadowsocks_method, config.shadowsocks_method);
    }



    #[tokio::test]
    async fn test_concurrent_proxy_operations() {
        let service = ProxyService::new();

        // Spawn multiple tasks to create connections concurrently
        let mut handles = vec![];
        for i in 0..5 {
            let service_clone = service.clone();
            let handle = tokio::spawn(async move {
                let proxy_config = create_test_proxy_config("http");
                let connection_id = service_clone.lock().await.create_proxy_connection(
                    format!("host{}.com", i),
                    80,
                    proxy_config,
                ).await.unwrap();

                // Don't try to connect in unit tests to avoid network dependencies
                // Just return the connection ID

                connection_id
            });
            handles.push(handle);
        }

        // Wait for all tasks to complete
        let mut connection_ids = vec![];
        for handle in handles {
            connection_ids.push(handle.await.unwrap());
        }

        // Verify all connections were created
        let connections = service.lock().await.list_proxy_connections().await;
        assert_eq!(connections.len(), 5);

        // Verify all IDs are unique
        let mut ids = std::collections::HashSet::new();
        for id in &connection_ids {
            assert!(ids.insert(id));
        }
    }
}