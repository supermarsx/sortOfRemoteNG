//! Crate-local error types for PostgreSQL administration operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PgAdminErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    QueryFailed,
    DatabaseNotFound,
    RoleNotFound,
    SchemaNotFound,
    TablespaceNotFound,
    ExtensionNotFound,
    ReplicationError,
    BackupError,
    VacuumError,
    HbaError,
    PermissionDenied,
    ConfigError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PgAdminError {
    pub kind: PgAdminErrorKind,
    pub message: String,
}

impl fmt::Display for PgAdminError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PgAdminError {}

pub type PgAdminResult<T> = Result<T, PgAdminError>;

impl PgAdminError {
    pub fn new(kind: PgAdminErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::AlreadyConnected, msg)
    }
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::ConnectionFailed, msg)
    }
    pub fn auth_failed(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::AuthenticationFailed, msg)
    }
    pub fn query_failed(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::QueryFailed, msg)
    }
    pub fn database_not_found(name: &str) -> Self {
        Self::new(PgAdminErrorKind::DatabaseNotFound, format!("Database not found: {name}"))
    }
    pub fn role_not_found(name: &str) -> Self {
        Self::new(PgAdminErrorKind::RoleNotFound, format!("Role not found: {name}"))
    }
    pub fn schema_not_found(name: &str) -> Self {
        Self::new(PgAdminErrorKind::SchemaNotFound, format!("Schema not found: {name}"))
    }
    pub fn tablespace_not_found(name: &str) -> Self {
        Self::new(PgAdminErrorKind::TablespaceNotFound, format!("Tablespace not found: {name}"))
    }
    pub fn extension_not_found(name: &str) -> Self {
        Self::new(PgAdminErrorKind::ExtensionNotFound, format!("Extension not found: {name}"))
    }
    pub fn replication(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::ReplicationError, msg)
    }
    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::BackupError, msg)
    }
    pub fn vacuum(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::VacuumError, msg)
    }
    pub fn hba(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::HbaError, msg)
    }
    pub fn permission_denied(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::PermissionDenied, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::ConfigError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::InternalError, msg)
    }
    pub fn ssh(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::ConnectionFailed, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(PgAdminErrorKind::QueryFailed, msg)
    }
}
