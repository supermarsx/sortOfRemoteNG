import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

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

export function useInternalProxyManager(isOpen: boolean) {
  const [sessions, setSessions] = useState<ProxySessionDetail[]>([]);
  const [requestLog, setRequestLog] = useState<ProxyRequestLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<ManagerTab>("sessions");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sessionsData, logData] = await Promise.all([
        invoke<ProxySessionDetail[]>("get_proxy_session_details"),
        invoke<ProxyRequestLogEntry[]>("get_proxy_request_log"),
      ]);
      setSessions(sessionsData);
      setRequestLog(logData);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    await fetchData();
    setIsLoading(false);
  }, [fetchData]);

  // Initial load + auto-refresh
  useEffect(() => {
    if (!isOpen) return;
    handleRefresh();

    intervalRef.current = setInterval(() => {
      if (autoRefreshRef.current) {
        fetchData();
      }
    }, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isOpen, handleRefresh, fetchData]);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const handleStopSession = async (sessionId: string) => {
    try {
      await invoke("stop_basic_auth_proxy", { sessionId });
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopAll = async () => {
    try {
      const count = await invoke<number>("stop_all_proxy_sessions");
      setError("");
      if (count > 0) {
        await fetchData();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearLog = async () => {
    try {
      await invoke("clear_proxy_request_log");
      await fetchData();
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
