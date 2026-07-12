// useMailcowOperations — real Tauri `invoke(...)` wrappers for the sorng-mailcow
// "operations" category (t42-mailcow-c2): Queue, Quarantine & Server. Binds all
// 28 commands across six blocks:
//   Transport maps (5) · Queue (5) · Quarantine (7) · Logs (2) · Status (6) ·
//   Rate limits (3)
//
// Pairs 1:1 with the matching command blocks in
//   src-tauri/crates/sorng-mailcow/src/commands.rs
// Every command's first arg is the live connection `id` (= the shell's
// `connectionId`). Tauri camelCases the top-level fn params, so two-word Rust
// params map as `transport_id -> transportId`, `queue_name -> queueName`,
// `queue_id -> queueId`, `quarantine_id -> quarantineId`, `log_type -> logType`;
// request/config/settings STRUCT fields stay snake_case (see
// `../../../types/mailcow/operations`).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CreateTransportMapRequest,
  MailcowContainerStatus,
  MailcowFail2BanConfig,
  MailcowLogEntry,
  MailcowLogType,
  MailcowQuarantineItem,
  MailcowQueueItem,
  MailcowQueueSummary,
  MailcowRateLimit,
  MailcowSystemStatus,
  MailcowTransportMap,
  SetRateLimitRequest,
} from "../../../types/mailcow/operations";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const mailcowOperationsApi = {
  // ── Transport maps (5) ──────────────────────────────────────────────────────
  listTransportMaps: (id: string) =>
    invoke<MailcowTransportMap[]>("mailcow_list_transport_maps", { id }),
  getTransportMap: (id: string, transportId: number) =>
    invoke<MailcowTransportMap>("mailcow_get_transport_map", {
      id,
      transportId,
    }),
  createTransportMap: (id: string, req: CreateTransportMapRequest) =>
    invoke<unknown>("mailcow_create_transport_map", { id, req }),
  updateTransportMap: (
    id: string,
    transportId: number,
    req: CreateTransportMapRequest,
  ) =>
    invoke<unknown>("mailcow_update_transport_map", { id, transportId, req }),
  deleteTransportMap: (id: string, transportId: number) =>
    invoke<unknown>("mailcow_delete_transport_map", { id, transportId }),

  // ── Queue (5) ───────────────────────────────────────────────────────────────
  getQueueSummary: (id: string) =>
    invoke<MailcowQueueSummary>("mailcow_get_queue_summary", { id }),
  listQueue: (id: string, queueName: string) =>
    invoke<MailcowQueueItem[]>("mailcow_list_queue", { id, queueName }),
  flushQueue: (id: string, queueName: string) =>
    invoke<unknown>("mailcow_flush_queue", { id, queueName }),
  deleteQueueItem: (id: string, queueId: string) =>
    invoke<unknown>("mailcow_delete_queue_item", { id, queueId }),
  superDeleteQueue: (id: string, queueName: string) =>
    invoke<unknown>("mailcow_super_delete_queue", { id, queueName }),

  // ── Quarantine (7) ────────────────────────────────────────────────────────--
  listQuarantine: (id: string) =>
    invoke<MailcowQuarantineItem[]>("mailcow_list_quarantine", { id }),
  getQuarantine: (id: string, quarantineId: number) =>
    invoke<MailcowQuarantineItem>("mailcow_get_quarantine", {
      id,
      quarantineId,
    }),
  releaseQuarantine: (id: string, quarantineId: number) =>
    invoke<unknown>("mailcow_release_quarantine", { id, quarantineId }),
  deleteQuarantine: (id: string, quarantineId: number) =>
    invoke<unknown>("mailcow_delete_quarantine", { id, quarantineId }),
  whitelistSender: (id: string, quarantineId: number) =>
    invoke<unknown>("mailcow_whitelist_sender", { id, quarantineId }),
  getQuarantineSettings: (id: string) =>
    invoke<unknown>("mailcow_get_quarantine_settings", { id }),
  updateQuarantineSettings: (id: string, settings: unknown) =>
    invoke<unknown>("mailcow_update_quarantine_settings", { id, settings }),

  // ── Logs (2) ──────────────────────────────────────────────────────────────--
  getLogs: (id: string, logType: MailcowLogType, count: number) =>
    invoke<MailcowLogEntry[]>("mailcow_get_logs", { id, logType, count }),
  getApiLogs: (id: string, count: number) =>
    invoke<MailcowLogEntry[]>("mailcow_get_api_logs", { id, count }),

  // ── Status (6) ────────────────────────────────────────────────────────────--
  getContainerStatus: (id: string) =>
    invoke<MailcowContainerStatus[]>("mailcow_get_container_status", { id }),
  getSolrStatus: (id: string) =>
    invoke<unknown>("mailcow_get_solr_status", { id }),
  getSystemStatus: (id: string) =>
    invoke<MailcowSystemStatus>("mailcow_get_system_status", { id }),
  getRspamdStats: (id: string) =>
    invoke<unknown>("mailcow_get_rspamd_stats", { id }),
  getFail2banConfig: (id: string) =>
    invoke<MailcowFail2BanConfig>("mailcow_get_fail2ban_config", { id }),
  updateFail2banConfig: (id: string, config: MailcowFail2BanConfig) =>
    invoke<unknown>("mailcow_update_fail2ban_config", { id, config }),

  // ── Rate limits (3) ───────────────────────────────────────────────────────--
  getRateLimits: (id: string, mailbox: string) =>
    invoke<MailcowRateLimit>("mailcow_get_rate_limits", { id, mailbox }),
  setRateLimit: (id: string, req: SetRateLimitRequest) =>
    invoke<unknown>("mailcow_set_rate_limit", { id, req }),
  deleteRateLimit: (id: string, mailbox: string) =>
    invoke<unknown>("mailcow_delete_rate_limit", { id, mailbox }),
};

export type MailcowOperationsApi = typeof mailcowOperationsApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the mailcow "operations" tab. `run` wraps any
 * `mailcowOperationsApi` call, tracking `isLoading` and surfacing errors with
 * the shared error idiom (Tauri rejects with a plain string via the command's
 * `map_err`); it resolves to the value, or `undefined` on failure.
 */
export function useMailcowOperations() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(
      fn: (api: MailcowOperationsApi) => Promise<T>,
    ): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(mailcowOperationsApi);
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

  return { api: mailcowOperationsApi, run, isLoading, error, clearError };
}

export type MailcowOperationsManager = ReturnType<typeof useMailcowOperations>;
