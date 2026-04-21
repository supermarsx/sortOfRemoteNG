/**
 * TypeScript surface for the `sorng-postgres-admin` backend crate.
 *
 * Mirrors the Rust structs in
 * `src-tauri/crates/sorng-postgres-admin/src/types.rs`.
 *
 * The Rust types do NOT apply `#[serde(rename_all = "camelCase")]`, so
 * field names stay snake_case on the wire and are mirrored verbatim
 * here. `Option<T>` in Rust is optional (`?`) here.
 *
 * See also: `src/hooks/ops/usePostgresAdmin.ts` (thin invoke wrapper).
 */

// ── Connection ──────────────────────────────────────────────────────────────

export interface PgConnectionConfig {
  host: string;
  port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key?: string;
  pg_user?: string;
  pg_password?: string;
  pg_host?: string;
  pg_port?: number;
  pg_database?: string;
  data_dir?: string;
  config_dir?: string;
  timeout_secs?: number;
}

export interface PgConnectionSummary {
  host: string;
  version: string;
  uptime: string;
  databases_count: number;
  roles_count: number;
  cluster_size: string;
}

// ── SSH output ──────────────────────────────────────────────────────────────

export interface SshOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ── Roles ───────────────────────────────────────────────────────────────────

export interface PgRole {
  name: string;
  superuser: boolean;
  create_db: boolean;
  create_role: boolean;
  login: boolean;
  replication: boolean;
  inherit: boolean;
  connection_limit: number;
  password_valid_until?: string;
  member_of: string[];
  config: string[];
}

// ── Databases ───────────────────────────────────────────────────────────────

export interface PgDatabase {
  name: string;
  owner: string;
  encoding: string;
  collation: string;
  ctype: string;
  access_privileges?: string;
  size_bytes: number;
  tablespace: string;
  connection_limit: number;
  is_template: boolean;
  allow_connections: boolean;
}

// ── pg_hba.conf ─────────────────────────────────────────────────────────────

export interface PgHbaEntry {
  line_number: number;
  entry_type: string;
  database: string;
  user: string;
  address?: string;
  method: string;
  options?: string;
}

// ── Replication ─────────────────────────────────────────────────────────────

export interface PgReplicationSlot {
  slot_name: string;
  plugin?: string;
  slot_type: string;
  datoid?: string;
  database?: string;
  temporary: boolean;
  active: boolean;
  active_pid?: number;
  xmin?: string;
  catalog_xmin?: string;
  restart_lsn?: string;
  confirmed_flush_lsn?: string;
}

export interface PgReplicationStat {
  pid: number;
  usename: string;
  application_name: string;
  client_addr?: string;
  state: string;
  sent_lsn?: string;
  write_lsn?: string;
  flush_lsn?: string;
  replay_lsn?: string;
  write_lag?: string;
  flush_lag?: string;
  replay_lag?: string;
  sync_state: string;
}

// ── Vacuum / Analyze ────────────────────────────────────────────────────────

export interface PgVacuumInfo {
  schemaname: string;
  relname: string;
  last_vacuum?: string;
  last_autovacuum?: string;
  vacuum_count: number;
  autovacuum_count: number;
  last_analyze?: string;
  last_autoanalyze?: string;
  dead_tuples: number;
  live_tuples: number;
  n_mod_since_analyze: number;
}

// ── Extensions ──────────────────────────────────────────────────────────────

export interface PgExtension {
  name: string;
  default_version?: string;
  installed_version?: string;
  schema?: string;
  relocatable: boolean;
  comment?: string;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface PgStatDatabase {
  datname: string;
  numbackends: number;
  xact_commit: number;
  xact_rollback: number;
  blks_read: number;
  blks_hit: number;
  tup_returned: number;
  tup_fetched: number;
  tup_inserted: number;
  tup_updated: number;
  tup_deleted: number;
  conflicts: number;
  temp_files: number;
  temp_bytes: number;
  deadlocks: number;
  blk_read_time: number;
  blk_write_time: number;
  stats_reset?: string;
}

export interface PgStatTable {
  schemaname: string;
  relname: string;
  seq_scan: number;
  seq_tup_read: number;
  idx_scan?: number;
  idx_tup_fetch?: number;
  n_tup_ins: number;
  n_tup_upd: number;
  n_tup_del: number;
  n_tup_hot_upd: number;
  n_live_tup: number;
  n_dead_tup: number;
  last_vacuum?: string;
  last_autovacuum?: string;
}

export interface PgIndex {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
  size_bytes: number;
  idx_scan: number;
  idx_tup_read: number;
  idx_tup_fetch: number;
}

export interface PgLock {
  locktype: string;
  database?: string;
  relation?: string;
  page?: number;
  tuple?: number;
  pid: number;
  mode: string;
  granted: boolean;
  waitstart?: string;
}

export interface PgSetting {
  name: string;
  setting: string;
  unit?: string;
  category: string;
  short_desc: string;
  context: string;
  source: string;
  boot_val?: string;
  reset_val?: string;
  pending_restart: boolean;
}

// ── WAL ─────────────────────────────────────────────────────────────────────

export interface PgWalInfo {
  current_lsn: string;
  current_timeline: string;
  wal_level: string;
  archive_mode: string;
  archive_command?: string;
  wal_segment_size: string;
  min_wal_size: string;
  max_wal_size: string;
  wal_keep_size?: string;
}

// ── Tablespaces ─────────────────────────────────────────────────────────────

export interface PgTablespace {
  name: string;
  owner: string;
  location: string;
  size_bytes: number;
  options?: string;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

export interface PgSchema {
  name: string;
  owner: string;
  access_privileges?: string;
  description?: string;
}

// ── Backup ──────────────────────────────────────────────────────────────────

export interface PgBackupConfig {
  /** Format: custom, plain, directory, tar. */
  format: string;
  databases: string[];
  output_path: string;
  compress_level?: number;
  jobs?: number;
  verbose: boolean;
}

export interface PgBackupResult {
  path: string;
  size_bytes: number;
  duration_secs: number;
  databases: string[];
  format: string;
}

// ── Activity / Connections ──────────────────────────────────────────────────

export interface PgActivity {
  pid: number;
  datname?: string;
  usename?: string;
  application_name: string;
  client_addr?: string;
  state?: string;
  query?: string;
  backend_start?: string;
  query_start?: string;
  wait_event_type?: string;
  wait_event?: string;
}
