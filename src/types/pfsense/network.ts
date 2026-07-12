// pfSense — "Network & Firewall" domain types (t42-pfsense-c1).
//
// 1:1 mirror of the network/firewall/nat/routing/vpn structs in
// `src-tauri/crates/sorng-pfsense/src/types.rs`.
//
// WIRE CASING: the pfSense crate does NOT set `#[serde(rename_all = ...)]` on
// these structs, so serde serialises/deserialises them with the raw Rust field
// names — i.e. **snake_case** — verbatim. These interfaces therefore use
// snake_case keys (NOT camelCase). The only exceptions are fields carrying an
// explicit `#[serde(rename = "type")]`, whose wire key is `type`.
//
// (Tauri command *argument* names — `id`, `ruleId`, `fwdId`, … — are a separate
// concern handled in `usePfsenseNetwork.ts`; they are camelCased by the command
// macro. Only the payload/return struct fields below are snake_case.)

// ── Interfaces ───────────────────────────────────────────────────────────────

/** `PfsenseInterface` (aliased `NetworkInterface` in Rust) — a configured
 *  interface as returned by `pfsense_list_interfaces` / `pfsense_get_interface`. */
export interface PfsenseInterface {
  name: string;
  if_descr: string;
  if_name: string;
  enabled: boolean;
  ipaddr: string;
  subnet: string;
  ipaddrv6: string;
  subnetv6: string;
  gateway: string;
  gatewayv6: string;
  mac: string;
  media: string;
  mtu: number;
  mss: number;
  spoofmac: string;
  /** Rust `type_` with `#[serde(rename = "type")]`. */
  type: string;
  descr: string;
  blockpriv: boolean;
  blockbogons: boolean;
}

/** Alias mirroring the Rust `type NetworkInterface = PfsenseInterface`. */
export type NetworkInterface = PfsenseInterface;

/** Create/update payload for an interface (`pfsense_create_interface` /
 *  `pfsense_update_interface`, arg name `iface`). */
export interface InterfaceConfig {
  name: string;
  descr: string;
  enabled: boolean;
  typev4: string;
  ipaddr: string;
  subnet: string;
  gateway: string;
  typev6: string;
  ipaddrv6: string;
  subnetv6: string;
  gatewayv6: string;
  mtu: number;
  mss: number;
  media: string;
  spoofmac: string;
  blockpriv: boolean;
  blockbogons: boolean;
}

export interface InterfaceStatus {
  name: string;
  status: string;
  ipaddr: string;
  subnet: string;
  media: string;
  link_state: string;
  macaddr: string;
  gateway: string;
  mtu: number;
  enabled: boolean;
  bytes_in: number;
  bytes_out: number;
}

export interface InterfaceStats {
  name: string;
  bytes_in: number;
  bytes_out: number;
  packets_in: number;
  packets_out: number;
  errors_in: number;
  errors_out: number;
  collisions: number;
  multicast_in: number;
  multicast_out: number;
  dropped_in: number;
  dropped_out: number;
}

/** Per-interface counters from `pfsense_list_interface_stats` /
 *  `pfsense_get_interface_stats`. */
export interface IfStats {
  interface: string;
  bytes_in: number;
  bytes_out: number;
  packets_in: number;
  packets_out: number;
  errors_in: number;
  errors_out: number;
  collisions: number;
  speed: string;
  media: string;
  status: string;
}

// ── Firewall ─────────────────────────────────────────────────────────────────

export interface FirewallRule {
  tracker: string;
  /** Rust `type_` with `#[serde(rename = "type")]` — pass/block/reject. */
  type: string;
  interface: string;
  ipprotocol: string;
  protocol: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  descr: string;
  disabled: boolean;
  log: boolean;
  gateway: string;
  sched: string;
  os: string;
  tag: string;
  tagged: string;
  max: number;
  max_src_nodes: number;
  max_src_conn: number;
  max_src_states: number;
  statetimeout: number;
  statetype: string;
  direction: string;
  floating: boolean;
  quick: boolean;
}

export interface FirewallRuleConfig {
  /** Rust `type_` with `#[serde(rename = "type")]`. */
  type: string;
  interface: string;
  ipprotocol: string;
  protocol: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  descr: string;
  disabled: boolean;
  log: boolean;
  gateway: string;
  sched: string;
  direction: string;
  floating: boolean;
  quick: boolean;
  top: boolean;
}

export interface FirewallAlias {
  name: string;
  /** Rust `type_` with `#[serde(rename = "type")]` — host/network/port/url. */
  type: string;
  address: string[];
  descr: string;
  detail: string[];
}

