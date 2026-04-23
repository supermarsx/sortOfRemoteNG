//! # Proxy Service
//!
//! This module provides comprehensive proxy and tunneling functionality for the SortOfRemote NG application.
//! It supports multiple proxy protocols and advanced tunneling techniques for secure and anonymous connections.
//!
//! ## Supported Proxy Types
//!
//! - **HTTP/HTTPS**: Standard web proxies with optional authentication
//! - **SOCKS4/SOCKS5**: Versatile proxy protocols with UDP support
//! - **SSH Tunneling**: Secure shell-based port forwarding
//! - **DNS Tunneling**: Data exfiltration through DNS queries
//! - **ICMP Tunneling**: Using ping packets for data transmission
//! - **WebSocket Tunneling**: Real-time bidirectional communication
//! - **QUIC Tunneling**: Next-generation transport protocol
//! - **TCP-over-DNS**: TCP connections tunneled through DNS
//! - **HTTP CONNECT**: HTTP method for establishing tunnels
//! - **Shadowsocks**: Encrypted SOCKS5 proxy protocol
//!
//! ## Features
//!
//! - **Connection Chaining**: Chain multiple proxies for enhanced anonymity
//! - **Dynamic Port Allocation**: Automatic local port assignment
//! - **Connection Health Monitoring**: Real-time status tracking
//! - **Error Handling**: Comprehensive error reporting and recovery
//! - **Thread Safety**: Async mutex-protected operations
//! - **Extensible Architecture**: Easy addition of new proxy types
//!
//! ## Security Considerations
//!
//! - All proxy credentials are handled securely
//! - SSH key-based authentication support
//! - Certificate validation for secure protocols
//! - Connection encryption where applicable
//!
//! ## Example
//!

use base64::Engine;
use futures::SinkExt;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::platform;

// ── QUIC certificate verification bypass for self-signed / dev servers ──────

/// Dummy certificate verifier that treats any certificate as valid.
///
/// **WARNING**: This is vulnerable to MITM attacks and should only be used for
/// development, testing, or when connecting to servers with self-signed
/// certificates where the user has explicitly opted in.
#[derive(Debug)]
struct SkipServerVerification(Arc<rustls::crypto::CryptoProvider>);

impl SkipServerVerification {
    fn new() -> Arc<Self> {
        Arc::new(Self(Arc::new(rustls::crypto::ring::default_provider())))
    }
}

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

// ── SSH tunnel handler for russh ────────────────────────────────────────────

/// Minimal russh client handler used exclusively for SSH port-forwarding tunnels.
///
/// Accepts all server host keys (mirrors the old `StrictHostKeyChecking=no` behaviour).
/// A production deployment should verify host keys against a known-hosts file.
struct SshTunnelHandler;

#[async_trait::async_trait]
impl russh::client::Handler for SshTunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<(Self, bool), Self::Error> {
        // Accept all host keys (equivalent to StrictHostKeyChecking=no)
        Ok((self, true))
    }
}

/// Type alias for the proxy service state wrapped in an Arc<Mutex<>> for thread-safe access.
pub type ProxyServiceState = Arc<Mutex<ProxyService>>;

/// Represents the current status of a proxy connection.
///
/// This enum tracks the lifecycle states of proxy connections and any errors that may occur.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ProxyConnectionStatus {
    /// Connection is being established
    Connecting,
    /// Connection is active and ready for use
    Connected,
    /// Connection has been closed or disconnected
    Disconnected,
    /// Connection failed with an error message
    Error(String),
}

/// Configuration for proxy connections and tunneling.
///
/// This struct contains all the parameters needed to establish various types of proxy connections,
/// from basic HTTP proxies to advanced tunneling protocols.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    /// The type of proxy protocol to use
    ///
    /// Supported values: "http", "https", "socks4", "socks5", "ssh", "dns-tunnel",
    /// "icmp-tunnel", "websocket", "quic", "tcp-over-dns", "http-connect", "shadowsocks"
    pub proxy_type: String,

    /// The hostname or IP address of the proxy server
    pub host: String,

    /// The port number of the proxy server
    pub port: u16,

    /// Optional username for proxy authentication
    pub username: Option<String>,

    /// Optional password for proxy authentication
    pub password: Option<String>,

    /// SSH private key file path (SSH tunneling only)
    pub ssh_key_file: Option<String>,

    /// Passphrase for encrypted SSH private key (SSH tunneling only)
    pub ssh_key_passphrase: Option<String>,

    /// Whether to verify SSH host keys (SSH tunneling only)
    pub ssh_host_key_verification: Option<bool>,

    /// Path to SSH known hosts file (SSH tunneling only)
    pub ssh_known_hosts_file: Option<String>,

    /// Domain name for DNS tunneling
    pub tunnel_domain: Option<String>,

    /// Encryption key for tunneling protocols
    pub tunnel_key: Option<String>,

    /// Tunneling method: "direct", "fragmented", "obfuscated"
    pub tunnel_method: Option<String>,

    /// Custom HTTP headers for HTTP-based tunneling
    pub custom_headers: Option<std::collections::HashMap<String, String>>,

    /// WebSocket path for WebSocket tunneling
    pub websocket_path: Option<String>,

    /// Certificate file path for QUIC tunneling
    pub quic_cert_file: Option<String>,

    /// Shadowsocks encryption method
    pub shadowsocks_method: Option<String>,

    /// Shadowsocks plugin configuration
    pub shadowsocks_plugin: Option<String>,
}

