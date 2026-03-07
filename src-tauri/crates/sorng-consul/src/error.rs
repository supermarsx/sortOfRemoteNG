//! Crate-local error types for Consul operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsulErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthFailed,
    NotFound,
    Forbidden,
    TxnFailed,
    SessionExpired,
    ApiError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConsulError {
    pub kind: ConsulErrorKind,
    pub message: String,
}

impl fmt::Display for ConsulError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ConsulError {}

impl ConsulError {
    pub fn new(kind: ConsulErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::AuthFailed, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::NotFound, msg)
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::Forbidden, msg)
    }
    pub fn txn_failed(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::TxnFailed, msg)
    }
    pub fn session_expired(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::SessionExpired, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::ApiError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(ConsulErrorKind::ParseError, msg)
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(ConsulErrorKind::ApiError, e.to_string())
    }
}

impl From<reqwest::Error> for ConsulError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::new(ConsulErrorKind::Timeout, format!("Request timed out: {e}"))
        } else if e.is_connect() {
            Self::connection(format!("Connection failed: {e}"))
        } else {
            Self::api(format!("HTTP error: {e}"))
        }
    }
}

pub type ConsulResult<T> = Result<T, ConsulError>;
