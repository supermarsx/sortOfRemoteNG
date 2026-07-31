/**
 * React hook wrapping the 44 `f2b_*` Tauri commands exposed by the
 * `sorng-fail2ban` backend crate (see t3-e54 wiring).
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  Fail2banAction,
  Fail2banBannedIp,
  Fail2banBannedIpSummary,
  Fail2banFilter,
  Fail2banFilterTestResult,
  Fail2banHost,
  Fail2banHourlyBanCount,
  Fail2banJailStatus,
  Fail2banLogEntry,
  Fail2banLogFileInfo,
  Fail2banLogStats,
  Fail2banStats,
} from "../../types/fail2ban";

export const fail2banInvokeArgs = {
  host: (hostId: string) => ({ hostId }),
  jail: (hostId: string, jailName: string) => ({ hostId, jailName }),
  jailSeconds: (hostId: string, jailName: string, seconds: number) => ({
    hostId,
    jailName,
    seconds,
  }),
  jailCount: (hostId: string, jailName: string, count: number) => ({
    hostId,
    jailName,
    count,
  }),
  ip: (hostId: string, ip: string) => ({ hostId, ip }),
  jailIp: (hostId: string, jailName: string, ip: string) => ({
    hostId,
    jailName,
    ip,
  }),
  filter: (hostId: string, filterName: string) => ({ hostId, filterName }),
  filterTest: (hostId: string, filterName: string, logFile: string) => ({
    hostId,
    logFile,
    filterName,
  }),
  regexTest: (hostId: string, regex: string, logFile: string) => ({
    hostId,
    logFile,
    regex,
  }),
  action: (hostId: string, actionName: string) => ({ hostId, actionName }),
  lines: (hostId: string, lines: number) => ({ hostId, lines }),
  limit: (hostId: string, limit: number) => ({ hostId, limit }),
};

export const fail2banApi = {
  // Host management (5)
  addHost: (host: Fail2banHost): Promise<void> =>
    invoke("f2b_add_host", { host }),
  updateHost: (host: Fail2banHost): Promise<void> =>
    invoke("f2b_update_host", { host }),
  removeHost: (hostId: string): Promise<Fail2banHost> =>
    invoke("f2b_remove_host", fail2banInvokeArgs.host(hostId)),
  listHosts: (): Promise<Fail2banHost[]> => invoke("f2b_list_hosts"),
  getHost: (hostId: string): Promise<Fail2banHost> =>
    invoke("f2b_get_host", fail2banInvokeArgs.host(hostId)),

  // Server control (6)
  ping: (hostId: string): Promise<boolean> =>
    invoke("f2b_ping", fail2banInvokeArgs.host(hostId)),
  version: (hostId: string): Promise<string> =>
    invoke("f2b_version", fail2banInvokeArgs.host(hostId)),
  serverStatus: (hostId: string): Promise<string> =>
    invoke("f2b_server_status", fail2banInvokeArgs.host(hostId)),
  reload: (hostId: string): Promise<void> =>
    invoke("f2b_reload", fail2banInvokeArgs.host(hostId)),
  reloadJail: (hostId: string, jailName: string): Promise<void> =>
    invoke("f2b_reload_jail", fail2banInvokeArgs.jail(hostId, jailName)),
  restartServer: (hostId: string): Promise<void> =>
    invoke("f2b_restart_server", fail2banInvokeArgs.host(hostId)),

  // Jail management (8)
  listJails: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_jails", fail2banInvokeArgs.host(hostId)),
  jailStatus: (hostId: string, jailName: string): Promise<Fail2banJailStatus> =>
    invoke("f2b_jail_status", fail2banInvokeArgs.jail(hostId, jailName)),
  allJailStatuses: (hostId: string): Promise<Fail2banJailStatus[]> =>
    invoke("f2b_all_jail_statuses", fail2banInvokeArgs.host(hostId)),
  startJail: (hostId: string, jailName: string): Promise<void> =>
    invoke("f2b_start_jail", fail2banInvokeArgs.jail(hostId, jailName)),
  stopJail: (hostId: string, jailName: string): Promise<void> =>
    invoke("f2b_stop_jail", fail2banInvokeArgs.jail(hostId, jailName)),
  restartJail: (hostId: string, jailName: string): Promise<void> =>
    invoke("f2b_restart_jail", fail2banInvokeArgs.jail(hostId, jailName)),
  setJailBantime: (
    hostId: string,
    jailName: string,
    seconds: number,
  ): Promise<void> =>
    invoke(
      "f2b_set_jail_bantime",
      fail2banInvokeArgs.jailSeconds(hostId, jailName, seconds),
    ),
  setJailMaxretry: (
    hostId: string,
    jailName: string,
    count: number,
  ): Promise<void> =>
    invoke(
      "f2b_set_jail_maxretry",
      fail2banInvokeArgs.jailCount(hostId, jailName, count),
    ),

  // Ban/unban (6)
  banIp: (hostId: string, jailName: string, ip: string): Promise<void> =>
    invoke("f2b_ban_ip", fail2banInvokeArgs.jailIp(hostId, jailName, ip)),
  unbanIp: (hostId: string, jailName: string, ip: string): Promise<void> =>
    invoke("f2b_unban_ip", fail2banInvokeArgs.jailIp(hostId, jailName, ip)),
  unbanIpAll: (hostId: string, ip: string): Promise<void> =>
    invoke("f2b_unban_ip_all", fail2banInvokeArgs.ip(hostId, ip)),
  listBanned: (hostId: string, jailName: string): Promise<Fail2banBannedIp[]> =>
    invoke("f2b_list_banned", fail2banInvokeArgs.jail(hostId, jailName)),
  listAllBanned: (hostId: string): Promise<Fail2banBannedIp[]> =>
    invoke("f2b_list_all_banned", fail2banInvokeArgs.host(hostId)),
  isBanned: (hostId: string, jailName: string, ip: string): Promise<boolean> =>
    invoke("f2b_is_banned", fail2banInvokeArgs.jailIp(hostId, jailName, ip)),

  // Filters (4)
  listFilters: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_filters", fail2banInvokeArgs.host(hostId)),
  readFilter: (hostId: string, filterName: string): Promise<Fail2banFilter> =>
    invoke("f2b_read_filter", fail2banInvokeArgs.filter(hostId, filterName)),
  testFilter: (
    hostId: string,
    filterName: string,
    logFile: string,
  ): Promise<Fail2banFilterTestResult> =>
    invoke(
      "f2b_test_filter",
      fail2banInvokeArgs.filterTest(hostId, filterName, logFile),
    ),
  testRegex: (
    hostId: string,
    regex: string,
    logFile: string,
  ): Promise<Fail2banFilterTestResult> =>
    invoke(
      "f2b_test_regex",
      fail2banInvokeArgs.regexTest(hostId, regex, logFile),
    ),

  // Actions (2)
  listActions: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_actions", fail2banInvokeArgs.host(hostId)),
  readAction: (hostId: string, actionName: string): Promise<Fail2banAction> =>
    invoke("f2b_read_action", fail2banInvokeArgs.action(hostId, actionName)),

  // Whitelist (4)
  listIgnored: (hostId: string, jailName: string): Promise<string[]> =>
    invoke("f2b_list_ignored", fail2banInvokeArgs.jail(hostId, jailName)),
  addIgnored: (hostId: string, jailName: string, ip: string): Promise<void> =>
    invoke("f2b_add_ignored", fail2banInvokeArgs.jailIp(hostId, jailName, ip)),
  removeIgnored: (
    hostId: string,
    jailName: string,
    ip: string,
  ): Promise<void> =>
    invoke(
      "f2b_remove_ignored",
      fail2banInvokeArgs.jailIp(hostId, jailName, ip),
    ),
  addIgnoredAllJails: (hostId: string, ip: string): Promise<string[]> =>
    invoke("f2b_add_ignored_all_jails", fail2banInvokeArgs.ip(hostId, ip)),

  // Logs (5)
  tailLog: (hostId: string, lines = 200): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_tail_log", fail2banInvokeArgs.lines(hostId, lines)),
  searchLogByIp: (hostId: string, ip: string): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_log_by_ip", fail2banInvokeArgs.ip(hostId, ip)),
  searchLogByJail: (
    hostId: string,
    jailName: string,
  ): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_log_by_jail", fail2banInvokeArgs.jail(hostId, jailName)),
  searchBans: (hostId: string): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_bans", fail2banInvokeArgs.host(hostId)),
  logInfo: (hostId: string): Promise<Fail2banLogFileInfo> =>
    invoke("f2b_log_info", fail2banInvokeArgs.host(hostId)),

  // Stats (4)
  hostStats: (hostId: string): Promise<Fail2banStats> =>
    invoke("f2b_host_stats", fail2banInvokeArgs.host(hostId)),
  topBannedIps: (
    hostId: string,
    limit = 20,
  ): Promise<Fail2banBannedIpSummary[]> =>
    invoke("f2b_top_banned_ips", fail2banInvokeArgs.limit(hostId, limit)),
  logStats: (hostId: string): Promise<Fail2banLogStats> =>
    invoke("f2b_log_stats", fail2banInvokeArgs.host(hostId)),
  banFrequency: (hostId: string): Promise<Fail2banHourlyBanCount[]> =>
    invoke("f2b_ban_frequency", fail2banInvokeArgs.host(hostId)),
};

export function useFail2ban() {
  return useMemo(() => ({ api: fail2banApi }), []);
}
