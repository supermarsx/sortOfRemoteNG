// Cloud Sync Provider Types
export const CloudSyncProviders = [
  "none",
  "googleDrive",
  "oneDrive",
  "nextcloud",
  "webdav",
  "sftp",
] as const;
export type CloudSyncProvider = (typeof CloudSyncProviders)[number];

// Cloud Sync Frequency
export const CloudSyncFrequencies = [
  "manual",
  "realtime",
  "onSave",
  "every5Minutes",
  "every15Minutes",
  "every30Minutes",
  "hourly",
  "daily",
  "custom",
] as const;
export type CloudSyncFrequency = (typeof CloudSyncFrequencies)[number];

export const cloudSyncFrequencyLabels: Record<CloudSyncFrequency, string> = {
  manual: "Manual Only",
  realtime: "Real-time (Instant)",
  onSave: "On Save",
  every5Minutes: "Every 5 Minutes",
  every15Minutes: "Every 15 Minutes",
  every30Minutes: "Every 30 Minutes",
  hourly: "Every Hour",
  daily: "Once Daily",
  custom: "Custom Interval",
};

export const MIN_CLOUD_SYNC_INTERVAL_MINUTES = 1;
export const MAX_CLOUD_SYNC_INTERVAL_MINUTES = 7 * 24 * 60;
export const DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES = 15;
export const DEFAULT_CLOUD_SYNC_FAILURE_NOTIFICATION_MINUTES = 30;
export const MAX_CLOUD_SYNC_FILE_SIZE_MIB = 100;
export const DEFAULT_CLOUD_SYNC_FILE_SIZE_MIB = 50;

/** Repair legacy limits on load without changing valid, smaller byte budgets. */
export function normalizeCloudSyncFileSizeMiB(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.floor(value * 1024 * 1024) < 1
  ) {
    return DEFAULT_CLOUD_SYNC_FILE_SIZE_MIB;
  }
  return Math.min(MAX_CLOUD_SYNC_FILE_SIZE_MIB, value);
}

/** Zero explicitly permits every failure; missing legacy values default to 30. */
export function normalizeCloudSyncFailureNotificationMinutes(
  value: unknown,
): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_CLOUD_SYNC_FAILURE_NOTIFICATION_MINUTES;
  return Math.min(
    MAX_CLOUD_SYNC_INTERVAL_MINUTES,
    Math.max(0, Math.round(value)),
  );
}

/** Bound persisted/custom input and keep browser timers below their 32-bit limit. */
export function normalizeCloudSyncIntervalMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES;
  }
  return Math.min(
    MAX_CLOUD_SYNC_INTERVAL_MINUTES,
    Math.max(MIN_CLOUD_SYNC_INTERVAL_MINUTES, Math.round(value)),
  );
}

// Conflict Resolution Strategy
export const ConflictResolutionStrategies = [
  "askEveryTime",
  "keepLocal",
  "keepRemote",
  "keepNewer",
  "merge",
  "smartMerge",
] as const;
export type ConflictResolutionStrategy =
  (typeof ConflictResolutionStrategies)[number];

// Per-provider sync status
export interface ProviderSyncStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: "success" | "failed" | "partial" | "conflict";
  lastSyncError?: string;
}

/** Results belong to a destination, not every account using its provider. */
export interface TargetSyncStatus {
  provider: CloudSyncProvider;
  lastSyncTime: number;
  lastSyncStatus: "success" | "failed" | "partial" | "conflict";
  lastSyncError?: string;
  lastSuccessTime?: number;
}

// ── Per-provider configuration shapes (now stored per-target) ──────────

export interface GoogleDriveProviderConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  folderId?: string;
  folderPath: string;
  accountEmail?: string;
}

export interface OneDriveProviderConfig {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  driveId?: string;
  folderPath: string;
  accountEmail?: string;
}

export interface NextcloudProviderConfig {
  serverUrl: string;
  username: string;
  password?: string;
  appPassword?: string;
  folderPath: string;
  useAppPassword: boolean;
}

export interface WebDavProviderConfig {
  serverUrl: string;
  username: string;
  password?: string;
  folderPath: string;
  authMethod: "basic" | "digest" | "bearer";
  bearerToken?: string;
}

export interface SftpProviderConfig {
  host: string;
  /** Required at runtime; optional only so existing saved targets can be edited. */
  hostKeyFingerprint?: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  folderPath: string;
  authMethod: "password" | "key";
}

// ── Multi-target sync destinations ────────────────────────────────────

/**
 * One sync target the cloud-sync engine pushes to on each scheduled
 * tick. Mirrors the multi-destination model used by Backup
 * (`BackupTarget`).
 *
 * Each target owns its own provider credentials so the user can run
 * e.g. a personal Google Drive and a work Google Drive side-by-side
 * with separate OAuth tokens, or two SFTP targets pointing at
 * different servers. Only the sub-object matching `provider` is
 * read at sync time; others are ignored.
 */
