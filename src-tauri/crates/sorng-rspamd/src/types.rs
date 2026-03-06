//! Shared types for Rspamd server management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdConnectionConfig {
    /// Rspamd web interface / controller URL (default: http://localhost:11334)
    #[serde(default = "default_base_url")]
    pub base_url: String,
    /// Controller password for authenticated endpoints
    pub password: Option<String>,
    /// Request timeout in seconds
    pub timeout_secs: Option<u64>,
    /// Skip TLS certificate verification
    pub tls_skip_verify: Option<bool>,
}

fn default_base_url() -> String {
    "http://localhost:11334".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub config_id: Option<String>,
    pub uptime_secs: Option<u64>,
    pub scanned: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scanning
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdScanResult {
    pub is_spam: bool,
    pub is_skipped: bool,
    pub score: f64,
    pub required_score: f64,
    pub action: String,
    pub symbols: Vec<RspamdSymbolResult>,
    pub message_id: Option<String>,
    pub urls: Vec<String>,
    pub emails: Vec<String>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdSymbolResult {
    pub name: String,
    pub score: f64,
    pub weight: Option<f64>,
    pub description: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
    pub metric_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdBayesLearnResult {
    pub success: bool,
    pub message: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdStat {
    pub scanned: u64,
    pub learned: u64,
    pub spam_count: u64,
    pub ham_count: u64,
    pub connections: u64,
    pub control_connections: u64,
    pub pools_allocated: u64,
    pub pools_freed: u64,
    pub bytes_allocated: u64,
    pub chunks_allocated: u64,
    pub shared_chunks_allocated: u64,
    pub chunks_oversized: u64,
    #[serde(default)]
    pub fuzzy_hashes: HashMap<String, RspamdFuzzyHash>,
    #[serde(default)]
    pub statfiles: Vec<RspamdStatfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdFuzzyHash {
    pub version: Option<u64>,
    pub size: Option<u64>,
    pub buckets: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdStatfile {
    pub symbol: String,
    pub type_name: Option<String>,
    pub size: Option<u64>,
    pub used: Option<u64>,
    pub total: Option<u64>,
    pub languages: Option<u64>,
    pub users: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdGraphData {
    pub label: String,
    pub data: Vec<Vec<f64>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdAction {
    pub name: String,
    pub threshold: Option<f64>,
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Symbols
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdSymbol {
    pub name: String,
    pub group: Option<String>,
    pub description: Option<String>,
    pub weight: Option<f64>,
    pub score: Option<f64>,
    pub is_composite: Option<bool>,
    pub is_virtual: Option<bool>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdSymbolGroup {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
    pub max_score: Option<f64>,
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Maps
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdMap {
    pub id: u64,
    pub uri: String,
    pub description: Option<String>,
    /// One of: regexp, radix, hash, glob, cdb
    pub map_type: Option<String>,
    pub entries_count: Option<u64>,
    pub hits: Option<u64>,
    pub last_reload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdMapEntry {
    pub key: String,
    pub value: Option<String>,
    pub hits: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdWorker {
    pub id: String,
    /// One of: normal, controller, rspamd_proxy, fuzzy
    pub worker_type: Option<String>,
    pub pid: Option<u64>,
    pub status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdHistory {
    pub rows: Vec<RspamdHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdHistoryEntry {
    pub id: Option<String>,
    pub timestamp: Option<f64>,
    pub ip: Option<String>,
    pub action: Option<String>,
    pub score: Option<f64>,
    pub required_score: Option<f64>,
    #[serde(default)]
    pub symbols: Vec<String>,
    pub size: Option<u64>,
    pub scan_time_ms: Option<f64>,
    pub user: Option<String>,
    pub message_id: Option<String>,
    pub subject: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Neighbours
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdNeighbour {
    pub name: String,
    pub host: String,
    pub version: Option<String>,
    pub is_self: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzzy
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdFuzzyStatus {
    pub name: String,
    pub version: Option<u64>,
    pub size: Option<u64>,
    pub buckets: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RspamdPlugin {
    pub name: String,
    pub enabled: bool,
    pub description: Option<String>,
}
