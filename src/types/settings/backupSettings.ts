// Backup scheduling frequency
export const BackupFrequencies = [
  'manual',
  'hourly',
  'daily',
  'weekly',
  'monthly',
] as const;
export type BackupFrequency = (typeof BackupFrequencies)[number];

// Day of week for weekly backups
export const DaysOfWeek = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type DayOfWeek = (typeof DaysOfWeek)[number];

// Backup format options
export const BackupFormats = ['json', 'xml', 'encrypted-json'] as const;
export type BackupFormat = (typeof BackupFormats)[number];

// Backup encryption algorithms
export const BackupEncryptionAlgorithms = [
  'AES-256-GCM',
  'AES-256-CBC',
  'AES-128-GCM',
  'ChaCha20-Poly1305',
  'Serpent-256-GCM',
  'Serpent-256-CBC',
  'Twofish-256-GCM',
  'Twofish-256-CBC',
] as const;
export type BackupEncryptionAlgorithm = (typeof BackupEncryptionAlgorithms)[number];

// Backup location presets
export const BackupLocationPresets = [
  'custom',
  'appData',
  'documents',
  'googleDrive',
  'oneDrive',
  'nextcloud',
  'dropbox',
] as const;
export type BackupLocationPreset = (typeof BackupLocationPresets)[number];

// ── Multi-target destinations ─────────────────────────────────────────

/**
 * Retention policy carried on an individual destination. Overrides
 * the global `maxBackupsToKeep` for that destination only — useful
 * when the user wants more copies on a roomy local drive than on a
 * tight cloud quota.
 */
export interface DestinationRetentionPolicy {
  /** Override the global `maxBackupsToKeep` for this destination. */
  maxBackupsToKeep?: number;
}

/**
 * One destination the scheduled backup writes to. Replaces the old
 * single `destinationPath` field so one tick can fan out to several
 * user-defined locations (multiple folders, multiple clouds).
 */
export interface BackupTarget {
  /** Stable identifier referenced by per-tick results. */
  id: string;
  /** Human label shown in the settings list and the restore picker. */
  label: string;
  /** Storage class — see `BackupLocationPresets`. */
  preset: BackupLocationPreset;
  /**
   * Local filesystem path for `custom` / `appData` / `documents`,
   * or cloud-side subfolder for cloud presets. Optional because
   * `appData` / `documents` presets resolve to platform defaults
   * when empty.
   */
  customPath?: string;
  /** Soft-disable a destination without removing it from the list. */
  enabled: boolean;
  /** Override the global retention for this destination only. */
  retentionOverride?: DestinationRetentionPolicy;
}

/**
 * Status emitted by the Rust pipeline for each destination on each
 * scheduled tick. Mirrors the Rust enum at
 * `sorng-storage::backup::TargetStatus`.
 */
export type TargetStatus =
  | 'success'
  | 'skipped_unchanged'
  | 'disabled'
  | 'failed';

/**
 * Per-destination outcome of a single tick. Stored on
 * `BackupStatus.lastTargetResults` for the "last run" panel.
 */
export interface TargetResult {
  targetId: string;
  status: TargetStatus;
  /** Canonical payload hash that landed at this destination, if any. */
  payloadHashWritten?: string;
  bytesWritten?: number;
  filePath?: string;
  errorMessage?: string;
}

export interface BackupConfig {
  // Enable automatic backups
  enabled: boolean;

  // Backup frequency
  frequency: BackupFrequency;

  // Time of day for daily/weekly/monthly backups (HH:MM format)
  scheduledTime: string;

  // Day of week for weekly backups
  weeklyDay: DayOfWeek;

  // Day of month for monthly backups (1-28)
  monthlyDay: number;

  // Backup destination folder path
  destinationPath: string;

  // Use differential backups (only backup changes)
  differentialEnabled: boolean;

  // Keep full backup every N differential backups
  fullBackupInterval: number;

  // Maximum number of backups to keep (0 = unlimited)
  maxBackupsToKeep: number;

  // Backup format
  format: BackupFormat;

  // Include passwords in backup
  includePasswords: boolean;

  // Encrypt backups
  encryptBackups: boolean;

