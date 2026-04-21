//! Crate-local error types for Nginx operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NginxErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    ConfigSyntaxError,
    ConfigNotFound,
    SiteNotFound,
    UpstreamNotFound,
    CertificateError,
    ProcessError,
    ReloadFailed,
    TestFailed,
    PermissionDenied,
    SshError,
    IoError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NginxError {
    pub kind: NginxErrorKind,
    pub message: String,
}

impl fmt::Display for NginxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for NginxError {}

impl NginxError {
    pub fn new(kind: NginxErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(NginxErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(NginxErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(NginxErrorKind::ParseError, msg)
    }
    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(NginxErrorKind::ReloadFailed, msg)
    }
    pub fn process(msg: impl Into<String>) -> Self {
        Self::new(NginxErrorKind::ProcessError, msg)
    }
    pub fn site_not_found(name: &str) -> Self {
        Self::new(
            NginxErrorKind::SiteNotFound,
            format!("Site not found: {name}"),
        )
    }
    pub fn config_syntax(msg: &str) -> Self {
        Self::new(NginxErrorKind::ConfigSyntaxError, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(NginxErrorKind::SshError, e.to_string())
    }
    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(NginxErrorKind::IoError, e.to_string())
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(NginxErrorKind::ConnectionFailed, e.to_string())
    }
}

pub type NginxResult<T> = Result<T, NginxError>;
