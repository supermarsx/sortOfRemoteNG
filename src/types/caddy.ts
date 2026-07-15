// Caddy integration types (t42-caddy).
//
// 1:1 mirror of the wire shapes produced by `sorng-caddy/src/types.rs`.
// Serde convention in that crate is the DEFAULT (no container `rename_all`, no
// per-field renames) — so every field is snake_case on the wire
// (`admin_url`, `api_key`, `tls_skip_verify`, `http_port`, ...). The one
// exception is `CaddyRoute`, whose three fields carry explicit
// `#[serde(rename)]` to Caddy's JSON keys `@id`, `group`, `match`. Mirrored
// exactly below.
//
// All 34 registered `caddy_*` commands (`sorng-caddy/src/commands.rs`) are
// reachable from these types via `caddyApi` / `useCaddy()`.

// ── Connection ───────────────────────────────────────────────────────────────

/** Request struct for `caddy_connect`. Default serde → snake_case wire. */
export interface CaddyConnectionConfig {
  /** Caddy admin API URL (default: http://localhost:2019). */
  admin_url: string;
  api_key?: string;
  username?: string;
  password?: string;
  tls_skip_verify?: boolean;
  timeout_secs?: number;
  proxy_url?: string;
}

/** Response of `caddy_connect` / `caddy_ping`. */
export interface CaddyConnectionSummary {
  admin_url: string;
  version?: string;
}

// ── Full Config (GET /config/) ───────────────────────────────────────────────

export interface CaddyConfig {
  admin?: AdminConfig;
  logging?: unknown;
  storage?: unknown;
  apps?: CaddyApps;
}

export interface AdminConfig {
  disabled?: boolean;
  listen?: string;
  enforce_origin?: boolean;
  origins?: string[];
}

export interface CaddyApps {
  http?: HttpApp;
  tls?: TlsApp;
  pki?: unknown;
}

// ── HTTP App ─────────────────────────────────────────────────────────────────

export interface HttpApp {
  http_port?: number;
  https_port?: number;
  grace_period?: string;
  servers?: Record<string, CaddyServer>;
}

export interface CaddyServer {
  listen?: string[];
  routes?: CaddyRoute[];
  errors?: unknown;
  automatic_https?: unknown;
  max_header_bytes?: number;
  timeouts?: ServerTimeouts;
  strict_sni_host?: boolean;
  tls_connection_policies?: TlsConnectionPolicy[];
  protocols?: string[];
  logs?: unknown;
}

