//! Error types for the Hyper-V management crate.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Error kinds for Hyper-V operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HyperVErrorKind {
    /// The Hyper-V PowerShell module is not installed or available.
    ModuleNotAvailable,
    /// The target VM was not found.
    VmNotFound,
    /// The requested operation is invalid for the current VM state.
    InvalidVmState,
    /// A PowerShell command failed.
    PowerShellError,
    /// Timeout waiting for an operation to complete.
    Timeout,
    /// A VHD operation failed (create, resize, convert, etc.).
    VhdError,
    /// A virtual switch operation failed.
    SwitchError,
    /// A checkpoint / snapshot operation failed.
    CheckpointError,
    /// A replication operation failed.
    ReplicationError,
    /// Live migration failed.
    MigrationError,
    /// Insufficient privileges.
    AccessDenied,
    /// A metrics / resource metering operation failed.
    MetricsError,
    /// JSON parsing / deserialization error.
    ParseError,
    /// The host is not reachable or the credential is wrong.
    ConnectionError,
    /// An export / import operation failed.
    ExportImportError,
    /// A generic / uncategorised error.
    Other,
}

/// Hyper-V management error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperVError {
    pub kind: HyperVErrorKind,
    pub message: String,
    #[serde(default)]
    pub details: Option<String>,
}

impl fmt::Display for HyperVError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(ref d) = self.details {
            write!(f, " — {}", d)?;
        }
        Ok(())
    }
}

impl std::error::Error for HyperVError {}

impl HyperVError {
    pub fn new(kind: HyperVErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        kind: HyperVErrorKind,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn module_not_available() -> Self {
        Self::new(
            HyperVErrorKind::ModuleNotAvailable,
            "Hyper-V PowerShell module is not available. Ensure the Hyper-V role is installed.",
        )
    }

    pub fn vm_not_found(name_or_id: &str) -> Self {
        Self::new(
            HyperVErrorKind::VmNotFound,
            format!("VM '{}' not found", name_or_id),
        )
    }

    pub fn invalid_state(vm: &str, current: &str, expected: &str) -> Self {
        Self::new(
            HyperVErrorKind::InvalidVmState,
            format!(
                "VM '{}' is in state '{}', expected '{}'",
                vm, current, expected
            ),
        )
    }

    pub fn ps_error(stderr: impl Into<String>) -> Self {
        Self::new(HyperVErrorKind::PowerShellError, stderr)
    }

    pub fn timeout(op: &str) -> Self {
        Self::new(
            HyperVErrorKind::Timeout,
            format!("Operation '{}' timed out", op),
        )
    }

    pub fn parse(message: impl Into<String>) -> Self {
        Self::new(HyperVErrorKind::ParseError, message)
    }

    pub fn access_denied(message: impl Into<String>) -> Self {
        Self::new(HyperVErrorKind::AccessDenied, message)
    }
}

/// Convert a `HyperVError` into a plain `String` for Tauri command returns.
impl From<HyperVError> for String {
    fn from(e: HyperVError) -> String {
        e.to_string()
    }
}

/// Convenience alias.
pub type HyperVResult<T> = Result<T, HyperVError>;
