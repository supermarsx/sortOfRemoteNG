// ── sorng-prometheus/src/types.rs ────────────────────────────────────────────
//! Shared types for Prometheus monitoring.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConnectionConfig {
    /// Hostname or IP of the Prometheus server.
    pub host: String,
    /// Port (default 9090).
    pub port: Option<u16>,
    /// Use HTTPS.
    pub use_tls: Option<bool>,
    /// Accept self-signed certificates.
    pub accept_invalid_certs: Option<bool>,
    /// HTTP basic-auth username.
    pub username: Option<String>,
    /// HTTP basic-auth password.
    pub password: Option<String>,
    /// Bearer token for authorization.
    pub bearer_token: Option<String>,
    /// Connection timeout in seconds (default 30).
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub uptime: Option<String>,
    pub series_count: Option<u64>,
    pub samples_ingested: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query results
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub result_type: String,
    pub data: Vec<QuerySample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuerySample {
    pub metric: HashMap<String, String>,
    /// (timestamp, value_string)
    pub value: (f64, String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangeQueryResult {
    pub result_type: String,
    pub data: Vec<QueryRangeSample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRangeSample {
    pub metric: HashMap<String, String>,
    /// Vec of (timestamp, value_string)
    pub values: Vec<(f64, String)>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Targets
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromTarget {
    pub labels: HashMap<String, String>,
    #[serde(rename = "discoveredLabels")]
    pub discovered_labels: HashMap<String, String>,
    #[serde(rename = "scrapePool")]
    pub scrape_pool: String,
    #[serde(rename = "scrapeUrl")]
    pub scrape_url: String,
    #[serde(rename = "globalUrl")]
    pub global_url: String,
    #[serde(rename = "lastError")]
    pub last_error: String,
    #[serde(rename = "lastScrape")]
    pub last_scrape: String,
    #[serde(rename = "lastScrapeDuration")]
    pub last_scrape_duration: f64,
    pub health: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMetadata {
    pub target: HashMap<String, String>,
    pub metric: String,
    #[serde(rename = "type")]
    pub metric_type: String,
    pub help: String,
    pub unit: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rules & Alerts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub name: String,
    pub query: String,
    pub duration: f64,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub state: String,
    pub health: String,
    #[serde(rename = "lastError", default)]
    pub last_error: String,
    #[serde(default)]
    pub alerts: Vec<Alert>,
    #[serde(rename = "type", default)]
    pub rule_type: String,
    #[serde(rename = "evaluationTime", default)]
    pub evaluation_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub state: String,
    #[serde(rename = "activeAt")]
    pub active_at: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingRule {
    pub name: String,
    pub query: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    pub health: String,
    #[serde(rename = "lastError", default)]
    pub last_error: String,
    #[serde(rename = "evaluationTime", default)]
    pub evaluation_time: f64,
    #[serde(rename = "type", default)]
    pub rule_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleGroup {
    pub name: String,
    pub file: String,
    pub interval: f64,
    pub rules: Vec<serde_json::Value>,
    #[serde(default)]
    pub limit: u64,
    #[serde(rename = "lastEvaluation", default)]
    pub last_evaluation: String,
    #[serde(rename = "evaluationTime", default)]
    pub evaluation_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertManagerInfo {
    #[serde(rename = "activeAlertmanagers")]
    pub active_alertmanagers: Vec<AlertmanagerEntry>,
    #[serde(rename = "droppedAlertmanagers")]
    pub dropped_alertmanagers: Vec<AlertmanagerEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertmanagerEntry {
    pub url: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConfig {
    pub yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigReloadResult {
    pub success: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TSDB
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TsdbStatus {
    #[serde(rename = "headStats")]
    pub head_stats: HeadStats,
    #[serde(rename = "seriesCountByMetricName")]
    pub series_count_by_metric_name: Vec<StatEntry>,
    #[serde(rename = "labelValueCountByLabelName")]
    pub label_value_count_by_label_name: Vec<StatEntry>,
    #[serde(rename = "memoryInBytesByLabelName")]
    pub memory_in_bytes_by_label_name: Vec<StatEntry>,
    #[serde(rename = "seriesCountByLabelValuePair")]
    pub series_count_by_label_value_pair: Vec<StatEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatEntry {
    pub name: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadStats {
    #[serde(rename = "numSeries")]
    pub num_series: u64,
    #[serde(rename = "numLabelPairs")]
    pub num_label_pairs: u64,
    #[serde(rename = "chunkCount")]
    pub chunk_count: u64,
    #[serde(rename = "minTime")]
    pub min_time: i64,
    #[serde(rename = "maxTime")]
    pub max_time: i64,
    #[serde(rename = "numChunks", default)]
    pub num_chunks: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Metadata
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricMetadata {
    #[serde(rename = "type")]
    pub metric_type: String,
    pub help: String,
    pub unit: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Silences (Alertmanager API)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Silence {
    pub id: String,
    pub matchers: Vec<SilenceMatcher>,
    #[serde(rename = "startsAt")]
    pub starts_at: String,
    #[serde(rename = "endsAt")]
    pub ends_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    pub comment: String,
    pub status: SilenceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceStatus {
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceMatcher {
    pub name: String,
    pub value: String,
    #[serde(rename = "isRegex")]
    pub is_regex: bool,
    #[serde(rename = "isEqual")]
    pub is_equal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSilenceRequest {
    pub matchers: Vec<SilenceMatcher>,
    #[serde(rename = "startsAt")]
    pub starts_at: String,
    #[serde(rename = "endsAt")]
    pub ends_at: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    pub comment: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Federation
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationResult {
    /// Raw text-format metrics returned by the /federate endpoint.
    pub metrics: String,
}
