// ── TypeScript types for sorng-ilo crate ─────────────────────────────────────
//
// These types mirror the Rust types in src-tauri/crates/sorng-ilo/src/types.rs
// and sorng-bmc-common/src/types.rs. Used by frontend hooks / components to
// interact with HP iLO 1-7 BMC management.

// ── Protocol / connection ────────────────────────────────────────────────────

export type IloProtocol = "redfish" | "ribcl" | "ipmi";

export type IloAuthMethod = "basic" | "session";

export type IloGeneration =
  | "Ilo1"
  | "Ilo2"
  | "Ilo3"
  | "Ilo4"
  | "Ilo5"
  | "Ilo6"
  | "Ilo7";

export interface IloConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  authMethod: IloAuthMethod;
  protocol?: IloProtocol;
  insecure: boolean;
  timeoutSecs: number;
  ipmiPort: number;
  generation?: IloGeneration;
}

/** Config without secrets, safe to display in UI. */
export interface IloConfigSafe {
  host: string;
  port: number;
  username: string;
  insecure: boolean;
  generation: IloGeneration;
  protocol: IloProtocol;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface BmcSystemInfo {
  id: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
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

export interface IloInfo {
  generation: IloGeneration;
  firmwareVersion: string;
  firmwareDate?: string;
  ipAddress: string;
  macAddress?: string;
  hostname?: string;
  serialNumber?: string;
  licenseType: string;
  fqdn?: string;
  uuid?: string;
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

export interface BmcPowerSupply {
  name: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  status: string;
  capacityWatts?: number;
  inputVoltage?: number;
  outputWatts?: number;
}

export interface BmcPowerMetrics {
  currentWatts?: number;
  minWatts?: number;
  maxWatts?: number;
  avgWatts?: number;
  powerSupplies: BmcPowerSupply[];
}

// ── Thermal ──────────────────────────────────────────────────────────────────

export interface BmcTemperatureSensor {
  name: string;
  readingCelsius?: number;
  upperThresholdCritical?: number;
  upperThresholdFatal?: number;
  status: string;
  location?: string;
}

export interface BmcFan {
  name: string;
  reading?: number;
  readingUnits: string;
  status: string;
}

export interface BmcThermalData {
  temperatures: BmcTemperatureSensor[];
  fans: BmcFan[];
}

export interface ThermalSummary {
  ambientTempCelsius?: number;
  cpuTempMaxCelsius?: number;
  fanSpeedMinPercent?: number;
  fanSpeedMaxPercent?: number;
  thermalAlerts: number;
}

// ── Hardware ─────────────────────────────────────────────────────────────────

export interface BmcProcessor {
  id: string;
  manufacturer: string;
  model: string;
  maxSpeedMhz?: number;
  totalCores?: number;
  totalThreads?: number;
  status: string;
}

export interface BmcMemoryDimm {
  id: string;
  name: string;
  manufacturer?: string;
  capacityMib?: number;
  speedMhz?: number;
  memoryType?: string;
  status: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface BmcStorageController {
  id: string;
  name: string;
  model?: string;
  firmwareVersion?: string;
  status: string;
}

export interface BmcVirtualDisk {
  id: string;
  name: string;
  raidLevel?: string;
  sizeBytes?: number;
  status: string;
}

export interface BmcPhysicalDisk {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  capacityBytes?: number;
  mediaType?: string;
  protocol?: string;
  status: string;
}

// ── Network ──────────────────────────────────────────────────────────────────

export interface BmcNetworkAdapter {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  macAddress?: string;
  status: string;
}

// ── Firmware ─────────────────────────────────────────────────────────────────

export interface BmcFirmwareItem {
  id: string;
  name: string;
  version: string;
  updateable?: boolean;
  status?: string;
}

// ── Virtual Media ────────────────────────────────────────────────────────────

export interface BmcVirtualMedia {
  id: string;
  mediaTypes: string[];
  image?: string;
  inserted: boolean;
  writeProtected: boolean;
  connectedVia?: string;
}

// ── Virtual Console ──────────────────────────────────────────────────────────

export type ConsoleType = "Html5" | "JavaIrc" | "DotNetIrc" | "JavaApplet";

export interface HotkeyConfig {
  name: string;
  keySequence: string;
}

export interface IloConsoleInfo {
  availableTypes: ConsoleType[];
  html5Url?: string;
  javaUrl?: string;
  hotkeys: HotkeyConfig[];
}

// ── Event Logs ───────────────────────────────────────────────────────────────

export interface BmcEventLogEntry {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  messageId?: string;
  category?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface BmcUser {
  id: string;
  username: string;
  role: string;
  enabled: boolean;
  locked: boolean;
  privilegeMap?: Record<string, unknown>;
}

// ── BIOS ─────────────────────────────────────────────────────────────────────

export interface BiosAttribute {
  name: string;
  value: unknown;
  readOnly: boolean;
}

export interface BootSource {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
}

export interface BootConfig {
  bootOrder: BootSource[];
  bootOverrideTarget?: string;
  bootOverrideEnabled?: string;
  uefiBootMode?: string;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface IloCertificate {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  serialNumber?: string;
  fingerprint?: string;
}

export interface CsrParams {
  commonName: string;
  country: string;
  state: string;
  city: string;
  organization: string;
  organizationalUnit?: string;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface ComponentHealth {
  name: string;
  status: string;
}

export interface BmcHealthRollup {
  overallHealth: string;
  isHealthy: boolean;
  components: ComponentHealth[];
}

// ── License ──────────────────────────────────────────────────────────────────

export type IloLicenseTier =
  | "Standard"
  | "Essentials"
  | "Advanced"
  | "AdvancedPremium"
  | "ScaleOut";

export interface IloLicense {
  tier: IloLicenseTier;
  key?: string;
  licenseString?: string;
  expiration?: string;
  installDate?: string;
}

// ── Security ─────────────────────────────────────────────────────────────────

export interface SecurityRiskItem {
  name: string;
  severity: string;
  description?: string;
  recommendedAction?: string;
}

export interface IloSecurityStatus {
  overallStatus: string;
  riskCount: number;
  risks: SecurityRiskItem[];
  tlsVersion?: string;
  ipmiOverLanEnabled?: boolean;
  sshEnabled?: boolean;
  defaultPassword?: boolean;
}

// ── Federation ───────────────────────────────────────────────────────────────

export interface IloFederationGroup {
  name: string;
  key?: string;
  privileges: string[];
}

export interface IloFederationPeer {
  name: string;
  ipAddress: string;
  group: string;
  iloGeneration?: string;
  firmwareVersion?: string;
  serverName?: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface IloDashboard {
  systemInfo?: BmcSystemInfo;
  iloInfo?: IloInfo;
  health?: BmcHealthRollup;
  powerState?: string;
  powerConsumptionWatts?: number;
  thermalSummary?: ThermalSummary;
}
