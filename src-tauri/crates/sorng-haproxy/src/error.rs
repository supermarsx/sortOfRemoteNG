//! Crate-local error types for HAProxy operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HaproxyErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    FrontendNotFound,
    BackendNotFound,
    ServerNotFound,
    AclNotFound,
    MapNotFound,
    StickTableNotFound,
    ConfigSyntaxError,
    ReloadFailed,
    SocketError,
    SshError,
    HttpError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HaproxyError {
    pub kind: HaproxyErrorKind,
    pub message: String,
}

impl fmt::Display for HaproxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for HaproxyError {}

impl HaproxyError {
    pub fn new(kind: HaproxyErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(HaproxyErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(HaproxyErrorKind::ConnectionFailed, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(HaproxyErrorKind::ParseError, msg)
    }
    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(HaproxyErrorKind::ReloadFailed, msg)
    }
    pub fn frontend_not_found(name: &str) -> Self {
        Self::new(HaproxyErrorKind::FrontendNotFound, format!("Frontend not found: {name}"))
    }
    pub fn backend_not_found(name: &str) -> Self {
        Self::new(HaproxyErrorKind::BackendNotFound, format!("Backend not found: {name}"))
    }
    pub fn server_not_found(name: &str) -> Self {
        Self::new(HaproxyErrorKind::ServerNotFound, format!("Server not found: {name}"))
    }
    pub fn socket(e: impl fmt::Display) -> Self {
        Self::new(HaproxyErrorKind::SocketError, e.to_string())
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(HaproxyErrorKind::SshError, e.to_string())
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(HaproxyErrorKind::HttpError, e.to_string())
    }
}

pub type HaproxyResult<T> = Result<T, HaproxyError>;
