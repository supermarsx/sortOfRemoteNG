import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import {
  ServerStatsSnapshot,
  StatsCollectionOptions,
  defaultStatsCollectionOptions,
  REFRESH_INTERVALS,
} from "../../types/serverStats";
import { buildStatsCollectionScript } from "../../utils/serverStatsCommands";
import { parseServerStatsOutput } from "../../utils/serverStatsParser";

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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<ServerStatsSnapshot | null>(null);
  const [history, setHistory] = useState<ServerStatsSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [collectionOptions, setCollectionOptions] = useState<StatsCollectionOptions>(
    defaultStatsCollectionOptions,
  );
  const [activeTab, setActiveTab] = useState<
    "overview" | "cpu" | "memory" | "disk" | "system" | "firewall" | "ports"
  >("overview");
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auto-select first session ──────────────────────────
  useEffect(() => {
    if (isOpen && !selectedSessionId && sshSessions.length > 0) {
      setSelectedSessionId(sshSessions[0].id);
    }
  }, [isOpen, selectedSessionId, sshSessions]);

  // ── Collect stats ──────────────────────────────────────
  const collectStats = useCallback(async () => {
    if (!selectedSessionId || isCollecting) return;

    const session = sshSessions.find((s) => s.id === selectedSessionId);
    if (!session) {
      setError("Selected SSH session not found or disconnected.");
      return;
    }

    const backendSessionId = session.backendSessionId;
    if (!backendSessionId) {
      setError("No backend session ID — is the SSH session fully connected?");
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setError("Server stats collection requires the Tauri runtime.");
      return;
    }

    setIsCollecting(true);
    setError(null);
    const startTime = Date.now();

    try {
      const script = buildStatsCollectionScript(collectionOptions);

      const output = await invoke<string>("execute_command", {
        sessionId: backendSessionId,
        command: script,
        timeout: 30000,
      });

      setRawOutput(output);

      const snapshot = parseServerStatsOutput(
        output,
        selectedSessionId,
        session.name || session.hostname || "SSH",
        startTime,
      );

      setLastSnapshot(snapshot);
      setHistory((prev) => [snapshot, ...prev].slice(0, 50));
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Unknown error";
      setError(`Stats collection failed: ${msg}`);
    } finally {
      setIsCollecting(false);
    }
  }, [selectedSessionId, isCollecting, sshSessions, collectionOptions]);

  // ── Auto-refresh ───────────────────────────────────────
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (autoRefreshInterval > 0 && isOpen) {
      autoRefreshRef.current = setInterval(collectStats, autoRefreshInterval * 1000);
    }
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [autoRefreshInterval, isOpen, collectStats]);

  // ── Clean up on close ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    }
  }, [isOpen]);

  // ── Toggle a collection option ─────────────────────────
  const toggleOption = useCallback((key: keyof StatsCollectionOptions) => {
    setCollectionOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Clear history ──────────────────────────────────────
  const clearHistory = useCallback(() => {
    setHistory([]);
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

    // Actions
    setSelectedSessionId,
    collectStats,
    setAutoRefreshInterval,
    toggleOption,
    setActiveTab,
    setShowRawOutput,
    setSearchFilter,
    clearHistory,
    setError,
  };
}
