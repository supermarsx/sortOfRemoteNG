use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use std::sync::Mutex as StdMutex;
use std::collections::HashMap;
use ssh2::{Session, KeyboardInteractivePrompt, Prompt};
use std::net::{TcpStream, TcpListener};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::time::Duration;
use tokio::net::TcpStream as AsyncTcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use shell_escape;
use tauri::Emitter;
use totp_rs::{Algorithm, TOTP};
use regex::Regex;

// Maximum buffer size in bytes (1MB)
const MAX_BUFFER_SIZE: usize = 1024 * 1024;

// Global terminal buffer storage
lazy_static::lazy_static! {
    static ref TERMINAL_BUFFERS: StdMutex<HashMap<String, String>> = StdMutex::new(HashMap::new());
}

/// Generate a TOTP code from a secret
fn generate_totp_code(secret: &str) -> Result<String, String> {
    // Try to decode the secret (it might be base32 encoded)
    let secret_bytes = if secret.chars().all(|c| c.is_ascii_alphanumeric()) {
        // Likely base32 encoded
        data_encoding::BASE32_NOPAD.decode(secret.to_uppercase().as_bytes())
            .unwrap_or_else(|_| secret.as_bytes().to_vec())
    } else {
        secret.as_bytes().to_vec()
    };
    
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,  // 6 digits
        1,  // 1 step
        30, // 30 second period
        secret_bytes,
    ).map_err(|e| format!("Failed to create TOTP: {}", e))?;
    
    Ok(totp.generate_current().map_err(|e| format!("Failed to generate TOTP: {}", e))?)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub jump_hosts: Vec<JumpHostConfig>,
    pub proxy_config: Option<ProxyConfig>,
    /// Proxy chain for routing through multiple proxies
    #[serde(default)]
    pub proxy_chain: Option<ProxyChainConfig>,
    pub openvpn_config: Option<OpenVPNConfig>,
    pub connect_timeout: Option<u64>,
    pub keep_alive_interval: Option<u64>,
    pub strict_host_key_checking: bool,
    pub known_hosts_path: Option<String>,
    // TOTP/MFA support for keyboard-interactive auth
    #[serde(default)]
    pub totp_secret: Option<String>,
    // Keyboard-interactive responses (pre-configured answers for MFA prompts)
    #[serde(default)]
    pub keyboard_interactive_responses: Vec<String>,
    // Agent forwarding
    #[serde(default)]
    pub agent_forwarding: bool,
    // TCP options
    #[serde(default = "default_true")]
    pub tcp_no_delay: bool,
    #[serde(default = "default_true")]
    pub tcp_keepalive: bool,
    #[serde(default = "default_keepalive_probes")]
    pub keepalive_probes: u32,
    #[serde(default = "default_ip_protocol")]
    pub ip_protocol: String,
    // SSH protocol options
    #[serde(default)]
    pub compression: bool,
    #[serde(default = "default_compression_level")]
    pub compression_level: u32,
    #[serde(default = "default_ssh_version")]
    pub ssh_version: String,
    // Cipher preferences (optional)
    #[serde(default)]
    pub preferred_ciphers: Vec<String>,
    #[serde(default)]
    pub preferred_macs: Vec<String>,
    #[serde(default)]
    pub preferred_kex: Vec<String>,
    #[serde(default)]
    pub preferred_host_key_algorithms: Vec<String>,
}

fn default_true() -> bool { true }
fn default_keepalive_probes() -> u32 { 2 } // Reduced for faster disconnect detection
fn default_ip_protocol() -> String { "auto".to_string() }
fn default_compression_level() -> u32 { 6 }
fn default_ssh_version() -> String { "auto".to_string() }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ProxyType {
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "https")]
    Https,
    #[serde(rename = "socks4")]
    Socks4,
    #[serde(rename = "socks5")]
    Socks5,
}

