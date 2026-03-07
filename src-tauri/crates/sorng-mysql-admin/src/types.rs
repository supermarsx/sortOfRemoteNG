// ── sorng-mysql-admin – shared types ─────────────────────────────────────────

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub mysql_user: Option<String>,
    pub mysql_password: Option<String>,
    pub mysql_socket: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub server_id: Option<String>,
    pub uptime: Option<u64>,
    pub databases_count: Option<u32>,
    pub is_replica: Option<bool>,
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlServerStatus {
    pub version: String,
    pub uptime: u64,
    pub threads_connected: u64,
    pub threads_running: u64,
    pub queries: u64,
    pub slow_queries: u64,
    pub opens: u64,
    pub open_tables: u64,
    pub flush_tables: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub aborted_connects: u64,
    pub aborted_clients: u64,
    pub max_connections: u64,
    pub connection_errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlGlobalStatus {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessListEntry {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: Option<String>,
    pub info: Option<String>,
    pub progress: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlDatabase {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub tables_count: Option<u32>,
    pub size_bytes: Option<u64>,
    pub index_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatabaseRequest {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterDatabaseRequest {
    pub charset: Option<String>,
    pub collation: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlUser {
    pub user: String,
    pub host: String,
    pub plugin: Option<String>,
    pub authentication_string: Option<String>,
    pub ssl_type: Option<String>,
    pub max_connections: Option<u32>,
    pub max_user_connections: Option<u32>,
    pub account_locked: Option<bool>,
    pub password_expired: Option<bool>,
    pub password_lifetime: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlGrant {
    pub privilege: String,
    pub database: Option<String>,
    pub table_name: Option<String>,
    pub column_name: Option<String>,
    pub is_grantable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub user: String,
    pub host: String,
    pub password: String,
    pub plugin: Option<String>,
    pub max_connections: Option<u32>,
    pub max_user_connections: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantRequest {
    pub user: String,
    pub host: String,
    pub privileges: Vec<String>,
    pub database: Option<String>,
    pub table_name: Option<String>,
    pub with_grant_option: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevokeRequest {
    pub user: String,
    pub host: String,
    pub privileges: Vec<String>,
    pub database: Option<String>,
    pub table_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterUserRequest {
    pub password: Option<String>,
    pub account_locked: Option<bool>,
    pub password_expired: Option<bool>,
    pub max_connections: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicaStatus {
    pub slave_io_running: String,
    pub slave_sql_running: String,
    pub master_host: Option<String>,
    pub master_port: Option<u16>,
    pub master_user: Option<String>,
    pub master_log_file: Option<String>,
    pub read_master_log_pos: Option<u64>,
    pub relay_log_file: Option<String>,
    pub relay_log_pos: Option<u64>,
    pub exec_master_log_pos: Option<u64>,
    pub seconds_behind_master: Option<u64>,
    pub last_error: Option<String>,
    pub last_io_error: Option<String>,
    pub last_sql_error: Option<String>,
    pub gtid_slave_pos: Option<String>,
    pub auto_position: Option<bool>,
    pub channel_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimaryStatus {
    pub file: String,
    pub position: u64,
    pub binlog_do_db: Option<String>,
    pub binlog_ignore_db: Option<String>,
    pub executed_gtid_set: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogEvent {
    pub log_name: String,
    pub pos: u64,
    pub event_type: String,
    pub server_id: u64,
    pub end_log_pos: u64,
    pub info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupReplicaRequest {
    pub master_host: String,
    pub master_port: u16,
    pub master_user: String,
    pub master_password: String,
    pub master_log_file: Option<String>,
    pub master_log_pos: Option<u64>,
    pub auto_position: Option<bool>,
    pub channel_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GtidStatus {
    pub gtid_mode: String,
    pub gtid_executed: Option<String>,
    pub gtid_purged: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Performance
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowQuery {
    pub id: Option<u64>,
    pub start_time: Option<String>,
    pub user: Option<String>,
    pub host: Option<String>,
    pub db: Option<String>,
    pub query_time: Option<String>,
    pub lock_time: Option<String>,
    pub rows_sent: Option<u64>,
    pub rows_examined: Option<u64>,
    pub sql_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceDigest {
    pub schema_name: Option<String>,
    pub digest_text: String,
    pub count_star: u64,
    pub avg_timer_wait: Option<f64>,
    pub sum_rows_sent: Option<u64>,
    pub sum_rows_examined: Option<u64>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableIoStats {
    pub table_schema: String,
    pub table_name: String,
    pub count_read: Option<u64>,
    pub count_write: Option<u64>,
    pub count_fetch: Option<u64>,
    pub count_insert: Option<u64>,
    pub count_update: Option<u64>,
    pub count_delete: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    pub table_schema: String,
    pub table_name: String,
    pub index_name: String,
    pub count_read: Option<u64>,
    pub count_write: Option<u64>,
    pub avg_timer_wait: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaitStats {
    pub event_name: String,
    pub count_star: u64,
    pub sum_timer_wait: Option<f64>,
    pub avg_timer_wait: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// InnoDB
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbStatus {
    pub buffer_pool_size: Option<u64>,
    pub buffer_pool_pages_total: Option<u64>,
    pub buffer_pool_pages_data: Option<u64>,
    pub buffer_pool_pages_dirty: Option<u64>,
    pub buffer_pool_pages_free: Option<u64>,
    pub buffer_pool_read_requests: Option<u64>,
    pub buffer_pool_reads: Option<u64>,
    pub row_operations: Option<String>,
    pub log_sequence_number: Option<String>,
    pub log_flushed_up_to: Option<String>,
    pub pending_io: Option<String>,
    pub deadlock_count: Option<u64>,
    pub history_list_length: Option<u64>,
    pub transactions_active: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbBufferPoolStats {
    pub pool_id: Option<u64>,
    pub pool_size: Option<u64>,
    pub free_buffers: Option<u64>,
    pub database_pages: Option<u64>,
    pub old_database_pages: Option<u64>,
    pub modified_database_pages: Option<u64>,
    pub pending_decompress: Option<u64>,
    pub pending_reads: Option<u64>,
    pub pending_flush_lru: Option<u64>,
    pub pending_flush_list: Option<u64>,
    pub pages_made_young: Option<u64>,
    pub pages_not_made_young: Option<u64>,
    pub pages_read: Option<u64>,
    pub pages_created: Option<u64>,
    pub pages_written: Option<u64>,
    pub hit_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbLock {
    pub lock_id: String,
    pub lock_trx_id: String,
    pub lock_mode: String,
    pub lock_type: String,
    pub lock_table: String,
    pub lock_index: Option<String>,
    pub lock_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnodbTransaction {
    pub trx_id: String,
    pub trx_state: String,
    pub trx_started: Option<String>,
    pub trx_query: Option<String>,
    pub trx_rows_locked: Option<u64>,
    pub trx_rows_modified: Option<u64>,
    pub trx_lock_wait_started: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backup
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlBackupRequest {
    pub databases: Option<Vec<String>>,
    pub all_databases: Option<bool>,
    pub single_transaction: Option<bool>,
    pub routines: Option<bool>,
    pub triggers: Option<bool>,
    pub events: Option<bool>,
    pub add_drop_database: Option<bool>,
    pub compress: Option<bool>,
    pub output_path: String,
    pub max_allowed_packet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlRestoreRequest {
    pub input_path: String,
    pub database: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub output_path: String,
    pub size_bytes: Option<u64>,
    pub duration_secs: Option<f64>,
    pub tables_dumped: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Variables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlVariable {
    pub name: String,
    pub value: String,
    pub is_dynamic: Option<bool>,
    pub scope: Option<VariableScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VariableScope {
    Global,
    Session,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetVariableRequest {
    pub name: String,
    pub value: String,
    pub scope: Option<VariableScope>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlLogConfig {
    pub general_log: Option<bool>,
    pub general_log_file: Option<String>,
    pub slow_query_log: Option<bool>,
    pub slow_query_log_file: Option<String>,
    pub long_query_time: Option<f64>,
    pub log_queries_not_using_indexes: Option<bool>,
    pub error_log: Option<String>,
    pub binlog_format: Option<String>,
    pub expire_logs_days: Option<u32>,
    pub max_binlog_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryLog {
    pub log_name: String,
    pub file_size: u64,
    pub encrypted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorLogEntry {
    pub timestamp: Option<String>,
    pub thread_id: Option<u64>,
    pub severity: Option<String>,
    pub error_code: Option<String>,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlTable {
    pub table_schema: String,
    pub table_name: String,
    pub engine: Option<String>,
    pub row_format: Option<String>,
    pub table_rows: Option<u64>,
    pub avg_row_length: Option<u64>,
    pub data_length: Option<u64>,
    pub index_length: Option<u64>,
    pub auto_increment: Option<u64>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub table_collation: Option<String>,
    pub table_comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableIndex {
    pub table_name: String,
    pub index_name: String,
    pub non_unique: bool,
    pub seq_in_index: u32,
    pub column_name: String,
    pub cardinality: Option<u64>,
    pub index_type: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStatus {
    pub name: String,
    pub engine: Option<String>,
    pub version: Option<u32>,
    pub rows: Option<u64>,
    pub avg_row_length: Option<u64>,
    pub data_length: Option<u64>,
    pub index_length: Option<u64>,
    pub data_free: Option<u64>,
    pub auto_increment: Option<u64>,
    pub create_time: Option<String>,
    pub check_time: Option<String>,
    pub table_collation: Option<String>,
    pub checksum: Option<String>,
    pub create_options: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeTableResult {
    pub table: String,
    pub op: String,
    pub msg_type: String,
    pub msg_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizeTableResult {
    pub table: String,
    pub op: String,
    pub msg_type: String,
    pub msg_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckTableResult {
    pub table: String,
    pub op: String,
    pub msg_type: String,
    pub msg_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairTableResult {
    pub table: String,
    pub op: String,
    pub msg_type: String,
    pub msg_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKey {
    pub constraint_name: String,
    pub column_name: String,
    pub referenced_table_schema: String,
    pub referenced_table_name: String,
    pub referenced_column_name: String,
    pub update_rule: Option<String>,
    pub delete_rule: Option<String>,
}
