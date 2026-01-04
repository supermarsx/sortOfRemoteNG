use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio::task;
use tokio::sync::mpsc;

pub type TelnetServiceState = Arc<Mutex<TelnetService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub connected: bool,
    pub username: Option<String>,
}

#[derive(Debug)]
struct TelnetConnection {
    session: TelnetSession,
    shutdown_tx: mpsc::Sender<()>,
    _handle: task::JoinHandle<()>,
}

pub struct TelnetService {
    connections: HashMap<String, TelnetConnection>,
}

impl TelnetService {
    pub fn new() -> TelnetServiceState {
        Arc::new(Mutex::new(TelnetService {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_telnet(&mut self, host: String, port: u16, username: Option<String>) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Create channels for shutdown signaling
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        // Connect to the telnet server
        let mut stream = TcpStream::connect(format!("{}:{}", host, port))
            .await
            .map_err(|e| format!("Failed to connect to {}:{}: {}", host, port, e))?;

        // Create session info
        let session = TelnetSession {
            id: session_id.clone(),
            host: host.clone(),
            port,
            connected: true,
            username: username.clone(),
        };

        // Spawn a task to handle the connection
        let handle = {
            let shutdown_rx = shutdown_rx;

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
                                    // For telnet, we might want to handle telnet protocol commands
                                    // For now, just log the data
                                    println!("Telnet received: {:?}", String::from_utf8_lossy(data));
                                }
                                Err(e) => {
                                    eprintln!("Telnet read error: {}", e);
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

        let connection = TelnetConnection {
            session: session.clone(),
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), connection);

        Ok(session_id)
    }

    pub async fn disconnect_telnet(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.remove(session_id) {
            // Send shutdown signal
            let _ = connection.shutdown_tx.send(()).await;

            // Wait for the task to finish
            let _ = connection._handle.await;

            Ok(())
        } else {
            Err("Telnet session not found".to_string())
        }
    }

    pub async fn send_telnet_command(&mut self, _session_id: &str, _command: String) -> Result<(), String> {
        // In this basic implementation, we don't maintain a persistent stream for sending commands
        // A more complete implementation would need to use channels or other IPC mechanisms
        Err("Command sending not implemented in this basic telnet client".to_string())
    }

    pub async fn get_telnet_session_info(&self, session_id: &str) -> Result<TelnetSession, String> {
        if let Some(connection) = self.connections.get(session_id) {
            Ok(connection.session.clone())
        } else {
            Err("Telnet session not found".to_string())
        }
    }

    pub async fn list_telnet_sessions(&self) -> Vec<TelnetSession> {
        self.connections.values()
            .map(|conn| conn.session.clone())
            .collect()
    }
}

#[tauri::command]
pub async fn connect_telnet(
    host: String,
    port: u16,
    username: Option<String>,
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_telnet(host, port, username).await
}

#[tauri::command]
pub async fn disconnect_telnet(
    session_id: String,
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_telnet(&session_id).await
}

#[tauri::command]
pub async fn send_telnet_command(
    session_id: String,
    command: String,
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_telnet_command(&session_id, command).await
}

#[tauri::command]
pub async fn get_telnet_session_info(
    session_id: String,
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<TelnetSession, String> {
    let service = state.lock().await;
    service.get_telnet_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_telnet_sessions(
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<Vec<TelnetSession>, String> {
    let service = state.lock().await;
    Ok(service.list_telnet_sessions().await)
}