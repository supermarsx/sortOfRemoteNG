//! HTTP API client for the Passbolt REST API.
//!
//! Handles all low-level HTTP communication with a Passbolt server including:
//! - Request building with JWT Bearer or GPGAuth cookie authentication
//! - Query parameter construction for Passbolt's `contain[]` and `filter[]` system
//! - Response envelope unwrapping (`ApiResponse<T>`)
//! - Error mapping from HTTP status codes to `PassboltError`
//! - Automatic token refresh on 401 responses (JWT mode)

use crate::passbolt::types::*;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::redirect::Policy;
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::io::{self, Write};
use std::time::Duration;
use url::Url;

const MIN_TIMEOUT_SECS: u64 = 5;
const MAX_TIMEOUT_SECS: u64 = 120;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_QUERY_PAIRS: usize = 64;
const MAX_QUERY_KEY_BYTES: usize = 128;
const MAX_QUERY_VALUE_BYTES: usize = 4096;
const MAX_PATH_BYTES: usize = 2048;
const MAX_AUTH_TOKEN_BYTES: usize = 16 * 1024;

struct LimitedJsonWriter {
    bytes: Vec<u8>,
}

impl LimitedJsonWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(4096),
        }
    }
}

impl Write for LimitedJsonWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if self.bytes.len().saturating_add(data.len()) > MAX_REQUEST_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "JSON request exceeds the configured limit",
            ));
        }
        self.bytes.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Passbolt API client.
#[allow(dead_code)]
pub struct PassboltApiClient {
    /// HTTP client.
    client: Option<Client>,
    /// Server base URL.
    base_url: String,
    /// Current session state.
    session: SessionState,
    /// Whether TLS verification is enabled.
    verify_tls: bool,
    /// Request timeout.
    timeout: Duration,
    /// Configuration failure retained by the default managed state.
    initialization_error: Option<PassboltError>,
}

