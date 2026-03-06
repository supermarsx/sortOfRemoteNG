//! Data types for syslog/journald/logrotate management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String, pub port: u16, pub username: String, pub auth: SshAuth, pub timeout_secs: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogHost {
    pub id: String, pub name: String, pub ssh: Option<SshConfig>, pub use_sudo: bool,
    pub backend: SyslogBackend, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyslogBackend { Rsyslog, SyslogNg, Journald }

// ─── Facility / Severity ────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyslogFacility {
    Kern, User, Mail, Daemon, Auth, Syslog, Lpr, News, Uucp, Cron,
    Authpriv, Ftp, Local0, Local1, Local2, Local3, Local4, Local5, Local6, Local7, Any,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyslogSeverity {
    Emergency, Alert, Critical, Error, Warning, Notice, Info, Debug, Any,
}

// ─── Rsyslog ────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsyslogConfig {
    pub version: Option<String>,
    pub modules: Vec<String>,
    pub global_directives: HashMap<String, String>,
    pub rules: Vec<RsyslogRule>,
    pub templates: Vec<RsyslogTemplate>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsyslogRule {
    pub facility: SyslogFacility,
    pub severity: SyslogSeverity,
    pub action: String,
    pub template: Option<String>,
    pub raw_line: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsyslogTemplate {
    pub name: String,
    pub template_type: String,
    pub content: String,
}

// ─── syslog-ng ──────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogNgConfig {
    pub version: Option<String>,
    pub sources: Vec<SyslogNgSource>,
    pub destinations: Vec<SyslogNgDestination>,
    pub filters: Vec<SyslogNgFilter>,
    pub log_paths: Vec<SyslogNgLogPath>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogNgSource { pub name: String, pub driver: String, pub options: HashMap<String, String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogNgDestination { pub name: String, pub driver: String, pub path: Option<String>, pub options: HashMap<String, String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogNgFilter { pub name: String, pub expression: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogNgLogPath { pub sources: Vec<String>, pub filters: Vec<String>, pub destinations: Vec<String> }

// ─── journald ───────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournaldConfig {
    pub storage: Option<String>,
    pub compress: Option<bool>,
    pub seal: Option<bool>,
    pub split_mode: Option<String>,
    pub max_use: Option<String>,
    pub max_file_size: Option<String>,
    pub max_retention_sec: Option<String>,
    pub max_level_store: Option<String>,
    pub max_level_syslog: Option<String>,
    pub max_level_console: Option<String>,
    pub forward_to_syslog: Option<bool>,
    pub forward_to_kmsg: Option<bool>,
    pub forward_to_console: Option<bool>,
    pub forward_to_wall: Option<bool>,
    pub rate_limit_interval_sec: Option<u32>,
    pub rate_limit_burst: Option<u32>,
    pub all_settings: HashMap<String, String>,
}

// ─── Logrotate ──────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogrotateGlobalConfig {
    pub frequency: LogrotateFrequency,
    pub rotate_count: u32,
    pub compress: bool,
    pub delay_compress: bool,
    pub file_configs: Vec<LogrotateFileConfig>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogrotateFrequency { Daily, Weekly, Monthly, Yearly }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogrotateFileConfig {
    pub path: String,
    pub frequency: Option<LogrotateFrequency>,
    pub rotate_count: Option<u32>,
    pub compress: Option<bool>,
    pub delay_compress: Option<bool>,
    pub missing_ok: bool,
    pub not_if_empty: bool,
    pub create: Option<String>,
    pub postrotate: Option<String>,
    pub prerotate: Option<String>,
    pub max_size: Option<String>,
    pub min_size: Option<String>,
    pub max_age: Option<u32>,
    pub copy_truncate: bool,
    pub date_ext: bool,
    pub shared_scripts: bool,
}

// ─── Log File ───────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: Option<DateTime<Utc>>,
    pub permissions: String,
    pub is_compressed: bool,
}

// ─── Remote Logging ─────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteLoggingConfig {
    pub protocol: RemoteLogProtocol,
    pub target_host: String,
    pub target_port: u16,
    pub use_tls: bool,
    pub tls_ca_path: Option<String>,
    pub tls_cert_path: Option<String>,
    pub tls_key_path: Option<String>,
    pub facility_filter: Option<SyslogFacility>,
    pub severity_filter: Option<SyslogSeverity>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteLogProtocol { Udp, Tcp, Relp }

// ─── Health ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogHealthCheck {
    pub backend: SyslogBackend,
    pub service_running: bool,
    pub config_valid: bool,
    pub log_dir_writable: bool,
    pub total_log_size_bytes: u64,
    pub log_file_count: u32,
    pub logrotate_available: bool,
    pub remote_forwarding: bool,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}
