// Frontend TypeScript types mirroring the public surface of
// `sorng-powershell` (backend crate `src-tauri/crates/sorng-powershell`).
//
// All backend structs use `#[serde(rename_all = "camelCase")]`, so the
// shapes here match the JSON wire format one-for-one. Fields typed as
// `unknown`/`Record<string, unknown>` are opaque JSON values produced by
// the PowerShell runtime (e.g., CIM instances, stream records, progress
// records) — the frontend is expected to render them as generic
// key/value data or pass them through.

// ─── Transport / auth ────────────────────────────────────────────────

export type PsTransportProtocol = 'http' | 'https' | 'ssh';

export type PsAuthMethod =
  | 'basic'
  | 'ntlm'
  | 'negotiate'
  | 'kerberos'
  | 'credSsp'
  | 'certificate'
  | 'default'
  | 'digest';

export interface PsCredential {
  username: string;
  password?: string | null;
  domain?: string | null;
  certificatePath?: string | null;
  certificateThumbprint?: string | null;
  privateKeyPath?: string | null;
  sshKeyPath?: string | null;
}

export interface PsProxyConfig {
  [key: string]: unknown;
}

export type OutputBufferingMode = 'none' | 'drop' | 'block';

export interface PsSessionOption {
  operationTimeoutSec?: number;
  openTimeoutSec?: number;
  cancelTimeoutSec?: number;
  idleTimeoutSec?: number;
  maxRedirections?: number;
  skipMachineProfile?: boolean;
  culture?: string;
  uiCulture?: string;
  maxReceivedDataSizeMb?: number;
  maxReceivedObjectSizeMb?: number;
  outputBufferingMode?: OutputBufferingMode;
  maxCommandsPerShell?: number;
  maxConcurrentUsers?: number;
  noCompression?: boolean;
  keepaliveIntervalSec?: number;
  noUtf8?: boolean;
  maxConnectionRetryCount?: number;
  maxConnectionRetryDelaySec?: number;
}

export interface PsRemotingConfig {
  computerName: string;
  port?: number | null;
  transport?: PsTransportProtocol;
  authMethod?: PsAuthMethod;
  credential: PsCredential;
  skipCaCheck?: boolean;
  skipCnCheck?: boolean;
  skipRevocationCheck?: boolean;
  useSsl?: boolean;
  uriPath?: string;
  connectionUri?: string | null;
  sessionOption?: PsSessionOption;
  configurationName?: string;
  applicationName?: string;
  enableReconnect?: boolean;
  proxy?: PsProxyConfig | null;
  customHeaders?: Record<string, string>;
}

// ─── Session ─────────────────────────────────────────────────────────

export type PsSessionState =
  | 'opening'
  | 'opened'
  | 'disconnected'
  | 'closing'
  | 'closed'
  | 'broken';

export type PsSessionAvailability = 'available' | 'busy' | 'none';

export interface PsSession {
  id: string;
  shellId?: string | null;
  name: string;
  computerName: string;
  state: PsSessionState;
  availability: PsSessionAvailability;
  configurationName: string;
  psVersion?: string | null;
  osVersion?: string | null;
  createdAt: string;
  lastActivity: string;
  idleSeconds: number;
  commandCount: number;
  transport: PsTransportProtocol;
  authMethod: PsAuthMethod;
  supportsDisconnect: boolean;
  reconnectCount: number;
  runspaceId?: string | null;
  port: number;
}

// ─── Command execution ───────────────────────────────────────────────

export type PsInvocationState =
  | 'notStarted'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'disconnected';

export type PsStreamType =
  | 'output'
  | 'error'
  | 'warning'
  | 'verbose'
  | 'debug'
  | 'information'
  | 'progress';

export interface PsErrorRecord {
  exceptionType: string;
  message: string;
  fullyQualifiedErrorId?: string | null;
  category?: string | null;
  targetObject?: string | null;
  scriptStackTrace?: string | null;
  invocationInfo?: string | null;
  pipelineIterationInfo?: string | null;
}

