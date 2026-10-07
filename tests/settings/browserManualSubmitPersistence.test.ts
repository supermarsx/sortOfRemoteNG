import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

type StoredSettings = {
  theme?: string;
  webBrowser?: Partial<NonNullable<GlobalSettings["webBrowser"]>>;
};

let stored: StoredSettings;
let write = vi.fn(async (_patch: Partial<GlobalSettings>) => 1);

beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  stored = {};
  write = vi.fn(async (patch: Partial<GlobalSettings>) => {
    stored = { ...stored, ...structuredClone(patch) };
    return 1;
  });
  vi.stubGlobal("__TAURI__", {
    core: {
      invoke: async (
        command: string,
        args?: { patch: Partial<GlobalSettings> },
      ) => {
        if (command === "read_app_settings") return structuredClone(stored);
        if (command === "write_app_settings") return write(args!.patch);
        return null;
      },
    },
  });
});

afterEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manual-submit preference persistence", () => {
  it.each([undefined, "real-origin", "legacy"] as const)(
    "keeps missing and explicit choices effective across unrelated saves for engine %s",
    async (engine) => {
      for (const manualFormSubmit of [undefined, false, true]) {
        SettingsManager.resetInstance();
        stored = {
          theme: "dark",
          ...(engine === undefined && manualFormSubmit === undefined
            ? {}
            : {
                webBrowser: {
                  ...(engine === undefined ? {} : { engine }),
                  ...(manualFormSubmit === undefined
                    ? {}
                    : { manualFormSubmit }),
                },
              }),
        };
        const original = structuredClone(stored);
        const expectedManual = manualFormSubmit ?? true;
        write.mockClear();
        const manager = SettingsManager.getInstance();
        const loaded = await manager.loadSettings();
        expect(loaded.webBrowser?.manualFormSubmit).toBe(expectedManual);
        expect(stored).toEqual(original);
        expect(write).not.toHaveBeenCalled();

        await manager.saveSettings({ theme: "light" }, { silent: true });
        expect(write).toHaveBeenLastCalledWith({ theme: "light" });
        expect(stored.webBrowser).toEqual(original.webBrowser);
        // Native reads raw persisted policy; absence must still mean manual.
        expect(stored.webBrowser?.manualFormSubmit ?? true).toBe(
          expectedManual,
        );

        // The browser settings UI saves its full normalized group when changing
        // zoom. This must not convert a missing/manual policy into auto-submit.
        await manager.saveSettings(
          {
            webBrowser: normalizeWebBrowserSettings({
              ...loaded.webBrowser,
              defaultZoomPercent: 125,
            }),
          },
          { silent: true },
        );
        expect(write).toHaveBeenCalledTimes(2);
        expect(stored.webBrowser).toMatchObject({
          defaultZoomPercent: 125,
          manualFormSubmit: expectedManual,
        });
        SettingsManager.resetInstance();
        const reloaded = await SettingsManager.getInstance().loadSettings();
        expect(reloaded.webBrowser?.manualFormSubmit).toBe(expectedManual);
        expect(write).toHaveBeenCalledTimes(2);
      }
    },
  );
});
