import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";

const mocks = vi.hoisted(() => {
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  return {
    applyInMemory: vi.fn(),
    benchmarkKeyDerivation: vi.fn(async () => 200_000),
    saveSettings: vi.fn(
      async (
        _settings: Partial<GlobalSettings>,
        _options?: { silent?: boolean },
      ): Promise<void> => undefined,
    ),
    applyTheme: vi.fn(),
    changeLanguage: vi.fn(async () => undefined),
    loadLanguage: vi.fn(async () => undefined),
    toastSuccess,
    toastError,
    toast: { success: toastSuccess, error: toastError },
    rawListen: vi.fn(),
  };
});

let contextSettings: GlobalSettings;

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: contextSettings }),
}));

vi.mock("../../src/utils/settings/settingsManager", () => {
  const instance = {
    applyInMemory: mocks.applyInMemory,
    benchmarkKeyDerivation: mocks.benchmarkKeyDerivation,
    saveSettings: mocks.saveSettings,
  };
  return { SettingsManager: { getInstance: () => instance } };
});

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({ applyTheme: mocks.applyTheme }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US", changeLanguage: mocks.changeLanguage },
  }),
}));

vi.mock("../../src/i18n", () => ({
  loadLanguage: mocks.loadLanguage,
  resolveSupportedLanguage: (language: string) => language,
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: mocks.toast,
  }),
}));

vi.mock("../../src/components/SettingsDialog/useSettingsSearch", () => ({
  useSettingsSearch: () => [],
}));

vi.mock("../../src/components/SettingsDialog/useSettingHighlight", () => ({
  useSettingHighlight: () => undefined,
}));

vi.mock("../../src/components/SettingsDialog/settingsConstants", () => ({
  TAB_DEFAULTS: {},
  DEFAULT_VALUES: {},
}));

// The dialog must not import or register this raw transport. SettingsProvider
// owns it and exposes only validated, ordered snapshots through context.
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.rawListen,
}));

import { useSettingsDialog } from "../../src/hooks/settings/useSettingsDialog";

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    theme: "dark",
    colorScheme: "default",
    useCustomAccent: false,
    primaryAccentColor: "#336699",
    autoDetectOsLanguage: false,
    language: "en-US",
    rtlLayout: false,
    backgroundGlowEnabled: false,
    animationDuration: 200,
    benchmarkTimeSeconds: 1,
    keyDerivationIterations: 100_000,
    settingsDialog: {
      showSaveButton: false,
      confirmBeforeReset: true,
      autoSave: true,
    },
    globalProxy: {
      enabled: false,
      type: "http",
      host: "",
      port: 8080,
      username: "",
      password: "",
      bypassList: [],
    },
    ...overrides,
  } as unknown as GlobalSettings;
}

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...renderHook(
      ({ isOpen }: { isOpen: boolean }) => useSettingsDialog(isOpen, onClose),
      { initialProps: { isOpen: true } },
    ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.benchmarkKeyDerivation.mockResolvedValue(200_000);
  mocks.changeLanguage.mockResolvedValue(undefined);
  mocks.loadLanguage.mockResolvedValue(undefined);
  mocks.toast = {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  };
  contextSettings = makeSettings();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSettingsDialog validated settings sync", () => {
  it("adopts a newer validated context snapshot without persistence or echo", () => {
    const { result, rerender, unmount } = renderDialog();
    expect(result.current.settings?.theme).toBe("dark");

    contextSettings = makeSettings({
      language: "fr-FR",
      animationDuration: 190,
    });
    act(() => rerender({ isOpen: true }));

    expect(result.current.settings?.language).toBe("fr-FR");
    expect(result.current.settings?.animationDuration).toBe(190);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(mocks.rawListen).not.toHaveBeenCalled();
    unmount();
  });

  it("has no raw event listener through which malformed or stale envelopes can bypass validation", () => {
    const { result, rerender, unmount } = renderDialog();

    // Without a raw callback, unvalidated transport payloads have no dialog
    // entry point. Only a provider-approved context change can alter state.
    expect(mocks.rawListen).not.toHaveBeenCalled();
    act(() => rerender({ isOpen: true }));
    expect(result.current.settings).toEqual(contextSettings);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    unmount();
  });

  it("rebases a pending local patch over newer remote fields and persists only that patch", async () => {
    const { result, rerender, unmount } = renderDialog();

    await act(async () => {
      await result.current.updateSettings({ theme: "light" });
    });

    contextSettings = makeSettings({
      language: "fr-FR",
      animationDuration: 210,
    });
    act(() => rerender({ isOpen: true }));

    expect(result.current.settings?.theme).toBe("light");
    expect(result.current.settings?.language).toBe("fr-FR");
    expect(result.current.settings?.animationDuration).toBe(210);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      { theme: "light" },
      { silent: true },
    );
    unmount();
  });

  it("keeps the debounce alive across rerenders and notifies through the latest toast", async () => {
    const { result, rerender, unmount } = renderDialog();

    await act(async () => {
      await result.current.updateSettings({ theme: "light" });
    });

    const latestSuccess = vi.fn();
    const latestError = vi.fn();
    mocks.toast = { success: latestSuccess, error: latestError };
    contextSettings = makeSettings({ animationDuration: 160 });
    act(() => rerender({ isOpen: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1499);
    });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      { theme: "light" },
      { silent: true },
    );
    expect(latestSuccess).toHaveBeenCalledWith(
      "settings.autoSaveSuccess",
      2000,
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(latestError).not.toHaveBeenCalled();
    unmount();
  });

  it("rebases in-flight and newer pending edits, then retries both after failure", async () => {
    let rejectFirstSave: ((error: Error) => void) | undefined;
    mocks.saveSettings
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstSave = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { result, rerender, unmount } = renderDialog();

    await act(async () => {
      await result.current.updateSettings({ theme: "light" });
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mocks.saveSettings).toHaveBeenNthCalledWith(
      1,
      { theme: "light" },
      { silent: true },
    );

    await act(async () => {
      await result.current.updateSettings({ language: "de-DE" });
    });
    contextSettings = makeSettings({
      language: "fr-FR",
      animationDuration: 220,
    });
    act(() => rerender({ isOpen: true }));

    expect(result.current.settings?.theme).toBe("light");
    expect(result.current.settings?.language).toBe("de-DE");
    expect(result.current.settings?.animationDuration).toBe(220);

    await act(async () => {
      rejectFirstSave?.(new Error("disk unavailable"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(mocks.saveSettings).toHaveBeenNthCalledWith(
      2,
      { theme: "light", language: "de-DE" },
      { silent: true },
    );
    expect(result.current.settings?.animationDuration).toBe(220);
    consoleError.mockRestore();
    unmount();
  });

  it("manual save drains a patch while auto-save is disabled and then closes", async () => {
    contextSettings = makeSettings({
      settingsDialog: {
        showSaveButton: true,
        confirmBeforeReset: true,
        autoSave: false,
      },
    });
    const { result, onClose, unmount } = renderDialog();

    await act(async () => {
      await result.current.updateSettings({ language: "de-DE" });
      await result.current.handleSave();
    });

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      { language: "de-DE" },
      { silent: false },
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("cancels the debounce timer and flushes the pending patch on unmount", async () => {
    const { result, unmount } = renderDialog();

    await act(async () => {
      await result.current.updateSettings({ animationDuration: 180 });
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      { animationDuration: 180 },
      { silent: true },
    );
    expect(mocks.rawListen).not.toHaveBeenCalled();
  });
});
