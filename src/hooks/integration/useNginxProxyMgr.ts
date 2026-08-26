// useNginxProxyMgr — real Tauri `invoke(...)` wrappers for the
// sorng-nginx-proxy-mgr backend.
//
// Binds all 57 `npm_*` commands registered in the Tauri handler
// (`sorng-commands-webservers` / webservers_handler.rs): 51 pre-existing + the
// 6 added by t65 (`npm_refresh_token`, `npm_web_ui_url`,
// `npm_{enable,disable}_redirection_host`, `npm_{enable,disable}_stream`).
// Every command after connect is keyed by a connection `id` (the backend holds
// a map of live clients). Argument keys are camelCase — Tauri v2 maps them to
// the snake_case Rust `#[tauri::command]` params (`hostId` → `host_id`). The
// `config` / `request` objects are NOT renamed: they mirror the crate's
// snake_case serde wire shape exactly (see `src/types/nginxProxyMgr.ts`).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import { useIntegrationConnectionLifecycle } from "../integrations/IntegrationSessionLifecycle";
import type {
  ChangePasswordRequest,
  CreateAccessListRequest,
  CreateDeadHostRequest,
  CreateLetsEncryptCertRequest,
  CreateProxyHostRequest,
  CreateRedirectionHostRequest,
  CreateStreamRequest,
  CreateUserRequest,
  NpmAccessList,
  NpmAuditLogEntry,
  NpmCertificate,
  NpmConnectionConfig,
  NpmConnectionSummary,
  NpmDeadHost,
  NpmHealthStatus,
  NpmProxyHost,
  NpmRedirectionHost,
  NpmReports,
  NpmSetting,
  NpmStream,
  NpmUser,
  UpdateProxyHostRequest,
  UpdateUserRequest,
  UploadCustomCertRequest,
} from "../../types/nginxProxyMgr";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const npmApi = {
  // ── Connection ──────────────────────────────────────────────────
  connect: (id: string, config: NpmConnectionConfig) =>
    invoke<NpmConnectionSummary>("npm_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("npm_disconnect", { id }),
  listConnections: () => invoke<string[]>("npm_list_connections"),
  ping: (id: string) => invoke<NpmConnectionSummary>("npm_ping", { id }),
  refreshToken: (id: string) =>
    invoke<NpmConnectionSummary>("npm_refresh_token", { id }),
  webUiUrl: (id: string) => invoke<string>("npm_web_ui_url", { id }),

  // ── Proxy hosts ─────────────────────────────────────────────────
  listProxyHosts: (id: string) =>
    invoke<NpmProxyHost[]>("npm_list_proxy_hosts", { id }),
  getProxyHost: (id: string, hostId: number) =>
    invoke<NpmProxyHost>("npm_get_proxy_host", { id, hostId }),
  createProxyHost: (id: string, request: CreateProxyHostRequest) =>
    invoke<NpmProxyHost>("npm_create_proxy_host", { id, request }),
  updateProxyHost: (
    id: string,
    hostId: number,
    request: UpdateProxyHostRequest,
  ) => invoke<NpmProxyHost>("npm_update_proxy_host", { id, hostId, request }),
  deleteProxyHost: (id: string, hostId: number) =>
    invoke<void>("npm_delete_proxy_host", { id, hostId }),
  enableProxyHost: (id: string, hostId: number) =>
    invoke<void>("npm_enable_proxy_host", { id, hostId }),
  disableProxyHost: (id: string, hostId: number) =>
    invoke<void>("npm_disable_proxy_host", { id, hostId }),

  // ── Redirection hosts ───────────────────────────────────────────
  listRedirectionHosts: (id: string) =>
    invoke<NpmRedirectionHost[]>("npm_list_redirection_hosts", { id }),
  getRedirectionHost: (id: string, hostId: number) =>
    invoke<NpmRedirectionHost>("npm_get_redirection_host", { id, hostId }),
  createRedirectionHost: (id: string, request: CreateRedirectionHostRequest) =>
    invoke<NpmRedirectionHost>("npm_create_redirection_host", { id, request }),
  updateRedirectionHost: (
    id: string,
    hostId: number,
    request: CreateRedirectionHostRequest,
  ) =>
    invoke<NpmRedirectionHost>("npm_update_redirection_host", {
      id,
      hostId,
      request,
    }),
  deleteRedirectionHost: (id: string, hostId: number) =>
    invoke<void>("npm_delete_redirection_host", { id, hostId }),
  enableRedirectionHost: (id: string, hostId: number) =>
    invoke<void>("npm_enable_redirection_host", { id, hostId }),
  disableRedirectionHost: (id: string, hostId: number) =>
    invoke<void>("npm_disable_redirection_host", { id, hostId }),

  // ── Dead hosts ──────────────────────────────────────────────────
  listDeadHosts: (id: string) =>
    invoke<NpmDeadHost[]>("npm_list_dead_hosts", { id }),
  getDeadHost: (id: string, hostId: number) =>
    invoke<NpmDeadHost>("npm_get_dead_host", { id, hostId }),
  createDeadHost: (id: string, request: CreateDeadHostRequest) =>
    invoke<NpmDeadHost>("npm_create_dead_host", { id, request }),
  updateDeadHost: (
    id: string,
    hostId: number,
    request: CreateDeadHostRequest,
  ) => invoke<NpmDeadHost>("npm_update_dead_host", { id, hostId, request }),
  deleteDeadHost: (id: string, hostId: number) =>
    invoke<void>("npm_delete_dead_host", { id, hostId }),

  // ── Streams ─────────────────────────────────────────────────────
  listStreams: (id: string) => invoke<NpmStream[]>("npm_list_streams", { id }),
  getStream: (id: string, streamId: number) =>
    invoke<NpmStream>("npm_get_stream", { id, streamId }),
  createStream: (id: string, request: CreateStreamRequest) =>
    invoke<NpmStream>("npm_create_stream", { id, request }),
  updateStream: (id: string, streamId: number, request: CreateStreamRequest) =>
    invoke<NpmStream>("npm_update_stream", { id, streamId, request }),
  deleteStream: (id: string, streamId: number) =>
    invoke<void>("npm_delete_stream", { id, streamId }),
  enableStream: (id: string, streamId: number) =>
    invoke<void>("npm_enable_stream", { id, streamId }),
  disableStream: (id: string, streamId: number) =>
    invoke<void>("npm_disable_stream", { id, streamId }),

  // ── Certificates ────────────────────────────────────────────────
  listCertificates: (id: string) =>
    invoke<NpmCertificate[]>("npm_list_certificates", { id }),
  getCertificate: (id: string, certId: number) =>
    invoke<NpmCertificate>("npm_get_certificate", { id, certId }),
  createLetsEncryptCertificate: (
    id: string,
    request: CreateLetsEncryptCertRequest,
  ) =>
    invoke<NpmCertificate>("npm_create_letsencrypt_certificate", {
      id,
      request,
    }),
  uploadCustomCertificate: (id: string, request: UploadCustomCertRequest) =>
    invoke<NpmCertificate>("npm_upload_custom_certificate", { id, request }),
  deleteCertificate: (id: string, certId: number) =>
    invoke<void>("npm_delete_certificate", { id, certId }),
  renewCertificate: (id: string, certId: number) =>
    invoke<NpmCertificate>("npm_renew_certificate", { id, certId }),
  validateCertificate: (id: string, certId: number) =>
    invoke<unknown>("npm_validate_certificate", { id, certId }),

  // ── Users ───────────────────────────────────────────────────────
  listUsers: (id: string) => invoke<NpmUser[]>("npm_list_users", { id }),
  getUser: (id: string, userId: number) =>
    invoke<NpmUser>("npm_get_user", { id, userId }),
  createUser: (id: string, request: CreateUserRequest) =>
    invoke<NpmUser>("npm_create_user", { id, request }),
  updateUser: (id: string, userId: number, request: UpdateUserRequest) =>
    invoke<NpmUser>("npm_update_user", { id, userId, request }),
  deleteUser: (id: string, userId: number) =>
    invoke<void>("npm_delete_user", { id, userId }),
  changeUserPassword: (
    id: string,
    userId: number,
    request: ChangePasswordRequest,
  ) => invoke<void>("npm_change_user_password", { id, userId, request }),
  getMe: (id: string) => invoke<NpmUser>("npm_get_me", { id }),

  // ── Access lists ────────────────────────────────────────────────
  listAccessLists: (id: string) =>
    invoke<NpmAccessList[]>("npm_list_access_lists", { id }),
  getAccessList: (id: string, listId: number) =>
    invoke<NpmAccessList>("npm_get_access_list", { id, listId }),
  createAccessList: (id: string, request: CreateAccessListRequest) =>
    invoke<NpmAccessList>("npm_create_access_list", { id, request }),
  updateAccessList: (
    id: string,
    listId: number,
    request: CreateAccessListRequest,
  ) => invoke<NpmAccessList>("npm_update_access_list", { id, listId, request }),
  deleteAccessList: (id: string, listId: number) =>
    invoke<void>("npm_delete_access_list", { id, listId }),

  // ── Settings / reports / audit / health ─────────────────────────
  listSettings: (id: string) =>
    invoke<NpmSetting[]>("npm_list_settings", { id }),
  getSetting: (id: string, settingId: string) =>
    invoke<NpmSetting>("npm_get_setting", { id, settingId }),
  updateSetting: (id: string, settingId: string, value: unknown) =>
    invoke<NpmSetting>("npm_update_setting", { id, settingId, value }),
  getReports: (id: string) => invoke<NpmReports>("npm_get_reports", { id }),
  getAuditLog: (id: string) =>
    invoke<NpmAuditLogEntry[]>("npm_get_audit_log", { id }),
  getHealth: (id: string) => invoke<NpmHealthStatus>("npm_get_health", { id }),
};

export type NpmApi = typeof npmApi;

// ─── React hook ──────────────────────────────────────────────────────────────

export type NpmStatus = "disconnected" | "connecting" | "connected" | "error";

function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as { message?: unknown; kind?: unknown };
    if (typeof obj.message === "string") {
      return typeof obj.kind === "string"
        ? `${obj.kind}: ${obj.message}`
        : obj.message;
    }
  }
  return String(e);
}

