use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpStream;
use uuid::Uuid;
use serde::{Deserialize, Serialize};

pub type VncServiceState = Arc<Mutex<VncService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub connected: bool,
}

pub struct VncService {
    sessions: HashMap<String, VncSession>,
}

impl VncService {
    pub fn new() -> VncServiceState {
        Arc::new(Mutex::new(VncService {
            sessions: HashMap::new(),
        }))
    }

    pub async fn connect_vnc(&mut self, host: String, port: u16, _password: Option<String>) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // For now, just establish a basic TCP connection to test connectivity
        // Full VNC protocol implementation would be much more complex
        match TcpStream::connect(format!("{}:{}", host, port)) {
            Ok(_stream) => {
                let session = VncSession {
                    id: session_id.clone(),
                    host,
                    port,
                    connected: true,
                };

                self.sessions.insert(session_id.clone(), session);
                Ok(format!("VNC session {} connected (basic TCP)", session_id))
            }
            Err(e) => {
                Err(format!("Failed to connect to VNC server {}:{}: {}", host, port, e))
            }
        }
    }

    pub async fn disconnect_vnc(&mut self, session_id: String) -> Result<(), String> {
        if let Some(mut session) = self.sessions.remove(&session_id) {
            session.connected = false;
            Ok(())
        } else {
            Err(format!("VNC session {} not found", session_id))
        }
    }

    pub async fn get_session_info(&self, session_id: &str) -> Result<VncSession, String> {
        if let Some(session) = self.sessions.get(session_id) {
            Ok(session.clone())
        } else {
            Err(format!("VNC session {} not found", session_id))
        }
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