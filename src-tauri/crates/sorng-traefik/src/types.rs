//! Shared types for Traefik management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikConnectionConfig {
    /// Traefik API base URL (e.g. http://host:8080)
    pub api_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub api_key: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikConnectionSummary {
    pub api_url: String,
    pub version: Option<String>,
    pub dashboard_url: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Overview
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikOverview {
    pub http: Option<ProviderSummary>,
    pub tcp: Option<ProviderSummary>,
    pub udp: Option<ProviderSummary>,
    pub features: Option<TraefikFeatures>,
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSummary {
    pub routers: ResourceCount,
    pub services: ResourceCount,
    pub middlewares: ResourceCount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceCount {
    pub total: u32,
    pub warnings: u32,
    pub errors: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikFeatures {
    pub tracing: Option<String>,
    pub metrics: Option<String>,
    pub access_log: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikVersion {
    pub version: String,
    pub codename: Option<String>,
    pub start_date: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// EntryPoints
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikEntryPoint {
    pub name: String,
    pub address: String,
    pub transport: Option<serde_json::Value>,
    pub forwarded_headers: Option<serde_json::Value>,
    pub http: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Routers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikRouter {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    pub entry_points: Option<Vec<String>>,
    pub middlewares: Option<Vec<String>>,
    pub service: Option<String>,
    pub rule: Option<String>,
    pub priority: Option<i64>,
    pub tls: Option<RouterTls>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterTls {
    pub cert_resolver: Option<String>,
    pub domains: Option<Vec<TlsDomain>>,
    pub options: Option<String>,
    pub passthrough: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsDomain {
    pub main: String,
    pub sans: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TCP Routers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikTcpRouter {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    pub entry_points: Option<Vec<String>>,
    pub service: Option<String>,
    pub rule: Option<String>,
    pub tls: Option<RouterTls>,
    pub priority: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UDP Routers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikUdpRouter {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    pub entry_points: Option<Vec<String>>,
    pub service: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Services
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikService {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub service_type: Option<String>,
    pub server_status: Option<HashMap<String, String>>,
    pub load_balancer: Option<LoadBalancer>,
    pub weighted: Option<serde_json::Value>,
    pub mirroring: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancer {
    pub servers: Option<Vec<LbServer>>,
    pub health_check: Option<HealthCheck>,
    pub pass_host_header: Option<bool>,
    pub sticky: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LbServer {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub scheme: Option<String>,
    pub path: Option<String>,
    pub port: Option<u16>,
    pub interval: Option<String>,
    pub timeout: Option<String>,
    pub hostname: Option<String>,
    pub follow_redirects: Option<bool>,
    pub headers: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TCP Services
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikTcpService {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub service_type: Option<String>,
    pub load_balancer: Option<TcpLoadBalancer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpLoadBalancer {
    pub servers: Option<Vec<TcpServer>>,
    pub termination_delay: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpServer {
    pub address: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UDP Services
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikUdpService {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    pub load_balancer: Option<UdpLoadBalancer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UdpLoadBalancer {
    pub servers: Option<Vec<UdpServer>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UdpServer {
    pub address: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middlewares
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikMiddleware {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub using: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub middleware_type: Option<String>,
    pub error: Option<String>,
    // All possible middleware configs as optional fields
    pub add_prefix: Option<serde_json::Value>,
    pub strip_prefix: Option<serde_json::Value>,
    pub strip_prefix_regex: Option<serde_json::Value>,
    pub replace_path: Option<serde_json::Value>,
    pub replace_path_regex: Option<serde_json::Value>,
    pub headers: Option<serde_json::Value>,
    pub rate_limit: Option<serde_json::Value>,
    pub redirect_regex: Option<serde_json::Value>,
    pub redirect_scheme: Option<serde_json::Value>,
    pub basic_auth: Option<serde_json::Value>,
    pub digest_auth: Option<serde_json::Value>,
    pub forward_auth: Option<serde_json::Value>,
    pub ip_allow_list: Option<serde_json::Value>,
    pub ip_white_list: Option<serde_json::Value>,
    pub chain: Option<serde_json::Value>,
    pub circuit_breaker: Option<serde_json::Value>,
    pub compress: Option<serde_json::Value>,
    pub content_type: Option<serde_json::Value>,
    pub buffering: Option<serde_json::Value>,
    pub retry: Option<serde_json::Value>,
    pub pass_tls_client_cert: Option<serde_json::Value>,
    pub in_flight_req: Option<serde_json::Value>,
    pub plugin: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraefikTcpMiddleware {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub middleware_type: Option<String>,
    pub ip_allow_list: Option<serde_json::Value>,
    pub in_flight_conn: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TLS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikTlsCertificate {
    pub sans: Vec<String>,
    pub not_after: Option<String>,
    pub not_before: Option<String>,
    pub serial_number: Option<String>,
    pub issuer: Option<String>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraefikRawConfig {
    pub json: serde_json::Value,
}
