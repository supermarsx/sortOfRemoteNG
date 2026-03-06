//! Data types for fail2ban management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Jail ───────────────────────────────────────────────────────────

/// Status of a fail2ban jail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JailStatus {
    Active,
    Inactive,
    Failed,
    Unknown,
}

/// A fail2ban jail configuration and runtime status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jail {
    pub name: String,
    pub status: JailStatus,
    /// Whether the jail is enabled in the config
    pub enabled: bool,
    /// Log file(s) being monitored
    pub logpath: Vec<String>,
    /// Filter name (references /etc/fail2ban/filter.d/<name>.conf)
    pub filter: String,
    /// Action name(s) (references /etc/fail2ban/action.d/<name>.conf)
    pub actions: Vec<String>,
    /// Max retries before ban
    pub maxretry: u32,
    /// Time window for retries (seconds)
    pub findtime: u64,
    /// Ban duration (seconds, -1 = permanent)
    pub bantime: i64,
    /// Currently banned IP count
    pub currently_banned: u64,
    /// Total banned ever
    pub total_banned: u64,
    /// Currently failed count
    pub currently_failed: u64,
    /// Total failed ever
    pub total_failed: u64,
    /// Banned IP list
    pub banned_ips: Vec<String>,
    /// Port(s) being protected
    pub port: Option<String>,
    /// Protocol (tcp/udp/all)
    pub protocol: Option<String>,
    /// Backend (auto, polling, systemd, pyinotify)
    pub backend: Option<String>,
    /// Date pattern for the log parser
    pub datepattern: Option<String>,
    /// Ignore IPs (whitelist — including fail2ban's own)
    pub ignoreip: Vec<String>,
    /// Whether incremental banning is enabled
    pub bantime_increment: bool,
    /// Ban time multiplier factor
    pub bantime_factor: Option<f64>,
    /// Maximum ban time for incremental bans
    pub bantime_maxtime: Option<i64>,
}

// ─── Ban ────────────────────────────────────────────────────────────

/// A single ban record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BanRecord {
    pub ip: String,
    pub jail: String,
    pub banned_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    /// Whether this is currently active
    pub active: bool,
    /// Number of times this IP has been banned in this jail
    pub ban_count: u32,
    /// Country code (if resolved via GeoIP)
    pub country: Option<String>,
    /// Hostname (if reverse-resolved)
    pub hostname: Option<String>,
}

// ─── Filter ─────────────────────────────────────────────────────────

/// A fail2ban filter definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterRule {
    pub name: String,
    /// Failregex patterns (lines that trigger a "failure")
    pub failregex: Vec<String>,
    /// Ignoreregex patterns (lines to ignore)
    pub ignoreregex: Vec<String>,
    /// Date pattern override
    pub datepattern: Option<String>,
    /// Definition section key-value pairs
    pub definition: HashMap<String, String>,
    /// Source file path (if loaded from disk)
    pub source_path: Option<String>,
    /// Which jails reference this filter
    pub used_by: Vec<String>,
}

// ─── Action ─────────────────────────────────────────────────────────

/// A fail2ban action definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDef {
    pub name: String,
    /// Command to start the action (iptables rule, etc.)
    pub actionstart: Option<String>,
    /// Command to stop the action
    pub actionstop: Option<String>,
    /// Command to ban an IP
    pub actionban: Option<String>,
    /// Command to unban an IP
    pub actionunban: Option<String>,
    /// Command to check the action
    pub actioncheck: Option<String>,
    /// Default parameters
    pub defaults: HashMap<String, String>,
    /// Source file path
    pub source_path: Option<String>,
}

// ─── Log Entry ──────────────────────────────────────────────────────

/// A parsed fail2ban log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: Option<DateTime<Utc>>,
    pub level: LogLevel,
    pub jail: Option<String>,
    pub message: String,
    pub ip: Option<String>,
    pub action: Option<LogAction>,
    pub raw_line: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    Info,
    Notice,
    Warning,
    Error,
    Critical,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogAction {
    Ban,
    Unban,
    Found,
    Ignore,
    AlreadyBanned,
    IncreaseBanTime,
    Restore,
    Start,
    Stop,
    Other(String),
}

// ─── Statistics ─────────────────────────────────────────────────────

/// Overall fail2ban statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fail2banStats {
    pub server_version: Option<String>,
    pub total_jails: u64,
    pub active_jails: u64,
    pub total_banned_now: u64,
    pub total_banned_ever: u64,
    pub total_failed_now: u64,
    pub total_failed_ever: u64,
    pub per_jail: Vec<JailStats>,
    pub top_banned_ips: Vec<BannedIpSummary>,
    pub collected_at: DateTime<Utc>,
}

/// Per-jail statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JailStats {
    pub jail: String,
    pub currently_banned: u64,
    pub total_banned: u64,
    pub currently_failed: u64,
    pub total_failed: u64,
}

/// Summary of a frequently banned IP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BannedIpSummary {
    pub ip: String,
    pub total_bans: u32,
    pub jails: Vec<String>,
    pub country: Option<String>,
    pub last_banned: Option<DateTime<Utc>>,
}

// ─── SSH Connection ─────────────────────────────────────────────────

/// SSH connection configuration for reaching the fail2ban host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    /// Extra SSH options (-o key=value)
    #[serde(default)]
    pub ssh_options: HashMap<String, String>,
    /// Connection timeout (seconds)
    pub connect_timeout: Option<u64>,
}

impl SshConfig {
    /// Build SSH command prefix for remote command execution.
    pub fn ssh_command(&self) -> Vec<String> {
        let mut args = vec![
            "ssh".to_string(),
            "-p".to_string(),
            self.port.to_string(),
        ];
        if let Some(key) = &self.private_key_path {
            args.push("-i".into());
            args.push(key.clone());
        }
        if let Some(timeout) = self.connect_timeout {
            args.push("-o".into());
            args.push(format!("ConnectTimeout={timeout}"));
        }
        for (k, v) in &self.ssh_options {
            args.push("-o".into());
            args.push(format!("{k}={v}"));
        }
        args.push(format!("{}@{}", self.username, self.host));
        args
    }
}

// ─── Config Managed Host ────────────────────────────────────────────

/// A managed fail2ban host (may be local or remote).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fail2banHost {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// None = local, Some = remote via SSH
    pub ssh: Option<SshConfig>,
    /// Whether to use sudo for fail2ban-client commands
    #[serde(default)]
    pub use_sudo: bool,
    /// Custom fail2ban-client binary path
    pub client_binary: Option<String>,
    /// Tags for grouping
    #[serde(default)]
    pub tags: Vec<String>,
}
