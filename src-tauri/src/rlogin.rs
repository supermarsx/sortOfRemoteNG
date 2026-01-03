use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;

pub type RloginServiceState = Arc<Mutex<RloginService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RloginSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub local_username: String,
    pub remote_username: String,
    pub terminal_type: String,
    pub connected: bool,
}

#[derive(Debug)]
struct RloginConnection {
    session: RloginSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct RloginService {
    connections: HashMap<String, RloginConnection>,
}

impl RloginService {
    pub fn new() -> RloginServiceState {
        Arc::new(Mutex::new(RloginService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_rlogin(
        &mut self,
        host: String,
        port: u16,
        local_username: String,
        remote_username: String,
        terminal_type: String,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Connect to the rlogin server
        let mut stream = TcpStream::connect(format!("{}:{}", host, port))
            .await
            .map_err(|e| format!("Failed to connect to {}:{}: {}", host, port, e))?;

        // Send rlogin protocol initialization
        // Rlogin protocol: null + local_username + null + remote_username + null + terminal_type + null
        let init_data = format!("\0{}\0{}\0{}\0", local_username, remote_username, terminal_type);
        stream.write_all(init_data.as_bytes())
            .await
            .map_err(|e| format!("Failed to send rlogin initialization: {}", e))?;

        // Create session info
        let session = RloginSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            local_username: local_username.clone(),
            remote_username: remote_username.clone(),
            terminal_type: terminal_type.clone(),
            connected: true,
        };

        // Spawn a task to handle the connection
        let handle = {
            let session_id = session_id.clone();

            task::spawn(async move {
                let mut buf = [0; 1024];
                let mut shutdown_rx = shutdown_rx;

                loop {
                    tokio::select! {
                        result = stream.read(&mut buf) => {
                            match result {
                                Ok(0) => {
                                    // Connection closed
                                    break;
                                }
                                Ok(n) => {
                                    // Process received data
                                    let data = &buf[..n];
                                    // Handle rlogin protocol specifics if needed
                                    println!("Rlogin received: {:?}", String::from_utf8_lossy(data));
                                }
                                Err(e) => {
                                    eprintln!("Rlogin read error: {}", e);
                                    break;
                                }
                            }
                        }
                        _ = shutdown_rx.recv() => {
                            // Shutdown signal received
                            break;
                        }
                    }
                }

                // Clean up connection
                let _ = stream.shutdown().await;
            })
        };

        let connection = RloginConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    pub async fn disconnect_rlogin(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(session_id) {
            // Send shutdown signal
            let _ = connection.shutdown_tx.send(()).await;

            // Wait for the task to finish
            let _ = connection._handle.await;

            Ok(())
        } else {
            Err("Rlogin session not found".to_string())
        }
    }

    pub async fn send_rlogin_command(&mut self, _session_id: &str, _command: String) -> Result<(), String> {
        // In this basic implementation, we don't maintain a persistent stream for sending commands
        // A more complete implementation would need to use channels or other IPC mechanisms
        Err("Command sending not implemented in this basic rlogin client".to_string())
    }

    pub async fn get_rlogin_session_info(&self, session_id: &str) -> Result<RloginSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err("Rlogin session not found".to_string())
        }
    }

    pub async fn list_rlogin_sessions(&self) -> Vec<RloginSession> {
        self.connections.values()
            .map(|conn| conn.session.clone())
            .collect()
    }
}

#[tauri::command]
pub async fn connect_rlogin(
    host: String,
    port: u16,
    local_username: String,
    remote_username: String,
    terminal_type: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_rlogin(host, port, local_username, remote_username, terminal_type).await
}

#[tauri::command]
pub async fn disconnect_rlogin(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_rlogin(&session_id).await
}

#[tauri::command]
pub async fn send_rlogin_command(
    session_id: String,
    command: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_rlogin_command(&session_id, command).await
}

#[tauri::command]
pub async fn get_rlogin_session_info(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<RloginSession, String> {
    let service = state.lock().await;
    service.get_rlogin_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_rlogin_sessions(
    state: tauri::State<'_, RloginServiceState>,
) -> Result<Vec<RloginSession>, String> {
    let service = state.lock().await;
    Ok(service.list_rlogin_sessions().await)
}