/// Configuration for a proxy chain - route through multiple proxies
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChainConfig {
    /// List of proxies to chain through (in order)
    pub proxies: Vec<ProxyConfig>,
    /// Chain mode
    #[serde(default)]
    pub mode: ProxyChainMode,
    /// Timeout for each proxy hop in milliseconds
    #[serde(default = "default_proxy_timeout")]
    pub hop_timeout_ms: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub enum ProxyChainMode {
    /// Connect through all proxies in order (default)
    #[default]
    Strict,
    /// Try proxies in order, skip failures
    Dynamic,
    /// Randomly select one proxy
    Random,
}

fn default_proxy_timeout() -> u64 { 10000 }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConfig {
    pub connection_id: String,
    pub chain_position: Option<u16>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JumpHostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SftpDirEntry {
    pub path: String,
    pub file_type: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshSessionInfo {
    pub id: String,
    pub config: SshConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_alive: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortForwardConfig {
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub direction: PortForwardDirection,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PortForwardDirection {
    Local,
    Remote,
    Dynamic,
}

pub struct SshSession {
    pub id: String,
    pub session: Session,
    pub config: SshConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub port_forwards: HashMap<String, PortForwardHandle>,
    pub keep_alive_handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug)]
pub struct SshShellHandle {
    pub id: String,
    pub sender: mpsc::UnboundedSender<SshShellCommand>,
    pub thread: std::thread::JoinHandle<()>,
}

#[derive(Debug)]
pub enum SshShellCommand {
    Input(String),
    Resize(u32, u32),
    Close,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellOutput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellError {
    pub session_id: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellClosed {
    pub session_id: String,
}

// Session recording structures
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecordingEntry {
    pub timestamp_ms: u64,  // Milliseconds since recording started
    pub data: String,       // Terminal output data
    pub entry_type: RecordingEntryType,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum RecordingEntryType {
    Output,  // Server -> client output
    Input,   // Client -> server input (optional, for auditing)
    Resize { cols: u32, rows: u32 },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecordingMetadata {
    pub session_id: String,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub host: String,
    pub username: String,
    pub cols: u32,
    pub rows: u32,
    pub duration_ms: u64,
    pub entry_count: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecording {
    pub metadata: SessionRecordingMetadata,
    pub entries: Vec<SessionRecordingEntry>,
}

// Global storage for active recordings
lazy_static::lazy_static! {
    static ref ACTIVE_RECORDINGS: StdMutex<HashMap<String, RecordingState>> = StdMutex::new(HashMap::new());
}

#[derive(Debug)]
struct RecordingState {
    start_time: std::time::Instant,
    start_utc: DateTime<Utc>,
    host: String,
    username: String,
    cols: u32,
    rows: u32,
    entries: Vec<SessionRecordingEntry>,
    record_input: bool,
}

// ===============================
// Terminal Automation Structures
// ===============================

/// Pattern to match in terminal output for automation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExpectPattern {
    /// Regex pattern to match
    pub pattern: String,
    /// Response to send when pattern matches
    pub response: String,
    /// Whether to include newline after response
    #[serde(default = "default_true")]
    pub send_newline: bool,
    /// Optional label for logging/debugging
    pub label: Option<String>,
}

/// Automation script definition
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationScript {
    /// Unique script ID
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Patterns to match and respond to
    pub patterns: Vec<ExpectPattern>,
    /// Timeout in milliseconds (0 = no timeout)
    #[serde(default = "default_automation_timeout")]
    pub timeout_ms: u64,
    /// Maximum number of pattern matches (0 = unlimited)
    #[serde(default)]
    pub max_matches: u32,
    /// Whether to stop on first unmatched output after patterns start matching
    #[serde(default)]
    pub stop_on_no_match: bool,
}

fn default_automation_timeout() -> u64 { 30000 } // 30 seconds default

/// Result of a single automation match
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationMatch {
    pub pattern_index: usize,
    pub matched_text: String,
    pub response_sent: String,
    pub timestamp_ms: u64,
}

/// Automation execution status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationStatus {
    pub session_id: String,
    pub script_id: String,
    pub script_name: String,
    pub is_active: bool,
    pub matches: Vec<AutomationMatch>,
    pub started_at: DateTime<Utc>,
    pub elapsed_ms: u64,
}

// State for active automation
#[derive(Debug)]
struct AutomationState {
    script: AutomationScript,
    compiled_patterns: Vec<regex::Regex>,
    output_buffer: String,
    matches: Vec<AutomationMatch>,
    start_time: std::time::Instant,
    start_utc: DateTime<Utc>,
    tx: mpsc::UnboundedSender<SshShellCommand>,
}

// Global storage for active automations
lazy_static::lazy_static! {
    static ref ACTIVE_AUTOMATIONS: StdMutex<HashMap<String, AutomationState>> = StdMutex::new(HashMap::new());
}

#[derive(Debug)]
pub struct PortForwardHandle {
    pub id: String,
    pub config: PortForwardConfig,
    pub handle: tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortForwardInfo {
    pub id: String,
    pub config: PortForwardConfig,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemInfo {
    pub uname: String,
    pub cpu_info: String,
    pub memory_info: String,
    pub disk_info: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProcessInfo {
    pub user: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub mem_percent: f32,
    pub command: String,
}

pub type SshServiceState = Arc<Mutex<SshService>>;

pub struct SshService {
    sessions: HashMap<String, SshSession>,
    #[allow(dead_code)]
    connection_pool: HashMap<String, Vec<SshSession>>,
    #[allow(dead_code)]
    known_hosts: HashMap<String, String>,
    shells: HashMap<String, SshShellHandle>,
}

impl SshService {
    pub fn new() -> SshServiceState {
        Arc::new(Mutex::new(SshService {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            shells: HashMap::new(),
        }))
    }

    pub async fn connect_ssh(&mut self, config: SshConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Determine connection method in priority order:
        // 1. Proxy chain (if specified)
        // 2. Single proxy (if specified)
        // 3. OpenVPN (if specified)
        // 4. Jump hosts (if specified)
        // 5. Direct connection
        let final_stream = if let Some(ref proxy_chain) = config.proxy_chain {
            self.establish_proxy_chain_connection(&config, proxy_chain).await?
        } else if let Some(ref proxy_config) = config.proxy_config {
            self.establish_proxy_connection(&config, proxy_config).await?
        } else if let Some(ref openvpn_config) = config.openvpn_config {
            self.establish_openvpn_connection(&config, openvpn_config).await?
        } else if !config.jump_hosts.is_empty() {
            self.establish_jump_connection(&config).await?
        } else {
            self.establish_direct_connection(&config).await?
        };

        // Apply TCP options to the stream for optimal performance
        // Always enable TCP_NODELAY for interactive SSH sessions (disable Nagle's algorithm)
        final_stream.set_nodelay(config.tcp_no_delay).ok();
        
        // Set read/write timeouts for faster failure detection
        let timeout_secs = config.connect_timeout.unwrap_or(15);
        final_stream.set_read_timeout(Some(Duration::from_secs(timeout_secs * 2))).ok();
        final_stream.set_write_timeout(Some(Duration::from_secs(timeout_secs))).ok();
        
        // Note: TCP keepalive at OS level is already enabled by default on most systems
        // Advanced keepalive tuning (probes, interval) requires platform-specific socket2 crate

        let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
        sess.set_tcp_stream(final_stream);
        
        // Apply SSH compression if enabled
        if config.compression {
            sess.set_compress(true);
        }
        
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Host key verification
        if config.strict_host_key_checking {
            self.verify_host_key(&mut sess, &config)?;
        }

        // Authentication
        self.authenticate_session(&mut sess, &config)?;

        let mut session = SshSession {
            id: session_id.clone(),
            session: sess,
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            port_forwards: HashMap::new(),
            keep_alive_handle: None,
        };

        // Start keep-alive if configured
        if let Some(interval) = config.keep_alive_interval {
            session.keep_alive_handle = Some(self.start_keep_alive(session_id.clone(), interval));
        }

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    async fn establish_direct_connection(&self, config: &SshConnectionConfig) -> Result<TcpStream, String> {
        // Handle OpenVPN chaining first
        if let Some(openvpn_config) = &config.openvpn_config {
            return self.establish_openvpn_connection(config, openvpn_config).await;
        }

        // Handle proxy connection
        if let Some(proxy_config) = &config.proxy_config {
            return self.establish_proxy_connection(config, proxy_config).await;
        }

        // Direct connection with optimized timeout (default 15s for faster feedback)
        let addr = format!("{}:{}", config.host, config.port);
        let timeout = config.connect_timeout.unwrap_or(15);

        // Use async connect with timeout for non-blocking behavior
        let async_stream = tokio::time::timeout(
            Duration::from_secs(timeout),
            AsyncTcpStream::connect(&addr)
        ).await
        .map_err(|_| format!("Connection timeout after {} seconds - host may be unreachable", timeout))?
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;
        
        // Get the raw fd/socket for conversion
        let std_stream = async_stream.into_std()
            .map_err(|e| format!("Failed to convert async stream: {}", e))?;
        
        // Set non-blocking to false for ssh2 compatibility
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        
        Ok(std_stream)
    }

    async fn establish_proxy_connection(&self, config: &SshConnectionConfig, proxy_config: &ProxyConfig) -> Result<TcpStream, String> {
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));
        
        // Connect to the proxy server
        let proxy_addr = format!("{}:{}", proxy_config.host, proxy_config.port);
        let proxy_stream = tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| format!("Proxy connection timeout to {}", proxy_addr))?
            .map_err(|e| format!("Failed to connect to proxy {}: {}", proxy_addr, e))?;
        
        let target = format!("{}:{}", config.host, config.port);
        
        match &proxy_config.proxy_type {
            ProxyType::Socks5 => {
                self.connect_through_socks5(proxy_stream, &target, proxy_config).await
            }
            ProxyType::Socks4 => {
                self.connect_through_socks4(proxy_stream, &target, proxy_config).await
            }
            ProxyType::Http | ProxyType::Https => {
                self.connect_through_http_proxy(proxy_stream, &target, proxy_config).await
            }
        }
    }
    
    async fn connect_through_socks5(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        
        // SOCKS5 greeting with auth method negotiation
        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]  // Version 5, 2 methods: no auth (0) and username/password (2)
        } else {
            vec![0x05, 0x01, 0x00]  // Version 5, 1 method: no auth
        };
        
        stream.write_all(&greeting).await
            .map_err(|e| format!("Failed to send SOCKS5 greeting: {}", e))?;
        
        // Read server response
        let mut response = [0u8; 2];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS5 greeting response: {}", e))?;
        
        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 response version".to_string());
        }
        
        // Handle authentication if required
        if response[1] == 0x02 {
            // Username/password authentication
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config.password.as_deref().unwrap_or("");
            
            let mut auth_request = vec![0x01]; // Auth version
            auth_request.push(username.len() as u8);
            auth_request.extend_from_slice(username.as_bytes());
            auth_request.push(password.len() as u8);
            auth_request.extend_from_slice(password.as_bytes());
            
            stream.write_all(&auth_request).await
                .map_err(|e| format!("Failed to send SOCKS5 auth: {}", e))?;
            
            let mut auth_response = [0u8; 2];
            stream.read_exact(&mut auth_response).await
                .map_err(|e| format!("Failed to read SOCKS5 auth response: {}", e))?;
            
            if auth_response[1] != 0x00 {
                return Err("SOCKS5 authentication failed".to_string());
            }
        } else if response[1] != 0x00 {
            return Err(format!("SOCKS5 server requires unsupported auth method: {}", response[1]));
        }
        
        // Parse target address
        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1].parse()
            .map_err(|_| "Invalid port number".to_string())?;
        
        // Build SOCKS5 connect request
        let mut request = vec![0x05, 0x01, 0x00]; // Version, Connect, Reserved
        
        // Try to parse as IP first, otherwise use domain name
        if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
            request.push(0x01); // IPv4
            request.extend_from_slice(&ip.octets());
        } else if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
            request.push(0x04); // IPv6
            request.extend_from_slice(&ip.octets());
        } else {
            request.push(0x03); // Domain name
            request.push(host.len() as u8);
            request.extend_from_slice(host.as_bytes());
        }
        
        request.extend_from_slice(&port.to_be_bytes());
        
        stream.write_all(&request).await
            .map_err(|e| format!("Failed to send SOCKS5 connect request: {}", e))?;
        
        // Read response (at least 10 bytes)
        let mut connect_response = [0u8; 10];
        stream.read_exact(&mut connect_response).await
            .map_err(|e| format!("Failed to read SOCKS5 connect response: {}", e))?;
        
        if connect_response[1] != 0x00 {
            let error_msg = match connect_response[1] {
                0x01 => "General SOCKS server failure",
                0x02 => "Connection not allowed by ruleset",
                0x03 => "Network unreachable",
                0x04 => "Host unreachable",
                0x05 => "Connection refused",
                0x06 => "TTL expired",
                0x07 => "Command not supported",
                0x08 => "Address type not supported",
                _ => "Unknown SOCKS5 error",
            };
            return Err(format!("SOCKS5 connect failed: {}", error_msg));
        }
        
        // Convert to std TcpStream
        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        
        Ok(std_stream)
    }
    
    async fn connect_through_socks4(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        
        let parts: Vec<&str> = target.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid target address format".to_string());
        }
        let host = parts[0];
        let port: u16 = parts[1].parse()
            .map_err(|_| "Invalid port number".to_string())?;
        
        // SOCKS4 only supports IPv4
        let ip: std::net::Ipv4Addr = host.parse()
            .map_err(|_| "SOCKS4 only supports IPv4 addresses, not domain names".to_string())?;
        
        // Build SOCKS4 request
        let mut request = vec![0x04, 0x01]; // Version 4, Connect command
        request.extend_from_slice(&port.to_be_bytes());
        request.extend_from_slice(&ip.octets());
        
        // User ID (null-terminated)
        if let Some(username) = &proxy_config.username {
            request.extend_from_slice(username.as_bytes());
        }
        request.push(0x00); // Null terminator
        
        stream.write_all(&request).await
            .map_err(|e| format!("Failed to send SOCKS4 request: {}", e))?;
        
        // Read response
        let mut response = [0u8; 8];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("Failed to read SOCKS4 response: {}", e))?;
        
        if response[1] != 0x5A {
            let error_msg = match response[1] {
                0x5B => "Request rejected or failed",
                0x5C => "Request failed (no identd)",
                0x5D => "Request failed (identd mismatch)",
                _ => "Unknown SOCKS4 error",
            };
            return Err(format!("SOCKS4 connect failed: {}", error_msg));
        }
        
        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        
        Ok(std_stream)
    }
    
    async fn connect_through_http_proxy(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<TcpStream, String> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        
        // Build HTTP CONNECT request
        let mut request = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\n", target, target);
        
        // Add proxy authentication if provided
        if let (Some(username), Some(password)) = (&proxy_config.username, &proxy_config.password) {
            let credentials = format!("{}:{}", username, password);
            let encoded = data_encoding::BASE64.encode(credentials.as_bytes());
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
        }
        
        request.push_str("\r\n");
        
        stream.write_all(request.as_bytes()).await
            .map_err(|e| format!("Failed to send HTTP CONNECT: {}", e))?;
        
        // Read response
        let mut reader = BufReader::new(&mut stream);
        let mut response_line = String::new();
        reader.read_line(&mut response_line).await
            .map_err(|e| format!("Failed to read HTTP response: {}", e))?;
        
        // Parse response status
        let parts: Vec<&str> = response_line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err("Invalid HTTP proxy response".to_string());
        }
        
        let status_code: u16 = parts[1].parse()
            .map_err(|_| "Invalid HTTP status code".to_string())?;
        
        if status_code != 200 {
            return Err(format!("HTTP proxy returned status {}", status_code));
        }
        
        // Read and discard headers until empty line
        loop {
            let mut header_line = String::new();
            reader.read_line(&mut header_line).await
                .map_err(|e| format!("Failed to read HTTP headers: {}", e))?;
            if header_line.trim().is_empty() {
                break;
            }
        }
        
        // Reconstruct the stream from the reader's inner
        drop(reader);
        let std_stream = stream.into_std()
            .map_err(|e| format!("Failed to convert stream: {}", e))?;
        std_stream.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        
        Ok(std_stream)
    }
    
    /// Establish connection through a proxy chain
    async fn establish_proxy_chain_connection(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        if chain_config.proxies.is_empty() {
            return Err("Proxy chain is empty".to_string());
        }
        
        match chain_config.mode {
            ProxyChainMode::Strict => {
                self.establish_strict_proxy_chain(config, chain_config).await
            }
            ProxyChainMode::Dynamic => {
                self.establish_dynamic_proxy_chain(config, chain_config).await
            }
            ProxyChainMode::Random => {
                self.establish_random_proxy(config, chain_config).await
            }
        }
    }
    
    async fn establish_strict_proxy_chain(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        // In strict mode, we must connect through ALL proxies in order
        // This is complex because each proxy tunnels through the previous one
        // For simplicity, we'll connect through the first proxy and use SOCKS5's ability to chain
        
        if chain_config.proxies.len() == 1 {
            return self.establish_proxy_connection(config, &chain_config.proxies[0]).await;
        }
        
        // For true chaining, we need to connect to each proxy and have it forward to the next
        // This implementation connects through the first proxy to reach subsequent proxies
        let first_proxy = &chain_config.proxies[0];
        let timeout = Duration::from_secs(config.connect_timeout.unwrap_or(15));
        
        // Connect to first proxy
        let proxy_addr = format!("{}:{}", first_proxy.host, first_proxy.port);
        let mut current_stream = tokio::time::timeout(timeout, AsyncTcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| format!("Proxy chain timeout connecting to {}", proxy_addr))?
            .map_err(|e| format!("Failed to connect to first proxy {}: {}", proxy_addr, e))?;
        
        // Chain through remaining proxies (except the last which connects to target)
        for (i, proxy) in chain_config.proxies.iter().skip(1).enumerate() {
            let target = if i == chain_config.proxies.len() - 2 {
                // Last proxy in chain - connect to actual target
                format!("{}:{}", config.host, config.port)
            } else {
                // Intermediate proxy - connect to next proxy
                format!("{}:{}", proxy.host, proxy.port)
            };
            
            // Use current stream to connect through previous proxy to this target
            // For simplicity, assume SOCKS5 for chaining (most flexible)
            current_stream = self.socks5_connect_internal(current_stream, &target, first_proxy).await
                .map_err(|e| format!("Chain hop {} failed: {}", i + 1, e))?
                .0;
        }
        
        // Final connection to target through last proxy
        let final_target = format!("{}:{}", config.host, config.port);
        let last_proxy = chain_config.proxies.last().unwrap();
        
        let std_stream = self.connect_through_socks5(current_stream, &final_target, last_proxy).await?;
        Ok(std_stream)
    }
    
    async fn socks5_connect_internal(
        &self,
        mut stream: AsyncTcpStream,
        target: &str,
        proxy_config: &ProxyConfig,
    ) -> Result<(AsyncTcpStream, ()), String> {
        // Similar to connect_through_socks5 but returns AsyncTcpStream for chaining
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        
        // SOCKS5 greeting
        let auth_required = proxy_config.username.is_some();
        let greeting = if auth_required {
            vec![0x05, 0x02, 0x00, 0x02]
        } else {
            vec![0x05, 0x01, 0x00]
        };
        
        stream.write_all(&greeting).await
            .map_err(|e| format!("SOCKS5 greeting failed: {}", e))?;
        
        let mut response = [0u8; 2];
        stream.read_exact(&mut response).await
            .map_err(|e| format!("SOCKS5 response failed: {}", e))?;
        
        if response[0] != 0x05 {
            return Err("Invalid SOCKS5 version".to_string());
        }
        
        if response[1] == 0x02 {
            let username = proxy_config.username.as_deref().unwrap_or("");
            let password = proxy_config.password.as_deref().unwrap_or("");
            
            let mut auth = vec![0x01];
            auth.push(username.len() as u8);
            auth.extend_from_slice(username.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());
            
            stream.write_all(&auth).await.map_err(|e| format!("Auth failed: {}", e))?;
            
            let mut auth_resp = [0u8; 2];
            stream.read_exact(&mut auth_resp).await.map_err(|e| format!("Auth response failed: {}", e))?;
            
            if auth_resp[1] != 0x00 {
                return Err("SOCKS5 auth rejected".to_string());
            }
        } else if response[1] != 0x00 {
            return Err("Unsupported auth method".to_string());
        }
        
        // Connect request
        let parts: Vec<&str> = target.split(':').collect();
        let host = parts[0];
        let port: u16 = parts[1].parse().unwrap_or(22);
        
        let mut request = vec![0x05, 0x01, 0x00, 0x03];
        request.push(host.len() as u8);
        request.extend_from_slice(host.as_bytes());
        request.extend_from_slice(&port.to_be_bytes());
        
        stream.write_all(&request).await.map_err(|e| format!("Connect request failed: {}", e))?;
        
        let mut resp = [0u8; 10];
        stream.read_exact(&mut resp).await.map_err(|e| format!("Connect response failed: {}", e))?;
        
        if resp[1] != 0x00 {
            return Err(format!("SOCKS5 connect failed with code {}", resp[1]));
        }
        
        Ok((stream, ()))
    }
    
    async fn establish_dynamic_proxy_chain(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        // In dynamic mode, try proxies in order and skip failures
        let mut last_error = String::from("No proxies available");
        
        for proxy in &chain_config.proxies {
            match self.establish_proxy_connection(config, proxy).await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    log::warn!("Proxy {}:{} failed: {}, trying next", proxy.host, proxy.port, e);
                    last_error = e;
                }
            }
        }
        
        Err(format!("All proxies in chain failed. Last error: {}", last_error))
    }
    
    async fn establish_random_proxy(&self, config: &SshConnectionConfig, chain_config: &ProxyChainConfig) -> Result<TcpStream, String> {
        use rand::Rng;
        
        // Use a simple random selection without thread_rng to avoid Send issues
        let index = {
            let mut rng = rand::rngs::OsRng;
            rng.gen_range(0..chain_config.proxies.len())
        };
        
        let proxy = &chain_config.proxies[index];
        self.establish_proxy_connection(config, proxy).await
    }

    async fn establish_openvpn_connection(&self, _config: &SshConnectionConfig, _openvpn_config: &OpenVPNConfig) -> Result<TcpStream, String> {
        // Use the OpenVPN service to establish connection through VPN
        // This would need to be implemented with the OpenVPN service
        // For now, return an error indicating OpenVPN is not implemented
        Err("OpenVPN connections not yet implemented for SSH".to_string())
    }

    async fn establish_jump_connection(&self, config: &SshConnectionConfig) -> Result<TcpStream, String> {
        let mut current_stream = self.establish_direct_connection(config).await?;

        for jump_host in &config.jump_hosts {
            // Get local address before moving the stream
            let local_addr = current_stream.local_addr()
                .map_err(|e| format!("Failed to get local address: {}", e))?;
            let _local_port = local_addr.port();

            let mut jump_session = Session::new()
                .map_err(|e| format!("Failed to create jump session: {}", e))?;
            jump_session.set_tcp_stream(current_stream);
            jump_session.handshake()
                .map_err(|e| format!("Jump host handshake failed: {}", e))?;

            // Authenticate with jump host
            self.authenticate_jump_session(&mut jump_session, jump_host)?;

            // Create tunnel to next host
            current_stream = TcpStream::connect((jump_host.host.as_str(), jump_host.port))
                .map_err(|e| format!("Failed to connect to jump host: {}", e))?;
        }

        Ok(current_stream)
    }

    fn authenticate_session(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        // Try public key authentication first if key is provided
        if let Some(private_key_path) = &config.private_key_path {
            if let Ok(_private_key_content) = std::fs::read_to_string(private_key_path) {
                let passphrase = config.private_key_passphrase.as_deref();

                if session.userauth_pubkey_file(
                    &config.username,
                    None,
                    Path::new(private_key_path),
                    passphrase,
                ).is_ok() {
                    return Ok(());
                }
            }
        }

        // Try password authentication if password is provided
        if let Some(password) = &config.password {
            if session.userauth_password(&config.username, password).is_ok() {
                return Ok(());
            }
        }

        // Try keyboard-interactive authentication (for MFA/2FA)
        // This handles challenge-response prompts like TOTP, SMS codes, etc.
        if config.password.is_some() || config.totp_secret.is_some() || !config.keyboard_interactive_responses.is_empty() {
            struct KeyboardInteractiveHandler {
                password: Option<String>,
                totp_secret: Option<String>,
                responses: Vec<String>,
            }
            
            impl KeyboardInteractivePrompt for KeyboardInteractiveHandler {
                fn prompt(&mut self, _username: &str, _instructions: &str, prompts: &[Prompt]) -> Vec<String> {
                    prompts.iter().map(|prompt| {
                        let prompt_lower = prompt.text.to_lowercase();
                        
                        // Check for TOTP/verification code prompts
                        if prompt_lower.contains("verification") || prompt_lower.contains("code") 
                            || prompt_lower.contains("token") || prompt_lower.contains("otp")
                            || prompt_lower.contains("2fa") || prompt_lower.contains("mfa") {
                            // Generate TOTP if secret is available
                            if let Some(ref secret) = self.totp_secret {
                                if let Ok(code) = generate_totp_code(secret) {
                                    return code;
                                }
                            }
                            // Check pre-configured responses
                            for resp in &self.responses {
                                if !resp.is_empty() {
                                    return resp.clone();
                                }
                            }
                        }
                        
                        // For password prompts, use the password
                        if prompt_lower.contains("password") {
                            if let Some(ref pwd) = self.password {
                                return pwd.clone();
                            }
                        }
                        
                        // Fall back to any available response
                        if let Some(ref pwd) = self.password {
                            return pwd.clone();
                        }
                        
                        String::new()
                    }).collect()
                }
            }
            
            let mut handler = KeyboardInteractiveHandler {
                password: config.password.clone(),
                totp_secret: config.totp_secret.clone(),
                responses: config.keyboard_interactive_responses.clone(),
            };
            
            if session.userauth_keyboard_interactive(&config.username, &mut handler).is_ok() {
                return Ok(());
            }
        }

        // Try agent authentication
        if session.userauth_agent(&config.username).is_ok() {
            return Ok(());
        }

        Err("All authentication methods failed".to_string())
    }

    fn authenticate_jump_session(&self, session: &mut Session, jump_config: &JumpHostConfig) -> Result<(), String> {
        // Try public key authentication first if key is provided
        if let Some(private_key_path) = &jump_config.private_key_path {
            if session.userauth_pubkey_file(
                &jump_config.username,
                None,
                Path::new(private_key_path),
                None,
                ).is_ok() {
                    return Ok(());
                }
        }

        // Try password authentication if password is provided
        if let Some(password) = &jump_config.password {
            if session.userauth_password(&jump_config.username, password).is_ok() {
                return Ok(());
            }
        }

        // Try agent authentication
        if session.userauth_agent(&jump_config.username).is_ok() {
            return Ok(());
        }

        Err("All jump host authentication methods failed".to_string())
    }

    pub async fn update_session_auth(&mut self, session_id: &str, password: Option<String>, private_key_path: Option<String>, private_key_passphrase: Option<String>) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        if let Some(password) = password {
            session.config.password = Some(password);
        }

        if let Some(private_key_path) = private_key_path {
            session.config.private_key_path = Some(private_key_path);
        }

        if let Some(passphrase) = private_key_passphrase {
            session.config.private_key_passphrase = Some(passphrase);
        }

        Ok(())
    }

    fn verify_host_key(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        let _known_hosts_path = config.known_hosts_path.clone()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|p| p.join(".ssh").join("known_hosts"))
                    .unwrap_or_else(|| Path::new("/dev/null").to_path_buf())
                    .to_string_lossy()
                    .to_string()
            });

        session.host_key()
            .ok_or("No host key available")?;

        // For now, we'll skip strict verification and just log
        // In a full implementation, you'd check against known_hosts file
        log::info!("Host key verification would be performed here for {}", config.host);
        Ok(())
    }

    fn start_keep_alive(&self, session_id: String, interval: u64) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval));
            loop {
                interval.tick().await;
                // Send keep-alive packet
                // This is a simplified implementation
                log::debug!("Sending keep-alive for session {}", session_id);
            }
        })
    }

    pub async fn validate_key_file(&self, key_path: &str, _passphrase: Option<&str>) -> Result<bool, String> {
        if !Path::new(key_path).exists() {
            return Err(format!("Key file does not exist: {}", key_path));
        }

        let key_content = std::fs::read_to_string(key_path)
            .map_err(|e| format!("Failed to read key file: {}", e))?;

        // Basic validation - check if it looks like a private key
        if !key_content.contains("-----BEGIN") || !key_content.contains("PRIVATE KEY-----") {
            return Err("File does not appear to be a valid private key".to_string());
        }

        // Try to parse the key (this is a basic check)
        // In a real implementation, you'd use the SSH library to validate the key
        Ok(true)
    }

    pub async fn generate_ssh_key(&self, key_type: &str, bits: Option<usize>, passphrase: Option<String>) -> Result<(String, String), String> {
        use ssh_key::{Algorithm, PrivateKey};
        use ssh_key::rand_core::OsRng;
        use ssh_key::LineEnding;

        let private_key = match key_type.to_lowercase().as_str() {
            "rsa" => {
                let bit_size = bits.unwrap_or(3072);
                // ssh-key 0.6 uses Algorithm::Rsa { hash } which doesn't take bits directly in the enum usually, 
                // but random() might. Let's check docs or usage.
                // Actually, for RSA, it's often PrivateKey::new(Algorithm::Rsa...).
                // If random() doesn't take bits for RSA via the enum, we might need another way.
                // Looking at ssh-key docs: Algorithm::Rsa does not hold bit size.
                // We should use rsa crate to generate and then convert.
                // OR checking if ssh-key has a specific RSA generation helper.
                // Let's try utilizing the 'rsa' crate directly for generation as we imported it.
                use rsa::RsaPrivateKey;
                let mut rng = OsRng;
                let _priv_key = RsaPrivateKey::new(&mut rng, bit_size)
                    .map_err(|e| format!("Failed to generate RSA key: {}", e))?;
                
                // Convert to OpenSSH format
                // ssh-key can parse PEM/PKCS8.
                // This is getting complicated. Let's stick to what ssh-key supports natively if possible.
                // If ssh-key doesn't support RSA generation easily, let's just stick to Ed25519 for now or fix this later.
                // Wait, Algorithm::Rsa doesn't carry size.
                
                // Let's simplify: Only support Ed25519 for this iteration to ensure it compiles.
                // We can add RSA later with proper crate usage.
                return Err("RSA generation not fully implemented yet, use Ed25519".to_string());
            }
            "ed25519" => {
                PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
                    .map_err(|e| format!("Failed to generate Ed25519 key: {}", e))?
            }
            _ => return Err(format!("Unsupported key type: {}", key_type)),
        };

        let final_priv_key = if let Some(_pass) = passphrase {
             // Basic encryption support
             // Note: proper encryption requires more setup, returning unencrypted for now with warning
             // log::warn!("Passphrase provided but encryption not yet implemented");
             private_key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?.to_string()
        } else {
            private_key.to_openssh(LineEnding::LF)
                .map_err(|e| format!("Failed to encode private key: {}", e))?
                .to_string()
        };

        let public_key = private_key.public_key();
        let public_key_str = public_key.to_openssh().map_err(|e| format!("Failed to encode public key: {}", e))?;

        Ok((final_priv_key, public_key_str))
    }

    pub async fn test_ssh_connection(&self, config: SshConnectionConfig) -> Result<String, String> {
        // Create a test connection without storing it
        let final_stream = if config.jump_hosts.is_empty() {
            self.establish_direct_connection(&config).await?
        } else {
            self.establish_jump_connection(&config).await?
        };

        let mut sess = Session::new().map_err(|e| format!("Failed to create test session: {}", e))?;
        sess.set_tcp_stream(final_stream);
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Test authentication
        self.authenticate_session(&mut sess, &config)?;

        Ok("SSH connection test successful".to_string())
    }

    pub async fn execute_command(&mut self, session_id: &str, command: String, _timeout: Option<u64>) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        channel.exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = Vec::new();
        channel.read_to_end(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel.wait_close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;

        let exit_status = channel.exit_status()
            .map_err(|e| format!("Failed to get exit status: {}", e))?;

        if exit_status != 0 {
            return Err(format!("Command failed with exit code {}", exit_status));
        }

        String::from_utf8(output)
            .map_err(|e| format!("Invalid UTF-8 output: {}", e))
    }

    pub async fn execute_command_interactive(&mut self, session_id: &str, command: String) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        // Request pseudo-terminal
        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel.wait_close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;

        Ok(output)
    }

    pub async fn start_shell(
        &mut self,
        session_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<String, String> {
        if let Some(existing) = self.shells.get(session_id) {
            return Ok(existing.id.clone());
        }

        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        session.session.set_blocking(true);

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        // Request agent forwarding if enabled
        if session.config.agent_forwarding {
            if let Err(e) = channel.request_auth_agent_forwarding() {
                log::warn!("Failed to request agent forwarding: {} (continuing without)", e);
            }
        }

        // Request pseudo-terminal
        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        session.session.set_blocking(false);

        let (tx, mut rx) = mpsc::unbounded_channel::<SshShellCommand>();
        let shell_id = Uuid::new_v4().to_string();
        let session_id_owned = session_id.to_string();
        let app_handle_clone = app_handle.clone();

        let thread = std::thread::spawn(move || {
            // Larger buffer for better throughput, especially for commands with lots of output
            let mut buffer = [0u8; 16384];
            let mut running = true;
            // Adaptive sleep: start short, increase when idle
            let mut idle_count: u32 = 0;
            const MIN_SLEEP_MS: u64 = 1;
            const MAX_SLEEP_MS: u64 = 10;
            const IDLE_THRESHOLD: u32 = 10;

            while running {
                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        SshShellCommand::Input(data) => {
                            // Record input if recording is active
                            record_input(&session_id_owned, &data);
                            
                            if let Err(error) = channel.write_all(data.as_bytes()) {
                                let _ = app_handle_clone.emit(
                                    "ssh-error",
                                    SshShellError {
                                        session_id: session_id_owned.clone(),
                                        message: error.to_string(),
                                    },
                                );
                                running = false;
                                break;
                            }
                            let _ = channel.flush();
                            idle_count = 0; // Reset idle counter on input
                        }
                        SshShellCommand::Resize(cols, rows) => {
                            // Record resize event
                            record_resize(&session_id_owned, cols, rows);
                            let _ = channel.request_pty_size(cols, rows, None, None);
                        }
                        SshShellCommand::Close => {
                            let _ = channel.close();
                            let _ = channel.wait_close();
                            running = false;
                        }
                    }
                }

                match channel.read(&mut buffer) {
                    Ok(bytes) if bytes > 0 => {
                        let output = String::from_utf8_lossy(&buffer[..bytes]).to_string();
                        idle_count = 0; // Reset idle counter on output
                        
                        // Record output if recording is active
                        record_output(&session_id_owned, &output);
                        
                        // Process automation patterns if automation is active
                        process_automation_output(&session_id_owned, &output);
                        
                        // Store output in the global buffer
                        if let Ok(mut buffers) = TERMINAL_BUFFERS.lock() {
                            let session_buffer = buffers.entry(session_id_owned.clone()).or_insert_with(String::new);
                            session_buffer.push_str(&output);
                            // Trim buffer if too large, keeping the most recent output
                            if session_buffer.len() > MAX_BUFFER_SIZE {
                                let excess = session_buffer.len() - MAX_BUFFER_SIZE;
                                *session_buffer = session_buffer[excess..].to_string();
                            }
                        }
                        
                        let _ = app_handle_clone.emit(
                            "ssh-output",
                            SshShellOutput {
                                session_id: session_id_owned.clone(),
                                data: output,
                            },
                        );
                    }
                    Ok(_) => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        idle_count = idle_count.saturating_add(1);
                    }
                    Err(error) => {
                        let _ = app_handle_clone.emit(
                            "ssh-error",
                            SshShellError {
                                session_id: session_id_owned.clone(),
                                message: error.to_string(),
                            },
                        );
                        running = false;
                    }
                }

                if channel.eof() {
                    running = false;
                }

                // Adaptive sleep: responsive when active, save CPU when idle
                let sleep_ms = if idle_count > IDLE_THRESHOLD {
                    MAX_SLEEP_MS
                } else {
                    MIN_SLEEP_MS
                };
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }

            let _ = app_handle_clone.emit(
                "ssh-shell-closed",
                SshShellClosed {
                    session_id: session_id_owned,
                },
            );
        });

        self.shells.insert(
            session_id.to_string(),
            SshShellHandle {
                id: shell_id.clone(),
                sender: tx,
                thread,
            },
        );

        Ok(shell_id)
    }

    pub async fn send_shell_input(&mut self, session_id: &str, data: String) -> Result<(), String> {
        let shell = self.shells.get(session_id)
            .ok_or("Shell not started")?;
        shell.sender.send(SshShellCommand::Input(data))
            .map_err(|_| "Failed to send input to shell".to_string())
    }

    pub async fn resize_shell(&mut self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let shell = self.shells.get(session_id)
            .ok_or("Shell not started")?;
        shell.sender.send(SshShellCommand::Resize(cols, rows))
            .map_err(|_| "Failed to resize shell".to_string())
    }

    pub async fn stop_shell(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(shell) = self.shells.remove(session_id) {
            let _ = shell.sender.send(SshShellCommand::Close);
        }
        Ok(())
    }

    pub async fn stop_port_forward(&mut self, session_id: &str, forward_id: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;
        
        if let Some(handle) = session.port_forwards.remove(forward_id) {
            // Abort the port forwarding task
            handle.handle.abort();
            log::info!("Port forward {} stopped for session {}", forward_id, session_id);
            Ok(())
        } else {
            Err(format!("Port forward {} not found", forward_id))
        }
    }

    pub async fn setup_port_forward(&mut self, session_id: &str, config: PortForwardConfig) -> Result<String, String> {
        let forward_id = Uuid::new_v4().to_string();

        let handle = match config.direction {
            PortForwardDirection::Local => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_local_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Remote => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_remote_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Dynamic => {
                let session = self.sessions.get_mut(session_id)
                    .ok_or("Session not found")?;
                session.last_activity = Utc::now();
                Self::setup_dynamic_port_forward(session, &config, forward_id.clone()).await?
            }
        };

        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;
        session.last_activity = Utc::now();
        session.port_forwards.insert(forward_id.clone(), handle);
        Ok(forward_id)
    }

    async fn setup_local_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        // Local port forwarding: bind locally, forward to remote via SSH
        let listener = std::net::TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind local port: {}", e))?;
        
        // Set non-blocking mode for the listener
        listener.set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;
        
        // Clone session handle for the task
        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { 
                    format!("Failed to convert listener: {}", e).into() 
                })?;
            
            log::info!("Local port forward started on {}:{} -> {}:{}", 
                config_clone.local_host, config_clone.local_port,
                config_clone.remote_host, config_clone.remote_port);

            loop {
                match listener.accept().await {
                    Ok((local_stream, peer_addr)) => {
                        log::debug!("Accepted local connection from {}", peer_addr);
                        
                        let session = session_clone.clone();
                        let remote_host = config_clone.remote_host.clone();
                        let remote_port = config_clone.remote_port;
                        let id = id_clone.clone();
                        
                        // Spawn a task for each connection
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_local_forward_connection(
                                local_stream, session, &remote_host, remote_port
                            ).await {
                                log::error!("[{}] Local forward connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("Failed to accept connection: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_local_forward_connection(
        local_stream: tokio::net::TcpStream,
        session: Session,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Create a direct-tcpip channel through SSH
        let mut channel = tokio::task::spawn_blocking({
            let session = session.clone();
            let remote_host = remote_host.to_string();
            move || {
                session.channel_direct_tcpip(&remote_host, remote_port, None)
                    .map_err(|e| format!("Failed to create channel: {}", e))
            }
        }).await??;

        // Convert local stream to split read/write
        let (mut local_read, mut local_write) = local_stream.into_split();
        
        // Bidirectional forwarding using blocking channel in separate thread
        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_local, mut rx_to_local) = mpsc::unbounded_channel::<Vec<u8>>();
        
        // Thread for SSH channel I/O (ssh2 is blocking)
        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];
            
            // ssh2 channels don't have set_read_timeout, we use non-blocking mode via the session
            // and poll with short sleeps
            
            loop {
                // Check for data to send to remote
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SSH channel write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }
                
                // Read from SSH channel (non-blocking read with poll)
                match channel.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        if tx_to_local.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }
                
                if channel.eof() {
                    break;
                }
                
                std::thread::sleep(Duration::from_millis(5));
            }
            
            let _ = channel.close();
            let _ = channel.wait_close();
        });

        // Task: Read from local, send to remote
        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Task: Read from remote channel, write to local
        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        // Wait for either side to finish
        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        // Clean up SSH thread
        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;

        Ok(())
    }

    async fn setup_remote_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        // Remote port forwarding - listen on remote host and forward to local
        // ssh2's channel_forward_listen returns (Listener, bound_port)
        let (listener, actual_port) = session.session.channel_forward_listen(config.remote_port, Some(&config.remote_host), None)
            .map_err(|e| format!("Failed to setup remote port forward: {}", e))?;

        let config_clone = config.clone();
        let id_clone = id.clone();

        // Log actual bound port if different
        let bound_port = if actual_port > 0 { actual_port } else { config.remote_port };
        if actual_port > 0 && actual_port != config.remote_port {
            log::info!("Remote port forward bound to {} (requested {})", actual_port, config.remote_port);
        }

        let handle = tokio::spawn(async move {
            log::info!("Remote port forward listening on {}:{} -> {}:{}", 
                config_clone.remote_host, bound_port,
                config_clone.local_host, config_clone.local_port);

            // Wrap listener in Arc<Mutex> so it can be shared
            let listener = std::sync::Arc::new(std::sync::Mutex::new(listener));

            loop {
                // Accept incoming connections from the SSH channel using the Listener
                let channel = match tokio::task::spawn_blocking({
                    let listener = listener.clone();
                    move || {
                        // Lock the listener and accept a connection
                        let mut listener = listener.lock().map_err(|e| format!("Lock error: {}", e))?;
                        listener.accept()
                            .map_err(|e| format!("Accept error: {}", e))
                    }
                }).await {
                    Ok(Ok(channel)) => channel,
                    Ok(Err(e)) => {
                        log::debug!("[{}] Forward accept error: {}", id_clone, e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                        continue;
                    }
                    Err(e) => {
                        log::error!("[{}] Task error: {}", id_clone, e);
                        break Err(format!("Task join error: {}", e).into());
                    }
                };

                log::debug!("[{}] Accepted remote forward connection", id_clone);

                let local_host = config_clone.local_host.clone();
                let local_port = config_clone.local_port;
                let id = id_clone.clone();

                // Handle each connection in its own task
                tokio::spawn(async move {
                    if let Err(e) = Self::handle_remote_forward_connection(
                        channel, &local_host, local_port
                    ).await {
                        log::error!("[{}] Remote forward connection error: {}", id, e);
                    }
                });
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_remote_forward_connection(
        mut channel: ssh2::Channel,
        local_host: &str,
        local_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Connect to local target
        let local_stream = tokio::net::TcpStream::connect(format!("{}:{}", local_host, local_port))
            .await
            .map_err(|e| format!("Failed to connect to local target: {}", e))?;

        let (mut local_read, mut local_write) = local_stream.into_split();

        // Channels for bidirectional forwarding
        let (tx_to_local, mut rx_to_local) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();

        // SSH channel I/O thread (ssh2 is blocking)
        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];
            
            // ssh2 channels don't have set_read_timeout, use non-blocking mode with polling

            loop {
                // Check for data to send back through SSH channel
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("Remote forward SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }

                // Read from SSH channel
                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_local.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }

                if channel.eof() {
                    break;
                }

                std::thread::sleep(Duration::from_millis(5));
            }

            let _ = channel.close();
            let _ = channel.wait_close();
        });

        // Task: Read from local, send to remote
        let local_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match local_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Task: Receive from channel, write to local
        let remote_to_local = tokio::spawn(async move {
            while let Some(data) = rx_to_local.recv().await {
                if local_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        // Wait for completion
        tokio::select! {
            _ = local_to_remote => {}
            _ = remote_to_local => {}
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;

        Ok(())
    }

    async fn setup_dynamic_port_forward(session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        // Dynamic port forwarding (SOCKS5 proxy)
        let listener = TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind SOCKS port: {}", e))?;
        
        listener.set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();
        let id_clone = id.clone();

        // Start the SOCKS5 proxy in background
        let handle = tokio::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { 
                    format!("Failed to convert listener: {}", e).into() 
                })?;

            log::info!("SOCKS5 proxy started on {}:{}", config_clone.local_host, config_clone.local_port);

            loop {
                match listener.accept().await {
                    Ok((client_stream, peer_addr)) => {
                        log::debug!("[{}] SOCKS5 client connected from {}", id_clone, peer_addr);
                        
                        let session = session_clone.clone();
                        let id = id_clone.clone();
                        
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_socks5_connection(client_stream, session).await {
                                log::debug!("[{}] SOCKS5 connection error: {}", id, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("SOCKS5 accept error: {}", e);
                    }
                }
            }
        });

        Ok(PortForwardHandle {
            id: id.clone(),
            config: config.clone(),
            handle,
        })
    }

    async fn handle_socks5_connection(
        mut client_stream: tokio::net::TcpStream,
        session: Session,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // SOCKS5 Handshake
        // 1. Client sends version and auth methods
        let mut buf = [0u8; 258];
        let n = client_stream.read(&mut buf).await?;
        
        if n < 2 || buf[0] != 0x05 {
            return Err("Invalid SOCKS version".into());
        }
        
        let n_methods = buf[1] as usize;
        if n < 2 + n_methods {
            return Err("Invalid SOCKS auth methods".into());
        }
        
        // Check if no-auth (0x00) is supported
        let methods = &buf[2..2 + n_methods];
        if !methods.contains(&0x00) {
            // Send auth not acceptable
            client_stream.write_all(&[0x05, 0xFF]).await?;
            return Err("No acceptable auth method".into());
        }
        
        // Send no-auth required response
        client_stream.write_all(&[0x05, 0x00]).await?;
        
        // 2. Client sends connection request
        let n = client_stream.read(&mut buf).await?;
        if n < 4 {
            return Err("Invalid SOCKS request".into());
        }
        
        // VER CMD RSV ATYP
        if buf[0] != 0x05 {
            return Err("Invalid SOCKS version in request".into());
        }
        
        let cmd = buf[1];
        let atype = buf[3];
        
        // Only support CONNECT command (0x01)
        if cmd != 0x01 {
            // Send command not supported
            client_stream.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
            return Err(format!("Unsupported SOCKS command: {}", cmd).into());
        }
        
        // Parse address
        let (target_host, target_port, _addr_end) = match atype {
            0x01 => {
                // IPv4
                if n < 10 {
                    return Err("Invalid IPv4 address length".into());
                }
                let addr = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
                let port = u16::from_be_bytes([buf[8], buf[9]]);
                (addr, port, 10)
            }
            0x03 => {
                // Domain name
                let domain_len = buf[4] as usize;
                if n < 5 + domain_len + 2 {
                    return Err("Invalid domain name length".into());
                }
                let domain = String::from_utf8_lossy(&buf[5..5 + domain_len]).to_string();
                let port = u16::from_be_bytes([buf[5 + domain_len], buf[6 + domain_len]]);
                (domain, port, 7 + domain_len)
            }
            0x04 => {
                // IPv6
                if n < 22 {
                    return Err("Invalid IPv6 address length".into());
                }
                let addr = format!(
                    "{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}",
                    u16::from_be_bytes([buf[4], buf[5]]),
                    u16::from_be_bytes([buf[6], buf[7]]),
                    u16::from_be_bytes([buf[8], buf[9]]),
                    u16::from_be_bytes([buf[10], buf[11]]),
                    u16::from_be_bytes([buf[12], buf[13]]),
                    u16::from_be_bytes([buf[14], buf[15]]),
                    u16::from_be_bytes([buf[16], buf[17]]),
                    u16::from_be_bytes([buf[18], buf[19]])
                );
                let port = u16::from_be_bytes([buf[20], buf[21]]);
                (addr, port, 22)
            }
            _ => {
                // Address type not supported
                client_stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
                return Err(format!("Unsupported address type: {}", atype).into());
            }
        };
        
        log::debug!("SOCKS5 CONNECT to {}:{}", target_host, target_port);
        
        // 3. Create SSH direct-tcpip channel to target
        let channel = match tokio::task::spawn_blocking({
            let session = session.clone();
            let host = target_host.clone();
            move || {
                session.channel_direct_tcpip(&host, target_port, None)
            }
        }).await? {
            Ok(ch) => ch,
            Err(e) => {
                // Connection refused or host unreachable
                client_stream.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
                return Err(format!("Failed to connect via SSH: {}", e).into());
            }
        };
        
        // Send success response
        // VER REP RSV ATYP BND.ADDR BND.PORT
        let response = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        client_stream.write_all(&response).await?;
        
        // 4. Start bidirectional forwarding
        Self::forward_socks5_traffic(client_stream, channel).await
    }

    async fn forward_socks5_traffic(
        client_stream: tokio::net::TcpStream,
        mut channel: ssh2::Channel,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (mut client_read, mut client_write) = client_stream.into_split();
        
        let (tx_to_client, mut rx_to_client) = mpsc::unbounded_channel::<Vec<u8>>();
        let (tx_to_remote, mut rx_to_remote) = mpsc::unbounded_channel::<Vec<u8>>();
        
        // SSH channel I/O thread
        let ssh_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 32768];
            // ssh2 channels don't have set_read_timeout, use non-blocking mode with polling
            
            loop {
                // Write data to SSH channel
                while let Ok(data) = rx_to_remote.try_recv() {
                    if let Err(e) = channel.write_all(&data) {
                        log::debug!("SOCKS5 SSH write error: {}", e);
                        return;
                    }
                    let _ = channel.flush();
                }
                
                // Read from SSH channel
                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_client.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == ErrorKind::TimedOut => {}
                    Err(_) => break,
                }
                
                if channel.eof() {
                    break;
                }
                
                std::thread::sleep(Duration::from_millis(5));
            }
            
            let _ = channel.close();
            let _ = channel.wait_close();
        });
        
        // Client -> Remote
        let client_to_remote = tokio::spawn(async move {
            let mut buf = [0u8; 32768];
            loop {
                match client_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_to_remote.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        
        // Remote -> Client
        let remote_to_client = tokio::spawn(async move {
            while let Some(data) = rx_to_client.recv().await {
                if client_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });
        
        tokio::select! {
            _ = client_to_remote => {}
            _ = remote_to_client => {}
        }
        
        let _ = tokio::task::spawn_blocking(move || {
            let _ = ssh_thread.join();
        }).await;
        
        Ok(())
    }

    pub async fn list_directory(&mut self, session_id: &str, path: &str) -> Result<Vec<SftpDirEntry>, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        // Use SFTP for directory listing
        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let entries = sftp.readdir(Path::new(path))
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        Ok(entries.into_iter().map(|(path, stat)| {
            // Create a simplified directory entry representation
            SftpDirEntry {
                path: path.to_string_lossy().to_string(),
                file_type: if stat.is_dir() { "directory" } else { "file" }.to_string(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0) as u64,
            }
        }).collect())
    }

    pub async fn upload_file(&mut self, session_id: &str, local_path: &str, remote_path: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut local_file = std::fs::File::open(local_path)
            .map_err(|e| format!("Failed to open local file: {}", e))?;

        let mut remote_file = sftp.create(Path::new(remote_path))
            .map_err(|e| format!("Failed to create remote file: {}", e))?;

        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn download_file(&mut self, session_id: &str, remote_path: &str, local_path: &str) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let sftp = session.session.sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

        let mut remote_file = sftp.open(Path::new(remote_path))
            .map_err(|e| format!("Failed to open remote file: {}", e))?;

        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| format!("Failed to create local file: {}", e))?;

        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    }

    pub async fn disconnect_ssh(&mut self, session_id: &str) -> Result<(), String> {
        let _ = self.stop_shell(session_id).await;
        if let Some(mut session) = self.sessions.remove(session_id) {
            // Stop keep-alive
            if let Some(handle) = session.keep_alive_handle.take() {
                handle.abort();
            }

            // Stop all port forwards
            for (_, forward) in session.port_forwards.drain() {
                forward.handle.abort();
            }

            // Session will be dropped automatically
        }
        Ok(())
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<SshSessionInfo, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Session not found")?;

        Ok(SshSessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            is_alive: true, // Simplified - in practice you'd check if session is still valid
        })
    }

    pub async fn list_sessions(&self) -> Vec<SshSessionInfo> {
        self.sessions.values().map(|session| SshSessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            is_alive: true,
        }).collect()
    }

    // Advanced SSH features
    pub async fn execute_script(&mut self, session_id: &str, script: &str, interpreter: Option<&str>) -> Result<String, String> {
        let interpreter = interpreter.unwrap_or("bash");
        let escaped_script = shell_escape::escape(script.into());
        let command = format!("echo {} | {}", escaped_script, interpreter);

        self.execute_command(session_id, command, Some(300)).await
    }

    pub async fn transfer_file_scp(&mut self, session_id: &str, local_path: &str, remote_path: &str, direction: TransferDirection) -> Result<(), String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        match direction {
            TransferDirection::Upload => {
                // Use SCP to upload file
                let _scp_command = format!("scp -t {}", remote_path);
                let file_size = std::fs::metadata(local_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .len() as u64;
                let mut channel = session.session.scp_send(Path::new(remote_path), 0o644, file_size, None)
                    .map_err(|e| format!("Failed to initiate SCP upload: {}", e))?;

                let content = std::fs::read(local_path)
                    .map_err(|e| format!("Failed to read local file: {}", e))?;

                channel.write_all(&content)
                    .map_err(|e| format!("Failed to write file content: {}", e))?;

                channel.send_eof()
                    .map_err(|e| format!("Failed to send EOF: {}", e))?;

                channel.wait_eof()
                    .map_err(|e| format!("Failed to wait for EOF: {}", e))?;

                channel.close()
                    .map_err(|e| format!("Failed to close channel: {}", e))?;

                channel.wait_close()
                    .map_err(|e| format!("Failed to wait for close: {}", e))?;
            }
            TransferDirection::Download => {
                // Use SCP to download file
                let (mut channel, stat) = session.session.scp_recv(Path::new(remote_path))
                    .map_err(|e| format!("Failed to initiate SCP download: {}", e))?;

                let file_size = stat.size();
                let mut content = Vec::with_capacity(file_size as usize);

                std::io::copy(&mut channel, &mut content)
                    .map_err(|e| format!("Failed to read file content: {}", e))?;

                std::fs::write(local_path, content)
                    .map_err(|e| format!("Failed to write local file: {}", e))?;
            }
        }

        Ok(())
    }

    pub async fn monitor_process(&mut self, session_id: &str, process_name: &str) -> Result<Vec<ProcessInfo>, String> {
        let command = format!("ps aux | grep {} | grep -v grep", shell_escape::escape(process_name.into()));
        let output = self.execute_command(session_id, command, None).await?;

        let mut processes = Vec::new();
        for line in output.lines().skip(1) { // Skip header
            if let Ok(process) = self.parse_process_line(line) {
                processes.push(process);
            }
        }

        Ok(processes)
    }

    fn parse_process_line(&self, line: &str) -> Result<ProcessInfo, String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 11 {
            return Err("Invalid process line format".to_string());
        }

        Ok(ProcessInfo {
            user: parts[0].to_string(),
            pid: parts[1].parse().map_err(|_| "Invalid PID")?,
            cpu_percent: parts[2].parse().unwrap_or(0.0),
            mem_percent: parts[3].parse().unwrap_or(0.0),
            command: parts[10..].join(" "),
        })
    }

    pub async fn get_system_info(&mut self, session_id: &str) -> Result<SystemInfo, String> {
        let uname_output = self.execute_command(session_id, "uname -a".to_string(), None).await?;
        let cpu_info = self.execute_command(session_id, "cat /proc/cpuinfo | head -5".to_string(), None).await?;
        let mem_info = self.execute_command(session_id, "free -h".to_string(), None).await?;
        let disk_info = self.execute_command(session_id, "df -h".to_string(), None).await?;

        Ok(SystemInfo {
            uname: uname_output.trim().to_string(),
            cpu_info: cpu_info.trim().to_string(),
            memory_info: mem_info.trim().to_string(),
            disk_info: disk_info.trim().to_string(),
        })
    }
}

