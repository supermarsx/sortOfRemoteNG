import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Error patterns that indicate the session is dead and cannot recover. */
const FATAL_PATTERNS = [
  // Auth / access
  "http 401",
  "http 403",
  "unauthorized",
  "access denied",
  "access is denied",
  "authentication failed",
  // Transport / network
  "connection refused",
  "connection reset",
  "timed out",
  "timeout",
  "failed to create transport",
  "connection test failed",
  "wmi http request failed",
  "wmi request failed",
  // SOAP / WS-Man faults (transport-level, not query-level)
  "soap fault",
  "wsmanfault",
  // Session lifecycle
  "session not found",
  "is disconnected",
  "is in error state",
];

function isFatalError(err: string): boolean {
  const lower = err.toLowerCase();
  return FATAL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Shared hook for managing a WMI session lifecycle.
 *
 * Accepts a pre-built WmiConnectionConfig object (matching the Rust serde
 * shape) so that all WinRM-specific settings — useSsl, authMethod,
 * namespace, skipCaCheck, etc. — are forwarded to the backend.
 *
 * Fatal errors (401, access denied, session lost, etc.) automatically
 * tear down the session and surface the error to `WinmgmtWrapper`.
 */
export function useWinmgmtSession(config: Record<string, unknown>) {
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

  // Stable stringified key so connect re-fires only when the config changes
  const configKey = JSON.stringify(config);

  const connect = useCallback(async () => {
    if (!isTauri) {
      setError("Windows management requires the Tauri runtime.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const id = await invoke<string>("winmgmt_connect", { config });
      if (mountedRef.current) {
        setSessionId(id);
      }
    } catch (err) {
      if (mountedRef.current) setError(String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect when config key changes
  }, [isTauri, configKey]);

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      await invoke("winmgmt_disconnect", { sessionId });
    } catch (e) {
      console.warn("winmgmt_disconnect failed:", e);
    }
    if (mountedRef.current) {
      setSessionId(null);
      setError(null);
    }
  }, [sessionId]);

  /**
   * Invoke a winmgmt command with the current sessionId auto-injected.
   */
  const cmd = useCallback(
    async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (!isTauri) throw new Error("Tauri runtime required.");
      if (!sessionId) throw new Error("No WMI session connected.");
      try {
        return await invoke<T>(command, { sessionId, ...args });
      } catch (err) {
        const msg = String(err);
        if (isFatalError(msg)) {
          if (mountedRef.current) {
            setSessionId(null);
            setError(msg);
          }
        }
        throw err;
      }
    },
    [isTauri, sessionId],
  );

  // Auto-connect on mount.
  // Re-arm mountedRef on every effect run so React 18 StrictMode
  // (mount → cleanup → remount) doesn't leave it permanently false.
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
    };
  }, [connect]);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        invoke("winmgmt_disconnect", { sessionId }).catch((e) => console.error("winmgmt disconnect failed:", e));
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
