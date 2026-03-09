//! Crate-local error types for Roundcube operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundcubeErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    Forbidden,
    NotFound,
    UserNotFound,
    IdentityNotFound,
    PluginNotFound,
    FilterNotFound,
    AddressBookNotFound,
    FolderNotFound,
    ApiError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RoundcubeError {
    pub kind: RoundcubeErrorKind,
    pub message: String,
}

impl fmt::Display for RoundcubeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for RoundcubeError {}

impl RoundcubeError {
    pub fn new(kind: RoundcubeErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::NotConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::ConnectionFailed, msg)
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::Forbidden, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::NotFound, msg)
    }

    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::ApiError, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(RoundcubeErrorKind::InternalError, msg)
    }
}

pub type RoundcubeResult<T> = Result<T, RoundcubeError>;
