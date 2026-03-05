//! HTTP client with session management and API discovery for Synology DSM.
//!
//! `SynoClient` is the core HTTP abstraction.  It:
//! 1. Discovers available APIs via `SYNO.API.Info`
//! 2. Manages SID session tokens
//! 3. Routes every call through `api_call()` → JSON → `SynoResponse<T>`
//! 4. Handles SynoToken CSRF headers when required

use crate::error::{SynologyError, SynologyResult};
use crate::types::*;

use reqwest::Client;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

/// Synology DSM HTTP client.
pub struct SynoClient {
    http: Client,
    pub base_url: String,
    pub sid: Option<String>,
    pub syno_token: Option<String>,
    pub device_token: Option<String>,
    pub api_info: HashMap<String, ApiInfoEntry>,
    pub dsm_version: Option<String>,
    pub model: Option<String>,
    pub config: SynologyConfig,
}

impl SynoClient {
    /// Create a new client from config.
    pub fn new(config: &SynologyConfig) -> SynologyResult<Self> {
        let scheme = if config.use_https { "https" } else { "http" };
        let base_url = format!("{scheme}://{}:{}", config.host, config.port);

        let http = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .cookie_store(true)
            .build()?;

        Ok(Self {
            http,
            base_url,
            sid: None,
            syno_token: None,
            device_token: config.device_token.clone(),
            api_info: HashMap::new(),
            dsm_version: None,
            model: None,
            config: config.clone(),
        })
    }

    pub fn is_connected(&self) -> bool {
        self.sid.is_some()
    }

    /// Produce a safe (no secrets) version of the current config.
    pub fn get_config_safe(&self) -> SynologyConfigSafe {
        SynologyConfigSafe {
            host: self.config.host.clone(),
            port: self.config.port,
            username: self.config.username.clone(),
            use_https: self.config.use_https,
            dsm_version: self.dsm_version.clone(),
            model: self.model.clone(),
        }
    }

    // ── API Discovery ───────────────────────────────────────────────

    /// Query `SYNO.API.Info` to discover all available APIs.
    pub async fn discover_apis(&mut self) -> SynologyResult<()> {
        let url = format!(
            "{}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=all",
            self.base_url
        );
        let resp: SynoResponse<HashMap<String, ApiInfoEntry>> = self
            .http
            .get(&url)
            .send()
            .await?
            .json()
            .await?;

        if !resp.success {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            return Err(SynologyError::from_dsm_code(code, "API discovery"));
        }

        self.api_info = resp.data.unwrap_or_default();
        log::info!("Discovered {} Synology APIs", self.api_info.len());
        Ok(())
    }

    /// Resolve the full URL for an API call.
    pub fn resolve_url(
        &self,
        api: &str,
        version: u32,
        method: &str,
    ) -> SynologyResult<String> {
        let info = self
            .api_info
            .get(api)
            .ok_or_else(|| SynologyError::api_not_found(format!("API not found: {api}")))?;

        if version < info.min_version || version > info.max_version {
            return Err(SynologyError::version_not_supported(format!(
                "{api} v{version} not in range [{},{}]",
                info.min_version, info.max_version
            )));
        }

        let mut url = format!(
            "{}/webapi/{}?api={}&version={}&method={}",
            self.base_url, info.path, api, version, method
        );

        if let Some(ref sid) = self.sid {
            url.push_str(&format!("&_sid={sid}"));
        }

        Ok(url)
    }

    /// Pick the highest supported version for an API (clamped to our max).
    pub fn best_version(&self, api: &str, our_max: u32) -> Option<u32> {
        self.api_info.get(api).map(|info| info.max_version.min(our_max))
    }

    /// Check if a particular API is available.
    pub fn has_api(&self, api: &str) -> bool {
        self.api_info.contains_key(api)
    }

    // ── Generic API calls ───────────────────────────────────────────

    /// Execute a GET-based API call and deserialize the `data` field.
    pub async fn api_call<T: DeserializeOwned>(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<T> {
        let url = self.resolve_url(api, version, method)?;

        let mut req = self.http.get(&url);
        if !params.is_empty() {
            req = req.query(params);
        }
        if let Some(ref token) = self.syno_token {
            req = req.header("X-SYNO-TOKEN", token);
        }

        let resp: SynoResponse<T> = req.send().await?.json().await?;

        if resp.success {
            resp.data
                .ok_or_else(|| SynologyError::parse("API returned success but no data"))
        } else {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            Err(SynologyError::from_dsm_code(code, api))
        }
    }

    /// Execute a POST-based API call.
    pub async fn api_post<T: DeserializeOwned>(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<T> {
        let info = self
            .api_info
            .get(api)
            .ok_or_else(|| SynologyError::api_not_found(format!("API not found: {api}")))?;

        let url = format!("{}/webapi/{}", self.base_url, info.path);

        let mut params: Vec<(&str, &str)> = vec![
            ("api", api),
            ("method", method),
        ];
        let ver_str = version.to_string();
        params.push(("version", &ver_str));
        if let Some(ref sid) = self.sid {
            params.push(("_sid", sid));
        }
        params.extend_from_slice(form);

        let mut req = self.http.post(&url).form(&params);
        if let Some(ref token) = self.syno_token {
            req = req.header("X-SYNO-TOKEN", token);
        }

        let resp: SynoResponse<T> = req.send().await?.json().await?;

        if resp.success {
            resp.data
                .ok_or_else(|| SynologyError::parse("API returned success but no data"))
        } else {
            let code = resp.error.map(|e| e.code).unwrap_or(100);
            Err(SynologyError::from_dsm_code(code, api))
        }
    }

    /// A void POST call (returns `SynoResponse<serde_json::Value>` and ignores data).
    pub async fn api_post_void(
        &self,
        api: &str,
        version: u32,
        method: &str,
        form: &[(&str, &str)],
    ) -> SynologyResult<()> {
        let _: serde_json::Value = self.api_post(api, version, method, form).await?;
        Ok(())
    }

    /// A void GET call.
    pub async fn api_call_void(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<()> {
        let _: serde_json::Value = self.api_call(api, version, method, params).await?;
        Ok(())
    }

    /// Download raw bytes (for FileStation.Download, thumbnails, etc.)
    pub async fn raw_download(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: &[(&str, &str)],
    ) -> SynologyResult<Vec<u8>> {
        let url = self.resolve_url(api, version, method)?;
        let mut req = self.http.get(&url);
        if !params.is_empty() {
            req = req.query(params);
        }
        let resp = req.send().await?;
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if ct.contains("application/json") {
            // DSM returned an error as JSON instead of file bytes
            let err_resp: SynoResponse<()> = resp.json().await?;
            let code = err_resp.error.map(|e| e.code).unwrap_or(100);
            return Err(SynologyError::from_dsm_code(code, api));
        }

        Ok(resp.bytes().await?.to_vec())
    }

    /// Get the reqwest client reference (for multipart uploads).
    pub fn http_client(&self) -> &Client {
        &self.http
    }
}
