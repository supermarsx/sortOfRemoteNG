import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

/**
 * Live SSH-session source for the unified Session Manager.
 *
 * SSH sessions are owned by the native service, so this hook deliberately
 * treats `list_sessions` as the source of truth instead of relying only on
 * frontend tabs. That also exposes orphaned/detached backend sessions and
 * gives the manager a reliable disconnect surface.
 */
export function useSshSessionPanel(isVisible: boolean) {
  const [sessions, setSessions] = useState<SshSessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchData = useCallback(async () => {
    try {
      const result = await invoke<SshSessionInfo[]>("list_sessions");
      setSessions(Array.isArray(result) ? result : []);
      setError("");
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

  const handleDisconnect = useCallback(async (sessionId: string) => {
    try {
      await invoke("disconnect_ssh", { sessionId });
      setSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );
      setError("");
      return true;
    } catch (cause) {
      setError(
        `Disconnect failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return false;
    }
  }, []);

  const handleDisconnectAll = useCallback(async () => {
    const current = sessions;
    const results = await Promise.allSettled(
      current.map((session) =>
        invoke("disconnect_ssh", { sessionId: session.id }),
      ),
    );
    const disconnectedIds = current
      .filter((_, index) => results[index]?.status === "fulfilled")
      .map((session) => session.id);
    const failedCount = results.length - disconnectedIds.length;

    setSessions((existing) =>
      existing.filter((session) => !disconnectedIds.includes(session.id)),
    );
    setError(
      failedCount > 0
        ? `Failed to disconnect ${failedCount} SSH session${failedCount === 1 ? "" : "s"}.`
        : "",
    );
    return disconnectedIds;
  }, [sessions]);

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
