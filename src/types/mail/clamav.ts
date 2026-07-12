// ClamAV (antivirus) sub-tab types — 1:1 mirror of
// src-tauri/crates/sorng-clamav/src/types.rs (t42 Wave M, mail panel).
//
// The ConnectionConfig struct carries NO `#[serde(rename_all)]`, so every field
// is snake_case on the wire — mirror them verbatim here; the object passed to
// `clamav_connect` uses these keys as-is. The SSH transport head is shared with
// the other 5 SSH-managed mail crates via `MailSshConnectionFields`.

import type { MailSshConnectionFields } from "./index";

// ─── Connection ──────────────────────────────────────────────────────────────

/** Mirrors `ClamavConnectionConfig` — SSH transport + the 4 binary paths, 2
 *  config-file paths and the clamd socket path (all optional, server-side
 *  defaults documented inline). snake_case verbatim. */
export interface ClamavConnectionConfig extends MailSshConnectionFields {
  /** Path to clamscan binary (default: /usr/bin/clamscan). */
  clamscan_bin?: string;
  /** Path to clamdscan binary (default: /usr/bin/clamdscan). */
  clamdscan_bin?: string;
  /** Path to clamd binary (default: /usr/sbin/clamd). */
  clamd_bin?: string;
  /** Path to freshclam binary (default: /usr/bin/freshclam). */
  freshclam_bin?: string;
  /** Path to clamd.conf (default: /etc/clamav/clamd.conf). */
  clamd_conf?: string;
  /** Path to freshclam.conf (default: /etc/clamav/freshclam.conf). */
  freshclam_conf?: string;
  /** Path to the clamd socket (default: /var/run/clamav/clamd.ctl). */
  clamd_socket?: string;
}

/** Mirrors `ClamavConnectionSummary` — returned by `clamav_connect`. */
export interface ClamavConnectionSummary {
  host: string;
  version?: string | null;
  database_version?: string | null;
  signature_count?: number | null;
  last_update?: string | null;
}

// ─── Scanning ────────────────────────────────────────────────────────────────

/** Mirrors `ScanResult` — one file's outcome. `result` is "clean" | "infected"
 *  | "error". */
export interface ClamavScanResult {
  file_path: string;
  result: string;
  virus_name?: string | null;
  scan_time_ms: number;
  size_bytes?: number | null;
}

/** Mirrors `ScanSummary` — an aggregate scan result set. */
export interface ClamavScanSummary {
  files_scanned: number;
  infected_files: number;
  data_scanned_mb: number;
  scan_time_secs: number;
  results: ClamavScanResult[];
}

/** Mirrors `ScanRequest` — the argument to `clamav_scan`. */
export interface ClamavScanRequest {
  path: string;
  recursive?: boolean | null;
  exclude_patterns?: string[];
  max_filesize_mb?: number | null;
  max_scansize_mb?: number | null;
  max_files?: number | null;
}

// ─── Database ────────────────────────────────────────────────────────────────

/** Mirrors `DatabaseInfo`. */
export interface ClamavDatabaseInfo {
  name: string;
  version?: string | null;
  signatures?: number | null;
  build_time?: string | null;
  updated_at?: string | null;
}

/** Mirrors `DatabaseUpdateResult`. */
export interface ClamavDatabaseUpdateResult {
  database: string;
  success: boolean;
  new_version?: string | null;
  message: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Mirrors `ClamdConfig` — one clamd.conf key/value directive. */
export interface ClamdConfigEntry {
  key: string;
  value: string;
  comment?: string | null;
}

/** Mirrors `FreshclamConfig` — one freshclam.conf key/value directive. */
export interface FreshclamConfigEntry {
  key: string;
  value: string;
  comment?: string | null;
}

/** Mirrors `ConfigTestResult` — output of `clamconf`/config validation. */
export interface ClamavConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

// ─── Clamd stats ─────────────────────────────────────────────────────────────

/** Mirrors `ClamdStats` — the parsed `clamdscan --version`/`STATS` output. */
export interface ClamdStats {
  pools: number;
  state: string;
  threads_live: number;
  threads_idle: number;
  threads_max: number;
  queue_items: number;
  memory_used: number;
  malware_detected: number;
  bytes_scanned: number;
  uptime_secs: number;
}

// ─── Quarantine ──────────────────────────────────────────────────────────────

/** Mirrors `QuarantineEntry`. */
export interface ClamavQuarantineEntry {
  id: string;
  original_path: string;
  virus_name: string;
  quarantine_path: string;
  quarantined_at: string;
  size_bytes: number;
}

/** Mirrors `QuarantineStats`. */
export interface ClamavQuarantineStats {
  total_items: number;
  total_size_bytes: number;
}

// ─── On-access ───────────────────────────────────────────────────────────────

/** Mirrors `OnAccessConfig` — clamd on-access (fanotify) scanning config.
 *  `action` is "notify" | "deny". */
export interface ClamavOnAccessConfig {
  enabled: boolean;
  mount_path?: string[];
  include_paths?: string[];
  exclude_paths?: string[];
  exclude_users?: string[];
  action: string;
  max_file_size_mb?: number | null;
}

// ─── Milter ──────────────────────────────────────────────────────────────────

/** Mirrors `MilterConfig` — the clamav-milter settings. */
export interface ClamavMilterConfig {
  enabled: boolean;
  socket: string;
  condition?: string | null;
  add_header?: boolean | null;
  reject_infected?: boolean | null;
}

// ─── Scheduled scans ─────────────────────────────────────────────────────────

/** Mirrors `ScheduledScan` — a cron-driven scan entry. */
export interface ClamavScheduledScan {
  id: string;
  name: string;
  path: string;
  schedule_cron: string;
  recursive: boolean;
  enabled: boolean;
  last_run?: string | null;
  last_result?: string | null;
}

// ─── Info ────────────────────────────────────────────────────────────────────

/** Mirrors `ClamavInfo` — the overview info blob. */
export interface ClamavInfo {
  version: string;
  database_version?: string | null;
  signature_count?: number | null;
  engine_version?: string | null;
  clamd_running: boolean;
  freshclam_running: boolean;
}
