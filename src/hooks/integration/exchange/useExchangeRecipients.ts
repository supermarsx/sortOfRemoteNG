// useExchangeRecipients — "Recipients & Mailboxes" category slice (t42 `c1`).
//
// `exchangeRecipientsApi` pairs 1:1 with the 49 recipient commands in
// `src-tauri/crates/sorng-exchange/src/commands.rs` (mailboxes, distribution /
// M365 groups, mail contacts & mail users, shared / resource mailboxes, and
// archive mailboxes). Argument keys are the camelCase form of each Rust
// `#[tauri::command]` param (Tauri maps `resultSize` → `result_size`,
// `accessRights` → `access_rights`, …).
//
// ⚠️ Exchange is a SINGLETON service: there is NO connection id. Every command
// runs against the one active connection established by the shell, so the
// wrappers pass only their command-specific args.

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ArchiveMailboxInfo,
  ArchiveStatistics,
  ConvertMailboxRequest,
  CreateGroupRequest,
  CreateMailContactRequest,
  CreateMailUserRequest,
  CreateMailboxRequest,
  DistributionGroup,
  GroupMember,
  Mailbox,
  MailboxForwarding,
  MailboxPermission,
  MailboxStatistics,
  MailContact,
  MailUser,
  OutOfOfficeSettings,
  UpdateGroupRequest,
  UpdateMailboxRequest,
} from "../../../types/exchange/recipients";

/** Raw JSON body for the params-based update commands (`serde_json::Value`). */
export type ExchangeParams = Record<string, unknown>;

// ─── Low-level invoke wrappers (all 49 recipient commands) ────────────────────

export const exchangeRecipientsApi = {
  // Mailboxes (14)
  listMailboxes: (resultSize?: number, filter?: string) =>
    invoke<Mailbox[]>("exchange_list_mailboxes", { resultSize, filter }),
  getMailbox: (identity: string) =>
    invoke<Mailbox>("exchange_get_mailbox", { identity }),
  createMailbox: (request: CreateMailboxRequest) =>
    invoke<Mailbox>("exchange_create_mailbox", { request }),
  removeMailbox: (identity: string) =>
    invoke<string>("exchange_remove_mailbox", { identity }),
  enableMailbox: (identity: string, database?: string) =>
    invoke<Mailbox>("exchange_enable_mailbox", { identity, database }),
  disableMailbox: (identity: string) =>
    invoke<string>("exchange_disable_mailbox", { identity }),
  updateMailbox: (request: UpdateMailboxRequest) =>
    invoke<string>("exchange_update_mailbox", { request }),
  getMailboxStatistics: (identity: string) =>
    invoke<MailboxStatistics>("exchange_get_mailbox_statistics", { identity }),
  getMailboxPermissions: (identity: string) =>
    invoke<MailboxPermission[]>("exchange_get_mailbox_permissions", {
      identity,
    }),
  addMailboxPermission: (
    identity: string,
    user: string,
    accessRights: string,
  ) =>
    invoke<string>("exchange_add_mailbox_permission", {
      identity,
      user,
      accessRights,
    }),
  removeMailboxPermission: (
    identity: string,
    user: string,
    accessRights: string,
  ) =>
    invoke<string>("exchange_remove_mailbox_permission", {
      identity,
      user,
      accessRights,
    }),
  getForwarding: (identity: string) =>
    invoke<MailboxForwarding>("exchange_get_forwarding", { identity }),
  getOoo: (identity: string) =>
    invoke<OutOfOfficeSettings>("exchange_get_ooo", { identity }),
  setOoo: (settings: OutOfOfficeSettings) =>
    invoke<string>("exchange_set_ooo", { settings }),

  // Distribution / M365 groups (9)
  listGroups: (resultSize?: number) =>
    invoke<DistributionGroup[]>("exchange_list_groups", { resultSize }),
  getGroup: (identity: string) =>
    invoke<DistributionGroup>("exchange_get_group", { identity }),
  createGroup: (request: CreateGroupRequest) =>
    invoke<DistributionGroup>("exchange_create_group", { request }),
  updateGroup: (request: UpdateGroupRequest) =>
    invoke<string>("exchange_update_group", { request }),
  removeGroup: (identity: string) =>
    invoke<string>("exchange_remove_group", { identity }),
  listGroupMembers: (identity: string) =>
    invoke<GroupMember[]>("exchange_list_group_members", { identity }),
  addGroupMember: (group: string, member: string) =>
    invoke<string>("exchange_add_group_member", { group, member }),
  removeGroupMember: (group: string, member: string) =>
    invoke<string>("exchange_remove_group_member", { group, member }),
  listDynamicGroups: () =>
    invoke<DistributionGroup[]>("exchange_list_dynamic_groups"),

  // Mail contacts & mail users (10)
  listMailContacts: (resultSize?: number) =>
    invoke<MailContact[]>("exchange_list_mail_contacts", { resultSize }),
  getMailContact: (identity: string) =>
    invoke<MailContact>("exchange_get_mail_contact", { identity }),
  createMailContact: (request: CreateMailContactRequest) =>
    invoke<MailContact>("exchange_create_mail_contact", { request }),
  updateMailContact: (identity: string, params: ExchangeParams) =>
    invoke<string>("exchange_update_mail_contact", { identity, params }),
  removeMailContact: (identity: string) =>
    invoke<string>("exchange_remove_mail_contact", { identity }),
  listMailUsers: (resultSize?: number) =>
    invoke<MailUser[]>("exchange_list_mail_users", { resultSize }),
  getMailUser: (identity: string) =>
    invoke<MailUser>("exchange_get_mail_user", { identity }),
  createMailUser: (request: CreateMailUserRequest) =>
    invoke<MailUser>("exchange_create_mail_user", { request }),
  removeMailUser: (identity: string) =>
    invoke<string>("exchange_remove_mail_user", { identity }),
  convertMailbox: (req: ConvertMailboxRequest) =>
    invoke<Mailbox>("exchange_convert_mailbox", { req }),

  // Shared / resource mailboxes (10)
  listSharedMailboxes: (resultSize?: number) =>
    invoke<Mailbox[]>("exchange_list_shared_mailboxes", { resultSize }),
  listRoomMailboxes: () =>
    invoke<Mailbox[]>("exchange_list_room_mailboxes"),
  listEquipmentMailboxes: () =>
    invoke<Mailbox[]>("exchange_list_equipment_mailboxes"),
  addAutomapping: (mailbox: string, user: string) =>
    invoke<string>("exchange_add_automapping", { mailbox, user }),
  removeAutomapping: (mailbox: string, user: string) =>
    invoke<string>("exchange_remove_automapping", { mailbox, user }),
  addSendAs: (mailbox: string, trustee: string) =>
    invoke<string>("exchange_add_send_as", { mailbox, trustee }),
  removeSendAs: (mailbox: string, trustee: string) =>
    invoke<string>("exchange_remove_send_as", { mailbox, trustee }),
  addSendOnBehalf: (mailbox: string, trustee: string) =>
    invoke<string>("exchange_add_send_on_behalf", { mailbox, trustee }),
  removeSendOnBehalf: (mailbox: string, trustee: string) =>
    invoke<string>("exchange_remove_send_on_behalf", { mailbox, trustee }),
  listRoomLists: () =>
    invoke<DistributionGroup[]>("exchange_list_room_lists"),

  // Archive mailboxes (6)
  getArchiveInfo: (identity: string) =>
    invoke<ArchiveMailboxInfo>("exchange_get_archive_info", { identity }),
  enableArchive: (identity: string, database?: string) =>
    invoke<string>("exchange_enable_archive", { identity, database }),
  disableArchive: (identity: string) =>
    invoke<string>("exchange_disable_archive", { identity }),
  enableAutoExpandingArchive: (identity: string) =>
    invoke<string>("exchange_enable_auto_expanding_archive", { identity }),
  setArchiveQuota: (identity: string, quota: string, warningQuota: string) =>
    invoke<string>("exchange_set_archive_quota", {
      identity,
      quota,
      warningQuota,
    }),
  getArchiveStatistics: (identity: string) =>
    invoke<ArchiveStatistics>("exchange_get_archive_statistics", { identity }),
};

