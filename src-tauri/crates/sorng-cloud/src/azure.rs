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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct AzureTokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u32,
}

#[derive(Debug, Deserialize)]
struct AzureApiVmResponse {
    value: Vec<AzureApiVirtualMachine>,
}

#[derive(Debug, Deserialize)]
struct AzureApiVirtualMachine {
    id: String,
    name: String,
    location: String,
    properties: AzureApiVmProperties,
    tags: Option<HashMap<String, String>>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct AzureApiVmProperties {
    vmId: String,
    hardwareProfile: AzureApiHardwareProfile,
    provisioningState: String,
    storageProfile: Option<AzureApiStorageProfile>,
    networkProfile: Option<AzureApiNetworkProfile>,
    instanceView: Option<AzureApiInstanceView>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct AzureApiHardwareProfile {
    vmSize: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct AzureApiStorageProfile {
    osDisk: Option<AzureApiOsDisk>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct AzureApiOsDisk {
    osType: Option<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct AzureApiNetworkProfile {
    networkInterfaces: Vec<AzureApiNetworkInterfaceRef>,
}

#[derive(Debug, Deserialize)]
struct AzureApiNetworkInterfaceRef {
    id: String,
}

#[derive(Debug, Deserialize)]
struct AzureApiInstanceView {
    statuses: Option<Vec<AzureApiStatus>>,
}

#[derive(Debug, Deserialize)]
struct AzureApiStatus {
    code: String,
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

        // Get access token
        let access_token = self.get_access_token(&session.config).await
            .map_err(|e| format!("Failed to get access token: {}", e))?;

        // Make API call to list VMs
        let url = format!(
            "https://management.azure.com/subscriptions/{}/providers/Microsoft.Compute/virtualMachines?api-version=2023-03-01",
            session.config.subscription_id
        );

        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| format!("Failed to make API request: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Azure API error {}: {}", status, error_text));
        }

        let api_response: AzureApiVmResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {}", e))?;

        let vms = api_response.value
            .into_iter()
            .map(|api_vm| {
                let resource_group = api_vm.id
                    .split('/')
                    .nth(4)
                    .unwrap_or("unknown")
                    .to_string();

                let power_state = api_vm.properties.instanceView
                    .and_then(|iv| iv.statuses)
                    .and_then(|statuses| statuses.into_iter().find(|s| s.code.starts_with("PowerState/")))
                    .map(|s| s.code.split('/').nth(1).unwrap_or("Unknown").to_string())
                    .unwrap_or("Unknown".to_string());

                let os_type = api_vm.properties.storageProfile
                    .and_then(|sp| sp.osDisk)
                    .and_then(|os| os.osType)
                    .unwrap_or("Unknown".to_string());

                let network_interfaces = api_vm.properties.networkProfile
                    .map(|np| np.networkInterfaces
                        .into_iter()
                        .map(|ni| AzureNetworkInterface {
                            id: ni.id.clone(),
                            name: ni.id.split('/').last().unwrap_or("unknown").to_string(),
                            private_ip_address: None, // Would need separate API call
                            public_ip_address: None,  // Would need separate API call
                        })
                        .collect()
                    )
                    .unwrap_or_default();

                let tags = api_vm.tags.unwrap_or_default();

                AzureVirtualMachine {
                    vm_id: api_vm.properties.vmId,
                    name: api_vm.name,
                    size: api_vm.properties.hardwareProfile.vmSize,
                    provisioning_state: api_vm.properties.provisioningState,
                    power_state,
                    location: api_vm.location,
                    resource_group,
                    os_type,
                    network_interfaces,
                    tags,
                }
            })
            .collect::<Vec<_>>();

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

    pub async fn get_access_token(&self, config: &AzureConnectionConfig) -> Result<String, String> {
        let token_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            config.tenant_id
        );

        let mut form_data = std::collections::HashMap::new();
        form_data.insert("grant_type", "client_credentials");
        form_data.insert("client_id", &config.client_id);
        form_data.insert("client_secret", &config.client_secret);
        form_data.insert("scope", "https://management.azure.com/.default");

        let response = self.client
            .post(&token_url)
            .form(&form_data)
            .send()
            .await
            .map_err(|e| format!("Failed to request access token: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Token request failed {}: {}", status, error_text));
        }

        let token_response: AzureTokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        Ok(token_response.access_token)
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
