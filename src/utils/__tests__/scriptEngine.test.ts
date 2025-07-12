import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { ScriptEngine } from '../scriptEngine';
import { SettingsManager } from '../settingsManager';
import { CustomScript } from '../../types/settings';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  localStorage.clear();
  SettingsManager.resetInstance();
  ScriptEngine.resetInstance();
});

describe('ScriptEngine.setSetting', () => {
  it('persists setting changes via scripts', async () => {
    const settingsManager = SettingsManager.getInstance();
    await settingsManager.loadSettings();
    const engine = ScriptEngine.getInstance();

    const script: CustomScript = {
      id: 's1',
      name: 'update setting',
      type: 'javascript',
      content: "await setSetting('colorScheme', 'purple');",
      trigger: 'manual',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await engine.executeScript(script, { trigger: 'manual' });

    SettingsManager.resetInstance();
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe('purple');
  });
});
