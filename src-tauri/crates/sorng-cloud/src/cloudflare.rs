use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type CloudflareServiceState = Arc<Mutex<CloudflareService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareConnectionConfig {
    pub api_token: String,
    pub api_key: Option<String>,
    pub email: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareSession {
    pub id: String,
    pub config: CloudflareConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub user_info: Option<CloudflareUser>,
    pub accounts: Vec<CloudflareAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareUser {
    pub id: String,
    pub email: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAccount {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub settings: CloudflareAccountSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAccountSettings {
    pub enforce_twofactor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareZone {
    pub id: String,
    pub name: String,
    pub status: String,
    pub paused: bool,
    pub r#type: String,
    pub development_mode: u32,
    pub name_servers: Vec<String>,
    pub original_name_servers: Vec<String>,
    pub original_registrar: Option<String>,
    pub original_dnshost: Option<String>,
    pub modified_on: String,
    pub created_on: String,
    pub activated_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareDNSRecord {
    pub id: String,
    pub r#type: String,
    pub name: String,
    pub content: String,
    pub proxiable: bool,
    pub proxied: bool,
    pub ttl: u32,
    pub locked: bool,
    pub zone_id: String,
    pub zone_name: String,
    pub created_on: String,
    pub modified_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareWorker {
    pub id: String,
    pub script: CloudflareWorkerScript,
    pub created_on: String,
    pub modified_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareWorkerScript {
    pub id: String,
    pub etag: String,
    pub size: u64,
    pub created_on: String,
    pub modified_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflarePageRule {
    pub id: String,
    pub targets: Vec<CloudflarePageRuleTarget>,
    pub actions: Vec<CloudflarePageRuleAction>,
    pub priority: u32,
    pub status: String,
    pub created_on: String,
    pub modified_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflarePageRuleTarget {
    pub target: String,
    pub constraint: CloudflarePageRuleConstraint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflarePageRuleConstraint {
    pub operator: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflarePageRuleAction {
    pub id: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAnalytics {
    pub zone_id: String,
    pub totals: CloudflareAnalyticsData,
    pub timeseries: Vec<CloudflareAnalyticsTimeseries>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAnalyticsData {
    pub requests: CloudflareAnalyticsMetric,
    pub bandwidth: CloudflareAnalyticsMetric,
    pub threats: CloudflareAnalyticsMetric,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAnalyticsMetric {
    pub all: u64,
    pub cached: u64,
    pub uncached: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareAnalyticsTimeseries {
    pub since: String,
    pub until: String,
    pub requests: CloudflareAnalyticsMetric,
    pub bandwidth: CloudflareAnalyticsMetric,
    pub threats: CloudflareAnalyticsMetric,
}

pub struct CloudflareService {
    sessions: HashMap<String, CloudflareSession>,
    #[allow(dead_code)]
    http_client: Client,
}

impl CloudflareService {
    pub fn new() -> CloudflareServiceState {
        Arc::new(Mutex::new(CloudflareService {
            sessions: HashMap::new(),
            http_client: Client::new(),
        }))
    }

    pub async fn connect_cloudflare(
        &mut self,
        config: CloudflareConnectionConfig,
    ) -> Result<String, String> {
        use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
        use serde_json::Value;
        let client = &self.http_client;
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("sortOfRemoteNG/1.0"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", config.api_token))
                .map_err(|e| e.to_string())?,
        );

        // 1. Validate token
        let verify_url = "https://api.cloudflare.com/client/v4/user/tokens/verify";
        let verify_resp = client
            .get(verify_url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| format!("Cloudflare token verify failed: {}", e))?;
        let verify_json: Value = verify_resp
            .json()
            .await
            .map_err(|e| format!("Cloudflare verify parse error: {}", e))?;
        if !verify_json["success"].as_bool().unwrap_or(false)
            || verify_json["result"]["status"] != "active"
        {
            return Err(format!(
                "Cloudflare token invalid or inactive: {}",
                verify_json
            ));
        }

        // 2. Get user info
        let user_url = "https://api.cloudflare.com/client/v4/user";
        let user_resp = client
            .get(user_url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| format!("Cloudflare user info failed: {}", e))?;
        let user_json: Value = user_resp
            .json()
            .await
            .map_err(|e| format!("Cloudflare user parse error: {}", e))?;
        let user = &user_json["result"];
        let user_info = CloudflareUser {
            id: user["id"].as_str().unwrap_or("").to_string(),
            email: user["email"].as_str().unwrap_or("").to_string(),
            first_name: user["first_name"].as_str().map(|s| s.to_string()),
            last_name: user["last_name"].as_str().map(|s| s.to_string()),
            username: user["username"].as_str().map(|s| s.to_string()),
        };

        // 3. Get accounts (optional, best effort)
        let mut accounts = Vec::new();
        if let Ok(accounts_resp) = client
            .get("https://api.cloudflare.com/client/v4/accounts")
            .headers(headers.clone())
            .send()
            .await
        {
            if let Ok(accounts_json) = accounts_resp.json::<Value>().await {
                if let Some(arr) = accounts_json["result"].as_array() {
                    for acc in arr {
                        accounts.push(CloudflareAccount {
                            id: acc["id"].as_str().unwrap_or("").to_string(),
                            name: acc["name"].as_str().unwrap_or("").to_string(),
                            r#type: acc["type"].as_str().unwrap_or("").to_string(),
                            settings: CloudflareAccountSettings {
                                enforce_twofactor: acc["settings"]["enforce_twofactor"]
                                    .as_bool()
                                    .unwrap_or(false),
                            },
                        });
                    }
                }
            }
        }

        let session_id = Uuid::new_v4().to_string();
        let session = CloudflareSession {
            id: session_id.clone(),
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            user_info: Some(user_info),
            accounts,
        };
        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_cloudflare(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err(format!("Cloudflare session {} not found", session_id))
        }
    }

    pub async fn list_cloudflare_sessions(&self) -> Vec<CloudflareSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn get_cloudflare_session(&self, session_id: &str) -> Option<CloudflareSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_cloudflare_zones(
        &self,
        session_id: &str,
    ) -> Result<Vec<CloudflareZone>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock Cloudflare zones for demonstration
        Ok(vec![CloudflareZone {
            id: "zone_123".to_string(),
            name: "example.com".to_string(),
            status: "active".to_string(),
            paused: false,
            r#type: "full".to_string(),
            development_mode: 0,
            name_servers: vec![
                "ns1.cloudflare.com".to_string(),
                "ns2.cloudflare.com".to_string(),
            ],
            original_name_servers: vec![
                "ns1.original.com".to_string(),
                "ns2.original.com".to_string(),
            ],
            original_registrar: Some("GoDaddy".to_string()),
            original_dnshost: Some("GoDaddy".to_string()),
            modified_on: "2024-01-03T12:00:00Z".to_string(),
            created_on: "2024-01-01T00:00:00Z".to_string(),
            activated_on: Some("2024-01-01T12:00:00Z".to_string()),
        }])
    }

    pub async fn list_cloudflare_dns_records(
        &self,
        session_id: &str,
        zone_id: &str,
    ) -> Result<Vec<CloudflareDNSRecord>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock DNS records for demonstration
        Ok(vec![
            CloudflareDNSRecord {
                id: "dns_123".to_string(),
                r#type: "A".to_string(),
                name: "www.example.com".to_string(),
                content: "192.0.2.1".to_string(),
                proxiable: true,
                proxied: true,
                ttl: 300,
                locked: false,
                zone_id: zone_id.to_string(),
                zone_name: "example.com".to_string(),
                created_on: "2024-01-01T00:00:00Z".to_string(),
                modified_on: "2024-01-01T00:00:00Z".to_string(),
            },
            CloudflareDNSRecord {
                id: "dns_456".to_string(),
                r#type: "CNAME".to_string(),
                name: "api.example.com".to_string(),
                content: "api-server.example.com".to_string(),
                proxiable: true,
                proxied: false,
                ttl: 300,
                locked: false,
                zone_id: zone_id.to_string(),
                zone_name: "example.com".to_string(),
                created_on: "2024-01-02T00:00:00Z".to_string(),
                modified_on: "2024-01-02T00:00:00Z".to_string(),
            },
        ])
    }

    pub async fn create_cloudflare_dns_record(
        &self,
        session_id: &str,
        zone_id: &str,
        record: CloudflareDNSRecord,
    ) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock DNS record creation
        Ok(format!(
            "DNS record {} created in zone {}",
            record.name, zone_id
        ))
    }

    pub async fn update_cloudflare_dns_record(
        &self,
        session_id: &str,
        zone_id: &str,
        record_id: &str,
        _record: CloudflareDNSRecord,
    ) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock DNS record update
        Ok(format!(
            "DNS record {} updated in zone {}",
            record_id, zone_id
        ))
    }

    pub async fn delete_cloudflare_dns_record(
        &self,
        session_id: &str,
        zone_id: &str,
        record_id: &str,
    ) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock DNS record deletion
        Ok(format!(
            "DNS record {} deleted from zone {}",
            record_id, zone_id
        ))
    }

    pub async fn list_cloudflare_workers(
        &self,
        session_id: &str,
        _account_id: &str,
    ) -> Result<Vec<CloudflareWorker>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock Cloudflare Workers for demonstration
        Ok(vec![CloudflareWorker {
            id: "worker_123".to_string(),
            script: CloudflareWorkerScript {
                id: "script_123".to_string(),
                etag: "etag123".to_string(),
                size: 1024,
                created_on: "2024-01-01T00:00:00Z".to_string(),
                modified_on: "2024-01-03T12:00:00Z".to_string(),
            },
            created_on: "2024-01-01T00:00:00Z".to_string(),
            modified_on: "2024-01-03T12:00:00Z".to_string(),
        }])
    }

    pub async fn deploy_cloudflare_worker(
        &self,
        session_id: &str,
        account_id: &str,
        script_name: &str,
        _script_content: &str,
    ) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock Worker deployment
        Ok(format!(
            "Worker {} deployed to account {}",
            script_name, account_id
        ))
    }

    pub async fn list_cloudflare_page_rules(
        &self,
        session_id: &str,
        _zone_id: &str,
    ) -> Result<Vec<CloudflarePageRule>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock Page Rules for demonstration
        Ok(vec![CloudflarePageRule {
            id: "rule_123".to_string(),
            targets: vec![CloudflarePageRuleTarget {
                target: "url".to_string(),
                constraint: CloudflarePageRuleConstraint {
                    operator: "matches".to_string(),
                    value: "*.example.com/images/*".to_string(),
                },
            }],
            actions: vec![CloudflarePageRuleAction {
                id: "cache_level".to_string(),
                value: Some("cache_everything".to_string()),
            }],
            priority: 1,
            status: "active".to_string(),
            created_on: "2024-01-01T00:00:00Z".to_string(),
            modified_on: "2024-01-01T00:00:00Z".to_string(),
        }])
    }

    pub async fn get_cloudflare_analytics(
        &self,
        session_id: &str,
        zone_id: &str,
        _since: Option<String>,
        _until: Option<String>,
    ) -> Result<CloudflareAnalytics, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock analytics data for demonstration
        Ok(CloudflareAnalytics {
            zone_id: zone_id.to_string(),
            totals: CloudflareAnalyticsData {
                requests: CloudflareAnalyticsMetric {
                    all: 1000000,
                    cached: 800000,
                    uncached: 200000,
                },
                bandwidth: CloudflareAnalyticsMetric {
                    all: 10737418240,     // 10GB
                    cached: 8589934592,   // 8GB
                    uncached: 2147483648, // 2GB
                },
                threats: CloudflareAnalyticsMetric {
                    all: 100,
                    cached: 0,
                    uncached: 100,
                },
            },
            timeseries: vec![],
        })
    }

    pub async fn purge_cloudflare_cache(
        &self,
        session_id: &str,
        zone_id: &str,
        files: Option<Vec<String>>,
        tags: Option<Vec<String>>,
        hosts: Option<Vec<String>>,
    ) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("Cloudflare session {} not found", session_id));
        }

        // Mock cache purge
        let purge_type = if files.is_some() {
            "files"
        } else if tags.is_some() {
            "tags"
        } else if hosts.is_some() {
            "hosts"
        } else {
            "everything"
        };

        Ok(format!(
            "Cache purged for zone {} (type: {})",
            zone_id, purge_type
        ))
    }
}

// Tauri commands
