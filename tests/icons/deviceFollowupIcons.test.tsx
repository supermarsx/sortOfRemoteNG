import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

const VARIANTS = [
  ["restaurant-table", "restaurant", "restaurant"],
  ["stock-shelves", "stock", "stock"],
  ["motorcycle-cruiser", "motorcycle", "motorcycle"],
  ["server-tower-vented", "server-tower", "tower server"],
  ["server-blade-horizontal", "server-blade", "blade server"],
  [
    "development-workstation-dual",
    "development-workstation",
    "development workstation",
  ],
  ["workstation-desktop", "laptop", "workstation"],
  ["server-rack-open", "server-rack", "rack server"],
  ["printer-laser", "printer", "printer"],
  ["display-ultrawide", "television", "display"],
  ["employee-card", "people", "employee card"],
  ["credit-card-contactless", "payment-card", "credit card"],
  ["l2tp-tunnel", "l2tp", "l2tp"],
  ["ikev2-exchange", "ikev2", "ikev2"],
] as const;

function svg(key: string, size = 16) {
  const definition = getConnectionIconDefinition(key)!;
  expect(definition).toBeDefined();
  const node = new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(definition.icon, {
        size,
        color: "#e09b56",
        "aria-label": definition.ariaLabel,
      }),
    ),
    "image/svg+xml",
  ).documentElement;
  node
    .querySelectorAll("[class]")
    .forEach((element) => element.removeAttribute("class"));
  return node;
}

describe("additional device, identity card and VPN variants", () => {
  it.each(VARIANTS)(
    "adds distinct %s without changing existing %s",
    (key, original, query) => {
      const definition = getConnectionIconDefinition(key)!;
      expect(svg(key).innerHTML).not.toBe(svg(original).innerHTML);
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toEqual(
        expect.arrayContaining([key]),
      );
      expect(getConnectionIconDefinition(original)?.key).toBe(original);
      for (const isGroup of [false, true]) {
        const restored = JSON.parse(
          JSON.stringify({ protocol: "ssh", icon: key, isGroup }),
        );
        expect(resolveEffectiveConnectionIcon(restored)).toMatchObject({
          key,
          source: "override",
        });
      }
      expect(definition.category).toBe(
        key === "employee-card"
          ? "business-shapes"
          : key === "credit-card-contactless"
            ? "web-applications"
            : key.startsWith("l2tp-") || key.startsWith("ikev2-")
              ? "network"
              : "servers-devices",
      );
    },
  );
  it.each(VARIANTS)(
    "keeps %s readable as themed pure vector geometry at16/24/32px",
    (key) => {
      const definition = getConnectionIconDefinition(key)!;
      for (const size of [16, 24, 32]) {
        const node = svg(key, size);
        expect(node.getAttribute("width")).toBe(String(size));
        expect(node.getAttribute("height")).toBe(String(size));
        expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(node.getAttribute("stroke")).toBe("#e09b56");
        expect(node.getAttribute("aria-label")).toBe(definition.ariaLabel);
        expect(
          node.querySelector(
            "text, image, use, script, foreignObject, [data-role-frame]",
          ),
        ).toBeNull();
        expect(node.querySelector("path, circle, rect")).not.toBeNull();
      }
    },
  );
  it("has14 unique silhouettes and no duplicate React node keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(VARIANTS).toHaveLength(14);
      expect(new Set(VARIANTS.map(([key]) => svg(key).innerHTML)).size).toBe(
        14,
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
