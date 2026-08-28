import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `behavior` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * Almost every label in `sections/behavior/**` is hardcoded English rather than
 * a `t()` call, so `labelKey` appears only on the handful that are translated
 * (`WindowConnection.tsx`).
 */
export const BEHAVIOR_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Click actions ──────────────────────────────────────────────
  {
    key: "singleClickConnect",
    label: "Connect on single click",
    description:
      "A single click on a connection in the sidebar tree will immediately open and connect to it. Disable if you prefer single-click to only select.",
    tags: ["click", "one click", "mouse", "connect", "tree", "sidebar"],
    synonyms: ["single click", "one click connect"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "singleClickDisconnect",
    label: "Disconnect on single click (active connections)",
    description:
      "Single-clicking an already connected session in the tree will disconnect it. Useful for quick teardown but may cause accidental disconnects.",
    tags: ["click", "disconnect", "mouse", "tree", "one click"],
    synonyms: ["single click disconnect", "click to disconnect"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "doubleClickConnect",
    label: "Connect on double click",
    description:
      "Double-clicking a connection in the tree opens and connects to it. This is the traditional way to initiate a connection.",
    tags: ["double click", "open", "mouse", "connect", "tree"],
    synonyms: ["double click", "dbl click"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "doubleClickRename",
    label: "Rename on double click",
    description:
      "Double-clicking a connection name in the tree puts it into inline edit mode so you can rename it without opening a properties dialog.",
    tags: ["rename", "double click", "edit name", "inline", "tree"],
    synonyms: ["inline rename", "edit name", "f2"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "middleClickCloseTab",
    label: "Middle-click to close tab",
    description:
      "Clicking a tab with the middle mouse button will close it immediately, similar to browser tab behavior.",
    tags: ["middle click", "close tab", "mouse", "wheel click", "scroll click"],
    synonyms: ["middle mouse", "wheel click", "button 3"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "folderSingleClickToggle",
    label: "Folder expand on single click",
    description:
      "When on, a single click anywhere on a folder in the sidebar tree toggles its expanded state. When off, only the small chevron on the left toggles it and the row body just selects.",
    tags: ["folder", "expand", "collapse", "tree", "sidebar", "click"],
    synonyms: ["expand folder", "collapse folder", "chevron"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "folderDoubleClickToggle",
    label: "Folder expand on double click",
    description:
      "When on, double-clicking a folder in the sidebar tree toggles its expanded state. This is useful when single-click folder toggling is disabled.",
    tags: ["folder", "expand", "collapse", "tree", "sidebar", "double click"],
    synonyms: ["expand folder", "collapse folder"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Tab behavior ───────────────────────────────────────────────
  {
    key: "openConnectionInBackground",
    label: "Open new connections in background",
    description:
      "When enabled, new connection tabs open behind the current tab instead of immediately switching focus to them.",
    tags: ["background", "tab", "new tab", "focus", "open"],
    synonyms: ["background tab", "don't switch", "open behind"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "openWinmgmtToolInBackground",
    label: "Open Windows management tools in background",
    description:
      "Open Windows management tool tabs (Services, Registry, Event Viewer, etc.) in the background without interrupting your current work.",
    tags: [
      "background",
      "windows",
      "management",
      "tools",
      "services",
      "registry",
      "event viewer",
      "winmgmt",
    ],
    synonyms: ["winrm tools", "windows tools", "wmi", "mmc", "services.msc"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "switchTabOnActivity",
    label: "Switch to tab on activity",
    description:
      "Automatically bring a background tab to the foreground when it receives new output or activity, such as incoming terminal data.",
    tags: ["activity", "output", "focus", "switch", "tab", "foreground"],
    synonyms: ["auto switch", "focus on output", "jump to tab"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "closeTabOnDisconnect",
    label: "Close tab on disconnect",
    description:
      "Automatically remove the tab when a session disconnects. When disabled, disconnected tabs remain open so you can review output or reconnect.",
    tags: ["close", "disconnect", "auto close", "tab", "session"],
    synonyms: ["auto close tab", "remove tab on disconnect"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "confirmCloseActiveTab",
    label: "Confirm before closing active tab",
    description:
      "Display a confirmation prompt before closing a tab that has an active, connected session to prevent accidental disconnections.",
    tags: ["confirm", "warning", "active", "close tab", "prompt"],
    synonyms: ["ask before closing", "confirm close tab"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "enableRecentlyClosedTabs",
    label: "Enable recently-closed tabs list",
    description:
      "Maintain a history of recently closed tabs so you can quickly reopen them. Useful for recovering accidentally closed sessions.",
    tags: ["recent", "undo close", "reopen", "history", "tab", "closed"],
    synonyms: ["undo close tab", "reopen closed tab", "ctrl shift t"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "recentlyClosedTabsMax",
    label: "Max recently closed",
    description:
      "The maximum number of recently closed tabs to remember. Older entries are discarded when this limit is reached.",
    tags: ["recent", "closed", "tabs", "limit", "maximum", "history", "count"],
    synonyms: ["how many closed tabs", "undo history size"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Focus & navigation ─────────────────────────────────────────
  {
    key: "focusTerminalOnTabSwitch",
    label: "Focus terminal when switching tabs",
    description:
      "When you switch to a different tab, automatically place keyboard focus inside the terminal so you can start typing immediately.",
    tags: ["focus", "terminal", "keyboard", "input", "tab switch"],
    synonyms: ["auto focus", "keyboard focus", "cursor in terminal"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "scrollTreeToActiveConnection",
    label: "Scroll sidebar to active connection",
    description:
      "Automatically scroll the sidebar connection tree to reveal and highlight the connection that corresponds to the active tab.",
    tags: ["scroll", "sidebar", "tree", "reveal", "active", "highlight"],
    synonyms: ["reveal in tree", "sync tree", "follow active"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "restoreLastActiveTab",
    label: "Restore last active tab on startup",
    description:
      "When the application starts, automatically select the same tab that was active when you last closed the app.",
    tags: ["restore", "tab", "startup", "remember", "last active"],
    synonyms: ["remember tab", "reopen last tab"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "tabCycleMru",
    label: "Cycle tabs in most-recently-used order",
    description:
      "When pressing Ctrl+Tab, cycle through tabs in the order you last used them rather than their left-to-right position in the tab bar.",
    tags: ["ctrl tab", "mru", "cycle", "order", "switch", "recent"],
    synonyms: ["ctrl+tab", "most recently used", "mru", "alt tab"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Window & connection ────────────────────────────────────────
  {
    key: "singleWindowMode",
    label: "Disallow multiple instances",
    description:
      "Prevent opening more than one instance of the application. If another instance is already running, the existing window will be focused instead.",
    tags: ["window", "single instance", "multiple", "duplicate", "instance"],
    synonyms: ["single instance", "one window", "no duplicates"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "singleConnectionMode",
    label: "Single connection mode",
    labelKey: "connections.singleConnection",
    description:
      "Restrict the application to one active connection at a time. Opening a new connection will close the current one first.",
    tags: ["connection", "exclusive", "single", "one at a time"],
    synonyms: ["one connection", "exclusive connection"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "reconnectOnReload",
    label: "Reconnect on reload",
    labelKey: "connections.reconnectOnReload",
    description:
      "Automatically reconnect to all previously active sessions when the application window is reloaded or restarted.",
    tags: ["reconnect", "restore", "refresh", "reload", "sessions"],
    synonyms: ["reload", "refresh", "f5", "restore sessions"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "enableAutocomplete",
    label: "Enable browser autocomplete on input fields",
    description:
      "Allow the browser's built-in autocomplete to suggest previously entered values in input fields like hostnames and usernames.",
    tags: ["auto complete", "suggestions", "input", "form", "autofill"],
    synonyms: ["autocomplete", "autofill", "suggestions"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "enableWinrmTools",
    label: "Enable Windows Remote Management tools",
    description:
      "When enabled, Windows management tools (Services, Processes, Event Viewer, etc.) are available in the context menu and RDP toolbar for Windows connections. Individual connections can override this setting.",
    tags: [
      "winrm",
      "windows",
      "remote management",
      "tools",
      "services",
      "processes",
      "event viewer",
      "rdp",
    ],
    synonyms: [
      "winrm",
      "windows remote management",
      "wmi",
      "services",
      "event viewer",
      "management tools",
    ],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Clipboard ──────────────────────────────────────────────────
  {
    key: "copyOnSelect",
    label: "Copy on select",
    description:
      "Automatically copy text to the clipboard as soon as you select it in the terminal, without needing to press Ctrl+C.",
    tags: ["copy", "select", "clipboard", "auto copy", "terminal"],
    synonyms: ["auto copy", "select to copy", "ctrl+c"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "pasteOnRightClick",
    label: "Paste on right-click",
    description:
      "Right-clicking inside the terminal area will paste the current clipboard contents. When disabled, right-click opens a context menu instead.",
    tags: ["paste", "right click", "clipboard", "terminal", "context menu"],
    synonyms: ["right click paste", "putty style paste"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "trimPastedWhitespace",
    label: "Trim whitespace from pasted text",
    description:
      "Remove leading and trailing spaces or newlines from clipboard text before pasting it into the terminal. Helps avoid accidental command execution.",
    tags: ["paste", "trim", "whitespace", "clean", "clipboard", "newline"],
    synonyms: ["strip whitespace", "trim newlines"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "warnOnMultiLinePaste",
    label: "Warn before pasting multi-line text",
    description:
      "Display a confirmation dialog when pasting text that contains newline characters, which could execute multiple commands at once.",
    tags: ["paste", "multiline", "warning", "confirm", "clipboard", "newline"],
    synonyms: ["multi line paste", "bracketed paste", "paste warning"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "clearClipboardAfterSeconds",
    label: "Clear clipboard after paste",
    description:
      "Automatically clear the clipboard a set number of seconds after pasting into a terminal. Set to 0 to disable this security feature.",
    tags: [
      "clipboard",
      "clear",
      "security",
      "terminal",
      "timeout",
      "seconds",
      "wipe",
    ],
    synonyms: ["wipe clipboard", "clipboard timeout", "clear after paste"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "maxPasteLengthChars",
    label: "Max paste length",
    description:
      "Show a confirmation prompt before pasting text longer than this many characters. Set to 0 for no limit.",
    tags: ["paste", "limit", "size", "characters", "clipboard", "maximum"],
    synonyms: ["paste limit", "paste size", "characters"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Idle & timeout ─────────────────────────────────────────────
  {
    key: "idleDisconnectMinutes",
    label: "Idle disconnect",
    description:
      "Automatically disconnect a session after this many minutes of inactivity. Set to 0 to disable idle disconnection.",
    tags: [
      "idle",
      "timeout",
      "disconnect",
      "inactivity",
      "minutes",
      "auto logout",
    ],
    synonyms: ["idle timeout", "auto disconnect", "inactivity timeout"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "sendKeepaliveOnIdle",
    label: "Send keepalive packets on idle",
    description:
      "Send periodic keepalive packets to the remote server while the session is idle to prevent the server from dropping the connection due to inactivity.",
    tags: ["keepalive", "idle", "ping", "heartbeat", "packets", "timeout"],
    synonyms: ["keep alive", "server alive", "heartbeat", "null packet"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "keepaliveIntervalSeconds",
    label: "Keepalive interval",
    description:
      "How often keepalive packets are sent to the server, in seconds. Lower values are more reliable but generate more network traffic.",
    tags: ["keepalive", "interval", "frequency", "seconds", "heartbeat"],
    synonyms: ["keep alive interval", "server alive interval"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "dimInactiveTabs",
    label: "Dim inactive tabs",
    description:
      "Visually dim tabs that are not currently focused, making it easier to identify which tab is active at a glance.",
    tags: ["dim", "inactive", "fade", "visual", "tabs", "opacity"],
    synonyms: ["fade tabs", "grey out tabs"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "showIdleDuration",
    label: "Show idle duration on tabs",
    description:
      "Display a time badge on each tab showing how long the session has been idle. Helps identify stale connections that may need attention.",
    tags: ["idle", "duration", "badge", "time", "tabs", "stale"],
    synonyms: ["idle time", "idle badge", "how long idle"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Reconnection ───────────────────────────────────────────────
  {
    key: "autoReconnectOnDisconnect",
    label: "Auto-reconnect on unexpected disconnect",
    description:
      "Automatically creates a new transport and shell after an established session is unexpectedly lost. Authentication and host-key failures are not transient disconnects and must not be retried automatically.",
    tags: ["reconnect", "auto", "disconnect", "retry", "recover", "network"],
    synonyms: ["auto reconnect", "retry connection", "reconnect automatically"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "autoReconnectMaxAttempts",
    label: "Max attempts",
    description:
      "Maximum number of reconnection attempts before giving up. The bounded default tolerates normal server reboot windows without retrying forever. Set to 0 only if you explicitly want unlimited attempts.",
    tags: ["reconnect", "attempts", "retry", "limit", "maximum", "tries"],
    synonyms: ["retry count", "max retries", "unlimited attempts"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "autoReconnectBackoff",
    label: "Retry backoff",
    description:
      "Exponential backoff recovers quickly from brief drops, then slows down to avoid hammering a host that is rebooting or offline.",
    tags: ["reconnect", "backoff", "retry", "ssh", "reboot", "delay"],
    values: ["exponential", "Exponential", "fixed", "Fixed"],
    synonyms: ["exponential backoff", "fixed delay", "retry strategy"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "autoReconnectDelaySecs",
    label: "Initial retry delay",
    description:
      "Number of seconds before the first reconnect attempt. Fixed backoff uses this for every attempt; exponential backoff grows from this value.",
    tags: [
      "reconnect",
      "delay",
      "wait",
      "interval",
      "ssh",
      "reboot",
      "seconds",
    ],
    synonyms: ["retry delay", "wait before retry", "first delay"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "autoReconnectMaxDelaySecs",
    label: "Maximum retry delay",
    description:
      "Caps exponential backoff so a recovered SSH daemon is discovered promptly while retries remain bounded.",
    tags: ["reconnect", "delay", "maximum", "cap", "ssh", "reboot", "backoff"],
    synonyms: ["max delay", "backoff cap", "longest wait"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "notifyOnReconnect",
    label: "Notify on successful reconnect",
    description:
      "Display a notification when an automatically reconnected session is successfully restored, so you know the connection is back.",
    tags: ["notify", "reconnect", "alert", "notification", "restored"],
    synonyms: ["reconnect notification", "alert on reconnect"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Notifications ──────────────────────────────────────────────
  {
    key: "notifyOnConnect",
    label: "Notify on connect",
    description:
      "Display an operating system notification when a remote session is successfully connected. Useful when connections are opened in the background.",
    tags: ["notify", "connect", "alert", "notification", "os", "toast"],
    synonyms: ["desktop notification", "toast", "os notification"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "notifyOnDisconnect",
    label: "Notify on disconnect",
    description:
      "Display an operating system notification when a remote session ends, whether intentionally or due to a network interruption.",
    tags: ["notify", "disconnect", "alert", "notification", "os", "toast"],
    synonyms: ["desktop notification", "toast", "os notification"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "notifyOnError",
    label: "Notify on error",
    description:
      "Display an operating system notification when a connection attempt fails or an active session encounters an error.",
    tags: ["notify", "error", "alert", "failure", "notification", "toast"],
    synonyms: ["error notification", "failure alert"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "notificationSound",
    label: "Play sound with notifications",
    description:
      "Play an audible alert along with each OS notification. Disable for silent visual-only notifications.",
    tags: ["sound", "audio", "beep", "alert", "notification", "chime"],
    synonyms: ["notification sound", "beep", "audible alert", "mute"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "flashTaskbarOnActivity",
    label: "Flash taskbar on background activity",
    description:
      "Flash the application icon in the Windows taskbar when a background tab receives new activity, drawing your attention without switching focus.",
    tags: ["taskbar", "flash", "blink", "attention", "activity", "windows"],
    synonyms: ["blink taskbar", "flash icon", "bounce dock"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Confirmation dialogs ───────────────────────────────────────
  {
    key: "confirmDisconnect",
    label: "Confirm before disconnecting",
    description:
      "Show a confirmation dialog before disconnecting an active remote session, preventing accidental disconnections from a running terminal.",
    tags: ["confirm", "disconnect", "warning", "prompt", "dialog"],
    synonyms: ["ask before disconnect", "disconnect prompt"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "confirmDeleteConnection",
    label: "Confirm before deleting connections",
    description:
      "Require confirmation before permanently deleting a saved connection entry from the connection tree. Helps prevent accidental data loss.",
    tags: ["confirm", "delete", "remove", "warning", "connection", "prompt"],
    synonyms: ["ask before delete", "delete confirmation"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "confirmDeleteTabGroup",
    label: "Confirm before deleting a tab group",
    description:
      "Require confirmation before deleting a tab group. Deleting a group also closes every session tab it contains, so this guard prevents accidentally killing a batch of open tabs.",
    tags: ["confirm", "delete", "tab group", "warning", "group", "prompt"],
    synonyms: ["tab group", "delete group", "group confirmation"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "confirmBulkOperations",
    label: "Confirm bulk operations",
    description:
      "Prompt for confirmation before executing actions on multiple selected connections at once, such as batch connect, disconnect, or delete.",
    tags: ["confirm", "bulk", "batch", "multi select", "mass", "prompt"],
    synonyms: ["batch operations", "mass actions", "multi select"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "confirmImport",
    label: "Confirm before importing",
    description:
      "Display a summary of what will be imported and ask for confirmation before adding imported connections or applying imported settings.",
    tags: ["confirm", "import", "warning", "summary", "prompt"],
    synonyms: ["import confirmation", "ask before import"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Drag & drop ────────────────────────────────────────────────
  {
    key: "enableFileDragDropToTerminal",
    label: "Enable file drag-and-drop to terminal",
    description:
      "Allow dragging files from your desktop onto an SSH terminal session to upload them via SCP or SFTP. Disable if you find this triggers accidentally.",
    tags: ["drag", "drop", "file", "upload", "scp", "sftp", "ssh", "terminal"],
    synonyms: ["drag and drop", "file upload", "scp", "sftp"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "enableFileDragDropToRdp",
    label: "Enable file drag-and-drop to RDP",
    description:
      "Allow dragging files and folders from your desktop onto an RDP session to transfer them to the remote clipboard via the CLIPRDR protocol. The remote user can then paste them. Disable if this triggers accidentally.",
    tags: [
      "drag",
      "drop",
      "file",
      "rdp",
      "clipboard",
      "cliprdr",
      "transfer",
      "folder",
    ],
    synonyms: ["drag and drop", "cliprdr", "file transfer", "rdp clipboard"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "showDropPreview",
    label: "Show drop preview overlay",
    description:
      "Show a visual overlay highlight when dragging items over valid drop targets, so you can see where the drop will land.",
    tags: ["drag", "drop", "preview", "overlay", "highlight", "visual"],
    synonyms: ["drop indicator", "drag overlay", "drop highlight"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "dragSensitivityPx",
    label: "Drag sensitivity",
    description:
      "Minimum number of pixels the mouse must move before a drag operation begins. Increase to prevent accidental drags on sensitive touchpads.",
    tags: ["drag", "sensitivity", "threshold", "pixels", "touchpad", "mouse"],
    synonyms: ["drag threshold", "pixels", "accidental drag"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Scroll & input ─────────────────────────────────────────────
  {
    key: "terminalScrollSpeed",
    label: "Terminal scroll speed",
    description:
      "Multiplier for terminal scroll speed. Higher values scroll faster per mouse wheel tick. The default is 1x.",
    tags: ["scroll", "speed", "terminal", "mouse wheel", "multiplier"],
    synonyms: ["scroll speed", "wheel speed", "scroll multiplier"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "terminalSmoothScroll",
    label: "Smooth scrolling in terminal",
    description:
      "Enable smooth animated scrolling in the terminal instead of jumping line by line. May feel more natural but can use slightly more resources.",
    tags: ["smooth", "scroll", "animation", "terminal"],
    synonyms: ["smooth scroll", "animated scrolling"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "treeRightClickAction",
    label: "Right-click in tree",
    description:
      "Choose what happens when you right-click a connection in the sidebar tree: show a context menu or immediately open the Quick Connect dialog.",
    tags: ["right click", "context menu", "tree", "sidebar", "quick connect"],
    values: ["contextMenu", "Context menu", "quickConnect", "Quick connect"],
    synonyms: ["right click menu", "context menu", "secondary click"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "mouseBackAction",
    label: "Mouse back button",
    description:
      "Assign an action to the mouse back button (Button 4). Choose to switch to the previous tab, disconnect the current session, or do nothing.",
    tags: ["mouse", "back", "button", "navigate", "button 4", "side button"],
    values: [
      "none",
      "Do nothing",
      "previousTab",
      "Previous tab",
      "disconnect",
      "Disconnect",
    ],
    synonyms: ["button 4", "side button", "thumb button", "back button"],
    section: "behavior",
    sectionLabel: "Behavior",
  },
  {
    key: "mouseForwardAction",
    label: "Mouse forward button",
    description:
      "Assign an action to the mouse forward button (Button 5). Choose to switch to the next tab, reconnect the current session, or do nothing.",
    tags: ["mouse", "forward", "button", "navigate", "button 5", "side button"],
    values: [
      "none",
      "Do nothing",
      "nextTab",
      "Next tab",
      "reconnect",
      "Reconnect",
    ],
    synonyms: ["button 5", "side button", "thumb button", "forward button"],
    section: "behavior",
    sectionLabel: "Behavior",
  },

  // ─── Telegram bots (integration panel) ──────────────────────────
  {
    key: "telegram.bots",
    label: "Telegram bots",
    labelKey: "integrations.telegram.title",
    description:
      "Configure Telegram bots for connection-event notifications, monitoring alerts, digests, and manual messaging. Bot tokens are stored encrypted in the OS credential vault, never in the settings file.",
    descriptionKey: "integrations.telegram.intro",
    tags: [
      "telegram",
      "bot",
      "notification",
      "alert",
      "webhook",
      "monitoring",
      "digest",
      "broadcast",
      "chat",
      "integration",
      "messaging",
    ],
    // The panel is a management console, not a set of persisted settings — the
    // one anchor covers all of it. These are the tab names inside it, so a user
    // searching "webhook" or "broadcast" lands on the right panel.
    values: [
      "Send",
      "Messages",
      "Chats",
      "Files",
      "Webhooks",
      "Notification rules",
      "Monitoring",
      "Templates",
      "Scheduled",
      "Broadcast",
      "Digests",
      "Logs",
    ],
    synonyms: [
      "telegram",
      "bot token",
      "chat id",
      "telegram notifications",
      "bot api",
    ],
    section: "behavior",
    sectionLabel: "Behavior",
  },
];