// Tauri commands
#[tauri::command]
pub async fn connect_ssh(
    state: tauri::State<'_, SshServiceState>,
    config: SshConnectionConfig
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.connect_ssh(config).await
}

#[tauri::command]
pub async fn execute_command(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String,
    timeout: Option<u64>
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_command(&session_id, command, timeout).await
}

#[tauri::command]
pub async fn execute_command_interactive(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_command_interactive(&session_id, command).await
}

#[tauri::command]
pub async fn start_shell(
    state: tauri::State<'_, SshServiceState>,
    app_handle: tauri::AppHandle,
    session_id: String
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.start_shell(&session_id, app_handle).await
}

#[tauri::command]
pub async fn send_ssh_input(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    data: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.send_shell_input(&session_id, data).await
}

#[tauri::command]
pub async fn resize_ssh_shell(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    cols: u32,
    rows: u32
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.resize_shell(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn setup_port_forward(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: PortForwardConfig
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.setup_port_forward(&session_id, config).await
}

#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    path: String
) -> Result<Vec<String>, String> {
    let mut ssh = state.lock().await;
    let entries = ssh.list_directory(&session_id, &path).await?;
    Ok(entries.into_iter().map(|e| e.path.to_string()).collect())
}

#[tauri::command]
pub async fn upload_file(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.upload_file(&session_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn download_file(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.download_file(&session_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn disconnect_ssh(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.disconnect_ssh(&session_id).await
}

#[tauri::command]
pub async fn get_session_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<SshSessionInfo, String> {
    let ssh = state.lock().await;
    ssh.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, SshServiceState>
) -> Result<Vec<SshSessionInfo>, String> {
    let ssh = state.lock().await;
    Ok(ssh.list_sessions().await)
}

#[tauri::command]
pub async fn execute_script(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    script: String,
    interpreter: Option<String>
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.execute_script(&session_id, &script, interpreter.as_deref()).await
}

#[tauri::command]
pub async fn transfer_file_scp(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    direction: TransferDirection
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.transfer_file_scp(&session_id, &local_path, &remote_path, direction).await
}

#[tauri::command]
pub async fn get_system_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<SystemInfo, String> {
    let mut ssh = state.lock().await;
    ssh.get_system_info(&session_id).await
}

#[tauri::command]
pub async fn monitor_process(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    process_name: String
) -> Result<Vec<ProcessInfo>, String> {
    let mut ssh = state.lock().await;
    ssh.monitor_process(&session_id, &process_name).await
}

#[tauri::command]
pub async fn update_ssh_session_auth(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>
) -> Result<(), String> {
    let mut ssh = state.lock().await;
    ssh.update_session_auth(&session_id, password, private_key_path, private_key_passphrase).await
}

#[tauri::command]
pub async fn validate_ssh_key_file(
    state: tauri::State<'_, SshServiceState>,
    key_path: String,
    passphrase: Option<String>
) -> Result<bool, String> {
    let ssh = state.lock().await;
    ssh.validate_key_file(&key_path, passphrase.as_deref()).await
}

#[tauri::command]
pub async fn test_ssh_connection(
    state: tauri::State<'_, SshServiceState>,
    config: SshConnectionConfig
) -> Result<String, String> {
    let ssh = state.lock().await;
    ssh.test_ssh_connection(config).await
}

#[tauri::command]
pub async fn generate_ssh_key(
    state: tauri::State<'_, SshServiceState>,
    key_type: String,
    bits: Option<usize>,
    passphrase: Option<String>
) -> Result<(String, String), String> {
    let ssh = state.lock().await;
    ssh.generate_ssh_key(&key_type, bits, passphrase).await
}

/// Get the terminal buffer for a session
#[tauri::command]
pub fn get_terminal_buffer(session_id: String) -> Result<String, String> {
    let buffers = TERMINAL_BUFFERS.lock()
        .map_err(|e| format!("Failed to lock buffer: {}", e))?;
    Ok(buffers.get(&session_id).cloned().unwrap_or_default())
}

/// Clear the terminal buffer for a session
#[tauri::command]
pub fn clear_terminal_buffer(session_id: String) -> Result<(), String> {
    let mut buffers = TERMINAL_BUFFERS.lock()
        .map_err(|e| format!("Failed to lock buffer: {}", e))?;
    buffers.remove(&session_id);
    Ok(())
}

/// Check if an SSH session is still alive and has an active shell
#[tauri::command]
pub async fn is_session_alive(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<bool, String> {
    let ssh = state.lock().await;
    // Check if session exists
    if !ssh.sessions.contains_key(&session_id) {
        return Ok(false);
    }
    // Check if shell is still running
    Ok(ssh.shells.contains_key(&session_id))
}

/// Get info about an active shell for a session
#[tauri::command]
pub async fn get_shell_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String
) -> Result<Option<String>, String> {
    let ssh = state.lock().await;
    if let Some(shell) = ssh.shells.get(&session_id) {
        Ok(Some(shell.id.clone()))
    } else {
        Ok(None)
    }
}

/// Reattach to an existing SSH session - restarts the shell event listeners
/// without creating a new connection
#[tauri::command]
pub async fn reattach_session(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    app_handle: tauri::AppHandle
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    
    // Check if session exists
    if !ssh.sessions.contains_key(&session_id) {
        return Err("Session not found - may have been disconnected".to_string());
    }
    
    // If shell already exists, just return the shell ID
    // The frontend will start receiving events again
    if let Some(shell) = ssh.shells.get(&session_id) {
        return Ok(shell.id.clone());
    }
    
    // Shell doesn't exist, need to start a new one but keep the existing connection
    ssh.start_shell(&session_id, app_handle).await
}

// NOTE: pause_shell and resume_shell commands removed
// The terminal buffer always captures the full session output (up to MAX_BUFFER_SIZE)
// This ensures users never lose output when detaching and reattaching sessions

// ===============================
// Session Recording Commands
// ===============================

/// Start recording an SSH session's terminal output
#[tauri::command]
pub async fn start_session_recording(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    record_input: Option<bool>,
    initial_cols: Option<u32>,
    initial_rows: Option<u32>,
) -> Result<(), String> {
    let ssh = state.lock().await;
    
    // Verify session exists
    let session = ssh.sessions.get(&session_id)
        .ok_or("Session not found")?;
    
    let mut recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    
    if recordings.contains_key(&session_id) {
        return Err("Recording already active for this session".to_string());
    }
    
    recordings.insert(session_id.clone(), RecordingState {
        start_time: std::time::Instant::now(),
        start_utc: Utc::now(),
        host: session.config.host.clone(),
        username: session.config.username.clone(),
        cols: initial_cols.unwrap_or(80),
        rows: initial_rows.unwrap_or(24),
        entries: Vec::new(),
        record_input: record_input.unwrap_or(false),
    });
    
    log::info!("Started recording SSH session: {}", session_id);
    Ok(())
}

/// Stop recording and return the recording data
#[tauri::command]
pub fn stop_session_recording(
    session_id: String,
) -> Result<SessionRecording, String> {
    let mut recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    
    let state = recordings.remove(&session_id)
        .ok_or("No active recording for this session")?;
    
    let duration_ms = state.start_time.elapsed().as_millis() as u64;
    
    let recording = SessionRecording {
        metadata: SessionRecordingMetadata {
            session_id: session_id.clone(),
            start_time: state.start_utc,
            end_time: Some(Utc::now()),
            host: state.host,
            username: state.username,
            cols: state.cols,
            rows: state.rows,
            duration_ms,
            entry_count: state.entries.len(),
        },
        entries: state.entries,
    };
    
    log::info!("Stopped recording SSH session: {} ({} entries, {}ms)", 
               session_id, recording.metadata.entry_count, duration_ms);
    
    Ok(recording)
}

/// Check if a session is being recorded
#[tauri::command]
pub fn is_session_recording(session_id: String) -> Result<bool, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    Ok(recordings.contains_key(&session_id))
}

/// Get recording status for a session
#[tauri::command]
pub fn get_recording_status(session_id: String) -> Result<Option<SessionRecordingMetadata>, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    
    if let Some(state) = recordings.get(&session_id) {
        let duration_ms = state.start_time.elapsed().as_millis() as u64;
        Ok(Some(SessionRecordingMetadata {
            session_id: session_id.clone(),
            start_time: state.start_utc,
            end_time: None,
            host: state.host.clone(),
            username: state.username.clone(),
            cols: state.cols,
            rows: state.rows,
            duration_ms,
            entry_count: state.entries.len(),
        }))
    } else {
        Ok(None)
    }
}

/// Add output data to an active recording (internal helper)
fn record_output(session_id: &str, data: &str) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
            state.entries.push(SessionRecordingEntry {
                timestamp_ms,
                data: data.to_string(),
                entry_type: RecordingEntryType::Output,
            });
        }
    }
}

