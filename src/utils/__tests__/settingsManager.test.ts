import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { SettingsManager } from '../settingsManager';
import { IndexedDbService } from '../indexedDbService';
import { openDB } from 'idb';

let dom: JSDOM;

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

beforeEach(async () => {
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  SettingsManager.resetInstance();
});

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

describe('SettingsManager loadSettings', () => {
  it('applies default network discovery TTLs when missing', async () => {
    await IndexedDbService.setItem('mremote-settings', {
      networkDiscovery: { cacheTTL: 12345 },
    } as any);
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();

    expect(settings.networkDiscovery.cacheTTL).toBe(12345);
    expect(settings.networkDiscovery.hostnameTtl).toBe(300000);
    expect(settings.networkDiscovery.macTtl).toBe(300000);
  });
});

describe('SettingsManager.benchmarkKeyDerivation', () => {
  it('returns a positive iteration count and logs completion', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    const iterations = await manager.benchmarkKeyDerivation(0.01, 0.1, 1);

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
