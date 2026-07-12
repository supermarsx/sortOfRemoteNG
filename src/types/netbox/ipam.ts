// NetBox IPAM domain types (t42 category exec `c2 — ipam`).
//
// camelCase 1:1 mirror of the IPAM structs in
// `src-tauri/crates/sorng-netbox/src/types.rs` — IpAddress, Prefix, Vrf,
// Aggregate, Rir, IpamRole, Service, Vlan, VlanGroup. Fields typed
// `Option<serde_json::Value>` on the Rust side (family/status/role/vrf/tenant/
// nested refs/custom_fields/…) are surfaced here as `unknown` because NetBox
// returns them either as a brief-object (`{ id, url, display, value, label }`)
// or a bare scalar depending on endpoint and API version; the tab reads them
// with the runtime `netboxLabel()` helper rather than a fixed shape.
//
// Shared types (Tag, NestedRef, PaginatedResponse, NetboxTabProps) come from the
// barrel `../netbox`; this module only owns the IPAM domain and is re-exported
// via an append-only `export * from "./ipam"` line in `index.ts`.

import type { Tag } from "./index";

/** A NetBox brief nested object or bare scalar (`status`, `role`, `vrf`,
 *  `tenant`, `site`, `family`, …). Rendered via `netboxLabel()`. */
export type NetboxValue = unknown;

/** Free-form custom-field bag (`custom_fields`). */
export type NetboxCustomFields = Record<string, unknown> | null;

// ─── IP Addresses ─────────────────────────────────────────────────────────────

/** Mirror of `IpAddress`. */
export interface IpAddress {
  id?: number | null;
  url?: string | null;
  family?: NetboxValue;
  address?: string | null;
  vrf?: NetboxValue;
  tenant?: NetboxValue;
  status?: NetboxValue;
  role?: NetboxValue;
  assignedObjectType?: string | null;
  assignedObjectId?: number | null;
  assignedObject?: NetboxValue;
  natInside?: NetboxValue;
  natOutside?: NetboxValue[] | null;
  dnsName?: string | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
}

// ─── Prefixes ─────────────────────────────────────────────────────────────────

/** Mirror of `Prefix`. */
export interface Prefix {
  id?: number | null;
  url?: string | null;
  family?: NetboxValue;
  prefix?: string | null;
  site?: NetboxValue;
  vrf?: NetboxValue;
  tenant?: NetboxValue;
  vlan?: NetboxValue;
  status?: NetboxValue;
  role?: NetboxValue;
  isPool?: boolean | null;
  markUtilized?: boolean | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
  depth?: number | null;
  children?: number | null;
}

// ─── VRFs ─────────────────────────────────────────────────────────────────────

/** Mirror of `Vrf`. */
export interface Vrf {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  rd?: string | null;
  tenant?: NetboxValue;
  enforceUnique?: boolean | null;
  description?: string | null;
  comments?: string | null;
  importTargets?: NetboxValue[] | null;
  exportTargets?: NetboxValue[] | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
  ipaddressCount?: number | null;
  prefixCount?: number | null;
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

/** Mirror of `Aggregate`. */
export interface Aggregate {
  id?: number | null;
  url?: string | null;
  family?: NetboxValue;
  prefix?: string | null;
  rir?: NetboxValue;
  tenant?: NetboxValue;
  dateAdded?: string | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
}

// ─── RIRs ─────────────────────────────────────────────────────────────────────

/** Mirror of `Rir`. */
export interface Rir {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  isPrivate?: boolean | null;
  description?: string | null;
  tags?: Tag[] | null;
  aggregateCount?: number | null;
}

// ─── IPAM roles ───────────────────────────────────────────────────────────────

/** Mirror of `IpamRole`. */
export interface IpamRole {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  weight?: number | null;
  description?: string | null;
  tags?: Tag[] | null;
  prefixCount?: number | null;
  vlanCount?: number | null;
}

// ─── Services ─────────────────────────────────────────────────────────────────

/** Mirror of `Service`. */
export interface Service {
  id?: number | null;
  url?: string | null;
  device?: NetboxValue;
  virtualMachine?: NetboxValue;
  name?: string | null;
  protocol?: NetboxValue;
  ports?: number[] | null;
  ipaddresses?: NetboxValue[] | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
}

// ─── VLANs ────────────────────────────────────────────────────────────────────

/** Mirror of `Vlan`. */
export interface Vlan {
  id?: number | null;
  url?: string | null;
  site?: NetboxValue;
  group?: NetboxValue;
  vid?: number | null;
  name?: string | null;
  tenant?: NetboxValue;
  status?: NetboxValue;
  role?: NetboxValue;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NetboxCustomFields;
  created?: string | null;
  lastUpdated?: string | null;
  prefixCount?: number | null;
}

/** Mirror of `VlanGroup`. */
export interface VlanGroup {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  scopeType?: string | null;
  scopeId?: number | null;
  scope?: NetboxValue;
  description?: string | null;
  tags?: Tag[] | null;
  vlanCount?: number | null;
  utilization?: string | null;
}
