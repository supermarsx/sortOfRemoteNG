//! Crate-local error types for Apache httpd operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApacheErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigSyntaxError,
    ConfigNotFound,
    VhostNotFound,
    ModuleNotFound,
    CertificateError,
    ProcessError,
    ReloadFailed,
    TestFailed,
    PermissionDenied,
    SshError,
    IoError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApacheError {
    pub kind: ApacheErrorKind,
    pub message: String,
}

impl fmt::Display for ApacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ApacheError {}

impl ApacheError {
    pub fn new(kind: ApacheErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(ApacheErrorKind::NotConnected, "Not connected to Apache host")
    }
    pub fn vhost_not_found(name: &str) -> Self {
        Self::new(ApacheErrorKind::VhostNotFound, format!("VirtualHost not found: {name}"))
    }
    pub fn config_syntax(msg: &str) -> Self {
        Self::new(ApacheErrorKind::ConfigSyntaxError, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(ApacheErrorKind::SshError, e.to_string())
    }
    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(ApacheErrorKind::IoError, e.to_string())
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(ApacheErrorKind::HttpError, e.to_string())
    }
}

pub type ApacheResult<T> = Result<T, ApacheError>;
