// pfSense — "Services & System" domain types (t42-pfsense-c2).
//
// 1:1 mirror of the relevant structs in
// `src-tauri/crates/sorng-pfsense/src/types.rs`. That crate does NOT set serde
// `rename_all`, so struct fields serialise with their raw Rust names — i.e.
// snake_case — and these interfaces use snake_case to match. The only exceptions
// are fields carrying `#[serde(rename = "type")]` (exposed as `type`) and
// `UserPrivilege.match_` (no rename → stays `match_`).
//
// (Top-level Tauri command ARGUMENTS are camelCase — that conversion is the
// `#[tauri::command]` macro's, independent of these struct field names.)

// ── DHCP ─────────────────────────────────────────────────────────────────────

export interface DhcpConfig {
  interface: string;
  enabled: boolean;
  range_from: string;
  range_to: string;
  domain: string;
  dns_servers: string[];
  gateway: string;
  default_lease_time: number;
  max_lease_time: number;
  wins_servers: string[];
  ntp_servers: string[];
  tftp_server: string;
  next_server: string;
  filename: string;
  deny_unknown: boolean;
  enable_static_arp: boolean;
}

export interface DhcpLease {
  ip: string;
  type: string;
  mac: string;
  hostname: string;
  descr: string;
  start: string;
  end: string;
  online: boolean;
  state: string;
  interface: string;
}

export interface DhcpStaticMapping {
  id: string;
  mac: string;
  ipaddr: string;
  hostname: string;
  descr: string;
  arp_table_static_entry: boolean;
  gateway: string;
  domain: string;
  dns_servers: string[];
  interface: string;
}

export interface DhcpRelay {
  enabled: boolean;
  interface: string[];
  server: string[];
  append_agent_id: boolean;
}

// ── DNS ──────────────────────────────────────────────────────────────────────

export interface DnsResolverConfig {
  enabled: boolean;
  port: number;
  active_interface: string[];
  outgoing_interface: string[];
  dnssec: boolean;
  forwarding: boolean;
  regdhcp: boolean;
  regdhcpstatic: boolean;
  custom_options: string;
  hide_identity: boolean;
  hide_version: boolean;
  prefetch: boolean;
  prefetch_key: boolean;
}

export interface DnsForwarderConfig {
  enabled: boolean;
  port: number;
  interface: string[];
  regdhcp: boolean;
  regdhcpstatic: boolean;
  dhcpfirst: boolean;
  strict_order: boolean;
  domain_needed: boolean;
  no_private_reverse: boolean;
  custom_options: string;
}

export interface DnsHostAlias {
  host: string;
  domain: string;
  descr: string;
}

export interface DnsHostOverride {
  id: string;
  host: string;
  domain: string;
  ip: string;
  descr: string;
  aliases: DnsHostAlias[];
}

export interface DnsDomainOverride {
  id: string;
  domain: string;
  ip: string;
  port: number;
  tls_hostname: string;
  descr: string;
  forward_tls_upstream: boolean;
}

export interface DnsCacheStats {
  total_entries: number;
  rrset_count: number;
  msg_count: number;
  infra_count: number;
  key_count: number;
}

// ── Services ─────────────────────────────────────────────────────────────────

