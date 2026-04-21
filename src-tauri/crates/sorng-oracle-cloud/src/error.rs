use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OciErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ResourceNotFound,
    PermissionDenied,
    QuotaExceeded,
    InvalidRequest,
    ConflictError,
    RateLimited,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OciError {
    pub kind: OciErrorKind,
    pub message: String,
}

impl OciError {
    pub fn new(kind: OciErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(OciErrorKind::NotConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(OciErrorKind::ConnectionFailed, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(OciErrorKind::ParseError, msg)
    }

    pub fn http(msg: impl Into<String>) -> Self {
        Self::new(OciErrorKind::HttpError, msg)
    }

    pub fn resource_not_found(msg: impl Into<String>) -> Self {
        Self::new(OciErrorKind::ResourceNotFound, msg)
    }
}

impl fmt::Display for OciError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "OCI {:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for OciError {}

impl From<reqwest::Error> for OciError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::new(OciErrorKind::Timeout, err.to_string())
        } else if err.is_connect() {
            Self::connection(err.to_string())
        } else if let Some(status) = err.status() {
            match status.as_u16() {
                401 => Self::new(OciErrorKind::AuthenticationFailed, err.to_string()),
                403 => Self::new(OciErrorKind::PermissionDenied, err.to_string()),
                404 => Self::resource_not_found(err.to_string()),
                409 => Self::new(OciErrorKind::ConflictError, err.to_string()),
                429 => Self::new(OciErrorKind::RateLimited, err.to_string()),
                _ => Self::http(err.to_string()),
            }
        } else {
            Self::connection(err.to_string())
        }
    }
}

impl From<serde_json::Error> for OciError {
    fn from(err: serde_json::Error) -> Self {
        Self::parse(err.to_string())
    }
}

pub type OciResult<T> = Result<T, OciError>;
