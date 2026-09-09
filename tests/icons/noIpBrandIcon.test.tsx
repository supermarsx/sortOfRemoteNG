import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noip } from "../../src/utils/icons/brand/noipBrandIcon";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ saveIconLibrary: vi.fn() }) },
}));

function renderMark(size: number, color = "#222834") {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(noip, {
        size,
        style: { color },
        "aria-label": "No-IP",
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}

beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("smooth publisher-derived No-IP mark", () => {
  it.each(
    [16, 24, 32, 96].flatMap((size) =>
      ["#222834", "#e5e7eb"].map((color) => ({ size, color })),
    ),
  )(
    "keeps passive recolorable geometry at $size px in $color",
    ({ size, color }) => {
      const svg = renderMark(size, color);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("style")).toContain(`color:${color}`);
      expect(svg.getAttribute("aria-label")).toBe("No-IP");
      expect(svg.querySelectorAll("path")).toHaveLength(1);
      expect(
        svg.querySelector(
          "image, mask, text, use, clipPath, foreignObject, script",
        ),
      ).toBeNull();
      const path = svg.querySelector("path")!;
      expect(path.getAttribute("fill")).toBe("currentColor");
      expect(path.getAttribute("stroke")).toBe("none");
      expect(path.getAttribute("transform")).toBe("scale(0.4444444444)");
    },
  );

  it("retains four disconnected foreground contours with smooth roundel and bowl edges", () => {
    const data = renderMark(96).querySelector("path")!.getAttribute("d")!;
    expect(data.match(/M/g)).toHaveLength(4);
    expect(data.match(/Z/g)).toHaveLength(4);
    expect(data.match(/C/g)!.length).toBeGreaterThanOrEqual(10);
    // A compact contour must not regress to hundreds of raster-boundary steps.
    expect(data.match(/[A-Za-z]/g)!.length).toBeLessThan(60);
    expect(data).not.toMatch(/NaN|Infinity/);
  });

  it("preserves the saved No-IP key and keeps generic Dynamic DNS separate", () => {
    const entry = CONNECTION_ICON_CATALOG.find((item) => item.key === "noip");
    expect(entry?.icon).toBe(noip);
    expect(entry?.category).toBe("domain-registrars");
    const generic = CONNECTION_ICON_CATALOG.find(
      (item) => item.key === "dynamic-dns",
    );
    expect(generic).toBeDefined();
    expect(generic?.icon).not.toBe(noip);
  });

  it("exports through the real strict SVG boundary and round-trips the contours losslessly", () => {
    const exported = exportLibrarySvg("noip");
    const parsed = parsePassiveSvg(exported);
    expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
    const svg = new DOMParser().parseFromString(exported, "image/svg+xml");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(
      renderMark(24).querySelector("path")!.getAttribute("d"),
    );
    expect(exported).not.toMatch(/(?:href=|url\(|<image|<mask|<text)/i);
  });
});
