//! Error types for the cron crate.

use std::fmt;

#[derive(Debug)]
pub enum CronError {
    CommandNotFound(String),
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    SshError(String),
    HostNotFound(String),
    PermissionDenied(String),
    ParseError(String),
    InvalidCronExpression(String),
    UserNotFound(String),
    JobNotFound(String),
    IoError(String),
    JsonError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for CronError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed {
                command,
                exit_code,
                stderr,
            } => {
                write!(f, "Command `{command}` failed (exit {exit_code}): {stderr}")
            }
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ParseError(e) => write!(f, "Parse error: {e}"),
            Self::InvalidCronExpression(e) => write!(f, "Invalid cron expression: {e}"),
            Self::UserNotFound(u) => write!(f, "User not found: {u}"),
            Self::JobNotFound(j) => write!(f, "Job not found: {j}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for CronError {}

impl From<std::io::Error> for CronError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for CronError {
    fn from(err: serde_json::Error) -> Self {
        Self::JsonError(err.to_string())
    }
}
