//! Crate-local error types for Mailcow operations.

use std::fmt;

/// Categorised error kinds for Mailcow API interactions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MailcowErrorKind {
    /// Client has not connected yet
    NotConnected,
    /// A connection with this ID already exists
    AlreadyConnected,
    /// TCP / TLS connection failed
    ConnectionFailed,
    /// API key rejected (HTTP 401)
    AuthenticationFailed,
    /// Insufficient permissions (HTTP 403)
    Forbidden,
    /// Generic resource not found (HTTP 404)
    NotFound,
    /// Requested domain does not exist
    DomainNotFound,
    /// Requested mailbox does not exist
    MailboxNotFound,
    /// Requested alias does not exist
    AliasNotFound,
    /// DKIM key not found for domain
    DkimNotFound,
    /// Catch-all resource not found
    ResourceNotFound,
    /// Quota exceeded for domain or mailbox
    QuotaExceeded,
    /// Attempted to create a duplicate entry
    DuplicateEntry,
    /// Non-2xx response from the Mailcow API
    ApiError,
    /// JSON / response-body parse error
    ParseError,
    /// Request timed out
    Timeout,
    /// Unexpected internal error
    InternalError,
}

/// Crate error carrying a kind + human-readable message.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MailcowError {
    pub kind: MailcowErrorKind,
    pub message: String,
}

impl fmt::Display for MailcowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for MailcowError {}

impl MailcowError {
    pub fn new(kind: MailcowErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }

    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::NotConnected, msg)
    }

    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::AlreadyConnected, msg)
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::ConnectionFailed, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::AuthenticationFailed, msg)
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::Forbidden, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::NotFound, msg)
    }

    pub fn domain_not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::DomainNotFound, msg)
    }

    pub fn mailbox_not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::MailboxNotFound, msg)
    }

    pub fn alias_not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::AliasNotFound, msg)
    }

    pub fn dkim_not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::DkimNotFound, msg)
    }

    pub fn resource_not_found(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::ResourceNotFound, msg)
    }

    pub fn quota_exceeded(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::QuotaExceeded, msg)
    }

    pub fn duplicate(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::DuplicateEntry, msg)
    }

    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::ApiError, msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::ParseError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::Timeout, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(MailcowErrorKind::InternalError, msg)
    }
}

/// Convenience result alias.
pub type MailcowResult<T> = Result<T, MailcowError>;
