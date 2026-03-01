//! Error types for the VMware management crate.

use std::fmt;

/// Categorised error kinds.
#[derive(Debug, Clone)]
pub enum VmwareErrorKind {
    /// vSphere REST API unreachable or session expired
    ConnectionError,
    /// Authentication failed (401)
    AuthenticationError,
    /// Resource not found (404)
    NotFound,
    /// VM is in an unexpected power state
    InvalidVmState,
    /// Snapshot operation failed
    SnapshotError,
    /// Storage / datastore error
    StorageError,
    /// Network / port-group error
    NetworkError,
    /// ESXi host error
    HostError,
    /// VMRC / Horizon View process error
    VmrcError,
    /// HTTP / API error with status code
    ApiError(u16),
    /// Timeout
    Timeout,
    /// Permission denied (403)
    AccessDenied,
    /// Task failed on vCenter
    TaskError,
    /// JSON parse / deserialization error
    ParseError,
    /// Migration / vMotion error
    MigrationError,
    /// Metrics / performance counter error
    MetricsError,
    /// Generic
    Other,
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct VmwareError {
    pub kind: VmwareErrorKind,
    pub message: String,
}

impl VmwareError {
    pub fn new(kind: VmwareErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::AuthenticationError, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::NotFound, msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::ApiError(status), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::ParseError, msg)
    }

    pub fn vmrc(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::VmrcError, msg)
    }

    pub fn task(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::TaskError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::Timeout, msg)
    }

    pub fn host(msg: impl Into<String>) -> Self {
        Self::new(VmwareErrorKind::HostError, msg)
    }
}

impl fmt::Display for VmwareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for VmwareError {}

impl From<VmwareError> for String {
    fn from(e: VmwareError) -> String {
        e.to_string()
    }
}

impl From<reqwest::Error> for VmwareError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(format!("HTTP timeout: {e}"))
        } else if e.is_connect() {
            Self::connection(format!("Connection failed: {e}"))
        } else {
            Self::new(VmwareErrorKind::Other, format!("HTTP error: {e}"))
        }
    }
}

impl From<serde_json::Error> for VmwareError {
    fn from(e: serde_json::Error) -> Self {
        Self::parse(format!("JSON parse error: {e}"))
    }
}

/// Convenience alias.
pub type VmwareResult<T> = Result<T, VmwareError>;
