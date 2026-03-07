//! Legacy REST API client for Lenovo IMM2.
//!
//! IMM2 (Integrated Management Module II) on System x M5/M6 servers uses
//! a proprietary JSON REST API at `/api/…` paths rather than Redfish.
//! This module implements the most common IMM2-specific endpoints.

use crate::error::{LenovoError, LenovoResult};
use crate::types::*;

/// IMM2 legacy REST API client.
pub struct LegacyRestClient {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
    session_token: Option<String>,
}

impl LegacyRestClient {
    /// Create a new IMM2 legacy REST client.
    pub fn new(config: &LenovoConfig) -> LenovoResult<Self> {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| LenovoError::connection(format!("Failed to create HTTP client: {e}")))?;

        Ok(Self {
            client,
            base_url: format!("https://{}:{}", config.host, config.port),
            username: config.username.clone(),
            password: config.password.clone(),
            session_token: None,
        })
    }

    /// Authenticate with the IMM2 REST API.
    pub async fn login(&mut self) -> LenovoResult<String> {
        let url = format!("{}/api/login", self.base_url);
        let body = serde_json::json!({
            "userid": self.username,
            "password": self.password,
        });

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| LenovoError::connection(format!("IMM2 login failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(LenovoError::auth(format!(
                "IMM2 authentication failed (HTTP {})",
                resp.status()
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| LenovoError::parse(format!("Failed to parse login response: {e}")))?;

        if let Some(token) = json.get("authResult").and_then(|v| v.as_str()) {
            if token == "0" {
                // Success — extract session cookie
                self.session_token = Some("authenticated".to_string());
                return Ok(format!("Connected to {} via IMM2 REST API", self.base_url));
            }
        }

        // Alternative: check for session token in response
        if let Some(token) = json.get("token").and_then(|v| v.as_str()) {
            self.session_token = Some(token.to_string());
            return Ok(format!("Connected to {} via IMM2 REST API", self.base_url));
        }

        Err(LenovoError::auth("IMM2 authentication failed — invalid credentials"))
    }

    /// Logout from IMM2.
    pub async fn logout(&mut self) -> LenovoResult<()> {
        if self.session_token.is_some() {
            let url = format!("{}/api/logout", self.base_url);
            let _ = self.client.post(&url).send().await;
            self.session_token = None;
        }
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.session_token.is_some()
    }

    /// Perform a GET request to the IMM2 REST API.
    async fn get(&self, path: &str) -> LenovoResult<serde_json::Value> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.get(&url);
        if let Some(ref token) = self.session_token {
            req = req.header("X-Auth-Token", token);
        } else {
            req = req.basic_auth(&self.username, Some(&self.password));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| LenovoError::legacy_rest(format!("IMM2 GET {path} failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(LenovoError::api(
                resp.status().as_u16(),
                format!("IMM2 GET {path} returned {}", resp.status()),
            ));
        }

        resp.json()
            .await
            .map_err(|e| LenovoError::parse(format!("Failed to parse IMM2 response: {e}")))
    }

    /// Get system information from IMM2.
    pub async fn get_system_info(&self) -> LenovoResult<BmcSystemInfo> {
        let data = self.get("/api/dataset/sys_info").await?;
        let items = data.get("items").and_then(|v| v.as_array());

        let default = serde_json::json!({});
        let sys = items.and_then(|arr| arr.first()).unwrap_or(&default);

        Ok(BmcSystemInfo {
            id: "1".to_string(),
            manufacturer: "Lenovo".to_string(),
            model: sys.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            serial_number: sys.get("serialNum").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            sku: sys.get("machineSn").and_then(|v| v.as_str()).map(String::from),
            bios_version: sys.get("biosVersion").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            hostname: sys.get("hostname").and_then(|v| v.as_str()).map(String::from),
            power_state: sys.get("powerStatus").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
            indicator_led: sys.get("locLED").and_then(|v| v.as_str()).map(String::from),
            asset_tag: sys.get("assetTag").and_then(|v| v.as_str()).map(String::from),
            memory_gib: sys.get("memoryTotal")
                .and_then(|v| v.as_str())
                .and_then(|s| s.replace(" GB", "").parse::<f64>().ok())
                .unwrap_or(0.0),
            processor_count: sys.get("processorCount")
                .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0) as u32,
            processor_model: sys.get("processorModel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
    }

    /// Get XCC/IMM2 controller info.
    pub async fn get_controller_info(&self) -> LenovoResult<XccInfo> {
        let data = self.get("/api/dataset/imm_info").await?;
        let items = data.get("items").and_then(|v| v.as_array());
        let default = serde_json::json!({});
        let imm = items.and_then(|arr| arr.first()).unwrap_or(&default);

        Ok(XccInfo {
            generation: XccGeneration::Imm2,
            firmware_version: imm.get("immVersion").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            firmware_date: imm.get("immDate").and_then(|v| v.as_str()).map(String::from),
            ip_address: imm.get("ipAddr").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            mac_address: imm.get("macAddr").and_then(|v| v.as_str()).map(String::from),
            hostname: imm.get("hostname").and_then(|v| v.as_str()).map(String::from),
            serial_number: None,
            model: imm.get("model").and_then(|v| v.as_str()).map(String::from),
            uuid: imm.get("uuid").and_then(|v| v.as_str()).map(String::from),
            fqdn: None,
        })
    }

    /// Power action via IMM2 API.
    pub async fn power_action(&self, action: &str) -> LenovoResult<()> {
        let url = format!("{}/api/power/{}", self.base_url, action);
        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| LenovoError::power(format!("IMM2 power action failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(LenovoError::power(format!(
                "IMM2 power action failed (HTTP {})",
                resp.status()
            )));
        }
        Ok(())
    }

    /// Get event log from IMM2.
    pub async fn get_event_log(&self) -> LenovoResult<Vec<BmcEventLogEntry>> {
        let data = self.get("/api/dataset/imm_log").await?;
        let items = data.get("items").and_then(|v| v.as_array());
        let mut entries = Vec::new();

        if let Some(items) = items {
            for (i, e) in items.iter().enumerate().take(500) {
                entries.push(BmcEventLogEntry {
                    id: format!("{}", i + 1),
                    created: e.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    severity: e.get("severity").and_then(|v| v.as_str()).unwrap_or("OK").to_string(),
                    message: e.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    message_id: None,
                    entry_type: Some("IMM2".to_string()),
                });
            }
        }
        Ok(entries)
    }
}
