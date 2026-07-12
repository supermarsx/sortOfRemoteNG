// NetBox Virtualization + Circuits domain types (t42 category exec c3,
// t42-netbox-c3). camelCase mirror of the Virtualization/Circuits structs in
// `src-tauri/crates/sorng-netbox/src/types.rs` — following the crate-wide
// convention established by the shell barrel (`./index.ts`): the panel consumes
// a camelCased view, so multi-word Rust fields (`last_updated`, `commit_rate`,
// `virtual_machine`, …) are mirrored as `lastUpdated`, `commitRate`,
// `virtualMachine`, … here.
//
// Fields typed `serde_json::Value` on the Rust side are nested NetBox objects
// (status `{value,label}`, references `{id,name,url,…}`, custom-field bags, …)
// whose exact shape varies by endpoint; they are typed `unknown` and read
// through the `refLabel` helper in the tab rather than being over-specified.

import type { Tag } from "./index";

// ─── Virtual machines ─────────────────────────────────────────────────────────

/** Mirror of `VirtualMachine`. */
export interface VirtualMachine {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  status?: unknown;
  site?: unknown;
  cluster?: unknown;
  role?: unknown;
  tenant?: unknown;
  platform?: unknown;
  primaryIp4?: unknown;
  primaryIp6?: unknown;
  vcpus?: number | null;
  memory?: number | null;
  disk?: number | null;
  description?: string | null;
  comments?: string | null;
  localContextData?: unknown;
  tags?: Tag[] | null;
  customFields?: unknown;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `VmInterface`. */
export interface VmInterface {
  id?: number | null;
  url?: string | null;
  virtualMachine?: unknown;
  name?: string | null;
  enabled?: boolean | null;
  parent?: unknown;
  bridge?: unknown;
  mtu?: number | null;
  macAddress?: string | null;
  description?: string | null;
  mode?: unknown;
  untaggedVlan?: unknown;
  taggedVlans?: unknown[] | null;
  vrf?: unknown;
  l2vpnTermination?: unknown;
  tags?: Tag[] | null;
  customFields?: unknown;
  created?: string | null;
  lastUpdated?: string | null;
  countIpaddresses?: number | null;
  countFhrpGroups?: number | null;
}

// ─── Clusters ─────────────────────────────────────────────────────────────────

/** Mirror of `Cluster` (`type_field` is wired as `type`). */
export interface Cluster {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  type?: unknown;
  group?: unknown;
  tenant?: unknown;
  site?: unknown;
  status?: unknown;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: unknown;
  created?: string | null;
  lastUpdated?: string | null;
  deviceCount?: number | null;
  virtualmachineCount?: number | null;
}

/** Mirror of `ClusterType`. */
export interface ClusterType {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  tags?: Tag[] | null;
  clusterCount?: number | null;
}

/** Mirror of `ClusterGroup`. */
export interface ClusterGroup {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  tags?: Tag[] | null;
  clusterCount?: number | null;
}

// ─── Circuits ─────────────────────────────────────────────────────────────────

/** Mirror of `Circuit` (`type_field` is wired as `type`). */
export interface Circuit {
  id?: number | null;
  url?: string | null;
  cid?: string | null;
  provider?: unknown;
  providerAccount?: unknown;
  type?: unknown;
  status?: unknown;
  tenant?: unknown;
  installDate?: string | null;
  terminationDate?: string | null;
  commitRate?: number | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: unknown;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `CircuitProvider`. */
export interface CircuitProvider {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  asns?: unknown[] | null;
  account?: string | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  circuitCount?: number | null;
}

/** Mirror of `CircuitType`. */
export interface CircuitType {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  color?: string | null;
  description?: string | null;
  tags?: Tag[] | null;
  circuitCount?: number | null;
}

/** Mirror of `CircuitTermination`. */
export interface CircuitTermination {
  id?: number | null;
  url?: string | null;
  circuit?: unknown;
  termSide?: string | null;
  site?: unknown;
  providerNetwork?: unknown;
  portSpeed?: number | null;
  upstreamSpeed?: number | null;
  xconnectId?: string | null;
  ppInfo?: string | null;
  description?: string | null;
  markConnected?: boolean | null;
  cable?: unknown;
  cableEnd?: string | null;
  tags?: Tag[] | null;
  customFields?: unknown;
  created?: string | null;
  lastUpdated?: string | null;
}
