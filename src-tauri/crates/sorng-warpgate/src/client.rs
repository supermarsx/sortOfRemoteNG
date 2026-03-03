// ── sorng-warpgate/src/client.rs ────────────────────────────────────────────
//! Warpgate admin REST API HTTP client.

use crate::error::{WarpgateError, WarpgateResult};
use crate::types::*;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE};
use std::time::Duration;

/// Warpgate API client wrapping reqwest.
pub struct WarpgateClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub username: String,
    pub password: String,
    /// Session cookie obtained after login.
    pub session_cookie: Option<String>,
}

impl WarpgateClient {
    /// Build a client from a connection config.
    pub fn from_config(config: &WarpgateConnectionConfig) -> WarpgateResult<Self> {
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.unwrap_or(30)))
            .cookie_store(true);

        if config.skip_tls_verify {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let http = builder.build().map_err(|e| WarpgateError::connection(&e.to_string()))?;
        let base_url = config.host.trim_end_matches('/').to_string();

        Ok(Self {
            http,
            base_url,
            username: config.username.clone(),
            password: config.password.clone(),
            session_cookie: None,
        })
    }

    /// Authenticate with the Warpgate admin API.
    pub async fn login(&mut self) -> WarpgateResult<()> {
        let url = format!("{}/@warpgate/api/auth/login", self.base_url);
        let body = serde_json::json!({
            "username": self.username,
            "password": self.password,
        });
        let resp = self.http.post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status == 401 {
            return Err(WarpgateError::auth("Invalid credentials"));
        }
        if status >= 300 {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(WarpgateError::api(status, &format!("Login failed: {body_text}")));
        }

        // Extract session cookie from response
        if let Some(cookie_val) = resp.headers().get("set-cookie") {
            self.session_cookie = cookie_val.to_str().ok().map(|s| s.to_string());
        }

        Ok(())
    }

    /// Build the default headers for Warpgate admin API requests.
    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref cookie) = self.session_cookie {
            if let Ok(val) = HeaderValue::from_str(cookie) {
                headers.insert(COOKIE, val);
            }
        }
        headers
    }

    /// Build a full URL for a Warpgate admin API endpoint.
    pub fn url(&self, path: &str) -> String {
        format!("{}/@warpgate/admin/api{}", self.base_url, path)
    }

    // ── GET ──────────────────────────────────────────────────────────

    pub async fn get(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params(&self, path: &str, params: &[(&str, &str)]) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.get(&url)
            .headers(self.default_headers())
            .query(params)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_text(&self, path: &str) -> WarpgateResult<String> {
        let url = self.url(path);
        let resp = self.http.get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        let status = resp.status().as_u16();
        if status >= 200 && status < 300 {
            Ok(resp.text().await.unwrap_or_default())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    pub async fn get_bytes(&self, path: &str) -> WarpgateResult<Vec<u8>> {
        let url = self.url(path);
        let resp = self.http.get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        let status = resp.status().as_u16();
        if status >= 200 && status < 300 {
            Ok(resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    // ── POST ─────────────────────────────────────────────────────────

    pub async fn post(&self, path: &str, body: &serde_json::Value) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.post(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.post(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── PUT ──────────────────────────────────────────────────────────

    pub async fn put(&self, path: &str, body: &serde_json::Value) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.put(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── PATCH ────────────────────────────────────────────────────────

    pub async fn patch(&self, path: &str, body: &serde_json::Value) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.patch(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── DELETE ────────────────────────────────────────────────────────

    pub async fn delete(&self, path: &str) -> WarpgateResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self.http.delete(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── Response handler ─────────────────────────────────────────────

    async fn handle_response(&self, resp: reqwest::Response) -> WarpgateResult<serde_json::Value> {
        let status = resp.status().as_u16();
        if status >= 200 && status < 300 {
            let text = resp.text().await.unwrap_or_default();
            if text.is_empty() {
                return Ok(serde_json::Value::Null);
            }
            serde_json::from_str(&text).map_err(|e| WarpgateError::parse(&format!("Invalid JSON response: {e}")))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(self.map_error(status, &body))
        }
    }

    fn map_error(&self, status: u16, body: &str) -> WarpgateError {
        match status {
            401 => WarpgateError::auth(&format!("Authentication failed: {body}")),
            403 => WarpgateError::forbidden(&format!("Forbidden: {body}")),
            404 => WarpgateError::not_found(&format!("Not found: {body}")),
            409 => WarpgateError::conflict(&format!("Conflict: {body}")),
            429 => WarpgateError::rate_limited(&format!("Rate limited: {body}")),
            _ => WarpgateError::api(status, &format!("API error {status}: {body}")),
        }
    }

    /// Quick connectivity check – try to fetch parameters.
    pub async fn ping(&self) -> WarpgateResult<WarpgateConnectionStatus> {
        let result = self.get("/parameters").await;
        match result {
            Ok(_) => Ok(WarpgateConnectionStatus {
                connected: true,
                host: self.base_url.clone(),
                version: None,
            }),
            Err(e) => Err(e),
        }
    }
}
