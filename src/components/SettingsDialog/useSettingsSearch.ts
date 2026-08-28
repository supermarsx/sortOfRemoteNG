import { useMemo } from "react";
import {
  SETTINGS_SEARCH_INDEX,
  type SettingSearchEntry,
} from "./settingsSearchIndex";
import {
  matchSettingsEntries,
  type SettingsTranslate,
} from "./settingsSearchMatch";

export type { SettingSearchEntry };

export interface SettingsSearchResult {
  results: SettingSearchEntry[];
  matchedSections: Set<string>;
  resultsBySection: Map<string, SettingSearchEntry[]>;
}

const EMPTY: SettingsSearchResult = {
  results: [],
  matchedSections: new Set<string>(),
  resultsBySection: new Map<string, SettingSearchEntry[]>(),
};

/**
 * Ranked settings search.
 *
 * `t` is optional and additive: passing it lets the matcher also search the
 * *translated* label/description of entries that carry `labelKey`/`descriptionKey`,
 * so a user searching in the UI language matches too. English always stays in the
 * haystack, which is the right behaviour for a sysadmin tool whose vendor terms
 * ("CredSSP", "WireGuard", "AES-256-GCM") are English in every locale.
 */
export function useSettingsSearch(
  query: string,
  t?: SettingsTranslate,
): SettingsSearchResult {
  return useMemo(() => {
    if (!query.trim()) return EMPTY;

    const results = matchSettingsEntries(SETTINGS_SEARCH_INDEX, query, { t });
    const matchedSections = new Set(results.map((r) => r.section));
    const resultsBySection = new Map<string, SettingSearchEntry[]>();
    for (const r of results) {
      const arr = resultsBySection.get(r.section) ?? [];
      arr.push(r);
      resultsBySection.set(r.section, arr);
    }
    return { results, matchedSections, resultsBySection };
  }, [query, t]);
}
