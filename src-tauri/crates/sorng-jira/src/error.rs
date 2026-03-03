// ── sorng-jira/src/error.rs ────────────────────────────────────────────────────
use std::fmt;

#[derive(Debug)]
pub struct JiraError {
    pub kind: JiraErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JiraErrorKind {
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

impl JiraError {
    pub fn new(kind: JiraErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn session(msg: impl Into<String>) -> Self {
        Self::new(JiraErrorKind::SessionError, msg)
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(JiraErrorKind::ValidationError, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(JiraErrorKind::NotFound, msg)
    }
}

impl fmt::Display for JiraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Jira error ({:?}): {}", self.kind, self.message)
    }
}

impl std::error::Error for JiraError {}

impl From<reqwest::Error> for JiraError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            return Self::new(JiraErrorKind::Timeout, e.to_string());
        }
        if e.is_connect() {
            return Self::new(JiraErrorKind::ConnectionFailed, e.to_string());
        }
        Self::new(JiraErrorKind::Other, e.to_string())
    }
}

impl From<serde_json::Error> for JiraError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(JiraErrorKind::ParseError, e.to_string())
    }
}

pub type JiraResult<T> = Result<T, JiraError>;
