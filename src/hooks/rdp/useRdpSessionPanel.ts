import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Connection,
  type ConnectionSession,
} from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSessionThumbnails } from "./useSessionThumbnails";
import {
  loadSessionHistory,
  saveSessionHistory,
  clearSessionHistory as clearStoredHistory,
  resolveRdpHistoryConnection,
  RDPSessionHistoryEntry,
} from "../../utils/rdp/rdpSessionHistory";
import {
  cleanupSessionVpnBackend,
  findAssociatedVpnSessions,
  vpnLeaseCleanupFailureMessage,
} from "../../utils/network/sessionVpnLeaseCleanup";

export interface RDPSessionInfo {
  id: string;
  connection_id?: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  desktop_width: number;
  desktop_height: number;
  server_cert_fingerprint?: string;
  viewer_attached?: boolean;
}

export interface RDPStats {
  session_id: string;
  uptime_secs: number;
  bytes_received: number;
  bytes_sent: number;
  pdus_received: number;
  pdus_sent: number;
  frame_count: number;
  fps: number;
  input_events: number;
  errors_recovered: number;
  reactivations: number;
  phase: string;
  last_error?: string;
}

export type { RDPSessionHistoryEntry } from "../../utils/rdp/rdpSessionHistory";

export type PanelTab = "sessions" | "logs" | "history";

export function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface UseRDPSessionPanelParams {
  isVisible: boolean;
  connections: Connection[];
  activeBackendSessionIds?: string[];
  thumbnailsEnabled?: boolean;
  thumbnailPolicy?: "realtime" | "on-blur" | "on-detach" | "manual";
  thumbnailInterval?: number;
}

