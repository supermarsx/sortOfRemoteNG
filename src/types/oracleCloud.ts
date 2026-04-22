// Oracle Cloud Infrastructure (OCI) — TypeScript mirror of
// `src-tauri/crates/sorng-oracle-cloud/src/types.rs`.
//
// All structs are `#[serde(rename_all = "camelCase")]`, so Rust
// snake_case fields serialise as camelCase JSON keys.

// ─── Connection ─────────────────────────────────────────────────────────

export interface OciConnectionConfig {
  region: string;
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  compartmentId?: string | null;
  tlsSkipVerify?: boolean | null;
  timeoutSecs?: number | null;
}

export interface OciConnectionSummary {
  region: string;
  tenancyOcid: string;
  userOcid: string;
  compartmentId?: string | null;
}

// ─── Compute ───────────────────────────────────────────────────────────

export interface OciInstance {
  id: string;
  displayName: string;
  compartmentId: string;
  availabilityDomain: string;
  faultDomain?: string | null;
  shape: string;
  lifecycleState: string;
  timeCreated: string;
  imageId?: string | null;
  region: string;
  metadata?: unknown;
  shapeConfig?: OciShapeConfig | null;
  sourceDetails?: unknown;
  launchOptions?: unknown;
  agentConfig?: unknown;
  definedTags?: unknown;
  freeformTags?: unknown;
}

export interface OciShapeConfig {
  ocpus?: number | null;
  memoryInGbs?: number | null;
  baselineOcpuUtilization?: string | null;
  gpuDescription?: string | null;
  gpus?: number | null;
  networkingBandwidthInGbps?: number | null;
}

export interface OciShape {
  shape: string;
  ocpus?: number | null;
  memoryInGbs?: number | null;
  networkingBandwidthInGbps?: number | null;
  gpuDescription?: string | null;
  gpus?: number | null;
  isFlexible?: boolean | null;
}

export interface OciImage {
  id: string;
  displayName: string;
  compartmentId: string;
  operatingSystem: string;
  operatingSystemVersion: string;
  lifecycleState: string;
  sizeInMbs?: number | null;
  timeCreated: string;
}

export interface OciVnicAttachment {
  id: string;
  instanceId: string;
  vnicId: string;
  subnetId: string;
  lifecycleState: string;
  timeCreated: string;
}

export interface OciBootVolume {
  id: string;
  displayName: string;
  compartmentId: string;
  availabilityDomain: string;
  sizeInGbs: number;
  lifecycleState: string;
  timeCreated: string;
  imageId?: string | null;
  vpusPerGb?: number | null;
}

export interface LaunchInstanceRequest {
  compartmentId: string;
  availabilityDomain: string;
  shape: string;
  displayName?: string | null;
  imageId?: string | null;
  subnetId?: string | null;
  shapeConfig?: OciShapeConfig | null;
  metadata?: unknown;
  sshAuthorizedKeys?: string | null;
}

// ─── Networking ────────────────────────────────────────────────────────

export interface OciVcn {
  id: string;
  displayName: string;
  compartmentId: string;
  cidrBlock: string;
  cidrBlocks?: string[] | null;
  dnsLabel?: string | null;
  lifecycleState: string;
  timeCreated: string;
  defaultRouteTableId?: string | null;
  defaultSecurityListId?: string | null;
  defaultDhcpOptionsId?: string | null;
}

export interface OciSubnet {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  cidrBlock: string;
  availabilityDomain?: string | null;
  lifecycleState: string;
  timeCreated: string;
  routeTableId?: string | null;
  securityListIds?: string[] | null;
  dnsLabel?: string | null;
  prohibitPublicIpOnVnic?: boolean | null;
}

export interface OciSecurityList {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  lifecycleState: string;
  ingressSecurityRules: OciSecurityRule[];
  egressSecurityRules: OciSecurityRule[];
}

export interface OciSecurityRule {
  protocol: string;
  source?: string | null;
  destination?: string | null;
  description?: string | null;
  isStateless?: boolean | null;
  tcpOptions?: unknown;
  udpOptions?: unknown;
  icmpOptions?: unknown;
}

export interface OciRouteTable {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  lifecycleState: string;
  routeRules: OciRouteRule[];
}

export interface OciRouteRule {
  destination: string;
  destinationType: string;
  networkEntityId: string;
  description?: string | null;
}

export interface OciInternetGateway {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  lifecycleState: string;
  isEnabled: boolean;
  timeCreated: string;
}

export interface OciNatGateway {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  lifecycleState: string;
  natIp: string;
  timeCreated: string;
}

export interface OciLoadBalancer {
  id: string;
  displayName: string;
  compartmentId: string;
  lifecycleState: string;
  shapeName: string;
  ipAddresses: OciIpAddress[];
  subnetIds: string[];
  isPrivate?: boolean | null;
  timeCreated: string;
}

export interface OciIpAddress {
  ipAddress: string;
  isPublic?: boolean | null;
}

export interface OciNetworkSecurityGroup {
  id: string;
  displayName: string;
  compartmentId: string;
  vcnId: string;
  lifecycleState: string;
  timeCreated: string;
}

// ─── Storage ───────────────────────────────────────────────────────────

export interface OciBlockVolume {
  id: string;
  displayName: string;
  compartmentId: string;
  availabilityDomain: string;
  sizeInGbs: number;
  lifecycleState: string;
  timeCreated: string;
  vpusPerGb?: number | null;
}

