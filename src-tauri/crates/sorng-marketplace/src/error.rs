//! Error types for the marketplace.

use std::fmt;

/// All errors that can originate from the marketplace engine.
#[derive(Debug, Clone)]
pub enum MarketplaceError {
    /// A listing with the given ID was not found.
    ListingNotFound(String),
    /// A duplicate listing ID was detected.
    DuplicateListing(String),
    /// Repository fetch / network error.
    NetworkError(String),
    /// Repository index could not be parsed.
    IndexParseError(String),
    /// Extension manifest failed validation.
    ManifestValidationError(String),
    /// Dependency resolution failed.
    DependencyError(String),
    /// A circular dependency was detected.
    CircularDependency(String),
    /// Version compatibility check failed.
    IncompatibleVersion(String),
    /// Installation failed.
    InstallError(String),
    /// Uninstallation failed.
    UninstallError(String),
    /// SHA-256 verification failed.
    VerificationError(String),
    /// A review with the given ID was not found.
    ReviewNotFound(String),
    /// Invalid rating value (must be 1–5).
    InvalidRating(u8),
    /// Repository not found or not configured.
    RepositoryNotFound(String),
    /// Serialization / deserialization error.
    SerializationError(String),
    /// Conflict between extensions.
    ConflictError(String),
    /// I/O error during file operations.
    IoError(String),
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for MarketplaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ListingNotFound(id) => write!(f, "listing not found: {id}"),
            Self::DuplicateListing(id) => write!(f, "duplicate listing id: {id}"),
            Self::NetworkError(msg) => write!(f, "network error: {msg}"),
            Self::IndexParseError(msg) => write!(f, "index parse error: {msg}"),
            Self::ManifestValidationError(msg) => write!(f, "manifest validation error: {msg}"),
            Self::DependencyError(msg) => write!(f, "dependency error: {msg}"),
            Self::CircularDependency(msg) => write!(f, "circular dependency: {msg}"),
            Self::IncompatibleVersion(msg) => write!(f, "incompatible version: {msg}"),
            Self::InstallError(msg) => write!(f, "install error: {msg}"),
            Self::UninstallError(msg) => write!(f, "uninstall error: {msg}"),
            Self::VerificationError(msg) => write!(f, "verification error: {msg}"),
            Self::ReviewNotFound(id) => write!(f, "review not found: {id}"),
            Self::InvalidRating(v) => write!(f, "invalid rating value: {v} (must be 1–5)"),
            Self::RepositoryNotFound(url) => write!(f, "repository not found: {url}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::ConflictError(msg) => write!(f, "conflict: {msg}"),
            Self::IoError(msg) => write!(f, "i/o error: {msg}"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for MarketplaceError {}

impl From<serde_json::Error> for MarketplaceError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}

impl From<std::io::Error> for MarketplaceError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<reqwest::Error> for MarketplaceError {
    fn from(e: reqwest::Error) -> Self {
        Self::NetworkError(e.to_string())
    }
}
