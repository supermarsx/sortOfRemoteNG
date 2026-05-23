import { describe, it, expect } from 'vitest';
import {
  defaultCloudSyncConfig,
  migrateCloudSyncConfig,
  type CloudSyncConfig,
} from '../../src/types/settings/cloudSyncSettings';

describe('migrateCloudSyncConfig', () => {
  it('seeds an empty syncTargets list when nothing legacy is configured', () => {
    const migrated = migrateCloudSyncConfig({ ...defaultCloudSyncConfig });
    expect(migrated.syncTargets).toEqual([]);
  });

  it('creates one target per legacy enabled provider with creds lifted onto it', () => {
    const legacy: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      enabledProviders: ['googleDrive', 'nextcloud'],
      googleDrive: {
        folderPath: '/gd-folder',
        accessToken: 'tok',
        accountEmail: 'me@example.com',
      },
      nextcloud: {
        serverUrl: 'https://nc.example',
        username: 'me',
        folderPath: '/nc-folder',
        useAppPassword: true,
      },
    };
    const migrated = migrateCloudSyncConfig(legacy);
    expect(migrated.syncTargets).toHaveLength(2);
    expect(migrated.syncTargets![0]).toMatchObject({
      provider: 'googleDrive',
      enabled: true,
      googleDrive: {
        folderPath: '/gd-folder',
        accessToken: 'tok',
        accountEmail: 'me@example.com',
      },
    });
    expect(migrated.syncTargets![1]).toMatchObject({
      provider: 'nextcloud',
      enabled: true,
      nextcloud: {
        serverUrl: 'https://nc.example',
        username: 'me',
        folderPath: '/nc-folder',
        useAppPassword: true,
      },
    });
  });

  it('uses the bare provider label when only one legacy provider was enabled', () => {
    const legacy: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      enabledProviders: ['oneDrive'],
    };
    const migrated = migrateCloudSyncConfig(legacy);
    expect(migrated.syncTargets).toHaveLength(1);
    expect(migrated.syncTargets![0].label).toBe('OneDrive');
  });

  it('numbers labels when multiple legacy providers were enabled', () => {
    const legacy: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      enabledProviders: ['googleDrive', 'oneDrive'],
    };
    const migrated = migrateCloudSyncConfig(legacy);
    expect(migrated.syncTargets![0].label).toBe('Google Drive 1');
    expect(migrated.syncTargets![1].label).toBe('OneDrive 2');
  });

  it('ignores the legacy "none" provider value if it sneaks into the list', () => {
    const legacy: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      enabledProviders: ['none', 'googleDrive'],
    };
    const migrated = migrateCloudSyncConfig(legacy);
    expect(migrated.syncTargets).toHaveLength(1);
    expect(migrated.syncTargets![0].provider).toBe('googleDrive');
  });

  it('is idempotent for already-migrated configs', () => {
    const cfg: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      syncTargets: [
        {
          id: 'existing',
          label: 'Existing',
          provider: 'sftp',
          enabled: true,
          sftp: {
            host: 'h.example',
            port: 22,
            username: 'u',
            folderPath: '/already-here',
            authMethod: 'password',
          },
        },
      ],
    };
    const migrated = migrateCloudSyncConfig(cfg);
    expect(migrated.syncTargets).toHaveLength(1);
    expect(migrated.syncTargets![0].id).toBe('existing');
  });

  it('mints a stable id per generated target', () => {
    const a = migrateCloudSyncConfig({
      ...defaultCloudSyncConfig,
      enabledProviders: ['googleDrive'],
    });
    const b = migrateCloudSyncConfig({
      ...defaultCloudSyncConfig,
      enabledProviders: ['googleDrive'],
    });
    expect(a.syncTargets![0].id).not.toEqual(b.syncTargets![0].id);
  });
});
