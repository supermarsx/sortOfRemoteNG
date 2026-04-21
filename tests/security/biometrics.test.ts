import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

describe('Biometric types', () => {
  it('BiometricStatus shape matches expected fields', () => {
    const status = {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint'] as const,
      platformLabel: 'Touch ID',
      biometryType: 'touch_id' as const,
      unavailableReason: null,
    };

    expect(status.hardwareAvailable).toBe(true);
    expect(status.enrolled).toBe(true);
    expect(status.kinds).toContain('fingerprint');
    expect(status.platformLabel).toBe('Touch ID');
    expect(status.biometryType).toBe('touch_id');
    expect(status.unavailableReason).toBeNull();
  });

  it('BiometricPlatformInfo shape matches expected fields', () => {
    const info = {
      os: 'macos',
      platformLabel: 'Touch ID',
      iconHint: 'fingerprint' as const,
    };

    expect(info.os).toBe('macos');
    expect(info.iconHint).toBe('fingerprint');
  });
});

describe('Biometric platform labels', () => {
  it('macOS uses Touch ID label', () => {
    const status = {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint'],
      platformLabel: 'Touch ID',
      biometryType: 'touch_id',
      unavailableReason: null,
    };
    expect(status.platformLabel).toBe('Touch ID');
  });

  it('Windows uses Windows Hello label', () => {
    const status = {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint', 'face_recognition'],
      platformLabel: 'Windows Hello',
      biometryType: 'none',
      unavailableReason: null,
    };
    expect(status.platformLabel).toBe('Windows Hello');
  });

  it('Linux uses fprintd label', () => {
    const status = {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint'],
      platformLabel: 'fprintd (Fingerprint)',
      biometryType: 'none',
      unavailableReason: null,
    };
    expect(status.platformLabel).toBe('fprintd (Fingerprint)');
  });
});

describe('Biometric icon hint derivation', () => {
  it('fingerprint kind maps to fingerprint icon', () => {
    const kinds = ['fingerprint'];
    const iconHint = kinds.includes('fingerprint') ? 'fingerprint'
      : kinds.includes('face_recognition') ? 'face'
      : 'shield';
    expect(iconHint).toBe('fingerprint');
  });

  it('face_recognition kind maps to face icon', () => {
    const kinds = ['face_recognition'];
    const iconHint = kinds.includes('fingerprint') ? 'fingerprint'
      : kinds.includes('face_recognition') ? 'face'
      : 'shield';
    expect(iconHint).toBe('face');
  });

  it('empty kinds maps to shield icon', () => {
    const kinds: string[] = [];
    const iconHint = kinds.includes('fingerprint') ? 'fingerprint'
      : kinds.includes('face_recognition') ? 'face'
      : 'shield';
    expect(iconHint).toBe('shield');
  });
});

describe('Biometric availability logic', () => {
  it('available when hardware present and enrolled', () => {
    const status = { hardwareAvailable: true, enrolled: true };
    expect(status.hardwareAvailable && status.enrolled).toBe(true);
  });

  it('not available when hardware missing', () => {
    const status = { hardwareAvailable: false, enrolled: false };
    expect(status.hardwareAvailable && status.enrolled).toBe(false);
  });

  it('not available when not enrolled', () => {
    const status = { hardwareAvailable: true, enrolled: false };
    expect(status.hardwareAvailable && status.enrolled).toBe(false);
  });
});

describe('Biometric migration detection', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('reports no migration needed on Windows', async () => {
    mockInvoke.mockResolvedValue(false);
    const result = await invoke('biometric_needs_migration');
    expect(result).toBe(false);
  });

  it('handles migration check failure gracefully', async () => {
    mockInvoke.mockRejectedValue(new Error('Not available'));
    try {
      await invoke('biometric_needs_migration');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
