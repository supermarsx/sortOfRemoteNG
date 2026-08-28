import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `proxy` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const PROXY_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Proxy ──────────────────────────────────────────────────────
  {
    key: "globalProxy",
    label: "Global Proxy",
    description: "Global proxy settings",
    tags: ["proxy", "socks", "http proxy", "tunnel"],
    section: "proxy",
    sectionLabel: "Proxy",
  },
];
