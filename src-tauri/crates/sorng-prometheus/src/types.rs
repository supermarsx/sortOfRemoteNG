//! Shared types for Prometheus management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub api_url: Option<String>,
    pub api_user: Option<String>,
    pub api_password: Option<String>,
    pub use_tls: Option<bool>,
    pub config_path: Option<String>,
    pub data_dir: Option<String>,
    pub service_name: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub api_url: String,
    pub up: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Targets
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Target {
    pub job: String,
    pub instance: String,
    pub labels: HashMap<String, String>,
    pub scrape_url: String,
    pub state: String,
    pub last_scrape: Option<String>,
    pub last_error: Option<String>,
    pub health: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMetadata {
    pub target: HashMap<String, String>,
    pub metric: String,
    pub metric_type: String,
    pub help: String,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetHealth {
    pub instance: String,
    pub job: String,
    pub health: String,
    pub last_scrape: Option<String>,
    pub scrape_duration_seconds: Option<f64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDiscovery {
    pub name: String,
    pub discovery_type: String,
    pub labels: HashMap<String, String>,
    pub targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroppedTarget {
    pub job: String,
    pub discovered_labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddStaticTargetRequest {
    pub job: String,
    pub targets: Vec<String>,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelabelTargetRequest {
    pub job: String,
    pub instance: String,
    pub new_labels: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scrape
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapeConfig {
    pub job_name: String,
    pub scrape_interval: Option<String>,
    pub scrape_timeout: Option<String>,
    pub metrics_path: Option<String>,
    pub scheme: Option<String>,
    pub static_configs: Vec<StaticConfig>,
    pub relabel_configs: Vec<serde_json::Value>,
    pub honor_labels: Option<bool>,
    pub honor_timestamps: Option<bool>,
    pub params: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticConfig {
    pub targets: Vec<String>,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapePool {
    pub name: String,
    pub target_count: u64,
    pub active_count: u64,
    pub dropped_count: u64,
    pub last_scrape: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapeStats {
    pub job: String,
    pub total_scrapes: u64,
    pub failed_scrapes: u64,
    pub avg_duration_seconds: f64,
    pub last_scrape_duration: Option<f64>,
    pub samples_scraped: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapeJob {
    pub job_name: String,
    pub health: String,
    pub target_count: u64,
    pub scrape_interval: String,
    pub scrape_timeout: String,
    pub last_scrape: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddScrapeConfigRequest {
    pub config: ScrapeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateScrapeConfigRequest {
    pub config: ScrapeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetScrapeIntervalRequest {
    pub job_name: String,
    pub interval: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub name: String,
    pub group: String,
    pub query: String,
    pub duration: Option<String>,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub state: String,
    pub health: String,
    pub last_evaluation: Option<String>,
    pub evaluation_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveAlert {
    pub name: String,
    pub labels: HashMap<String, String>,
    pub annotations: HashMap<String, String>,
    pub state: String,
    pub value: String,
    pub active_at: Option<String>,
    pub fired_at: Option<String>,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertGroup {
    pub name: String,
    pub file: String,
    pub rules: Vec<AlertRule>,
    pub interval: Option<String>,
    pub last_evaluation: Option<String>,
    pub evaluation_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Silence {
    pub id: String,
    pub matchers: Vec<SilenceMatcher>,
    pub starts_at: String,
    pub ends_at: String,
    pub created_by: String,
    pub comment: String,
    pub status: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceMatcher {
    pub name: String,
    pub value: String,
    pub is_regex: bool,
    pub is_equal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertReceiver {
    pub name: String,
    pub receiver_type: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertInhibition {
    pub source_matchers: Vec<String>,
    pub target_matchers: Vec<String>,
    pub equal: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertmanagerStatus {
    pub version: String,
    pub uptime: Option<String>,
    pub cluster_status: Option<String>,
    pub config_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub group: String,
    pub name: String,
    pub query: String,
    pub duration: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub annotations: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAlertRuleRequest {
    pub group: String,
    pub name: String,
    pub query: Option<String>,
    pub duration: Option<String>,
    pub labels: Option<HashMap<String, String>>,
    pub annotations: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSilenceRequest {
    pub matchers: Vec<SilenceMatcher>,
    pub starts_at: String,
    pub ends_at: String,
    pub created_by: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAlertmanagerConfigRequest {
    pub config_yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestAlertReceiverRequest {
    pub receiver_name: String,
    pub alert: Option<ActiveAlert>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recording Rules
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingRule {
    pub name: String,
    pub group: String,
    pub query: String,
    pub labels: HashMap<String, String>,
    pub health: String,
    pub last_evaluation: Option<String>,
    pub evaluation_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleGroup {
    pub name: String,
    pub file: String,
    pub interval: Option<String>,
    pub rules: Vec<serde_json::Value>,
    pub last_evaluation: Option<String>,
    pub evaluation_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleEvalStats {
    pub group_name: String,
    pub rule_name: String,
    pub rule_type: String,
    pub evaluations_total: u64,
    pub evaluation_failures_total: u64,
    pub last_duration_seconds: f64,
    pub average_duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecordingRuleRequest {
    pub group: String,
    pub name: String,
    pub query: String,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecordingRuleRequest {
    pub group: String,
    pub name: String,
    pub query: Option<String>,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRuleGroupRequest {
    pub name: String,
    pub interval: Option<String>,
    pub rules: Vec<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub result_type: String,
    pub result: Vec<serde_json::Value>,
    pub stats: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangeQueryResult {
    pub result_type: String,
    pub result: Vec<serde_json::Value>,
    pub stats: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangeQueryRequest {
    pub query: String,
    pub start: String,
    pub end: String,
    pub step: Option<String>,
    pub timeout: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exemplar {
    pub series_labels: HashMap<String, String>,
    pub exemplars: Vec<ExemplarData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExemplarData {
    pub labels: HashMap<String, String>,
    pub value: String,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricMetadata {
    pub metric_name: String,
    pub metric_type: String,
    pub help: String,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteSeriesRequest {
    pub matchers: Vec<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExemplarQueryRequest {
    pub query: String,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesQueryRequest {
    pub matchers: Vec<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TSDB
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TsdbStatus {
    pub head_stats: HeadStats,
    pub series_count_by_metric_name: Vec<MetricCount>,
    pub label_value_count_by_label_name: Vec<LabelCount>,
    pub memory_in_bytes_by_label_name: Vec<LabelCount>,
    pub series_count_by_label_value_pair: Vec<MetricCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricCount {
    pub name: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelCount {
    pub name: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TsdbStats {
    pub num_series: u64,
    pub num_label_pairs: u64,
    pub chunk_count: u64,
    pub min_time: i64,
    pub max_time: i64,
    pub num_samples: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadStats {
    pub num_series: u64,
    pub num_label_pairs: u64,
    pub chunk_count: u64,
    pub min_time: i64,
    pub max_time: i64,
    pub num_chunks: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockInfo {
    pub ulid: String,
    pub min_time: i64,
    pub max_time: i64,
    pub num_series: u64,
    pub num_samples: u64,
    pub num_chunks: u64,
    pub size_bytes: u64,
    pub compaction_level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalStatus {
    pub current_segment: u64,
    pub storage_size_bytes: u64,
    pub corruptions_total: u64,
    pub failed_flushes_total: u64,
    pub completed_pages_total: u64,
    pub truncations_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStats {
    pub total_bytes: u64,
    pub block_bytes: u64,
    pub wal_bytes: u64,
    pub checkpoint_bytes: Option<u64>,
    pub tombstone_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionConfig {
    pub time_retention: Option<String>,
    pub size_retention: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRetentionConfigRequest {
    pub time_retention: Option<String>,
    pub size_retention: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub created_at: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Federation
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationTarget {
    pub name: String,
    pub url: String,
    pub match_params: Vec<String>,
    pub honor_labels: Option<bool>,
    pub params: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteReadConfig {
    pub name: Option<String>,
    pub url: String,
    pub read_recent: Option<bool>,
    pub required_matchers: Option<HashMap<String, String>>,
    pub remote_timeout: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteWriteConfig {
    pub name: Option<String>,
    pub url: String,
    pub remote_timeout: Option<String>,
    pub write_relabel_configs: Vec<serde_json::Value>,
    pub queue_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteWriteStats {
    pub name: String,
    pub url: String,
    pub samples_total: u64,
    pub failed_samples_total: u64,
    pub retried_samples_total: u64,
    pub enqueue_retries_total: u64,
    pub sent_bytes_total: u64,
    pub highest_sent_timestamp: Option<f64>,
    pub pending_samples: u64,
    pub shard_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddFederationTargetRequest {
    pub target: FederationTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRemoteReadRequest {
    pub config: RemoteReadConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRemoteWriteRequest {
    pub config: RemoteWriteConfig,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config / Runtime
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusConfig {
    pub yaml: String,
    pub loaded_config_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub start_time: String,
    pub cwd: String,
    pub reload_config_success: bool,
    pub last_config_time: Option<String>,
    pub goroutine_count: Option<u64>,
    pub gomaxprocs: Option<u64>,
    pub gogc: Option<String>,
    pub godebug: Option<String>,
    pub storage_retention: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildInfo {
    pub version: String,
    pub revision: String,
    pub branch: String,
    pub build_user: String,
    pub build_date: String,
    pub go_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub healthy: bool,
    pub ready: bool,
    pub started: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrometheusFlags {
    pub flags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidateConfigRequest {
    pub config_yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfigFileRequest {
    pub content: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Management
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub active: bool,
    pub state: String,
    pub pid: Option<u32>,
    pub uptime: Option<String>,
    pub memory_usage: Option<String>,
    pub cpu_usage: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceLog {
    pub timestamp: Option<String>,
    pub level: Option<String>,
    pub message: String,
    pub caller: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceLogQuery {
    pub lines: Option<u32>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub grep: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
}
