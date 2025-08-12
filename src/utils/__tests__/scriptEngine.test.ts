import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('ScriptEngine.httpRequest', () => {
  it('makes GET request without Content-Type header', async () => {
    const engine = ScriptEngine.getInstance();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '',
    } as any);
    (global as any).fetch = fetchSpy;

    await (engine as any).httpRequest('GET', 'https://example.com');

    const headers = fetchSpy.mock.calls[0][1]?.headers;
    if (headers instanceof Headers) {
      expect(headers.has('Content-Type')).toBe(false);
      expect(headers.has('content-type')).toBe(false);
    } else {
      expect(headers?.['Content-Type']).toBeUndefined();
      expect(headers?.['content-type']).toBeUndefined();
    }
  });
});
