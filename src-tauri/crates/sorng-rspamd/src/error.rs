//! Crate-local error types for Rspamd operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RspamdErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    Forbidden,
    NotFound,
    RuleNotFound,
    MapNotFound,
    SymbolNotFound,
    ProcessError,
    ApiError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RspamdError {
    pub kind: RspamdErrorKind,
    pub message: String,
}

impl fmt::Display for RspamdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for RspamdError {}

impl RspamdError {
    pub fn new(kind: RspamdErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::NotConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::ConnectionFailed, msg)
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::Forbidden, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::NotFound, msg)
    }

    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::ApiError, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(RspamdErrorKind::ParseError, msg)
    }
}

pub type RspamdResult<T> = Result<T, RspamdError>;
