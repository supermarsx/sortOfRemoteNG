//! Shared types for Caddy server management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyConnectionConfig {
    /// Caddy admin API URL (default: http://localhost:2019)
    pub admin_url: String,
    pub api_key: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyConnectionSummary {
    pub admin_url: String,
    pub version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Config  (GET /config/)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyConfig {
    pub admin: Option<AdminConfig>,
    pub logging: Option<serde_json::Value>,
    pub storage: Option<serde_json::Value>,
    pub apps: Option<CaddyApps>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminConfig {
    pub disabled: Option<bool>,
    pub listen: Option<String>,
    pub enforce_origin: Option<bool>,
    pub origins: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyApps {
    pub http: Option<HttpApp>,
    pub tls: Option<TlsApp>,
    pub pki: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP App
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpApp {
    pub http_port: Option<u16>,
    pub https_port: Option<u16>,
    pub grace_period: Option<String>,
    pub servers: Option<HashMap<String, CaddyServer>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyServer {
    pub listen: Option<Vec<String>>,
    pub routes: Option<Vec<CaddyRoute>>,
    pub errors: Option<serde_json::Value>,
    pub automatic_https: Option<serde_json::Value>,
    pub max_header_bytes: Option<u64>,
    pub timeouts: Option<ServerTimeouts>,
    pub strict_sni_host: Option<bool>,
    pub tls_connection_policies: Option<Vec<TlsConnectionPolicy>>,
    pub protocols: Option<Vec<String>>,
    pub logs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerTimeouts {
    pub read_body: Option<String>,
    pub read_header: Option<String>,
    pub write: Option<String>,
    pub idle: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyRoute {
    #[serde(rename = "@id")]
    pub id: Option<String>,
    #[serde(rename = "group")]
    pub group: Option<String>,
    #[serde(rename = "match")]
    pub matchers: Option<Vec<CaddyMatcher>>,
    pub handle: Option<Vec<CaddyHandler>>,
    pub terminal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyMatcher {
    pub host: Option<Vec<String>>,
    pub path: Option<Vec<String>>,
    pub path_regexp: Option<PathRegexp>,
    pub method: Option<Vec<String>>,
    pub header: Option<HashMap<String, Vec<String>>>,
    pub header_regexp: Option<HashMap<String, PathRegexp>>,
    pub protocol: Option<String>,
    pub query: Option<HashMap<String, Vec<String>>>,
    pub remote_ip: Option<RemoteIpMatcher>,
    pub not: Option<Vec<CaddyMatcher>>,
    pub expression: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathRegexp {
    pub name: Option<String>,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteIpMatcher {
    pub ranges: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyHandler {
    pub handler: String,
    // reverse_proxy
    pub upstreams: Option<Vec<CaddyUpstream>>,
    pub load_balancing: Option<LoadBalancingConfig>,
    pub health_checks: Option<HealthCheckConfig>,
    pub headers: Option<serde_json::Value>,
    pub transport: Option<serde_json::Value>,
    pub rewrite: Option<String>,
    pub buffer_requests: Option<bool>,
    pub buffer_responses: Option<bool>,
    pub max_buffer_size: Option<u64>,
    // file_server
    pub root: Option<String>,
    pub hide: Option<Vec<String>>,
    pub index_names: Option<Vec<String>>,
    pub browse: Option<serde_json::Value>,
    pub precompressed: Option<serde_json::Value>,
    pub canonical_uris: Option<bool>,
    pub pass_thru: Option<bool>,
    // static_response
    pub status_code: Option<String>,
    pub body: Option<String>,
    pub close: Option<bool>,
    // subroute
    pub routes: Option<Vec<CaddyRoute>>,
    // encode (compression)
    pub encodings: Option<serde_json::Value>,
    pub prefer: Option<Vec<String>>,
    pub minimum_length: Option<u64>,
    // authentication
    pub providers: Option<serde_json::Value>,
    // rewrite
    pub uri: Option<String>,
    pub strip_path_prefix: Option<String>,
    pub strip_path_suffix: Option<String>,
    pub uri_substring: Option<Vec<SubstringReplace>>,
    // redirect
    #[serde(rename = "status_code")]
    pub redirect_status: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstringReplace {
    pub find: String,
    pub replace: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyUpstream {
    pub dial: String,
    pub max_requests: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancingConfig {
    pub selection_policy: Option<serde_json::Value>,
    pub try_duration: Option<String>,
    pub try_interval: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckConfig {
    pub active: Option<ActiveHealthCheck>,
    pub passive: Option<PassiveHealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveHealthCheck {
    pub path: Option<String>,
    pub port: Option<u16>,
    pub interval: Option<String>,
    pub timeout: Option<String>,
    pub max_size: Option<u64>,
    pub expect_status: Option<u16>,
    pub expect_body: Option<String>,
    pub headers: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveHealthCheck {
    pub fail_duration: Option<String>,
    pub max_fails: Option<u32>,
    pub unhealthy_request_count: Option<u32>,
    pub unhealthy_status: Option<Vec<u16>>,
    pub unhealthy_latency: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TLS App
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsApp {
    pub certificates: Option<TlsCertificates>,
    pub automation: Option<TlsAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsCertificates {
    pub automate: Option<Vec<String>>,
    pub load_files: Option<Vec<TlsLoadFile>>,
    pub load_folders: Option<Vec<String>>,
    pub load_pem: Option<Vec<TlsLoadPem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsLoadFile {
    pub certificate: String,
    pub key: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsLoadPem {
    pub certificate: String,
    pub key: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsAutomation {
    pub policies: Option<Vec<TlsAutomationPolicy>>,
    pub on_demand: Option<OnDemandConfig>,
    pub ocsp_interval: Option<String>,
    pub renew_interval: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsAutomationPolicy {
    pub subjects: Option<Vec<String>>,
    pub issuers: Option<Vec<serde_json::Value>>,
    pub must_staple: Option<bool>,
    pub renewal_window_ratio: Option<f64>,
    pub key_type: Option<String>,
    pub on_demand: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnDemandConfig {
    pub rate_limit: Option<OnDemandRateLimit>,
    pub ask: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnDemandRateLimit {
    pub interval: Option<String>,
    pub burst: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConnectionPolicy {
    #[serde(rename = "match")]
    pub match_config: Option<serde_json::Value>,
    pub certificate_selection: Option<serde_json::Value>,
    pub cipher_suites: Option<Vec<String>>,
    pub curves: Option<Vec<String>>,
    pub alpn: Option<Vec<String>>,
    pub protocol_min: Option<String>,
    pub protocol_max: Option<String>,
    pub client_authentication: Option<serde_json::Value>,
    pub default_sni: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates (managed by Caddy)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyCertificate {
    pub managed: bool,
    pub issuer: Option<String>,
    pub sans: Vec<String>,
    pub not_before: Option<String>,
    pub not_after: Option<String>,
    pub fingerprint: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Caddyfile helpers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyfileAdaptResult {
    pub config: serde_json::Value,
    pub warnings: Vec<CaddyfileWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaddyfileWarning {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub directive: Option<String>,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reverse Proxy convenience
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReverseProxyRequest {
    pub server_name: Option<String>,
    pub hosts: Vec<String>,
    pub upstreams: Vec<String>,
    pub tls: Option<bool>,
    pub headers: Option<HashMap<String, String>>,
    pub health_check_path: Option<String>,
    pub load_balancing: Option<String>,
    pub strip_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileServerRequest {
    pub server_name: Option<String>,
    pub hosts: Vec<String>,
    pub root: String,
    pub browse: Option<bool>,
    pub tls: Option<bool>,
    pub index_names: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRedirectRequest {
    pub server_name: Option<String>,
    pub hosts: Vec<String>,
    pub target: String,
    pub permanent: Option<bool>,
}
