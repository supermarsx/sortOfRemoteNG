// ── sorng-warpgate/src/error.rs ─────────────────────────────────────────────
//! Warpgate error types.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WarpgateErrorKind {
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
pub struct WarpgateError {
    pub kind: WarpgateErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl WarpgateError {
    pub fn new(kind: WarpgateErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        kind: WarpgateErrorKind,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn connection(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::AuthError, msg)
    }
    pub fn not_found(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::NotFound, msg)
    }
    pub fn conflict(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::Conflict, msg)
    }
    pub fn forbidden(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::Forbidden, msg)
    }
    pub fn timeout(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::Timeout, msg)
    }
    pub fn parse(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::ParseError, msg)
    }
    pub fn validation(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::ValidationError, msg)
    }
    pub fn rate_limited(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::RateLimited, msg)
    }
    pub fn session(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::SessionError, msg)
    }
    pub fn other(msg: &str) -> Self {
        Self::new(WarpgateErrorKind::Other, msg)
    }

    pub fn api(status: u16, msg: &str) -> Self {
        Self::new(WarpgateErrorKind::ApiError(status), msg)
    }
}

impl fmt::Display for WarpgateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Warpgate {:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " ({})", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for WarpgateError {}

impl From<reqwest::Error> for WarpgateError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            WarpgateError::timeout(&e.to_string())
        } else if e.is_connect() {
            WarpgateError::connection(&e.to_string())
        } else {
            WarpgateError::other(&e.to_string())
        }
    }
}

impl From<serde_json::Error> for WarpgateError {
    fn from(e: serde_json::Error) -> Self {
        WarpgateError::parse(&e.to_string())
    }
}

pub type WarpgateResult<T> = Result<T, WarpgateError>;
