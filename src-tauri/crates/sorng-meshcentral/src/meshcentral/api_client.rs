//! HTTP API client for MeshCentral.
//!
//! MeshCentral uses a WebSocket-based API (`/control.ashx`) for most operations.
//! This client implements the API over HTTP by sending JSON payloads to the
//! server REST endpoints and WebSocket relay endpoints. For operations that
//! are purely REST-based (agent download, relay URLs) we use direct HTTP.
//!
//! The authentication is passed via the `x-meshauth` header (base64 encoded
//! username, password, and optional 2FA token) or via a login cookie/key.

use crate::meshcentral::auth;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use log::debug;
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use url::Url;

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Low-level HTTP transport for MeshCentral API calls.
pub struct McApiClient {
    pub(crate) client: Client,
    pub(crate) base_url: String,
    pub(crate) auth_header: Option<String>,
    pub(crate) auth_cookie: Option<String>,
    #[allow(dead_code)]
    pub(crate) domain: String,
    #[allow(dead_code)]
    pub(crate) timeout: Duration,
}

impl McApiClient {
    /// Build a new API client from connection configuration.
    pub fn new(config: &McConnectionConfig) -> MeshCentralResult<Self> {
        if !config.verify_tls {
            return Err(MeshCentralError::InvalidParameter(
                "TLS certificate verification cannot be disabled: verify_tls=false requires an explicit runtime acknowledgement contract".to_string(),
            ));
        }
        let supplied = config.server_url.trim();
        if supplied.is_empty() || supplied.len() > 8192 {
            return Err(MeshCentralError::InvalidParameter(
                "Invalid MeshCentral server URL".to_string(),
            ));
        }
        let normalized = if supplied.contains("://") {
            supplied.to_string()
        } else {
            format!("https://{supplied}")
        };
        let mut parsed = Url::parse(&normalized).map_err(|_| {
            MeshCentralError::InvalidParameter("Invalid MeshCentral server URL".to_string())
        })?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
        {
            return Err(MeshCentralError::InvalidParameter(
                "MeshCentral requires an HTTPS URL without credentials or fragments".to_string(),
            ));
        }
        parsed.set_query(None);
        let url = parsed.as_str().trim_end_matches('/').to_string();
        let timeout = Duration::from_secs(config.timeout_secs.clamp(1, 300));

        let mut builder = Client::builder()
            .timeout(timeout)
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .user_agent("SortOfRemoteNG-MeshCentral/1");

        if let Some(ref proxy_url) = config.proxy {
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|_| {
                MeshCentralError::InvalidParameter("Invalid proxy configuration".to_string())
            })?;
            builder = builder.proxy(proxy);
        }

        let client = builder.build()?;

        let (auth_header, auth_cookie) = auth::build_auth(&config.auth, &config.domain)?;

