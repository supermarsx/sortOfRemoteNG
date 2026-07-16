import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  NxNativeSavedOptions,
  NxNativeSessionInfo,
} from "../../types/protocols/nxNative";
import type { NxSessionType } from "../../types/nx";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type NxNativeStatus =
  | "launching"
  | "native-client-running"
  | "exited"
  | "error";

type SavedNxConnection = Connection & NxNativeSavedOptions;

export interface NxNativeConnectArgs {
  host: string;
  port: number;
  username: string | null;
  password: null;
  privateKey: string | null;
  label: string | null;
  sessionType: string;
  resolutionWidth: number;
  resolutionHeight: number;
  fullscreen: boolean;
  clipboard: boolean;
  audioEnabled: boolean;
  resumeSessionId: null;
  connectionService: "nx" | "ssh";
  nativeClientPath: string | null;
  sshPort: number | null;
  customCommand: string | null;
}

export function nxSessionTypeWireValue(sessionType: NxSessionType): string {
  switch (sessionType) {
    case "UnixDesktop":
      return "unix-desktop";
    case "UnixGnome":
      return "unix-gnome";
    case "UnixKde":
      return "unix-kde";
    case "UnixXfce":
      return "unix-xfce";
    case "UnixCustom":
      return "unix-custom";
    case "Shadow":
      return "shadow";
    case "Windows":
      return "windows";
    case "Vnc":
      return "vnc";
    case "Application":
      return "application";
    case "Console":
      return "console";
  }
}

const positive = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;

export function getUnsupportedNxRouteReason(
  connection: Readonly<Connection>,
): string | null {
  const inlineRoute =
    connection.security?.proxy?.enabled === true ||
    connection.security?.openvpn?.enabled === true ||
    connection.security?.sshTunnel?.enabled === true ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled !== false);
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    inlineRoute
  ) {
    return "The native NoMachine handoff cannot consume sortOfRemoteNG proxy, VPN, or tunnel chains. Remove the route or configure it inside NoMachine.";
  }
  return null;
}

export function buildNxNativeConnectArgs(
  connection: Connection,
  session: ConnectionSession,
): NxNativeConnectArgs {
  const saved = connection as SavedNxConnection;
  const routeError = getUnsupportedNxRouteReason(saved);
  if (routeError) throw new Error(routeError);
  const connectionService = saved.nxConnectionService ?? "nx";
  return {
    host: saved.hostname || session.hostname,
    port: positive(saved.port, connectionService === "ssh" ? 22 : 4000),
    username: saved.username?.trim() || null,
    // Native NoMachine owns the trusted password/2FA prompt. The saved
    // password is deliberately never sent through IPC or written to NXS.
    password: null,
    privateKey: saved.privateKey?.trim() || null,
    label: saved.name || null,
    sessionType: nxSessionTypeWireValue(saved.nxSessionType ?? "UnixDesktop"),
    resolutionWidth: positive(saved.nxWidth, 1280),
    resolutionHeight: positive(saved.nxHeight, 800),
    fullscreen: saved.nxFullscreen ?? false,
    clipboard: saved.nxClipboardEnabled ?? true,
    audioEnabled: saved.nxAudioEnabled ?? true,
    resumeSessionId: null,
    connectionService,
    nativeClientPath: saved.nxNativeClientPath?.trim() || null,
    sshPort: connectionService === "ssh" ? positive(saved.port, 22) : null,
    customCommand: saved.nxCustomCommand?.trim() || null,
  };
}

export const nxNativeApi = {
  connect: (args: NxNativeConnectArgs) =>
    invoke<string>("connect_nx", args as unknown as Record<string, unknown>),
  info: (sessionId: string) =>
    invoke<NxNativeSessionInfo>("get_nx_session_info", { sessionId }),
  disconnect: (sessionId: string) =>
    invoke<void>("disconnect_nx", { sessionId }),
};

export function nxNativeErrorMessage(
  error: unknown,
  connection?: Connection,
): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  for (const secret of [
    connection?.password,
    connection?.passphrase,
    connection?.privateKey,
  ]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return sanitizeBehaviorText(message) || "NoMachine Client launch failed.";
}

