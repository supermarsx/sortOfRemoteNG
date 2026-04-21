//! Shared types for HAProxy management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyConnectionConfig {
    /// SSH host for remote management
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// Stats socket path (e.g. /var/run/haproxy/admin.sock)
    pub stats_socket: Option<String>,
    /// Stats HTTP URL (e.g. http://host:8404/stats)
    pub stats_url: Option<String>,
    pub stats_user: Option<String>,
    pub stats_password: Option<String>,
    /// HAProxy Data-plane API URL (e.g. http://host:5555)
    pub dataplane_url: Option<String>,
    pub dataplane_user: Option<String>,
    pub dataplane_password: Option<String>,
    /// Config file path (default: /etc/haproxy/haproxy.cfg)
    pub config_path: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyConnectionSummary {
    pub host: String,
    pub version: Option<String>,
    pub node_name: Option<String>,
    pub release_date: Option<String>,
    pub uptime_secs: Option<u64>,
    pub process_num: Option<u32>,
    pub pid: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Info
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyInfo {
    pub name: Option<String>,
    pub version: String,
    pub release_date: Option<String>,
    pub nbthread: Option<u32>,
    pub nbproc: Option<u32>,
    pub process_num: Option<u32>,
    pub pid: u32,
    pub uptime: Option<String>,
    pub uptime_sec: Option<u64>,
    pub mem_max_mb: Option<u64>,
    pub pool_alloc_mb: Option<u64>,
    pub pool_used_mb: Option<u64>,
    pub pool_failed: Option<u64>,
    pub ulimit_n: Option<u64>,
    pub maxsock: Option<u64>,
    pub maxconn: Option<u64>,
    pub hard_maxconn: Option<u64>,
    pub curr_conns: Option<u64>,
    pub cum_conns: Option<u64>,
    pub cum_req: Option<u64>,
    pub max_ssl_conns: Option<u64>,
    pub curr_ssl_conns: Option<u64>,
    pub cum_ssl_conns: Option<u64>,
    pub maxpipes: Option<u64>,
    pub pipes_used: Option<u64>,
    pub pipes_free: Option<u64>,
    pub conn_rate: Option<u64>,
    pub conn_rate_limit: Option<u64>,
    pub max_conn_rate: Option<u64>,
    pub sess_rate: Option<u64>,
    pub sess_rate_limit: Option<u64>,
    pub max_sess_rate: Option<u64>,
    pub ssl_rate: Option<u64>,
    pub ssl_rate_limit: Option<u64>,
    pub max_ssl_rate: Option<u64>,
    pub ssl_frontend_key_rate: Option<u64>,
    pub ssl_frontend_max_key_rate: Option<u64>,
    pub ssl_frontend_session_reuse: Option<f64>,
    pub ssl_backend_key_rate: Option<u64>,
    pub ssl_backend_max_key_rate: Option<u64>,
    pub ssl_cache_usage: Option<f64>,
    pub ssl_cache_misses: Option<u64>,
    pub compress_bps_in: Option<u64>,
    pub compress_bps_out: Option<u64>,
    pub compress_bps_rate_lim: Option<u64>,
    pub tasks: Option<u64>,
    pub run_queue: Option<u64>,
    pub idle_pct: Option<f64>,
    pub node: Option<String>,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Frontends & Backends
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyFrontend {
    pub name: String,
    pub status: String,
    pub current_sessions: u64,
    pub max_sessions: u64,
    pub session_limit: u64,
    pub total_sessions: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub denied_requests: u64,
    pub denied_responses: u64,
    pub request_errors: u64,
    pub request_rate: u64,
    pub request_rate_max: u64,
    pub request_total: u64,
    pub connection_rate: u64,
    pub connection_rate_max: u64,
    pub connection_total: u64,
    pub http_responses: HttpResponses,
    pub mode: Option<String>,
    pub bind: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyBackend {
    pub name: String,
    pub status: String,
    pub current_sessions: u64,
    pub max_sessions: u64,
    pub total_sessions: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub denied_requests: u64,
    pub denied_responses: u64,
    pub connection_errors: u64,
    pub response_errors: u64,
    pub retry_warnings: u64,
    pub redispatch_warnings: u64,
    pub request_total: u64,
    pub http_responses: HttpResponses,
    pub active_servers: u32,
    pub backup_servers: u32,
    pub check_down: u64,
    pub last_change: u64,
    pub downtime: u64,
    pub queue_current: u64,
    pub queue_max: u64,
    pub balance_algorithm: Option<String>,
    pub mode: Option<String>,
    pub servers: Vec<HaproxyServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponses {
    pub http_1xx: u64,
    pub http_2xx: u64,
    pub http_3xx: u64,
    pub http_4xx: u64,
    pub http_5xx: u64,
    pub http_other: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Servers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyServer {
    pub name: String,
    pub backend: String,
    pub address: String,
    pub port: Option<u16>,
    pub status: String,
    pub weight: u32,
    pub current_sessions: u64,
    pub max_sessions: u64,
    pub total_sessions: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub connection_errors: u64,
    pub response_errors: u64,
    pub retry_warnings: u64,
    pub redispatch_warnings: u64,
    pub check_status: Option<String>,
    pub check_code: Option<u32>,
    pub check_duration: Option<u64>,
    pub last_change: u64,
    pub downtime: u64,
    pub queue_current: u64,
    pub queue_max: u64,
    pub throttle: Option<u32>,
    pub agent_status: Option<String>,
    pub active: bool,
    pub backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoketServerAction {
    pub backend: String,
    pub server: String,
    pub action: ServerAction,
    pub weight: Option<u32>,
    pub address: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerAction {
    Enable,
    Disable,
    Drain,
    Maint,
    Ready,
    SetWeight,
    SetAddr,
    AgentUp,
    AgentDown,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACLs & Maps
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyAcl {
    pub id: String,
    pub description: Option<String>,
    pub entries: Vec<AclEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclEntry {
    pub id: u64,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyMap {
    pub id: String,
    pub description: Option<String>,
    pub entries: Vec<MapEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapEntry {
    pub id: u64,
    pub key: String,
    pub value: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stick Tables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickTable {
    pub name: String,
    pub table_type: String,
    pub size: u64,
    pub used: u64,
    pub data_types: Vec<String>,
    pub entries: Vec<StickTableEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickTableEntry {
    pub key: String,
    pub use_count: u64,
    pub expiry_ms: Option<u64>,
    pub data: HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyConfig {
    pub global: HashMap<String, String>,
    pub defaults: HashMap<String, String>,
    pub frontends: Vec<HaproxyConfigSection>,
    pub backends: Vec<HaproxyConfigSection>,
    pub listeners: Vec<HaproxyConfigSection>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyConfigSection {
    pub name: String,
    pub directives: Vec<ConfigDirective>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDirective {
    pub keyword: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResult {
    pub valid: bool,
    pub output: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime API
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCommand {
    pub command: String,
    pub response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntry {
    pub id: String,
    pub frontend: String,
    pub backend: String,
    pub server: String,
    pub source: String,
    pub destination: Option<String>,
    pub age_secs: u64,
    pub idle_secs: Option<u64>,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Peers & Resolvers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyPeer {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyResolver {
    pub name: String,
    pub nameservers: Vec<ResolverNameserver>,
    pub hold: Option<HashMap<String, String>>,
    pub resolve_retries: Option<u32>,
    pub timeout: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolverNameserver {
    pub name: String,
    pub address: String,
    pub port: u16,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaproxyLogEntry {
    pub timestamp: String,
    pub process: String,
    pub pid: Option<u32>,
    pub frontend: Option<String>,
    pub backend: Option<String>,
    pub server: Option<String>,
    pub timers: Option<String>,
    pub status_code: Option<u16>,
    pub bytes_read: Option<u64>,
    pub captured_request_cookie: Option<String>,
    pub captured_response_cookie: Option<String>,
    pub termination_state: Option<String>,
    pub actconn: Option<u64>,
    pub feconn: Option<u64>,
    pub beconn: Option<u64>,
    pub srv_conn: Option<u64>,
    pub retries: Option<u64>,
    pub queue_server: Option<u64>,
    pub queue_backend: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogQuery {
    pub lines: Option<u32>,
    pub since: Option<String>,
    pub filter: Option<String>,
    pub frontend: Option<String>,
    pub backend: Option<String>,
    pub status_code: Option<u16>,
}
