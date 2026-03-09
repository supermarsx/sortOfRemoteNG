use std::fmt;
#[derive(Debug)]
pub enum FileSharingError {
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
    ShareNotFound(String),
    PermissionDenied(String),
    IoError(String),
    JsonError(String),
    Other(String),
}
impl fmt::Display for FileSharingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed {
                command,
                exit_code,
                stderr,
            } => write!(f, "`{command}` (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::ConfigParseError(e) => write!(f, "Config parse: {e}"),
            Self::ConfigWriteError(e) => write!(f, "Config write: {e}"),
            Self::ShareNotFound(s) => write!(f, "Share not found: {s}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for FileSharingError {}
impl From<std::io::Error> for FileSharingError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
impl From<serde_json::Error> for FileSharingError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}
