//! Error types for the syslog crate.
use std::fmt;

#[derive(Debug)]
pub enum SyslogError {
    CommandNotFound(String),
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    SshError(String),
    HostNotFound(String),
    ConfigParseError(String),
    ConfigWriteError(String),
    ServiceError(String),
    PermissionDenied(String),
    FileNotFound(String),
    IoError(String),
    JsonError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for SyslogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed {
                command,
                exit_code,
                stderr,
            } => write!(f, "`{command}` failed (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::ConfigParseError(e) => write!(f, "Config parse: {e}"),
            Self::ConfigWriteError(e) => write!(f, "Config write: {e}"),
            Self::ServiceError(e) => write!(f, "Service: {e}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::FileNotFound(p) => write!(f, "File not found: {p}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for SyslogError {}
impl From<std::io::Error> for SyslogError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
impl From<serde_json::Error> for SyslogError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}
