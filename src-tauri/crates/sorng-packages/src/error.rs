use std::fmt;
#[derive(Debug)]
pub enum PkgError {
    CommandNotFound(String),
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    SshError(String),
    HostNotFound(String),
    PackageNotFound(String),
    DependencyError(String),
    LockError(String),
    PermissionDenied(String),
    IoError(String),
    JsonError(String),
    ParseError(String),
    Other(String),
}
impl fmt::Display for PkgError {
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
            Self::PackageNotFound(p) => write!(f, "Package not found: {p}"),
            Self::DependencyError(e) => write!(f, "Dependency: {e}"),
            Self::LockError(e) => write!(f, "Lock: {e}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::ParseError(e) => write!(f, "Parse: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for PkgError {}
impl From<std::io::Error> for PkgError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
impl From<serde_json::Error> for PkgError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}
