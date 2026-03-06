//! Shared types for Amavis (amavisd-new) management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisConnectionConfig {
    /// SSH hostname or IP
    pub host: String,
    /// SSH port (default: 22)
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// SSH username
    pub username: String,
    /// SSH password (if not using key-based auth)
    pub password: Option<String>,
    /// Path to SSH private key
    pub private_key: Option<String>,
    /// SSH connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub running: bool,
    pub uptime_secs: Option<u64>,
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
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisMainConfig {
    pub config_file_path: String,
    pub daemon_user: Option<String>,
    pub daemon_group: Option<String>,
    pub max_servers: Option<u32>,
    pub child_timeout: Option<u32>,
    pub log_level: Option<u32>,
    pub syslog_facility: Option<String>,
    pub myhostname: Option<String>,
    pub mydomain: Option<String>,
    pub virus_admin: Option<String>,
    pub spam_admin: Option<String>,
    pub sa_tag_level_deflt: Option<f64>,
    pub sa_tag2_level_deflt: Option<f64>,
    pub sa_kill_level_deflt: Option<f64>,
    pub sa_dsn_cutoff_level: Option<f64>,
    pub final_virus_destiny: Option<String>,
    pub final_banned_destiny: Option<String>,
    pub final_spam_destiny: Option<String>,
    pub final_bad_header_destiny: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisConfigSnippet {
    pub name: String,
    pub path: String,
    pub content: String,
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Banks
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisPolicyBank {
    pub name: String,
    pub description: Option<String>,
    pub bypass_virus_checks: Option<bool>,
    pub bypass_spam_checks: Option<bool>,
    pub bypass_banned_checks: Option<bool>,
    pub bypass_header_checks: Option<bool>,
    pub spam_tag_level: Option<f64>,
    pub spam_tag2_level: Option<f64>,
    pub spam_kill_level: Option<f64>,
    pub spam_dsn_cutoff_level: Option<f64>,
    pub virus_quarantine_to: Option<String>,
    pub spam_quarantine_to: Option<String>,
    pub banned_quarantine_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePolicyBankRequest {
    pub name: String,
    pub description: Option<String>,
    pub bypass_virus_checks: Option<bool>,
    pub bypass_spam_checks: Option<bool>,
    pub bypass_banned_checks: Option<bool>,
    pub bypass_header_checks: Option<bool>,
    pub spam_tag_level: Option<f64>,
    pub spam_tag2_level: Option<f64>,
    pub spam_kill_level: Option<f64>,
    pub spam_dsn_cutoff_level: Option<f64>,
    pub virus_quarantine_to: Option<String>,
    pub spam_quarantine_to: Option<String>,
    pub banned_quarantine_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePolicyBankRequest {
    pub description: Option<String>,
    pub bypass_virus_checks: Option<bool>,
    pub bypass_spam_checks: Option<bool>,
    pub bypass_banned_checks: Option<bool>,
    pub bypass_header_checks: Option<bool>,
    pub spam_tag_level: Option<f64>,
    pub spam_tag2_level: Option<f64>,
    pub spam_kill_level: Option<f64>,
    pub spam_dsn_cutoff_level: Option<f64>,
    pub virus_quarantine_to: Option<String>,
    pub spam_quarantine_to: Option<String>,
    pub banned_quarantine_to: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Banned Files
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisBannedRule {
    pub id: String,
    pub pattern: String,
    pub description: Option<String>,
    pub policy_bank: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBannedRuleRequest {
    pub pattern: String,
    pub description: Option<String>,
    pub policy_bank: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateBannedRuleRequest {
    pub pattern: Option<String>,
    pub description: Option<String>,
    pub policy_bank: Option<String>,
    pub enabled: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Whitelist / Blacklist
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmavisListType {
    SenderWhitelist,
    SenderBlacklist,
    RecipientWhitelist,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisListEntry {
    pub id: String,
    pub list_type: AmavisListType,
    pub address: String,
    pub description: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateListEntryRequest {
    pub list_type: AmavisListType,
    pub address: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateListEntryRequest {
    pub list_type: Option<AmavisListType>,
    pub address: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisListCheckResult {
    pub whitelisted: bool,
    pub blacklisted: bool,
    pub score_modifier: f64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quarantine
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisQuarantineItem {
    pub mail_id: String,
    pub partition_tag: Option<String>,
    pub sender: String,
    pub recipients: Vec<String>,
    pub subject: Option<String>,
    pub spam_level: Option<f64>,
    pub content_type: Option<String>,
    pub time_iso: String,
    pub quarantine_type: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuarantineAction {
    Release,
    Delete,
    Whitelist,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineListRequest {
    pub quarantine_type: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisQuarantineStats {
    pub total_items: u64,
    pub total_size_bytes: u64,
    pub spam_count: u64,
    pub virus_count: u64,
    pub banned_count: u64,
    pub oldest_item_time: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats / Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisStats {
    pub msgs_total: u64,
    pub msgs_clean: u64,
    pub msgs_spam: u64,
    pub msgs_virus: u64,
    pub msgs_banned: u64,
    pub msgs_bad_header: u64,
    pub msgs_unchecked: u64,
    pub avg_process_time_ms: f64,
    pub uptime_secs: u64,
    pub children_active: u32,
    pub children_idle: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisChildProcess {
    pub pid: u32,
    pub state: String,
    pub msgs_processed: u64,
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisThroughput {
    pub msgs_per_minute: f64,
    pub bytes_per_minute: f64,
    pub avg_latency_ms: f64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Process
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisProcessInfo {
    pub pid: Option<u32>,
    pub running: bool,
    pub version: Option<String>,
    pub config_file: Option<String>,
    pub uptime_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmavisProcessAction {
    Start,
    Stop,
    Restart,
    Reload,
    Status,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Milter Integration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisMilterConfig {
    pub listen_address: String,
    pub max_connections: Option<u32>,
    pub policy_bank_mapping: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisMilterStatus {
    pub active: bool,
    pub listen_address: Option<String>,
    pub connections_current: u32,
    pub connections_total: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisLogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub mail_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmavisLogQuery {
    pub lines: Option<u32>,
    pub mail_id: Option<String>,
    pub level: Option<String>,
}
