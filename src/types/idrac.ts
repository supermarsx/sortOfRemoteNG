// ── TypeScript types for sorng-idrac crate ───────────────────────────────────
//
// These types mirror the Rust types in src-tauri/crates/sorng-idrac/src/types.rs
// and are used by the frontend hooks / components to interact with Dell iDRAC.

// ── Protocol / connection ────────────────────────────────────────────────────

export type IdracProtocol = "redfish" | "wsman" | "ipmi";

export type IdracAuthMethod =
  | { type: "Basic"; username: string; password: string }
  | { type: "Session"; username: string; password: string };

export interface IdracConfig {
  host: string;
  port: number;
  auth: IdracAuthMethod;
  insecure: boolean;
  forceProtocol?: IdracProtocol;
  timeoutSecs: number;
}

/** Config without secrets, safe to display in UI. */
export interface IdracConfigSafe {
  host: string;
  port: number;
  username: string;
  insecure: boolean;
  protocol: IdracProtocol;
  idracVersion?: string;
}

export interface IdracSession {
  token: string;
  sessionUri: string;
  username: string;
  connectedAt: string;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface SystemInfo {
  id: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  serviceTag: string;
  sku?: string;
  biosVersion: string;
  hostname?: string;
  powerState: string;
  indicatorLed?: string;
  assetTag?: string;
  memoryGib: number;
  processorCount: number;
  processorModel: string;
}

export interface IdracInfo {
  firmwareVersion: string;
  idracType: string;
  ipAddress: string;
  macAddress?: string;
  model?: string;
  generation?: string;
  licenseType?: string;
}

// ── Power ────────────────────────────────────────────────────────────────────

export type PowerAction =
  | "on"
  | "forceOff"
  | "gracefulShutdown"
  | "gracefulRestart"
  | "forceRestart"
  | "nmi"
  | "pushPowerButton"
  | "powerCycle";

export interface PowerSupply {
  id: string;
  name: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  status: ComponentHealth;
  capacityWatts?: number;
  inputVoltage?: number;
  outputWatts?: number;
  lineInputVoltageType?: string;
  powerSupplyType?: string;
  manufacturer?: string;
  partNumber?: string;
  sparePartNumber?: string;
  efficiencyRating?: number;
}

export interface PowerMetrics {
  currentWatts?: number;
  minWatts?: number;
  maxWatts?: number;
  averageWatts?: number;
  powerCapWatts?: number;
  powerCapEnabled: boolean;
}

// ── Thermal ──────────────────────────────────────────────────────────────────

export interface TemperatureSensor {
  id: string;
  name: string;
  readingCelsius?: number;
  upperThresholdCritical?: number;
  upperThresholdFatal?: number;
  lowerThresholdCritical?: number;
  status: ComponentHealth;
  physicalContext?: string;
}

export interface Fan {
  id: string;
  name: string;
  readingRpm?: number;
  readingPercent?: number;
  lowerThresholdCritical?: number;
  lowerThresholdFatal?: number;
  status: ComponentHealth;
  physicalContext?: string;
  fanName?: string;
}

export interface ThermalData {
  temperatures: TemperatureSensor[];
  fans: Fan[];
}

export interface ThermalSummary {
  inletTempCelsius?: number;
  exhaustTempCelsius?: number;
  fanCount: number;
  fansOk: number;
  sensorCount: number;
  sensorsOk: number;
}

// ── Hardware ─────────────────────────────────────────────────────────────────

export interface Processor {
  id: string;
  socket: string;
  manufacturer: string;
  model: string;
  totalCores: number;
  totalThreads: number;
  maxSpeedMhz?: number;
  currentSpeedMhz?: number;
  status: ComponentHealth;
  instructionSet?: string;
  microcode?: string;
  cacheMib?: number;
}

export interface MemoryDimm {
  id: string;
  name: string;
  manufacturer: string;
  serialNumber?: string;
  partNumber?: string;
  capacityMib: number;
  speedMhz?: number;
  memoryType: string;
  rankCount?: number;
  deviceLocator: string;
  bankLocator?: string;
  status: ComponentHealth;
  errorCorrection?: string;
  dataWidthBits?: number;
  busWidthBits?: number;
}

export interface PcieDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  deviceClass?: string;
  slotType?: string;
  busNumber?: number;
  functionNumber?: number;
  status: ComponentHealth;
  firmwareVersion?: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface StorageController {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  status: ComponentHealth;
  speedGbps?: number;
  supportedRaidLevels: string[];
  cacheSizeMib?: number;
  supportedDeviceProtocols: string[];
}

export interface VirtualDisk {
  id: string;
  name: string;
  raidLevel: string;
  capacityBytes: number;
  status: ComponentHealth;
  mediaType?: string;
  optimumIoSizeBytes?: number;
  stripeSizeBytes?: number;
  readCachePolicy?: string;
  writeCachePolicy?: string;
  diskCachePolicy?: string;
  encrypted?: boolean;
  physicalDiskIds: string[];
}

export interface PhysicalDisk {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  capacityBytes: number;
  mediaType: string;
  protocol?: string;
  rotationSpeedRpm?: number;
  status: ComponentHealth;
  capableSpeedGbps?: number;
  negotiatedSpeedGbps?: number;
  failurePredicted?: boolean;
  predictedMediaLifeLeftPercent?: number;
  slot?: string;
  enclosureId?: string;
  hotspareType?: string;
}

export interface StorageEnclosure {
  id: string;
  name: string;
  connector?: string;
  slotCount?: number;
  wiredOrder?: string;
  status: ComponentHealth;
}

export interface CreateVirtualDiskParams {
  controllerId: string;
  name?: string;
  raidLevel: string;
  physicalDiskIds: string[];
  sizeBytes?: number;
  stripeSizeBytes?: number;
  readCachePolicy?: string;
  writeCachePolicy?: string;
}

// ── Network ──────────────────────────────────────────────────────────────────

export interface NetworkAdapter {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  serialNumber?: string;
  status: ComponentHealth;
  portCount: number;
  ports: NetworkPort[];
}

export interface NetworkPort {
  id: string;
  name: string;
  linkStatus?: string;
  currentSpeedGbps?: number;
  macAddress?: string;
  activeLinkTechnology?: string;
  autoNegotiate?: boolean;
  flowControl?: string;
  mtuSize?: number;
}

export interface IdracNetworkConfig {
  ipv4Address?: string;
  ipv4Subnet?: string;
  ipv4Gateway?: string;
  ipv4Source?: string;
  ipv6Address?: string;
  ipv6PrefixLength?: number;
  ipv6Gateway?: string;
  ipv6Source?: string;
  macAddress?: string;
  dnsServers: string[];
  hostname?: string;
  domainName?: string;
  vlanEnable?: boolean;
  vlanId?: number;
  nicSelection?: string;
  speedDuplex?: string;
  autoNegotiation?: boolean;
}

// ── Firmware ─────────────────────────────────────────────────────────────────

export interface FirmwareInventory {
  id: string;
  name: string;
  version: string;
  updateable: boolean;
  status: ComponentHealth;
  componentId?: string;
  installDate?: string;
  releaseDate?: string;
  sizeBytes?: number;
}

export interface FirmwareUpdateParams {
  imageUri: string;
  applyTime?: string;
  force: boolean;
}

// ── Lifecycle Controller ─────────────────────────────────────────────────────

export interface LifecycleJob {
  id: string;
  name?: string;
  message?: string;
  jobType?: string;
  jobState: string;
  percentComplete?: number;
  startTime?: string;
  endTime?: string;
  targetSettingsUri?: string;
}

export interface ScpExportParams {
  exportFormat?: string;
  exportUse?: string;
  includeInExport?: string;
  shareType?: string;
  ipAddress?: string;
  shareName?: string;
  fileName?: string;
  username?: string;
  password?: string;
}

export interface ScpImportParams {
  importBuffer?: string;
  shareType?: string;
  ipAddress?: string;
  shareName?: string;
  fileName?: string;
  username?: string;
  password?: string;
  shutdownType?: string;
  hostPoweroff?: boolean;
}

// ── Virtual Media ────────────────────────────────────────────────────────────

export interface VirtualMediaStatus {
  id: string;
  name: string;
  mediaTypes: string[];
  inserted: boolean;
  image?: string;
  writeProtected: boolean;
  connectedVia?: string;
}

export interface VirtualMediaMountParams {
  imageUri: string;
  mediaType?: string;
  inserted?: boolean;
  writeProtected?: boolean;
  username?: string;
  password?: string;
}

// ── Virtual Console / KVM ────────────────────────────────────────────────────

export interface ConsoleInfo {
  consoleType: string;
  url: string;
  enabled: boolean;
  maxSessions?: number;
  sslEncryptionBits?: number;
}

// ── Event Log ────────────────────────────────────────────────────────────────

export interface SelEntry {
  id: string;
  created?: string;
  message: string;
  severity: string;
  entryType?: string;
  messageId?: string;
  sensorType?: string;
  component?: string;
}

export interface LcLogEntry {
  id: string;
  created?: string;
  message: string;
  severity: string;
  messageId?: string;
  category?: string;
  comment?: string;
  sequence?: number;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface IdracUser {
  id: string;
  name: string;
  roleId: string;
  enabled: boolean;
  locked: boolean;
  description?: string;
  ipmiPrivilege?: string;
  snmpV3Auth?: string;
  snmpV3Privacy?: string;
}

export interface IdracUserParams {
  username: string;
  password?: string;
  roleId?: string;
  enabled?: boolean;
  description?: string;
}

export interface LdapConfig {
  enabled: boolean;
  serverAddress?: string;
  port?: number;
  baseDn?: string;
  bindDn?: string;
  searchFilter?: string;
  useSsl?: boolean;
  certificateValidation?: boolean;
  groupAttribute?: string;
}

export interface ActiveDirectoryConfig {
  enabled: boolean;
  domainName?: string;
  domainControllerAddresses: string[];
  globalCatalogAddresses: string[];
  schemaType?: string;
  certificateValidation?: boolean;
}

// ── BIOS ─────────────────────────────────────────────────────────────────────

export interface BiosAttribute {
  name: string;
  value: unknown;
  attributeType?: string;
  displayName?: string;
  readOnly: boolean;
  allowedValues?: unknown[];
  lowerBound?: number;
  upperBound?: number;
}

export interface BootSource {
  id: string;
  name: string;
  enabled: boolean;
  index: number;
  bootOptionReference?: string;
  uefiDevicePath?: string;
  displayName?: string;
}

export interface BootConfig {
  bootMode: string;
  bootOrder: string[];
  bootSourceOverrideTarget?: string;
  bootSourceOverrideEnabled?: string;
  bootSourceOverrideMode?: string;
  uefiTargetBootSourceOverride?: string;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface IdracCertificate {
  id: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  thumbprint?: string;
  keyUsage?: string[];
  signatureAlgorithm?: string;
}

export interface CsrParams {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  locality?: string;
  state?: string;
  country?: string;
  email?: string;
  subjectAlternativeNames?: string[];
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface ComponentHealth {
  health?: string;
  healthRollup?: string;
  state?: string;
}

export interface ServerHealthRollup {
  overallHealth: string;
  system: ComponentHealth;
  processors: ComponentHealth;
  memory: ComponentHealth;
  storage: ComponentHealth;
  fans: ComponentHealth;
  temperatures: ComponentHealth;
  powerSupplies: ComponentHealth;
  network: ComponentHealth;
  idrac: ComponentHealth;
  voltage: ComponentHealth;
  intrusion: ComponentHealth;
  batteries: ComponentHealth;
}

// ── Telemetry / Metrics ──────────────────────────────────────────────────────

export interface TelemetryDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface TelemetryReport {
  metricId: string;
  name: string;
  metricType: string;
  dataPoints: TelemetryDataPoint[];
}

export interface PowerTelemetry {
  currentWatts: number;
  peakWatts: number;
  minWatts: number;
  averageWatts: number;
  timeWindowMinutes: number;
  history: TelemetryDataPoint[];
}

export interface ThermalTelemetry {
  inletTempCelsius?: number;
  exhaustTempCelsius?: number;
  peakInletCelsius?: number;
  averageInletCelsius?: number;
  history: TelemetryDataPoint[];
}

// ── RACADM ───────────────────────────────────────────────────────────────────

export interface RacadmResult {
  command: string;
  output: string;
  returnCode: number;
  success: boolean;
}

// ── IPMI types ───────────────────────────────────────────────────────────────

export interface IpmiSensor {
  name: string;
  value?: number;
  unit?: string;
  status: string;
  sensorType: string;
  lowerCritical?: number;
  upperCritical?: number;
}

export interface IpmiFru {
  deviceId: number;
  productManufacturer?: string;
  productName?: string;
  productSerial?: string;
  productPartNumber?: string;
  boardManufacturer?: string;
  boardProductName?: string;
  boardSerial?: string;
  chassisType?: string;
  chassisSerial?: string;
}

export interface IpmiChassisStatus {
  powerOn: boolean;
  powerOverload: boolean;
  powerInterlock: boolean;
  powerFault: boolean;
  powerControlFault: boolean;
  powerRestorePolicy: string;
  lastPowerEvent: string;
  chassisIntrusion: boolean;
  frontPanelLockout: boolean;
  driveFault: boolean;
  coolingFault: boolean;
}

// ── WS-Management types ──────────────────────────────────────────────────────

export interface WsmanInstance {
  className: string;
  properties: Record<string, unknown>;
}

export interface WsmanSystemView {
  fqdd: string;
  model: string;
  serviceTag: string;
  biosVersion: string;
  systemGeneration: string;
  hostname?: string;
  osName?: string;
  idracFirmwareVersion: string;
  lifecycleControllerVersion: string;
  powerState: string;
  cpldVersion?: string;
}

// ── Dashboard / summary ──────────────────────────────────────────────────────

export interface IdracDashboard {
  system: SystemInfo;
  idrac: IdracInfo;
  health: ServerHealthRollup;
  power: PowerMetrics;
  thermalSummary?: ThermalSummary;
  firmwareCount: number;
  virtualDiskCount: number;
  physicalDiskCount: number;
  memoryDimmCount: number;
  nicCount: number;
  recentEvents: SelEntry[];
}
