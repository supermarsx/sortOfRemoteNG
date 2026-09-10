import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { BRAND_ICONS } from "../../src/utils/icons/brand";

function render(key: string, size = 24) {
  const definition = getConnectionIconDefinition(key)!;
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(definition.icon, {
        size,
        color: "#abc123",
        "aria-label": definition.ariaLabel,
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}

describe("publisher-referenced replacement marks", () => {
  it.each([
    [
      "ptservidor",
      "1bfe6273c65be9a1ed0690d27156c46a0fdc171f30104f0ba10b058c1f7a01f3",
    ],
    [
      "ptisp",
      "0409020455bee5675eb64f95d6466ea38907d914dfa417a0786b78d4d9548151",
    ],
    [
      "webtuga",
      "0d38781129ca24bebcda598c9806b535ba8330f705992fab54707fb22d082034",
    ],
    [
      "dameware",
      "d33a0967b24de0bbd34b02de61bec159de415b1914f75f0a1065a406d041fd5c",
    ],
  ])("preserves the reviewed contour of %s", (key, expected) => {
    const path = render(key).querySelector("path")!;
    expect(
      createHash("sha256").update(path.getAttribute("d")!).digest("hex"),
    ).toBe(expected);
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(getConnectionIconDefinition(key)?.description).toContain("traced");
    expect(Object.values(BRAND_ICONS)).toContain(
      getConnectionIconDefinition(key)?.icon,
    );
  });

  it("keeps all 25 independent Snappy paths without wordmark or background", () => {
    const paths = render("hostgator").querySelectorAll("path");
    expect(paths).toHaveLength(25);
    expect(paths[0].getAttribute("d")).toMatch(/^M24\.2957 35\.3284/);
    expect(paths[24].getAttribute("d")).toMatch(/^M10\.6353 25\.0754/);
    for (const path of paths)
      expect(path.getAttribute("transform")).toBe(
        "translate(3.2 1) scale(0.55)",
      );
  });

  it.each([
    "ptservidor",
    "ptisp",
    "webtuga",
    "hostgator",
    "dameware",
    "mcdonalds",
    "storefront",
  ])("renders %s as a themed passive local vector", (key) => {
    for (const size of [16, 24, 32]) {
      const svg = render(key, size);
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("stroke")).toBe("#abc123");
      expect(
        svg.querySelector("image,text,use,script,foreignObject,mask,clipPath"),
      ).toBeNull();
      expect(svg.querySelector("[href],[src],[onload],[onclick]")).toBeNull();
      expect(svg.innerHTML).not.toMatch(/data:/);
      expect(svg.querySelector("path")).not.toBeNull();
    }
    expect(filterConnectionIcons(key).map((entry) => entry.key)).toContain(key);
  });

  it("honestly distinguishes the Dameware publisher fallback and generic storefront", () => {
    expect(getConnectionIconDefinition("dameware")?.description).toContain(
      "Not a separate Dameware product logo",
    );
    expect(getConnectionIconDefinition("storefront")?.description).toContain(
      "not a brand",
    );
    expect(
      filterConnectionIcons("golden arches").map((entry) => entry.key),
    ).toContain("mcdonalds");
    expect(getConnectionIconDefinition("mcdonalds")?.icon).toBe(
      BRAND_ICONS.mcdonalds,
    );
    expect(render("storefront").innerHTML).not.toBe(
      render("citrix-web").innerHTML,
    );
  });
});
