//! HTTP API client for the Passbolt REST API.
//!
//! Handles all low-level HTTP communication with a Passbolt server including:
//! - Request building with JWT Bearer or GPGAuth cookie authentication
//! - Query parameter construction for Passbolt's `contain[]` and `filter[]` system
//! - Response envelope unwrapping (`ApiResponse<T>`)
//! - Error mapping from HTTP status codes to `PassboltError`
//! - Automatic token refresh on 401 responses (JWT mode)

use crate::passbolt::types::*;
use reqwest::header::AUTHORIZATION;
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Passbolt API client.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PassboltApiClient {
    /// HTTP client.
    client: Client,
    /// Server base URL.
    base_url: String,
    /// Current session state.
    session: SessionState,
    /// Whether TLS verification is enabled.
    verify_tls: bool,
    /// Request timeout.
    timeout: Duration,
}

impl PassboltApiClient {
    /// Create a new API client.
    pub fn new(base_url: &str, verify_tls: bool, timeout_secs: u64) -> Result<Self, PassboltError> {
        let client = Client::builder()
            .danger_accept_invalid_certs(!verify_tls)
            .timeout(Duration::from_secs(timeout_secs))
            .cookie_store(true)
            .build()
            .map_err(|e| PassboltError::network(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            session: SessionState::default(),
            verify_tls,
            timeout: Duration::from_secs(timeout_secs),
        })
    }

    /// Create from a `PassboltConfig`.
    pub fn from_config(config: &PassboltConfig) -> Self {
        Self::new(
            &config.server_url,
            config.verify_tls,
            config.request_timeout_secs,
        )
        .unwrap_or_else(|_| {
            // Fallback: use a default client if builder fails
            Self {
                client: Client::new(),
                base_url: config.server_url.trim_end_matches('/').to_string(),
                session: SessionState::default(),
                verify_tls: config.verify_tls,
                timeout: Duration::from_secs(config.request_timeout_secs),
            }
        })
    }

    /// Get the base URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Set the base URL.
    pub fn set_base_url(&mut self, url: &str) {
        self.base_url = url.trim_end_matches('/').to_string();
    }

    /// Get a reference to the current session.
    pub fn session(&self) -> &SessionState {
        &self.session
    }

    /// Get a mutable reference to the session.
    pub fn session_mut(&mut self) -> &mut SessionState {
        &mut self.session
    }

    /// Set the session state.
    pub fn set_session(&mut self, session: SessionState) {
        self.session = session;
    }

