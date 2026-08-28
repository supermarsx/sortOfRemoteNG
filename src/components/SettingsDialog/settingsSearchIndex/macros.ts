import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `macros` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const MACROS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Macros ─────────────────────────────────────────────────────
  {
    key: "macros.defaultStepDelayMs",
    label: "Default Step Delay",
    description: "Default delay between macro steps",
    tags: ["macro", "delay", "speed", "replay"],
    section: "macros",
    sectionLabel: "Macros",
  },
  {
    key: "macros.confirmBeforeReplay",
    label: "Confirm Before Replay",
    description: "Show confirmation before replaying macros",
    tags: ["macro", "confirm", "replay", "safety"],
    section: "macros",
    sectionLabel: "Macros",
  },
  {
    key: "macros.maxMacroSteps",
    label: "Max Macro Steps",
    description: "Maximum steps per macro",
    tags: ["macro", "limit", "steps", "count"],
    section: "macros",
    sectionLabel: "Macros",
  },
];
