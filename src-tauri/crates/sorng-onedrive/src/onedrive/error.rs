//! Error types for the OneDrive / Microsoft Graph integration.
//!
//! All public API surfaces in this crate return `OneDriveResult<T>`.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Convenience alias.
pub type OneDriveResult<T> = Result<T, OneDriveError>;

/// Error codes specific to OneDrive / Graph operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OneDriveErrorCode {
    /// OAuth2 / token error.
    AuthFailed,
    /// Access token expired; refresh needed.
    TokenExpired,
    /// Insufficient OAuth scopes.
    InsufficientPermissions,
    /// Rate-limited (HTTP 429).
    RateLimited,
    /// Bad request / invalid parameter.
    InvalidRequest,
    /// Resource (file, folder, drive) not found (HTTP 404).
    NotFound,
    /// Conflict (name collision, edit conflict).
    Conflict,
    /// Quota exceeded.
    QuotaExceeded,
    /// Item is locked by another user / process.
    ItemLocked,
    /// Malware detected in uploaded file.
    MalwareDetected,
    /// Upload session expired.
    UploadSessionExpired,
    /// Name too long, invalid characters, etc.
    InvalidName,
    /// The service is not configured.
    NotConfigured,
    /// Session not found.
    SessionNotFound,
    /// Network / connectivity error.
    NetworkError,
    /// (De)serialization error.
    SerializationError,
    /// Catch-all internal error.
    InternalError,
}

impl fmt::Display for OneDriveErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Structured error returned by every public function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneDriveError {
    pub code: OneDriveErrorCode,
    pub message: String,
    pub status: Option<u16>,
    pub graph_error_code: Option<String>,
    pub inner_message: Option<String>,
    pub request_id: Option<String>,
}

impl fmt::Display for OneDriveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)?;
        if let Some(ref gc) = self.graph_error_code {
            write!(f, " (graph: {})", gc)?;
        }
        Ok(())
    }
}

impl std::error::Error for OneDriveError {}

impl OneDriveError {
    /// Create from a code + message.
    pub fn new(code: OneDriveErrorCode, msg: impl Into<String>) -> Self {
        Self {
            code,
            message: msg.into(),
            status: None,
            graph_error_code: None,
            inner_message: None,
            request_id: None,
        }
    }

    /// Shortcut: not configured.
    pub fn not_configured(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::NotConfigured, msg)
    }

    /// Shortcut: session not found.
    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            OneDriveErrorCode::SessionNotFound,
            format!("OneDrive session not found: {}", id),
        )
    }

    /// Shortcut: network error.
    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::NetworkError, msg)
    }

    /// Shortcut: internal error.
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::InternalError, msg)
    }

    /// Shortcut: auth failure.
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::AuthFailed, msg)
    }

    /// Shortcut: not found.
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::NotFound, msg)
    }

    /// Shortcut: conflict.
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(OneDriveErrorCode::Conflict, msg)
    }

    /// Build an error from a Graph API error response body.
    pub fn from_graph_response(status: u16, body: &str) -> Self {
        let code = match status {
            401 => OneDriveErrorCode::AuthFailed,
            403 => OneDriveErrorCode::InsufficientPermissions,
            404 => OneDriveErrorCode::NotFound,
            409 => OneDriveErrorCode::Conflict,
            423 => OneDriveErrorCode::ItemLocked,
            429 => OneDriveErrorCode::RateLimited,
            507 => OneDriveErrorCode::QuotaExceeded,
            _ if status >= 500 => OneDriveErrorCode::InternalError,
            _ => OneDriveErrorCode::InvalidRequest,
        };

        let (graph_code, inner_msg, request_id) = Self::parse_graph_error_body(body);

        let message = inner_msg
            .clone()
            .unwrap_or_else(|| format!("Graph API error (HTTP {})", status));

        Self {
            code,
            message,
            status: Some(status),
            graph_error_code: graph_code,
            inner_message: inner_msg,
            request_id,
        }
    }

    /// Try to extract Graph error JSON: `{ "error": { "code": "...", "message": "...", "innerError": { "request-id": "..." } } }`.
    fn parse_graph_error_body(body: &str) -> (Option<String>, Option<String>, Option<String>) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
            return (None, None, None);
        };
        let err = &v["error"];
        let code = err["code"].as_str().map(String::from);
        let msg = err["message"].as_str().map(String::from);
        let req_id = err["innerError"]["request-id"]
            .as_str()
            .map(String::from);
        (code, msg, req_id)
    }
}

impl From<reqwest::Error> for OneDriveError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::network(format!("Request timed out: {}", err))
        } else if err.is_connect() {
            Self::network(format!("Connection failed: {}", err))
        } else {
            Self::internal(format!("HTTP error: {}", err))
        }
    }
}

impl From<serde_json::Error> for OneDriveError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(
            OneDriveErrorCode::SerializationError,
            format!("JSON error: {}", err),
        )
    }
}

impl From<url::ParseError> for OneDriveError {
    fn from(err: url::ParseError) -> Self {
        Self::new(
            OneDriveErrorCode::InvalidRequest,
            format!("URL parse error: {}", err),
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
    fn test_not_configured() {
        let err = OneDriveError::not_configured("no credentials");
        assert_eq!(err.code, OneDriveErrorCode::NotConfigured);
        assert!(err.message.contains("no credentials"));
    }

    #[test]
    fn test_from_graph_response_404() {
        let body = r#"{"error":{"code":"itemNotFound","message":"Item does not exist","innerError":{"request-id":"abc-123"}}}"#;
        let err = OneDriveError::from_graph_response(404, body);
        assert_eq!(err.code, OneDriveErrorCode::NotFound);
        assert_eq!(err.graph_error_code.as_deref(), Some("itemNotFound"));
        assert_eq!(err.request_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn test_from_graph_response_429() {
        let err = OneDriveError::from_graph_response(429, "");
        assert_eq!(err.code, OneDriveErrorCode::RateLimited);
    }

    #[test]
    fn test_from_graph_response_500() {
        let err = OneDriveError::from_graph_response(502, "bad gateway");
        assert_eq!(err.code, OneDriveErrorCode::InternalError);
    }

    #[test]
    fn test_error_display() {
        let err = OneDriveError {
            code: OneDriveErrorCode::NotFound,
            message: "missing".into(),
            status: Some(404),
            graph_error_code: Some("itemNotFound".into()),
            inner_message: None,
            request_id: None,
        };
        let s = format!("{}", err);
        assert!(s.contains("missing"));
        assert!(s.contains("itemNotFound"));
    }
}
