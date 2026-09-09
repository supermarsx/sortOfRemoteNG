import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";
import {
  parsePassiveSvg,
  validateIconLibrary,
  type IconLibraryData,
} from "../../src/utils/icons/iconLibrary";
import {
  getIconLibrarySnapshot,
  getRuntimeIconEntry,
} from "../../src/utils/icons/iconLibraryRuntime";
const key = "custom:12345678-1234-4123-8123-123456789abc" as const;
const data = (): IconLibraryData => ({
  version: 1,
  customIcons: [
    {
      key,
      label: "Protected icon",
      notes: "Private notes",
      svg: parsePassiveSvg(
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>',
      ),
    },
  ],
  builtInOverrides: {},
});
let persisted: Record<string, unknown>;
let write = vi.fn(async (_args: Record<string, unknown>) => 1);
beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  persisted = {};
  write = vi.fn(async (args: Record<string, unknown>) => {
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
describe("commit-confirmed icon settings", () => {
  it("captures the reviewed base before awaits and does not publish over a newer synced library", async () => {
    persisted.iconLibrary = data();
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const expected = data();
    let resolve!: (value: number) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const next = {
      ...data(),
      builtInOverrides: { server: { label: "Old completion", notes: "" } },
    };
    const saving = manager.saveIconLibrary(next, expected);
    expected.customIcons[0].label = "Mutated after submit";
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0].expectedIconLibrary).toEqual(data());
    const newer = {
      ...data(),
      builtInOverrides: { server: { label: "Newer window", notes: "" } },
    };
    manager.applySettingsSnapshot({
      ...manager.getSettings(),
      iconLibrary: newer,
    });
    resolve(1);
    await expect(saving).rejects.toThrow("newer icon library");
    expect(getRuntimeIconEntry("server")?.label).toBe("Newer window");
  });
  it("sends exact reviewed CAS base and installs only after commit while preserving sibling patches", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    let resolve!: (value: number) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const saving = manager.saveIconLibrary(
      data(),
      validateIconLibrary(undefined),
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0]).toEqual({
      patch: { iconLibrary: data() },
      expectedIconLibrary: validateIconLibrary(undefined),
    });
    expect(manager.getSettings().iconLibrary).toBeUndefined();
    expect(getRuntimeIconEntry(key)).toBeUndefined();
    manager.applyInMemory({ colorScheme: "red" });
    resolve(1);
    await saving;
    expect(manager.getSettings().colorScheme).toBe("red");
    expect(getRuntimeIconEntry(key)?.label).toBe("Protected icon");
  });
  it("never leaves failed imports in manager or later ordinary save broadcasts", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    write.mockRejectedValue(new Error("disk refused"));
    await expect(
      manager.saveIconLibrary(data(), validateIconLibrary(undefined)),
    ).rejects.toThrow("disk refused");
    expect(manager.getSettings().iconLibrary).toBeUndefined();
    expect(getRuntimeIconEntry(key)).toBeUndefined();
    write.mockResolvedValue(1);
    await manager.saveSettings({ colorScheme: "red" }, { silent: true });
    expect(getRuntimeIconEntry(key)).toBeUndefined();
    expect(write.mock.lastCall?.[0].patch).toEqual({ colorScheme: "red" });
  });
  it("clears notes/vectors synchronously on lock and fences late completion across unlock", async () => {
    persisted.iconLibrary = data();
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    let resolve!: (value: number) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const saving = manager.saveIconLibrary(
      {
        ...data(),
        builtInOverrides: {
          server: { label: "Pending", notes: "pending private" },
        },
      },
      data(),
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    manager.invalidateLoadedSettings(true);
    expect(getIconLibrarySnapshot().locked).toBe(true);
    expect(JSON.stringify(getIconLibrarySnapshot())).not.toContain(
      "Private notes",
    );
    expect(getRuntimeIconEntry(key)).toBeUndefined();
    manager.invalidateLoadedSettings(false);
    await manager.loadSettings();
    resolve(1);
    await expect(saving).rejects.toThrow("lock state");
    expect(getRuntimeIconEntry("server")?.label).not.toBe("Pending");
  });
  it("rejects a changed reviewed base and stale full-settings library writes before any IPC", async () => {
    persisted.iconLibrary = data();
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveIconLibrary(data(), validateIconLibrary(undefined)),
    ).rejects.toThrow("changed");
    await expect(
      manager.saveSettings({
        colorScheme: "red",
        iconLibrary: validateIconLibrary(undefined),
      }),
    ).rejects.toThrow("Icon Explorer");
    expect(write).not.toHaveBeenCalled();
    expect(manager.getSettings().colorScheme).not.toBe("red");
  });
  it("quarantines malformed persisted vectors without overwriting their bytes on unrelated saves", async () => {
    const malformed = {
      version: 1,
      customIcons: [{ svg: "<script/>" }],
      builtInOverrides: {},
    };
    persisted.iconLibrary = malformed;
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    expect(getIconLibrarySnapshot()).toMatchObject({
      ready: false,
      locked: false,
    });
    expect(getIconLibrarySnapshot().error).toContain("Icon library");
    await manager.saveSettings({ colorScheme: "red" }, { silent: true });
    expect(persisted.iconLibrary).toEqual(malformed);
    expect(write.mock.lastCall?.[0].patch).toEqual({ colorScheme: "red" });
  });
  it("reset all explicitly clears the stored library with its reviewed base", async () => {
    persisted.iconLibrary = data();
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await manager.resetStoredSettings();
    expect(write.mock.lastCall?.[0].expectedIconLibrary).toEqual(data());
    expect(persisted.iconLibrary).toEqual(validateIconLibrary(undefined));
    expect(getRuntimeIconEntry(key)).toBeUndefined();
  });
  it("accepted same-window library snapshots invalidate the runtime revision", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    const revision = getIconLibrarySnapshot().revision;
    expect(
      manager.applySettingsSnapshot({
        ...manager.getSettings(),
        iconLibrary: data(),
      }),
    ).not.toBeNull();
    expect(getIconLibrarySnapshot().revision).toBeGreaterThan(revision);
    expect(getRuntimeIconEntry(key)?.label).toBe("Protected icon");
  });
});
