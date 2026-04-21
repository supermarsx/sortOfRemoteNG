/**
 * React hook wrapping the 44 `f2b_*` Tauri commands exposed by the
 * `sorng-fail2ban` backend crate (see t3-e54 wiring).
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  Fail2banAction,
  Fail2banBannedIp,
  Fail2banFilter,
  Fail2banFilterTestResult,
  Fail2banHost,
  Fail2banHourlyBanCount,
  Fail2banJail,
  Fail2banJailStatus,
  Fail2banLogEntry,
  Fail2banLogFileInfo,
  Fail2banLogStats,
  Fail2banStats,
} from "../../types/fail2ban";

export const fail2banApi = {
  // Host management (5)
  addHost: (host: Fail2banHost): Promise<void> =>
    invoke("f2b_add_host", { host }),
  updateHost: (host: Fail2banHost): Promise<void> =>
    invoke("f2b_update_host", { host }),
  removeHost: (hostId: string): Promise<Fail2banHost> =>
    invoke("f2b_remove_host", { hostId }),
  listHosts: (): Promise<Fail2banHost[]> => invoke("f2b_list_hosts"),
  getHost: (hostId: string): Promise<Fail2banHost> =>
    invoke("f2b_get_host", { hostId }),

  // Server control (6)
  ping: (hostId: string): Promise<boolean> => invoke("f2b_ping", { hostId }),
  version: (hostId: string): Promise<string> => invoke("f2b_version", { hostId }),
  serverStatus: (hostId: string): Promise<Fail2banStats> =>
    invoke("f2b_server_status", { hostId }),
  reload: (hostId: string): Promise<void> => invoke("f2b_reload", { hostId }),
  reloadJail: (hostId: string, jail: string): Promise<void> =>
    invoke("f2b_reload_jail", { hostId, jail }),
  restartServer: (hostId: string): Promise<void> =>
    invoke("f2b_restart_server", { hostId }),

  // Jail management (8)
  listJails: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_jails", { hostId }),
  jailStatus: (hostId: string, jail: string): Promise<Fail2banJailStatus> =>
    invoke("f2b_jail_status", { hostId, jail }),
  allJailStatuses: (hostId: string): Promise<Fail2banJailStatus[]> =>
    invoke("f2b_all_jail_statuses", { hostId }),
  startJail: (hostId: string, jail: string): Promise<void> =>
    invoke("f2b_start_jail", { hostId, jail }),
  stopJail: (hostId: string, jail: string): Promise<void> =>
    invoke("f2b_stop_jail", { hostId, jail }),
  restartJail: (hostId: string, jail: string): Promise<void> =>
    invoke("f2b_restart_jail", { hostId, jail }),
  setJailBantime: (hostId: string, jail: string, bantime: number): Promise<void> =>
    invoke("f2b_set_jail_bantime", { hostId, jail, bantime }),
  setJailMaxretry: (hostId: string, jail: string, maxretry: number): Promise<void> =>
    invoke("f2b_set_jail_maxretry", { hostId, jail, maxretry }),

  // Ban/unban (6)
  banIp: (hostId: string, jail: string, ip: string): Promise<void> =>
    invoke("f2b_ban_ip", { hostId, jail, ip }),
  unbanIp: (hostId: string, jail: string, ip: string): Promise<void> =>
    invoke("f2b_unban_ip", { hostId, jail, ip }),
  unbanIpAll: (hostId: string, ip: string): Promise<void> =>
    invoke("f2b_unban_ip_all", { hostId, ip }),
  listBanned: (hostId: string, jail: string): Promise<Fail2banBannedIp[]> =>
    invoke("f2b_list_banned", { hostId, jail }),
  listAllBanned: (hostId: string): Promise<Fail2banBannedIp[]> =>
    invoke("f2b_list_all_banned", { hostId }),
  isBanned: (hostId: string, jail: string, ip: string): Promise<boolean> =>
    invoke("f2b_is_banned", { hostId, jail, ip }),

  // Filters (4)
  listFilters: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_filters", { hostId }),
  readFilter: (hostId: string, filter: string): Promise<Fail2banFilter> =>
    invoke("f2b_read_filter", { hostId, filter }),
  testFilter: (
    hostId: string,
    filter: string,
    logContent: string,
  ): Promise<Fail2banFilterTestResult> =>
    invoke("f2b_test_filter", { hostId, filter, logContent }),
  testRegex: (hostId: string, regex: string, logContent: string): Promise<Fail2banFilterTestResult> =>
    invoke("f2b_test_regex", { hostId, regex, logContent }),

  // Actions (2)
  listActions: (hostId: string): Promise<string[]> =>
    invoke("f2b_list_actions", { hostId }),
  readAction: (hostId: string, action: string): Promise<Fail2banAction> =>
    invoke("f2b_read_action", { hostId, action }),

  // Whitelist (4)
  listIgnored: (hostId: string, jail: string): Promise<string[]> =>
    invoke("f2b_list_ignored", { hostId, jail }),
  addIgnored: (hostId: string, jail: string, ip: string): Promise<void> =>
    invoke("f2b_add_ignored", { hostId, jail, ip }),
  removeIgnored: (hostId: string, jail: string, ip: string): Promise<void> =>
    invoke("f2b_remove_ignored", { hostId, jail, ip }),
  addIgnoredAllJails: (hostId: string, ip: string): Promise<void> =>
    invoke("f2b_add_ignored_all_jails", { hostId, ip }),

  // Logs (5)
  tailLog: (hostId: string, lines?: number): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_tail_log", { hostId, lines }),
  searchLogByIp: (hostId: string, ip: string): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_log_by_ip", { hostId, ip }),
  searchLogByJail: (hostId: string, jail: string): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_log_by_jail", { hostId, jail }),
  searchBans: (hostId: string, query: string): Promise<Fail2banLogEntry[]> =>
    invoke("f2b_search_bans", { hostId, query }),
  logInfo: (hostId: string): Promise<Fail2banLogFileInfo> =>
    invoke("f2b_log_info", { hostId }),

  // Stats (4)
  hostStats: (hostId: string): Promise<Fail2banStats> =>
    invoke("f2b_host_stats", { hostId }),
  topBannedIps: (hostId: string, limit?: number): Promise<Array<[string, number]>> =>
    invoke("f2b_top_banned_ips", { hostId, limit }),
  logStats: (hostId: string): Promise<Fail2banLogStats> =>
    invoke("f2b_log_stats", { hostId }),
  banFrequency: (hostId: string): Promise<Fail2banHourlyBanCount[]> =>
    invoke("f2b_ban_frequency", { hostId }),
};

export function useFail2ban() {
  return useMemo(() => ({ api: fail2banApi }), []);
}
