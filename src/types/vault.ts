// HashiCorp Vault — TypeScript mirrors of `sorng-hashicorp-vault/src/types.rs`.
//
// Field names match the Rust structs as serialised by serde (default =
// the Rust identifier). Rust uses snake_case; the backend does not apply
// renameAll, so we keep snake_case here to match wire format.

export interface VaultConnectionConfig {
  addr: string;
  token: string;
  namespace?: string;
  tls_skip_verify?: boolean;
  auth_method?: VaultAuthMethod;
}

export type VaultAuthMethod =
  | { type: 'token' }
  | { type: 'user_pass'; username: string; password: string }
  | { type: 'app_role'; role_id: string; secret_id: string }
  | { type: 'ldap'; username: string; password: string }
  | { type: 'kubernetes'; role: string; jwt: string };

export interface VaultConnectionSummary {
  id: string;
  addr: string;
  namespace?: string;
  version?: string;
  cluster_name?: string;
  sealed: boolean;
  initialized: boolean;
  connected_at: string;
}

export interface VaultDashboard {
  sealed: boolean;
  initialized: boolean;
  cluster_name?: string;
  version?: string;
  secret_engine_count: number;
  auth_method_count: number;
  policy_count: number;
  ha_enabled: boolean;
  active_node?: string;
}

export interface VaultKvEntry {
  key: string;
  value: unknown;
  metadata?: VaultKvMetadata;
  version?: number;
  created_time?: string;
  deletion_time?: string;
  destroyed: boolean;
}

export interface VaultKvVersionMetadata {
  created_time: string;
  deletion_time?: string;
  destroyed: boolean;
}

export interface VaultKvMetadata {
  created_time: string;
  current_version: number;
  max_versions?: number;
  oldest_version?: number;
  updated_time: string;
  versions: Record<string, VaultKvVersionMetadata>;
  cas_required: boolean;
  delete_version_after: string;
  custom_metadata: Record<string, string>;
}

export interface VaultTransitKey {
  name: string;
  type: string;
  latest_version: number;
  min_decryption_version: number;
  min_encryption_version: number;
  deletion_allowed: boolean;
  exportable: boolean;
  supports_encryption: boolean;
  supports_decryption: boolean;
  supports_derivation: boolean;
  supports_signing: boolean;
  keys: Record<string, unknown>;
}

export interface VaultEncryptResponse {
  ciphertext: string;
  key_version?: number;
}

export interface VaultDecryptResponse {
  plaintext: string;
}

export interface VaultCertificate {
  serial_number: string;
  certificate: string;
  issuing_ca?: string;
  ca_chain?: string[];
  private_key?: string;
  private_key_type?: string;
  expiration?: number;
}

export interface VaultCaInfo {
  certificate: string;
  serial_number?: string;
  issuing_ca?: string;
}

export interface VaultPkiIssueCert {
  common_name: string;
  alt_names?: string;
  ip_sans?: string;
  ttl?: string;
  format?: string;
  exclude_cn_from_sans?: boolean;
}

export interface VaultAuthMount {
  path: string;
  type: string;
  description?: string;
  accessor?: string;
  local: boolean;
  seal_wrap: boolean;
  config?: unknown;
}

export interface VaultTokenInfo {
  id: string;
  accessor?: string;
  display_name?: string;
  entity_id?: string;
  policies: string[];
  creation_time?: number;
  creation_ttl?: number;
  expire_time?: string;
  ttl?: number;
  renewable: boolean;
  orphan: boolean;
  path?: string;
  num_uses?: number;
}

export interface VaultTokenCreateRequest {
  id?: string;
  policies?: string[];
  no_parent?: boolean;
  no_default_policy?: boolean;
  renewable?: boolean;
  ttl?: string;
  explicit_max_ttl?: string;
  display_name?: string;
  num_uses?: number;
  period?: string;
  entity_alias?: string;
}

export interface VaultPolicy {
  name: string;
  policy_text: string;
}

export interface VaultAuditDevice {
  path: string;
  type: string;
  description?: string;
  options: Record<string, string>;
  local: boolean;
}

export interface VaultSealStatus {
  sealed: boolean;
  initialized: boolean;
  t: number;
  n: number;
  progress: number;
  version?: string;
  cluster_name?: string;
  cluster_id?: string;
  nonce?: string;
  type?: string;
  recovery_seal: boolean;
  storage_type?: string;
}

export interface VaultHealthResponse {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  performance_standby?: boolean;
  replication_performance_mode?: string;
  replication_dr_mode?: string;
  server_time_utc: number;
  version?: string;
  cluster_name?: string;
  cluster_id?: string;
}

export interface VaultLeader {
  ha_enabled: boolean;
  is_self: boolean;
  active_time?: string;
  leader_address?: string;
  leader_cluster_address?: string;
  performance_standby: boolean;
}

export interface VaultMountConfig {
  default_lease_ttl?: string;
  max_lease_ttl?: string;
  force_no_cache?: boolean;
  audit_non_hmac_request_keys?: string[];
  audit_non_hmac_response_keys?: string[];
  listing_visibility?: string;
  passthrough_request_headers?: string[];
}

export interface VaultSecretEngine {
  path: string;
  type: string;
  description?: string;
  accessor?: string;
  local: boolean;
  seal_wrap: boolean;
  config?: VaultMountConfig;
}
