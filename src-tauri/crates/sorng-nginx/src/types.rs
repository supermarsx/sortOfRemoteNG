//! Shared types for Nginx management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxConnectionConfig {
    /// SSH host or direct host for stub_status
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Path to nginx binary (default: /usr/sbin/nginx)
    pub nginx_bin: Option<String>,
    /// Path to main config (default: /etc/nginx/nginx.conf)
    pub config_path: Option<String>,
    /// Sites-available dir (default: /etc/nginx/sites-available)
    pub sites_available_dir: Option<String>,
    /// Sites-enabled dir (default: /etc/nginx/sites-enabled)
    pub sites_enabled_dir: Option<String>,
    /// Conf.d directory (default: /etc/nginx/conf.d)
    pub conf_d_dir: Option<String>,
    /// stub_status URL (e.g. http://host/nginx_status)
    pub status_url: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub config_path: String,
    pub worker_processes: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Nginx Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxInfo {
    pub version: String,
    pub compiler: Option<String>,
    pub configure_arguments: Vec<String>,
    pub modules: Vec<String>,
    pub prefix: Option<String>,
    pub config_path: String,
    pub pid_path: Option<String>,
    pub error_log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxProcess {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub process_type: String, // master, worker, cache manager, etc.
    pub cpu_percent: Option<f64>,
    pub memory_rss: Option<u64>,
    pub connections: Option<u64>,
    pub uptime_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Blocks (Sites)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxSite {
    pub name: String,
    pub filename: String,
    pub enabled: bool,
    pub server_names: Vec<String>,
    pub listen_directives: Vec<ListenDirective>,
    pub root: Option<String>,
    pub index: Option<String>,
    pub locations: Vec<NginxLocation>,
    pub ssl: Option<SslConfig>,
    pub upstream_ref: Option<String>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenDirective {
    pub address: Option<String>,
    pub port: u16,
    pub ssl: bool,
    pub http2: bool,
    pub default_server: bool,
    pub ipv6only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxLocation {
    pub path: String,
    pub modifier: Option<String>, // =, ~, ~*, ^~
    pub proxy_pass: Option<String>,
    pub root: Option<String>,
    pub alias: Option<String>,
    pub index: Option<String>,
    pub try_files: Option<String>,
    pub return_directive: Option<String>,
    pub rewrite: Option<String>,
    pub fastcgi_pass: Option<String>,
    pub uwsgi_pass: Option<String>,
    pub grpc_pass: Option<String>,
    pub extra_directives: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSiteRequest {
    pub name: String,
    pub server_names: Vec<String>,
    pub listen_port: Option<u16>,
    pub ssl: Option<SslConfig>,
    pub root: Option<String>,
    pub locations: Vec<CreateLocationRequest>,
    pub upstream: Option<String>,
    pub extra_directives: Option<HashMap<String, String>>,
    pub enable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocationRequest {
    pub path: String,
    pub modifier: Option<String>,
    pub proxy_pass: Option<String>,
    pub root: Option<String>,
    pub alias: Option<String>,
    pub try_files: Option<String>,
    pub return_directive: Option<String>,
    pub fastcgi_pass: Option<String>,
    pub extra_directives: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSiteRequest {
    pub name: String,
    pub content: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSL
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslConfig {
    pub certificate: String,
    pub certificate_key: String,
    pub protocols: Option<Vec<String>>,
    pub ciphers: Option<String>,
    pub prefer_server_ciphers: Option<bool>,
    pub session_cache: Option<String>,
    pub session_timeout: Option<String>,
    pub stapling: Option<bool>,
    pub stapling_verify: Option<bool>,
    pub trusted_certificate: Option<String>,
    pub dhparam: Option<String>,
    pub hsts: Option<bool>,
    pub hsts_max_age: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Upstreams
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxUpstream {
    pub name: String,
    pub servers: Vec<UpstreamServer>,
    pub load_balancing: Option<String>, // round_robin, least_conn, ip_hash, hash
    pub keepalive: Option<u32>,
    pub keepalive_requests: Option<u32>,
    pub keepalive_timeout: Option<String>,
    pub zone: Option<String>,
    pub zone_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamServer {
    pub address: String,
    pub port: Option<u16>,
    pub weight: Option<u32>,
    pub max_conns: Option<u32>,
    pub max_fails: Option<u32>,
    pub fail_timeout: Option<String>,
    pub backup: bool,
    pub down: bool,
    pub slow_start: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUpstreamRequest {
    pub name: String,
    pub servers: Vec<UpstreamServer>,
    pub load_balancing: Option<String>,
    pub keepalive: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUpstreamRequest {
    pub name: String,
    pub servers: Option<Vec<UpstreamServer>>,
    pub load_balancing: Option<String>,
    pub keepalive: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status / Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxStubStatus {
    pub active_connections: u64,
    pub accepts: u64,
    pub handled: u64,
    pub requests: u64,
    pub reading: u64,
    pub writing: u64,
    pub waiting: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxHealthCheck {
    pub running: bool,
    pub pid: Option<u32>,
    pub worker_count: u32,
    pub config_valid: bool,
    pub uptime_secs: Option<u64>,
    pub status: Option<NginxStubStatus>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLogEntry {
    pub remote_addr: String,
    pub remote_user: Option<String>,
    pub time_local: String,
    pub request: String,
    pub status: u16,
    pub body_bytes_sent: u64,
    pub http_referer: Option<String>,
    pub http_user_agent: Option<String>,
    pub request_time: Option<f64>,
    pub upstream_response_time: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorLogEntry {
    pub timestamp: String,
    pub level: String,
    pub pid: Option<u32>,
    pub tid: Option<u32>,
    pub connection: Option<u64>,
    pub message: String,
    pub client: Option<String>,
    pub server: Option<String>,
    pub request: Option<String>,
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
pub struct NginxMainConfig {
    pub worker_processes: Option<String>,
    pub worker_connections: Option<u32>,
    pub multi_accept: Option<bool>,
    pub sendfile: Option<bool>,
    pub tcp_nopush: Option<bool>,
    pub tcp_nodelay: Option<bool>,
    pub keepalive_timeout: Option<String>,
    pub types_hash_max_size: Option<u32>,
    pub server_tokens: Option<bool>,
    pub client_max_body_size: Option<String>,
    pub gzip: Option<bool>,
    pub gzip_types: Option<Vec<String>>,
    pub include_files: Vec<String>,
    pub error_log: Option<String>,
    pub access_log: Option<String>,
    pub pid_file: Option<String>,
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
// Rate Limiting / Security
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitZone {
    pub name: String,
    pub key: String,
    pub size: String,
    pub rate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoRestriction {
    pub name: String,
    pub default_action: String,
    pub rules: Vec<GeoRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoRule {
    pub cidr: String,
    pub action: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Maps & Redirects
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxMap {
    pub name: String,
    pub source_variable: String,
    pub target_variable: String,
    pub default: Option<String>,
    pub entries: Vec<MapEntry>,
    pub hostnames: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapEntry {
    pub pattern: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedirectRule {
    pub source: String,
    pub target: String,
    pub permanent: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snippets / Includes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxSnippet {
    pub name: String,
    pub path: String,
    pub content: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSnippetRequest {
    pub name: String,
    pub content: String,
    pub description: Option<String>,
}
