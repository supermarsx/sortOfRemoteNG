// ── sorng-zabbix/src/client.rs ───────────────────────────────────────────────
//! HTTP client for the Zabbix JSON-RPC API.

use crate::error::ZabbixError;
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub struct ZabbixClient {
    base_url: String,
    http: HttpClient,
    auth_token: Option<String>,
    api_version: Option<String>,
    request_id: AtomicU64,
}

type ZabbixResult<T> = Result<T, ZabbixError>;

impl ZabbixClient {
    /// Create a new client, authenticate, and detect the API version.
    pub async fn new(config: &ZabbixConnectionConfig) -> ZabbixResult<Self> {
        let skip_verify = config.tls_skip_verify.unwrap_or(false);
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(skip_verify)
            .build()
            .map_err(|e| ZabbixError::ConnectionFailed(format!("http build: {e}")))?;

        let base_url = config.url.trim_end_matches('/').to_string();

        let mut client = Self {
            base_url,
            http,
            auth_token: None,
            api_version: None,
            request_id: AtomicU64::new(1),
        };

        // Detect API version
        let version_resp: Value = client.raw_request("apiinfo.version", json!([])).await?;
        if let Some(v) = version_resp.as_str() {
            client.api_version = Some(v.to_string());
        }

        // Authenticate
        if let Some(ref token) = config.api_token {
            client.auth_token = Some(token.clone());
        } else if let (Some(ref user), Some(ref pass)) = (&config.username, &config.password) {
            let auth: Value = client
                .raw_request("user.login", json!({"username": user, "password": pass}))
                .await?;
            match auth.as_str() {
                Some(tok) => client.auth_token = Some(tok.to_string()),
                None => {
                    return Err(ZabbixError::AuthenticationFailed(
                        "user.login did not return a token".into(),
                    ))
                }
            }
        } else {
            return Err(ZabbixError::AuthenticationFailed(
                "no credentials provided".into(),
            ));
        }

        Ok(client)
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::Relaxed)
    }

    fn endpoint(&self) -> String {
        format!("{}/api_jsonrpc.php", self.base_url)
    }

    /// Low-level JSON-RPC call (no auth header injected).
    async fn raw_request(&self, method: &str, params: Value) -> ZabbixResult<Value> {
        let body = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self.next_id(),
        });
        self.send_body(body).await
    }

    /// Authenticated JSON-RPC call.
    pub async fn request<P: Serialize>(&self, method: &str, params: P) -> ZabbixResult<Value> {
        let mut body = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self.next_id(),
        });
        if let Some(ref token) = self.auth_token {
            body["auth"] = Value::String(token.clone());
        }
        self.send_body(body).await
    }

    /// Send a constructed JSON-RPC body and extract the result.
    async fn send_body(&self, body: Value) -> ZabbixResult<Value> {
        let url = self.endpoint();
        let method_name = body["method"].as_str().unwrap_or("unknown");
        debug!("ZABBIX RPC {method_name} -> {url}");

        let resp = self.http.post(&url).json(&body).send().await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(ZabbixError::ConnectionFailed(format!(
                "HTTP {status}: {text}"
            )));
        }

        let envelope: Value = resp.json().await?;

        if let Some(err) = envelope.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) as i32;
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string();
            let data = err.get("data").and_then(|d| d.as_str()).map(String::from);
            return Err(ZabbixError::ApiError {
                code,
                message,
                data,
            });
        }

        Ok(envelope.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Typed JSON-RPC call that deserializes the result.
    pub async fn request_typed<P: Serialize, T: DeserializeOwned>(
        &self,
        method: &str,
        params: P,
    ) -> ZabbixResult<T> {
        let value = self.request(method, params).await?;
        serde_json::from_value(value).map_err(ZabbixError::from)
    }

    pub fn version(&self) -> &str {
        self.auth_token
            .as_deref()
            .map(|_| self.api_version.as_deref().unwrap_or("unknown"))
            .unwrap_or("unknown")
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Produce a connection summary.
    pub fn summary(&self, id: &str) -> ZabbixConnectionSummary {
        ZabbixConnectionSummary {
            id: id.to_string(),
            url: self.base_url.clone(),
            version: self.api_version.clone().unwrap_or_else(|| "unknown".into()),
            user: "authenticated".into(),
            connected_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Fetch a high-level dashboard overview.
    pub async fn get_dashboard(&self) -> ZabbixResult<ZabbixDashboard> {
        let hosts: Vec<Value> = self
            .request_typed("host.get", json!({"countOutput": true}))
            .await
            .unwrap_or_default();
        let host_count = hosts
            .first()
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| hosts.first().and_then(|v| v.as_u64()))
            .unwrap_or(0);

        // For count queries Zabbix may return the count directly as a string
        let count_or = |val: ZabbixResult<Value>| -> u64 {
            val.ok()
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| s.parse().ok())
                        .or_else(|| v.as_u64())
                })
                .unwrap_or(0)
        };

        let template_count = count_or(
            self.request("template.get", json!({"countOutput": true}))
                .await,
        );
        let trigger_count = count_or(
            self.request("trigger.get", json!({"countOutput": true}))
                .await,
        );
        let active_problems = count_or(
            self.request("problem.get", json!({"countOutput": true}))
                .await,
        );
        let total_items = count_or(self.request("item.get", json!({"countOutput": true})).await);
        let monitored_hosts = count_or(
            self.request(
                "host.get",
                json!({"countOutput": true, "filter": {"status": "0"}}),
            )
            .await,
        );
        let disabled_hosts = count_or(
            self.request(
                "host.get",
                json!({"countOutput": true, "filter": {"status": "1"}}),
            )
            .await,
        );

        Ok(ZabbixDashboard {
            host_count,
            template_count,
            trigger_count,
            active_problems,
            total_items,
            monitored_hosts,
            disabled_hosts,
        })
    }
}
