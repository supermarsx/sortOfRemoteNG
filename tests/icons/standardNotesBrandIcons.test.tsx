import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  standardnotes,
  standardrednotes,
} from "../../src/utils/icons/brand/standardNotesBrandIcons";
import { BRAND_ICONS } from "../../src/utils/icons/brand";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { HTTP_APPLICATION_ICON_SUGGESTIONS } from "../../src/utils/icons/httpApplicationIconSuggestions";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ saveIconLibrary: vi.fn() }) },
}));
beforeEach(() => publishIconLibrary(undefined, { ready: true }));
const icons = {
  "standard-notes": standardnotes,
  "standard-red-notes": standardrednotes,
};
const render = (key: keyof typeof icons, size = 24, color = "#222834") =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(icons[key], {
        size,
        color,
        style: { color },
        "aria-label": key,
      }),
    ),
    "image/svg+xml",
  ).documentElement;

describe("distinct Standard Notes publisher and Standard Red Notes fork icons", () => {
  it.each(
    Object.keys(icons).flatMap((key) =>
      [16, 24, 32, 96].flatMap((size) =>
        ["#222834", "#e5e7eb"].map((color) => ({
          key: key as keyof typeof icons,
          size,
          color,
        })),
      ),
    ),
  )(
    "keeps $key passive and legible at $size px in $color",
    ({ key, size, color }) => {
      const svg = render(key, size, color);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("stroke")).toBe(color);
      expect(svg.getAttribute("style")).toContain(`color:${color}`);
      expect(svg.getAttribute("aria-label")).toBe(key);
      expect(
        svg.querySelector(
          "image,script,foreignObject,use,text,mask,clipPath,filter",
        ),
      ).toBeNull();
      for (const node of Array.from(svg.children)) {
        expect(node.getAttribute("stroke")).toBe("none");
        expect(node.getAttribute("transform")).toBe(
          key === "standard-notes" ? "scale(1.2)" : "scale(0.046875)",
        );
      }
      expect(svg.querySelector('[fill="currentColor"]')).not.toBeNull();
    },
  );
  it("retains the exact official even-odd rounded-square/n publisher geometry", () => {
    const svg = render("standard-notes");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    const node = svg.querySelector("path")!;
    expect(node.getAttribute("fill-rule")).toBe("evenodd");
    expect(
      createHash("sha256").update(node.getAttribute("d")!).digest("hex"),
    ).toBe("6397e4bf9638b09442cb643e2d1d41928af9e682f1e1f1c5b25f944f4e92b4e3");
  });
  it("retains all ten fork shapes including red tile, paper, folded corner and three red lines", () => {
    const svg = render("standard-red-notes");
    expect(svg.children).toHaveLength(10);
    expect(svg.querySelectorAll("rect")).toHaveLength(6);
    expect(svg.querySelectorAll("path")).toHaveLength(4);
    expect(
      svg.querySelector('rect[fill="#be1f2d"][width="476"]'),
    ).not.toBeNull();
    expect(svg.querySelector('path[fill="#fffaf6"]')).not.toBeNull();
    expect(
      svg.querySelectorAll('rect[width="132"][height="15"][fill="#be1f2d"]'),
    ).toHaveLength(3);
    const shapes = Array.from(svg.children).map((node) => ({
      tag: node.localName,
      attributes: Object.fromEntries(
        Array.from(node.attributes)
          .filter((attr) => !["stroke", "transform"].includes(attr.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((attr) => [attr.name, attr.value]),
      ),
    }));
    expect(
      createHash("sha256").update(JSON.stringify(shapes)).digest("hex"),
    ).toBe("3fcf252632c188757f44d62bf4e1d5c0562f717d18ba67e1dd8e9f409bf9dfaf");
  });
  it.each(Object.keys(icons) as (keyof typeof icons)[])(
    "exports and round-trips %s through the actual passive SVG boundary",
    (key) => {
      const exported = exportLibrarySvg(key);
      const parsed = parsePassiveSvg(exported);
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
      const svg = new DOMParser().parseFromString(
        exported,
        "image/svg+xml",
      ).documentElement;
      expect(svg.children.length).toBe(render(key).children.length);
      expect(exported).not.toMatch(/(?:href=|url\(|<image|<text|<script)/i);
    },
  );
  it("registers independent searchable marks and maps both Standard Notes deployment presets to the upstream icon", () => {
    expect(getConnectionIconDefinition("standard-notes")?.icon).toBe(
      standardnotes,
    );
    expect(getConnectionIconDefinition("standard-red-notes")?.icon).toBe(
      standardrednotes,
    );
    expect(BRAND_ICONS.standardnotes).toBe(standardnotes);
    expect(BRAND_ICONS.standardrednotes).toBe(standardrednotes);
    expect(standardnotes).not.toBe(standardrednotes);
    expect(
      getConnectionIconDefinition("standard-red-notes")?.keywords,
    ).toContain("standard notes fork");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS["standard-notes"]).toBe(
      "standard-notes",
    );
    expect(
      HTTP_APPLICATION_ICON_SUGGESTIONS["standard-notes-self-hosted"],
    ).toBe("standard-notes");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS["standard-red-notes"]).toBe(
      "standard-red-notes",
    );
  });
});
