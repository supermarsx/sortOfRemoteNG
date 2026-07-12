// usePostfix — real Tauri `invoke(...)` wrappers for the sorng-postfix backend
// (t42 Wave M, Mail Server panel → Postfix sub-tab).
//
// Pairs 1:1 with src-tauri/crates/sorng-postfix/src/commands.rs (70 commands:
// 4 connection + 66 management). Every stateful command is keyed by a connection
// `id` (the backend holds a map of live SSH clients). Command arg names are
// camelCase — Tauri v2 maps them to the snake_case Rust `#[tauri::command]`
// params (e.g. `queueName` → `queue_name`, `queueId` → `queue_id`, `certPath` →
// `cert_path`). The `config` object mirrors `PostfixConnectionConfig`'s serde
// wire shape, which has NO rename → snake_case (`ssh_user`, `postfix_bin`,
// `config_dir`, ...); pass it as-is.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CertificateInfo,
  ConfigTestResult,
  CreateAliasRequest,
  CreateDomainRequest,
  CreateTransportRequest,
  MailStatistics,
  PostfixAlias,
  PostfixConnectionConfig,
  PostfixConnectionSummary,
  PostfixDomain,
  PostfixInfo,
  PostfixMailLog,
  PostfixMainCfParam,
  PostfixMap,
  PostfixMapEntry,
  PostfixMasterCfEntry,
  PostfixMilter,
  PostfixQueue,
  PostfixQueueEntry,
  PostfixRestriction,
  PostfixTlsPolicy,
  PostfixTransport,
  RestrictionStage,
  UpdateAliasRequest,
  UpdateDomainRequest,
  UpdateTransportRequest,
} from "../../../types/mail/postfix";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const postfixApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: PostfixConnectionConfig) =>
    invoke<PostfixConnectionSummary>("postfix_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("postfix_disconnect", { id }),
  listConnections: () => invoke<string[]>("postfix_list_connections"),
  ping: (id: string) => invoke<string>("postfix_ping", { id }),

  // Config & maps (12)
  getMainCf: (id: string) =>
    invoke<PostfixMainCfParam[]>("postfix_get_main_cf", { id }),
  getParam: (id: string, name: string) =>
    invoke<PostfixMainCfParam>("postfix_get_param", { id, name }),
  setParam: (id: string, name: string, value: string) =>
    invoke<void>("postfix_set_param", { id, name, value }),
  deleteParam: (id: string, name: string) =>
    invoke<void>("postfix_delete_param", { id, name }),
  getMasterCf: (id: string) =>
    invoke<PostfixMasterCfEntry[]>("postfix_get_master_cf", { id }),
  updateMasterCf: (id: string, entry: PostfixMasterCfEntry) =>
    invoke<void>("postfix_update_master_cf", { id, entry }),
  checkConfig: (id: string) =>
    invoke<ConfigTestResult>("postfix_check_config", { id }),
  getMaps: (id: string) => invoke<PostfixMap[]>("postfix_get_maps", { id }),
  getMapEntries: (id: string, name: string) =>
    invoke<PostfixMapEntry[]>("postfix_get_map_entries", { id, name }),
  setMapEntry: (id: string, name: string, key: string, value: string) =>
    invoke<void>("postfix_set_map_entry", { id, name, key, value }),
  deleteMapEntry: (id: string, name: string, key: string) =>
    invoke<void>("postfix_delete_map_entry", { id, name, key }),
  rebuildMap: (id: string, name: string) =>
    invoke<void>("postfix_rebuild_map", { id, name }),

  // Domains (5)
  listDomains: (id: string) =>
    invoke<PostfixDomain[]>("postfix_list_domains", { id }),
  getDomain: (id: string, domain: string) =>
    invoke<PostfixDomain>("postfix_get_domain", { id, domain }),
  createDomain: (id: string, request: CreateDomainRequest) =>
    invoke<PostfixDomain>("postfix_create_domain", { id, request }),
  updateDomain: (id: string, domain: string, request: UpdateDomainRequest) =>
    invoke<PostfixDomain>("postfix_update_domain", { id, domain, request }),
  deleteDomain: (id: string, domain: string) =>
    invoke<void>("postfix_delete_domain", { id, domain }),

  // Aliases (7)
  listAliases: (id: string) =>
    invoke<PostfixAlias[]>("postfix_list_aliases", { id }),
  getAlias: (id: string, address: string) =>
    invoke<PostfixAlias>("postfix_get_alias", { id, address }),
  createAlias: (id: string, request: CreateAliasRequest) =>
    invoke<PostfixAlias>("postfix_create_alias", { id, request }),
  updateAlias: (id: string, address: string, request: UpdateAliasRequest) =>
    invoke<PostfixAlias>("postfix_update_alias", { id, address, request }),
  deleteAlias: (id: string, address: string) =>
    invoke<void>("postfix_delete_alias", { id, address }),
  listVirtualAliases: (id: string) =>
    invoke<PostfixAlias[]>("postfix_list_virtual_aliases", { id }),
  listLocalAliases: (id: string) =>
    invoke<PostfixAlias[]>("postfix_list_local_aliases", { id }),

  // Transports (6)
  listTransports: (id: string) =>
    invoke<PostfixTransport[]>("postfix_list_transports", { id }),
  getTransport: (id: string, domain: string) =>
    invoke<PostfixTransport>("postfix_get_transport", { id, domain }),
  createTransport: (id: string, request: CreateTransportRequest) =>
    invoke<PostfixTransport>("postfix_create_transport", { id, request }),
  updateTransport: (
    id: string,
    domain: string,
    request: UpdateTransportRequest,
  ) =>
    invoke<PostfixTransport>("postfix_update_transport", {
      id,
      domain,
      request,
    }),
  deleteTransport: (id: string, domain: string) =>
    invoke<void>("postfix_delete_transport", { id, domain }),
  testTransport: (id: string, domain: string) =>
    invoke<string>("postfix_test_transport", { id, domain }),

  // Queue (11)
  listQueues: (id: string) =>
    invoke<PostfixQueue[]>("postfix_list_queues", { id }),
  listQueueEntries: (id: string, queueName: string) =>
    invoke<PostfixQueueEntry[]>("postfix_list_queue_entries", {
      id,
      queueName,
    }),
  getQueueEntry: (id: string, queueId: string) =>
    invoke<PostfixQueueEntry>("postfix_get_queue_entry", { id, queueId }),
  flush: (id: string) => invoke<void>("postfix_flush", { id }),
  flushQueue: (id: string, queueName: string) =>
    invoke<void>("postfix_flush_queue", { id, queueName }),
  deleteQueueEntry: (id: string, queueId: string) =>
    invoke<void>("postfix_delete_queue_entry", { id, queueId }),
  holdQueueEntry: (id: string, queueId: string) =>
    invoke<void>("postfix_hold_queue_entry", { id, queueId }),
  releaseQueueEntry: (id: string, queueId: string) =>
    invoke<void>("postfix_release_queue_entry", { id, queueId }),
  deleteAllQueued: (id: string) =>
    invoke<void>("postfix_delete_all_queued", { id }),
  requeueAll: (id: string) => invoke<void>("postfix_requeue_all", { id }),
  purgeQueues: (id: string) => invoke<void>("postfix_purge_queues", { id }),

  // TLS (6)
  getTlsConfig: (id: string) =>
    invoke<Record<string, string>>("postfix_get_tls_config", { id }),
  setTlsParam: (id: string, name: string, value: string) =>
    invoke<void>("postfix_set_tls_param", { id, name, value }),
  listTlsPolicies: (id: string) =>
    invoke<PostfixTlsPolicy[]>("postfix_list_tls_policies", { id }),
  setTlsPolicy: (id: string, domain: string, policy: PostfixTlsPolicy) =>
    invoke<void>("postfix_set_tls_policy", { id, domain, policy }),
  deleteTlsPolicy: (id: string, domain: string) =>
    invoke<void>("postfix_delete_tls_policy", { id, domain }),
  checkCertificate: (id: string, certPath: string) =>
    invoke<CertificateInfo>("postfix_check_certificate", { id, certPath }),

  // Restrictions (5)
  listRestrictions: (id: string) =>
    invoke<PostfixRestriction[]>("postfix_list_restrictions", { id }),
  getRestrictions: (id: string, stage: RestrictionStage) =>
    invoke<string[]>("postfix_get_restrictions", { id, stage }),
  setRestrictions: (
    id: string,
    stage: RestrictionStage,
    restrictions: string[],
  ) => invoke<void>("postfix_set_restrictions", { id, stage, restrictions }),
  addRestriction: (
    id: string,
    stage: RestrictionStage,
    restriction: string,
    position?: number,
  ) =>
    invoke<void>("postfix_add_restriction", {
      id,
      stage,
      restriction,
      position,
    }),
  removeRestriction: (
    id: string,
    stage: RestrictionStage,
    restriction: string,
  ) => invoke<void>("postfix_remove_restriction", { id, stage, restriction }),

  // Milters (4)
  listMilters: (id: string) =>
    invoke<PostfixMilter[]>("postfix_list_milters", { id }),
  addMilter: (id: string, milter: PostfixMilter) =>
    invoke<void>("postfix_add_milter", { id, milter }),
  removeMilter: (id: string, name: string) =>
    invoke<void>("postfix_remove_milter", { id, name }),
  updateMilter: (id: string, name: string, milter: PostfixMilter) =>
    invoke<void>("postfix_update_milter", { id, name, milter }),

  // Service control (7)
  start: (id: string) => invoke<void>("postfix_start", { id }),
  stop: (id: string) => invoke<void>("postfix_stop", { id }),
  restart: (id: string) => invoke<void>("postfix_restart", { id }),
  reload: (id: string) => invoke<void>("postfix_reload", { id }),
  status: (id: string) => invoke<string>("postfix_status", { id }),
  version: (id: string) => invoke<string>("postfix_version", { id }),
  info: (id: string) => invoke<PostfixInfo>("postfix_info", { id }),

  // Logs & stats (3)
  queryMailLog: (id: string, lines?: number, filter?: string) =>
    invoke<PostfixMailLog[]>("postfix_query_mail_log", { id, lines, filter }),
  listLogFiles: (id: string) =>
    invoke<string[]>("postfix_list_log_files", { id }),
  getStatistics: (id: string) =>
    invoke<MailStatistics>("postfix_get_statistics", { id }),
};

export type PostfixApi = typeof postfixApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Postfix session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id` (the Postfix sub-tab generates its own id), plus shared
 * `isLoading`/`error`, and exposes the full 70-command surface via `api` (each
 * call takes the connection id). The `run` wrapper funnels arbitrary ops through
 * the same loading/error handling (matching the other integration hooks).
 */
export function usePostfix() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PostfixConnectionSummary | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: PostfixConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await postfixApi.connect(id, config);
        setConnectionId(id);
        setSummary(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await postfixApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  /** Re-ping the live connection (health check — returns a status string, not a
   *  summary; the header summary is fixed from connect). Non-fatal. */
  const ping = useCallback(async (): Promise<string | null> => {
    if (!connectionId) return null;
    try {
      return await postfixApi.ping(connectionId);
    } catch (e) {
      setError(errMsg(e));
      return null;
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    ping,
    // full command surface + shared runner
    api: postfixApi,
    run,
  };
}

export type PostfixManager = ReturnType<typeof usePostfix>;
