// Traefik integration types — 1:1 mirror of the wire shapes emitted by
// `src-tauri/crates/sorng-traefik/src/types.rs`.
//
// MIXED serde convention (mirror it exactly):
//   - The result structs `TraefikRouter`, `TraefikTcpRouter`, `TraefikUdpRouter`,
//     `TraefikService`, `TraefikTcpService`, `TraefikUdpService`,
//     `TraefikMiddleware`, `TraefikTcpMiddleware` and `RouterTls` carry
//     `#[serde(rename_all = "camelCase")]` → camelCase keys on the wire.
//   - Everything else (`TraefikConnectionConfig`/`Summary`, `TraefikOverview`,
//     `ProviderSummary`, `ResourceCount`, `TraefikFeatures`, `TraefikVersion`,
//     `TraefikEntryPoint`, `LoadBalancer`/`LbServer`/`HealthCheck`,
//     `TcpLoadBalancer`/`TcpServer`, `UdpLoadBalancer`/`UdpServer`, `TlsDomain`,
//     `TraefikTlsCertificate`, `TraefikRawConfig`) has NO rename_all → snake_case
//     keys, INCLUDING when nested inside a camelCase parent (serde rename_all is
//     not inherited).
//   - The `type` field on services/middlewares is `#[serde(rename = "type")]`.
//   - `serde_json::Value` → `unknown`.

// ── Connection ──────────────────────────────────────────────────────────────

/** Wire shape of `TraefikConnectionConfig` (snake_case). */
export interface TraefikConnectionConfig {
  api_url: string;
  username?: string;
  password?: string;
  api_key?: string;
  tls_skip_verify?: boolean;
  timeout_secs?: number;
  proxy_url?: string;
}

/** Wire shape of `TraefikConnectionSummary` (snake_case). */
export interface TraefikConnectionSummary {
  api_url: string;
  version?: string;
  dashboard_url?: string;
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface ResourceCount {
  total: number;
  warnings: number;
  errors: number;
}

export interface ProviderSummary {
  routers: ResourceCount;
  services: ResourceCount;
  middlewares: ResourceCount;
}

export interface TraefikFeatures {
  tracing?: string;
  metrics?: string;
  access_log?: boolean;
}

export interface TraefikOverview {
  http?: ProviderSummary;
  tcp?: ProviderSummary;
  udp?: ProviderSummary;
  features?: TraefikFeatures;
  providers: string[];
}

export interface TraefikVersion {
  version: string;
  codename?: string;
  start_date?: string;
}

// ── EntryPoints ─────────────────────────────────────────────────────────────

export interface TraefikEntryPoint {
  name: string;
  address: string;
  transport?: unknown;
  forwarded_headers?: unknown;
  http?: unknown;
}

// ── Routers (camelCase) ─────────────────────────────────────────────────────

export interface TlsDomain {
  main: string;
  sans?: string[];
}

export interface RouterTls {
  certResolver?: string;
  domains?: TlsDomain[];
  options?: string;
  passthrough?: boolean;
}

export interface TraefikRouter {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  entryPoints?: string[];
  middlewares?: string[];
  service?: string;
  rule?: string;
  priority?: number;
  tls?: RouterTls;
  error?: string;
}

export interface TraefikTcpRouter {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  entryPoints?: string[];
  service?: string;
  rule?: string;
  tls?: RouterTls;
  priority?: number;
}

export interface TraefikUdpRouter {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  entryPoints?: string[];
  service?: string;
}

// ── Services ────────────────────────────────────────────────────────────────

/** Nested load-balancer types are snake_case (no rename_all on them). */
export interface LbServer {
  url: string;
}

export interface HealthCheck {
  scheme?: string;
  path?: string;
  port?: number;
  interval?: string;
  timeout?: string;
  hostname?: string;
  follow_redirects?: boolean;
  headers?: Record<string, string>;
}

export interface LoadBalancer {
  servers?: LbServer[];
  health_check?: HealthCheck;
  pass_host_header?: boolean;
  sticky?: unknown;
}

/** `TraefikService` is camelCase; `type` is a serde rename; `loadBalancer`
 *  (camelCase key) nests the snake_case `LoadBalancer`. */
export interface TraefikService {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  type?: string;
  serverStatus?: Record<string, string>;
  loadBalancer?: LoadBalancer;
  weighted?: unknown;
  mirroring?: unknown;
}

export interface TcpServer {
  address: string;
}

export interface TcpLoadBalancer {
  servers?: TcpServer[];
  termination_delay?: number;
}

export interface TraefikTcpService {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  type?: string;
  loadBalancer?: TcpLoadBalancer;
}

export interface UdpServer {
  address: string;
}

export interface UdpLoadBalancer {
  servers?: UdpServer[];
}

export interface TraefikUdpService {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  loadBalancer?: UdpLoadBalancer;
}

// ── Middlewares (camelCase) ─────────────────────────────────────────────────

export interface TraefikMiddleware {
  name?: string;
  provider?: string;
  status?: string;
  using?: string[];
  type?: string;
  error?: string;
  // Middleware config variants — exactly one is typically populated.
  addPrefix?: unknown;
  stripPrefix?: unknown;
  stripPrefixRegex?: unknown;
  replacePath?: unknown;
  replacePathRegex?: unknown;
  headers?: unknown;
  rateLimit?: unknown;
  redirectRegex?: unknown;
  redirectScheme?: unknown;
  basicAuth?: unknown;
  digestAuth?: unknown;
  forwardAuth?: unknown;
  ipAllowList?: unknown;
  ipWhiteList?: unknown;
  chain?: unknown;
  circuitBreaker?: unknown;
  compress?: unknown;
  contentType?: unknown;
  buffering?: unknown;
  retry?: unknown;
  passTlsClientCert?: unknown;
  inFlightReq?: unknown;
  plugin?: unknown;
}

export interface TraefikTcpMiddleware {
  name?: string;
  provider?: string;
  status?: string;
  type?: string;
  ipAllowList?: unknown;
  inFlightConn?: unknown;
}

// ── TLS ─────────────────────────────────────────────────────────────────────

export interface TraefikTlsCertificate {
  sans: string[];
  not_after?: string;
  not_before?: string;
  serial_number?: string;
  issuer?: string;
  subject?: string;
}

// ── Raw config ──────────────────────────────────────────────────────────────

export interface TraefikRawConfig {
  json: unknown;
}
