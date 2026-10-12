import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_PORTAL_ICONS } from "../../src/utils/icons/catalog/applicationPortals";
import {
  APPLICATION_PORTAL_IDENTIFIER_ICONS,
  BRAND_ICONS,
  HISTORICAL_BRAND_ICONS,
} from "../../src/utils/icons/brand";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveIconLibrary: () => {
        throw new Error("Read-only icon fixture must not write settings");
      },
    }),
  },
}));

/** Persisted values: a key may gain different artwork, never another name. */
const KEYS = [
  "arlo",
  "autoridade-tributaria",
  "brevo",
  "chatgpt",
  "e-redes",
  "ebay",
  "google-adsense",
  "google-forms",
  "google-gemini",
  "google-play",
  "guacamole",
  "imt",
  "irn",
  "kimi",
  "lovable",
  "notion",
  "npm",
  "pypi",
  "reddit",
  "seguranca-social",
  "steam",
  "tesla",
  "uptime-kuma",
  "vaultwarden",
  "via-verde",
  "x",
  "youtube-studio",
  "zabbix",
] as const;
const THEME_COLORS = ["#f8fafc", "#172033"] as const;

// What an entry is follows from where its artwork is registered, not from a
// list in this file, so giving an application different artwork needs no edit
// here: an app-authored identifier is registered under its own catalog key;
// everything else must be a mark in the brand registry.
const identifiers: Readonly<Record<string, unknown>> =
  APPLICATION_PORTAL_IDENTIFIER_ICONS;
const brandMarks = new Set<unknown>(Object.values(BRAND_ICONS));
const historicalMarks = new Set<unknown>(Object.values(HISTORICAL_BRAND_ICONS));
const isIdentifier = (entry: (typeof APPLICATION_PORTAL_ICONS)[number]) =>
  identifiers[entry.key] === entry.icon;

function render(
  entry: (typeof APPLICATION_PORTAL_ICONS)[number],
  props: { size?: number; color?: string } = {},
) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, props)),
    "image/svg+xml",
  ).documentElement;
}

beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("application portal icons", () => {
  it("registers each key once, in the web applications category", () => {
    expect(APPLICATION_PORTAL_ICONS.map((entry) => entry.key).sort()).toEqual([
      ...KEYS,
    ]);
    const catalogKeys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    for (const entry of APPLICATION_PORTAL_ICONS) {
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
      expect(entry.category).toBe("web-applications");
    }
  });

  it("gives every key artwork of its own", () => {
    const geometry = APPLICATION_PORTAL_ICONS.map(
      (entry) => render(entry).querySelector("path")?.getAttribute("d") ?? "",
    );
    expect(geometry.every((d) => d.length > 0)).toBe(true);
    expect(new Set(geometry).size).toBe(APPLICATION_PORTAL_ICONS.length);
  });

  it.each(APPLICATION_PORTAL_ICONS)(
    "$key is searchable, passive, theme-aware and portable",
    (entry) => {
      expect(
        filterConnectionIcons(entry.label).map((found) => found.key),
      ).toContain(entry.key);
      expect(render(entry).outerHTML).toContain("currentColor");
      for (const size of [16, 24, 32, 96])
        for (const color of THEME_COLORS) {
          const svg = render(entry, { size, color });
          expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
          expect(svg.getAttribute("width")).toBe(String(size));
          expect(svg.getAttribute("height")).toBe(String(size));
          expect(svg.getAttribute("stroke")).toBe(color);
          // One passive path and nothing else.
          expect(Array.from(svg.children, (child) => child.tagName)).toEqual([
            "path",
          ]);
          expect(
            svg.querySelector(
              "script,image,foreignObject,text,use,style,mask,filter,a",
            ),
          ).toBeNull();
          for (const element of [svg, ...svg.querySelectorAll("*")])
            for (const attr of element.attributes) {
              expect(attr.name).not.toMatch(/^on|href$|^style$/);
              // The only paint is the theme's: no colour ships in the artwork.
              if (attr.name === "fill" || attr.name === "stroke")
                expect(["none", "currentColor", color]).toContain(attr.value);
            }
        }
      const exported = parsePassiveSvg(exportLibrarySvg(entry.key));
      expect(parsePassiveSvg(serializePassiveSvg(exported))).toEqual(exported);
      expect(exported.attrs.viewBox).toBe("0 0 24 24");
      expect(exported.children.map((child) => child.tag)).toEqual(["path"]);
      expect(exported.children[0].attrs.d).toBe(
        render(entry).querySelector("path")?.getAttribute("d"),
      );
    },
  );

  it.each(APPLICATION_PORTAL_ICONS)(
    "$key says what its artwork is",
    (entry) => {
      const claimsAppAuthored = /App-authored.*not an official/.test(
        entry.description,
      );
      // Exactly one of: a registered app-authored identifier that says it is
      // not the official logo, or a mark from the brand registry that does not
      // claim to be app-authored.
      expect(claimsAppAuthored).toBe(isIdentifier(entry));
      expect(brandMarks.has(entry.icon)).toBe(!isIdentifier(entry));
      if (historicalMarks.has(entry.icon))
        expect(entry.description).toMatch(/historical.*not current/);
    },
  );

  it("keeps the app-authored identifiers out of the brand registry", () => {
    const keys = APPLICATION_PORTAL_ICONS.map((entry) => entry.key as string);
    for (const [key, icon] of Object.entries(identifiers)) {
      expect(keys, `${key} is not a catalog key of this module`).toContain(key);
      expect(brandMarks.has(icon), `${key} must not be a brand mark`).toBe(
        false,
      );
    }
  });

  it.each(KEYS)("resolves a saved %s selection to the same key", (key) => {
    for (const saved of [key, ` ${key.toUpperCase()} `])
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "https", icon: saved })),
        ),
      ).toMatchObject({ key, source: "override", overrideState: "valid" });
  });
});
