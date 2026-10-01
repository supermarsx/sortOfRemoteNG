import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

let write = vi.fn(async (_args: Record<string, unknown>) => 1);
beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  write = vi.fn(async () => 1);
  vi.stubGlobal("__TAURI__", {
    core: {
      invoke: async (command: string, args: Record<string, unknown>) =>
        command === "read_app_settings"
          ? { theme: "dark" }
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

describe("cloud preference compare-and-save", () => {
  it.each([
    [100, 100],
    [500, 100],
    [0, 50],
  ])(
    "loads saved size limit %s as %s MiB before sync can use it",
    async (saved, expected) => {
      vi.stubGlobal("__TAURI__", {
        core: {
          invoke: async (command: string) =>
            command === "read_app_settings"
              ? { cloudSync: { maxFileSizeMB: saved } }
              : null,
        },
      });
      const manager = SettingsManager.getInstance();
      await manager.loadSettings();
      expect(manager.getSettings().cloudSync.maxFileSizeMB).toBe(expected);
    },
  );

  it("sends a reviewed patch and publishes only after storage commits", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    let resolve!: (value: number) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const saving = manager.saveCloudSyncSettings(
      { theme: "light" },
      { theme: "dark" },
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(manager.getSettings().theme).toBe("dark");
    expect(write).toHaveBeenCalledWith({
      patch: { theme: "light" },
      expectedPatch: { theme: "dark" },
    });
    manager.applyInMemory({ colorScheme: "red" });
    resolve(3);
    await saving;
    expect(manager.getSettings()).toMatchObject({
      theme: "light",
      colorScheme: "red",
    });
  });
  it("does not retry conflicts or publish rejected preferences", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const conflict = new Error("Preferences changed");
    write.mockRejectedValueOnce(conflict);
    await expect(
      manager.saveCloudSyncSettings({ theme: "light" }, { theme: "dark" }),
    ).rejects.toBe(conflict);
    expect(conflict).not.toHaveProperty("kind");
    expect(write).toHaveBeenCalledOnce();
    expect(manager.getSettings().theme).toBe("dark");
  });
  it("cannot import security policy, sync destinations or device settings", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveCloudSyncSettings({ cloudSync: {} } as never, {}),
    ).rejects.toThrow("unsupported");
    expect(write).not.toHaveBeenCalled();
  });
  it("preserves newer in-memory drafts when an old completion arrives", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    let resolve!: (value: number) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const saving = manager.saveCloudSyncSettings(
      { theme: "light" },
      { theme: "dark" },
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    manager.applyInMemory({ theme: "system" });
    resolve(4);
    await expect(saving).rejects.toMatchObject({
      kind: "partial",
      message: expect.stringContaining("edited while"),
    });
    expect(write).toHaveBeenCalledOnce();
    expect(manager.getSettings().theme).toBe("system");
  });
  it.each([false, true])(
    "reports partial after a committed write crosses a lock boundary (unlocked again: %s)",
    async (unlockAgain) => {
      const manager = SettingsManager.getInstance();
      await manager.loadSettings();
      let resolve!: (value: number) => void;
      write.mockImplementationOnce(
        () =>
          new Promise<number>((done) => {
            resolve = done;
          }),
      );
      const saving = manager.saveCloudSyncSettings(
        { theme: "light" },
        { theme: "dark" },
      );
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      manager.invalidateLoadedSettings(true);
      if (unlockAgain) manager.invalidateLoadedSettings(false);
      const afterLock = manager.getSettings();

      resolve(5);
      await expect(saving).rejects.toMatchObject({
        kind: "partial",
        message: expect.stringContaining("lock changed"),
      });
      expect(write).toHaveBeenCalledOnce();
      expect(manager.getSettings()).toBe(afterLock);
    },
  );
  it("reports post-commit broadcast failures without rolling back or replaying", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    vi.spyOn(window, "dispatchEvent").mockImplementation(() => {
      throw new Error("settings broadcast failed");
    });

    await expect(
      manager.saveCloudSyncSettings({ theme: "light" }, { theme: "dark" }),
    ).rejects.toMatchObject({
      kind: "partial",
      message: "settings broadcast failed",
    });
    expect(write).toHaveBeenCalledOnce();
    expect(manager.getSettings().theme).toBe("light");
  });
});
