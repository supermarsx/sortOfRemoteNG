// useAnsibleRuns — "Playbooks & Runs" command slice for the Ansible integration
// (t42-ansible-c1). Binds all 27 runs-category commands: inventory (9),
// playbooks (7), ad-hoc (6), facts (2), history (3).
//
// ⚠ WIRE-FORMAT — command ARG names are camelCase (Tauri default): `useBecome`,
// `serviceName`, `serviceState`, `packageState`, `execId`. STRUCT payload fields
// (inside `options` / `params` / `config`) stay snake_case — see `types/ansible`.
// The `id` arg is the live control-node `connectionId` from the shell, EXCEPT the
// inventory add/remove commands which operate on a file `path`, not a session id.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  AddGroupParams,
  AddHostParams,
  AdHocOptions,
  DynamicInventoryConfig,
  ExecutionHistoryEntry,
  ExecutionResult,
  HostFacts,
  Inventory,
  Playbook,
  PlaybookRunOptions,
  PlaybookValidation,
} from "../../../types/ansible/runs";

// ─── Low-level invoke wrappers (all 27 commands of the runs slice) ─────────────

export const ansibleRunsApi = {
  // Inventory (9)
  inventoryParse: (id: string, source: string) =>
    invoke<Inventory>("ansible_inventory_parse", { id, source }),
  inventoryGraph: (id: string, source: string) =>
    invoke<string>("ansible_inventory_graph", { id, source }),
  inventoryListHosts: (id: string, source: string, pattern: string) =>
    invoke<string[]>("ansible_inventory_list_hosts", { id, source, pattern }),
  inventoryHostVars: (id: string, source: string, host: string) =>
    invoke<Record<string, unknown>>("ansible_inventory_host_vars", {
      id,
      source,
      host,
    }),
  inventoryAddHost: (path: string, params: AddHostParams) =>
    invoke<void>("ansible_inventory_add_host", { path, params }),
  inventoryRemoveHost: (path: string, host: string) =>
    invoke<boolean>("ansible_inventory_remove_host", { path, host }),
  inventoryAddGroup: (path: string, params: AddGroupParams) =>
    invoke<void>("ansible_inventory_add_group", { path, params }),
  inventoryRemoveGroup: (path: string, group: string) =>
    invoke<boolean>("ansible_inventory_remove_group", { path, group }),
  inventoryDynamic: (id: string, config: DynamicInventoryConfig) =>
    invoke<Inventory>("ansible_inventory_dynamic", { id, config }),

  // Playbooks (7)
  playbookParse: (path: string) =>
    invoke<Playbook>("ansible_playbook_parse", { path }),
  playbookList: (dir: string) =>
    invoke<string[]>("ansible_playbook_list", { dir }),
  playbookSyntaxCheck: (id: string, path: string) =>
    invoke<PlaybookValidation>("ansible_playbook_syntax_check", { id, path }),
  playbookLint: (id: string, path: string) =>
    invoke<PlaybookValidation>("ansible_playbook_lint", { id, path }),
  playbookRun: (id: string, options: PlaybookRunOptions) =>
    invoke<ExecutionResult>("ansible_playbook_run", { id, options }),
  playbookCheck: (id: string, options: PlaybookRunOptions) =>
    invoke<ExecutionResult>("ansible_playbook_check", { id, options }),
  playbookDiff: (id: string, options: PlaybookRunOptions) =>
    invoke<ExecutionResult>("ansible_playbook_diff", { id, options }),

  // Ad-hoc (6)
  adhocRun: (id: string, options: AdHocOptions) =>
    invoke<ExecutionResult>("ansible_adhoc_run", { id, options }),
  adhocPing: (id: string, pattern: string, inventory?: string) =>
    invoke<ExecutionResult>("ansible_adhoc_ping", { id, pattern, inventory }),
  adhocShell: (
    id: string,
    pattern: string,
    command: string,
    inventory: string | undefined,
    useBecome: boolean,
  ) =>
    invoke<ExecutionResult>("ansible_adhoc_shell", {
      id,
      pattern,
      command,
      inventory,
      useBecome,
    }),
  adhocCopy: (
    id: string,
    pattern: string,
    src: string,
    dest: string,
    inventory: string | undefined,
    useBecome: boolean,
  ) =>
    invoke<ExecutionResult>("ansible_adhoc_copy", {
      id,
      pattern,
      src,
      dest,
      inventory,
      useBecome,
    }),
  adhocService: (
    id: string,
    pattern: string,
    serviceName: string,
    serviceState: string,
    inventory?: string,
  ) =>
    invoke<ExecutionResult>("ansible_adhoc_service", {
      id,
      pattern,
      serviceName,
      serviceState,
      inventory,
    }),
  adhocPackage: (
    id: string,
    pattern: string,
    pkg: string,
    packageState: string,
    inventory?: string,
  ) =>
    invoke<ExecutionResult>("ansible_adhoc_package", {
      id,
      pattern,
      package: pkg,
      packageState,
      inventory,
    }),

  // Facts (2)
  factsGather: (
    id: string,
    pattern: string,
    inventory?: string,
    filter?: string,
  ) =>
    invoke<Record<string, HostFacts>>("ansible_facts_gather", {
      id,
      pattern,
      inventory,
      filter,
    }),
  factsGatherMin: (id: string, pattern: string, inventory?: string) =>
    invoke<Record<string, HostFacts>>("ansible_facts_gather_min", {
      id,
      pattern,
      inventory,
    }),

  // History (3)
  historyList: () =>
    invoke<ExecutionHistoryEntry[]>("ansible_history_list"),
  historyGet: (execId: string) =>
    invoke<ExecutionHistoryEntry | null>("ansible_history_get", { execId }),
  historyClear: () => invoke<void>("ansible_history_clear"),
};

export type AnsibleRunsApi = typeof ansibleRunsApi;

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Holds the primary list state for the Playbooks & Runs tab and a `run` helper
 * that funnels every command through shared loading/error handling. Deeper,
 * selection-scoped reads and one-shot executions are issued by the tab straight
 * through `api`, wrapped in `run`. `connectionId` is the live control-node id.
 */
export function useAnsibleRuns(connectionId: string) {
  const [playbooks, setPlaybooks] = useState<string[]>([]);
  const [history, setHistory] = useState<ExecutionHistoryEntry[]>([]);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** Run any command with shared loading/error handling; rethrows on failure so
   *  callers can branch, but always records the message for the tab to surface. */
  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
      throw e;
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  const refreshPlaybooks = useCallback(
    async (dir: string) => {
      const list = await run(() => ansibleRunsApi.playbookList(dir));
      if (mounted.current) setPlaybooks(list);
      return list;
    },
    [run],
  );

  const refreshHistory = useCallback(async () => {
    const list = await run(() => ansibleRunsApi.historyList());
    if (mounted.current) setHistory(list);
    return list;
  }, [run]);

  const recordResult = useCallback((result: ExecutionResult) => {
    if (mounted.current) setLastResult(result);
  }, []);

  return {
    // scoped session id
    connectionId,
    // state
    playbooks,
    history,
    lastResult,
    isLoading,
    error,
    // loaders / helpers
    refreshPlaybooks,
    refreshHistory,
    recordResult,
    clearError,
    // low-level access for selection-scoped reads + executions
    run,
    api: ansibleRunsApi,
  };
}

export type AnsibleRunsManager = ReturnType<typeof useAnsibleRuns>;
