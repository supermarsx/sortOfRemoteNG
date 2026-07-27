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
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";
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
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [summary, setSummary] = useState<LxdConnectionSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ownedConnectionRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const disconnectOperation = useCallback(async (): Promise<void> => {
    if (!ownedConnectionRef.current) return;
    await lxdConnectionApi.disconnect();
    ownedConnectionRef.current = false;
    if (mounted.current) {
      setConnected(false);
      setSummary(null);
      setIsLoading(false);
    }
  }, []);

  /** Reconcile only the backend connection owned by this mounted session. */
  const refreshStatus = useCallback(async () => {
    if (!ownedConnectionRef.current) {
      if (mounted.current) {
        setConnected(false);
        setSummary(null);
      }
      return false;
    }
    try {
      const isConn = await lxdConnectionApi.isConnected();
      if (mounted.current) {
        setConnected(isConn);
        if (!isConn) setSummary(null);
      }
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
      try {
        return await trackConnect(
          "lxd:global",
          async () => {
            setIsLoading(true);
            setError(null);
            try {
              const result = await lxdConnectionApi.connect(
                withGlobalHttpProxy(config, "camel"),
              );
              if (!result.connected) {
                throw new Error("LXD backend did not establish a connection");
              }
              ownedConnectionRef.current = true;
              if (mounted.current) {
                setSummary(result);
                setConnected(true);
              }
              return result;
            } catch (e) {
              const msg = typeof e === "string" ? e : (e as Error).message;
              if (mounted.current) {
                setError(msg);
                setConnected(false);
                setSummary(null);
              }
              throw e;
            } finally {
              if (mounted.current) setIsLoading(false);
            }
          },
          disconnectOperation,
        );
      } catch {
        return null;
      }
    },
    [disconnectOperation, trackConnect],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!ownedConnectionRef.current) {
      if (mounted.current) {
        setConnected(false);
        setSummary(null);
      }
      return;
    }
    setIsLoading(true);
    try {
      await trackDisconnect("lxd:global", disconnectOperation);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [disconnectOperation, trackDisconnect]);

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
