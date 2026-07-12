// TypeScript mirror of the sorng-haproxy crate types.
//
// Source: src-tauri/crates/sorng-haproxy/src/types.rs
//
// SERDE CONVENTION: the HAProxy structs carry NO `#[serde(rename_all)]`, so
// their wire shape is the Rust field names verbatim — snake_case (`ssh_user`,
// `stats_socket`, `dataplane_url`, `current_sessions`, ...). These interfaces
// therefore use snake_case keys and are passed to `invoke(...)` as-is (same
// convention as src/types/mssql.ts). The ONE enum with an explicit rename,
// `ServerAction`, is `snake_case`, so its string-literal union uses snake_case
// too. Top-level command params (id, name, backend, aclId, mapId, ...) are
// camelCase — Tauri v2 maps them to the snake_case Rust params.

// ═══════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════

export interface HaproxyConnectionConfig {
  /** SSH host for remote management. */
  host: string;
  port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key?: string;
  /** Stats socket path (e.g. /var/run/haproxy/admin.sock). */
  stats_socket?: string;
  /** Stats HTTP URL (e.g. http://host:8404/stats). */
  stats_url?: string;
  stats_user?: string;
  stats_password?: string;
  /** HAProxy Data-plane API URL (e.g. http://host:5555). */
  dataplane_url?: string;
  dataplane_user?: string;
  dataplane_password?: string;
  /** Config file path (default: /etc/haproxy/haproxy.cfg). */
  config_path?: string;
  timeout_secs?: number;
}

