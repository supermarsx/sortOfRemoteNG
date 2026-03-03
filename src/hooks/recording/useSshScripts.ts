import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SshEventScript,
  ScriptChain,
  ExecutionRecord,
  PendingExecution,
  ScriptStats,
  SchedulerEntry,
  SshScriptsSummary,
  CreateScriptRequest,
  UpdateScriptRequest,
  CreateChainRequest,
  UpdateChainRequest,
  RunScriptRequest,
  RunChainRequest,
  HistoryQuery,
  HistoryResponse,
  ScriptBundle,
  ImportResult,
  SshLifecycleEvent,
} from "../../types/sshScripts";

export interface UseSshScriptsReturn {
  // Data
  scripts: SshEventScript[];
  chains: ScriptChain[];
  selectedScript: SshEventScript | null;
  selectedChain: ScriptChain | null;
  history: ExecutionRecord[];
  historyTotal: number;
  stats: Record<string, ScriptStats>;
  timers: SchedulerEntry[];
  summary: SshScriptsSummary | null;
  tags: string[];
  categories: string[];
  pendingExecutions: PendingExecution[];
  loading: boolean;
  error: string | null;

  // Filters
  searchFilter: string;
  setSearchFilter: (v: string) => void;
  triggerFilter: string;
  setTriggerFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  tab: "scripts" | "chains" | "history" | "timers";
  setTab: (t: "scripts" | "chains" | "history" | "timers") => void;

  // Script CRUD
  createScript: (req: CreateScriptRequest) => Promise<SshEventScript>;
  updateScript: (id: string, req: UpdateScriptRequest) => Promise<SshEventScript>;
  deleteScript: (id: string) => Promise<void>;
  duplicateScript: (id: string) => Promise<SshEventScript>;
  toggleScript: (id: string, enabled: boolean) => Promise<void>;
  selectScript: (script: SshEventScript | null) => void;

  // Chain CRUD
  createChain: (req: CreateChainRequest) => Promise<ScriptChain>;
  updateChain: (id: string, req: UpdateChainRequest) => Promise<ScriptChain>;
  deleteChain: (id: string) => Promise<void>;
  toggleChain: (id: string, enabled: boolean) => Promise<void>;
  selectChain: (chain: ScriptChain | null) => void;

  // Execution
  runScript: (req: RunScriptRequest) => Promise<PendingExecution>;
  runChain: (req: RunChainRequest) => Promise<PendingExecution[]>;
  recordExecution: (record: ExecutionRecord) => Promise<void>;

  // Events
  notifyEvent: (event: SshLifecycleEvent) => Promise<PendingExecution[]>;
  notifyOutput: (sessionId: string, data: string) => Promise<PendingExecution[]>;

  // History
  queryHistory: (query: HistoryQuery) => Promise<HistoryResponse>;
  clearHistory: () => Promise<void>;

  // Scheduler
  pauseTimer: (scriptId: string, sessionId: string) => Promise<void>;
  resumeTimer: (scriptId: string, sessionId: string) => Promise<void>;

  // Bulk
  bulkEnable: (ids: string[], enabled: boolean) => Promise<number>;
  bulkDelete: (ids: string[]) => Promise<number>;

  // Import/Export
  exportScripts: () => Promise<ScriptBundle>;
  importScripts: (bundle: ScriptBundle) => Promise<ImportResult>;

  // Refresh
  refresh: () => Promise<void>;
}

