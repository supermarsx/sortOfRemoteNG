//! Crate-local error types for VMware Desktop operations.

use std::fmt;

/// Categorises the kind of failure.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VmwErrorKind {
    NotConnected,
    AlreadyConnected,
    VmNotFound,
    SnapshotNotFound,
    VmRunNotFound,
    VmRestNotAvailable,
    VmxParseError,
    VmdkError,
    NetworkError,
    PermissionDenied,
    InvalidConfig,
    Timeout,
    IoError,
    HttpError,
    CommandFailed,
    UnsupportedPlatform,
    InternalError,
}

/// A rich error that can be serialised across the Tauri IPC boundary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmwError {
    pub kind: VmwErrorKind,
    pub message: String,
}

impl fmt::Display for VmwError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for VmwError {}

impl VmwError {
    pub fn new(kind: VmwErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected() -> Self {
        Self::new(VmwErrorKind::NotConnected, "Not connected to VMware Desktop host")
    }
    pub fn vm_not_found(id: &str) -> Self {
        Self::new(VmwErrorKind::VmNotFound, format!("VM not found: {id}"))
    }
    pub fn snapshot_not_found(name: &str) -> Self {
        Self::new(VmwErrorKind::SnapshotNotFound, format!("Snapshot not found: {name}"))
    }
    pub fn vmrun_not_found() -> Self {
        Self::new(VmwErrorKind::VmRunNotFound, "vmrun executable not found on PATH")
    }
    pub fn command_failed(cmd: &str, stderr: &str) -> Self {
        Self::new(VmwErrorKind::CommandFailed, format!("{cmd}: {stderr}"))
    }
    pub fn io(e: impl fmt::Display) -> Self {
        Self::new(VmwErrorKind::IoError, e.to_string())
    }
    pub fn http(e: impl fmt::Display) -> Self {
        Self::new(VmwErrorKind::HttpError, e.to_string())
    }
}

/// Convenience result alias used throughout the crate.
pub type VmwResult<T> = Result<T, VmwError>;
