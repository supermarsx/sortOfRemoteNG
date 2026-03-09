//! Unified BMC error types shared across all vendor crates.

use std::fmt;

/// Categorised error kinds covering all BMC protocol / domain errors.
#[derive(Debug, Clone)]
pub enum BmcErrorKind {
    /// BMC unreachable or session expired
    ConnectionError,
    /// Authentication failed (401 / bad credentials)
    AuthenticationError,
    /// Resource not found (404)
    NotFound,
    /// Invalid state for the requested operation
    InvalidState,
    /// HTTP / Redfish API error with status code
    ApiError(u16),
    /// Request timeout
    Timeout,
    /// Permission denied (403)
    AccessDenied,
    /// JSON/XML parse or deserialization error
    ParseError,
    /// Protocol not supported for this BMC generation
    UnsupportedProtocol,
    /// IPMI protocol error
    IpmiError,
    /// Generic / uncategorised
    Other,
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct BmcError {
    pub kind: BmcErrorKind,
    pub message: String,
}

impl BmcError {
    pub fn new(kind: BmcErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::AuthenticationError, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::NotFound, msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::ApiError(status), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::Timeout, msg)
    }

    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::AccessDenied, msg)
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::UnsupportedProtocol, msg)
    }

    pub fn ipmi(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::IpmiError, msg)
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::new(BmcErrorKind::Other, msg)
    }
}

impl fmt::Display for BmcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for BmcError {}

/// Convenience alias.
pub type BmcResult<T> = Result<T, BmcError>;
