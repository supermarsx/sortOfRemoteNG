//! Error types for the remote-backup crate.

use std::fmt;

/// Errors that can occur during backup operations.
#[derive(Debug)]
pub enum BackupError {
    /// Tool binary not found on the system
    ToolNotFound(String),
    /// Tool returned a non-zero exit code
    ToolFailed {
        tool: String,
        exit_code: i32,
        stderr: String,
    },
    /// SSH connection or transport error
    SshError(String),
    /// Authentication failure
    AuthError(String),
    /// Permission denied on source or destination
    PermissionDenied(String),
    /// Source path does not exist
    SourceNotFound(String),
    /// Destination path does not exist or is unreachable
    DestinationUnreachable(String),
    /// Repository does not exist or is corrupted
    RepositoryError(String),
    /// Repository is locked by another process
    RepositoryLocked(String),
    /// Integrity verification failed
    IntegrityError(String),
    /// Retention policy error
    RetentionError(String),
    /// Bandwidth limit configuration error
    BandwidthError(String),
    /// Schedule / cron expression error
    ScheduleError(String),
    /// Job not found by ID
    JobNotFound(String),
    /// Job is already running
    JobAlreadyRunning(String),
    /// Job was cancelled
    JobCancelled(String),
    /// Timeout exceeded
    Timeout(String),
    /// Configuration validation error
    ConfigError(String),
    /// I/O error
    IoError(String),
    /// JSON serialization / deserialization error
    JsonError(String),
    /// Process spawn error
    ProcessError(String),
    /// Generic / unexpected error
    Other(String),
}

impl fmt::Display for BackupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ToolNotFound(t) => write!(f, "backup tool not found: {t}"),
            Self::ToolFailed {
                tool,
                exit_code,
                stderr,
            } => write!(f, "{tool} failed (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::AuthError(e) => write!(f, "authentication error: {e}"),
            Self::PermissionDenied(e) => write!(f, "permission denied: {e}"),
            Self::SourceNotFound(p) => write!(f, "source not found: {p}"),
            Self::DestinationUnreachable(p) => write!(f, "destination unreachable: {p}"),
            Self::RepositoryError(e) => write!(f, "repository error: {e}"),
            Self::RepositoryLocked(e) => write!(f, "repository locked: {e}"),
            Self::IntegrityError(e) => write!(f, "integrity check failed: {e}"),
            Self::RetentionError(e) => write!(f, "retention policy error: {e}"),
            Self::BandwidthError(e) => write!(f, "bandwidth limit error: {e}"),
            Self::ScheduleError(e) => write!(f, "schedule error: {e}"),
            Self::JobNotFound(id) => write!(f, "backup job not found: {id}"),
            Self::JobAlreadyRunning(id) => write!(f, "backup job already running: {id}"),
            Self::JobCancelled(id) => write!(f, "backup job cancelled: {id}"),
            Self::Timeout(e) => write!(f, "timeout: {e}"),
            Self::ConfigError(e) => write!(f, "configuration error: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::ProcessError(e) => write!(f, "process error: {e}"),
            Self::Other(e) => write!(f, "backup error: {e}"),
        }
    }
}

impl std::error::Error for BackupError {}

impl From<std::io::Error> for BackupError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for BackupError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}

/// Helper to convert a BackupError to a String (for Tauri command results).
pub fn err_str(e: BackupError) -> String {
    e.to_string()
}
