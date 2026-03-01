//! Low-level HTTP client for the Dropbox API v2.
//!
//! All API calls go through [`DropboxClient`] which handles:
//! - Bearer token injection
//! - RPC vs content-upload vs content-download endpoint routing
//! - Rate-limit (429) retries with exponential back-off
//! - JSON error envelope parsing

use crate::types::DropboxApiError;
use log::warn;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Base URLs for the three Dropbox endpoint families.
const API_BASE: &str = "https://api.dropboxapi.com/2";
const CONTENT_BASE: &str = "https://content.dropboxapi.com/2";
const NOTIFY_BASE: &str = "https://notify.dropboxapi.com/2";

/// Maximum retries on 429 / 500-class responses.
const MAX_RETRIES: u32 = 4;

/// HTTP client for a single Dropbox account.
#[derive(Clone)]
pub struct DropboxClient {
    http: reqwest::Client,
    access_token: String,
    api_base: String,
    content_base: String,
    notify_base: String,
}

impl std::fmt::Debug for DropboxClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DropboxClient")
            .field("api_base", &self.api_base)
            .field("token_preview", &self.masked_token())
            .finish()
    }
}

impl DropboxClient {
    /// Create a new client for the given access token.
    pub fn new(access_token: &str) -> Result<Self, String> {
        if access_token.is_empty() {
            return Err("Dropbox access_token must not be empty".into());
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

        Ok(Self {
            http,
            access_token: access_token.to_string(),
            api_base: API_BASE.to_string(),
            content_base: CONTENT_BASE.to_string(),
            notify_base: NOTIFY_BASE.to_string(),
        })
    }

    /// Override base URLs (for testing).
    #[cfg(test)]
    pub fn with_bases(mut self, api: &str, content: &str, notify: &str) -> Self {
        self.api_base = api.to_string();
        self.content_base = content.to_string();
        self.notify_base = notify.to_string();
        self
    }

    /// Update the access token (e.g. after a refresh).
    pub fn set_access_token(&mut self, token: &str) {
        self.access_token = token.to_string();
    }

    /// Show a masked version of the token for logging.
    pub fn masked_token(&self) -> String {
        if self.access_token.len() <= 8 {
            "****".into()
        } else {
            format!("{}…{}", &self.access_token[..4], &self.access_token[self.access_token.len() - 4..])
        }
    }

    fn auth_header(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let val = format!("Bearer {}", self.access_token);
        headers.insert(AUTHORIZATION, HeaderValue::from_str(&val).unwrap());
        headers
    }

    // ── RPC endpoint (JSON in, JSON out) ────────────────────────────

    /// Call an RPC endpoint: `POST {api_base}/{route}` with JSON body.
    pub async fn rpc<P: Serialize, R: DeserializeOwned>(
        &self,
        route: &str,
        params: &P,
    ) -> Result<R, String> {
        let url = format!("{}/{}", self.api_base, route);
        self.post_json(&url, params).await
    }

    /// Call an RPC endpoint that takes no body (empty JSON object).
    pub async fn rpc_no_body<R: DeserializeOwned>(&self, route: &str) -> Result<R, String> {
        let empty = serde_json::json!(null);
        let url = format!("{}/{}", self.api_base, route);
        self.post_json(&url, &empty).await
    }

    async fn post_json<P: Serialize, R: DeserializeOwned>(
        &self,
        url: &str,
        params: &P,
    ) -> Result<R, String> {
        let mut last_err = String::new();

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                tokio::time::sleep(delay).await;
            }

            let resp = self
                .http
                .post(url)
                .headers(self.auth_header())
                .header(CONTENT_TYPE, "application/json")
                .json(params)
                .send()
                .await;

            let resp = match resp {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!("HTTP request to {url} failed: {e}");
                    continue;
                }
            };

            let status = resp.status();

            if status == 429 {
                let retry_after = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(1);
                warn!("Dropbox 429 rate-limit, retry after {retry_after}s (attempt {attempt})");
                tokio::time::sleep(Duration::from_secs(retry_after)).await;
                last_err = "Rate limited (429)".into();
                continue;
            }

            let body = resp
                .text()
                .await
                .unwrap_or_else(|e| format!(r#"{{"error_summary":"read body: {e}"}}"#));

            if status.is_success() {
                return serde_json::from_str(&body)
                    .map_err(|e| format!("Failed to parse response from {url}: {e} — body: {body}"));
            }

            if status.is_server_error() && attempt < MAX_RETRIES {
                last_err = format!("Server error {status} from {url}: {body}");
                continue;
            }

            // Client error (4xx except 429) — not retryable
            let api_err: Result<DropboxApiError, _> = serde_json::from_str(&body);
            return Err(match api_err {
                Ok(e) => e
                    .error_summary
                    .unwrap_or_else(|| format!("Dropbox API error {status}")),
                Err(_) => format!("Dropbox API error {status}: {body}"),
            });
        }

        Err(format!("Dropbox API request failed after {MAX_RETRIES} retries: {last_err}"))
    }

    // ── Content-upload endpoint ─────────────────────────────────────

    /// Upload file content via the content endpoint.
    ///
    /// Dropbox uses an `Dropbox-API-Arg` header for the commit metadata
    /// and the raw body carries the file bytes.
    pub async fn content_upload<A: Serialize, R: DeserializeOwned>(
        &self,
        route: &str,
        api_arg: &A,
        data: &[u8],
    ) -> Result<R, String> {
        let url = format!("{}/{}", self.content_base, route);
        let api_arg_json = serde_json::to_string(api_arg)
            .map_err(|e| format!("Failed to serialise Dropbox-API-Arg: {e}"))?;

        let mut last_err = String::new();

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                tokio::time::sleep(delay).await;
            }

