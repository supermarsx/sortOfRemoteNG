import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Undo the global useSettings mock from vitest.setup — this test exercises the real module.
vi.unmock("../../src/contexts/SettingsContext");

import {
  SettingsProvider,
  useSettings,
} from "../../src/contexts/SettingsContext";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  SettingsSyncRevisionTracker,
} from "../../src/utils/settings/settingsManager";
import { getEffectiveTrustPolicy } from "../../src/utils/auth/trustStore";
import { resolveSshReconnectPolicy } from "../../src/utils/ssh/sshReconnectPolicy";

const eventMocks = vi.hoisted(() => ({
  listener: null as ((event: { payload: unknown }) => void) | null,
  unlisten: vi.fn(),
  emit: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: eventMocks.emit,
  listen: vi.fn(
    async (
      _eventName: string,
      listener: (event: { payload: unknown }) => void,
    ) => {
      eventMocks.listener = listener;
      return eventMocks.unlisten;
    },
  ),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

let loadedSettings: GlobalSettings;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

const dispatchSettingsSync = async (payload: unknown): Promise<void> => {
  await act(async () => {
    eventMocks.listener?.({ payload });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

describe("SettingsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsManager.resetInstance();
    eventMocks.listener = null;

    // Mock the SettingsManager methods
    const mgr = SettingsManager.getInstance();
    loadedSettings = {
      ...mgr.getSettings(),
      language: "en",
      theme: "dark",
    };
    vi.spyOn(mgr, "loadSettings").mockResolvedValue(loadedSettings);
    vi.spyOn(mgr, "saveSettings").mockResolvedValue(undefined);
    vi.spyOn(mgr, "logAction").mockImplementation(() => {});
  });

  it("provides default settings initially", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    // Before loadSettings resolves, defaults are used
    expect(result.current.settings).toBeDefined();
    expect(result.current.settings.theme).toBeDefined();
  });

  it("loads settings from SettingsManager on mount", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    // Wait for the useEffect to resolve and the loaded settings to apply
    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });
    expect(result.current.settings.language).toBe("en");
  });

  it("updates settings via updateSettings", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    // Wait for initial load to complete and apply
    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });

    await act(async () => {
      await result.current.updateSettings({ language: "fr" });
    });

    expect(result.current.settings.language).toBe("fr");
    expect(mgr.saveSettings).toHaveBeenCalled();
  });

  it("logs changed settings on update", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await vi.waitFor(() => {
      expect(mgr.loadSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.updateSettings({ language: "fr" });
    });

    expect(mgr.logAction).toHaveBeenCalledWith(
      "info",
      "Settings changed",
      undefined,
      expect.stringContaining("language"),
    );
  });

  it("reloads settings via reloadSettings", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await vi.waitFor(() => {
      expect(mgr.loadSettings).toHaveBeenCalledTimes(1);
    });

    vi.mocked(mgr.loadSettings).mockResolvedValue({
      ...loadedSettings,
      language: "de",
    });

    await act(async () => {
      await result.current.reloadSettings();
    });

    expect(mgr.loadSettings).toHaveBeenCalledTimes(2);
    expect(result.current.settings.language).toBe("de");
  });

  it("applies same-window settings-updated events live without remount", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });

    // Sanity: starts at the loaded value, not the new one.
    expect(result.current.settings.language).toBe("en");

    // SettingsManager.saveSettings() dispatches the full merged blob as detail.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { ...loadedSettings, language: "es" },
        }),
      );
    });

    // Same hook instance (no remount) now reflects the new value.
    expect(result.current.settings.language).toBe("es");
  });

  it("does not re-persist when handling settings-updated (no loop)", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });

    vi.mocked(mgr.saveSettings).mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: { ...loadedSettings, language: "pt" },
        }),
      );
    });

    expect(result.current.settings.language).toBe("pt");
    // The listener must only setSettings — never call saveSettings (would loop).
    expect(mgr.saveSettings).not.toHaveBeenCalled();
  });

  it("ignores malformed settings-updated detail", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mgr.loadSettings).toHaveBeenCalled();
      });
    });

    expect(result.current.settings.language).toBe("en");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("settings-updated", { detail: null }),
      );
    });

    // Unchanged — guard rejected the malformed detail.
    expect(result.current.settings.language).toBe("en");
  });

  it("updates live trust, reconnect, and close consumers without remounting", async () => {
    const { result } = renderHook(
      () => {
        const mountId = React.useRef(Symbol("policy-consumer")).current;
        const { settings } = useSettings();
        return {
          mountId,
          trust: getEffectiveTrustPolicy(undefined, settings.sshTrustPolicy),
          reconnect: resolveSshReconnectPolicy(settings),
          confirmCloseActiveTab: settings.confirmCloseActiveTab,
          warnOnDetachClose: settings.warnOnDetachClose,
        };
      },
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(eventMocks.listener).toBeTypeOf("function");
      expect(result.current.trust).toBe(loadedSettings.sshTrustPolicy);
    });
    const initialMountId = result.current.mountId;
    const remote = new SettingsSyncRevisionTracker("writer-detached", () => 10);
    const payload = remote.next("detached-1", {
      ...loadedSettings,
      sshTrustPolicy: "strict",
      autoReconnectOnDisconnect: false,
      confirmCloseActiveTab: false,
      warnOnDetachClose: false,
    });

    await dispatchSettingsSync(payload);
    await vi.waitFor(() => expect(result.current.trust).toBe("strict"));

    expect(result.current.mountId).toBe(initialMountId);
    expect(result.current.reconnect.enabled).toBe(false);
    expect(result.current.confirmCloseActiveTab).toBe(false);
    expect(result.current.warnOnDetachClose).toBe(false);
  });

  it("strips malicious sync secrets before manager, React, and DOM consumers", async () => {
    const mgr = SettingsManager.getInstance();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await vi.waitFor(() => {
      expect(eventMocks.listener).toBeTypeOf("function");
      expect(result.current.settings.language).toBe("en");
    });
    vi.mocked(mgr.saveSettings).mockClear();
    eventMocks.emit.mockClear();
    const domUpdates: unknown[] = [];
    const onDomUpdate = (event: Event) => {
      domUpdates.push((event as CustomEvent).detail);
    };
    window.addEventListener("settings-updated", onDomUpdate);
    const remote = new SettingsSyncRevisionTracker(
      "writer-malicious",
      () => 20,
    );
    const payload = remote.next("detached-evil", {
      ...loadedSettings,
      language: "fr",
      restApi: {
        ...loadedSettings.restApi,
        apiKey: "must-not-sync",
        jwtSecret: "must-not-sync",
      },
    } as typeof loadedSettings);

    await dispatchSettingsSync(payload);
    await vi.waitFor(() => expect(result.current.settings.language).toBe("fr"));
    window.removeEventListener("settings-updated", onDomUpdate);

    expect(mgr.getSettings().restApi).not.toHaveProperty("apiKey");
    expect(mgr.getSettings().restApi).not.toHaveProperty("jwtSecret");
    const detail = domUpdates[domUpdates.length - 1] as typeof loadedSettings;
    expect(detail.restApi).not.toHaveProperty("apiKey");
    expect(detail.restApi).not.toHaveProperty("jwtSecret");
    expect(mgr.saveSettings).not.toHaveBeenCalled();
    expect(eventMocks.emit).not.toHaveBeenCalled();
  });

  it("cleans up the cross-window listener", async () => {
    const view = renderHook(() => useSettings(), { wrapper });
    await vi.waitFor(() => expect(eventMocks.listener).toBeTypeOf("function"));

    view.unmount();

    expect(eventMocks.unlisten).toHaveBeenCalledOnce();
  });

  it("throws when used without provider", () => {
    expect(() => {
      renderHook(() => useSettings());
    }).toThrow("useSettings must be used within a SettingsProvider");
  });

  it("exposes updateSettings and reloadSettings functions", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(typeof result.current.updateSettings).toBe("function");
    expect(typeof result.current.reloadSettings).toBe("function");
  });
});
