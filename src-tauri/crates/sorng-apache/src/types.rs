//! Shared types for Apache httpd management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to httpd / apache2 / apachectl binary
    pub apache_bin: Option<String>,
    /// Main config path (default: /etc/apache2/apache2.conf or /etc/httpd/conf/httpd.conf)
    pub config_path: Option<String>,
    /// Sites-available dir
    pub sites_available_dir: Option<String>,
    /// Sites-enabled dir
    pub sites_enabled_dir: Option<String>,
    /// Mods-available dir
    pub mods_available_dir: Option<String>,
    /// Mods-enabled dir
    pub mods_enabled_dir: Option<String>,
    /// Conf-available dir
    pub conf_available_dir: Option<String>,
    /// Conf-enabled dir
    pub conf_enabled_dir: Option<String>,
    /// mod_status URL (e.g. http://host/server-status)
    pub status_url: Option<String>,
    /// mod_info URL (e.g. http://host/server-info)
    pub info_url: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub mpm: Option<String>,
    pub config_path: String,
    pub server_root: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheInfo {
    pub version: String,
    pub mpm: Option<String>,
    pub built: Option<String>,
    pub server_root: String,
    pub config_file: String,
    pub compiled_modules: Vec<String>,
    pub loaded_modules: Vec<String>,
    pub architecture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheProcess {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub process_type: String,
    pub cpu_percent: Option<f64>,
    pub memory_rss: Option<u64>,
    pub uptime_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual Hosts
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheVhost {
    pub name: String,
    pub filename: String,
    pub enabled: bool,
    pub server_name: Option<String>,
    pub server_aliases: Vec<String>,
    pub document_root: Option<String>,
    pub listen_address: Option<String>,
    pub listen_port: u16,
    pub ssl_enabled: bool,
    pub ssl_certificate: Option<String>,
    pub ssl_certificate_key: Option<String>,
    pub proxy_pass_rules: Vec<ProxyPassRule>,
    pub directory_blocks: Vec<DirectoryBlock>,
    pub location_blocks: Vec<LocationBlock>,
    pub rewrite_rules: Vec<RewriteRule>,
    pub custom_log: Option<String>,
    pub error_log: Option<String>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyPassRule {
    pub path: String,
    pub target: String,
    pub reverse: bool,
    pub timeout: Option<u32>,
    pub retry: Option<u32>,
    pub preserve_host: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryBlock {
    pub path: String,
    pub options: Option<Vec<String>>,
    pub allow_override: Option<String>,
    pub require: Option<String>,
    pub extra_directives: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationBlock {
    pub path: String,
    pub match_type: Option<String>,
    pub proxy_pass: Option<String>,
    pub set_handler: Option<String>,
    pub require: Option<String>,
    pub extra_directives: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteRule {
    pub pattern: String,
    pub substitution: String,
    pub flags: Option<String>,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVhostRequest {
    pub name: String,
    pub server_name: String,
    pub server_aliases: Option<Vec<String>>,
    pub listen_port: Option<u16>,
    pub document_root: Option<String>,
    pub ssl: Option<ApacheSslConfig>,
    pub proxy_pass_rules: Option<Vec<ProxyPassRule>>,
    pub extra_directives: Option<HashMap<String, String>>,
    pub enable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateVhostRequest {
    pub name: String,
    pub content: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSL
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheSslConfig {
    pub certificate_file: String,
    pub certificate_key_file: String,
    pub certificate_chain_file: Option<String>,
    pub ca_certificate_file: Option<String>,
    pub protocols: Option<Vec<String>>,
    pub cipher_suite: Option<String>,
    pub honor_cipher_order: Option<bool>,
    pub hsts: Option<bool>,
    pub hsts_max_age: Option<u64>,
    pub stapling: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modules
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheModule {
    pub name: String,
    pub filename: Option<String>,
    pub enabled: bool,
    pub module_type: ModuleType,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    Static,
    Shared,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status (mod_status)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheServerStatus {
    pub total_accesses: u64,
    pub total_kbytes: u64,
    pub cpu_load: Option<f64>,
    pub uptime: u64,
    pub requests_per_sec: f64,
    pub bytes_per_sec: f64,
    pub bytes_per_request: f64,
    pub busy_workers: u32,
    pub idle_workers: u32,
    pub scoreboard: String,
    pub workers: Vec<WorkerStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerStatus {
    pub pid: u32,
    pub access_count: u64,
    pub mode: String,
    pub cpu: Option<f64>,
    pub seconds_since_last_request: f64,
    pub request: Option<String>,
    pub vhost: Option<String>,
    pub client: Option<String>,
    pub protocol: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheAccessLogEntry {
    pub remote_host: String,
    pub identity: Option<String>,
    pub user: Option<String>,
    pub timestamp: String,
    pub request: String,
    pub status: u16,
    pub bytes: u64,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheErrorLogEntry {
    pub timestamp: String,
    pub module: Option<String>,
    pub level: String,
    pub pid: Option<u32>,
    pub tid: Option<u64>,
    pub client: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogQuery {
    pub path: Option<String>,
    pub lines: Option<u32>,
    pub since: Option<String>,
    pub filter: Option<String>,
    pub level: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheMainConfig {
    pub server_root: Option<String>,
    pub listen: Vec<String>,
    pub server_admin: Option<String>,
    pub server_name: Option<String>,
    pub document_root: Option<String>,
    pub error_log: Option<String>,
    pub log_level: Option<String>,
    pub keep_alive: Option<bool>,
    pub keep_alive_timeout: Option<u32>,
    pub max_keep_alive_requests: Option<u32>,
    pub timeout: Option<u32>,
    pub include_files: Vec<String>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTestResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// .htaccess
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HtaccessFile {
    pub path: String,
    pub content: String,
    pub rewrite_rules: Vec<RewriteRule>,
    pub auth_config: Option<HtaccessAuth>,
    pub deny_rules: Vec<String>,
    pub allow_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HtaccessAuth {
    pub auth_type: String,
    pub auth_name: String,
    pub auth_user_file: String,
    pub require: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Balancer Manager
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalancerMember {
    pub worker_url: String,
    pub route: Option<String>,
    pub route_redirect: Option<String>,
    pub factor: f64,
    pub lbset: u32,
    pub status: String,
    pub elected: u64,
    pub busy: u32,
    pub load: u32,
    pub to_bytes: u64,
    pub from_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheBalancer {
    pub name: String,
    pub method: String,
    pub sticky_session: Option<String>,
    pub disable_failover: bool,
    pub max_attempts: Option<u32>,
    pub members: Vec<BalancerMember>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snippets
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApacheSnippet {
    pub name: String,
    pub filename: String,
    pub enabled: bool,
    pub content: String,
}
