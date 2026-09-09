import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PIRATE_ICONS } from "../../src/utils/icons/catalog/pirates";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";

const additions = [
  ["pirate-parrot", "parrot"],
  ["pirate-eyepatch", "eye patch"],
  ["pirate-spyglass", "telescope"],
  ["pirate-ship-wheel", "helm"],
  ["pirate-rum-barrel", "grog"],
  ["pirate-doubloon", "gold coin"],
  ["pirate-island", "palm tree"],
  ["pirate-message-bottle", "message in a bottle"],
  ["pirate-cannon", "broadside"],
  ["pirate-kraken", "sea monster"],
  ["pirate-captain", "corsair"],
  ["pirate-crossed-cutlasses", "crossed swords"],
] as const;

describe("twelve additional pirate adventure icons", () => {
  it("keeps the original ten keys and adds twelve distinct silhouettes", () => {
    expect(PIRATE_ICONS).toHaveLength(22);
    expect(PIRATE_ICONS.slice(0, 10).map(({ key }) => key)).toEqual([
      "pirate-skull",
      "pirate-flag",
      "pirate-tricorn",
      "pirate-ship",
      "pirate-treasure",
      "pirate-cutlass",
      "pirate-hook",
      "pirate-map",
      "pirate-anchor",
      "pirate-compass",
    ]);
    const geometries = PIRATE_ICONS.map(({ icon }) => {
      const svg = new DOMParser().parseFromString(
        renderToStaticMarkup(createElement(icon)),
        "image/svg+xml",
      );
      return Array.from(svg.querySelectorAll("path"))
        .map((node) => node.getAttribute("d"))
        .join("|");
    });
    expect(new Set(geometries).size).toBe(22);
  });
  it.each(additions)(
    "persists and discovers %s through its %s alias",
    (key, alias) => {
      const entry = getConnectionIconDefinition(key)!;
      expect(entry.category).toBe("pirates");
      expect(filterConnectionIcons(alias).map((icon) => icon.key)).toContain(
        key,
      );
      const restored = JSON.parse(
        JSON.stringify({ protocol: "ssh", icon: key }),
      );
      expect(resolveEffectiveConnectionIcon(restored)).toMatchObject({
        key,
        source: "override",
      });
      for (const size of [16, 24, 32, 96]) {
        const svg = new DOMParser().parseFromString(
          renderToStaticMarkup(
            createElement(entry.icon, {
              size,
              color: "#765abc",
              "aria-label": entry.ariaLabel,
            }),
          ),
          "image/svg+xml",
        ).documentElement;
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("stroke")).toBe("#765abc");
        expect(svg.getAttribute("aria-label")).toBe(entry.ariaLabel);
        expect(
          svg.querySelector("script,image,use,foreignObject,text,mask,style"),
        ).toBeNull();
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(key))).not.toThrow();
    },
  );
});
