import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useVisibleInterval } from "../perf/useVisibleInterval";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import {
  ServerStatsSnapshot,
  StatsCollectionOptions,
  defaultStatsCollectionOptions,
  REFRESH_INTERVALS,
} from "../../types/monitoring/serverStats";
import { buildStatsCollectionScript } from "../../utils/ssh/serverStatsCommands";
import { parseServerStatsOutput } from "../../utils/ssh/serverStatsParser";
import { serverStatsHistory } from "../../utils/ssh/serverStatsHistory";

export type ServerStatsViewMode = "single" | "aggregate";

// ─── Hook ──────────────────────────────────────────────────────────

export function useServerStats(isOpen: boolean) {
  const { state } = useConnections();

  // ── SSH sessions ───────────────────────────────────────
  const sshSessions = useMemo(() => {
    return state.sessions.filter(
      (s) =>
        s.protocol === "ssh" &&
        (s.status === "connected" || s.status === "connecting"),
    );
  }, [state.sessions]);

  // ── State ──────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [isCollecting, setIsCollecting] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<ServerStatsSnapshot | null>(
    null,
  );
  const [history, setHistory] = useState<ServerStatsSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [collectionOptions, setCollectionOptions] =
    useState<StatsCollectionOptions>(defaultStatsCollectionOptions);
  const [activeTab, setActiveTab] = useState<
    "overview" | "cpu" | "memory" | "disk" | "system" | "firewall" | "ports"
  >("overview");
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [viewMode, setViewMode] = useState<ServerStatsViewMode>("single");
  const [isCollectingAll, setIsCollectingAll] = useState(false);
  const inFlightRef = useRef<Set<string>>(new Set());

  // ── Auto-select first session ──────────────────────────
  useEffect(() => {
    if (isOpen && !selectedSessionId && sshSessions.length > 0) {
      setSelectedSessionId(sshSessions[0].id);
    }
  }, [isOpen, selectedSessionId, sshSessions]);

  // ── Collect stats ──────────────────────────────────────
  const collectForSession = useCallback(
    async (sessionId: string, opts: { surfaceError: boolean }) => {
      if (inFlightRef.current.has(sessionId)) return;

      const session = sshSessions.find((s) => s.id === sessionId);
      const fail = (msg: string) => {
        serverStatsHistory.recordError(sessionId, msg);
        if (opts.surfaceError) setError(msg);
      };
      if (!session) {
        if (opts.surfaceError)
          setError("Selected SSH session not found or disconnected.");
        return;
      }

      const backendSessionId = session.backendSessionId;
      if (!backendSessionId) {
        fail("No backend session ID — is the SSH session fully connected?");
        return;
      }

      const isTauri =
        typeof window !== "undefined" &&
        Boolean(
          (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
        );
      if (!isTauri) {
        fail("Server stats collection requires the Tauri runtime.");
        return;
      }

      inFlightRef.current.add(sessionId);
      if (opts.surfaceError) {
        setIsCollecting(true);
        setError(null);
      }
      const startTime = Date.now();

      try {
        const script = buildStatsCollectionScript(collectionOptions);

        const output = await invoke<string>("execute_command", {
          sessionId: backendSessionId,
          command: script,
          timeout: 30000,
        });

        const snapshot = parseServerStatsOutput(
          output,
          sessionId,
          session.name || session.hostname || "SSH",
          startTime,
        );
        serverStatsHistory.record(sessionId, snapshot);

        if (opts.surfaceError) {
          setRawOutput(output);
          setLastSnapshot(snapshot);
          setHistory((prev) => [snapshot, ...prev].slice(0, 50));
        }
      } catch (err: any) {
        const msg =
          typeof err === "string" ? err : err?.message || "Unknown error";
        fail(`Stats collection failed: ${msg}`);
      } finally {
        inFlightRef.current.delete(sessionId);
        if (opts.surfaceError) setIsCollecting(false);
      }
    },
    [sshSessions, collectionOptions],
  );

  const collectStats = useCallback(async () => {
    if (!selectedSessionId || isCollecting) return;
    await collectForSession(selectedSessionId, { surfaceError: true });
  }, [selectedSessionId, isCollecting, collectForSession]);

  /** Collect every connected SSH session with a small concurrency cap. */
  const collectAll = useCallback(async () => {
    const ids = sshSessions.map((s) => s.id);
    if (ids.length === 0) return;
    setIsCollectingAll(true);
    try {
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          await collectForSession(id, { surfaceError: false });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, worker),
      );
    } finally {
      setIsCollectingAll(false);
    }
  }, [sshSessions, collectForSession]);

  // Drop history for sessions that no longer exist.
  useEffect(() => {
    const live = new Set(state.sessions.map((s) => s.id));
    for (const id of serverStatsHistory.getSnapshot().keys()) {
      if (!live.has(id)) serverStatsHistory.remove(id);
    }
  }, [state.sessions]);

  // ── Auto-refresh (paused while hidden, one catch-up on return) ──
  useVisibleInterval(
    () => {
      void (viewMode === "aggregate" ? collectAll() : collectStats());
    },
    autoRefreshInterval > 0 && isOpen ? autoRefreshInterval * 1000 : null,
  );

  // ── Toggle a collection option ─────────────────────────
  const toggleOption = useCallback((key: keyof StatsCollectionOptions) => {
    setCollectionOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Clear history ──────────────────────────────────────
  const clearHistory = useCallback(() => {
    setHistory([]);
    serverStatsHistory.clear();
    setLastSnapshot(null);
    setRawOutput("");
  }, []);

  return {
    // Data
    sshSessions,
    selectedSessionId,
    lastSnapshot,
    history,
    error,
    rawOutput,
    showRawOutput,
    isCollecting,
    activeTab,
    autoRefreshInterval,
    collectionOptions,
    searchFilter,
    refreshIntervals: REFRESH_INTERVALS,
    viewMode,
    isCollectingAll,

    // Actions
    setSelectedSessionId,
    collectStats,
    collectAll,
    setViewMode,
    setAutoRefreshInterval,
    toggleOption,
    setActiveTab,
    setShowRawOutput,
    setSearchFilter,
    clearHistory,
    setError,
  };
}
