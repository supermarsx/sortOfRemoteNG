//! Data types for fail2ban management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

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
#[derive(Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default, skip_serializing)]
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    #[serde(default, skip_serializing)]
    pub private_key_passphrase: Option<String>,
    /// Extra SSH options (-o key=value)
    #[serde(default)]
    pub ssh_options: HashMap<String, String>,
    /// Connection timeout (seconds)
    pub connect_timeout: Option<u64>,
}

impl fmt::Debug for SshConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("private_key_path", &self.private_key_path)
            .field(
                "private_key_passphrase",
                &self.private_key_passphrase.as_ref().map(|_| "[REDACTED]"),
            )
            .field("ssh_options", &self.ssh_options)
            .field("connect_timeout", &self.connect_timeout)
            .finish()
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

impl Fail2banHost {
    pub fn redacted(&self) -> Self {
        let mut host = self.clone();
        if let Some(ssh) = &mut host.ssh {
            ssh.password = None;
            ssh.private_key_passphrase = None;
        }
        host
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host_with_secrets() -> Fail2banHost {
        Fail2banHost {
            id: "host-1".into(),
            name: "example".into(),
            description: None,
            ssh: Some(SshConfig {
                host: "server.example".into(),
                port: 22,
                username: "operator".into(),
                password: Some("password-value".into()),
                private_key_path: Some("/home/operator/.ssh/id_ed25519".into()),
                private_key_passphrase: Some("passphrase-value".into()),
                ssh_options: HashMap::new(),
                connect_timeout: Some(5),
            }),
            use_sudo: true,
            client_binary: None,
            tags: vec![],
        }
    }

    #[test]
    fn credentials_are_absent_from_serialization_and_debug_output() {
        let host = host_with_secrets();
        let serialized = serde_json::to_string(&host).unwrap();
        let debug = format!("{host:?}");
        for secret in ["password-value", "passphrase-value"] {
            assert!(!serialized.contains(secret));
            assert!(!debug.contains(secret));
        }
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("private_key_passphrase"));
    }

    #[test]
    fn public_host_view_drops_credentials() {
        let host = host_with_secrets().redacted();
        let ssh = host.ssh.unwrap();
        assert!(ssh.password.is_none());
        assert!(ssh.private_key_passphrase.is_none());
    }
}
