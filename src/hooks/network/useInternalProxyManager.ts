import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  sameSessionSnapshot,
  useVisibleSessionRefresh,
  type SessionRefreshLease,
} from "../session/useVisibleSessionRefresh";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProxySessionDetail {
  session_id: string;
  target_url: string;
  username: string;
  proxy_url: string;
  created_at: string;
  request_count: number;
  error_count: number;
  last_error: string | null;
}

export interface ProxyRequestLogEntry {
  /** New backends provide stable IDs; older fixtures/backends may omit it. */
  id?: string;
  session_id: string;
  method: string;
  url: string;
  status: number;
  error: string | null;
  timestamp: string;
}

export type ManagerTab = "sessions" | "logs" | "stats";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export const formatTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
};

export const formatDateTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
};

export const getStatusColor = (status: number): string => {
  if (status < 300) return "text-green-400";
  if (status < 400) return "text-yellow-400";
  if (status < 500) return "text-orange-400";
  return "text-red-400";
};

export const getMethodColor = (method: string): string => {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-blue-400";
    case "POST":
      return "text-green-400";
    case "PUT":
      return "text-yellow-400";
    case "DELETE":
      return "text-red-400";
    case "PATCH":
      return "text-purple-400";
    default:
      return "text-[var(--color-textSecondary)]";
  }
};

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useInternalProxyManager(
  isOpen: boolean,
  options: { view?: ManagerTab; invalidationKey?: string } = {},
) {
  const [sessions, setSessions] = useState<ProxySessionDetail[]>([]);
  const [requestLog, setRequestLog] = useState<ProxyRequestLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<ManagerTab>("sessions");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const loadedRef = useRef(false);
  const loadLogs = (options.view ?? activeTab) === "logs";

  const fetchData = useCallback(
    async (lease: SessionRefreshLease): Promise<void> => {
      if (!loadedRef.current) setIsLoading(true);
      try {
        const [sessionsData, logData] = await Promise.all([
          invoke<ProxySessionDetail[]>("get_proxy_session_details"),
          loadLogs
            ? invoke<ProxyRequestLogEntry[]>("get_proxy_request_log")
            : Promise.resolve(null),
        ]);
        if (!lease.isCurrent()) return;
        setSessions((previous) =>
          sameSessionSnapshot(previous, sessionsData) ? previous : sessionsData,
        );
        if (logData)
          setRequestLog((previous) =>
            sameSessionSnapshot(previous, logData) ? previous : logData,
          );
        loadedRef.current = true;
        setError("");
      } catch (e) {
        if (lease.isCurrent())
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (lease.isCurrent()) setIsLoading(false);
      }
    },
    [loadLogs],
  );
  const observation = useVisibleSessionRefresh({
    enabled: isOpen,
    load: fetchData,
    invalidationKey: `${loadLogs}:${options.invalidationKey ?? ""}`,
    intervalMs: autoRefresh ? 15_000 : 0,
  });
  const handleRefresh = observation.refresh;
  useEffect(() => {
    if (!isOpen) setIsLoading(false);
  }, [isOpen]);

  const handleStopSession = async (sessionId: string): Promise<boolean> => {
    observation.invalidate();
    setIsLoading(false);
    try {
      await invoke("stop_basic_auth_proxy", { sessionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }

    // The native stop command is intentionally non-idempotent: once it
    // succeeds, retrying it can only report "not found". Commit that close
    // locally before the best-effort refresh so an observability failure
    // cannot turn completed cleanup into an endless retry loop.
    setSessions((current) =>
      current.filter((session) => session.session_id !== sessionId),
    );
    observation.refresh();
    return true;
  };

  const handleStopAll = async () => {
    observation.invalidate();
    setIsLoading(false);
    try {
      await invoke<number>("stop_all_proxy_sessions");
      setError("");
      observation.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearLog = async () => {
    observation.invalidate();
    setIsLoading(false);
    try {
      await invoke("clear_proxy_request_log");
      setRequestLog([]);
      observation.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Derived stats
  const totalRequests = sessions.reduce((sum, s) => sum + s.request_count, 0);
  const totalErrors = sessions.reduce((sum, s) => sum + s.error_count, 0);
  const errorRate =
    totalRequests > 0
      ? ((totalErrors / totalRequests) * 100).toFixed(1)
      : "0.0";

  return {
    sessions,
    requestLog,
    activeTab,
    setActiveTab,
    isLoading,
    error,
    setError,
    autoRefresh,
    setAutoRefresh,
    handleRefresh,
    handleStopSession,
    handleStopAll,
    handleClearLog,
    totalRequests,
    totalErrors,
    errorRate,
  };
}
