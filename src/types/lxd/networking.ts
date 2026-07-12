// LXD / Incus — Networking category types (t42 slice c3).
//
// camelCase/snake_case 1:1 mirror of the networking structs in
// `src-tauri/crates/sorng-lxd/src/types.rs`. IMPORTANT: unlike the shared
// connection types (which use serde `rename_all = "camelCase"`), most of the
// networking *response* structs use `rename_all = "snake_case"` and several of
// the rule/port sub-structs carry no rename at all (verbatim Rust field names,
// which are snake_case). These interfaces therefore mirror the ACTUAL wire
// format so the shapes are correct at runtime — do not "camelCase-normalise"
// the read fields. Only the `Create*Request` bodies use camelCase (except the
// explicit `#[serde(rename = "type")]` fields), matching the Rust structs.
//
// Cross-cutting types (`LxdOperation`, `LxdError`, ...) live in the shared
// barrel and must be imported from there, not redefined here. `LxdNetworkState`
// embeds address/counter shapes that the Rust side reuses from the instances
// module; to keep this slice self-contained (and tsc-clean regardless of the
// instances slice landing) we mirror those shapes locally below.

// ─── Networks ──────────────────────────────────────────────────────────────────

/** Mirror of `LxdNetwork` (serde snake_case; `network_type` → `type`). Returned
 *  by `lxd_list_networks` / `lxd_get_network`. */
export interface LxdNetwork {
  name: string;
  description?: string | null;
  /** Rust `network_type`, serialised as `type`. e.g. `bridge`, `ovn`, `physical`. */
  type?: string | null;
  status?: string | null;
  managed?: boolean | null;
  config?: Record<string, string> | null;
  used_by?: string[] | null;
  locations?: string[] | null;
}

/** Mirror of `CreateNetworkRequest` (serde camelCase; `network_type` → `type`).
 *  Body of `lxd_create_network`. */
export interface CreateNetworkRequest {
  name: string;
  description?: string;
  /** Rust `network_type`, serialised as `type`. */
  type?: string;
  config?: Record<string, string>;
}

/** Mirror of `InstanceAddress` (verbatim Rust field names). Reused by
 *  `LxdNetworkState.addresses`; defined locally to keep the slice self-contained. */
export interface LxdNetworkAddress {
  family?: string | null;
  address?: string | null;
  netmask?: string | null;
  scope?: string | null;
}

/** Mirror of `InstanceNetCounters` (verbatim Rust field names). Reused by
 *  `LxdNetworkState.counters`. */
export interface LxdNetworkCounters {
  bytes_received?: number | null;
  bytes_sent?: number | null;
  packets_received?: number | null;
  packets_sent?: number | null;
  errors_received?: number | null;
  errors_sent?: number | null;
}

/** Mirror of `LxdNetworkState` (serde snake_case; `net_type` → `type`). Returned
 *  by `lxd_get_network_state`. */
export interface LxdNetworkState {
  addresses?: LxdNetworkAddress[] | null;
  counters?: LxdNetworkCounters | null;
  hwaddr?: string | null;
  mtu?: number | null;
  state?: string | null;
  /** Rust `net_type`, serialised as `type`. */
  type?: string | null;
  bond?: unknown;
  bridge?: unknown;
  vlan?: unknown;
  ovn?: unknown;
}

/** A single DHCP lease row. `lxd_list_network_leases` returns raw
 *  `serde_json::Value` objects; these are the fields LXD/Incus populate. */
export interface LxdNetworkLease {
  hostname?: string | null;
  hwaddr?: string | null;
  address?: string | null;
  type?: string | null;
  location?: string | null;
  [key: string]: unknown;
}

// ─── ACLs ──────────────────────────────────────────────────────────────────────

