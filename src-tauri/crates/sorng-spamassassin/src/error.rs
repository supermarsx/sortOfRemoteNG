//! Crate-local error types for SpamAssassin operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpamAssassinErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    RuleNotFound,
    ChannelError,
    BayesError,
    ConfigNotFound,
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
pub struct SpamAssassinError {
    pub kind: SpamAssassinErrorKind,
    pub message: String,
}

impl fmt::Display for SpamAssassinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for SpamAssassinError {}

impl SpamAssassinError {
    pub fn new(kind: SpamAssassinErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            SpamAssassinErrorKind::NotConnected,
            "Not connected to SpamAssassin host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            SpamAssassinErrorKind::AlreadyConnected,
            format!("Connection '{}' already exists", id),
        )
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::ConnectionFailed, msg)
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::AuthenticationFailed, msg)
    }

    pub fn rule_not_found(name: &str) -> Self {
        Self::new(
            SpamAssassinErrorKind::RuleNotFound,
            format!("Rule not found: {}", name),
        )
    }

    pub fn channel_error(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::ChannelError, msg)
    }

    pub fn bayes_error(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::BayesError, msg)
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            SpamAssassinErrorKind::ConfigNotFound,
            format!("Config not found: {}", path),
        )
    }

    pub fn process(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::ProcessError, msg)
    }

    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::ReloadFailed, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::PermissionDenied, msg)
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(SpamAssassinErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(SpamAssassinErrorKind::IoError, e.to_string())
    }

    pub fn parse(e: impl fmt::Display) -> Self {
        Self::new(SpamAssassinErrorKind::ParseError, e.to_string())
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(SpamAssassinErrorKind::InternalError, msg)
    }
}

pub type SpamAssassinResult<T> = Result<T, SpamAssassinError>;
