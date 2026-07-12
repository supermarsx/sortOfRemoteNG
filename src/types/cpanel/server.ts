// cPanel/WHM integration — "server" category types (t42-cpanel-c1).
//
// WHM / Server Administration slice: accounts, DNS zones, backups, server
// security, monitoring, and PHP versions. Mirror of the matching structs in
//   src-tauri/crates/sorng-cpanel/src/types.rs
//
// CRITICAL — this crate is snake_case. None of these request/response structs
// carry `#[serde(rename_all)]`, so serde serialises their fields with the raw
// Rust snake_case names. Every field below is therefore snake_case verbatim
// (`whm_port`, `record_type`, `keep_dns`-style bodies live in the invoke args,
// not here). Only the top-level command ARGUMENT names follow Tauri's camelCase
// conversion — see `../../hooks/integration/cpanel/useCpanelServer.ts`. Enums
// tagged `#[serde(rename_all = "snake_case")]` in Rust are string unions here.

// ─── Accounts ───────────────────────────────────────────────────────────────

/** A WHM-listed account (`accountsummary` / `listaccts`). */
export interface CpanelAccount {
  user: string;
  domain: string;
  owner?: string;
  email?: string;
  package?: string;
  theme?: string;
  shell?: string;
  ip?: string;
  startdate?: string;
  diskused?: string;
  disklimit?: string;
  plan?: string;
  max_emails?: string;
  max_sql?: string;
  max_ftp?: string;
  max_sub?: string;
  max_parked?: string;
  max_addons?: string;
  max_pop?: string;
  max_lst?: string;
  suspended?: boolean;
  suspend_reason?: string;
  suspend_time?: string;
  partition?: string;
  uid?: number;
  backup?: boolean;
  temporary?: boolean;
}

/** Payload for `cpanel_create_account` (WHM `createacct`). snake_case. */
export interface CreateAccountRequest {
  username: string;
  domain: string;
  password: string;
  plan?: string;
  contactemail?: string;
  quota?: number;
  bwlimit?: number;
  maxftp?: string;
  maxsql?: string;
  maxpop?: string;
  maxlst?: string;
  maxsub?: string;
  maxpark?: string;
  maxaddon?: string;
  hasshell?: boolean;
  cgi?: boolean;
  ip?: string;
  language?: string;
  reseller?: boolean;
  useregns?: boolean;
  force?: boolean;
}

/** Payload for `cpanel_modify_account` (WHM `modifyacct`). snake_case. */
export interface ModifyAccountRequest {
  user: string;
  domain?: string;
  newuser?: string;
  quota?: number;
  bwlimit?: number;
  plan?: string;
  maxftp?: string;
  maxsql?: string;
  maxpop?: string;
  maxlst?: string;
  maxsub?: string;
  maxpark?: string;
  maxaddon?: string;
  shell?: string;
}

/** Normalised resource summary for one account (`cpanel_get_account_summary`). */
export interface AccountSummary {
  user: string;
  domain: string;
  suspended: boolean;
  disk_used_mb: number;
  disk_limit_mb?: number;
  bandwidth_used_mb: number;
  bandwidth_limit_mb?: number;
  email_accounts: number;
  databases: number;
  addon_domains: number;
  subdomains: number;
  parked_domains: number;
  ftp_accounts: number;
}

/** A hosting package / plan (`cpanel_list_packages`). */
export interface HostingPackage {
  name: string;
  quota?: number;
  bandwidth?: number;
  max_ftp?: string;
  max_sql?: string;
  max_pop?: string;
  max_lst?: string;
  max_sub?: string;
  max_park?: string;
  max_addon?: string;
  max_email_per_hour?: string;
  has_cgi?: boolean;
  has_shell?: boolean;
  digest?: string;
  ip?: string;
  language?: string;
  max_defer_fail_pct?: string;
}

/** Server identity + capacity (`cpanel_get_server_info`). */
export interface CpanelServerInfo {
  hostname: string;
  version: string;
  build?: string;
  theme?: string;
  os?: string;
  os_version?: string;
  kernel?: string;
  arch?: string;
  apache_version?: string;
  php_version?: string;
  mysql_version?: string;
  perl_version?: string;
  license_id?: string;
  license_package?: string;
  max_accounts?: number;
  current_accounts?: number;
  uptime?: string;
  /** `[1m, 5m, 15m]` load averages. */
  load_average?: [number, number, number];
}

// ─── DNS ────────────────────────────────────────────────────────────────────

/** A DNS zone with its records (`cpanel_get_dns_zone`). */
export interface DnsZone {
  domain: string;
  records: DnsRecord[];
  serial?: string;
  ttl?: number;
  refresh?: number;
  retry?: number;
  expire?: number;
  minimum?: number;
}

