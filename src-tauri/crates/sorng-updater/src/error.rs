//! Error types for the updater.

use std::fmt;

/// All errors that can originate from the updater engine.
#[derive(Debug, Clone)]
pub enum UpdateError {
    /// A network request failed.
    NetworkError(String),
    /// The response from the update server was invalid.
    InvalidResponse(String),
    /// Version string could not be parsed.
    VersionParseError(String),
    /// The downloaded file checksum did not match.
    ChecksumMismatch { expected: String, actual: String },
    /// Signature verification failed.
    SignatureInvalid(String),
    /// A file I/O operation failed.
    IoError(String),
    /// No update is available.
    NoUpdateAvailable,
    /// The download was cancelled by the user.
    DownloadCancelled,
    /// The download is already in progress.
    DownloadInProgress,
    /// Installation failed.
    InstallError(String),
    /// Rollback failed.
    RollbackError(String),
    /// No rollback is available.
    NoRollbackAvailable,
    /// Configuration is invalid.
    ConfigError(String),
    /// Serialization / deserialization error.
    SerializationError(String),
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NetworkError(msg) => write!(f, "network error: {msg}"),
            Self::InvalidResponse(msg) => write!(f, "invalid response: {msg}"),
            Self::VersionParseError(msg) => write!(f, "version parse error: {msg}"),
            Self::ChecksumMismatch { expected, actual } => {
                write!(f, "checksum mismatch: expected {expected}, got {actual}")
            }
            Self::SignatureInvalid(msg) => write!(f, "invalid signature: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::NoUpdateAvailable => write!(f, "no update available"),
            Self::DownloadCancelled => write!(f, "download cancelled"),
            Self::DownloadInProgress => write!(f, "download already in progress"),
            Self::InstallError(msg) => write!(f, "installation error: {msg}"),
            Self::RollbackError(msg) => write!(f, "rollback error: {msg}"),
            Self::NoRollbackAvailable => write!(f, "no rollback available"),
            Self::ConfigError(msg) => write!(f, "configuration error: {msg}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<serde_json::Error> for UpdateError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}

impl From<std::io::Error> for UpdateError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<reqwest::Error> for UpdateError {
    fn from(e: reqwest::Error) -> Self {
        Self::NetworkError(e.to_string())
    }
}
