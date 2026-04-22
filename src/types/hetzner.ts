// Hetzner Cloud — TypeScript mirror of
// `src-tauri/crates/sorng-hetzner/src/types.rs`.
//
// Rust structs use `#[serde(rename_all = "camelCase")]` (so Rust
// snake_case fields serialise as camelCase JSON keys), and
// `#[serde(rename = "type")]` on `type_field` (JSON key `type`).
// The only non-camelCase case is `ServerStatus`
// (`rename_all = "snake_case"`).

// ─── Connection ─────────────────────────────────────────────────────────

export interface HetznerConnectionConfig {
  apiToken: string;
  baseUrl?: string | null;
  tlsSkipVerify?: boolean | null;
  timeoutSecs?: number | null;
}

export interface HetznerConnectionSummary {
  serverCount: number;
  projectName?: string | null;
}

// ─── Servers ───────────────────────────────────────────────────────────

export type ServerStatus =
  | 'running'
  | 'initializing'
  | 'starting'
  | 'stopping'
  | 'off'
  | 'deleting'
  | 'migrating'
  | 'rebuilding'
  | 'unknown';

export interface HetznerServer {
  id: number;
  name: string;
  status: ServerStatus;
  publicNet: HetznerPublicNet;
  privateNet: HetznerPrivateNet[];
  serverType: HetznerServerType;
  datacenter: HetznerDatacenter;
  image?: HetznerImage | null;
  iso?: unknown;
  rescueEnabled: boolean;
  locked: boolean;
  backupWindow?: string | null;
  outgoingTraffic?: number | null;
  ingoingTraffic?: number | null;
  includedTraffic: number;
  protection: HetznerProtection;
  labels: unknown;
  volumes: number[];
  loadBalancers: number[];
  created: string;
}

export interface HetznerPublicNet {
  ipv4?: HetznerIpv4 | null;
  ipv6?: HetznerIpv6 | null;
  floatingIps: number[];
  firewalls: HetznerFirewallRef[];
}

export interface HetznerIpv4 {
  ip: string;
  blocked: boolean;
  dnsPtr?: string | null;
}

export interface HetznerIpv6 {
  ip: string;
  blocked: boolean;
  dnsPtr: HetznerDnsPtr[];
}

export interface HetznerDnsPtr {
  ip: string;
  dnsPtr: string;
}

export interface HetznerPrivateNet {
  network: number;
  ip: string;
  aliasIps: string[];
  macAddress: string;
}

export interface HetznerFirewallRef {
  id: number;
  status: string;
}

export interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  deprecated?: boolean | null;
  prices?: HetznerPrice[] | null;
  storageType: string;
  cpuType: string;
  architecture: string;
}

export interface HetznerDatacenter {
  id: number;
  name: string;
  description: string;
  location: HetznerLocation;
}

export interface HetznerLocation {
  id: number;
  name: string;
  description: string;
  country: string;
  city: string;
  latitude: number;
  longitude: number;
  networkZone: string;
}

export interface HetznerProtection {
  delete: boolean;
  rebuild: boolean;
}

export interface HetznerPrice {
  location: string;
  priceHourly: HetznerPriceDetail;
  priceMonthly: HetznerPriceDetail;
}

export interface HetznerPriceDetail {
  net: string;
  gross: string;
}

export interface CreateServerRequest {
  name: string;
  serverType: string;
  image: string;
  location?: string | null;
  datacenter?: string | null;
  sshKeys?: number[] | null;
  volumes?: number[] | null;
  firewalls?: HetznerFirewallRef[] | null;
  networks?: number[] | null;
  userData?: string | null;
  labels?: unknown;
  publicNet?: unknown;
  startAfterCreate?: boolean | null;
}

// ─── Networks ──────────────────────────────────────────────────────────

export interface HetznerNetwork {
  id: number;
  name: string;
  ipRange: string;
  subnets: HetznerSubnet[];
  routes: HetznerRoute[];
  servers: number[];
  protection: HetznerProtection;
  labels: unknown;
  created: string;
}

export interface HetznerSubnet {
  type: string;
  ipRange: string;
  networkZone: string;
  gateway: string;
}

export interface HetznerRoute {
  destination: string;
  gateway: string;
}

export interface CreateNetworkRequest {
  name: string;
  ipRange: string;
  subnets?: HetznerSubnet[] | null;
  routes?: HetznerRoute[] | null;
  labels?: unknown;
}

// ─── Firewalls ─────────────────────────────────────────────────────────

export interface HetznerFirewall {
  id: number;
  name: string;
  rules: HetznerFirewallRule[];
  appliedTo: HetznerFirewallAppliedTo[];
  labels: unknown;
  created: string;
}

export interface HetznerFirewallRule {
  direction: string;
  protocol: string;
  port?: string | null;
  sourceIps: string[];
  destinationIps: string[];
  description?: string | null;
}

export interface HetznerFirewallAppliedTo {
  type: string;
  server?: HetznerFirewallServer | null;
}

export interface HetznerFirewallServer {
  id: number;
}

export interface CreateFirewallRequest {
  name: string;
  rules?: HetznerFirewallRule[] | null;
  labels?: unknown;
}

// ─── Floating IPs ──────────────────────────────────────────────────────

