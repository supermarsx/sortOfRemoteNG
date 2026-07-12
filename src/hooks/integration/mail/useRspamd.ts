// useRspamd — real Tauri `invoke(...)` wrappers for the sorng-rspamd backend
// (t42 Wave M, Mail Server panel → Rspamd sub-tab).
//
// Binds all 44 `rspamd_*` commands registered in the mail command handler
// (`sorng-commands-mail/src/mail_handler.rs`). Every command is keyed by a
// connection `id` (the backend holds a map of live HTTP clients). Command arg
// names are camelCase — Tauri v2 maps them to the Rust snake_case params
// (`graph_type` → `graphType`, `map_id` → `mapId`, ...). The `config` object
// mirrors `RspamdConnectionConfig`'s serde wire shape, which has NO rename →
// snake_case (`base_url`, `timeout_secs`, `tls_skip_verify`).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  RspamdAction,
  RspamdBayesLearnResult,
  RspamdConnectionConfig,
  RspamdConnectionSummary,
  RspamdFuzzyStatus,
  RspamdGraphData,
  RspamdHistory,
  RspamdHistoryEntry,
  RspamdMap,
  RspamdMapEntry,
  RspamdNeighbour,
  RspamdPlugin,
  RspamdScanResult,
  RspamdStat,
  RspamdSymbol,
  RspamdSymbolGroup,
  RspamdSymbolResult,
  RspamdWorker,
} from "../../../types/mail/rspamd";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const rspamdApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: RspamdConnectionConfig) =>
    invoke<RspamdConnectionSummary>("rspamd_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("rspamd_disconnect", { id }),
  listConnections: () => invoke<string[]>("rspamd_list_connections"),
  ping: (id: string) =>
    invoke<RspamdConnectionSummary>("rspamd_ping", { id }),

  // Scanning (4)
  checkMessage: (id: string, message: string) =>
    invoke<RspamdScanResult>("rspamd_check_message", { id, message }),
  checkFile: (id: string, path: string) =>
    invoke<RspamdScanResult>("rspamd_check_file", { id, path }),
  learnSpam: (id: string, message: string) =>
    invoke<RspamdBayesLearnResult>("rspamd_learn_spam", { id, message }),
  learnHam: (id: string, message: string) =>
    invoke<RspamdBayesLearnResult>("rspamd_learn_ham", { id, message }),

  // Fuzzy training (2)
  fuzzyAdd: (id: string, message: string, flag: number, weight: number) =>
    invoke<void>("rspamd_fuzzy_add", { id, message, flag, weight }),
  fuzzyDelete: (id: string, message: string, flag: number) =>
    invoke<void>("rspamd_fuzzy_delete", { id, message, flag }),

  // Statistics (5)
  getStats: (id: string) => invoke<RspamdStat>("rspamd_get_stats", { id }),
  getGraph: (id: string, graphType: string) =>
    invoke<RspamdGraphData[]>("rspamd_get_graph", { id, graphType }),
  getThroughput: (id: string) =>
    invoke<RspamdGraphData[]>("rspamd_get_throughput", { id }),
  resetStats: (id: string) => invoke<void>("rspamd_reset_stats", { id }),
  getErrors: (id: string) => invoke<string[]>("rspamd_get_errors", { id }),

  // Symbols (4)
  listSymbols: (id: string) =>
    invoke<RspamdSymbol[]>("rspamd_list_symbols", { id }),
  getSymbol: (id: string, name: string) =>
    invoke<RspamdSymbol>("rspamd_get_symbol", { id, name }),
  listSymbolGroups: (id: string) =>
    invoke<RspamdSymbolGroup[]>("rspamd_list_symbol_groups", { id }),
  getSymbolGroup: (id: string, name: string) =>
    invoke<RspamdSymbolGroup>("rspamd_get_symbol_group", { id, name }),

  // Actions (5)
  listActions: (id: string) =>
    invoke<RspamdAction[]>("rspamd_list_actions", { id }),
  getAction: (id: string, name: string) =>
    invoke<RspamdAction>("rspamd_get_action", { id, name }),
  setAction: (id: string, name: string, threshold: number) =>
    invoke<void>("rspamd_set_action", { id, name, threshold }),
  enableAction: (id: string, name: string) =>
    invoke<void>("rspamd_enable_action", { id, name }),
  disableAction: (id: string, name: string) =>
    invoke<void>("rspamd_disable_action", { id, name }),

  // Maps (6)
  listMaps: (id: string) => invoke<RspamdMap[]>("rspamd_list_maps", { id }),
  getMap: (id: string, mapId: number) =>
    invoke<RspamdMap>("rspamd_get_map", { id, mapId }),
  getMapEntries: (id: string, mapId: number) =>
    invoke<RspamdMapEntry[]>("rspamd_get_map_entries", { id, mapId }),
  saveMapEntries: (id: string, mapId: number, content: string) =>
    invoke<void>("rspamd_save_map_entries", { id, mapId, content }),
  addMapEntry: (id: string, mapId: number, key: string, value?: string) =>
    invoke<void>("rspamd_add_map_entry", { id, mapId, key, value }),
  removeMapEntry: (id: string, mapId: number, key: string) =>
    invoke<void>("rspamd_remove_map_entry", { id, mapId, key }),

  // History (3)
  getHistory: (id: string, limit?: number, offset?: number) =>
    invoke<RspamdHistory>("rspamd_get_history", { id, limit, offset }),
  getHistoryEntry: (id: string, entryId: string) =>
    invoke<RspamdHistoryEntry>("rspamd_get_history_entry", { id, entryId }),
  resetHistory: (id: string) => invoke<void>("rspamd_reset_history", { id }),

  // Workers & neighbours (3)
  listWorkers: (id: string) =>
    invoke<RspamdWorker[]>("rspamd_list_workers", { id }),
  getWorker: (id: string, workerId: string) =>
    invoke<RspamdWorker>("rspamd_get_worker", { id, workerId }),
  listNeighbours: (id: string) =>
    invoke<RspamdNeighbour[]>("rspamd_list_neighbours", { id }),

  // Fuzzy status (2)
  fuzzyStatus: (id: string) =>
    invoke<RspamdFuzzyStatus[]>("rspamd_fuzzy_status", { id }),
  fuzzyCheck: (id: string, message: string) =>
    invoke<RspamdSymbolResult[]>("rspamd_fuzzy_check", { id, message }),

  // Config & plugins (6)
  getActionsConfig: (id: string) =>
    invoke<RspamdAction[]>("rspamd_get_actions_config", { id }),
  getPlugins: (id: string) =>
    invoke<RspamdPlugin[]>("rspamd_get_plugins", { id }),
  enablePlugin: (id: string, name: string) =>
    invoke<void>("rspamd_enable_plugin", { id, name }),
  disablePlugin: (id: string, name: string) =>
    invoke<void>("rspamd_disable_plugin", { id, name }),
  reloadConfig: (id: string) => invoke<void>("rspamd_reload_config", { id }),
  saveActionsConfig: (id: string, actions: RspamdAction[]) =>
    invoke<void>("rspamd_save_actions_config", { id, actions }),
};

export type RspamdApi = typeof rspamdApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Rspamd session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isConnecting`/`isLoading`/`error`, and
 * exposes the full 44-command surface via `api` (each call takes the connection
 * id). The `run` wrapper funnels arbitrary ops through the same loading/error
 * handling. Self-contained — the sub-tab manages its own connection.
 */
export function useRspamd() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RspamdConnectionSummary | null>(null);
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
    async (id: string, config: RspamdConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await rspamdApi.connect(id, config);
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
      await rspamdApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const ping = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      setSummary(await rspamdApi.ping(connectionId));
    } catch (e) {
      setError(errMsg(e));
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
    api: rspamdApi,
    run,
  };
}

export type RspamdManager = ReturnType<typeof useRspamd>;
