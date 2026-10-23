import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { PerformanceSettings } from "../../src/components/SettingsDialog/sections/PerformanceSettings";
import { BackendSettings } from "../../src/components/SettingsDialog/sections/BackendSettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

let stored: Record<string, unknown> | null;
afterEach(cleanup);
beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
  _resetInvokeCache();
  stored = null;
  (globalThis as any).__TAURI__ = {
    core: {
      invoke: async (
        command: string,
        args?: { patch?: Record<string, unknown> },
      ) => {
        if (command === "read_app_settings") return stored;
        if (command === "write_app_settings") {
          stored = { ...stored, ...args?.patch };
          return null;
        }
        return null;
      },
    },
  };
});

describe("persistent connection capacity policy", () => {
  it("offers a themed automatic/fixed choice and a shared RDP summary without changing legacy RDP metadata", () => {
    const writes = vi.fn();
    function View() {
      const [settings, setSettings] = React.useState<GlobalSettings>({
        ...defaultSettings,
        connectionAdmissionMode: "automatic",
        backendConfig: {
          ...defaultSettings.backendConfig,
          maxConcurrentRdpSessions: 3,
        },
      });
      const updateSettings = (patch: Partial<GlobalSettings>) => {
        writes(patch);
        setSettings((current) => ({ ...current, ...patch }));
      };
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(PerformanceSettings, { settings, updateSettings }),
        React.createElement(BackendSettings, { settings, updateSettings }),
      );
    }
    const { container } = render(React.createElement(View));
    expect(
      screen.queryByRole("spinbutton", { name: "Maximum connections" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Automatic — available system memory/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Max Concurrent RDP Sessions"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Connection limit" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Set a connection limit" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Maximum connections" }),
    ).toHaveValue(10);
    expect(writes).toHaveBeenLastCalledWith({
      connectionAdmissionMode: "fixed",
    });
    expect(writes.mock.calls.some(([patch]) => "backendConfig" in patch)).toBe(
      false,
    );
    expect(container.querySelector("select")).toBeNull();
  });
  it.each([null, {}, { maxConcurrentConnections: 10 }])(
    "migrates untouched old defaults %j to automatic",
    async (value) => {
      stored = value;
      const settings = await SettingsManager.getInstance().loadSettings();
      expect(settings.connectionAdmissionMode).toBe("automatic");
      expect(settings.maxConcurrentConnections).toBe(10);
    },
  );
  it.each([0, 1, 24])(
    "preserves explicit legacy numeric limit %i",
    async (limit) => {
      stored = { maxConcurrentConnections: limit };
      const settings = await SettingsManager.getInstance().loadSettings();
      expect(settings.connectionAdmissionMode).toBe("fixed");
      expect(settings.maxConcurrentConnections).toBe(limit);
    },
  );
  it("persists a newly chosen fixed10 and never migrates it back to automatic", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    await manager.saveSettings({ maxConcurrentConnections: 10 });
    expect(stored).toMatchObject({
      connectionAdmissionMode: "fixed",
      maxConcurrentConnections: 10,
    });
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings())
        .connectionAdmissionMode,
    ).toBe("fixed");
    await SettingsManager.getInstance().saveSettings({
      connectionAdmissionMode: "automatic",
    });
    SettingsManager.resetInstance();
    expect(
      (await SettingsManager.getInstance().loadSettings())
        .connectionAdmissionMode,
    ).toBe("automatic");
  });
  it("normalizes in-memory legacy numeric edits without silently clearing their restriction", async () => {
    const manager = SettingsManager.getInstance();
    await manager.loadSettings();
    manager.applyInMemory({ maxConcurrentConnections: 1 });
    expect(manager.getSettings()).toMatchObject({
      connectionAdmissionMode: "fixed",
      maxConcurrentConnections: 1,
    });
    manager.applyInMemory({ connectionAdmissionMode: "automatic" });
    expect(manager.getSettings()).toMatchObject({
      connectionAdmissionMode: "automatic",
      maxConcurrentConnections: 1,
    });
  });
  it("treats malformed imported mode as restrictive rather than silently automatic", async () => {
    stored = {
      connectionAdmissionMode: "unknown",
      maxConcurrentConnections: 10,
    };
    expect(
      (await SettingsManager.getInstance().loadSettings())
        .connectionAdmissionMode,
    ).toBe("fixed");
  });
});
