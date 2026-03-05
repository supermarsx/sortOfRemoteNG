//! Crate-local error types for Nginx Proxy Manager operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NpmErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    TokenExpired,
    ProxyHostNotFound,
    RedirectionHostNotFound,
    DeadHostNotFound,
    StreamNotFound,
    CertificateNotFound,
    AccessListNotFound,
    UserNotFound,
    PermissionDenied,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NpmError {
    pub kind: NpmErrorKind,
    pub message: String,
}

impl fmt::Display for NpmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NpmError {}

impl NpmError {
    pub fn new(kind: NpmErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(NpmErrorKind::NotConnected, "Not connected to Nginx Proxy Manager")
    }
    pub fn proxy_host_not_found(id: u64) -> Self {
        Self::new(NpmErrorKind::ProxyHostNotFound, format!("Proxy host not found: {id}"))
    }
    pub fn token_expired() -> Self {
        Self::new(NpmErrorKind::TokenExpired, "Authentication token has expired")
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(NpmErrorKind::HttpError, e.to_string())
    }
}

pub type NpmResult<T> = Result<T, NpmError>;
