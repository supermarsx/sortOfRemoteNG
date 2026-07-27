// useExchangeConnection — connection-lifecycle slice for the Exchange integration.
//
// Pairs 1:1 with the "Connection" commands in
// `src-tauri/crates/sorng-exchange/src/commands.rs`
// (exchange_connect_with_config / exchange_disconnect /
// exchange_connection_summary). Argument names match the Rust
// `#[tauri::command]` signatures exactly.
//
// ⚠️ Exchange is a SINGLETON service. Configuration and authentication must use
// the atomic `exchange_connect_with_config` command so another panel cannot
// replace staged credentials between two invokes. Category tabs receive the
// resulting `summary` via props and MUST NOT re-implement connect.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";
import type {
  ExchangeConnectionConfig,
  ExchangeConnectionSummary,
} from "../../../types/exchange";

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const exchangeConnectionApi = {
  /** Legacy staged-config command; retained for command-surface compatibility. */
  setConfig: (config: ExchangeConnectionConfig) =>
    invoke<void>("exchange_set_config", { config }),
  /** Legacy staged connect; new callers must use `connectWithConfig`. */
  connect: () => invoke<ExchangeConnectionSummary>("exchange_connect"),
  connectWithConfig: (config: ExchangeConnectionConfig) =>
    invoke<ExchangeConnectionSummary>("exchange_connect_with_config", {
      config,
    }),
  disconnect: () => invoke<void>("exchange_disconnect"),
  isConnected: () => invoke<boolean>("exchange_is_connected"),
  connectionSummary: () =>
    invoke<ExchangeConnectionSummary>("exchange_connection_summary"),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseExchangeConnection {
  summary: ExchangeConnectionSummary | null;
  isConnecting: boolean;
  error: string | null;
  isConnected: boolean;
  /** Atomically configure and connect; resolves true on success. */
  connect: (config: ExchangeConnectionConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

/**
 * Manages the single Exchange connection lifecycle for the panel shell. A hook
 * only observes and tears down the connection it established itself; a cold
 * panel must never adopt another session's process-global backend handle.
 */
export function useExchangeConnection(): UseExchangeConnection {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [summary, setSummary] = useState<ExchangeConnectionSummary | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownedConnectionRef = useRef(false);

  const disconnectOperation = useCallback(async (): Promise<void> => {
    if (!ownedConnectionRef.current) {
      setSummary(null);
      return;
    }
    await exchangeConnectionApi.disconnect();
    ownedConnectionRef.current = false;
    setSummary(null);
  }, []);

  const connect = useCallback(
    async (config: ExchangeConnectionConfig): Promise<boolean> => {
      try {
        await trackConnect(
          "exchange:global",
          async () => {
            setIsConnecting(true);
            setError(null);
            try {
              const next = await exchangeConnectionApi.connectWithConfig(
                withGlobalHttpProxy(config, "camel"),
              );
              if (!next.connected) {
                throw new Error(
                  "Exchange backend did not establish a connection",
                );
              }
              ownedConnectionRef.current = true;
              setSummary(next);
              return next;
            } catch (e) {
              const msg = typeof e === "string" ? e : (e as Error).message;
              setError(msg);
              setSummary(null);
              throw e;
            } finally {
              setIsConnecting(false);
            }
          },
          disconnectOperation,
        );
        return true;
      } catch {
        return false;
      }
    },
    [disconnectOperation, trackConnect],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!ownedConnectionRef.current) {
      setSummary(null);
      return;
    }
    try {
      await trackDisconnect("exchange:global", disconnectOperation);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, [disconnectOperation, trackDisconnect]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!ownedConnectionRef.current) {
      setSummary(null);
      return;
    }
    try {
      setSummary(await exchangeConnectionApi.connectionSummary());
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    summary,
    isConnecting,
    error,
    isConnected: summary !== null && summary.connected,
    connect,
    disconnect,
    refresh,
    clearError,
  };
}
