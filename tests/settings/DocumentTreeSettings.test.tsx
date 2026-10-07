import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import type { GlobalSettings } from "../../src/types/settings/settings";

const persistence = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => async (command: string, args?: { patch: object }) => {
    if (command === "read_app_settings")
      return structuredClone(persistence.stored);
    if (command === "write_app_settings")
      Object.assign(persistence.stored, args?.patch);
    return null;
  },
}));
beforeEach(() => {
  persistence.stored = {};
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});
afterEach(() => {
  cleanup();
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});
const flags = [
  "showDocumentsInConnectionTree",
  "searchDocumentContents",
] as const;
describe("document tree and full-text opt-ins", () => {
  it.each([
    [
      "showDocumentsInConnectionTree",
      "Show documents in connection tree",
      "tree documents",
    ],
    ["searchDocumentContents", "Search document contents", "full-text"],
  ] as const)(
    "keeps %s off by default, registered for reset, searchable and editable",
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
      expect(toggle).not.toBeChecked();
      expect(defaultSettings[key]).toBe(false);
      expect(DEFAULT_VALUES[key]).toBe(false);
      expect(TAB_DEFAULTS.layout).toContain(key);
      expect(
        matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map(
          (entry) => entry.key,
        ),
      ).toContain(key);
      fireEvent.click(toggle);
      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ [key]: true });
    },
  );
  it("preserves explicit opt-ins and opt-outs through durable save and reload", async () => {
    let manager = SettingsManager.getInstance();
    const initial = await manager.loadSettings();
    for (const key of flags) expect(initial[key]).toBe(false);
    for (const value of [true, false]) {
      await manager.saveSettings({
        showDocumentsInConnectionTree: value,
        searchDocumentContents: value,
      });
      SettingsManager.resetInstance();
      manager = SettingsManager.getInstance();
      const restored = await manager.loadSettings();
      for (const key of flags) expect(restored[key]).toBe(value);
      expect(restored.theme).toBe(initial.theme);
    }
  });
  it.each(["true", "false", 1, 0, null, undefined])(
    "does not enable opt-ins for malformed imported value %s",
    async (value) => {
      const manager = SettingsManager.getInstance();
      await manager.loadSettings();
      const patch = {
        showDocumentsInConnectionTree: value,
        searchDocumentContents: value,
      } as unknown as Partial<GlobalSettings>;
      await manager.saveSettings(patch);
      for (const key of flags) expect(manager.getSettings()[key]).toBe(false);
      SettingsManager.resetInstance();
      const restored = await SettingsManager.getInstance().loadSettings();
      for (const key of flags) expect(restored[key]).toBe(false);
    },
  );
  it.each([true, false, "true", "false", 1, 0, null, undefined])(
    "normalizes raw stored value %s using strict true on load",
    async (value) => {
      persistence.stored = {
        showDocumentsInConnectionTree: value,
        searchDocumentContents: value,
      };
      const loaded = await SettingsManager.getInstance().loadSettings();
      for (const key of flags) expect(loaded[key]).toBe(value === true);
    },
  );
});
