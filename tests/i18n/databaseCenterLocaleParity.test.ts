import { describe, expect, it } from "vitest";
import enUS from "../../src/i18n/locales/en-US.json";
import de from "../../src/i18n/locales/de-DE.json";
import es from "../../src/i18n/locales/es-ES.json";
import fr from "../../src/i18n/locales/fr-FR.json";
import itLocale from "../../src/i18n/locales/it-IT.json";
import ja from "../../src/i18n/locales/ja-JP.json";
import ko from "../../src/i18n/locales/ko-KR.json";
import ptPT from "../../src/i18n/locales/pt-PT.json";
import ru from "../../src/i18n/locales/ru-RU.json";
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

describe("databaseCenter locale parity", () => {
  const locales = {
    "de-DE": de,
    "es-ES": es,
    "fr-FR": fr,
    "it-IT": itLocale,
    "ja-JP": ja,
    "ko-KR": ko,
    "pt-PT": ptPT,
    "ru-RU": ru,
    "zh-CN": zhCN,
  } as const;

  const expectedLeafPaths = collectLeafPaths((enUS as any).databaseCenter);

  it("ships the databaseCenter namespace in every supported locale", () => {
    for (const [localeName, locale] of Object.entries(locales)) {
      expect(
        collectLeafPaths((locale as any).databaseCenter),
        localeName,
      ).toEqual(expectedLeafPaths);
    }
  });
});
