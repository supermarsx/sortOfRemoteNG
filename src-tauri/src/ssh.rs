use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use ssh2::Session;
use std::net::{TcpStream, TcpListener, SocketAddr};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::net::{TcpStream as AsyncTcpStream, TcpListener as AsyncTcpListener};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures::future::join_all;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::sync::mpsc;
use russh::*;
use russh_keys::*;
use async_trait::async_trait;
use shell_escape;
use crate::ssh_bridge::{SshBridgeManager, BridgeStatus, TunnelInfo, TunnelDirection};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub jump_hosts: Vec<JumpHostConfig>,
    pub connect_timeout: Option<u64>,
    pub keep_alive_interval: Option<u64>,
    pub strict_host_key_checking: bool,
    pub known_hosts_path: Option<String>,
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SshSession {
    pub id: String,
    #[serde(skip)]
    pub session: Session,
    pub config: SshConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub port_forwards: HashMap<String, PortForwardHandle>,
    pub keep_alive_handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug)]
pub struct PortForwardHandle {
    pub id: String,
    pub config: PortForwardConfig,
    pub handle: tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
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
    connection_pool: HashMap<String, Vec<SshSession>>,
    known_hosts: HashMap<String, String>,
    bridge_manager: SshBridgeManager,
}

impl SshService {
    pub fn new() -> SshServiceState {
        Arc::new(Mutex::new(SshService {
            sessions: HashMap::new(),
            connection_pool: HashMap::new(),
            known_hosts: HashMap::new(),
            bridge_manager: SshBridgeManager::new(),
        }))
    }

    pub async fn connect_ssh(&mut self, config: SshConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Handle jump hosts if specified
        let final_stream = if config.jump_hosts.is_empty() {
            self.establish_direct_connection(&config).await?
        } else {
            self.establish_jump_connection(&config).await?
        };

        let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
        sess.set_tcp_stream(final_stream);
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
        let addr = format!("{}:{}", config.host, config.port);
        let timeout = config.connect_timeout.unwrap_or(30);

        tokio::time::timeout(
            Duration::from_secs(timeout),
            AsyncTcpStream::connect(&addr)
        ).await
        .map_err(|_| format!("Connection timeout after {} seconds", timeout))?
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

        // Convert to blocking TcpStream for ssh2
        TcpStream::connect((config.host.as_str(), config.port))
            .map_err(|e| format!("Failed to establish TCP connection: {}", e))
    }

    async fn establish_jump_connection(&self, config: &SshConnectionConfig) -> Result<TcpStream, String> {
        let mut current_stream = self.establish_direct_connection(config).await?;

        for jump_host in &config.jump_hosts {
            let mut jump_session = Session::new()
                .map_err(|e| format!("Failed to create jump session: {}", e))?;
            jump_session.set_tcp_stream(current_stream);
            jump_session.handshake()
                .map_err(|e| format!("Jump host handshake failed: {}", e))?;

            // Authenticate with jump host
            self.authenticate_jump_session(&mut jump_session, jump_host)?;

            // Create tunnel to next host
            let local_addr = current_stream.local_addr()
                .map_err(|e| format!("Failed to get local address: {}", e))?;
            let local_port = local_addr.port();

            current_stream = TcpStream::connect((jump_host.host.as_str(), jump_host.port))
                .map_err(|e| format!("Failed to connect to jump host: {}", e))?;
        }

        Ok(current_stream)
    }

