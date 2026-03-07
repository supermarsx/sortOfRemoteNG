//! Crate-local error types for NetBox operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetboxErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ApiError,
    ObjectNotFound,
    ValidationError,
    ConflictError,
    PermissionDenied,
    RateLimited,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NetboxError {
    pub kind: NetboxErrorKind,
    pub message: String,
}

pub type NetboxResult<T> = Result<T, NetboxError>;

impl fmt::Display for NetboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NetboxError {}

impl NetboxError {
    pub fn new(kind: NetboxErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::AlreadyConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::AuthenticationFailed, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ApiError, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ObjectNotFound, msg)
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ValidationError, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ConflictError, msg)
    }
    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::PermissionDenied, msg)
    }
    pub fn rate_limited(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::RateLimited, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(NetboxErrorKind::InternalError, msg)
    }
}