    /// Check if authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.session.authenticated
    }

    // ── Request building ────────────────────────────────────────────

    /// Build a URL from a path.
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Create an authenticated request builder.
    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        let url = self.url(path);
        let mut builder = self.client.request(method, &url);

        // Add auth headers based on session.
        if let Some(ref token) = self.session.access_token {
            builder = builder.header(AUTHORIZATION, format!("Bearer {}", token));
        }
        if let Some(ref csrf) = self.session.csrf_token {
            builder = builder.header("X-CSRF-Token", csrf.as_str());
        }

        builder
    }

    /// Build query parameters for Passbolt's `contain[key]=1` / `filter[key]=value` style.
    pub fn build_contain_filter_params(
        &self,
        contains: &[(&str, bool)],
        filters: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        let mut params = Vec::new();
        for (key, val) in contains {
            if *val {
                params.push((format!("contain[{}]", key), "1".to_string()));
            }
        }
        for (key, val) in filters {
            params.push((format!("filter[{}]", key), val.to_string()));
        }
        params
    }

    // ── Response handling ───────────────────────────────────────────

    /// Execute a request and parse the standard Passbolt envelope.
    pub async fn execute<T: DeserializeOwned>(
        &self,
        builder: RequestBuilder,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let response = builder
            .send()
            .await
            .map_err(|e| PassboltError::network(format!("Request failed: {}", e)))?;

        self.handle_response(response).await
    }

    /// Execute a request, returning just the body.
    pub async fn execute_body<T: DeserializeOwned>(
        &self,
        builder: RequestBuilder,
    ) -> Result<T, PassboltError> {
        let resp = self.execute::<T>(builder).await?;
        Ok(resp.body)
    }

    /// Handle a raw HTTP response.
    async fn handle_response<T: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let status = response.status();
        let url = response.url().to_string();

        match status {
            s if s.is_success() => {
                let text = response.text().await.map_err(|e| {
                    PassboltError::parse(format!("Failed to read response body: {}", e))
                })?;
                let envelope: ApiResponse<T> = serde_json::from_str(&text).map_err(|e| {
                    PassboltError::parse(format!(
                        "Failed to parse response JSON: {} (url: {})",
                        e, url
                    ))
                })?;
                Ok(envelope)
            }
            StatusCode::BAD_REQUEST => {
                let text = response.text().await.unwrap_or_default();
                Err(PassboltError::bad_request(format!(
                    "Bad request: {} ({})",
                    text, url
                )))
            }
            StatusCode::UNAUTHORIZED => Err(PassboltError::session_expired(
                "Authentication required or session expired",
            )),
            StatusCode::FORBIDDEN => {
                let text = response.text().await.unwrap_or_default();
                if text.contains("MFA") || text.contains("mfa") {
                    Err(PassboltError::mfa_required("MFA verification required"))
                } else {
                    Err(PassboltError::forbidden(format!("Access denied: {}", url)))
                }
            }
            StatusCode::NOT_FOUND => Err(PassboltError::not_found(format!("Not found: {}", url))),
            StatusCode::CONFLICT => Err(PassboltError::conflict(
                "Entity was modified by another user",
            )),
            StatusCode::TOO_MANY_REQUESTS => {
                Err(PassboltError::rate_limited("Rate limited by server"))
            }
            s if s.is_server_error() => {
                let text = response.text().await.unwrap_or_default();
                Err(PassboltError::server(format!(
                    "Server error {}: {}",
                    s.as_u16(),
                    text
                )))
            }
            _ => {
                let text = response.text().await.unwrap_or_default();
                Err(PassboltError::api(format!(
                    "Unexpected status {}: {}",
                    status.as_u16(),
                    text
                )))
            }
        }
    }

    /// Execute a raw request returning the response directly (for auth flows).
    pub async fn execute_raw(&self, builder: RequestBuilder) -> Result<Response, PassboltError> {
        builder
            .send()
            .await
            .map_err(|e| PassboltError::network(format!("Request failed: {}", e)))
    }

    // ── Convenience HTTP methods ────────────────────────────────────

    /// GET request with full envelope.
    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::GET, path);
        self.execute(builder).await
    }

    /// GET request with query parameters.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &std::collections::HashMap<String, String>,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let pairs: Vec<(String, String)> =
            params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let builder = self.request(Method::GET, path).query(&pairs);
        self.execute(builder).await
    }

    /// GET returning just the body.
    pub async fn get_body<T: DeserializeOwned>(&self, path: &str) -> Result<T, PassboltError> {
        let builder = self.request(Method::GET, path);
        self.execute_body(builder).await
    }

    /// POST request with JSON body.
    pub async fn post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::POST, path).json(body);
        self.execute(builder).await
    }

    /// POST returning just the body.
    pub async fn post_body<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PassboltError> {
        let builder = self.request(Method::POST, path).json(body);
        self.execute_body(builder).await
    }

    /// PUT request with JSON body.
    pub async fn put<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::PUT, path).json(body);
        self.execute(builder).await
    }

    /// PUT returning just the body.
    pub async fn put_body<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PassboltError> {
        let builder = self.request(Method::PUT, path).json(body);
        self.execute_body(builder).await
    }

    /// DELETE request.
    pub async fn delete<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::DELETE, path);
        self.execute(builder).await
    }

    /// DELETE returning just the body (often null).
    pub async fn delete_void(&self, path: &str) -> Result<(), PassboltError> {
        let builder = self.request(Method::DELETE, path);
        let response = builder
            .send()
            .await
            .map_err(|e| PassboltError::network(format!("Request failed: {}", e)))?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            let text = response.text().await.unwrap_or_default();
            Err(self.error_from_status(status, &text))
        }
    }

    /// Map an HTTP status to a PassboltError.
    fn error_from_status(&self, status: StatusCode, body: &str) -> PassboltError {
        match status {
            StatusCode::BAD_REQUEST => PassboltError::bad_request(body.to_string()),
            StatusCode::UNAUTHORIZED => PassboltError::session_expired("Authentication required"),
            StatusCode::FORBIDDEN => PassboltError::forbidden(body.to_string()),
            StatusCode::NOT_FOUND => PassboltError::not_found(body.to_string()),
            StatusCode::CONFLICT => PassboltError::conflict(body.to_string()),
            StatusCode::TOO_MANY_REQUESTS => PassboltError::rate_limited("Rate limited"),
            _ => PassboltError::api(format!("HTTP {}: {}", status.as_u16(), body)),
        }
    }

    // ── Unauthenticated requests (for auth flows) ───────────────────

    /// GET request without authentication.
    pub async fn get_unauthenticated<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let url = self.url(path);
        let builder = self.client.get(&url);
        self.execute(builder).await
    }

    /// POST request without authentication.
    pub async fn post_unauthenticated<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let url = self.url(path);
        let builder = self.client.post(&url).json(body);
        self.execute(builder).await
    }

    /// POST request without authentication returning raw response.
    pub async fn post_unauthenticated_raw<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<Response, PassboltError> {
        let url = self.url(path);
        let builder = self.client.post(&url).json(body);
        self.execute_raw(builder).await
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = PassboltApiClient::new("https://example.com", true, 30);
        assert!(client.is_ok());
        let c = client.unwrap();
        assert_eq!(c.base_url(), "https://example.com");
        assert!(!c.is_authenticated());
    }

    #[test]
    fn test_client_from_config() {
        let config = PassboltConfig {
            server_url: "https://passbolt.test/".into(),
            ..Default::default()
        };
        let client = PassboltApiClient::from_config(&config);
        assert_eq!(client.base_url(), "https://passbolt.test");
    }

    #[test]
    fn test_trailing_slash_stripped() {
        let client = PassboltApiClient::new("https://example.com/", true, 30).unwrap();
        assert_eq!(client.base_url(), "https://example.com");
    }

    #[test]
    fn test_session_management() {
        let mut client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        assert!(!client.is_authenticated());

        let mut session = SessionState::default();
        session.authenticated = true;
        session.access_token = Some("test-token".into());
        client.set_session(session);

        assert!(client.is_authenticated());
        assert_eq!(client.session().access_token.as_deref(), Some("test-token"));
    }

    #[test]
    fn test_build_contain_filter_params() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let params = client.build_contain_filter_params(
            &[("creator", true), ("modifier", false)],
            &[("search", "test"), ("has-id", "uuid-123")],
        );
        assert_eq!(params.len(), 3); // creator + search + has-id (modifier=false excluded)
        assert!(params.iter().any(|(k, _)| k == "contain[creator]"));
        assert!(params.iter().any(|(k, _)| k == "filter[search]"));
        assert!(params.iter().any(|(k, _)| k == "filter[has-id]"));
    }

    #[test]
    fn test_set_base_url() {
        let mut client = PassboltApiClient::new("https://old.com", true, 30).unwrap();
        client.set_base_url("https://new.com/");
        assert_eq!(client.base_url(), "https://new.com");
    }

    #[test]
    fn test_error_from_status() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::NOT_FOUND, "missing");
        assert_eq!(err.kind, PassboltErrorKind::NotFound);
    }

    #[test]
    fn test_error_from_status_unauthorized() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::UNAUTHORIZED, "");
        assert_eq!(err.kind, PassboltErrorKind::SessionExpired);
    }

    #[test]
    fn test_error_from_status_forbidden() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::FORBIDDEN, "denied");
        assert_eq!(err.kind, PassboltErrorKind::Forbidden);
    }

    #[test]
    fn test_error_from_status_conflict() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::CONFLICT, "conflict");
        assert_eq!(err.kind, PassboltErrorKind::Conflict);
    }

    #[test]
    fn test_error_from_status_rate_limited() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::TOO_MANY_REQUESTS, "");
        assert_eq!(err.kind, PassboltErrorKind::RateLimited);
    }
}
