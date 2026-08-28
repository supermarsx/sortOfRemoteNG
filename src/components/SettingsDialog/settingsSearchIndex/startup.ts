import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `startup` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const STARTUP_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Startup ────────────────────────────────────────────────────
  {
    key: "startMinimized",
    label: "Start Minimized",
    description: "Start application minimized",
    tags: ["minimize", "hidden", "tray"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "startMaximized",
    label: "Start Maximized",
    description: "Start application maximized",
    tags: ["maximize", "fullscreen"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "startWithSystem",
    label: "Start with System",
    description: "Launch on system startup",
    tags: ["boot", "autostart", "login", "startup"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "reconnectPreviousSessions",
    label: "Reconnect Previous Sessions",
    description: "Restore previous sessions on start",
    tags: ["restore", "sessions", "remember"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "autoOpenLastCollection",
    label: "Auto Open Last Collection",
    description: "Open last used collection on start",
    tags: ["collection", "recent", "last used"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "minimizeToTray",
    label: "Minimize to Tray",
    description: "Minimize to system tray",
    tags: ["tray", "system tray", "minimize"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "closeToTray",
    label: "Close to Tray",
    description: "Close to system tray instead of exiting",
    tags: ["tray", "close", "background"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "showTrayIcon",
    label: "Show Tray Icon",
    description: "Show icon in system tray",
    tags: ["tray", "icon", "notification area"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "welcomeScreenTitle",
    label: "Welcome Screen Title",
    description: "Custom welcome screen title",
    tags: ["welcome", "greeting", "home"],
    section: "startup",
    sectionLabel: "Startup",
  },
  {
    key: "welcomeScreenMessage",
    label: "Welcome Screen Message",
    description: "Custom welcome screen message",
    tags: ["welcome", "message", "motd"],
    section: "startup",
    sectionLabel: "Startup",
  },
];
