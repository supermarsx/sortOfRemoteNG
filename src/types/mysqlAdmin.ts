// MySQL/MariaDB Admin — TypeScript mirrors of
// `src-tauri/crates/sorng-mysql-admin/src/types.rs`.
//
// Field names match the Rust structs as serialised by serde (default =
// the Rust identifier). The backend does not apply `rename_all`, so we
// keep snake_case here to match the wire format.

export interface MysqlConnectionConfig {
  host: string;
  port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key?: string;
  mysql_user?: string;
  mysql_password?: string;
  mysql_host?: string;
  mysql_port?: number;
  mysql_socket?: string;
  timeout_secs?: number;
}

export interface MysqlConnectionSummary {
  host: string;
  version: string;
  uptime: number;
  databases_count: number;
  threads_connected: number;
}

export interface SshOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface MysqlUser {
  user: string;
  host: string;
  plugin: string;
  account_locked: boolean;
  password_expired: boolean;
  max_connections: number;
  ssl_type: string;
}

export interface MysqlGrant {
  user: string;
  host: string;
  privilege: string;
  database: string;
  table_name: string;
  is_grantable: boolean;
}

export interface MysqlDatabase {
  name: string;
  character_set: string;
  collation: string;
  size_bytes: number;
  tables_count: number;
}

export interface MysqlTable {
  name: string;
  engine: string;
  row_format: string;
  rows: number;
  data_length: number;
  index_length: number;
  auto_increment?: number;
  create_time: string;
  update_time?: string;
  collation: string;
}

export interface MysqlColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default?: string;
  character_set?: string;
  collation?: string;
  column_key: string;
  extra: string;
}

export interface MysqlIndex {
  name: string;
  table_name: string;
  non_unique: boolean;
  columns: string[];
  index_type: string;
  comment: string;
}

export interface ReplicationStatus {
  role: string;
  master_host?: string;
  master_port?: number;
  slave_io_running?: string;
  slave_sql_running?: string;
  seconds_behind_master?: number;
  last_error?: string;
  gtid_executed?: string;
  read_master_log_pos?: number;
  exec_master_log_pos?: number;
  relay_log_file?: string;
}

export interface ReplicationConfig {
  server_id: number;
  log_bin: boolean;
  binlog_format: string;
  gtid_mode?: string;
  enforce_gtid_consistency?: string;
  replicate_do_db: string[];
  replicate_ignore_db: string[];
}

export interface SlowQueryEntry {
  query_time: number;
  lock_time: number;
  rows_sent: number;
  rows_examined: number;
  timestamp: string;
  user: string;
  host: string;
  db: string;
  sql_text: string;
}

export interface InnodbStatus {
  buffer_pool_size: number;
  buffer_pool_free: number;
  buffer_pool_dirty: number;
  buffer_pool_hit_rate: number;
  log_sequence_number: number;
  log_flushed_up_to: number;
  pages_created: number;
  pages_read: number;
  pages_written: number;
  rows_inserted: number;
  rows_updated: number;
  rows_deleted: number;
  rows_read: number;
  deadlocks: number;
  pending_io_reads: number;
  pending_io_writes: number;
}

export interface MysqlVariable {
  name: string;
  value: string;
  is_global: boolean;
  is_session: boolean;
}

export interface MysqlProcess {
  id: number;
  user: string;
  host: string;
  db?: string;
  command: string;
  time: number;
  state: string;
  info?: string;
}

export interface BinlogFile {
  name: string;
  size: number;
  encrypted: boolean;
}

export interface BinlogEvent {
  log_name: string;
  pos: number;
  event_type: string;
  server_id: number;
  end_log_pos: number;
  info: string;
}

export interface BackupConfig {
  databases: string[];
  output_path: string;
  compress: boolean;
  single_transaction: boolean;
  routines: boolean;
  triggers: boolean;
  events: boolean;
}

export interface BackupResult {
  path: string;
  size_bytes: number;
  duration_secs: number;
  databases: string[];
}
