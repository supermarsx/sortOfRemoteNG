use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use russh::*;
use russh_keys::*;
use async_trait::async_trait;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use futures::future::join_all;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Clone)]
pub struct SshBridgeServer {
    clients: Arc<Mutex<HashMap<Uuid, russh::server::Handle>>>,
    config: Arc<russh::server::Config>,
}

impl SshBridgeServer {
    pub fn new() -> Self {
        let mut config = russh::server::Config::default();
        config.auth_rejection_time = std::time::Duration::from_secs(3);
        config.auth_rejection_time_initial = Some(std::time::Duration::from_secs(0));
        config.keys = vec![russh_keys::key::KeyPair::generate_ed25519().unwrap()];

        SshBridgeServer {
            clients: Arc::new(Mutex::new(HashMap::new())),
            config: Arc::new(config),
        }
    }

    pub async fn start_server(&self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(addr).await?;
        log::info!("SSH Bridge server listening on {}", addr);

        loop {
            let (socket, _) = listener.accept().await?;
            let server_clone = self.clone();

            tokio::spawn(async move {
                let config = server_clone.config.clone();
                if let Err(e) = russh::server::run_stream(config, socket, server_clone).await {
                    log::error!("SSH server error: {}", e);
                }
            });
        }
    }

    pub async fn get_connected_clients(&self) -> Vec<Uuid> {
        let clients = self.clients.lock().await;
        clients.keys().cloned().collect()
    }

    pub async fn disconnect_client(&self, client_id: Uuid) -> Result<(), Box<dyn std::error::Error>> {
        let mut clients = self.clients.lock().await;
        clients.remove(&client_id);
        // Note: The handle doesn't have a disconnect method in this version
        Ok(())
    }
}

#[async_trait]
impl russh::server::Server for SshBridgeServer {
    type Handler = SshBridgeHandler;

    fn new_client(&mut self, peer_addr: Option<SocketAddr>) -> Self::Handler {
        let client_id = Uuid::new_v4();
        log::info!("New SSH client connected: {:?} (ID: {})", peer_addr, client_id);

        SshBridgeHandler {
            client_id,
            server: self.clone(),
            authenticated: false,
            username: None,
            channels: HashMap::new(),
        }
    }
}

pub struct SshBridgeHandler {
    client_id: Uuid,
    server: SshBridgeServer,
    authenticated: bool,
    username: Option<String>,
    channels: HashMap<russh::ChannelId, russh::Channel<russh::server::Msg>>,
}

#[async_trait]
impl russh::server::Handler for SshBridgeHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<russh::server::Auth, Self::Error> {
        log::info!("Password auth attempt for user: {}", user);

        // For demo purposes, accept any user/password combination
        // In production, you'd validate against your user database
        self.authenticated = true;
        self.username = Some(user.to_string());

        {
            let mut clients = self.server.clients.lock().await;
            // Note: We can't store the handle here as it's not yet available
            // We'll store it in the channel_open_session method
        }