            let resp = self
                .http
                .post(&url)
                .headers(self.auth_header())
                .header(CONTENT_TYPE, "application/octet-stream")
                .header("Dropbox-API-Arg", &api_arg_json)
                .body(data.to_vec())
                .send()
                .await;

            let resp = match resp {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!("Content upload to {url} failed: {e}");
                    continue;
                }
            };

            let status = resp.status();

            if status == 429 {
                let retry_after = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(1);
                tokio::time::sleep(Duration::from_secs(retry_after)).await;
                last_err = "Rate limited (429)".into();
                continue;
            }

            let body = resp.text().await.unwrap_or_default();

            if status.is_success() {
                return serde_json::from_str(&body)
                    .map_err(|e| format!("Parse content-upload response: {e}"));
            }

            if status.is_server_error() && attempt < MAX_RETRIES {
                last_err = format!("Server error {status}: {body}");
                continue;
            }

            let api_err: Result<DropboxApiError, _> = serde_json::from_str(&body);
            return Err(match api_err {
                Ok(e) => e.error_summary.unwrap_or_else(|| format!("Error {status}")),
                Err(_) => format!("Error {status}: {body}"),
            });
        }

        Err(format!("Content upload failed after {MAX_RETRIES} retries: {last_err}"))
    }

    // ── Content-download endpoint ───────────────────────────────────

    /// Download file content via the content endpoint.
    ///
    /// Returns the raw bytes. The metadata is in the `Dropbox-API-Result` header.
    pub async fn content_download<A: Serialize>(
        &self,
        route: &str,
        api_arg: &A,
    ) -> Result<(Vec<u8>, Option<String>), String> {
        let url = format!("{}/{}", self.content_base, route);
        let api_arg_json = serde_json::to_string(api_arg)
            .map_err(|e| format!("Failed to serialise Dropbox-API-Arg: {e}"))?;

        let resp = self
            .http
            .post(&url)
            .headers(self.auth_header())
            .header("Dropbox-API-Arg", &api_arg_json)
            .send()
            .await
            .map_err(|e| format!("Content download from {url} failed: {e}"))?;

        let status = resp.status();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            let api_err: Result<DropboxApiError, _> = serde_json::from_str(&body);
            return Err(match api_err {
                Ok(e) => e.error_summary.unwrap_or_else(|| format!("Error {status}")),
                Err(_) => format!("Error {status}: {body}"),
            });
        }

        let api_result = resp
            .headers()
            .get("dropbox-api-result")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download body: {e}"))?
            .to_vec();

        Ok((bytes, api_result))
    }

    // ── Notify endpoint (long-poll) ─────────────────────────────────

    /// Long-poll for changes on a cursor (via the notify endpoint).
    pub async fn list_folder_longpoll(
        &self,
        cursor: &str,
        timeout: u64,
    ) -> Result<LongpollResult, String> {
        let url = format!("{}/files/list_folder/longpoll", self.notify_base);
        let body = serde_json::json!({
            "cursor": cursor,
            "timeout": timeout,
        });

        // longpoll does NOT use auth header
        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .timeout(Duration::from_secs(timeout + 30))
            .send()
            .await
            .map_err(|e| format!("Longpoll failed: {e}"))?;

        let text = resp.text().await.unwrap_or_default();
        serde_json::from_str(&text).map_err(|e| format!("Parse longpoll response: {e}"))
    }
}

/// Result of a longpoll call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongpollResult {
    pub changes: bool,
    #[serde(default)]
    pub backoff: Option<u64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_rejects_empty_token() {
        assert!(DropboxClient::new("").is_err());
    }

    #[test]
    fn new_accepts_valid_token() {
        let c = DropboxClient::new("sl.abc123def456").unwrap();
        assert!(c.masked_token().starts_with("sl.a"));
    }

    #[test]
    fn masked_token_short() {
        let c = DropboxClient::new("tiny").unwrap();
        assert_eq!(c.masked_token(), "****");
    }

    #[test]
    fn masked_token_long() {
        let c = DropboxClient::new("sl.abcdef12345678").unwrap();
        let m = c.masked_token();
        assert!(m.starts_with("sl.a"));
        assert!(m.ends_with("5678"));
        assert!(m.contains('…'));
    }

    #[test]
    fn set_access_token_updates() {
        let mut c = DropboxClient::new("old_token_value").unwrap();
        c.set_access_token("new_token_value");
        assert!(c.masked_token().contains("alue"));
    }

    #[test]
    fn debug_format() {
        let c = DropboxClient::new("sl.testing12345678").unwrap();
        let dbg = format!("{:?}", c);
        assert!(dbg.contains("DropboxClient"));
        assert!(dbg.contains("api_base"));
    }

    #[test]
    fn longpoll_result_deser() {
        let json = r#"{"changes":true,"backoff":60}"#;
        let r: LongpollResult = serde_json::from_str(json).unwrap();
        assert!(r.changes);
        assert_eq!(r.backoff, Some(60));
    }

    #[test]
    fn longpoll_result_no_backoff() {
        let json = r#"{"changes":false}"#;
        let r: LongpollResult = serde_json::from_str(json).unwrap();
        assert!(!r.changes);
        assert!(r.backoff.is_none());
    }
}