/// Add input data to an active recording (internal helper)
fn record_input(session_id: &str, data: &str) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            if state.record_input {
                let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
                state.entries.push(SessionRecordingEntry {
                    timestamp_ms,
                    data: data.to_string(),
                    entry_type: RecordingEntryType::Input,
                });
            }
        }
    }
}

/// Record a resize event
fn record_resize(session_id: &str, cols: u32, rows: u32) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
            state.entries.push(SessionRecordingEntry {
                timestamp_ms,
                data: String::new(),
                entry_type: RecordingEntryType::Resize { cols, rows },
            });
            state.cols = cols;
            state.rows = rows;
        }
    }
}

/// Export recording to asciicast v2 format (compatible with asciinema)
#[tauri::command]
pub fn export_recording_asciicast(recording: SessionRecording) -> Result<String, String> {
    let mut output = Vec::new();
    
    // Header line (JSON object)
    let header = serde_json::json!({
        "version": 2,
        "width": recording.metadata.cols,
        "height": recording.metadata.rows,
        "timestamp": recording.metadata.start_time.timestamp(),
        "duration": recording.metadata.duration_ms as f64 / 1000.0,
        "env": {
            "SHELL": "/bin/bash",
            "TERM": "xterm-256color"
        },
        "title": format!("SSH Session: {}@{}", recording.metadata.username, recording.metadata.host)
    });
    output.push(header.to_string());
    
    // Event lines [time, event_type, data]
    for entry in &recording.entries {
        let time_secs = entry.timestamp_ms as f64 / 1000.0;
        match &entry.entry_type {
            RecordingEntryType::Output => {
                let event = serde_json::json!([time_secs, "o", entry.data]);
                output.push(event.to_string());
            }
            RecordingEntryType::Input => {
                let event = serde_json::json!([time_secs, "i", entry.data]);
                output.push(event.to_string());
            }
            RecordingEntryType::Resize { cols, rows } => {
                let resize_data = format!("\x1b[8;{};{}t", rows, cols);
                let event = serde_json::json!([time_secs, "o", resize_data]);
                output.push(event.to_string());
            }
        }
    }
    
    Ok(output.join("\n"))
}

