/**
 * TypeScript surface for the `sorng-consul` backend crate
 * (see t3-e49 wiring).
 *
 * These types are forward-compatible mirrors of the Rust structs in
 * `src-tauri/crates/sorng-consul/src/types.rs`. All Rust structs use
 * `#[serde(rename_all = "camelCase")]` so the TS shapes use camelCase
 * keys.  Fields that are `Option<T>` in Rust are optional here.
 *
 * For rarely-used nested aggregates (dashboard, metrics, ACL policy
 * documents) we declare loose `Record<string, unknown>` shapes rather
 * than exhaustively mirroring every field — consumers can tighten
 * these progressively.
 */

export interface ConsulConnectionConfig {
  address: string;
  token?: string;
  datacenter?: string;
  tlsSkipVerify?: boolean;
  timeoutSecs?: number;
  namespace?: string;
  partition?: string;
}

export interface ConsulConnectionSummary {
  address: string;
  datacenter: string;
  nodeName: string;
  version: string;
  leader: string;
  memberCount: number;
}

export interface ConsulNode {
  id?: string;
  node: string;
  address: string;
  datacenter?: string;
  taggedAddresses?: Record<string, string>;
  meta?: Record<string, string>;
  createIndex?: number;
  modifyIndex?: number;
}

export interface ConsulService {
  id?: string;
  service: string;
  tags?: string[];
  address?: string;
  port?: number;
  meta?: Record<string, string>;
  namespace?: string;
  partition?: string;
  weights?: { passing?: number; warning?: number };
  enableTagOverride?: boolean;
  createIndex?: number;
  modifyIndex?: number;
}

export interface ConsulServiceEntry {
  node: ConsulNode;
  service: ConsulService;
  checks?: ConsulHealthCheck[];
}

export interface ConsulHealthCheck {
  node: string;
  checkId: string;
  name: string;
  status: string;
  notes?: string;
  output?: string;
  serviceId?: string;
  serviceName?: string;
  serviceTags?: string[];
  [k: string]: unknown;
}

export interface ConsulKeyValue {
  key: string;
  value?: string;
  flags?: number;
  createIndex?: number;
  modifyIndex?: number;
  lockIndex?: number;
  session?: string;
  [k: string]: unknown;
}

export interface CatalogNode {
  node: ConsulNode;
  services?: Record<string, ConsulService>;
  [k: string]: unknown;
}

export interface ConsulAgentInfo {
  config?: Record<string, unknown>;
  member?: AgentMember;
  stats?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface AgentMember {
  name: string;
  addr: string;
  port: number;
  status: number | string;
  tags?: Record<string, string>;
  [k: string]: unknown;
}

export interface ConsulAgentMetrics {
  timestamp?: string;
  gauges?: Array<Record<string, unknown>>;
  counters?: Array<Record<string, unknown>>;
  samples?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface ConsulDashboard {
  summary?: ConsulConnectionSummary;
  nodes?: ConsulNode[];
  services?: Record<string, string[]>;
  leader?: string;
  [k: string]: unknown;
}

export interface ConsulAclToken {
  accessorId: string;
  secretId?: string;
  description?: string;
  policies?: Array<{ id: string; name?: string }>;
  local?: boolean;
  createTime?: string;
  [k: string]: unknown;
}

export interface ConsulAclPolicy {
  id: string;
  name: string;
  description?: string;
  rules?: string;
  datacenters?: string[];
  [k: string]: unknown;
}

export interface AclTokenCreateRequest {
  description?: string;
  policies?: Array<{ id?: string; name?: string }>;
  local?: boolean;
  [k: string]: unknown;
}

export interface AclPolicyCreateRequest {
  name: string;
  description?: string;
  rules: string;
  datacenters?: string[];
  [k: string]: unknown;
}

export interface ConsulSession {
  id: string;
  name?: string;
  node?: string;
  ttl?: string;
  behavior?: string;
  createIndex?: number;
  modifyIndex?: number;
  [k: string]: unknown;
}

export interface SessionCreateRequest {
  name?: string;
  node?: string;
  ttl?: string;
  behavior?: string;
  lockDelay?: string;
  [k: string]: unknown;
}

export interface ConsulEvent {
  id: string;
  name: string;
  payload?: string;
  nodeFilter?: string;
  serviceFilter?: string;
  tagFilter?: string;
  version?: number;
  lTime?: number;
  [k: string]: unknown;
}

export interface EventFireRequest {
  name: string;
  payload?: string;
  nodeFilter?: string;
  serviceFilter?: string;
  tagFilter?: string;
}

export interface ServiceRegistration {
  id?: string;
  name: string;
  tags?: string[];
  address?: string;
  port?: number;
  meta?: Record<string, string>;
  [k: string]: unknown;
}
