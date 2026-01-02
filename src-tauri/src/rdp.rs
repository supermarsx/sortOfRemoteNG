use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpStream;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

pub type RdpServiceState = Arc<Mutex<RdpService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

#[derive(Debug)]
struct RdpConnection {
    session: RdpSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct RdpService {
    connections: HashMap<String, RdpConnection>,
}

impl RdpService {
    pub fn new() -> RdpServiceState {
        Arc::new(Mutex::new(RdpService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_rdp(&mut self, host: String, port: u16, username: String, _password: String) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        // Create session info
        let session = RdpSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            username: username.clone(),
            connected: true,
        };

        // Clone session for the connection handler
        let session_clone = session.clone();

        // Spawn a dedicated task for this RDP connection
        let handle = task::spawn(async move {
            Self::handle_rdp_connection(session_clone, shutdown_rx).await;
        });

        let connection = RdpConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(format!("RDP session {} connected and running on dedicated thread", session_id))
    }

    async fn handle_rdp_connection(session: RdpSession, mut shutdown_rx: mpsc::Receiver<()>) {
        println!("RDP connection handler started for session {}", session.id);

        // For now, just establish and maintain a basic TCP connection
        // In a full implementation, this would handle the RDP protocol
        match TcpStream::connect(format!("{}:{}", session.host, session.port)) {
            Ok(mut stream) => {
                println!("RDP TCP connection established for session {}", session.id);

                // Set up connection parameters (would be RDP-specific in full implementation)
                let _ = stream.set_nonblocking(true);

                // Connection maintenance loop
                loop {
                    tokio::select! {
                        // Check for shutdown signal
                        _ = shutdown_rx.recv() => {
                            println!("RDP session {} received shutdown signal", session.id);
                            break;
                        }
                        // In a full RDP implementation, this would handle:
                        // - RDP protocol messages
                        // - Input events from frontend
                        // - Screen updates to frontend
                        // - Keep-alive messages
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(30)) => {
                            // Send keep-alive or check connection health
                            println!("RDP session {} keep-alive", session.id);
                        }
                    }
                }

                println!("RDP connection handler ending for session {}", session.id);
            }
            Err(e) => {
                eprintln!("Failed to establish RDP TCP connection for session {}: {}", session.id, e);
            }
        }
    }

    pub async fn disconnect_rdp(&mut self, session_id: String) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(&session_id) {
            // Send shutdown signal to the connection handler
            let _ = connection.shutdown_tx.send(()).await;

            // Wait a bit for graceful shutdown (in production, might want to wait for task completion)
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            Ok(())
        } else {
            Err(format!("RDP session {} not found", session_id))
        }
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<RdpSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err(format!("RDP session {} not found", session_id))
        }
    }

    pub async fn list_sessions(&self) -> Vec<RdpSession> {
        self.connections.values().map(|conn| conn.session.clone()).collect()
    }
}

#[tauri::command]
pub async fn connect_rdp(state: tauri::State<'_, RdpServiceState>, host: String, port: u16, username: String, password: String) -> Result<String, String> {
    let mut rdp = state.lock().await;
    rdp.connect_rdp(host, port, username, password).await
}

#[tauri::command]
pub async fn disconnect_rdp(state: tauri::State<'_, RdpServiceState>, session_id: String) -> Result<(), String> {
    let mut rdp = state.lock().await;
    rdp.disconnect_rdp(session_id).await
}

#[tauri::command]
pub async fn get_rdp_session_info(state: tauri::State<'_, RdpServiceState>, session_id: String) -> Result<RdpSession, String> {
    let rdp = state.lock().await;
    rdp.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_rdp_sessions(state: tauri::State<'_, RdpServiceState>) -> Result<Vec<RdpSession>, String> {
    let rdp = state.lock().await;
    Ok(rdp.list_sessions().await)
}