export interface PfsenseService {
  name: string;
  descr: string;
  enabled: boolean;
  status: boolean;
  id: string;
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  pid: string;
  descr: string;
  enabled: boolean;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface SystemInfo {
  hostname: string;
  domain: string;
  version: string;
  platform: string;
  serial: string;
  netgate_id: string;
  uptime: string;
  cpu_model: string;
  cpu_count: number;
  cpu_usage: string;
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  disk_usage: string;
  temp: string;
  load_avg: string[];
  bios_vendor: string;
  bios_version: string;
  bios_date: string;
  kernel_pti: boolean;
  mds_mitigation: string;
}

export interface PackageUpdate {
  name: string;
  current_version: string;
  new_version: string;
}

export interface SystemUpdate {
  version: string;
  installed_version: string;
  update_available: boolean;
  latest_version: string;
  pkg_updates: PackageUpdate[];
}

export interface GeneralConfig {
  hostname: string;
  domain: string;
  dns_servers: string[];
  timezone: string;
  language: string;
  theme: string;
  webgui_protocol: string;
  webgui_port: number;
  webgui_ssl_cert_ref: string;
  dns_allow_override: boolean;
  already_run_wizard: boolean;
}

export interface AdvancedConfig {
  scrub_rnid: boolean;
  optimization: string;
  max_states: number;
  max_table_entries: number;
  max_frags: number;
  adaptive_start: number;
  adaptive_end: number;
  alias_resolve_interval: number;
  check_cert_ca: boolean;
  bogonsinterval: string;
  powerd_enable: boolean;
  powerd_ac_mode: string;
  powerd_battery_mode: string;
  crypto_hardware: string;
  thermal_hardware: string;
  disable_pf_scrub: boolean;
  proxy_url: string;
  proxy_port: number;
  proxy_user: string;
  proxy_pass: string;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface CaCertificate {
  refid: string;
  descr: string;
  crt: string;
  prv: string;
  serial: string;
  distinguished_name: string;
  valid_from: string;
  valid_to: string;
  key_length: number;
  hash_algo: string;
  issuer: string;
  in_use: boolean;
}

export interface ServerCertificate {
  refid: string;
  descr: string;
  ca_ref: string;
  crt: string;
  prv: string;
  csr: string;
  type: string;
  distinguished_name: string;
  valid_from: string;
  valid_to: string;
  key_length: number;
  hash_algo: string;
  san: string[];
  issuer: string;
  serial: string;
  in_use: boolean;
}

export interface CertificateRequest {
  descr: string;
  key_length: number;
  digest_alg: string;
  lifetime: number;
  country: string;
  state: string;
  city: string;
  organization: string;
  organizational_unit: string;
  common_name: string;
  alt_names: string[];
  type: string;
  ca_ref: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface PfsenseUser {
  uid: number;
  name: string;
  full_name: string;
  email: string;
  comment: string;
  disabled: boolean;
  scope: string;
  groups: string[];
  cert_refs: string[];
  authorizedkeys: string;
  ipsecpsk: string;
  expires: string;
  dashboard_columns: number;
  webguicss: string;
}

export interface PfsenseGroup {
  gid: number;
  name: string;
  descr: string;
  scope: string;
  members: string[];
  priv_list: string[];
}

export interface UserPrivilege {
  id: string;
  name: string;
  descr: string;
  // `match_` in Rust has no `#[serde(rename)]`, so the JSON key is `match_`.
  match_: string;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
  hostname: string;
  expires: string;
  type: string;
  status: string;
  link_type: string;
}

export interface NdpEntry {
  ipv6: string;
  mac: string;
  interface: string;
  hostname: string;
  expires: string;
  status: string;
}

export interface DnsLookupRecord {
  name: string;
  type: string;
  value: string;
  ttl: number;
  class: string;
}

export interface DnsLookupResult {
  query: string;
  type: string;
  results: DnsLookupRecord[];
  resolver: string;
  query_time: string;
}

export interface PingResult {
  host: string;
  count: number;
  transmitted: number;
  received: number;
  loss_pct: number;
  min_rtt: number;
  avg_rtt: number;
  max_rtt: number;
  stddev_rtt: number;
  raw: string;
}

export interface TraceHop {
  hop: number;
  ip: string;
  hostname: string;
  rtt1: string;
  rtt2: string;
  rtt3: string;
}

export interface TraceResult {
  host: string;
  hops: TraceHop[];
  raw: string;
}

// ── Backups ──────────────────────────────────────────────────────────────────

export interface BackupConfig {
  area: string;
  no_rrd: boolean;
  no_packages: boolean;
  encrypt: boolean;
  encrypt_password: string;
  skip_captive_portal: boolean;
}

export interface BackupEntry {
  id: string;
  filename: string;
  timestamp: string;
  description: string;
  size: number;
  version: string;
  config_type: string;
}
