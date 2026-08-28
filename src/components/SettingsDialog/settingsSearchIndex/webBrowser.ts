import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `webBrowser` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const WEB_BROWSER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Web Browser ────────────────────────────────────────────────
  {
    key: "proxyKeepaliveEnabled",
    label: "Proxy Keepalive",
    description: "Enable proxy connection keepalive",
    tags: ["proxy", "keepalive", "ping", "connection"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "proxyKeepaliveIntervalSeconds",
    label: "Keepalive Interval",
    description: "Proxy keepalive interval in seconds",
    tags: ["proxy", "keepalive", "interval", "timer"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "confirmDeleteAllBookmarks",
    label: "Confirm Delete Bookmarks",
    description: "Confirm before deleting all bookmarks",
    tags: ["bookmarks", "delete", "confirm"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
];
