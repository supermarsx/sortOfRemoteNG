import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProxyLogDiagnostic } from "../../utils/network/proxyLogDiagnostic";
import {
  parseNativeBrowserDiagnostics,
  type NativeBrowserDiagnostics,
} from "../../types/network/nativeBrowserDiagnostics";
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
  /** Optional native-owned bounded diagnostics; older log entries omit this. */
  diagnostic?: ProxyLogDiagnostic;
}

export type ManagerTab = "sessions" | "logs" | "stats" | "browser-logs";

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
  const view = options.view ?? activeTab;
  const loadLogs = view === "logs";
  const loadNative = view !== "sessions";
  const nativeScope = `${view}:${options.invalidationKey ?? ""}`;
  const [nativeResult, setNativeResult] = useState<{
    scope: string;
    data?: NativeBrowserDiagnostics;
    error: string;
  }>();

  const fetchData = useCallback(
    async (lease: SessionRefreshLease): Promise<void> => {
      if (!loadedRef.current) setIsLoading(true);
      // Independent read sources: legacy failure must not hide live CEF relays,
      // and missing native support must not discard the legacy request log.
      const nativeRead = loadNative
        ? invoke<unknown>("origin_browser_session_diagnostics")
            .then(parseNativeBrowserDiagnostics)
            .then((data) => {
              if (!lease.isCurrent()) return;
              const next = { scope: nativeScope, data, error: "" };
              setNativeResult((previous) =>
                sameSessionSnapshot(previous, next) ? previous : next,
              );
            })
            .catch(() => {
              if (lease.isCurrent())
                setNativeResult({
                  scope: nativeScope,
                  error:
                    "Native browser diagnostics could not be read. Refresh to retry.",
                });
            })
        : Promise.resolve();
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
        await nativeRead;
        if (lease.isCurrent()) setIsLoading(false);
      }
    },
    [loadLogs, loadNative, nativeScope],
  );
  const observation = useVisibleSessionRefresh({
    enabled: isOpen,
    load: fetchData,
    invalidationKey: nativeScope,
    intervalMs: autoRefresh ? 15_000 : 0,
  });
  const handleRefresh = observation.refresh;
  useEffect(() => {
    if (!isOpen) {
      setIsLoading(false);
      setNativeResult(undefined);
    }
  }, [isOpen]);

  // Do not display a prior owner/lifecycle snapshot during a coalesced refresh.
  const currentNative =
    isOpen && loadNative && nativeResult?.scope === nativeScope
      ? nativeResult
      : undefined;

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
    nativeDiagnostics: currentNative?.data,
    nativeDiagnosticsError: currentNative?.error ?? "",
    nativeDiagnosticsLoading: isOpen && loadNative && !currentNative,
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
