import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { SCRIPT_LANGUAGE_ICONS } from "../../src/utils/icons/catalog/scriptLanguages";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import {
  OS_TAG_LABELS,
  OS_TAG_ICONS,
  languageIcons,
} from "../../src/components/recording/scriptManager/shared";
import {
  platformIcon,
  scriptLanguageIcon,
} from "../../src/components/recording/scriptManager/scriptMetadataIcons";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ saveIconLibrary: vi.fn() }) },
}));
beforeEach(() => publishIconLibrary(undefined, { ready: true }));
describe("central script language and platform vectors", () => {
  it.each(["bash", "sh", "batch", "javascript", "python", "perl"])(
    "renders %s as a passive theme-aware distinct vector and strict SVG roundtrip",
    (key) => {
      const entry = getConnectionIconDefinition(key)!;
      expect(entry.category).toBe("devops-monitoring");
      expect(filterConnectionIcons(key).some((icon) => icon.key === key)).toBe(
        true,
      );
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        for (const size of [16, 24, 32, 96]) {
          const svg = renderToStaticMarkup(
            createElement(entry.icon, { size, color: "#abcdef" }),
          );
          expect(svg).toContain('viewBox="0 0 24 24"');
          expect(svg).toContain(`width="${size}"`);
          expect(svg).not.toMatch(
            /<(?:text|image|mask|use|script|foreignObject)\b|href=|url\(/i,
          );
        }
        expect(error).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
      const parsed = parsePassiveSvg(exportLibrarySvg(key));
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
    },
  );
  it("keeps platform coverage and every language lookup in the same central collection without emoji", () => {
    for (const key of Object.values(OS_TAG_ICONS))
      expect(getConnectionIconDefinition(key)).toBeDefined();
    for (const key of Object.values(languageIcons))
      expect(getConnectionIconDefinition(key)).toBeDefined();
    for (const tag of Object.keys(
      OS_TAG_LABELS,
    ) as (keyof typeof OS_TAG_LABELS)[])
      expect(platformIcon(tag)).toBe(
        getConnectionIconDefinition(OS_TAG_ICONS[tag])?.icon,
      );
    expect(scriptLanguageIcon("powershell")).toBe(
      getConnectionIconDefinition("powershell")?.icon,
    );
    expect(
      new Set(
        SCRIPT_LANGUAGE_ICONS.map((entry) =>
          renderToStaticMarkup(createElement(entry.icon)),
        ),
      ).size,
    ).toBe(6);
  });
});
