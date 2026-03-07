//! Error types for the FreeIPA management crate.

use std::fmt;

/// Categorised error kinds for FreeIPA operations.
#[derive(Debug, Clone)]
pub enum FreeIpaErrorKind {
    /// Server unreachable or network error
    ConnectionFailed,
    /// Invalid credentials or rejected login
    AuthenticationFailed,
    /// Kerberos / cookie session expired
    SessionExpired,
    /// Requested object does not exist
    NotFound,
    /// Object already exists
    DuplicateEntry,
    /// Input validation failure
    ValidationError,
    /// LDAP backend error
    LdapError,
    /// Kerberos operation error
    KerberosError,
    /// Certificate operation error
    CertificateError,
    /// DNS zone / record error
    DnsError,
    /// Policy error
    PolicyError,
    /// JSON-RPC API error with code
    ApiError(i32),
    /// Insufficient privileges
    PermissionDenied,
    /// Response parse / deserialization error
    ParseError,
    /// Request timed out
    Timeout,
    /// Generic / uncategorised
    Other,
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

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_expired(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::SessionExpired, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::NotFound, msg)
    }

    pub fn duplicate(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::DuplicateEntry, msg)
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ValidationError, msg)
    }

    pub fn ldap(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::LdapError, msg)
    }

    pub fn kerberos(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::KerberosError, msg)
    }

    pub fn certificate(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::CertificateError, msg)
    }

    pub fn dns(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::DnsError, msg)
    }

    pub fn policy(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::PolicyError, msg)
    }

    pub fn api(code: i32, msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ApiError(code), msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::PermissionDenied, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::Timeout, msg)
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::new(FreeIpaErrorKind::Other, msg)
    }
}

/// Helper to convert any Display-able error into an Other variant.
pub fn err_str(e: impl fmt::Display) -> FreeIpaError {
    FreeIpaError::other(e.to_string())
}

impl fmt::Display for FreeIpaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let prefix = match &self.kind {
            FreeIpaErrorKind::ConnectionFailed => "FreeIPA connection failed",
            FreeIpaErrorKind::AuthenticationFailed => "FreeIPA authentication failed",
            FreeIpaErrorKind::SessionExpired => "FreeIPA session expired",
            FreeIpaErrorKind::NotFound => "FreeIPA not found",
            FreeIpaErrorKind::DuplicateEntry => "FreeIPA duplicate entry",
            FreeIpaErrorKind::ValidationError => "FreeIPA validation error",
            FreeIpaErrorKind::LdapError => "FreeIPA LDAP error",
            FreeIpaErrorKind::KerberosError => "FreeIPA Kerberos error",
            FreeIpaErrorKind::CertificateError => "FreeIPA certificate error",
            FreeIpaErrorKind::DnsError => "FreeIPA DNS error",
            FreeIpaErrorKind::PolicyError => "FreeIPA policy error",
            FreeIpaErrorKind::ApiError(code) => return write!(f, "FreeIPA API error ({}): {}", code, self.message),
            FreeIpaErrorKind::PermissionDenied => "FreeIPA permission denied",
            FreeIpaErrorKind::ParseError => "FreeIPA parse error",
            FreeIpaErrorKind::Timeout => "FreeIPA timeout",
            FreeIpaErrorKind::Other => "FreeIPA error",
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
            FreeIpaError::other(e.to_string())
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
    fn api_error_display() {
        let e = FreeIpaError::api(4001, "no such user");
        assert!(e.to_string().contains("4001"));
        assert!(e.to_string().contains("no such user"));
    }

    #[test]
    fn err_str_helper() {
        let e = err_str("oops");
        assert!(e.to_string().contains("oops"));
    }
}
