//! Error types for Redis operations.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Categories of errors that can occur during Redis operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RedisErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    CommandFailed,
    KeyNotFound,
    TypeError,
    ClusterError,
    TimeoutError,
    SerializationError,
}

/// The primary error type for all Redis operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisError {
    /// The category of error.
    pub kind: RedisErrorKind,
    /// A human-readable description of what went wrong.
    pub message: String,
    /// Additional context or details.
    #[serde(default)]
    pub details: Option<String>,
}

impl RedisError {
    /// Create a new error with the given kind and message.
    pub fn new(kind: RedisErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    /// Attach additional detail text to this error.
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Convenience constructor for connection failures.
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(RedisErrorKind::ConnectionFailed, msg)
    }

    /// Convenience constructor for authentication failures.
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(RedisErrorKind::AuthenticationFailed, msg)
    }

    /// Convenience constructor for session-not-found errors.
    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            RedisErrorKind::SessionNotFound,
            format!("Session not found: {}", id),
        )
    }

    /// Convenience constructor for command failures.
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(RedisErrorKind::CommandFailed, msg)
    }

    /// Convenience constructor for key-not-found errors.
    pub fn key_not_found(key: &str) -> Self {
        Self::new(
            RedisErrorKind::KeyNotFound,
            format!("Key not found: {}", key),
        )
    }

    /// Convenience constructor for type errors.
    pub fn type_error(msg: impl Into<String>) -> Self {
        Self::new(RedisErrorKind::TypeError, msg)
    }
}

impl fmt::Display for RedisError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(ref details) = self.details {
            write!(f, " — {}", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for RedisError {}

impl From<redis::RedisError> for RedisError {
    fn from(err: redis::RedisError) -> Self {
        let kind = match err.kind() {
            redis::ErrorKind::AuthenticationFailed => RedisErrorKind::AuthenticationFailed,
            redis::ErrorKind::IoError => RedisErrorKind::ConnectionFailed,
            redis::ErrorKind::TypeError => RedisErrorKind::TypeError,
            redis::ErrorKind::ClusterDown | redis::ErrorKind::MasterDown => {
                RedisErrorKind::ClusterError
            }
            _ => RedisErrorKind::CommandFailed,
        };
        Self::new(kind, err.to_string())
    }
}

impl From<serde_json::Error> for RedisError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(RedisErrorKind::SerializationError, err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display() {
        let e = RedisError::connection_failed("cannot connect");
        assert!(e.to_string().contains("cannot connect"));
    }

    #[test]
    fn with_details() {
        let e = RedisError::auth_failed("NOAUTH").with_details("password required");
        assert_eq!(e.kind, RedisErrorKind::AuthenticationFailed);
        assert_eq!(e.details.as_deref(), Some("password required"));
    }

    #[test]
    fn session_not_found() {
        let e = RedisError::session_not_found("abc-123");
        assert!(e.message.contains("abc-123"));
    }

    #[test]
    fn serialize() {
        let e = RedisError::command_failed("ERR unknown command");
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "commandFailed");
    }
}
