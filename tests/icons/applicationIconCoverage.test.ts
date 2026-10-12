import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";
import { HTTP_APPLICATION_PROFILES } from "../../src/utils/connection/httpApplicationProfiles";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import {
  getHttpApplicationIconSuggestion,
  HTTP_APPLICATION_ICON_SUGGESTIONS,
} from "../../src/utils/icons/httpApplicationIconSuggestions";

/**
 * Profiles that name no product (`custom`, `generic-form`, `http-basic`,
 * `http-digest`) or combine two (`lxd` is LXD / Incus): a neutral glyph is the
 * intended suggestion. Every other selectable application suggests an icon of
 * its own. A new profile belongs here only for one of those two reasons.
 */
const GENERIC_BY_DESIGN = [
  "custom",
  "generic-form",
  "http-basic",
  "http-digest",
  "lxd",
] as const;

/**
 * A generic glyph is an unmodified lucide-react export. Brand marks, role
 * composites and app-authored identifiers are components this app builds, so
 * the rule needs no list of "generic" keys that could fall out of date.
 */
const STOCK_LUCIDE_EXPORTS = new Set<unknown>(Object.values(lucide));

const selectable = HTTP_APPLICATION_PROFILES.filter(
  (profile) => profile.capability !== "none",
);
const suggestionFor = (id: string) =>
  getHttpApplicationIconSuggestion({
    protocol: "https",
    httpApplication: { version: 1, id, loginMode: "manual" },
  })?.icon;
const suggestsGenericGlyph = (id: string) =>
  STOCK_LUCIDE_EXPORTS.has(suggestionFor(id)?.icon);

describe("application icon coverage", () => {
  it("suggests an icon of its own for every supported application", () => {
    const lacking = selectable
      .filter(
        ({ id }) =>
          !(GENERIC_BY_DESIGN as readonly string[]).includes(id) &&
          suggestsGenericGlyph(id),
      )
      .map(({ id }) => `${id} -> ${suggestionFor(id)?.key}`);
    expect(lacking).toEqual([]);
  });

  it("keeps the neutral-by-design allowlist exact", () => {
    expect(GENERIC_BY_DESIGN).toHaveLength(5);
    for (const id of GENERIC_BY_DESIGN) {
      expect(
        selectable.some((profile) => profile.id === id),
        `${id} is not a selectable application`,
      ).toBe(true);
      // An entry must not outlive its reason: once a profile gets an icon of
      // its own, it leaves the allowlist.
      expect(suggestsGenericGlyph(id), `${id} no longer needs an entry`).toBe(
        true,
      );
    }
  });

  it("maps every selectable application explicitly, never through the fallback", () => {
    const suggestions: Readonly<Record<string, string>> =
      HTTP_APPLICATION_ICON_SUGGESTIONS;
    for (const { id } of selectable) {
      expect(
        Object.prototype.hasOwnProperty.call(suggestions, id),
        `${id} has no suggestion`,
      ).toBe(true);
      const definition = getConnectionIconDefinition(suggestions[id]);
      expect(definition, `${id} suggests an unknown key`).toBeDefined();
      expect(suggestionFor(id)).toBe(definition);
    }
  });
});
