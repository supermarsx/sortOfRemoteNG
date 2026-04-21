//! Crate-local error types for Postfix operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostfixErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigSyntaxError,
    ConfigNotFound,
    MapNotFound,
    DomainNotFound,
    TransportNotFound,
    AliasNotFound,
    QueueError,
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
pub struct PostfixError {
    pub kind: PostfixErrorKind,
    pub message: String,
}

impl fmt::Display for PostfixError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PostfixError {}

impl PostfixError {
    pub fn new(kind: PostfixErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            PostfixErrorKind::NotConnected,
            "Not connected to Postfix host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            PostfixErrorKind::AlreadyConnected,
            format!("Connection '{}' already exists", id),
        )
    }

    pub fn connection_failed(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::ConnectionFailed, msg.to_string())
    }

    pub fn config_syntax(msg: &str) -> Self {
        Self::new(PostfixErrorKind::ConfigSyntaxError, msg)
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            PostfixErrorKind::ConfigNotFound,
            format!("Config not found: {}", path),
        )
    }

    pub fn map_not_found(name: &str) -> Self {
        Self::new(
            PostfixErrorKind::MapNotFound,
            format!("Map not found: {}", name),
        )
    }

    pub fn domain_not_found(domain: &str) -> Self {
        Self::new(
            PostfixErrorKind::DomainNotFound,
            format!("Domain not found: {}", domain),
        )
    }

    pub fn transport_not_found(domain: &str) -> Self {
        Self::new(
            PostfixErrorKind::TransportNotFound,
            format!("Transport not found for domain: {}", domain),
        )
    }

    pub fn alias_not_found(address: &str) -> Self {
        Self::new(
            PostfixErrorKind::AliasNotFound,
            format!("Alias not found: {}", address),
        )
    }

    pub fn queue_error(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::QueueError, msg.to_string())
    }

    pub fn process_error(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::ProcessError, msg.to_string())
    }

    pub fn reload_failed(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::ReloadFailed, msg.to_string())
    }

    pub fn permission_denied(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::PermissionDenied, msg.to_string())
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::IoError, e.to_string())
    }

    pub fn parse(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::ParseError, msg.to_string())
    }

    pub fn timeout(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::Timeout, msg.to_string())
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::new(PostfixErrorKind::InternalError, msg.to_string())
    }
}

pub type PostfixResult<T> = Result<T, PostfixError>;
