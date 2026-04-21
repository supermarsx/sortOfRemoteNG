import { useMemo } from 'react';
import { SETTINGS_SEARCH_INDEX, SettingSearchEntry } from './settingsSearchIndex';

export interface SettingsSearchResult {
  results: SettingSearchEntry[];
  matchedSections: Set<string>;
  resultsBySection: Map<string, SettingSearchEntry[]>;
}

export function useSettingsSearch(query: string): SettingsSearchResult {
  return useMemo(() => {
    if (!query.trim()) {
      return { results: [], matchedSections: new Set<string>(), resultsBySection: new Map() };
    }
    const q = query.toLowerCase();
    const results = SETTINGS_SEARCH_INDEX.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.tags.some((tag) => tag.includes(q)) ||
        entry.key.toLowerCase().includes(q),
    );
    const matchedSections = new Set(results.map((r) => r.section));
    const resultsBySection = new Map<string, SettingSearchEntry[]>();
    for (const r of results) {
      const arr = resultsBySection.get(r.section) ?? [];
      arr.push(r);
      resultsBySection.set(r.section, arr);
    }
    return { results, matchedSections, resultsBySection };
  }, [query]);
}
