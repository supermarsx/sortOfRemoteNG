// Amavis (amavisd-new content filter) — TypeScript mirror of
// src-tauri/crates/sorng-amavis/src/types.rs (t42 Wave M, mail sub-tab).
//
// 1:1 mirror of the crate's serde wire shapes. IMPORTANT: `AmavisConnectionConfig`
// carries NO `#[serde(rename_all)]`, so its fields are snake_case verbatim
// (`private_key`, `timeout_secs`) — the object passed to `amavis_connect` MUST use
// these keys. Unlike the 6 SSH-transport mail crates, amavis does NOT use
// `MailSshConnectionFields`: its SSH creds are `username` / `password` /
// `private_key` (not `ssh_*`-prefixed). Enums that carry `rename_all = "snake_case"`
// on the Rust side are modelled as snake_case string-literal unions here.

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/** Config passed verbatim to `amavis_connect` (snake_case — no serde rename). */
export interface AmavisConnectionConfig {
  /** SSH hostname or IP. */
  host: string;
  /** SSH port (default 22 server-side). */
  port?: number;
  /** SSH username. */
  username: string;
  /** SSH password (omit when using key auth). */
  password?: string;
  /** Path to an SSH private key. */
  private_key?: string;
  /** SSH connection timeout in seconds. */
  timeout_secs?: number;
}

export interface AmavisConnectionSummary {
  host: string;
  version?: string | null;
  running: boolean;
  uptime_secs?: number | null;
}

export interface SshOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisMainConfig {
  config_file_path: string;
  daemon_user?: string | null;
  daemon_group?: string | null;
  max_servers?: number | null;
  child_timeout?: number | null;
  log_level?: number | null;
  syslog_facility?: string | null;
  myhostname?: string | null;
  mydomain?: string | null;
  virus_admin?: string | null;
  spam_admin?: string | null;
  sa_tag_level_deflt?: number | null;
  sa_tag2_level_deflt?: number | null;
  sa_kill_level_deflt?: number | null;
  sa_dsn_cutoff_level?: number | null;
  final_virus_destiny?: string | null;
  final_banned_destiny?: string | null;
  final_spam_destiny?: string | null;
  final_bad_header_destiny?: string | null;
}

export interface AmavisConfigSnippet {
  name: string;
  path: string;
  content: string;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Banks
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisPolicyBank {
  name: string;
  description?: string | null;
  bypass_virus_checks?: boolean | null;
  bypass_spam_checks?: boolean | null;
  bypass_banned_checks?: boolean | null;
  bypass_header_checks?: boolean | null;
  spam_tag_level?: number | null;
  spam_tag2_level?: number | null;
  spam_kill_level?: number | null;
  spam_dsn_cutoff_level?: number | null;
  virus_quarantine_to?: string | null;
  spam_quarantine_to?: string | null;
  banned_quarantine_to?: string | null;
}

export interface CreatePolicyBankRequest {
  name: string;
  description?: string | null;
  bypass_virus_checks?: boolean | null;
  bypass_spam_checks?: boolean | null;
  bypass_banned_checks?: boolean | null;
  bypass_header_checks?: boolean | null;
  spam_tag_level?: number | null;
  spam_tag2_level?: number | null;
  spam_kill_level?: number | null;
  spam_dsn_cutoff_level?: number | null;
  virus_quarantine_to?: string | null;
  spam_quarantine_to?: string | null;
  banned_quarantine_to?: string | null;
}

export interface UpdatePolicyBankRequest {
  description?: string | null;
  bypass_virus_checks?: boolean | null;
  bypass_spam_checks?: boolean | null;
  bypass_banned_checks?: boolean | null;
  bypass_header_checks?: boolean | null;
  spam_tag_level?: number | null;
  spam_tag2_level?: number | null;
  spam_kill_level?: number | null;
  spam_dsn_cutoff_level?: number | null;
  virus_quarantine_to?: string | null;
  spam_quarantine_to?: string | null;
  banned_quarantine_to?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Banned Files
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisBannedRule {
  id: string;
  pattern: string;
  description?: string | null;
  policy_bank?: string | null;
  enabled: boolean;
}

export interface CreateBannedRuleRequest {
  pattern: string;
  description?: string | null;
  policy_bank?: string | null;
}

export interface UpdateBannedRuleRequest {
  pattern?: string | null;
  description?: string | null;
  policy_bank?: string | null;
  enabled?: boolean | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Whitelist / Blacklist
// ═══════════════════════════════════════════════════════════════════════════════

/** `AmavisListType` — serde `rename_all = "snake_case"`. */
export type AmavisListType =
  | "sender_whitelist"
  | "sender_blacklist"
  | "recipient_whitelist";

export const AMAVIS_LIST_TYPES: AmavisListType[] = [
  "sender_whitelist",
  "sender_blacklist",
  "recipient_whitelist",
];

export interface AmavisListEntry {
  id: string;
  list_type: AmavisListType;
  address: string;
  description?: string | null;
  enabled: boolean;
}

export interface CreateListEntryRequest {
  list_type: AmavisListType;
  address: string;
  description?: string | null;
}

export interface UpdateListEntryRequest {
  list_type?: AmavisListType | null;
  address?: string | null;
  description?: string | null;
  enabled?: boolean | null;
}

export interface AmavisListCheckResult {
  whitelisted: boolean;
  blacklisted: boolean;
  score_modifier: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quarantine
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisQuarantineItem {
  mail_id: string;
  partition_tag?: string | null;
  sender: string;
  recipients: string[];
  subject?: string | null;
  spam_level?: number | null;
  content_type?: string | null;
  time_iso: string;
  quarantine_type: string;
  size_bytes: number;
}

/** `QuarantineAction` — serde `rename_all = "snake_case"`. */
export type QuarantineAction = "release" | "delete" | "whitelist";

export interface QuarantineListRequest {
  quarantine_type?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface AmavisQuarantineStats {
  total_items: number;
  total_size_bytes: number;
  spam_count: number;
  virus_count: number;
  banned_count: number;
  oldest_item_time?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats / Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisStats {
  msgs_total: number;
  msgs_clean: number;
  msgs_spam: number;
  msgs_virus: number;
  msgs_banned: number;
  msgs_bad_header: number;
  msgs_unchecked: number;
  avg_process_time_ms: number;
  uptime_secs: number;
  children_active: number;
  children_idle: number;
}

export interface AmavisChildProcess {
  pid: number;
  state: string;
  msgs_processed: number;
  started_at?: string | null;
}

export interface AmavisThroughput {
  msgs_per_minute: number;
  bytes_per_minute: number;
  avg_latency_ms: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Process
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisProcessInfo {
  pid?: number | null;
  running: boolean;
  version?: string | null;
  config_file?: string | null;
  uptime_secs?: number | null;
}

/** `AmavisProcessAction` — serde `rename_all = "snake_case"`. */
export type AmavisProcessAction =
  | "start"
  | "stop"
  | "restart"
  | "reload"
  | "status";

// ═══════════════════════════════════════════════════════════════════════════════
// Milter Integration
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisMilterConfig {
  listen_address: string;
  max_connections?: number | null;
  policy_bank_mapping: Record<string, string>;
}

export interface AmavisMilterStatus {
  active: boolean;
  listen_address?: string | null;
  connections_current: number;
  connections_total: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════════

export interface AmavisLogEntry {
  timestamp: string;
  level: string;
  message: string;
  mail_id?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface AmavisLogQuery {
  lines?: number | null;
  mail_id?: string | null;
  level?: string | null;
}
