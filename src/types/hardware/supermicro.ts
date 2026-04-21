// ── TypeScript types for sorng-supermicro crate ──────────────────────────────
//
// These types mirror the Rust types in src-tauri/crates/sorng-supermicro/src/types.rs
// and sorng-bmc-common/src/types.rs. Used by frontend hooks / components to
// interact with Supermicro BMC management (X9–X13, H12, H13).

// ── Protocol / connection ────────────────────────────────────────────────────

export type SmcProtocol = "redfish" | "legacyWeb" | "ipmi";

export type SmcAuthMethod = "basic" | "session";

export type SmcPlatform =
  | "x13"
  | "h13"
  | "x12"
  | "h12"
  | "x11"
  | "x10"
  | "x9"
  | "unknown";

export interface SmcConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
  verifyCert: boolean;
  platform: SmcPlatform;
  authMethod: SmcAuthMethod;
  timeoutSecs: number;
}

/** Config without secrets, safe to display in UI. */
export interface SmcConfigSafe {
  host: string;
  port: number;
  username: string;
  useSsl: boolean;
  verifyCert: boolean;
  platform: SmcPlatform;
  authMethod: SmcAuthMethod;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface SmcSystemInfo {
  manufacturer: string;
  model: string;
  serialNumber?: string;
  sku?: string;
  biosVersion?: string;
  hostname?: string;
  powerState?: string;
  indicatorLed?: string;
  assetTag?: string;
  uuid?: string;
  servicetag?: string;
  osName?: string;
  osVersion?: string;
  totalMemoryGib?: number;
  processorCount?: number;
  processorModel?: string;
}

export interface SmcBmcInfo {
  platform: SmcPlatform;
  firmwareVersion: string;
  firmwareBuildDate?: string;
  bmcMacAddress?: string;
  ipmiVersion?: string;
  bmcModel?: string;
  uniqueId?: string;
}

// ── Power ────────────────────────────────────────────────────────────────────

export type PowerAction = "on" | "off" | "gracefulShutdown" | "reset" | "cycle" | "nmi";

export interface SmcPsuInfo {
  name: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  status: string;
  capacityWatts?: number;
  outputWatts?: number;
  inputVoltage?: number;
  efficiencyPercent?: number;
  redundancy?: string;
}

export interface SmcPowerMetrics {
  totalConsumedWatts?: number;
  averageConsumedWatts?: number;
  maxConsumedWatts?: number;
  minConsumedWatts?: number;
  powerCapWatts?: number;
  powerCapEnabled: boolean;
  powerSupplies: SmcPsuInfo[];
}

// ── Thermal ──────────────────────────────────────────────────────────────────

export interface SmcTemperature {
  name: string;
  readingCelsius?: number;
  upperWarning?: number;
  upperCritical?: number;
  upperFatal?: number;
  lowerWarning?: number;
  lowerCritical?: number;
  status: string;
  location?: string;
}

export interface SmcFan {
  name: string;
  readingRpm?: number;
  readingPercent?: number;
  status: string;
  location?: string;
  redundancy?: string;
}

export interface SmcThermalData {
  temperatures: SmcTemperature[];
  fans: SmcFan[];
}

export interface SmcThermalSummary {
  ambientTempCelsius?: number;
  cpuMaxTempCelsius?: number;
  dimmMaxTempCelsius?: number;
  fanCount: number;
  fansOk: number;
  fansWarning: number;
  fansCritical: number;
  overallStatus: string;
}

// ── Hardware ─────────────────────────────────────────────────────────────────

export interface SmcProcessor {
  name: string;
  manufacturer?: string;
  model?: string;
  architecture?: string;
  coreCount?: number;
  threadCount?: number;
  maxSpeedMhz?: number;
  currentSpeedMhz?: number;
  status: string;
  socket?: string;
  cacheSizeKb?: number;
}

export interface SmcMemory {
  name: string;
  capacityMib?: number;
  speedMhz?: number;
  manufacturer?: string;
  partNumber?: string;
  serialNumber?: string;
  memoryType?: string;
  status: string;
  slot?: string;
  rank?: number;
  ecc?: boolean;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface SmcStorageController {
  name: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  status: string;
  speedGbps?: number;
  supportedRaid?: string[];
  cacheSizeMb?: number;
}

export interface SmcVirtualDisk {
  name: string;
  raidLevel?: string;
  capacityBytes?: number;
  status: string;
  stripeSizeKb?: number;
  readPolicy?: string;
  writePolicy?: string;
}

export interface SmcPhysicalDisk {
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  capacityBytes?: number;
  mediaType?: string;
  protocol?: string;
  rotationSpeedRpm?: number;
  status: string;
  firmwareVersion?: string;
  slot?: number;
  predictedLifeLeftPercent?: number;
}

// ── Network ──────────────────────────────────────────────────────────────────

export interface SmcNetworkAdapter {
  name: string;
  macAddress?: string;
  linkStatus?: string;
  speedMbps?: number;
  ipv4Addresses?: string[];
  ipv6Addresses?: string[];
  status: string;
  firmwareVersion?: string;
}

// ── Firmware ─────────────────────────────────────────────────────────────────

export interface SmcFirmwareItem {
  name: string;
  version: string;
  updateable: boolean;
  component?: string;
  installDate?: string;
  status?: string;
}

// ── Virtual Media ────────────────────────────────────────────────────────────

export interface SmcVirtualMedia {
  name: string;
  mediaTypes: string[];
  inserted: boolean;
  image?: string;
  writeProtected?: boolean;
  connectedVia?: string;
}

// ── Console / iKVM ───────────────────────────────────────────────────────────

export type SmcConsoleType = "html5Ikvm" | "javaKvm";

export interface SmcConsoleInfo {
  consoleType: SmcConsoleType;
  enabled: boolean;
  maxSessions: number;
  activeSessions: number;
  encryptionEnabled: boolean;
  port?: number;
  sslPort?: number;
  launchUrl?: string;
}

// ── Event Logs ───────────────────────────────────────────────────────────────

export interface SmcEventLogEntry {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  messageId?: string;
  source?: string;
  category?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface SmcUser {
  id: string;
  username: string;
  role: string;
  enabled: boolean;
  locked: boolean;
  description?: string;
}

// ── BIOS ─────────────────────────────────────────────────────────────────────

export interface SmcBiosAttribute {
  name: string;
  currentValue: unknown;
  defaultValue?: unknown;
  attributeType?: string;
  allowedValues?: unknown[];
  readOnly: boolean;
  description?: string;
}

export interface SmcBootSource {
  index: number;
  name: string;
  enabled: boolean;
  deviceType?: string;
}

export interface SmcBootConfig {
  bootMode: string;
  bootOrder: SmcBootSource[];
  currentBootSource?: string;
  uefiSecureBoot?: boolean;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface SmcCertificate {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  thumbprint?: string;
  keySize?: number;
  signatureAlgorithm?: string;
}

export interface SmcCsrParams {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  keySize?: number;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface SmcComponentHealth {
  name: string;
  status: string;
  componentType: string;
  details?: string;
}

export interface SmcHealthRollup {
  overallStatus: string;
  components: SmcComponentHealth[];
}

// ── License ──────────────────────────────────────────────────────────────────

export type SmcLicenseTier =
  | "standard"
  | "outOfBand"
  | "dcms"
  | "spm"
  | { other: string };

export interface SmcLicense {
  tier: SmcLicenseTier;
  productKey?: string;
  activated: boolean;
  expiration?: string;
  description?: string;
}

// ── Security ─────────────────────────────────────────────────────────────────

export interface SmcSecurityRiskItem {
  severity: string;
  category: string;
  message: string;
  remediation?: string;
}

export interface SmcSecurityStatus {
  sslEnabled: boolean;
  sslCertValid: boolean;
  ipmiOverLanEnabled: boolean;
  sshEnabled: boolean;
  webSessionTimeoutMins: number;
  accountLockoutEnabled: boolean;
  maxLoginFailures?: number;
  lockoutDurationSecs?: number;
  defaultPasswordWarning: boolean;
  risks: SmcSecurityRiskItem[];
}

// ── Node Manager (Intel power capping) ───────────────────────────────────────

export type NodeManagerDomain = "platform" | "cpu" | "memory" | "io";

export interface NodeManagerPolicy {
  policyId: number;
  enabled: boolean;
  domain: NodeManagerDomain;
  powerLimitWatts: number;
  correctionTimeMs: number;
  triggerType: string;
  reportingPeriodSecs: number;
}

export interface NodeManagerStats {
  domain: NodeManagerDomain;
  currentWatts: number;
  minWatts: number;
  maxWatts: number;
  avgWatts: number;
  timestamp: string;
  reportingPeriodSecs: number;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface SmcDashboard {
  platform: SmcPlatform;
  systemInfo?: SmcSystemInfo;
  bmcInfo?: SmcBmcInfo;
  powerState?: string;
  healthStatus?: string;
  totalMemoryGb?: number;
  cpuCount?: number;
  storageControllerCount?: number;
  nicCount?: number;
  ambientTempCelsius?: number;
  totalPowerWatts?: number;
  selEntryCount?: number;
  licenseTier?: SmcLicenseTier;
}
