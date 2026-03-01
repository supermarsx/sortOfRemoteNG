//! HTTP client for the Google Drive API v3.
//!
//! Wraps `reqwest::Client` with OAuth2 bearer-token auth, automatic rate
//! limiting, exponential-backoff retries, and helpers for the common HTTP
//! verbs used by the Drive REST surface.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use log::{debug, warn};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::types::{GDriveConfig, GDriveError, GDriveErrorKind, GDriveResult, OAuthToken};

/// Base URL for Drive API v3 metadata endpoints.
pub const API_BASE: &str = "https://www.googleapis.com/drive/v3";
/// Base URL for Drive API v3 upload endpoints.
pub const UPLOAD_BASE: &str = "https://www.googleapis.com/upload/drive/v3";
/// Google OAuth2 token endpoint.
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Google OAuth2 authorization endpoint.
pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// Google OAuth2 token revocation endpoint.
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

/// Google Drive HTTP client with built-in auth, rate-limiting, and retries.
#[derive(Clone)]
pub struct GDriveClient {
    /// Inner reqwest client.
    inner: Client,
    /// Currently active OAuth2 token.
    token: Option<OAuthToken>,
    /// Configuration.
    config: GDriveConfig,
    /// Nanosecond timestamp of the last request (for rate-limiting).
    last_request_ns: Arc<AtomicU64>,
}

impl GDriveClient {
    // ── Construction ─────────────────────────────────────────────

