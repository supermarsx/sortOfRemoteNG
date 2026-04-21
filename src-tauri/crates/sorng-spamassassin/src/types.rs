//! Shared types for SpamAssassin management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamAssassinConnectionConfig {
    /// SSH host for remote SpamAssassin management
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to spamc binary (default: /usr/bin/spamc)
    pub spamc_bin: Option<String>,
    /// Path to spamd binary (default: /usr/sbin/spamd)
    pub spamd_bin: Option<String>,
    /// Path to sa-update binary (default: /usr/bin/sa-update)
    pub sa_update_bin: Option<String>,
    /// Path to sa-learn binary (default: /usr/bin/sa-learn)
    pub sa_learn_bin: Option<String>,
    /// SpamAssassin config directory (default: /etc/spamassassin)
    pub config_dir: Option<String>,
    /// Path to local.cf (default: /etc/spamassassin/local.cf)
    pub local_cf_path: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamAssassinConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub rules_count: Option<u32>,
    pub bayes_status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH Output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rules
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamRule {
    pub name: String,
    pub score: f64,
    pub description: String,
    /// Area / category the rule belongs to (e.g. "BODY", "HEADER")
    pub area: String,
    pub enabled: bool,
    pub is_custom: bool,
    /// Test type: header, body, rawbody, full, uri, meta, eval
    pub test_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamRuleScore {
    pub name: String,
    pub score: f64,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomRuleRequest {
    pub name: String,
    /// Rule type: header, body, rawbody, full, uri, meta, eval
    pub rule_type: String,
    pub pattern: String,
    pub score: f64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRuleScoreRequest {
    pub score: f64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bayes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BayesStatus {
    pub nspam: u64,
    pub nham: u64,
    pub ntokens: u64,
    pub oldest_token: Option<String>,
    pub newest_token: Option<String>,
    pub last_journal_sync: Option<String>,
    pub last_expire: Option<String>,
    pub last_expire_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BayesLearnResult {
    pub messages_learned: u64,
    pub messages_skipped: u64,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scanning
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamCheckResult {
    pub is_spam: bool,
    pub score: f64,
    pub threshold: f64,
    pub rules_hit: Vec<SpamRuleHit>,
    pub report: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamRuleHit {
    pub name: String,
    pub score: f64,
    pub description: String,
    pub area: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Channels
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamChannel {
    pub name: String,
    pub channel_type: String,
    pub url: Option<String>,
    pub key: Option<String>,
    pub last_update: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelUpdateResult {
    pub channel: String,
    pub success: bool,
    pub rules_updated: u32,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trusted Networks / Whitelist / Blacklist
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamTrustedNetwork {
    pub network: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamWhitelistEntry {
    /// Entry type: whitelist_from, blacklist_from, whitelist_to,
    /// more_spam_to, all_spam_to
    pub entry_type: String,
    pub pattern: String,
    pub comment: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamPlugin {
    pub name: String,
    pub enabled: bool,
    pub description: String,
    pub config: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// spamd Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamdConfig {
    pub listen_address: Option<String>,
    pub port: Option<u16>,
    pub max_children: Option<u32>,
    pub min_children: Option<u32>,
    pub min_spare: Option<u32>,
    pub max_spare: Option<u32>,
    pub timeout_child: Option<u32>,
    pub pidfile: Option<String>,
    pub allowed_ips: Vec<String>,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamdStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub children: u32,
    pub connections_served: u64,
    pub uptime_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamAssassinInfo {
    pub version: String,
    pub rules_version: Option<String>,
    pub config_path: String,
    pub local_cf: String,
    pub user_prefs_path: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Test
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamLog {
    pub timestamp: Option<String>,
    pub hostname: Option<String>,
    pub process: Option<String>,
    pub pid: Option<u32>,
    pub message_id: Option<String>,
    pub score: Option<f64>,
    pub threshold: Option<f64>,
    pub result: Option<String>,
    pub rules_hit: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamStatistics {
    pub total_scanned: u64,
    pub spam_count: u64,
    pub ham_count: u64,
    pub avg_score: f64,
    pub avg_scan_time_ms: f64,
}
