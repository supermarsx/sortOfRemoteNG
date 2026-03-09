use std::fmt;
#[derive(Debug)]
pub enum LdapError {
    CommandNotFound(String),
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    SshError(String),
    HostNotFound(String),
    EntryNotFound(String),
    DuplicateEntry(String),
    SchemaViolation(String),
    PermissionDenied(String),
    ConnectionError(String),
    ConfigParseError(String),
    LdifError(String),
    IoError(String),
    JsonError(String),
    Other(String),
}
impl fmt::Display for LdapError {
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
            Self::EntryNotFound(d) => write!(f, "Entry not found: {d}"),
            Self::DuplicateEntry(d) => write!(f, "Duplicate entry: {d}"),
            Self::SchemaViolation(e) => write!(f, "Schema violation: {e}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ConnectionError(e) => write!(f, "Connection: {e}"),
            Self::ConfigParseError(e) => write!(f, "Config parse: {e}"),
            Self::LdifError(e) => write!(f, "LDIF: {e}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for LdapError {}
impl From<std::io::Error> for LdapError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
impl From<serde_json::Error> for LdapError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}
