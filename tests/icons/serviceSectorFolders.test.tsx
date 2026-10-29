import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import {
  SERVICE_SECTOR_FOLDER_ICONS,
  SERVICE_SECTOR_FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/serviceSectorFolders";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

type Icon = (typeof FOLDER_ICONS)[number]["icon"];

const KEYS = ["folder-government", "folder-isp", "folder-shopping"] as const;

// Every query must find the folder through the picker's own search model.
const SEARCHES = {
  "folder-government": [
    "government",
    "gov",
    "govt",
    "public sector",
    "public administration",
    "civic",
    "municipal",
    "city hall",
    "council",
    "federal",
    "agency",
    "ministry",
    "governo",
    "gobierno",
    "gouvernement",
    "regierung",
  ],
  "folder-isp": [
    "isp",
    "isps",
    "internet service provider",
    "internet provider",
    "internet",
    "provider",
    "operator",
    "carrier",
    "telecom",
    "telco",
    "broadband",
    "fibre",
    "fiber",
    "operadora",
    "operadoras",
    "fornecedor de internet",
    "proveedor de internet",
  ],
  "folder-shopping": [
    "shopping",
    "shop",
    "shops",
    "store",
    "stores",
    "cart",
    "basket",
    "bag",
    "retail",
    "ecommerce",
    "e-commerce",
    "online shopping",
    "orders",
    "compras",
    "loja",
    "lojas",
    "tienda",
  ],
} as const;

// The nearest existing folder emblems a person could confuse them with.
const NEIGHBOURS = {
  "folder-government": [
    "folder-company-finance",
    "folder-company-legal",
    "folder-company-headquarters",
    "folder-building",
    "folder-company",
    "folder-education",
  ],
  "folder-isp": [
    "folder-tree",
    "folder-network-equipment",
    "folder-router",
    "folder-router-wired",
    "folder-router-mesh",
    "folder-cloud",
    "folder-providers",
    "folder-registrars",
    "folder-web",
    "folder-web-world",
    "folder-access-point",
    "folder-access-point-outdoor",
    "folder-telephony",
    "folder-analytics",
  ],
  "folder-shopping": [
    "folder-lock",
    "folder-archive",
    "folder-work",
    "folder-building",
    "folder-company",
    "folder-personal-home",
    "folder-accounting",
    "folder-vaults",
  ],
} as const;

function markup(icon: Icon, size = 16, color = "currentColor") {
  return renderToStaticMarkup(createElement(icon, { size, color }));
}

function svg(icon: Icon, size = 16, color = "currentColor") {
  return new DOMParser().parseFromString(
    markup(icon, size, color),
    "image/svg+xml",
  ).documentElement;
}

function emblem(icon: Icon) {
  return svg(icon)
    .querySelector("svg")!
    .innerHTML.replace(/ class="[^"]*"/g, "");
}

function entry(key: (typeof KEYS)[number]) {
  return SERVICE_SECTOR_FOLDER_ICONS.find((item) => item.key === key)!;
}

describe("Government, ISP and shopping folder icons", () => {
  it("adds exactly three stable folder choices, once each, with paired open states", () => {
    expect(SERVICE_SECTOR_FOLDER_ICONS.map(({ key }) => key)).toEqual(KEYS);
    expect(Object.keys(SERVICE_SECTOR_FOLDER_OPEN_ICONS).sort()).toEqual([
      ...KEYS,
    ]);
    for (const key of KEYS) {
      expect(FOLDER_ICONS.filter((item) => item.key === key)).toHaveLength(1);
      expect(
        CONNECTION_ICON_CATALOG.filter((item) => item.key === key),
      ).toHaveLength(1);
      expect(FOLDER_OPEN_ICONS[key]).toBe(
        SERVICE_SECTOR_FOLDER_OPEN_ICONS[key],
      );
      expect(getConnectionIconDefinition(key)?.category).toBe("folders");
    }
    expect(entry("folder-government").label).toBe("Government folder");
    expect(entry("folder-isp").label).toBe("ISPs folder");
    expect(entry("folder-shopping").label).toBe("Shopping folder");
    for (const item of SERVICE_SECTOR_FOLDER_ICONS) {
      expect(item.ariaLabel).toBe(`${item.label} icon`);
      expect(item.keywords).toEqual(
        expect.arrayContaining(["folder", "folders", "collection"]),
      );
      expect(new Set(item.keywords).size).toBe(item.keywords.length);
    }
  });

  it("records app-authored provenance and claims no brand", () => {
    for (const item of SERVICE_SECTOR_FOLDER_ICONS) {
      expect(item.description).toMatch(/^App-authored /);
      expect(item.description).toMatch(/not (a|any) (brand|vendor|operator)/);
    }
  });

  it.each(
    KEYS.flatMap((key) => SEARCHES[key].map((query) => [query, key] as const)),
  )("finds %s -> %s in the folder search", (query, key) => {
    expect(filterConnectionIcons(query).map((item) => item.key)).toContain(key);
  });

  it.each(KEYS.map((key) => [key, SEARCHES[key][0]] as const))(
    "selects %s from the folder picker",
    (key, query) => {
      const onChange = vi.fn();
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
      fireEvent.click(
        within(
          screen.getByRole("listbox", { name: "Folders icons" }),
        ).getByRole("option", { name: new RegExp(`\\(${key}\\)`) }),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith(key);
    },
  );

  it.each(KEYS)(
    "keeps %s theme-aware, passive and emblem-identical in both states",
    (key) => {
      const item = entry(key);
      const resolved = resolveEffectiveConnectionIcon(
        JSON.parse(
          JSON.stringify({ protocol: "ssh", isGroup: true, icon: key }),
        ),
      );
      expect(resolved).toMatchObject({ key, source: "override" });
      expect(getExpandedFolderIcon(resolved, false)).toBe(item.icon);
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS[key],
      );
      for (const size of [16, 20, 24, 32]) {
        for (const color of ["#f8fafc", "#172033"]) {
          const closed = svg(item.icon, size, color);
          const open = svg(FOLDER_OPEN_ICONS[key], size, color);
          expect(closed.innerHTML).not.toBe(open.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            open.querySelector("svg")!.innerHTML,
          );
          for (const [root, role] of [
            [closed, "folder"],
            [open, "folder-open"],
          ] as const) {
            expect(root.getAttribute("width")).toBe(String(size));
            expect(root.getAttribute("stroke")).toBe(color);
            expect(
              root.querySelector(`[data-role-frame="${role}"]`),
            ).not.toBeNull();
            const badge = root.querySelector("svg")!;
            expect(
              ["x", "y", "width", "height"].map((name) =>
                badge.getAttribute(name),
              ),
            ).toEqual(["12", "12", "11", "11"]);
            expect(badge.getAttribute("stroke")).toBe(color);
            expect(
              root.querySelector(
                "script, image, text, foreignObject, use, mask, filter, [fill]:not([fill='none'])",
              ),
            ).toBeNull();
          }
        }
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(key))).not.toThrow();
    },
  );

  it("keeps each emblem simple enough for the 7 px badge of a 16 px folder", () => {
    for (const item of SERVICE_SECTOR_FOLDER_ICONS) {
      const badge = svg(item.icon).querySelector("svg")!;
      const shapes = badge.querySelectorAll("path, circle, rect, ellipse");
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.length).toBeLessThanOrEqual(3);
      // Lucide's 24-unit grid; nothing may be cut off by the badge viewport.
      expect(badge.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });

  it.each(KEYS)(
    "draws %s distinctly from every other folder and its nearest neighbours",
    (key) => {
      const own = emblem(entry(key).icon);
      for (const other of FOLDER_ICONS) {
        if (other.key === key) continue;
        const otherBadge = svg(other.icon).querySelector("svg");
        if (otherBadge)
          expect(
            otherBadge.innerHTML.replace(/ class="[^"]*"/g, ""),
            `${key} vs ${other.key}`,
          ).not.toBe(own);
      }
      for (const neighbour of NEIGHBOURS[key]) {
        expect(getConnectionIconDefinition(neighbour)?.key).toBe(neighbour);
      }
    },
  );

  it("does not reuse a cart or lucide's shopping glyphs for the shopping folder", () => {
    const badgeClass = (key: (typeof KEYS)[number]) =>
      svg(entry(key).icon).querySelector("svg")!.getAttribute("class") ?? "";
    expect(badgeClass("folder-shopping")).toMatch(
      /\blucide-folder-shopping-emblem\b/,
    );
    expect(badgeClass("folder-shopping")).not.toMatch(
      /shopping-(cart|bag|basket)\b|store|cart/i,
    );
    expect(badgeClass("folder-isp")).toMatch(/\blucide-folder-isp-emblem\b/);
    expect(badgeClass("folder-government")).toMatch(
      /\blucide-folder-government-emblem\b/,
    );
    expect(badgeClass("folder-government")).not.toMatch(/lucide-landmark/i);
    expect(badgeClass("folder-isp")).not.toMatch(
      /lucide-(globe|earth|router|radio|wifi|cloud|antenna|network)/i,
    );
  });
});
