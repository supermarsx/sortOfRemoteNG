import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `ai` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const AI_SEARCH_ENTRIES: SettingSearchEntry[] = [];