export interface FirewallAliasConfig {
  name: string;
  /** Rust `type_` with `#[serde(rename = "type")]`. */
  type: string;
  address: string[];
  descr: string;
  detail: string[];
}

export interface FirewallState {
  total_entries: number;
  current_entries: number;
  states: FirewallStateEntry[];
}

export interface FirewallStateEntry {
  interface: string;
  protocol: string;
  source: string;
  destination: string;
  state: string;
  age: string;
  packets: number;
  bytes: number;
}

export interface FirewallLog {
  time: string;
  action: string;
  interface: string;
  direction: string;
  protocol: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  reason: string;
  label: string;
}

// ── NAT ──────────────────────────────────────────────────────────────────────

/** `NatRule` (aliased `NatPortForward` in Rust) — a NAT port-forward. */
export interface NatRule {
  id: string;
  interface: string;
  protocol: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  target: string;
  local_port: string;
  descr: string;
  disabled: boolean;
  nordr: boolean;
  associated_rule_id: string;
  natreflection: string;
}

/** Alias mirroring the Rust `type NatPortForward = NatRule`. */
export type NatPortForward = NatRule;

export interface NatRuleConfig {
  interface: string;
  protocol: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  target: string;
  local_port: string;
  descr: string;
  disabled: boolean;
  nordr: boolean;
  natreflection: string;
  top: boolean;
}

export interface NatOutbound {
  id: string;
  interface: string;
  source: string;
  source_port: string;
  destination: string;
  destination_port: string;
  translation_address: string;
  translation_port: string;
  protocol: string;
  poolopts: string;
  descr: string;
  disabled: boolean;
  nonat: boolean;
}

export interface Nat1to1 {
  id: string;
  interface: string;
  external: string;
  source: string;
  destination: string;
  descr: string;
  disabled: boolean;
  nobinat: boolean;
  natreflection: string;
}

// ── Routing ──────────────────────────────────────────────────────────────────

export interface StaticRoute {
  id: string;
  network: string;
  gateway: string;
  descr: string;
  disabled: boolean;
}

export interface Gateway {
  name: string;
  interface: string;
  gateway: string;
  monitor: string;
  descr: string;
  disabled: boolean;
  default_gw: boolean;
  weight: number;
  ipprotocol: string;
  interval: number;
  loss_interval: number;
  time_period: number;
  alert_interval: number;
  latencylow: number;
  latencyhigh: number;
  losslow: number;
  losshigh: number;
  action_disable: boolean;
}

export interface GatewayGroup {
  name: string;
  descr: string;
  trigger: string;
  members: GatewayGroupMember[];
}

export interface GatewayGroupMember {
  gateway: string;
  tier: number;
  virtual_ip: string;
}

export interface GatewayStatus {
  name: string;
  gateway: string;
  monitor: string;
  status: string;
  delay: string;
  stddev: string;
  loss: string;
  substatus: string;
}

export interface RoutingTableEntry {
  destination: string;
  gateway: string;
  flags: string;
  netif: string;
  expire: string;
}

// ── VPN ──────────────────────────────────────────────────────────────────────

export interface OpenVpnServer {
  vpnid: number;
  mode: string;
  protocol: string;
  dev_mode: string;
  interface: string;
  local_port: number;
  descr: string;
  tls_key: string;
  ca_ref: string;
  cert_ref: string;
  dh_length: number;
  data_ciphers: string;
  digest: string;
  tunnel_network: string;
  tunnel_networkv6: string;
  remote_network: string;
  local_network: string;
  compression: string;
  enabled: boolean;
  maxclients: number;
  dns_server1: string;
  dns_server2: string;
  ntp_server1: string;
  push_register_dns: boolean;
  topology: string;
}

export interface OpenVpnClient {
  vpnid: number;
  server_addr: string;
  server_port: number;
  protocol: string;
  dev_mode: string;
  interface: string;
  descr: string;
  ca_ref: string;
  cert_ref: string;
  tls_key: string;
  data_ciphers: string;
  digest: string;
  tunnel_network: string;
  remote_network: string;
  compression: string;
  enabled: boolean;
  auth_user: string;
  auth_pass: string;
  topology: string;
}

export interface IpsecTunnel {
  ikeid: number;
  phase1: IpsecPhase1;
  phase2: IpsecPhase2[];
  enabled: boolean;
  descr: string;
}

