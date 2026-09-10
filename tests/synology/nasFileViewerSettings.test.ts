import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";
import { normalizeNasFileViewers } from "../../src/types/settings/nasFileViewers";

let persisted: Record<string, unknown>;
const write = vi.fn<(args: Record<string, unknown>) => Promise<number>>();
beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  persisted = {};
  write.mockReset().mockImplementation(async (args) => {
    Object.assign(persisted, args.patch);
    return 1;
  });
  vi.stubGlobal("__TAURI__", {
    core: {
      invoke: async (command: string, args: Record<string, unknown>) =>
        command === "read_app_settings"
          ? structuredClone(persisted)
          : command === "write_app_settings"
            ? write(args)
            : null,
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("persisted NAS viewer preferences", () => {
  it("roundtrips the owned nested key through protected settings and preserves false preferences", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const preferences = normalizeNasFileViewers({
      preview: { text: false },
      external: { pdf: true },
      application: { pdf: "choose" },
      textWrap: false,
      confirmExternal: false,
      previewMaxMiB: 8,
      retentionMinutes: 60,
    });
    await manager.saveSettings(
      { nasFileViewers: preferences },
      { silent: true },
    );
    expect(persisted.nasFileViewers).toEqual(preferences);
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings()).nasFileViewers,
    ).toEqual(preferences);
  });
  it("never publishes failed external permission changes through a later unrelated settings save", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const before = manager.getSettings().nasFileViewers;
    write.mockRejectedValue(new Error("disk unavailable"));
    await expect(
      manager.saveSettings(
        {
          nasFileViewers: normalizeNasFileViewers({
            external: { text: true },
            confirmExternal: false,
          }),
        },
        { silent: true },
      ),
    ).rejects.toThrow("disk unavailable");
    expect(manager.getSettings().nasFileViewers).toEqual(before);
    write.mockImplementation(async (args) => {
      Object.assign(persisted, args.patch);
      return 2;
    });
    await manager.saveSettings({ colorScheme: "red" }, { silent: true });
    expect(manager.getSettings().nasFileViewers).toEqual(before);
    expect(persisted.nasFileViewers).toBeUndefined();
    expect(write.mock.lastCall?.[0].patch).toEqual({ colorScheme: "red" });
  });
});
