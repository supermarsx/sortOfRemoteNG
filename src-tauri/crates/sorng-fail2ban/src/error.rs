//! Error types for the fail2ban crate.

use std::fmt;

/// Errors that can occur during fail2ban operations.
#[derive(Debug)]
pub enum Fail2banError {
    /// fail2ban-client not found
    ClientNotFound(String),
    /// fail2ban-client returned an error
    ClientFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    /// SSH connection error
    SshError(String),
    /// Authentication failure
    AuthError(String),
    /// Jail not found
    JailNotFound(String),
    /// IP already banned
    AlreadyBanned { ip: String, jail: String },
    /// IP not currently banned
    NotBanned { ip: String, jail: String },
    /// Filter not found
    FilterNotFound(String),
    /// Action not found
    ActionNotFound(String),
    /// Host not found by ID
    HostNotFound(String),
    /// fail2ban server not running
    ServerNotRunning,
    /// Configuration parse error
    ConfigError(String),
    /// Log parse error
    LogParseError(String),
    /// Permission denied (needs sudo?)
    PermissionDenied(String),
    /// I/O error
    IoError(String),
    /// JSON error
    JsonError(String),
    /// Process spawn error
    ProcessError(String),
    /// Timeout
    Timeout(String),
    /// Generic / unexpected error
    Other(String),
}

impl fmt::Display for Fail2banError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ClientNotFound(p) => write!(f, "fail2ban-client not found: {p}"),
            Self::ClientFailed {
                command,
                exit_code,
                stderr,
            } => write!(f, "fail2ban-client `{command}` failed (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::AuthError(e) => write!(f, "authentication error: {e}"),
            Self::JailNotFound(j) => write!(f, "jail not found: {j}"),
            Self::AlreadyBanned { ip, jail } => write!(f, "IP {ip} already banned in {jail}"),
            Self::NotBanned { ip, jail } => write!(f, "IP {ip} not banned in {jail}"),
            Self::FilterNotFound(n) => write!(f, "filter not found: {n}"),
            Self::ActionNotFound(n) => write!(f, "action not found: {n}"),
            Self::HostNotFound(id) => write!(f, "host not found: {id}"),
            Self::ServerNotRunning => write!(f, "fail2ban server is not running"),
            Self::ConfigError(e) => write!(f, "configuration error: {e}"),
            Self::LogParseError(e) => write!(f, "log parse error: {e}"),
            Self::PermissionDenied(e) => write!(f, "permission denied: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::ProcessError(e) => write!(f, "process error: {e}"),
            Self::Timeout(e) => write!(f, "timeout: {e}"),
            Self::Other(e) => write!(f, "fail2ban error: {e}"),
        }
    }
}

impl std::error::Error for Fail2banError {}

impl From<std::io::Error> for Fail2banError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for Fail2banError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}

/// Helper to convert a Fail2banError to a String (for Tauri command results).
pub fn err_str(e: Fail2banError) -> String {
    e.to_string()
}
