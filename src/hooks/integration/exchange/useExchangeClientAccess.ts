// Exchange — "Client Access & Protocols" invoke slice + hook (t42-exchange-c4).
//
// `exchangeClientAccessApi` is a thin 1:1 wrapper over the 44 `exchange_*` Tauri
// commands of this category (Calendar 5, Public folders 7, Mobile devices 7,
// Inbox rules 7, Client-access policies 8, Virtual directories & Outlook Anywhere
// 10). Argument names are camelCase exactly matching the Rust fn params after the
// `#[tauri::command]` macro's snake→camel conversion.
//
// ⚠️ Exchange is a SINGLETON service: NO command takes a connection id — each
// operates on the one active connection. Call each wrapper with its own
// command-specific args only.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CalendarPermission,
  CreateInboxRuleRequest,
  InboxRule,
  MobileDevice,
  MobileDeviceMailboxPolicy,
  MobileDeviceStatistics,
  OwaMailboxPolicy,
  PublicFolder,
  PublicFolderStatistics,
  ResourceBookingConfig,
  ThrottlingPolicy,
  VirtualDirectory,
  VirtualDirectoryType,
} from "../../../types/exchange/clientaccess";

/** Free-form param bag for the `params: serde_json::Value` mutate commands. */
type ParamBag = Record<string, unknown>;

