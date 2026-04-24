import { describe, expect, it } from "vitest";
import en from "../../src/i18n/locales/en.json";
import de from "../../src/i18n/locales/de.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import it from "../../src/i18n/locales/it.json";
import ja from "../../src/i18n/locales/ja.json";
import ko from "../../src/i18n/locales/ko.json";
import ptPT from "../../src/i18n/locales/pt-PT.json";
import ru from "../../src/i18n/locales/ru.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      collectLeafPaths(child, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

describe("collectionCenter locale parity", () => {
  const locales = {
    de,
    es,
    fr,
    it,
    ja,
    ko,
    "pt-PT": ptPT,
    ru,
    "zh-CN": zhCN,
  } as const;

  const expectedLeafPaths = collectLeafPaths((en as any).collectionCenter);

  it("ships the collectionCenter namespace in every supported locale", () => {
    for (const [localeName, locale] of Object.entries(locales)) {
      expect(collectLeafPaths((locale as any).collectionCenter), localeName).toEqual(
        expectedLeafPaths,
      );
    }
  });
});