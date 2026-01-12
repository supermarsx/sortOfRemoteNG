use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type ScalewayServiceState = Arc<Mutex<ScalewayService>>;

#[derive(Debug, Clone, Deserialize)]
struct ScalewayListResponse {
    servers: Vec<ScalewayInstanceApi>,
}

#[derive(Debug, Clone, Deserialize)]
struct ScalewayInstanceApi {
    id: String,
    name: String,
    state: String,
    commercial_type: String,
    zone: String,
    created_at: DateTime<Utc>,
    public_ip: Option<ScalewayPublicIp>,
    private_ips: Option<Vec<ScalewayPrivateIp>>,
}

#[derive(Debug, Clone, Deserialize)]
struct ScalewayPublicIp {
    address: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ScalewayPrivateIp {
    address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScalewayConnectionConfig {
    pub api_key: String,
    pub organization_id: Option<String>,
    pub project_name: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScalewaySession {
    pub id: String,
    pub config: ScalewayConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub instances: Vec<ScalewayInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScalewayInstance {
    pub id: String,
    pub name: String,
    pub state: String,
    pub instance_type: String,
    pub zone: String,
    pub public_ip: Option<String>,
    pub private_ip: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct ScalewayService {
    sessions: HashMap<String, ScalewaySession>,
    client: Client,
}

impl ScalewayService {
    pub fn new() -> ScalewayServiceState {
        Arc::new(Mutex::new(ScalewayService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_scaleway(&mut self, config: ScalewayConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_key.is_empty() {
            return Err("Scaleway API key is required".to_string());
        }

        let session = ScalewaySession {
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

    pub async fn disconnect_scaleway(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("Scaleway session not found".to_string())
        }
    }

    pub async fn list_instances(&mut self, session_id: &str) -> Result<Vec<ScalewayInstance>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Scaleway session not found")?;

        if !session.is_connected {
            return Err("Scaleway session is not connected".to_string());
        }

        let zone = session
            .config
            .region
            .as_deref()
            .ok_or("Scaleway region (zone) is required")?;

        let response = self.client
            .get(format!("https://api.scaleway.com/instance/v1/zones/{}/servers", zone))
            .header("X-Auth-Token", &session.config.api_key)
            .send()
            .await
            .map_err(|err| format!("Scaleway API request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Scaleway API error {}: {}", status, body));
        }

        let response_body: ScalewayListResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse Scaleway API response: {}", err))?;

        let instances: Vec<ScalewayInstance> = response_body
            .servers
            .into_iter()
            .map(|server| ScalewayInstance {
                id: server.id,
                name: server.name,
                state: server.state,
                instance_type: server.commercial_type,
                zone: server.zone,
                public_ip: server.public_ip.map(|ip| ip.address),
                private_ip: server
                    .private_ips
                    .and_then(|ips| ips.into_iter().next().map(|ip| ip.address)),
                created_at: server.created_at,
            })
            .collect();

        // Update session with instances
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.instances = instances.clone();
            session.last_activity = Utc::now();
        }

        Ok(instances)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&ScalewaySession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&ScalewaySession> {
        self.sessions.values().collect()
    }
}

impl Default for ScalewayService {
    fn default() -> Self {
        ScalewayService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_scaleway(
    config: ScalewayConnectionConfig,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_scaleway(config).await
}

#[tauri::command]
pub async fn disconnect_scaleway(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_scaleway(&session_id).await
}

#[tauri::command]
pub async fn list_scaleway_instances(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<Vec<ScalewayInstance>, String> {
    let mut service = state.lock().await;
    service.list_instances(&session_id).await
}

#[tauri::command]
pub async fn get_scaleway_session(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<ScalewaySession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("Scaleway session not found".to_string())
}

#[tauri::command]
pub async fn list_scaleway_sessions(
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<Vec<ScalewaySession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}
