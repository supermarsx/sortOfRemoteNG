//! Crate-local error types for Caddy operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaddyErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    RouteNotFound,
    ServerNotFound,
    UpstreamNotFound,
    CertificateError,
    ConfigValidationError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CaddyError {
    pub kind: CaddyErrorKind,
    pub message: String,
}

impl fmt::Display for CaddyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for CaddyError {}

impl CaddyError {
    pub fn new(kind: CaddyErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(CaddyErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(CaddyErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(CaddyErrorKind::ParseError, msg)
    }
    pub fn route_not_found(id: &str) -> Self {
        Self::new(CaddyErrorKind::RouteNotFound, format!("Route not found: {id}"))
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(CaddyErrorKind::HttpError, e.to_string())
    }
}

pub type CaddyResult<T> = Result<T, CaddyError>;
