// useProcmail — real Tauri `invoke(...)` wrappers for the sorng-procmail backend.
//
// Binds all 40 `procmail_*` commands registered in
// `sorng-procmail/src/commands.rs` through `procmailApi` (flat invoke slice) and
// `useProcmail()` (connect/disconnect lifecycle + shared loading/error + `run`).
//
// procmail is unique among the 8 mail crates: it has NO `procmail_ping` — the
// lifecycle is connect / disconnect / list_connections only. Every management
// command is keyed by a connection `id` AND a `user` (whose `~/.procmailrc`, or
// the global rc, is operated on). Command arg names are camelCase; Tauri v2 maps
// them to the Rust snake_case params. The `config` object mirrors
// `ProcmailConnectionConfig`'s serde wire shape (NO container rename → snake_case:
// `ssh_user`, `procmail_bin`, `procmailrc_path`, `log_path`, `timeout_secs`).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CreateRecipeRequest,
  CreateRuleRequest,
  ProcmailConfig,
  ProcmailConnectionConfig,
  ProcmailConnectionSummary,
  ProcmailInclude,
  ProcmailLogEntry,
  ProcmailRecipe,
  ProcmailRule,
  ProcmailVariable,
  RecipeTestResult,
  UpdateRecipeRequest,
  UpdateRuleRequest,
} from "../../../types/mail/procmail";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const procmailApi = {
  // ── Connection lifecycle (no ping) ──────────────────────────────────────────
  connect: (id: string, config: ProcmailConnectionConfig) =>
    invoke<ProcmailConnectionSummary>("procmail_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("procmail_disconnect", { id }),
  listConnections: () => invoke<string[]>("procmail_list_connections"),

  // ── Recipes ─────────────────────────────────────────────────────────────────
  listRecipes: (id: string, user: string) =>
    invoke<ProcmailRecipe[]>("procmail_list_recipes", { id, user }),
  getRecipe: (id: string, user: string, recipeId: string) =>
    invoke<ProcmailRecipe>("procmail_get_recipe", { id, user, recipeId }),
  createRecipe: (id: string, user: string, request: CreateRecipeRequest) =>
    invoke<ProcmailRecipe>("procmail_create_recipe", { id, user, request }),
  updateRecipe: (
    id: string,
    user: string,
    recipeId: string,
    request: UpdateRecipeRequest,
  ) =>
    invoke<ProcmailRecipe>("procmail_update_recipe", {
      id,
      user,
      recipeId,
      request,
    }),
  deleteRecipe: (id: string, user: string, recipeId: string) =>
    invoke<void>("procmail_delete_recipe", { id, user, recipeId }),
  enableRecipe: (id: string, user: string, recipeId: string) =>
    invoke<void>("procmail_enable_recipe", { id, user, recipeId }),
  disableRecipe: (id: string, user: string, recipeId: string) =>
    invoke<void>("procmail_disable_recipe", { id, user, recipeId }),
  reorderRecipe: (
    id: string,
    user: string,
    recipeId: string,
    newPosition: number,
  ) =>
    invoke<void>("procmail_reorder_recipe", {
      id,
      user,
      recipeId,
      newPosition,
    }),
  testRecipe: (id: string, user: string, messageContent: string) =>
    invoke<RecipeTestResult>("procmail_test_recipe", {
      id,
      user,
      messageContent,
    }),

  // ── Rules (named groups of recipes) ─────────────────────────────────────────
  listRules: (id: string, user: string) =>
    invoke<ProcmailRule[]>("procmail_list_rules", { id, user }),
  getRule: (id: string, user: string, ruleId: string) =>
    invoke<ProcmailRule>("procmail_get_rule", { id, user, ruleId }),
  createRule: (id: string, user: string, request: CreateRuleRequest) =>
    invoke<ProcmailRule>("procmail_create_rule", { id, user, request }),
  updateRule: (
    id: string,
    user: string,
    ruleId: string,
    request: UpdateRuleRequest,
  ) =>
    invoke<ProcmailRule>("procmail_update_rule", { id, user, ruleId, request }),
  deleteRule: (id: string, user: string, ruleId: string) =>
    invoke<void>("procmail_delete_rule", { id, user, ruleId }),
  enableRule: (id: string, user: string, ruleId: string) =>
    invoke<void>("procmail_enable_rule", { id, user, ruleId }),
  disableRule: (id: string, user: string, ruleId: string) =>
    invoke<void>("procmail_disable_rule", { id, user, ruleId }),

  // ── Variables ───────────────────────────────────────────────────────────────
  listVariables: (id: string, user: string) =>
    invoke<ProcmailVariable[]>("procmail_list_variables", { id, user }),
  getVariable: (id: string, user: string, name: string) =>
    invoke<ProcmailVariable>("procmail_get_variable", { id, user, name }),
  setVariable: (id: string, user: string, name: string, value: string) =>
    invoke<void>("procmail_set_variable", { id, user, name, value }),
  deleteVariable: (id: string, user: string, name: string) =>
    invoke<void>("procmail_delete_variable", { id, user, name }),

  // ── Includes ────────────────────────────────────────────────────────────────
  listIncludes: (id: string, user: string) =>
    invoke<ProcmailInclude[]>("procmail_list_includes", { id, user }),
  addInclude: (id: string, user: string, path: string) =>
    invoke<void>("procmail_add_include", { id, user, path }),
  removeInclude: (id: string, user: string, path: string) =>
    invoke<void>("procmail_remove_include", { id, user, path }),
  enableInclude: (id: string, user: string, path: string) =>
    invoke<void>("procmail_enable_include", { id, user, path }),
  disableInclude: (id: string, user: string, path: string) =>
    invoke<void>("procmail_disable_include", { id, user, path }),

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig: (id: string, user: string) =>
    invoke<ProcmailConfig>("procmail_get_config", { id, user }),
  setConfig: (id: string, user: string, config: ProcmailConfig) =>
    invoke<void>("procmail_set_config", { id, user, config }),
  backupConfig: (id: string, user: string) =>
    invoke<string>("procmail_backup_config", { id, user }),
  restoreConfig: (id: string, user: string, backupContent: string) =>
    invoke<void>("procmail_restore_config", { id, user, backupContent }),
  validateConfig: (id: string, user: string, content: string) =>
    invoke<RecipeTestResult>("procmail_validate_config", { id, user, content }),
  getRawConfig: (id: string, user: string) =>
    invoke<string>("procmail_get_raw_config", { id, user }),
  setRawConfig: (id: string, user: string, content: string) =>
    invoke<void>("procmail_set_raw_config", { id, user, content }),

  // ── Logs ────────────────────────────────────────────────────────────────────
  queryLog: (id: string, user: string, lines?: number, filter?: string) =>
    invoke<ProcmailLogEntry[]>("procmail_query_log", {
      id,
      user,
      lines,
      filter,
    }),
  listLogFiles: (id: string, user: string) =>
    invoke<string[]>("procmail_list_log_files", { id, user }),
  clearLog: (id: string, user: string) =>
    invoke<void>("procmail_clear_log", { id, user }),
  getLogPath: (id: string, user: string) =>
    invoke<string>("procmail_get_log_path", { id, user }),
  setLogPath: (id: string, user: string, path: string) =>
    invoke<void>("procmail_set_log_path", { id, user, path }),
};

export type ProcmailApi = typeof procmailApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Procmail session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api`. The `run` wrapper funnels arbitrary ops
 * through the same loading/error handling. There is no ping (procmail has none).
 */
export function useProcmail() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProcmailConnectionSummary | null>(null);
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
    async (id: string, config: ProcmailConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await procmailApi.connect(id, config);
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
      await procmailApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
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
    // full registered command surface + shared runner
    api: procmailApi,
    run,
  };
}

export type ProcmailManager = ReturnType<typeof useProcmail>;
