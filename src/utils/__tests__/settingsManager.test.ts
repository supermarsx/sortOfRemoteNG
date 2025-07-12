import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { SettingsManager } from '../settingsManager';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  localStorage.clear();
  (SettingsManager as any).instance = undefined;
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

    (SettingsManager as any).instance = undefined;
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe('green');
  });

  it('accepts grey colorScheme', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await manager.saveSettings({ colorScheme: 'grey' });

    (SettingsManager as any).instance = undefined;
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe('grey');
  });
});

describe('SettingsManager.benchmarkKeyDerivation', () => {
  it('returns a positive iteration count and logs completion', async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();

    const iterations = await manager.benchmarkKeyDerivation(0.01);

    expect(iterations).toBeGreaterThan(0);
    const [last] = manager.getActionLog();
    expect(last.action).toBe('Key derivation benchmark completed');
  });
});