/** Mirror of `NetworkAclRule` (verbatim Rust field names — snake_case). */
export interface NetworkAclRule {
  action?: string | null;
  description?: string | null;
  source?: string | null;
  destination?: string | null;
  protocol?: string | null;
  source_port?: string | null;
  destination_port?: string | null;
  icmp_type?: string | null;
  icmp_code?: string | null;
  state?: string | null;
}

/** Mirror of `LxdNetworkAcl` (serde snake_case). Returned by
 *  `lxd_list_network_acls` / `lxd_get_network_acl`. */
export interface LxdNetworkAcl {
  name: string;
  description?: string | null;
  egress?: NetworkAclRule[] | null;
  ingress?: NetworkAclRule[] | null;
  config?: Record<string, string> | null;
  used_by?: string[] | null;
}

/** Mirror of `CreateNetworkAclRequest` (serde camelCase). Body of
 *  `lxd_create_network_acl`. */
export interface CreateNetworkAclRequest {
  name: string;
  description?: string;
  egress?: NetworkAclRule[];
  ingress?: NetworkAclRule[];
  config?: Record<string, string>;
}

// ─── Forwards (port forwarding) ─────────────────────────────────────────────────

/** Mirror of `NetworkForwardPort` (verbatim Rust field names — snake_case). */
export interface NetworkForwardPort {
  description?: string | null;
  protocol?: string | null;
  listen_ports?: string | null;
  target_address?: string | null;
  target_ports?: string | null;
}

/** Mirror of `LxdNetworkForward` (serde snake_case). Returned by
 *  `lxd_list_network_forwards` / `lxd_get_network_forward`. */
export interface LxdNetworkForward {
  listen_address?: string | null;
  description?: string | null;
  config?: Record<string, string> | null;
  ports?: NetworkForwardPort[] | null;
  location?: string | null;
}

/** Mirror of `CreateNetworkForwardRequest` (serde camelCase; note the nested
 *  `ports` items are `NetworkForwardPort`, whose keys stay snake_case). Body of
 *  `lxd_create_network_forward`. */
export interface CreateNetworkForwardRequest {
  network: string;
  listenAddress: string;
  description?: string;
  config?: Record<string, string>;
  ports?: NetworkForwardPort[];
}

// ─── Zones (DNS) ────────────────────────────────────────────────────────────────

/** Mirror of `LxdNetworkZone` (serde snake_case). Returned by
 *  `lxd_list_network_zones` / `lxd_get_network_zone`. */
export interface LxdNetworkZone {
  name: string;
  description?: string | null;
  config?: Record<string, string> | null;
  used_by?: string[] | null;
}

// ─── Load balancers ─────────────────────────────────────────────────────────────

/** Mirror of `LoadBalancerBackend` (verbatim Rust field names — snake_case). */
export interface LoadBalancerBackend {
  name?: string | null;
  description?: string | null;
  target_address?: string | null;
  target_port?: string | null;
}

/** Mirror of `LoadBalancerPort` (verbatim Rust field names — snake_case). */
export interface LoadBalancerPort {
  description?: string | null;
  protocol?: string | null;
  listen_ports?: string | null;
  target_backend?: string[] | null;
}

/** Mirror of `LxdNetworkLoadBalancer` (serde snake_case). Returned by
 *  `lxd_list_network_load_balancers` / `lxd_get_network_load_balancer`. */
export interface LxdNetworkLoadBalancer {
  listen_address?: string | null;
  description?: string | null;
  config?: Record<string, string> | null;
  backends?: LoadBalancerBackend[] | null;
  ports?: LoadBalancerPort[] | null;
  location?: string | null;
}

// ─── Peers (cross-project networking) ───────────────────────────────────────────

/** Mirror of `LxdNetworkPeer` (serde snake_case). Returned by
 *  `lxd_list_network_peers`. */
export interface LxdNetworkPeer {
  name?: string | null;
  description?: string | null;
  target_project?: string | null;
  target_network?: string | null;
  status?: string | null;
  config?: Record<string, string> | null;
}
