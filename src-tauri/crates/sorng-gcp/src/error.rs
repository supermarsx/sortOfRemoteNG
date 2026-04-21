//! GCP error types following Google Cloud API error conventions.
//!
//! Google Cloud APIs return errors in a consistent JSON format with
//! `error.code`, `error.message`, and `error.status` fields. This module
//! provides a unified error type that can represent errors from any GCP service.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Top-level error type for all GCP operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcpError {
    /// The gRPC / HTTP status code (e.g., 400, 403, 404, 409, 500).
    pub code: u16,
    /// Human-readable error message.
    pub message: String,
    /// gRPC status string (e.g., "INVALID_ARGUMENT", "PERMISSION_DENIED").
    pub status: String,
    /// The GCP service that returned the error (e.g., "compute", "storage").
    pub service: String,
    /// The API method that failed (e.g., "instances.list").
    pub method: Option<String>,
    /// Whether this error is retryable (429, 500, 503).
    pub retryable: bool,
}

impl fmt::Display for GcpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "GCP {} error [{}]: {} (HTTP {})",
            self.service, self.status, self.message, self.code
        )?;
        if let Some(ref method) = self.method {
            write!(f, " [Method: {}]", method)?;
        }
        Ok(())
    }
}

impl std::error::Error for GcpError {}

impl GcpError {
    /// Create a new GCP error.
    pub fn new(service: &str, code: u16, status: &str, message: &str) -> Self {
        let retryable = matches!(code, 429 | 500 | 503);
        Self {
            code,
            message: message.to_string(),
            status: status.to_string(),
            service: service.to_string(),
            method: None,
            retryable,
        }
    }

    /// Create from a generic string error with service context.
    pub fn from_str(service: &str, msg: &str) -> Self {
        Self {
            code: 500,
            message: msg.to_string(),
            status: "INTERNAL".to_string(),
            service: service.to_string(),
            method: None,
            retryable: false,
        }
    }

    /// Session not found error.
    pub fn session_not_found(session_id: &str) -> Self {
        Self {
            code: 404,
            message: format!("GCP session '{}' not found or expired", session_id),
            status: "NOT_FOUND".to_string(),
            service: "gcp".to_string(),
            method: None,
            retryable: false,
        }
    }

    /// Not connected error.
    pub fn not_connected(session_id: &str) -> Self {
        Self {
            code: 400,
            message: format!("GCP session '{}' is not connected", session_id),
            status: "FAILED_PRECONDITION".to_string(),
            service: "gcp".to_string(),
            method: None,
            retryable: false,
        }
    }

    /// Authentication error.
    pub fn auth_error(msg: &str) -> Self {
        Self {
            code: 401,
            message: msg.to_string(),
            status: "UNAUTHENTICATED".to_string(),
            service: "auth".to_string(),
            method: None,
            retryable: false,
        }
    }

    /// Permission denied error.
    pub fn permission_denied(service: &str, msg: &str) -> Self {
        Self {
            code: 403,
            message: msg.to_string(),
            status: "PERMISSION_DENIED".to_string(),
            service: service.to_string(),
            method: None,
            retryable: false,
        }
    }

    /// Parse a GCP API error from a JSON response body.
    pub fn from_api_response(service: &str, status_code: u16, body: &str) -> Self {
        // GCP APIs return: { "error": { "code": N, "message": "...", "status": "..." } }
        #[derive(Deserialize)]
        struct ApiErrorInner {
            code: Option<u16>,
            message: Option<String>,
            status: Option<String>,
        }
        #[derive(Deserialize)]
        struct ApiErrorWrapper {
            error: Option<ApiErrorInner>,
        }

        if let Ok(wrapper) = serde_json::from_str::<ApiErrorWrapper>(body) {
            if let Some(err) = wrapper.error {
                return Self {
                    code: err.code.unwrap_or(status_code),
                    message: err.message.unwrap_or_else(|| "Unknown error".to_string()),
                    status: err.status.unwrap_or_else(|| "UNKNOWN".to_string()),
                    service: service.to_string(),
                    method: None,
                    retryable: matches!(err.code.unwrap_or(status_code), 429 | 500 | 503),
                };
            }
        }

        Self {
            code: status_code,
            message: if body.is_empty() {
                format!("HTTP {}", status_code)
            } else {
                body.chars().take(500).collect()
            },
            status: "UNKNOWN".to_string(),
            service: service.to_string(),
            method: None,
            retryable: matches!(status_code, 429 | 500 | 503),
        }
    }

    /// Set the method that failed.
    pub fn with_method(mut self, method: &str) -> Self {
        self.method = Some(method.to_string());
        self
    }
}

/// Convenience type alias for GCP results.
pub type GcpResult<T> = Result<T, GcpError>;

/// Convert GcpError to a String for Tauri command returns.
impl From<GcpError> for String {
    fn from(e: GcpError) -> String {
        serde_json::to_string(&e).unwrap_or_else(|_| e.message.clone())
    }
}
