//! Shared types for PostgreSQL server administration.

use serde::{Deserialize, Serialize};

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
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub pg_user: Option<String>,
    pub pg_password: Option<String>,
    pub pg_database: Option<String>,
    pub pg_config_dir: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub cluster_name: Option<String>,
    pub data_directory: Option<String>,
    pub databases_count: u32,
    pub is_standby: bool,
    pub wal_level: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgServerStatus {
    pub version: String,
    pub uptime: String,
    pub max_connections: i32,
    pub active_connections: i32,
    pub idle_connections: i32,
    pub waiting_connections: i32,
    pub databases: i32,
    pub total_size_bytes: i64,
    pub cache_hit_ratio: f64,
    pub commit_ratio: f64,
    pub deadlocks: i64,
    pub checkpoints: i64,
    pub bgwriter_stats: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSetting {
    pub name: String,
    pub setting: String,
    pub unit: Option<String>,
    pub category: String,
    pub short_desc: String,
    pub context: String,
    pub vartype: String,
    pub source: String,
    pub min_val: Option<String>,
    pub max_val: Option<String>,
    pub boot_val: Option<String>,
    pub reset_val: Option<String>,
    pub pending_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBackendProcess {
    pub pid: i32,
    pub usename: Option<String>,
    pub datname: Option<String>,
    pub application_name: Option<String>,
    pub client_addr: Option<String>,
    pub client_port: Option<i32>,
    pub backend_start: Option<String>,
    pub xact_start: Option<String>,
    pub query_start: Option<String>,
    pub state_change: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    pub state: Option<String>,
    pub query: Option<String>,
    pub backend_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgLock {
    pub locktype: String,
    pub database: Option<String>,
    pub relation: Option<String>,
    pub page: Option<i32>,
    pub tuple: Option<i16>,
    pub virtualxid: Option<String>,
    pub transactionid: Option<String>,
    pub classid: Option<String>,
    pub objid: Option<String>,
    pub objsubid: Option<i16>,
    pub virtualtransaction: Option<String>,
    pub pid: Option<i32>,
    pub mode: String,
    pub granted: bool,
    pub fastpath: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgDatabase {
    pub oid: u32,
    pub datname: String,
    pub datdba: String,
    pub encoding: String,
    pub datcollate: String,
    pub datctype: String,
    pub datistemplate: bool,
    pub datallowconn: bool,
    pub datconnlimit: i32,
    pub datlastsysoid: Option<u32>,
    pub datfrozenxid: Option<String>,
    pub datminmxid: Option<String>,
    pub dattablespace: String,
    pub size_bytes: i64,
    pub num_backends: i32,
    pub xact_commit: i64,
    pub xact_rollback: i64,
    pub blks_read: i64,
    pub blks_hit: i64,
    pub tup_returned: i64,
    pub tup_fetched: i64,
    pub tup_inserted: i64,
    pub tup_updated: i64,
    pub tup_deleted: i64,
    pub conflicts: i64,
    pub temp_files: i64,
    pub temp_bytes: i64,
    pub deadlocks: i64,
    pub stats_reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDatabaseRequest {
    pub name: String,
    pub owner: Option<String>,
    pub encoding: Option<String>,
    pub template: Option<String>,
    pub tablespace: Option<String>,
    pub connection_limit: Option<i32>,
    pub is_template: Option<bool>,
    pub locale: Option<String>,
    pub lc_collate: Option<String>,
    pub lc_ctype: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterDatabaseRequest {
    pub owner: Option<String>,
    pub connection_limit: Option<i32>,
    pub is_template: Option<bool>,
    pub tablespace: Option<String>,
    pub allow_connections: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Roles
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgRole {
    pub oid: u32,
    pub rolname: String,
    pub rolsuper: bool,
    pub rolinherit: bool,
    pub rolcreaterole: bool,
    pub rolcreatedb: bool,
    pub rolcanlogin: bool,
    pub rolreplication: bool,
    pub rolbypassrls: bool,
    pub rolconnlimit: i32,
    pub rolvaliduntil: Option<String>,
    pub memberof: Vec<String>,
    pub config: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleRequest {
    pub rolname: String,
    pub password: Option<String>,
    pub superuser: Option<bool>,
    pub createdb: Option<bool>,
    pub createrole: Option<bool>,
    pub inherit: Option<bool>,
    pub login: Option<bool>,
    pub replication: Option<bool>,
    pub bypassrls: Option<bool>,
    pub connection_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub in_roles: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterRoleRequest {
    pub superuser: Option<bool>,
    pub createdb: Option<bool>,
    pub createrole: Option<bool>,
    pub inherit: Option<bool>,
    pub login: Option<bool>,
    pub replication: Option<bool>,
    pub bypassrls: Option<bool>,
    pub connection_limit: Option<i32>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantRoleRequest {
    pub role: String,
    pub member: String,
    pub with_admin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevokeRoleRequest {
    pub role: String,
    pub member: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgPrivilege {
    pub grantee: String,
    pub table_catalog: Option<String>,
    pub table_schema: Option<String>,
    pub table_name: Option<String>,
    pub privilege_type: String,
    pub is_grantable: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgReplicationSlot {
    pub slot_name: String,
    pub plugin: Option<String>,
    pub slot_type: String,
    pub datoid: Option<u32>,
    pub database: Option<String>,
    pub temporary: bool,
    pub active: bool,
    pub active_pid: Option<i32>,
    pub xmin: Option<String>,
    pub catalog_xmin: Option<String>,
    pub restart_lsn: Option<String>,
    pub confirmed_flush_lsn: Option<String>,
    pub wal_status: Option<String>,
    pub safe_wal_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStandbyInfo {
    pub pid: i32,
    pub usesysid: Option<u32>,
    pub usename: Option<String>,
    pub application_name: Option<String>,
    pub client_addr: Option<String>,
    pub client_hostname: Option<String>,
    pub client_port: Option<i32>,
    pub backend_start: Option<String>,
    pub state: Option<String>,
    pub sent_lsn: Option<String>,
    pub write_lsn: Option<String>,
    pub flush_lsn: Option<String>,
    pub replay_lsn: Option<String>,
    pub write_lag: Option<String>,
    pub flush_lag: Option<String>,
    pub replay_lag: Option<String>,
    pub sync_priority: Option<i32>,
    pub sync_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgWalStatus {
    pub current_lsn: Option<String>,
    pub current_timeline: Option<i32>,
    pub wal_level: Option<String>,
    pub archive_mode: Option<String>,
    pub archive_command: Option<String>,
    pub archive_library: Option<String>,
    pub last_archived_wal: Option<String>,
    pub last_archived_time: Option<String>,
    pub last_failed_wal: Option<String>,
    pub last_failed_time: Option<String>,
    pub stats_reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReplicationSlotRequest {
    pub slot_name: String,
    pub slot_type: String,
    pub plugin: Option<String>,
    pub temporary: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgPublicationInfo {
    pub pubname: String,
    pub pubowner: String,
    pub puballtables: bool,
    pub pubinsert: bool,
    pub pubupdate: bool,
    pub pubdelete: bool,
    pub pubtruncate: bool,
    pub pubviaroot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSubscriptionInfo {
    pub subname: String,
    pub subowner: String,
    pub subenabled: bool,
    pub subconninfo: String,
    pub subslotname: Option<String>,
    pub subsynccommit: String,
    pub subpublications: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Performance
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatUserTable {
    pub schemaname: String,
    pub relname: String,
    pub seq_scan: i64,
    pub seq_tup_read: i64,
    pub idx_scan: Option<i64>,
    pub idx_tup_fetch: Option<i64>,
    pub n_tup_ins: i64,
    pub n_tup_upd: i64,
    pub n_tup_del: i64,
    pub n_tup_hot_upd: i64,
    pub n_live_tup: i64,
    pub n_dead_tup: i64,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub last_analyze: Option<String>,
    pub last_autoanalyze: Option<String>,
    pub vacuum_count: i64,
    pub autovacuum_count: i64,
    pub analyze_count: i64,
    pub autoanalyze_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatUserIndex {
    pub schemaname: String,
    pub relname: String,
    pub indexrelname: String,
    pub idx_scan: i64,
    pub idx_tup_read: i64,
    pub idx_tup_fetch: i64,
    pub idx_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatIo {
    pub backend_type: String,
    pub object: String,
    pub context: String,
    pub reads: i64,
    pub read_time: f64,
    pub writes: i64,
    pub write_time: f64,
    pub writebacks: i64,
    pub writeback_time: f64,
    pub extends: i64,
    pub extend_time: f64,
    pub hits: i64,
    pub evictions: i64,
    pub reuses: i64,
    pub fsyncs: i64,
    pub fsync_time: f64,
    pub stats_reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBufferCacheStats {
    pub buffers_used: i64,
    pub buffers_unused: i64,
    pub buffers_dirty: i64,
    pub buffers_pinned: i64,
    pub total_buffers: i64,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgQueryStats {
    pub queryid: Option<String>,
    pub query: String,
    pub calls: i64,
    pub total_exec_time: f64,
    pub mean_exec_time: f64,
    pub min_exec_time: f64,
    pub max_exec_time: f64,
    pub rows: i64,
    pub shared_blks_hit: i64,
    pub shared_blks_read: i64,
    pub shared_blks_written: i64,
    pub temp_blks_read: i64,
    pub temp_blks_written: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexBloatInfo {
    pub schemaname: String,
    pub relname: String,
    pub indexrelname: String,
    pub real_size: i64,
    pub bloat_size: i64,
    pub bloat_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBloatInfo {
    pub schemaname: String,
    pub relname: String,
    pub real_size: i64,
    pub bloat_size: i64,
    pub bloat_ratio: f64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vacuum
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacuumStats {
    pub relname: String,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub last_analyze: Option<String>,
    pub last_autoanalyze: Option<String>,
    pub n_dead_tup: i64,
    pub n_live_tup: i64,
    pub autovacuum_count: i64,
    pub vacuum_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacuumRequest {
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table_name: Option<String>,
    pub full: Option<bool>,
    pub analyze: Option<bool>,
    pub freeze: Option<bool>,
    pub verbose: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutovacuumConfig {
    pub autovacuum: bool,
    pub autovacuum_naptime: String,
    pub autovacuum_vacuum_threshold: i32,
    pub autovacuum_vacuum_scale_factor: f64,
    pub autovacuum_analyze_threshold: i32,
    pub autovacuum_analyze_scale_factor: f64,
    pub autovacuum_freeze_max_age: i64,
    pub autovacuum_max_workers: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacuumProgress {
    pub pid: i32,
    pub datname: String,
    pub relname: String,
    pub phase: String,
    pub heap_blks_total: i64,
    pub heap_blks_scanned: i64,
    pub heap_blks_vacuumed: i64,
    pub index_vacuum_count: i64,
    pub max_dead_tuples: i64,
    pub num_dead_tuples: i64,
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
    pub description: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableExtension {
    pub name: String,
    pub default_version: String,
    pub installed_version: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateExtensionRequest {
    pub name: String,
    pub schema: Option<String>,
    pub version: Option<String>,
    pub cascade: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterExtensionRequest {
    pub schema: Option<String>,
    pub version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backup
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PgDumpFormat {
    Custom,
    Directory,
    Tar,
    Plain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBackupRequest {
    pub format: PgDumpFormat,
    pub database: String,
    pub schema: Option<String>,
    pub tables: Option<Vec<String>>,
    pub compress: Option<i32>,
    pub jobs: Option<i32>,
    pub output_path: String,
    pub custom_options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgRestoreRequest {
    pub format: PgDumpFormat,
    pub database: String,
    pub input_path: String,
    pub clean: Option<bool>,
    pub create: Option<bool>,
    pub jobs: Option<i32>,
    pub no_owner: Option<bool>,
    pub no_privileges: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgBasebackupRequest {
    pub output_dir: String,
    pub format: Option<String>,
    pub checkpoint: Option<String>,
    pub wal_method: Option<String>,
    pub compress: Option<String>,
    pub label: Option<String>,
    pub progress: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub output_path: String,
    pub size_bytes: Option<i64>,
    pub duration_secs: Option<f64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitrInfo {
    pub wal_level: String,
    pub archive_mode: String,
    pub archive_command: Option<String>,
    pub restore_command: Option<String>,
    pub recovery_target_time: Option<String>,
    pub recovery_target_lsn: Option<String>,
    pub recovery_target_name: Option<String>,
    pub min_recovery_end_lsn: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HBA
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HbaType {
    Local,
    Host,
    Hostssl,
    Hostnossl,
    Hostgssenc,
    Hostnogssenc,
}

impl std::fmt::Display for HbaType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::Host => write!(f, "host"),
            Self::Hostssl => write!(f, "hostssl"),
            Self::Hostnossl => write!(f, "hostnossl"),
            Self::Hostgssenc => write!(f, "hostgssenc"),
            Self::Hostnogssenc => write!(f, "hostnogssenc"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgHbaEntry {
    pub type_: HbaType,
    pub database: String,
    pub user: String,
    pub address: Option<String>,
    pub auth_method: String,
    pub options: Option<String>,
    pub line_number: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddHbaEntryRequest {
    pub type_: HbaType,
    pub database: String,
    pub user: String,
    pub address: Option<String>,
    pub auth_method: String,
    pub options: Option<String>,
    pub position: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgIdentMap {
    pub map_name: String,
    pub system_username: String,
    pub pg_username: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tablespaces
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgTablespace {
    pub spcname: String,
    pub spcowner: String,
    pub spclocation: String,
    pub size_bytes: i64,
    pub spcacl: Option<String>,
    pub spcoptions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTablespaceRequest {
    pub name: String,
    pub location: String,
    pub owner: Option<String>,
    pub options: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSchema {
    pub schema_name: String,
    pub schema_owner: String,
    pub tables_count: i32,
    pub views_count: i32,
    pub functions_count: i32,
    pub default_acl: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSchemaRequest {
    pub name: String,
    pub owner: Option<String>,
    pub if_not_exists: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgLogConfig {
    pub log_destination: String,
    pub logging_collector: bool,
    pub log_directory: String,
    pub log_filename: String,
    pub log_rotation_age: String,
    pub log_rotation_size: String,
    pub log_min_duration_statement: String,
    pub log_min_messages: String,
    pub log_statement: String,
    pub log_line_prefix: String,
    pub log_checkpoints: bool,
    pub log_connections: bool,
    pub log_disconnections: bool,
    pub log_lock_waits: bool,
    pub log_temp_files: String,
    pub log_autovacuum_min_duration: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgLogEntry {
    pub timestamp: Option<String>,
    pub user: Option<String>,
    pub database: Option<String>,
    pub pid: Option<i32>,
    pub log_level: String,
    pub message: String,
    pub detail: Option<String>,
    pub hint: Option<String>,
    pub query: Option<String>,
    pub location: Option<String>,
}
