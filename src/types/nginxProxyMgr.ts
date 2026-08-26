// Nginx Proxy Manager integration types — snake_case 1:1 mirror of the crate's
// wire shapes.
//
// Source: src-tauri/crates/sorng-nginx-proxy-mgr/src/{types,error}.rs
// Unlike most integration crates, the structs there carry NO `rename_all`:
// NPM's own REST JSON is snake_case and the crate deserialises it as-is, so
// the exact same snake_case keys travel over the Tauri boundary in both
// directions (the `config` arg is passed through serde untouched). Command
// *argument* names still follow Tauri's camelCase mapping (`hostId` →
// `host_id`) — see `useNginxProxyMgr.ts`. `Option<T>` fields become optional
// (`?`); nullable JSON values arrive as `null`, so optionals are `T | null`.

// ═══════════════════════════════════════════════════════════════════════════════
// Connection & Auth
// ═══════════════════════════════════════════════════════════════════════════════

export type NpmAuthMode = "password" | "token";

export interface NpmConnectionConfig {
  /** NPM API URL, scheme required — e.g. `http://host:81` (trailing slash stripped). */
  api_url: string;
  email?: string | null;
  password?: string | null;
  /** Pre-existing bearer token (used only when email+password are absent). */
  token?: string | null;
  /** Skip TLS verification (AlwaysTrust override); only meaningful for https URLs. */
  skip_tls_verify?: boolean | null;
  /**
   * One-shot acknowledgement that must accompany `skip_tls_verify: true`
   * (Trust-Center ack contract). Never persisted; `skip_serializing` server-side.
   */
  acknowledge_invalid_cert_risk?: boolean;
  timeout_secs?: number | null;
  proxy_url?: string | null;
}

export interface NpmConnectionSummary {
  api_url: string;
  user?: string | null;
  roles?: string[];
  version?: string | null;
  auth_mode: NpmAuthMode;
  /** ISO-8601 UTC expiry of the current bearer token, when known. */
  token_expires_at?: string | null;
}

export interface NpmTokenResponse {
  token: string;
  expires: string;
}

export interface NpmVersion {
  major: number;
  minor: number;
  revision: number;
}

