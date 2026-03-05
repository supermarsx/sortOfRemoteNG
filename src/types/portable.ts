// Portable Mode types

export type PortableMode = 'installed' | 'portable' | 'hybrid';

export interface PortableStatus {
  mode: PortableMode;
  markerPresent: boolean;
  dataPath: string;
  configPath: string;
  cachePath: string;
  logsPath: string;
  extensionsPath: string;
  tempPath: string;
  isWritable: boolean;
  driveLabel: string | null;
  driveType: string | null;
  freeSpaceBytes: number;
  totalSpaceBytes: number;
}

export interface PortablePaths {
  data: string;
  config: string;
  cache: string;
  logs: string;
  extensions: string;
  backups: string;
  recordings: string;
  temp: string;
}

export interface PortableConfig {
  autoDetect: boolean;
  preferPortable: boolean;
  syncOnEject: boolean;
  compactOnExit: boolean;
  encryptPortableData: boolean;
  maxCacheSizeMb: number;
  maxLogSizeMb: number;
  cleanTempOnExit: boolean;
}

export interface DriveInfo {
  label: string;
  driveLetter: string;
  driveType: 'removable' | 'fixed' | 'network' | 'unknown';
  fileSystem: string;
  totalBytes: number;
  freeBytes: number;
  isReadOnly: boolean;
}

export interface MigrationResult {
  success: boolean;
  itemsMigrated: number;
  totalSizeBytes: number;
  durationMs: number;
  errors: string[];
  warnings: string[];
}

export interface PortableValidation {
  valid: boolean;
  markerFound: boolean;
  dataIntegrity: boolean;
  writablePermissions: boolean;
  sufficientSpace: boolean;
  issues: string[];
}
