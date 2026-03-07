// ── sorng-mysql-admin – error types ──────────────────────────────────────────

use std::fmt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MysqlAdminErrorKind {
    NotConnected,
    AlreadyConnected,
    ConnectionFailed,
    AuthenticationFailed,
    QueryFailed,
    DatabaseNotFound,
    UserNotFound,
    TableNotFound,
    ReplicationError,
    BackupError,
    PermissionDenied,
    LockError,
    ConfigError,
    ParseError,
    Timeout,
    InternalError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MysqlAdminError {
    pub kind: MysqlAdminErrorKind,
    pub message: String,
}

impl fmt::Display for MysqlAdminError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for MysqlAdminError {}

impl MysqlAdminError {
    pub fn new(kind: MysqlAdminErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn not_connected(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::NotConnected, msg)
    }
    pub fn already_connected(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::AlreadyConnected, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::ConnectionFailed, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::AuthenticationFailed, msg)
    }
    pub fn query(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::QueryFailed, msg)
    }
    pub fn database_not_found(db: &str) -> Self {
        Self::new(MysqlAdminErrorKind::DatabaseNotFound, format!("Database not found: {db}"))
    }
    pub fn user_not_found(user: &str) -> Self {
        Self::new(MysqlAdminErrorKind::UserNotFound, format!("User not found: {user}"))
    }
    pub fn table_not_found(table: &str) -> Self {
        Self::new(MysqlAdminErrorKind::TableNotFound, format!("Table not found: {table}"))
    }
    pub fn replication(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::ReplicationError, msg)
    }
    pub fn backup(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::BackupError, msg)
    }
    pub fn permission(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::PermissionDenied, msg)
    }
    pub fn lock(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::LockError, msg)
    }
    pub fn config(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::ConfigError, msg)
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::ParseError, msg)
    }
    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::Timeout, msg)
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(MysqlAdminErrorKind::InternalError, msg)
    }
}

pub type MysqlAdminResult<T> = Result<T, MysqlAdminError>;