export interface IpsecPhase1 {
  ikeid: number;
  iketype: string;
  interface: string;
  remote_gateway: string;
  protocol: string;
  myid_type: string;
  myid_data: string;
  peerid_type: string;
  peerid_data: string;
  pre_shared_key: string;
  cert_ref: string;
  ca_ref: string;
  encryption_algorithm: string;
  hash_algorithm: string;
  dh_group: number;
  lifetime: number;
  disabled: boolean;
  nat_traversal: string;
  mobike: string;
  dpd_delay: number;
  dpd_maxfail: number;
  descr: string;
}

export interface IpsecPhase2 {
  uniqid: string;
  ikeid: number;
  mode: string;
  localid_type: string;
  localid_address: string;
  localid_netbits: number;
  remoteid_type: string;
  remoteid_address: string;
  remoteid_netbits: number;
  encryption_algorithm: string;
  hash_algorithm: string;
  pfsgroup: number;
  lifetime: number;
  disabled: boolean;
  protocol: string;
  descr: string;
}

export interface WireGuardTunnel {
  id: string;
  name: string;
  listen_port: number;
  private_key: string;
  public_key: string;
  addresses: string[];
  dns_servers: string[];
  mtu: number;
  enabled: boolean;
  descr: string;
}

export interface WireGuardPeer {
  id: string;
  tunnel_id: string;
  descr: string;
  public_key: string;
  preshared_key: string;
  allowed_ips: string[];
  endpoint: string;
  endpoint_port: number;
  persistent_keepalive: number;
}

// ── New-entity templates (seed the JSON editors in the tab) ──────────────────

export const NEW_INTERFACE_CONFIG: InterfaceConfig = {
  name: "",
  descr: "",
  enabled: true,
  typev4: "static",
  ipaddr: "",
  subnet: "",
  gateway: "",
  typev6: "none",
  ipaddrv6: "",
  subnetv6: "",
  gatewayv6: "",
  mtu: 0,
  mss: 0,
  media: "",
  spoofmac: "",
  blockpriv: false,
  blockbogons: false,
};

export const NEW_FIREWALL_RULE: FirewallRule = {
  tracker: "",
  type: "pass",
  interface: "wan",
  ipprotocol: "inet",
  protocol: "tcp",
  source: "any",
  source_port: "",
  destination: "any",
  destination_port: "",
  descr: "",
  disabled: false,
  log: false,
  gateway: "",
  sched: "",
  os: "",
  tag: "",
  tagged: "",
  max: 0,
  max_src_nodes: 0,
  max_src_conn: 0,
  max_src_states: 0,
  statetimeout: 0,
  statetype: "keep state",
  direction: "",
  floating: false,
  quick: false,
};

export const NEW_FIREWALL_ALIAS: FirewallAlias = {
  name: "",
  type: "host",
  address: [],
  descr: "",
  detail: [],
};

export const NEW_NAT_PORT_FORWARD: NatRule = {
  id: "",
  interface: "wan",
  protocol: "tcp",
  source: "any",
  source_port: "",
  destination: "",
  destination_port: "",
  target: "",
  local_port: "",
  descr: "",
  disabled: false,
  nordr: false,
  associated_rule_id: "",
  natreflection: "",
};

export const NEW_NAT_OUTBOUND: NatOutbound = {
  id: "",
  interface: "wan",
  source: "",
  source_port: "",
  destination: "any",
  destination_port: "",
  translation_address: "",
  translation_port: "",
  protocol: "",
  poolopts: "",
  descr: "",
  disabled: false,
  nonat: false,
};

export const NEW_NAT_1TO1: Nat1to1 = {
  id: "",
  interface: "wan",
  external: "",
  source: "",
  destination: "",
  descr: "",
  disabled: false,
  nobinat: false,
  natreflection: "",
};

export const NEW_STATIC_ROUTE: StaticRoute = {
  id: "",
  network: "",
  gateway: "",
  descr: "",
  disabled: false,
};

export const NEW_OPENVPN_SERVER: OpenVpnServer = {
  vpnid: 0,
  mode: "server_tls",
  protocol: "UDP4",
  dev_mode: "tun",
  interface: "wan",
  local_port: 1194,
  descr: "",
  tls_key: "",
  ca_ref: "",
  cert_ref: "",
  dh_length: 2048,
  data_ciphers: "AES-256-GCM",
  digest: "SHA256",
  tunnel_network: "",
  tunnel_networkv6: "",
  remote_network: "",
  local_network: "",
  compression: "",
  enabled: true,
  maxclients: 0,
  dns_server1: "",
  dns_server2: "",
  ntp_server1: "",
  push_register_dns: false,
  topology: "subnet",
};
