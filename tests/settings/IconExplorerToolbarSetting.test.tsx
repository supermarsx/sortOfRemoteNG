import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayoutSettings } from "../../src/components/SettingsDialog/sections/LayoutSettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import {
  DEFAULT_VALUES,
  TAB_DEFAULTS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
describe("Icon Explorer toolbar preference", () => {
  it("uses the existing settings update path, starts enabled, and belongs to Layout reset", () => {
    const updateSettings = vi.fn();
    const { rerender } = render(
      <LayoutSettings
        settings={defaultSettings}
        updateSettings={updateSettings}
      />,
    );
    const toggle = screen.getByRole("checkbox", { name: /^Icon Explorer/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({
      showIconExplorerIcon: false,
    });
    rerender(
      <LayoutSettings
        settings={{ ...defaultSettings, showIconExplorerIcon: false }}
        updateSettings={updateSettings}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: /^Icon Explorer/ }),
    ).not.toBeChecked();
    expect(DEFAULT_VALUES.showIconExplorerIcon).toBe(true);
    expect(TAB_DEFAULTS.layout).toContain("showIconExplorerIcon");
  });
  it("is discoverable by explorer, library and toolbar queries", () => {
    for (const query of [
      "icon explorer button",
      "icon library shortcut",
      "topbar icons",
    ])
      expect(
        matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map(
          (entry) => entry.key,
        ),
      ).toContain("showIconExplorerIcon");
  });
});
