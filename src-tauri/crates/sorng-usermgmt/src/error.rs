//! Error types for the user management crate.

use std::fmt;

/// Errors that can occur during user/group management operations.
#[derive(Debug)]
pub enum UserMgmtError {
    /// Command not found on the system
    CommandNotFound(String),
    /// Command returned a non-zero exit code
    CommandFailed { command: String, exit_code: i32, stderr: String },
    /// SSH connection error
    SshError(String),
    /// Authentication failure
    AuthError(String),
    /// User not found
    UserNotFound(String),
    /// User already exists
    UserAlreadyExists(String),
    /// Group not found
    GroupNotFound(String),
    /// Group already exists
    GroupAlreadyExists(String),
    /// Host not found by ID
    HostNotFound(String),
    /// Cannot delete user (still in use / logged in)
    UserInUse(String),
    /// Password policy violation
    PasswordPolicyViolation(String),
    /// Quota error
    QuotaError(String),
    /// Permission denied (needs sudo?)
    PermissionDenied(String),
    /// Parse error (file format)
    ParseError(String),
    /// File not found
    FileNotFound(String),
    /// Sudoers validation failed
    SudoersInvalid(String),
    /// I/O error
    IoError(String),
    /// JSON error
    JsonError(String),
    /// Timeout
    Timeout(String),
    /// Generic error
    Other(String),
}

impl fmt::Display for UserMgmtError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed { command, exit_code, stderr } => {
                write!(f, "Command `{command}` failed (exit {exit_code}): {stderr}")
            }
            Self::SshError(e) => write!(f, "SSH error: {e}"),
            Self::AuthError(e) => write!(f, "Auth error: {e}"),
            Self::UserNotFound(u) => write!(f, "User not found: {u}"),
            Self::UserAlreadyExists(u) => write!(f, "User already exists: {u}"),
            Self::GroupNotFound(g) => write!(f, "Group not found: {g}"),
            Self::GroupAlreadyExists(g) => write!(f, "Group already exists: {g}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::UserInUse(u) => write!(f, "User is in use: {u}"),
            Self::PasswordPolicyViolation(e) => write!(f, "Password policy: {e}"),
            Self::QuotaError(e) => write!(f, "Quota error: {e}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::ParseError(e) => write!(f, "Parse error: {e}"),
            Self::FileNotFound(f2) => write!(f, "File not found: {f2}"),
            Self::SudoersInvalid(e) => write!(f, "Sudoers validation failed: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::JsonError(e) => write!(f, "JSON error: {e}"),
            Self::Timeout(e) => write!(f, "Timeout: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for UserMgmtError {}

impl From<std::io::Error> for UserMgmtError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for UserMgmtError {
    fn from(err: serde_json::Error) -> Self {
        Self::JsonError(err.to_string())
    }
}
