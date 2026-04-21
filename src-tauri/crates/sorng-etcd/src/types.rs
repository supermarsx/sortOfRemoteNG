// ── sorng-etcd/src/types.rs ──────────────────────────────────────────────────
//! Domain types for the etcd v3 API.

use serde::{Deserialize, Serialize};

// ── Connection ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdConnectionConfig {
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub auth_token: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub endpoints: Option<Vec<String>>,
    pub timeout_secs: Option<u64>,
    pub tls_skip_verify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdConnectionSummary {
    pub id: String,
    pub endpoints: Vec<String>,
    pub version: String,
    pub leader_id: u64,
    pub cluster_id: u64,
    pub connected_at: String,
}

// ── Dashboard ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdDashboard {
    pub cluster_health: bool,
    pub member_count: usize,
    pub db_size: i64,
    pub raft_index: u64,
    pub leader_info: Option<EtcdMember>,
    pub alarm_count: usize,
}

// ── KV ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdKeyValue {
    pub key: String,
    pub value: String,
    pub create_revision: i64,
    pub mod_revision: i64,
    pub version: i64,
    pub lease: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdRangeResponse {
    pub kvs: Vec<EtcdKeyValue>,
    pub count: i64,
    pub more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdPutRequest {
    pub key: String,
    pub value: String,
    pub lease: Option<i64>,
    pub prev_kv: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdDeleteRangeResponse {
    pub deleted: i64,
    pub prev_kvs: Vec<EtcdKeyValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdKeyHistory {
    pub key: String,
    pub revisions: Vec<EtcdKeyValue>,
}

// ── Lease ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdLease {
    pub id: i64,
    pub ttl: i64,
    pub granted_ttl: i64,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdLeaseGrant {
    pub id: i64,
    pub ttl: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdLeaseTimeToLive {
    pub id: i64,
    pub ttl: i64,
    pub granted_ttl: i64,
    pub keys: Vec<String>,
}

// ── Watch ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdWatchConfig {
    pub key: String,
    pub range_end: Option<String>,
    pub start_revision: Option<i64>,
    pub prev_kv: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdWatchEvent {
    pub event_type: String,
    pub kv: EtcdKeyValue,
    pub prev_kv: Option<EtcdKeyValue>,
}

// ── Cluster ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdMember {
    pub id: u64,
    pub name: String,
    pub peer_urls: Vec<String>,
    pub client_urls: Vec<String>,
    pub is_learner: bool,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdClusterHealth {
    pub healthy: bool,
    pub members: Vec<EtcdEndpointHealth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdEndpointHealth {
    pub endpoint: String,
    pub healthy: bool,
    pub took_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdEndpointStatus {
    pub endpoint: String,
    pub version: String,
    pub db_size: i64,
    pub leader: u64,
    pub raft_index: u64,
    pub raft_term: u64,
    pub is_learner: bool,
    pub errors: Vec<String>,
}

// ── Auth ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdUser {
    pub name: String,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdRole {
    pub name: String,
    pub permissions: Vec<EtcdPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdPermission {
    pub permission_type: String,
    pub key: String,
    pub range_end: String,
}

// ── Maintenance ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdAlarm {
    pub member_id: u64,
    pub alarm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdDefragResult {
    pub endpoint: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdSnapshotInfo {
    pub db_size: i64,
    pub revision: i64,
    pub member_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EtcdStatusResponse {
    pub version: String,
    pub db_size: i64,
    pub leader: u64,
    pub raft_index: u64,
    pub raft_term: u64,
    pub raft_applied_index: u64,
    pub errors: Vec<String>,
    pub db_size_in_use: i64,
    pub is_learner: bool,
}