export function useRDPSessionPanel({
  isVisible,
  connections,
  activeBackendSessionIds = [],
  thumbnailsEnabled = true,
  thumbnailPolicy = "realtime",
  thumbnailInterval = 5,
}: UseRDPSessionPanelParams) {
  const { state, dispatch } = useConnections();
  const [sessions, setSessions] = useState<RDPSessionInfo[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RDPStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  const [activeTab, setActiveTab] = useState<PanelTab>("sessions");
  const [rebootConfirmSessionId, setRebootConfirmSessionId] = useState<
    string | null
  >(null);
  const [logSessionFilter, setLogSessionFilter] = useState<string | null>(null);
  const [sessionHistory, setSessionHistory] =
    useState<RDPSessionHistoryEntry[]>(loadSessionHistory);
  const sessionsRef = useRef(sessions);
  const frontendSessionsRef = useRef(state.sessions);
  const retainedCleanupRowsRef = useRef(new Map<string, RDPSessionInfo>());
  const backendClosedRef = useRef(new Set<string>());
  const associatedSessionsRef = useRef(new Map<string, ConnectionSession[]>());

  sessionsRef.current = sessions;
  frontendSessionsRef.current = state.sessions;

  // Track previous sessions so we can detect disconnections
  const prevSessionsRef = useRef<RDPSessionInfo[]>([]);

  const thumbnails = useSessionThumbnails(
    sessions,
    thumbnailInterval * 1000,
    isVisible &&
      activeTab === "sessions" &&
      thumbnailsEnabled &&
      thumbnailPolicy === "realtime",
  );

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const getSessionDisplayName = useCallback(
    (session: RDPSessionInfo): { name: string; subtitle: string } => {
      let conn = session.connection_id
        ? connections.find((c) => c.id === session.connection_id)
        : undefined;
      if (!conn) {
        conn = connections.find(
          (c) =>
            c.hostname === session.host &&
            (c.port || 3389) === session.port &&
            c.protocol === "rdp",
        );
      }
      if (conn) {
        return {
          name: conn.name,
          subtitle: `${session.host}:${session.port}${session.username ? ` (${session.username})` : ""}`,
        };
      }
      return {
        name: `${session.host}:${session.port}`,
        subtitle: session.username || "",
      };
    },
    [connections],
  );

  // Detect disconnected sessions and record them to history
  useEffect(() => {
    const prev = prevSessionsRef.current;
    if (prev.length === 0) {
      prevSessionsRef.current = sessions;
      return;
    }

    const currentIds = new Set(sessions.map((s) => s.id));
    const disappeared = prev.filter((s) => !currentIds.has(s.id));

    if (disappeared.length > 0) {
      // Re-read from localStorage so we pick up entries written by useSessionManager
      setSessionHistory(() => {
        const stored = loadSessionHistory();
        const newEntries: RDPSessionHistoryEntry[] = disappeared.map((s) => {
          const stats = statsMap[s.id];
          const display = getSessionDisplayName(s);
          return {
            connectionId: s.connection_id || "",
            connectionName: display.name,
            hostname: s.host,
            port: s.port,
            username: s.username,
            lastConnected: stats
              ? new Date(Date.now() - stats.uptime_secs * 1000).toISOString()
              : new Date().toISOString(),
            disconnectedAt: new Date().toISOString(),
            duration: stats?.uptime_secs ?? 0,
            desktopWidth: s.desktop_width,
            desktopHeight: s.desktop_height,
          };
        });
        const merged = [...newEntries, ...stored];
        saveSessionHistory(merged);
        return merged;
      });
    }

    prevSessionsRef.current = sessions;
  }, [sessions, statsMap, getSessionDisplayName]);

  const addToHistory = useCallback(
    (session: RDPSessionInfo) => {
      const stats = statsMap[session.id];
      const display = getSessionDisplayName(session);
      const entry: RDPSessionHistoryEntry = {
        connectionId: session.connection_id || "",
        connectionName: display.name,
        hostname: session.host,
        port: session.port,
        username: session.username,
        lastConnected: stats
          ? new Date(Date.now() - stats.uptime_secs * 1000).toISOString()
          : new Date().toISOString(),
        disconnectedAt: new Date().toISOString(),
        duration: stats?.uptime_secs ?? 0,
        desktopWidth: session.desktop_width,
        desktopHeight: session.desktop_height,
      };
      setSessionHistory((prev) => {
        const merged = [entry, ...prev];
        saveSessionHistory(merged);
        return merged;
      });
    },
    [statsMap, getSessionDisplayName],
  );

  const clearHistory = useCallback(() => {
    setSessionHistory([]);
    clearStoredHistory();
  }, []);

  const reconnectFromHistory = useCallback(
    (entry: RDPSessionHistoryEntry) =>
      resolveRdpHistoryConnection(entry, connections),
    [connections],
  );

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await invoke<RDPSessionInfo[]>("list_rdp_sessions");
      const liveIds = new Set(list.map((session) => session.id));
      setSessions([
        ...list,
        ...[...retainedCleanupRowsRef.current.values()].filter(
          (session) => !liveIds.has(session.id),
        ),
      ]);
      const newStats: Record<string, RDPStats> = {};
      for (const s of list) {
        try {
          const st = await invoke<RDPStats>("get_rdp_stats", {
            sessionId: s.id,
          });
          newStats[s.id] = st;
        } catch {
          // Session may have ended
        }
      }
      setStatsMap(newStats);
      if (retainedCleanupRowsRef.current.size === 0) setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isVisible) return;
    fetchData();
    const timer = setInterval(() => {
      if (autoRefreshRef.current) fetchData();
    }, 3000);
    return () => clearInterval(timer);
  }, [isVisible, fetchData]);

  const handleDisconnect = useCallback(
    async (sessionId: string) => {
      const nativeSession =
        sessionsRef.current.find((session) => session.id === sessionId) ??
        retainedCleanupRowsRef.current.get(sessionId);
      if (!nativeSession) return false;
      const associatedSessions =
        associatedSessionsRef.current.get(sessionId) ??
        findAssociatedVpnSessions(
          frontendSessionsRef.current,
          "rdp",
          sessionId,
          nativeSession.connection_id,
        );

      const cleanup = await cleanupSessionVpnBackend({
        sessions: associatedSessions,
        protocol: "rdp",
        backendSessionId: sessionId,
        backendAlreadyClosed: backendClosedRef.current.has(sessionId),
        closeBackend: async () => {
          await invoke("disconnect_rdp", { sessionId });
          addToHistory(nativeSession);
          backendClosedRef.current.add(sessionId);
        },
        onSessionsUpdated: (updatedSessions) => {
          const snapshot = updatedSessions.map((session) => ({ ...session }));
          associatedSessionsRef.current.set(sessionId, snapshot);
          snapshot.forEach((session) => {
            dispatch({ type: "UPDATE_SESSION", payload: session });
          });
        },
      });
      if (cleanup.backendClosed) backendClosedRef.current.add(sessionId);
      const cleanupFailed =
        !cleanup.backendClosed ||
        cleanup.failures.length > 0 ||
        Boolean(cleanup.blockedReason);
      const cleanupError =
        cleanup.blockedReason ??
        (cleanup.failures.length > 0
          ? vpnLeaseCleanupFailureMessage("rdp", cleanup)
          : "RDP cleanup could not be completed. Retry disconnect.");

      if (cleanupFailed) {
        retainedCleanupRowsRef.current.set(sessionId, nativeSession);
        associatedSessionsRef.current.set(sessionId, cleanup.sessions);
        setSessions((current) =>
          current.some((session) => session.id === sessionId)
            ? current
            : [...current, nativeSession],
        );
        setError(cleanupError);
        return false;
      }

      retainedCleanupRowsRef.current.delete(sessionId);
      backendClosedRef.current.delete(sessionId);
      associatedSessionsRef.current.delete(sessionId);
      setSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );
      if (retainedCleanupRowsRef.current.size === 0) setError("");
      return true;
    },
    [addToHistory, dispatch],
  );

  const handleDetach = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("detach_rdp_session", { sessionId });
        fetchData();
      } catch (e) {
        setError(`Detach failed: ${String(e)}`);
      }
    },
    [fetchData],
  );

  const handleSignOut = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("rdp_sign_out", { sessionId });
        fetchData();
      } catch (e) {
        setError(`Sign out failed: ${String(e)}`);
      }
    },
    [fetchData],
  );

  const handleForceReboot = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("rdp_force_reboot", { sessionId });
        fetchData();
      } catch (e) {
        setError(`Force reboot failed: ${String(e)}`);
      }
    },
    [fetchData],
  );

  const handleDisconnectAll = useCallback(async () => {
    const current = [...sessionsRef.current];
    let failedCount = 0;
    for (const session of current) {
      if (!(await handleDisconnect(session.id))) failedCount += 1;
    }
    if (failedCount > 0) {
      setError(
        `Failed to fully clean up ${failedCount} RDP session${failedCount === 1 ? "" : "s"}. Retry disconnect to finish cleanup.`,
      );
    }
    setStatsMap((currentStats) => {
      const retainedIds = new Set(retainedCleanupRowsRef.current.keys());
      return Object.fromEntries(
        Object.entries(currentStats).filter(([id]) => retainedIds.has(id)),
      );
    });
  }, [handleDisconnect]);

  const isSessionDetached = useCallback(
    (session: RDPSessionInfo): boolean => {
      const hasFrontendViewer =
        activeBackendSessionIds.includes(session.id) ||
        (session.connection_id != null &&
          activeBackendSessionIds.includes(session.connection_id));
      return !hasFrontendViewer;
    },
    [activeBackendSessionIds],
  );

  const totalTraffic = Object.values(statsMap).reduce(
    (sum, s) => sum + s.bytes_received + s.bytes_sent,
    0,
  );

  return {
    sessions,
    statsMap,
    isLoading,
    error,
    setError,
    autoRefresh,
    setAutoRefresh,
    activeTab,
    setActiveTab,
    rebootConfirmSessionId,
    setRebootConfirmSessionId,
    logSessionFilter,
    setLogSessionFilter,
    thumbnails,
    handleRefresh,
    handleDisconnect,
    handleDetach,
    handleSignOut,
    handleForceReboot,
    handleDisconnectAll,
    getSessionDisplayName,
    isSessionDetached,
    totalTraffic,
    sessionHistory,
    clearHistory,
    reconnectFromHistory,
  };
}