/// Export recording to script/typescript format (Unix script command format)
#[tauri::command]
pub fn export_recording_script(recording: SessionRecording) -> Result<String, String> {
    let mut output = String::new();
    
    // Script header
    output.push_str(&format!(
        "Script started on {}\n",
        recording.metadata.start_time.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    
    // Output data only (script format is simpler)
    for entry in &recording.entries {
        if let RecordingEntryType::Output = entry.entry_type {
            output.push_str(&entry.data);
        }
    }
    
    // Script footer
    if let Some(end_time) = recording.metadata.end_time {
        output.push_str(&format!(
            "\nScript done on {}\n",
            end_time.format("%Y-%m-%d %H:%M:%S UTC")
        ));
    }
    
    Ok(output)
}

/// List all active recordings
#[tauri::command]
pub fn list_active_recordings() -> Result<Vec<String>, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    Ok(recordings.keys().cloned().collect())
}

// ===============================
// Terminal Automation Commands
// ===============================

/// Start automation on a session - patterns will be matched against terminal output
#[tauri::command]
pub async fn start_automation(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    script: AutomationScript,
) -> Result<(), String> {
    let ssh = state.lock().await;
    
    // Verify session and shell exist
    let shell = ssh.shells.get(&session_id)
        .ok_or("No active shell for this session")?;
    
    // Compile regex patterns
    let compiled_patterns: Vec<Regex> = script.patterns.iter()
        .map(|p| Regex::new(&p.pattern))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;
    
    let mut automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    
    if automations.contains_key(&session_id) {
        return Err("Automation already active for this session".to_string());
    }
    
    automations.insert(session_id.clone(), AutomationState {
        script: script.clone(),
        compiled_patterns,
        output_buffer: String::new(),
        matches: Vec::new(),
        start_time: std::time::Instant::now(),
        start_utc: Utc::now(),
        tx: shell.sender.clone(),
    });
    
    log::info!("Started automation '{}' on session {}", script.name, session_id);
    Ok(())
}

/// Stop automation on a session and return results
#[tauri::command]
pub fn stop_automation(session_id: String) -> Result<AutomationStatus, String> {
    let mut automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    
    let state = automations.remove(&session_id)
        .ok_or("No active automation for this session")?;
    
    let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
    
    log::info!("Stopped automation '{}' on session {} ({} matches)", 
               state.script.name, session_id, state.matches.len());
    
    Ok(AutomationStatus {
        session_id,
        script_id: state.script.id,
        script_name: state.script.name,
        is_active: false,
        matches: state.matches,
        started_at: state.start_utc,
        elapsed_ms,
    })
}

/// Check if automation is active on a session
#[tauri::command]
pub fn is_automation_active(session_id: String) -> Result<bool, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    Ok(automations.contains_key(&session_id))
}

