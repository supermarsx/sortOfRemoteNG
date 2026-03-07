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
    DeviceOffline,
    CommandFailed,
    BatteryError,
    OutletNotFound,
    NutError,
    ConfigError,
    ScheduleError,
    PermissionDenied,
    ParseError,
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
    pub fn device_offline(name: &str) -> Self {
        Self::new(UpsErrorKind::DeviceOffline, format!("UPS device offline: {name}"))
    }
    pub fn command(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::CommandFailed, msg)
    }
    pub fn battery(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::BatteryError, msg)
    }
    pub fn outlet_not_found(id: u32) -> Self {
        Self::new(UpsErrorKind::OutletNotFound, format!("Outlet not found: {id}"))
    }
    pub fn nut(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::NutError, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ConfigError, msg)
    }
    pub fn schedule(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ScheduleError, msg)
    }
    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::PermissionDenied, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(UpsErrorKind::InternalError, msg)
    }
}

pub type UpsResult<T> = Result<T, UpsError>;
