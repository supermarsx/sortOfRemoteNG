//! Error types for the mRemoteNG crate.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MremotengError {
    /// XML parsing error
    XmlParse(String),
    /// CSV parsing error
    CsvParse(String),
    /// RDP file parsing error
    RdpParse(String),
    /// PuTTY session import error
    PuttyImport(String),
    /// Encryption/decryption error
    Encryption(String),
    /// Decryption error (wrong password, corrupted data)
    Decryption(String),
    /// File I/O error
    Io(String),
    /// Invalid configuration version
    UnsupportedVersion(String),
    /// Missing required field
    MissingField(String),
    /// Invalid enum value
    InvalidValue(String),
    /// Serialization error
    Serialization(String),
    /// Generic error
    Other(String),
}

impl fmt::Display for MremotengError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::XmlParse(msg) => write!(f, "XML parse error: {}", msg),
            Self::CsvParse(msg) => write!(f, "CSV parse error: {}", msg),
            Self::RdpParse(msg) => write!(f, "RDP file parse error: {}", msg),
            Self::PuttyImport(msg) => write!(f, "PuTTY import error: {}", msg),
            Self::Encryption(msg) => write!(f, "Encryption error: {}", msg),
            Self::Decryption(msg) => write!(f, "Decryption error: {}", msg),
            Self::Io(msg) => write!(f, "I/O error: {}", msg),
            Self::UnsupportedVersion(msg) => write!(f, "Unsupported version: {}", msg),
            Self::MissingField(msg) => write!(f, "Missing field: {}", msg),
            Self::InvalidValue(msg) => write!(f, "Invalid value: {}", msg),
            Self::Serialization(msg) => write!(f, "Serialization error: {}", msg),
            Self::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for MremotengError {}

pub type MremotengResult<T> = Result<T, MremotengError>;

impl From<std::io::Error> for MremotengError {
    fn from(e: std::io::Error) -> Self { Self::Io(e.to_string()) }
}

impl From<quick_xml::Error> for MremotengError {
    fn from(e: quick_xml::Error) -> Self { Self::XmlParse(e.to_string()) }
}

impl From<quick_xml::events::attributes::AttrError> for MremotengError {
    fn from(e: quick_xml::events::attributes::AttrError) -> Self {
        Self::XmlParse(e.to_string())
    }
}

impl From<serde_json::Error> for MremotengError {
    fn from(e: serde_json::Error) -> Self { Self::Serialization(e.to_string()) }
}
