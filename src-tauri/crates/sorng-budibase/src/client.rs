// ── sorng-budibase/src/client.rs ───────────────────────────────────────────────
//! Budibase REST API HTTP client.

use crate::error::{BudibaseError, BudibaseResult};
use crate::types::*;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use std::time::Duration;

/// Budibase API client wrapping reqwest.
pub struct BudibaseClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub api_key: String,
    pub app_id: Option<String>,
}

impl BudibaseClient {
    /// Build a client from a connection config.
    pub fn from_config(config: &BudibaseConnectionConfig) -> BudibaseResult<Self> {
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds.unwrap_or(30)));

        if config.skip_tls_verify {
            log::warn!("TLS certificate verification disabled for Budibase connection to {}", config.host);
            builder = builder.danger_accept_invalid_certs(true);
        }

        let http = builder
            .build()
            .map_err(|e| BudibaseError::connection(&e.to_string()))?;

        // Normalise base URL (strip trailing slash)
        let base_url = config.host.trim_end_matches('/').to_string();

        Ok(Self {
            http,
            base_url,
            api_key: config.api_key.clone(),
            app_id: config.app_id.clone(),
        })
    }

    /// Build the default headers for Budibase API requests.
    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-budibase-api-key",
            HeaderValue::from_str(&self.api_key).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref app_id) = self.app_id {
            headers.insert(
                "x-budibase-app-id",
                HeaderValue::from_str(app_id).unwrap_or_else(|_| HeaderValue::from_static("")),
            );
        }
        headers
    }

    /// Build a full URL for an API endpoint.
    pub fn url(&self, path: &str) -> String {
        format!("{}/api/public/v1{}", self.base_url, path)
    }

    /// Build a full URL for an internal API endpoint.
    pub fn internal_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url, path)
    }

    // ── GET ──────────────────────────────────────────────────────────

    pub async fn get(&self, path: &str) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .get(&url)
            .headers(self.default_headers())
            .query(params)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── POST ─────────────────────────────────────────────────────────

    pub async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── PUT ──────────────────────────────────────────────────────────

    pub async fn put(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .put(&url)
            .headers(self.default_headers())
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── DELETE ────────────────────────────────────────────────────────

    pub async fn delete(&self, path: &str) -> BudibaseResult<serde_json::Value> {
        let url = self.url(path);
        let resp = self
            .http
            .delete(&url)
            .headers(self.default_headers())
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── Response handler ─────────────────────────────────────────────

    async fn handle_response(&self, resp: reqwest::Response) -> BudibaseResult<serde_json::Value> {
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            if text.is_empty() {
                return Ok(serde_json::Value::Null);
            }
            serde_json::from_str(&text)
                .map_err(|e| BudibaseError::parse(&format!("Invalid JSON response: {e}")))
        } else {
            let body = resp.text().await.unwrap_or_default();
            match status {
                401 => Err(BudibaseError::auth(&format!(
                    "Authentication failed: {body}"
                ))),
                403 => Err(BudibaseError::forbidden(&format!("Forbidden: {body}"))),
                404 => Err(BudibaseError::not_found(&format!("Not found: {body}"))),
                409 => Err(BudibaseError::conflict(&format!("Conflict: {body}"))),
                429 => Err(BudibaseError::rate_limited(&format!(
                    "Rate limited: {body}"
                ))),
                _ => Err(BudibaseError::api(
                    status,
                    &format!("API error {status}: {body}"),
                )),
            }
        }
    }

    /// Quick connectivity check.
    pub async fn ping(&self) -> BudibaseResult<BudibaseConnectionStatus> {
        // Try to fetch apps as a health check
        let result = self.get("/applications?limit=1").await;
        match result {
            Ok(_) => Ok(BudibaseConnectionStatus {
                connected: true,
                host: self.base_url.clone(),
                version: None,
                tenant_id: None,
            }),
            Err(e) => Err(e),
        }
    }
}
