use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HetznerErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ResourceNotFound,
    ServerError,
    RateLimited,
    QuotaExceeded,
    ActionFailed,
    ConflictError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HetznerError {
    pub kind: HetznerErrorKind,
    pub message: String,
}

impl fmt::Display for HetznerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for HetznerError {}

impl HetznerError {
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::NotConnected, message: msg.into() }
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ConnectionFailed, message: msg.into() }
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::AuthenticationFailed, message: msg.into() }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ResourceNotFound, message: msg.into() }
    }

    pub fn server_error(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ServerError, message: msg.into() }
    }

    pub fn rate_limited(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::RateLimited, message: msg.into() }
    }

    pub fn quota_exceeded(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::QuotaExceeded, message: msg.into() }
    }

    pub fn action_failed(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ActionFailed, message: msg.into() }
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ConflictError, message: msg.into() }
    }

    pub fn http(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::HttpError, message: msg.into() }
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::ParseError, message: msg.into() }
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::Timeout, message: msg.into() }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self { kind: HetznerErrorKind::InternalError, message: msg.into() }
    }
}

pub type HetznerResult<T> = Result<T, HetznerError>;
