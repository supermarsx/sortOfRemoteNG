import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `backend` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const BACKEND_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Backend ────────────────────────────────────────────────────
  {
    key: "backendConfig",
    label: "Backend Config",
    description: "Backend service configuration",
    tags: ["backend", "service", "server", "config"],
    section: "backend",
    sectionLabel: "Backend",
  },
];
