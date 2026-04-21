//! Shared types for ClamAV management.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClamavConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to clamscan binary (default: /usr/bin/clamscan)
    pub clamscan_bin: Option<String>,
    /// Path to clamdscan binary (default: /usr/bin/clamdscan)
    pub clamdscan_bin: Option<String>,
    /// Path to clamd binary (default: /usr/sbin/clamd)
    pub clamd_bin: Option<String>,
    /// Path to freshclam binary (default: /usr/bin/freshclam)
    pub freshclam_bin: Option<String>,
    /// Path to clamd.conf (default: /etc/clamav/clamd.conf)
    pub clamd_conf: Option<String>,
    /// Path to freshclam.conf (default: /etc/clamav/freshclam.conf)
    pub freshclam_conf: Option<String>,
    /// Path to clamd socket (default: /var/run/clamav/clamd.ctl)
    pub clamd_socket: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClamavConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub database_version: Option<String>,
    pub signature_count: Option<u64>,
    pub last_update: Option<String>,
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
// Scanning
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub file_path: String,
    /// "clean", "infected", or "error"
    pub result: String,
    pub virus_name: Option<String>,
    pub scan_time_ms: u64,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSummary {
    pub files_scanned: u64,
    pub infected_files: u64,
    pub data_scanned_mb: f64,
    pub scan_time_secs: f64,
    pub results: Vec<ScanResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRequest {
    pub path: String,
    pub recursive: Option<bool>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    pub max_filesize_mb: Option<u64>,
    pub max_scansize_mb: Option<u64>,
    pub max_files: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub version: Option<String>,
    pub signatures: Option<u64>,
    pub build_time: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseUpdateResult {
    pub database: String,
    pub success: bool,
    pub new_version: Option<String>,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClamdConfig {
    pub key: String,
    pub value: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreshclamConfig {
    pub key: String,
    pub value: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Clamd Stats
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClamdStats {
    pub pools: u32,
    pub state: String,
    pub threads_live: u32,
    pub threads_idle: u32,
    pub threads_max: u32,
    pub queue_items: u32,
    pub memory_used: u64,
    pub malware_detected: u64,
    pub bytes_scanned: u64,
    pub uptime_secs: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quarantine
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineEntry {
    pub id: String,
    pub original_path: String,
    pub virus_name: String,
    pub quarantine_path: String,
    pub quarantined_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineStats {
    pub total_items: u64,
    pub total_size_bytes: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// On-Access
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnAccessConfig {
    pub enabled: bool,
    #[serde(default)]
    pub mount_path: Vec<String>,
    #[serde(default)]
    pub include_paths: Vec<String>,
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    #[serde(default)]
    pub exclude_users: Vec<String>,
    /// "notify" or "deny"
    pub action: String,
    pub max_file_size_mb: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Milter
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilterConfig {
    pub enabled: bool,
    pub socket: String,
    pub condition: Option<String>,
    pub add_header: Option<bool>,
    pub reject_infected: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scheduled Scans
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledScan {
    pub id: String,
    pub name: String,
    pub path: String,
    pub schedule_cron: String,
    pub recursive: bool,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub last_result: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ClamAV Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClamavInfo {
    pub version: String,
    pub database_version: Option<String>,
    pub signature_count: Option<u64>,
    pub engine_version: Option<String>,
    pub clamd_running: bool,
    pub freshclam_running: bool,
}
