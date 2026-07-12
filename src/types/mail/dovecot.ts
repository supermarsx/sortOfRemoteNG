// Dovecot (IMAP/POP3) types — 1:1 mirror of
// `src-tauri/crates/sorng-dovecot/src/types.rs` (t42 Wave M, sub-tab
// t42-mail-dovecot).
//
// Every struct in the crate is plain snake_case (NO `#[serde(rename_all)]`), so
// these field names are the wire shape: the `config` passed to `dovecot_connect`
// and every request body uses these keys verbatim. Only the top-level command ARG
// names (`id`, `config`, `oldName`, …) follow Tauri's camelCase conversion — see
// `useDovecot.ts`.

import type { MailSshConnectionFields } from "./index";

// ── Connection ───────────────────────────────────────────────────────────────

/** Snake_case connection config for `dovecot_connect`. Extends the shared SSH
 *  transport base with Dovecot's binary/config-dir paths. */
export interface DovecotConnectionConfig extends MailSshConnectionFields {
  /** Path to `doveadm` (default `/usr/bin/doveadm`). */
  doveadm_bin?: string;
  /** Path to the `dovecot` binary (default `/usr/sbin/dovecot`). */
  dovecot_bin?: string;
  /** Dovecot config directory (default `/etc/dovecot`). */
  config_dir?: string;
}

export interface DovecotConnectionSummary {
  host: string;
  version?: string;
  protocols: string[];
  auth_mechanisms: string[];
  mail_location?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface DovecotUser {
  username: string;
  uid?: number;
  gid?: number;
  home?: string;
  mail_location?: string;
  quota_rule?: string;
  password_hash?: string;
  extra_fields: Record<string, string>;
}

export interface CreateUserRequest {
  username: string;
  password?: string;
  uid?: number;
  gid?: number;
  home?: string;
  mail_location?: string;
  quota_rule?: string;
  extra_fields?: Record<string, string>;
}

export interface UpdateUserRequest {
  password?: string;
  uid?: number;
  gid?: number;
  home?: string;
  mail_location?: string;
  quota_rule?: string;
  extra_fields?: Record<string, string>;
}

// ── Mailboxes ────────────────────────────────────────────────────────────────

export interface DovecotMailbox {
  user: string;
  name: string;
  messages: number;
  unseen: number;
  recent: number;
  uidvalidity: number;
  uidnext: number;
  vsize: number;
  guid?: string;
}

export interface DovecotMailboxStatus {
  mailbox: string;
  messages: number;
  recent: number;
  unseen: number;
  uidvalidity: number;
  uidnext: number;
  highestmodseq: number;
}

// ── Namespaces ───────────────────────────────────────────────────────────────

export interface DovecotNamespace {
  name: string;
  /** private, shared, or public */
  namespace_type: string;
  prefix?: string;
  separator?: string;
  inbox: boolean;
  hidden: boolean;
  list: boolean;
  subscriptions: boolean;
  location?: string;
}

// ── Sieve ────────────────────────────────────────────────────────────────────

export interface DovecotSieveScript {
  name: string;
  active: boolean;
  content?: string;
  size_bytes?: number;
  last_modified?: string;
}

export interface CreateSieveRequest {
  name: string;
  content: string;
  activate?: boolean;
}

export interface UpdateSieveRequest {
  content?: string;
  activate?: boolean;
}

// ── Quota ────────────────────────────────────────────────────────────────────

export interface DovecotQuota {
  user: string;
  storage_limit?: number;
  storage_used: number;
  message_limit?: number;
  message_used: number;
  percent_used: number;
}

export interface DovecotQuotaRule {
  rule: string;
  storage_limit_mb?: number;
  message_limit?: number;
}

// ── Authentication ───────────────────────────────────────────────────────────

export interface DovecotAuthConfig {
  mechanisms: string[];
  passdb_drivers: string[];
  userdb_drivers: string[];
  auth_verbose: boolean;
  auth_debug: boolean;
}

export interface DovecotPassdbEntry {
  /** pam, sql, ldap, passwd, static */
  driver: string;
  args?: string;
  deny: boolean;
  master: boolean;
  pass: boolean;
}

export interface DovecotUserdbEntry {
  /** sql, ldap, passwd, static */
  driver: string;
  args?: string;
  default_fields?: string;
  override_fields?: string;
}

// ── Services / Listeners ─────────────────────────────────────────────────────

export interface DovecotService {
  name: string;
  listeners: DovecotListener[];
  process_min_avail?: number;
  process_limit?: number;
  vsz_limit?: string;
}

export interface DovecotListener {
  /** inet, unix, or fifo */
  listener_type: string;
  path_or_address: string;
  port?: number;
  mode?: string;
  user?: string;
  group?: string;
}

// ── Plugins ──────────────────────────────────────────────────────────────────

export interface DovecotPlugin {
  name: string;
  enabled: boolean;
  settings: Record<string, string>;
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export interface DovecotLog {
  timestamp?: string;
  level?: string;
  process?: string;
  pid?: number;
  message: string;
}

// ── Stats / Processes ────────────────────────────────────────────────────────

export interface DovecotStats {
  user?: string;
  command: string;
  count: number;
  last_used?: string;
  bytes_in: number;
  bytes_out: number;
}

export interface DovecotProcess {
  pid: number;
  service: string;
  user?: string;
  ip?: string;
  state?: string;
  uptime_secs?: number;
}

// ── Replication ──────────────────────────────────────────────────────────────

export interface DovecotReplication {
  user: string;
  priority?: string;
  last_fast_sync?: string;
  last_full_sync?: string;
  status?: string;
}

// ── Info / Config Test ───────────────────────────────────────────────────────

export interface DovecotInfo {
  version: string;
  protocols: string[];
  ssl_library?: string;
  mail_plugins: string[];
  auth_mechanisms: string[];
  config_path: string;
}

export interface ConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

// ── ACL ──────────────────────────────────────────────────────────────────────

export interface DovecotAcl {
  mailbox: string;
  identifier: string;
  rights: string[];
}

// ── Config Params ────────────────────────────────────────────────────────────

export interface DovecotConfigParam {
  name: string;
  value: string;
  section?: string;
  filename?: string;
}
