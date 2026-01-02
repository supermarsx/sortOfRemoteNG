use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;
use tokio::net::TcpStream;

pub type VncServiceState = Arc<Mutex<VncService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub connected: bool,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub framebuffer_width: Option<u16>,
    pub framebuffer_height: Option<u16>,
    pub pixel_format: Option<String>,
}

#[derive(Debug)]
struct VncConnection {
    session: VncSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct VncService {
    connections: HashMap<String, VncConnection>,
}

impl VncService {
    pub fn new() -> VncServiceState {
        Arc::new(Mutex::new(VncService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_vnc(&mut self, host: String, port: u16, password: Option<String>) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = VncSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            username: None,
            connected: false,
            protocol_version: None,
            server_name: None,
            framebuffer_width: None,
            framebuffer_height: None,
            pixel_format: None,
        };

        // Clone session for the connection handler
        let session_clone = session.clone();

        // Spawn a dedicated task for this VNC connection
        let handle = task::spawn(async move {
            Self::handle_vnc_connection(session_clone, password, shutdown_rx).await;
        });

        let connection = VncConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(format!("VNC session {} initiated and running on dedicated thread", session_id))
    }

    async fn handle_vnc_connection(session: VncSession, password: Option<String>, mut shutdown_rx: mpsc::Receiver<()>) {
        println!("VNC connection handler started for session {}", session.id);

        // For now, implement a basic VNC protocol handler
        // This is a simplified implementation - a full VNC client would be much more complex
        let addr = format!("{}:{}", session.host, session.port);

        match TcpStream::connect(&addr).await {
            Ok(mut stream) => {
                println!("TCP connection established to VNC server at {}", addr);

                // Basic VNC protocol version negotiation
                match Self::negotiate_vnc_version(&mut stream).await {
                    Ok(version) => {
                        println!("VNC protocol version negotiated: {} for session {}", version, session.id);

                        // In a full implementation, we would:
                        // 1. Handle authentication
                        // 2. Negotiate security types
                        // 3. Initialize framebuffer
                        // 4. Handle protocol messages (framebuffer updates, input events, etc.)
                    }
                    Err(e) => {
                        eprintln!("VNC version negotiation failed for session {}: {}", session.id, e);
                        return;
                    }
                }

                // Connection maintenance loop
                loop {
                    tokio::select! {
                        // Check for shutdown signal
                        _ = shutdown_rx.recv() => {
                            println!("VNC session {} received shutdown signal", session.id);
                            break;
                        }
                        // Keep-alive and periodic updates
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(30)) => {
                            // Send keep-alive or check connection health
                            println!("VNC session {} keep-alive", session.id);
                        }
                    }
                }

                println!("VNC connection handler ending for session {}", session.id);
            }
            Err(e) => {
                eprintln!("Failed to establish TCP connection to {}: {}", addr, e);
            }
        }
    }

    pub async fn disconnect_vnc(&mut self, session_id: String) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(&session_id) {
            // Send shutdown signal to the connection handler
            let _ = connection.shutdown_tx.send(()).await;

            // Wait a bit for graceful shutdown
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            Ok(())
        } else {
            Err(format!("VNC session {} not found", session_id))
        }
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<VncSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err(format!("VNC session {} not found", session_id))
        }
    }

    pub async fn list_sessions(&self) -> Vec<VncSession> {
        self.connections.values().map(|conn| conn.session.clone()).collect()
    }
}

impl VncService {
    async fn negotiate_vnc_version(stream: &mut TcpStream) -> Result<String, String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // Read server version (12 bytes: "RFB xxx.xxx\n")
        let mut version_buf = [0u8; 12];
        stream.read_exact(&mut version_buf).await
            .map_err(|e| format!("Failed to read VNC version: {}", e))?;

        let version_str = String::from_utf8_lossy(&version_buf);
        println!("Received VNC server version: {}", version_str.trim());

        // Parse version
        let version = if version_str.starts_with("RFB 003.003") {
            "3.3"
        } else if version_str.starts_with("RFB 003.007") {
            "3.7"
        } else if version_str.starts_with("RFB 003.008") {
            "3.8"
        } else if version_str.starts_with("RFB 004.000") {
            "4.0"
        } else if version_str.starts_with("RFB 004.001") {
            "4.1"
        } else {
            return Err(format!("Unsupported VNC version: {}", version_str.trim()));
        };

        // Respond with our supported version (we'll use 3.8 for compatibility)
        let response = b"RFB 003.008\n";
        stream.write_all(response).await
            .map_err(|e| format!("Failed to send VNC version response: {}", e))?;

        Ok(version.to_string())
    }
}

#[tauri::command]
pub async fn connect_vnc(state: tauri::State<'_, VncServiceState>, host: String, port: u16, password: Option<String>) -> Result<String, String> {
    let mut vnc = state.lock().await;
    vnc.connect_vnc(host, port, password).await
}

#[tauri::command]
pub async fn disconnect_vnc(state: tauri::State<'_, VncServiceState>, session_id: String) -> Result<(), String> {
    let mut vnc = state.lock().await;
    vnc.disconnect_vnc(session_id).await
}

#[tauri::command]
pub async fn get_vnc_session_info(state: tauri::State<'_, VncServiceState>, session_id: String) -> Result<VncSession, String> {
    let vnc = state.lock().await;
    vnc.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_vnc_sessions(state: tauri::State<'_, VncServiceState>) -> Result<Vec<VncSession>, String> {
    let vnc = state.lock().await;
    Ok(vnc.list_sessions().await)
}