export interface HetznerFloatingIp {
  id: number;
  description?: string | null;
  ip: string;
  type: string;
  server?: number | null;
  dnsPtr: HetznerDnsPtr[];
  homeLocation: HetznerLocation;
  blocked: boolean;
  protection: HetznerProtection;
  labels: unknown;
  created: string;
  name: string;
}

export interface CreateFloatingIpRequest {
  type: string;
  homeLocation?: string | null;
  server?: number | null;
  description?: string | null;
  name?: string | null;
  labels?: unknown;
}

// ─── Volumes ───────────────────────────────────────────────────────────

export interface HetznerVolume {
  id: number;
  name: string;
  size: number;
  server?: number | null;
  location: HetznerLocation;
  linuxDevice?: string | null;
  protection: HetznerProtection;
  labels: unknown;
  status: string;
  format?: string | null;
  created: string;
}

export interface CreateVolumeRequest {
  name: string;
  size: number;
  server?: number | null;
  location?: string | null;
  automount?: boolean | null;
  format?: string | null;
  labels?: unknown;
}

// ─── Load Balancers ───────────────────────────────────────────────────

export interface HetznerLoadBalancer {
  id: number;
  name: string;
  publicNet: HetznerLbPublicNet;
  privateNet: HetznerLbPrivateNet[];
  location: HetznerLocation;
  loadBalancerType: HetznerLbType;
  protection: HetznerProtection;
  labels: unknown;
  targets: HetznerLbTarget[];
  services: HetznerLbService[];
  algorithm: HetznerLbAlgorithm;
  created: string;
}

export interface HetznerLbPublicNet {
  enabled: boolean;
  ipv4?: HetznerIpv4 | null;
  ipv6?: HetznerIpv6 | null;
}

export interface HetznerLbPrivateNet {
  network: number;
  ip: string;
}

export interface HetznerLbType {
  id: number;
  name: string;
  description: string;
  maxConnections: number;
  maxServices: number;
  maxTargets: number;
}

export interface HetznerLbTarget {
  type: string;
  server?: HetznerLbTargetServer | null;
  healthStatus?: HetznerHealthStatus[] | null;
}

export interface HetznerLbTargetServer {
  id: number;
}

export interface HetznerHealthStatus {
  listenPort: number;
  status: string;
}

export interface HetznerLbService {
  protocol: string;
  listenPort: number;
  destinationPort: number;
  proxyprotocol: boolean;
  healthCheck?: HetznerHealthCheck | null;
}

export interface HetznerHealthCheck {
  protocol: string;
  port: number;
  interval: number;
  timeout: number;
  retries: number;
  http?: HetznerHttpHealthCheck | null;
}

export interface HetznerHttpHealthCheck {
  domain?: string | null;
  path: string;
  response?: string | null;
  statusCodes?: string[] | null;
  tls?: boolean | null;
}

export interface HetznerLbAlgorithm {
  type: string;
}

// ─── Images ────────────────────────────────────────────────────────────

export interface HetznerImage {
  id: number;
  name?: string | null;
  description: string;
  type: string;
  status: string;
  imageSize?: number | null;
  diskSize: number;
  created: string;
  osFlavor: string;
  osVersion?: string | null;
  rapidDeploy?: boolean | null;
  protection: HetznerProtection;
  labels: unknown;
  createdFrom?: HetznerCreatedFrom | null;
  architecture: string;
}

export interface HetznerCreatedFrom {
  id: number;
  name: string;
}

// ─── SSH Keys ──────────────────────────────────────────────────────────

export interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  publicKey: string;
  labels: unknown;
  created: string;
}

export interface CreateSshKeyRequest {
  name: string;
  publicKey: string;
  labels?: unknown;
}

// ─── Certificates ──────────────────────────────────────────────────────

export interface HetznerCertificate {
  id: number;
  name: string;
  type: string;
  certificate?: string | null;
  fingerprint?: string | null;
  notValidBefore?: string | null;
  notValidAfter?: string | null;
  domainNames: string[];
  status?: HetznerCertStatus | null;
  labels: unknown;
  created: string;
}

export interface HetznerCertStatus {
  issuance?: string | null;
  renewal?: string | null;
  error?: unknown;
}

export interface CreateCertificateRequest {
  name: string;
  type: string;
  certificate?: string | null;
  privateKey?: string | null;
  domainNames?: string[] | null;
  labels?: unknown;
}

// ─── Actions ───────────────────────────────────────────────────────────

export interface HetznerAction {
  id: number;
  command: string;
  status: string;
  progress: number;
  started: string;
  finished?: string | null;
  resources: HetznerActionResource[];
  error?: HetznerActionError | null;
}

export interface HetznerActionResource {
  id: number;
  type: string;
}

export interface HetznerActionError {
  code: string;
  message: string;
}

// ─── Dashboard ─────────────────────────────────────────────────────────

export interface HetznerDashboard {
  totalServers: number;
  runningServers: number;
  stoppedServers: number;
  totalVolumes: number;
  totalNetworks: number;
  totalFirewalls: number;
  totalFloatingIps: number;
  totalLoadBalancers: number;
  totalImages: number;
  totalSshKeys: number;
  recentActions: HetznerAction[];
}
