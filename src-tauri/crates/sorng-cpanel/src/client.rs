// ── sorng-cpanel – HTTP client for cPanel UAPI + WHM JSON API ────────────────
//! Multi-transport client for cPanel / WHM management.
//! Supports:
//!   • WHM JSON API v1 (port 2087) — server-wide administration
//!   • cPanel UAPI (port 2083)     — per-account operations
//!   • cPanel API2 (legacy)        — older per-account calls

use crate::error::{CpanelError, CpanelResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub struct CpanelClient {
    pub config: CpanelConnectionConfig,
    http: HttpClient,
}

impl CpanelClient {
    pub fn new(config: CpanelConnectionConfig) -> CpanelResult<Self> {
        let accept_invalid = config.accept_invalid_certs.unwrap_or(false);
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .danger_accept_invalid_certs(accept_invalid)
            .build()
            .map_err(|e| CpanelError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── URL builders ─────────────────────────────────────────────────

    fn scheme(&self) -> &str {
        if self.config.use_tls.unwrap_or(true) {
            "https"
        } else {
            "http"
        }
    }

    fn whm_base(&self) -> String {
        let port = self.config.whm_port.unwrap_or(2087);
        format!("{}://{}:{}", self.scheme(), self.config.host, port)
    }

    fn cpanel_base(&self) -> String {
        let port = self.config.cpanel_port.unwrap_or(2083);
        format!("{}://{}:{}", self.scheme(), self.config.host, port)
    }

    /// WHM JSON API v1 endpoint.
    fn whm_url(&self, function: &str) -> String {
        format!("{}/json-api/{}", self.whm_base(), function)
    }

    /// cPanel UAPI endpoint.
    fn uapi_url(&self, _user: &str, module: &str, function: &str) -> String {
        format!("{}/execute/{}/{}", self.cpanel_base(), module, function)
    }

    /// cPanel UAPI endpoint accessed through WHM (as root impersonating user).
    fn whm_uapi_url(&self, user: &str, module: &str, function: &str) -> String {
        format!(
            "{}/json-api/cpanel?cpanel_jsonapi_user={}&cpanel_jsonapi_apiversion=3&cpanel_jsonapi_module={}&cpanel_jsonapi_func={}",
            self.whm_base(),
            user,
            module,
            function
        )
    }

    // ── Auth headers ─────────────────────────────────────────────────

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.config.auth_mode {
            CpanelAuthMode::ApiToken => {
                let token = self.config.api_token.as_deref().unwrap_or("");
                let header = format!("whm {}:{}", self.config.username, token);
                req.header("Authorization", header)
            }
            CpanelAuthMode::UserApiToken => {
                let token = self.config.api_token.as_deref().unwrap_or("");
                let header = format!("cpanel {}:{}", self.config.username, token);
                req.header("Authorization", header)
            }
            CpanelAuthMode::Password => {
                let pw = self.config.password.as_deref().unwrap_or("");
                req.basic_auth(&self.config.username, Some(pw))
            }
        }
    }

    // ── Generic request helpers ──────────────────────────────────────

    fn map_status_error(&self, status: u16, body: &str) -> CpanelError {
        match status {
            401 => CpanelError::auth(format!("Authentication failed (HTTP 401): {body}")),
            403 => CpanelError::forbidden(format!("Access denied (HTTP 403): {body}")),
            404 => CpanelError::api(format!("Not found (HTTP 404): {body}")),
            _ => CpanelError::http(format!("HTTP {status}: {body}")),
        }
    }

    /// Generic GET request returning parsed JSON.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> CpanelResult<T> {
        debug!("CPANEL GET {url}");
        let resp = self
            .apply_auth(self.http.get(url))
            .send()
            .await
            .map_err(|e| CpanelError::http(format!("GET {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| CpanelError::parse(format!("GET {url} parse: {e}")))
    }

    /// Generic GET request returning raw JSON value.
    pub async fn get_raw(&self, url: &str) -> CpanelResult<serde_json::Value> {
        self.get_json(url).await
    }

    /// Generic POST request with form-encoded body.
    pub async fn post_form<T: DeserializeOwned>(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<T> {
        debug!("CPANEL POST {url}");
        let resp = self
            .apply_auth(self.http.post(url).form(params))
            .send()
            .await
            .map_err(|e| CpanelError::http(format!("POST {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| CpanelError::parse(format!("POST {url} parse: {e}")))
    }

    /// Generic POST request with JSON body.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> CpanelResult<T> {
        debug!("CPANEL POST JSON {url}");
        let resp = self
            .apply_auth(self.http.post(url).json(body))
            .send()
            .await
            .map_err(|e| CpanelError::http(format!("POST JSON {url}: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(self.map_status_error(status.as_u16(), &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| CpanelError::parse(format!("POST JSON {url} parse: {e}")))
    }

    // ── WHM API shortcuts ────────────────────────────────────────────

    /// Call a WHM JSON API v1 function with query parameters.
    pub async fn whm_api<T: DeserializeOwned>(
        &self,
        function: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<T> {
        let base = self.whm_url(function);
        let url = if params.is_empty() {
            format!("{base}?api.version=1")
        } else {
            let qs: String = params
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&");
            format!("{base}?api.version=1&{qs}")
        };
        self.get_json(&url).await
    }

    /// Call a WHM API function and return raw JSON.
    pub async fn whm_api_raw(
        &self,
        function: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<serde_json::Value> {
        self.whm_api(function, params).await
    }

    // ── UAPI shortcuts ───────────────────────────────────────────────

    /// Call a cPanel UAPI function (as the configured user).
    pub async fn uapi<T: DeserializeOwned>(
        &self,
        module: &str,
        function: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<T> {
        let base = self.uapi_url(&self.config.username, module, function);
        let url = if params.is_empty() {
            base
        } else {
            let qs: String = params
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&");
            format!("{base}?{qs}")
        };
        self.get_json(&url).await
    }

    /// Call a UAPI function via WHM (impersonating a user).
    pub async fn whm_uapi<T: DeserializeOwned>(
        &self,
        user: &str,
        module: &str,
        function: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<T> {
        let base = self.whm_uapi_url(user, module, function);
        let url = if params.is_empty() {
            base
        } else {
            let qs: String = params
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&");
            format!("{base}&{qs}")
        };
        self.get_json(&url).await
    }

    /// Call a UAPI function and return raw JSON.
    pub async fn uapi_raw(
        &self,
        module: &str,
        function: &str,
        params: &[(&str, &str)],
    ) -> CpanelResult<serde_json::Value> {
        self.uapi(module, function, params).await
    }

    // ── Connection verification ──────────────────────────────────────

    /// Verify the connection and return a summary.
    pub async fn ping(&self) -> CpanelResult<CpanelConnectionSummary> {
        let raw: serde_json::Value = self.whm_api("version", &[]).await?;
        let version = raw
            .get("version")
            .and_then(|v| v.as_str())
            .map(String::from);

        let info: serde_json::Value = self
            .whm_api_raw("gethostname", &[])
            .await
            .unwrap_or_default();
        let hostname = info
            .get("data")
            .and_then(|d| d.get("hostname"))
            .and_then(|h| h.as_str())
            .map(String::from);

        Ok(CpanelConnectionSummary {
            host: self.config.host.clone(),
            hostname,
            version,
            theme: None,
            server_type: Some("cPanel/WHM".into()),
            license_id: None,
        })
    }
}
