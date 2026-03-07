//! Crate-local error types for Traefik operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraefikErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    RouterNotFound,
    ServiceNotFound,
    MiddlewareNotFound,
    EntryPointNotFound,
    CertificateError,
    ProviderError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TraefikError {
    pub kind: TraefikErrorKind,
    pub message: String,
}

impl fmt::Display for TraefikError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for TraefikError {}

impl TraefikError {
    pub fn new(kind: TraefikErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(TraefikErrorKind::NotConnected, msg)
    }
    pub fn router_not_found(name: &str) -> Self {
        Self::new(TraefikErrorKind::RouterNotFound, format!("Router not found: {name}"))
    }
    pub fn service_not_found(name: &str) -> Self {
        Self::new(TraefikErrorKind::ServiceNotFound, format!("Service not found: {name}"))
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(TraefikErrorKind::HttpError, e.to_string())
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(TraefikErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(TraefikErrorKind::ParseError, msg)
    }
}

pub type TraefikResult<T> = Result<T, TraefikError>;
