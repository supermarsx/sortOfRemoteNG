use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type IbmServiceState = Arc<Mutex<IbmService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmConnectionConfig {
    pub api_key: String,
    pub region: Option<String>,
    pub resource_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmSession {
    pub id: String,
    pub config: IbmConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub virtual_servers: Vec<IbmVirtualServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmVirtualServer {
    pub id: String,
    pub name: String,
    pub profile: String,
    pub status: String,
    pub zone: String,
    pub vpc: String,
    pub primary_network_interface: IbmNetworkInterface,
    pub floating_ips: Vec<IbmFloatingIp>,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmNetworkInterface {
    pub id: String,
    pub name: String,
    pub primary_ip: IbmIpAddress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmIpAddress {
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IbmFloatingIp {
    pub id: String,
    pub address: String,
}

pub struct IbmService {
    sessions: HashMap<String, IbmSession>,
    client: Client,
}

impl IbmService {
    pub fn new() -> IbmServiceState {
        Arc::new(Mutex::new(IbmService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_ibm(&mut self, config: IbmConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.api_key.is_empty() {
            return Err("IBM Cloud API key is required".to_string());
        }

        let session = IbmSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            virtual_servers: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_ibm(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("IBM Cloud session not found".to_string())
        }
    }

    pub async fn list_virtual_servers(&mut self, session_id: &str) -> Result<Vec<IbmVirtualServer>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("IBM Cloud session not found")?;

        if !session.is_connected {
            return Err("IBM Cloud session is not connected".to_string());
        }

        // TODO: Implement actual IBM Cloud API call to list virtual servers
        // For now, return mock data
        let servers = vec![
            IbmVirtualServer {
                id: "test-server-1".to_string(),
                name: "test-server-1".to_string(),
                profile: "bx2-2x8".to_string(),
                status: "running".to_string(),
                zone: session.config.region.clone().unwrap_or("us-south-1".to_string()),
                vpc: "test-vpc".to_string(),
                created_at: "2024-01-01T00:00:00Z".to_string(),
                primary_network_interface: IbmNetworkInterface {
                    id: "nic-1".to_string(),
                    name: "eth0".to_string(),
                    primary_ip: IbmIpAddress {
                        address: "10.0.0.1".to_string(),
                    },
                },
                floating_ips: vec![IbmFloatingIp {
                    id: "fip-1".to_string(),
                    address: "169.61.123.456".to_string(),
                }],
                tags: vec![],
            }
        ];

        // Update session with servers
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.virtual_servers = servers.clone();
            session.last_activity = Utc::now();
        }

        Ok(servers)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&IbmSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&IbmSession> {
        self.sessions.values().collect()
    }
}

impl Default for IbmService {
    fn default() -> Self {
        IbmService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_ibm(
    config: IbmConnectionConfig,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_ibm(config).await
}

#[tauri::command]
pub async fn disconnect_ibm(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_ibm(&session_id).await
}

#[tauri::command]
pub async fn list_ibm_virtual_servers(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<Vec<IbmVirtualServer>, String> {
    let mut service = state.lock().await;
    service.list_virtual_servers(&session_id).await
}

#[tauri::command]
pub async fn get_ibm_session(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<IbmSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("IBM Cloud session not found".to_string())
}

#[tauri::command]
pub async fn list_ibm_sessions(
    state: tauri::State<'_, IbmServiceState>,
) -> Result<Vec<IbmSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}