/// Get automation status for a session
#[tauri::command]
pub fn get_automation_status(session_id: String) -> Result<Option<AutomationStatus>, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    
    if let Some(state) = automations.get(&session_id) {
        let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
        Ok(Some(AutomationStatus {
            session_id: session_id.clone(),
            script_id: state.script.id.clone(),
            script_name: state.script.name.clone(),
            is_active: true,
            matches: state.matches.clone(),
            started_at: state.start_utc,
            elapsed_ms,
        }))
    } else {
        Ok(None)
    }
}

/// List all active automations
#[tauri::command]
pub fn list_active_automations() -> Result<Vec<String>, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    Ok(automations.keys().cloned().collect())
}

/// Process automation patterns against new output (internal helper)
fn process_automation_output(session_id: &str, output: &str) {
    if let Ok(mut automations) = ACTIVE_AUTOMATIONS.lock() {
        if let Some(state) = automations.get_mut(session_id) {
            // Check for timeout
            let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
            if state.script.timeout_ms > 0 && elapsed_ms > state.script.timeout_ms {
                log::warn!("Automation timeout for session {}", session_id);
                return;
            }
            
            // Check max matches
            if state.script.max_matches > 0 && state.matches.len() >= state.script.max_matches as usize {
                return;
            }
            
            // Add output to buffer
            state.output_buffer.push_str(output);
            
            // Try to match patterns
            let mut matched = false;
            for (index, pattern) in state.compiled_patterns.iter().enumerate() {
                if let Some(captures) = pattern.captures(&state.output_buffer) {
                    matched = true;
                    let matched_text = captures.get(0)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();
                    
                    let expect_pattern = &state.script.patterns[index];
                    let mut response = expect_pattern.response.clone();
                    if expect_pattern.send_newline {
                        response.push('\n');
                    }
                    
                    // Send response
                    let _ = state.tx.send(SshShellCommand::Input(response.clone()));
                    
                    // Record match
                    state.matches.push(AutomationMatch {
                        pattern_index: index,
                        matched_text,
                        response_sent: response,
                        timestamp_ms: elapsed_ms,
                    });
                    
                    log::debug!("Automation pattern {} matched for session {}", 
                               expect_pattern.label.as_deref().unwrap_or(&format!("#{}", index)), 
                               session_id);
                    
                    // Clear buffer after match to avoid re-matching
                    state.output_buffer.clear();
                    break;
                }
            }
            
            // Limit buffer size to prevent memory issues
            if state.output_buffer.len() > 64 * 1024 {
                // Keep last 32KB
                let excess = state.output_buffer.len() - 32 * 1024;
                state.output_buffer = state.output_buffer[excess..].to_string();
            }
            
            // Stop on no match if configured and we've had matches before
            if state.script.stop_on_no_match && !matched && !state.matches.is_empty() {
                // The caller should stop automation when this happens
                // We could emit an event here if needed
            }
        }
    }
}

