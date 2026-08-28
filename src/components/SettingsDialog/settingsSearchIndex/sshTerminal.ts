import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `sshTerminal` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const SSH_TERMINAL_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── SSH Terminal ───────────────────────────────────────────────
  {
    key: "sshTerminal",
    label: "SSH Terminal",
    description: "SSH terminal configuration",
    tags: ["ssh", "terminal", "font", "cursor", "scrollback", "xterm"],
    section: "sshTerminal",
    sectionLabel: "SSH Terminal",
  },
  {
    key: "sshTerminal.fontFamily",
    label: "Terminal Font",
    description: "SSH terminal font family",
    tags: ["font", "typeface", "monospace", "terminal"],
    section: "sshTerminal",
    sectionLabel: "SSH Terminal",
  },
  {
    key: "sshTerminal.fontSize",
    label: "Terminal Font Size",
    description: "SSH terminal font size",
    tags: ["font size", "text size", "terminal"],
    section: "sshTerminal",
    sectionLabel: "SSH Terminal",
  },
  {
    key: "sshTerminal.cursorStyle",
    label: "Cursor Style",
    description: "Terminal cursor style",
    tags: ["cursor", "block", "underline", "bar"],
    section: "sshTerminal",
    sectionLabel: "SSH Terminal",
  },
  {
    key: "sshTerminal.scrollback",
    label: "Scrollback Lines",
    description: "Terminal scrollback buffer size",
    tags: ["scrollback", "buffer", "history", "lines"],
    section: "sshTerminal",
    sectionLabel: "SSH Terminal",
  },
];
