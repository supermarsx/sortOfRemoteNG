// useCpanelServer — real Tauri `invoke(...)` wrappers for the sorng-cpanel
// "server" category (t42-cpanel-c1): WHM / Server Administration. Binds all 39
// commands across six blocks:
//   Accounts (12) · DNS (5) · Backups (5) · Security (8) · Monitoring (4) · PHP (5)
//
// Pairs 1:1 with the matching command blocks in
//   src-tauri/crates/sorng-cpanel/src/commands.rs
// Every command's first arg is the live connection `id` (= the shell's
// `connectionId`). Account-scope commands additionally take a cPanel account
// `user`. Tauri camelCases the top-level fn params, so two-word Rust params map
// as `keep_dns -> keepDns`, `key_type -> keyType`; request STRUCT fields stay
// snake_case (see `../../../types/cpanel/server`).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AccountSummary,
  AddDnsRecordRequest,
  BandwidthUsage,
  BackupInfo,
  CpanelAccount,
  CpanelServerInfo,
  CreateAccountRequest,
  DnsZone,
  EditDnsRecordRequest,
  ErrorLogEntry,
  HostingPackage,
  IpBlockRule,
  ModifyAccountRequest,
  PhpConfig,
  PhpExtension,
  PhpVersion,
  ResourceUsage,
  ServerLoadStatus,
  SshKey,
} from "../../../types/cpanel/server";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const cpanelServerApi = {
  // ── Accounts (12) ─────────────────────────────────────────────────────────
  listAccounts: (id: string) =>
    invoke<CpanelAccount[]>("cpanel_list_accounts", { id }),
  getAccount: (id: string, user: string) =>
    invoke<CpanelAccount>("cpanel_get_account", { id, user }),
  createAccount: (id: string, req: CreateAccountRequest) =>
    invoke<string>("cpanel_create_account", { id, req }),
  suspendAccount: (id: string, user: string, reason?: string) =>
    invoke<string>("cpanel_suspend_account", { id, user, reason }),
  unsuspendAccount: (id: string, user: string) =>
    invoke<string>("cpanel_unsuspend_account", { id, user }),
  terminateAccount: (id: string, user: string, keepDns: boolean) =>
    invoke<string>("cpanel_terminate_account", { id, user, keepDns }),
  modifyAccount: (id: string, req: ModifyAccountRequest) =>
    invoke<string>("cpanel_modify_account", { id, req }),
  changeAccountPassword: (id: string, user: string, password: string) =>
    invoke<string>("cpanel_change_account_password", { id, user, password }),
  listPackages: (id: string) =>
    invoke<HostingPackage[]>("cpanel_list_packages", { id }),
  getAccountSummary: (id: string, user: string) =>
    invoke<AccountSummary>("cpanel_get_account_summary", { id, user }),
  listSuspendedAccounts: (id: string) =>
    invoke<CpanelAccount[]>("cpanel_list_suspended_accounts", { id }),
  getServerInfo: (id: string) =>
    invoke<CpanelServerInfo>("cpanel_get_server_info", { id }),

  // ── DNS (5) ───────────────────────────────────────────────────────────────
  listDnsZones: (id: string) =>
    invoke<string[]>("cpanel_list_dns_zones", { id }),
  getDnsZone: (id: string, domain: string) =>
    invoke<DnsZone>("cpanel_get_dns_zone", { id, domain }),
  addDnsRecord: (id: string, req: AddDnsRecordRequest) =>
    invoke<string>("cpanel_add_dns_record", { id, req }),
  editDnsRecord: (id: string, req: EditDnsRecordRequest) =>
    invoke<string>("cpanel_edit_dns_record", { id, req }),
  removeDnsRecord: (id: string, zone: string, line: number) =>
    invoke<string>("cpanel_remove_dns_record", { id, zone, line }),

  // ── Backups (5) ─────────────────────────────────────────────────────────---
  listBackups: (id: string, user: string) =>
    invoke<BackupInfo[]>("cpanel_list_backups", { id, user }),
  createFullBackup: (id: string, user: string, dest?: string, email?: string) =>
    invoke<string>("cpanel_create_full_backup", { id, user, dest, email }),
  restoreFile: (id: string, user: string, backup: string, path: string) =>
    invoke<string>("cpanel_restore_file", { id, user, backup, path }),
  getBackupConfig: (id: string) =>
    invoke<unknown>("cpanel_get_backup_config", { id }),
  triggerServerBackup: (id: string) =>
    invoke<string>("cpanel_trigger_server_backup", { id }),

  // ── Security (8) ──────────────────────────────────────────────────────────
  listBlockedIps: (id: string, user: string) =>
    invoke<IpBlockRule[]>("cpanel_list_blocked_ips", { id, user }),
  blockIp: (id: string, user: string, ip: string) =>
    invoke<string>("cpanel_block_ip", { id, user, ip }),
  unblockIp: (id: string, user: string, ip: string) =>
    invoke<string>("cpanel_unblock_ip", { id, user, ip }),
  listSshKeys: (id: string, user: string) =>
    invoke<SshKey[]>("cpanel_list_ssh_keys", { id, user }),
  importSshKey: (
    id: string,
    user: string,
    name: string,
    key: string,
    keyType: string,
  ) => invoke<string>("cpanel_import_ssh_key", { id, user, name, key, keyType }),
  deleteSshKey: (id: string, user: string, name: string, keyType: string) =>
    invoke<string>("cpanel_delete_ssh_key", { id, user, name, keyType }),
  getModsecStatus: (id: string, domain: string) =>
    invoke<boolean>("cpanel_get_modsec_status", { id, domain }),
  setModsec: (id: string, domain: string, enabled: boolean) =>
    invoke<string>("cpanel_set_modsec", { id, domain, enabled }),

  // ── Monitoring (4) ────────────────────────────────────────────────────────
  getBandwidth: (id: string, user: string) =>
    invoke<BandwidthUsage>("cpanel_get_bandwidth", { id, user }),
  getResourceUsage: (id: string, user: string) =>
    invoke<ResourceUsage>("cpanel_get_resource_usage", { id, user }),
  getErrorLog: (id: string, user: string, lines: number) =>
    invoke<ErrorLogEntry[]>("cpanel_get_error_log", { id, user, lines }),
  getServerLoad: (id: string) =>
    invoke<ServerLoadStatus>("cpanel_get_server_load", { id }),

  // ── PHP (5) ───────────────────────────────────────────────────────────────
  listPhpVersions: (id: string) =>
    invoke<PhpVersion[]>("cpanel_list_php_versions", { id }),
  getDomainPhpVersion: (id: string, user: string, domain: string) =>
    invoke<string>("cpanel_get_domain_php_version", { id, user, domain }),
  setDomainPhpVersion: (
    id: string,
    user: string,
    domain: string,
    version: string,
  ) =>
    invoke<string>("cpanel_set_domain_php_version", {
      id,
      user,
      domain,
      version,
    }),
  getPhpConfig: (id: string, user: string, version: string) =>
    invoke<PhpConfig>("cpanel_get_php_config", { id, user, version }),
  listPhpExtensions: (id: string, user: string, version: string) =>
    invoke<PhpExtension[]>("cpanel_list_php_extensions", { id, user, version }),
};

export type CpanelServerApi = typeof cpanelServerApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the cPanel/WHM Server-Administration tab. `run`
 * wraps any `cpanelServerApi` call, tracking `isLoading` and surfacing errors
 * with the shared error idiom (Tauri rejects with a plain string via the
 * command's `map_err`); it resolves to the value, or `undefined` on failure.
 */
export function useCpanelServer() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(
      fn: (api: CpanelServerApi) => Promise<T>,
    ): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(cpanelServerApi);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { api: cpanelServerApi, run, isLoading, error, clearError };
}

export type CpanelServerManager = ReturnType<typeof useCpanelServer>;
