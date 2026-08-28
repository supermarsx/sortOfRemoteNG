import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `updater` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const UPDATER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Updater ────────────────────────────────────────────────────
  {
    key: "updater.status",
    label: "Updater Status",
    description: "Current application update status",
    tags: ["update", "updater", "version", "release"],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.autoCheckEnabled",
    label: "Auto-check Updates",
    description: "Automatically check for signed updates",
    tags: ["update", "automatic", "check", "cadence"],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.checkIntervalHours",
    label: "Update Check Interval",
    description: "Hours between automatic update checks",
    tags: ["update", "interval", "hours", "schedule"],
    section: "updater",
    sectionLabel: "Updater",
  },
  {
    key: "updater.privateEndpointUrl",
    label: "Private Update Endpoint",
    description: "Private signed update feed URL",
    tags: ["update", "private", "feed", "endpoint", "enterprise"],
    section: "updater",
    sectionLabel: "Updater",
  },
];
