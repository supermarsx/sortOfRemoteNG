// ── sorng-docker/src/error.rs ─────────────────────────────────────────────────
//! Docker error types.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DockerErrorKind {
    ConnectionFailed,
    AuthError,
    ApiError(u16),
    NotFound,
    Conflict,
    Forbidden,
    Timeout,
    ParseError,
    ImagePullError,
    ImageBuildError,
    ComposeError,
    RegistryError,
    SessionError,
    ValidationError,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerError {
    pub kind: DockerErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl DockerError {
    pub fn new(kind: DockerErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: None }
    }

    pub fn with_details(kind: DockerErrorKind, message: impl Into<String>, details: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: Some(details.into()) }
    }

    pub fn connection(msg: &str) -> Self { Self::new(DockerErrorKind::ConnectionFailed, msg) }
    pub fn auth(msg: &str) -> Self { Self::new(DockerErrorKind::AuthError, msg) }
    pub fn not_found(msg: &str) -> Self { Self::new(DockerErrorKind::NotFound, msg) }
    pub fn conflict(msg: &str) -> Self { Self::new(DockerErrorKind::Conflict, msg) }
    pub fn forbidden(msg: &str) -> Self { Self::new(DockerErrorKind::Forbidden, msg) }
    pub fn timeout(msg: &str) -> Self { Self::new(DockerErrorKind::Timeout, msg) }
    pub fn parse(msg: &str) -> Self { Self::new(DockerErrorKind::ParseError, msg) }
    pub fn pull(msg: &str) -> Self { Self::new(DockerErrorKind::ImagePullError, msg) }
    pub fn build(msg: &str) -> Self { Self::new(DockerErrorKind::ImageBuildError, msg) }
    pub fn compose(msg: &str) -> Self { Self::new(DockerErrorKind::ComposeError, msg) }
    pub fn registry(msg: &str) -> Self { Self::new(DockerErrorKind::RegistryError, msg) }
    pub fn session(msg: &str) -> Self { Self::new(DockerErrorKind::SessionError, msg) }
    pub fn validation(msg: &str) -> Self { Self::new(DockerErrorKind::ValidationError, msg) }
    pub fn other(msg: &str) -> Self { Self::new(DockerErrorKind::Other, msg) }

    pub fn api(status: u16, msg: &str) -> Self {
        Self::new(DockerErrorKind::ApiError(status), msg)
    }
}

impl fmt::Display for DockerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Docker {:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " ({})", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for DockerError {}

impl From<reqwest::Error> for DockerError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            DockerError::timeout(&e.to_string())
        } else if e.is_connect() {
            DockerError::connection(&e.to_string())
        } else {
            DockerError::other(&e.to_string())
        }
    }
}

impl From<serde_json::Error> for DockerError {
    fn from(e: serde_json::Error) -> Self {
        DockerError::parse(&e.to_string())
    }
}

impl From<std::io::Error> for DockerError {
    fn from(e: std::io::Error) -> Self {
        DockerError::other(&e.to_string())
    }
}

impl From<url::ParseError> for DockerError {
    fn from(e: url::ParseError) -> Self {
        DockerError::parse(&e.to_string())
    }
}

pub type DockerResult<T> = Result<T, DockerError>;
