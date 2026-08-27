/**
 * Renderer contracts for the per-session `sorng-mysql` client (MySQL and
 * MariaDB share one engine, one protocol id, and one command surface).
 *
 * The Rust DTOs in `sorng-mysql/src/mysql/types.rs` do not use
 * `serde(rename_all)`, so nested config objects and returned records use
 * snake_case. Top-level Tauri command arguments remain camelCase.
 */

/** TLS posture selected in the connection editor (`connection.mysqlTls`). */
export type MysqlTlsMode =
  | "disabled"
  | "preferred"
  | "required"
  | "verify-ca"
  | "verify-identity";

export interface MysqlSavedTlsOptions {
  mode?: MysqlTlsMode;
  caPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
}

/** Icon/label hint chosen before the first connect; detection wins after. */
export type MysqlDialectHint = "auto" | "mysql" | "mariadb";

/**
 * Frontend-only fields persisted on a MySQL/MariaDB Connection. The registry
 * owner adds these to `Connection`; the client reads them optionally.
 */
export interface MysqlSavedConnectionOptions {
  mysqlTls?: MysqlSavedTlsOptions;
  mysqlDialectHint?: MysqlDialectHint;
  mysqlConnectionTimeoutSecs?: number;
}

/** Mirrors `TlsConfig`. `verify_hostname` upgrades Verify CA to Verify Identity. */
export interface MysqlTlsConfig {
  enabled: boolean;
  ca_cert?: string | null;
  client_cert?: string | null;
  client_key?: string | null;
  skip_verify: boolean;
  verify_hostname: boolean;
}

/** Mirrors `MysqlConnectionConfig`. */
export interface MysqlConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string | null;
  /** Always null: SSH tunnelling fails closed for database sessions. */
  ssh_tunnel: null;
  tls?: MysqlTlsConfig | null;
  max_connections?: number | null;
  connect_timeout_secs?: number | null;
  idle_timeout_secs?: number | null;
  charset?: string | null;
  timezone?: string | null;
}

export interface MysqlColumnInfo {
  name: string;
  ordinal: number;
  data_type: string;
  is_nullable: boolean;
  max_length?: number | null;
}

/** Rows are positional and aligned with `columns`. */
export type MysqlRow = unknown[];

export interface MysqlQueryResult {
  columns: MysqlColumnInfo[];
  rows: MysqlRow[];
  row_count: number;
  affected_rows: number;
  last_insert_id?: number | null;
  execution_time_ms: number;
  warnings: string[];
}

export interface MysqlDatabaseInfo {
  name: string;
  character_set?: string | null;
  collation?: string | null;
  table_count?: number | null;
}

export interface MysqlTableInfo {
  name: string;
  engine?: string | null;
  row_count?: number | null;
  data_length?: number | null;
  index_length?: number | null;
  auto_increment?: number | null;
  create_time?: string | null;
  update_time?: string | null;
  collation?: string | null;
  comment?: string | null;
}

export interface MysqlColumnDef {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default?: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
  is_auto_increment: boolean;
  character_set?: string | null;
  collation?: string | null;
  ordinal_position: number;
  extra: string;
  comment?: string | null;
}

export interface MysqlIndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface MysqlForeignKeyInfo {
  name: string;
  column: string;
  referenced_table: string;
  referenced_column: string;
  on_update: string;
  on_delete: string;
}

export interface MysqlViewInfo {
  name: string;
  definition?: string | null;
  definer: string;
  is_updatable: boolean;
}

export interface MysqlRoutineInfo {
  name: string;
  routine_type: string;
  definer: string;
  created?: string | null;
  modified?: string | null;
  body?: string | null;
}

export interface MysqlTriggerInfo {
  name: string;
  event: string;
  table: string;
  timing: string;
  statement: string;
}

export interface MysqlExplainRow {
  id?: number | null;
  select_type?: string | null;
  table?: string | null;
  partitions?: string | null;
  access_type?: string | null;
  possible_keys?: string | null;
  key?: string | null;
  key_len?: string | null;
  ref_col?: string | null;
  rows?: number | null;
  filtered?: number | null;
  extra?: string | null;
}

export interface MysqlProcessInfo {
  id: number;
  user: string;
  host: string;
  db?: string | null;
  command: string;
  time: number;
  state?: string | null;
  info?: string | null;
}

export interface MysqlServerVariable {
  name: string;
  value: string;
}

export type MysqlExportFormat = "Csv" | "Sql" | "Json" | "Tsv";

export interface MysqlExportOptions {
  format: MysqlExportFormat;
  include_schema: boolean;
  include_data: boolean;
  chunk_size: number;
  max_chunks: number;
  where_clause?: string | null;
  tables?: string[] | null;
}

export type MysqlConnectionStatus =
  | "Connected"
  | "Connecting"
  | "Disconnected"
  | { Error: string };

export type MysqlDialect = "mysql" | "mariadb";

/** Mirrors `SessionInfo`; `dialect` is present once the backend reports it. */
export interface MysqlSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  database?: string | null;
  status: MysqlConnectionStatus;
  server_version?: string | null;
  server_charset?: string | null;
  connected_at?: string | null;
  via_ssh_tunnel: boolean;
  tls_enabled: boolean;
  queries_executed: number;
  total_rows_fetched: number;
  dialect?: string | null;
}

/** Result of `mysql_server_info`. */
export interface MysqlServerInfo {
  dialect: string;
  server_version: string;
  tls_enabled: boolean;
}

export type MysqlExecutionMode = "query" | "statement";

/** Client-side result window; larger sets are revealed in steps. */
export const MYSQL_RESULT_PAGE_SIZE = 1000;

export const MYSQL_RUNTIME_CAPABILITIES = Object.freeze({
  directConnection: true,
  perSessionIsolation: true,
  executeQuery: true,
  executeStatement: true,
  explain: true,
  databaseBrowse: true,
  tableBrowse: true,
  describeTable: true,
  indexBrowse: true,
  foreignKeyBrowse: true,
  processList: true,
  explicitTlsMode: true,
  customCaCertificate: true,
  mutualTls: true,
  mariadbDialect: true,
  proxyRouting: false,
  vpnRouting: false,
  sshTunnel: false,
} as const);
