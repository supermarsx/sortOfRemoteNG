//! Error types for portable mode operations.

use std::fmt;

/// All errors that can originate from the portable module.
#[derive(Debug, Clone)]
pub enum PortableError {
    /// The portable marker file could not be created.
    MarkerCreateFailed(String),
    /// The portable marker file could not be removed.
    MarkerRemoveFailed(String),
    /// A required directory does not exist and could not be created.
    DirectoryCreateFailed(String),
    /// The migration failed.
    MigrationFailed(String),
    /// The specified path is invalid.
    InvalidPath(String),
    /// A file copy operation failed.
    CopyFailed { source: String, dest: String, reason: String },
    /// Insufficient disk space for the operation.
    InsufficientSpace { required: u64, available: u64 },
    /// An I/O error occurred.
    IoError(String),
    /// Serialization / deserialization failed.
    SerializationError(String),
    /// The configuration is invalid.
    InvalidConfig(String),
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for PortableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MarkerCreateFailed(msg) => write!(f, "failed to create portable marker: {msg}"),
            Self::MarkerRemoveFailed(msg) => write!(f, "failed to remove portable marker: {msg}"),
            Self::DirectoryCreateFailed(msg) => write!(f, "failed to create directory: {msg}"),
            Self::MigrationFailed(msg) => write!(f, "migration failed: {msg}"),
            Self::InvalidPath(msg) => write!(f, "invalid path: {msg}"),
            Self::CopyFailed { source, dest, reason } => {
                write!(f, "copy failed from '{source}' to '{dest}': {reason}")
            }
            Self::InsufficientSpace { required, available } => {
                write!(
                    f,
                    "insufficient space: need {} bytes, have {} bytes",
                    required, available
                )
            }
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::InvalidConfig(msg) => write!(f, "invalid config: {msg}"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for PortableError {}

impl From<std::io::Error> for PortableError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for PortableError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}