/** One thin wrapper per command. No connection id (singleton service). */
export const exchangeClientAccessApi = {
  // ── Calendar & resource booking ─────────────────────────────────────────
  listCalendarPermissions: (identity: string) =>
    invoke<CalendarPermission[]>("exchange_list_calendar_permissions", {
      identity,
    }),
  setCalendarPermission: (
    identity: string,
    user: string,
    accessRights: string,
  ) =>
    invoke<string>("exchange_set_calendar_permission", {
      identity,
      user,
      accessRights,
    }),
  removeCalendarPermission: (identity: string, user: string) =>
    invoke<string>("exchange_remove_calendar_permission", { identity, user }),
  getBookingConfig: (identity: string) =>
    invoke<ResourceBookingConfig>("exchange_get_booking_config", { identity }),
  setBookingConfig: (config: ResourceBookingConfig) =>
    invoke<string>("exchange_set_booking_config", { config }),

  // ── Public folders ──────────────────────────────────────────────────────
  listPublicFolders: (root?: string | null, recurse?: boolean) =>
    invoke<PublicFolder[]>("exchange_list_public_folders", { root, recurse }),
  getPublicFolder: (identity: string) =>
    invoke<PublicFolder>("exchange_get_public_folder", { identity }),
  createPublicFolder: (name: string, path?: string | null) =>
    invoke<PublicFolder>("exchange_create_public_folder", { name, path }),
  removePublicFolder: (identity: string) =>
    invoke<string>("exchange_remove_public_folder", { identity }),
  mailEnablePublicFolder: (identity: string) =>
    invoke<string>("exchange_mail_enable_public_folder", { identity }),
  mailDisablePublicFolder: (identity: string) =>
    invoke<string>("exchange_mail_disable_public_folder", { identity }),
  getPublicFolderStatistics: (identity: string) =>
    invoke<PublicFolderStatistics>("exchange_get_public_folder_statistics", {
      identity,
    }),

  // ── Mobile devices ──────────────────────────────────────────────────────
  listMobileDevices: (mailbox: string) =>
    invoke<MobileDevice[]>("exchange_list_mobile_devices", { mailbox }),
  getMobileDeviceStatistics: (identity: string) =>
    invoke<MobileDeviceStatistics>("exchange_get_mobile_device_statistics", {
      identity,
    }),
  wipeMobileDevice: (identity: string) =>
    invoke<string>("exchange_wipe_mobile_device", { identity }),
  blockMobileDevice: (identity: string) =>
    invoke<string>("exchange_block_mobile_device", { identity }),
  allowMobileDevice: (identity: string) =>
    invoke<string>("exchange_allow_mobile_device", { identity }),
  removeMobileDevice: (identity: string) =>
    invoke<string>("exchange_remove_mobile_device", { identity }),
  listAllMobileDevices: (resultSize?: number | null) =>
    invoke<MobileDevice[]>("exchange_list_all_mobile_devices", { resultSize }),

  // ── Inbox rules ─────────────────────────────────────────────────────────
  listInboxRules: (mailbox: string) =>
    invoke<InboxRule[]>("exchange_list_inbox_rules", { mailbox }),
  getInboxRule: (mailbox: string, ruleId: string) =>
    invoke<InboxRule>("exchange_get_inbox_rule", { mailbox, ruleId }),
  createInboxRule: (request: CreateInboxRuleRequest) =>
    invoke<InboxRule>("exchange_create_inbox_rule", { request }),
  updateInboxRule: (mailbox: string, ruleId: string, params: ParamBag) =>
    invoke<string>("exchange_update_inbox_rule", { mailbox, ruleId, params }),
  removeInboxRule: (mailbox: string, ruleId: string) =>
    invoke<string>("exchange_remove_inbox_rule", { mailbox, ruleId }),
  enableInboxRule: (mailbox: string, ruleId: string) =>
    invoke<string>("exchange_enable_inbox_rule", { mailbox, ruleId }),
  disableInboxRule: (mailbox: string, ruleId: string) =>
    invoke<string>("exchange_disable_inbox_rule", { mailbox, ruleId }),

  // ── Client-access policies (OWA / mobile device / throttling) ───────────
  listOwaPolicies: () =>
    invoke<OwaMailboxPolicy[]>("exchange_list_owa_policies"),
  getOwaPolicy: (identity: string) =>
    invoke<OwaMailboxPolicy>("exchange_get_owa_policy", { identity }),
  setOwaPolicy: (identity: string, params: ParamBag) =>
    invoke<string>("exchange_set_owa_policy", { identity, params }),
  listMobileDevicePolicies: () =>
    invoke<MobileDeviceMailboxPolicy[]>("exchange_list_mobile_device_policies"),
  getMobileDevicePolicy: (identity: string) =>
    invoke<MobileDeviceMailboxPolicy>("exchange_get_mobile_device_policy", {
      identity,
    }),
  setMobileDevicePolicy: (identity: string, params: ParamBag) =>
    invoke<string>("exchange_set_mobile_device_policy", { identity, params }),
  listThrottlingPolicies: () =>
    invoke<ThrottlingPolicy[]>("exchange_list_throttling_policies"),
  getThrottlingPolicy: (identity: string) =>
    invoke<ThrottlingPolicy>("exchange_get_throttling_policy", { identity }),

  // ── Virtual directories & Outlook Anywhere ──────────────────────────────
  listOwaVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_owa_virtual_directories", {
      server,
    }),
  listEcpVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_ecp_virtual_directories", {
      server,
    }),
  listActivesyncVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>(
      "exchange_list_activesync_virtual_directories",
      { server },
    ),
  listEwsVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_ews_virtual_directories", {
      server,
    }),
  listMapiVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_mapi_virtual_directories", {
      server,
    }),
  listAutodiscoverVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>(
      "exchange_list_autodiscover_virtual_directories",
      { server },
    ),
  listPowershellVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>(
      "exchange_list_powershell_virtual_directories",
      { server },
    ),
  listOabVirtualDirectories: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_oab_virtual_directories", {
      server,
    }),
  setVirtualDirectoryUrls: (
    vdirType: VirtualDirectoryType,
    identity: string,
    internalUrl?: string | null,
    externalUrl?: string | null,
  ) =>
    invoke<string>("exchange_set_virtual_directory_urls", {
      vdirType,
      identity,
      internalUrl,
      externalUrl,
    }),
  listOutlookAnywhere: (server?: string | null) =>
    invoke<VirtualDirectory[]>("exchange_list_outlook_anywhere", { server }),
} as const;

export type ExchangeClientAccessApi = typeof exchangeClientAccessApi;

/** Cross-cutting request lifecycle helper for the tab: every command is funneled
 *  through a shared `loading` / `error` surface. Section view-state stays in the
 *  component; this hook owns only the request plumbing. */
export function useExchangeClientAccess() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run an api call with shared loading/error handling. Returns the resolved
   *  value, or `undefined` if the call threw (the error is captured in state). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    api: exchangeClientAccessApi,
    loading,
    error,
    setError,
    clearError,
    run,
  };
}

export type UseExchangeClientAccess = ReturnType<typeof useExchangeClientAccess>;