        Ok(russh::server::Auth::Accept)
    }

    async fn auth_publickey(&mut self, user: &str, public_key: &russh_keys::key::PublicKey) -> Result<russh::server::Auth, Self::Error> {
        log::info!("Public key auth attempt for user: {}", user);

        // For demo purposes, accept any public key
        // In production, you'd validate against authorized keys
        self.authenticated = true;
        self.username = Some(user.to_string());

        Ok(russh::server::Auth::Accept)
    }

    async fn channel_open_session(&mut self, channel: russh::Channel<russh::server::Msg>, session: &mut russh::server::Session) -> Result<bool, Self::Error> {
        if !self.authenticated {
            return Ok(false);
        }

        log::info!("Session channel opened for client {}", self.client_id);

        // Store the client handle
        {
            let mut clients = self.server.clients.lock().await;
            // Note: We can't directly get the handle here, but we can mark the client as active
        }

        self.channels.insert(channel.id(), channel);
        Ok(true)
    }

    async fn exec_request(&mut self, channel_id: russh::ChannelId, data: &[u8], session: &mut russh::server::Session) -> Result<(), Self::Error> {
        if !self.authenticated {
            session.channel_failure(channel_id).await?;
            return Ok(());
        }

        let command = String::from_utf8_lossy(data);
        log::info!("Executing command for client {}: {}", self.client_id, command);

        if let Some(channel) = self.channels.get(&channel_id) {
            // Execute the command and send output
            // This is a simplified implementation
            let output = format!("Command executed: {}\n", command.trim());

            session.data(channel_id, russh::CryptoVec::from(output.as_bytes().to_vec()))?;
            session.exit_status_request(channel_id, 0)?;
            session.channel_failure(channel_id).await?;
        }

        Ok(())
    }

    async fn shell_request(&mut self, channel_id: russh::ChannelId, session: &mut russh::server::Session) -> Result<(), Self::Error> {
        if !self.authenticated {
            session.channel_failure(channel_id).await?;
            return Ok(());
        }

        log::info!("Shell request for client {}", self.client_id);

        // Send a welcome message
        let welcome = "Welcome to SSH Bridge Server\n$ ";
        session.data(channel_id, russh::CryptoVec::from(welcome.as_bytes().to_vec()))?;

        Ok(())
    }

    async fn data(&mut self, channel_id: russh::ChannelId, data: &[u8], session: &mut russh::server::Session) -> Result<(), Self::Error> {
        if !self.authenticated {
            return Ok(());
        }

        let input = String::from_utf8_lossy(data);
        log::info!("Received data from client {}: {}", self.client_id, input.trim());

        // Echo back the input with a prompt
        let response = format!("Echo: {}\n$ ", input.trim());
        session.data(channel_id, russh::CryptoVec::from(response.as_bytes().to_vec()))?;

        Ok(())
    }

    async fn channel_close(&mut self, channel_id: russh::ChannelId, session: &mut russh::server::Session) -> Result<(), Self::Error> {
        log::info!("Channel {} closed for client {}", channel_id, self.client_id);
        self.channels.remove(&channel_id);
        Ok(())
    }

    async fn tcpip_forward(&mut self, address: &str, port: u32, session: &mut russh::server::Session) -> Result<bool, Self::Error> {
        if !self.authenticated {
            return Ok(false);
        }

        log::info!("TCP/IP forward request for {}:{} by client {}", address, port, self.client_id);

        // For demo purposes, accept all forward requests
        // In production, you'd implement proper access control
        Ok(true)
    }
}

// SSH Client Bridge for connecting to remote servers
pub struct SshClientBridge {
    connections: Arc<Mutex<HashMap<String, russh::client::Handle<SshClientHandler>>>>,
}

impl SshClientBridge {
    pub fn new() -> Self {
        SshClientBridge {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect_to_remote(
        &self,
        connection_id: &str,
        host: &str,
        port: u16,
        username: &str,
        auth_method: AuthMethod,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let config = russh::client::Config::default();
        let mut session = russh::client::connect(Arc::new(config), (host, port), SshClientHandler::new()).await?;

        match auth_method {
            AuthMethod::Password(password) => {
                session.authenticate_password(username, password).await?;
            }
            AuthMethod::PublicKey(key_path) => {
                let key_pair = russh_keys::load_secret_key(key_path, None)?;
                session.authenticate_publickey(username, Arc::new(key_pair)).await?;
            }
        }

        {
            let mut connections = self.connections.lock().await;
            connections.insert(connection_id.to_string(), session);
        }

        Ok(())
    }

    pub async fn execute_on_remote(
        &self,
        connection_id: &str,
        command: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let mut connections = self.connections.lock().await;
        if let Some(session) = connections.get_mut(connection_id) {
            let mut channel = session.channel_open_session().await?;
            channel.exec(true, command).await?;

            let mut output = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                match channel.read(&mut buf).await? {
                    0 => break,
                    n => output.extend_from_slice(&buf[..n]),
                }
            }

            channel.close().await?;
            Ok(String::from_utf8(output)?)
        } else {
            Err("Connection not found".into())
        }
    }

    pub async fn disconnect_remote(&self, connection_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let mut connections = self.connections.lock().await;
        if let Some(session) = connections.remove(connection_id) {
            session.disconnect().await?;
        }
        Ok(())
    }
}

pub enum AuthMethod {
    Password(String),
    PublicKey(String),
}

pub struct SshClientHandler;

impl SshClientHandler {
    pub fn new() -> Self {
        SshClientHandler
    }
}

#[async_trait]
impl russh::client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _server_public_key: &russh_keys::key::PublicKey) -> Result<bool, Self::Error> {
        // For demo purposes, accept any server key
        // In production, you'd implement proper host key verification
        Ok(true)
    }
}

// Bridge Manager that coordinates server and client bridges
pub struct SshBridgeManager {
    server: SshBridgeServer,
    client_bridge: SshClientBridge,
    tunnels: Arc<Mutex<HashMap<String, TunnelInfo>>>,
}

