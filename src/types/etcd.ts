/**
 * TypeScript surface for the `sorng-etcd` backend crate
 * (see t3-e49 wiring).
 *
 * Mirrors the Rust structs in
 * `src-tauri/crates/sorng-etcd/src/types.rs`. Unlike the consul crate,
 * etcd types do NOT use `rename_all = "camelCase"`, so these TS
 * interfaces use snake_case keys to match the serde wire format.
 */

export interface EtcdConnectionConfig {
  host: string;
  port: number;
  tls: boolean;
  auth_token?: string;
  username?: string;
  password?: string;
  endpoints?: string[];
  timeout_secs?: number;
  tls_skip_verify?: boolean;
}

export interface EtcdConnectionSummary {
  id: string;
  endpoints: string[];
  version: string;
  leader_id: number;
  cluster_id: number;
  connected_at: string;
}

export interface EtcdDashboard {
  cluster_health: boolean;
  member_count: number;
  db_size: number;
  raft_index: number;
  leader_info?: EtcdMember;
  alarm_count: number;
}

export interface EtcdKeyValue {
  key: string;
  value: string;
  create_revision: number;
  mod_revision: number;
  version: number;
  lease?: number;
}

export interface EtcdRangeResponse {
  kvs: EtcdKeyValue[];
  count: number;
  more: boolean;
}

export interface EtcdPutRequest {
  key: string;
  value: string;
  lease?: number;
  prev_kv?: boolean;
}

export interface EtcdDeleteRangeResponse {
  deleted: number;
  prev_kvs: EtcdKeyValue[];
}

export interface EtcdKeyHistory {
  key: string;
  revisions: EtcdKeyValue[];
}

export interface EtcdLease {
  id: number;
  ttl: number;
  granted_ttl: number;
  keys: string[];
}

export interface EtcdLeaseGrant {
  id: number;
  ttl: number;
}

export interface EtcdLeaseTimeToLive {
  id: number;
  ttl: number;
  granted_ttl: number;
  keys: string[];
}

export interface EtcdMember {
  id: number;
  name: string;
  peer_urls: string[];
  client_urls: string[];
  is_learner: boolean;
  status?: string;
}

export interface EtcdClusterHealth {
  healthy: boolean;
  members: EtcdEndpointHealth[];
}

export interface EtcdEndpointHealth {
  endpoint: string;
  healthy: boolean;
  took_ms: number;
  error?: string;
}

export interface EtcdEndpointStatus {
  endpoint: string;
  version: string;
  db_size: number;
  leader: number;
  raft_index: number;
  raft_term: number;
  is_learner: boolean;
  errors: string[];
}

export interface EtcdUser {
  name: string;
  roles: string[];
}

export interface EtcdRole {
  name: string;
  permissions: EtcdPermission[];
}

export interface EtcdPermission {
  permission_type: string;
  key: string;
  range_end: string;
}

export interface EtcdAlarm {
  member_id: number;
  alarm: string;
}

export interface EtcdDefragResult {
  endpoint: string;
  success: boolean;
  message: string;
}

export interface EtcdStatusResponse {
  version: string;
  db_size: number;
  leader: number;
  raft_index: number;
  raft_term: number;
  raft_applied_index: number;
  errors: string[];
  db_size_in_use: number;
  is_learner: boolean;
}
