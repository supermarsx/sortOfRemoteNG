import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `rdpDefaults` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const RDP_DEFAULTS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── RDP Defaults ───────────────────────────────────────────────
  {
    key: "rdpDefaults",
    label: "RDP Defaults",
    description: "Default RDP connection settings",
    tags: ["rdp", "remote desktop", "default", "resolution", "color depth"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
];
