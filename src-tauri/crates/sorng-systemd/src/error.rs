//! Error types for the systemd crate.

use std::fmt;

#[derive(Debug)]
pub enum SystemdError {
    CommandNotFound(String),
    CommandFailed { command: String, exit_code: i32, stderr: String },
    SshError(String),
    UnitNotFound(String),
    HostNotFound(String),
    PermissionDenied(String),
    ParseError(String),
    JournalError(String),
    InvalidUnitFile(String),
    IoError(String),
    JsonError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for SystemdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed { command, exit_code, stderr } => {
                write!(f, "Command `{command}` failed (exit {exit_code}): {stderr}")
            }
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::UnitNotFound(u) => write!(f, "Unit not found: {u}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ParseError(e) => write!(f, "Parse error: {e}"),
            Self::JournalError(e) => write!(f, "Journal error: {e}"),
            Self::InvalidUnitFile(e) => write!(f, "Invalid unit file: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for SystemdError {}

impl From<std::io::Error> for SystemdError {
    fn from(err: std::io::Error) -> Self { Self::IoError(err.to_string()) }
}

impl From<serde_json::Error> for SystemdError {
    fn from(err: serde_json::Error) -> Self { Self::JsonError(err.to_string()) }
}
