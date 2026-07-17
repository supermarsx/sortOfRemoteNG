import { describe, expect, it } from "vitest";
import enUS from "../../src/i18n/locales/en-US.json";
import deDE from "../../src/i18n/locales/de-DE.json";
import esES from "../../src/i18n/locales/es-ES.json";
import frFR from "../../src/i18n/locales/fr-FR.json";
import itIT from "../../src/i18n/locales/it-IT.json";
import jaJP from "../../src/i18n/locales/ja-JP.json";
import koKR from "../../src/i18n/locales/ko-KR.json";
import ptPT from "../../src/i18n/locales/pt-PT.json";
import ruRU from "../../src/i18n/locales/ru-RU.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import acceptedIdentical from "./acceptedIdentical.json";
import glossary from "../../src/i18n/glossary.json";

// The canonical locale set. en-US is the source of truth every other locale mirrors.
const nonEnLocales = {
  "de-DE": deDE,
  "es-ES": esES,
  "fr-FR": frFR,
  "it-IT": itIT,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "pt-PT": ptPT,
  "ru-RU": ruRU,
  "zh-CN": zhCN,
} as const;

const allLocales = { "en-US": enUS, ...nonEnLocales } as const;

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

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const enLeafPaths = collectLeafPaths(enUS);
const enEntries = new Map(collectLeafEntries(enUS));
const accepted = acceptedIdentical as Record<string, string[]>;

// integrations.* is a self-contained, never-translated namespace deferred to a
// later programme (t52+). It is intentionally excluded from the ratchet so the
// gate tracks the surface t51 actually repaired; its rot is tracked separately.
const DEFERRED_PREFIX = "integrations.";

describe("repo-wide locale parity + translation ratchet", () => {
  it("ships a large, non-empty en-US leaf set (guards against vacuous parity)", () => {
    expect(enLeafPaths.length).toBeGreaterThan(7000);
  });

  it("gives every locale exactly the en-US leaf set", () => {
    for (const [name, locale] of Object.entries(nonEnLocales)) {
      expect(collectLeafPaths(locale), name).toEqual(enLeafPaths);
    }
  });

  it("preserves every {{interpolation}} token per key in every locale", () => {
    for (const [name, locale] of Object.entries(nonEnLocales)) {
      for (const [key, value] of collectLeafEntries(locale)) {
        expect(interpolations(value), `${name}: ${key}`).toEqual(
          interpolations(enEntries.get(key) ?? ""),
        );
      }
    }
  });

  it("never leaves a blank or whitespace-only value in any locale", () => {
    for (const [name, locale] of Object.entries(allLocales)) {
      for (const [key, value] of collectLeafEntries(locale)) {
        expect(value.trim(), `${name}: ${key}`).not.toBe("");
      }
    }
  });

  it("exposes no _-prefixed metadata key as a translatable leaf", () => {
    for (const [name, locale] of Object.entries(allLocales)) {
      for (const key of collectLeafPaths(locale)) {
        const leaked = key
          .split(".")
          .some((segment) => segment.startsWith("_"));
        expect(leaked, `${name}: ${key}`).toBe(false);
      }
    }
  });

  // THE RATCHET. Every leaf whose value still equals en-US must be a member of
  // the frozen acceptedIdentical.json baseline for that locale (proper nouns,
  // acronyms, unit/format strings, CJK Latin passthrough, and keys pending a
  // later translation wave). A NEW value that regresses to English — one not in
  // the baseline — fails here. Regenerating the baseline is a deliberate,
  // reviewable act, never an automatic side effect.
  it("adds no untranslated value beyond the frozen acceptedIdentical baseline", () => {
    for (const [name, locale] of Object.entries(nonEnLocales)) {
      const baseline = new Set(accepted[name] ?? []);
      const offenders: string[] = [];
      for (const [key, value] of collectLeafEntries(locale)) {
        if (key.startsWith(DEFERRED_PREFIX)) continue;
        if (value === enEntries.get(key) && !baseline.has(key)) {
          offenders.push(key);
        }
      }
      expect(
        offenders,
        `${name}: value equals en-US but is not in acceptedIdentical.json`,
      ).toEqual([]);
    }
  });

  // ASCII-mangled German (umlaut/eszett digraphs never restored, e.g. "Loeschen",
  // "Zuruecksetzen", "moechten") is a de-only class with a known systemic origin.
  // Stems come from glossary.mangledDe.stems, minus "breit": that stem
  // false-positive-matches correct German "Breite"/"Bandbreite" (e.g.
  // rdpInternals.bandwidth = "Bandbreite"), so including it would fail the gate on
  // correct text. "moecht" IS included (locks the two dialogs fixed in t51-b-de).
  it("has no ASCII-mangled German in de-DE", () => {
    const stems = (
      glossary as { mangledDe: { stems: string[] } }
    ).mangledDe.stems.filter((stem) => stem !== "breit");
    const mangled = new RegExp(`(${stems.map(escapeRegExp).join("|")})`, "i");
    for (const [key, value] of collectLeafEntries(deDE)) {
      expect(
        mangled.test(value),
        `de-DE: ASCII-mangled German at ${key}: ${value}`,
      ).toBe(false);
    }
  });
});
