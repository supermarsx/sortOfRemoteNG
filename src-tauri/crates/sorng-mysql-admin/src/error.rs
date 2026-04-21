//! Crate-local error types for MySQL/MariaDB operations.

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MysqlErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    DatabaseNotFound,
    TableNotFound,
    UserNotFound,
    ReplicationError,
    QueryError,
    BackupError,
    RestoreError,
    PermissionDenied,
    VariableNotFound,
    ProcessNotFound,
    BinlogError,
    SshError,
    ParseError,
    CommandFailed,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MysqlError {
    pub kind: MysqlErrorKind,
    pub message: String,
}

impl fmt::Display for MysqlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for MysqlError {}

impl MysqlError {
    pub fn new(kind: MysqlErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::AlreadyConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::AuthenticationFailed, msg)
    }
    pub fn database_not_found(name: &str) -> Self {
        Self::new(
            MysqlErrorKind::DatabaseNotFound,
            format!("Database not found: {name}"),
        )
    }
    pub fn table_not_found(name: &str) -> Self {
        Self::new(
            MysqlErrorKind::TableNotFound,
            format!("Table not found: {name}"),
        )
    }
    pub fn user_not_found(user: &str, host: &str) -> Self {
        Self::new(
            MysqlErrorKind::UserNotFound,
            format!("User not found: '{user}'@'{host}'"),
        )
    }
    pub fn replication(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::ReplicationError, msg)
    }
    pub fn query(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::QueryError, msg)
    }
    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::BackupError, msg)
    }
    pub fn restore(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::RestoreError, msg)
    }
    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::PermissionDenied, msg)
    }
    pub fn variable_not_found(name: &str) -> Self {
        Self::new(
            MysqlErrorKind::VariableNotFound,
            format!("Variable not found: {name}"),
        )
    }
    pub fn process_not_found(id: u64) -> Self {
        Self::new(
            MysqlErrorKind::ProcessNotFound,
            format!("Process not found: {id}"),
        )
    }
    pub fn binlog(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::BinlogError, msg)
    }
    pub fn ssh(e: impl fmt::Display) -> Self {
        Self::new(MysqlErrorKind::SshError, e.to_string())
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::ParseError, msg)
    }
    pub fn command_failed(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::CommandFailed, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::InternalError, msg)
    }
}

pub type MysqlResult<T> = Result<T, MysqlError>;
