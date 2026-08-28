import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `layout` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const LAYOUT_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Layout ─────────────────────────────────────────────────────
  {
    key: "defaultTabLayout",
    label: "Default Tab Layout",
    description: "Tiling mode used when the app starts",
    tags: ["tabs", "layout", "tiling", "grid", "split", "mosaic"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "tabGrouping",
    label: "Tab Grouping",
    description: "Tab grouping strategy",
    tags: ["tabs", "group", "organize"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "persistWindowSize",
    label: "Persist Window Size",
    description: "Remember window size",
    tags: ["window", "size", "remember"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "persistWindowPosition",
    label: "Persist Window Position",
    description: "Remember window position",
    tags: ["window", "position", "remember"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "persistSidebarWidth",
    label: "Persist Sidebar Width",
    description: "Remember sidebar width",
    tags: ["sidebar", "width", "tab"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "enableTabReorder",
    label: "Tab Reorder",
    description: "Allow drag-to-reorder tabs",
    tags: ["tabs", "drag", "reorder", "sort"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showQuickConnectIcon",
    label: "Quick Connect Icon",
    description: "Show quick connect in toolbar",
    tags: ["toolbar", "icon", "quick connect"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showSettingsIcon",
    label: "Settings Icon",
    description: "Show settings in toolbar",
    tags: ["toolbar", "icon", "settings"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showProxyMenuIcon",
    label: "Proxy Menu Icon",
    description: "Show proxy menu in toolbar",
    tags: ["toolbar", "icon", "proxy", "vpn"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showWolIcon",
    label: "Wake-on-LAN Icon",
    description: "Show Wake-on-LAN in toolbar",
    tags: ["toolbar", "icon", "wol", "wake"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showBulkSSHIcon",
    label: "Bulk SSH Icon",
    description: "Show Bulk SSH in toolbar",
    tags: ["toolbar", "icon", "bulk", "ssh"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showScriptManagerIcon",
    label: "Script Manager Icon",
    description: "Show Script Manager in toolbar",
    tags: ["toolbar", "icon", "script"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showMacroManagerIcon",
    label: "Macro Manager Icon",
    description: "Show Macro Manager in toolbar",
    tags: ["toolbar", "icon", "macro", "recording"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showRdpSessionsIcon",
    label: "Session Manager Icon",
    description: "Show Session Manager in toolbar",
    tags: ["toolbar", "icon", "rdp", "ssh", "sessions"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showErrorLogBar",
    label: "Error Log Bar",
    description: "Show error log toggle in toolbar",
    tags: ["toolbar", "icon", "error", "log", "debug"],
    section: "layout",
    sectionLabel: "Layout",
  },
  {
    key: "showPerformanceMonitorIcon",
    label: "Performance Monitor Icon",
    description: "Show Performance Monitor in toolbar",
    tags: ["toolbar", "icon", "performance", "monitor"],
    section: "layout",
    sectionLabel: "Layout",
  },
];
