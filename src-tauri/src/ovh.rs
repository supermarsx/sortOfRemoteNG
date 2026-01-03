use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type OvhServiceState = Arc<Mutex<OvhService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhConnectionConfig {
    pub api_key: String,
    pub service_id: Option<String>,
    pub project_name: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhSession {
    pub id: String,
    pub config: OvhConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub instances: Vec<OvhInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhInstance {
    pub id: String,
    pub name: String,
    pub status: String,
    pub flavor: String,
    pub region: String,
    pub ip_addresses: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct OvhService {
    sessions: HashMap<String, OvhSession>,
    client: Client,
}

impl OvhService {
    pub fn new() -> OvhServiceState {
        Arc::new(Mutex::new(OvhService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_ovh(&mut self, config: OvhConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_key.is_empty() {
            return Err("OVH API key is required".to_string());
        }

        let session = OvhSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            instances: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_ovh(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("OVH session not found".to_string())
        }
    }

    pub async fn list_instances(&mut self, session_id: &str) -> Result<Vec<OvhInstance>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("OVH session not found")?;

        if !session.is_connected {
            return Err("OVH session is not connected".to_string());
        }

        // TODO: Implement actual OVH API call to list instances
        // For now, return mock data
        let instances = vec![
            OvhInstance {
                id: "instance-1".to_string(),
                name: "ovh-instance-1".to_string(),
                status: "ACTIVE".to_string(),
                flavor: "s1-2".to_string(),
                region: session.config.region.clone().unwrap_or("GRA1".to_string()),
                ip_addresses: vec!["51.178.123.456".to_string()],
                created_at: Utc::now(),
                updated_at: Utc::now(),
            }
        ];

        // Update session with instances
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.instances = instances.clone();
            session.last_activity = Utc::now();
        }

        Ok(instances)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&OvhSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&OvhSession> {
        self.sessions.values().collect()
    }
}

impl Default for OvhService {
    fn default() -> Self {
        OvhService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_ovh(
    config: OvhConnectionConfig,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_ovh(config).await
}

#[tauri::command]
pub async fn disconnect_ovh(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_ovh(&session_id).await
}

#[tauri::command]
pub async fn list_ovh_instances(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<Vec<OvhInstance>, String> {
    let mut service = state.lock().await;
    service.list_instances(&session_id).await
}

#[tauri::command]
pub async fn get_ovh_session(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<OvhSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("OVH session not found".to_string())
}

#[tauri::command]
pub async fn list_ovh_sessions(
    state: tauri::State<'_, OvhServiceState>,
) -> Result<Vec<OvhSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}