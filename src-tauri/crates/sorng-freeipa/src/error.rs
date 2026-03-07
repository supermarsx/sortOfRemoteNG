//! Error types for the FreeIPA management crate.

use std::fmt;

/// Categorised error kinds for FreeIPA operations.
#[derive(Debug, Clone)]
pub enum FreeIpaErrorKind {
    /// Not connected to any FreeIPA server
    NotConnected,
    /// Server unreachable or network error
    ConnectionFailed,
    /// Invalid credentials or rejected login
    AuthenticationFailed,
    /// Requested object does not exist
    ObjectNotFound,
    /// Object already exists
    DuplicateEntry,
    /// Input validation failure
    ValidationError,
    /// Insufficient privileges
    PermissionDenied,
    /// Kerberos / cookie session expired
    SessionExpired,
    /// HTTP-level error with status code
    HttpError(u16),
    /// Response parse / deserialization error
    ParseError,
    /// Request timed out
    Timeout,
    /// Internal server error
    InternalError,
    /// FreeIPA JSON-RPC API error with code
    IpaError(i32),
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct FreeIpaError {
    pub kind: FreeIpaErrorKind,
    pub message: String,
}

impl FreeIpaError {
    pub fn new(kind: FreeIpaErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::NotConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::AuthenticationFailed, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ObjectNotFound, msg)
    }

    pub fn duplicate(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::DuplicateEntry, msg)
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ValidationError, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::PermissionDenied, msg)
    }

    pub fn session_expired(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::SessionExpired, msg)
    }

    pub fn http(status: u16, msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::HttpError(status), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::InternalError, msg)
    }

    pub fn ipa(code: i32, msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::IpaError(code), msg)
    }
}

/// Helper to convert any Display-able error into an InternalError variant.
pub fn err_str(e: impl fmt::Display) -> FreeIpaError {
    FreeIpaError::internal(e.to_string())
}

impl fmt::Display for FreeIpaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let prefix = match &self.kind {
            FreeIpaErrorKind::NotConnected => "FreeIPA not connected",
            FreeIpaErrorKind::ConnectionFailed => "FreeIPA connection failed",
            FreeIpaErrorKind::AuthenticationFailed => "FreeIPA authentication failed",
            FreeIpaErrorKind::ObjectNotFound => "FreeIPA object not found",
            FreeIpaErrorKind::DuplicateEntry => "FreeIPA duplicate entry",
            FreeIpaErrorKind::ValidationError => "FreeIPA validation error",
            FreeIpaErrorKind::PermissionDenied => "FreeIPA permission denied",
            FreeIpaErrorKind::SessionExpired => "FreeIPA session expired",
            FreeIpaErrorKind::HttpError(code) => return write!(f, "FreeIPA HTTP error ({}): {}", code, self.message),
            FreeIpaErrorKind::ParseError => "FreeIPA parse error",
            FreeIpaErrorKind::Timeout => "FreeIPA timeout",
            FreeIpaErrorKind::InternalError => "FreeIPA internal error",
            FreeIpaErrorKind::IpaError(code) => return write!(f, "FreeIPA API error ({}): {}", code, self.message),
        };
        write!(f, "{}: {}", prefix, self.message)
    }
}

impl std::error::Error for FreeIpaError {}

impl From<reqwest::Error> for FreeIpaError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            FreeIpaError::timeout(e.to_string())
        } else if e.is_connect() {
            FreeIpaError::connection(e.to_string())
        } else {
            FreeIpaError::internal(e.to_string())
        }
    }
}

impl From<serde_json::Error> for FreeIpaError {
    fn from(e: serde_json::Error) -> Self {
        FreeIpaError::parse(e.to_string())
    }
}

/// Convenience alias used throughout the crate.
pub type FreeIpaResult<T> = Result<T, FreeIpaError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = FreeIpaError::auth("bad password");
        assert!(e.to_string().contains("authentication failed"));
        assert!(e.to_string().contains("bad password"));
    }

    #[test]
    fn ipa_error_display() {
        let e = FreeIpaError::ipa(4001, "no such user");
        assert!(e.to_string().contains("4001"));
        assert!(e.to_string().contains("no such user"));
    }

    #[test]
    fn http_error_display() {
        let e = FreeIpaError::http(401, "Unauthorized");
        assert!(e.to_string().contains("401"));
    }

    #[test]
    fn not_connected_display() {
        let e = FreeIpaError::not_connected("call connect first");
        assert!(e.to_string().contains("not connected"));
    }

    #[test]
    fn err_str_helper() {
        let e = err_str("oops");
        assert!(e.to_string().contains("oops"));
    }
}
