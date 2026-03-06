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
};
