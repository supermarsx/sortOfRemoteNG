// NetBox DCIM domain types (t42-netbox-c1).
//
// camelCase 1:1 mirror of the DCIM structs in
// `src-tauri/crates/sorng-netbox/src/types.rs` (Site, Rack, RackUnit,
// RackReservation, Device, DeviceType, Manufacturer, Platform, DeviceRole,
// Interface, InterfaceConnection, Cable, CableTrace). Tauri serializes struct
// fields as-is (snake_case on the wire) but the panel consumes a camelCased
// view; these interfaces describe that view. Fields the Rust side models as
// `serde_json::Value` (nested refs like `status`/`site`/`tenant`, plus
// `custom_fields`) are typed as the loose `NbRef` / `NbJson` below — NetBox
// returns brief nested objects (`{ id, url, display, name, slug, value, label }`)
// whose exact shape varies by endpoint.
//
// Shared shell types (PaginatedResponse, Tag, NetboxTabProps, ...) live in the
// barrel `./index`; this module owns ONLY the DCIM slice.

import type { Tag } from "./index";

/** Opaque JSON blob (`serde_json::Value`) — e.g. `custom_fields`, rendered
 *  config, `local_context_data`. */
export type NbJson = unknown;

/** Loose nested reference / choice object as returned inline by NetBox. Covers
 *  both NestedRef-style refs (`{ id, url, display, name, slug }`) and choice
 *  fields (`{ value, label }`). */
export interface NbRef {
  id?: number | null;
  url?: string | null;
  display?: string | null;
  name?: string | null;
  slug?: string | null;
  value?: string | null;
  label?: string | null;
  [key: string]: unknown;
}

/** Query-string params passed to the list commands as `Vec<(String, String)>`. */
export type NbParams = Array<[string, string]>;

/** JSON create/update payload (`serde_json::Value` on the Rust side). */
export type NbPayload = Record<string, unknown>;

// ─── Sites ─────────────────────────────────────────────────────────────────────

/** Mirror of `Site`. */
export interface Site {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  status?: NbRef | null;
  region?: NbRef | null;
  group?: NbRef | null;
  tenant?: NbRef | null;
  facility?: string | null;
  timeZone?: string | null;
  description?: string | null;
  physicalAddress?: string | null;
  shippingAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
  circuitCount?: number | null;
  deviceCount?: number | null;
  prefixCount?: number | null;
  rackCount?: number | null;
  vlanCount?: number | null;
  virtualmachineCount?: number | null;
}

// ─── Racks ─────────────────────────────────────────────────────────────────────

/** Mirror of `Rack`. */
export interface Rack {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  facilityId?: string | null;
  site?: NbRef | null;
  location?: NbRef | null;
  tenant?: NbRef | null;
  status?: NbRef | null;
  role?: NbRef | null;
  serial?: string | null;
  assetTag?: string | null;
  /** `rack_type` — serialized as `type` on the wire. */
  type?: NbRef | null;
  width?: NbRef | null;
  uHeight?: number | null;
  descUnits?: boolean | null;
  outerWidth?: number | null;
  outerDepth?: number | null;
  outerUnit?: NbRef | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
  deviceCount?: number | null;
  powerFeedCount?: number | null;
}

/** Mirror of `RackUnit` — one slot in a rack elevation. */
export interface RackUnit {
  id: number;
  name: string;
  face?: NbRef | null;
  device?: NbRef | null;
  occupied?: boolean | null;
}

/** Mirror of `RackReservation`. */
export interface RackReservation {
  id?: number | null;
  url?: string | null;
  rack?: NbRef | null;
  units?: number[] | null;
  user?: NbRef | null;
  tenant?: NbRef | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
}

// ─── Devices ───────────────────────────────────────────────────────────────────

