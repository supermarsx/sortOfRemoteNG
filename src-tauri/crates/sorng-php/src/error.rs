//! Crate-local error types for PHP operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhpErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    VersionNotFound,
    FpmPoolNotFound,
    FpmNotRunning,
    ModuleNotFound,
    ModuleAlreadyEnabled,
    ModuleAlreadyDisabled,
    ConfigSyntaxError,
    ConfigNotFound,
    IniParseError,
    ComposerNotFound,
    ComposerError,
    OpcacheNotEnabled,
    SessionError,
    ProcessError,
    ReloadFailed,
    RestartFailed,
    ServiceError,
    PermissionDenied,
    SshError,
    IoError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhpError {
    pub kind: PhpErrorKind,
    pub message: String,
}

impl fmt::Display for PhpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PhpError {}

impl PhpError {
    pub fn new(kind: PhpErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ConnectionFailed, msg)
    }
    pub fn version_not_found(ver: &str) -> Self {
        Self::new(
            PhpErrorKind::VersionNotFound,
            format!("PHP version not found: {ver}"),
        )
    }
    pub fn pool_not_found(name: &str) -> Self {
        Self::new(
            PhpErrorKind::FpmPoolNotFound,
            format!("FPM pool not found: {name}"),
        )
    }
    pub fn fpm_not_running(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::FpmNotRunning, msg)
    }
    pub fn module_not_found(name: &str) -> Self {
        Self::new(
            PhpErrorKind::ModuleNotFound,
            format!("Module not found: {name}"),
        )
    }
    pub fn config_syntax(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ConfigSyntaxError, msg)
    }
    pub fn config_not_found(path: &str) -> Self {
        Self::new(
            PhpErrorKind::ConfigNotFound,
            format!("Config file not found: {path}"),
        )
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ParseError, msg)
    }
    pub fn composer_not_found() -> Self {
        Self::new(PhpErrorKind::ComposerNotFound, "Composer binary not found")
    }
    pub fn composer(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ComposerError, msg)
    }
    pub fn opcache_not_enabled() -> Self {
        Self::new(PhpErrorKind::OpcacheNotEnabled, "OPcache is not enabled")
    }
    pub fn process(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ProcessError, msg)
    }
    pub fn reload(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ReloadFailed, msg)
    }
    pub fn service(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::ServiceError, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(PhpErrorKind::CommandFailed, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(PhpErrorKind::SshError, e.to_string())
    }
    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(PhpErrorKind::IoError, e.to_string())
    }
}

pub type PhpResult<T> = Result<T, PhpError>;