export interface PsProgressRecord {
  activity: string;
  statusDescription: string;
  percentComplete: number;
  secondsRemaining: number;
  currentOperation?: string | null;
  parentActivityId: number;
  activityId: number;
  recordType: string;
}

export interface PsStreamRecord {
  stream: PsStreamType;
  data: unknown;
  timestamp: string;
  exception?: PsErrorRecord | null;
  progress?: PsProgressRecord | null;
}

export interface PsInvokeCommandParams {
  script?: string | null;
  scriptBlock?: string | null;
  scriptPath?: string | null;
  commandName?: string | null;
  arguments?: string[];
  parameters?: Record<string, unknown>;
  asJob?: boolean;
  noNewScope?: boolean;
  useRunspace?: boolean;
  [key: string]: unknown;
}

export interface PsCommandOutput {
  commandId: string;
  state: PsInvocationState;
  exitCode?: number | null;
  streams: PsStreamRecord[];
  startedAt: string;
  finishedAt?: string | null;
  hadErrors: boolean;
  [key: string]: unknown;
}

// ─── File transfer ───────────────────────────────────────────────────

export interface PsFileCopyParams {
  source: string;
  destination: string;
  recurse?: boolean;
  force?: boolean;
  [key: string]: unknown;
}

export interface PsFileTransferProgress {
  transferId: string;
  sessionId: string;
  direction: 'toSession' | 'fromSession' | string;
  source: string;
  destination: string;
  totalBytes: number;
  bytesTransferred: number;
  percentComplete: number;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

// ─── CIM ─────────────────────────────────────────────────────────────

export interface CimSessionConfig {
  computerName: string;
  port?: number | null;
  protocol?: string;
  authentication?: string;
  skipTestConnection?: boolean;
  [key: string]: unknown;
}

export interface CimQueryParams {
  namespace?: string;
  className?: string;
  query?: string;
  filter?: string;
  [key: string]: unknown;
}

export interface CimMethodParams {
  namespace?: string;
  className?: string;
  methodName: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CimInstance {
  namespace?: string;
  className: string;
  keys?: Record<string, unknown>;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── DSC ─────────────────────────────────────────────────────────────

export interface DscResourceState {
  resourceName: string;
  inDesiredState: boolean;
  [key: string]: unknown;
}

export interface DscResult {
  inDesiredState: boolean;
  resources: DscResourceState[];
  [key: string]: unknown;
}

export interface DscConfiguration {
  [key: string]: unknown;
}

// ─── JEA ─────────────────────────────────────────────────────────────

export interface JeaEndpoint {
  name: string;
  [key: string]: unknown;
}

export interface JeaRoleCapability {
  [key: string]: unknown;
}

export interface PsSessionConfiguration {
  name: string;
  [key: string]: unknown;
}

// ─── Direct (Hyper-V VM) ─────────────────────────────────────────────

export interface PsDirectConfig {
  vmName?: string;
  vmId?: string;
  credential?: PsCredential;
  [key: string]: unknown;
}

export interface HyperVVmInfo {
  name: string;
  id: string;
  state: string;
  [key: string]: unknown;
}

// ─── Session configuration params ────────────────────────────────────

export interface NewSessionConfigurationParams {
  name: string;
  [key: string]: unknown;
}

export interface SetSessionConfigurationParams {
  [key: string]: unknown;
}

// ─── Diagnostics ─────────────────────────────────────────────────────

export interface PsDiagnosticResult {
  ok: boolean;
  diagnostics: Array<{ name: string; passed: boolean; details?: string | null }>;
  [key: string]: unknown;
}

export interface WinRmServiceStatus {
  running: boolean;
  [key: string]: unknown;
}

export interface FirewallRuleInfo {
  name: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface LatencyResult {
  meanMs: number;
  minMs: number;
  maxMs: number;
  samples: number;
  [key: string]: unknown;
}

export interface PsCertificateInfo {
  subject: string;
  thumbprint: string;
  [key: string]: unknown;
}

// ─── Service stats / events ──────────────────────────────────────────

export interface PsRemotingStats {
  activeSessions: number;
  totalCommandsExecuted: number;
  [key: string]: unknown;
}

export interface PsRemotingEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}
