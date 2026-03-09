//! Crate-local error types for Dovecot operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DovecotErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigSyntaxError,
    ConfigNotFound,
    UserNotFound,
    MailboxNotFound,
    SieveError,
    QuotaError,
    NamespaceNotFound,
    ProcessError,
    ReloadFailed,
    PermissionDenied,
    SshError,
    IoError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DovecotError {
    pub kind: DovecotErrorKind,
    pub message: String,
}

impl fmt::Display for DovecotError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for DovecotError {}

impl DovecotError {
    pub fn new(kind: DovecotErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            DovecotErrorKind::NotConnected,
            "Not connected to Dovecot host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            DovecotErrorKind::AlreadyConnected,
            format!("Connection '{}' already exists", id),
        )
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::ConnectionFailed, msg)
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::AuthenticationFailed, msg)
    }

    pub fn config_syntax(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::ConfigSyntaxError, msg)
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            DovecotErrorKind::ConfigNotFound,
            format!("Config not found: {}", path),
        )
    }

    pub fn user_not_found(user: &str) -> Self {
        Self::new(
            DovecotErrorKind::UserNotFound,
            format!("User not found: {}", user),
        )
    }

    pub fn mailbox_not_found(name: &str) -> Self {
        Self::new(
            DovecotErrorKind::MailboxNotFound,
            format!("Mailbox not found: {}", name),
        )
    }

    pub fn sieve(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::SieveError, msg)
    }

    pub fn quota(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::QuotaError, msg)
    }

    pub fn namespace_not_found(name: &str) -> Self {
        Self::new(
            DovecotErrorKind::NamespaceNotFound,
            format!("Namespace not found: {}", name),
        )
    }

    pub fn process(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::ProcessError, msg)
    }

    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::ReloadFailed, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::PermissionDenied, msg)
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(DovecotErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(DovecotErrorKind::IoError, e.to_string())
    }

    pub fn parse(e: impl fmt::Display) -> Self {
        Self::new(DovecotErrorKind::ParseError, e.to_string())
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(DovecotErrorKind::InternalError, msg)
    }
}

pub type DovecotResult<T> = Result<T, DovecotError>;
