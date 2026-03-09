//! Error types for the PAM management crate.

use std::fmt;

/// Errors that can occur during PAM operations.
#[derive(Debug)]
pub enum PamError {
    /// Required command not found on host
    CommandNotFound(String),
    /// Command returned a non-zero exit code
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    /// SSH connection/execution error
    SshError(String),
    /// Host not found by ID
    HostNotFound(String),
    /// Permission denied (needs sudo?)
    PermissionDenied(String),
    /// Failed to parse configuration file
    ParseError(String),
    /// PAM service not found in /etc/pam.d/
    ServiceNotFound(String),
    /// PAM module not found
    ModuleNotFound(String),
    /// Invalid configuration value
    InvalidConfig(String),
    /// I/O error
    IoError(String),
    /// JSON serialisation/deserialisation error
    JsonError(String),
    /// Operation timed out
    Timeout(String),
    /// Generic / unexpected error
    Other(String),
}

impl fmt::Display for PamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(p) => write!(f, "command not found: {p}"),
            Self::CommandFailed {
                command,
                exit_code,
                stderr,
            } => {
                write!(f, "command `{command}` failed (exit {exit_code}): {stderr}")
            }
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::HostNotFound(id) => write!(f, "host not found: {id}"),
            Self::PermissionDenied(e) => write!(f, "permission denied: {e}"),
            Self::ParseError(e) => write!(f, "parse error: {e}"),
            Self::ServiceNotFound(n) => write!(f, "PAM service not found: {n}"),
            Self::ModuleNotFound(n) => write!(f, "PAM module not found: {n}"),
            Self::InvalidConfig(e) => write!(f, "invalid configuration: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::Timeout(e) => write!(f, "timeout: {e}"),
            Self::Other(e) => write!(f, "PAM error: {e}"),
        }
    }
}

impl std::error::Error for PamError {}

impl From<std::io::Error> for PamError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for PamError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}

/// Helper to convert a PamError to a String (for Tauri command results).
pub fn err_str(e: PamError) -> String {
    e.to_string()
}
