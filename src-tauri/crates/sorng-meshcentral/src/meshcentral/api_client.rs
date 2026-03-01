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
use log::{debug, info, warn};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

/// Low-level HTTP transport for MeshCentral API calls.
pub struct McApiClient {
    pub(crate) client: Client,
    pub(crate) base_url: String,
    pub(crate) auth_header: Option<String>,
    pub(crate) auth_cookie: Option<String>,
    pub(crate) domain: String,
    pub(crate) timeout: Duration,
}

impl McApiClient {
    /// Build a new API client from connection configuration.
    pub fn new(config: &McConnectionConfig) -> MeshCentralResult<Self> {
        let mut url = config.server_url.trim_end_matches('/').to_string();
        if !url.starts_with("http://") && !url.starts_with("https://") {
            url = format!("https://{}", url);
        }

        let timeout = Duration::from_secs(config.timeout_secs);

        let mut builder = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(!config.verify_tls);

        if let Some(ref proxy_url) = config.proxy {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| MeshCentralError::InvalidParameter(format!("Invalid proxy: {}", e)))?;
            builder = builder.proxy(proxy);
        }

        let client = builder.build()?;

        let (auth_header, auth_cookie) = auth::build_auth(&config.auth, &config.domain)?;

        info!("MeshCentral API client created for {}", url);

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
    fn authenticated_request(
        &self,
        method: reqwest::Method,
        url: &str,
    ) -> reqwest::RequestBuilder {
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

        let url = self.control_url();
        debug!("MeshCentral API → {} action={}", url, action);

        let resp = self
            .authenticated_request(reqwest::Method::POST, &url)
            .json(&payload)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!("MeshCentral API error {}: {}", status, body);

            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(MeshCentralError::AuthenticationFailed(body));
            }
            return Err(MeshCentralError::ServerError(format!(
                "HTTP {} — {}",
                status, body
            )));
        }

        let body: Value = resp.json().await?;
        debug!("MeshCentral API ← {}", serde_json::to_string(&body).unwrap_or_default());
        Ok(body)
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
            let text = resp.text().await.unwrap_or_default();
            return Err(MeshCentralError::ServerError(format!(
                "HTTP {} — {}",
                status, text
            )));
        }
        let body: Value = resp.json().await?;
        Ok(body)
    }

    /// Perform a raw POST request.
    pub async fn post_json(
        &self,
        path: &str,
        body: &Value,
    ) -> MeshCentralResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .authenticated_request(reqwest::Method::POST, &url)
            .json(body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(MeshCentralError::ServerError(format!(
                "HTTP {} — {}",
                status, text
            )));
        }
        let body: Value = resp.json().await?;
        Ok(body)
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
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| MeshCentralError::NetworkError(e.to_string()))?;
        Ok(bytes.to_vec())
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
            result.to_lowercase().contains("ok") || result.to_lowercase().contains("success")
        } else {
            // No explicit result field means it might be successful with data
            true
        }
    }
}
