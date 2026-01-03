use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type LinodeServiceState = Arc<Mutex<LinodeService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinodeConnectionConfig {
    pub api_key: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinodeSession {
    pub id: String,
    pub config: LinodeConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub linodes: Vec<LinodeInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinodeInstance {
    pub id: i32,
    pub label: String,
    pub status: String,
    pub region: String,
    pub type_name: String,
    pub ipv4: Vec<String>,
    pub ipv6: Option<String>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
}

pub struct LinodeService {
    sessions: HashMap<String, LinodeSession>,
    client: Client,
}

impl LinodeService {
    pub fn new() -> LinodeServiceState {
        Arc::new(Mutex::new(LinodeService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_linode(&mut self, config: LinodeConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_key.is_empty() {
            return Err("Linode API key is required".to_string());
        }

        let session = LinodeSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            linodes: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_linode(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("Linode session not found".to_string())
        }
    }

    pub async fn list_linodes(&mut self, session_id: &str) -> Result<Vec<LinodeInstance>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Linode session not found")?;

        if !session.is_connected {
            return Err("Linode session is not connected".to_string());
        }

        // TODO: Implement actual Linode API call to list instances
        // For now, return mock data
        let linodes = vec![
            LinodeInstance {
                id: 12345678,
                label: "linode-instance-1".to_string(),
                status: "running".to_string(),
                region: session.config.region.clone().unwrap_or("us-east".to_string()),
                type_name: "g6-standard-1".to_string(),
                ipv4: vec!["192.168.1.100".to_string()],
                ipv6: Some("2001:db8::1".to_string()),
                created: Utc::now(),
                updated: Utc::now(),
            }
        ];

        // Update session with linodes
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.linodes = linodes.clone();
            session.last_activity = Utc::now();
        }

        Ok(linodes)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&LinodeSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&LinodeSession> {
        self.sessions.values().collect()
    }
}

impl Default for LinodeService {
    fn default() -> Self {
        LinodeService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_linode(
    config: LinodeConnectionConfig,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_linode(config).await
}

#[tauri::command]
pub async fn disconnect_linode(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_linode(&session_id).await
}

#[tauri::command]
pub async fn list_linode_instances(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<Vec<LinodeInstance>, String> {
    let mut service = state.lock().await;
    service.list_linodes(&session_id).await
}

#[tauri::command]
pub async fn get_linode_session(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<LinodeSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("Linode session not found".to_string())
}

#[tauri::command]
pub async fn list_linode_sessions(
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<Vec<LinodeSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}