// useLxdConnection — connection lifecycle for the LXD integration (t42 lead).
//
// Pairs 1:1 with the "Connection" commands in
// `src-tauri/crates/sorng-lxd/src/commands.rs`: `lxd_connect`, `lxd_disconnect`,
// `lxd_is_connected`. The LxdService backend holds a single active connection in
// Tauri state, so these are global (no per-instance session id). Category slices
// (instances/images/networking/storage) call their own commands against that
// active connection — they do NOT re-bind these three.

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import type {
  LxdConnectionConfig,
  LxdConnectionSummary,
} from "../../../types/lxd";

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const lxdConnectionApi = {
  connect: (config: LxdConnectionConfig) =>
    invoke<LxdConnectionSummary>("lxd_connect", { config }),
  disconnect: () => invoke<void>("lxd_disconnect"),
  isConnected: () => invoke<boolean>("lxd_is_connected"),
};

// ─── React hook ───────────────────────────────────────────────────────────────

export function useLxdConnection() {
  const [summary, setSummary] = useState<LxdConnectionSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Reconcile local state with the backend's actual connection status. */
  const refreshStatus = useCallback(async () => {
    try {
      const isConn = await lxdConnectionApi.isConnected();
      if (mounted.current) setConnected(isConn);
      return isConn;
    } catch {
      if (mounted.current) setConnected(false);
      return false;
    }
  }, []);

  const connect = useCallback(
    async (
      config: LxdConnectionConfig,
    ): Promise<LxdConnectionSummary | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await lxdConnectionApi.connect(
          withGlobalHttpProxy(config, "camel"),
        );
        if (mounted.current) {
          setSummary(result);
          setConnected(result.connected);
        }
        return result;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        if (mounted.current) {
          setError(msg);
          setConnected(false);
        }
        return null;
      } finally {
        if (mounted.current) setIsLoading(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await lxdConnectionApi.disconnect();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
    } finally {
      if (mounted.current) {
        setConnected(false);
        setSummary(null);
        setIsLoading(false);
      }
    }
  }, []);

  return {
    summary,
    connected,
    isLoading,
    error,
    connect,
    disconnect,
    refreshStatus,
  };
}

export type LxdConnectionManager = ReturnType<typeof useLxdConnection>;
