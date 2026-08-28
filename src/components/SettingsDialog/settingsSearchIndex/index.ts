import type { SettingSearchEntry } from "./types";
import { GENERAL_SEARCH_ENTRIES } from "./general";
import { LANGUAGE_SEARCH_ENTRIES } from "./language";
import { BEHAVIOR_SEARCH_ENTRIES } from "./behavior";
import { STARTUP_SEARCH_ENTRIES } from "./startup";
import { LAYOUT_SEARCH_ENTRIES } from "./layout";
import { THEME_SEARCH_ENTRIES } from "./theme";
import { UPDATER_SEARCH_ENTRIES } from "./updater";
import { SECURITY_SEARCH_ENTRIES } from "./security";
import { TRUST_SEARCH_ENTRIES } from "./trust";
import { PERFORMANCE_SEARCH_ENTRIES } from "./performance";
import { RDP_DEFAULTS_SEARCH_ENTRIES } from "./rdpDefaults";
import { SSH_TERMINAL_SEARCH_ENTRIES } from "./sshTerminal";
import { WEB_BROWSER_SEARCH_ENTRIES } from "./webBrowser";
import { PROXY_SEARCH_ENTRIES } from "./proxy";
import { VPN_SEARCH_ENTRIES } from "./vpn";
import { BACKUP_SEARCH_ENTRIES } from "./backup";
import { CLOUD_SYNC_SEARCH_ENTRIES } from "./cloudSync";
import { RECORDING_SEARCH_ENTRIES } from "./recording";
import { MACROS_SEARCH_ENTRIES } from "./macros";
import { API_SEARCH_ENTRIES } from "./api";
import { MCP_SERVER_SEARCH_ENTRIES } from "./mcpServer";
import { AI_SEARCH_ENTRIES } from "./ai";
import { BACKEND_SEARCH_ENTRIES } from "./backend";
import { DIAGNOSTICS_SEARCH_ENTRIES } from "./diagnostics";
import { ADVANCED_SEARCH_ENTRIES } from "./advanced";
import { RECOVERY_SEARCH_ENTRIES } from "./recovery";
import { ABOUT_SEARCH_ENTRIES } from "./about";

export type { SettingSearchEntry } from "./types";
export { GENERAL_SEARCH_ENTRIES } from "./general";
export { LANGUAGE_SEARCH_ENTRIES } from "./language";
export { BEHAVIOR_SEARCH_ENTRIES } from "./behavior";
export { STARTUP_SEARCH_ENTRIES } from "./startup";
export { LAYOUT_SEARCH_ENTRIES } from "./layout";
export { THEME_SEARCH_ENTRIES } from "./theme";
export { UPDATER_SEARCH_ENTRIES } from "./updater";
export { SECURITY_SEARCH_ENTRIES } from "./security";
export { TRUST_SEARCH_ENTRIES } from "./trust";
export { PERFORMANCE_SEARCH_ENTRIES } from "./performance";
export { RDP_DEFAULTS_SEARCH_ENTRIES } from "./rdpDefaults";
export { SSH_TERMINAL_SEARCH_ENTRIES } from "./sshTerminal";
export { WEB_BROWSER_SEARCH_ENTRIES } from "./webBrowser";
export { PROXY_SEARCH_ENTRIES } from "./proxy";
export { VPN_SEARCH_ENTRIES } from "./vpn";
export { BACKUP_SEARCH_ENTRIES } from "./backup";
export { CLOUD_SYNC_SEARCH_ENTRIES } from "./cloudSync";
export { RECORDING_SEARCH_ENTRIES } from "./recording";
export { MACROS_SEARCH_ENTRIES } from "./macros";
export { API_SEARCH_ENTRIES } from "./api";
export { MCP_SERVER_SEARCH_ENTRIES } from "./mcpServer";
export { AI_SEARCH_ENTRIES } from "./ai";
export { BACKEND_SEARCH_ENTRIES } from "./backend";
export { DIAGNOSTICS_SEARCH_ENTRIES } from "./diagnostics";
export { ADVANCED_SEARCH_ENTRIES } from "./advanced";
export { RECOVERY_SEARCH_ENTRIES } from "./recovery";
export { ABOUT_SEARCH_ENTRIES } from "./about";

/**
 * The flattened settings search index.
 *
 * Entries are concatenated in `SETTINGS_TABS` order, so the array position of an
 * entry is its tab order — which `settingsSearchMatch` relies on as the stable
 * tie-break between equally scored results.
 */
export const SETTINGS_SEARCH_INDEX: SettingSearchEntry[] = [
  ...GENERAL_SEARCH_ENTRIES,
  ...LANGUAGE_SEARCH_ENTRIES,
  ...BEHAVIOR_SEARCH_ENTRIES,
  ...STARTUP_SEARCH_ENTRIES,
  ...LAYOUT_SEARCH_ENTRIES,
  ...THEME_SEARCH_ENTRIES,
  ...UPDATER_SEARCH_ENTRIES,
  ...SECURITY_SEARCH_ENTRIES,
  ...TRUST_SEARCH_ENTRIES,
  ...PERFORMANCE_SEARCH_ENTRIES,
  ...RDP_DEFAULTS_SEARCH_ENTRIES,
  ...SSH_TERMINAL_SEARCH_ENTRIES,
  ...WEB_BROWSER_SEARCH_ENTRIES,
  ...PROXY_SEARCH_ENTRIES,
  ...VPN_SEARCH_ENTRIES,
  ...BACKUP_SEARCH_ENTRIES,
  ...CLOUD_SYNC_SEARCH_ENTRIES,
  ...RECORDING_SEARCH_ENTRIES,
  ...MACROS_SEARCH_ENTRIES,
  ...API_SEARCH_ENTRIES,
  ...MCP_SERVER_SEARCH_ENTRIES,
  ...AI_SEARCH_ENTRIES,
  ...BACKEND_SEARCH_ENTRIES,
  ...DIAGNOSTICS_SEARCH_ENTRIES,
  ...ADVANCED_SEARCH_ENTRIES,
  ...RECOVERY_SEARCH_ENTRIES,
  ...ABOUT_SEARCH_ENTRIES,
];
