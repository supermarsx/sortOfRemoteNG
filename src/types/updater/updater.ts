export type UpdaterStatusValue =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "restart_required"
  | "error";

export type UpdaterEndpointMode = "public_only" | "private_then_public";
export type UpdaterEndpointSource = "public" | "private";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ResolvedUpdaterEndpoint {
  url: string;
  source: UpdaterEndpointSource;
}

export interface UpdaterSettings {
  autoCheckEnabled: boolean;
  checkIntervalHours: number;
  privateEndpointEnabled: boolean;
  privateEndpointUrl: string | null;
  publicEndpointUrl: string;
  endpointMode: UpdaterEndpointMode;
  resolvedEndpoints: ResolvedUpdaterEndpoint[];
  dynamicPluginEndpointsSupported: boolean;
  dynamicPluginEndpointsMessage: string | null;
  privateEndpointValidationError: string | null;
}

export interface UpdaterSettingsPatch {
  autoCheckEnabled?: boolean;
  checkIntervalHours?: number;
  privateEndpointEnabled?: boolean;
  privateEndpointUrl?: string | null;
}

export interface AvailableUpdate {
  currentVersion: string;
  version: string;
  date: string | null;
  body: string | null;
  target: string;
  downloadUrl: string;
  signaturePresent: boolean;
  rawJson: JsonValue;
}

export interface UpdaterStatusSnapshot {
  status: UpdaterStatusValue;
  currentVersion: string;
  availableUpdate: AvailableUpdate | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  endpointMode: UpdaterEndpointMode;
  endpointSource: string;
  resolvedEndpoints: ResolvedUpdaterEndpoint[];
  dynamicPluginEndpointsSupported: boolean;
  dynamicPluginEndpointsMessage: string | null;
  privateEndpointValidationError: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
}

export interface UpdaterCheckResult {
  updateAvailable: boolean;
  availableUpdate: AvailableUpdate | null;
  status: UpdaterStatusSnapshot;
}

export interface UpdaterProgressView {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface UpdaterDerivedState {
  updateAvailable: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isRestartRequired: boolean;
  isUpToDate: boolean;
  canCheck: boolean;
  canInstall: boolean;
  canRelaunch: boolean;
  progress: UpdaterProgressView;
}

export type UpdateChannel = "stable" | "beta" | "nightly" | "custom";
export type UpdateStatus = UpdaterStatusValue | "ready";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  channel: UpdateChannel;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  checksum: string;
  mandatory: boolean;
  minCurrentVersion: string | null;
}

export interface UpdateProgress {
  status: UpdateStatus;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedBps: number;
  etaSeconds: number;
  errorMessage: string | null;
}

export interface UpdateHistoryEntry {
  version: string;
  channel: UpdateChannel;
  installedAt: string;
  previousVersion: string;
  success: boolean;
  rollbackAvailable: boolean;
}

export interface RollbackInfo {
  version: string;
  backedUpAt: string;
  fileSize: number;
  canRollback: boolean;
}

export interface ReleaseNotes {
  version: string;
  channel: UpdateChannel;
  date: string;
  highlights: string[];
  changes: Array<{ category: string; description: string }>;
  breakingChanges: string[];
  knownIssues: string[];
}

export interface VersionInfo {
  currentVersion: string;
  buildDate: string;
  commitHash: string;
  channel: UpdateChannel;
  rustVersion: string;
  tauriVersion: string;
  osInfo: string;
}

export interface UpdaterConfig extends UpdaterSettings {
  enabled: boolean;
  channel: UpdateChannel;
  autoCheck: boolean;
  autoDownload: boolean;
  autoInstall: boolean;
  checkIntervalMs: number;
  notifyOnUpdate: boolean;
  installOnExit: boolean;
  keepRollbackCount: number;
  customUpdateUrl: string | null;
  preReleaseOptIn: boolean;
}