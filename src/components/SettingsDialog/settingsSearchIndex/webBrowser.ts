import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `webBrowser` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const WEB_BROWSER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Internal Proxy Keepalive ───────────────────────────────────
  {
    key: "proxyKeepaliveEnabled",
    label: "Enable proxy health checks",
    description:
      "Periodically verify the local authentication proxy is still alive and responsive.",
    tags: [
      "proxy",
      "keepalive",
      "health",
      "check",
      "browser",
      "authentication",
      "alive",
      "probe",
    ],
    synonyms: [
      "keep alive",
      "health check",
      "dead proxy",
      "auth proxy",
      "internal proxy",
    ],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "proxyKeepaliveIntervalSeconds",
    label: "Health-check interval",
    description:
      "How often, in seconds, the proxy port is probed to verify it is still responding.",
    tags: [
      "proxy",
      "keepalive",
      "interval",
      "seconds",
      "timer",
      "probe",
      "port",
      "health",
    ],
    synonyms: ["keep alive interval", "probe interval", "proxy port"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "proxyAutoRestart",
    label: "Auto-restart dead proxies",
    description:
      "Automatically restart the local proxy process when a health check detects it has stopped responding.",
    tags: [
      "proxy",
      "restart",
      "auto",
      "recover",
      "dead",
      "health",
      "browser",
      "process",
    ],
    synonyms: ["auto restart", "self healing", "restart proxy", "recovery"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
  {
    key: "proxyMaxAutoRestarts",
    label: "Max consecutive auto-restarts",
    description:
      "Stop auto-restarting the proxy after this many consecutive failed attempts. Set to 0 for unlimited retries.",
    tags: [
      "proxy",
      "restart",
      "max",
      "limit",
      "attempts",
      "consecutive",
      "unlimited",
      "retries",
    ],
    synonyms: ["restart limit", "give up", "0 = unlimited"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },

  // ─── Bookmarks ──────────────────────────────────────────────────
  {
    key: "confirmDeleteAllBookmarks",
    label: "Confirm before deleting all bookmarks",
    description:
      "Show a confirmation dialog before clearing all saved bookmarks for a web browser connection.",
    tags: [
      "bookmarks",
      "delete",
      "confirm",
      "clear",
      "browser",
      "favorites",
      "safety",
    ],
    synonyms: ["favourites", "favorites", "clear bookmarks", "are you sure"],
    section: "webBrowser",
    sectionLabel: "Web Browser",
  },
];
