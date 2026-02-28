use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

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

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceAccountKey {
    r#type: String,
    project_id: String,
    private_key_id: String,
    private_key: String,
    client_email: String,
    client_id: String,
    auth_uri: String,
    token_uri: String,
    auth_provider_x509_cert_url: String,
    client_x509_cert_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct JwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: i64,
    iat: i64,
}

#[derive(Debug, Deserialize)]
struct GcpApiResponse<T> {
    items: Option<Vec<T>>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct GcpComputeInstance {
    id: String,
    name: String,
    machineType: String,
    status: String,
    networkInterfaces: Vec<GcpApiNetworkInterface>,
    zone: String,
    creationTimestamp: String,
    tags: Option<GcpApiTags>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct GcpApiNetworkInterface {
    network: String,
    subnetwork: String,
    networkIP: String,
    accessConfigs: Option<Vec<GcpApiAccessConfig>>,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct GcpApiAccessConfig {
    natIP: Option<String>,
    publicPtrDomainName: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GcpApiTags {
    items: Option<Vec<String>>,
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

        // Parse service account key
        let service_account: ServiceAccountKey = serde_json::from_str(&session.config.service_account_key)
            .map_err(|e| format!("Failed to parse service account key: {}", e))?;

        // Get access token
        let access_token = self.get_access_token(&service_account).await
            .map_err(|e| format!("Failed to get access token: {}", e))?;

        // Determine zone to query
        let zone = session.config.zone.as_ref()
            .ok_or("Zone must be specified in GCP config")?;

        // Make API call to list instances
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/instances",
            session.config.project_id, zone
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
            return Err(format!("GCP API error {}: {}", status, error_text));
        }

        let api_response: GcpApiResponse<GcpComputeInstance> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {}", e))?;

        let instances = api_response.items
            .unwrap_or_default()
            .into_iter()
            .map(|api_instance| {
                let tags = api_instance.tags
                    .and_then(|t| t.items)
                    .unwrap_or_default()
                    .into_iter()
                    .enumerate()
                    .map(|(i, tag)| (format!("tag_{}", i), tag))
                    .collect();

                GcpInstance {
                    instance_id: api_instance.id,
                    name: api_instance.name,
                    machine_type: api_instance.machineType,
                    status: api_instance.status,
                    zone: api_instance.zone,
                    creation_timestamp: api_instance.creationTimestamp,
                    network_interfaces: api_instance.networkInterfaces
                        .into_iter()
                        .map(|ni| GcpNetworkInterface {
                            network: ni.network,
                            subnetwork: ni.subnetwork,
                            network_ip: ni.networkIP,
                            access_configs: ni.accessConfigs
                                .unwrap_or_default()
                                .into_iter()
                                .map(|ac| GcpAccessConfig {
                                    nat_ip: ac.natIP,
                                    public_ptr_domain_name: ac.publicPtrDomainName,
                                })
                                .collect(),
                        })
                        .collect(),
                    tags,
                }
            })
            .collect::<Vec<_>>();

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

    pub async fn get_access_token(&self, service_account: &ServiceAccountKey) -> Result<String, String> {
        // Create JWT claims
        let now = Utc::now().timestamp();
        let claims = JwtClaims {
            iss: service_account.client_email.clone(),
            scope: "https://www.googleapis.com/auth/compute.readonly".to_string(),
            aud: service_account.token_uri.clone(),
            exp: now + 3600, // 1 hour
            iat: now,
        };

        // Create header
        let header = Header {
            alg: Algorithm::RS256,
            kid: Some(service_account.private_key_id.clone()),
            ..Default::default()
        };

        // Load private key
        let private_key_pem = service_account.private_key
            .replace("\\n", "\n")
            .replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\n")
            .replace("-----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");

        let encoding_key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())
            .map_err(|e| format!("Failed to load private key: {}", e))?;

        // Sign JWT
        let jwt = encode(&header, &claims, &encoding_key)
            .map_err(|e| format!("Failed to encode JWT: {}", e))?;

        // Exchange JWT for access token
        let mut form_data = std::collections::HashMap::new();
        form_data.insert("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        form_data.insert("assertion", &jwt);

        let response = self.client
            .post(&service_account.token_uri)
            .form(&form_data)
            .send()
            .await
            .map_err(|e| format!("Failed to exchange JWT for token: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed {}: {}", status, error_text));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        Ok(token_response.access_token)
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
