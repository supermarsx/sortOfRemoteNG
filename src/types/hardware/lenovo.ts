// ── TypeScript types for sorng-lenovo crate ──────────────────────────────────
//
// These types mirror the Rust types in src-tauri/crates/sorng-lenovo/src/types.rs
// and sorng-bmc-common/src/types.rs. Used by frontend hooks / components to
// interact with Lenovo XCC/XCC2/IMM2/IMM BMC management.

// ── Protocol / connection ────────────────────────────────────────────────────

export type LenovoProtocol = "redfish" | "legacyRest" | "ipmi";

export type LenovoAuthMethod = "basic" | "session";

export type XccGeneration = "xcc2" | "xcc" | "imm2" | "imm" | "unknown";

export interface LenovoConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
  verifyCert: boolean;
  generation: XccGeneration;
  authMethod: LenovoAuthMethod;
  timeoutSecs: number;
}

/** Config without secrets, safe to display in UI. */
export interface LenovoConfigSafe {
  host: string;
  port: number;
  username: string;
  useSsl: boolean;
  verifyCert: boolean;
  generation: XccGeneration;
  authMethod: LenovoAuthMethod;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface LenovoSystemInfo {
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

export interface XccInfo {
  generation: XccGeneration;
  firmwareVersion: string;
  firmwareBuildDate?: string;
  xccMacAddress?: string;
  ipmiVersion?: string;
  xccModel?: string;
  uniqueId?: string;
}

// ── Power ────────────────────────────────────────────────────────────────────

export type PowerAction = "on" | "off" | "gracefulShutdown" | "reset" | "cycle" | "nmi";

export interface LenovoPsuInfo {
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

export interface LenovoPowerMetrics {
  totalConsumedWatts?: number;
  averageConsumedWatts?: number;
  maxConsumedWatts?: number;
  minConsumedWatts?: number;
  powerCapWatts?: number;
  powerCapEnabled: boolean;
  powerSupplies: LenovoPsuInfo[];
}

// ── Thermal ──────────────────────────────────────────────────────────────────

export interface LenovoTemperature {
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

export interface LenovoFan {
  name: string;
  readingRpm?: number;
  readingPercent?: number;
  status: string;
  location?: string;
  redundancy?: string;
}

export interface LenovoThermalData {
  temperatures: LenovoTemperature[];
  fans: LenovoFan[];
}

export interface LenovoThermalSummary {
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

export interface LenovoProcessor {
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

export interface LenovoMemory {
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

export interface LenovoStorageController {
  name: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  status: string;
  speedGbps?: number;
  supportedRaid?: string[];
  cacheSizeMb?: number;
}

export interface LenovoVirtualDisk {
  name: string;
  raidLevel?: string;
  capacityBytes?: number;
  status: string;
  stripeSizeKb?: number;
  readPolicy?: string;
  writePolicy?: string;
}

export interface LenovoPhysicalDisk {
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

export interface LenovoNetworkAdapter {
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

export interface LenovoFirmwareItem {
  name: string;
  version: string;
  updateable: boolean;
  component?: string;
  installDate?: string;
  status?: string;
}

// ── Virtual Media ────────────────────────────────────────────────────────────

export interface LenovoVirtualMedia {
  name: string;
  mediaTypes: string[];
  inserted: boolean;
  image?: string;
  writeProtected?: boolean;
  connectedVia?: string;
}

// ── Console ──────────────────────────────────────────────────────────────────

export type LenovoConsoleType = "html5" | "javaApplet";

export interface XccConsoleInfo {
  consoleType: LenovoConsoleType;
  enabled: boolean;
  maxSessions: number;
  activeSessions: number;
  encryptionEnabled: boolean;
  port?: number;
  sslPort?: number;
  launchUrl?: string;
}

// ── Event Logs ───────────────────────────────────────────────────────────────

export interface LenovoEventLogEntry {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  messageId?: string;
  source?: string;
  category?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface LenovoUser {
  id: string;
  username: string;
  role: string;
  enabled: boolean;
  locked: boolean;
  description?: string;
}

// ── BIOS ─────────────────────────────────────────────────────────────────────

export interface LenovoBiosAttribute {
  name: string;
  currentValue: unknown;
  defaultValue?: unknown;
  attributeType?: string;
  allowedValues?: unknown[];
  readOnly: boolean;
  description?: string;
}

export interface LenovoBootSource {
  index: number;
  name: string;
  enabled: boolean;
  deviceType?: string;
}

export interface LenovoBootConfig {
  bootMode: string;
  bootOrder: LenovoBootSource[];
  currentBootSource?: string;
  uefiSecureBoot?: boolean;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface XccCertificate {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  thumbprint?: string;
  keySize?: number;
  signatureAlgorithm?: string;
}

export interface LenovoCsrParams {
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

export interface LenovoComponentHealth {
  name: string;
  status: string;
  componentType: string;
  details?: string;
}

export interface LenovoHealthRollup {
  overallStatus: string;
  components: LenovoComponentHealth[];
}

// ── License ──────────────────────────────────────────────────────────────────

export type XccLicenseTier =
  | "standard"
  | "advanced"
  | "enterprise"
  | "fod"
  | { other: string };

export interface XccLicense {
  tier: XccLicenseTier;
  productKey?: string;
  activated: boolean;
  expiration?: string;
  description?: string;
}

// ── Security ─────────────────────────────────────────────────────────────────

export interface LenovoSecurityRiskItem {
  severity: string;
  category: string;
  message: string;
  remediation?: string;
}

export interface XccSecurityStatus {
  sslEnabled: boolean;
  sslCertValid: boolean;
  ipmiOverLanEnabled: boolean;
  sshEnabled: boolean;
  webSessionTimeoutMins: number;
  accountLockoutEnabled: boolean;
  maxLoginFailures?: number;
  lockoutDurationSecs?: number;
  defaultPasswordWarning: boolean;
  risks: LenovoSecurityRiskItem[];
}

// ── OneCLI ───────────────────────────────────────────────────────────────────

export interface OnecliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface XccDashboard {
  generation: XccGeneration;
  systemInfo?: LenovoSystemInfo;
  xccInfo?: XccInfo;
  powerState?: string;
  healthStatus?: string;
  totalMemoryGb?: number;
  cpuCount?: number;
  storageControllerCount?: number;
  nicCount?: number;
  ambientTempCelsius?: number;
  totalPowerWatts?: number;
  selEntryCount?: number;
  licenseTier?: XccLicenseTier;
}