impl PassboltApiClient {
    /// Create a new API client.
    pub fn new(base_url: &str, verify_tls: bool, timeout_secs: u64) -> Result<Self, PassboltError> {
        if !verify_tls {
            return Err(PassboltError::invalid_config(
                "TLS certificate verification cannot be disabled",
            ));
        }
        if !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&timeout_secs) {
            return Err(PassboltError::invalid_config(format!(
                "Request timeout must be between {} and {} seconds",
                MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS
            )));
        }
        let base_url = Self::validate_base_url(base_url)?;
        let client = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(timeout_secs.min(15)))
            .timeout(Duration::from_secs(timeout_secs))
            .cookie_store(true)
            .pool_max_idle_per_host(4)
            .build()
            .map_err(|_| PassboltError::network("Failed to initialize secure HTTP transport"))?;

        Ok(Self {
            client: Some(client),
            base_url,
            session: SessionState::default(),
            verify_tls,
            timeout: Duration::from_secs(timeout_secs),
            initialization_error: None,
        })
    }

    /// Create from a `PassboltConfig`.
    pub fn from_config(config: &PassboltConfig) -> Self {
        match Self::new(
            &config.server_url,
            config.verify_tls,
            config.request_timeout_secs,
        ) {
            Ok(client) => client,
            Err(error) => Self {
                client: None,
                base_url: String::new(),
                session: SessionState::default(),
                verify_tls: true,
                timeout: Duration::from_secs(30),
                initialization_error: Some(error),
            },
        }
    }

    fn validate_base_url(base_url: &str) -> Result<String, PassboltError> {
        if base_url.len() > 2048
            || base_url
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || base_url.contains('\\')
        {
            return Err(PassboltError::invalid_config(
                "Passbolt server URL is invalid",
            ));
        }
        let parsed = Url::parse(base_url)
            .map_err(|_| PassboltError::invalid_config("Passbolt server URL is invalid"))?;
        if parsed.scheme() != "https" {
            return Err(PassboltError::invalid_config(
                "Passbolt server URL must use HTTPS",
            ));
        }
        if parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(PassboltError::invalid_config(
                "Passbolt server URL must be an HTTPS origin or path without credentials, query, or fragment",
            ));
        }
        let mut normalized = parsed.to_string();
        while normalized.ends_with('/') {
            normalized.pop();
        }
        Ok(normalized)
    }

    /// Validate and return an unescaped server object identifier/path segment.
    pub fn encode_path_segment(value: &str) -> Result<&str, PassboltError> {
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        {
            return Err(PassboltError::bad_request(
                "Passbolt object identifier is invalid",
            ));
        }
        Ok(value)
    }

    pub fn initialization_error(&self) -> Option<&PassboltError> {
        self.initialization_error.as_ref()
    }

    /// Get the base URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Set the base URL.
    pub fn set_base_url(&mut self, url: &str) -> Result<(), PassboltError> {
        let replacement = Self::new(url, self.verify_tls, self.timeout.as_secs())?;
        *self = replacement;
        Ok(())
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
        self.session.clear_sensitive();
        self.session = session;
    }

    /// Clear all local authentication material.
    pub fn clear_session(&mut self) {
        self.session.clear_sensitive();
        self.session = SessionState::default();
    }

    /// Check if authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.initialization_error.is_none() && self.session.authenticated
    }

    // ── Request building ────────────────────────────────────────────

    /// Build a URL from a path.
    fn url(&self, path: &str) -> Result<String, PassboltError> {
        if let Some(error) = &self.initialization_error {
            return Err(error.clone());
        }
        if path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || !path.starts_with('/')
            || path.starts_with("//")
            || path.contains("://")
            || path.contains('\\')
            || path.contains('#')
            || path.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(PassboltError::bad_request("Passbolt API path is invalid"));
        }
        let (path_only, query) = path.split_once('?').unwrap_or((path, ""));
        if !query.is_empty() && query != "cascade=1" {
            return Err(PassboltError::bad_request(
                "Inline Passbolt query parameters are not allowed",
            ));
        }
        if path_only
            .split('/')
            .any(|segment| matches!(segment, "." | ".."))
        {
            return Err(PassboltError::bad_request("Passbolt API path is invalid"));
        }
        Ok(format!("{}{}", self.base_url, path))
    }

    /// Create an authenticated request builder.
    fn request(&self, method: Method, path: &str) -> Result<RequestBuilder, PassboltError> {
        if !self.session.authenticated {
            return Err(PassboltError::session_expired(
                "An authenticated Passbolt session is required",
            ));
        }
        let url = self.url(path)?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| PassboltError::invalid_config("Passbolt client is not configured"))?;
        let mut builder = client.request(method, &url);

        // Add auth headers based on session.
        if let Some(ref token) = self.session.access_token {
            if token.is_empty() || token.len() > MAX_AUTH_TOKEN_BYTES {
                return Err(PassboltError::auth_failed(
                    "Stored Passbolt access token is invalid",
                ));
            }
            builder = builder.header(AUTHORIZATION, format!("Bearer {}", token));
        }
        if let Some(ref csrf) = self.session.csrf_token {
            if csrf.is_empty() || csrf.len() > 4096 {
                return Err(PassboltError::auth_failed(
                    "Stored Passbolt CSRF token is invalid",
                ));
            }
            builder = builder.header("X-CSRF-Token", csrf.as_str());
        }

        Ok(builder)
    }

    /// Build query parameters for Passbolt's `contain[key]=1` / `filter[key]=value` style.
    pub fn build_contain_filter_params(
        &self,
        contains: &[(&str, bool)],
        filters: &[(&str, &str)],
    ) -> Result<Vec<(String, String)>, PassboltError> {
        let enabled_contains = contains.iter().filter(|(_, enabled)| *enabled).count();
        let total = enabled_contains
            .checked_add(filters.len())
            .ok_or_else(|| PassboltError::bad_request("Passbolt query is too large"))?;
        if total > MAX_QUERY_PAIRS
            || contains.iter().any(|(key, _)| {
                key.is_empty()
                    || key.len() > MAX_QUERY_KEY_BYTES
                    || key.chars().any(|c| c.is_control())
            })
            || filters.iter().any(|(key, value)| {
                key.is_empty()
                    || key.len() > MAX_QUERY_KEY_BYTES
                    || value.len() > MAX_QUERY_VALUE_BYTES
                    || key.chars().any(|c| c.is_control())
                    || value.chars().any(|c| c.is_control())
            })
        {
            return Err(PassboltError::bad_request(
                "Passbolt contain/filter query exceeds the configured limits",
            ));
        }

        let mut params = Vec::with_capacity(total);
        for (key, val) in contains {
            if *val {
                params.push((format!("contain[{}]", key), "1".to_string()));
            }
        }
        for (key, val) in filters {
            params.push((format!("filter[{}]", key), val.to_string()));
        }
        Ok(params)
    }

    // ── Response handling ───────────────────────────────────────────

    /// Execute a request and parse the standard Passbolt envelope.
    pub async fn execute<T: DeserializeOwned>(
        &self,
        builder: RequestBuilder,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let response = builder.send().await.map_err(Self::map_transport_error)?;

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
        let is_json = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| {
                let mime = v.split(';').next().unwrap_or("").trim();
                mime == "application/json" || mime.ends_with("+json")
            })
            .unwrap_or(false);
        let body = Self::read_limited_body(response).await?;

        match status {
            s if s.is_success() => {
                if !is_json {
                    return Err(PassboltError::parse(
                        "Passbolt returned a non-JSON success response",
                    ));
                }
                let envelope: ApiResponse<T> = serde_json::from_slice(&body)
                    .map_err(|_| PassboltError::parse("Passbolt returned malformed JSON"))?;
                Ok(envelope)
            }
            StatusCode::BAD_REQUEST => {
                Err(PassboltError::bad_request("Passbolt rejected the request"))
            }
            StatusCode::UNAUTHORIZED => Err(PassboltError::session_expired(
                "Authentication required or session expired",
            )),
            StatusCode::FORBIDDEN => {
                let lower = String::from_utf8_lossy(&body).to_ascii_lowercase();
                if lower.contains("mfa") || lower.contains("multi-factor") {
                    Err(PassboltError::mfa_required("MFA verification required"))
                } else {
                    Err(PassboltError::forbidden("Passbolt denied access"))
                }
            }
            StatusCode::NOT_FOUND => Err(PassboltError::not_found(
                "The requested Passbolt object was not found",
            )),
            StatusCode::CONFLICT => Err(PassboltError::conflict(
                "Entity was modified by another user",
            )),
            StatusCode::TOO_MANY_REQUESTS => {
                Err(PassboltError::rate_limited("Rate limited by server"))
            }
            s if s.is_server_error() => Err(PassboltError::server(format!(
                "Passbolt returned server error {}",
                s.as_u16()
            ))),
            _ => Err(PassboltError::api(format!(
                "Passbolt returned unexpected HTTP status {}",
                status.as_u16()
            ))),
        }
    }

    async fn read_limited_body(mut response: Response) -> Result<Vec<u8>, PassboltError> {
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(PassboltError::api(
                "Passbolt response exceeds the configured size limit",
            ));
        }
        let mut body = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or(0)
                .min(MAX_RESPONSE_BYTES as u64) as usize,
        );
        while let Some(chunk) = response.chunk().await.map_err(Self::map_transport_error)? {
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(PassboltError::api(
                    "Passbolt response exceeds the configured size limit",
                ));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    fn map_transport_error(error: reqwest::Error) -> PassboltError {
        if error.is_timeout() {
            PassboltError::timeout("Passbolt request timed out")
        } else {
            PassboltError::network("Passbolt transport request failed")
        }
    }

    /// Execute a raw request returning the response directly (for auth flows).
    pub async fn execute_raw(&self, builder: RequestBuilder) -> Result<Response, PassboltError> {
        builder.send().await.map_err(Self::map_transport_error)
    }

    // ── Convenience HTTP methods ────────────────────────────────────

    /// GET request with full envelope.
    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::GET, path)?;
        self.execute(builder).await
    }

    /// GET request with query parameters.
    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &std::collections::HashMap<String, String>,
    ) -> Result<ApiResponse<T>, PassboltError> {
        Self::validate_query(params)?;
        let builder = self.request(Method::GET, path)?.query(params);
        self.execute(builder).await
    }

    /// GET returning just the body.
    pub async fn get_body<T: DeserializeOwned>(&self, path: &str) -> Result<T, PassboltError> {
        let builder = self.request(Method::GET, path)?;
        self.execute_body(builder).await
    }

    /// POST request with JSON body.
    pub async fn post<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.json_request(self.request(Method::POST, path)?, body)?;
        self.execute(builder).await
    }

    /// POST returning just the body.
    pub async fn post_body<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PassboltError> {
        let builder = self.json_request(self.request(Method::POST, path)?, body)?;
        self.execute_body(builder).await
    }

    /// PUT request with JSON body.
    pub async fn put<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.json_request(self.request(Method::PUT, path)?, body)?;
        self.execute(builder).await
    }

    /// PUT returning just the body.
    pub async fn put_body<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PassboltError> {
        let builder = self.json_request(self.request(Method::PUT, path)?, body)?;
        self.execute_body(builder).await
    }

    /// DELETE request.
    pub async fn delete<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let builder = self.request(Method::DELETE, path)?;
        self.execute(builder).await
    }

    /// DELETE returning just the body (often null).
    pub async fn delete_void(&self, path: &str) -> Result<(), PassboltError> {
        let builder = self.request(Method::DELETE, path)?;
        let response = builder.send().await.map_err(Self::map_transport_error)?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            let _ = Self::read_limited_body(response).await?;
            Err(self.error_from_status(status))
        }
    }

    /// POST JSON and require an actual 2xx response without assuming an envelope.
    pub async fn post_void<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), PassboltError> {
        let builder = self.json_request(self.request(Method::POST, path)?, body)?;
        let response = builder.send().await.map_err(Self::map_transport_error)?;
        let status = response.status();
        let _ = Self::read_limited_body(response).await?;
        if status.is_success() {
            Ok(())
        } else {
            Err(self.error_from_status(status))
        }
    }

    /// Map an HTTP status to a PassboltError.
    fn error_from_status(&self, status: StatusCode) -> PassboltError {
        match status {
            StatusCode::BAD_REQUEST => PassboltError::bad_request("Passbolt rejected the request"),
            StatusCode::UNAUTHORIZED => PassboltError::session_expired("Authentication required"),
            StatusCode::FORBIDDEN => PassboltError::forbidden("Passbolt denied access"),
            StatusCode::NOT_FOUND => PassboltError::not_found("Passbolt object not found"),
            StatusCode::CONFLICT => PassboltError::conflict("Passbolt object changed"),
            StatusCode::TOO_MANY_REQUESTS => PassboltError::rate_limited("Rate limited"),
            s if s.is_server_error() => {
                PassboltError::server(format!("Passbolt returned server error {}", s.as_u16()))
            }
            _ => PassboltError::api(format!(
                "Passbolt returned unexpected HTTP status {}",
                status.as_u16()
            )),
        }
    }

    fn validate_query(
        params: &std::collections::HashMap<String, String>,
    ) -> Result<(), PassboltError> {
        if params.len() > MAX_QUERY_PAIRS
            || params.iter().any(|(key, value)| {
                key.is_empty()
                    || key.len() > MAX_QUERY_KEY_BYTES
                    || value.len() > MAX_QUERY_VALUE_BYTES
                    || key.chars().any(|c| c.is_control())
                    || value.chars().any(|c| c.is_control())
            })
        {
            return Err(PassboltError::bad_request(
                "Passbolt query exceeds the configured limits",
            ));
        }
        Ok(())
    }

    fn json_request<B: serde::Serialize>(
        &self,
        builder: RequestBuilder,
        body: &B,
    ) -> Result<RequestBuilder, PassboltError> {
        let mut writer = LimitedJsonWriter::new();
        serde_json::to_writer(&mut writer, body).map_err(|_| {
            PassboltError::bad_request("Passbolt JSON request is invalid or too large")
        })?;
        Ok(builder
            .header(CONTENT_TYPE, "application/json")
            .body(writer.bytes))
    }

    // ── Unauthenticated requests (for auth flows) ───────────────────

    /// GET request without authentication.
    pub async fn get_unauthenticated<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let url = self.url(path)?;
        let builder = self
            .client
            .as_ref()
            .ok_or_else(|| PassboltError::invalid_config("Passbolt client is not configured"))?
            .get(&url);
        self.execute(builder).await
    }

    /// POST request without authentication.
    pub async fn post_unauthenticated<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<ApiResponse<T>, PassboltError> {
        let url = self.url(path)?;
        let builder = self
            .client
            .as_ref()
            .ok_or_else(|| PassboltError::invalid_config("Passbolt client is not configured"))?
            .post(&url);
        let builder = self.json_request(builder, body)?;
        self.execute(builder).await
    }

    /// POST request without authentication returning raw response.
    pub async fn post_unauthenticated_raw<B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<Response, PassboltError> {
        let url = self.url(path)?;
        let builder = self
            .client
            .as_ref()
            .ok_or_else(|| PassboltError::invalid_config("Passbolt client is not configured"))?
            .post(&url);
        let builder = self.json_request(builder, body)?;
        self.execute_raw(builder).await
    }
}

