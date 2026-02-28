use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type IbmServiceState = Arc<Mutex<IbmService>>;

#[derive(Debug, Clone, Deserialize)]
struct IbmIamTokenResponse {
    access_token: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmInstanceListResponse {
    instances: Vec<IbmVirtualServerApi>,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmVirtualServerApi {
    id: String,
    name: String,
    status: String,
    created_at: String,
    profile: Option<IbmProfileApi>,
    zone: Option<IbmZoneApi>,
    vpc: Option<IbmVpcApi>,
    primary_network_interface: Option<IbmNetworkInterfaceApi>,
    floating_ips: Option<Vec<IbmFloatingIpApi>>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmProfileApi {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmZoneApi {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmVpcApi {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmNetworkInterfaceApi {
    id: String,
    name: String,
    primary_ip: Option<IbmIpAddressApi>,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmIpAddressApi {
    address: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IbmFloatingIpApi {
    id: String,
    address: String,
}

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

        let region = session
            .config
            .region
            .as_deref()
            .ok_or("IBM Cloud region is required")?;

        let access_token = self.get_access_token(&session.config.api_key).await?;

        let response = self.client
            .get(format!("https://{}.iaas.cloud.ibm.com/v1/instances", region))
            .query(&[("version", "2021-11-01"), ("generation", "2")])
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|err| format!("IBM Cloud API request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("IBM Cloud API error {}: {}", status, body));
        }

        let response_body: IbmInstanceListResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse IBM Cloud API response: {}", err))?;

        let servers: Vec<IbmVirtualServer> = response_body
            .instances
            .into_iter()
            .map(|instance| IbmVirtualServer {
                id: instance.id,
                name: instance.name,
                profile: instance.profile.map(|p| p.name).unwrap_or_default(),
                status: instance.status,
                zone: instance
                    .zone
                    .map(|z| z.name)
                    .unwrap_or_else(|| region.to_string()),
                vpc: instance.vpc.map(|v| v.name).unwrap_or_default(),
                primary_network_interface: instance
                    .primary_network_interface
                    .map(|iface| IbmNetworkInterface {
                        id: iface.id,
                        name: iface.name,
                        primary_ip: IbmIpAddress {
                            address: iface
                                .primary_ip
                                .map(|ip| ip.address)
                                .unwrap_or_default(),
                        },
                    })
                    .unwrap_or(IbmNetworkInterface {
                        id: String::new(),
                        name: String::new(),
                        primary_ip: IbmIpAddress { address: String::new() },
                    }),
                floating_ips: instance
                    .floating_ips
                    .unwrap_or_default()
                    .into_iter()
                    .map(|ip| IbmFloatingIp {
                        id: ip.id,
                        address: ip.address,
                    })
                    .collect(),
                created_at: instance.created_at,
                tags: instance.tags.unwrap_or_default(),
            })
            .collect();

        // Update session with servers
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.virtual_servers = servers.clone();
            session.last_activity = Utc::now();
        }

        Ok(servers)
    }

    async fn get_access_token(&self, api_key: &str) -> Result<String, String> {
        let response = self.client
            .post("https://iam.cloud.ibm.com/identity/token")
            .header("Accept", "application/json")
            .form(&[
                ("grant_type", "urn:ibm:params:oauth:grant-type:apikey"),
                ("apikey", api_key),
            ])
            .send()
            .await
            .map_err(|err| format!("IBM IAM request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("IBM IAM error {}: {}", status, body));
        }

        let token: IbmIamTokenResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse IBM IAM response: {}", err))?;

        Ok(token.access_token)
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
