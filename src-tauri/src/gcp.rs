use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type GcpServiceState = Arc<Mutex<GcpService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpConnectionConfig {
    pub project_id: String,
    pub service_account_key: String,
    pub region: Option<String>,
    pub zone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpSession {
    pub id: String,
    pub config: GcpConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub instances: Vec<GcpInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpInstance {
    pub instance_id: String,
    pub name: String,
    pub machine_type: String,
    pub status: String,
    pub network_interfaces: Vec<GcpNetworkInterface>,
    pub zone: String,
    pub creation_timestamp: String,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpNetworkInterface {
    pub network: String,
    pub subnetwork: String,
    pub network_ip: String,
    pub access_configs: Vec<GcpAccessConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpAccessConfig {
    pub nat_ip: Option<String>,
    pub public_ptr_domain_name: Option<String>,
}

pub struct GcpService {
    sessions: HashMap<String, GcpSession>,
    client: Client,
}

impl GcpService {
    pub fn new() -> GcpServiceState {
        Arc::new(Mutex::new(GcpService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_gcp(&mut self, config: GcpConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Validate service account key by attempting to parse it
        let _key_data: serde_json::Value = serde_json::from_str(&config.service_account_key)
            .map_err(|e| format!("Invalid service account key JSON: {}", e))?;

        let session = GcpSession {
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

    pub async fn disconnect_gcp(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("GCP session not found".to_string())
        }
    }

    pub async fn list_instances(&mut self, session_id: &str) -> Result<Vec<GcpInstance>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("GCP session not found")?;

        if !session.is_connected {
            return Err("GCP session is not connected".to_string());
        }

        // TODO: Implement actual GCP API call to list instances
        // For now, return mock data
        let instances = vec![
            GcpInstance {
                instance_id: "test-instance-1".to_string(),
                name: "test-instance-1".to_string(),
                machine_type: "n1-standard-1".to_string(),
                status: "RUNNING".to_string(),
                zone: session.config.zone.clone().unwrap_or("us-central1-a".to_string()),
                creation_timestamp: "2024-01-01T00:00:00Z".to_string(),
                network_interfaces: vec![GcpNetworkInterface {
                    network: "default".to_string(),
                    subnetwork: "default".to_string(),
                    network_ip: "10.0.0.1".to_string(),
                    access_configs: vec![GcpAccessConfig {
                        nat_ip: Some("35.123.456.789".to_string()),
                        public_ptr_domain_name: None,
                    }],
                }],
                tags: HashMap::new(),
            }
        ];

        // Update session with instances
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.instances = instances.clone();
            session.last_activity = Utc::now();
        }

        Ok(instances)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&GcpSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&GcpSession> {
        self.sessions.values().collect()
    }
}

#[tauri::command]
pub async fn connect_gcp(
    config: GcpConnectionConfig,
    state: tauri::State<'_, GcpServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_gcp(config).await
}

#[tauri::command]
pub async fn disconnect_gcp(
    session_id: String,
    state: tauri::State<'_, GcpServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_gcp(&session_id).await
}

#[tauri::command]
pub async fn list_gcp_instances(
    session_id: String,
    state: tauri::State<'_, GcpServiceState>,
) -> Result<Vec<GcpInstance>, String> {
    let mut service = state.lock().await;
    service.list_instances(&session_id).await
}

#[tauri::command]
pub async fn get_gcp_session(
    session_id: String,
    state: tauri::State<'_, GcpServiceState>,
) -> Result<GcpSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("GCP session not found".to_string())
}

#[tauri::command]
pub async fn list_gcp_sessions(
    state: tauri::State<'_, GcpServiceState>,
) -> Result<Vec<GcpSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}