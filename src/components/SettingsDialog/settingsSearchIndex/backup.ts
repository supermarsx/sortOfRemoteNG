import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `backup` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const BACKUP_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Backup ─────────────────────────────────────────────────────
  {
    key: "backup",
    label: "Backup",
    description: "Backup configuration",
    tags: ["backup", "save", "export", "restore", "schedule"],
    section: "backup",
    sectionLabel: "Backup",
  },
];
