// useExchangeConnection — connection-lifecycle slice for the Exchange integration.
//
// Pairs 1:1 with the "Connection" commands in
// `src-tauri/crates/sorng-exchange/src/commands.rs`
// (exchange_set_config / exchange_connect / exchange_disconnect /
// exchange_is_connected / exchange_connection_summary). Argument names match the
// Rust `#[tauri::command]` signatures exactly.
//
// ⚠️ Exchange is a SINGLETON service: `exchange_connect` takes NO id and returns
// the summary; the online-vs-on-prem credential variant is selected by the config
// passed to `exchange_set_config` (the `environment` field + which of
// `online`/`onPrem` is populated). Connecting is a two-step flow: set_config THEN
// connect. This is LEAD-owned (the shell's connect form drives it). Category tabs
// receive the resulting `summary` via props and MUST NOT re-implement connect.

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import type {
  ExchangeConnectionConfig,
  ExchangeConnectionSummary,
} from "../../../types/exchange";

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const exchangeConnectionApi = {
  /** `exchange_set_config(config)` — stage the connection config (creds variant). */
  setConfig: (config: ExchangeConnectionConfig) =>
    invoke<void>("exchange_set_config", { config }),
  /** `exchange_connect() -> summary` — connect using the staged config (no id). */
  connect: () => invoke<ExchangeConnectionSummary>("exchange_connect"),
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
  /** set_config(config) then connect(); resolves true on success. */
  connect: (config: ExchangeConnectionConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

/**
 * Manages the single Exchange connection lifecycle for the panel shell. Because
 * the backend is a singleton service, this hook also reconciles with an existing
 * live connection on mount (a panel reopened after connecting elsewhere).
 */
export function useExchangeConnection(): UseExchangeConnection {
  const [summary, setSummary] = useState<ExchangeConnectionSummary | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reconcile with a pre-existing live connection (singleton service).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await exchangeConnectionApi.isConnected()) {
          const s = await exchangeConnectionApi.connectionSummary();
          if (!cancelled && s.connected) setSummary(s);
        }
      } catch {
        /* not connected / backend unavailable — stay disconnected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(
    async (config: ExchangeConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        await exchangeConnectionApi.setConfig(
          withGlobalHttpProxy(config, "camel"),
        );
        const s = await exchangeConnectionApi.connect();
        setSummary(s);
        return true;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await exchangeConnectionApi.disconnect();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    } finally {
      setSummary(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
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
