// ── sorng-budibase/src/error.rs ────────────────────────────────────────────────
//! Budibase error types.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BudibaseErrorKind {
    ConnectionFailed,
    AuthError,
    ApiError(u16),
    NotFound,
    Conflict,
    Forbidden,
    Timeout,
    ParseError,
    ValidationError,
    RateLimited,
    SessionError,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudibaseError {
    pub kind: BudibaseErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl BudibaseError {
    pub fn new(kind: BudibaseErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: None }
    }

    pub fn with_details(kind: BudibaseErrorKind, message: impl Into<String>, details: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: Some(details.into()) }
    }

    pub fn connection(msg: &str) -> Self { Self::new(BudibaseErrorKind::ConnectionFailed, msg) }
    pub fn auth(msg: &str) -> Self { Self::new(BudibaseErrorKind::AuthError, msg) }
    pub fn not_found(msg: &str) -> Self { Self::new(BudibaseErrorKind::NotFound, msg) }
    pub fn conflict(msg: &str) -> Self { Self::new(BudibaseErrorKind::Conflict, msg) }
    pub fn forbidden(msg: &str) -> Self { Self::new(BudibaseErrorKind::Forbidden, msg) }
    pub fn timeout(msg: &str) -> Self { Self::new(BudibaseErrorKind::Timeout, msg) }
    pub fn parse(msg: &str) -> Self { Self::new(BudibaseErrorKind::ParseError, msg) }
    pub fn validation(msg: &str) -> Self { Self::new(BudibaseErrorKind::ValidationError, msg) }
    pub fn rate_limited(msg: &str) -> Self { Self::new(BudibaseErrorKind::RateLimited, msg) }
    pub fn session(msg: &str) -> Self { Self::new(BudibaseErrorKind::SessionError, msg) }
    pub fn other(msg: &str) -> Self { Self::new(BudibaseErrorKind::Other, msg) }

    pub fn api(status: u16, msg: &str) -> Self {
        Self::new(BudibaseErrorKind::ApiError(status), msg)
    }
}

impl fmt::Display for BudibaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Budibase {:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " ({})", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for BudibaseError {}

impl From<reqwest::Error> for BudibaseError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            BudibaseError::timeout(&e.to_string())
        } else if e.is_connect() {
            BudibaseError::connection(&e.to_string())
        } else {
            BudibaseError::other(&e.to_string())
        }
    }
}

impl From<serde_json::Error> for BudibaseError {
    fn from(e: serde_json::Error) -> Self {
        BudibaseError::parse(&e.to_string())
    }
}

pub type BudibaseResult<T> = Result<T, BudibaseError>;
