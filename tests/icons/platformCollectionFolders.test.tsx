import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import {
  PLATFORM_COLLECTION_FOLDER_ICONS,
  PLATFORM_COLLECTION_FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/platformCollectionFolders";

const KEYS = [
  "folder-windows",
  "folder-linux",
  "folder-apple",
  "folder-ubuntu",
  "folder-proxmox",
  "folder-hyper-v",
  "folder-mariadb",
] as const;

const SEARCH_QUERIES = {
  "folder-windows": ["windows", "microsoft windows"],
  "folder-linux": ["linux", "unix"],
  "folder-apple": ["apple", "macos"],
  "folder-ubuntu": ["ubuntu", "canonical"],
  "folder-proxmox": ["proxmox", "pve"],
  "folder-hyper-v": ["hyper-v", "hyperv", "microsoft"],
  "folder-mariadb": ["mariadb", "maria db", "database"],
} as const;

function markup(
  icon: (typeof PLATFORM_COLLECTION_FOLDER_ICONS)[number]["icon"],
  size = 16,
  color = "#725bc9",
) {
  return renderToStaticMarkup(createElement(icon, { size, color }));
}

function svg(
  icon: (typeof PLATFORM_COLLECTION_FOLDER_ICONS)[number]["icon"],
  size = 16,
  color = "#725bc9",
) {
  return new DOMParser().parseFromString(
    markup(icon, size, color),
    "image/svg+xml",
  ).documentElement;
}

function emblem(
  icon: (typeof PLATFORM_COLLECTION_FOLDER_ICONS)[number]["icon"],
) {
  return svg(icon)
    .querySelector("svg")!
    .innerHTML.replace(/ class="[^"]*"/g, "");
}

function parseRenderedPassiveSvg(source: string) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  for (const element of [
    doc.documentElement,
    ...Array.from(doc.documentElement.getElementsByTagName("*")),
  ]) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        ["class", "color", "focusable"].includes(attribute.name) ||
        attribute.name.startsWith("aria-") ||
        attribute.name.startsWith("data-")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return parsePassiveSvg(
    new XMLSerializer().serializeToString(doc.documentElement),
  );
}

describe("platform collection folder pairs", () => {
  it("defines exactly seven stable, unique, searchable folder choices", () => {
    expect(PLATFORM_COLLECTION_FOLDER_ICONS.map(({ key }) => key)).toEqual(
      KEYS,
    );
    expect(new Set(KEYS).size).toBe(KEYS.length);

    for (const entry of PLATFORM_COLLECTION_FOLDER_ICONS) {
      expect(entry.category).toBe("folders");
      const searchable = [entry.key, entry.label, ...entry.keywords]
        .join(" ")
        .toLowerCase();
      for (const query of SEARCH_QUERIES[entry.key]) {
        expect(searchable, `${entry.key} should match ${query}`).toContain(
          query,
        );
      }
      expect(entry.keywords).toEqual(
        expect.arrayContaining([
          "folder",
          "folders",
          "collection",
          "collections",
        ]),
      );
    }
  });

  it.each(PLATFORM_COLLECTION_FOLDER_ICONS)(
    "keeps $key emblem-identical, theme-aware and passive in both states",
    (entry) => {
      const OpenIcon = PLATFORM_COLLECTION_FOLDER_OPEN_ICONS[entry.key];
      for (const size of [16, 24, 32]) {
        for (const color of ["#f8fafc", "#172033"]) {
          const closedMarkup = markup(entry.icon, size, color);
          const openMarkup = markup(OpenIcon, size, color);
          const closed = new DOMParser().parseFromString(
            closedMarkup,
            "image/svg+xml",
          ).documentElement;
          const open = new DOMParser().parseFromString(
            openMarkup,
            "image/svg+xml",
          ).documentElement;

          expect(closed.innerHTML).not.toBe(open.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            open.querySelector("svg")!.innerHTML,
          );
          for (const [root, role, source] of [
            [closed, "folder", closedMarkup],
            [open, "folder-open", openMarkup],
          ] as const) {
            expect(root.getAttribute("width")).toBe(String(size));
            expect(root.getAttribute("stroke")).toBe(color);
            expect(
              root.querySelector(`[data-role-frame="${role}"]`),
            ).not.toBeNull();
            expect(
              root.querySelector(
                "script, image, text, foreignObject, use, mask, filter",
              ),
            ).toBeNull();
            const badge = root.querySelector("svg")!;
            expect(
              ["x", "y", "width", "height"].map((name) =>
                badge.getAttribute(name),
              ),
            ).toEqual(["12", "12", "11", "11"]);
            expect(badge.getAttribute("stroke")).toBe(color);
            expect(() => parseRenderedPassiveSvg(source)).not.toThrow();
          }
        }
      }
    },
  );

  it("keeps every badge unique and Hyper-V distinct from Windows at 16px", () => {
    const emblems = PLATFORM_COLLECTION_FOLDER_ICONS.map(({ icon }) =>
      emblem(icon),
    );
    expect(new Set(emblems).size).toBe(emblems.length);

    const windows = PLATFORM_COLLECTION_FOLDER_ICONS.find(
      ({ key }) => key === "folder-windows",
    )!;
    const hyperV = PLATFORM_COLLECTION_FOLDER_ICONS.find(
      ({ key }) => key === "folder-hyper-v",
    )!;
    expect(emblem(hyperV.icon)).not.toBe(emblem(windows.icon));
    const hyperVBadge = svg(hyperV.icon, 16).querySelector("svg")!;
    expect(hyperVBadge.getAttribute("width")).toBe("11");
    expect(hyperVBadge.querySelector("path")).not.toBeNull();
  });
});