/**
 * Stateful Nginx Proxy Manager session hook. Owns the connect/disconnect
 * lifecycle for a single connection `id`, caches the last fetched proxy hosts /
 * redirection hosts / streams / certificates, and exposes the full registered
 * command surface via `api`. The `run` wrapper funnels arbitrary ops through
 * the same busy/error handling. Token expiry / 401 re-login is handled
 * transparently in the backend; a surfaced `token_expired` error means that
 * re-login also failed and the panel should offer a reconnect.
 */
export function useNginxProxyMgr() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<NpmStatus>("disconnected");
  const [summary, setSummary] = useState<NpmConnectionSummary | null>(null);
  const [proxyHosts, setProxyHosts] = useState<NpmProxyHost[]>([]);
  const [redirectionHosts, setRedirectionHosts] = useState<
    NpmRedirectionHost[]
  >([]);
  const [streams, setStreams] = useState<NpmStream[]>([]);
  const [certificates, setCertificates] = useState<NpmCertificate[]>([]);
  const [webUiUrl, setWebUiUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against overlapping in-flight ops flipping busy incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setBusy(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setBusy(false);
    }
  }, []);

  const resetSession = useCallback(() => {
    setConnectionId(null);
    setSummary(null);
    setProxyHosts([]);
    setRedirectionHosts([]);
    setStreams([]);
    setCertificates([]);
    setWebUiUrl(null);
  }, []);

  const disconnectById = useCallback(
    async (id: string): Promise<void> => {
      try {
        await npmApi.disconnect(id);
      } catch (e) {
        setError(errMsg(e));
        throw e;
      } finally {
        resetSession();
        setStatus("disconnected");
      }
    },
    [resetSession],
  );

  const connect = useCallback(
    async (id: string, config: NpmConnectionConfig): Promise<boolean> => {
      let acknowledgementAvailable =
        config.acknowledge_invalid_cert_risk === true;
      const reconnectConfig = {
        ...config,
        acknowledge_invalid_cert_risk: false,
      };
      try {
        await trackConnect(
          `nginxProxyMgr:${id}`,
          async () => {
            setStatus("connecting");
            setError(null);
            try {
              const attemptConfig = {
                ...reconnectConfig,
                acknowledge_invalid_cert_risk: acknowledgementAvailable,
              };
              acknowledgementAvailable = false;
              const result = await npmApi.connect(
                id,
                withGlobalHttpProxy(attemptConfig, "snake"),
              );
              setConnectionId(id);
              setSummary(result);
              setStatus("connected");
              // Best effort: the web-UI URL is derived server-side from the
              // normalised api_url; a failure here must not fail connect.
              try {
                setWebUiUrl(await npmApi.webUiUrl(id));
              } catch {
                setWebUiUrl(null);
              }
              return result;
            } catch (e) {
              resetSession();
              setStatus("error");
              setError(errMsg(e));
              throw e;
            }
          },
          () => disconnectById(id),
        );
        return true;
      } catch {
        return false;
      }
    },
    [disconnectById, resetSession, trackConnect],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await trackDisconnect(`nginxProxyMgr:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // disconnectById already synchronizes the local error and state.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const requireId = useCallback((): string => {
    if (!connectionId)
      throw new Error("not_connected: Nginx Proxy Manager not connected");
    return connectionId;
  }, [connectionId]);

  // ── Session ─────────────────────────────────────────────────────

  const refreshSummary = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.ping(id));
    setSummary(result);
    return result;
  }, [requireId, run]);

  const refreshToken = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.refreshToken(id));
    setSummary(result);
    return result;
  }, [requireId, run]);

  // ── Proxy hosts ─────────────────────────────────────────────────

  const loadProxyHosts = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.listProxyHosts(id));
    setProxyHosts(result);
    return result;
  }, [requireId, run]);

  const toggleProxyHost = useCallback(
    async (hostId: number, enabled: boolean) => {
      const id = requireId();
      await run(() =>
        enabled
          ? npmApi.enableProxyHost(id, hostId)
          : npmApi.disableProxyHost(id, hostId),
      );
      setProxyHosts((prev) =>
        prev.map((h) => (h.id === hostId ? { ...h, enabled } : h)),
      );
    },
    [requireId, run],
  );

  // ── Redirection hosts ───────────────────────────────────────────

  const loadRedirectionHosts = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.listRedirectionHosts(id));
    setRedirectionHosts(result);
    return result;
  }, [requireId, run]);

  const toggleRedirectionHost = useCallback(
    async (hostId: number, enabled: boolean) => {
      const id = requireId();
      await run(() =>
        enabled
          ? npmApi.enableRedirectionHost(id, hostId)
          : npmApi.disableRedirectionHost(id, hostId),
      );
      setRedirectionHosts((prev) =>
        prev.map((h) => (h.id === hostId ? { ...h, enabled } : h)),
      );
    },
    [requireId, run],
  );

  // ── Streams ─────────────────────────────────────────────────────

  const loadStreams = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.listStreams(id));
    setStreams(result);
    return result;
  }, [requireId, run]);

  const toggleStream = useCallback(
    async (streamId: number, enabled: boolean) => {
      const id = requireId();
      await run(() =>
        enabled
          ? npmApi.enableStream(id, streamId)
          : npmApi.disableStream(id, streamId),
      );
      setStreams((prev) =>
        prev.map((s) => (s.id === streamId ? { ...s, enabled } : s)),
      );
    },
    [requireId, run],
  );

  // ── Certificates ────────────────────────────────────────────────

  const loadCertificates = useCallback(async () => {
    const id = requireId();
    const result = await run(() => npmApi.listCertificates(id));
    setCertificates(result);
    return result;
  }, [requireId, run]);

  const renewCertificate = useCallback(
    async (certId: number) => {
      const id = requireId();
      const renewed = await run(() => npmApi.renewCertificate(id, certId));
      if (renewed && typeof renewed === "object" && "id" in renewed) {
        setCertificates((prev) =>
          prev.map((c) => (c.id === certId ? { ...c, ...renewed } : c)),
        );
      }
      return renewed;
    },
    [requireId, run],
  );

  // ── Aggregate ───────────────────────────────────────────────────

  /** Fetches all four cached collections in parallel (single busy window). */
  const refreshAll = useCallback(async () => {
    const id = requireId();
    const [ph, rh, st, ce] = await run(() =>
      Promise.all([
        npmApi.listProxyHosts(id),
        npmApi.listRedirectionHosts(id),
        npmApi.listStreams(id),
        npmApi.listCertificates(id),
      ]),
    );
    setProxyHosts(ph);
    setRedirectionHosts(rh);
    setStreams(st);
    setCertificates(ce);
    return {
      proxyHosts: ph,
      redirectionHosts: rh,
      streams: st,
      certificates: ce,
    };
  }, [requireId, run]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    status,
    summary,
    proxyHosts,
    redirectionHosts,
    streams,
    certificates,
    webUiUrl,
    error,
    busy,
    isConnected: status === "connected" && connectionId !== null,
    isConnecting: status === "connecting",
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    // session
    refreshSummary,
    refreshToken,
    // data ops (state-caching)
    refreshAll,
    loadProxyHosts,
    toggleProxyHost,
    loadRedirectionHosts,
    toggleRedirectionHost,
    loadStreams,
    toggleStream,
    loadCertificates,
    renewCertificate,
    // full registered command surface + shared runner
    api: npmApi,
    run,
  };
}

export type NginxProxyMgrManager = ReturnType<typeof useNginxProxyMgr>;
