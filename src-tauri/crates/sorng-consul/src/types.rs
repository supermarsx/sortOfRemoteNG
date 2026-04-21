//! Shared types for HashiCorp Consul management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulConnectionConfig {
    /// Consul HTTP API URL (default: http://localhost:8500)
    pub address: String,
    /// ACL token for authentication
    pub token: Option<String>,
    /// Datacenter to target
    pub datacenter: Option<String>,
    /// Skip TLS certificate verification
    pub tls_skip_verify: Option<bool>,
    /// Request timeout in seconds
    pub timeout_secs: Option<u64>,
    /// Optional namespace (Consul Enterprise)
    pub namespace: Option<String>,
    /// Optional partition (Consul Enterprise)
    pub partition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulConnectionSummary {
    pub address: String,
    pub datacenter: String,
    pub node_name: String,
    pub version: String,
    pub leader: String,
    pub member_count: usize,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Node
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulNode {
    pub id: Option<String>,
    pub node: String,
    pub address: String,
    pub datacenter: Option<String>,
    pub tagged_addresses: Option<HashMap<String, String>>,
    pub meta: Option<HashMap<String, String>>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulService {
    pub id: Option<String>,
    pub service: String,
    pub tags: Option<Vec<String>>,
    pub address: Option<String>,
    pub port: Option<u16>,
    pub meta: Option<HashMap<String, String>>,
    pub namespace: Option<String>,
    pub partition: Option<String>,
    pub weights: Option<ServiceWeights>,
    pub enable_tag_override: Option<bool>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceWeights {
    pub passing: i32,
    pub warning: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulServiceEntry {
    pub node: ConsulNode,
    pub service: ConsulService,
    pub checks: Vec<ConsulHealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRegistration {
    pub name: String,
    pub id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub address: Option<String>,
    pub port: Option<u16>,
    pub meta: Option<HashMap<String, String>>,
    pub check: Option<ServiceCheckRegistration>,
    pub checks: Option<Vec<ServiceCheckRegistration>>,
    pub enable_tag_override: Option<bool>,
    pub weights: Option<ServiceWeights>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCheckRegistration {
    pub name: Option<String>,
    pub check_id: Option<String>,
    pub http: Option<String>,
    pub tcp: Option<String>,
    pub grpc: Option<String>,
    pub interval: Option<String>,
    pub timeout: Option<String>,
    pub deregister_critical_service_after: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulHealthCheck {
    pub node: Option<String>,
    pub check_id: Option<String>,
    pub name: String,
    pub status: String,
    pub notes: Option<String>,
    pub output: Option<String>,
    pub service_id: Option<String>,
    pub service_name: Option<String>,
    pub service_tags: Option<Vec<String>>,
    #[serde(rename = "Type")]
    pub check_type: Option<String>,
    pub definition: Option<serde_json::Value>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRegistration {
    pub name: String,
    pub check_id: Option<String>,
    pub service_id: Option<String>,
    pub http: Option<String>,
    pub tcp: Option<String>,
    pub grpc: Option<String>,
    pub interval: Option<String>,
    pub timeout: Option<String>,
    pub deregister_critical_service_after: Option<String>,
    pub tls_skip_verify: Option<bool>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Key-Value
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulKeyValue {
    pub key: String,
    pub value: Option<String>,
    pub flags: Option<u64>,
    pub session: Option<String>,
    pub lock_index: Option<u64>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulKeyMetadata {
    pub key: String,
    pub flags: u64,
    pub lock_index: u64,
    pub session: Option<String>,
    pub create_index: u64,
    pub modify_index: u64,
}

/// Raw KV entry as returned by the Consul API (PascalCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawKvEntry {
    #[serde(rename = "Key")]
    pub key: String,
    #[serde(rename = "Value")]
    pub value: Option<String>,
    #[serde(rename = "Flags")]
    pub flags: u64,
    #[serde(rename = "Session")]
    pub session: Option<String>,
    #[serde(rename = "LockIndex")]
    pub lock_index: u64,
    #[serde(rename = "CreateIndex")]
    pub create_index: u64,
    #[serde(rename = "ModifyIndex")]
    pub modify_index: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Session
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulSession {
    pub id: String,
    pub name: Option<String>,
    pub node: Option<String>,
    pub lock_delay: Option<String>,
    pub behavior: Option<String>,
    pub ttl: Option<String>,
    pub checks: Option<Vec<String>>,
    pub node_checks: Option<Vec<String>>,
    pub service_checks: Option<Vec<SessionServiceCheck>>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionServiceCheck {
    pub id: String,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateRequest {
    pub name: Option<String>,
    pub node: Option<String>,
    pub lock_delay: Option<String>,
    pub behavior: Option<String>,
    pub ttl: Option<String>,
    pub checks: Option<Vec<String>>,
    pub node_checks: Option<Vec<String>>,
    pub service_checks: Option<Vec<SessionServiceCheck>>,
}

/// Raw session as returned by the Consul API (PascalCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSession {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Name")]
    pub name: Option<String>,
    #[serde(rename = "Node")]
    pub node: Option<String>,
    #[serde(rename = "LockDelay")]
    pub lock_delay: Option<u64>,
    #[serde(rename = "Behavior")]
    pub behavior: Option<String>,
    #[serde(rename = "TTL")]
    pub ttl: Option<String>,
    #[serde(rename = "Checks")]
    pub checks: Option<Vec<String>>,
    #[serde(rename = "NodeChecks")]
    pub node_checks: Option<Vec<String>>,
    #[serde(rename = "ServiceChecks")]
    pub service_checks: Option<Vec<SessionServiceCheck>>,
    #[serde(rename = "CreateIndex")]
    pub create_index: Option<u64>,
    #[serde(rename = "ModifyIndex")]
    pub modify_index: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACL
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulAclToken {
    pub accessor_id: String,
    pub secret_id: Option<String>,
    pub description: Option<String>,
    pub policies: Option<Vec<AclTokenPolicyLink>>,
    pub roles: Option<Vec<AclTokenRoleLink>>,
    pub service_identities: Option<Vec<AclServiceIdentity>>,
    pub node_identities: Option<Vec<AclNodeIdentity>>,
    pub local: Option<bool>,
    pub expiration_time: Option<String>,
    pub expiration_ttl: Option<String>,
    pub namespace: Option<String>,
    pub create_time: Option<String>,
    pub hash: Option<String>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclTokenPolicyLink {
    #[serde(rename = "ID")]
    pub id: Option<String>,
    #[serde(rename = "Name")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclTokenRoleLink {
    #[serde(rename = "ID")]
    pub id: Option<String>,
    #[serde(rename = "Name")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclServiceIdentity {
    pub service_name: String,
    pub datacenters: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclNodeIdentity {
    pub node_name: String,
    pub datacenter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclTokenCreateRequest {
    pub description: Option<String>,
    pub policies: Option<Vec<AclTokenPolicyLink>>,
    pub roles: Option<Vec<AclTokenRoleLink>>,
    pub service_identities: Option<Vec<AclServiceIdentity>>,
    pub node_identities: Option<Vec<AclNodeIdentity>>,
    pub local: Option<bool>,
    pub expiration_time: Option<String>,
    pub expiration_ttl: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulAclPolicy {
    #[serde(rename = "ID")]
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub rules: Option<String>,
    pub datacenters: Option<Vec<String>>,
    pub namespace: Option<String>,
    pub hash: Option<String>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclPolicyCreateRequest {
    pub name: String,
    pub description: Option<String>,
    pub rules: String,
    pub datacenters: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulAclRole {
    #[serde(rename = "ID")]
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub policies: Option<Vec<AclTokenPolicyLink>>,
    pub service_identities: Option<Vec<AclServiceIdentity>>,
    pub node_identities: Option<Vec<AclNodeIdentity>>,
    pub namespace: Option<String>,
    pub hash: Option<String>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclRoleCreateRequest {
    pub name: String,
    pub description: Option<String>,
    pub policies: Option<Vec<AclTokenPolicyLink>>,
    pub service_identities: Option<Vec<AclServiceIdentity>>,
    pub node_identities: Option<Vec<AclNodeIdentity>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Event
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulEvent {
    pub id: String,
    pub name: String,
    pub payload: Option<String>,
    pub node_filter: Option<String>,
    pub service_filter: Option<String>,
    pub tag_filter: Option<String>,
    pub version: Option<u64>,
    pub l_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFireRequest {
    pub name: String,
    pub payload: Option<String>,
    pub node_filter: Option<String>,
    pub service_filter: Option<String>,
    pub tag_filter: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulAgentInfo {
    pub config: Option<serde_json::Value>,
    pub coord: Option<serde_json::Value>,
    pub member: Option<AgentMember>,
    pub meta: Option<HashMap<String, String>>,
    pub stats: Option<HashMap<String, serde_json::Value>>,
    pub debug_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMember {
    pub name: String,
    pub addr: String,
    pub port: u16,
    pub tags: Option<HashMap<String, String>>,
    pub status: u8,
    pub protocol_min: Option<u8>,
    pub protocol_max: Option<u8>,
    pub protocol_cur: Option<u8>,
    pub delegate_min: Option<u8>,
    pub delegate_max: Option<u8>,
    pub delegate_cur: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulAgentMetrics {
    pub timestamp: Option<String>,
    pub gauges: Option<Vec<MetricGauge>>,
    pub counters: Option<Vec<MetricCounter>>,
    pub samples: Option<Vec<MetricSample>>,
    pub points: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricGauge {
    pub name: String,
    pub value: f64,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricCounter {
    pub name: String,
    pub count: u64,
    pub sum: f64,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub rate: f64,
    pub labels: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSample {
    pub name: String,
    pub count: u64,
    pub sum: f64,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub stddev: f64,
    pub labels: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Catalog
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogNode {
    pub node: ConsulNode,
    pub services: Option<HashMap<String, ConsulService>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDatacenter(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRegistration {
    pub node: String,
    pub address: String,
    pub datacenter: Option<String>,
    pub tagged_addresses: Option<HashMap<String, String>>,
    pub node_meta: Option<HashMap<String, String>>,
    pub service: Option<CatalogServiceRegistration>,
    pub check: Option<CatalogCheckRegistration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogServiceRegistration {
    pub id: Option<String>,
    pub service: String,
    pub tags: Option<Vec<String>>,
    pub address: Option<String>,
    pub port: Option<u16>,
    pub meta: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCheckRegistration {
    pub node: Option<String>,
    pub check_id: Option<String>,
    pub name: String,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub service_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDeregistration {
    pub node: String,
    pub datacenter: Option<String>,
    pub check_id: Option<String>,
    pub service_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Prepared Query
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulPreparedQuery {
    pub id: Option<String>,
    pub name: String,
    pub session: Option<String>,
    pub token: Option<String>,
    pub service: PreparedQueryService,
    pub dns: Option<PreparedQueryDns>,
    pub template: Option<serde_json::Value>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedQueryService {
    pub service: String,
    pub failover: Option<PreparedQueryFailover>,
    pub only_passing: Option<bool>,
    pub near: Option<String>,
    pub tags: Option<Vec<String>>,
    pub node_meta: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedQueryFailover {
    pub nearest_n: Option<u32>,
    pub datacenters: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedQueryDns {
    pub ttl: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transaction
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulTxnOp {
    #[serde(rename = "KV")]
    pub kv: Option<TxnKvOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnKvOp {
    pub verb: String,
    pub key: String,
    pub value: Option<String>,
    pub flags: Option<u64>,
    pub index: Option<u64>,
    pub session: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnResult {
    pub results: Option<Vec<TxnResultEntry>>,
    pub errors: Option<Vec<TxnError>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnResultEntry {
    #[serde(rename = "KV")]
    pub kv: Option<RawKvEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnError {
    pub op_index: u64,
    pub what: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Intentions (Connect)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulServiceIntention {
    pub id: Option<String>,
    pub source_name: String,
    pub destination_name: String,
    pub source_namespace: Option<String>,
    pub destination_namespace: Option<String>,
    pub source_partition: Option<String>,
    pub destination_partition: Option<String>,
    pub action: String,
    pub description: Option<String>,
    pub precedence: Option<u32>,
    pub source_type: Option<String>,
    pub meta: Option<HashMap<String, String>>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub create_index: Option<u64>,
    pub modify_index: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard (aggregate view)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsulDashboard {
    pub datacenter: String,
    pub node_name: String,
    pub version: String,
    pub leader: String,
    pub members: Vec<AgentMember>,
    pub services: HashMap<String, Vec<String>>,
    pub node_count: usize,
    pub service_count: usize,
    pub check_summary: CheckSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSummary {
    pub passing: usize,
    pub warning: usize,
    pub critical: usize,
    pub total: usize,
}
