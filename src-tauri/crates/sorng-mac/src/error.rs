// ── sorng-mac/src/error.rs ────────────────────────────────────────────────────
//! Crate-local error types for MAC operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MacErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    UnsupportedSystem,
    PolicyError,
    ModuleError,
    ProfileError,
    BooleanNotFound,
    ContextError,
    AuditError,
    ComplianceError,
    PermissionDenied,
    SshError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MacError {
    pub kind: MacErrorKind,
    pub message: String,
}

impl fmt::Display for MacError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for MacError {}

impl MacError {
    pub fn new(kind: MacErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::ParseError, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::UnsupportedSystem, msg)
    }
    pub fn policy(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::PolicyError, msg)
    }
    pub fn module(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::ModuleError, msg)
    }
    pub fn profile(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::ProfileError, msg)
    }
    pub fn boolean_not_found(name: &str) -> Self {
        Self::new(
            MacErrorKind::BooleanNotFound,
            format!("Boolean not found: {name}"),
        )
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(MacErrorKind::SshError, e.to_string())
    }
    pub fn command(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::CommandFailed, msg)
    }
    pub fn audit(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::AuditError, msg)
    }
    pub fn compliance(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::ComplianceError, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(MacErrorKind::InternalError, msg)
    }
}

pub type MacResult<T> = Result<T, MacError>;
