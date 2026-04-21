// sorng-replay – Error types

use std::fmt;

/// All errors produced by the replay crate.
#[derive(Debug)]
pub enum ReplayError {
    /// The requested session/recording was not found.
    NotFound(String),
    /// A parse/deserialization error.
    ParseError(String),
    /// The player is in a state that does not allow the requested operation.
    InvalidState(String),
    /// Seek position is outside the valid range.
    SeekOutOfRange { requested_ms: u64, max_ms: u64 },
    /// Export failed.
    ExportError(String),
    /// IO error.
    Io(String),
    /// Generic internal error.
    Internal(String),
}

impl fmt::Display for ReplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(msg) => write!(f, "not found: {msg}"),
            Self::ParseError(msg) => write!(f, "parse error: {msg}"),
            Self::InvalidState(msg) => write!(f, "invalid state: {msg}"),
            Self::SeekOutOfRange {
                requested_ms,
                max_ms,
            } => write!(
                f,
                "seek out of range: requested {requested_ms} ms, max {max_ms} ms"
            ),
            Self::ExportError(msg) => write!(f, "export error: {msg}"),
            Self::Io(msg) => write!(f, "IO error: {msg}"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for ReplayError {}

impl From<serde_json::Error> for ReplayError {
    fn from(e: serde_json::Error) -> Self {
        Self::ParseError(e.to_string())
    }
}

impl From<std::io::Error> for ReplayError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

/// Crate-level Result alias.
pub type ReplayResult<T> = Result<T, ReplayError>;
