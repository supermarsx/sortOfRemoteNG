// sorng-recording – Error types

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecordingError {
    SessionNotFound(String),
    RecordingNotFound(String),
    RecordingAlreadyActive(String),
    RecordingNotActive(String),
    EncodingError(String),
    CompressionError(String),
    StorageError(String),
    IoError(String),
    SerializationError(String),
    ConfigError(String),
    MacroError(String),
    JobError(String),
    InvalidParameter(String),
    CapacityExceeded(String),
    Cancelled,
    Internal(String),
}

impl fmt::Display for RecordingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionNotFound(id) => write!(f, "Session not found: {}", id),
            Self::RecordingNotFound(id) => write!(f, "Recording not found: {}", id),
            Self::RecordingAlreadyActive(id) => {
                write!(f, "Recording already active for session: {}", id)
            }
            Self::RecordingNotActive(id) => {
                write!(f, "No active recording for session: {}", id)
            }
            Self::EncodingError(msg) => write!(f, "Encoding error: {}", msg),
            Self::CompressionError(msg) => write!(f, "Compression error: {}", msg),
            Self::StorageError(msg) => write!(f, "Storage error: {}", msg),
            Self::IoError(msg) => write!(f, "I/O error: {}", msg),
            Self::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
            Self::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
            Self::MacroError(msg) => write!(f, "Macro error: {}", msg),
            Self::JobError(msg) => write!(f, "Job error: {}", msg),
            Self::InvalidParameter(msg) => write!(f, "Invalid parameter: {}", msg),
            Self::CapacityExceeded(msg) => write!(f, "Capacity exceeded: {}", msg),
            Self::Cancelled => write!(f, "Operation cancelled"),
            Self::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for RecordingError {}

impl From<std::io::Error> for RecordingError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for RecordingError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}

// Allow easy conversion to a Tauri-friendly String error
impl From<RecordingError> for String {
    fn from(e: RecordingError) -> Self {
        e.to_string()
    }
}

pub type RecordingResult<T> = Result<T, RecordingError>;
