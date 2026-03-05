//! # Error types
//!
//! Unified error enum for the credential-management crate.

use std::fmt;

/// All possible errors produced by the credential subsystem.
#[derive(Debug)]
pub enum CredentialError {
    /// A credential with the given ID was not found.
    NotFound(String),
    /// A credential with the given ID already exists.
    AlreadyExists(String),
    /// A policy with the given ID was not found.
    PolicyNotFound(String),
    /// A policy with the given ID already exists.
    PolicyAlreadyExists(String),
    /// A group with the given ID was not found.
    GroupNotFound(String),
    /// A group with the given ID already exists.
    GroupAlreadyExists(String),
    /// An alert with the given ID was not found.
    AlertNotFound(String),
    /// An audit log entry with the given ID was not found.
    AuditEntryNotFound(String),
    /// A validation error (e.g. missing required fields).
    Validation(String),
    /// JSON (de)serialization error.
    Serialization(String),
    /// Generic / internal error.
    Internal(String),
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Credential not found: {id}"),
            Self::AlreadyExists(id) => write!(f, "Credential already exists: {id}"),
            Self::PolicyNotFound(id) => write!(f, "Rotation policy not found: {id}"),
            Self::PolicyAlreadyExists(id) => write!(f, "Rotation policy already exists: {id}"),
            Self::GroupNotFound(id) => write!(f, "Credential group not found: {id}"),
            Self::GroupAlreadyExists(id) => write!(f, "Credential group already exists: {id}"),
            Self::AlertNotFound(id) => write!(f, "Alert not found: {id}"),
            Self::AuditEntryNotFound(id) => write!(f, "Audit entry not found: {id}"),
            Self::Validation(msg) => write!(f, "Validation error: {msg}"),
            Self::Serialization(msg) => write!(f, "Serialization error: {msg}"),
            Self::Internal(msg) => write!(f, "Internal error: {msg}"),
        }
    }
}

impl std::error::Error for CredentialError {}

impl From<serde_json::Error> for CredentialError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}
