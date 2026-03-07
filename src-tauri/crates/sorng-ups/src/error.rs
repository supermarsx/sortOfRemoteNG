//! Crate-local error types for UPS / NUT operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    DeviceNotFound,
    DriverNotFound,
    OutletNotFound,
    ScheduleNotFound,
    VariableNotFound,
    CommandNotSupported,
    TestFailed,
    ConfigError,
    NutError,
    SshError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpsError {
    pub kind: UpsErrorKind,
    pub message: String,
}

impl fmt::Display for UpsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for UpsError {}

impl UpsError {
    pub fn new(kind: UpsErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::AlreadyConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::AuthenticationFailed, msg)
    }
    pub fn device_not_found(name: &str) -> Self {
        Self::new(UpsErrorKind::DeviceNotFound, format!("UPS device not found: {name}"))
    }
    pub fn driver_not_found(name: &str) -> Self {
        Self::new(UpsErrorKind::DriverNotFound, format!("Driver not found: {name}"))
    }
    pub fn outlet_not_found(id: &str) -> Self {
        Self::new(UpsErrorKind::OutletNotFound, format!("Outlet not found: {id}"))
    }
    pub fn schedule_not_found(id: &str) -> Self {
        Self::new(UpsErrorKind::ScheduleNotFound, format!("Schedule not found: {id}"))
    }
    pub fn variable_not_found(name: &str) -> Self {
        Self::new(UpsErrorKind::VariableNotFound, format!("Variable not found: {name}"))
    }
    pub fn command_not_supported(cmd: &str) -> Self {
        Self::new(UpsErrorKind::CommandNotSupported, format!("Command not supported: {cmd}"))
    }
    pub fn test_failed(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::TestFailed, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ConfigError, msg)
    }
    pub fn nut(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::NutError, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(UpsErrorKind::SshError, e.to_string())
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ParseError, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::CommandFailed, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::InternalError, msg)
    }
}

pub type UpsResult<T> = Result<T, UpsError>;
