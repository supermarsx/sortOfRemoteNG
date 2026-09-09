import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Folder } from "lucide-react";
import { COLLECTION_FOLDER_ICONS } from "../../src/utils/icons/catalog/folderCollectionVariants";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

const REQUESTED_KEYS = [
  "folder-datacenter",
  "folder-warehouse",
  "folder-rack",
  "folder-computers",
  "folder-personal-travel",
  "folder-personal-finance",
  "folder-personal-photos",
  "folder-personal-music",
  "folder-personal-gaming",
  "folder-company-headquarters",
  "folder-company-finance",
  "folder-company-people",
  "folder-company-logistics",
  "folder-company-legal",
  "folder-lab",
  "folder-education",
  "folder-monitoring",
  "folder-media",
  "folder-cloud",
] as const;

function svg(
  Icon: (typeof FOLDER_ICONS)[number]["icon"],
  size = 16,
  color = "#fafafa",
) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(Icon, { size, color })),
    "image/svg+xml",
  ).documentElement;
}

describe("collection folder variants", () => {
  it("adds exactly 19 paired choices without duplicating the existing generic folder", () => {
    expect(COLLECTION_FOLDER_ICONS.map(({ key }) => key)).toEqual(
      REQUESTED_KEYS,
    );
    expect(FOLDER_ICONS).toHaveLength(82);
    expect(Object.keys(FOLDER_OPEN_ICONS).sort()).toEqual(
      FOLDER_ICONS.map(({ key }) => key).sort(),
    );
    expect(
      COLLECTION_FOLDER_ICONS.filter(({ key }) =>
        key.startsWith("folder-personal-"),
      ),
    ).toHaveLength(5);
    expect(
      COLLECTION_FOLDER_ICONS.filter(({ key }) =>
        key.startsWith("folder-company-"),
      ),
    ).toHaveLength(5);
    expect(getConnectionIconDefinition("folder")?.icon).toBe(Folder);
    expect(
      filterConnectionIcons("generic folder").map(({ key }) => key),
    ).toContain("folder");
    expect(new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
  });

  it.each(COLLECTION_FOLDER_ICONS)(
    "keeps $key searchable, persistable and paired at the bottom-right",
    (entry) => {
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
      expect(
        filterConnectionIcons(entry.label).map(({ key }) => key),
      ).toContain(entry.key);
      expect(
        filterConnectionIcons(entry.key.replace(/-/g, " ")).map(
          ({ key }) => key,
        ),
      ).toContain(entry.key);
      const saved = JSON.parse(
        JSON.stringify({ protocol: "ssh", isGroup: true, icon: entry.key }),
      );
      const resolved = resolveEffectiveConnectionIcon(saved);
      expect(resolved.key).toBe(entry.key);
      expect(getExpandedFolderIcon(resolved, false)).toBe(entry.icon);
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS[entry.key],
      );
      for (const size of [16, 24, 32, 96]) {
        for (const color of ["#fafafa", "#101827"]) {
          const closed = svg(entry.icon, size, color);
          const opened = svg(FOLDER_OPEN_ICONS[entry.key], size, color);
          expect(closed.innerHTML).not.toBe(opened.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            opened.querySelector("svg")!.innerHTML,
          );
          for (const root of [closed, opened]) {
            expect(root.getAttribute("width")).toBe(String(size));
            expect(
              root.querySelector("script, foreignObject, use, image, text"),
            ).toBeNull();
            const badge = root.querySelector("svg")!;
            expect(badge.getAttribute("stroke")).toBe(color);
            expect(
              ["x", "y", "width", "height"].map((name) =>
                badge.getAttribute(name),
              ),
            ).toEqual(["12", "12", "11", "11"]);
          }
        }
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(entry.key))).not.toThrow();
    },
  );

  it("keeps every new emblem geometrically distinct from the existing folders", () => {
    const geometries = FOLDER_ICONS.filter(
      ({ key }) => key !== "folder" && key !== "folder-open",
    ).map(({ icon }) =>
      svg(icon)
        .querySelector("svg")!
        .innerHTML.replace(/ class="[^"]*"/g, ""),
    );
    expect(new Set(geometries).size).toBe(geometries.length);
  });
});
