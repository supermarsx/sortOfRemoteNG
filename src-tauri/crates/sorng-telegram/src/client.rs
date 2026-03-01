//! Low-level HTTP client for the Telegram Bot API.
//!
//! Handles authentication (bearer token in URL), request signing,
//! retries, rate limiting, and error mapping.

use crate::types::*;
use log::{debug, warn};
use reqwest::multipart;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

const DEFAULT_API_BASE: &str = "https://api.telegram.org";

/// Low-level Telegram Bot API HTTP client.
#[derive(Debug, Clone)]
pub struct TelegramClient {
    http: reqwest::Client,
    token: String,
    api_base: String,
    max_retries: u32,
    rate_limit_ms: u64,
    /// Timestamp of the last request (for rate limiting).
    last_request_ms: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl TelegramClient {
    /// Create a new client from a [`TelegramBotConfig`].
    pub fn new(config: &TelegramBotConfig) -> Result<Self, String> {
        if config.token.is_empty() {
            return Err("Bot token must not be empty".into());
        }

        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds))
            .connect_timeout(Duration::from_secs(10));

        if let Some(ref proxy_url) = config.proxy_url {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| format!("Invalid proxy URL: {e}"))?;
            builder = builder.proxy(proxy);
        }

        let http = builder.build().map_err(|e| format!("HTTP client build error: {e}"))?;

        Ok(Self {
            http,
            token: config.token.clone(),
            api_base: config
                .api_base_url
                .clone()
                .unwrap_or_else(|| DEFAULT_API_BASE.to_string()),
            max_retries: config.max_retries,
            rate_limit_ms: config.rate_limit_ms,
            last_request_ms: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        })
    }

    /// Build the full URL for a Bot API method.
    fn method_url(&self, method: &str) -> String {
        format!("{}/bot{}/{}", self.api_base, self.token, method)
    }

    /// Enforce rate limiting between requests.
    async fn rate_limit(&self) {
        if self.rate_limit_ms == 0 {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let last = self
            .last_request_ms
            .load(std::sync::atomic::Ordering::Relaxed);
        if last > 0 {
            let elapsed = now.saturating_sub(last);
            if elapsed < self.rate_limit_ms {
                let wait = self.rate_limit_ms - elapsed;
                tokio::time::sleep(Duration::from_millis(wait)).await;
            }
        }
        let updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_request_ms
            .store(updated, std::sync::atomic::Ordering::Relaxed);
    }

    /// Call a Bot API method with a JSON body and parse the response.
    pub async fn call<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: &P,
    ) -> Result<R, String> {
        self.rate_limit().await;
        let url = self.method_url(method);
        let mut last_err = String::new();

        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                let backoff = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                debug!(
                    "Telegram API retry {}/{} for {} after {:?}",
                    attempt, self.max_retries, method, backoff
                );
                tokio::time::sleep(backoff).await;
            }

            let resp = self.http.post(&url).json(params).send().await;
            match resp {
                Ok(r) => {
                    let status = r.status();
                    let body = r
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("{{\"ok\":false,\"description\":\"{e}\"}}"));

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        // Parse retry_after if possible
                        if let Ok(api_resp) =
                            serde_json::from_str::<ApiResponse<serde_json::Value>>(&body)
                        {
                            if let Some(params) = &api_resp.parameters {
                                if let Some(retry_after) = params.retry_after {
                                    let wait = Duration::from_secs(retry_after as u64);
                                    warn!(
                                        "Telegram rate limited, waiting {:?} (attempt {})",
                                        wait, attempt
                                    );
                                    tokio::time::sleep(wait).await;
                                    continue;
                                }
                            }
                        }
                        last_err = format!("Rate limited (429): {body}");
                        continue;
                    }

                    let api_resp: ApiResponse<R> = serde_json::from_str(&body).map_err(|e| {
                        format!("Failed to parse Telegram response for {method}: {e}\nBody: {body}")
                    })?;

                    if api_resp.ok {
                        return api_resp
                            .result
                            .ok_or_else(|| format!("Telegram {method}: ok=true but no result"));
                    }

                    let desc = api_resp
                        .description
                        .unwrap_or_else(|| "Unknown error".into());
                    let code = api_resp.error_code.unwrap_or(0);

                    // Don't retry client errors (4xx) other than 429.
                    if (400..500).contains(&code) && code != 429 {
                        return Err(format!("Telegram API error {code}: {desc}"));
                    }

                    last_err = format!("Telegram API error {code}: {desc}");
                }
                Err(e) => {
                    last_err = format!("HTTP request to {} failed: {e}", method);
                    if e.is_timeout() || e.is_connect() {
                        continue;
                    }
                    return Err(last_err);
                }
            }
        }

        Err(format!(
            "All {} retries exhausted for {}: {}",
            self.max_retries, method, last_err
        ))
    }

    /// Call a Bot API method with no parameters.
    pub async fn call_no_params<R: DeserializeOwned>(
        &self,
        method: &str,
    ) -> Result<R, String> {
        let empty: serde_json::Value = serde_json::json!({});
        self.call(method, &empty).await
    }

    /// Call a Bot API method with multipart form data (for file uploads).
    pub async fn call_multipart<R: DeserializeOwned>(
        &self,
        method: &str,
        form: multipart::Form,
    ) -> Result<R, String> {
        self.rate_limit().await;
        let url = self.method_url(method);

        let resp = self
            .http
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Multipart upload to {method} failed: {e}"))?;

        let body = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("{{\"ok\":false,\"description\":\"{e}\"}}"));

        let api_resp: ApiResponse<R> = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response for {method}: {e}"))?;

        if api_resp.ok {
            api_resp
                .result
                .ok_or_else(|| format!("Telegram {method}: ok=true but no result"))
        } else {
            let desc = api_resp
                .description
                .unwrap_or_else(|| "Unknown error".into());
            let code = api_resp.error_code.unwrap_or(0);
            Err(format!("Telegram API error {code}: {desc}"))
        }
    }

    /// Get the bot's own user via getMe.
    pub async fn get_me(&self) -> Result<TgUser, String> {
        self.call_no_params("getMe").await
    }

    /// Get the API base URL.
    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// Get the token (masked for logging).
    pub fn masked_token(&self) -> String {
        if self.token.len() > 10 {
            format!("{}...{}", &self.token[..5], &self.token[self.token.len() - 4..])
        } else {
            "***".to_string()
        }
    }

    /// Build the download URL for a file.
    pub fn file_download_url(&self, file_path: &str) -> String {
        format!("{}/file/bot{}/{}", self.api_base, self.token, file_path)
    }

    /// Download a file by its file_path.
    pub async fn download_file(&self, file_path: &str) -> Result<Vec<u8>, String> {
        let url = self.file_download_url(file_path);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Download HTTP {}", resp.status()));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Download read error: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_method_url() {
        let config = TelegramBotConfig {
            token: "123456:ABC-DEF".to_string(),
            ..Default::default()
        };
        let client = TelegramClient::new(&config).unwrap();
        assert_eq!(
            client.method_url("sendMessage"),
            "https://api.telegram.org/bot123456:ABC-DEF/sendMessage"
        );
    }

    #[test]
    fn test_method_url_custom_base() {
        let config = TelegramBotConfig {
            token: "123456:XYZ".to_string(),
            api_base_url: Some("https://my-api.example.com".to_string()),
            ..Default::default()
        };
        let client = TelegramClient::new(&config).unwrap();
        assert_eq!(
            client.method_url("getMe"),
            "https://my-api.example.com/bot123456:XYZ/getMe"
        );
    }

    #[test]
    fn test_empty_token_rejected() {
        let config = TelegramBotConfig {
            token: "".to_string(),
            ..Default::default()
        };
        assert!(TelegramClient::new(&config).is_err());
    }

    #[test]
    fn test_masked_token() {
        let config = TelegramBotConfig {
            token: "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11".to_string(),
            ..Default::default()
        };
        let client = TelegramClient::new(&config).unwrap();
        let masked = client.masked_token();
        assert!(masked.starts_with("12345"));
        assert!(masked.ends_with("ew11"));
        assert!(masked.contains("..."));
    }

    #[test]
    fn test_file_download_url() {
        let config = TelegramBotConfig {
            token: "123:XYZ".to_string(),
            ..Default::default()
        };
        let client = TelegramClient::new(&config).unwrap();
        assert_eq!(
            client.file_download_url("documents/file_0.pdf"),
            "https://api.telegram.org/file/bot123:XYZ/documents/file_0.pdf"
        );
    }

    #[test]
    fn test_default_config() {
        let config = TelegramBotConfig::default();
        assert_eq!(config.timeout_seconds, 30);
        assert_eq!(config.max_retries, 3);
        assert!(config.enabled);
        assert_eq!(config.rate_limit_ms, 50);
        assert!(config.api_base_url.is_none());
        assert!(config.proxy_url.is_none());
    }
}
