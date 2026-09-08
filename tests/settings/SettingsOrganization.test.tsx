import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SettingsTabContent } from "../../src/components/SettingsDialog";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { useSettingsDialog } from "../../src/hooks/settings/useSettingsDialog";
import {
  DEFAULT_VALUES,
  TAB_DEFAULTS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  settingsManager: {
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    applyInMemory: vi.fn(),
  },
  themeManager: { applyTheme: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("../../src/contexts/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/contexts/SettingsContext")
  >()),
  useSettings: () => ({
    settings: customized,
    updateSettings: vi.fn(),
    reloadSettings: vi.fn(),
  }),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => mocks.settingsManager },
}));
vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: { getInstance: () => mocks.themeManager },
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en-US", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const warnings = [
  "warnOnClose",
  "warnOnDetachClose",
  "warnOnExit",
  "confirmMainAppClose",
] as const;
const customized = {
  ...defaultSettings,
  warnOnClose: false,
  warnOnDetachClose: false,
  warnOnExit: false,
  confirmMainAppClose: true,
  allowSshExternalLinks: true,
};

const originalScrollTo = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollTo",
);
beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (entries: { isIntersecting: boolean }[]) => void,
      ) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(Element.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(Element.prototype, "scrollTo");
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsManager.loadSettings.mockResolvedValue(customized);
  mocks.settingsManager.saveSettings.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "telegram_list_bots" ? [] : null,
  );
});

describe("Settings organization", () => {
  it("moves warnings into Behavior with saved values and without initializing Telegram", async () => {
    const view = render(
      <SettingsTabContent onClose={vi.fn()} initialTab="general" />,
    );
    await screen.findByTestId("settings-tab-bots");
    for (const key of warnings)
      expect(
        view.container.querySelector(`[data-setting-key="${key}"]`),
      ).toBeNull();
    expect(
      view.container.querySelector('[data-setting-key="telegram.bots"]'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("settings-tab-behavior"));
    for (const key of warnings) {
      const input = view.container.querySelector<HTMLInputElement>(
        `[data-setting-key="${key}"] input`,
      );
      expect(input).not.toBeNull();
      expect(input?.checked).toBe(customized[key]);
    }
    expect(
      view.container.querySelector('[data-setting-key="telegram.bots"]'),
    ).toBeNull();
    expect(
      mocks.invoke.mock.calls.some(([command]) =>
        String(command).startsWith("telegram_"),
      ),
    ).toBe(false);
    const closeToggle = view.container.querySelector(
      '[data-setting-key="warnOnClose"] input',
    );
    if (!closeToggle) throw new Error("Missing moved close toggle");
    fireEvent.click(closeToggle);
    // The established settings autosave debounce is 1500ms.
    await waitFor(
      () =>
        expect(mocks.settingsManager.saveSettings).toHaveBeenCalledWith(
          expect.objectContaining({ warnOnClose: true }),
          expect.anything(),
        ),
      { timeout: 2500 },
    );
  });

  it("deep-links to the real Bots panel, retains its controls, and offers no app-settings reset", async () => {
    const view = render(
      <SettingsTabContent onClose={vi.fn()} initialTab="bots" />,
    );
    const trigger = await screen.findByRole("button", {
      name: "Telegram bots",
    });
    expect(screen.getByTestId("settings-tab-bots")).toHaveTextContent("Bots");
    expect(
      view.container.querySelector('[data-setting-key="telegram.bots"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(
      await screen.findByPlaceholderText("alerts-bot"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("telegram_list_bots"),
    );
  });

  it.each([
    ["telegram", "bots", "telegram.bots"],
    ["warn on exit", "behavior", "warnOnExit"],
    ["confirm main app close", "behavior", "confirmMainAppClose"],
  ])("navigates search %s to its real destination", async (query, tab, key) => {
    const view = render(
      <SettingsTabContent onClose={vi.fn()} initialTab="general" />,
    );
    fireEvent.change(await screen.findByTestId("settings-search"), {
      target: { value: query },
    });
    fireEvent.click(await screen.findByTestId(`settings-tab-${tab}`));
    const result = view.container.querySelector(
      `[data-setting-result-key="${key}"]`,
    );
    expect(result).not.toBeNull();
    if (result) fireEvent.click(result);
    expect(
      view.container.querySelector(`[data-setting-key="${key}"]`),
    ).not.toBeNull();
  });

  it("moves all four warning search/reset owners without changing defaults", () => {
    for (const key of warnings) {
      expect(TAB_DEFAULTS.general).not.toContain(key);
      expect(TAB_DEFAULTS.behavior).toContain(key);
      expect(DEFAULT_VALUES[key]).toBe(defaultSettings[key]);
      expect(
        SETTINGS_SEARCH_INDEX.filter((entry) => entry.key === key),
      ).toEqual([expect.objectContaining({ section: "behavior" })]);
    }
    expect(TAB_DEFAULTS.bots).toEqual([]);
    for (const query of ["bot token", "webhook", "broadcast"]) {
      expect(matchSettingsEntries(SETTINGS_SEARCH_INDEX, query)).toContainEqual(
        expect.objectContaining({ key: "telegram.bots", section: "bots" }),
      );
    }
  });

  it.each(["general", "behavior", "security"] as const)(
    "resets only the %s-owned warning/link policies",
    async (tab) => {
      const { result } = renderHook(() =>
        useSettingsDialog(true, vi.fn(), tab),
      );
      await waitFor(() => expect(result.current.settings).not.toBeNull());
      await act(async () => result.current.confirmReset());
      for (const key of warnings) {
        expect(result.current.settings?.[key]).toBe(
          tab === "behavior" ? defaultSettings[key] : customized[key],
        );
      }
      expect(result.current.settings?.allowSshExternalLinks).toBe(
        tab === "security" ? false : true,
      );
      expect(mocks.settingsManager.saveSettings).toHaveBeenCalled();
    },
  );
});
