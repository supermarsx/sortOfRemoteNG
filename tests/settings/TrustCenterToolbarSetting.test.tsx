import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
afterEach(cleanup);
describe("Trust Center toolbar visibility setting", () => {
  it("uses the real Layout toggle and keeps its default and reset ownership aligned", () => {
    const updateSettings = vi.fn();
    render(
      <LayoutSettings
        settings={defaultSettings}
        updateSettings={updateSettings}
      />,
    );
    const toggle = screen.getByRole("checkbox", { name: /^Trust Center/ });
    expect(toggle).toBeChecked();
    expect(toggle.closest("[data-setting-key]")).toHaveAttribute(
      "data-setting-key",
      "showTrustCenterIcon",
    );
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({ showTrustCenterIcon: false });
    expect(DEFAULT_VALUES.showTrustCenterIcon).toBe(true);
    expect(TAB_DEFAULTS.layout).toContain("showTrustCenterIcon");
  });
  it("finds the icon setting by certificate manager, toolbar and trust-center queries", () => {
    for (const query of [
      "trust center button",
      "certificate manager icon",
      "topbar trust",
    ]) {
      expect(
        matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map(
          (entry) => entry.key,
        ),
      ).toContain("showTrustCenterIcon");
    }
    expect(
      SETTINGS_SEARCH_INDEX.find((entry) => entry.key === "showTrustCenterIcon")
        ?.section,
    ).toBe("layout");
  });
});