export interface ServerTimeouts {
  read_body?: string;
  read_header?: string;
  write?: string;
  idle?: string;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export interface CaddyRoute {
  /** serde rename → `@id`. */
  "@id"?: string;
  group?: string;
  /** serde rename → `match`. */
  match?: CaddyMatcher[];
  handle?: CaddyHandler[];
  terminal?: boolean;
}

export interface CaddyMatcher {
  host?: string[];
  path?: string[];
  path_regexp?: PathRegexp;
  method?: string[];
  header?: Record<string, string[]>;
  header_regexp?: Record<string, PathRegexp>;
  protocol?: string;
  query?: Record<string, string[]>;
  remote_ip?: RemoteIpMatcher;
  not?: CaddyMatcher[];
  expression?: string;
}

export interface PathRegexp {
  name?: string;
  pattern: string;
}

export interface RemoteIpMatcher {
  ranges?: string[];
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export interface CaddyHandler {
  handler: string;
  // reverse_proxy
  upstreams?: CaddyUpstream[];
  load_balancing?: LoadBalancingConfig;
  health_checks?: HealthCheckConfig;
  headers?: unknown;
  transport?: unknown;
  rewrite?: string;
  buffer_requests?: boolean;
  buffer_responses?: boolean;
  max_buffer_size?: number;
  // file_server
  root?: string;
  hide?: string[];
  index_names?: string[];
  browse?: unknown;
  precompressed?: unknown;
  canonical_uris?: boolean;
  pass_thru?: boolean;
  // static_response
  status_code?: string;
  body?: string;
  close?: boolean;
  // subroute
  routes?: CaddyRoute[];
  // encode (compression)
  encodings?: unknown;
  prefer?: string[];
  minimum_length?: number;
  // authentication
  providers?: unknown;
  // rewrite
  uri?: string;
  strip_path_prefix?: string;
  strip_path_suffix?: string;
  uri_substring?: SubstringReplace[];
  // redirect
  redirect_status?: number;
}

export interface SubstringReplace {
  find: string;
  replace: string;
  limit?: number;
}

export interface CaddyUpstream {
  dial: string;
  max_requests?: number;
}

export interface LoadBalancingConfig {
  selection_policy?: unknown;
  try_duration?: string;
  try_interval?: string;
}

export interface HealthCheckConfig {
  active?: ActiveHealthCheck;
  passive?: PassiveHealthCheck;
}

export interface ActiveHealthCheck {
  path?: string;
  port?: number;
  interval?: string;
  timeout?: string;
  max_size?: number;
  expect_status?: number;
  expect_body?: string;
  headers?: Record<string, string[]>;
}

export interface PassiveHealthCheck {
  fail_duration?: string;
  max_fails?: number;
  unhealthy_request_count?: number;
  unhealthy_status?: number[];
  unhealthy_latency?: string;
}

// ── TLS App ──────────────────────────────────────────────────────────────────

export interface TlsApp {
  certificates?: TlsCertificates;
  automation?: TlsAutomation;
}

export interface TlsCertificates {
  automate?: string[];
  load_files?: TlsLoadFile[];
  load_folders?: string[];
  load_pem?: TlsLoadPem[];
}

export interface TlsLoadFile {
  certificate: string;
  key: string;
  tags?: string[];
}

export interface TlsLoadPem {
  certificate: string;
  key: string;
  tags?: string[];
}

export interface TlsAutomation {
  policies?: TlsAutomationPolicy[];
  on_demand?: OnDemandConfig;
  ocsp_interval?: string;
  renew_interval?: string;
}

export interface TlsAutomationPolicy {
  subjects?: string[];
  issuers?: unknown[];
  must_staple?: boolean;
  renewal_window_ratio?: number;
  key_type?: string;
  on_demand?: boolean;
}

export interface OnDemandConfig {
  rate_limit?: OnDemandRateLimit;
  ask?: string;
}

export interface OnDemandRateLimit {
  interval?: string;
  burst?: number;
}

export interface TlsConnectionPolicy {
  /** serde rename → `match`. */
  match?: unknown;
  certificate_selection?: unknown;
  cipher_suites?: string[];
  curves?: string[];
  alpn?: string[];
  protocol_min?: string;
  protocol_max?: string;
  client_authentication?: unknown;
  default_sni?: string;
}

// ── Certificates (managed by Caddy) ──────────────────────────────────────────

export interface CaddyCertificate {
  managed: boolean;
  issuer?: string;
  sans: string[];
  not_before?: string;
  not_after?: string;
  fingerprint?: string;
}

// ── Caddyfile helpers ────────────────────────────────────────────────────────

export interface CaddyfileAdaptResult {
  config: unknown;
  warnings: CaddyfileWarning[];
}

export interface CaddyfileWarning {
  file?: string;
  line?: number;
  directive?: string;
  message: string;
}

// ── Reverse Proxy convenience ────────────────────────────────────────────────

export interface CreateReverseProxyRequest {
  server_name?: string;
  hosts: string[];
  upstreams: string[];
  tls?: boolean;
  headers?: Record<string, string>;
  health_check_path?: string;
  load_balancing?: string;
  strip_prefix?: string;
}

export interface CreateFileServerRequest {
  server_name?: string;
  hosts: string[];
  root: string;
  browse?: boolean;
  tls?: boolean;
  index_names?: string[];
}

export interface CreateRedirectRequest {
  server_name?: string;
  hosts: string[];
  target: string;
  permanent?: boolean;
}
