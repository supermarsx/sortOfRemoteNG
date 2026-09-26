import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import { SERVICE_COLLECTION_FOLDER_ICONS } from "../../src/utils/icons/catalog/serviceCollectionFolders";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { google, hpe } from "../../src/utils/icons/brand";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

const KEYS = [
  "folder-ilo",
  "folder-google-services",
  "folder-social-media",
  "folder-nas-storage",
] as const;

function svg(
  icon: (typeof FOLDER_ICONS)[number]["icon"],
  size = 24,
  color = "currentColor",
) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(icon, { size, color })),
    "image/svg+xml",
  ).documentElement;
}

describe("service collection folder pairs", () => {
  it("registers four distinct pairs and retains the prior NAS choice", () => {
    expect(SERVICE_COLLECTION_FOLDER_ICONS.map(({ key }) => key)).toEqual(KEYS);
    expect(getConnectionIconDefinition("folder-nas")).toBeDefined();
    const emblems = FOLDER_ICONS.filter(
      ({ key }) => key !== "folder" && key !== "folder-open",
    ).map(({ icon }) =>
      svg(icon)
        .querySelector("svg")!
        .innerHTML.replace(/ class="[^"]*"/g, ""),
    );
    expect(new Set(emblems).size).toBe(emblems.length);
    expect(
      svg(SERVICE_COLLECTION_FOLDER_ICONS[0].icon).querySelector("svg")!
        .innerHTML,
    ).toBe(svg(hpe).innerHTML);
    expect(
      svg(SERVICE_COLLECTION_FOLDER_ICONS[1].icon).querySelector("svg")!
        .innerHTML,
    ).toBe(svg(google).innerHTML);
  });

  it.each(SERVICE_COLLECTION_FOLDER_ICONS)(
    "renders matching, theme-aware states for $key and retains its saved selection",
    (entry) => {
      const resolved = resolveEffectiveConnectionIcon(
        JSON.parse(
          JSON.stringify({ protocol: "rdp", isGroup: true, icon: entry.key }),
        ),
      );
      expect(resolved).toMatchObject({
        key: entry.key,
        category: "folders",
        source: "override",
      });
      expect(getExpandedFolderIcon(resolved, false)).toBe(entry.icon);
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS[entry.key],
      );
      for (const size of [16, 24, 32]) {
        for (const color of ["#fafafa", "#101827"]) {
          const closed = svg(entry.icon, size, color);
          const opened = svg(FOLDER_OPEN_ICONS[entry.key], size, color);
          expect(closed.innerHTML).not.toBe(opened.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            opened.querySelector("svg")!.innerHTML,
          );
          for (const [root, role] of [
            [closed, "folder"],
            [opened, "folder-open"],
          ] as const) {
            expect(
              root.querySelector(`[data-role-frame="${role}"]`),
            ).not.toBeNull();
            expect(root.getAttribute("width")).toBe(String(size));
            expect(root.getAttribute("color")).toBe(color);
            expect(
              root.querySelector("script, image, text, foreignObject, use"),
            ).toBeNull();
            const badge = root.querySelector("svg")!;
            expect(
              ["x", "y", "width", "height"].map((name) =>
                badge.getAttribute(name),
              ),
            ).toEqual(["12", "12", "11", "11"]);
            expect(badge.getAttribute("stroke")).toBe(color);
          }
        }
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(entry.key))).not.toThrow();
    },
  );

  it.each([
    ["hpe ilo collections", "folder-ilo"],
    ["google services", "folder-google-services"],
    ["social media", "folder-social-media"],
    ["nas storage", "folder-nas-storage"],
  ])("finds and selects %s in the existing folder picker", (query, key) => {
    const onChange = vi.fn();
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
    render(
      <ConnectionIconPicker
        connection={{ protocol: "rdp", isGroup: true }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search folder icons" }),
      { target: { value: query } },
    );
    const options = within(
      screen.getByRole("listbox", { name: "Folders icons" }),
    );
    fireEvent.click(
      options.getByRole("option", { name: new RegExp(`\\(${key}\\)`) }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith(key);
  });
});
