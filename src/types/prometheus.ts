// Prometheus integration types — mirror of
// `src-tauri/crates/sorng-prometheus/src/types.rs`.
//
// Field names follow the EXACT serde wire format of the Rust structs, not a
// blanket camelCase convention: those structs do NOT use `rename_all`, so most
// fields serialize as snake_case (`use_tls`, `bearer_token`, `series_count`, …)
// while a subset carries per-field `#[serde(rename = "...")]` to camelCase
// (`scrapePool`, `lastError`, `startsAt`, …). Getting the connection-config
// field names wrong would silently drop TLS/auth (serde ignores unknown fields
// and defaults Options to None), so this file matches the wire names 1:1.

// ── Connection ──────────────────────────────────────────────────────────────

/** `prometheus_connect` config argument (serde: plain snake_case). */
export interface PrometheusConnectionConfig {
  /** Hostname or IP of the Prometheus server. */
  host: string;
  /** Port (default 9090). */
  port?: number;
  /** Use HTTPS. */
  use_tls?: boolean;
  /** Accept self-signed certificates. */
  accept_invalid_certs?: boolean;
  /** HTTP basic-auth username. */
  username?: string;
  /** HTTP basic-auth password. */
  password?: string;
  /** Bearer token for authorization. */
  bearer_token?: string;
  /** Connection timeout in seconds (default 30). */
  timeout_secs?: number;
  /** Optional HTTP proxy URL supplied from the app-wide proxy setting. */
  proxy_url?: string;
}

export interface PrometheusConnectionSummary {
  host: string;
  version?: string | null;
  uptime?: string | null;
  series_count?: number | null;
  samples_ingested?: number | null;
}

// ── Query results ───────────────────────────────────────────────────────────

/** A single (timestamp, value_string) point. */
export type PromValue = [number, string];

export interface QueryResult {
  result_type: string;
  data: QuerySample[];
}

export interface QuerySample {
  metric: Record<string, string>;
  value: PromValue;
}

export interface RangeQueryResult {
  result_type: string;
  data: QueryRangeSample[];
}

export interface QueryRangeSample {
  metric: Record<string, string>;
  values: PromValue[];
}

// ── Targets ─────────────────────────────────────────────────────────────────

export interface PromTarget {
  labels: Record<string, string>;
  discoveredLabels: Record<string, string>;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  health: string;
}

export interface TargetMetadata {
  target: Record<string, string>;
  metric: string;
  type: string;
  help: string;
  unit: string;
}

// ── Rules & Alerts ──────────────────────────────────────────────────────────

export interface AlertRule {
  name: string;
  query: string;
  duration: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  health: string;
  lastError: string;
  alerts: Alert[];
  type: string;
  evaluationTime: number;
}

export interface Alert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt: string;
  value: string;
}

export interface RecordingRule {
  name: string;
  query: string;
  labels: Record<string, string>;
  health: string;
  lastError: string;
  evaluationTime: number;
  type: string;
}

export interface RuleGroup {
  name: string;
  file: string;
  interval: number;
  /** Raw rule objects (alerting + recording, untyped on the wire). */
  rules: unknown[];
  limit: number;
  lastEvaluation: string;
  evaluationTime: number;
}

export interface AlertManagerInfo {
  activeAlertmanagers: AlertmanagerEntry[];
  droppedAlertmanagers: AlertmanagerEntry[];
}

export interface AlertmanagerEntry {
  url: string;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface PrometheusConfig {
  yaml: string;
}

export interface ConfigReloadResult {
  success: boolean;
}

// ── TSDB ────────────────────────────────────────────────────────────────────

export interface TsdbStatus {
  headStats: HeadStats;
  seriesCountByMetricName: StatEntry[];
  labelValueCountByLabelName: StatEntry[];
  memoryInBytesByLabelName: StatEntry[];
  seriesCountByLabelValuePair: StatEntry[];
}

export interface StatEntry {
  name: string;
  value: number;
}

export interface HeadStats {
  numSeries: number;
  numLabelPairs: number;
  chunkCount: number;
  minTime: number;
  maxTime: number;
  numChunks: number;
}

// ── Metadata ────────────────────────────────────────────────────────────────

export interface MetricMetadata {
  type: string;
  help: string;
  unit: string;
}

// ── Silences (Alertmanager API) ─────────────────────────────────────────────

export interface Silence {
  id: string;
  matchers: SilenceMatcher[];
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  createdBy: string;
  comment: string;
  status: SilenceStatus;
}

export interface SilenceStatus {
  state: string;
}

export interface SilenceMatcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual: boolean;
}

export interface CreateSilenceRequest {
  matchers: SilenceMatcher[];
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

// ── Federation ──────────────────────────────────────────────────────────────

export interface FederationResult {
  /** Raw text-format metrics returned by the /federate endpoint. */
  metrics: string;
}
