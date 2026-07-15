// TypeScript mirror of the sorng-nginx crate's wire types.
//
// Source of truth: `src-tauri/crates/sorng-nginx/src/types.rs`.
//
// SERDE CONVENTION: the crate has NO `#[serde(rename_all)]` on any struct, so
// every field serializes with its raw Rust snake_case name. These interfaces
// therefore use snake_case keys (host, ssh_user, config_path, use_tls-free —
// there is no rename here). Command ARGUMENT names (the fn params) do convert to
// camelCase per Tauri's default (e.g. `site_name` → `siteName`); those live in
// `useNginx.ts`, not here. Only struct fields stay snake_case.

// ═══════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxConnectionConfig {
  /** SSH host or direct host for stub_status. */
  host: string;
  port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key?: string;
  /** Path to nginx binary (default: /usr/sbin/nginx). */
  nginx_bin?: string;
  /** Path to main config (default: /etc/nginx/nginx.conf). */
  config_path?: string;
  /** Sites-available dir (default: /etc/nginx/sites-available). */
  sites_available_dir?: string;
  /** Sites-enabled dir (default: /etc/nginx/sites-enabled). */
  sites_enabled_dir?: string;
  /** Conf.d directory (default: /etc/nginx/conf.d). */
  conf_d_dir?: string;
  /** stub_status URL (e.g. http://host/nginx_status). */
  status_url?: string;
  timeout_secs?: number;
  proxy_url?: string;
}

export interface NginxConnectionSummary {
  host: string;
  version?: string;
  config_path: string;
  worker_processes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Nginx Info / Process
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxInfo {
  version: string;
  compiler?: string;
  configure_arguments: string[];
  modules: string[];
  prefix?: string;
  config_path: string;
  pid_path?: string;
  error_log?: string;
}

export interface NginxProcess {
  pid: number;
  ppid?: number;
  process_type: string;
  cpu_percent?: number;
  memory_rss?: number;
  connections?: number;
  uptime_secs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Server Blocks (Sites)
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxSite {
  name: string;
  filename: string;
  enabled: boolean;
  server_names: string[];
  listen_directives: ListenDirective[];
  root?: string;
  index?: string;
  locations: NginxLocation[];
  ssl?: SslConfig;
  upstream_ref?: string;
  raw_content: string;
}

export interface ListenDirective {
  address?: string;
  port: number;
  ssl: boolean;
  http2: boolean;
  default_server: boolean;
  ipv6only: boolean;
}

export interface NginxLocation {
  path: string;
  /** =, ~, ~*, ^~ */
  modifier?: string;
  proxy_pass?: string;
  root?: string;
  alias?: string;
  index?: string;
  try_files?: string;
  return_directive?: string;
  rewrite?: string;
  fastcgi_pass?: string;
  uwsgi_pass?: string;
  grpc_pass?: string;
  extra_directives: Record<string, string>;
}

export interface CreateSiteRequest {
  name: string;
  server_names: string[];
  listen_port?: number;
  ssl?: SslConfig;
  root?: string;
  locations: CreateLocationRequest[];
  upstream?: string;
  extra_directives?: Record<string, string>;
  enable?: boolean;
}

export interface CreateLocationRequest {
  path: string;
  modifier?: string;
  proxy_pass?: string;
  root?: string;
  alias?: string;
  try_files?: string;
  return_directive?: string;
  fastcgi_pass?: string;
  extra_directives?: Record<string, string>;
}

export interface UpdateSiteRequest {
  name: string;
  content: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SSL
// ═══════════════════════════════════════════════════════════════════════════

export interface SslConfig {
  certificate: string;
  certificate_key: string;
  protocols?: string[];
  ciphers?: string;
  prefer_server_ciphers?: boolean;
  session_cache?: string;
  session_timeout?: string;
  stapling?: boolean;
  stapling_verify?: boolean;
  trusted_certificate?: string;
  dhparam?: string;
  hsts?: boolean;
  hsts_max_age?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Upstreams
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxUpstream {
  name: string;
  servers: UpstreamServer[];
  /** round_robin, least_conn, ip_hash, hash */
  load_balancing?: string;
  keepalive?: number;
  keepalive_requests?: number;
  keepalive_timeout?: string;
  zone?: string;
  zone_size?: string;
}

export interface UpstreamServer {
  address: string;
  port?: number;
  weight?: number;
  max_conns?: number;
  max_fails?: number;
  fail_timeout?: string;
  backup: boolean;
  down: boolean;
  slow_start?: string;
}

export interface CreateUpstreamRequest {
  name: string;
  servers: UpstreamServer[];
  load_balancing?: string;
  keepalive?: number;
}

export interface UpdateUpstreamRequest {
  name: string;
  servers?: UpstreamServer[];
  load_balancing?: string;
  keepalive?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status / Monitoring
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxStubStatus {
  active_connections: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
}

export interface NginxHealthCheck {
  running: boolean;
  pid?: number;
  worker_count: number;
  config_valid: boolean;
  uptime_secs?: number;
  status?: NginxStubStatus;
}

// ═══════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════

export interface AccessLogEntry {
  remote_addr: string;
  remote_user?: string;
  time_local: string;
  request: string;
  status: number;
  body_bytes_sent: number;
  http_referer?: string;
  http_user_agent?: string;
  request_time?: number;
  upstream_response_time?: number;
}

export interface ErrorLogEntry {
  timestamp: string;
  level: string;
  pid?: number;
  tid?: number;
  connection?: number;
  message: string;
  client?: string;
  server?: string;
  request?: string;
}

export interface LogQuery {
  path?: string;
  lines?: number;
  since?: string;
  filter?: string;
  level?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxMainConfig {
  worker_processes?: string;
  worker_connections?: number;
  multi_accept?: boolean;
  sendfile?: boolean;
  tcp_nopush?: boolean;
  tcp_nodelay?: boolean;
  keepalive_timeout?: string;
  types_hash_max_size?: number;
  server_tokens?: boolean;
  client_max_body_size?: string;
  gzip?: boolean;
  gzip_types?: string[];
  include_files: string[];
  error_log?: string;
  access_log?: string;
  pid_file?: string;
  raw_content: string;
}

export interface ConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting / Security (types only — no commands bind these yet)
// ═══════════════════════════════════════════════════════════════════════════

export interface RateLimitZone {
  name: string;
  key: string;
  size: string;
  rate: string;
}

export interface GeoRestriction {
  name: string;
  default_action: string;
  rules: GeoRule[];
}

export interface GeoRule {
  cidr: string;
  action: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Maps & Redirects (types only — no commands bind these yet)
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxMap {
  name: string;
  source_variable: string;
  target_variable: string;
  default?: string;
  entries: MapEntry[];
  hostnames: boolean;
}

export interface MapEntry {
  pattern: string;
  value: string;
}

export interface RedirectRule {
  source: string;
  target: string;
  permanent: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Snippets / Includes
// ═══════════════════════════════════════════════════════════════════════════

export interface NginxSnippet {
  name: string;
  path: string;
  content: string;
  description?: string;
}

export interface CreateSnippetRequest {
  name: string;
  content: string;
  description?: string;
}