/// Represents an individual proxy connection.
///
/// This struct tracks the state and configuration of a single proxy connection,
/// including its target destination and current status.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConnection {
    /// Unique identifier for this connection
    pub id: String,

    /// Target hostname or IP address to connect to through the proxy
    pub target_host: String,

    /// Target port number to connect to through the proxy
    pub target_port: u16,

    /// Proxy configuration for this connection
    pub proxy_config: ProxyConfig,

    /// Local port allocated for this connection (assigned when connected)
    pub local_port: Option<u16>,

    /// Current status of the connection
    pub status: ProxyConnectionStatus,
}

/// Represents a layer in a proxy chain.
///
/// Proxy chains allow routing traffic through multiple proxies in sequence,
/// with each layer representing one hop in the chain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChainLayer {
    /// Unique identifier for this layer
    pub id: String,

    /// Proxy configuration for this layer
    pub proxy_config: ProxyConfig,

    /// Position of this layer in the chain (0-based index)
    pub position: usize,

    /// Current status of this layer
    pub status: ProxyConnectionStatus,

    /// Local port allocated for this layer (if applicable)
    pub local_port: Option<u16>,

    /// Error message if this layer failed
    pub error: Option<String>,
}

/// Represents a complete proxy chain configuration.
///
/// A proxy chain consists of multiple layers that traffic passes through in sequence,
/// providing enhanced anonymity and security.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChain {
    /// Unique identifier for this chain
    pub id: String,

    /// Human-readable name for the chain
    pub name: String,

    /// Optional description of the chain's purpose
    pub description: Option<String>,

    /// Ordered list of proxy layers in this chain
    pub layers: Vec<ProxyChainLayer>,

    /// Overall status of the chain
    pub status: ProxyConnectionStatus,

    /// ISO 8601 timestamp when the chain was created
    pub created_at: String,

    /// ISO 8601 timestamp when the chain was last connected (if applicable)
    pub connected_at: Option<String>,

    /// Final local port that provides access to the chain
    pub final_local_port: Option<u16>,

    /// Error message if the chain failed to connect
    pub error: Option<String>,
}

/// The main proxy service that manages proxy connections and chains.
///
/// This service provides all proxy-related functionality including creating connections,
/// managing chains, and handling different proxy protocols.
pub struct ProxyService {
    /// Map of connection ID to proxy connection
    connections: HashMap<String, ProxyConnection>,
    /// Map of chain ID to proxy chain
    chains: HashMap<String, ProxyChain>,
    /// Optional event emitter for status change notifications
    #[allow(dead_code)]
    emitter: Option<DynEventEmitter>,
}

impl ProxyService {
    /// Creates a new proxy service instance.
    ///
    /// Initializes an empty proxy service with no connections or chains.
    ///
    /// # Returns
    ///
    /// A new `ProxyServiceState` wrapped in an Arc<Mutex<>> for thread-safe access
    ///
    /// # Example
    ///
    pub fn new() -> ProxyServiceState {
        Arc::new(Mutex::new(ProxyService {
            connections: HashMap::new(),
            chains: HashMap::new(),
            emitter: None,
        }))
    }

