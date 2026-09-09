import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";

const pureKeys = [
  "ddwrt",
  "meo",
  "viva",
  "uzo",
  "draytek",
  "freepbx",
  "grandstream",
  "hurricane-electric",
] as const;
const variants = [
  ["ddwrt", "ddwrt-router"],
  ["draytek", "draytek-router"],
  ["draytek", "draytek-switch"],
  ["freepbx", "freepbx-server"],
  ["grandstream", "grandstream-phone"],
] as const;

function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key)!;
  expect(entry, key).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, { size, color: "#b356f0" })),
    "image/svg+xml",
  ).documentElement;
}

describe("named provider vector retraces", () => {
  it.each(pureKeys)(
    "renders %s as bounded, color-inheriting vector geometry",
    (key) => {
      for (const size of [16, 20, 24]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.querySelector("path")).not.toBeNull();
        expect(
          svg.querySelector(
            "text, image, use, foreignObject, script, mask, clipPath",
          ),
        ).toBeNull();
        expect(svg.querySelector("[data-role-frame]")).toBeNull();
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity|url\(/);
        for (const path of Array.from(svg.querySelectorAll("path"))) {
          expect([null, "none", "currentColor"]).toContain(
            path.getAttribute("fill"),
          );
        }
      }
    },
  );

  it.each(pureKeys)(
    "preserves saved %s overrides and search identity",
    (key) => {
      const restored = JSON.parse(
        JSON.stringify({ protocol: "ssh", isGroup: true, icon: key }),
      );
      expect(resolveEffectiveConnectionIcon(restored)).toMatchObject({
        key,
        source: "override",
      });
      expect(filterConnectionIcons(key).map((entry) => entry.key)).toContain(
        key,
      );
    },
  );

  it.each(variants)(
    "reuses %s geometry inside %s without duplicating a frame in the glyph",
    (base, variant) => {
      const glyphPaths = Array.from(svgFor(base).querySelectorAll("path")).map(
        (node) => node.getAttribute("d"),
      );
      const renderedVariant = svgFor(variant);
      const variantPaths = Array.from(
        renderedVariant.querySelectorAll("path"),
      ).map((node) => node.getAttribute("d"));
      expect(renderedVariant.querySelector("[data-role-frame]")).not.toBeNull();
      for (const path of glyphPaths) expect(variantPaths).toContain(path);
    },
  );

  it("uses the publisher MEO roundel and UZO letterforms, not the former typed initials", () => {
    expect(svgFor("meo").querySelector("path")?.getAttribute("d")).toContain(
      "M96 48a48 48",
    );
    expect(svgFor("meo").querySelector("path")?.getAttribute("fill-rule")).toBe(
      "evenodd",
    );
    expect(svgFor("uzo").querySelector("path")?.getAttribute("d")).toContain(
      "M149.47,24.72",
    );
    expect(
      svgFor("freepbx").querySelector("path")?.getAttribute("d"),
    ).toContain("M5.5 8.4");
    expect(svgFor("grandstream").querySelectorAll("path")).toHaveLength(2);
    expect(getConnectionIconDefinition("viva")?.description).toContain(
      "not assigned to a particular regional provider",
    );
  });
  it("retains Hurricane Electric's circled serif HE rather than a generic initial pair", () => {
    const svg = svgFor("hurricane-electric");
    const circle = svg.querySelector("circle")!;
    expect(circle.getAttribute("cx")).toBe("12");
    expect(circle.getAttribute("cy")).toBe("12");
    expect(circle.getAttribute("r")).toBe("10");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M6\.3 6h4/);
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe(
      "currentColor",
    );
    expect(svg.querySelector("image, mask, text")).toBeNull();
  });
  it("keeps the full DrayTek wordmark standalone but stacks those exact letterforms for tiny badges", () => {
    const plain = svgFor("draytek");
    const paths = Array.from(plain.querySelectorAll("path"));
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("transform")).toBe(
      paths[1].getAttribute("transform"),
    );
    for (const key of ["draytek-router", "draytek-switch"]) {
      const composite = svgFor(key);
      const badge = composite.querySelector("svg")!;
      const compact = Array.from(badge.querySelectorAll("path"));
      expect(compact.map((node) => node.getAttribute("d"))).toEqual(
        paths.map((node) => node.getAttribute("d")),
      );
      expect(compact[0].getAttribute("transform")).not.toBe(
        compact[1].getAttribute("transform"),
      );
      expect(badge.getAttribute("x")).toBe("12");
      expect(badge.getAttribute("y")).toBe("12");
      expect(badge.getAttribute("width")).toBe("11");
      expect(badge.getAttribute("height")).toBe("11");
    }
  });
});
