import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { siWebmin, siCockpit, siPlesk, siCloudron } from "simple-icons";
import { ADMIN_PANEL_ICONS } from "../../src/utils/icons/catalog/adminPanels";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

describe("publisher admin-panel icons", () => {
  it("adds four missing pure marks and preserves the existing cPanel choice", () => {
    expect(ADMIN_PANEL_ICONS.map(({ key }) => key)).toEqual([
      "webmin",
      "cockpit",
      "plesk",
      "cloudron",
    ]);
    expect(getConnectionIconDefinition("cpanel")).toBeDefined();
    expect(new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
  });
  it.each(ADMIN_PANEL_ICONS)(
    "keeps $key exact, theme aware, searchable, and strictly portable",
    (entry) => {
      const reference = [siWebmin, siCockpit, siPlesk, siCloudron].find(
        ({ slug }) => slug === entry.key,
      )!;
      expect(entry.category).toBe("web-applications");
      for (const query of [
        entry.key,
        "admin panel",
        "control panel",
        "administration",
      ])
        expect(filterConnectionIcons(query).map(({ key }) => key)).toContain(
          entry.key,
        );
      for (const size of [16, 24, 32, 96])
        for (const color of ["#f8fafc", "#172033"]) {
          const svg = new DOMParser().parseFromString(
            renderToStaticMarkup(createElement(entry.icon, { size, color })),
            "image/svg+xml",
          ).documentElement;
          expect(svg.getAttribute("width")).toBe(String(size));
          expect(svg.querySelector("path")!.getAttribute("d")).toBe(
            reference.path,
          );
          expect(svg.querySelector("path")!.getAttribute("fill")).toBe(
            "currentColor",
          );
          expect(svg.getAttribute("stroke")).toBe(color);
          expect(
            svg.querySelector(
              "svg,script,foreignObject,image,text,use,mask,filter",
            ),
          ).toBeNull();
        }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(entry.key))).not.toThrow();
    },
  );
});
