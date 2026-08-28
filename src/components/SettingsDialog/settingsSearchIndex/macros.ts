import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `macros` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const MACROS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Replay Behavior ────────────────────────────────────────────
  {
    key: "macros.defaultStepDelayMs",
    label: "Default delay between steps",
    description:
      "Time in milliseconds to wait between each step when replaying a macro. Increase for slower remote hosts.",
    tags: [
      "macro",
      "delay",
      "speed",
      "replay",
      "step",
      "milliseconds",
      "ms",
      "terminal",
      "playback",
    ],
    synonyms: ["step delay", "typing speed", "playback speed", "keystroke"],
    section: "macros",
    sectionLabel: "Macros",
  },
  {
    key: "macros.confirmBeforeReplay",
    label: "Confirm before replay",
    description:
      "Show a confirmation dialog before executing a macro to prevent accidental replay.",
    tags: [
      "macro",
      "confirm",
      "replay",
      "safety",
      "dialog",
      "prompt",
      "accidental",
    ],
    synonyms: ["are you sure", "confirmation", "playback confirm"],
    section: "macros",
    sectionLabel: "Macros",
  },

  // ─── Limits & Library ───────────────────────────────────────────
  {
    key: "macros.maxMacroSteps",
    label: "Max steps per macro",
    description:
      "Upper limit on the number of recorded steps in a single macro. Prevents excessively large recordings.",
    tags: ["macro", "limit", "steps", "count", "max", "recording", "size"],
    synonyms: ["macro length", "step limit", "recording limit"],
    section: "macros",
    sectionLabel: "Macros",
  },
];