export interface CloudSyncTarget {
  /** Stable identifier referenced by per-tick results. */
  id: string;
  /** Human label shown in the settings list. */
  label: string;
  /** Which provider this target rides on top of. */
  provider: CloudSyncProvider;
  /** Soft-disable a target without removing it from the list. */
  enabled: boolean;
  // Per-target provider credentials. Only the field matching
  // `provider` is read; the rest may be present from a prior
  // provider choice but are inert.
  googleDrive?: GoogleDriveProviderConfig;
  oneDrive?: OneDriveProviderConfig;
  nextcloud?: NextcloudProviderConfig;
  webdav?: WebDavProviderConfig;
  sftp?: SftpProviderConfig;
}

/** Default config seeded when a fresh target of this provider is added. */
export function defaultProviderConfigFor(
  provider: CloudSyncProvider,
): Partial<CloudSyncTarget> {
  switch (provider) {
    case "googleDrive":
      return { googleDrive: { folderPath: "/sortOfRemoteNG" } };
    case "oneDrive":
      return { oneDrive: { folderPath: "/sortOfRemoteNG" } };
    case "nextcloud":
      return {
        nextcloud: {
          serverUrl: "",
          username: "",
          folderPath: "/sortOfRemoteNG",
          useAppPassword: true,
        },
      };
    case "webdav":
      return {
        webdav: {
          serverUrl: "",
          username: "",
          folderPath: "/sortOfRemoteNG",
          authMethod: "basic",
        },
      };
    case "sftp":
      return {
        sftp: {
          host: "",
          port: 22,
          username: "",
          folderPath: "sortOfRemoteNG",
          authMethod: "password",
        },
      };
    default:
      return {};
  }
}

// Cloud Sync Configuration
export interface CloudSyncConfig {
  // Enable cloud sync (master switch)
  enabled: boolean;

  // Legacy: Selected cloud provider (for backward compatibility)
  provider: CloudSyncProvider;

  // Legacy multi-target flag list (kept for back-compat with the
  // old "toggle a provider on/off" UI). New code should iterate
  // `syncTargets` instead — it carries label / folder overrides too.
  enabledProviders: CloudSyncProvider[];

  /**
   * Named sync targets the engine fans out to on each tick. Replaces
   * the legacy `enabledProviders` flat list. Optional because
   * pre-migration configs won't have it set — the migration helper
   * backfills an empty list (or one row per legacy enabled provider)
   * on first load.
   */
  syncTargets?: CloudSyncTarget[];

  // Per-provider sync status
  providerStatus: Partial<Record<CloudSyncProvider, ProviderSyncStatus>>;

  /** Keyed by stable target id; absent for legacy provider-only results. */
  targetStatus?: Record<string, TargetSyncStatus>;

  // Sync frequency
  frequency: CloudSyncFrequency;
  /** Whole minutes, used only for custom frequency; older configs may omit it. */
  customIntervalMinutes?: number;

  // @deprecated — top-level provider blocks live here only so the
  // migration helper can lift them onto the first matching target on
  // first load after the per-target-credentials change landed. New
  // code should read `syncTargets[i].googleDrive` etc. instead.
  googleDrive: GoogleDriveProviderConfig;
  oneDrive: OneDriveProviderConfig;
  nextcloud: NextcloudProviderConfig;
  webdav: WebDavProviderConfig;
  sftp: SftpProviderConfig;

  /** Explicit inventory ids; empty/absent selects nothing. New items are never auto-selected. */
  selectedItems?: string[];

  /** Explicit consent to unlock selected native databases with one OS-vault slot. */
  autoUnlockOsVaultDatabases?: boolean;

  // Deprecated category options retained for saved-config compatibility only.
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
  lastSyncStatus?: "success" | "failed" | "partial" | "conflict";
  lastSyncError?: string;

  // Sync on startup/shutdown
  syncOnStartup: boolean;
  syncOnShutdown: boolean;