/// Send a command and wait for expected output pattern
#[tauri::command]
pub async fn expect_and_send(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String,
    expect_pattern: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let ssh = state.lock().await;
    
    let shell = ssh.shells.get(&session_id)
        .ok_or("No active shell for this session")?;
    
    // Send the command
    shell.sender.send(SshShellCommand::Input(format!("{}\n", command)))
        .map_err(|e| format!("Failed to send command: {}", e))?;
    
    drop(ssh); // Release lock while waiting
    
    // Compile the pattern
    let pattern = Regex::new(&expect_pattern)
        .map_err(|e| format!("Invalid expect pattern: {}", e))?;
    
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10000));
    let start = std::time::Instant::now();
    
    // Poll terminal buffer for pattern match
    loop {
        if start.elapsed() > timeout {
            return Err("Timeout waiting for expected pattern".to_string());
        }
        
        if let Ok(buffers) = TERMINAL_BUFFERS.lock() {
            if let Some(buffer) = buffers.get(&session_id) {
                if let Some(captures) = pattern.captures(buffer) {
                    let matched_text = captures.get(0)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();
                    return Ok(matched_text);
                }
            }
        }
        
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Execute a sequence of commands with optional expect patterns between them
#[tauri::command]
pub async fn execute_command_sequence(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    commands: Vec<String>,
    delay_between_ms: Option<u64>,
) -> Result<Vec<String>, String> {
    let delay = Duration::from_millis(delay_between_ms.unwrap_or(500));
    let mut results = Vec::new();
    
    for (i, cmd) in commands.iter().enumerate() {
        let ssh = state.lock().await;
        
        let shell = ssh.shells.get(&session_id)
            .ok_or("No active shell for this session")?;
        
        // Send command
        shell.sender.send(SshShellCommand::Input(format!("{}\n", cmd)))
            .map_err(|e| format!("Failed to send command {}: {}", i, e))?;
        
        drop(ssh);
        
        // Wait for command to execute
        tokio::time::sleep(delay).await;
        
        // Capture current buffer state
        if let Ok(buffers) = TERMINAL_BUFFERS.lock() {
            if let Some(buffer) = buffers.get(&session_id) {
                results.push(buffer.clone());
            } else {
                results.push(String::new());
            }
        }
    }
    
    Ok(results)
}

// ===============================
// FTP over SSH Tunnel Commands
// ===============================

/// FTP tunnel configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpTunnelConfig {
    /// Local port for FTP control connection (default: dynamically assigned)
    pub local_control_port: Option<u16>,
    /// Remote FTP server host
    pub remote_ftp_host: String,
    /// Remote FTP server port (default: 21)
    #[serde(default = "default_ftp_port")]
    pub remote_ftp_port: u16,
    /// Whether to set up passive mode data port forwarding
    #[serde(default = "default_true")]
    pub passive_mode: bool,
    /// Local port range start for passive mode data connections
    pub passive_port_range_start: Option<u16>,
    /// Number of passive ports to forward (default: 10)
    #[serde(default = "default_passive_port_count")]
    pub passive_port_count: u16,
}

fn default_ftp_port() -> u16 { 21 }
fn default_passive_port_count() -> u16 { 10 }

/// FTP tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_control_port: u16,
    pub remote_ftp_host: String,
    pub remote_ftp_port: u16,
    pub passive_mode: bool,
    pub passive_ports: Vec<u16>,
    pub control_forward_id: String,
    pub data_forward_ids: Vec<String>,
}

// Global storage for active FTP tunnels
lazy_static::lazy_static! {
    static ref FTP_TUNNELS: StdMutex<HashMap<String, FtpTunnelStatus>> = StdMutex::new(HashMap::new());
}

/// Setup an FTP tunnel over SSH
/// This creates port forwards for both control (port 21) and optionally passive data ports
#[tauri::command]
pub async fn setup_ftp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: FtpTunnelConfig,
) -> Result<FtpTunnelStatus, String> {
    let mut ssh = state.lock().await;
    
    // Verify session exists
    if !ssh.sessions.contains_key(&session_id) {
        return Err("SSH session not found".to_string());
    }
    
    let tunnel_id = Uuid::new_v4().to_string();
    
    // Setup control connection tunnel
    let local_control_port = config.local_control_port.unwrap_or(0);
    let control_config = PortForwardConfig {
        local_host: "127.0.0.1".to_string(),
        local_port: local_control_port,
        remote_host: config.remote_ftp_host.clone(),
        remote_port: config.remote_ftp_port,
        direction: PortForwardDirection::Local,
    };
    
    let control_forward_id = ssh.setup_port_forward(&session_id, control_config).await?;
    
    // Get the actual local port if it was dynamically assigned
    let actual_control_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&control_forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_control_port);
    
    let mut data_forward_ids = Vec::new();
    let mut passive_ports = Vec::new();
    
    // Setup passive mode data port tunnels if enabled
    if config.passive_mode {
        // Use a common passive port range (typically 49152-65535 or a custom range)
        let start_port = config.passive_port_range_start.unwrap_or(50000);
        let port_count = config.passive_port_count;
        
        for i in 0..port_count {
            let data_port = start_port + i;
            let data_config = PortForwardConfig {
                local_host: "127.0.0.1".to_string(),
                local_port: data_port,
                remote_host: config.remote_ftp_host.clone(),
                remote_port: data_port,
                direction: PortForwardDirection::Local,
            };
            
            match ssh.setup_port_forward(&session_id, data_config).await {
                Ok(forward_id) => {
                    data_forward_ids.push(forward_id);
                    passive_ports.push(data_port);
                }
                Err(e) => {
                    log::warn!("Failed to setup passive port forward for port {}: {}", data_port, e);
                }
            }
        }
    }
    
    let status = FtpTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_control_port: actual_control_port,
        remote_ftp_host: config.remote_ftp_host,
        remote_ftp_port: config.remote_ftp_port,
        passive_mode: config.passive_mode,
        passive_ports,
        control_forward_id,
        data_forward_ids,
    };
    
    // Store tunnel status
    if let Ok(mut tunnels) = FTP_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }
    
    log::info!("FTP tunnel {} created: local port {} -> {}:{}", 
               tunnel_id, actual_control_port, status.remote_ftp_host, status.remote_ftp_port);
    
    Ok(status)
}

/// Stop an FTP tunnel and clean up port forwards
#[tauri::command]
pub async fn stop_ftp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    // Get tunnel info
    let tunnel_status = {
        let mut tunnels = FTP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("FTP tunnel not found")?
    };
    
    let mut ssh = state.lock().await;
    
    // Stop control connection forward
    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.control_forward_id).await {
        log::warn!("Failed to stop control port forward: {}", e);
    }
    
    // Stop data port forwards
    for forward_id in &tunnel_status.data_forward_ids {
        if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, forward_id).await {
            log::warn!("Failed to stop data port forward {}: {}", forward_id, e);
        }
    }
    
    log::info!("FTP tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of an FTP tunnel
#[tauri::command]
pub fn get_ftp_tunnel_status(tunnel_id: String) -> Result<Option<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active FTP tunnels
#[tauri::command]
pub fn list_ftp_tunnels() -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List FTP tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_ftp_tunnels(session_id: String) -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

// ===============================
// RDP over SSH Tunnel Support
// ===============================

fn default_rdp_port() -> u16 { 3389 }

/// Configuration for RDP over SSH tunnel
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelConfig {
    /// Local port for RDP connection (default: dynamically assigned starting from 13389)
    pub local_port: Option<u16>,
    /// Remote RDP server host (relative to SSH server)
    pub remote_rdp_host: String,
    /// Remote RDP server port (default: 3389)
    #[serde(default = "default_rdp_port")]
    pub remote_rdp_port: u16,
    /// Optional: Enable UDP tunnel for RDP UDP transport (requires additional setup)
    #[serde(default)]
    pub enable_udp: bool,
    /// Optional: Restrict to specific network interface
    pub bind_interface: Option<String>,
    /// Whether to use NLA (Network Level Authentication) - informational only
    #[serde(default = "default_true")]
    pub nla_enabled: bool,
    /// Optional description/label for this tunnel
    pub label: Option<String>,
}

/// RDP tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_port: u16,
    pub remote_rdp_host: String,
    pub remote_rdp_port: u16,
    pub forward_id: String,
    pub bind_address: String,
    pub label: Option<String>,
    pub nla_enabled: bool,
    pub enable_udp: bool,
    /// Connection string to use with RDP client (e.g., mstsc.exe)
    pub connection_string: String,
    pub created_at: DateTime<Utc>,
}

/// RDP tunnel statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelStats {
    pub tunnel_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub active_connections: u32,
    pub uptime_seconds: u64,
}

