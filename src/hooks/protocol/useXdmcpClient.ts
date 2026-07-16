import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  XdmcpConfig,
  XdmcpDiscoveredHost,
  XdmcpSavedConnectionOptions,
  XdmcpSessionInfo,
  XdmcpSessionStats,
} from "../../types/protocols/xdmcp";
import { formatErrorForDisplay } from "../../utils/errors/formatError";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type XdmcpClientStatus =
  | "launching"
  | "x-server-running"
  | "stopped"
  | "error";

type SavedXdmcpConnection = Connection & XdmcpSavedConnectionOptions;

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value as number)))
    : fallback;

export const defaultXdmcpServerType = () =>
  typeof navigator !== "undefined" &&
  /windows|win32|win64/i.test(
    `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`,
  )
    ? ("VcXsrv" as const)
    : ("Xephyr" as const);

export const buildXdmcpConfig = (
  connection: Connection,
  session: ConnectionSession,
): XdmcpConfig => {
  const saved = connection as SavedXdmcpConnection;
  const host = (saved.hostname || session.hostname).trim();
  if (!host) throw new Error("An XDMCP display-manager host is required.");
  return {
    host,
    port: boundedInteger(saved.port, 177, 1, 65_535),
    label: saved.name || null,
    acknowledge_insecure_transport:
      saved.xdmcpAcknowledgeInsecureTransport ?? false,
    query_type: saved.xdmcpQueryType ?? "Direct",
    broadcast_address: null,
    auth_type: "None",
    auth_data: null,
    display_number:
      saved.xdmcpDisplayNumber === undefined
        ? null
        : boundedInteger(saved.xdmcpDisplayNumber, 10, 0, 65_535),
    resolution_width: boundedInteger(
      saved.xdmcpResolutionWidth,
      1024,
      320,
      16_384,
    ),
    resolution_height: boundedInteger(
      saved.xdmcpResolutionHeight,
      768,
      200,
      16_384,
    ),
    color_depth: saved.xdmcpColorDepth ?? 24,
    fullscreen: saved.xdmcpFullscreen ?? false,
    x_server_type: saved.xdmcpXServerType ?? defaultXdmcpServerType(),
    x_server_path: saved.xdmcpXServerPath?.trim() || null,
    x_server_extra_args: null,
    connect_timeout: 30,
    keepalive_interval: 60,
    retry_count: 3,
  };
};

export const getUnsupportedXdmcpRouteReason = (
  connection: Readonly<Connection>,
): string | null => {
  const hasInlineRoute =
    connection.security?.proxy?.enabled === true ||
    connection.security?.openvpn?.enabled === true ||
    connection.security?.sshTunnel?.enabled === true ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled !== false);
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    hasInlineRoute
  ) {
    return "The native XDMCP X server cannot consume an application proxy, VPN, SSH tunnel, or connection chain. Remove the configured route; XDMCP must otherwise be protected by a trusted isolated network.";
  }
  return null;
};

export const xdmcpApi = {
  connect: (sessionId: string, config: XdmcpConfig) =>
    invoke<void>("connect_xdmcp", { sessionId, config }),
  disconnect: (sessionId: string) =>
    invoke<void>("disconnect_xdmcp", { sessionId }),
  isXServerRunning: (sessionId: string) =>
    invoke<boolean>("is_xdmcp_connected", { sessionId }),
  getSessionInfo: (sessionId: string) =>
    invoke<XdmcpSessionInfo>("get_xdmcp_session_info", { sessionId }),
  getStats: (sessionId: string) =>
    invoke<XdmcpSessionStats>("get_xdmcp_session_stats", { sessionId }),
  discover: (broadcastAddress?: string, timeoutMs = 3000) =>
    invoke<XdmcpDiscoveredHost[]>("discover_xdmcp", {
      broadcastAddress: broadcastAddress ?? null,
      timeoutMs,
    }),
};

export const xdmcpErrorMessage = (cause: unknown): string =>
  formatErrorForDisplay(cause);

/**
 * Owns a real external X server process. “x-server-running” never implies that
 * the display manager authenticated a user or produced a usable login screen.
 */
export function useXdmcpClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const [status, setStatus] = useState<XdmcpClientStatus>("launching");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<XdmcpSessionInfo | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const generationRef = useRef(0);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const markError = useCallback(
    (cause: unknown) => {
      const message = xdmcpErrorMessage(cause);
      setStatus("error");
      setError(message);
      updateSession({ status: "error", errorMessage: message });
    },
    [updateSession],
  );

  const markRunning = useCallback(
    (id: string, info: XdmcpSessionInfo) => {
      backendRef.current = id;
      setBackendSessionId(id);
      setSessionInfo(info);
      setStatus("x-server-running");
      setError(null);
      updateSession({
        backendSessionId: id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const initialize = useCallback(
    async (generation: number) => {
      const currentConnection = connectionRef.current;
      const currentSession = sessionRef.current;
      if (!currentConnection) {
        markError(
          "The saved or Quick Connect XDMCP connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedXdmcpRouteReason(currentConnection);
      if (routeError) {
        markError(routeError);
        return;
      }
      setStatus("launching");
      setError(null);
      let newlyLaunchedId: string | null = null;

      try {
        let id =
          currentSession.backendSessionId ?? `${currentSession.id}-xdmcp`;
        let running = currentSession.backendSessionId
          ? await xdmcpApi.isXServerRunning(id).catch(() => false)
          : false;
        if (generationRef.current !== generation) return;
        if (!running) {
          await xdmcpApi.disconnect(id).catch(() => undefined);
          id = `${currentSession.id}-xdmcp`;
          await xdmcpApi.connect(
            id,
            buildXdmcpConfig(currentConnection, currentSession),
          );
          newlyLaunchedId = id;
          running = true;
        }
        if (generationRef.current !== generation) {
          await xdmcpApi.disconnect(id).catch(() => undefined);
          return;
        }
        const info = await xdmcpApi.getSessionInfo(id);
        if (!running || info.state !== "Running" || !info.x_server_pid) {
          throw new Error(
            "The local X server process stopped during XDMCP startup.",
          );
        }
        markRunning(id, info);
      } catch (cause) {
        if (newlyLaunchedId) {
          await xdmcpApi.disconnect(newlyLaunchedId).catch(() => undefined);
        }
        if (generationRef.current === generation) markError(cause);
      }
    },
    [markError, markRunning],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    void initialize(generation);
    return () => {
      generationRef.current += 1;
      // SessionManager owns final termination across detach/reattach.
    };
  }, [initialize, session.id]);

  useEffect(() => {
    if (status !== "x-server-running" || !backendSessionId) return;
    const timer = window.setInterval(() => {
      void xdmcpApi
        .isXServerRunning(backendSessionId)
        .then((running) => {
          if (running || backendRef.current !== backendSessionId) return;
          backendRef.current = null;
          setBackendSessionId(null);
          setSessionInfo(null);
          setStatus("stopped");
          updateSession({
            backendSessionId: undefined,
            status: "disconnected",
            errorMessage: undefined,
          });
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [backendSessionId, status, updateSession]);

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (id) await xdmcpApi.disconnect(id);
    backendRef.current = null;
    setBackendSessionId(null);
    setSessionInfo(null);
    setStatus("stopped");
    setError(null);
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [updateSession]);

  const reconnect = useCallback(() => {
    const generation = ++generationRef.current;
    return initialize(generation);
  }, [initialize]);

  return {
    status,
    error,
    backendSessionId,
    sessionInfo,
    disconnect,
    reconnect,
    discover: xdmcpApi.discover,
  };
}
