import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  X2goNativeSavedOptions,
  X2goNativeSessionInfo,
} from "../../types/protocols/x2goNative";
import type { X2goConfig, X2goSshAuth } from "../../types/x2go";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type X2goNativeStatus =
  | "launching"
  | "native-client-running"
  | "exited"
  | "error";

type SavedX2goConnection = Connection & X2goNativeSavedOptions;

const positive = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;

export function getUnsupportedX2goRouteReason(
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
    return "The native X2Go handoff cannot consume sortOfRemoteNG proxy, VPN, or tunnel chains. Remove the route or configure it inside X2Go Client.";
  }
  if (connection.ignoreSshSecurityErrors) {
    return "The native X2Go handoff does not bypass SSH host-key verification. Disable 'ignore SSH security errors' and complete trust in X2Go Client.";
  }
  return null;
}

function sshAuth(connection: SavedX2goConnection): X2goSshAuth {
  const mode =
    connection.x2goAuthMode ??
    (connection.privateKey ? "privateKey" : "password");
  if (mode === "agent") return "Agent";
  if (mode === "gssapi") return "Gssapi";
  if (mode === "privateKey") {
    const key = connection.privateKey?.trim();
    if (!key) {
      throw new Error(
        "X2Go private-key authentication requires a key or key path.",
      );
    }
    if (key.includes("-----BEGIN") || key.includes("\n")) {
      return {
        InlinePrivateKey: {
          private_key: key,
          // The passphrase is intentionally entered in X2Go Client and never
          // sent through this command bridge.
        },
      };
    }
    return { PrivateKey: { key_path: key } };
  }
  // Deliberately do not send the saved password. The native client displays
  // its own trusted authentication prompt.
  return { Password: { password: "" } };
}

export function buildX2goNativeConfig(
  connection: Connection,
  session: ConnectionSession,
): X2goConfig {
  const saved = connection as SavedX2goConnection;
  const routeError = getUnsupportedX2goRouteReason(saved);
  if (routeError) throw new Error(routeError);
  const width = positive(saved.x2goWidth, 1280);
  const height = positive(saved.x2goHeight, 800);
  return {
    host: saved.hostname || session.hostname,
    username: saved.username?.trim() || "",
    ssh: {
      port: positive(saved.port, 22),
      auth: sshAuth(saved),
      strict_host_key: true,
      connect_timeout: positive(saved.sshConnectTimeout ?? saved.timeout, 30),
    },
    session_type: saved.x2goSessionType ?? "Xfce",
    command: saved.x2goCommand?.trim() || undefined,
    display: saved.x2goFullscreen
      ? "Fullscreen"
      : { Window: { width, height } },
    color_depth: 24,
    compression: saved.x2goCompression ?? "Adsl",
    dpi: positive(saved.x2goDpi, 96),
    keyboard: {
      layout: saved.x2goKeyboardLayout?.trim() || "us",
      model: saved.x2goKeyboardModel?.trim() || "pc105/us",
    },
    audio: {
      system: "Pulse",
      enabled: saved.x2goAudioEnabled ?? true,
      port: 0,
    },
    printing: { enabled: saved.x2goPrintingEnabled ?? false },
    shared_folders: saved.x2goSharedFolders ?? [],
    clipboard: saved.x2goClipboard ?? "Both",
    rootless: saved.x2goRootless ?? false,
    published_applications: saved.x2goPublishedApplications ?? false,
    use_broker: false,
    native_client_path: saved.x2goNativeClientPath?.trim() || undefined,
  };
}

export const x2goNativeApi = {
  connect: (sessionId: string, config: X2goConfig) =>
    invoke<void>("connect_x2go", { sessionId, config }),
  info: (sessionId: string) =>
    invoke<X2goNativeSessionInfo>("get_x2go_session_info", { sessionId }),
  disconnect: (sessionId: string) =>
    invoke<void>("disconnect_x2go", { sessionId }),
};

export function x2goNativeErrorMessage(
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
  return sanitizeBehaviorText(message) || "X2Go Client launch failed.";
}

export function useX2goNativeSession(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const [status, setStatus] = useState<X2goNativeStatus>("launching");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<X2goNativeSessionInfo | null>(null);
  const backendIdRef = useRef<string | null>(session.backendSessionId ?? null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const generationRef = useRef(0);
  const launchPromiseRef = useRef<Promise<void> | null>(null);

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
    try {
      const next = await x2goNativeApi.info(backendId);
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
      const message = x2goNativeErrorMessage(value, connection);
      setError(message);
      setStatus("error");
      return false;
    }
  }, [connection, updateSession]);

  const launch = useCallback(async () => {
    if (launchPromiseRef.current) return launchPromiseRef.current;
    const operation = (async () => {
      const generation = ++generationRef.current;
      setStatus("launching");
      setError(null);
      try {
        if (!connection)
          throw new Error("X2Go connection settings were not found.");
        const existingId = backendIdRef.current;
        if (existingId && (await refresh())) return;
        const config = buildX2goNativeConfig(connection, sessionRef.current);
        const backendId = sessionRef.current.id;
        await x2goNativeApi.connect(backendId, config);
        if (generation !== generationRef.current) {
          await x2goNativeApi.disconnect(backendId).catch(() => undefined);
          return;
        }
        backendIdRef.current = backendId;
        const next = await x2goNativeApi.info(backendId);
        setInfo(next);
        if (next.state !== "Running" || !next.native_client_pid) {
          backendIdRef.current = null;
          await x2goNativeApi.disconnect(backendId).catch(() => undefined);
          throw new Error(
            "X2Go Client exited before its process could be tracked.",
          );
        }
        setStatus("native-client-running");
        updateSession({
          backendSessionId: backendId,
          status: "connected",
          errorMessage: undefined,
        });
      } catch (value) {
        if (generation !== generationRef.current) return;
        const message = x2goNativeErrorMessage(value, connection);
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
      await x2goNativeApi.disconnect(backendId).catch(() => undefined);
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
      // SessionManager owns final disconnect. A viewer remount must not kill a
      // native process or duplicate it.
      ++generationRef.current;
    };
  }, [launch, session.id]);

  useEffect(() => {
    if (status !== "native-client-running") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  return { status, error, info, launch, refresh, disconnect };
}