export type ExchangeRecipientsApi = typeof exchangeRecipientsApi;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseExchangeRecipients {
  /** The raw invoke wrappers (all 49 recipient commands). */
  api: ExchangeRecipientsApi;
  /** Rows for the currently loaded list section. */
  items: unknown[];
  loading: boolean;
  /** True while a create/update/delete/detail action is in flight. */
  busy: boolean;
  error: string | null;
  /** Run a list loader and store its rows (Exchange lists are plain arrays). */
  loadList: (loader: () => Promise<unknown[]>) => Promise<void>;
  /** Run a mutation/detail action, surfacing loading + errors. Returns the
   *  result on success, or `null` on failure (error is set). */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  clearItems: () => void;
  clearError: () => void;
}

function toMessage(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * State machine for the Recipients tab: one active list (rows + loading) plus a
 * shared busy/error channel for detail fetches and mutations. Resource-agnostic
 * so the tab can point `loadList` at any recipient list command and `run` at any
 * of the get/create/update/remove/permission/archive commands.
 */
export function useExchangeRecipients(): UseExchangeRecipients {
  const [items, setItems] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier list load overwriting a newer one.
  const loadSeq = useRef(0);

  const loadList = useCallback(
    async (loader: () => Promise<unknown[]>): Promise<void> => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await loader();
        if (seq !== loadSeq.current) return;
        setItems(res ?? []);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(toMessage(e));
        setItems([]);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [],
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (e) {
        setError(toMessage(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const clearItems = useCallback(() => setItems([]), []);
  const clearError = useCallback(() => setError(null), []);

  return {
    api: exchangeRecipientsApi,
    items,
    loading,
    busy,
    error,
    loadList,
    run,
    clearItems,
    clearError,
  };
}
