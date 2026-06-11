import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-expect-error - no type declarations for jsdom
import { JSDOM } from 'jsdom';
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from '../../src/utils/settings/settingsManager';
import { _resetInvokeCache } from '../../src/utils/tauri/invoke';
import type { GlobalSettings } from '../../src/types/settings/settings';

let dom: JSDOM;

/**
 * The disk-backed `settings.json` blob that the fake Tauri backend serves.
 * `read_app_settings` returns it; `write_app_settings` shallow-merges its
 * `patch` into it — mirroring the real backend's partial-merge semantics.
 * Reset to `null` between cases (cold start = no stored settings).
 */
let fakeStoredSettings: Record<string, unknown> | null = null;

/**
 * Install a fake `window.__TAURI__.core.invoke` so `getInvoke()` resolves
 * the legacy global path (cheap, never cached). This replaces the removed
 * IndexedDB seeding: the desktop settings store is now `settings.json` via
 * the backend, and these tests exercise that authoritative path with an
 * in-memory stand-in for the disk file. `read_app_settings` returns only
 * the keys actually stored (preserving "absent key" semantics that the old
 * partial `IndexedDbService.setItem('mremote-settings', …)` seeds relied
 * on); `write_app_settings` shallow-merges the patch like the real backend.
 */
function installFakeTauri(): void {
  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'read_app_settings') {
      return fakeStoredSettings;
    }
    if (cmd === 'write_app_settings') {
      const patch = (args?.patch ?? {}) as Record<string, unknown>;
      fakeStoredSettings = { ...(fakeStoredSettings ?? {}), ...patch };
      return null;
    }
    return null;
  };
  (globalThis as any).__TAURI__ = { core: { invoke } };
}

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  SettingsManager.resetInstance();
  // Settings no longer persist via IndexedDB. Reset every per-suite settings
  // surface so a value stored in one test can't leak into the next, and make
  // sure no stale Tauri invoke is memoised from another suite.
  fakeStoredSettings = null;
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  installFakeTauri();
});

/**
 * Seed persistence "as if from a prior run" by writing exactly the given
 * keys into the fake `settings.json` store — the modern replacement for the
 * removed `IndexedDbService.setItem('mremote-settings', seed)` calls. Only
 * the supplied keys are present (not a full default blob), preserving the
 * "this key was never stored" semantics the load/migration logic depends on.
 */
function seedStoredSettings(seed: Partial<GlobalSettings>): void {
  fakeStoredSettings = { ...(fakeStoredSettings ?? {}), ...seed };
}

describe('SettingsManager colorScheme', () => {
  it('defaults to blue', async () => {
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();
    expect(settings.colorScheme).toBe('blue');
  });

  it('persists colorScheme changes', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await manager.saveSettings({ colorScheme: 'green' });

    SettingsManager.resetInstance();
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe('green');
  });

  it('accepts grey colorScheme', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await manager.saveSettings({ colorScheme: 'grey' });

    SettingsManager.resetInstance();
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe('grey');
  });
});

describe('SettingsManager save-before-load race', () => {
  it('does not clobber stored settings when a partial save races the initial load', async () => {
    // Seed storage with a non-default user config, as if from a prior run.
    seedStoredSettings({
      colorScheme: 'green',
      theme: 'light',
      autoSaveEnabled: true,
    });

    const manager = SettingsManager.getInstance();

    // Simulate a startup saver (e.g. window-geometry persistence) firing a
    // partial save WITHOUT first awaiting loadSettings(). The save must wait
    // for the load internally so it merges onto the stored config, not the
    // in-memory defaults.
    await manager.saveSettings({ windowSize: { width: 800, height: 600 } } as any);

    SettingsManager.resetInstance();
    const reloaded = await SettingsManager.getInstance().loadSettings();

    // The pre-existing custom values must survive.
    expect(reloaded.colorScheme).toBe('green');
    expect(reloaded.theme).toBe('light');
    expect(reloaded.autoSaveEnabled).toBe(true);
    // And the new partial value must be persisted too.
    expect(reloaded.windowSize).toEqual({ width: 800, height: 600 });
  });
});