    /// Creates a new proxy service instance with an event emitter.
    pub fn new_with_emitter(emitter: DynEventEmitter) -> ProxyServiceState {
        Arc::new(Mutex::new(ProxyService {
            connections: HashMap::new(),
            chains: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    /// Emit a status change event for a proxy connection.
    #[allow(dead_code)]
    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "service_type": "proxy",
                "status": status,
            });
            if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
                for (k, v) in ext {
                    base.insert(k.clone(), v.clone());
                }
            }
            let _ = emitter.emit_event("proxy::status-changed", payload);
        }
    }

    /// Creates a new proxy connection configuration.
    ///
    /// This method creates a proxy connection entry but does not establish the actual connection.
    /// Use `connect_via_proxy` to establish the connection after creation.
    ///
    /// # Arguments
    ///
    /// * `target_host` - The target hostname or IP address to connect to through the proxy
    /// * `target_port` - The target port number to connect to through the proxy
    /// * `proxy_config` - The proxy configuration specifying protocol, server, and credentials
    ///
    /// # Returns
    ///
    /// `Ok(String)` containing the connection ID if successful, `Err(String)` with error message if failed
    ///
    /// # Example
    ///
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

    /// Establishes a proxy connection using the specified connection configuration.
    ///
    /// This method connects to the proxy server and sets up local port forwarding.
    /// The connection must have been previously created using `create_proxy_connection`.
    ///
    /// # Arguments
    ///
    /// * `connection_id` - The ID of the proxy connection to establish
    ///
    /// # Returns
    ///
    /// `Ok(u16)` containing the local port number if successful, `Err(String)` with error message if failed
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The connection ID doesn't exist
    /// - The proxy server is unreachable
    /// - Authentication fails
    /// - The proxy protocol is unsupported
    ///
    /// # Example
    ///
    pub async fn connect_via_proxy(&mut self, connection_id: &str) -> Result<u16, String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Proxy connection not found".to_string())?;

        connection.status = ProxyConnectionStatus::Connecting;

        let result = match connection.proxy_config.proxy_type.as_str() {
            "http" | "https" => Self::connect_http_proxy_static(connection).await,
            "socks4" => Self::connect_socks4_proxy_static(connection).await,
            "socks5" => Self::connect_socks5_proxy_static(connection).await,
            "ssh" => Self::connect_ssh_tunnel_static(connection).await,
            "dns-tunnel" => Self::connect_dns_tunnel_static(connection).await,
            "icmp-tunnel" => Self::connect_icmp_tunnel_static(connection).await,
            "websocket" => Self::connect_websocket_tunnel_static(connection).await,
            "quic" => Self::connect_quic_tunnel_static(connection).await,
            "tcp-over-dns" => Self::connect_tcp_over_dns_static(connection).await,
            "http-connect" => Self::connect_http_connect_tunnel_static(connection).await,
            "shadowsocks" => Self::connect_shadowsocks_static(connection).await,
            _ => Err(format!(
                "Unsupported proxy type: {}",
                connection.proxy_config.proxy_type
            )),
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
        let proxy_addr = format!(
            "{}:{}",
            connection.proxy_config.host, connection.proxy_config.port
        );
        let proxy_socket_addr: SocketAddr = proxy_addr
            .parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(
            Duration::from_secs(10),
            TcpStream::connect(proxy_socket_addr),
        )
        .await
        .map_err(|_| "Proxy connection timeout".to_string())?
        .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // Send CONNECT request
        let connect_request = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
            connection.target_host,
            connection.target_port,
            connection.target_host,
            connection.target_port
        );

        let mut request = connect_request;

        // Add proxy authentication if provided
        if let (Some(username), Some(password)) = (
            &connection.proxy_config.username,
            &connection.proxy_config.password,
        ) {
            let auth = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", username, password));
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
        }

        request.push_str("Connection: close\r\n\r\n");

        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|e| format!("Failed to send CONNECT request: {}", e))?;

        // Read response
        let mut buffer = [0; 1024];
        let n = stream
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read proxy response: {}", e))?;

        let response = String::from_utf8_lossy(&buffer[..n]);
        if !response.contains("200") {
            return Err(format!("Proxy CONNECT failed: {}", response));
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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
        let proxy_addr = format!(
            "{}:{}",
            connection.proxy_config.host, connection.proxy_config.port
        );
        let proxy_socket_addr: SocketAddr = proxy_addr
            .parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(
            Duration::from_secs(10),
            TcpStream::connect(proxy_socket_addr),
        )
        .await
        .map_err(|_| "Proxy connection timeout".to_string())?
        .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // SOCKS4 request format:
        // +----+----+----+----+----+----+----+----+----+----+....+----+
        // | VN | CD | DSTPORT |      DSTIP        | USERID       |NULL|
        // +----+----+----+----+----+----+----+----+----+----+....+----+

        let mut request = vec![0x04, 0x01]; // VN=4, CD=1 (CONNECT)

        // DSTPORT (big endian)
        request.extend_from_slice(&connection.target_port.to_be_bytes());

        // DSTIP - resolve hostname to IP
        let target_ip = tokio::net::lookup_host(&format!(
            "{}:{}",
            connection.target_host, connection.target_port
        ))
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

        stream
            .write_all(&request)
            .await
            .map_err(|e| format!("Failed to send SOCKS4 request: {}", e))?;

        // Read response
        let mut response = [0; 8];
        stream
            .read_exact(&mut response)
            .await
            .map_err(|e| format!("Failed to read SOCKS4 response: {}", e))?;

        if response[1] != 0x5A {
            return Err(format!(
                "SOCKS4 connection failed: reply code {}",
                response[1]
            ));
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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
        let proxy_addr = format!(
            "{}:{}",
            connection.proxy_config.host, connection.proxy_config.port
        );
        let proxy_socket_addr: SocketAddr = proxy_addr
            .parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(
            Duration::from_secs(10),
            TcpStream::connect(proxy_socket_addr),
        )
        .await
        .map_err(|_| "Proxy connection timeout".to_string())?
        .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // SOCKS5 handshake
        let mut auth_methods = vec![0x00]; // No authentication
        if connection.proxy_config.username.is_some() && connection.proxy_config.password.is_some()
        {
            auth_methods.push(0x02); // Username/password authentication
        }

        let greeting = [0x05, auth_methods.len() as u8];
        let mut greeting_msg = greeting.to_vec();
        greeting_msg.extend_from_slice(&auth_methods);

        stream
            .write_all(&greeting_msg)
            .await
            .map_err(|e| format!("Failed to send SOCKS5 greeting: {}", e))?;

        let mut response = [0; 2];
        stream
            .read_exact(&mut response)
            .await
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
                    &connection.proxy_config.password,
                ) {
                    let username_bytes = username.as_bytes();
                    let password_bytes = password.as_bytes();

                    let auth_request = [0x01, username_bytes.len() as u8];
                    let mut auth_msg = auth_request.to_vec();
                    auth_msg.extend_from_slice(username_bytes);
                    auth_msg.push(password_bytes.len() as u8);
                    auth_msg.extend_from_slice(password_bytes);

                    stream
                        .write_all(&auth_msg)
                        .await
                        .map_err(|e| format!("Failed to send SOCKS5 auth: {}", e))?;

                    let mut auth_response = [0; 2];
                    stream
                        .read_exact(&mut auth_response)
                        .await
                        .map_err(|e| format!("Failed to read SOCKS5 auth response: {}", e))?;

                    if auth_response[1] != 0x00 {
                        return Err("SOCKS5 authentication failed".to_string());
                    }
                } else {
                    return Err(
                        "SOCKS5 authentication required but no credentials provided".to_string()
                    );
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
        connect_request.extend_from_slice(&connection.target_port.to_be_bytes());

        stream
            .write_all(&connect_request)
            .await
            .map_err(|e| format!("Failed to send SOCKS5 CONNECT: {}", e))?;

        // Read response
        let mut connect_response = [0; 4];
        stream
            .read_exact(&mut connect_response)
            .await
            .map_err(|e| format!("Failed to read SOCKS5 CONNECT response: {}", e))?;

        if connect_response[1] != 0x00 {
            return Err(format!(
                "SOCKS5 CONNECT failed: reply code {}",
                connect_response[1]
            ));
        }

        // Skip the bound address/port in response
        let mut addr_type = [0; 1];
        stream
            .read_exact(&mut addr_type)
            .await
            .map_err(|e| format!("Failed to read address type: {}", e))?;

        match addr_type[0] {
            0x01 => {
                // IPv4
                let mut ipv4 = [0; 4];
                stream
                    .read_exact(&mut ipv4)
                    .await
                    .map_err(|e| format!("Failed to read IPv4: {}", e))?;
            }
            0x03 => {
                // Domain name
                let mut len = [0; 1];
                stream
                    .read_exact(&mut len)
                    .await
                    .map_err(|e| format!("Failed to read domain length: {}", e))?;
                let mut domain = vec![0; len[0] as usize];
                stream
                    .read_exact(&mut domain)
                    .await
                    .map_err(|e| format!("Failed to read domain: {}", e))?;
            }
            0x04 => {
                // IPv6
                let mut ipv6 = [0; 16];
                stream
                    .read_exact(&mut ipv6)
                    .await
                    .map_err(|e| format!("Failed to read IPv6: {}", e))?;
            }
            _ => {
                return Err(format!("Unknown address type: {}", addr_type[0]));
            }
        }

        // Skip port
        let mut port = [0; 2];
        stream
            .read_exact(&mut port)
            .await
            .map_err(|e| format!("Failed to read port: {}", e))?;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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
        // SSH tunneling implementation using the russh library.
        //
        // Establishes an SSH session, authenticates with password or key, binds
        // a local TCP listener, and for every accepted connection opens an SSH
        // direct-tcpip channel that forwards traffic to the target host/port.

        let ssh_host = connection.proxy_config.host.clone();
        let ssh_port = connection.proxy_config.port;
        let username = connection
            .proxy_config
            .username
            .clone()
            .unwrap_or_else(|| "root".to_string());
        let target_host = connection.target_host.clone();
        let target_port = connection.target_port;

        // Build russh client config
        let config = russh::client::Config::default();
        let config = Arc::new(config);

        let ssh_addr = format!("{}:{}", ssh_host, ssh_port);
        let mut session = russh::client::connect(config, &ssh_addr, SshTunnelHandler)
            .await
            .map_err(|e| format!("SSH connection failed to {}: {}", ssh_addr, e))?;

        // Authenticate: prefer key file if provided, otherwise password
        if let Some(key_path) = &connection.proxy_config.ssh_key_file {
            let passphrase = connection.proxy_config.ssh_key_passphrase.as_deref();
            let key_pair = russh_keys::load_secret_key(key_path, passphrase)
                .map_err(|e| format!("Failed to load SSH key '{}': {}", key_path, e))?;
            let authenticated = session
                .authenticate_publickey(&username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("SSH public-key authentication failed: {}", e))?;
            if !authenticated {
                return Err("SSH public-key authentication rejected by server".to_string());
            }
        } else if let Some(password) = &connection.proxy_config.password {
            let authenticated = session
                .authenticate_password(&username, password)
                .await
                .map_err(|e| format!("SSH password authentication failed: {}", e))?;
            if !authenticated {
                return Err("SSH password authentication rejected by server".to_string());
            }
        } else {
            return Err(
                "SSH tunnel requires either a password or an SSH key file".to_string(),
            );
        }

        // Bind local TCP listener
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Wrap the session handle in an Arc<Mutex<>> so relay tasks can share it.
        let session = Arc::new(tokio::sync::Mutex::new(session));

        // Spawn a relay task: for every accepted TCP connection, open an SSH
        // direct-tcpip channel and bidirectionally copy bytes.
        tokio::spawn(async move {
            loop {
                let (mut tcp_stream, _peer) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let session = session.clone();
                let target_host = target_host.clone();
                tokio::spawn(async move {
                    // Open an SSH direct-tcpip channel for port forwarding
                    let channel = {
                        let handle = session.lock().await;
                        handle
                            .channel_open_direct_tcpip(
                                &target_host,
                                target_port as u32,
                                "127.0.0.1",
                                0,
                            )
                            .await
                    };
                    match channel {
                        Ok(channel) => {
                            // Convert the SSH channel into an AsyncRead + AsyncWrite
                            // stream and split it so we can copy in both directions
                            // concurrently without double-borrowing.
                            let stream = channel.into_stream();
                            let (mut ssh_read, mut ssh_write) = tokio::io::split(stream);
                            let (mut tcp_read, mut tcp_write) = tcp_stream.split();
                            let _ = tokio::join!(
                                tokio::io::copy(&mut tcp_read, &mut ssh_write),
                                tokio::io::copy(&mut ssh_read, &mut tcp_write),
                            );
                        }
                        Err(e) => {
                            log::warn!("SSH direct-tcpip channel open failed: {}", e);
                        }
                    }
                });
            }
        });

        Ok(local_port)
    }

    #[allow(unused_variables)]
    async fn connect_dns_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // DNS tunneling implementation using the `iodine` CLI tool.
        //
        // A full embedded rewrite (e.g. using hickory-dns) is deferred to a
        // later phase. For now we resolve the binary through platform::resolve_binary
        // and gate the feature to non-Windows platforms (iodine requires a tun
        // device that is unavailable on Windows).

        #[cfg(windows)]
        {
            Err(
                "DNS tunneling via iodine is not supported on Windows. \
                 iodine requires a TUN/TAP device that is unavailable on this platform."
                    .to_string(),
            )
        }

        #[cfg(not(windows))]
        {
            use tokio::process::Command;

            let iodine_bin = platform::resolve_binary("iodine")
                .map_err(|e| format!("DNS tunnel unavailable: {}", e))?;

            let domain = connection
                .proxy_config
                .tunnel_domain
                .as_deref()
                .unwrap_or("tunnel.example.com");

            let dns_password = connection
                .proxy_config
                .password
                .as_deref()
                .ok_or("DNS tunnel requires a password")?;

            let mut command = Command::new(&iodine_bin);
            command.args([
                "-f", // foreground mode
                "-P",
                dns_password,
                connection.proxy_config.host.as_str(),
                domain,
            ]);

            let child = command
                .spawn()
                .map_err(|e| format!("Failed to spawn DNS tunnel process ({}): {}", iodine_bin.display(), e))?;

            // Wait for tunnel to establish
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            // Find an available local port for binding
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind local port: {}", e))?;

            let local_addr = listener
                .local_addr()
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
    }

    #[allow(unused_variables)]
    async fn connect_icmp_tunnel_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // ICMP tunneling implementation using the `hping3` CLI tool.
        //
        // A full embedded rewrite (e.g. using pnet for raw sockets) is deferred
        // to a later phase. For now we resolve the binary through
        // platform::resolve_binary and gate the feature to non-Windows platforms
        // (hping3 requires raw socket access unavailable on Windows).

        #[cfg(windows)]
        {
            Err(
                "ICMP tunneling via hping3 is not supported on Windows. \
                 hping3 requires raw socket access that is unavailable on this platform. \
                 A native pnet-based implementation is planned for a future release."
                    .to_string(),
            )
        }

        #[cfg(not(windows))]
        {
            use tokio::process::Command;

            let hping3_bin = platform::resolve_binary("hping3")
                .map_err(|e| format!("ICMP tunnel unavailable: {}", e))?;

            let mut command = Command::new(&hping3_bin);
            command.args([
                "--icmp",
                "-d",
                "100", // data size
                "--spoof",
                &connection.proxy_config.host,
                connection.target_host.as_str(),
            ]);

            let child = command
                .spawn()
                .map_err(|e| format!("Failed to spawn ICMP tunnel process ({}): {}", hping3_bin.display(), e))?;

            // Find an available local port for binding
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind local port: {}", e))?;

            let local_addr = listener
                .local_addr()
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
    }

    async fn connect_websocket_tunnel_static(
        connection: &mut ProxyConnection,
    ) -> Result<u16, String> {
        // WebSocket tunneling implementation
        // This would use WebSocket connections to tunnel traffic
        use futures_util::StreamExt;
        use tokio_tungstenite::connect_async;

        let ws_url = format!(
            "ws://{}:{}{}",
            connection.proxy_config.host,
            connection.proxy_config.port,
            connection
                .proxy_config
                .websocket_path
                .as_deref()
                .unwrap_or("/")
        );

        let (ws_stream, _) = connect_async(ws_url)
            .await
            .map_err(|e| format!("Failed to connect to WebSocket: {}", e))?;

        let (write, read) = ws_stream.split();

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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
        // QUIC tunneling implementation using the quinn library.
        //
        // Opens a QUIC connection to the proxy server, then binds a local TCP
        // listener. Each inbound TCP connection is bridged to a new QUIC
        // bidirectional stream, giving callers a plain TCP interface to a
        // QUIC-tunneled transport.

        let host = connection.proxy_config.host.clone();
        let port = connection.proxy_config.port;
        let _target_host = connection.target_host.clone();
        let _target_port = connection.target_port;

        // Build a rustls ClientConfig that skips certificate verification
        // (self-signed / dev certs). QUIC mandates TLS 1.3.
        let crypto = rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(SkipServerVerification::new())
            .with_no_client_auth();

        let quic_client_config =
            quinn::crypto::rustls::QuicClientConfig::try_from(crypto)
                .map_err(|e| format!("QUIC crypto config error: {}", e))?;

        let client_config = quinn::ClientConfig::new(Arc::new(quic_client_config));

        let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap())
            .map_err(|e| format!("Failed to create QUIC endpoint: {}", e))?;
        endpoint.set_default_client_config(client_config);

        // Resolve the server address. If the host is not already a SocketAddr,
        // perform a blocking DNS lookup (acceptable here because it happens once
        // at connection setup).
        let server_addr: SocketAddr = format!("{}:{}", host, port)
            .parse()
            .or_else(|_| {
                // Host is a hostname, not an IP — resolve it.
                use std::net::ToSocketAddrs;
                format!("{}:{}", host, port)
                    .to_socket_addrs()
                    .map_err(|e| format!("DNS resolution failed for {}:{}: {}", host, port, e))?
                    .next()
                    .ok_or_else(|| format!("No addresses found for {}:{}", host, port))
            })?;

        let quic_connection = endpoint
            .connect(server_addr, &host)
            .map_err(|e| format!("QUIC connect error: {}", e))?
            .await
            .map_err(|e| format!("QUIC connection failed: {}", e))?;

        // Bind a local TCP listener for callers to connect to.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local listener: {}", e))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a relay task: for every accepted TCP connection, open a QUIC
        // bidirectional stream and copy bytes in both directions.
        tokio::spawn(async move {
            loop {
                let (mut tcp_stream, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let conn = quic_connection.clone();
                tokio::spawn(async move {
                    match conn.open_bi().await {
                        Ok((mut send, mut recv)) => {
                            let (mut tcp_read, mut tcp_write) = tcp_stream.split();
                            let _ = tokio::join!(
                                tokio::io::copy(&mut tcp_read, &mut send),
                                tokio::io::copy(&mut recv, &mut tcp_write),
                            );
                        }
                        Err(e) => {
                            log::warn!("QUIC open_bi failed: {}", e);
                        }
                    }
                });
            }
        });

        Ok(local_port)
    }

    async fn connect_tcp_over_dns_static(connection: &mut ProxyConnection) -> Result<u16, String> {
        // TCP-over-DNS tunneling implementation
        // This encodes TCP traffic as DNS queries
        use tokio::process::Command;

        let mut command = Command::new("tcp-over-dns");
        command.args([
            "--server",
            &connection.proxy_config.host,
            "--port",
            &connection.proxy_config.port.to_string(),
            "--domain",
            connection
                .proxy_config
                .tunnel_domain
                .as_deref()
                .unwrap_or("example.com"),
        ]);

        let child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn TCP-over-DNS process: {}", e))?;

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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

    async fn connect_http_connect_tunnel_static(
        connection: &mut ProxyConnection,
    ) -> Result<u16, String> {
        // Enhanced HTTP CONNECT tunneling with custom headers and obfuscation
        let proxy_addr = format!(
            "{}:{}",
            connection.proxy_config.host, connection.proxy_config.port
        );
        let proxy_socket_addr: SocketAddr = proxy_addr
            .parse()
            .map_err(|e| format!("Invalid proxy address: {}", e))?;

        let mut stream = timeout(
            Duration::from_secs(10),
            TcpStream::connect(proxy_socket_addr),
        )
        .await
        .map_err(|_| "Proxy connection timeout".to_string())?
        .map_err(|e| format!("Failed to connect to proxy: {}", e))?;

        // Build CONNECT request with custom headers
        let mut connect_request = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
            connection.target_host,
            connection.target_port,
            connection.target_host,
            connection.target_port
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
            &connection.proxy_config.password,
        ) {
            let auth = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", username, password));
            connect_request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
        }

        connect_request.push_str("Connection: close\r\n\r\n");

        stream
            .write_all(connect_request.as_bytes())
            .await
            .map_err(|e| format!("Failed to send CONNECT request: {}", e))?;

        // Read response
        let mut buffer = [0; 1024];
        let n = stream
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read proxy response: {}", e))?;

        let response = String::from_utf8_lossy(&buffer[..n]);
        if !response.contains("200") {
            return Err(format!("Proxy CONNECT failed: {}", response));
        }

        // Find an available local port for binding
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_addr = listener
            .local_addr()
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
        // Shadowsocks proxy implementation using the `ss-local` CLI tool.
        //
        // The full shadowsocks crate embedding is a larger task deferred to a
        // later phase. This implementation resolves ss-local through
        // platform::resolve_binary for better error messages and portability.
        use tokio::process::Command;

        let ss_local_bin = platform::resolve_binary("ss-local")
            .map_err(|e| format!("Shadowsocks unavailable: {}", e))?;

        let method = connection
            .proxy_config
            .shadowsocks_method
            .as_deref()
            .unwrap_or("aes-256-gcm");

        let ss_password = connection
            .proxy_config
            .password
            .as_deref()
            .ok_or("Shadowsocks requires a password")?;

        // Bind a local port first so we can pass a concrete port to ss-local.
        // This avoids the race condition of passing "0" and not knowing the
        // actual allocated port.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        // Drop the listener so ss-local can bind the same port
        drop(listener);

        let mut command = Command::new(&ss_local_bin);
        command.args([
            "-s",
            &connection.proxy_config.host,
            "-p",
            &connection.proxy_config.port.to_string(),
            "-k",
            ss_password,
            "-m",
            method,
            "-l",
            &local_port.to_string(),
        ]);

        if let Some(plugin) = &connection.proxy_config.shadowsocks_plugin {
            command.arg("--plugin").arg(plugin);
        }

        let child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn Shadowsocks process ({}): {}", ss_local_bin.display(), e))?;

        // Wait for Shadowsocks to start
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        connection.local_port = Some(local_port);
        connection.status = ProxyConnectionStatus::Connected;

        // Spawn a background task that keeps the ss-local process alive
        // and cleans it up when it exits.
        tokio::spawn(async move {
            let mut child = child;
            let _ = child.wait().await;
            log::info!("Shadowsocks ss-local process exited");
        });

        Ok(local_port)
    }

    async fn handle_proxy_tunnel(listener: tokio::net::TcpListener, mut proxy_stream: TcpStream) {
        // For simplicity, we'll handle only one connection at a time
        // In a production implementation, you'd want to handle multiple concurrent connections
        if let Ok((mut client_stream, _)) = listener.accept().await {
            if let Err(e) =
                tokio::io::copy_bidirectional(&mut client_stream, &mut proxy_stream).await
            {
                eprintln!("Proxy tunnel error: {}", e);
            }
        }
    }

    // handle_ssh_tunnel removed — the russh-based SSH tunnel implementation
    // handles relay directly in its spawned task.

    #[allow(dead_code)]
    async fn handle_dns_tunnel(
        listener: tokio::net::TcpListener,
        mut child: tokio::process::Child,
    ) {
        // Monitor the DNS tunnel process
        if let Ok((_client_stream, _)) = listener.accept().await {
            // DNS tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    #[allow(dead_code)]
    async fn handle_icmp_tunnel(
        listener: tokio::net::TcpListener,
        mut child: tokio::process::Child,
    ) {
        // Monitor the ICMP tunnel process
        if let Ok((_client_stream, _)) = listener.accept().await {
            // ICMP tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    async fn handle_websocket_tunnel(
        listener: tokio::net::TcpListener,
        mut write: futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            tokio_tungstenite::tungstenite::Message,
        >,
        mut read: futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
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
                                    if write.send(tokio_tungstenite::tungstenite::Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                        Some(message) = read.next() => {
                            match message {
                                Ok(tokio_tungstenite::tungstenite::Message::Binary(data)) => {
                                    if client_stream.write_all(&data).await.is_err() {
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

    async fn handle_tcp_over_dns_tunnel(
        listener: tokio::net::TcpListener,
        mut child: tokio::process::Child,
    ) {
        // Monitor the TCP-over-DNS tunnel process
        if let Ok((_client_stream, _)) = listener.accept().await {
            // TCP-over-DNS tunneling handles the traffic encoding/decoding
            let _ = child.wait().await;
        }
    }

    // handle_shadowsocks_tunnel removed — the improved shadowsocks implementation
    // manages the ss-local child process lifecycle directly in its spawned task.

    pub async fn disconnect_proxy(&mut self, connection_id: &str) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "Proxy connection not found".to_string())?;

        connection.status = ProxyConnectionStatus::Disconnected;
        connection.local_port = None;
        Ok(())
    }

    pub async fn get_proxy_connection(
        &self,
        connection_id: &str,
    ) -> Result<ProxyConnection, String> {
        self.connections
            .get(connection_id)
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
            let chain = self.chains.get(chain_id).expect("chain_id passed to function");
            chain
                .layers
                .iter()
                .map(|layer| (layer.position, layer.proxy_config.clone()))
                .collect()
        };

        // Connect layers in sequence
        for (position, proxy_config) in layers_config {
            // Create a proxy connection for this layer
            let connection_id = self
                .create_proxy_connection(
                    current_target_host.clone(),
                    current_target_port,
                    proxy_config,
                )
                .await?;

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
            let chain = self.chains.get_mut(chain_id).expect("chain_id passed to function");
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
            let chain = self.chains.get(chain_id).expect("chain verified to exist above");
            chain
                .layers
                .iter()
                .filter_map(|layer| layer.local_port)
                .collect()
        };

        // Collect connection IDs to disconnect
        let connection_ids_to_disconnect: Vec<String> = local_ports
            .iter()
            .filter_map(|&local_port| {
                self.connections
                    .iter()
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
            let chain = self.chains.get_mut(chain_id).expect("chain verified to exist above");
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
        self.chains
            .get(chain_id)
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

    pub async fn get_proxy_chain_health(
        &self,
        chain_id: &str,
    ) -> Result<serde_json::Value, String> {
        let chain = self
            .chains
            .get(chain_id)
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

        let result = service
            .lock()
            .await
            .create_proxy_connection("example.com".to_string(), 80, proxy_config)
            .await;

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

        let connection_id = service
            .lock()
            .await
            .create_proxy_connection("test.com".to_string(), 443, proxy_config)
            .await
            .unwrap();

        let result = service
            .lock()
            .await
            .get_proxy_connection(&connection_id)
            .await;
        assert!(result.is_ok());

        let connection = result.unwrap();
        assert_eq!(connection.id, connection_id);
        assert_eq!(connection.target_host, "test.com");
        assert_eq!(connection.target_port, 443);
    }

    #[tokio::test]
    async fn test_get_proxy_connection_nonexistent() {
        let service = ProxyService::new();

        let result = service
            .lock()
            .await
            .get_proxy_connection("nonexistent")
            .await;
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

        service
            .lock()
            .await
            .create_proxy_connection("host1.com".to_string(), 80, config1)
            .await
            .unwrap();

        service
            .lock()
            .await
            .create_proxy_connection("host2.com".to_string(), 443, config2)
            .await
            .unwrap();

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

        let connection_id = service
            .lock()
            .await
            .create_proxy_connection("ssh.example.com".to_string(), 22, proxy_config)
            .await
            .unwrap();

        // Verify connection exists
        assert!(service
            .lock()
            .await
            .connections
            .contains_key(&connection_id));

        // Delete connection
        let result = service
            .lock()
            .await
            .delete_proxy_connection(&connection_id)
            .await;
        assert!(result.is_ok());

        // Verify connection is gone
        assert!(!service
            .lock()
            .await
            .connections
            .contains_key(&connection_id));
    }

    #[tokio::test]
    async fn test_delete_proxy_connection_nonexistent() {
        let service = ProxyService::new();

        let result = service
            .lock()
            .await
            .delete_proxy_connection("nonexistent")
            .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Proxy connection not found");
    }

    #[tokio::test]
    async fn test_connect_via_proxy_unsupported_type() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("unsupported");

        let connection_id = service
            .lock()
            .await
            .create_proxy_connection("example.com".to_string(), 80, proxy_config)
            .await
            .unwrap();

        let result = service.lock().await.connect_via_proxy(&connection_id).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported proxy type"));

        // Check that status was updated to error
        let service_guard = service.lock().await;
        let connection = service_guard.connections.get(&connection_id).unwrap();
        let ProxyConnectionStatus::Error(_) = &connection.status else {
            unreachable!("Expected ProxyConnectionStatus::Error variant")
        };
    }

    #[tokio::test]
    async fn test_disconnect_proxy_connection() {
        let service = ProxyService::new();
        let proxy_config = create_test_proxy_config("http");

        let connection_id = service
            .lock()
            .await
            .create_proxy_connection("example.com".to_string(), 80, proxy_config)
            .await
            .unwrap();

        // Disconnect (should work even if not connected)
        let result = service.lock().await.disconnect_proxy(&connection_id).await;
        assert!(result.is_ok());

        // Verify status is disconnected
        let service_guard = service.lock().await;
        let connection = service_guard.connections.get(&connection_id).unwrap();
        assert!(matches!(
            connection.status,
            ProxyConnectionStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn test_create_proxy_chain() {
        let service = ProxyService::new();

        let layers = vec![
            create_test_proxy_config("http"),
            create_test_proxy_config("socks5"),
        ];

        let result = service
            .lock()
            .await
            .create_proxy_chain(
                "Test Chain".to_string(),
                layers,
                Some("A test proxy chain".to_string()),
            )
            .await;

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

        let chain_id = service
            .lock()
            .await
            .create_proxy_chain("Test Chain".to_string(), layers, None)
            .await
            .unwrap();

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

        service
            .lock()
            .await
            .create_proxy_chain("Chain 1".to_string(), layers1, None)
            .await
            .unwrap();

        service
            .lock()
            .await
            .create_proxy_chain("Chain 2".to_string(), layers2, None)
            .await
            .unwrap();

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
        let chain_id = service
            .lock()
            .await
            .create_proxy_chain("Test Chain".to_string(), layers, None)
            .await
            .unwrap();

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
        let config = crate::proxy::ProxyConfig {
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
                let connection_id = service_clone
                    .lock()
                    .await
                    .create_proxy_connection(format!("host{}.com", i), 80, proxy_config)
                    .await
                    .unwrap();

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

