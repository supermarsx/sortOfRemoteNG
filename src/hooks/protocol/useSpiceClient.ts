import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  SpiceNativeConnectRequest,
  SpiceSavedConnectionOptions,
  SpiceSessionInfo,
  SpiceSessionStats,
} from "../../types/protocols/spice";
import { formatErrorForDisplay } from "../../utils/errors/formatError";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type SpiceClientStatus =
  | "launching"
  | "viewer-running"
  | "stopped"
  | "error";

type SavedSpiceConnection = Connection & SpiceSavedConnectionOptions;

const positivePort = (value: number | undefined, fallback: number): number =>
  Number.isInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= 65_535
    ? (value as number)
    : fallback;

export const buildSpiceNativeConnectRequest = (
  connection: Connection,
  session: ConnectionSession,
): SpiceNativeConnectRequest => {
  const saved = connection as SavedSpiceConnection;
  const host = (saved.hostname || session.hostname).trim();
  if (!host) throw new Error("A SPICE hostname is required.");
  const requireTls = saved.spiceRequireTls ?? false;
  const hasTlsMetadata = Boolean(
    saved.spiceCaCertificatePath?.trim() || saved.spiceTlsHostSubject?.trim(),
  );
  return {
    host,
    port: positivePort(saved.port, 5900),
    tlsPort:
      saved.spiceTlsPort === undefined
        ? requireTls || hasTlsMetadata
          ? 5901
          : null
        : positivePort(saved.spiceTlsPort, 5901),
    password: saved.password ?? null,
    label: saved.name || null,
    nativeClientPath: saved.spiceNativeClientPath?.trim() || null,
    fullscreen: saved.spiceFullscreen ?? false,
    viewOnly: saved.spiceViewOnly ?? false,
    // remote-viewer's stdin connection-file contract cannot enforce
    // clipboard-off, so legacy false values must not cross the IPC boundary.
    shareClipboard: true,
    usbRedirection: saved.spiceUsbRedirection ?? false,
    audioPlayback: saved.spiceAudioPlayback ?? true,
    // remote-viewer's documented connection file cannot force a fixed size.
    preferredWidth: null,
    preferredHeight: null,
    proxy: saved.spiceProxyUri?.trim() || null,
    requireTls,
    caCert: saved.spiceCaCertificatePath?.trim() || null,
    verifyHostname: saved.spiceTlsHostSubject?.trim() || null,
    // Runtime fail-safe for imported/Quick Connect records that bypassed the
    // persistence normalizer: unverified certificates are never supported.
    allowSelfSigned: false,
  };
};

/** Generic routes are not silently bypassed by the external viewer process. */
export const getUnsupportedSpiceRouteReason = (
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
    return "The native SPICE viewer cannot consume the configured connection chain, VPN, SSH tunnel, or generic proxy. Remove that route or configure a dedicated SPICE HTTP CONNECT proxy URI.";
  }
  return null;
};

export const spiceApi = {
  connect: (request: SpiceNativeConnectRequest) =>
    invoke<string>("connect_spice", { ...request }),
  disconnect: (sessionId: string) =>
    invoke<void>("disconnect_spice", { sessionId }),
  isViewerRunning: (sessionId: string) =>
    invoke<boolean>("is_spice_connected", { sessionId }),
  getSessionInfo: (sessionId: string) =>
    invoke<SpiceSessionInfo>("get_spice_session_info", { sessionId }),
  getStats: (sessionId: string) =>
    invoke<SpiceSessionStats>("get_spice_session_stats", { sessionId }),
};

const connectionSecrets = (connection?: Readonly<Connection>): string[] => {
  if (!connection) return [];
  const inline = (connection.security?.tunnelChain ?? []).flatMap((layer) => [
    layer.proxy?.password,
    layer.sshTunnel?.password,
    layer.sshTunnel?.passphrase,
    layer.sshTunnel?.privateKey,
    layer.vpn?.privateKey,
    layer.vpn?.presharedKey,
    layer.tunnel?.authToken,
    layer.mesh?.authKey,
  ]);
  return [
    connection.password,
    connection.passphrase,
    connection.privateKey,
    connection.security?.proxy?.password,
    ...inline,
  ].filter((value): value is string => Boolean(value));
};

export const spiceErrorMessage = (
  error: unknown,
  connection?: Readonly<Connection>,
): string => formatErrorForDisplay(error, connectionSecrets(connection));

const isMissingSessionError = (error: unknown): boolean =>
  /session .*not found/i.test(
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "",
  );

/**
 * Owns the renderer side of a native SPICE handoff. “viewer-running” means
 * only that remote-viewer remains alive; authentication and remote display
 * readiness stay inside its separate native window.
 */
export function useSpiceClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const [status, setStatus] = useState<SpiceClientStatus>("launching");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<SpiceSessionInfo | null>(null);
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
      const message = spiceErrorMessage(cause, connectionRef.current);
      setStatus("error");
      setError(message);
      updateSession({ status: "error", errorMessage: message });
    },
    [updateSession],
  );

  const markViewerRunning = useCallback(
    (id: string, info: SpiceSessionInfo) => {
      backendRef.current = id;
      setBackendSessionId(id);
      setSessionInfo(info);
      setStatus("viewer-running");
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
          "The saved or Quick Connect SPICE connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedSpiceRouteReason(currentConnection);
      if (routeError) {
        markError(routeError);
        return;
      }

      setStatus("launching");
      setError(null);
      let newlyLaunchedId: string | null = null;
      try {
        let id = currentSession.backendSessionId ?? null;
        let running = false;
        if (id) {
          running = await spiceApi.isViewerRunning(id).catch(() => false);
          if (generationRef.current !== generation) return;
        }
        if (!id || !running) {
          if (id) await spiceApi.disconnect(id).catch(() => undefined);
          id = await spiceApi.connect(
            buildSpiceNativeConnectRequest(currentConnection, currentSession),
          );
          newlyLaunchedId = id;
        }
        if (generationRef.current !== generation) {
          if (newlyLaunchedId) {
            await spiceApi.disconnect(newlyLaunchedId).catch(() => undefined);
          }
          return;
        }
        const info = await spiceApi.getSessionInfo(id);
        if (generationRef.current !== generation) {
          if (newlyLaunchedId) {
            await spiceApi.disconnect(newlyLaunchedId).catch(() => undefined);
          }
          return;
        }
        if (!info.connected) {
          throw new Error(
            "The native SPICE viewer process stopped during startup.",
          );
        }
        markViewerRunning(id, info);
      } catch (cause) {
        if (newlyLaunchedId) {
          await spiceApi.disconnect(newlyLaunchedId).catch(() => undefined);
        }
        if (generationRef.current === generation) markError(cause);
      }
    },
    [markError, markViewerRunning],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    void initialize(generation);
    return () => {
      generationRef.current += 1;
      // SessionManager owns final process termination so detach/reattach does
      // not close the external viewer window.
    };
  }, [initialize, session.id]);

  useEffect(() => {
    if (status !== "viewer-running" || !backendSessionId) return;
    const timer = window.setInterval(() => {
      void spiceApi
        .isViewerRunning(backendSessionId)
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
        .catch((cause) => {
          if (!isMissingSessionError(cause)) return;
          backendRef.current = null;
          setBackendSessionId(null);
          setSessionInfo(null);
          setStatus("stopped");
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [backendSessionId, status, updateSession]);

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (id) {
      await spiceApi.disconnect(id).catch((cause) => {
        if (!isMissingSessionError(cause)) throw cause;
      });
    }
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
  };
}
