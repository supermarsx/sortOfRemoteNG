// useDovecot — Dovecot (IMAP/POP3) invoke slice + connection-lifecycle hook
// (t42 Wave M, sub-tab t42-mail-dovecot). Binds all 70 `dovecot_*` Tauri
// commands full-depth and exposes a self-contained connect/disconnect/ping
// lifecycle for the DovecotSubTab.
//
// serde: the `config`/`request`/`rule` bodies are snake_case (the crate carries
// no `#[serde(rename_all)]` on these structs — see `src/types/mail/dovecot.ts`).
// Only the top-level command ARG names follow Tauri's camelCase conversion, so
// Rust `old_name`/`new_name` are passed as `oldName`/`newName` below.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  ConfigTestResult,
  CreateSieveRequest,
  CreateUserRequest,
  DovecotAcl,
  DovecotAuthConfig,
  DovecotConfigParam,
  DovecotConnectionConfig,
  DovecotConnectionSummary,
  DovecotInfo,
  DovecotLog,
  DovecotMailbox,
  DovecotMailboxStatus,
  DovecotNamespace,
  DovecotPlugin,
  DovecotProcess,
  DovecotQuota,
  DovecotQuotaRule,
  DovecotReplication,
  DovecotService,
  DovecotSieveScript,
  DovecotStats,
  DovecotUser,
  UpdateSieveRequest,
  UpdateUserRequest,
} from "../../../types/mail/dovecot";

/** Thin invoke wrappers for every `dovecot_*` command, grouped by section. All 70
 *  commands are bound full-depth; the first `id` arg is the panel's persisted
 *  instance id. */
