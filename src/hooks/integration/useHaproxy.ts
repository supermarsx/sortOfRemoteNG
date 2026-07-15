// useHaproxy — real Tauri `invoke(...)` wrappers for the sorng-haproxy backend.
//
// Pairs 1:1 with src-tauri/crates/sorng-haproxy/src/commands.rs (40 commands).
//
// Every stateful command is keyed by a connection `id` (the backend holds a map
// of live clients). Command arg names are camelCase — Tauri v2 maps them to the
// snake_case Rust `#[tauri::command]` params (e.g. `aclId` → `acl_id`,
// `mapId` → `map_id`). The `config` object mirrors `HaproxyConnectionConfig`'s
// serde wire shape, which has NO rename → snake_case (`ssh_user`, `stats_socket`,
// `dataplane_url`, ...); pass it as-is.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  AclEntry,
  ConfigValidationResult,
  HaproxyAcl,
  HaproxyBackend,
  HaproxyConnectionConfig,
  HaproxyConnectionSummary,
  HaproxyFrontend,
  HaproxyInfo,
  HaproxyMap,
  HaproxyServer,
  MapEntry,
  ServerAction,
  SessionEntry,
  StickTable,
  StickTableEntry,
} from "../../types/haproxy";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const haproxyApi = {
  // Connection lifecycle
  connect: (id: string, config: HaproxyConnectionConfig) =>
    invoke<HaproxyConnectionSummary>("haproxy_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("haproxy_disconnect", { id }),
  listConnections: () => invoke<string[]>("haproxy_list_connections"),
  ping: (id: string) =>
    invoke<HaproxyConnectionSummary>("haproxy_ping", { id }),

  // Stats / info
  getInfo: (id: string) => invoke<HaproxyInfo>("haproxy_get_info", { id }),
  getCsv: (id: string) => invoke<string>("haproxy_get_csv", { id }),
  version: (id: string) => invoke<string>("haproxy_version", { id }),

  // Frontends
  listFrontends: (id: string) =>
    invoke<HaproxyFrontend[]>("haproxy_list_frontends", { id }),
  getFrontend: (id: string, name: string) =>
    invoke<HaproxyFrontend>("haproxy_get_frontend", { id, name }),

  // Backends
  listBackends: (id: string) =>
    invoke<HaproxyBackend[]>("haproxy_list_backends", { id }),
  getBackend: (id: string, name: string) =>
    invoke<HaproxyBackend>("haproxy_get_backend", { id, name }),
  showBackendList: (id: string) =>
    invoke<string[]>("haproxy_show_backend_list", { id }),

  // Servers
  listServers: (id: string, backend: string) =>
    invoke<HaproxyServer[]>("haproxy_list_servers", { id, backend }),
  getServer: (id: string, backend: string, server: string) =>
    invoke<HaproxyServer>("haproxy_get_server", { id, backend, server }),
  setServerState: (
    id: string,
    backend: string,
    server: string,
    action: ServerAction,
  ) =>
    invoke<string>("haproxy_set_server_state", {
      id,
      backend,
      server,
      action,
    }),

  // ACLs
  listAcls: (id: string) => invoke<HaproxyAcl[]>("haproxy_list_acls", { id }),
  getAcl: (id: string, aclId: string) =>
    invoke<AclEntry[]>("haproxy_get_acl", { id, aclId }),
  addAclEntry: (id: string, aclId: string, value: string) =>
    invoke<string>("haproxy_add_acl_entry", { id, aclId, value }),
  delAclEntry: (id: string, aclId: string, value: string) =>
    invoke<string>("haproxy_del_acl_entry", { id, aclId, value }),
  clearAcl: (id: string, aclId: string) =>
    invoke<string>("haproxy_clear_acl", { id, aclId }),

  // Maps
  listMaps: (id: string) => invoke<HaproxyMap[]>("haproxy_list_maps", { id }),
  getMap: (id: string, mapId: string) =>
    invoke<MapEntry[]>("haproxy_get_map", { id, mapId }),
  addMapEntry: (id: string, mapId: string, key: string, value: string) =>
    invoke<string>("haproxy_add_map_entry", { id, mapId, key, value }),
  delMapEntry: (id: string, mapId: string, key: string) =>
    invoke<string>("haproxy_del_map_entry", { id, mapId, key }),
  setMapEntry: (id: string, mapId: string, key: string, value: string) =>
    invoke<string>("haproxy_set_map_entry", { id, mapId, key, value }),
  clearMap: (id: string, mapId: string) =>
    invoke<string>("haproxy_clear_map", { id, mapId }),

  // Stick tables
  listStickTables: (id: string) =>
    invoke<StickTable[]>("haproxy_list_stick_tables", { id }),
  getStickTable: (id: string, name: string) =>
    invoke<StickTableEntry[]>("haproxy_get_stick_table", { id, name }),
  clearStickTable: (id: string, name: string) =>
    invoke<string>("haproxy_clear_stick_table", { id, name }),
  setStickTableEntry: (id: string, name: string, key: string, data: string) =>
    invoke<string>("haproxy_set_stick_table_entry", { id, name, key, data }),

  // Runtime
  runtimeExecute: (id: string, command: string) =>
    invoke<string>("haproxy_runtime_execute", { id, command }),
  showServersState: (id: string) =>
    invoke<string>("haproxy_show_servers_state", { id }),
  showSessions: (id: string) =>
    invoke<SessionEntry[]>("haproxy_show_sessions", { id }),

  // Config / process control
  getRawConfig: (id: string) =>
    invoke<string>("haproxy_get_raw_config", { id }),
  updateRawConfig: (id: string, content: string) =>
    invoke<void>("haproxy_update_raw_config", { id, content }),
  validateConfig: (id: string) =>
    invoke<ConfigValidationResult>("haproxy_validate_config", { id }),
  reload: (id: string) => invoke<void>("haproxy_reload", { id }),
  start: (id: string) => invoke<void>("haproxy_start", { id }),
  stop: (id: string) => invoke<void>("haproxy_stop", { id }),
  restart: (id: string) => invoke<void>("haproxy_restart", { id }),
};

export type HaproxyApi = typeof haproxyApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful HAProxy session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * 40-command surface via `api` (each call takes the connection id). The `run`
 * wrapper funnels arbitrary ops through the same loading/error handling
 * (matching useGrafana).
 */
export function useHaproxy() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<HaproxyConnectionSummary | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: HaproxyConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await haproxyApi.connect(id, withGlobalHttpProxy(config));
        setConnectionId(id);
        setSummary(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
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
      await haproxyApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  /** Re-ping the live connection to refresh the summary header. */
  const refreshSummary = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      setSummary(await haproxyApi.ping(connectionId));
    } catch {
      // Non-fatal — the connection is live even if the info echo fails.
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    refreshSummary,
    // full command surface + shared runner
    api: haproxyApi,
    run,
  };
}

export type HaproxyManager = ReturnType<typeof useHaproxy>;
