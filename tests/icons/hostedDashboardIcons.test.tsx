import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  siYoutube,
  siIcloud,
  siClaude,
  siOpenrouter,
  siFacebook,
  siInstagram,
  siGmail,
  siGoogleanalytics,
  siGoogleads,
  siGooglesearchconsole,
} from "simple-icons";
import {
  HOSTED_DASHBOARD_ICONS,
  HOSTED_REGISTRAR_ICONS,
} from "../../src/utils/icons/catalog/hostedDashboards";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

const added = [...HOSTED_DASHBOARD_ICONS, ...HOSTED_REGISTRAR_ICONS];
const references = {
  youtube: siYoutube,
  icloud: siIcloud,
  claude: siClaude,
  openrouter: siOpenrouter,
  facebook: siFacebook,
  instagram: siInstagram,
  gmail: siGmail,
  "google-analytics": siGoogleanalytics,
  "google-ads": siGoogleads,
  "google-search-console": siGooglesearchconsole,
};

describe("dashboard pure vector identifiers", () => {
  it("adds only missing keys, reuses Zoom and keeps the full catalogue unique", () => {
    expect(added).toHaveLength(14);
    expect(new Set(CONNECTION_ICON_CATALOG.map((e) => e.key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
    expect(
      CONNECTION_ICON_CATALOG.filter((e) => e.key === "zoom"),
    ).toHaveLength(1);
    for (const key of [
      "adobe",
      "youtube",
      "zoom",
      "icloud",
      "marcaria",
      "freedns",
      "registro-br",
    ])
      expect(getConnectionIconDefinition(key)).toBeDefined();
  });
  it.each(added)(
    "$key is searchable, passive, theme-aware and portable",
    (entry) => {
      expect(
        filterConnectionIcons(entry.label).some((e) => e.key === entry.key),
      ).toBe(true);
      for (const size of [16, 24, 32, 96])
        for (const color of ["#f8fafc", "#172033"]) {
          const svg = new DOMParser().parseFromString(
            renderToStaticMarkup(createElement(entry.icon, { size, color })),
            "image/svg+xml",
          ).documentElement;
          expect(svg.getAttribute("width")).toBe(String(size));
          expect(svg.getAttribute("stroke")).toBe(color);
          expect(
            svg.querySelector(
              "script,image,foreignObject,text,use,style,mask,filter",
            ),
          ).toBeNull();
          const ref = references[entry.key as keyof typeof references];
          if (ref) {
            expect(svg.querySelector("path")?.getAttribute("d")).toBe(ref.path);
            expect(svg.querySelector("path")?.getAttribute("fill")).toBe(
              "currentColor",
            );
          }
          for (const element of svg.querySelectorAll("*"))
            for (const attr of element.attributes)
              expect(attr.name).not.toMatch(/^on|href$/);
        }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(entry.key))).not.toThrow();
    },
  );
  it("states identifier fallback provenance and preserves the verified publisher contours", () => {
    expect(getConnectionIconDefinition("marcaria")?.description).toMatch(
      /App-authored.*not an official/,
    );
    expect(getConnectionIconDefinition("freedns")?.description).toMatch(
      /App-authored.*not an official/,
    );
    const svg = (key: string) =>
      new DOMParser().parseFromString(
        renderToStaticMarkup(
          createElement(getConnectionIconDefinition(key)!.icon),
        ),
        "image/svg+xml",
      );
    expect(svg("adobe").querySelector("path")?.getAttribute("d")).toBe(
      "M6.27,10.22h4.39l6.2,14.94h-4.64l-3.92-9.92-2.59,6.51h3.08l1.23,3.41H0l6.27-14.94Z",
    );
    expect(
      svg("registro-br").querySelector("path")?.getAttribute("d"),
    ).toContain("M82.9 1.4c-.1.6-.2 51.7-.3 113.6");
    expect(
      svg("registro-br").querySelector("path")?.getAttribute("transform"),
    ).toBe("scale(0.07384615384615385)");
  });
});
