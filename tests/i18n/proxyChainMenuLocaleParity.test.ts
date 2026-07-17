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

function collectLeafEntries(
  value: unknown,
  prefix = "",
): Array<[string, string]> {
  if (typeof value === "string") {
    return prefix ? [[prefix, value]] : [];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) =>
      collectLeafEntries(child, prefix ? `${prefix}.${key}` : key),
  );
}

function interpolations(source: string): string[] {
  return (source.match(/\{\{\s*\w+\s*\}\}/g) ?? [])
    .map((token) => token.replace(/\s/g, ""))
    .sort();
}

describe("proxyChainMenu locale parity", () => {
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

  const expectedLeafPaths = collectLeafPaths((enUS as any).proxyChainMenu);

  it("ships a non-empty proxyChainMenu namespace in en", () => {
    expect(expectedLeafPaths.length).toBeGreaterThan(0);
  });

  it("ships the proxyChainMenu namespace in every supported locale", () => {
    for (const [localeName, locale] of Object.entries(locales)) {
      expect(
        collectLeafPaths((locale as any).proxyChainMenu),
        localeName,
      ).toEqual(expectedLeafPaths);
    }
  });

  it("preserves every {{interpolation}} token in every locale", () => {
    const expected = new Map(
      collectLeafEntries((enUS as any).proxyChainMenu).map(([key, value]) => [
        key,
        interpolations(value),
      ]),
    );

    for (const [localeName, locale] of Object.entries(locales)) {
      for (const [key, value] of collectLeafEntries(
        (locale as any).proxyChainMenu,
      )) {
        expect(interpolations(value), `${localeName}: ${key}`).toEqual(
          expected.get(key),
        );
      }
    }
  });

  it("never leaves a blank string in a locale", () => {
    for (const [localeName, locale] of Object.entries(locales)) {
      for (const [key, value] of collectLeafEntries(
        (locale as any).proxyChainMenu,
      )) {
        expect(value.trim(), `${localeName}: ${key}`).not.toBe("");
      }
    }
  });

  it("reuses the frozen proxyChainMenu.common.* verbs in every locale", () => {
    const commonKeys = collectLeafPaths((enUS as any).proxyChainMenu.common);
    expect(commonKeys).toContain("connect");
    expect(commonKeys).toContain("delete");

    for (const [localeName, locale] of Object.entries(locales)) {
      expect(
        collectLeafPaths((locale as any).proxyChainMenu.common),
        localeName,
      ).toEqual(commonKeys);
    }
  });
});
