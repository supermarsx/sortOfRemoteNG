//! Shared types for Dovecot IMAP/POP3 server management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotConnectionConfig {
    /// SSH host for remote Dovecot management
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to doveadm binary (default: /usr/bin/doveadm)
    pub doveadm_bin: Option<String>,
    /// Path to dovecot binary (default: /usr/sbin/dovecot)
    pub dovecot_bin: Option<String>,
    /// Dovecot config directory (default: /etc/dovecot)
    pub config_dir: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub protocols: Vec<String>,
    pub auth_mechanisms: Vec<String>,
    pub mail_location: Option<String>,
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
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotUser {
    pub username: String,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub home: Option<String>,
    pub mail_location: Option<String>,
    pub quota_rule: Option<String>,
    pub password_hash: Option<String>,
    pub extra_fields: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub home: Option<String>,
    pub mail_location: Option<String>,
    pub quota_rule: Option<String>,
    pub extra_fields: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub password: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub home: Option<String>,
    pub mail_location: Option<String>,
    pub quota_rule: Option<String>,
    pub extra_fields: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotMailbox {
    pub user: String,
    pub name: String,
    pub messages: u64,
    pub unseen: u64,
    pub recent: u64,
    pub uidvalidity: u64,
    pub uidnext: u64,
    pub vsize: u64,
    pub guid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotMailboxStatus {
    pub mailbox: String,
    pub messages: u64,
    pub recent: u64,
    pub unseen: u64,
    pub uidvalidity: u64,
    pub uidnext: u64,
    pub highestmodseq: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Namespaces
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotNamespace {
    pub name: String,
    /// private, shared, or public
    pub namespace_type: String,
    pub prefix: Option<String>,
    pub separator: Option<String>,
    pub inbox: bool,
    pub hidden: bool,
    pub list: bool,
    pub subscriptions: bool,
    pub location: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sieve
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotSieveScript {
    pub name: String,
    pub active: bool,
    pub content: Option<String>,
    pub size_bytes: Option<u64>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSieveRequest {
    pub name: String,
    pub content: String,
    pub activate: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSieveRequest {
    pub content: Option<String>,
    pub activate: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quota
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotQuota {
    pub user: String,
    pub storage_limit: Option<u64>,
    pub storage_used: u64,
    pub message_limit: Option<u64>,
    pub message_used: u64,
    pub percent_used: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotQuotaRule {
    pub rule: String,
    pub storage_limit_mb: Option<u64>,
    pub message_limit: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotAuthConfig {
    pub mechanisms: Vec<String>,
    pub passdb_drivers: Vec<String>,
    pub userdb_drivers: Vec<String>,
    pub auth_verbose: bool,
    pub auth_debug: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotPassdbEntry {
    /// pam, sql, ldap, passwd, static
    pub driver: String,
    pub args: Option<String>,
    pub deny: bool,
    pub master: bool,
    pub pass: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotUserdbEntry {
    /// sql, ldap, passwd, static
    pub driver: String,
    pub args: Option<String>,
    pub default_fields: Option<String>,
    pub override_fields: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Services / Listeners
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotService {
    pub name: String,
    pub listeners: Vec<DovecotListener>,
    pub process_min_avail: Option<u32>,
    pub process_limit: Option<u32>,
    pub vsz_limit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotListener {
    /// inet, unix, or fifo
    pub listener_type: String,
    pub path_or_address: String,
    pub port: Option<u16>,
    pub mode: Option<String>,
    pub user: Option<String>,
    pub group: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotPlugin {
    pub name: String,
    pub enabled: bool,
    pub settings: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotLog {
    pub timestamp: Option<String>,
    pub level: Option<String>,
    pub process: Option<String>,
    pub pid: Option<u32>,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats / Processes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotStats {
    pub user: Option<String>,
    pub command: String,
    pub count: u64,
    pub last_used: Option<String>,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotProcess {
    pub pid: u32,
    pub service: String,
    pub user: Option<String>,
    pub ip: Option<String>,
    pub state: Option<String>,
    pub uptime_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replication
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotReplication {
    pub user: String,
    pub priority: Option<String>,
    pub last_fast_sync: Option<String>,
    pub last_full_sync: Option<String>,
    pub status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Info / Config Test
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotInfo {
    pub version: String,
    pub protocols: Vec<String>,
    pub ssl_library: Option<String>,
    pub mail_plugins: Vec<String>,
    pub auth_mechanisms: Vec<String>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACL
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotAcl {
    pub mailbox: String,
    pub identifier: String,
    pub rights: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Params
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DovecotConfigParam {
    pub name: String,
    pub value: String,
    pub section: Option<String>,
    pub filename: Option<String>,
}
