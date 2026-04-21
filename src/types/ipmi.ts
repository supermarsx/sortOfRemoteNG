// ═══════════════════════════════════════════════════════════════════════
// IPMI types — mirror Rust-side `sorng_ipmi::types` (serde camelCase)
// ═══════════════════════════════════════════════════════════════════════

export type IpmiVersion = 'V15' | 'V20';

export type AuthType = 'None' | 'MD2' | 'MD5' | 'Password' | 'OEM';

export type PrivilegeLevel =
  | 'Callback'
  | 'User'
  | 'Operator'
  | 'Administrator'
  | 'Oem';

export type SessionState =
  | 'Disconnected'
  | 'Authenticating'
  | 'Active'
  | 'Error';

export interface IpmiSessionConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  version?: IpmiVersion;
  authType?: AuthType;
  privilege?: PrivilegeLevel;
  cipherSuite?: number;
  timeoutSecs?: number;
  retries?: number;
}

export interface IpmiSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  state: SessionState;
  version: IpmiVersion;
  privilege: PrivilegeLevel;
  connectedAt?: string | null;
}

// ── Chassis ─────────────────────────────────────────────────────────────

export type ChassisControl =
  | 'PowerDown'
  | 'PowerUp'
  | 'PowerCycle'
  | 'HardReset'
  | 'PulseDiag'
  | 'SoftShutdown';

export type BootDevice =
  | 'NoOverride'
  | 'Pxe'
  | 'HardDisk'
  | 'HardDiskSafe'
  | 'DiagPartition'
  | 'Cdrom'
  | 'Bios'
  | 'FloppyRemovable';

export interface ChassisStatus {
  powerOn: boolean;
  powerOverload: boolean;
  powerFault: boolean;
  powerRestorePolicy: string;
  lastPowerEvent: string;
  chassisIntrusion: boolean;
  frontPanelLockout: boolean;
  driveFault: boolean;
  coolingFault: boolean;
}

export interface IpmiDeviceId {
  deviceId: number;
  deviceRevision: number;
  firmwareRevision: string;
  ipmiVersion: string;
  manufacturerId: number;
  productId: number;
}

// ── SDR / Sensors ───────────────────────────────────────────────────────

export interface SdrRecord {
  recordId: number;
  recordType: number;
  sensorNumber?: number;
  sensorName?: string;
  raw: number[];
}

// Opaque — frontend passes back whatever backend returned from
// `ipmi_get_all_sdr_records`.
export type SdrFullSensor = unknown;

export interface SensorReading {
  sensorNumber: number;
  name: string;
  value?: number | null;
  units?: string | null;
  raw: number;
  eventState: number;
}

export interface SensorThresholds {
  lowerNonRecoverable?: number | null;
  lowerCritical?: number | null;
  lowerNonCritical?: number | null;
  upperNonCritical?: number | null;
  upperCritical?: number | null;
  upperNonRecoverable?: number | null;
}

// ── SEL ─────────────────────────────────────────────────────────────────

export interface SelInfo {
  version: string;
  entries: number;
  freeSpace: number;
  lastAddTimestamp?: string | null;
  lastEraseTimestamp?: string | null;
  overflow: boolean;
  supportsDelete: boolean;
  supportsPartialAdd: boolean;
  supportsReserve: boolean;
  supportsGetAllocInfo: boolean;
}

export interface SelEntry {
  recordId: number;
  recordType: number;
  timestamp?: string | null;
  generatorId: number;
  evmRev: number;
  sensorType: number;
  sensorNumber: number;
  eventType: number;
  eventData: number[];
}

// ── FRU / SOL / Watchdog / LAN / Users / PEF / Channels ────────────────

export interface FruDeviceInfo {
  deviceId: number;
  deviceName?: string | null;
  chassis?: Record<string, string> | null;
  board?: Record<string, string> | null;
  product?: Record<string, string> | null;
}

export interface SolConfig {
  enabled: boolean;
  authEnabled: boolean;
  encryptionEnabled: boolean;
  baudRate: number;
  channel: number;
}

export interface SolSession {
  sessionId: string;
  instance: number;
  encrypt: boolean;
  auth: boolean;
}

export interface WatchdogTimer {
  useField: number;
  timerActions: number;
  preTimeoutInterval: number;
  timerUseExp: number;
  initialCountdown: number;
  presentCountdown: number;
}

export interface LanConfig {
  channel: number;
  ipAddress?: string | null;
  subnetMask?: string | null;
  gateway?: string | null;
  macAddress?: string | null;
  vlanId?: number | null;
  ipSource?: string | null;
}

export interface IpmiUser {
  userId: number;
  name?: string | null;
  enabled: boolean;
  privilege: PrivilegeLevel;
  callbackOnly: boolean;
  linkAuth: boolean;
  ipmiMessaging: boolean;
}

export interface PefCapabilities {
  alertSupport: boolean;
  powerDownSupport: boolean;
  resetSupport: boolean;
  powerCycleSupport: boolean;
  oemActionSupport: boolean;
  diagnosticInterruptSupport: boolean;
  numEventFilters: number;
}

export interface ChannelInfo {
  channel: number;
  mediumType: number;
  protocolType: number;
  sessionSupport: number;
}

export interface CipherSuite {
  id: number;
  authAlg: number;
  integrityAlg: number;
  confidentialityAlg: number;
}

export interface RawIpmiResponse {
  completionCode: number;
  data: number[];
}
