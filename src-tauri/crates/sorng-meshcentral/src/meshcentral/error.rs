//! MeshCentral error types.

use std::fmt;

/// Unified error type for all MeshCentral operations.
#[derive(Debug)]
pub enum MeshCentralError {
    /// Not connected / no session
    NotConnected,
    /// Session not found
    SessionNotFound(String),
    /// Authentication failure
    AuthenticationFailed(String),
    /// Token required for 2FA
    TokenRequired,
    /// Invalid login key
    InvalidLoginKey,
    /// Server returned an error
    ServerError(String),
    /// Device not found
    DeviceNotFound(String),
    /// Device group not found
    DeviceGroupNotFound(String),
    /// User not found
    UserNotFound(String),
    /// User group not found
    UserGroupNotFound(String),
    /// Command execution failed
    CommandFailed(String),
    /// File transfer failed
    FileTransferFailed(String),
    /// Network / HTTP error
    NetworkError(String),
    /// JSON parse error
    ParseError(String),
    /// Timeout
    Timeout(String),
    /// Permission denied
    PermissionDenied(String),
    /// Invalid parameter
    InvalidParameter(String),
    /// Operation not supported
    NotSupported(String),
    /// Generic / internal
    Internal(String),
}

impl fmt::Display for MeshCentralError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConnected => write!(f, "Not connected to MeshCentral server"),
            Self::SessionNotFound(id) => write!(f, "Session '{}' not found", id),
            Self::AuthenticationFailed(msg) => write!(f, "Authentication failed: {}", msg),
            Self::TokenRequired => write!(f, "2FA token required"),
            Self::InvalidLoginKey => write!(f, "Invalid or missing login key"),
            Self::ServerError(msg) => write!(f, "Server error: {}", msg),
            Self::DeviceNotFound(id) => write!(f, "Device '{}' not found", id),
            Self::DeviceGroupNotFound(id) => write!(f, "Device group '{}' not found", id),
            Self::UserNotFound(id) => write!(f, "User '{}' not found", id),
            Self::UserGroupNotFound(id) => write!(f, "User group '{}' not found", id),
            Self::CommandFailed(msg) => write!(f, "Command failed: {}", msg),
            Self::FileTransferFailed(msg) => write!(f, "File transfer failed: {}", msg),
            Self::NetworkError(msg) => write!(f, "Network error: {}", msg),
            Self::ParseError(msg) => write!(f, "Parse error: {}", msg),
            Self::Timeout(msg) => write!(f, "Timeout: {}", msg),
            Self::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
            Self::InvalidParameter(msg) => write!(f, "Invalid parameter: {}", msg),
            Self::NotSupported(msg) => write!(f, "Not supported: {}", msg),
            Self::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for MeshCentralError {}

impl From<reqwest::Error> for MeshCentralError {
    fn from(e: reqwest::Error) -> Self {
        MeshCentralError::NetworkError(e.to_string())
    }
}

impl From<serde_json::Error> for MeshCentralError {
    fn from(e: serde_json::Error) -> Self {
        MeshCentralError::ParseError(e.to_string())
    }
}

impl From<url::ParseError> for MeshCentralError {
    fn from(e: url::ParseError) -> Self {
        MeshCentralError::InvalidParameter(format!("Invalid URL: {}", e))
    }
}

/// Convenience Result alias.
pub type MeshCentralResult<T> = Result<T, MeshCentralError>;

/// Convert MeshCentralError to a String for Tauri command returns.
impl From<MeshCentralError> for String {
    fn from(e: MeshCentralError) -> Self {
        e.to_string()
    }
}
