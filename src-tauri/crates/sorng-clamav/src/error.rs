//! Crate-local error types for ClamAV operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClamavErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ScanError,
    VirusFound,
    DatabaseError,
    FreshclamError,
    ConfigNotFound,
    SocketError,
    ProcessError,
    PermissionDenied,
    SshError,
    IoError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClamavError {
    pub kind: ClamavErrorKind,
    pub message: String,
}

impl fmt::Display for ClamavError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ClamavError {}

impl ClamavError {
    pub fn new(kind: ClamavErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        Self::new(
            ClamavErrorKind::NotConnected,
            "Not connected to ClamAV host",
        )
    }

    pub fn already_connected(id: &str) -> Self {
        Self::new(
            ClamavErrorKind::AlreadyConnected,
            format!("Connection '{}' already exists", id),
        )
    }

    pub fn connection_failed(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::ConnectionFailed, msg.to_string())
    }

    pub fn auth_failed(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::AuthenticationFailed, msg.to_string())
    }

    pub fn scan_error(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::ScanError, msg.to_string())
    }

    pub fn virus_found(name: &str, path: &str) -> Self {
        Self::new(
            ClamavErrorKind::VirusFound,
            format!("Virus '{}' found in {}", name, path),
        )
    }

    pub fn database_error(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::DatabaseError, msg.to_string())
    }

    pub fn freshclam_error(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::FreshclamError, msg.to_string())
    }

    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            ClamavErrorKind::ConfigNotFound,
            format!("Config file not found: {}", path),
        )
    }

    pub fn socket_error(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::SocketError, msg.to_string())
    }

    pub fn process_error(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::ProcessError, msg.to_string())
    }

    pub fn permission_denied(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::PermissionDenied, msg.to_string())
    }

    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::SshError, e.to_string())
    }

    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::IoError, e.to_string())
    }

    pub fn parse(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::ParseError, msg.to_string())
    }

    pub fn timeout(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::Timeout, msg.to_string())
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::new(ClamavErrorKind::InternalError, msg.to_string())
    }
}

pub type ClamavResult<T> = Result<T, ClamavError>;
