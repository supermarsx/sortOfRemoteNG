use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type HerokuServiceState = Arc<Mutex<HerokuService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerokuConnectionConfig {
    pub api_key: String,
    pub app_name: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerokuSession {
    pub id: String,
    pub config: HerokuConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub dynos: Vec<HerokuDyno>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerokuDyno {
    pub id: String,
    pub name: String,
    pub state: String,
    pub command: String,
    pub size: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct HerokuService {
    sessions: HashMap<String, HerokuSession>,
    client: Client,
}

impl HerokuService {
    pub fn new() -> HerokuServiceState {
        Arc::new(Mutex::new(HerokuService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_heroku(&mut self, config: HerokuConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_key.is_empty() {
            return Err("Heroku API key is required".to_string());
        }

        let session = HerokuSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            dynos: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_heroku(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("Heroku session not found".to_string())
        }
    }

    pub async fn list_dynos(&mut self, session_id: &str) -> Result<Vec<HerokuDyno>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Heroku session not found")?;

        if !session.is_connected {
            return Err("Heroku session is not connected".to_string());
        }

        // TODO: Implement actual Heroku API call to list dynos
        // For now, return mock data
        let dynos = vec![
            HerokuDyno {
                id: "dyno-1".to_string(),
                name: "web.1".to_string(),
                state: "up".to_string(),
                command: "npm start".to_string(),
                size: "Standard-1X".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            }
        ];

        // Update session with dynos
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.dynos = dynos.clone();
            session.last_activity = Utc::now();
        }

        Ok(dynos)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&HerokuSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&HerokuSession> {
        self.sessions.values().collect()
    }
}

impl Default for HerokuService {
    fn default() -> Self {
        HerokuService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_heroku(
    config: HerokuConnectionConfig,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_heroku(config).await
}

#[tauri::command]
pub async fn disconnect_heroku(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_heroku(&session_id).await
}

#[tauri::command]
pub async fn list_heroku_dynos(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<Vec<HerokuDyno>, String> {
    let mut service = state.lock().await;
    service.list_dynos(&session_id).await
}

#[tauri::command]
pub async fn get_heroku_session(
    session_id: String,
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<HerokuSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("Heroku session not found".to_string())
}

#[tauri::command]
pub async fn list_heroku_sessions(
    state: tauri::State<'_, HerokuServiceState>,
) -> Result<Vec<HerokuSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}