export function useNxNativeSession(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const [status, setStatus] = useState<NxNativeStatus>("launching");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<NxNativeSessionInfo | null>(null);
  const backendIdRef = useRef<string | null>(session.backendSessionId ?? null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const generationRef = useRef(0);
  const launchPromiseRef = useRef<Promise<void> | null>(null);
  const invalidateLaunch = useCallback(() => {
    ++generationRef.current;
  }, []);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    const backendId = backendIdRef.current;
    if (!backendId) return false;
    const generation = generationRef.current;
    try {
      const next = await nxNativeApi.info(backendId);
      if (
        generation !== generationRef.current ||
        backendIdRef.current !== backendId
      ) {
        return false;
      }
      setInfo(next);
      if (next.state === "Running" && next.native_client_pid) {
        setStatus("native-client-running");
        setError(null);
        return true;
      }
      setStatus("exited");
      updateSession({ status: "disconnected" });
      return false;
    } catch (value) {
      if (
        generation !== generationRef.current ||
        backendIdRef.current !== backendId
      ) {
        return false;
      }
      const message = nxNativeErrorMessage(value, connection);
      setError(message);
      setStatus("error");
      return false;
    }
  }, [connection, updateSession]);

  const launch = useCallback(async () => {
    if (launchPromiseRef.current) return launchPromiseRef.current;
    const operation = (async () => {
      const generation = ++generationRef.current;
      let launchedBackendId: string | null = null;
      const cleanupLaunchedBackend = async () => {
        const backendId = launchedBackendId;
        if (!backendId) return;
        launchedBackendId = null;
        if (backendIdRef.current === backendId) {
          backendIdRef.current = null;
        }
        await nxNativeApi.disconnect(backendId).catch(() => undefined);
      };
      setStatus("launching");
      setError(null);
      try {
        if (!connection) {
          throw new Error("NoMachine connection settings were not found.");
        }
        const existingId = backendIdRef.current;
        if (existingId) {
          if (await refresh()) return;
          if (generation !== generationRef.current) return;
          if (backendIdRef.current === existingId) {
            backendIdRef.current = null;
          }
          await nxNativeApi.disconnect(existingId).catch(() => undefined);
          if (generation !== generationRef.current) return;
        }
        const args = buildNxNativeConnectArgs(connection, sessionRef.current);
        const backendId = await nxNativeApi.connect(args);
        launchedBackendId = backendId;
        if (generation !== generationRef.current) {
          await cleanupLaunchedBackend();
          return;
        }
        backendIdRef.current = backendId;
        const next = await nxNativeApi.info(backendId);
        if (generation !== generationRef.current) {
          await cleanupLaunchedBackend();
          return;
        }
        setInfo(next);
        if (next.state !== "Running" || !next.native_client_pid) {
          await cleanupLaunchedBackend();
          throw new Error(
            "NoMachine Client exited before its process could be tracked.",
          );
        }
        setStatus("native-client-running");
        updateSession({
          backendSessionId: backendId,
          status: "connected",
          errorMessage: undefined,
        });
        launchedBackendId = null;
      } catch (value) {
        await cleanupLaunchedBackend();
        if (generation !== generationRef.current) return;
        const message = nxNativeErrorMessage(value, connection);
        setError(message);
        setStatus("error");
        updateSession({ status: "error", errorMessage: message });
      }
    })();
    launchPromiseRef.current = operation.finally(() => {
      launchPromiseRef.current = null;
    });
    return launchPromiseRef.current;
  }, [connection, refresh, updateSession]);

  const disconnect = useCallback(async () => {
    ++generationRef.current;
    const backendId = backendIdRef.current;
    backendIdRef.current = null;
    if (backendId) {
      await nxNativeApi.disconnect(backendId).catch(() => undefined);
    }
    setInfo(null);
    setStatus("exited");
    setError(null);
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [updateSession]);

  useEffect(() => {
    void launch();
    return () => {
      invalidateLaunch();
    };
  }, [invalidateLaunch, launch, session.id]);

  useEffect(() => {
    if (status !== "native-client-running") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  return { status, error, info, launch, refresh, disconnect };
}