        Ok(McApiClient {
            client,
            base_url: url,
            auth_header,
            auth_cookie,
            domain: config.domain.clone(),
            timeout,
        })
    }

    /// The control endpoint URL.
    fn control_url(&self) -> String {
        format!("{}/api/meshctrl", self.base_url)
    }

    /// Build a request with authentication headers.
    fn authenticated_request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.client.request(method, url);
        if let Some(ref header) = self.auth_header {
            req = req.header("x-meshauth", header);
        }
        if let Some(ref cookie) = self.auth_cookie {
            req = req.query(&[("auth", cookie.as_str())]);
        }
        req
    }

    /// Send a WebSocket-style action via the REST API.
    /// MeshCentral's REST API accepts the same JSON payloads that the
    /// WebSocket control channel uses.
    pub async fn send_action(
        &self,
        action: &str,
        mut payload: serde_json::Map<String, Value>,
    ) -> MeshCentralResult<Value> {
        payload.insert("action".to_string(), Value::String(action.to_string()));
        payload.insert(
            "responseid".to_string(),
            Value::String("meshctrl".to_string()),
        );
        let encoded = serde_json::to_vec(&payload)?;
        if encoded.len() > MAX_REQUEST_BYTES {
            return Err(MeshCentralError::InvalidParameter(
                "MeshCentral request exceeds the 8 MiB limit".to_string(),
            ));
        }

        let url = self.control_url();
        debug!("MeshCentral API action={}", action);

        let resp = self
            .authenticated_request(reqwest::Method::POST, &url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(encoded)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(MeshCentralError::AuthenticationFailed(
                    "MeshCentral rejected the supplied credentials".to_string(),
                ));
            }
            return Err(MeshCentralError::ServerError(format!(
                "MeshCentral returned HTTP {}",
                status
            )));
        }

        let body = Self::read_limited(resp, MAX_JSON_RESPONSE_BYTES).await?;
        serde_json::from_slice(&body).map_err(Into::into)
    }

    /// Send an action and wait for a specific response action.
    pub async fn send_and_expect(
        &self,
        action: &str,
        payload: serde_json::Map<String, Value>,
        _expect_action: &str,
    ) -> MeshCentralResult<Value> {
        // For REST API, the response comes directly
        self.send_action(action, payload).await
    }

    /// Perform a raw GET request to a server endpoint.
    pub async fn get(&self, path: &str) -> MeshCentralResult<reqwest::Response> {
        Self::validate_path(path)?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .authenticated_request(reqwest::Method::GET, &url)
            .send()
            .await?;
        Ok(resp)
    }

    /// Perform a raw GET and return JSON.
    pub async fn get_json(&self, path: &str) -> MeshCentralResult<Value> {
        let resp = self.get(path).await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(MeshCentralError::ServerError(format!(
                "MeshCentral returned HTTP {}",
                status
            )));
        }
        let body = Self::read_limited(resp, MAX_JSON_RESPONSE_BYTES).await?;
        serde_json::from_slice(&body).map_err(Into::into)
    }

    /// Perform a raw POST request.
    pub async fn post_json(&self, path: &str, body: &Value) -> MeshCentralResult<Value> {
        Self::validate_path(path)?;
        let encoded = serde_json::to_vec(body)?;
        if encoded.len() > MAX_REQUEST_BYTES {
            return Err(MeshCentralError::InvalidParameter(
                "MeshCentral request exceeds the 8 MiB limit".to_string(),
            ));
        }
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .authenticated_request(reqwest::Method::POST, &url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(encoded)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(MeshCentralError::ServerError(format!(
                "MeshCentral returned HTTP {}",
                status
            )));
        }
        let body = Self::read_limited(resp, MAX_JSON_RESPONSE_BYTES).await?;
        serde_json::from_slice(&body).map_err(Into::into)
    }

    /// Download bytes from a path (e.g. agent download).
    pub async fn download_bytes(&self, path: &str) -> MeshCentralResult<Vec<u8>> {
        let resp = self.get(path).await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(MeshCentralError::ServerError(format!(
                "Download failed: HTTP {}",
                status
            )));
        }
        Self::read_limited(resp, MAX_DOWNLOAD_BYTES).await
    }

    /// Get server information.
    pub async fn server_info(&self) -> MeshCentralResult<McServerInfo> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("serverinfo", payload).await?;

        // The response has a `serverinfo` field
        if let Some(info) = resp.get("serverinfo") {
            let server_info: McServerInfo = serde_json::from_value(info.clone())?;
            Ok(server_info)
        } else {
            // Try to parse the whole response as server info
            let server_info: McServerInfo = serde_json::from_value(resp)?;
            Ok(server_info)
        }
    }

    /// Get the authenticated user's info.
    pub async fn user_info(&self) -> MeshCentralResult<McUserInfo> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("userinfo", payload).await?;
        if let Some(info) = resp.get("userinfo") {
            let user_info: McUserInfo = serde_json::from_value(info.clone())?;
            Ok(user_info)
        } else {
            let user_info: McUserInfo = serde_json::from_value(resp)?;
            Ok(user_info)
        }
    }

    /// Check if the connection is alive by fetching server info.
    pub async fn ping(&self) -> MeshCentralResult<bool> {
        match self.server_info().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Helper: extract the `result` field from a response.
    pub(crate) fn extract_result(resp: &Value) -> Option<String> {
        resp.get("result")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// Helper: check if the response indicates success.
    pub(crate) fn is_success(resp: &Value) -> bool {
        if let Some(result) = Self::extract_result(resp) {
            let result = result.trim().to_ascii_lowercase();
            result == "ok" || result == "success"
        } else {
            resp.get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        }
    }

    fn validate_path(path: &str) -> MeshCentralResult<()> {
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.len() > 8192
            || path.chars().any(char::is_control)
        {
            return Err(MeshCentralError::InvalidParameter(
                "Invalid MeshCentral API path".to_string(),
            ));
        }
        Ok(())
    }

    async fn read_limited(
        mut response: reqwest::Response,
        limit: usize,
    ) -> MeshCentralResult<Vec<u8>> {
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(MeshCentralError::ServerError(
                "MeshCentral response exceeded the configured limit".to_string(),
            ));
        }
        let mut bytes = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or(16 * 1024)
                .min(limit as u64) as usize,
        );
        while let Some(chunk) = response.chunk().await? {
            if bytes.len().saturating_add(chunk.len()) > limit {
                return Err(MeshCentralError::ServerError(
                    "MeshCentral response exceeded the configured limit".to_string(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}
