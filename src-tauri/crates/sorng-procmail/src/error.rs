//! Crate-local error types for Procmail operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcmailErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    RecipeNotFound,
    RuleNotFound,
    ConfigNotFound,
    SyntaxError,
    DeliveryError,
    LockError,
    PermissionDenied,
    SshError,
    IoError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProcmailError {
    pub kind: ProcmailErrorKind,
    pub message: String,
}

impl fmt::Display for ProcmailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ProcmailError {}

impl ProcmailError {
    pub fn new(kind: ProcmailErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            ProcmailErrorKind::NotConnected,
            "Not connected to Procmail host",
        )
    }

    pub fn recipe_not_found(id: &str) -> Self {
        Self::new(
            ProcmailErrorKind::RecipeNotFound,
            format!("Recipe not found: {id}"),
        )
    }

    pub fn rule_not_found(id: &str) -> Self {
        Self::new(
            ProcmailErrorKind::RuleNotFound,
            format!("Rule not found: {id}"),
        )
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            ProcmailErrorKind::ConfigNotFound,
            format!("Config not found: {path}"),
        )
    }

    pub fn syntax(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::SyntaxError, msg)
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(ProcmailErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(ProcmailErrorKind::IoError, e.to_string())
    }

    pub fn parse(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::ParseError, msg)
    }

    pub fn delivery(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::DeliveryError, msg)
    }

    pub fn lock(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::LockError, msg)
    }

    pub fn permission(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::PermissionDenied, msg)
    }

    pub fn timeout(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::Timeout, msg)
    }

    pub fn internal(msg: &str) -> Self {
        Self::new(ProcmailErrorKind::InternalError, msg)
    }
}

pub type ProcmailResult<T> = Result<T, ProcmailError>;
