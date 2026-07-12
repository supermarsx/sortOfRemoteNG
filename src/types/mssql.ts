// Microsoft SQL Server integration types — 1:1 mirror of the Rust backend.
//
// Source of truth: src-tauri/crates/sorng-mssql/src/mssql/types.rs
//
// IMPORTANT: unlike most sorng crates, sorng-mssql's structs do NOT use
// `#[serde(rename_all = "camelCase")]`. Nested structs therefore cross the
// serde boundary with their Rust field names verbatim — i.e. **snake_case**.
// That applies to everything sent as a nested argument struct (`config`,
// `options`) and everything returned (`QueryResult`, `DatabaseInfo`, ...), so
// the field names below are snake_case on purpose.
//
// (Top-level `#[tauri::command]` parameters — `sessionId`, `whereClause`,
// `sqlContent`, ... — are a separate concern: Tauri maps camelCase JS arg keys
// to the snake_case Rust params. Those live in the hook, not here.)
//
// Rust enums map to string-literal unions or externally-tagged object unions,
// preserving the Rust variant names verbatim (no rename). `serde_json::Value`
// becomes `unknown`.

// ── Error ───────────────────────────────────────────────────────────

export type MssqlErrorKind =
  | "ConnectionFailed"
  | "AuthenticationFailed"
  | "QueryFailed"
  | "NotConnected"
  | "SessionNotFound"
  | "SessionExists"
  | "DatabaseNotFound"
  | "SchemaNotFound"
  | "TableNotFound"
  | "PermissionDenied"
  | "SshTunnelFailed"
  | "TlsError"
  | "Timeout"
  | "ExportFailed"
  | "ImportFailed"
  | "InvalidInput";

export interface MssqlError {
  kind: MssqlErrorKind;
  message: string;
}

// ── SSH / TLS ───────────────────────────────────────────────────────

export interface SshTunnelConfig {
  host: string;
  port: number;
  username: string;
  password?: string | null;
  private_key_path?: string | null;
  passphrase?: string | null;
}

export interface TlsConfig {
  trust_server_certificate: boolean;
  ca_cert_path?: string | null;
}

// ── Connection config ───────────────────────────────────────────────

/** Externally-tagged `MssqlAuthMethod`. `WindowsAuth` is a bare string; the
 *  credentialed variants are single-key objects keyed by the Rust variant name. */
export type MssqlAuthMethod =
  | { SqlAuth: { username: string; password: string } }
  | "WindowsAuth"
  | { AzureAd: { username: string; password: string } };

export interface MssqlConnectionConfig {
  host: string;
  port: number;
  auth: MssqlAuthMethod;
  database?: string | null;
  instance_name?: string | null;
  application_name?: string | null;
  connection_timeout_secs?: number | null;
  ssh_tunnel?: SshTunnelConfig | null;
  tls?: TlsConfig | null;
  encrypt?: boolean | null;
}

// ── Query result ────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type_name: string;
  ordinal: number;
}

/** A single row: column-name → JSON value. */
export type RowMap = Record<string, unknown>;

export interface QueryResult {
  columns: ColumnInfo[];
  rows: RowMap[];
  affected_rows: number;
  execution_time_ms: number;
}

// ── Schema introspection ────────────────────────────────────────────

export interface DatabaseInfo {
  name: string;
  state?: string | null;
  recovery_model?: string | null;
  compatibility_level?: number | null;
  collation?: string | null;
  size_mb?: number | null;
}

export interface SchemaInfo {
  name: string;
  owner?: string | null;
}

export interface TableInfo {
  name: string;
  schema: string;
  table_type: string;
  row_count?: number | null;
  total_size_kb?: number | null;
}

export interface ColumnDef {
  name: string;
  data_type: string;
  max_length?: number | null;
  precision?: number | null;
  scale?: number | null;
  is_nullable: boolean;
  is_identity: boolean;
  is_computed: boolean;
  default_value?: string | null;
  ordinal_position: number;
  collation?: string | null;
}

export interface IndexInfo {
  name: string;
  table_name: string;
  index_type: string;
  columns: string[];
  is_unique: boolean;
  is_primary_key: boolean;
  is_clustered: boolean;
  fill_factor?: number | null;
}

export interface ForeignKeyInfo {
  name: string;
  column: string;
  referenced_table: string;
  referenced_column: string;
  referenced_schema: string;
  on_update: string;
  on_delete: string;
}

export interface ViewInfo {
  name: string;
  schema: string;
  definition?: string | null;
  is_indexed: boolean;
}

export interface StoredProcInfo {
  name: string;
  schema: string;
  proc_type: string;
  definition?: string | null;
  created?: string | null;
  modified?: string | null;
}

export interface TriggerInfo {
  name: string;
  table_name: string;
  schema: string;
  trigger_type: string;
  is_enabled: boolean;
  definition?: string | null;
}

// ── Export / Import ─────────────────────────────────────────────────

export type ExportFormat = "Csv" | "Tsv" | "Sql" | "Json";

export interface ExportOptions {
  format: ExportFormat;
  include_headers: boolean;
  include_create: boolean;
  chunk_size: number;
}

export const defaultExportOptions = (): ExportOptions => ({
  format: "Csv",
  include_headers: true,
  include_create: true,
  chunk_size: 5000,
});

// ── Session / status ────────────────────────────────────────────────

/** Externally-tagged `ConnectionStatus`. The error variant is a single-key
 *  object; the others are bare strings. */
export type ConnectionStatus =
  | "Connected"
  | "Disconnected"
  | { Error: string };

export interface SessionInfo {
  id: string;
  host: string;
  port: number;
  database?: string | null;
  instance_name?: string | null;
  status: ConnectionStatus;
  server_version?: string | null;
  connected_at?: string | null;
  queries_executed: number;
  total_rows_fetched: number;
  via_ssh_tunnel: boolean;
}

// ── Admin ───────────────────────────────────────────────────────────

export interface ServerProperty {
  name: string;
  value?: string | null;
}

export interface SpWhoResult {
  spid: number;
  status?: string | null;
  login_name?: string | null;
  hostname?: string | null;
  database_name?: string | null;
  command?: string | null;
  program_name?: string | null;
}

export interface SqlLogin {
  name: string;
  login_type: string;
  is_disabled: boolean;
  default_database?: string | null;
  create_date?: string | null;
}
