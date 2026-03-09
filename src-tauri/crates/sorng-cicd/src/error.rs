//! Crate-local error types for CI/CD operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CicdErrorKind {
    NotConnected,
    ConnectionFailed,
    AuthenticationFailed,
    BuildNotFound,
    PipelineNotFound,
    ArtifactNotFound,
    PermissionDenied,
    RateLimited,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
    ProviderError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CicdError {
    pub kind: CicdErrorKind,
    pub message: String,
}

impl fmt::Display for CicdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for CicdError {}

impl CicdError {
    pub fn new(kind: CicdErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(CicdErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(CicdErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(CicdErrorKind::ParseError, msg)
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(CicdErrorKind::HttpError, e.to_string())
    }
    pub fn provider(msg: impl Into<String>) -> Self {
        Self::new(CicdErrorKind::ProviderError, msg)
    }
}

pub type CicdResult<T> = Result<T, CicdError>;
