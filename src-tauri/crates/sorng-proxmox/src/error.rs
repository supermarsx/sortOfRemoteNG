//! Error types for the Proxmox VE management crate.

use std::fmt;

/// Categorised error kinds.
#[derive(Debug, Clone)]
pub enum ProxmoxErrorKind {
    /// PVE REST API unreachable or session expired
    ConnectionError,
    /// Authentication failed (401)
    AuthenticationError,
    /// Resource not found (404 / 500 with "no such …")
    NotFound,
    /// VM/CT is in an unexpected state for the requested operation
    InvalidState,
    /// Snapshot operation failed
    SnapshotError,
    /// Storage operation failed
    StorageError,
    /// Network configuration error
    NetworkError,
    /// Node error (offline, unreachable, or maintenance)
    NodeError,
    /// Cluster operation error
    ClusterError,
    /// Backup / vzdump error
    BackupError,
    /// Firewall rule error
    FirewallError,
    /// HA error (fencing, resource management)
    HaError,
    /// Ceph error (mon, OSD, pool)
    CephError,
    /// SDN error (zone, vnet, subnet)
    SdnError,
    /// Console ticket error
    ConsoleError,
    /// Task error (failed, timed out)
    TaskError,
    /// Template download/upload error
    TemplateError,
    /// HTTP / API error with status code
    ApiError(u16),
    /// Request timeout
    Timeout,
    /// Permission denied (403)
    AccessDenied,
    /// Two-factor authentication required
    TfaRequired,
    /// JSON parse / deserialization error
    ParseError,
    /// Pool management error
    PoolError,
    /// Migration error (live or offline)
    MigrationError,
    /// Metrics / RRD data error
    MetricsError,
    /// Generic
    Other,
}

/// Crate error type carrying a kind + human-readable message.
#[derive(Debug, Clone)]
pub struct ProxmoxError {
    pub kind: ProxmoxErrorKind,
    pub message: String,
}

impl ProxmoxError {
    pub fn new(kind: ProxmoxErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }

    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::ConnectionError, msg)
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::AuthenticationError, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::NotFound, msg)
    }

    pub fn api(status: u16, msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::ApiError(status), msg)
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::ParseError, msg)
    }

    pub fn task(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::TaskError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::Timeout, msg)
    }

    pub fn node(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::NodeError, msg)
    }

    pub fn invalid_state(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::InvalidState, msg)
    }

    pub fn cluster(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::ClusterError, msg)
    }

    pub fn storage(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::StorageError, msg)
    }

    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::BackupError, msg)
    }

    pub fn firewall(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::FirewallError, msg)
    }

    pub fn ha(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::HaError, msg)
    }

    pub fn ceph(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::CephError, msg)
    }

    pub fn sdn(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::SdnError, msg)
    }

    pub fn console(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::ConsoleError, msg)
    }

    pub fn template(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::TemplateError, msg)
    }

    pub fn pool(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::PoolError, msg)
    }

    pub fn migration(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::MigrationError, msg)
    }

    pub fn metrics(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::MetricsError, msg)
    }

    pub fn tfa(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::TfaRequired, msg)
    }

    pub fn access_denied(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::AccessDenied, msg)
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(ProxmoxErrorKind::NetworkError, msg)
    }
}

impl fmt::Display for ProxmoxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for ProxmoxError {}

/// Convenience result alias.
pub type ProxmoxResult<T> = Result<T, ProxmoxError>;