/** A single DNS record within a zone. `line` identifies it for edit/remove. */
export interface DnsRecord {
  line?: number;
  name: string;
  record_type: string;
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number;
  txtdata?: string;
  priority?: number;
  weight?: number;
  port?: number;
  target?: string;
  ttl?: number;
  class?: string;
  raw?: string;
}

/** Payload for `cpanel_add_dns_record`. snake_case. */
export interface AddDnsRecordRequest {
  domain: string;
  name: string;
  record_type: string;
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number;
  txtdata?: string;
  priority?: number;
  weight?: number;
  port?: number;
  target?: string;
  ttl?: number;
  class?: string;
}

/** Payload for `cpanel_edit_dns_record`. `line` targets the existing record. */
export interface EditDnsRecordRequest {
  domain: string;
  line: number;
  name?: string;
  record_type?: string;
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number;
  txtdata?: string;
  priority?: number;
  weight?: number;
  port?: number;
  target?: string;
  ttl?: number;
}

// ─── Backups ────────────────────────────────────────────────────────────────

/** Backup kind (`#[serde(rename_all = "snake_case")]`). */
export type BackupType =
  | "full"
  | "incremental"
  | "home_dir"
  | "mysql"
  | "email"
  | "filters";

/** One backup record (`cpanel_list_backups`). */
export interface BackupInfo {
  backup_id?: string;
  backup_type: BackupType;
  size?: number;
  path?: string;
  status?: string;
  created_at?: string;
  completed_at?: string;
  user?: string;
}

/** Server backup configuration. `cpanel_get_backup_config` returns
 *  `serde_json::Value` server-side, so it is surfaced as `unknown`; this shape
 *  documents the expected structure for callers that narrow it. */
export interface BackupConfig {
  enabled: boolean;
  backup_type: BackupType;
  schedule?: string;
  retain_daily?: number;
  retain_weekly?: number;
  retain_monthly?: number;
  compress?: boolean;
  backup_accounts?: boolean;
  backup_system?: boolean;
  destination?: unknown;
}

// ─── Security ───────────────────────────────────────────────────────────────

/** A blocked-IP rule (`cpanel_list_blocked_ips`). */
export interface IpBlockRule {
  ip: string;
  comment?: string;
}

/** An SSH key entry (`cpanel_list_ssh_keys`). */
export interface SshKey {
  name: string;
  key_type?: string;
  fingerprint?: string;
  comment?: string;
  authorized: boolean;
}

// ─── Monitoring ─────────────────────────────────────────────────────────────

/** Per-account bandwidth usage (`cpanel_get_bandwidth`). */
export interface BandwidthUsage {
  domain: string;
  used_bytes: number;
  limit_bytes?: number;
  http_bytes?: number;
  smtp_bytes?: number;
  pop3_bytes?: number;
  imap_bytes?: number;
  ftp_bytes?: number;
  period?: string;
}

/** CloudLinux/LVE-style resource usage (`cpanel_get_resource_usage`). */
export interface ResourceUsage {
  cpu_usage?: number;
  memory_mb?: number;
  memory_limit_mb?: number;
  processes?: number;
  process_limit?: number;
  io_usage?: number;
  io_limit?: number;
  iops_usage?: number;
  iops_limit?: number;
  entry_procs?: number;
  entry_proc_limit?: number;
  nproc?: number;
  nproc_limit?: number;
}

/** One parsed error-log line (`cpanel_get_error_log`). */
export interface ErrorLogEntry {
  message: string;
  timestamp?: string;
  level?: string;
  file?: string;
  line?: number;
}

/** Server load snapshot (`cpanel_get_server_load`). */
export interface ServerLoadStatus {
  one: number;
  five: number;
  fifteen: number;
  cpu_count?: number;
  running_procs?: number;
  total_procs?: number;
}

// ─── PHP ────────────────────────────────────────────────────────────────────

/** An installed PHP version (`cpanel_list_php_versions`). */
export interface PhpVersion {
  version: string;
  handler?: string;
  is_default: boolean;
  is_system_default?: boolean;
  path?: string;
}

/** PHP INI configuration for one version (`cpanel_get_php_config`). */
export interface PhpConfig {
  version: string;
  directives: PhpDirective[];
}

/** A single PHP INI directive. */
export interface PhpDirective {
  key: string;
  value: string;
  default_value?: string;
  info?: string;
  directive_type?: string;
}

/** A PHP extension (`cpanel_list_php_extensions`). */
export interface PhpExtension {
  name: string;
  enabled: boolean;
  version?: string;
}