/** Mirror of `Device`. */
export interface Device {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  deviceType?: NbRef | null;
  role?: NbRef | null;
  tenant?: NbRef | null;
  platform?: NbRef | null;
  serial?: string | null;
  assetTag?: string | null;
  site?: NbRef | null;
  location?: NbRef | null;
  rack?: NbRef | null;
  position?: number | null;
  face?: NbRef | null;
  parentDevice?: NbRef | null;
  status?: NbRef | null;
  airflow?: NbRef | null;
  primaryIp4?: NbRef | null;
  primaryIp6?: NbRef | null;
  cluster?: NbRef | null;
  virtualChassis?: NbRef | null;
  vcPosition?: number | null;
  vcPriority?: number | null;
  comments?: string | null;
  localContextData?: NbJson;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `DeviceType`. */
export interface DeviceType {
  id?: number | null;
  url?: string | null;
  manufacturer?: NbRef | null;
  model?: string | null;
  slug?: string | null;
  partNumber?: string | null;
  uHeight?: number | null;
  isFullDepth?: boolean | null;
  subdeviceRole?: NbRef | null;
  airflow?: NbRef | null;
  frontImage?: string | null;
  rearImage?: string | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  deviceCount?: number | null;
}

/** Mirror of `Manufacturer`. */
export interface Manufacturer {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  tags?: Tag[] | null;
  devicetypeCount?: number | null;
}

/** Mirror of `Platform`. */
export interface Platform {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  manufacturer?: NbRef | null;
  configTemplate?: NbRef | null;
  description?: string | null;
  tags?: Tag[] | null;
  deviceCount?: number | null;
  virtualmachineCount?: number | null;
}

/** Mirror of `DeviceRole`. */
export interface DeviceRole {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  color?: string | null;
  vmRole?: boolean | null;
  configTemplate?: NbRef | null;
  description?: string | null;
  tags?: Tag[] | null;
  deviceCount?: number | null;
  virtualmachineCount?: number | null;
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

/** Mirror of `Interface`. */
export interface Interface {
  id?: number | null;
  url?: string | null;
  device?: NbRef | null;
  name?: string | null;
  label?: string | null;
  /** `type_field` — serialized as `type` on the wire. */
  type?: NbRef | null;
  enabled?: boolean | null;
  parent?: NbRef | null;
  bridge?: NbRef | null;
  lag?: NbRef | null;
  mtu?: number | null;
  macAddress?: string | null;
  speed?: number | null;
  duplex?: NbRef | null;
  wwn?: string | null;
  mgmtOnly?: boolean | null;
  description?: string | null;
  mode?: NbRef | null;
  rfRole?: NbRef | null;
  rfChannel?: NbRef | null;
  poeMode?: NbRef | null;
  poeType?: NbRef | null;
  untaggedVlan?: NbRef | null;
  taggedVlans?: NbRef[] | null;
  markConnected?: boolean | null;
  cable?: NbRef | null;
  cableEnd?: string | null;
  wirelessLink?: NbRef | null;
  wirelessLans?: NbRef[] | null;
  vrf?: NbRef | null;
  l2vpnTermination?: NbRef | null;
  connectedEndpoints?: NbJson;
  connectedEndpointsType?: string | null;
  connectedEndpointsReachable?: boolean | null;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
  countIpaddresses?: number | null;
  countFhrpGroups?: number | null;
}

/** Mirror of `InterfaceConnection`. */
export interface InterfaceConnection {
  interfaceA?: NbRef | null;
  interfaceB?: NbRef | null;
  connectedEndpointReachable?: boolean | null;
}

// ─── Cables ────────────────────────────────────────────────────────────────────

/** Mirror of `Cable`. */
export interface Cable {
  id?: number | null;
  url?: string | null;
  /** `type_field` — serialized as `type` on the wire. */
  type?: NbRef | null;
  aTerminations?: NbRef[] | null;
  bTerminations?: NbRef[] | null;
  status?: NbRef | null;
  tenant?: NbRef | null;
  label?: string | null;
  color?: string | null;
  length?: number | null;
  lengthUnit?: NbRef | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: NbJson;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `CableTrace` — one hop in a cable path trace. */
export interface CableTrace {
  id?: number | null;
  url?: string | null;
  cable?: NbRef | null;
  nearEnd?: NbRef | null;
  farEnd?: NbRef | null;
}
