// mailcow integration — "operations" category types (t42-mailcow-c2):
// Queue, Quarantine & Server. Mirror of the operations structs in
// `src-tauri/crates/sorng-mailcow/src/types.rs` (transport maps, queue,
// quarantine, logs, status, rate limits).
//
// IMPORTANT — this crate is snake_case. Every struct below carries NO
// `#[serde(rename_all)]` server-side, so serde serialises fields with the raw
// Rust snake_case names. Request objects passed to `invoke` MUST use these
// snake_case keys verbatim (`next_hop`, `queue_name`, …). Only the top-level
// command ARGUMENT names (id/transportId/queueName/…) follow Tauri's camelCase
// conversion — struct fields do not. See
// `.orchestration/logs/t42-mailcow-categories.md`.

// ── Transport maps ──────────────────────────────────────────────────────────

/** A postfix sender-dependent transport map entry (`mailcow_*_transport_map`). */
export interface MailcowTransportMap {
  id: number;
  destination: string;
  next_hop: string;
  username: string;
  password: string;
  active: boolean;
  created: string;
  modified: string;
}

/** Body for `mailcow_create_transport_map` (and reused by `update`). */
export interface CreateTransportMapRequest {
  destination: string;
  next_hop: string;
  username?: string;
  password?: string;
  active?: boolean;
}

// ── Queue ───────────────────────────────────────────────────────────────────

/** Aggregate postfix queue counts (`mailcow_get_queue_summary`). */
export interface MailcowQueueSummary {
  active: number;
  deferred: number;
  hold: number;
  incoming: number;
}

/** A single message in a postfix queue (`mailcow_list_queue`). */
export interface MailcowQueueItem {
  queue_name: string;
  queue_id: string;
  sender: string;
  recipients: string;
  arrival_time: string;
  message_size: number;
  reason: string;
}

// ── Quarantine ──────────────────────────────────────────────────────────────

/** A quarantined message (`mailcow_list_quarantine` / `get_quarantine`). The
 *  settings payload for get/update_quarantine_settings is `unknown` (the backend
 *  passes it through as `serde_json::Value`). */
export interface MailcowQuarantineItem {
  id: number;
  qid: string;
  sender: string;
  rcpt: string;
  subject: string;
  score: number;
  action: string;
  created: string;
  notified: boolean;
}

// ── Logs ────────────────────────────────────────────────────────────────────

/** A single log line (`mailcow_get_logs` / `get_api_logs`). */
export interface MailcowLogEntry {
  time: string;
  priority: string;
  message: string;
  program: string;
}

/** Log source for `mailcow_get_logs` (the `logType` arg). Mirrors the lowercase
 *  `MailcowLogType` enum in types.rs. */
export type MailcowLogType =
  | "dovecot"
  | "postfix"
  | "sogo"
  | "rspamd"
  | "autodiscover"
  | "api"
  | "acme"
  | "netfilter"
  | "watchdog";

/** Ordered list of every log source, for building a picker. */
export const MAILCOW_LOG_TYPES: readonly MailcowLogType[] = [
  "postfix",
  "dovecot",
  "rspamd",
  "sogo",
  "autodiscover",
  "api",
  "acme",
  "netfilter",
  "watchdog",
] as const;

// ── Status ──────────────────────────────────────────────────────────────────

/** One docker container's status (`mailcow_get_container_status`). */
export interface MailcowContainerStatus {
  container: string;
  state: string;
  started_at: string;
  health: string;
  image: string;
}

/** System-wide status (`mailcow_get_system_status`). solr/rspamd stats are
 *  returned as `unknown` by their own commands. */
export interface MailcowSystemStatus {
  containers: MailcowContainerStatus[];
  disk_usage?: string | null;
  solr_status?: string | null;
}

/** Fail2ban configuration (`mailcow_get_fail2ban_config` / update). */
export interface MailcowFail2BanConfig {
  ban_time: number;
  max_attempts: number;
  retry_window: number;
  whitelist: string[];
  blacklist: string[];
}

// ── Rate limits ─────────────────────────────────────────────────────────────

/** A rate limit for a mailbox/domain (`mailcow_get_rate_limits`). */
export interface MailcowRateLimit {
  object: string;
  value: string;
  frame: string;
}

/** Body for `mailcow_set_rate_limit`. */
export interface SetRateLimitRequest {
  object: string;
  value: string;
  frame: string;
}
