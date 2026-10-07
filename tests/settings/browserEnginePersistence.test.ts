import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

let stored: Record<string, unknown> | null;
const invoke = vi.fn(
  async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_app_settings") return stored;
    if (command === "write_app_settings") {
      stored = { ...stored, ...(args?.patch as Record<string, unknown>) };
    }
    return null;
  },
);

beforeEach(() => {
  stored = null;
  invoke.mockClear();
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  vi.stubGlobal("__TAURI__", { core: { invoke } });
});

afterEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  vi.unstubAllGlobals();
});

describe("browser engine persistence and migration", () => {
  it.each([
    null,
    {},
    { webBrowser: {} },
    { webBrowser: { version: 1, showBookmarksBar: false } },
  ])(
    "selects native for absent engine preferences in persisted settings (%j)",
    async (preferences) => {
      stored = preferences;
      const settings = await SettingsManager.getInstance().loadSettings();
      expect(settings.webBrowser?.engine).toBe("real-origin");
    },
  );

  it.each(["legacy", "real-origin"] as const)(
    "preserves saved %s through loading, unrelated saves and reload",
    async (engine) => {
      // Earlier normalized legacy defaults have no provenance marker and must
      // receive the same preservation as explicit choices.
      stored = { webBrowser: normalizeWebBrowserSettings({ engine }) };
      const manager = SettingsManager.getInstance();
      expect((await manager.loadSettings()).webBrowser?.engine).toBe(engine);
      await manager.saveSettings({ confirmDeleteAllBookmarks: false });
      SettingsManager.resetInstance();
      expect(
        (await SettingsManager.getInstance().loadSettings()).webBrowser?.engine,
      ).toBe(engine);
      expect(stored?.webBrowser).toMatchObject({ engine });
    },
  );

  it("persists explicit global engine changes and resets to native defaults", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    for (const engine of ["legacy", "real-origin"] as const) {
      await manager.saveSettings({
        webBrowser: normalizeWebBrowserSettings({ engine }),
      });
      expect(stored?.webBrowser).toMatchObject({ engine });
    }
    await manager.saveSettings({
      webBrowser: normalizeWebBrowserSettings(undefined),
    });
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings()).webBrowser?.engine,
    ).toBe("real-origin");
  });
});
