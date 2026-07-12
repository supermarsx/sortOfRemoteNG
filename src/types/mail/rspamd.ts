// Rspamd (spam filter) — sub-tab types for the unified Mail Server panel
// (t42 Wave M, crate `sorng-rspamd`). 1:1 mirror of the crate's `types.rs`.
//
// Unlike the 6 SSH-managed mail crates, rspamd talks to its HTTP controller
// (web interface) API, so its config is `base_url` + optional controller
// `password` — NOT the shared `MailSshConnectionFields`. The config struct has
// NO `#[serde(rename_all)]`, so the object passed to `rspamd_connect` uses these
// snake_case keys verbatim.

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/** Config passed to `rspamd_connect` (snake_case wire shape, mirrors
 *  `RspamdConnectionConfig`). */
export interface RspamdConnectionConfig {
  /** Rspamd web interface / controller URL (default: http://localhost:11334). */
  base_url: string;
  /** Controller password for authenticated endpoints. */
  password?: string;
  /** Request timeout in seconds. */
  timeout_secs?: number;
  /** Skip TLS certificate verification. */
  tls_skip_verify?: boolean;
}

export interface RspamdConnectionSummary {
  host: string;
  version?: string | null;
  config_id?: string | null;
  uptime_secs?: number | null;
  scanned?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scanning
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdScanResult {
  is_spam: boolean;
  is_skipped: boolean;
  score: number;
  required_score: number;
  action: string;
  symbols: RspamdSymbolResult[];
  message_id?: string | null;
  urls: string[];
  emails: string[];
  subject?: string | null;
}

export interface RspamdSymbolResult {
  name: string;
  score: number;
  weight?: number | null;
  description?: string | null;
  options: string[];
  metric_score?: number | null;
}

export interface RspamdBayesLearnResult {
  success: boolean;
  message?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdStat {
  scanned: number;
  learned: number;
  spam_count: number;
  ham_count: number;
  connections: number;
  control_connections: number;
  pools_allocated: number;
  pools_freed: number;
  bytes_allocated: number;
  chunks_allocated: number;
  shared_chunks_allocated: number;
  chunks_oversized: number;
  fuzzy_hashes: Record<string, RspamdFuzzyHash>;
  statfiles: RspamdStatfile[];
}

export interface RspamdFuzzyHash {
  version?: number | null;
  size?: number | null;
  buckets?: number | null;
}

export interface RspamdStatfile {
  symbol: string;
  type_name?: string | null;
  size?: number | null;
  used?: number | null;
  total?: number | null;
  languages?: number | null;
  users?: number | null;
}

export interface RspamdGraphData {
  label: string;
  data: number[][];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdAction {
  name: string;
  threshold?: number | null;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Symbols
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdSymbol {
  name: string;
  group?: string | null;
  description?: string | null;
  weight?: number | null;
  score?: number | null;
  is_composite?: boolean | null;
  is_virtual?: boolean | null;
  enabled: boolean;
}

export interface RspamdSymbolGroup {
  name: string;
  description?: string | null;
  symbols: string[];
  max_score?: number | null;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Maps
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdMap {
  id: number;
  uri: string;
  description?: string | null;
  /** One of: regexp, radix, hash, glob, cdb. */
  map_type?: string | null;
  entries_count?: number | null;
  hits?: number | null;
  last_reload?: string | null;
}

export interface RspamdMapEntry {
  key: string;
  value?: string | null;
  hits?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workers
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdWorker {
  id: string;
  /** One of: normal, controller, rspamd_proxy, fuzzy. */
  worker_type?: string | null;
  pid?: number | null;
  status?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdHistory {
  rows: RspamdHistoryEntry[];
}

export interface RspamdHistoryEntry {
  id?: string | null;
  timestamp?: number | null;
  ip?: string | null;
  action?: string | null;
  score?: number | null;
  required_score?: number | null;
  symbols: string[];
  size?: number | null;
  scan_time_ms?: number | null;
  user?: string | null;
  message_id?: string | null;
  subject?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Neighbours
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdNeighbour {
  name: string;
  host: string;
  version?: string | null;
  is_self?: boolean | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzzy
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdFuzzyStatus {
  name: string;
  version?: number | null;
  size?: number | null;
  buckets?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

export interface RspamdPlugin {
  name: string;
  enabled: boolean;
  description?: string | null;
}