export interface OciBucket {
  name: string;
  namespaceName: string;
  compartmentId: string;
  createdBy: string;
  timeCreated: string;
  etag: string;
  publicAccessType?: string | null;
  storageTier?: string | null;
  objectLifecyclePolicyEtag?: string | null;
  freeformTags?: unknown;
  approximateCount?: number | null;
  approximateSize?: number | null;
}

export interface OciObject {
  name: string;
  size?: number | null;
  md5?: string | null;
  timeCreated?: string | null;
  etag?: string | null;
  storageTier?: string | null;
}

export interface OciVolumeAttachment {
  id: string;
  instanceId: string;
  volumeId: string;
  attachmentType: string;
  lifecycleState: string;
  timeCreated: string;
  device?: string | null;
  isReadOnly?: boolean | null;
}

// ─── Identity / IAM ────────────────────────────────────────────────────

export interface OciCompartment {
  id: string;
  name: string;
  description: string;
  compartmentId: string;
  lifecycleState: string;
  timeCreated: string;
  freeformTags?: unknown;
}

export interface OciUser {
  id: string;
  name: string;
  description: string;
  compartmentId: string;
  lifecycleState: string;
  timeCreated: string;
  email?: string | null;
  isMfaActivated?: boolean | null;
}

export interface OciGroup {
  id: string;
  name: string;
  description: string;
  compartmentId: string;
  lifecycleState: string;
  timeCreated: string;
}

export interface OciPolicy {
  id: string;
  name: string;
  description: string;
  compartmentId: string;
  lifecycleState: string;
  statements: string[];
  timeCreated: string;
}

// ─── Database ──────────────────────────────────────────────────────────

export interface OciDbSystem {
  id: string;
  displayName: string;
  compartmentId: string;
  availabilityDomain: string;
  shape: string;
  lifecycleState: string;
  dbVersion: string;
  cpuCoreCount: number;
  dataStorageSizeInGbs?: number | null;
  nodeCount?: number | null;
  timeCreated: string;
  subnetId: string;
}

export interface OciAutonomousDb {
  id: string;
  displayName: string;
  compartmentId: string;
  lifecycleState: string;
  dbName: string;
  dbVersion?: string | null;
  cpuCoreCount: number;
  dataStorageSizeInTbs?: number | null;
  isFreeTier?: boolean | null;
  timeCreated: string;
  connectionStrings?: unknown;
}

// ─── Containers / OKE ──────────────────────────────────────────────────

export interface OciContainerInstance {
  id: string;
  displayName: string;
  compartmentId: string;
  availabilityDomain: string;
  lifecycleState: string;
  shape: string;
  shapeConfig?: OciShapeConfig | null;
  containerCount: number;
  timeCreated: string;
  vnics?: unknown[] | null;
  containers?: OciContainer[] | null;
}

export interface OciContainer {
  containerId: string;
  displayName: string;
  imageUrl: string;
  lifecycleState: string;
  resourceConfig?: unknown;
  healthChecks?: unknown[] | null;
}

export interface OkeCluster {
  id: string;
  name: string;
  compartmentId: string;
  vcnId: string;
  kubernetesVersion: string;
  lifecycleState: string;
  endpointConfig?: unknown;
  options?: unknown;
  timeCreated: string;
}

export interface OkeNodePool {
  id: string;
  name: string;
  clusterId: string;
  compartmentId: string;
  kubernetesVersion: string;
  nodeShape: string;
  nodeSource?: unknown;
  quantityPerSubnet?: number | null;
  lifecycleState: string;
  timeCreated: string;
}

// ─── Functions ─────────────────────────────────────────────────────────

export interface OciFunction {
  id: string;
  displayName: string;
  applicationId: string;
  compartmentId: string;
  image: string;
  memoryInMbs: number;
  timeoutInSeconds: number;
  lifecycleState: string;
  invokeEndpoint?: string | null;
  timeCreated: string;
}

export interface OciFunctionApplication {
  id: string;
  displayName: string;
  compartmentId: string;
  lifecycleState: string;
  subnetIds: string[];
  timeCreated: string;
}

// ─── Monitoring ────────────────────────────────────────────────────────

export interface OciAlarm {
  id: string;
  displayName: string;
  compartmentId: string;
  namespaceName: string;
  query: string;
  severity: string;
  lifecycleState: string;
  isEnabled: boolean;
  destinations: string[];
  timeCreated: string;
}

export interface OciMetricData {
  namespaceName: string;
  name: string;
  compartmentId: string;
  dimensions: unknown;
  aggregatedDatapoints: OciDatapoint[];
}

export interface OciDatapoint {
  timestamp: string;
  value: number;
}

export interface OciAuditEvent {
  eventType: string;
  compartmentId: string;
  eventTime: string;
  source: string;
  eventName: string;
  data?: unknown;
}

// ─── Dashboard ─────────────────────────────────────────────────────────

export interface OciDashboard {
  region: string;
  totalInstances: number;
  runningInstances: number;
  totalVcns: number;
  totalSubnets: number;
  totalVolumes: number;
  totalBuckets: number;
  totalAutonomousDbs: number;
  totalCompartments: number;
  recentAuditEvents: OciAuditEvent[];
}
