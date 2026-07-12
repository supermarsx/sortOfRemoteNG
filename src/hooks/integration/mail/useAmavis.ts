// useAmavis — real Tauri `invoke(...)` wrappers for the sorng-amavis backend
// (t42 Wave M, unified Mail Server panel → Amavis sub-tab).
//
// Pairs 1:1 with src-tauri/crates/sorng-amavis/src/commands.rs (52 commands,
// 4 of them connection lifecycle). Every stateful command is keyed by a
// connection `id` (the backend holds a map of live SSH sessions). Command arg
// names are camelCase — Tauri v2 maps them to the snake_case Rust
// `#[tauri::command]` params (`banId` → `ban_id`, `entryId` → `entry_id`,
// `listType` → `list_type`, `senderAddress` → `sender_address`,
// `mailId` → `mail_id`, `quarantineType` → `quarantine_type`). The `config`
// object mirrors `AmavisConnectionConfig`'s serde wire shape, which has NO
// rename → snake_case (`private_key`, `timeout_secs`); pass it as-is.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AmavisBannedRule,
  AmavisChildProcess,
  AmavisConfigSnippet,
  AmavisConnectionConfig,
  AmavisConnectionSummary,
  AmavisListCheckResult,
  AmavisListEntry,
  AmavisListType,
  AmavisMainConfig,
  AmavisPolicyBank,
  AmavisProcessInfo,
  AmavisQuarantineItem,
  AmavisQuarantineStats,
  AmavisStats,
  AmavisThroughput,
  CreateBannedRuleRequest,
  CreateListEntryRequest,
  CreatePolicyBankRequest,
  QuarantineListRequest,
  UpdateBannedRuleRequest,
  UpdateListEntryRequest,
  UpdatePolicyBankRequest,
} from "../../../types/mail/amavis";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const amavisApi = {
  // Connection lifecycle (4)
  connect: (id: string, config: AmavisConnectionConfig) =>
    invoke<AmavisConnectionSummary>("amavis_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("amavis_disconnect", { id }),
  listConnections: () => invoke<string[]>("amavis_list_connections"),
  ping: (id: string) =>
    invoke<AmavisConnectionSummary>("amavis_ping", { id }),

  // Main config & snippets (10)
  getMainConfig: (id: string) =>
    invoke<AmavisMainConfig>("amavis_get_main_config", { id }),
  updateMainConfig: (id: string, config: AmavisMainConfig) =>
    invoke<void>("amavis_update_main_config", { id, config }),
  listSnippets: (id: string) =>
    invoke<AmavisConfigSnippet[]>("amavis_list_snippets", { id }),
  getSnippet: (id: string, name: string) =>
    invoke<AmavisConfigSnippet>("amavis_get_snippet", { id, name }),
  createSnippet: (id: string, name: string, content: string) =>
    invoke<void>("amavis_create_snippet", { id, name, content }),
  updateSnippet: (id: string, name: string, content: string) =>
    invoke<void>("amavis_update_snippet", { id, name, content }),
  deleteSnippet: (id: string, name: string) =>
    invoke<void>("amavis_delete_snippet", { id, name }),
  enableSnippet: (id: string, name: string) =>
    invoke<void>("amavis_enable_snippet", { id, name }),
  disableSnippet: (id: string, name: string) =>
    invoke<void>("amavis_disable_snippet", { id, name }),
  testConfig: (id: string) => invoke<string>("amavis_test_config", { id }),

  // Policy banks (7)
  listPolicyBanks: (id: string) =>
    invoke<AmavisPolicyBank[]>("amavis_list_policy_banks", { id }),
  getPolicyBank: (id: string, name: string) =>
    invoke<AmavisPolicyBank>("amavis_get_policy_bank", { id, name }),
  createPolicyBank: (id: string, req: CreatePolicyBankRequest) =>
    invoke<AmavisPolicyBank>("amavis_create_policy_bank", { id, req }),
  updatePolicyBank: (
    id: string,
    name: string,
    req: UpdatePolicyBankRequest,
  ) => invoke<AmavisPolicyBank>("amavis_update_policy_bank", { id, name, req }),
  deletePolicyBank: (id: string, name: string) =>
    invoke<void>("amavis_delete_policy_bank", { id, name }),
  activatePolicyBank: (id: string, name: string) =>
    invoke<void>("amavis_activate_policy_bank", { id, name }),
  deactivatePolicyBank: (id: string, name: string) =>
    invoke<void>("amavis_deactivate_policy_bank", { id, name }),

  // Banned rules (6)
  listBannedRules: (id: string) =>
    invoke<AmavisBannedRule[]>("amavis_list_banned_rules", { id }),
  getBannedRule: (id: string, banId: string) =>
    invoke<AmavisBannedRule>("amavis_get_banned_rule", { id, banId }),
  createBannedRule: (id: string, req: CreateBannedRuleRequest) =>
    invoke<AmavisBannedRule>("amavis_create_banned_rule", { id, req }),
  updateBannedRule: (
    id: string,
    banId: string,
    req: UpdateBannedRuleRequest,
  ) => invoke<AmavisBannedRule>("amavis_update_banned_rule", { id, banId, req }),
  deleteBannedRule: (id: string, banId: string) =>
    invoke<void>("amavis_delete_banned_rule", { id, banId }),
  testFilename: (id: string, filename: string) =>
    invoke<boolean>("amavis_test_filename", { id, filename }),

  // Lists — whitelist / blacklist (6)
  listEntries: (id: string, listType: AmavisListType) =>
    invoke<AmavisListEntry[]>("amavis_list_entries", { id, listType }),
  getListEntry: (id: string, entryId: string) =>
    invoke<AmavisListEntry>("amavis_get_list_entry", { id, entryId }),
  addListEntry: (id: string, req: CreateListEntryRequest) =>
    invoke<AmavisListEntry>("amavis_add_list_entry", { id, req }),
  updateListEntry: (
    id: string,
    entryId: string,
    req: UpdateListEntryRequest,
  ) => invoke<AmavisListEntry>("amavis_update_list_entry", { id, entryId, req }),
  removeListEntry: (id: string, entryId: string) =>
    invoke<void>("amavis_remove_list_entry", { id, entryId }),
  checkSender: (id: string, senderAddress: string) =>
    invoke<AmavisListCheckResult>("amavis_check_sender", { id, senderAddress }),

  // Quarantine (7)
  listQuarantine: (id: string, request: QuarantineListRequest) =>
    invoke<AmavisQuarantineItem[]>("amavis_list_quarantine", { id, request }),
  getQuarantine: (id: string, mailId: string) =>
    invoke<AmavisQuarantineItem>("amavis_get_quarantine", { id, mailId }),
  releaseQuarantine: (id: string, mailId: string) =>
    invoke<void>("amavis_release_quarantine", { id, mailId }),
  deleteQuarantine: (id: string, mailId: string) =>
    invoke<void>("amavis_delete_quarantine", { id, mailId }),
  releaseAllQuarantine: (id: string, quarantineType: string) =>
    invoke<void>("amavis_release_all_quarantine", { id, quarantineType }),
  deleteAllQuarantine: (id: string, quarantineType: string) =>
    invoke<void>("amavis_delete_all_quarantine", { id, quarantineType }),
  getQuarantineStats: (id: string) =>
    invoke<AmavisQuarantineStats>("amavis_get_quarantine_stats", { id }),

  // Stats / monitoring (4)
  getStats: (id: string) => invoke<AmavisStats>("amavis_get_stats", { id }),
  getChildProcesses: (id: string) =>
    invoke<AmavisChildProcess[]>("amavis_get_child_processes", { id }),
  getThroughput: (id: string) =>
    invoke<AmavisThroughput>("amavis_get_throughput", { id }),
  resetStats: (id: string) => invoke<void>("amavis_reset_stats", { id }),

  // Service / process control (8)
  start: (id: string) => invoke<void>("amavis_start", { id }),
  stop: (id: string) => invoke<void>("amavis_stop", { id }),
  restart: (id: string) => invoke<void>("amavis_restart", { id }),
  reload: (id: string) => invoke<void>("amavis_reload", { id }),
  processStatus: (id: string) =>
    invoke<AmavisProcessInfo>("amavis_process_status", { id }),
  version: (id: string) => invoke<string>("amavis_version", { id }),
  debugSa: (id: string, message: string) =>
    invoke<string>("amavis_debug_sa", { id, message }),
  showConfig: (id: string) => invoke<string>("amavis_show_config", { id }),
};

export type AmavisApi = typeof amavisApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Amavis session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * 52-command surface via `api` (each stateful call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling
 * (matching useHaproxy / useGrafana).
 */
export function useAmavis() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<AmavisConnectionSummary | null>(null);
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
    async (id: string, config: AmavisConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await amavisApi.connect(id, config);
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
      await amavisApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  /** Re-ping the live connection to refresh the summary header. */
  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      setSummary(await amavisApi.ping(connectionId));
    } catch {
      // Non-fatal — the connection is live even if the ping echo fails.
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
    refreshSummary,
    // full command surface + shared runner
    api: amavisApi,
    run,
  };
}

export type AmavisManager = ReturnType<typeof useAmavis>;
