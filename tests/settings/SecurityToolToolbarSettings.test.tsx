import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutSettings } from "../../src/components/SettingsDialog/sections/LayoutSettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import {
  DEFAULT_VALUES,
  TAB_DEFAULTS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
beforeEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});
afterEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});
describe("security tool visibility", () => {
  it.each([
    ["showCredentialVaultIcon", "Database Credential Vault", "topbar vault"],
    ["showHardwareKeysIcon", "Hardware Keys", "topbar yubikey"],
  ] as const)(
    "keeps %s toggle/default/reset/search consistent",
    (key, label, query) => {
      const updateSettings = vi.fn();
      render(
        <LayoutSettings
          settings={defaultSettings}
          updateSettings={updateSettings}
        />,
      );
      const toggle = screen.getByRole("checkbox", {
        name: new RegExp(`^${label}`),
      });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      expect(updateSettings).toHaveBeenCalledWith({ [key]: false });
      expect(DEFAULT_VALUES[key]).toBe(true);
      expect(TAB_DEFAULTS.layout).toContain(key);
      expect(
        matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map(
          (entry) => entry.key,
        ),
      ).toContain(key);
    },
  );
  it("migrates missing flags and preserves explicit false through JSON import, durable save and reload", async () => {
    const manager = SettingsManager.getInstance();
    const initial = await manager.loadSettings();
    expect(initial.showCredentialVaultIcon).toBe(true);
    expect(initial.showHardwareKeysIcon).toBe(true);
    const imported = JSON.parse(
      JSON.stringify({
        ...initial,
        showCredentialVaultIcon: false,
        showHardwareKeysIcon: false,
      }),
    );
    await manager.saveSettings(imported);
    SettingsManager.resetInstance();
    const restored = await SettingsManager.getInstance().loadSettings();
    expect(restored.showCredentialVaultIcon).toBe(false);
    expect(restored.showHardwareKeysIcon).toBe(false);
    expect(restored.theme).toBe(initial.theme);
  });
});
