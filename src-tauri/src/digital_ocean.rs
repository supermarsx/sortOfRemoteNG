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

        // TODO: Implement actual DigitalOcean API call to list droplets
        // For now, return mock data
        let droplets = vec![
            DigitalOceanDroplet {
                id: 123456789,
                name: "test-droplet".to_string(),
                size_slug: "s-1vcpu-1gb".to_string(),
                status: "active".to_string(),
                region: DigitalOceanRegion {
                    slug: session.config.region.clone().unwrap_or("nyc1".to_string()),
                    name: "New York 1".to_string(),
                },
                image: DigitalOceanImage {
                    id: 12345678,
                    name: "Ubuntu 22.04 LTS".to_string(),
                    distribution: "Ubuntu".to_string(),
                },
                networks: DigitalOceanNetworks {
                    v4: vec![
                        DigitalOceanNetworkV4 {
                            ip_address: "10.0.0.1".to_string(),
                            netmask: "255.255.0.0".to_string(),
                            network_type: "private".to_string(),
                        },
                        DigitalOceanNetworkV4 {
                            ip_address: "192.0.2.1".to_string(),
                            netmask: "255.255.255.0".to_string(),
                            network_type: "public".to_string(),
                        },
                    ],
                },
                created_at: "2024-01-01T00:00:00Z".to_string(),
                tags: vec![],
            }
        ];

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