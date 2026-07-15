// useNetboxConnection — connection-lifecycle slice for the NetBox integration.
//
// Pairs 1:1 with the "Connection lifecycle" commands in
// `src-tauri/crates/sorng-netbox/src/commands.rs` (netbox_connect /
// netbox_disconnect / netbox_list_connections / netbox_ping). Argument names
// match the Rust `#[tauri::command]` signatures exactly so Tauri's arg mapping
// works without custom serializers.
//
// This is LEAD-owned (the shell's connect form drives it). Category tabs receive
// the resulting `connectionId` via props and MUST NOT re-implement connect.

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import type {
  NetboxConnectionConfig,
  NetboxConnectionSummary,
} from "../../../types/netbox";

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const netboxConnectionApi = {
  /** `netbox_connect(id, config) -> id`. The caller supplies the connection id. */
  connect: (id: string, config: NetboxConnectionConfig) =>
    invoke<string>("netbox_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("netbox_disconnect", { id }),
  listConnections: () => invoke<string[]>("netbox_list_connections"),
  ping: (id: string) => invoke<NetboxConnectionSummary>("netbox_ping", { id }),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseNetboxConnection {
  connectionId: string | null;
  summary: NetboxConnectionSummary | null;
  isConnecting: boolean;
  error: string | null;
  isConnected: boolean;
  connect: (id: string, config: NetboxConnectionConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

/**
 * Manages a single NetBox connection lifecycle for the panel shell: connect,
 * disconnect, and a ping-backed summary. On successful connect it fetches the
 * summary and exposes the live `connectionId` that category tabs consume.
 */
export function useNetboxConnection(): UseNetboxConnection {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<NetboxConnectionSummary | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (id: string, config: NetboxConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        await netboxConnectionApi.connect(
          id,
          withGlobalHttpProxy(config, "camel"),
        );
        setConnectionId(id);
        // Best-effort summary; a failed ping should not undo a live connection.
        try {
          setSummary(await netboxConnectionApi.ping(id));
        } catch {
          setSummary(null);
        }
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
    if (!connectionId) return;
    try {
      await netboxConnectionApi.disconnect(connectionId);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      setSummary(await netboxConnectionApi.ping(connectionId));
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionId,
    summary,
    isConnecting,
    error,
    isConnected: connectionId !== null,
    connect,
    disconnect,
    refresh,
    clearError,
  };
}
