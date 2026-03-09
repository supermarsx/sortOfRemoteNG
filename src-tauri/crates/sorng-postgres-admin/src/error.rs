//! Crate-local error types for PostgreSQL administration operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PgErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    RoleNotFound,
    DatabaseNotFound,
    SchemaNotFound,
    TablespaceNotFound,
    ExtensionNotFound,
    ReplicationError,
    WalError,
    VacuumError,
    BackupError,
    RestoreError,
    HbaParseError,
    PermissionDenied,
    SshError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PgError {
    pub kind: PgErrorKind,
    pub message: String,
}

impl fmt::Display for PgError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PgError {}

impl PgError {
    pub fn new(kind: PgErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::NotConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::ConnectionFailed, msg)
    }
    pub fn role_not_found(name: &str) -> Self {
        Self::new(PgErrorKind::RoleNotFound, format!("Role not found: {name}"))
    }
    pub fn database_not_found(name: &str) -> Self {
        Self::new(
            PgErrorKind::DatabaseNotFound,
            format!("Database not found: {name}"),
        )
    }
    pub fn schema_not_found(name: &str) -> Self {
        Self::new(
            PgErrorKind::SchemaNotFound,
            format!("Schema not found: {name}"),
        )
    }
    pub fn tablespace_not_found(name: &str) -> Self {
        Self::new(
            PgErrorKind::TablespaceNotFound,
            format!("Tablespace not found: {name}"),
        )
    }
    pub fn extension_not_found(name: &str) -> Self {
        Self::new(
            PgErrorKind::ExtensionNotFound,
            format!("Extension not found: {name}"),
        )
    }
    pub fn replication(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::ReplicationError, msg)
    }
    pub fn wal(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::WalError, msg)
    }
    pub fn vacuum(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::VacuumError, msg)
    }
    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::BackupError, msg)
    }
    pub fn restore(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::RestoreError, msg)
    }
    pub fn hba_parse(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::HbaParseError, msg)
    }
    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::PermissionDenied, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::ParseError, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::CommandFailed, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(PgErrorKind::SshError, e.to_string())
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PgErrorKind::InternalError, msg)
    }
}

pub type PgResult<T> = Result<T, PgError>;
