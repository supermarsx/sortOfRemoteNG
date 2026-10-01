import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

type RawSettings = Partial<GlobalSettings> & { recordTimestamps?: unknown };
type WriteArgs = {
  patch: RawSettings;
  expectedPatch?: Partial<GlobalSettings>;
};

const nativeMetadata = { version: 1, records: {} };
let stored: RawSettings;
let write = vi.fn(async (_args: WriteArgs) => 1);

beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  stored = { theme: "dark", recordTimestamps: structuredClone(nativeMetadata) };
  write = vi.fn(async ({ patch }: WriteArgs) => {
    // The native boundary rejects even unchanged metadata in arbitrary patches.
    if (Object.prototype.hasOwnProperty.call(patch, "recordTimestamps")) {
      throw new Error("recordTimestamps is native-owned");
    }
    stored = { ...stored, ...patch };
    return 1;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("__TAURI__", {
    core: {
      invoke: async (command: string, args: WriteArgs) =>
        command === "read_app_settings"
          ? structuredClone(stored)
          : command === "write_app_settings"
            ? write(args)
            : null,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsManager native-owned recordTimestamps", () => {
  it("strips metadata on read and when saving a full settings snapshot", async () => {
    const manager = SettingsManager.getInstance();
    const loaded = await manager.loadSettings();
    expect(loaded).not.toHaveProperty("recordTimestamps");

    const input: RawSettings = Object.freeze({
      ...loaded,
      theme: "light",
      recordTimestamps: nativeMetadata,
    });
    await manager.saveSettings(input, { silent: true });

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0].patch).toMatchObject({ theme: "light" });
    expect(write.mock.calls[0][0].patch).not.toHaveProperty("recordTimestamps");
    expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
    expect(manager.getSettings().theme).toBe("light");
    expect(stored.recordTimestamps).toEqual(nativeMetadata);
    expect(input.recordTimestamps).toBe(nativeMetadata);
  });

  it.each([nativeMetadata, null, undefined])(
    "strips draft metadata regardless of its value (%j)",
    async (recordTimestamps) => {
      const manager = SettingsManager.getInstance();
      await manager.loadSettings();
      const input: RawSettings = Object.freeze({
        theme: "light",
        recordTimestamps,
      });

      manager.applyInMemory(input);
      expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
      expect(manager.getSettings().theme).toBe("light");
      expect(write).not.toHaveBeenCalled();
      expect(
        Object.prototype.hasOwnProperty.call(input, "recordTimestamps"),
      ).toBe(true);
      expect(input.recordTimestamps).toBe(recordTimestamps);

      await manager.saveSettings(manager.getSettings(), { silent: true });
      expect(write).toHaveBeenCalledOnce();
      expect(write.mock.calls[0][0].patch).not.toHaveProperty(
        "recordTimestamps",
      );
      expect(stored.recordTimestamps).toEqual(nativeMetadata);
    },
  );

  it("never installs metadata during a rejected save or any retry", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const before = structuredClone(stored);
    const input: RawSettings = Object.freeze({
      theme: "light",
      recordTimestamps: nativeMetadata,
    });
    write.mockImplementation(async ({ patch }) => {
      expect(patch).not.toHaveProperty("recordTimestamps");
      expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
      throw new Error("disk unavailable");
    });

    await expect(manager.saveSettings(input)).rejects.toThrow(
      "disk unavailable",
    );
    expect(write).toHaveBeenCalledTimes(3);
    expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
    // Ordinary failed saves still retain the user's draft, not native metadata.
    expect(manager.getSettings().theme).toBe("light");
    expect(stored).toEqual(before);
    expect(input.recordTimestamps).toBe(nativeMetadata);
  });

  it("leaves native metadata and runtime settings unchanged on a cloud conflict", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const before = structuredClone(stored);
    write.mockRejectedValueOnce(new Error("Preferences changed"));

    await expect(
      manager.saveCloudSyncSettings({ theme: "light" }, { theme: "dark" }),
    ).rejects.toThrow("Preferences changed");
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({
      patch: { theme: "light" },
      expectedPatch: { theme: "dark" },
    });
    expect(manager.getSettings().theme).toBe("dark");
    expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
    expect(stored).toEqual(before);
  });

  it("still rejects reserved metadata in either cloud CAS argument", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const raw: RawSettings = {
      theme: "light",
      recordTimestamps: nativeMetadata,
    };

    await expect(manager.saveCloudSyncSettings(raw, {})).rejects.toThrow(
      "unsupported",
    );
    await expect(manager.saveCloudSyncSettings({}, raw)).rejects.toThrow(
      "unsupported",
    );
    expect(write).not.toHaveBeenCalled();
    expect(manager.getSettings()).not.toHaveProperty("recordTimestamps");
    expect(manager.getSettings().theme).toBe("dark");
    expect(stored.recordTimestamps).toEqual(nativeMetadata);
  });
});
