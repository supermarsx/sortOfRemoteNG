//! Shared types for Cyrus SASL management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyrusSaslConnectionConfig {
    /// SSH host to connect to
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to saslauthd binary (default: /usr/sbin/saslauthd)
    pub saslauthd_bin: Option<String>,
    /// Path to sasldblistusers2 binary (default: /usr/sbin/sasldblistusers2)
    pub sasldblistusers_bin: Option<String>,
    /// Path to saslpasswd2 binary (default: /usr/sbin/saslpasswd2)
    pub saslpasswd_bin: Option<String>,
    /// SASL config directory (default: /etc/sasl2)
    pub config_dir: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyrusSaslConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub mechanisms: Vec<String>,
    pub saslauthd_running: bool,
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
// Mechanisms
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslMechanism {
    pub name: String,
    pub enabled: bool,
    pub description: String,
    pub security_flags: Vec<String>,
    pub features: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslUser {
    pub username: String,
    pub realm: String,
    pub password_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSaslUserRequest {
    pub username: String,
    pub realm: Option<String>,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSaslUserRequest {
    pub password: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Saslauthd
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslauthConfig {
    /// Mechanism: pam, shadow, ldap, rimap, kerberos5, httpform
    pub mech: String,
    pub flags: Vec<String>,
    pub run_dir: Option<String>,
    pub threads: Option<u32>,
    pub cache_timeout: Option<u64>,
    pub log_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslauthStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub socket_path: Option<String>,
    pub mechanism: Option<String>,
    pub threads_active: Option<u32>,
    pub threads_idle: Option<u32>,
    pub cache_hits: Option<u64>,
    pub cache_misses: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// App Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslAppConfig {
    pub app_name: String,
    pub pwcheck_method: Option<String>,
    pub mech_list: Option<String>,
    pub log_level: Option<String>,
    pub auxprop_plugin: Option<String>,
    pub sql_engine: Option<String>,
    pub sql_hostnames: Option<String>,
    pub sql_database: Option<String>,
    pub sql_user: Option<String>,
    pub sql_passw: Option<String>,
    pub ldapdb_uri: Option<String>,
    pub ldapdb_id: Option<String>,
    pub ldapdb_pw: Option<String>,
    pub extra: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auxprop Plugins
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuxpropPlugin {
    pub name: String,
    pub plugin_type: String,
    pub description: String,
    pub available: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslTestResult {
    pub success: bool,
    pub mechanism_used: Option<String>,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SaslDB
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslDbEntry {
    pub username: String,
    pub realm: String,
    pub property: String,
    pub value: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaslInfo {
    pub version: String,
    pub available_mechanisms: Vec<String>,
    pub plugin_dir: Option<String>,
    pub config_dir: String,
    pub saslauthd_running: bool,
}
