import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  cleanupSessionVpnBackend,
  findAssociatedVpnSessions,
  vpnLeaseCleanupFailureMessage,
} from "../../utils/network/sessionVpnLeaseCleanup";

export interface SshSessionInfo {
  id: string;
  config: {
    host: string;
    port: number;
    username: string;
  };
  connected_at: string;
  last_activity: string;
  is_alive: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeSessionInfo(value: unknown): SshSessionInfo | null {
  if (!isRecord(value) || !isRecord(value.config)) return null;
  const { config } = value;
  if (
    typeof value.id !== "string" ||
    typeof config.host !== "string" ||
    typeof config.port !== "number" ||
    typeof config.username !== "string" ||
    typeof value.connected_at !== "string" ||
    typeof value.last_activity !== "string" ||
    typeof value.is_alive !== "boolean"
  ) {
    return null;
  }

  // Keep only display-safe fields in React state. The native SSH config has
  // additional auth/routing fields that the Session Manager must never retain.
  return {
    id: value.id,
    config: {
      host: config.host,
      port: config.port,
      username: config.username,
    },
    connected_at: value.connected_at,
    last_activity: value.last_activity,
    is_alive: value.is_alive,
  };
}

/**
 * Live SSH-session source for the unified Session Manager.
 *
 * SSH sessions are owned by the native service, so this hook deliberately
 * treats `list_sessions` as the source of truth instead of relying only on
 * frontend tabs. That also exposes orphaned/detached backend sessions and
 * gives the manager a reliable disconnect surface.
 */
export function useSshSessionPanel(isVisible: boolean) {
  const { state, dispatch } = useConnections();
  const [sessions, setSessions] = useState<SshSessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  const sessionsRef = useRef(sessions);
  const frontendSessionsRef = useRef(state.sessions);
  const retainedCleanupRowsRef = useRef(new Map<string, SshSessionInfo>());
  const backendClosedRef = useRef(new Set<string>());
  const associatedSessionsRef = useRef(new Map<string, ConnectionSession[]>());

  sessionsRef.current = sessions;
  frontendSessionsRef.current = state.sessions;

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchData = useCallback(async () => {
    try {
      const result = await invoke<unknown>("list_sessions");
      const liveSessions = Array.isArray(result)
        ? result
            .map(sanitizeSessionInfo)
            .filter((session): session is SshSessionInfo => session !== null)
        : [];
      const liveIds = new Set(liveSessions.map((session) => session.id));
      setSessions([
        ...liveSessions,
        ...[...retainedCleanupRowsRef.current.values()].filter(
          (session) => !liveIds.has(session.id),
        ),
      ]);
      if (retainedCleanupRowsRef.current.size === 0) setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchData();
    } finally {
      setIsLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    if (!isVisible) return;
    void handleRefresh();
    const timer = setInterval(() => {
      if (autoRefreshRef.current) void fetchData();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchData, handleRefresh, isVisible]);

  const disconnectSession = useCallback(
    async (sessionId: string) => {
      const nativeSession =
        sessionsRef.current.find((session) => session.id === sessionId) ??
        retainedCleanupRowsRef.current.get(sessionId);
      if (!nativeSession) return false;

      const associatedSessions =
        associatedSessionsRef.current.get(sessionId) ??
        findAssociatedVpnSessions(
          frontendSessionsRef.current,
          "ssh",
          sessionId,
        );

      const cleanup = await cleanupSessionVpnBackend({
        sessions: associatedSessions,
        protocol: "ssh",
        backendSessionId: sessionId,
        backendAlreadyClosed: backendClosedRef.current.has(sessionId),
        closeBackend: async () => {
          await invoke("disconnect_ssh", { sessionId });
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
          ? vpnLeaseCleanupFailureMessage("ssh", cleanup)
          : "SSH cleanup could not be completed. Retry disconnect.");

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
    [dispatch],
  );

  const handleDisconnect = useCallback(
    (sessionId: string) => disconnectSession(sessionId),
    [disconnectSession],
  );

  const handleDisconnectAll = useCallback(async () => {
    const current = [...sessionsRef.current];
    const disconnectedIds: string[] = [];
    for (const session of current) {
      if (await disconnectSession(session.id)) {
        disconnectedIds.push(session.id);
      }
    }
    const failedCount = current.length - disconnectedIds.length;
    if (failedCount > 0) {
      setError(
        `Failed to fully clean up ${failedCount} SSH session${failedCount === 1 ? "" : "s"}. Retry disconnect to finish cleanup.`,
      );
    }
    return disconnectedIds;
  }, [disconnectSession]);

  return {
    sessions,
    isLoading,
    error,
    setError,
    autoRefresh,
    setAutoRefresh,
    handleRefresh,
    handleDisconnect,
    handleDisconnectAll,
  };
}
