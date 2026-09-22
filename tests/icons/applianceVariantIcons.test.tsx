import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

const VARIANTS = [
  "development-server",
  "development-workstation",
  "gpu-farm",
  "storage-farm",
  "rendering-server",
  "render-workstation",
  "ip-camera",
  "ip-camera-bullet",
  "ip-camera-dome",
  "ip-camera-ptz",
  "dvr",
  "nvr",
  "reolink",
  "hikvision",
  "dahua",
  "axis",
  "hanwha",
  "uniview",
  "amcrest",
  "reolink-camera",
  "hikvision-camera",
  "dahua-camera",
  "axis-camera",
  "hanwha-camera",
  "uniview-camera",
  "amcrest-camera",
  "tplink-camera",
  "ubiquiti-camera",
  "reolink-nvr",
  "hikvision-dvr",
  "dahua-dvr",
  "access-point-ceiling",
  "access-point-wall",
  "router-rack",
  "router-edge",
  "router-wireless",
  "switch-managed",
  "switch-poe",
  "switch-fiber",
  "server-rack",
  "server-tower",
  "server-blade",
  "ddwrt",
  "ddwrt-router",
] as const;
const PLAIN = [
  "ftp",
  "clock",
  "battery-charging",
  "power",
  "transfer",
  "mail-plus",
  "payment-card",
  "pie-chart",
  "hetzner",
  "ovh",
  "digitalocean",
  "alibabacloud",
  "exchange",
  "intel",
  "bind",
] as const;

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  const svg = new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry!.icon, { size: 24 })),
    "image/svg+xml",
  ).documentElement;
  expect(svg.tagName).toBe("svg");
  expect(
    svg.querySelector("path, rect, circle, ellipse, polygon, polyline, line"),
  ).not.toBeNull();
  expect(svg.querySelector("image, text, use, foreignObject")).toBeNull();
  return svg;
}
function fingerprint(svg: Element) {
  const clone = svg.cloneNode(true) as Element;
  for (const node of Array.from(clone.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return clone.innerHTML;
}
function roleFrame(svg: Element) {
  return Array.from(svg.children).find((node) =>
    node.hasAttribute("data-role-frame"),
  );
}
describe("appliance variants and complete plain counterparts", () => {
  it.each([...VARIANTS, ...PLAIN])("renders and finds %s", (key) => {
    expect(fingerprint(svgFor(key))).not.toBe("");
    expect(
      filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
    ).toContain(key);
  });
  it.each(VARIANTS)("persists explicit appliance %s", (key) => {
    const restored = normalizeAdvancedProtocolConnection(
      JSON.parse(
        JSON.stringify({
          id: "appliance",
          name: "Appliance",
          protocol: "ssh",
          icon: key,
        }),
      ),
    );
    expect(restored.icon).toBe(key);
    expect(
      resolveEffectiveConnectionIcon({
        ...restored,
        protocol: restored.protocol ?? "ssh",
      }),
    ).toMatchObject({ key, source: "override" });
  });
  it.each([
    [
      "camera",
      "ip-camera",
      "ip-camera-bullet",
      "ip-camera-dome",
      "ip-camera-ptz",
    ],
    ["reolink", "reolink-camera", "reolink-nvr"],
    ["hikvision", "hikvision-camera", "hikvision-dvr"],
    ["dahua", "dahua-camera", "dahua-dvr"],
    ["axis", "axis-camera"],
    ["hanwha", "hanwha-camera"],
    ["uniview", "uniview-camera"],
    ["amcrest", "amcrest-camera"],
    ["tplink", "tplink-camera"],
    ["ubiquiti", "ubiquiti-camera"],
    ["development-server", "development-workstation"],
    ["rendering-server", "render-workstation"],
    [
      "server",
      "gpu-farm",
      "storage-farm",
      "rendering-server",
      "development-server",
    ],
    ["access-point", "access-point-ceiling", "access-point-wall"],
    ["router", "router-rack", "router-edge", "router-wireless"],
    ["switch", "switch-managed", "switch-poe", "switch-fiber"],
    ["server", "server-rack", "server-tower", "server-blade"],
    ["ddwrt", "ddwrt-router"],
  ])("keeps the %s appliance family geometrically distinct", (...keys) => {
    expect(new Set(keys.map((key) => fingerprint(svgFor(key)))).size).toBe(
      keys.length,
    );
  });
  it("provides a real standalone plain SVG for every nonfolder framed glyph", () => {
    const rendered = CONNECTION_ICON_CATALOG.map((entry) => ({
      key: entry.key,
      svg: svgFor(entry.key),
    }));
    const plain = new Set(
      rendered
        .filter(({ svg }) => !roleFrame(svg))
        .map(({ svg }) => fingerprint(svg)),
    );
    const composites = rendered.filter(({ svg }) => {
      const role = roleFrame(svg)?.getAttribute("data-role-frame");
      return role && role !== "folder";
    });
    expect(composites.length).toBeGreaterThanOrEqual(178);
    const missing: string[] = [];
    for (const { key, svg } of composites) {
      const glyph = Array.from(svg.children).find(
        (node) => node.tagName === "svg",
      );
      expect(glyph, key + " missing nested glyph").toBeDefined();
      if (key === "draytek-router" || key === "draytek-switch") {
        // Compact badges stack the same traced wordmark letterforms; only their
        // placement differs from the selectable full-width publisher layout.
        const withoutPlacement = (source: Element) => {
          const clone = source.cloneNode(true) as Element;
          for (const node of clone.querySelectorAll("path"))
            node.removeAttribute("transform");
          return fingerprint(clone);
        };
        expect(withoutPlacement(glyph!)).toBe(
          withoutPlacement(svgFor("draytek")),
        );
        continue;
      }
      if (!plain.has(fingerprint(glyph!))) missing.push(key);
    }
    expect(
      missing,
      "Every appliance frame needs its actual inset as a selectable plain icon",
    ).toEqual([]);
  }, 30_000);
});
