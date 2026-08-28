import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `general` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const GENERAL_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── General ────────────────────────────────────────────────────
  {
    key: "autoSaveEnabled",
    label: "Auto Save",
    description: "Automatically save connections",
    tags: ["save", "persist", "automatic"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "autoSaveIntervalMinutes",
    label: "Auto Save Interval",
    description: "Minutes between auto saves",
    tags: ["save interval", "timer"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "warnOnClose",
    label: "Warn on Close",
    description: "Show warning when closing tabs",
    tags: ["close warning", "confirm close"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "warnOnExit",
    label: "Warn on Exit",
    description: "Show warning when exiting application",
    tags: ["exit warning", "confirm exit", "quit"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "warnOnDetachClose",
    label: "Warn on Detach Close",
    description: "Warn when closing detached windows",
    tags: ["detach", "popup", "floating"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "quickConnectHistoryEnabled",
    label: "Quick Connect History",
    description: "Remember quick connect entries",
    tags: ["history", "recent", "quick connect"],
    section: "general",
    sectionLabel: "General",
  },
  // Settings Dialog (lives in General)
  {
    key: "hostnameOverride",
    label: "Override Tab Names with Hostname",
    description: "Show server hostname instead of connection name in tabs",
    tags: ["tab", "name", "hostname", "title"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "detectUnexpectedClose",
    label: "Detect Unexpected Close",
    description: "Show recovery options after an unexpected app close",
    tags: ["crash", "recovery", "unexpected", "close", "diagnostics"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "settingsDialog.autoSave",
    label: "Auto-save Settings",
    description: "Automatically save settings changes",
    tags: ["auto", "save", "settings", "dialog", "debounce"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "settingsDialog.showSaveButton",
    label: "Show Save Button",
    description: "Show manual save button in the settings footer",
    tags: ["save", "button", "settings", "dialog", "manual"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "settingsDialog.confirmBeforeReset",
    label: "Confirm Before Reset",
    description: "Show confirmation before resetting tab settings to defaults",
    tags: ["confirm", "reset", "defaults", "settings", "dialog"],
    section: "general",
    sectionLabel: "General",
  },
];
