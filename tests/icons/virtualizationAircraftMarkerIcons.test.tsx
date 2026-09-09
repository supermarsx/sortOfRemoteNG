import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { siQemu } from "simple-icons";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { AIRCRAFT_ICONS } from "../../src/utils/icons/catalog/aircraft";
import { ALPHANUMERIC_MARKER_ICONS } from "../../src/utils/icons/catalog/alphanumericMarkers";
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
        throw new Error("Icon fixture refuses settings writes");
      },
    }),
  },
}));
const requested = [
  ["qemu", "qemu kvm", "virtualization"],
  ["virtual-machine", "guest os", "virtualization"],
  ["cryptography", "cryptography", "security"],
  ["stealth-bomber", "flying wing", "servers-devices"],
  ["fighter-jet", "fighter jet", "servers-devices"],
  ["black-hawk-helicopter", "blackhawk", "servers-devices"],
  ["ipv4", "internet protocol version 4", "network"],
  ["ipv6", "internet protocol version 6", "network"],
  ...ALPHANUMERIC_MARKER_ICONS.map(
    (entry) => [entry.key, entry.label, "generic-shapes"] as const,
  ),
] as const;
function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key)!;
  expect(entry).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, { size, color: "#647ea8" })),
    "image/svg+xml",
  ).documentElement;
}
beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("virtualization, aircraft, IP and alphanumeric icons", () => {
  it("includes all 44 choices once, including the existing saved VM key", () => {
    expect(requested).toHaveLength(44);
    expect(ALPHANUMERIC_MARKER_ICONS).toHaveLength(36);
    expect(AIRCRAFT_ICONS).toHaveLength(3);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key] of requested)
      expect(keys.filter((candidate) => candidate === key)).toHaveLength(1);
    expect(ALPHANUMERIC_MARKER_ICONS.map((entry) => entry.key)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `number-${index}`),
      ...Array.from(
        { length: 26 },
        (_, index) => `letter-${String.fromCharCode(97 + index)}`,
      ),
    ]);
  });
  it.each(requested)(
    "finds %s through its requested aliases and preserves serialized overrides",
    (key, query, category) => {
      expect(getConnectionIconDefinition(key)?.category).toBe(category);
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );
  it.each(requested)(
    "renders %s as a themed pure vector at small and preview sizes",
    (key) => {
      for (const size of [16, 24, 32, 96]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("height")).toBe(String(size));
        expect(svg.getAttribute("stroke")).toBe("#647ea8");
        expect(svg.querySelector("path,rect,circle")).not.toBeNull();
        expect(
          svg.querySelector(
            "image,text,use,script,foreignObject,mask,clipPath,filter,svg,[href],[style],[data-role-frame]",
          ),
        ).toBeNull();
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity|url\(/);
        for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
          for (const attr of Array.from(element.attributes)) {
            if (["fill", "stroke"].includes(attr.name))
              expect(["none", "currentColor", "#647ea8"]).toContain(attr.value);
            expect(attr.name).not.toMatch(/^on/i);
          }
        }
      }
    },
  );
  it.each(requested)(
    "strictly exports and reimports every path of %s",
    (key) => {
      const serialized = exportLibrarySvg(key);
      const parsed = parsePassiveSvg(serialized);
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
      const imported = new DOMParser().parseFromString(
        serialized,
        "image/svg+xml",
      ).documentElement;
      expect(
        Array.from(imported.querySelectorAll("path")).map((node) =>
          node.getAttribute("d"),
        ),
      ).toEqual(
        Array.from(svgFor(key).querySelectorAll("path")).map((node) =>
          node.getAttribute("d"),
        ),
      );
    },
  );
  it("uses the exact pinned pure QEMU brand path and a distinct guest-window VM", () => {
    expect(svgFor("qemu").querySelectorAll("path")).toHaveLength(1);
    expect(svgFor("qemu").querySelector("path")!.getAttribute("d")).toBe(
      siQemu.path,
    );
    expect(svgFor("virtual-machine").querySelectorAll("rect")).toHaveLength(2);
    expect(getConnectionIconDefinition("virtual-machine")?.label).toBe(
      "Virtual machine",
    );
  });
  it("keeps every glyph distinct, including zero/O, one/I, IP versions and aircraft", () => {
    const geometry = requested.map(([key]) =>
      Array.from(svgFor(key).children)
        .map((node) => node.outerHTML)
        .join(""),
    );
    expect(new Set(geometry).size).toBe(44);
    expect(
      svgFor("black-hawk-helicopter").querySelectorAll("circle"),
    ).toHaveLength(2);
    expect(svgFor("cryptography").querySelector("circle")).not.toBeNull();
    for (const query of ["black hawk", "UH-60", "uh60", "helicopter"])
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        "black-hawk-helicopter",
      );
  });
});
