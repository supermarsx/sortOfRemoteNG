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

const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

pub struct CpanelClient {
    pub config: CpanelConnectionConfig,
    http: HttpClient,
}

impl CpanelClient {
    pub fn new(mut config: CpanelConnectionConfig) -> CpanelResult<Self> {
        if config.host.trim().is_empty() {
            return Err(CpanelError::invalid_request("host must not be empty"));
        }
        if config.username.trim().is_empty() {
            return Err(CpanelError::auth("username must not be empty"));
        }
        if config.timeout_secs == Some(0) {
            return Err(CpanelError::invalid_request(
                "request timeout must be greater than zero",
            ));
        }
        let credential_missing = match &config.auth_mode {
            CpanelAuthMode::Password => config
                .password
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none(),
            CpanelAuthMode::ApiToken | CpanelAuthMode::UserApiToken => config
                .api_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none(),
        };
        if credential_missing {
            return Err(CpanelError::auth(
                "the selected authentication credential must not be empty",
            ));
        }

        let accept_invalid =
            config.use_tls.unwrap_or(true) && config.accept_invalid_certs.unwrap_or(false);
        if accept_invalid != config.acknowledge_invalid_cert_risk.unwrap_or(false) {
            return Err(CpanelError::invalid_request(
                "disabling TLS certificate validation requires a runtime acknowledgement for this connection attempt",
            ));
        }
        let mut builder = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(accept_invalid);
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|_| CpanelError::connection("invalid proxy URL"))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|_| CpanelError::connection("failed to build HTTP client"))?;
        config.acknowledge_invalid_cert_risk = None;
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
        let port = self
            .config
            .whm_port
            .unwrap_or(if self.config.use_tls.unwrap_or(true) {
                2087
            } else {
                2086
            });
        format!("{}://{}:{}", self.scheme(), self.config.host, port)
    }

    fn cpanel_base(&self) -> String {
        let port = self
            .config
            .cpanel_port
            .unwrap_or(if self.config.use_tls.unwrap_or(true) {
                2083
            } else {
                2082
            });
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

    fn map_status_error(&self, status: u16) -> CpanelError {
        match status {
            401 => CpanelError::auth("Authentication failed (HTTP 401)"),
            403 => CpanelError::forbidden("Access denied (HTTP 403)"),
            404 => CpanelError::api("Not found (HTTP 404)"),
            _ => CpanelError::http(format!("HTTP {status}")),
        }
    }

    async fn read_bounded_body(mut resp: reqwest::Response) -> CpanelResult<Vec<u8>> {
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(CpanelError::http(format!(
                "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
            )));
        }

        let capacity = resp
            .content_length()
            .unwrap_or(0)
            .min(MAX_RESPONSE_BODY_BYTES as u64) as usize;
        let mut body = Vec::with_capacity(capacity);
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| Self::request_error("response body", &e))?
        {
            let remaining = (MAX_RESPONSE_BODY_BYTES + 1).saturating_sub(body.len());
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if body.len() > MAX_RESPONSE_BODY_BYTES {
                return Err(CpanelError::http(format!(
                    "response body exceeds {MAX_RESPONSE_BODY_BYTES} byte limit"
                )));
            }
        }
        Ok(body)
    }

    async fn handle_json_response<T: DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> CpanelResult<T> {
        let status = resp.status();
        if !status.is_success() {
            return Err(self.map_status_error(status.as_u16()));
        }
        let body = Self::read_bounded_body(resp).await?;
        serde_json::from_slice(&body).map_err(|e| {
            CpanelError::parse(format!(
                "invalid JSON response at line {}, column {}",
                e.line(),
                e.column()
            ))
        })
    }

    /// Generic GET request returning parsed JSON.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> CpanelResult<T> {
        debug!("CPANEL GET");
        let resp = self
            .apply_auth(self.http.get(url))
            .send()
            .await
            .map_err(|e| Self::request_error("GET request", &e))?;
        self.handle_json_response(resp).await
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
        debug!("CPANEL POST");
        let resp = self
            .apply_auth(self.http.post(url).form(params))
            .send()
            .await
            .map_err(|e| Self::request_error("POST request", &e))?;
        self.handle_json_response(resp).await
    }

    /// Generic POST request with JSON body.
    pub async fn post_json<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> CpanelResult<T> {
        debug!("CPANEL POST JSON");
        let resp = self
            .apply_auth(self.http.post(url).json(body))
            .send()
            .await
            .map_err(|e| Self::request_error("POST JSON request", &e))?;
        self.handle_json_response(resp).await
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
        let raw: serde_json::Value = self.get_json(&url).await?;
        Self::ensure_whm_success(&raw)?;
        serde_json::from_value(raw).map_err(|_| CpanelError::parse("WHM response schema mismatch"))
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
        let raw: serde_json::Value = self.get_json(&url).await?;
        Self::ensure_uapi_success(&raw)?;
        serde_json::from_value(raw).map_err(|_| CpanelError::parse("UAPI response schema mismatch"))
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
        if matches!(self.config.auth_mode, CpanelAuthMode::UserApiToken) {
            return self.ping_user_api().await;
        }

        let raw: serde_json::Value = self.whm_api("version", &[]).await?;
        let version = raw
            .get("version")
            .or_else(|| raw.get("data").and_then(|data| data.get("version")))
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| CpanelError::parse("WHM version response omitted data.version"))?;

        let info: serde_json::Value = self.whm_api_raw("gethostname", &[]).await?;
        let hostname = info
            .get("data")
            .and_then(|d| d.get("hostname"))
            .and_then(|h| h.as_str())
            .map(String::from)
            .ok_or_else(|| CpanelError::parse("WHM gethostname response omitted data.hostname"))?;

        Ok(CpanelConnectionSummary {
            host: self.config.host.clone(),
            hostname: Some(hostname),
            version: Some(version),
            theme: None,
            server_type: Some("cPanel/WHM".into()),
            license_id: None,
        })
    }

    async fn ping_user_api(&self) -> CpanelResult<CpanelConnectionSummary> {
        let raw: serde_json::Value = self
            .uapi("Variables", "get_server_information", &[])
            .await?;
        let data = raw
            .get("result")
            .and_then(|result| result.get("data"))
            .ok_or_else(|| {
                CpanelError::parse("Variables::get_server_information response omitted result.data")
            })?;
        let hostname = data
            .get("hostname")
            .and_then(|value| value.as_str())
            .map(String::from)
            .ok_or_else(|| {
                CpanelError::parse("Variables::get_server_information response omitted hostname")
            })?;
        let version = data
            .get("version")
            .and_then(|value| value.as_str())
            .map(String::from);

        Ok(CpanelConnectionSummary {
            host: self.config.host.clone(),
            hostname: Some(hostname),
            version,
            theme: None,
            server_type: Some("cPanel".into()),
            license_id: None,
        })
    }

    fn ensure_whm_success(raw: &serde_json::Value) -> CpanelResult<()> {
        let result = raw
            .get("metadata")
            .and_then(|metadata| metadata.get("result"))
            .or_else(|| raw.get("status"));
        if result.and_then(|value| value.as_u64()) == Some(0) {
            return Err(CpanelError::api("WHM API reported failure"));
        }
        Ok(())
    }

    fn ensure_uapi_success(raw: &serde_json::Value) -> CpanelResult<()> {
        let result = raw.get("result");
        let status = result
            .and_then(|value| value.get("status"))
            .and_then(|value| value.as_u64());
        match status {
            Some(0) => Err(CpanelError::api("cPanel UAPI reported failure")),
            Some(_) => Ok(()),
            None => Err(CpanelError::parse(
                "cPanel UAPI response omitted result.status",
            )),
        }
    }

    fn request_error(context: &str, error: &reqwest::Error) -> CpanelError {
        let reason = if error.is_timeout() {
            "timed out"
        } else if error.is_connect() {
            "connection failed"
        } else {
            "transport failed"
        };
        let message = format!("{context}: {reason}");
        if error.is_timeout() {
            CpanelError::timeout(message)
        } else {
            CpanelError::http(message)
        }
    }
}
