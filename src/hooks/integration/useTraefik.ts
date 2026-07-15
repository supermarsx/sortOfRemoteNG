// useTraefik — real Tauri `invoke(...)` wrappers for the sorng-traefik backend.
//
// Binds all 27 Traefik commands registered in
// `sorng-commands-webservers/src/webservers_handler.rs` (both the is_command
// match arm and the generate_handler! list). Argument names match the Rust
// `#[tauri::command]` params exactly (`id`, `name`, `config`); the `config`
// object mirrors `TraefikConnectionConfig`'s snake_case wire shape.
//
// Every command is keyed by a connection `id` — the backend holds a map of live
// clients. `useTraefik()` owns the connect/disconnect lifecycle plus shared
// isLoading/error state, and exposes the full command surface via `api`.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  TraefikConnectionConfig,
  TraefikConnectionSummary,
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikOverview,
  TraefikRawConfig,
  TraefikRouter,
  TraefikService,
  TraefikTcpMiddleware,
  TraefikTcpRouter,
  TraefikTcpService,
  TraefikTlsCertificate,
  TraefikUdpRouter,
  TraefikUdpService,
  TraefikVersion,
} from "../../types/traefik";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const traefikApi = {
  // Connection lifecycle
  connect: (id: string, config: TraefikConnectionConfig) =>
    invoke<TraefikConnectionSummary>("traefik_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("traefik_disconnect", { id }),
  listConnections: () => invoke<string[]>("traefik_list_connections"),
  ping: (id: string) =>
    invoke<TraefikConnectionSummary>("traefik_ping", { id }),

  // Routers
  listHttpRouters: (id: string) =>
    invoke<TraefikRouter[]>("traefik_list_http_routers", { id }),
  getHttpRouter: (id: string, name: string) =>
    invoke<TraefikRouter>("traefik_get_http_router", { id, name }),
  listTcpRouters: (id: string) =>
    invoke<TraefikTcpRouter[]>("traefik_list_tcp_routers", { id }),
  getTcpRouter: (id: string, name: string) =>
    invoke<TraefikTcpRouter>("traefik_get_tcp_router", { id, name }),
  listUdpRouters: (id: string) =>
    invoke<TraefikUdpRouter[]>("traefik_list_udp_routers", { id }),
  getUdpRouter: (id: string, name: string) =>
    invoke<TraefikUdpRouter>("traefik_get_udp_router", { id, name }),

  // Services
  listHttpServices: (id: string) =>
    invoke<TraefikService[]>("traefik_list_http_services", { id }),
  getHttpService: (id: string, name: string) =>
    invoke<TraefikService>("traefik_get_http_service", { id, name }),
  listTcpServices: (id: string) =>
    invoke<TraefikTcpService[]>("traefik_list_tcp_services", { id }),
  getTcpService: (id: string, name: string) =>
    invoke<TraefikTcpService>("traefik_get_tcp_service", { id, name }),
  listUdpServices: (id: string) =>
    invoke<TraefikUdpService[]>("traefik_list_udp_services", { id }),
  getUdpService: (id: string, name: string) =>
    invoke<TraefikUdpService>("traefik_get_udp_service", { id, name }),

  // Middlewares
  listHttpMiddlewares: (id: string) =>
    invoke<TraefikMiddleware[]>("traefik_list_http_middlewares", { id }),
  getHttpMiddleware: (id: string, name: string) =>
    invoke<TraefikMiddleware>("traefik_get_http_middleware", { id, name }),
  listTcpMiddlewares: (id: string) =>
    invoke<TraefikTcpMiddleware[]>("traefik_list_tcp_middlewares", { id }),
  getTcpMiddleware: (id: string, name: string) =>
    invoke<TraefikTcpMiddleware>("traefik_get_tcp_middleware", { id, name }),

  // Entrypoints
  listEntrypoints: (id: string) =>
    invoke<TraefikEntryPoint[]>("traefik_list_entrypoints", { id }),
  getEntrypoint: (id: string, name: string) =>
    invoke<TraefikEntryPoint>("traefik_get_entrypoint", { id, name }),

  // TLS
  listTlsCertificates: (id: string) =>
    invoke<TraefikTlsCertificate[]>("traefik_list_tls_certificates", { id }),
  getTlsCertificate: (id: string, name: string) =>
    invoke<TraefikTlsCertificate>("traefik_get_tls_certificate", { id, name }),

  // Overview / health / config
  getOverview: (id: string) =>
    invoke<TraefikOverview>("traefik_get_overview", { id }),
  getVersion: (id: string) =>
    invoke<TraefikVersion>("traefik_get_version", { id }),
  getRawConfig: (id: string) =>
    invoke<TraefikRawConfig>("traefik_get_raw_config", { id }),
};

export type TraefikApi = typeof traefikApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Traefik session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useTraefik() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<TraefikConnectionSummary | null>(null);
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
    async (id: string, config: TraefikConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await traefikApi.connect(id, withGlobalHttpProxy(config));
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
      await traefikApi.disconnect(connectionId);
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
    api: traefikApi,
    run,
  };
}

export type TraefikManager = ReturnType<typeof useTraefik>;
