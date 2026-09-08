import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TerminalLinksSection from "../../src/components/SettingsDialog/sections/security/TerminalLinksSection";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

describe("SSH link security setting", () => {
  it("defaults off and updates only the application-wide security key", () => {
    const updateSettings = vi.fn();
    expect(defaultSettings.allowSshExternalLinks).toBe(false);
    const view = render(
      <TerminalLinksSection
        settings={defaultSettings}
        updateSettings={updateSettings}
      />,
    );
    const toggle = screen.getByRole("checkbox");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({
      allowSshExternalLinks: true,
    });
    view.rerender(
      <TerminalLinksSection
        settings={{ ...defaultSettings, allowSshExternalLinks: true }}
        updateSettings={updateSettings}
      />,
    );
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenLastCalledWith({
      allowSshExternalLinks: false,
    });
    expect(screen.getByText(/off by default/i)).toHaveTextContent(/OSC8/);
  });

  it.each(["ssh links", "terminal hyperlinks", "OSC8", "clickable urls"])(
    "is discoverable with %s",
    (query) => {
      expect(matchSettingsEntries(SETTINGS_SEARCH_INDEX, query)).toContainEqual(
        expect.objectContaining({
          key: "allowSshExternalLinks",
          section: "security",
        }),
      );
    },
  );
});
