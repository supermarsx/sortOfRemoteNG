//! HTTP client for the Microsoft Graph API.
//!
//! Wraps `reqwest::Client` with automatic Bearer-token injection, retry
//! logic with exponential back-off for 429 / 503 / 504, and transparent
//! JSON envelope parsing.

use crate::onedrive::error::{OneDriveError, OneDriveResult};
use crate::onedrive::types::OneDriveConfig;
use log::{debug, warn};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use std::time::Duration;

/// Low-level Graph API HTTP client.
#[derive(Debug, Clone)]
pub struct GraphApiClient {
    inner: reqwest::Client,
    base_url: String,
    access_token: String,
    max_retries: u32,
}

impl GraphApiClient {
    /// Create a new Graph client.
    pub fn new(config: &OneDriveConfig, access_token: &str) -> OneDriveResult<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );

        let inner = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_sec))
            .default_headers(headers)
            .build()
            .map_err(|e| OneDriveError::internal(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            inner,
            base_url: config.graph_base_url.clone(),
            access_token: access_token.to_string(),
            max_retries: config.max_retries,
        })
    }

    /// Update the access token (after a refresh).
    pub fn set_access_token(&mut self, token: &str) {
        self.access_token = token.to_string();
    }

    /// Full URL for a Graph endpoint path.
    pub fn url(&self, path: &str) -> String {
        if path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}/{}", self.base_url, path.trim_start_matches('/'))
        }
    }

    /// GET with optional query parameters.
    pub async fn get(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> OneDriveResult<serde_json::Value> {
        let url = self.url(path);
        self.request_with_retry(|| {
            self.inner
                .get(&url)
                .bearer_auth(&self.access_token)
                .query(query)
        })
        .await
    }

    /// GET raw bytes (for downloads).
    pub async fn get_bytes(
        &self,
        url: &str,
    ) -> OneDriveResult<Vec<u8>> {
        let full_url = self.url(url);
        debug!("GET (bytes) {}", full_url);

        let resp = self
            .inner
            .get(&full_url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(OneDriveError::from)?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.text().await.unwrap_or_default();
            return Err(OneDriveError::from_graph_response(status, &body));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(OneDriveError::from)
    }

    /// POST JSON body.
    pub async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> OneDriveResult<serde_json::Value> {
        let url = self.url(path);
        self.request_with_retry(|| {
            self.inner
                .post(&url)
                .bearer_auth(&self.access_token)
                .json(body)
        })
        .await
    }

    /// POST with empty body (actions).
    pub async fn post_empty(
        &self,
        path: &str,
    ) -> OneDriveResult<serde_json::Value> {
        let url = self.url(path);
        self.request_with_retry(|| {
            self.inner
                .post(&url)
                .bearer_auth(&self.access_token)
                .header(CONTENT_TYPE, "application/json")
                .body("")
        })
        .await
    }

    /// PATCH JSON body.
    pub async fn patch(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> OneDriveResult<serde_json::Value> {
        let url = self.url(path);
        self.request_with_retry(|| {
            self.inner
                .patch(&url)
                .bearer_auth(&self.access_token)
                .json(body)
        })
        .await
    }

    /// PUT raw bytes (for small file uploads).
    pub async fn put_bytes(
        &self,
        path: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> OneDriveResult<serde_json::Value> {
        let url = self.url(path);
        debug!("PUT (bytes) {} ({} bytes)", url, data.len());

        let resp = self
            .inner
            .put(&url)
            .bearer_auth(&self.access_token)
            .header(CONTENT_TYPE, content_type)
            .body(data)
            .send()
            .await
            .map_err(OneDriveError::from)?;

        self.handle_response(resp).await
    }

    /// PUT a byte range for resumable upload (no auth on upload URL).
    pub async fn put_upload_range(
        &self,
        upload_url: &str,
        data: Vec<u8>,
        range_start: u64,
        range_end: u64,
        total_size: u64,
    ) -> OneDriveResult<serde_json::Value> {
        let content_range = format!(
            "bytes {}-{}/{}",
            range_start, range_end, total_size
        );
        debug!("PUT upload range: {}", content_range);

        let resp = self
            .inner
            .put(upload_url)
            .header("Content-Range", &content_range)
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(data)
            .send()
            .await
            .map_err(OneDriveError::from)?;

        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();

        // 200/201 = completed, 202 = accepted (more ranges needed).
        if status == 200 || status == 201 || status == 202 {
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            Ok(v)
        } else {
            Err(OneDriveError::from_graph_response(status, &body))
        }
    }

    /// DELETE a resource.
    pub async fn delete(&self, path: &str) -> OneDriveResult<()> {
        let url = self.url(path);
        debug!("DELETE {}", url);

        let resp = self
            .inner
            .delete(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(OneDriveError::from)?;

        let status = resp.status().as_u16();
        if status == 204 || status == 200 {
            Ok(())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(OneDriveError::from_graph_response(status, &body))
        }
    }

    // ─── Internal ────────────────────────────────────────────────────

    async fn request_with_retry<F>(
        &self,
        build: impl Fn() -> F,
    ) -> OneDriveResult<serde_json::Value>
    where
        F: Into<reqwest::RequestBuilder>,
    {
        let mut last_err = OneDriveError::internal("No attempts made");

        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                let delay = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                warn!("Retry {}/{} after {:?}", attempt, self.max_retries, delay);
                tokio::time::sleep(delay).await;
            }

            let req: reqwest::RequestBuilder = build().into();
            match req.send().await {
                Ok(resp) => match self.handle_response(resp).await {
                    Ok(v) => return Ok(v),
                    Err(e) if Self::is_retryable(&e) && attempt < self.max_retries => {
                        last_err = e;
                        continue;
                    }
                    Err(e) => return Err(e),
                },
                Err(e) => {
                    last_err = OneDriveError::from(e);
                    if attempt < self.max_retries {
                        continue;
                    }
                }
            }
        }

        Err(last_err)
    }

    async fn handle_response(
        &self,
        resp: reqwest::Response,
    ) -> OneDriveResult<serde_json::Value> {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();

        debug!("Response status={} body_len={}", status, body.len());

        if status >= 400 {
            return Err(OneDriveError::from_graph_response(status, &body));
        }

        // 204 No Content — return null.
        if body.is_empty() {
            return Ok(serde_json::Value::Null);
        }

        serde_json::from_str(&body).map_err(OneDriveError::from)
    }

    fn is_retryable(err: &OneDriveError) -> bool {
        matches!(
            err.code,
            crate::onedrive::error::OneDriveErrorCode::RateLimited
                | crate::onedrive::error::OneDriveErrorCode::NetworkError
                | crate::onedrive::error::OneDriveErrorCode::InternalError
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_building() {
        let config = OneDriveConfig::default();
        let client = GraphApiClient::new(&config, "tok").unwrap();
        assert_eq!(
            client.url("/me/drive"),
            "https://graph.microsoft.com/v1.0/me/drive"
        );
        assert_eq!(
            client.url("me/drive"),
            "https://graph.microsoft.com/v1.0/me/drive"
        );
        assert_eq!(
            client.url("https://custom.host/path"),
            "https://custom.host/path"
        );
    }

    #[test]
    fn test_is_retryable() {
        assert!(GraphApiClient::is_retryable(&OneDriveError::network("timeout")));
        assert!(GraphApiClient::is_retryable(&OneDriveError::internal("500")));
        assert!(!GraphApiClient::is_retryable(&OneDriveError::not_found("nope")));
    }

    #[test]
    fn test_set_access_token() {
        let config = OneDriveConfig::default();
        let mut client = GraphApiClient::new(&config, "old").unwrap();
        assert_eq!(client.access_token, "old");
        client.set_access_token("new");
        assert_eq!(client.access_token, "new");
    }
}
