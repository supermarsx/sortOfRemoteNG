use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type AzureServiceState = Arc<Mutex<AzureService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureConnectionConfig {
    pub subscription_id: String,
    pub client_id: String,
    pub client_secret: String,
    pub tenant_id: String,
    pub resource_group: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureSession {
    pub id: String,
    pub config: AzureConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub virtual_machines: Vec<AzureVirtualMachine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureVirtualMachine {
    pub vm_id: String,
    pub name: String,
    pub size: String,
    pub provisioning_state: String,
    pub power_state: String,
    pub location: String,
    pub resource_group: String,
    pub network_interfaces: Vec<AzureNetworkInterface>,
    pub os_type: String,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureNetworkInterface {
    pub id: String,
    pub name: String,
    pub private_ip_address: Option<String>,
    pub public_ip_address: Option<String>,
}

pub struct AzureService {
    sessions: HashMap<String, AzureSession>,
    client: Client,
}

impl AzureService {
    pub fn new() -> AzureServiceState {
        Arc::new(Mutex::new(AzureService {
            sessions: HashMap::new(),
            client: Client::new(),
        }))
    }

    pub async fn connect_azure(&mut self, config: AzureConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // Basic validation
        if config.subscription_id.is_empty() || config.client_id.is_empty() ||
           config.client_secret.is_empty() || config.tenant_id.is_empty() {
            return Err("All Azure credentials are required".to_string());
        }

        let session = AzureSession {
            id: session_id.clone(),
            config,
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            virtual_machines: Vec::new(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_azure(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err("Azure session not found".to_string())
        }
    }

    pub async fn list_virtual_machines(&mut self, session_id: &str) -> Result<Vec<AzureVirtualMachine>, String> {
        let session = self.sessions.get(session_id)
            .ok_or("Azure session not found")?;

        if !session.is_connected {
            return Err("Azure session is not connected".to_string());
        }

        // TODO: Implement actual Azure API call to list VMs
        // For now, return mock data
        let vms = vec![
            AzureVirtualMachine {
                vm_id: "test-vm-1".to_string(),
                name: "test-vm-1".to_string(),
                size: "Standard_DS1_v2".to_string(),
                provisioning_state: "Succeeded".to_string(),
                power_state: "VM running".to_string(),
                location: session.config.region.clone().unwrap_or("East US".to_string()),
                resource_group: session.config.resource_group.clone().unwrap_or("default".to_string()),
                os_type: "Linux".to_string(),
                network_interfaces: vec![AzureNetworkInterface {
                    id: "nic-1".to_string(),
                    name: "nic-1".to_string(),
                    private_ip_address: Some("10.0.0.4".to_string()),
                    public_ip_address: Some("52.123.456.789".to_string()),
                }],
                tags: HashMap::new(),
            }
        ];

        // Update session with VMs
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.virtual_machines = vms.clone();
            session.last_activity = Utc::now();
        }

        Ok(vms)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<&AzureSession> {
        self.sessions.get(session_id)
    }

    pub fn get_sessions(&self) -> Vec<&AzureSession> {
        self.sessions.values().collect()
    }
}

impl Default for AzureService {
    fn default() -> Self {
        AzureService {
            sessions: HashMap::new(),
            client: Client::new(),
        }
    }
}

#[tauri::command]
pub async fn connect_azure(
    config: AzureConnectionConfig,
    state: tauri::State<'_, AzureServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_azure(config).await
}

#[tauri::command]
pub async fn disconnect_azure(
    session_id: String,
    state: tauri::State<'_, AzureServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_azure(&session_id).await
}

#[tauri::command]
pub async fn list_azure_virtual_machines(
    session_id: String,
    state: tauri::State<'_, AzureServiceState>,
) -> Result<Vec<AzureVirtualMachine>, String> {
    let mut service = state.lock().await;
    service.list_virtual_machines(&session_id).await
}

#[tauri::command]
pub async fn get_azure_session(
    session_id: String,
    state: tauri::State<'_, AzureServiceState>,
) -> Result<AzureSession, String> {
    let service = state.lock().await;
    service.get_session(&session_id)
        .await
        .map(|s| s.clone())
        .ok_or("Azure session not found".to_string())
}

#[tauri::command]
pub async fn list_azure_sessions(
    state: tauri::State<'_, AzureServiceState>,
) -> Result<Vec<AzureSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}