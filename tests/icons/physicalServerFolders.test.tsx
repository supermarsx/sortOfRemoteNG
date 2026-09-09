import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MailPlus } from "lucide-react";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import {
  PHYSICAL_SERVICE_FOLDER_ICONS,
  PHYSICAL_SERVER_ICONS,
} from "../../src/utils/icons/catalog/physicalServerFolders";
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

function svg(
  icon: (typeof FOLDER_ICONS)[number]["icon"],
  size = 24,
  color = "#172033",
) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(icon, { size, color })),
    "image/svg+xml",
  ).documentElement;
}

describe("physical-server and MTA-relay choices", () => {
  it("adds exactly three stable keys in their existing categories without replacing prior choices", () => {
    expect(PHYSICAL_SERVICE_FOLDER_ICONS.map(({ key }) => key)).toEqual([
      "folder-mta-relay",
      "folder-bare-metal",
    ]);
    expect(PHYSICAL_SERVER_ICONS.map(({ key }) => key)).toEqual([
      "bare-metal-server",
    ]);
    for (const entry of [
      ...PHYSICAL_SERVICE_FOLDER_ICONS,
      ...PHYSICAL_SERVER_ICONS,
    ])
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
    expect(
      PHYSICAL_SERVICE_FOLDER_ICONS.every(
        ({ category }) => category === "folders",
      ),
    ).toBe(true);
    expect(PHYSICAL_SERVER_ICONS[0].category).toBe("servers-devices");
    for (const key of [
      "server",
      "server-rack",
      "server-tower",
      "server-blade",
      "folder-server",
      "folder-mail-server",
      "mta-server",
    ])
      expect(getConnectionIconDefinition(key), key).toBeDefined();
    expect(new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
  });

  it.each([
    ["mta", "folder-mta-relay"],
    ["mail relay", "folder-mta-relay"],
    ["smtp relay", "folder-mta-relay"],
    ["bare metal", "bare-metal-server"],
    ["bare-metal", "bare-metal-server"],
    ["physical server", "bare-metal-server"],
    ["bare metal folder", "folder-bare-metal"],
    ["bare-metal folder", "folder-bare-metal"],
    ["physical server folder", "folder-bare-metal"],
  ])("finds %s as %s", (query, key) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it.each(PHYSICAL_SERVICE_FOLDER_ICONS)(
    "keeps $key closed/open badges identical at the bottom-right",
    (entry) => {
      const saved = JSON.parse(
        JSON.stringify({ protocol: "ssh", isGroup: true, icon: entry.key }),
      );
      const resolved = resolveEffectiveConnectionIcon(saved);
      expect(resolved.key).toBe(entry.key);
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS[entry.key],
      );
      for (const size of [16, 24, 32, 96])
        for (const color of ["#f8fafc", "#172033"]) {
          const closed = svg(entry.icon, size, color),
            open = svg(FOLDER_OPEN_ICONS[entry.key], size, color);
          expect(closed.innerHTML).not.toBe(open.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            open.querySelector("svg")!.innerHTML,
          );
          for (const root of [closed, open]) {
            expect(root.getAttribute("width")).toBe(String(size));
            const badge = root.querySelector("svg")!;
            expect(
              ["x", "y", "width", "height"].map((name) =>
                badge.getAttribute(name),
              ),
            ).toEqual(["12", "12", "11", "11"]);
            expect(badge.getAttribute("stroke")).toBe(color);
            expect(
              root.querySelector(
                "script,foreignObject,image,text,use,mask,filter",
              ),
            ).toBeNull();
          }
        }
    },
  );

  it("reuses the established mail-relay symbol and distinguishes physical hardware from generic/virtual servers", () => {
    expect(
      svg(PHYSICAL_SERVICE_FOLDER_ICONS[0].icon).querySelector("svg")!
        .innerHTML,
    ).toBe(svg(MailPlus).innerHTML);
    const physical = svg(PHYSICAL_SERVER_ICONS[0].icon);
    expect(physical.querySelector("svg")).toBeNull();
    for (const key of [
      "server",
      "server-rack",
      "server-tower",
      "server-blade",
      "folder-server",
    ])
      expect(physical.innerHTML).not.toBe(
        svg(getConnectionIconDefinition(key)!.icon).innerHTML,
      );
    expect(
      svg(PHYSICAL_SERVICE_FOLDER_ICONS[1].icon).querySelector("svg")!
        .innerHTML,
    ).toBe(physical.innerHTML);
  });

  it("exports and strictly reimports all three passive SVGs", () => {
    publishIconLibrary(undefined, { ready: true });
    for (const entry of [
      ...PHYSICAL_SERVICE_FOLDER_ICONS,
      ...PHYSICAL_SERVER_ICONS,
    ]) {
      expect(() => parsePassiveSvg(exportLibrarySvg(entry.key))).not.toThrow();
    }
  });
});
