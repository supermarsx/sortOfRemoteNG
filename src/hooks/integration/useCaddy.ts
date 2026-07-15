// useCaddy — real Tauri `invoke(...)` wrappers for the sorng-caddy backend.
//
// Binds all 34 `caddy_*` commands registered in `sorng-caddy/src/commands.rs`.
// Every command (except `caddy_list_connections`) is keyed by a connection `id`
// — the backend holds a map of live admin-API clients. Command arg names are
// camelCase; Tauri v2 maps them to the Rust snake_case `#[tauri::command]`
// params. The `config` object mirrors `CaddyConnectionConfig`'s serde wire
// shape, which has NO container rename → snake_case (`admin_url`, `api_key`,
// `tls_skip_verify`, `timeout_secs`).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  CaddyCertificate,
  CaddyConfig,
  CaddyConnectionConfig,
  CaddyConnectionSummary,
  CaddyfileAdaptResult,
  CaddyRoute,
  CaddyServer,
  CreateFileServerRequest,
  CreateRedirectRequest,
  CreateReverseProxyRequest,
  TlsApp,
  TlsAutomation,
} from "../../types/caddy";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const caddyApi = {
  // Connection lifecycle
  connect: (id: string, config: CaddyConnectionConfig) =>
    invoke<CaddyConnectionSummary>("caddy_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("caddy_disconnect", { id }),
  listConnections: () => invoke<string[]>("caddy_list_connections"),
  ping: (id: string) => invoke<CaddyConnectionSummary>("caddy_ping", { id }),

  // Config
  getFullConfig: (id: string) =>
    invoke<CaddyConfig>("caddy_get_full_config", { id }),
  getRawConfig: (id: string) => invoke<unknown>("caddy_get_raw_config", { id }),
  getConfigPath: (id: string, path: string) =>
    invoke<unknown>("caddy_get_config_path", { id, path }),
  setConfigPath: (id: string, path: string, value: unknown) =>
    invoke<void>("caddy_set_config_path", { id, path, value }),
  patchConfigPath: (id: string, path: string, value: unknown) =>
    invoke<void>("caddy_patch_config_path", { id, path, value }),
  deleteConfigPath: (id: string, path: string) =>
    invoke<void>("caddy_delete_config_path", { id, path }),
  loadConfig: (id: string, config: unknown) =>
    invoke<void>("caddy_load_config", { id, config }),
  adaptCaddyfile: (id: string, caddyfile: string) =>
    invoke<CaddyfileAdaptResult>("caddy_adapt_caddyfile", { id, caddyfile }),
  stopServer: (id: string) => invoke<void>("caddy_stop_server", { id }),

  // Servers
  listServers: (id: string) =>
    invoke<Record<string, CaddyServer>>("caddy_list_servers", { id }),
  getServer: (id: string, name: string) =>
    invoke<CaddyServer>("caddy_get_server", { id, name }),
  setServer: (id: string, name: string, server: CaddyServer) =>
    invoke<void>("caddy_set_server", { id, name, server }),
  deleteServer: (id: string, name: string) =>
    invoke<void>("caddy_delete_server", { id, name }),

  // Routes
  listRoutes: (id: string, server: string) =>
    invoke<CaddyRoute[]>("caddy_list_routes", { id, server }),
  getRoute: (id: string, server: string, index: number) =>
    invoke<CaddyRoute>("caddy_get_route", { id, server, index }),
  addRoute: (id: string, server: string, route: CaddyRoute) =>
    invoke<void>("caddy_add_route", { id, server, route }),
  setRoute: (id: string, server: string, index: number, route: CaddyRoute) =>
    invoke<void>("caddy_set_route", { id, server, index, route }),
  deleteRoute: (id: string, server: string, index: number) =>
    invoke<void>("caddy_delete_route", { id, server, index }),
  setAllRoutes: (id: string, server: string, routes: CaddyRoute[]) =>
    invoke<void>("caddy_set_all_routes", { id, server, routes }),

  // TLS
  getTlsApp: (id: string) => invoke<TlsApp>("caddy_get_tls_app", { id }),
  setTlsApp: (id: string, tls: TlsApp) =>
    invoke<void>("caddy_set_tls_app", { id, tls }),
  listAutomateDomains: (id: string) =>
    invoke<string[]>("caddy_list_automate_domains", { id }),
  setAutomateDomains: (id: string, domains: string[]) =>
    invoke<void>("caddy_set_automate_domains", { id, domains }),
  getTlsAutomation: (id: string) =>
    invoke<TlsAutomation>("caddy_get_tls_automation", { id }),
  setTlsAutomation: (id: string, automation: TlsAutomation) =>
    invoke<void>("caddy_set_tls_automation", { id, automation }),
  listTlsCertificates: (id: string) =>
    invoke<CaddyCertificate[]>("caddy_list_tls_certificates", { id }),

  // Reverse Proxy convenience
  createReverseProxy: (
    id: string,
    server: string,
    request: CreateReverseProxyRequest,
  ) => invoke<void>("caddy_create_reverse_proxy", { id, server, request }),
  getUpstreams: (id: string) =>
    invoke<unknown[]>("caddy_get_upstreams", { id }),
  createFileServer: (
    id: string,
    server: string,
    request: CreateFileServerRequest,
  ) => invoke<void>("caddy_create_file_server", { id, server, request }),
  createRedirect: (
    id: string,
    server: string,
    request: CreateRedirectRequest,
  ) => invoke<void>("caddy_create_redirect", { id, server, request }),
};

export type CaddyApi = typeof caddyApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Caddy session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useCaddy() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CaddyConnectionSummary | null>(null);
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
    async (id: string, config: CaddyConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await caddyApi.connect(id, withGlobalHttpProxy(config));
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
      await caddyApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
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
    // full registered command surface + shared runner
    api: caddyApi,
    run,
  };
}

export type CaddyManager = ReturnType<typeof useCaddy>;
