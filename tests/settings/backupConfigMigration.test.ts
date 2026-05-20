import { describe, it, expect } from 'vitest';
import {
  defaultBackupConfig,
  migrateBackupConfig,
  type BackupConfig,
} from '../../src/types/settings/backupSettings';

describe('migrateBackupConfig', () => {
  it('wraps a legacy destinationPath into a single-target list', () => {
    const legacy: BackupConfig = {
      ...defaultBackupConfig,
      destinationPath: 'C:\\backups',
      locationPreset: 'custom',
    };
    const migrated = migrateBackupConfig(legacy);
    expect(migrated.destinations).toHaveLength(1);
    expect(migrated.destinations![0].customPath).toBe('C:\\backups');
    expect(migrated.destinations![0].preset).toBe('custom');
    expect(migrated.destinations![0].enabled).toBe(true);
    expect(migrated.destinations![0].label).toBe('Default');
  });

  it('preserves a non-default location preset on migration', () => {
    const legacy: BackupConfig = {
      ...defaultBackupConfig,
      destinationPath: '',
      locationPreset: 'googleDrive',
      cloudCustomPath: 'sortOfRemoteNG/backups',
    };
    const migrated = migrateBackupConfig(legacy);
    expect(migrated.destinations).toHaveLength(1);
    expect(migrated.destinations![0].preset).toBe('googleDrive');
    expect(migrated.destinations![0].customPath).toBe(
      'sortOfRemoteNG/backups',
    );
  });

  it('returns an empty destinations list when nothing legacy is configured', () => {
    const cfg: BackupConfig = {
      ...defaultBackupConfig,
      destinationPath: '',
    };
    delete (cfg as Partial<BackupConfig>).cloudCustomPath;
    const migrated = migrateBackupConfig(cfg);
    expect(migrated.destinations).toEqual([]);
  });

  it('is idempotent for already-migrated configs', () => {
    const cfg: BackupConfig = {
      ...defaultBackupConfig,
      destinations: [
        {
          id: 'existing',
          label: 'Existing',
          preset: 'custom',
          customPath: '/already-here',
          enabled: true,
        },
      ],
    };
    const migrated = migrateBackupConfig(cfg);
    expect(migrated.destinations).toHaveLength(1);
    expect(migrated.destinations![0].id).toBe('existing');
  });

  it('defaults force-N to 7 when the field is missing from stored config', () => {
    // Simulates an upgrade from pre-multi-target storage.
    const stored = { ...defaultBackupConfig };
    delete (stored as Partial<BackupConfig>).forceEmitEveryNSkippedTicks;
    const merged = { ...defaultBackupConfig, ...stored };
    expect(merged.forceEmitEveryNSkippedTicks).toBe(7);
  });

  it('defaults deltaSkipEnabled to false so existing setups are unaffected', () => {
    expect(defaultBackupConfig.deltaSkipEnabled).toBe(false);
  });

  it('mints a stable id per generated target', () => {
    const a = migrateBackupConfig({
      ...defaultBackupConfig,
      destinationPath: '/a',
    });
    const b = migrateBackupConfig({
      ...defaultBackupConfig,
      destinationPath: '/b',
    });
    expect(a.destinations![0].id).not.toEqual(b.destinations![0].id);
  });
});
