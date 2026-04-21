// ── sorng-hashicorp-vault/src/types.rs ────────────────────────────────────────
//! Domain types for HashiCorp Vault integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Connection ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConnectionConfig {
    pub addr: String,
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default)]
    pub tls_skip_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<VaultAuthMethod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VaultAuthMethod {
    Token,
    UserPass { username: String, password: String },
    AppRole { role_id: String, secret_id: String },
    Ldap { username: String, password: String },
    Kubernetes { role: String, jwt: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConnectionSummary {
    pub id: String,
    pub addr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_name: Option<String>,
    pub sealed: bool,
    pub initialized: bool,
    pub connected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultDashboard {
    pub sealed: bool,
    pub initialized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub secret_engine_count: u64,
    pub auth_method_count: u64,
    pub policy_count: u64,
    pub ha_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_node: Option<String>,
}

// ── KV Secrets Engine ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKvEntry {
    pub key: String,
    pub value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<VaultKvMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_time: Option<String>,
    pub destroyed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKvMetadata {
    pub created_time: String,
    pub current_version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_versions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_version: Option<u64>,
    pub updated_time: String,
    #[serde(default)]
    pub versions: HashMap<String, VaultKvVersionMetadata>,
    #[serde(default)]
    pub cas_required: bool,
    #[serde(default)]
    pub delete_version_after: String,
    #[serde(default)]
    pub custom_metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKvVersionMetadata {
    pub created_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_time: Option<String>,
    pub destroyed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKvListResponse {
    pub keys: Vec<String>,
}

// ── Transit Secrets Engine ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTransitKey {
    pub name: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub latest_version: u64,
    pub min_decryption_version: u64,
    pub min_encryption_version: u64,
    pub deletion_allowed: bool,
    pub exportable: bool,
    pub supports_encryption: bool,
    pub supports_decryption: bool,
    pub supports_derivation: bool,
    pub supports_signing: bool,
    #[serde(default)]
    pub keys: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTransitKeyConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_decryption_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_encryption_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exportable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_plaintext_backup: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEncryptResponse {
    pub ciphertext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultDecryptResponse {
    pub plaintext: String,
}

// ── PKI Secrets Engine ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultCertificate {
    pub serial_number: String,
    pub certificate: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuing_ca: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ca_chain: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultCaInfo {
    pub certificate: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuing_ca: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPkiRole {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_domains: Option<Vec<String>>,
    #[serde(default)]
    pub allow_subdomains: bool,
    #[serde(default)]
    pub allow_any_name: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_bits: Option<u32>,
    #[serde(default)]
    pub generate_lease: bool,
    #[serde(default)]
    pub no_store: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPkiIssueCert {
    pub common_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_names: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_sans: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_cn_from_sans: Option<bool>,
}

// ── Auth Methods ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultAuthMount {
    pub path: String,
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessor: Option<String>,
    #[serde(default)]
    pub local: bool,
    #[serde(default)]
    pub seal_wrap: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTokenInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub policies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation_ttl: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expire_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<i64>,
    pub renewable: bool,
    pub orphan: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_uses: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultTokenCreateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policies: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_parent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_default_policy: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renewable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_max_ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_uses: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_alias: Option<String>,
}

// ── Policies ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPolicy {
    pub name: String,
    pub policy_text: String,
}

// ── Audit ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultAuditDevice {
    pub path: String,
    #[serde(rename = "type")]
    pub audit_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub options: HashMap<String, String>,
    #[serde(default)]
    pub local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultAuditEntry {
    #[serde(rename = "type")]
    pub entry_type: String,
    pub time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Sys ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSealStatus {
    pub sealed: bool,
    pub initialized: bool,
    pub t: u32,
    pub n: u32,
    pub progress: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub seal_type: Option<String>,
    #[serde(default)]
    pub recovery_seal: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultHealthResponse {
    pub initialized: bool,
    pub sealed: bool,
    pub standby: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub performance_standby: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replication_performance_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replication_dr_mode: Option<String>,
    pub server_time_utc: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultLeader {
    pub ha_enabled: bool,
    pub is_self: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leader_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leader_cluster_address: Option<String>,
    pub performance_standby: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSecretEngine {
    pub path: String,
    #[serde(rename = "type")]
    pub engine_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessor: Option<String>,
    #[serde(default)]
    pub local: bool,
    #[serde(default)]
    pub seal_wrap: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<VaultMountConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMountConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_lease_ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_lease_ttl: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_no_cache: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_non_hmac_request_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_non_hmac_response_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listing_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passthrough_request_headers: Option<Vec<String>>,
}