describe('SettingsManager loadSettings', () => {
  it('applies default network discovery TTLs when missing', async () => {
    seedStoredSettings({
      networkDiscovery: { cacheTTL: 12345 },
    } as any);
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();

    expect(settings.networkDiscovery.cacheTTL).toBe(12345);
    expect(settings.networkDiscovery.hostnameTtl).toBe(300000);
    expect(settings.networkDiscovery.macTtl).toBe(300000);
  });

  it('defaults SSH trust policy to always-ask while preserving explicit stored values', async () => {
    seedStoredSettings({
      theme: 'dark',
    });

    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();
    expect(settings.sshTrustPolicy).toBe('always-ask');

    await manager.saveSettings({ sshTrustPolicy: 'strict' });
    SettingsManager.resetInstance();

    const reloaded = await SettingsManager.getInstance().loadSettings();
    expect(reloaded.sshTrustPolicy).toBe('strict');
  });

  it('defaults trust policies to root tofu with inherited certificate categories', async () => {
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();

    expect(settings.trustPolicy).toBe('tofu');
    expect(settings.httpsTrustPolicy).toBe('inherit');
    expect(settings.certificateTrustPolicy).toBe('inherit');
    expect(settings.rdpTrustPolicy).toBe('inherit');
    expect(settings.sshTrustPolicy).toBe('always-ask');
    expect(settings.tlsTrustPolicy).toBe('tofu');
  });

  it('backfills HTTPS trust policy from legacy TLS only when HTTPS is absent', async () => {
    seedStoredSettings({
      tlsTrustPolicy: 'strict',
    });

    const legacyOnly = await SettingsManager.getInstance().loadSettings();
    expect(legacyOnly.httpsTrustPolicy).toBe('strict');
    expect(legacyOnly.certificateTrustPolicy).toBe('inherit');
    expect(legacyOnly.tlsTrustPolicy).toBe('strict');

    SettingsManager.resetInstance();
    // Fresh store with HTTPS explicitly set — the backfill must NOT override it.
    fakeStoredSettings = null;
    seedStoredSettings({
      httpsTrustPolicy: 'always-trust',
      tlsTrustPolicy: 'strict',
    });

    const explicitHttps = await SettingsManager.getInstance().loadSettings();
    expect(explicitHttps.httpsTrustPolicy).toBe('always-trust');
    expect(explicitHttps.certificateTrustPolicy).toBe('inherit');
    expect(explicitHttps.tlsTrustPolicy).toBe('strict');
  });
});

describe('SettingsManager.benchmarkKeyDerivation', () => {
  it('returns a positive iteration count and logs completion', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    // Use a short target time (10ms) and short max time (100ms) to ensure test completes quickly
    const iterations = await manager.benchmarkKeyDerivation(0.01, 0.1);

    expect(iterations).toBeGreaterThan(0);
    const [last] = manager.getActionLog();
    expect(last.action).toBe('Key derivation benchmark completed');
  });

  it('throws when required Web APIs are missing', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    const originalPerformance = globalThis.performance;
    // Remove performance API to simulate unsupported environment
    // @ts-expect-error: simulate unsupported environment
    globalThis.performance = undefined;

    await expect(manager.benchmarkKeyDerivation(0.01)).rejects.toThrow();

    globalThis.performance = originalPerformance;
  });

  it('stops when exceeding max time and returns last iteration count', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    // Mock performance.now to simulate time passing quickly
    let time = 0;
    const nowSpy = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
      time += 100; // increase by 100ms each call
      return time;
    });

    const iterations = await manager.benchmarkKeyDerivation(5, 0.03); // 30ms max

    expect(iterations).toBe(10000);

    nowSpy.mockRestore();
  });
});
