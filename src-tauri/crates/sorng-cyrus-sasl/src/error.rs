//! Crate-local error types for Cyrus SASL operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CyrusSaslErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigNotFound,
    MechanismNotFound,
    UserNotFound,
    PluginError,
    SaslauthError,
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
pub struct CyrusSaslError {
    pub kind: CyrusSaslErrorKind,
    pub message: String,
}

impl fmt::Display for CyrusSaslError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for CyrusSaslError {}

impl CyrusSaslError {
    pub fn new(kind: CyrusSaslErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            CyrusSaslErrorKind::NotConnected,
            "Not connected to SASL host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            CyrusSaslErrorKind::AlreadyConnected,
            format!("Already connected: {id}"),
        )
    }

    pub fn connection_failed(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::ConnectionFailed, msg.to_string())
    }

    pub fn auth_failed(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::AuthenticationFailed, msg.to_string())
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            CyrusSaslErrorKind::ConfigNotFound,
            format!("Config not found: {path}"),
        )
    }

    pub fn mechanism_not_found(name: &str) -> Self {
        Self::new(
            CyrusSaslErrorKind::MechanismNotFound,
            format!("Mechanism not found: {name}"),
        )
    }

    pub fn user_not_found(username: &str, realm: &str) -> Self {
        Self::new(
            CyrusSaslErrorKind::UserNotFound,
            format!("User not found: {username}@{realm}"),
        )
    }

    pub fn plugin_error(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::PluginError, msg.to_string())
    }

    pub fn saslauthd_error(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::SaslauthError, msg.to_string())
    }

    pub fn process_error(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::ProcessError, msg.to_string())
    }

    pub fn reload_failed(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::ReloadFailed, msg.to_string())
    }

    pub fn permission_denied(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::PermissionDenied, msg.to_string())
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::IoError, e.to_string())
    }

    pub fn parse(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::ParseError, msg.to_string())
    }

    pub fn timeout(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::Timeout, msg.to_string())
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::new(CyrusSaslErrorKind::InternalError, msg.to_string())
    }
}

pub type CyrusSaslResult<T> = Result<T, CyrusSaslError>;
