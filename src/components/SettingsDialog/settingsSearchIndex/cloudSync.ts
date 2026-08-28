import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `cloudSync` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const CLOUD_SYNC_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Cloud Sync ─────────────────────────────────────────────────
  {
    key: "cloudSync",
    label: "Cloud Sync",
    description: "Cloud synchronization settings",
    tags: ["cloud", "sync", "remote", "github", "gist", "s3"],
    section: "cloudSync",
    sectionLabel: "Cloud Sync",
  },
];
