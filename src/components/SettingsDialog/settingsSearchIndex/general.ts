import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `general` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const GENERAL_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Autosave ───────────────────────────────────────────────────
  {
    key: "autoSaveEnabled",
    label: "Enable autosave",
    labelKey: "settingsGeneral.enableAutosave",
    description:
      "Automatically save your connection file at regular intervals so changes are not lost if the app closes unexpectedly.",
    descriptionKey: "settingsGeneral.enableAutosaveTooltip",
    tags: ["save", "persist", "automatic", "autosave", "connection file"],
    synonyms: ["auto save", "autosave", "save automatically"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "autoSaveIntervalMinutes",
    label: "Autosave Interval",
    labelKey: "settingsGeneral.autosaveInterval",
    description:
      "How often the connection file is automatically saved. Lower values save more frequently but may cause brief pauses on large files.",
    descriptionKey: "settingsGeneral.autosaveIntervalTooltip",
    tags: ["save interval", "timer", "minutes", "frequency", "autosave"],
    synonyms: ["auto save interval", "save every", "minutes"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Confirmation warnings ──────────────────────────────────────
  {
    key: "warnOnClose",
    label: "Warn on close",
    labelKey: "connections.warnOnClose",
    description:
      "Show a confirmation dialog when you attempt to close a tab that has an active connection, preventing accidental disconnections.",
    descriptionKey: "settingsGeneral.warnOnCloseTooltip",
    tags: ["close warning", "confirm close", "tab", "prompt", "dialog"],
    synonyms: ["confirm before closing", "ask before close"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "warnOnDetachClose",
    label: "Warn on detached tab close",
    labelKey: "connections.warnOnDetachClose",
    description:
      "Show a confirmation dialog before closing a tab that has been detached into its own window.",
    descriptionKey: "settingsGeneral.warnOnDetachCloseTooltip",
    tags: ["detach", "popup", "floating", "window", "close warning"],
    synonyms: ["detached window", "popped out tab", "torn off tab"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "warnOnExit",
    label: "Warn on exit",
    labelKey: "connections.warnOnExit",
    description:
      "Show a warning when you try to quit the application while there are still active connections open.",
    descriptionKey: "settingsGeneral.warnOnExitTooltip",
    tags: ["exit warning", "confirm exit", "quit", "shutdown"],
    synonyms: ["confirm quit", "ask before quitting"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "confirmMainAppClose",
    label: "Confirm main app close",
    labelKey: "settingsGeneral.confirmMainAppClose",
    description:
      "Always prompt for confirmation before the main application window is closed, even if no connections are active.",
    descriptionKey: "settingsGeneral.confirmMainAppCloseTooltip",
    tags: ["confirm", "close", "main window", "quit", "prompt"],
    synonyms: ["confirm before closing app", "ask before closing window"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Crash recovery ─────────────────────────────────────────────
  {
    key: "detectUnexpectedClose",
    label: "Detect unexpected app close",
    labelKey: "settingsGeneral.detectUnexpectedClose",
    description:
      "Monitor for abnormal application exits and offer session recovery options on next launch.",
    descriptionKey: "settingsGeneral.detectUnexpectedCloseTooltip",
    tags: [
      "crash",
      "recovery",
      "unexpected",
      "close",
      "diagnostics",
      "restore",
    ],
    synonyms: ["crash recovery", "crash detection", "session recovery"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Connections ────────────────────────────────────────────────
  {
    key: "connectionTimeout",
    label: "Connection timeout",
    labelKey: "settingsGeneral.connectionTimeout",
    description:
      "Maximum time in seconds to wait for a connection to be established before giving up. Increase this for slow or high-latency networks.",
    descriptionKey: "settingsGeneral.connectionTimeoutTooltip",
    tags: ["timeout", "connect", "seconds", "latency", "network", "wait"],
    synonyms: ["connect timeout", "dial timeout", "time out"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Tab naming ─────────────────────────────────────────────────
  {
    key: "hostnameOverride",
    label: "Override tab names with hostname",
    labelKey: "settingsGeneral.hostnameOverride",
    description:
      "Display the resolved server hostname in tab titles instead of the user-defined connection name.",
    descriptionKey: "settingsGeneral.hostnameOverrideTooltip",
    tags: ["tab", "name", "hostname", "title", "fqdn", "server"],
    synonyms: ["tab title", "tab naming", "show hostname", "host name"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Quick Connect history ──────────────────────────────────────
  {
    key: "quickConnectHistoryEnabled",
    label: "Save Quick Connect history",
    labelKey: "settingsGeneral.saveQuickConnectHistory",
    description:
      "Remember previously used Quick Connect addresses so they can be quickly selected again. Disable to keep no history of ad-hoc connections.",
    descriptionKey: "settingsGeneral.saveQuickConnectHistoryTooltip",
    tags: ["history", "recent", "quick connect", "address", "ad-hoc"],
    synonyms: ["quickconnect", "recent hosts", "clear history"],
    section: "general",
    sectionLabel: "General",
  },

  // ─── Settings dialog (meta) ─────────────────────────────────────
  {
    key: "settingsDialog.autoSave",
    label: "Auto-save settings",
    labelKey: "settingsGeneral.autoSaveSettings",
    description:
      "Automatically persist settings changes as you make them, with a short debounce delay.",
    descriptionKey: "settingsGeneral.autoSaveSettingsTooltip",
    tags: ["auto", "save", "settings", "dialog", "debounce", "persist"],
    synonyms: ["autosave settings", "save settings automatically"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "settingsDialog.showSaveButton",
    label: "Show save button",
    labelKey: "settingsGeneral.showSaveButton",
    description:
      "Always show a manual Save button in the settings footer for explicit saving. When auto-save is disabled the Save button appears automatically regardless of this setting.",
    descriptionKey: "settingsGeneral.showSaveButtonTooltip",
    tags: ["save", "button", "settings", "dialog", "manual", "footer"],
    synonyms: ["manual save", "save button"],
    section: "general",
    sectionLabel: "General",
  },
  {
    key: "settingsDialog.confirmBeforeReset",
    label: "Confirm before reset",
    labelKey: "settingsGeneral.confirmBeforeReset",
    description:
      "Show a confirmation dialog before resetting a settings tab back to its default values.",
    descriptionKey: "settingsGeneral.confirmBeforeResetTooltip",
    tags: ["confirm", "reset", "defaults", "settings", "dialog", "restore"],
    synonyms: ["reset to defaults", "restore defaults", "factory reset"],
    section: "general",
    sectionLabel: "General",
  },
];
