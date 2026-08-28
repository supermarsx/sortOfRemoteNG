import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `recovery` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const RECOVERY_SEARCH_ENTRIES: SettingSearchEntry[] = [];
