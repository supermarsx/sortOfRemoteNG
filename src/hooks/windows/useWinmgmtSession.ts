import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Shared hook for managing a WMI session lifecycle.
 * Each tool panel uses this to connect/disconnect using the parent connection's credentials.
 */
export function useWinmgmtSession(
  hostname: string,
  connectionId: string,
  username?: string,
  password?: string,
  domain?: string,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const isTauri = useMemo(
    () =>
      typeof window !== "undefined" &&
      Boolean(
        (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
      ),
    [],
  );

  const connect = useCallback(async () => {
    if (!isTauri) {
      setError("Windows management requires the Tauri runtime.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const config: Record<string, unknown> = { computerName: hostname };
      if (username && password) {
        config.credential = { username, password, domain: domain || undefined };
      }
      const id = await invoke<string>("winmgmt_connect", { config });
      if (mountedRef.current) {
        setSessionId(id);
      }
    } catch (err) {
      if (mountedRef.current) setError(String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [isTauri, hostname, username, password, domain]);

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      await invoke("winmgmt_disconnect", { sessionId });
    } catch {
      // ignore
    }
    if (mountedRef.current) {
      setSessionId(null);
      setError(null);
    }
  }, [sessionId]);

  /** Invoke a winmgmt command with the current sessionId auto-injected. */
  const cmd = useCallback(
    async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (!isTauri) throw new Error("Tauri runtime required.");
      if (!sessionId) throw new Error("No WMI session connected.");
      return invoke<T>(command, { sessionId, ...args });
    },
    [isTauri, sessionId],
  );

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        invoke("winmgmt_disconnect", { sessionId }).catch(() => {});
      }
    };
  }, [sessionId]);

  return {
    sessionId,
    isConnected: sessionId !== null,
    loading,
    error,
    isTauri,
    connect,
    disconnect,
    cmd,
    clearError: () => setError(null),
  };
}
