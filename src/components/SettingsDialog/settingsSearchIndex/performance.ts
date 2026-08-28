import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `performance` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const PERFORMANCE_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Performance ────────────────────────────────────────────────
  {
    key: "maxConcurrentConnections",
    label: "Max Concurrent Connections",
    description: "Maximum simultaneous connections",
    tags: ["limit", "concurrent", "connections", "parallel"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "connectionTimeout",
    label: "Connection Timeout",
    description: "Connection timeout in milliseconds",
    tags: ["timeout", "connect", "wait"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "retryAttempts",
    label: "Retry Attempts",
    description: "Number of connection retry attempts",
    tags: ["retry", "reconnect", "attempts"],
    section: "performance",
    sectionLabel: "Performance",
  },
  {
    key: "retryDelay",
    label: "Retry Delay",
    description: "Delay between retry attempts",
    tags: ["retry", "delay", "wait"],
    section: "performance",
    sectionLabel: "Performance",
  },
];
