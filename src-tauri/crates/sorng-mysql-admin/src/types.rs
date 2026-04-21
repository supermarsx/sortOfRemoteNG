//! Shared types for MySQL/MariaDB administration.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlConnectionConfig {
    /// SSH host to connect through
    pub host: String,
    /// SSH port (default 22)
    pub port: Option<u16>,
    /// SSH username
    pub ssh_user: Option<String>,
    /// SSH password
    pub ssh_password: Option<String>,
    /// Path to SSH private key
    pub ssh_key: Option<String>,
    /// MySQL user for authentication
    pub mysql_user: Option<String>,
    /// MySQL password
    pub mysql_password: Option<String>,
    /// MySQL host to connect to from the SSH server (default 127.0.0.1)
    pub mysql_host: Option<String>,
    /// MySQL port (default 3306)
    pub mysql_port: Option<u16>,
    /// Unix socket path (overrides host/port when set)
    pub mysql_socket: Option<String>,
    /// Connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlConnectionSummary {
    pub host: String,
    pub version: String,
    pub uptime: u64,
    pub databases_count: u64,
    pub threads_connected: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users & Grants
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlUser {
    pub user: String,
    pub host: String,
    pub plugin: String,
    pub account_locked: bool,
    pub password_expired: bool,
    pub max_connections: u64,
    pub ssl_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlGrant {
    pub user: String,
    pub host: String,
    pub privilege: String,
    pub database: String,
    pub table_name: String,
    pub is_grantable: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlDatabase {
    pub name: String,
    pub character_set: String,
    pub collation: String,
    pub size_bytes: u64,
    pub tables_count: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tables, Columns & Indexes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlTable {
    pub name: String,
    pub engine: String,
    pub row_format: String,
    pub rows: u64,
    pub data_length: u64,
    pub index_length: u64,
    pub auto_increment: Option<u64>,
    pub create_time: String,
    pub update_time: Option<String>,
    pub collation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlColumn {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub character_set: Option<String>,
    pub collation: Option<String>,
    pub column_key: String,
    pub extra: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlIndex {
    pub name: String,
    pub table_name: String,
    pub non_unique: bool,
    pub columns: Vec<String>,
    pub index_type: String,
    pub comment: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationStatus {
    pub role: String,
    pub master_host: Option<String>,
    pub master_port: Option<u16>,
    pub slave_io_running: Option<String>,
    pub slave_sql_running: Option<String>,
    pub seconds_behind_master: Option<u64>,
    pub last_error: Option<String>,
    pub gtid_executed: Option<String>,
    pub read_master_log_pos: Option<u64>,
    pub exec_master_log_pos: Option<u64>,
    pub relay_log_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationConfig {
    pub server_id: u64,
    pub log_bin: bool,
    pub binlog_format: String,
    pub gtid_mode: Option<String>,
    pub enforce_gtid_consistency: Option<String>,
    pub replicate_do_db: Vec<String>,
    pub replicate_ignore_db: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slow Query Log
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowQueryEntry {
    pub query_time: f64,
    pub lock_time: f64,
    pub rows_sent: u64,
    pub rows_examined: u64,
    pub timestamp: String,
    pub user: String,
    pub host: String,
    pub db: String,
    pub sql_text: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// InnoDB
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbStatus {
    pub buffer_pool_size: u64,
    pub buffer_pool_free: u64,
    pub buffer_pool_dirty: u64,
    pub buffer_pool_hit_rate: f64,
    pub log_sequence_number: u64,
    pub log_flushed_up_to: u64,
    pub pages_created: u64,
    pub pages_read: u64,
    pub pages_written: u64,
    pub rows_inserted: u64,
    pub rows_updated: u64,
    pub rows_deleted: u64,
    pub rows_read: u64,
    pub deadlocks: u64,
    pub pending_io_reads: u64,
    pub pending_io_writes: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Variables & Status
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlVariable {
    pub name: String,
    pub value: String,
    pub is_global: bool,
    pub is_session: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Processes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlProcess {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: String,
    pub info: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Binary Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogFile {
    pub name: String,
    pub size: u64,
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogEvent {
    pub log_name: String,
    pub pos: u64,
    pub event_type: String,
    pub server_id: u64,
    pub end_log_pos: u64,
    pub info: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backup
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub databases: Vec<String>,
    pub output_path: String,
    pub compress: bool,
    pub single_transaction: bool,
    pub routines: bool,
    pub triggers: bool,
    pub events: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub path: String,
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub databases: Vec<String>,
}
