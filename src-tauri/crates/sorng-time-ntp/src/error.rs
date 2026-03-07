//! Error types for time / NTP management.
use std::fmt;

#[derive(Debug)]
pub enum TimeNtpError {
    CommandNotFound(String),
    CommandFailed { command: String, exit_code: i32, stderr: String },
    SshError(String),
    HostNotFound(String),
    PermissionDenied(String),
    ParseError(String),
    InvalidTimezone(String),
    NtpError(String),
    IoError(String),
    JsonError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for TimeNtpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed { command, exit_code, stderr } => write!(f, "`{command}` failed (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ParseError(e) => write!(f, "Parse error: {e}"),
            Self::InvalidTimezone(tz) => write!(f, "Invalid timezone: {tz}"),
            Self::NtpError(e) => write!(f, "NTP: {e}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for TimeNtpError {}

impl From<std::io::Error> for TimeNtpError {
    fn from(e: std::io::Error) -> Self { Self::IoError(e.to_string()) }
}

impl From<serde_json::Error> for TimeNtpError {
    fn from(e: serde_json::Error) -> Self { Self::JsonError(e.to_string()) }
}
