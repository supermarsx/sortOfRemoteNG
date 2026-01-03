use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type DigitalOceanServiceState = Arc<Mutex<DigitalOceanService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanConnectionConfig {
    pub api_token: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanSession {
    pub id: String,
    pub config: DigitalOceanConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub droplets: Vec<DigitalOceanDroplet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanDroplet {
    pub id: u64,
    pub name: String,
    pub size_slug: String,
    pub status: String,
    pub region: DigitalOceanRegion,
    pub image: DigitalOceanImage,
    pub networks: DigitalOceanNetworks,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanRegion {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanImage {
    pub id: u64,
    pub name: String,
    pub distribution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanNetworks {
    pub v4: Vec<DigitalOceanNetworkV4>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalOceanNetworkV4 {
    pub ip_address: String,
    pub netmask: String,
    #[serde(rename = "type")]
    pub network_type: String,
}

pub struct DigitalOceanService {
    sessions: HashMap<String, DigitalOceanSession>,
    client: Client,
}

impl DigitalOceanService {
    pub fn new() -> DigitalOceanServiceState {
        Arc::new(Mutex::new(DigitalOceanService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_digital_ocean(&mut self, config: DigitalOceanConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_token.is_empty() {
            return Err("DigitalOcean API token is required".to_string());
        }

        let session = DigitalOceanSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            droplets: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_digital_ocean(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("DigitalOcean session not found".to_string())
        }
    }

    pub async fn list_droplets(&mut self, session_id: &str) -> Result<Vec<DigitalOceanDroplet>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("DigitalOcean session not found")?;

        if !session.is_connected {
            return Err("DigitalOcean session is not connected".to_string());
        }

        // Make API call to list droplets
        let url = "https://api.digitalocean.com/v2/droplets";

        let response = self.client
            .get(url)
            .header("Authorization", format!("Bearer {}", session.config.api_token))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to make API request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("DigitalOcean API error {}: {}", status, error_text));
        }

        #[derive(Deserialize)]
        struct DoApiResponse {
            droplets: Vec<DigitalOceanDroplet>,
        }

        let api_response: DoApiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {}", e))?;

        let droplets = api_response.droplets;

        // Update session with droplets
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.droplets = droplets.clone();
            session.last_activity = Utc::now();
        }

        Ok(droplets)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&DigitalOceanSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&DigitalOceanSession> {
        self.sessions.values().collect()
    }
}

impl Default for DigitalOceanService {
    fn default() -> Self {
        DigitalOceanService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_digital_ocean(
    config: DigitalOceanConnectionConfig,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_digital_ocean(config).await
}

#[tauri::command]
pub async fn disconnect_digital_ocean(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_digital_ocean(&session_id).await
}

#[tauri::command]
pub async fn list_digital_ocean_droplets(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<Vec<DigitalOceanDroplet>, String> {
    let mut service = state.lock().await;
    service.list_droplets(&session_id).await
}

#[tauri::command]
pub async fn get_digital_ocean_session(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<DigitalOceanSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("DigitalOcean session not found".to_string())
}

#[tauri::command]
pub async fn list_digital_ocean_sessions(
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<Vec<DigitalOceanSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}