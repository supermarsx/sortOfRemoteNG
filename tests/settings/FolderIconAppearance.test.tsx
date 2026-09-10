import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectionTreeRow } from "../../src/components/connection/connectionTree/ConnectionTreeItem";
import ThemeSettings from "../../src/components/SettingsDialog/sections/ThemeSettings";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { DEFAULT_VALUES } from "../../src/components/SettingsDialog/settingsConstants";
import {
  normalizeFolderIconColor,
  normalizeFolderIconMode,
  resolveFolderIconColor,
} from "../../src/utils/settings/folderIconColor";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { THEME_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/theme";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";
import type { Connection } from "../../src/types/connection/connection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
const folder: Connection = {
  id: "folder",
  name: "Folder",
  hostname: "",
  protocol: "ssh",
  port: 22,
  isGroup: true,
  favorite: true,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
};
const props = {
  connection: folder,
  level: 0,
  dispatch: vi.fn(),
  isSelected: false,
  isMultiSelected: false,
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onCopyHostname: vi.fn(),
  onRename: vi.fn(),
  onExport: vi.fn(),
  onConnectWithOptions: vi.fn(),
  onConnectWithoutCredentials: vi.fn(),
  onExecuteScripts: vi.fn(),
  onDuplicate: vi.fn(),
  enableReorder: false,
  isDragging: false,
  isDragOver: false,
  dropPosition: null,
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDragEnd: vi.fn(),
  onDrop: vi.fn(),
};

describe("folder icon appearance", () => {
  it("keeps old defaults and rejects malformed mode or injected CSS", () => {
    expect(defaultSettings.folderIconColorMode).toBe("default");
    expect(DEFAULT_VALUES.folderIconColorMode).toBe("default");
    expect(resolveFolderIconColor({})).toBe("var(--color-warning)");
    for (const value of [null, {}, "red", "ACCENT"])
      expect(normalizeFolderIconMode(value)).toBe("default");
    for (const value of [
      null,
      {},
      "red",
      "#abc",
      "url(https://example.com)",
      "#ffffff;opacity:0",
    ])
      expect(normalizeFolderIconColor(value)).toBe("#f59e0b");
    expect(normalizeFolderIconColor("#AbC123")).toBe("#abc123");
  });

  it.each([false, true])(
    "tints the actual open/closed folder icon (%s) without tinting its favorite star",
    (expanded) => {
      const { container, rerender } = render(
        <ConnectionTreeRow
          {...props}
          expanded={expanded}
          folderIconColor={resolveFolderIconColor({
            folderIconColorMode: "custom",
            folderIconCustomColor: "#123456",
          })}
        />,
      );
      const icon = container.querySelector("svg[aria-label]") as SVGElement;
      expect(icon.style.color).toBe("rgb(18, 52, 86)");
      expect(container.querySelector("svg.lucide-star")).toHaveClass(
        "text-warning",
      );
      rerender(
        <ConnectionTreeRow
          {...props}
          expanded={expanded}
          folderIconColor={resolveFolderIconColor({
            folderIconColorMode: "default",
          })}
        />,
      );
      expect(icon.style.color).toBe("var(--color-warning)");
    },
  );

  it("uses a live theme accent reference, not a stale copied accent value", () => {
    const { container } = render(
      <ConnectionTreeRow
        {...props}
        folderIconColor={resolveFolderIconColor({
          folderIconColorMode: "accent",
        })}
      />,
    );
    const icon = container.querySelector("svg[aria-label]") as SVGElement;
    const theme = ThemeManager.getInstance();
    theme.applyThemeFromSync("dark", "blue", "#112233");
    expect(icon.style.color).toBe("var(--color-primary)");
    expect(document.body.style.getPropertyValue("--color-primary")).toBe(
      "#112233",
    );
    theme.applyThemeFromSync("light", "green", "#445566");
    expect(icon.style.color).toBe("var(--color-primary)");
    expect(document.body.style.getPropertyValue("--color-primary")).toBe(
      "#445566",
    );
  });

  it("does not override a connection status icon", () => {
    const { container } = render(
      <ConnectionTreeRow
        {...props}
        connection={{ ...folder, isGroup: false }}
        folderIconColor="#123456"
        activeSession={{ status: "connected" } as any}
      />,
    );
    const icon = container.querySelector("svg[aria-label]") as SVGElement;
    expect(icon).toHaveClass("text-success");
    expect(icon.style.color).toBe("");
  });

  it("exposes a themed mode selector and a labeled native custom color picker", () => {
    const updateSettings = vi.fn();
    const { container, rerender } = render(
      <ThemeSettings
        settings={defaultSettings}
        updateSettings={updateSettings}
      />,
    );
    const row = container.querySelector(
      '[data-setting-key="folderIconColorMode"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("combobox"));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Follow accent color" }),
    );
    expect(updateSettings).toHaveBeenCalledWith({
      folderIconColorMode: "accent",
    });
    expect(screen.queryByLabelText("Custom folder icon color")).toBeNull();
    rerender(
      <ThemeSettings
        settings={{
          ...defaultSettings,
          folderIconColorMode: "custom",
          folderIconCustomColor: "#123456",
        }}
        updateSettings={updateSettings}
      />,
    );
    const picker = screen.getByLabelText("Custom folder icon color");
    expect(picker).toHaveAttribute("type", "color");
    fireEvent.change(picker, { target: { value: "#abcdef" } });
    expect(updateSettings).toHaveBeenCalledWith({
      folderIconCustomColor: "#abcdef",
    });
  });

  it("is discoverable by folder highlight and custom color searches", () => {
    expect(
      matchSettingsEntries(THEME_SEARCH_ENTRIES, "folder highlight").map(
        (entry) => entry.key,
      ),
    ).toContain("folderIconColorMode");
    expect(
      matchSettingsEntries(THEME_SEARCH_ENTRIES, "custom folder colour").map(
        (entry) => entry.key,
      ),
    ).toContain("folderIconCustomColor");
  });
});