export function useSshScripts(): UseSshScriptsReturn {
  const [scripts, setScripts] = useState<SshEventScript[]>([]);
  const [chains, setChains] = useState<ScriptChain[]>([]);
  const [selectedScript, setSelectedScript] = useState<SshEventScript | null>(null);
  const [selectedChain, setSelectedChain] = useState<ScriptChain | null>(null);
  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, ScriptStats>>({});
  const [timers, setTimers] = useState<SchedulerEntry[]>([]);
  const [summary, setSummary] = useState<SshScriptsSummary | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [pendingExecutions, setPendingExecutions] = useState<PendingExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchFilter, setSearchFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [tab, setTab] = useState<"scripts" | "chains" | "history" | "timers">("scripts");

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c, t, cat, sum, st] = await Promise.all([
        invoke<SshEventScript[]>("ssh_scripts_list_scripts"),
        invoke<ScriptChain[]>("ssh_scripts_list_chains"),
        invoke<string[]>("ssh_scripts_get_tags"),
        invoke<string[]>("ssh_scripts_get_categories"),
        invoke<SshScriptsSummary>("ssh_scripts_get_summary"),
        invoke<Record<string, ScriptStats>>("ssh_scripts_get_all_stats"),
      ]);
      setScripts(s);
      setChains(c);
      setTags(t);
      setCategories(cat);
      setSummary(sum);
      setStats(st);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Scheduler tick every 5 seconds
  useEffect(() => {
    tickRef.current = setInterval(async () => {
      try {
        const execs = await invoke<PendingExecution[]>("ssh_scripts_scheduler_tick");
        if (execs.length > 0) {
          setPendingExecutions((prev) => [...prev, ...execs]);
        }
      } catch {
        // ignore tick errors
      }
    }, 5000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // ── Script CRUD ────────────────────────────────────────────────────────

  const createScript = useCallback(
    async (req: CreateScriptRequest) => {
      const script = await invoke<SshEventScript>("ssh_scripts_create_script", {
        request: req,
      });
      await refresh();
      return script;
    },
    [refresh],
  );

  const updateScript = useCallback(
    async (id: string, req: UpdateScriptRequest) => {
      const script = await invoke<SshEventScript>("ssh_scripts_update_script", {
        scriptId: id,
        request: req,
      });
      await refresh();
      return script;
    },
    [refresh],
  );

  const deleteScript = useCallback(
    async (id: string) => {
      await invoke("ssh_scripts_delete_script", { scriptId: id });
      if (selectedScript?.id === id) setSelectedScript(null);
      await refresh();
    },
    [refresh, selectedScript],
  );

  const duplicateScript = useCallback(
    async (id: string) => {
      const script = await invoke<SshEventScript>("ssh_scripts_duplicate_script", {
        scriptId: id,
      });
      await refresh();
      return script;
    },
    [refresh],
  );

  const toggleScript = useCallback(
    async (id: string, enabled: boolean) => {
      await invoke("ssh_scripts_toggle_script", { scriptId: id, enabled });
      await refresh();
    },
    [refresh],
  );

  // ── Chain CRUD ─────────────────────────────────────────────────────────

  const createChain = useCallback(
    async (req: CreateChainRequest) => {
      const chain = await invoke<ScriptChain>("ssh_scripts_create_chain", {
        request: req,
      });
      await refresh();
      return chain;
    },
    [refresh],
  );

  const updateChain = useCallback(
    async (id: string, req: UpdateChainRequest) => {
      const chain = await invoke<ScriptChain>("ssh_scripts_update_chain", {
        chainId: id,
        request: req,
      });
      await refresh();
      return chain;
    },
    [refresh],
  );

  const deleteChain = useCallback(
    async (id: string) => {
      await invoke("ssh_scripts_delete_chain", { chainId: id });
      if (selectedChain?.id === id) setSelectedChain(null);
      await refresh();
    },
    [refresh, selectedChain],
  );

  const toggleChain = useCallback(
    async (id: string, enabled: boolean) => {
      await invoke("ssh_scripts_toggle_chain", { chainId: id, enabled });
      await refresh();
    },
    [refresh],
  );

  // ── Execution ──────────────────────────────────────────────────────────

  const runScript = useCallback(async (req: RunScriptRequest) => {
    const exec = await invoke<PendingExecution>("ssh_scripts_run_script", {
      request: req,
    });
    setPendingExecutions((prev) => [...prev, exec]);
    return exec;
  }, []);

  const runChain = useCallback(async (req: RunChainRequest) => {
    const execs = await invoke<PendingExecution[]>("ssh_scripts_run_chain", {
      request: req,
    });
    setPendingExecutions((prev) => [...prev, ...execs]);
    return execs;
  }, []);

  const recordExecution = useCallback(
    async (record: ExecutionRecord) => {
      await invoke("ssh_scripts_record_execution", { record });
      await refresh();
    },
    [refresh],
  );

  // ── Events ─────────────────────────────────────────────────────────────

  const notifyEvent = useCallback(async (event: SshLifecycleEvent) => {
    const execs = await invoke<PendingExecution[]>("ssh_scripts_notify_event", {
      event,
    });
    if (execs.length > 0) setPendingExecutions((prev) => [...prev, ...execs]);
    return execs;
  }, []);

  const notifyOutput = useCallback(async (sessionId: string, data: string) => {
    const execs = await invoke<PendingExecution[]>("ssh_scripts_notify_output", {
      sessionId,
      data,
    });
    if (execs.length > 0) setPendingExecutions((prev) => [...prev, ...execs]);
    return execs;
  }, []);

  // ── History ────────────────────────────────────────────────────────────

  const queryHistory = useCallback(async (query: HistoryQuery) => {
    const res = await invoke<HistoryResponse>("ssh_scripts_query_history", {
      query,
    });
    setHistory(res.records);
    setHistoryTotal(res.total);
    return res;
  }, []);

  const clearHistory = useCallback(async () => {
    await invoke("ssh_scripts_clear_history");
    setHistory([]);
    setHistoryTotal(0);
  }, []);

  // ── Scheduler ──────────────────────────────────────────────────────────

  const pauseTimer = useCallback(async (scriptId: string, sessionId: string) => {
    await invoke("ssh_scripts_pause_timer", { scriptId, sessionId });
  }, []);

  const resumeTimer = useCallback(async (scriptId: string, sessionId: string) => {
    await invoke("ssh_scripts_resume_timer", { scriptId, sessionId });
  }, []);

  // ── Bulk ───────────────────────────────────────────────────────────────

  const bulkEnable = useCallback(
    async (ids: string[], enabled: boolean) => {
      const count = await invoke<number>("ssh_scripts_bulk_enable", {
        scriptIds: ids,
        enabled,
      });
      await refresh();
      return count;
    },
    [refresh],
  );

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      const count = await invoke<number>("ssh_scripts_bulk_delete", {
        scriptIds: ids,
      });
      await refresh();
      return count;
    },
    [refresh],
  );

  // ── Import/Export ──────────────────────────────────────────────────────

  const exportScripts = useCallback(async () => {
    return invoke<ScriptBundle>("ssh_scripts_export");
  }, []);

  const importScripts = useCallback(
    async (bundle: ScriptBundle) => {
      const result = await invoke<ImportResult>("ssh_scripts_import", { bundle });
      await refresh();
      return result;
    },
    [refresh],
  );

  // ── Filtered data ──────────────────────────────────────────────────────

  const filteredScripts = useMemo(() => {
    let list = scripts;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (triggerFilter) {
      list = list.filter((s) => s.trigger.type === triggerFilter);
    }
    if (categoryFilter) {
      list = list.filter((s) => s.category === categoryFilter);
    }
    if (tagFilter) {
      list = list.filter((s) => s.tags.includes(tagFilter));
    }
    return list;
  }, [scripts, searchFilter, triggerFilter, categoryFilter, tagFilter]);

  return {
    scripts: filteredScripts,
    chains,
    selectedScript,
    selectedChain,
    history,
    historyTotal,
    stats,
    timers,
    summary,
    tags,
    categories,
    pendingExecutions,
    loading,
    error,
    searchFilter,
    setSearchFilter,
    triggerFilter,
    setTriggerFilter,
    categoryFilter,
    setCategoryFilter,
    tagFilter,
    setTagFilter,
    tab,
    setTab,
    createScript,
    updateScript,
    deleteScript,
    duplicateScript,
    toggleScript,
    selectScript: setSelectedScript,
    createChain,
    updateChain,
    deleteChain,
    toggleChain,
    selectChain: setSelectedChain,
    runScript,
    runChain,
    recordExecution,
    notifyEvent,
    notifyOutput,
    queryHistory,
    clearHistory,
    pauseTimer,
    resumeTimer,
    bulkEnable,
    bulkDelete,
    exportScripts,
    importScripts,
    refresh,
  };
}
