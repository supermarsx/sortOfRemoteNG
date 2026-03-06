//! Crate-local error types for OpenDKIM operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpendkimErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigSyntaxError,
    ConfigNotFound,
    KeyNotFound,
    SigningTableError,
    KeyTableError,
    TrustedHostError,
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
pub struct OpendkimError {
    pub kind: OpendkimErrorKind,
    pub message: String,
}

impl fmt::Display for OpendkimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for OpendkimError {}

impl OpendkimError {
    pub fn new(kind: OpendkimErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn not_connected() -> Self {
        Self::new(OpendkimErrorKind::NotConnected, "Not connected to OpenDKIM host")
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(OpendkimErrorKind::AlreadyConnected, format!("Connection '{}' already exists", id))
    }

    pub fn connection_failed(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::ConnectionFailed, msg.to_string())
    }

    pub fn auth_failed(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::AuthenticationFailed, msg.to_string())
    }

    pub fn config_syntax(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::ConfigSyntaxError, msg.to_string())
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(OpendkimErrorKind::ConfigNotFound, format!("Config not found: {}", path))
    }

    pub fn key_not_found(selector: &str, domain: &str) -> Self {
        Self::new(OpendkimErrorKind::KeyNotFound, format!("Key not found: {}._domainkey.{}", selector, domain))
    }

    pub fn signing_table(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::SigningTableError, msg.to_string())
    }

    pub fn key_table(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::KeyTableError, msg.to_string())
    }

    pub fn trusted_host(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::TrustedHostError, msg.to_string())
    }

    pub fn process(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::ProcessError, msg.to_string())
    }

    pub fn reload(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::ReloadFailed, msg.to_string())
    }

    pub fn permission_denied(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::PermissionDenied, msg.to_string())
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::IoError, e.to_string())
    }

    pub fn parse(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::ParseError, msg.to_string())
    }

    pub fn timeout(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::Timeout, msg.to_string())
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::new(OpendkimErrorKind::InternalError, msg.to_string())
    }
}

pub type OpendkimResult<T> = Result<T, OpendkimError>;
