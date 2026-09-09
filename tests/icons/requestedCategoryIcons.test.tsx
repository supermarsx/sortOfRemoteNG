import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ADDITIONAL_FOLDER_ICONS } from "../../src/utils/icons/catalog/folderVariants";
import { FOLDER_OPEN_ICONS } from "../../src/utils/icons/catalog/folders";
import { NETWORK_VARIANT_ICONS } from "../../src/utils/icons/catalog/networkVariants";
import { PIRATE_ICONS } from "../../src/utils/icons/catalog/pirates";
import { DEITY_RELIGION_ICONS } from "../../src/utils/icons/catalog/deitiesReligion";
import { EMOJI_ICONS } from "../../src/utils/icons/catalog/emojis";
import { FRUIT_ICONS } from "../../src/utils/icons/catalog/fruits";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
  getConnectionIconsByCategory,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

const NEW_ICONS = [
  ...ADDITIONAL_FOLDER_ICONS,
  ...NETWORK_VARIANT_ICONS,
  ...PIRATE_ICONS,
  ...DEITY_RELIGION_ICONS,
];
function svg(key: string) {
  const entry = getConnectionIconDefinition(key)!;
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(entry.icon, {
        size: 16,
        color: "#9575d7",
        "aria-label": entry.ariaLabel,
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}
function geometry(key: string) {
  const node = svg(key);
  node
    .querySelectorAll("[class]")
    .forEach((element) => element.removeAttribute("class"));
  return node.innerHTML;
}

describe("requested folder, network, pirate and religious symbol catalog", () => {
  it("keeps 84 stable choices with 23 matching open-state folder variants", () => {
    expect(NEW_ICONS).toHaveLength(84);
    expect(ADDITIONAL_FOLDER_ICONS).toHaveLength(23);
    expect(PIRATE_ICONS).toHaveLength(22);
    expect(DEITY_RELIGION_ICONS).toHaveLength(27);
    expect(new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
  });
  it.each(NEW_ICONS)(
    "renders $key as themed, accessible, local SVG and preserves its saved key",
    ({ key, ariaLabel }) => {
      const node = svg(key);
      expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(node.getAttribute("width")).toBe("16");
      expect(node.getAttribute("stroke")).toBe("#9575d7");
      expect(node.getAttribute("aria-label")).toBe(ariaLabel);
      expect(
        node.querySelector("text, image, use, foreignObject, script"),
      ).toBeNull();
      expect(node.querySelector("path, rect, circle")).not.toBeNull();
      const restored = JSON.parse(
        JSON.stringify({
          protocol: "ssh",
          isGroup: key.startsWith("folder-"),
          icon: key,
        }),
      );
      expect(resolveEffectiveConnectionIcon(restored)).toMatchObject({
        key,
        source: "override",
      });
      expect(
        filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
      ).toContain(key);
    },
  );
  it.each(ADDITIONAL_FOLDER_ICONS)(
    "retains $key's bottom-right emblem in its open counterpart",
    ({ key }) => {
      const closed = svg(key);
      const open = new DOMParser().parseFromString(
        renderToStaticMarkup(
          createElement(FOLDER_OPEN_ICONS[key], { size: 16, color: "#9575d7" }),
        ),
        "image/svg+xml",
      ).documentElement;
      expect(
        open.querySelector('[data-role-frame="folder-open"]'),
      ).not.toBeNull();
      const emblem = open.querySelector("svg")!;
      expect(emblem.innerHTML).toBe(closed.querySelector("svg")!.innerHTML);
      expect(emblem.getAttribute("x")).toBe("12");
      expect(emblem.getAttribute("y")).toBe("12");
      expect(emblem.getAttribute("width")).toBe("11");
    },
  );
  it.each([
    ["wireless", "wireless-signal", "wireless-antenna", "wifi"],
    ["router", "router-modular", "router-core", "router"],
    ["network", "network-ring", "network-star", "network"],
    ["web", "web-browser", "web-orbit", "globe"],
    ["wired connection", "wired-plug", "wired-ports", "cable"],
    ["gateway", "gateway-bridge", "gateway-portal", "router"],
  ])(
    "provides two distinct pure %s alternatives",
    (query, first, second, original) => {
      expect(new Set([first, second, original].map(geometry)).size).toBe(3);
      for (const key of [first, second]) {
        expect(svg(key).querySelector("[data-role-frame]")).toBeNull();
        expect(
          filterConnectionIcons(query).map((entry) => entry.key),
        ).toContain(key);
      }
    },
  );
  it("keeps all 25 emoji choices separate from shapes and fruits", () => {
    expect(EMOJI_ICONS).toHaveLength(25);
    expect(
      getConnectionIconsByCategory("emojis").map(({ key }) => key),
    ).toEqual(EMOJI_ICONS.map(({ key }) => key));
    expect(EMOJI_ICONS.every(({ key }) => key.startsWith("emoji-"))).toBe(true);
    for (const key of [
      "heart",
      "star",
      "heart-filled",
      "circle",
      ...FRUIT_ICONS.map(({ key }) => key),
    ])
      expect(getConnectionIconDefinition(key)?.category).toBe("generic-shapes");
  });
  it.each([
    "Jupiter",
    "Juno",
    "Neptune",
    "Minerva",
    "Mercury",
    "Vulcan",
    "Diana",
    "Ceres",
    "Vesta",
    "Bacchus",
    "Pluto",
    "Proserpina",
    "Janus",
    "Fortuna",
  ])("finds the classical symbol by Roman name %s", (query) => {
    expect(
      filterConnectionIcons(query).some(
        ({ category }) => category === "deities-religion",
      ),
    ).toBe(true);
  });
  it("gives each pirate and deity symbol distinct geometry without duplicate React keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const entries of [PIRATE_ICONS, DEITY_RELIGION_ICONS])
        expect(new Set(entries.map(({ key }) => geometry(key))).size).toBe(
          entries.length,
        );
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
