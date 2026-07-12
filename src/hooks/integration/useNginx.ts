// useNginx — real Tauri `invoke(...)` wrappers for the sorng-nginx backend.
//
// Binds all 38 nginx commands registered from `sorng-nginx/src/commands.rs`
// (connect prefix `ngx_*`) through `nginxApi`, plus a stateful `useNginx()` hook
// owning the connect/disconnect lifecycle for a single connection `id`.
//
// Every command is keyed by a connection `id` (the backend holds a map of live
// clients). Command ARG names are camelCase — Tauri v2 maps them to the Rust
// snake_case `#[tauri::command]` params (e.g. `siteName` → `site_name`,
// `certDir` → `cert_dir`, `logDir` → `log_dir`). The `config` / `request` /
// `query` / `ssl` objects mirror their structs' serde wire shape, which has NO
// rename → snake_case (`ssh_user`, `config_path`, `server_names`, ...).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AccessLogEntry,
  ConfigTestResult,
  CreateSiteRequest,
  CreateSnippetRequest,
  CreateUpstreamRequest,
  ErrorLogEntry,
  LogQuery,
  NginxConnectionConfig,
  NginxConnectionSummary,
  NginxHealthCheck,
  NginxInfo,
  NginxMainConfig,
  NginxProcess,
  NginxSite,
  NginxSnippet,
  NginxStubStatus,
  NginxUpstream,
  SslConfig,
  UpdateSiteRequest,
  UpdateUpstreamRequest,
} from "../../types/nginx";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const nginxApi = {
  // Connection lifecycle
  connect: (id: string, config: NginxConnectionConfig) =>
    invoke<NginxConnectionSummary>("ngx_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("ngx_disconnect", { id }),
  listConnections: () => invoke<string[]>("ngx_list_connections"),

  // Sites (server blocks)
  listSites: (id: string) => invoke<NginxSite[]>("ngx_list_sites", { id }),
  getSite: (id: string, name: string) =>
    invoke<NginxSite>("ngx_get_site", { id, name }),
  createSite: (id: string, request: CreateSiteRequest) =>
    invoke<NginxSite>("ngx_create_site", { id, request }),
  updateSite: (id: string, name: string, request: UpdateSiteRequest) =>
    invoke<NginxSite>("ngx_update_site", { id, name, request }),
  deleteSite: (id: string, name: string) =>
    invoke<void>("ngx_delete_site", { id, name }),
  enableSite: (id: string, name: string) =>
    invoke<void>("ngx_enable_site", { id, name }),
  disableSite: (id: string, name: string) =>
    invoke<void>("ngx_disable_site", { id, name }),

  // Upstreams
  listUpstreams: (id: string) =>
    invoke<NginxUpstream[]>("ngx_list_upstreams", { id }),
  getUpstream: (id: string, name: string) =>
    invoke<NginxUpstream>("ngx_get_upstream", { id, name }),
  createUpstream: (id: string, request: CreateUpstreamRequest) =>
    invoke<NginxUpstream>("ngx_create_upstream", { id, request }),
  updateUpstream: (id: string, name: string, request: UpdateUpstreamRequest) =>
    invoke<NginxUpstream>("ngx_update_upstream", { id, name, request }),
  deleteUpstream: (id: string, name: string) =>
    invoke<void>("ngx_delete_upstream", { id, name }),

  // SSL
  getSslConfig: (id: string, siteName: string) =>
    invoke<SslConfig | null>("ngx_get_ssl_config", { id, siteName }),
  updateSslConfig: (id: string, siteName: string, ssl: SslConfig) =>
    invoke<void>("ngx_update_ssl_config", { id, siteName, ssl }),
  listSslCertificates: (id: string, certDir: string) =>
    invoke<string[]>("ngx_list_ssl_certificates", { id, certDir }),

  // Status / monitoring
  stubStatus: (id: string) =>
    invoke<NginxStubStatus>("ngx_stub_status", { id }),
  processStatus: (id: string) =>
    invoke<NginxProcess>("ngx_process_status", { id }),
  healthCheck: (id: string) =>
    invoke<NginxHealthCheck>("ngx_health_check", { id }),

  // Logs
  queryAccessLog: (id: string, query: LogQuery) =>
    invoke<AccessLogEntry[]>("ngx_query_access_log", { id, query }),
  queryErrorLog: (id: string, query: LogQuery) =>
    invoke<ErrorLogEntry[]>("ngx_query_error_log", { id, query }),
  listLogFiles: (id: string, logDir?: string) =>
    invoke<string[]>("ngx_list_log_files", { id, logDir }),

  // Config
  getMainConfig: (id: string) =>
    invoke<NginxMainConfig>("ngx_get_main_config", { id }),
  updateMainConfig: (id: string, content: string) =>
    invoke<void>("ngx_update_main_config", { id, content }),
  testConfig: (id: string) =>
    invoke<ConfigTestResult>("ngx_test_config", { id }),

  // Snippets / includes
  listSnippets: (id: string) =>
    invoke<NginxSnippet[]>("ngx_list_snippets", { id }),
  getSnippet: (id: string, name: string) =>
    invoke<NginxSnippet>("ngx_get_snippet", { id, name }),
  createSnippet: (id: string, request: CreateSnippetRequest) =>
    invoke<NginxSnippet>("ngx_create_snippet", { id, request }),
  updateSnippet: (id: string, name: string, content: string) =>
    invoke<NginxSnippet>("ngx_update_snippet", { id, name, content }),
  deleteSnippet: (id: string, name: string) =>
    invoke<void>("ngx_delete_snippet", { id, name }),

  // Process control
  start: (id: string) => invoke<void>("ngx_start", { id }),
  stop: (id: string) => invoke<void>("ngx_stop", { id }),
  restart: (id: string) => invoke<void>("ngx_restart", { id }),
  reload: (id: string) => invoke<void>("ngx_reload", { id }),
  version: (id: string) => invoke<string>("ngx_version", { id }),
  info: (id: string) => invoke<NginxInfo>("ngx_info", { id }),
};

export type NginxApi = typeof nginxApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Nginx session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useNginx() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<NginxConnectionSummary | null>(null);
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
    async (id: string, config: NginxConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await nginxApi.connect(id, config);
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
      await nginxApi.disconnect(connectionId);
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
    api: nginxApi,
    run,
  };
}

export type NginxManager = ReturnType<typeof useNginx>;
