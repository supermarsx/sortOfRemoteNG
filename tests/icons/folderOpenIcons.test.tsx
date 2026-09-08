import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Archive,
  Clock,
  CodeXml,
  GitFork,
  Heart,
  Kanban,
  LockKeyhole,
  Network,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";

function svg(Icon: LucideIcon) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(Icon, {
        size: 16,
        color: "#a45bad",
        className: "folder-theme",
        "aria-label": "Custom folder",
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}

describe("matching folder open states", () => {
  it("covers exactly every folder without adding duplicate picker or persisted keys", () => {
    expect(Object.keys(FOLDER_OPEN_ICONS).sort()).toEqual(
      FOLDER_ICONS.map((entry) => entry.key).sort(),
    );
    expect(
      CONNECTION_ICON_CATALOG.filter(
        (entry) => entry.category === "folders",
      ).map((entry) => entry.key),
    ).toEqual(FOLDER_ICONS.map((entry) => entry.key));
  });
  it.each(FOLDER_ICONS)(
    "renders $key open with inherited color, sizing and accessible label",
    (entry) => {
      const resolved = resolveEffectiveConnectionIcon({
        protocol: "rdp",
        isGroup: true,
        icon: entry.key,
      });
      const Open = getExpandedFolderIcon(resolved, true);
      expect(Open).toBe(FOLDER_OPEN_ICONS[entry.key]);
      expect(getExpandedFolderIcon(resolved, false)).toBe(entry.icon);
      expect(getExpandedFolderIcon(resolved, true)).toBe(Open);
      const opened = svg(Open);
      const closed = svg(entry.icon);
      expect(opened.getAttribute("width")).toBe("16");
      expect(opened.getAttribute("stroke")).toBe("#a45bad");
      expect(opened.getAttribute("class")).toContain("folder-theme");
      expect(opened.getAttribute("aria-label")).toBe("Custom folder");
      expect(opened.querySelector("path, rect, circle")).not.toBeNull();
      expect(opened.querySelector("text, image, foreignObject")).toBeNull();
      if (entry.key !== "folder-open")
        expect(opened.innerHTML).not.toBe(closed.innerHTML);
      if (closed.querySelector('[data-role-frame="folder"]')) {
        const inset = opened.querySelector("svg")!;
        expect(inset.innerHTML).toBe(closed.querySelector("svg")!.innerHTML);
        expect(inset.getAttribute("stroke")).toBe("#a45bad");
        expect(inset.getAttribute("aria-hidden")).toBe("true");
        expect(inset.getAttribute("width")).toBe(
          closed.querySelector("svg")!.getAttribute("width"),
        );
        expect(inset.getAttribute("height")).toBe(
          closed.querySelector("svg")!.getAttribute("height"),
        );
      }
      // Presentation must not turn an explicit persisted choice into another key.
      expect(resolved.key).toBe(entry.key);
      expect(resolved.source).toBe("override");
    },
  );
  it.each([
    ["folder-cog", Settings],
    ["folder-tree", Network],
    ["folder-lock", LockKeyhole],
    ["folder-archive", Archive],
    ["folder-code", CodeXml],
    ["folder-git", GitFork],
    ["folder-sync", RefreshCw],
    ["folder-clock", Clock],
    ["folder-kanban", Kanban],
    ["folder-heart", Heart],
  ] as const)(
    "retains the recognizable %s emblem instead of nesting a closed folder",
    (key, Glyph) => {
      const opened = svg(FOLDER_OPEN_ICONS[key]);
      expect(
        opened.querySelector('[data-role-frame="folder-open"]'),
      ).not.toBeNull();
      expect(opened.querySelector("svg")!.innerHTML).toBe(svg(Glyph).innerHTML);
    },
  );
  it("keeps all emblem-bearing open states geometrically distinct", () => {
    const emblems = FOLDER_ICONS.filter(
      (entry) => entry.key !== "folder" && entry.key !== "folder-open",
    );
    const geometry = emblems.map((entry) =>
      svg(FOLDER_OPEN_ICONS[entry.key]).innerHTML.replace(
        / class="[^"]*"/g,
        "",
      ),
    );
    expect(new Set(geometry).size).toBe(emblems.length);
  });
  it.each([undefined, "unknown-folder"])(
    "opens the automatic folder fallback for %s",
    (icon) => {
      const resolved = resolveEffectiveConnectionIcon({
        protocol: "rdp",
        isGroup: true,
        icon,
      });
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS.folder,
      );
      expect(getExpandedFolderIcon(resolved, false)).toBe(resolved.icon);
    },
  );
  it("does not replace an explicit nonfolder group icon", () => {
    const resolved = resolveEffectiveConnectionIcon({
      protocol: "rdp",
      isGroup: true,
      icon: "server",
    });
    expect(getExpandedFolderIcon(resolved, true)).toBe(resolved.icon);
  });
});
