use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;
use sha1::{Digest, Sha1};

pub type OvhServiceState = Arc<Mutex<OvhService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhConnectionConfig {
    pub api_key: String,
    pub app_secret: Option<String>,
    pub consumer_key: Option<String>,
    pub service_id: Option<String>,
    pub project_name: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OvhInstanceApi {
    id: String,
    name: String,
    status: String,
    #[serde(default)]
    region: Option<String>,
    #[serde(rename = "flavorId")]
    flavor_id: Option<String>,
    #[serde(rename = "ipAddresses", default)]
    ip_addresses: Vec<OvhIpAddressApi>,
    #[serde(rename = "created")]
    created_at: Option<DateTime<Utc>>,
    #[serde(rename = "updated")]
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
struct OvhIpAddressApi {
    ip: String,
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

        let app_key = session.config.api_key.trim();
        if app_key.is_empty() {
            return Err("OVH application key is required".to_string());
        }

        let app_secret = session
            .config
            .app_secret
            .as_deref()
            .ok_or("OVH application secret is required")?;

        let consumer_key = session
            .config
            .consumer_key
            .as_deref()
            .ok_or("OVH consumer key is required")?;

        let project_id = session
            .config
            .service_id
            .as_deref()
            .or(session.config.project_name.as_deref())
            .ok_or("OVH project id is required")?;

        let url = format!(
            "https://api.ovh.com/1.0/cloud/project/{}/instance",
            project_id
        );
        let timestamp = self.get_ovh_timestamp().await?;
        let signature = self.sign_request(
            app_secret,
            consumer_key,
            "GET",
            &url,
            "",
            timestamp,
        );

        let response = self.client
            .get(&url)
            .header("X-Ovh-Application", app_key)
            .header("X-Ovh-Consumer", consumer_key)
            .header("X-Ovh-Timestamp", timestamp.to_string())
            .header("X-Ovh-Signature", signature)
            .send()
            .await
            .map_err(|err| format!("OVH API request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("OVH API error {}: {}", status, body));
        }

        let response_body: Vec<OvhInstanceApi> = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse OVH API response: {}", err))?;

        let region_filter = session.config.region.as_deref();
        let instances: Vec<OvhInstance> = response_body
            .into_iter()
            .filter(|instance| {
                region_filter.map_or(true, |region| {
                    instance.region.as_deref().map_or(false, |r| r == region)
                })
            })
            .map(|instance| OvhInstance {
                id: instance.id,
                name: instance.name,
                status: instance.status,
                flavor: instance.flavor_id.unwrap_or_default(),
                region: instance
                    .region
                    .or_else(|| session.config.region.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                ip_addresses: instance
                    .ip_addresses
                    .into_iter()
                    .map(|ip| ip.ip)
                    .collect(),
                created_at: instance.created_at.unwrap_or_else(Utc::now),
                updated_at: instance.updated_at.unwrap_or_else(Utc::now),
            })
            .collect();

        // Update session with instances
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.instances = instances.clone();
            session.last_activity = Utc::now();
        }

        Ok(instances)
    }

    async fn get_ovh_timestamp(&self) -> Result<i64, String> {
        let response = self.client
            .get("https://api.ovh.com/1.0/auth/time")
            .send()
            .await
            .map_err(|err| format!("OVH time request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("OVH time error {}: {}", status, body));
        }

        let body = response
            .text()
            .await
            .map_err(|err| format!("Failed to read OVH time response: {}", err))?;

        body.trim()
            .parse::<i64>()
            .map_err(|err| format!("Invalid OVH time response: {}", err))
    }

    fn sign_request(
        &self,
        app_secret: &str,
        consumer_key: &str,
        method: &str,
        url: &str,
        body: &str,
        timestamp: i64,
    ) -> String {
        let data = format!(
            "{}+{}+{}+{}+{}+{}",
            app_secret, consumer_key, method, url, body, timestamp
        );
        let mut hasher = Sha1::new();
        hasher.update(data.as_bytes());
        let digest = hasher.finalize();
        format!("$1${}", hex::encode(digest))
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
