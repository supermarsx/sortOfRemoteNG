import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import {
  APP_AUTHORED_IDENTIFIER_ICONS,
  amcrest,
  brother,
  dahua,
  hanwha,
} from "../../src/utils/icons/brand";
import * as refined from "../../src/utils/icons/brand/refinedApplianceBrandIcons";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveIconLibrary: () => {
        throw new Error("Read-only icon fixture must not write settings");
      },
    }),
  },
}));

const marks = { amcrest, brother, dahua, hanwha } as const;
const keys = ["amcrest", "brother", "dahua", "hanwha"] as const;
const variants = [
  ["amcrest", "amcrest-camera"],
  ["brother", "brother-printer"],
  ["dahua", "dahua-camera"],
  ["dahua", "dahua-dvr"],
  ["hanwha", "hanwha-camera"],
] as const;
const hashes = {
  amcrest: "a612583090a09c0bad357af286e6526b8c9cddbb77214a6bba07bb1f67e1ff55",
  brother: "c95740823c8e9daf50931cb1ca824be53567e7ad38ae113ce2a8257e5818a150",
  dahua: "55c51c905e2da8f443484c3efc8e2fe2860e6ea2dd88dffe5d0b738aa29d0420",
  hanwha: "a5d16ed8bce4fe3e9e7361ed970d274f269de5962c44f7ed6bef253de52b12a4",
} as const;
const expectedCounts = { amcrest: 1, brother: 1, dahua: 2, hanwha: 3 } as const;
function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(entry!.icon, { size, color: "#8756b9" }),
    ),
    "image/svg+xml",
  ).documentElement;
}
function paths(svg: Element) {
  return Array.from(svg.querySelectorAll("path")).map((path) =>
    path.getAttribute("d")!,
  );
}
beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("publisher-derived appliance logo refinements", () => {
  it.each(keys)("preserves %s public and compatibility aliases", (key) => {
    expect(marks[key]).toBe(refined[key]);
    expect(APP_AUTHORED_IDENTIFIER_ICONS[key]).toBe(refined[key]);
    expect(getConnectionIconDefinition(key)?.icon).toBe(refined[key]);
    expect(Object.keys(APP_AUTHORED_IDENTIFIER_ICONS)).toHaveLength(47);
  });
  it.each(keys)(
    "retains saved %s selection and search without changing its key",
    (key) => {
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
      expect(filterConnectionIcons(key).map((entry) => entry.key)).toContain(
        key,
      );
      expect(getConnectionIconDefinition(key)?.description).toMatch(
        /publisher/,
      );
      expect(getConnectionIconDefinition(key)?.description).not.toMatch(
        /not an official|identifier authored/,
      );
    },
  );
  it.each(keys)(
    "renders %s passive, theme-colored and unframed at16/24/32/96",
    (key) => {
      for (const size of [16, 24, 32, 96]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("height")).toBe(String(size));
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("stroke")).toBe("#8756b9");
        expect(svg.querySelectorAll("path")).toHaveLength(expectedCounts[key]);
        expect(
          svg.querySelector(
            "image,text,use,script,foreignObject,mask,clipPath,[data-role-frame]",
          ),
        ).toBeNull();
        // XML serialization repeats the standard SVG namespace on child nodes.
        expect(
          svg.innerHTML.replace(
            /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,
            "",
          ),
        ).not.toMatch(/NaN|Infinity|url\(|https?:|data:/);
        expect(svg.querySelector("[href], [style]")).toBeNull();
        for (const path of svg.querySelectorAll("path")) {
          expect(path.getAttribute("fill")).toBe("currentColor");
          expect(path.getAttribute("stroke")).toBe("none");
          expect(path.getAttribute("transform")).toMatch(
            /^translate\([^)]*\) scale\([.\d]+\)$/,
          );
        }
      }
    },
  );
  it.each(keys)("pins the reviewed %s path geometry", (key) => {
    expect(
      createHash("sha256")
        .update(paths(svgFor(key)).join("\n"))
        .digest("hex"),
    ).toBe(hashes[key]);
  });
  it.each(variants)("reuses exact %s glyph inside %s", (plain, variant) => {
    const svg = svgFor(variant);
    expect(svg.querySelector("[data-role-frame]")).not.toBeNull();
    const badge = svg.querySelector("svg")!;
    expect(badge).not.toBeNull();
    expect(paths(badge)).toEqual(paths(svgFor(plain)));
    expect(
      Array.from(badge.querySelectorAll("path")).map((path) =>
        path.getAttribute("transform"),
      ),
    ).toEqual(
      Array.from(svgFor(plain).querySelectorAll("path")).map((path) =>
        path.getAttribute("transform"),
      ),
    );
    expect(getConnectionIconDefinition(variant)?.description).toMatch(
      /publisher/,
    );
  });
  it.each([...keys, ...variants.map(([, variant]) => variant)])(
    "exports %s through the strict passive library boundary",
    (key) => {
      const exported = exportLibrarySvg(key);
      expect(() => parsePassiveSvg(exported)).not.toThrow();
      expect(
        paths(
          new DOMParser().parseFromString(exported, "image/svg+xml")
            .documentElement,
        ),
      ).toEqual(paths(svgFor(key)));
    },
  );
  it("keeps Hanwha's independent relative-path origins and uniform source placement", () => {
    const nodes = Array.from(svgFor("hanwha").querySelectorAll("path"));
    expect(nodes.map((node) => node.getAttribute("d")?.split("c")[0])).toEqual([
      "M16.358 20.501",
      "M31.523 33.794",
      "M16.577 3.443",
    ]);
    expect(
      new Set(nodes.map((node) => node.getAttribute("transform"))).size,
    ).toBe(1);
  });
  it("keeps Dahua's italic a counter transparent, with smooth loop and letter curves", () => {
    const nodes = svgFor("dahua").querySelectorAll("path");
    expect(nodes).toHaveLength(2);
    expect(nodes[1].getAttribute("fill-rule")).toBe("evenodd");
    expect(nodes[0].getAttribute("d")).toMatch(/C/);
    expect(nodes[1].getAttribute("d")).toMatch(/c/);
  });
});
