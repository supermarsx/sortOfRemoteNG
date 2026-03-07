//! Error types for the kernel crate.

use std::fmt;

#[derive(Debug)]
pub enum KernelError {
    CommandNotFound(String),
    CommandFailed { command: String, exit_code: i32, stderr: String },
    SshError(String),
    HostNotFound(String),
    PermissionDenied(String),
    ParseError(String),
    ModuleNotFound(String),
    ModuleInUse(String),
    SysctlError(String),
    IoError(String),
    JsonError(String),
    Timeout(String),
    Other(String),
}

impl fmt::Display for KernelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed { command, exit_code, stderr } => {
                write!(f, "Command `{command}` failed (exit {exit_code}): {stderr}")
            }
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ParseError(e) => write!(f, "Parse error: {e}"),
            Self::ModuleNotFound(m) => write!(f, "Module not found: {m}"),
            Self::ModuleInUse(m) => write!(f, "Module in use: {m}"),
            Self::SysctlError(e) => write!(f, "Sysctl error: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for KernelError {}

impl From<std::io::Error> for KernelError {
    fn from(err: std::io::Error) -> Self { Self::IoError(err.to_string()) }
}

impl From<serde_json::Error> for KernelError {
    fn from(err: serde_json::Error) -> Self { Self::JsonError(err.to_string()) }
}