    /// Create a new client from config.
    pub fn new(config: GDriveConfig) -> GDriveResult<Self> {
        let inner = Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds))
            .build()
            .map_err(|e| GDriveError::network(format!("Failed to build HTTP client: {e}")))?;

        Ok(Self {
            inner,
            token: None,
            config,
            last_request_ns: Arc::new(AtomicU64::new(0)),
        })
    }

    /// Create a client without any configuration (for tests / quick scripts).
    pub fn default_client() -> GDriveResult<Self> {
        Self::new(GDriveConfig::default())
    }

    // ── Token management ─────────────────────────────────────────

    /// Set the active OAuth2 token.
    pub fn set_token(&mut self, token: OAuthToken) {
        self.token = Some(token);
    }

    /// Get a reference to the current token, if any.
    pub fn token(&self) -> Option<&OAuthToken> {
        self.token.as_ref()
    }

    /// Whether the client currently has a valid (non-expired) token.
    pub fn is_authenticated(&self) -> bool {
        self.token
            .as_ref()
            .map(|t| !t.access_token.is_empty() && !t.is_expired())
            .unwrap_or(false)
    }

    /// Get the config reference.
    pub fn config(&self) -> &GDriveConfig {
        &self.config
    }

    /// Get mutable config reference.
    pub fn config_mut(&mut self) -> &mut GDriveConfig {
        &mut self.config
    }

    // ── Rate limiting ────────────────────────────────────────────

    async fn rate_limit(&self) {
        if self.config.rate_limit_ms == 0 {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let last = self.last_request_ns.load(Ordering::Relaxed);
        let min_gap = self.config.rate_limit_ms * 1_000_000; // ms → ns
        if last > 0 && now.saturating_sub(last) < min_gap {
            let wait = min_gap - now.saturating_sub(last);
            tokio::time::sleep(Duration::from_nanos(wait)).await;
        }
        self.last_request_ns.store(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64,
            Ordering::Relaxed,
        );
    }

    // ── Request building helpers ─────────────────────────────────

    fn auth_headers(&self) -> GDriveResult<HeaderMap> {
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| GDriveError::auth("No OAuth2 token set"))?;
        if token.is_expired() {
            return Err(GDriveError::new(
                GDriveErrorKind::TokenExpired,
                "OAuth2 token has expired — refresh required",
            ));
        }
        let mut headers = HeaderMap::new();
        let val = format!("Bearer {}", token.access_token);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&val)
                .map_err(|e| GDriveError::auth(format!("Invalid auth header: {e}")))?,
        );
        Ok(headers)
    }

    fn build_request(&self, method: Method, url: &str) -> GDriveResult<RequestBuilder> {
        let headers = self.auth_headers()?;
        Ok(self.inner.request(method, url).headers(headers))
    }

    // ── Core execution with retries ──────────────────────────────

    /// Execute a request builder with automatic retry on transient failures.
    async fn execute_with_retry(
        &self,
        build_fn: impl Fn() -> GDriveResult<RequestBuilder>,
    ) -> GDriveResult<Response> {
        let max_retries = self.config.max_retries;
        let mut attempt = 0u32;
        loop {
            self.rate_limit().await;
            let request = build_fn()?.build().map_err(|e| {
                GDriveError::network(format!("Failed to build request: {e}"))
            })?;
            debug!("Drive API {} {}", request.method(), request.url());

            match self.inner.execute(request).await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp);
                    }
                    let body = resp.text().await.unwrap_or_default();
                    let err = GDriveError::from_status(status.as_u16(), &body);

                    // Retry on 429 and 5xx
                    if (status == StatusCode::TOO_MANY_REQUESTS
                        || status.is_server_error())
                        && attempt < max_retries
                    {
                        attempt += 1;
                        let backoff = Duration::from_millis(500 * 2u64.pow(attempt));
                        warn!(
                            "Drive API transient error ({}), retry {}/{} in {:?}",
                            status, attempt, max_retries, backoff
                        );
                        tokio::time::sleep(backoff).await;
                        continue;
                    }
                    return Err(err);
                }
                Err(e) => {
                    if attempt < max_retries {
                        attempt += 1;
                        let backoff = Duration::from_millis(500 * 2u64.pow(attempt));
                        warn!(
                            "Drive API network error: {}, retry {}/{} in {:?}",
                            e, attempt, max_retries, backoff
                        );
                        tokio::time::sleep(backoff).await;
                        continue;
                    }
                    return Err(GDriveError::network(e.to_string()));
                }
            }
        }
    }

    // ── Public HTTP verb helpers ──────────────────────────────────

    /// GET a JSON response.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> GDriveResult<T> {
        let url_owned = url.to_string();
        let resp = self
            .execute_with_retry(|| self.build_request(Method::GET, &url_owned))
            .await?;
        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("JSON parse error: {e}")))
    }

    /// GET with query parameters, return JSON.
    pub async fn get_json_with_query<T, Q>(&self, url: &str, query: &Q) -> GDriveResult<T>
    where
        T: DeserializeOwned,
        Q: Serialize + ?Sized,
    {
        let url_owned = url.to_string();
        let query_string = serde_json::to_value(query)
            .map_err(|e| GDriveError::invalid(format!("Query serialization: {e}")))?;

        let resp = self
            .execute_with_retry(|| {
                let mut req = self.build_request(Method::GET, &url_owned)?;
                if let Some(map) = query_string.as_object() {
                    let pairs: Vec<(String, String)> = map
                        .iter()
                        .filter_map(|(k, v)| {
                            let s = match v {
                                serde_json::Value::String(s) => Some(s.clone()),
                                serde_json::Value::Number(n) => Some(n.to_string()),
                                serde_json::Value::Bool(b) => Some(b.to_string()),
                                _ => None,
                            };
                            s.map(|val| (k.clone(), val))
                        })
                        .collect();
                    req = req.query(&pairs);
                }
                Ok(req)
            })
            .await?;

        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("JSON parse error: {e}")))
    }

    /// POST with a JSON body, return JSON.
    pub async fn post_json<B, T>(&self, url: &str, body: &B) -> GDriveResult<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let url_owned = url.to_string();
        let body_bytes = serde_json::to_vec(body)
            .map_err(|e| GDriveError::invalid(format!("Body serialization: {e}")))?;

        let resp = self
            .execute_with_retry(|| {
                let req = self.build_request(Method::POST, &url_owned)?;
                Ok(req
                    .header(CONTENT_TYPE, "application/json")
                    .body(body_bytes.clone()))
            })
            .await?;

        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("JSON parse error: {e}")))
    }

    /// PATCH with a JSON body, return JSON.
    pub async fn patch_json<B, T>(&self, url: &str, body: &B) -> GDriveResult<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let url_owned = url.to_string();
        let body_bytes = serde_json::to_vec(body)
            .map_err(|e| GDriveError::invalid(format!("Body serialization: {e}")))?;

        let resp = self
            .execute_with_retry(|| {
                let req = self.build_request(Method::PATCH, &url_owned)?;
                Ok(req
                    .header(CONTENT_TYPE, "application/json")
                    .body(body_bytes.clone()))
            })
            .await?;

        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("JSON parse error: {e}")))
    }

    /// DELETE (no response body expected).
    pub async fn delete(&self, url: &str) -> GDriveResult<()> {
        let url_owned = url.to_string();
        self.execute_with_retry(|| self.build_request(Method::DELETE, &url_owned))
            .await?;
        Ok(())
    }

    /// GET raw bytes (for file downloads).
    pub async fn get_bytes(&self, url: &str) -> GDriveResult<Vec<u8>> {
        let url_owned = url.to_string();
        let resp = self
            .execute_with_retry(|| self.build_request(Method::GET, &url_owned))
            .await?;
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| GDriveError::network(format!("Download error: {e}")))
    }

    /// POST raw bytes (for uploads), return JSON.
    pub async fn post_bytes<T: DeserializeOwned>(
        &self,
        url: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> GDriveResult<T> {
        let url_owned = url.to_string();
        let ct = content_type.to_string();

        let resp = self
            .execute_with_retry(|| {
                let req = self.build_request(Method::POST, &url_owned)?;
                Ok(req.header(CONTENT_TYPE, &ct).body(bytes.clone()))
            })
            .await?;

        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("JSON parse error: {e}")))
    }

    /// PUT raw bytes (for resumable upload chunks), return the raw Response.
    pub async fn put_bytes_raw(
        &self,
        url: &str,
        content_type: &str,
        bytes: Vec<u8>,
        extra_headers: HeaderMap,
    ) -> GDriveResult<Response> {
        let url_owned = url.to_string();
        let ct = content_type.to_string();

        self.execute_with_retry(|| {
            let req = self.build_request(Method::PUT, &url_owned)?;
            Ok(req
                .header(CONTENT_TYPE, &ct)
                .headers(extra_headers.clone())
                .body(bytes.clone()))
        })
        .await
    }

    /// POST to the token endpoint (un-authenticated).
    pub async fn post_form_unauthenticated<T: DeserializeOwned>(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> GDriveResult<T> {
        self.rate_limit().await;
        let resp = self
            .inner
            .post(url)
            .form(params)
            .send()
            .await
            .map_err(|e| GDriveError::network(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(GDriveError::from_status(status, &body));
        }
        resp.json::<T>()
            .await
            .map_err(|e| GDriveError::network(format!("Token response parse error: {e}")))
    }

    /// Build a full API URL: `{API_BASE}/{path}`.
    pub fn api_url(path: &str) -> String {
        format!("{}/{}", API_BASE, path.trim_start_matches('/'))
    }

    /// Build a full upload URL: `{UPLOAD_BASE}/{path}`.
    pub fn upload_url(path: &str) -> String {
        format!("{}/{}", UPLOAD_BASE, path.trim_start_matches('/'))
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OAuthToken;
    use chrono::Utc;

    #[test]
    fn api_url_construction() {
        assert_eq!(
            GDriveClient::api_url("files"),
            "https://www.googleapis.com/drive/v3/files"
        );
        assert_eq!(
            GDriveClient::api_url("/files"),
            "https://www.googleapis.com/drive/v3/files"
        );
        assert_eq!(
            GDriveClient::api_url("files/abc123"),
            "https://www.googleapis.com/drive/v3/files/abc123"
        );
    }

    #[test]
    fn upload_url_construction() {
        assert_eq!(
            GDriveClient::upload_url("files"),
            "https://www.googleapis.com/upload/drive/v3/files"
        );
    }

    #[test]
    fn new_client_default() {
        let client = GDriveClient::default_client().unwrap();
        assert!(!client.is_authenticated());
        assert!(client.token().is_none());
        assert_eq!(client.config().timeout_seconds, 30);
    }

    #[test]
    fn set_token() {
        let mut client = GDriveClient::default_client().unwrap();
        assert!(!client.is_authenticated());

        let token = OAuthToken {
            access_token: "ya29.test".into(),
            refresh_token: Some("1//refresh".into()),
            token_type: "Bearer".into(),
            expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
            scope: None,
        };
        client.set_token(token);
        assert!(client.is_authenticated());
    }

    #[test]
    fn expired_token_not_authenticated() {
        let mut client = GDriveClient::default_client().unwrap();
        let token = OAuthToken {
            access_token: "ya29.expired".into(),
            refresh_token: None,
            token_type: "Bearer".into(),
            expires_at: Some(Utc::now() - chrono::Duration::hours(1)),
            scope: None,
        };
        client.set_token(token);
        assert!(!client.is_authenticated());
    }

    #[test]
    fn empty_token_not_authenticated() {
        let mut client = GDriveClient::default_client().unwrap();
        let token = OAuthToken::default(); // empty access_token
        client.set_token(token);
        assert!(!client.is_authenticated());
    }

    #[test]
    fn auth_headers_no_token() {
        let client = GDriveClient::default_client().unwrap();
        let err = client.auth_headers().unwrap_err();
        assert_eq!(err.kind, GDriveErrorKind::AuthenticationFailed);
    }

    #[test]
    fn auth_headers_expired_token() {
        let mut client = GDriveClient::default_client().unwrap();
        client.set_token(OAuthToken {
            access_token: "ya29.expired".into(),
            expires_at: Some(Utc::now() - chrono::Duration::hours(1)),
            ..Default::default()
        });
        let err = client.auth_headers().unwrap_err();
        assert_eq!(err.kind, GDriveErrorKind::TokenExpired);
    }

    #[test]
    fn auth_headers_valid_token() {
        let mut client = GDriveClient::default_client().unwrap();
        client.set_token(OAuthToken {
            access_token: "ya29.valid".into(),
            expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
            ..Default::default()
        });
        let headers = client.auth_headers().unwrap();
        let auth_val = headers.get(AUTHORIZATION).unwrap().to_str().unwrap();
        assert_eq!(auth_val, "Bearer ya29.valid");
    }

    #[test]
    fn constants() {
        assert!(API_BASE.contains("googleapis.com/drive/v3"));
        assert!(UPLOAD_BASE.contains("upload/drive/v3"));
        assert!(TOKEN_URL.contains("oauth2.googleapis.com/token"));
        assert!(AUTH_URL.contains("accounts.google.com"));
        assert!(REVOKE_URL.contains("oauth2.googleapis.com/revoke"));
    }

    #[test]
    fn clone_client() {
        let client = GDriveClient::default_client().unwrap();
        let cloned = client.clone();
        assert!(!cloned.is_authenticated());
    }

    #[test]
    fn config_mut_access() {
        let mut client = GDriveClient::default_client().unwrap();
        client.config_mut().max_retries = 5;
        assert_eq!(client.config().max_retries, 5);
    }
}