export interface HaproxyConnectionSummary {
  host: string;
  version?: string;
  node_name?: string;
  release_date?: string;
  uptime_secs?: number;
  process_num?: number;
  pid?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Server Info
// ═══════════════════════════════════════════════════════════════════════════

export interface HaproxyInfo {
  name?: string;
  version: string;
  release_date?: string;
  nbthread?: number;
  nbproc?: number;
  process_num?: number;
  pid: number;
  uptime?: string;
  uptime_sec?: number;
  mem_max_mb?: number;
  pool_alloc_mb?: number;
  pool_used_mb?: number;
  pool_failed?: number;
  ulimit_n?: number;
  maxsock?: number;
  maxconn?: number;
  hard_maxconn?: number;
  curr_conns?: number;
  cum_conns?: number;
  cum_req?: number;
  max_ssl_conns?: number;
  curr_ssl_conns?: number;
  cum_ssl_conns?: number;
  maxpipes?: number;
  pipes_used?: number;
  pipes_free?: number;
  conn_rate?: number;
  conn_rate_limit?: number;
  max_conn_rate?: number;
  sess_rate?: number;
  sess_rate_limit?: number;
  max_sess_rate?: number;
  ssl_rate?: number;
  ssl_rate_limit?: number;
  max_ssl_rate?: number;
  ssl_frontend_key_rate?: number;
  ssl_frontend_max_key_rate?: number;
  ssl_frontend_session_reuse?: number;
  ssl_backend_key_rate?: number;
  ssl_backend_max_key_rate?: number;
  ssl_cache_usage?: number;
  ssl_cache_misses?: number;
  compress_bps_in?: number;
  compress_bps_out?: number;
  compress_bps_rate_lim?: number;
  tasks?: number;
  run_queue?: number;
  idle_pct?: number;
  node?: string;
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Frontends & Backends
// ═══════════════════════════════════════════════════════════════════════════

export interface HttpResponses {
  http_1xx: number;
  http_2xx: number;
  http_3xx: number;
  http_4xx: number;
  http_5xx: number;
  http_other: number;
}

export interface HaproxyFrontend {
  name: string;
  status: string;
  current_sessions: number;
  max_sessions: number;
  session_limit: number;
  total_sessions: number;
  bytes_in: number;
  bytes_out: number;
  denied_requests: number;
  denied_responses: number;
  request_errors: number;
  request_rate: number;
  request_rate_max: number;
  request_total: number;
  connection_rate: number;
  connection_rate_max: number;
  connection_total: number;
  http_responses: HttpResponses;
  mode?: string;
  bind?: string[];
}

export interface HaproxyBackend {
  name: string;
  status: string;
  current_sessions: number;
  max_sessions: number;
  total_sessions: number;
  bytes_in: number;
  bytes_out: number;
  denied_requests: number;
  denied_responses: number;
  connection_errors: number;
  response_errors: number;
  retry_warnings: number;
  redispatch_warnings: number;
  request_total: number;
  http_responses: HttpResponses;
  active_servers: number;
  backup_servers: number;
  check_down: number;
  last_change: number;
  downtime: number;
  queue_current: number;
  queue_max: number;
  balance_algorithm?: string;
  mode?: string;
  servers: HaproxyServer[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Servers
// ═══════════════════════════════════════════════════════════════════════════

export interface HaproxyServer {
  name: string;
  backend: string;
  address: string;
  port?: number;
  status: string;
  weight: number;
  current_sessions: number;
  max_sessions: number;
  total_sessions: number;
  bytes_in: number;
  bytes_out: number;
  connection_errors: number;
  response_errors: number;
  retry_warnings: number;
  redispatch_warnings: number;
  check_status?: string;
  check_code?: number;
  check_duration?: number;
  last_change: number;
  downtime: number;
  queue_current: number;
  queue_max: number;
  throttle?: number;
  agent_status?: string;
  active: boolean;
  backup: boolean;
}

export interface SoketServerAction {
  backend: string;
  server: string;
  action: ServerAction;
  weight?: number;
  address?: string;
  port?: number;
}

/** `#[serde(rename_all = "snake_case")]` enum. */
export type ServerAction =
  | "enable"
  | "disable"
  | "drain"
  | "maint"
  | "ready"
  | "set_weight"
  | "set_addr"
  | "agent_up"
  | "agent_down";

// ═══════════════════════════════════════════════════════════════════════════
// ACLs & Maps
// ═══════════════════════════════════════════════════════════════════════════

export interface AclEntry {
  id: number;
  value: string;
}

export interface HaproxyAcl {
  id: string;
  description?: string;
  entries: AclEntry[];
}

export interface MapEntry {
  id: number;
  key: string;
  value: string;
}

export interface HaproxyMap {
  id: string;
  description?: string;
  entries: MapEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Stick Tables
// ═══════════════════════════════════════════════════════════════════════════

export interface StickTableEntry {
  key: string;
  use_count: number;
  expiry_ms?: number;
  data: Record<string, unknown>;
}

export interface StickTable {
  name: string;
  table_type: string;
  size: number;
  used: number;
  data_types: string[];
  entries: StickTableEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfigDirective {
  keyword: string;
  args: string;
}

export interface HaproxyConfigSection {
  name: string;
  directives: ConfigDirective[];
  raw_content: string;
}

export interface HaproxyConfig {
  global: Record<string, string>;
  defaults: Record<string, string>;
  frontends: HaproxyConfigSection[];
  backends: HaproxyConfigSection[];
  listeners: HaproxyConfigSection[];
  raw_content: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  output: string;
  errors: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Runtime API
// ═══════════════════════════════════════════════════════════════════════════

export interface RuntimeCommand {
  command: string;
  response: string;
}

export interface SessionEntry {
  id: string;
  frontend: string;
  backend: string;
  server: string;
  source: string;
  destination?: string;
  age_secs: number;
  idle_secs?: number;
  bytes_in: number;
  bytes_out: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Peers & Resolvers
// ═══════════════════════════════════════════════════════════════════════════

export interface HaproxyPeer {
  name: string;
  address: string;
  port: number;
  status: string;
}

export interface ResolverNameserver {
  name: string;
  address: string;
  port: number;
}

export interface HaproxyResolver {
  name: string;
  nameservers: ResolverNameserver[];
  hold?: Record<string, string>;
  resolve_retries?: number;
  timeout?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════

export interface HaproxyLogEntry {
  timestamp: string;
  process: string;
  pid?: number;
  frontend?: string;
  backend?: string;
  server?: string;
  timers?: string;
  status_code?: number;
  bytes_read?: number;
  captured_request_cookie?: string;
  captured_response_cookie?: string;
  termination_state?: string;
  actconn?: number;
  feconn?: number;
  beconn?: number;
  srv_conn?: number;
  retries?: number;
  queue_server?: number;
  queue_backend?: number;
  message: string;
}

export interface LogQuery {
  lines?: number;
  since?: string;
  filter?: string;
  frontend?: string;
  backend?: string;
  status_code?: number;
}
