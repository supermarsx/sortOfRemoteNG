use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupVerifyErrorKind {
    ConnectionFailed,
    SessionNotFound,
    PolicyNotFound,
    CatalogError,
    VerificationFailed,
    IntegrityError,
    DrTestFailed,
    ComplianceError,
    ReplicationError,
    SchedulerError,
    StorageError,
    EncryptionError,
    SerializationError,
    Timeout,
    PermissionDenied,
}

impl fmt::Display for BackupVerifyErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionFailed => write!(f, "ConnectionFailed"),
            Self::SessionNotFound => write!(f, "SessionNotFound"),
            Self::PolicyNotFound => write!(f, "PolicyNotFound"),
            Self::CatalogError => write!(f, "CatalogError"),
            Self::VerificationFailed => write!(f, "VerificationFailed"),
            Self::IntegrityError => write!(f, "IntegrityError"),
            Self::DrTestFailed => write!(f, "DrTestFailed"),
            Self::ComplianceError => write!(f, "ComplianceError"),
            Self::ReplicationError => write!(f, "ReplicationError"),
            Self::SchedulerError => write!(f, "SchedulerError"),
            Self::StorageError => write!(f, "StorageError"),
            Self::EncryptionError => write!(f, "EncryptionError"),
            Self::SerializationError => write!(f, "SerializationError"),
            Self::Timeout => write!(f, "Timeout"),
            Self::PermissionDenied => write!(f, "PermissionDenied"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupVerifyError {
    pub kind: BackupVerifyErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl BackupVerifyError {
    pub fn new(kind: BackupVerifyErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::ConnectionFailed, msg)
    }

    pub fn session_not_found(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::SessionNotFound, msg)
    }

    pub fn policy_not_found(policy_id: &str) -> Self {
        Self::new(
            BackupVerifyErrorKind::PolicyNotFound,
            format!("Policy '{}' not found", policy_id),
        )
    }

    pub fn catalog_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::CatalogError, msg)
    }

    pub fn verification_failed(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::VerificationFailed, msg)
    }

    pub fn integrity_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::IntegrityError, msg)
    }

    pub fn dr_test_failed(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::DrTestFailed, msg)
    }

    pub fn compliance_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::ComplianceError, msg)
    }

    pub fn replication_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::ReplicationError, msg)
    }

    pub fn scheduler_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::SchedulerError, msg)
    }

    pub fn storage_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::StorageError, msg)
    }

    pub fn serialization_error(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::SerializationError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::Timeout, msg)
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(BackupVerifyErrorKind::PermissionDenied, msg)
    }
}

impl fmt::Display for BackupVerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)?;
        if let Some(ref details) = self.details {
            write!(f, " ({})", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for BackupVerifyError {}

impl From<serde_json::Error> for BackupVerifyError {
    fn from(e: serde_json::Error) -> Self {
        Self::serialization_error(e.to_string())
    }
}

impl From<std::io::Error> for BackupVerifyError {
    fn from(e: std::io::Error) -> Self {
        Self::storage_error(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, BackupVerifyError>;