  // Notifications
  notifyOnSync: boolean;
  notifyOnConflict: boolean;
  /** Minimum minutes between failure toasts, across targets; 0 means every failure. */
  failureNotificationIntervalMinutes?: number;

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
  provider: "none",
  enabledProviders: [],
  syncTargets: [],
  providerStatus: {},
  frequency: "manual",
  customIntervalMinutes: DEFAULT_CLOUD_SYNC_INTERVAL_MINUTES,
  googleDrive: {
    folderPath: "/sortOfRemoteNG",
  },
  oneDrive: {
    folderPath: "/sortOfRemoteNG",
  },
  nextcloud: {
    serverUrl: "",
    username: "",
    folderPath: "/sortOfRemoteNG",
    useAppPassword: true,
  },
  webdav: {
    serverUrl: "",
    username: "",
    folderPath: "/sortOfRemoteNG",
    authMethod: "basic",
  },
  sftp: {
    host: "",
    port: 22,
    username: "",
    folderPath: "sortOfRemoteNG",
    authMethod: "password",
  },
  syncConnections: true,
  selectedItems: [],
  autoUnlockOsVaultDatabases: false,
  syncSettings: true,
  syncSSHKeys: false,
  syncScripts: true,
  syncColorTags: true,
  syncShortcuts: true,
  encryptBeforeSync: true,
  conflictResolution: "askEveryTime",
  syncOnStartup: false,
  syncOnShutdown: false,
  notifyOnSync: true,
  notifyOnConflict: true,
  failureNotificationIntervalMinutes:
    DEFAULT_CLOUD_SYNC_FAILURE_NOTIFICATION_MINUTES,
  maxFileSizeMB: DEFAULT_CLOUD_SYNC_FILE_SIZE_MIB,
  excludePatterns: [],
  compressionEnabled: true,
  uploadLimitKBs: 0,
  downloadLimitKBs: 0,
};

/**
 * Generate a stable identifier for a `CloudSyncTarget`. Used by the
 * migration helper below and by the settings UI when the user adds a
 * new target row.
 */
export function generateCloudSyncTargetId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `sync-target-${crypto.randomUUID()}`;
  }
  return `sync-target-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

const providerDefaultLabels: Record<CloudSyncProvider, string> = {
  none: "Sync Target",
  googleDrive: "Google Drive",
  oneDrive: "OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV",
  sftp: "SFTP",
};

/**
 * Lift the matching top-level provider block off `CloudSyncConfig`
 * onto a freshly-seeded target. Migration only — new credentials
 * are written directly into the target.
 */
function liftLegacyProviderConfig(
  provider: CloudSyncProvider,
  config: CloudSyncConfig,
): Partial<CloudSyncTarget> {
  switch (provider) {
    case "googleDrive":
      return config.googleDrive
        ? { googleDrive: { ...config.googleDrive } }
        : {};
    case "oneDrive":
      return config.oneDrive ? { oneDrive: { ...config.oneDrive } } : {};
    case "nextcloud":
      return config.nextcloud ? { nextcloud: { ...config.nextcloud } } : {};
    case "webdav":
      return config.webdav ? { webdav: { ...config.webdav } } : {};
    case "sftp":
      return config.sftp ? { sftp: { ...config.sftp } } : {};
    default:
      return {};
  }
}

/**
 * Migrate a `CloudSyncConfig` from the legacy shape (top-level
 * provider blocks + `enabledProviders: CloudSyncProvider[]`) to the
 * new `syncTargets: CloudSyncTarget[]` shape where each target owns
 * its own provider credentials. Idempotent — calling with an
 * already-migrated config returns it unchanged.
 *
 * Runs during `SettingsManager.loadSettings` so users upgrading
 * from pre-per-target-creds builds see one fully-configured target
 * per provider they had previously enabled, ready to edit / clone
 * in the new list UI.
 */
export function migrateCloudSyncConfig(
  config: CloudSyncConfig,
): CloudSyncConfig {
  const autoUnlockOsVaultDatabases = config.autoUnlockOsVaultDatabases === true;
  if (config.autoUnlockOsVaultDatabases !== autoUnlockOsVaultDatabases)
    config = { ...config, autoUnlockOsVaultDatabases };
  const maxFileSizeMB = normalizeCloudSyncFileSizeMiB(config.maxFileSizeMB);
  if (config.maxFileSizeMB !== maxFileSizeMB) {
    config = { ...config, maxFileSizeMB };
  }
  const failureNotificationIntervalMinutes =
    normalizeCloudSyncFailureNotificationMinutes(
      config.failureNotificationIntervalMinutes,
    );
  if (
    config.failureNotificationIntervalMinutes !==
    failureNotificationIntervalMinutes
  )
    config = { ...config, failureNotificationIntervalMinutes };
  const customIntervalMinutes = normalizeCloudSyncIntervalMinutes(
    config.customIntervalMinutes,
  );
  if (config.customIntervalMinutes !== customIntervalMinutes) {
    config = { ...config, customIntervalMinutes };
  }
  if (config.syncTargets && config.syncTargets.length > 0) {
    return config;
  }
  const legacyProviders = (config.enabledProviders ?? []).filter(
    (p) => p !== "none",
  );
  if (legacyProviders.length === 0) {
    return { ...config, syncTargets: [] };
  }
  const targets: CloudSyncTarget[] = legacyProviders.map((provider, idx) => ({
    id: generateCloudSyncTargetId(),
    label:
      legacyProviders.length === 1
        ? providerDefaultLabels[provider]
        : `${providerDefaultLabels[provider]} ${idx + 1}`,
    provider,
    enabled: true,
    ...liftLegacyProviderConfig(provider, config),
  }));
  return { ...config, syncTargets: targets };
}