    fn authenticate_session(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        if let Some(password) = &config.password {
            session.userauth_password(&config.username, password)
                .map_err(|e| format!("Password authentication failed: {}", e))?;
        } else if let Some(key_path) = &config.private_key_path {
            let passphrase = config.private_key_passphrase.as_deref();
            session.userauth_pubkey_file(&config.username, None, Path::new(key_path), passphrase)
                .map_err(|e| format!("Key authentication failed: {}", e))?;
        } else {
            return Err("No authentication method provided".to_string());
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        Ok(())
    }

    fn authenticate_jump_session(&self, session: &mut Session, jump_config: &JumpHostConfig) -> Result<(), String> {
        if let Some(password) = &jump_config.password {
            session.userauth_password(&jump_config.username, password)
                .map_err(|e| format!("Jump host password authentication failed: {}", e))?;
        } else if let Some(key_path) = &jump_config.private_key_path {
            session.userauth_pubkey_file(&jump_config.username, None, Path::new(key_path), None)
                .map_err(|e| format!("Jump host key authentication failed: {}", e))?;
        } else {
            return Err("No authentication method for jump host".to_string());
        }

        if !session.authenticated() {
            return Err("Jump host authentication failed".to_string());
        }

        Ok(())
    }

    fn verify_host_key(&self, session: &mut Session, config: &SshConnectionConfig) -> Result<(), String> {
        let mut known_hosts_path = config.known_hosts_path.clone()
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
                // This is a simplified version - in practice you'd need access to the session
                log::debug!("Keep-alive for session {}", session_id);
            }
        })
    }

    pub async fn execute_command(&mut self, session_id: &str, command: String, timeout: Option<u64>) -> Result<String, String> {
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

    pub async fn start_shell(&mut self, session_id: &str) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let mut channel = session.session.channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        // Request pseudo-terminal
        channel.request_pty("xterm", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        // Return channel ID for future operations
        let channel_id = Uuid::new_v4().to_string();
        Ok(channel_id)
    }

    pub async fn setup_port_forward(&mut self, session_id: &str, config: PortForwardConfig) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or("Session not found")?;

        session.last_activity = Utc::now();

        let forward_id = Uuid::new_v4().to_string();

        let handle = match config.direction {
            PortForwardDirection::Local => {
                self.setup_local_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Remote => {
                self.setup_remote_port_forward(session, &config, forward_id.clone()).await?
            }
            PortForwardDirection::Dynamic => {
                self.setup_dynamic_port_forward(session, &config, forward_id.clone()).await?
            }
        };

        session.port_forwards.insert(forward_id.clone(), handle);
        Ok(forward_id)
    }

    async fn setup_local_port_forward(&self, session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        let listener = TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind local port: {}", e))?;

        let session_clone = session.session.clone();
        let config_clone = config.clone();

        let handle = tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept()
                    .map_err(|e| format!("Failed to accept connection: {}", e))?;

                let mut session = session_clone.clone();
                let config = config_clone.clone();

                tokio::spawn(async move {
                    let mut channel = session.channel_direct_tcpip(&config.remote_host, config.remote_port, None)
                        .map_err(|e| format!("Failed to create direct TCP channel: {}", e))?;

                    // Forward data between local stream and SSH channel
                    let mut local_stream = AsyncTcpStream::from_std(stream)?;
                    let (mut reader, mut writer) = tokio::io::split(local_stream);
                    let mut channel_reader = channel.stream(0);
                    let mut channel_writer = channel.stream(0);

                    let forward_task1 = tokio::io::copy(&mut reader, &mut channel_writer);
                    let forward_task2 = tokio::io::copy(&mut channel_reader, &mut writer);

                    tokio::select! {
                        result = forward_task1 => {
                            result.map_err(|e| format!("Forward error: {}", e))?;
                        }
                        result = forward_task2 => {
                            result.map_err(|e| format!("Reverse forward error: {}", e))?;
                        }
                    }
                    Ok(())
                });
            }
        });

        Ok(PortForwardHandle {
            id,
            config: config.clone(),
            handle,
        })
    }

    async fn setup_remote_port_forward(&self, session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        // Remote port forwarding - listen on remote host and forward to local
        session.session.channel_forward_listen(config.remote_port, Some(&config.remote_host), None)
            .map_err(|e| format!("Failed to setup remote port forward: {}", e))?;

        Ok(PortForwardHandle {
            id,
            config: config.clone(),
            handle: tokio::spawn(async { Ok(()) }),
        })
    }

    async fn setup_dynamic_port_forward(&self, session: &mut SshSession, config: &PortForwardConfig, id: String) -> Result<PortForwardHandle, String> {
        // Dynamic port forwarding (SOCKS proxy)
        let listener = TcpListener::bind(format!("{}:{}", config.local_host, config.local_port))
            .map_err(|e| format!("Failed to bind SOCKS port: {}", e))?;

        let session_clone = session.session.clone();

        let handle = tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept()
                    .map_err(|e| format!("Failed to accept SOCKS connection: {}", e))?;

                let session = session_clone.clone();

                tokio::spawn(async move {
                    // Handle SOCKS protocol
                    // This is a simplified implementation - full SOCKS5 would be more complex
                    let mut local_stream = AsyncTcpStream::from_std(stream)?;
                    let mut buf = [0u8; 512];

                    // Read SOCKS request
                    let n = local_stream.read(&mut buf).await
                        .map_err(|e| format!("Failed to read SOCKS request: {}", e))?;

                    if n < 10 || buf[0] != 5 {
                        return Err("Invalid SOCKS version".to_string());
                    }

                    // Send success response
                    local_stream.write_all(&[5, 0]).await
                        .map_err(|e| format!("Failed to send SOCKS response: {}", e))?;

                    Ok(())
                });
            }
        });

        Ok(PortForwardHandle {
            id,
            config: config.clone(),
            handle,
        })
    }

    pub async fn list_directory(&mut self, session_id: &str, path: &str) -> Result<Vec<std::fs::DirEntry>, String> {
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

    // Bridge-related methods
    pub async fn start_bridge_server(&self, address: &str) -> Result<(), String> {
        let bridge_manager = &self.bridge_manager;
        tokio::spawn(async move {
            if let Err(e) = bridge_manager.start_bridge_server(address).await {
                log::error!("Failed to start SSH bridge server: {}", e);
            }
        });
        Ok(())
    }

    pub async fn create_tunnel(&self, connection_id: &str, local_addr: &str, remote_addr: &str, direction: TunnelDirection) -> Result<String, String> {
        self.bridge_manager.create_tunnel(connection_id, local_addr, remote_addr, direction).await
            .map_err(|e| format!("Failed to create tunnel: {}", e))
    }

    pub async fn list_tunnels(&self) -> Vec<TunnelInfo> {
        self.bridge_manager.list_tunnels().await
    }

    pub async fn close_tunnel(&self, tunnel_id: &str) -> Result<(), String> {
        self.bridge_manager.close_tunnel(tunnel_id).await
            .map_err(|e| format!("Failed to close tunnel: {}", e))
    }

    pub async fn get_bridge_status(&self) -> BridgeStatus {
        self.bridge_manager.get_bridge_status().await
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
                let scp_command = format!("scp -t {}", remote_path);
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
    session_id: String
) -> Result<String, String> {
    let mut ssh = state.lock().await;
    ssh.start_shell(&session_id).await
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
    Ok(entries.into_iter().map(|e| e.path().to_string_lossy().to_string()).collect())
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
pub async fn start_bridge_server(
    state: tauri::State<'_, SshServiceState>,
    address: String
) -> Result<(), String> {
    let ssh = state.lock().await;
    ssh.start_bridge_server(&address).await
}

#[tauri::command]
pub async fn create_tunnel(
    state: tauri::State<'_, SshServiceState>,
    connection_id: String,
    local_addr: String,
    remote_addr: String,
    direction: TunnelDirection
) -> Result<String, String> {
    let ssh = state.lock().await;
    ssh.create_tunnel(&connection_id, &local_addr, &remote_addr, direction).await
}

#[tauri::command]
pub async fn list_tunnels(
    state: tauri::State<'_, SshServiceState>
) -> Result<Vec<TunnelInfo>, String> {
    let ssh = state.lock().await;
    Ok(ssh.list_tunnels().await)
}

#[tauri::command]
pub async fn close_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String
) -> Result<(), String> {
    let ssh = state.lock().await;
    ssh.close_tunnel(&tunnel_id).await
}

#[tauri::command]
pub async fn get_bridge_status(
    state: tauri::State<'_, SshServiceState>
) -> Result<BridgeStatus, String> {
    let ssh = state.lock().await;
    Ok(ssh.get_bridge_status().await)
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