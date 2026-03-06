// App Auto-Updater types

export type UpdateChannel = 'stable' | 'beta' | 'nightly' | 'custom';
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'up_to_date';

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

export interface UpdaterConfig {
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
