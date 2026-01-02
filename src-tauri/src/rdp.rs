use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpStream;
use uuid::Uuid;
use serde::{Deserialize, Serialize};

pub type RdpServiceState = Arc<Mutex<RdpService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

pub struct RdpService {
    sessions: HashMap<String, RdpSession>,
}

impl RdpService {
    pub fn new() -> RdpServiceState {
        Arc::new(Mutex::new(RdpService {
            sessions: HashMap::new(),
        }))
    }

    pub async fn connect_rdp(&mut self, host: String, port: u16, username: String, _password: String) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // For now, just establish a basic TCP connection to test connectivity
        // Full RDP protocol implementation would be much more complex
        match TcpStream::connect(format!("{}:{}", host, port)) {
            Ok(_stream) => {
                let session = RdpSession {
                    id: session_id.clone(),
                    host,
                    port,
                    username,
                    connected: true,
                };

                self.sessions.insert(session_id.clone(), session);
                Ok(format!("RDP session {} connected (basic TCP)", session_id))
            }
            Err(e) => {
                Err(format!("Failed to connect to RDP server {}:{}: {}", host, port, e))
            }
        }
    }

    pub async fn disconnect_rdp(&mut self, session_id: String) -> Result<(), String> {
        if let Some(mut session) = self.sessions.remove(&session_id) {
            session.connected = false;
            Ok(())
        } else {
            Err(format!("RDP session {} not found", session_id))
        }
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<RdpSession, String> {
        if let Some(session) = self.sessions.get(session_id) {
            Ok(session.clone())
        } else {
            Err(format!("RDP session {} not found", session_id))
        }
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