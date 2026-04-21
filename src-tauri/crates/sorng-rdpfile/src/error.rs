//! Error types for RDP file operations.

use std::fmt;

/// All errors that can originate from RDP file parsing and generation.
#[derive(Debug, Clone)]
pub enum RdpFileError {
    /// The .rdp file content is empty.
    EmptyFile,
    /// A line could not be parsed.
    ParseError(String),
    /// The required `full address` field is missing.
    MissingAddress,
    /// A setting has an invalid value.
    InvalidValue { setting: String, message: String },
    /// A type prefix is unrecognized (not `i:` or `s:`).
    UnknownType { setting: String, type_char: String },
    /// An I/O error occurred (e.g. reading a file).
    IoError(String),
    /// Serialization / deserialization failed.
    SerializationError(String),
    /// A batch operation partially failed.
    BatchError {
        succeeded: usize,
        failed: usize,
        errors: Vec<String>,
    },
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for RdpFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyFile => write!(f, "RDP file is empty"),
            Self::ParseError(msg) => write!(f, "parse error: {msg}"),
            Self::MissingAddress => write!(f, "missing required field: full address"),
            Self::InvalidValue { setting, message } => {
                write!(f, "invalid value for '{setting}': {message}")
            }
            Self::UnknownType { setting, type_char } => {
                write!(f, "unknown type '{type_char}' for setting '{setting}'")
            }
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::BatchError {
                succeeded,
                failed,
                errors,
            } => {
                write!(
                    f,
                    "batch error: {succeeded} succeeded, {failed} failed: {}",
                    errors.join("; ")
                )
            }
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for RdpFileError {}

impl From<serde_json::Error> for RdpFileError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}

impl From<std::io::Error> for RdpFileError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
