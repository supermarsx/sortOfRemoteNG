//! HTTP client for the WhatsApp Business Cloud API (Meta Graph API).
//!
//! Provides low-level request helpers with retry logic, rate-limit
//! awareness, and automatic token refresh support.

use crate::whatsapp::error::{WhatsAppError, WhatsAppErrorCode, WhatsAppResult};
use crate::whatsapp::types::WaConfig;
use log::{debug, warn};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::multipart;
use std::time::Duration;

/// Low-level HTTP client for the Meta Graph API.
#[derive(Debug, Clone)]
pub struct CloudApiClient {
    client: reqwest::Client,
    config: WaConfig,
}

impl CloudApiClient {
    /// Create a new client from configuration.
    pub fn new(config: &WaConfig) -> WhatsAppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_sec as u64))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| WhatsAppError::network(format!("HTTP client init failed: {}", e)))?;

        Ok(Self {
            client,
            config: config.clone(),
        })
    }

    /// Update the access token (e.g. after refresh).
    pub fn set_access_token(&mut self, token: String) {
        self.config.access_token = token;
    }

    /// Get current config reference.
    pub fn config(&self) -> &WaConfig {
        &self.config
    }

    // ─── URL helpers ─────────────────────────────────────────────────

    /// Build a Graph API URL: `{base}/{version}/{path}`.
    pub fn url(&self, path: &str) -> String {
        format!(
            "{}/{}/{}",
            self.config.base_url, self.config.api_version, path
        )
    }

    /// Phone-number-scoped URL: `{base}/{version}/{phone_number_id}/{endpoint}`.
    pub fn phone_url(&self, endpoint: &str) -> String {
        format!(
            "{}/{}/{}/{}",
            self.config.base_url,
            self.config.api_version,
            self.config.phone_number_id,
            endpoint
        )
    }

    /// Business-account-scoped URL: `{base}/{version}/{waba_id}/{endpoint}`.
    pub fn waba_url(&self, endpoint: &str) -> String {
        format!(
            "{}/{}/{}/{}",
            self.config.base_url,
            self.config.api_version,
            self.config.business_account_id,
            endpoint
        )
    }

    // ─── HTTP primitives ─────────────────────────────────────────────

    fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", self.config.access_token)) {
            headers.insert(AUTHORIZATION, v);
        }
        headers
    }

    /// GET with automatic retry.
    pub async fn get(&self, url: &str) -> WhatsAppResult<serde_json::Value> {
        self.request_with_retry(reqwest::Method::GET, url, None)
            .await
    }

    /// GET with query parameters.
    pub async fn get_with_params(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> WhatsAppResult<serde_json::Value> {
        let full_url = reqwest::Url::parse_with_params(url, params)
            .map_err(|e| WhatsAppError::internal(format!("Invalid URL: {}", e)))?;
        self.request_with_retry(reqwest::Method::GET, full_url.as_str(), None)
            .await
    }

    /// POST JSON body.
    pub async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> WhatsAppResult<serde_json::Value> {
        self.request_with_retry(reqwest::Method::POST, url, Some(body.clone()))
            .await
    }

    /// DELETE.
    pub async fn delete(&self, url: &str) -> WhatsAppResult<serde_json::Value> {
        self.request_with_retry(reqwest::Method::DELETE, url, None)
            .await
    }

    /// POST multipart form (for media upload).
    ///
    /// Note: reqwest 0.11 `Form` does not support `try_clone()`, so this
    /// method is non-retryable. Only a single attempt is made.
    pub async fn post_multipart(
        &self,
        url: &str,
        form: multipart::Form,
    ) -> WhatsAppResult<serde_json::Value> {
        debug!("POST multipart {}", url);

        let resp = self
            .client
            .post(url)
            .headers(self.auth_headers())
            .multipart(form)
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status().as_u16();
                let body = r.text().await.unwrap_or_default();

                if status >= 200 && status < 300 {
                    return serde_json::from_str(&body).map_err(|e| {
                        WhatsAppError::internal(format!("JSON parse error: {}", e))
                    });
                }

                Err(WhatsAppError::from_api_response(status, &body))
            }
            Err(e) => Err(WhatsAppError::network(e.to_string())),
        }
    }

    /// Download raw bytes with auth (for media download).
    pub async fn download_bytes(&self, url: &str) -> WhatsAppResult<Vec<u8>> {
        let resp = self
            .client
            .get(url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| WhatsAppError::network(e.to_string()))?;

        let status = resp.status().as_u16();
        if status >= 200 && status < 300 {
            resp.bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| WhatsAppError::network(format!("Download failed: {}", e)))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(WhatsAppError::from_api_response(status, &body))
        }
    }

    // ─── Core request method with retry ──────────────────────────────

    async fn request_with_retry(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<serde_json::Value>,
    ) -> WhatsAppResult<serde_json::Value> {
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            debug!("{} {} (attempt {})", method, url, attempt);

            let mut req = self
                .client
                .request(method.clone(), url)
                .headers(self.auth_headers());

            if let Some(ref b) = body {
                req = req
                    .header(CONTENT_TYPE, "application/json")
                    .json(b);
            }

            let resp = req.send().await;

            match resp {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let resp_body = r.text().await.unwrap_or_default();

                    if status >= 200 && status < 300 {
                        if resp_body.is_empty() {
                            return Ok(serde_json::json!({"success": true}));
                        }
                        return serde_json::from_str(&resp_body).map_err(|e| {
                            WhatsAppError::internal(format!("JSON parse error: {}", e))
                        });
                    }

                    let err = WhatsAppError::from_api_response(status, &resp_body);
                    if Self::is_retryable(&err) && attempt <= self.config.max_retries {
                        let delay = Self::backoff_delay(attempt);
                        warn!("Retryable error (attempt {}): {}", attempt, err);
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return Err(err);
                }
                Err(e) => {
                    if attempt <= self.config.max_retries {
                        let delay = Self::backoff_delay(attempt);
                        warn!("Network error (attempt {}): {}", attempt, e);
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return Err(WhatsAppError::network(e.to_string()));
                }
            }
        }
    }

    /// Check if an error is retryable.
    fn is_retryable(err: &WhatsAppError) -> bool {
        matches!(
            err.code,
            WhatsAppErrorCode::RateLimited | WhatsAppErrorCode::NetworkError
        ) || err.http_status == Some(500)
            || err.http_status == Some(502)
            || err.http_status == Some(503)
    }

    /// Exponential backoff with jitter.
    fn backoff_delay(attempt: u32) -> Duration {
        let base_ms = 1000u64 * 2u64.pow(attempt.saturating_sub(1));
        let jitter = rand::random::<u64>() % 500;
        Duration::from_millis(base_ms + jitter)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> WaConfig {
        WaConfig {
            access_token: "test_token".to_string(),
            phone_number_id: "1234".to_string(),
            business_account_id: "5678".to_string(),
            api_version: "v21.0".to_string(),
            base_url: "https://graph.facebook.com".to_string(),
            webhook_verify_token: None,
            app_secret: None,
            timeout_sec: 30,
            max_retries: 3,
        }
    }

    #[test]
    fn test_url_builder() {
        let client = CloudApiClient::new(&test_config()).unwrap();
        assert_eq!(
            client.url("1234/messages"),
            "https://graph.facebook.com/v21.0/1234/messages"
        );
    }

    #[test]
    fn test_phone_url() {
        let client = CloudApiClient::new(&test_config()).unwrap();
        assert_eq!(
            client.phone_url("messages"),
            "https://graph.facebook.com/v21.0/1234/messages"
        );
    }

    #[test]
    fn test_waba_url() {
        let client = CloudApiClient::new(&test_config()).unwrap();
        assert_eq!(
            client.waba_url("message_templates"),
            "https://graph.facebook.com/v21.0/5678/message_templates"
        );
    }

    #[test]
    fn test_is_retryable() {
        let rate_err = WhatsAppError {
            code: WhatsAppErrorCode::RateLimited,
            message: "rate".to_string(),
            details: None,
            http_status: Some(429),
        };
        assert!(CloudApiClient::is_retryable(&rate_err));

        let auth_err = WhatsAppError {
            code: WhatsAppErrorCode::InvalidAccessToken,
            message: "bad".to_string(),
            details: None,
            http_status: Some(401),
        };
        assert!(!CloudApiClient::is_retryable(&auth_err));
    }

    #[test]
    fn test_backoff_delay() {
        let d1 = CloudApiClient::backoff_delay(1);
        assert!(d1.as_millis() >= 1000 && d1.as_millis() < 1600);
        let d2 = CloudApiClient::backoff_delay(2);
        assert!(d2.as_millis() >= 2000 && d2.as_millis() < 2600);
    }
}
