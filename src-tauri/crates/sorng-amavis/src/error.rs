//! Crate-local error types for Amavis operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmavisErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    SshError,
    CommandFailed,
    ConfigError,
    PolicyNotFound,
    BanNotFound,
    WhitelistNotFound,
    QuarantineError,
    ProcessError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AmavisError {
    pub kind: AmavisErrorKind,
    pub message: String,
}

impl fmt::Display for AmavisError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for AmavisError {}

impl AmavisError {
    pub fn new(kind: AmavisErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            AmavisErrorKind::NotConnected,
            "Not connected to Amavis host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            AmavisErrorKind::AlreadyConnected,
            format!("Connection '{}' already exists", id),
        )
    }

    pub fn connection(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::ConnectionFailed, msg.to_string())
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::SshError, e.to_string())
    }

    pub fn command(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::CommandFailed, msg.to_string())
    }

    pub fn config(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::ConfigError, msg.to_string())
    }

    pub fn not_found(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::PolicyNotFound, msg.to_string())
    }

    pub fn ban_not_found(id: &str) -> Self {
        Self::new(
            AmavisErrorKind::BanNotFound,
            format!("Banned rule not found: {}", id),
        )
    }

    pub fn whitelist_not_found(id: &str) -> Self {
        Self::new(
            AmavisErrorKind::WhitelistNotFound,
            format!("List entry not found: {}", id),
        )
    }

    pub fn quarantine(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::QuarantineError, msg.to_string())
    }

    pub fn process(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::ProcessError, msg.to_string())
    }

    pub fn parse(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::ParseError, msg.to_string())
    }

    pub fn timeout(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::Timeout, msg.to_string())
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::new(AmavisErrorKind::InternalError, msg.to_string())
    }
}

pub type AmavisResult<T> = Result<T, AmavisError>;
