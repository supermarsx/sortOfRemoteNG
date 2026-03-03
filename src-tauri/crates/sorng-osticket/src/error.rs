// ── sorng-osticket/src/error.rs ────────────────────────────────────────────────
use std::fmt;

#[derive(Debug)]
pub struct OsticketError {
    pub kind: OsticketErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OsticketErrorKind {
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

impl OsticketError {
    pub fn new(kind: OsticketErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn session(msg: impl Into<String>) -> Self {
        Self::new(OsticketErrorKind::SessionError, msg)
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(OsticketErrorKind::ValidationError, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(OsticketErrorKind::NotFound, msg)
    }
}

impl fmt::Display for OsticketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "osTicket error ({:?}): {}", self.kind, self.message)
    }
}

impl std::error::Error for OsticketError {}

impl From<reqwest::Error> for OsticketError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            return Self::new(OsticketErrorKind::Timeout, e.to_string());
        }
        if e.is_connect() {
            return Self::new(OsticketErrorKind::ConnectionFailed, e.to_string());
        }
        Self::new(OsticketErrorKind::Other, e.to_string())
    }
}

impl From<serde_json::Error> for OsticketError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(OsticketErrorKind::ParseError, e.to_string())
    }
}

pub type OsticketResult<T> = Result<T, OsticketError>;
