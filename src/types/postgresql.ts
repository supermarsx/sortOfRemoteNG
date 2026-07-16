/**
 * Renderer contracts for the direct `sorng-postgres` client.
 *
 * The Rust DTOs in `sorng-postgres/src/postgres/types.rs` do not use
 * `serde(rename_all)`, so nested config objects and returned records use
 * snake_case. Top-level Tauri command arguments remain camelCase.
 */

export type PostgreSQLSslMode =
  | "disable"
  | "allow"
  | "prefer"
  | "require"
  | "verify-ca"
  | "verify-full";

/** Frontend-only fields persisted on a PostgreSQL Connection. */
export interface PostgreSQLSavedConnectionOptions {
  postgresSslMode?: PostgreSQLSslMode;
  postgresCaCertificatePath?: string;
  postgresClientCertificatePath?: string;
  postgresClientKeyPath?: string;
  postgresConnectionTimeoutSecs?: number;
}

export interface PostgreSQLTlsConfig {
  require_ssl: boolean;
  ca_cert_path?: string | null;
  client_cert_path?: string | null;
  client_key_path?: string | null;
}

export interface PostgreSQLConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string | null;
  database?: string | null;
  application_name?: string | null;
  connection_timeout_secs?: number | null;
  /** Deliberately unused: the current backend does not consume this DTO. */
  ssh_tunnel?: null;
  /** Deliberately unused: TLS is wired through SQLx URL parameters instead. */
  tls?: PostgreSQLTlsConfig | null;
  extra_params?: Record<string, string> | null;
}

export interface PostgreSQLColumnInfo {
  name: string;
  type_name: string;
  ordinal: number;
}

export type PostgreSQLRow = Record<string, unknown>;

export interface PostgreSQLQueryResult {
  columns: PostgreSQLColumnInfo[];
  rows: PostgreSQLRow[];
  affected_rows: number;
  execution_time_ms: number;
}

export interface PostgreSQLDatabaseInfo {
  name: string;
  owner?: string | null;
  encoding?: string | null;
  collation?: string | null;
  size_bytes?: number | null;
}

export interface PostgreSQLSchemaInfo {
  name: string;
  owner?: string | null;
}

export interface PostgreSQLTableInfo {
  name: string;
  schema: string;
  table_type: string;
  estimated_rows?: number | null;
  total_size?: string | null;
  comment?: string | null;
}

export interface PostgreSQLColumnDef {
  name: string;
  data_type: string;
  udt_name: string;
  is_nullable: boolean;
  column_default?: string | null;
  character_maximum_length?: number | null;
  numeric_precision?: number | null;
  ordinal_position: number;
  is_identity: boolean;
  comment?: string | null;
}

export type PostgreSQLConnectionStatus =
  | "Connected"
  | "Disconnected"
  | { Error: string };

export interface PostgreSQLSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  database?: string | null;
  status: PostgreSQLConnectionStatus;
  server_version?: string | null;
  connected_at?: string | null;
  queries_executed: number;
  total_rows_fetched: number;
  via_ssh_tunnel: boolean;
}

export type PostgreSQLExecutionMode = "query" | "statement";

export const POSTGRESQL_RUNTIME_CAPABILITIES = Object.freeze({
  directConnection: true,
  executeQuery: true,
  executeStatement: true,
  databaseBrowse: true,
  schemaBrowse: true,
  tableBrowse: true,
  describeTable: true,
  explicitSslMode: true,
  customCaCertificate: true,
  mutualTls: true,
  proxyRouting: false,
  vpnRouting: false,
  sshTunnel: false,
  databaseSwitchInPlace: false,
} as const);
