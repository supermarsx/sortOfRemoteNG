use serde::{Deserialize, Serialize};
use std::fmt;

/// Categories of errors that can occur during RabbitMQ management operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RabbitErrorKind {
    /// Failed to establish a connection to the management API.
    ConnectionFailed,
    /// Invalid credentials or authentication token expired.
    AuthenticationFailed,
    /// The requested session ID does not exist.
    SessionNotFound,
    /// The specified vhost was not found on the server.
    VhostNotFound,
    /// The specified exchange was not found.
    ExchangeNotFound,
    /// The specified queue was not found.
    QueueNotFound,
    /// The specified binding was not found.
    BindingNotFound,
    /// The specified user was not found.
    UserNotFound,
    /// An error occurred while managing policies.
    PolicyError,
    /// The authenticated user lacks the required permissions.
    PermissionDenied,
    /// An error occurred with shovel configuration or operation.
    ShovelError,
    /// An error occurred with federation configuration or links.
    FederationError,
    /// An error occurred with cluster operations.
    ClusterError,
    /// An error occurred importing or exporting definitions.
    DefinitionError,
    /// The request timed out.
    Timeout,
    /// A generic API error with an HTTP status code.
    ApiError,
    /// A serialization or deserialization error.
    SerializationError,
    /// An internal or unexpected error.
    Internal,
}

/// The primary error type for all RabbitMQ management operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RabbitError {
    /// The category of error.
    pub kind: RabbitErrorKind,
    /// A human-readable description of what went wrong.
    pub message: String,
    /// The HTTP status code, if the error originated from an API response.
    pub status_code: Option<u16>,
    /// Additional context or details (e.g., the raw API response body).
    pub details: Option<String>,
}

impl RabbitError {
    /// Create a new error with the given kind and message.
    pub fn new(kind: RabbitErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            details: None,
        }
    }

    /// Attach an HTTP status code to this error.
    pub fn with_status(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    /// Attach additional detail text to this error.
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Convenience constructor for connection failures.
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(RabbitErrorKind::ConnectionFailed, msg)
    }

    /// Convenience constructor for authentication failures.
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(RabbitErrorKind::AuthenticationFailed, msg)
    }

    /// Convenience constructor for session-not-found errors.
    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            RabbitErrorKind::SessionNotFound,
            format!("Session not found: {}", id),
        )
    }

    /// Convenience for not-found errors with a specific kind.
    pub fn not_found(kind: RabbitErrorKind, name: &str) -> Self {
        Self::new(kind, format!("Not found: {}", name))
    }

    /// Build an error from an HTTP status code and response body.
    pub fn from_http(status: u16, body: &str) -> Self {
        let kind = match status {
            401 => RabbitErrorKind::AuthenticationFailed,
            403 => RabbitErrorKind::PermissionDenied,
            404 => RabbitErrorKind::ApiError,
            408 => RabbitErrorKind::Timeout,
            _ => RabbitErrorKind::ApiError,
        };
        Self::new(kind, format!("HTTP {}: {}", status, body)).with_status(status)
    }
}

impl fmt::Display for RabbitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(code) = self.status_code {
            write!(f, " (HTTP {})", code)?;
        }
        if let Some(ref details) = self.details {
            write!(f, " — {}", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for RabbitError {}

impl From<reqwest::Error> for RabbitError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            return Self::new(RabbitErrorKind::Timeout, err.to_string());
        }
        if err.is_connect() {
            return Self::connection_failed(err.to_string());
        }
        Self::new(RabbitErrorKind::ConnectionFailed, err.to_string())
    }
}

impl From<serde_json::Error> for RabbitError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(RabbitErrorKind::SerializationError, err.to_string())
    }
}

impl From<url::ParseError> for RabbitError {
    fn from(err: url::ParseError) -> Self {
        Self::new(
            RabbitErrorKind::ConnectionFailed,
            format!("Invalid URL: {}", err),
        )
    }
}
