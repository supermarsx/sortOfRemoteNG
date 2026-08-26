//! Crate-local error types for DrayTek operations (mirrors `sorng-pfsense`).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraytekErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    /// The device firmware uses a login scheme (e.g. client-side RSA password
    /// encryption) this client cannot satisfy; use the browser ("Open Web UI").
    UnsupportedFirmwareLogin,
    InvalidRequest,
    ApiError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DraytekError {
    pub kind: DraytekErrorKind,
    pub message: String,
}

impl fmt::Display for DraytekError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for DraytekError {}

pub type DraytekResult<T> = Result<T, DraytekError>;

impl DraytekError {
    pub fn new(kind: DraytekErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::NotConnected, msg)
    }

    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::AlreadyConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::AuthenticationFailed, msg)
    }

    pub fn unsupported_firmware_login(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::UnsupportedFirmwareLogin, msg)
    }

    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::ApiError, msg)
    }

    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::HttpError, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::ParseError, msg)
    }

    pub fn invalid_request(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::InvalidRequest, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(DraytekErrorKind::InternalError, msg)
    }
}
