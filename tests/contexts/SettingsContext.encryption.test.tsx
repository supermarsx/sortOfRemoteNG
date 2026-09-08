import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("../../src/contexts/SettingsContext");
import {
  SettingsProvider,
  useSettings,
} from "../../src/contexts/SettingsContext";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../src/types/encryption/encryption";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    native.events.set(name, callback);
    return () => {
      native.events.delete(name);
    };
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);
beforeEach(() => {
  SettingsManager.resetInstance();
  native.invoke.mockReset();
  native.events.clear();
});
describe("Global settings encryption boundaries", () => {
  it("does not save defaults after a locked read and restores saved policies before later edits", async () => {
    const manager = SettingsManager.getInstance();
    const saved = {
      ...manager.getSettings(),
      language: "pt",
      autoLock: { ...manager.getSettings().autoLock, timeoutMinutes: 7 },
      globalProxy: { enabled: true, password: "proxy-secret-sentinel" },
    };
    let locked = true;
    native.invoke.mockImplementation(async (command) => {
      if (command === "read_app_settings") {
        if (locked) throw new Error("Storage locked");
        return saved;
      }
      return null;
    });
    const log = vi.spyOn(manager, "logAction").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() =>
      expect(result.current.settingsLoadError).toContain("Storage locked"),
    );
    await expect(
      result.current.updateSettings({ language: "en" }),
    ).rejects.toThrow("Storage locked");
    expect(
      native.invoke.mock.calls.filter(
        ([name]) => name === "write_app_settings",
      ),
    ).toHaveLength(0);
    locked = false;
    await waitFor(() =>
      expect(native.events.has(ENCRYPTION_EVENT_UNLOCKED)).toBe(true),
    );
    act(() => native.events.get(ENCRYPTION_EVENT_UNLOCKED)?.({ payload: {} }));
    await waitFor(() => expect(result.current.settingsReady).toBe(true));
    expect(result.current.settings.autoLock.timeoutMinutes).toBe(7);
    await act(async () => result.current.updateSettings({ language: "fr" }));
    const write = native.invoke.mock.calls.find(
      ([name]) => name === "write_app_settings",
    );
    expect(write?.[1].patch).toEqual({ language: "fr" });
    expect(result.current.settings.autoLock.timeoutMinutes).toBe(7);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "proxy-secret-sentinel",
    );
    expect(log).toHaveBeenCalledWith(
      "info",
      "Settings changed",
      undefined,
      "Changed keys: language",
    );
  });
  it("does not restore a pre-lock asynchronous settings load after the lock event", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementation(async (command) =>
      command === "read_app_settings"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : null,
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() =>
      expect(native.events.has(ENCRYPTION_EVENT_LOCKED)).toBe(true),
    );
    act(() => native.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
    await act(async () =>
      finish({ language: "secret-language", theme: "light" }),
    );
    expect(result.current.settingsReady).toBe(false);
    expect(result.current.settings.language).not.toBe("secret-language");
    await expect(
      result.current.updateSettings({ theme: "light" }),
    ).rejects.toThrow("locked");
    expect(
      native.invoke.mock.calls.filter(
        ([name]) => name === "write_app_settings",
      ),
    ).toHaveLength(0);
  });
  it("logs changed field names, never nested credential values", async () => {
    native.invoke.mockImplementation(async (command) =>
      command === "read_app_settings" ? {} : null,
    );
    const manager = SettingsManager.getInstance();
    const log = vi.spyOn(manager, "logAction").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsReady).toBe(true));
    await act(async () =>
      result.current.updateSettings({
        globalProxy: {
          type: "http",
          host: "proxy.example",
          port: 8080,
          enabled: true,
          ...result.current.settings.globalProxy,
          password: "must-not-be-logged",
        },
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-be-logged");
    expect(log).toHaveBeenCalledWith(
      "info",
      "Settings changed",
      undefined,
      "Changed keys: globalProxy",
    );
  });
  it("does not advertise a rejected security policy save", async () => {
    native.invoke.mockImplementation(async (command) =>
      command === "read_app_settings" ? {} : null,
    );
    const manager = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsReady).toBe(true));
    const original = result.current.settings.autoLock;
    vi.spyOn(manager, "saveSettings").mockRejectedValue(
      new Error("Disk unavailable"),
    );
    await act(async () => {
      await expect(
        result.current.updateSettings({
          autoLock: { ...original, enabled: !original.enabled },
        }),
      ).rejects.toThrow("Disk unavailable");
    });
    expect(result.current.settings.autoLock).toEqual(original);
  });
  it("does not republish a deferred save after native lock clears preferences", async () => {
    native.invoke.mockImplementation(async (command) =>
      command === "read_app_settings" ? {} : null,
    );
    const manager = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsReady).toBe(true));
    await waitFor(() =>
      expect(native.events.has(ENCRYPTION_EVENT_LOCKED)).toBe(true),
    );
    let finish!: () => void;
    vi.spyOn(manager, "saveSettings").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = result.current.updateSettings({
      language: "do-not-restore",
    });
    const rejected = expect(pending).rejects.toThrow("lock state");
    act(() => native.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
    await act(async () => finish());
    await rejected;
    expect(result.current.settingsReady).toBe(false);
    expect(result.current.settings.language).not.toBe("do-not-restore");
  });
});