#[derive(Debug, Clone)]
pub struct TunnelInfo {
    pub id: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub direction: TunnelDirection,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub enum TunnelDirection {
    LocalToRemote,
    RemoteToLocal,
    Dynamic,
}

impl SshBridgeManager {
    pub fn new() -> Self {
        SshBridgeManager {
            server: SshBridgeServer::new(),
            client_bridge: SshClientBridge::new(),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_bridge_server(&self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.server.start_server(addr).await
    }

    pub async fn create_tunnel(
        &self,
        connection_id: &str,
        local_addr: &str,
        remote_addr: &str,
        direction: TunnelDirection,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let tunnel_id = Uuid::new_v4().to_string();

        let tunnel_info = TunnelInfo {
            id: tunnel_id.clone(),
            local_addr: local_addr.to_string(),
            remote_addr: remote_addr.to_string(),
            direction: direction.clone(),
            created_at: Utc::now(),
        };

        {
            let mut tunnels = self.tunnels.lock().await;
            tunnels.insert(tunnel_id.clone(), tunnel_info);
        }

        // Start the tunnel based on direction
        match direction {
            TunnelDirection::LocalToRemote => {
                self.start_local_to_remote_tunnel(&tunnel_id, local_addr, remote_addr).await?;
            }
            TunnelDirection::RemoteToLocal => {
                self.start_remote_to_local_tunnel(connection_id, &tunnel_id, local_addr, remote_addr).await?;
            }
            TunnelDirection::Dynamic => {
                self.start_dynamic_tunnel(&tunnel_id, local_addr).await?;
            }
        }

        Ok(tunnel_id)
    }

    async fn start_local_to_remote_tunnel(
        &self,
        tunnel_id: &str,
        local_addr: &str,
        remote_addr: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(local_addr).await?;
        log::info!("Local tunnel listening on {} for remote {}", local_addr, remote_addr);

        let tunnels = self.tunnels.clone();
        let remote_addr = remote_addr.to_string();

        tokio::spawn(async move {
            loop {
                if let Ok((socket, _)) = listener.accept().await {
                    let tunnels = tunnels.clone();
                    let remote_addr = remote_addr.clone();

                    tokio::spawn(async move {
                        // Forward traffic to remote destination
                        // This is a simplified implementation
                        log::info!("Accepted connection on tunnel, forwarding to {}", remote_addr);
                        // In a full implementation, you'd establish the SSH tunnel here
                    });
                }
            }
        });

        Ok(())
    }

    async fn start_remote_to_local_tunnel(
        &self,
        connection_id: &str,
        tunnel_id: &str,
        local_addr: &str,
        remote_addr: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Set up remote port forwarding
        log::info!("Setting up remote tunnel from {} to {}", remote_addr, local_addr);
        // Implementation would involve SSH reverse tunneling
        Ok(())
    }

    async fn start_dynamic_tunnel(
        &self,
        tunnel_id: &str,
        local_addr: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(local_addr).await?;
        log::info!("Dynamic tunnel (SOCKS proxy) listening on {}", local_addr);

        tokio::spawn(async move {
            loop {
                if let Ok((socket, _)) = listener.accept().await {
                    tokio::spawn(async move {
                        // Handle SOCKS5 protocol
                        log::info!("Accepted SOCKS connection");
                        // Full SOCKS5 implementation would go here
                    });
                }
            }
        });

        Ok(())
    }

    pub async fn list_tunnels(&self) -> Vec<TunnelInfo> {
        let tunnels = self.tunnels.lock().await;
        tunnels.values().cloned().collect()
    }

    pub async fn close_tunnel(&self, tunnel_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let mut tunnels = self.tunnels.lock().await;
        tunnels.remove(tunnel_id);
        log::info!("Closed tunnel {}", tunnel_id);
        Ok(())
    }

    pub async fn get_bridge_status(&self) -> BridgeStatus {
        let connected_clients = self.server.get_connected_clients().await;
        let active_tunnels = self.list_tunnels().await;

        BridgeStatus {
            server_running: true, // Simplified
            connected_clients: connected_clients.len(),
            active_tunnels: active_tunnels.len(),
            uptime: Utc::now().timestamp() as u64, // Simplified
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct BridgeStatus {
    pub server_running: bool,
    pub connected_clients: usize,
    pub active_tunnels: usize,
    pub uptime: u64,
}