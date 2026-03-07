//! Shared types for PostgreSQL server administration.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgConnectionConfig {
    /// SSH host
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// PostgreSQL user for psql commands
    pub pg_user: Option<String>,
    /// PostgreSQL password
    pub pg_password: Option<String>,
    /// PostgreSQL host (inside the SSH tunnel, default: 127.0.0.1)
    pub pg_host: Option<String>,
    /// PostgreSQL port (default: 5432)
    pub pg_port: Option<u16>,
    /// Default database (default: postgres)
    pub pg_database: Option<String>,
    /// PostgreSQL data directory (e.g. /var/lib/postgresql/15/main)
    pub data_dir: Option<String>,
    /// PostgreSQL config directory (e.g. /etc/postgresql/15/main)
    pub config_dir: Option<String>,
    /// Connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgConnectionSummary {
    pub host: String,
    pub version: String,
    pub uptime: String,
    pub databases_count: u64,
    pub roles_count: u64,
    pub cluster_size: String,
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
// Roles
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgRole {
    pub name: String,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub login: bool,
    pub replication: bool,
    pub inherit: bool,
    pub connection_limit: i32,
    pub password_valid_until: Option<String>,
    pub member_of: Vec<String>,
    pub config: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgDatabase {
    pub name: String,
    pub owner: String,
    pub encoding: String,
    pub collation: String,
    pub ctype: String,
    pub access_privileges: Option<String>,
    pub size_bytes: u64,
    pub tablespace: String,
    pub connection_limit: i32,
    pub is_template: bool,
    pub allow_connections: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// pg_hba.conf
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgHbaEntry {
    pub line_number: u32,
    pub entry_type: String,
    pub database: String,
    pub user: String,
    pub address: Option<String>,
    pub method: String,
    pub options: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgReplicationSlot {
    pub slot_name: String,
    pub plugin: Option<String>,
    pub slot_type: String,
    pub datoid: Option<String>,
    pub database: Option<String>,
    pub temporary: bool,
    pub active: bool,
    pub active_pid: Option<i32>,
    pub xmin: Option<String>,
    pub catalog_xmin: Option<String>,
    pub restart_lsn: Option<String>,
    pub confirmed_flush_lsn: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgReplicationStat {
    pub pid: i32,
    pub usename: String,
    pub application_name: String,
    pub client_addr: Option<String>,
    pub state: String,
    pub sent_lsn: Option<String>,
    pub write_lsn: Option<String>,
    pub flush_lsn: Option<String>,
    pub replay_lsn: Option<String>,
    pub write_lag: Option<String>,
    pub flush_lag: Option<String>,
    pub replay_lag: Option<String>,
    pub sync_state: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vacuum / Analyze
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgVacuumInfo {
    pub schemaname: String,
    pub relname: String,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub vacuum_count: u64,
    pub autovacuum_count: u64,
    pub last_analyze: Option<String>,
    pub last_autoanalyze: Option<String>,
    pub dead_tuples: u64,
    pub live_tuples: u64,
    pub n_mod_since_analyze: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extensions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgExtension {
    pub name: String,
    pub default_version: Option<String>,
    pub installed_version: Option<String>,
    pub schema: Option<String>,
    pub relocatable: bool,
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatDatabase {
    pub datname: String,
    pub numbackends: i32,
    pub xact_commit: u64,
    pub xact_rollback: u64,
    pub blks_read: u64,
    pub blks_hit: u64,
    pub tup_returned: u64,
    pub tup_fetched: u64,
    pub tup_inserted: u64,
    pub tup_updated: u64,
    pub tup_deleted: u64,
    pub conflicts: u64,
    pub temp_files: u64,
    pub temp_bytes: u64,
    pub deadlocks: u64,
    pub blk_read_time: f64,
    pub blk_write_time: f64,
    pub stats_reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatTable {
    pub schemaname: String,
    pub relname: String,
    pub seq_scan: u64,
    pub seq_tup_read: u64,
    pub idx_scan: Option<u64>,
    pub idx_tup_fetch: Option<u64>,
    pub n_tup_ins: u64,
    pub n_tup_upd: u64,
    pub n_tup_del: u64,
    pub n_tup_hot_upd: u64,
    pub n_live_tup: u64,
    pub n_dead_tup: u64,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgIndex {
    pub schemaname: String,
    pub tablename: String,
    pub indexname: String,
    pub indexdef: String,
    pub size_bytes: u64,
    pub idx_scan: u64,
    pub idx_tup_read: u64,
    pub idx_tup_fetch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgLock {
    pub locktype: String,
    pub database: Option<String>,
    pub relation: Option<String>,
    pub page: Option<i32>,
    pub tuple: Option<i32>,
    pub pid: i32,
    pub mode: String,
    pub granted: bool,
    pub waitstart: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSetting {
    pub name: String,
    pub setting: String,
    pub unit: Option<String>,
    pub category: String,
    pub short_desc: String,
    pub context: String,
    pub source: String,
    pub boot_val: Option<String>,
    pub reset_val: Option<String>,
    pub pending_restart: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAL
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgWalInfo {
    pub current_lsn: String,
    pub current_timeline: String,
    pub wal_level: String,
    pub archive_mode: String,
    pub archive_command: Option<String>,
    pub wal_segment_size: String,
    pub min_wal_size: String,
    pub max_wal_size: String,
    pub wal_keep_size: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tablespaces
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgTablespace {
    pub name: String,
    pub owner: String,
    pub location: String,
    pub size_bytes: u64,
    pub options: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSchema {
    pub name: String,
    pub owner: String,
    pub access_privileges: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backup
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBackupConfig {
    /// Format: custom, plain, directory, tar
    pub format: String,
    /// Specific databases to dump (empty = all)
    pub databases: Vec<String>,
    /// Output path on remote server
    pub output_path: String,
    /// Compression level (0-9)
    pub compress_level: Option<u32>,
    /// Number of parallel jobs
    pub jobs: Option<u32>,
    /// Verbose output
    pub verbose: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBackupResult {
    pub path: String,
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub databases: Vec<String>,
    pub format: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Activity / Connections
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgActivity {
    pub pid: i32,
    pub datname: Option<String>,
    pub usename: Option<String>,
    pub application_name: String,
    pub client_addr: Option<String>,
    pub state: Option<String>,
    pub query: Option<String>,
    pub backend_start: Option<String>,
    pub query_start: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
}
