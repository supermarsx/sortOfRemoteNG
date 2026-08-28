import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `startup` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * `sectionLabel` is "Startup & Tray" — the label the sidebar actually shows
 * (`settingsConstants.ts`, `settings.startup.title`). The matcher searches
 * `sectionLabel`, so this is what makes typing the tab's own name find it.
 */
export const STARTUP_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Startup behavior ───────────────────────────────────────────
  {
    key: "startWithSystem",
    label: "Start with system",
    labelKey: "settings.startup.startWithSystem",
    description:
      "Automatically launch the application when the operating system starts",
    tags: ["boot", "autostart", "login", "startup", "launch", "system"],
    synonyms: ["auto start", "run at login", "run on boot", "startup item"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "startMinimized",
    label: "Start minimized",
    labelKey: "settings.startup.startMinimized",
    description:
      "Start the application minimized to the taskbar or system tray",
    tags: ["minimize", "hidden", "tray", "taskbar", "startup"],
    synonyms: ["start hidden", "launch minimized"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "startMaximized",
    label: "Start maximized",
    labelKey: "settings.startup.startMaximized",
    description: "Open the application window in maximized (full-screen) mode",
    tags: ["maximize", "fullscreen", "full screen", "window", "startup"],
    synonyms: ["full screen", "launch maximized"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "reconnectPreviousSessions",
    label: "Reconnect previous sessions on startup",
    labelKey: "settings.startup.reconnectSessions",
    description:
      "Automatically reconnect all sessions that were active when the application was last closed",
    tags: ["restore", "sessions", "remember", "reconnect", "startup"],
    synonyms: ["restore sessions", "reopen sessions", "resume sessions"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "autoOpenLastCollection",
    label: "Auto-open last used connection collection",
    labelKey: "settings.startup.autoOpenLastCollection",
    description:
      "Automatically load the most recently used connection collection on startup",
    tags: ["collection", "recent", "last used", "open", "startup"],
    synonyms: ["last collection", "recent collection", "reopen collection"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },

  // ─── System tray behavior ───────────────────────────────────────
  {
    key: "showTrayIcon",
    label: "Show system tray icon",
    labelKey: "settings.startup.showTrayIcon",
    description:
      "Display an icon in the system notification area for quick access",
    tags: ["tray", "icon", "notification area", "systray", "taskbar"],
    synonyms: ["system tray", "notification area", "systray", "menu bar icon"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "minimizeToTray",
    label: "Minimize to notification area",
    labelKey: "settings.startup.minimizeToTray",
    description:
      "When minimizing, hide the window and keep it accessible from the system tray icon",
    tags: ["tray", "system tray", "minimize", "hide", "notification area"],
    synonyms: ["minimize to tray", "hide to tray"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "closeToTray",
    label: "Close to notification area",
    labelKey: "settings.startup.closeToTray",
    description:
      "When closing the window, minimize to the system tray instead of quitting the application",
    tags: ["tray", "close", "background", "quit", "notification area"],
    synonyms: ["close to tray", "keep running in background", "x button"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },

  // ─── Welcome screen ─────────────────────────────────────────────
  {
    key: "hideQuickStartMessage",
    label: "Hide welcome message",
    labelKey: "settings.startup.hideQuickStartMessage",
    description:
      "Hide the introductory welcome message shown on the start screen",
    tags: [
      "welcome",
      "message",
      "quick start",
      "start screen",
      "hide",
      "intro",
    ],
    synonyms: ["welcome screen", "quickstart", "splash", "greeting"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "hideQuickStartButtons",
    label: "Hide quick action buttons",
    labelKey: "settings.startup.hideQuickStartButtons",
    description:
      "Hide the shortcut buttons for common actions on the welcome screen",
    tags: ["welcome", "buttons", "quick start", "shortcuts", "hide", "actions"],
    synonyms: ["quickstart buttons", "quick actions", "welcome screen buttons"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "welcomeScreenTitle",
    label: "Custom Title",
    labelKey: "settings.startup.customTitle",
    description:
      "Set a custom title to display on the welcome screen instead of the default",
    tags: ["welcome", "greeting", "home", "title", "custom", "branding"],
    synonyms: ["welcome title", "custom welcome", "start screen title"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
  {
    key: "welcomeScreenMessage",
    label: "Custom Message",
    labelKey: "settings.startup.customMessage",
    description:
      "Set a custom message to display on the welcome screen instead of the default",
    tags: ["welcome", "message", "motd", "custom", "banner", "branding"],
    synonyms: ["motd", "message of the day", "welcome text", "banner"],
    section: "startup",
    sectionLabel: "Startup & Tray",
  },
];
