// cPanel Account Services — domain types for category c2 (t42-cpanel-c2).
//
// Mirrors the request/response structs in
// `src-tauri/crates/sorng-cpanel/src/types.rs` for the single-account command
// surface (Domains, Email, Databases, Files, SSL, FTP, Cron).
//
// IMPORTANT — this crate is snake_case. None of these structs carry
// `#[serde(rename_all)]`, so serde serialises/deserialises their fields with the
// raw Rust snake_case names. Every field below is therefore snake_case verbatim
// (`document_root`, `send_welcome`, `record_type`, `not_after`, `home_used`, …).
// Only the top-level command ARGUMENT names (id/user/req/domain/…) follow Tauri's
// camelCase conversion — those live in `useCpanelAccount.ts`, not here. See
// `.orchestration/logs/t42-cpanel-categories.md` (CRITICAL serde note).

// ═══════════════════════════════════════════════════════════════════════════════
// Domains
// ═══════════════════════════════════════════════════════════════════════════════

/** `DomainType` — Rust enum (`#[serde(rename_all = "snake_case")]`). */
export type DomainType = "main" | "addon" | "parked" | "sub";

export interface DomainInfo {
  domain: string;
  domain_type: DomainType;
  documentroot?: string;
  user?: string;
  ip?: string;
  port?: number;
  ssl_port?: number;
  php_version?: string;
  server_name?: string;
  server_alias?: string;
  redirect_url?: string;
  status?: string;
}

export interface CreateAddonDomainRequest {
  domain: string;
  subdomain: string;
  document_root: string;
  password?: string;
}

export interface CreateSubdomainRequest {
  subdomain: string;
  root_domain: string;
  document_root?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Email
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmailAccount {
  email: string;
  login: string;
  domain: string;
  diskused?: number;
  diskquota?: number;
  diskusedpercent?: number;
  humandiskused?: string;
  humandiskquota?: string;
  suspended_incoming?: boolean;
  suspended_login?: boolean;
  hold_outgoing?: boolean;
}

export interface CreateEmailRequest {
  email: string;
  password: string;
  quota?: number;
  send_welcome?: boolean;
}

export interface EmailForwarder {
  dest: string;
  forward: string;
  uri?: string;
  html?: string;
}

export interface EmailAutoresponder {
  email: string;
  domain: string;
  from?: string;
  subject?: string;
  body: string;
  start?: number;
  stop?: number;
  interval?: number;
  is_html?: boolean;
}

export interface MailingList {
  list: string;
  accesstype?: string;
  humandiskused?: string;
  diskused?: number;
}

export interface SpamFilterSettings {
  enabled: boolean;
  score?: number;
  auto_delete?: boolean;
  auto_delete_score?: number;
  rewrite_subject?: boolean;
  subject_tag?: string;
  whitelist_from: string[];
  blacklist_from: string[];
}

export interface MxRecord {
  domain: string;
  exchanger: string;
  priority: number;
  record_type?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════════════════════════

/** `DatabaseEngine` — Rust enum (`#[serde(rename_all = "snake_case")]`). */
export type DatabaseEngine = "mysql" | "postgresql";

export interface CpanelDatabase {
  db: string;
  engine: DatabaseEngine;
  users: string[];
  size?: number;
  disk_usage?: string;
}

export interface DatabaseUser {
  user: string;
  engine: DatabaseEngine;
  databases: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Files
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileItem {
  path: string;
  name: string;
  file_type: string;
  size?: number;
  humansize?: string;
  permissions?: string;
  owner?: string;
  group?: string;
  mtime?: number;
  ctime?: number;
  mimetype?: string;
  is_symlink?: boolean;
}

export interface DiskUsageInfo {
  user: string;
  home_used?: number;
  home_limit?: number;
  mail_used?: number;
  mysql_used?: number;
  pgsql_used?: number;
  total_used?: number;
  total_limit?: number;
  percentage?: number;
  inodes_used?: number;
  inodes_limit?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSL / TLS
// ═══════════════════════════════════════════════════════════════════════════════

export interface SslCertificate {
  id?: string;
  domain: string;
  issuer?: string;
  subject?: string;
  not_before?: string;
  not_after?: string;
  is_self_signed?: boolean;
  key_size?: number;
  signature_algorithm?: string;
  domains: string[];
  installed?: boolean;
}

export interface SslStatus {
  domain: string;
  ssl_enabled: boolean;
  certificate?: SslCertificate;
  autossl_enabled?: boolean;
}

export interface InstallSslRequest {
  domain: string;
  cert: string;
  key: string;
  cabundle?: string;
}

export interface GenerateCsrRequest {
  domain: string;
  country?: string;
  state?: string;
  city?: string;
  company?: string;
  company_division?: string;
  email?: string;
  key_size?: number;
}

export interface CsrResult {
  csr: string;
  key: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FTP
// ═══════════════════════════════════════════════════════════════════════════════

export interface FtpAccount {
  user: string;
  login: string;
  dir: string;
  homedir?: string;
  quota?: number;
  diskused?: number;
  /** Rust field is `type_` (no serde rename) — serialises verbatim as `type_`. */
  type_?: string;
}

export interface CreateFtpRequest {
  user: string;
  password: string;
  quota?: number;
  homedir?: string;
}

export interface FtpSession {
  user: string;
  logged_in_from?: string;
  status?: string;
  process_id?: number;
  login_time?: string;
  file?: string;
  cmdline?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cron Jobs
// ═══════════════════════════════════════════════════════════════════════════════

export interface CronJob {
  linekey?: string;
  line?: number;
  command: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  enabled?: boolean;
}

export interface CreateCronRequest {
  command: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
}
