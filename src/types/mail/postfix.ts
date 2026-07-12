// Postfix (MTA) sub-tab types — 1:1 mirror of
// src-tauri/crates/sorng-postfix/src/types.rs (t42 Wave M, mail panel).
//
// SERDE NOTE: `PostfixConnectionConfig` has NO `#[serde(rename_all)]`, so every
// key is snake_case verbatim — the object passed to `postfix_connect` uses these
// keys as-is (`ssh_user`, `postfix_bin`, `timeout_secs`, ...). The domain enums
// (DomainType, AliasType, QueueName, TlsPolicy, RestrictionStage, MapType) DO
// carry `rename_all = "snake_case"`, so their wire values are the snake_case
// strings mirrored below.

import type { MailSshConnectionFields } from "./index";

// ── Connection ───────────────────────────────────────────────────────────────

/** Config for `postfix_connect`. SSH transport base + postfix binary/dir paths.
 *  All keys snake_case (mirrors `PostfixConnectionConfig`, no serde rename). */
export interface PostfixConnectionConfig extends MailSshConnectionFields {
  /** Path to the postfix binary (default `/usr/sbin/postfix`). */
  postfix_bin?: string;
  /** Postfix config directory (default `/etc/postfix`). */
  config_dir?: string;
  /** Postfix queue directory (default `/var/spool/postfix`). */
  queue_dir?: string;
}

export interface PostfixConnectionSummary {
  host: string;
  version?: string | null;
  mail_name?: string | null;
  mydomain?: string | null;
  myorigin?: string | null;
}

/** Raw SSH command result (mirrors `SshOutput`). */
export interface SshOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ── Info ─────────────────────────────────────────────────────────────────────

export interface PostfixInfo {
  version: string;
  mail_name?: string | null;
  config_directory: string;
  queue_directory: string;
  daemon_directory?: string | null;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface PostfixMainCfParam {
  name: string;
  value: string;
  default_value?: string | null;
  is_default: boolean;
}

export interface PostfixMasterCfEntry {
  service_name: string;
  service_type: string;
  private_flag?: string | null;
  unpriv?: string | null;
  chroot?: string | null;
  wakeup?: string | null;
  maxproc?: string | null;
  command: string;
}

export interface ConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

// ── Domains ──────────────────────────────────────────────────────────────────

export type DomainType = "virtual" | "relay" | "local";

export interface PostfixDomain {
  domain: string;
  domain_type: DomainType;
  transport?: string | null;
  description?: string | null;
}

export interface CreateDomainRequest {
  domain: string;
  domain_type: DomainType;
  transport?: string | null;
  description?: string | null;
}

export interface UpdateDomainRequest {
  domain_type?: DomainType | null;
  transport?: string | null;
  description?: string | null;
}

// ── Aliases ──────────────────────────────────────────────────────────────────

export type AliasType = "virtual" | "local";

export interface PostfixAlias {
  address: string;
  recipients: string[];
  alias_type: AliasType;
  enabled: boolean;
}

export interface CreateAliasRequest {
  address: string;
  recipients: string[];
  alias_type: AliasType;
}

export interface UpdateAliasRequest {
  recipients?: string[] | null;
  alias_type?: AliasType | null;
  enabled?: boolean | null;
}

// ── Transports ───────────────────────────────────────────────────────────────

export interface PostfixTransport {
  domain: string;
  transport: string;
  nexthop?: string | null;
  description?: string | null;
}

export interface CreateTransportRequest {
  domain: string;
  transport: string;
  nexthop?: string | null;
  description?: string | null;
}

export interface UpdateTransportRequest {
  transport?: string | null;
  nexthop?: string | null;
  description?: string | null;
}

// ── Queues ───────────────────────────────────────────────────────────────────

export type QueueName = "active" | "deferred" | "hold" | "corrupt" | "incoming";

export interface PostfixQueue {
  queue_name: QueueName;
  count: number;
  size_bytes: number;
}

export interface PostfixQueueEntry {
  queue_id: string;
  sender: string;
  recipients: string[];
  arrival_time?: string | null;
  size: number;
  status: string;
  reason?: string | null;
}

// ── Logs & stats ─────────────────────────────────────────────────────────────

export interface PostfixMailLog {
  timestamp?: string | null;
  hostname?: string | null;
  process?: string | null;
  pid?: number | null;
  queue_id?: string | null;
  message: string;
}

export interface MailStatistics {
  sent: number;
  bounced: number;
  deferred: number;
  rejected: number;
  held: number;
  total: number;
}

// ── TLS ──────────────────────────────────────────────────────────────────────

export type TlsPolicy =
  | "none"
  | "may"
  | "encrypt"
  | "dane"
  | "verify"
  | "secure";

export interface PostfixTlsPolicy {
  domain: string;
  policy: TlsPolicy;
  match_type?: string | null;
  params?: string | null;
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  not_before: string;
  not_after: string;
  fingerprint: string;
  serial: string;
}

// ── Restrictions ─────────────────────────────────────────────────────────────

export type RestrictionStage =
  | "smtpd_relay"
  | "smtpd_recipient"
  | "smtpd_sender"
  | "smtpd_client";

export interface PostfixRestriction {
  name: string;
  stage: RestrictionStage;
  position: number;
}

// ── Maps ─────────────────────────────────────────────────────────────────────

export type MapType = "hash" | "btree" | "regexp" | "pcre" | "lmdb";

export interface PostfixMap {
  name: string;
  map_type: MapType;
  path: string;
  entries_count: number;
}

export interface PostfixMapEntry {
  key: string;
  value: string;
}

// ── SASL ─────────────────────────────────────────────────────────────────────

export interface PostfixSaslAuth {
  mechanisms: string[];
  smtpd_sasl_auth_enable: boolean;
  smtpd_sasl_security_options: string[];
}

// ── Milters ──────────────────────────────────────────────────────────────────

export interface PostfixMilter {
  name: string;
  socket: string;
  flags?: string | null;
  protocol?: string | null;
}