  // Backup encryption algorithm
  encryptionAlgorithm: BackupEncryptionAlgorithm;

  // Backup encryption password (stored securely)
  encryptionPassword?: string;

  // Backup location preset
  locationPreset: BackupLocationPreset;

  // Custom path for cloud services (e.g., Nextcloud folder path)
  cloudCustomPath?: string;

  // Include settings in backup
  includeSettings: boolean;

  // Include SSH keys in backup
  includeSSHKeys: boolean;

  // Last backup timestamp
  lastBackupTime?: number;

  // Last full backup timestamp (for differential)
  lastFullBackupTime?: number;

  // Backup on app close
  backupOnClose: boolean;

  // Show notification after backup
  notifyOnBackup: boolean;

  // Compress backups
  compressBackups: boolean;

  /**
   * Destinations the scheduled backup fans out to on each tick.
   * Empty when the user hasn't migrated from the legacy single
   * `destinationPath` model yet — the Rust side wraps the legacy
   * field into a synthetic single-element list so the runtime
   * always has at least one target to iterate over.
   */
  destinations?: BackupTarget[];

  /**
   * When `true`, ticks whose canonical payload hash matches the
   * previous successful run's hash are skipped at every destination
   * that's already up to date. The `forceEmitEveryNSkippedTicks`
   * safety valve still applies.
   */
  deltaSkipEnabled?: boolean;

  /**
   * After this many consecutive skipped ticks, the next tick emits
   * regardless so retention rotation stays healthy. `0` disables
   * the safety valve (skip indefinitely when payload is unchanged).
   * Default `7` — one guaranteed backup per week on a daily
   * schedule.
   */
  forceEmitEveryNSkippedTicks?: number;
}

export const defaultBackupConfig: BackupConfig = {
  enabled: false,
  frequency: 'daily',
  scheduledTime: '03:00',
  weeklyDay: 'sunday',
  monthlyDay: 1,
  destinationPath: '',
  differentialEnabled: true,
  fullBackupInterval: 7,
  maxBackupsToKeep: 30,
  format: 'json',
  includePasswords: false,
  encryptBackups: true,
  encryptionAlgorithm: 'AES-256-GCM',
  locationPreset: 'custom',
  includeSettings: true,
  includeSSHKeys: false,
  backupOnClose: false,
  notifyOnBackup: true,
  compressBackups: true,
  destinations: [],
  deltaSkipEnabled: false,
  // Match the Rust workspace default at
  // sorng-storage::backup::default_force_emit_every: one guaranteed
  // backup per week on a daily schedule.
  forceEmitEveryNSkippedTicks: 7,
};

/**
 * Generate a stable identifier for a `BackupTarget`. Used both by
 * the migration helper below and by the settings UI when the user
 * adds a new destination row.
 */
export function generateBackupTargetId(): string {
  // Prefer crypto.randomUUID when available; fall back to a short
  // random string for older runtimes (e.g. early Jest environments).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `target-${crypto.randomUUID()}`;
  }
  return `target-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

/**
 * Migrate a `BackupConfig` from the legacy single-destination shape
 * (`destinationPath` + `locationPreset` + `cloudCustomPath`) to the
 * new multi-target shape (`destinations[]`). Idempotent — calling
 * with an already-migrated config returns it unchanged.
 *
 * Runs during `SettingsManager.loadSettings` so users upgrading from
 * pre-multi-target builds see their existing destination preserved
 * as the first row of the new list editor.
 */
export function migrateBackupConfig(config: BackupConfig): BackupConfig {
  if (config.destinations && config.destinations.length > 0) {
    return config;
  }
  // Nothing to migrate when no legacy destination is configured —
  // the user starts with an empty destinations list and adds rows
  // through the UI.
  if (!config.destinationPath && !config.cloudCustomPath) {
    return { ...config, destinations: [] };
  }
  const legacyTarget: BackupTarget = {
    id: generateBackupTargetId(),
    label: 'Default',
    preset: config.locationPreset ?? 'custom',
    customPath: config.destinationPath || config.cloudCustomPath || undefined,
    enabled: true,
  };
  return {
    ...config,
    destinations: [legacyTarget],
  };
}
