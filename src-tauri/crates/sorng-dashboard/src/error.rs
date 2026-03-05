//! Error types for the dashboard engine.

use std::fmt;

/// All errors that can originate from the dashboard engine.
#[derive(Debug, Clone)]
pub enum DashboardError {
    /// A connection with the given ID was not found.
    ConnectionNotFound(String),
    /// An alert with the given ID was not found.
    AlertNotFound(String),
    /// A health check failed for the given connection.
    HealthCheckFailed(String),
    /// The health check timed out.
    TimeoutError(String),
    /// A widget could not be generated.
    WidgetError(String),
    /// Configuration is invalid.
    ConfigError(String),
    /// The monitoring worker is not running.
    NotRunning,
    /// The monitoring worker is already running.
    AlreadyRunning,
    /// Serialization / deserialization failed.
    SerializationError(String),
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for DashboardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionNotFound(id) => write!(f, "connection not found: {id}"),
            Self::AlertNotFound(id) => write!(f, "alert not found: {id}"),
            Self::HealthCheckFailed(msg) => write!(f, "health check failed: {msg}"),
            Self::TimeoutError(msg) => write!(f, "timeout: {msg}"),
            Self::WidgetError(msg) => write!(f, "widget error: {msg}"),
            Self::ConfigError(msg) => write!(f, "config error: {msg}"),
            Self::NotRunning => write!(f, "dashboard monitoring is not running"),
            Self::AlreadyRunning => write!(f, "dashboard monitoring is already running"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for DashboardError {}

impl From<serde_json::Error> for DashboardError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}

impl From<std::io::Error> for DashboardError {
    fn from(e: std::io::Error) -> Self {
        Self::Internal(e.to_string())
    }
}
