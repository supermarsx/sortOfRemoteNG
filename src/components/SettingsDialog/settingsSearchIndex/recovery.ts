import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `recovery` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * Recovery is an action-only tab: it has no persisted settings, so the anchors
 * `sections/RecoverySettings.tsx` declares are its five destructive/restart
 * actions. Indexing them is what makes "reset settings", "factory reset" and
 * "restart" reachable from search at all.
 */
export const RECOVERY_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "recovery.deleteAppData",
    label: "Delete App Data",
    description:
      "Delete settings, theme preferences and cached data. Collections are preserved.",
    tags: [
      "recovery",
      "delete",
      "clear",
      "app data",
      "cache",
      "settings",
      "preferences",
      "theme",
      "troubleshoot",
      "clean",
      "wipe",
      "repair",
    ],
    synonyms: [
      "clear cache",
      "clear app data",
      "remove app data",
      "start fresh",
    ],
    section: "recovery",
    sectionLabel: "Recovery",
  },
  {
    key: "recovery.deleteAllData",
    label: "Delete All Data & Collections",
    description:
      "Permanently delete everything including collections and passwords. Cannot be undone.",
    tags: [
      "recovery",
      "delete",
      "delete all",
      "erase",
      "collections",
      "passwords",
      "credentials",
      "connections",
      "permanent",
      "destructive",
      "wipe",
      "purge",
    ],
    synonyms: [
      "factory reset",
      "wipe everything",
      "erase all data",
      "nuke",
      "delete everything",
    ],
    section: "recovery",
    sectionLabel: "Recovery",
  },
  {
    key: "recovery.resetSettings",
    label: "Reset All Settings",
    description:
      "Reset every setting to its default value. Collections are not affected.",
    tags: [
      "recovery",
      "reset",
      "defaults",
      "default settings",
      "restore",
      "revert",
      "settings",
      "troubleshoot",
      "repair",
    ],
    synonyms: [
      "restore defaults",
      "reset to defaults",
      "factory settings",
      "revert settings",
    ],
    section: "recovery",
    sectionLabel: "Recovery",
  },
  {
    key: "recovery.softRestart",
    label: "Soft Restart",
    description:
      "Reload the frontend without restarting the application — a quick way to apply changes.",
    tags: [
      "recovery",
      "restart",
      "reload",
      "refresh",
      "soft restart",
      "frontend",
      "ui",
      "window",
      "troubleshoot",
    ],
    synonyms: ["reload ui", "refresh window", "soft reload", "reload frontend"],
    section: "recovery",
    sectionLabel: "Recovery",
  },
  {
    key: "recovery.hardRestart",
    label: "Hard Restart",
    description: "Completely restart the application, backend included.",
    tags: [
      "recovery",
      "restart",
      "hard restart",
      "reboot",
      "relaunch",
      "backend",
      "process",
      "full restart",
      "troubleshoot",
    ],
    synonyms: ["restart app", "relaunch application", "full restart", "reboot"],
    section: "recovery",
    sectionLabel: "Recovery",
  },
];
