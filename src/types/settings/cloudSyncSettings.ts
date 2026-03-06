// Cloud Sync Provider Types
export const CloudSyncProviders = [
  'none',
  'googleDrive',
  'oneDrive',
  'nextcloud',
  'webdav',
  'sftp',
] as const;
export type CloudSyncProvider = (typeof CloudSyncProviders)[number];

// Cloud Sync Frequency
export const CloudSyncFrequencies = [
  'manual',
  'realtime',
  'onSave',
  'every5Minutes',
  'every15Minutes',
  'every30Minutes',
  'hourly',
  'daily',
] as const;
export type CloudSyncFrequency = (typeof CloudSyncFrequencies)[number];

// Conflict Resolution Strategy
export const ConflictResolutionStrategies = [
  'askEveryTime',
  'keepLocal',
  'keepRemote',
  'keepNewer',
  'merge',
] as const;
export type ConflictResolutionStrategy = (typeof ConflictResolutionStrategies)[number];

// Per-provider sync status
export interface ProviderSyncStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
}

// Cloud Sync Configuration
export interface CloudSyncConfig {
  // Enable cloud sync (master switch)
  enabled: boolean;

  // Legacy: Selected cloud provider (for backward compatibility)
  provider: CloudSyncProvider;

  // Multi-target: Enabled providers list
  enabledProviders: CloudSyncProvider[];

  // Per-provider sync status
  providerStatus: Partial<Record<CloudSyncProvider, ProviderSyncStatus>>;

  // Sync frequency
  frequency: CloudSyncFrequency;

  // Google Drive specific
  googleDrive: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    folderId?: string;
    folderPath: string;
    accountEmail?: string;
  };

  // OneDrive specific
  oneDrive: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    driveId?: string;
    folderPath: string;
    accountEmail?: string;
  };

  // Nextcloud specific
  nextcloud: {
    serverUrl: string;
    username: string;
    password?: string;
    appPassword?: string;
    folderPath: string;
    useAppPassword: boolean;
  };

  // WebDAV specific
  webdav: {
    serverUrl: string;
    username: string;
    password?: string;
    folderPath: string;
    authMethod: 'basic' | 'digest' | 'bearer';
    bearerToken?: string;
  };

  // SFTP specific
  sftp: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    folderPath: string;
    authMethod: 'password' | 'key';
  };

  // Sync options
  syncConnections: boolean;
  syncSettings: boolean;
  syncSSHKeys: boolean;
  syncScripts: boolean;
  syncColorTags: boolean;
  syncShortcuts: boolean;

  // Encryption options
  encryptBeforeSync: boolean;
  syncEncryptionPassword?: string;

  // Conflict resolution
  conflictResolution: ConflictResolutionStrategy;

  // Last sync timestamps
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;

  // Sync on startup/shutdown
  syncOnStartup: boolean;
  syncOnShutdown: boolean;

  // Notifications
  notifyOnSync: boolean;
  notifyOnConflict: boolean;

  // Advanced options
  maxFileSizeMB: number;
  excludePatterns: string[];
  compressionEnabled: boolean;

  // Bandwidth limiting (KB/s, 0 = unlimited)
  uploadLimitKBs: number;
  downloadLimitKBs: number;
}

export const defaultCloudSyncConfig: CloudSyncConfig = {
  enabled: false,
  provider: 'none',
  enabledProviders: [],
  providerStatus: {},
  frequency: 'manual',
  googleDrive: {
    folderPath: '/sortOfRemoteNG',
  },
  oneDrive: {
    folderPath: '/sortOfRemoteNG',
  },
  nextcloud: {
    serverUrl: '',
    username: '',
    folderPath: '/sortOfRemoteNG',
    useAppPassword: true,
  },
  webdav: {
    serverUrl: '',
    username: '',
    folderPath: '/sortOfRemoteNG',
    authMethod: 'basic',
  },
  sftp: {
    host: '',
    port: 22,
    username: '',
    folderPath: '/sortOfRemoteNG',
    authMethod: 'password',
  },
  syncConnections: true,
  syncSettings: true,
  syncSSHKeys: false,
  syncScripts: true,
  syncColorTags: true,
  syncShortcuts: true,
  encryptBeforeSync: true,
  conflictResolution: 'askEveryTime',
  syncOnStartup: false,
  syncOnShutdown: false,
  notifyOnSync: true,
  notifyOnConflict: true,
  maxFileSizeMB: 50,
  excludePatterns: [],
  compressionEnabled: true,
  uploadLimitKBs: 0,
  downloadLimitKBs: 0,
};
