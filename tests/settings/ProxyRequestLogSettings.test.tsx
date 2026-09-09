import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProxySettings from "../../src/components/SettingsDialog/sections/ProxySettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("proxy request log settings draft", () => {
  it("does not clear logs while editing an empty field; requires explicit bounded Apply", () => {
    const updateSettings = vi.fn();
    render(
      <ProxySettings
        settings={defaultSettings}
        updateSettings={updateSettings}
        updateProxy={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Proxy request log limit");
    fireEvent.change(input, { target: { value: "" } });
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply log limit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("whole number");
    expect(updateSettings).not.toHaveBeenCalled();
    for (const value of ["-1", "1.5", "100001"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Apply log limit" }));
      expect(updateSettings).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: "0" } });
    expect(
      screen.getByText(/Applying 0 clears and disables/),
    ).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply log limit" }));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      proxyRequestLogLimit: 0,
    });
  });

  it("shows retryable runtime failure without claiming the draft is applied", () => {
    const retry = vi.fn();
    render(
      <ProxySettings
        settings={defaultSettings}
        updateSettings={vi.fn()}
        updateProxy={vi.fn()}
        requestLogSync={{
          pending: false,
          appliedLimit: 50,
          error: "Could not apply saved limit.",
          retry,
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not apply");
    expect(screen.queryByText(/Running proxy limit/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry applying log limit" }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("disables changes while settings are locked or loading", () => {
    const updateSettings = vi.fn();
    render(
      <ProxySettings
        settings={defaultSettings}
        settingsReady={false}
        updateSettings={updateSettings}
        updateProxy={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Proxy request log limit")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Apply log limit" }),
    ).toBeDisabled();
  });
});

describe("proxy limit settings persistence", () => {
  let stored: Record<string, unknown>;
  let failLimitWrite: boolean;
  beforeEach(() => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    _resetInvokeCache();
    stored = {};
    failLimitWrite = false;
    vi.stubGlobal("__TAURI__", {
      core: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === "read_app_settings") return structuredClone(stored);
          if (
            command === "write_app_settings" &&
            failLimitWrite &&
            "proxyRequestLogLimit" in (args.patch as object)
          )
            throw new Error("Synthetic persistence failure");
          if (command === "write_app_settings")
            Object.assign(stored, args.patch);
          return null;
        },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _resetInvokeCache();
  });

  it("migrates absence to 10000, persists zero and preserves unrelated settings", async () => {
    stored = { theme: "dark" };
    const manager = SettingsManager.getInstance();
    expect((await manager.loadSettings()).proxyRequestLogLimit).toBe(10000);
    await manager.saveSettings({ proxyRequestLogLimit: 0 });
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings()).proxyRequestLogLimit,
    ).toBe(0);
    expect(stored.theme).toBe("dark");
  });

  it("rejects invalid explicit writes without mutating stored settings", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await expect(
      manager.saveSettings({ proxyRequestLogLimit: -1 }),
    ).rejects.toThrow(/integer/);
    expect(stored.proxyRequestLogLimit).toBeUndefined();
  });

  it("never publishes a draft or failed zero through unrelated settings saves", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    manager.applyInMemory({ proxyRequestLogLimit: 0 });
    expect(manager.getSettings().proxyRequestLogLimit).toBe(10000);
    await manager.saveSettings({ theme: "light" });
    expect(manager.getSettings().proxyRequestLogLimit).toBe(10000);
    failLimitWrite = true;
    await expect(
      manager.saveSettings({ proxyRequestLogLimit: 0 }),
    ).rejects.toThrow();
    expect(manager.getSettings().proxyRequestLogLimit).toBe(10000);
    expect(stored.proxyRequestLogLimit).toBeUndefined();
    await manager.saveSettings({ theme: "dark" });
    expect(manager.getSettings().proxyRequestLogLimit).toBe(10000);
  });
});