export const dovecotApi = {
  // ── Connection (4) ─────────────────────────────────────────────────────────
  connect: (id: string, config: DovecotConnectionConfig) =>
    invoke<DovecotConnectionSummary>("dovecot_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("dovecot_disconnect", { id }),
  listConnections: () => invoke<string[]>("dovecot_list_connections"),
  ping: (id: string) => invoke<boolean>("dovecot_ping", { id }),

  // ── Mailboxes (10) ─────────────────────────────────────────────────────────
  listMailboxes: (id: string, user: string) =>
    invoke<DovecotMailbox[]>("dovecot_list_mailboxes", { id, user }),
  mailboxStatus: (id: string, user: string, mailbox: string) =>
    invoke<DovecotMailboxStatus>("dovecot_mailbox_status", {
      id,
      user,
      mailbox,
    }),
  createMailbox: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_create_mailbox", { id, user, name }),
  deleteMailbox: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_delete_mailbox", { id, user, name }),
  renameMailbox: (id: string, user: string, oldName: string, newName: string) =>
    invoke<void>("dovecot_rename_mailbox", { id, user, oldName, newName }),
  subscribeMailbox: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_subscribe_mailbox", { id, user, name }),
  unsubscribeMailbox: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_unsubscribe_mailbox", { id, user, name }),
  listSubscriptions: (id: string, user: string) =>
    invoke<string[]>("dovecot_list_subscriptions", { id, user }),
  syncMailbox: (id: string, user: string) =>
    invoke<void>("dovecot_sync_mailbox", { id, user }),
  forceResync: (id: string, user: string, mailbox: string) =>
    invoke<void>("dovecot_force_resync", { id, user, mailbox }),

  // ── Users & auth (8) ───────────────────────────────────────────────────────
  listUsers: (id: string) => invoke<DovecotUser[]>("dovecot_list_users", { id }),
  getUser: (id: string, username: string) =>
    invoke<DovecotUser>("dovecot_get_user", { id, username }),
  createUser: (id: string, request: CreateUserRequest) =>
    invoke<DovecotUser>("dovecot_create_user", { id, request }),
  updateUser: (id: string, username: string, request: UpdateUserRequest) =>
    invoke<DovecotUser>("dovecot_update_user", { id, username, request }),
  deleteUser: (id: string, username: string) =>
    invoke<void>("dovecot_delete_user", { id, username }),
  authTest: (id: string, username: string, password: string) =>
    invoke<boolean>("dovecot_auth_test", { id, username, password }),
  kickUser: (id: string, username: string) =>
    invoke<void>("dovecot_kick_user", { id, username }),
  who: (id: string) => invoke<DovecotProcess[]>("dovecot_who", { id }),

  // ── Sieve (8) ──────────────────────────────────────────────────────────────
  listSieve: (id: string, user: string) =>
    invoke<DovecotSieveScript[]>("dovecot_list_sieve", { id, user }),
  getSieve: (id: string, user: string, name: string) =>
    invoke<DovecotSieveScript>("dovecot_get_sieve", { id, user, name }),
  createSieve: (id: string, user: string, request: CreateSieveRequest) =>
    invoke<DovecotSieveScript>("dovecot_create_sieve", { id, user, request }),
  updateSieve: (
    id: string,
    user: string,
    name: string,
    request: UpdateSieveRequest,
  ) => invoke<DovecotSieveScript>("dovecot_update_sieve", {
    id,
    user,
    name,
    request,
  }),
  deleteSieve: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_delete_sieve", { id, user, name }),
  activateSieve: (id: string, user: string, name: string) =>
    invoke<void>("dovecot_activate_sieve", { id, user, name }),
  deactivateSieve: (id: string, user: string) =>
    invoke<void>("dovecot_deactivate_sieve", { id, user }),
  compileSieve: (id: string, user: string, name: string) =>
    invoke<ConfigTestResult>("dovecot_compile_sieve", { id, user, name }),

  // ── Quota (6) ──────────────────────────────────────────────────────────────
  getQuota: (id: string, user: string) =>
    invoke<DovecotQuota>("dovecot_get_quota", { id, user }),
  setQuota: (id: string, user: string, rule: DovecotQuotaRule) =>
    invoke<void>("dovecot_set_quota", { id, user, rule }),
  recalculateQuota: (id: string, user: string) =>
    invoke<void>("dovecot_recalculate_quota", { id, user }),
  listQuotaRules: (id: string) =>
    invoke<DovecotQuotaRule[]>("dovecot_list_quota_rules", { id }),
  setQuotaRule: (id: string, rule: DovecotQuotaRule) =>
    invoke<void>("dovecot_set_quota_rule", { id, rule }),
  deleteQuotaRule: (id: string, name: string) =>
    invoke<void>("dovecot_delete_quota_rule", { id, name }),

  // ── Config (12) ────────────────────────────────────────────────────────────
  getConfig: (id: string) =>
    invoke<DovecotConfigParam[]>("dovecot_get_config", { id }),
  getConfigParam: (id: string, name: string) =>
    invoke<string>("dovecot_get_config_param", { id, name }),
  setConfigParam: (id: string, name: string, value: string) =>
    invoke<void>("dovecot_set_config_param", { id, name, value }),
  listNamespaces: (id: string) =>
    invoke<DovecotNamespace[]>("dovecot_list_namespaces", { id }),
  getNamespace: (id: string, name: string) =>
    invoke<DovecotNamespace>("dovecot_get_namespace", { id, name }),
  listPlugins: (id: string) =>
    invoke<DovecotPlugin[]>("dovecot_list_plugins", { id }),
  enablePlugin: (id: string, name: string) =>
    invoke<void>("dovecot_enable_plugin", { id, name }),
  disablePlugin: (id: string, name: string) =>
    invoke<void>("dovecot_disable_plugin", { id, name }),
  configurePlugin: (id: string, name: string, settings: Record<string, string>) =>
    invoke<void>("dovecot_configure_plugin", { id, name, settings }),
  getAuthConfig: (id: string) =>
    invoke<DovecotAuthConfig>("dovecot_get_auth_config", { id }),
  listServices: (id: string) =>
    invoke<DovecotService[]>("dovecot_list_services", { id }),
  testConfig: (id: string) =>
    invoke<ConfigTestResult>("dovecot_test_config", { id }),

  // ── ACL (4) ────────────────────────────────────────────────────────────────
  listAcls: (id: string, user: string, mailbox: string) =>
    invoke<DovecotAcl[]>("dovecot_list_acls", { id, user, mailbox }),
  getAcl: (id: string, user: string, mailbox: string, identifier: string) =>
    invoke<DovecotAcl>("dovecot_get_acl", { id, user, mailbox, identifier }),
  setAcl: (
    id: string,
    user: string,
    mailbox: string,
    identifier: string,
    rights: string[],
  ) => invoke<void>("dovecot_set_acl", {
    id,
    user,
    mailbox,
    identifier,
    rights,
  }),
  deleteAcl: (
    id: string,
    user: string,
    mailbox: string,
    identifier: string,
  ) => invoke<void>("dovecot_delete_acl", { id, user, mailbox, identifier }),

  // ── Replication (4) ────────────────────────────────────────────────────────
  replicationStatus: (id: string) =>
    invoke<DovecotReplication[]>("dovecot_replication_status", { id }),
  replicateUser: (id: string, user: string, priority: string) =>
    invoke<void>("dovecot_replicate_user", { id, user, priority }),
  dsyncBackup: (id: string, user: string, remote: string) =>
    invoke<void>("dovecot_dsync_backup", { id, user, remote }),
  dsyncMirror: (id: string, user: string, remote: string) =>
    invoke<void>("dovecot_dsync_mirror", { id, user, remote }),

  // ── Service (7) ────────────────────────────────────────────────────────────
  start: (id: string) => invoke<void>("dovecot_start", { id }),
  stop: (id: string) => invoke<void>("dovecot_stop", { id }),
  restart: (id: string) => invoke<void>("dovecot_restart", { id }),
  reload: (id: string) => invoke<void>("dovecot_reload", { id }),
  status: (id: string) => invoke<string>("dovecot_status", { id }),
  version: (id: string) => invoke<string>("dovecot_version", { id }),
  info: (id: string) => invoke<DovecotInfo>("dovecot_info", { id }),

  // ── Process (3) ────────────────────────────────────────────────────────────
  processWho: (id: string) =>
    invoke<DovecotProcess[]>("dovecot_process_who", { id }),
  processStats: (id: string) =>
    invoke<DovecotStats[]>("dovecot_process_stats", { id }),
  processTestConfig: (id: string) =>
    invoke<ConfigTestResult>("dovecot_process_test_config", { id }),

  // ── Logs (4) ───────────────────────────────────────────────────────────────
  queryLog: (id: string, lines?: number, filter?: string) =>
    invoke<DovecotLog[]>("dovecot_query_log", { id, lines, filter }),
  listLogFiles: (id: string) =>
    invoke<string[]>("dovecot_list_log_files", { id }),
  setLogLevel: (id: string, level: string) =>
    invoke<void>("dovecot_set_log_level", { id, level }),
  getLogLevel: (id: string) => invoke<string>("dovecot_get_log_level", { id }),
};

export type DovecotApi = typeof dovecotApi;

/** Connection-lifecycle state for the self-contained Dovecot sub-tab. Owns the
 *  live backend session identified by `connectionId`; the tab persists host +
 *  SSH secret separately via `useIntegrationConfigStore` (key `"mail.dovecot"`).
 *  `dovecot_ping` returns a boolean health check (not a summary), so the summary
 *  shown in the header is the one captured at connect time. */
export function useDovecot() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DovecotConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (
      id: string,
      config: DovecotConnectionConfig,
    ): Promise<DovecotConnectionSummary> => {
      setConnecting(true);
      setError(null);
      try {
        const result = await dovecotApi.connect(id, config);
        setConnectionId(id);
        setSummary(result);
        return result;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await dovecotApi.disconnect(connectionId);
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const ping = useCallback(async (): Promise<boolean> => {
    if (!connectionId) return false;
    try {
      return await dovecotApi.ping(connectionId);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
      return false;
    }
  }, [connectionId]);

  return {
    connectionId,
    summary,
    connecting,
    error,
    connect,
    disconnect,
    ping,
    setError,
    api: dovecotApi,
  };
}

export type DovecotManager = ReturnType<typeof useDovecot>;
