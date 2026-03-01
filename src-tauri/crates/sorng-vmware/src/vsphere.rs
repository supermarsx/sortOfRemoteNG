//! vSphere REST API HTTP client with session-based authentication.
//!
//! Communicates with vCenter / ESXi via `https://{host}/api/...`.
//! Manages session lifecycle (create / delete) and provides typed helpers.

use crate::error::{VmwareError, VmwareResult};
use crate::types::VsphereConfig;

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// vSphere REST API client.
pub struct VsphereClient {
    client: Client,
    base_url: String,
    session_id: Option<String>,
    config: VsphereConfig,
}

impl VsphereClient {
    /// Build a new client from config (does NOT create a session yet).
    pub fn new(config: &VsphereConfig) -> VmwareResult<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(config.insecure)
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| VmwareError::connection(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}", config.host, config.port);

        Ok(Self {
            client,
            base_url,
            session_id: None,
            config: config.clone(),
        })
    }

    /// Base URL for API calls.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Whether we have an active session.
    pub fn is_connected(&self) -> bool {
        self.session_id.is_some()
    }

    /// Current session ID (if any).
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Current config.
    pub fn config(&self) -> &VsphereConfig {
        &self.config
    }

    // ── Session management ──────────────────────────────────────────

    /// Create a new API session (POST /api/session).
    pub async fn login(&mut self) -> VmwareResult<String> {
        let url = format!("{}/api/session", self.base_url);

        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(VmwareError::auth("Invalid credentials"));
        }

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(VmwareError::api(
                status.as_u16(),
                format!("Login failed: {body}"),
            ));
        }

        // Session ID comes back as a quoted JSON string
        let session_id: String = resp.json().await.map_err(|e| {
            VmwareError::parse(format!("Failed to parse session response: {e}"))
        })?;

        self.session_id = Some(session_id.clone());
        Ok(session_id)
    }

    /// Delete the current session (DELETE /api/session).
    pub async fn logout(&mut self) -> VmwareResult<()> {
        if let Some(ref sid) = self.session_id {
            let url = format!("{}/api/session", self.base_url);
            let _ = self
                .client
                .delete(&url)
                .header("vmware-api-session-id", sid.as_str())
                .send()
                .await;
        }
        self.session_id = None;
        Ok(())
    }

    /// Check if the session is still valid (GET /api/session).
    pub async fn check_session(&self) -> VmwareResult<bool> {
        let sid = self.require_session()?;
        let url = format!("{}/api/session", self.base_url);
        let resp = self
            .client
            .get(&url)
            .header("vmware-api-session-id", sid)
            .send()
            .await?;

        Ok(resp.status().is_success())
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    fn require_session(&self) -> VmwareResult<&str> {
        self.session_id
            .as_deref()
            .ok_or_else(|| VmwareError::auth("Not logged in — no active session"))
    }

    /// GET a JSON response.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> VmwareResult<T> {
        let resp = self.get_raw(path).await?;
        Self::parse_response(resp).await
    }

    /// GET raw `Response`.
    pub async fn get_raw(&self, path: &str) -> VmwareResult<Response> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .get(&url)
            .header("vmware-api-session-id", sid)
            .send()
            .await?;
        Self::check_status(resp).await
    }

    /// GET a JSON response with query params (borrowed).
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(String, String)],
    ) -> VmwareResult<T> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let resp = self
            .client
            .get(&url)
            .header("vmware-api-session-id", sid)
            .query(&borrowed)
            .send()
            .await?;
        let resp = Self::check_status(resp).await?;
        Self::parse_response(resp).await
    }

    /// POST with JSON body, return parsed response.
    pub async fn post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwareResult<T> {
        let resp = self.post_raw(path, body).await?;
        Self::parse_response(resp).await
    }

    /// POST with JSON body, return raw `Response`.
    pub async fn post_raw<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwareResult<Response> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .header("vmware-api-session-id", sid)
            .json(body)
            .send()
            .await?;
        Self::check_status(resp).await
    }

    /// POST with no body, return nothing (discards response).
    pub async fn post_empty(&self, path: &str) -> VmwareResult<()> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .header("vmware-api-session-id", sid)
            .send()
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PATCH with JSON body.
    pub async fn patch<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwareResult<()> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .patch(&url)
            .header("vmware-api-session-id", sid)
            .json(body)
            .send()
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// PUT with JSON body.
    pub async fn put<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> VmwareResult<()> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .put(&url)
            .header("vmware-api-session-id", sid)
            .json(body)
            .send()
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    /// DELETE, ignoring response body.
    pub async fn delete(&self, path: &str) -> VmwareResult<()> {
        let sid = self.require_session()?;
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .delete(&url)
            .header("vmware-api-session-id", sid)
            .send()
            .await?;
        Self::check_status(resp).await?;
        Ok(())
    }

    // ── Internal helpers ────────────────────────────────────────────

    async fn check_status(resp: Response) -> VmwareResult<Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let code = status.as_u16();
        let body = resp.text().await.unwrap_or_default();

        match status {
            StatusCode::UNAUTHORIZED => Err(VmwareError::auth(format!("Session expired or invalid: {body}"))),
            StatusCode::FORBIDDEN => Err(VmwareError::new(
                crate::error::VmwareErrorKind::AccessDenied,
                format!("Access denied: {body}"),
            )),
            StatusCode::NOT_FOUND => Err(VmwareError::not_found(format!("Resource not found: {body}"))),
            _ => Err(VmwareError::api(code, format!("API error {code}: {body}"))),
        }
    }

    async fn parse_response<T: DeserializeOwned>(resp: Response) -> VmwareResult<T> {
        let text = resp.text().await.map_err(|e| {
            VmwareError::parse(format!("Failed to read response body: {e}"))
        })?;

        if text.is_empty() {
            // Some vSphere endpoints return empty body for success
            return serde_json::from_str("null").map_err(|e| {
                VmwareError::parse(format!("Cannot deserialise empty response: {e}"))
            });
        }

        serde_json::from_str(&text).map_err(|e| {
            VmwareError::parse(format!("JSON parse error: {e} — body: {}", &text[..text.len().min(500)]))
        })
    }
}