export interface NpmHealthStatus {
  status: string;
  version?: NpmVersion | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Proxy Hosts
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmLocation {
  path: string;
  forward_host: string;
  forward_port: number;
  forward_scheme: string;
  advanced_config?: string | null;
}

export interface NpmProxyHost {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  domain_names: string[];
  forward_host: string;
  forward_port: number;
  forward_scheme: string;
  access_list_id?: number | null;
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  caching_enabled?: boolean | null;
  block_exploits?: boolean | null;
  allow_websocket_upgrade?: boolean | null;
  http2_support?: boolean | null;
  hsts_enabled?: boolean | null;
  hsts_subdomains?: boolean | null;
  advanced_config?: string | null;
  enabled?: boolean | null;
  meta?: unknown;
  locations?: NpmLocation[] | null;
  certificate?: unknown;
  owner?: unknown;
  access_list?: unknown;
}

export interface CreateProxyHostRequest {
  domain_names: string[];
  forward_host: string;
  forward_port: number;
  forward_scheme?: string | null;
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  caching_enabled?: boolean | null;
  block_exploits?: boolean | null;
  allow_websocket_upgrade?: boolean | null;
  http2_support?: boolean | null;
  hsts_enabled?: boolean | null;
  hsts_subdomains?: boolean | null;
  advanced_config?: string | null;
  locations?: NpmLocation[] | null;
  access_list_id?: number | null;
  meta?: unknown;
}

export type UpdateProxyHostRequest = Partial<CreateProxyHostRequest>;

// ═══════════════════════════════════════════════════════════════════════════════
// Redirection Hosts
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmRedirectionHost {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  domain_names: string[];
  forward_http_code: number;
  forward_domain_name: string;
  forward_scheme: string;
  preserve_path?: boolean | null;
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  block_exploits?: boolean | null;
  hsts_enabled?: boolean | null;
  hsts_subdomains?: boolean | null;
  advanced_config?: string | null;
  enabled?: boolean | null;
  meta?: unknown;
  certificate?: unknown;
  owner?: unknown;
}

export interface CreateRedirectionHostRequest {
  domain_names: string[];
  forward_http_code: number;
  forward_domain_name: string;
  forward_scheme?: string | null;
  preserve_path?: boolean | null;
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  block_exploits?: boolean | null;
  hsts_enabled?: boolean | null;
  hsts_subdomains?: boolean | null;
  advanced_config?: string | null;
  meta?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dead Hosts (404 pages)
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmDeadHost {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  domain_names: string[];
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  advanced_config?: string | null;
  enabled?: boolean | null;
  meta?: unknown;
  certificate?: unknown;
  owner?: unknown;
}

export interface CreateDeadHostRequest {
  domain_names: string[];
  certificate_id?: number | null;
  ssl_forced?: boolean | null;
  advanced_config?: string | null;
  meta?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streams (TCP/UDP forwarding)
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmStream {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  incoming_port: number;
  forwarding_host: string;
  forwarding_port: number;
  tcp_forwarding?: boolean | null;
  udp_forwarding?: boolean | null;
  enabled?: boolean | null;
  meta?: unknown;
  owner?: unknown;
}

export interface CreateStreamRequest {
  incoming_port: number;
  forwarding_host: string;
  forwarding_port: number;
  tcp_forwarding?: boolean | null;
  udp_forwarding?: boolean | null;
  meta?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmCertificate {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  /** `letsencrypt` | `other` */
  provider: string;
  nice_name: string;
  domain_names: string[];
  expires_on?: string | null;
  meta?: unknown;
  owner?: unknown;
}

export interface LetsEncryptMeta {
  letsencrypt_email: string;
  letsencrypt_agree: boolean;
  dns_challenge?: boolean | null;
  dns_provider?: string | null;
  dns_provider_credentials?: string | null;
  propagation_seconds?: number | null;
}

export interface CreateLetsEncryptCertRequest {
  domain_names: string[];
  meta?: LetsEncryptMeta | null;
}

export interface UploadCustomCertRequest {
  nice_name: string;
  certificate: string;
  certificate_key: string;
  intermediate_certificate?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmUser {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  name: string;
  nickname: string;
  email: string;
  avatar?: string | null;
  is_disabled?: boolean | null;
  roles?: string[] | null;
}

export interface UserAuth {
  type: string;
  secret: string;
}

export interface CreateUserRequest {
  name: string;
  nickname: string;
  email: string;
  roles?: string[] | null;
  is_disabled?: boolean | null;
  auth?: UserAuth | null;
}

export interface UpdateUserRequest {
  name?: string | null;
  nickname?: string | null;
  email?: string | null;
  roles?: string[] | null;
  is_disabled?: boolean | null;
}

export interface ChangePasswordRequest {
  type: string;
  current?: string | null;
  secret: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Lists
// ═══════════════════════════════════════════════════════════════════════════════

export interface AccessListItem {
  username: string;
  password: string;
}

export interface AccessListClient {
  address: string;
  directive: string;
}

export interface NpmAccessList {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  owner_user_id?: number | null;
  name: string;
  /** sic — the crate (and NPM) spell it `satisty_any` on the read side. */
  satisty_any?: boolean | null;
  pass_auth?: boolean | null;
  items?: AccessListItem[] | null;
  clients?: AccessListClient[] | null;
  proxy_host_count?: number | null;
  owner?: unknown;
  meta?: unknown;
}

export interface CreateAccessListRequest {
  name: string;
  satisfy_any?: boolean | null;
  pass_auth?: boolean | null;
  items?: AccessListItem[] | null;
  clients?: AccessListClient[] | null;
  meta?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings & Audit & Reports
// ═══════════════════════════════════════════════════════════════════════════════

export interface NpmSetting {
  id: string;
  name: string;
  description?: string | null;
  value: unknown;
  meta?: unknown;
}

export interface NpmAuditLogEntry {
  id: number;
  created_on?: string | null;
  modified_on?: string | null;
  user_id?: number | null;
  object_type?: string | null;
  object_id?: number | null;
  action?: string | null;
  meta?: unknown;
  user?: unknown;
}

export interface NpmReports {
  proxy: number;
  redirection: number;
  stream: number;
  dead: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Errors — `#[serde(rename_all = "snake_case")]` enum in error.rs
// ═══════════════════════════════════════════════════════════════════════════════

export type NpmErrorKind =
  | "not_connected"
  | "already_connected"
  | "connection_failed"
  | "authentication_failed"
  | "token_expired"
  | "config_error"
  | "tls_untrusted"
  | "proxy_host_not_found"
  | "redirection_host_not_found"
  | "dead_host_not_found"
  | "stream_not_found"
  | "certificate_not_found"
  | "access_list_not_found"
  | "user_not_found"
  | "permission_denied"
  | "http_error"
  | "parse_error"
  | "timeout"
  | "internal_error";

export interface NpmError {
  kind: NpmErrorKind;
  message: string;
}
