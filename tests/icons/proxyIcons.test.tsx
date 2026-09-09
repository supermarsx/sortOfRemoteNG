import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrowLeftRight, Waypoints } from "lucide-react";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { PROXY_ICONS } from "../../src/utils/icons/catalog/proxyIcons";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveIconLibrary: () => {
        throw new Error("Read-only proxy icon tests must not write settings");
      },
    }),
  },
}));

const choices = ["socks-proxy", "http-proxy", "proxy-chain"] as const;
const aliases = [
  ["socks-proxy", "SOCKS"],
  ["socks-proxy", "SOCKS4"],
  ["socks-proxy", "SOCKS4a"],
  ["socks-proxy", "SOCKS5"],
  ["http-proxy", "HTTP proxy"],
  ["http-proxy", "HTTPS proxy"],
  ["http-proxy", "HTTP CONNECT"],
  ["http-proxy", "web proxy"],
  ["proxy-chain", "chained proxy"],
  ["proxy-chain", "proxychain"],
  ["proxy-chain", "proxychains"],
  ["proxy-chain", "multi-hop"],
  ["proxy-chain", "chain"],
] as const;
function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key)!;
  expect(entry, key).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, { size, color: "#725bc9" })),
    "image/svg+xml",
  ).documentElement;
}
beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("pure proxy protocol icons", () => {
  it.each(aliases)("finds %s through %s", (key, query) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });
  it.each(choices)(
    "keeps %s unique, network-scoped and saved without fallback",
    (key) => {
      expect(
        CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
      ).toHaveLength(1);
      expect(getConnectionIconDefinition(key)?.category).toBe("network");
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );
  it.each(choices)(
    "renders %s as a theme-safe unframed 24-grid vector",
    (key) => {
      for (const size of [16, 24, 32, 96]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("height")).toBe(String(size));
        expect(svg.getAttribute("stroke")).toBe("#725bc9");
        expect(
          svg.querySelector(
            "svg,[data-role-frame],image,text,use,script,foreignObject,mask,clipPath,filter,[href],[style]",
          ),
        ).toBeNull();
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity|url\(/);
        expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
      }
    },
  );
  it.each(choices)("preserves %s through strict SVG export/import", (key) => {
    const exported = exportLibrarySvg(key);
    const parsed = parsePassiveSvg(exported);
    expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
    const svg = new DOMParser().parseFromString(
      exported,
      "image/svg+xml",
    ).documentElement;
    expect(
      Array.from(svg.querySelectorAll("path")).map((p) => p.getAttribute("d")),
    ).toEqual(
      Array.from(svgFor(key).querySelectorAll("path")).map((p) =>
        p.getAttribute("d"),
      ),
    );
  });
  it("preserves the existing generic tunnel and route artwork", () => {
    expect(getConnectionIconDefinition("waypoints")?.icon).toBe(Waypoints);
    const existing = svgFor("proxy-tunnel");
    expect(existing.querySelector('[data-role-frame="vpn"]')).not.toBeNull();
    const oldGlyph = new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(ArrowLeftRight)),
      "image/svg+xml",
    ).documentElement;
    expect(existing.querySelector("svg")?.innerHTML).toBe(oldGlyph.innerHTML);
  });
  it("has three genuinely distinct silhouettes, including all three linked hops", () => {
    expect(PROXY_ICONS).toHaveLength(3);
    const shapes = [...choices, "proxy-tunnel", "waypoints"].map(
      (key) => svgFor(key).innerHTML,
    );
    expect(new Set(shapes).size).toBe(5);
    expect(svgFor("proxy-chain").querySelectorAll("rect")).toHaveLength(3);
    expect(svgFor("proxy-chain").querySelectorAll("path")).toHaveLength(1);
  });
  it("keeps stable React keys on all custom nodes", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const entry of PROXY_ICONS)
        renderToStaticMarkup(createElement(entry.icon));
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(
        /unique.*key|same key/i,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