impl Drop for PassboltApiClient {
    fn drop(&mut self) {
        self.session.clear_sensitive();
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

        let session = SessionState {
            authenticated: true,
            access_token: Some("test-token".into()),
            ..SessionState::default()
        };
        client.set_session(session);

        assert!(client.is_authenticated());
        assert_eq!(client.session().access_token.as_deref(), Some("test-token"));
    }

    #[test]
    fn test_build_contain_filter_params() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let params = client
            .build_contain_filter_params(
                &[("creator", true), ("modifier", false)],
                &[("search", "test"), ("has-id", "uuid-123")],
            )
            .unwrap();
        assert_eq!(params.len(), 3); // creator + search + has-id (modifier=false excluded)
        assert!(params.iter().any(|(k, _)| k == "contain[creator]"));
        assert!(params.iter().any(|(k, _)| k == "filter[search]"));
        assert!(params.iter().any(|(k, _)| k == "filter[has-id]"));
    }

    #[test]
    fn test_set_base_url() {
        let mut client = PassboltApiClient::new("https://old.com", true, 30).unwrap();
        client.set_base_url("https://new.com/").unwrap();
        assert_eq!(client.base_url(), "https://new.com");
    }

    #[test]
    fn test_error_from_status() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::NOT_FOUND);
        assert_eq!(err.kind, PassboltErrorKind::NotFound);
    }

    #[test]
    fn test_error_from_status_unauthorized() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::UNAUTHORIZED);
        assert_eq!(err.kind, PassboltErrorKind::SessionExpired);
    }

    #[test]
    fn test_error_from_status_forbidden() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::FORBIDDEN);
        assert_eq!(err.kind, PassboltErrorKind::Forbidden);
    }

    #[test]
    fn test_error_from_status_conflict() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::CONFLICT);
        assert_eq!(err.kind, PassboltErrorKind::Conflict);
    }

    #[test]
    fn test_error_from_status_rate_limited() {
        let client = PassboltApiClient::new("https://example.com", true, 30).unwrap();
        let err = client.error_from_status(StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(err.kind, PassboltErrorKind::RateLimited);
    }
}