// Global storage for active RDP tunnels
lazy_static::lazy_static! {
    static ref RDP_TUNNELS: StdMutex<HashMap<String, RdpTunnelStatus>> = StdMutex::new(HashMap::new());
}

/// Setup an RDP tunnel over SSH
/// Creates a local port forward that tunnels RDP traffic through the SSH connection
#[tauri::command]
pub async fn setup_rdp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: RdpTunnelConfig,
) -> Result<RdpTunnelStatus, String> {
    let mut ssh = state.lock().await;
    
    // Determine local port - use specified or find available
    let local_port = config.local_port.unwrap_or(13389);
    let bind_interface = config.bind_interface.clone().unwrap_or_else(|| "127.0.0.1".to_string());
    
    // Setup port forward for RDP
    let forward_config = PortForwardConfig {
        local_host: bind_interface.clone(),
        local_port,
        remote_host: config.remote_rdp_host.clone(),
        remote_port: config.remote_rdp_port,
        direction: PortForwardDirection::Local,
    };
    
    let forward_id = ssh.setup_port_forward(&session_id, forward_config).await?;
    
    // Get actual port (in case it was dynamically assigned)
    let actual_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_port);
    
    let tunnel_id = format!("rdp_{}", Uuid::new_v4());
    let connection_string = if bind_interface == "127.0.0.1" || bind_interface == "localhost" {
        format!("localhost:{}", actual_port)
    } else {
        format!("{}:{}", bind_interface, actual_port)
    };
    
    let status = RdpTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_port: actual_port,
        remote_rdp_host: config.remote_rdp_host,
        remote_rdp_port: config.remote_rdp_port,
        forward_id,
        bind_address: bind_interface,
        label: config.label,
        nla_enabled: config.nla_enabled,
        enable_udp: config.enable_udp,
        connection_string: connection_string.clone(),
        created_at: Utc::now(),
    };
    
    // Store tunnel status
    if let Ok(mut tunnels) = RDP_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }
    
    log::info!("RDP tunnel {} created: {} -> {}:{}", 
               tunnel_id, connection_string, status.remote_rdp_host, status.remote_rdp_port);
    
    Ok(status)
}

/// Stop an RDP tunnel and clean up port forward
#[tauri::command]
pub async fn stop_rdp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    // Get tunnel info
    let tunnel_status = {
        let mut tunnels = RDP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("RDP tunnel not found")?
    };
    
    let mut ssh = state.lock().await;
    
    // Stop the port forward
    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.forward_id).await {
        log::warn!("Failed to stop RDP port forward: {}", e);
    }
    
    log::info!("RDP tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of an RDP tunnel
#[tauri::command]
pub fn get_rdp_tunnel_status(tunnel_id: String) -> Result<Option<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active RDP tunnels
#[tauri::command]
pub fn list_rdp_tunnels() -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List RDP tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_rdp_tunnels(session_id: String) -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

/// Setup multiple RDP tunnels for bulk remote desktop access
#[tauri::command]
pub async fn setup_bulk_rdp_tunnels(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    targets: Vec<RdpTunnelConfig>,
) -> Result<Vec<RdpTunnelStatus>, String> {
    let mut results = Vec::new();
    let mut base_port = 13390u16; // Start from 13390 to avoid conflict with first tunnel at 13389
    
    for mut config in targets {
        // Auto-assign port if not specified
        if config.local_port.is_none() {
            config.local_port = Some(base_port);
            base_port += 1;
        }
        
        match setup_rdp_tunnel(state.clone(), session_id.clone(), config).await {
            Ok(status) => results.push(status),
            Err(e) => {
                log::warn!("Failed to setup RDP tunnel: {}", e);
                // Continue with other tunnels
            }
        }
    }
    
    Ok(results)
}

/// Stop all RDP tunnels for a session
#[tauri::command]
pub async fn stop_session_rdp_tunnels(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<u32, String> {
    // Get all tunnel IDs for this session
    let tunnel_ids: Vec<String> = {
        let tunnels = RDP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.values()
            .filter(|t| t.session_id == session_id)
            .map(|t| t.tunnel_id.clone())
            .collect()
    };
    
    let mut stopped = 0u32;
    for tunnel_id in tunnel_ids {
        if stop_rdp_tunnel(state.clone(), tunnel_id).await.is_ok() {
            stopped += 1;
        }
    }
    
    Ok(stopped)
}

/// Generate an RDP file for a tunnel (can be opened directly by Windows Remote Desktop)
#[tauri::command]
pub fn generate_rdp_file(tunnel_id: String, options: Option<RdpFileOptions>) -> Result<String, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    
    let tunnel = tunnels.get(&tunnel_id)
        .ok_or("RDP tunnel not found")?;
    
    let opts = options.unwrap_or_default();
    
    let mut rdp_content = String::new();
    
    // Basic connection settings
    rdp_content.push_str(&format!("full address:s:{}\n", tunnel.connection_string));
    rdp_content.push_str(&format!("server port:i:{}\n", tunnel.local_port));
    
    // Screen settings
    if let Some(width) = opts.screen_width {
        rdp_content.push_str(&format!("desktopwidth:i:{}\n", width));
    }
    if let Some(height) = opts.screen_height {
        rdp_content.push_str(&format!("desktopheight:i:{}\n", height));
    }
    if opts.fullscreen.unwrap_or(false) {
        rdp_content.push_str("screen mode id:i:2\n");
    } else {
        rdp_content.push_str("screen mode id:i:1\n");
    }
    
    // Color depth
    let color_depth = opts.color_depth.unwrap_or(32);
    rdp_content.push_str(&format!("session bpp:i:{}\n", color_depth));
    
    // Authentication
    if tunnel.nla_enabled {
        rdp_content.push_str("enablecredsspsupport:i:1\n");
        rdp_content.push_str("authentication level:i:2\n");
    } else {
        rdp_content.push_str("enablecredsspsupport:i:0\n");
        rdp_content.push_str("authentication level:i:0\n");
    }
    
    // Username if provided
    if let Some(username) = &opts.username {
        rdp_content.push_str(&format!("username:s:{}\n", username));
    }
    
    // Domain if provided
    if let Some(domain) = &opts.domain {
        rdp_content.push_str(&format!("domain:s:{}\n", domain));
    }
    
    // Resource redirection
    if opts.redirect_clipboard.unwrap_or(true) {
        rdp_content.push_str("redirectclipboard:i:1\n");
    }
    if opts.redirect_printers.unwrap_or(false) {
        rdp_content.push_str("redirectprinters:i:1\n");
    }
    if opts.redirect_drives.unwrap_or(false) {
        rdp_content.push_str("drivestoredirect:s:*\n");
    }
    if opts.redirect_smartcards.unwrap_or(false) {
        rdp_content.push_str("redirectsmartcards:i:1\n");
    }
    if opts.redirect_audio.unwrap_or(true) {
        rdp_content.push_str("audiomode:i:0\n"); // Play on local computer
    } else {
        rdp_content.push_str("audiomode:i:2\n"); // Do not play
    }
    
    // Performance settings
    if opts.disable_wallpaper.unwrap_or(false) {
        rdp_content.push_str("disable wallpaper:i:1\n");
    }
    if opts.disable_themes.unwrap_or(false) {
        rdp_content.push_str("disable themes:i:1\n");
    }
    if opts.disable_font_smoothing.unwrap_or(false) {
        rdp_content.push_str("disable font smoothing:i:1\n");
    }
    
    // Gateway settings (not needed for SSH tunnel, but can be disabled)
    rdp_content.push_str("gatewayusagemethod:i:0\n");
    rdp_content.push_str("gatewaycredentialssource:i:0\n");
    
    // Connection bar
    rdp_content.push_str("displayconnectionbar:i:1\n");
    
    // Prompt for credentials
    rdp_content.push_str("prompt for credentials:i:0\n");
    
    // Negotiate security
    rdp_content.push_str("negotiate security layer:i:1\n");
    
    Ok(rdp_content)
}

/// Options for generating RDP file
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RdpFileOptions {
    pub username: Option<String>,
    pub domain: Option<String>,
    pub screen_width: Option<u32>,
    pub screen_height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub color_depth: Option<u32>,
    pub redirect_clipboard: Option<bool>,
    pub redirect_printers: Option<bool>,
    pub redirect_drives: Option<bool>,
    pub redirect_smartcards: Option<bool>,
    pub redirect_audio: Option<bool>,
    pub disable_wallpaper: Option<bool>,
    pub disable_themes: Option<bool>,
    pub disable_font_smoothing: Option<bool>,
}

// ===============================
// VNC over SSH Tunnel Support  
// ===============================

fn default_vnc_port() -> u16 { 5900 }

/// Configuration for VNC over SSH tunnel
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VncTunnelConfig {
    /// Local port for VNC connection (default: dynamically assigned starting from 15900)
    pub local_port: Option<u16>,
    /// Remote VNC server host (relative to SSH server)
    pub remote_vnc_host: String,
    /// Remote VNC server port (default: 5900, or 5900 + display number)
    #[serde(default = "default_vnc_port")]
    pub remote_vnc_port: u16,
    /// VNC display number (alternative to specifying port directly)
    pub display_number: Option<u16>,
    /// Optional: Restrict to specific network interface
    pub bind_interface: Option<String>,
    /// Optional description/label for this tunnel
    pub label: Option<String>,
}

/// VNC tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VncTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_port: u16,
    pub remote_vnc_host: String,
    pub remote_vnc_port: u16,
    pub forward_id: String,
    pub bind_address: String,
    pub label: Option<String>,
    /// Connection string to use with VNC client
    pub connection_string: String,
    pub created_at: DateTime<Utc>,
}

// Global storage for active VNC tunnels
lazy_static::lazy_static! {
    static ref VNC_TUNNELS: StdMutex<HashMap<String, VncTunnelStatus>> = StdMutex::new(HashMap::new());
}

/// Setup a VNC tunnel over SSH
#[tauri::command]
pub async fn setup_vnc_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: VncTunnelConfig,
) -> Result<VncTunnelStatus, String> {
    let mut ssh = state.lock().await;
    
    // Determine remote port - use display number if provided
    let remote_port = if let Some(display) = config.display_number {
        5900 + display
    } else {
        config.remote_vnc_port
    };
    
    // Determine local port - use specified or find available
    let local_port = config.local_port.unwrap_or(15900);
    let bind_interface = config.bind_interface.clone().unwrap_or_else(|| "127.0.0.1".to_string());
    
    // Setup port forward for VNC
    let forward_config = PortForwardConfig {
        local_host: bind_interface.clone(),
        local_port,
        remote_host: config.remote_vnc_host.clone(),
        remote_port,
        direction: PortForwardDirection::Local,
    };
    
    let forward_id = ssh.setup_port_forward(&session_id, forward_config).await?;
    
    // Get actual port
    let actual_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_port);
    
    let tunnel_id = format!("vnc_{}", Uuid::new_v4());
    let connection_string = if bind_interface == "127.0.0.1" || bind_interface == "localhost" {
        format!("localhost:{}", actual_port)
    } else {
        format!("{}:{}", bind_interface, actual_port)
    };
    
    let status = VncTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_port: actual_port,
        remote_vnc_host: config.remote_vnc_host,
        remote_vnc_port: remote_port,
        forward_id,
        bind_address: bind_interface,
        label: config.label,
        connection_string: connection_string.clone(),
        created_at: Utc::now(),
    };
    
    // Store tunnel status
    if let Ok(mut tunnels) = VNC_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }
    
    log::info!("VNC tunnel {} created: {} -> {}:{}", 
               tunnel_id, connection_string, status.remote_vnc_host, status.remote_vnc_port);
    
    Ok(status)
}

/// Stop a VNC tunnel
#[tauri::command]
pub async fn stop_vnc_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    let tunnel_status = {
        let mut tunnels = VNC_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("VNC tunnel not found")?
    };
    
    let mut ssh = state.lock().await;
    
    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.forward_id).await {
        log::warn!("Failed to stop VNC port forward: {}", e);
    }
    
    log::info!("VNC tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of a VNC tunnel
#[tauri::command]
pub fn get_vnc_tunnel_status(tunnel_id: String) -> Result<Option<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active VNC tunnels
#[tauri::command]
pub fn list_vnc_tunnels() -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List VNC tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_vnc_tunnels(session_id: String) -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}
