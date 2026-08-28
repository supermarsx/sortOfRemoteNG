import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `api` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const API_SEARCH_ENTRIES: SettingSearchEntry[] = [];
