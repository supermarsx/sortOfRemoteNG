import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  FtpConnectionConfig,
  FtpEntry,
  FtpListOptions,
  FtpSavedConnectionOptions,
  FtpSessionInfo,
  FtpTransferResult,
} from "../../types/ftp";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type FtpClientStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type SavedFtpConnection = Connection & FtpSavedConnectionOptions;

const positiveInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;

export const buildFtpConnectionConfig = (
  connection: Connection,
  session: ConnectionSession,
): FtpConnectionConfig => {
  const saved = connection as SavedFtpConnection;
  const username = saved.username?.trim() || "anonymous";
  const configuredDataMode = (
    saved as Connection & { ftpDataChannelMode?: string }
  ).ftpDataChannelMode;
  if (
    configuredDataMode &&
    configuredDataMode !== "passive" &&
    configuredDataMode !== "extendedPassive"
  ) {
    throw new Error(
      "Active FTP data channels are unavailable because the native backend cannot complete PORT/EPRT transfers safely. Choose Passive or Extended Passive.",
    );
  }

  return {
    host: saved.hostname || session.hostname,
    port: positiveInteger(saved.port, 21),
    username,
    password:
      saved.password ??
      (username.toLowerCase() === "anonymous" ? "anonymous@" : ""),
    security: saved.ftpSecurity ?? "none",
    // Direct upload/download intentionally use binary mode in the backend.
    // Do not expose an ASCII toggle that those operations would ignore.
    transferType: "binary",
    dataChannelMode: saved.ftpDataChannelMode ?? "passive",
    initialDirectory: saved.remotePath?.trim() || null,
    connectTimeoutSec: positiveInteger(
      saved.ftpConnectTimeoutSec ?? saved.timeout,
      15,
    ),
    dataTimeoutSec: positiveInteger(saved.ftpDataTimeoutSec, 30),
    // The crate currently stores a keepalive interval but never starts its
    // NOOP worker. Disable the inert setting until the backend owns a worker.
    keepaliveIntervalSec: 0,
    acceptInvalidCerts: saved.ftpAcceptInvalidCerts ?? false,
    utf8: saved.ftpUtf8 ?? true,
    activeBindAddress: null,
    label: saved.name || null,
  };
};

/**
 * `sorng-ftp` currently opens its own direct TCP socket and has no route DTO.
 * Refuse persisted proxy/VPN/tunnel requests instead of bypassing them.
 */
export const getUnsupportedFtpRouteReason = (
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
    return "The native FTP backend currently supports direct connections only; remove the configured proxy, VPN, or tunnel chain for this session.";
  }
  return null;
};

export const normalizeFtpPath = (path: string): string => {
  const normalized = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  if (!normalized || normalized === ".") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

export const joinFtpPath = (directory: string, name: string): string => {
  const base = normalizeFtpPath(directory);
  return normalizeFtpPath(`${base === "/" ? "" : base}/${name}`);
};

export const parentFtpPath = (path: string): string => {
  const parts = normalizeFtpPath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
};

export const ftpApi = {
  connect: (config: FtpConnectionConfig) =>
    invoke<FtpSessionInfo>("ftp_connect", { config }),
  disconnect: (sessionId: string) =>
    invoke<void>("ftp_disconnect", { sessionId }),
  getSessionInfo: (sessionId: string) =>
    invoke<FtpSessionInfo>("ftp_get_session_info", { sessionId }),
  listDirectory: (sessionId: string, path: string, options?: FtpListOptions) =>
    invoke<FtpEntry[]>("ftp_list_directory", {
      sessionId,
      path,
      options: options ?? null,
    }),
  mkdir: (sessionId: string, path: string) =>
    invoke<string>("ftp_mkdir", { sessionId, path }),
  removeDirectory: (sessionId: string, path: string, recursive = false) =>
    invoke<void>(recursive ? "ftp_rmdir_recursive" : "ftp_rmdir", {
      sessionId,
      path,
    }),
  rename: (sessionId: string, from: string, to: string) =>
    invoke<void>("ftp_rename", { sessionId, from, to }),
  deleteFile: (sessionId: string, path: string) =>
    invoke<void>("ftp_delete_file", { sessionId, path }),
  chmod: (sessionId: string, path: string, mode: string) =>
    invoke<void>("ftp_chmod", { sessionId, path, mode }),
  uploadFile: (sessionId: string, localPath: string, remotePath: string) =>
    invoke<number>("ftp_upload_file", {
      sessionId,
      localPath,
      remotePath,
    }),
  downloadFile: (sessionId: string, remotePath: string, localPath: string) =>
    invoke<number>("ftp_download_file", {
      sessionId,
      remotePath,
      localPath,
    }),
};

const errorText = (error: unknown, password?: string): string => {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  if (password) message = message.split(password).join("[redacted]");
  return sanitizeBehaviorText(message) || "FTP operation failed.";
};

export function useFTPSession(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const initialPath = normalizeFtpPath(connection?.remotePath || "/");

  const [status, setStatus] = useState<FtpClientStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<FtpSessionInfo | null>(null);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FtpEntry[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastTransfer, setLastTransfer] = useState<FtpTransferResult | null>(
    null,
  );

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const generationRef = useRef(0);
  const listGenerationRef = useRef(0);
  const disconnectPromiseRef = useRef<Promise<void> | null>(null);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const toErrorText = useCallback(
    (value: unknown) => errorText(value, connectionRef.current?.password),
    [],
  );

  const markError = useCallback(
    (value: unknown) => {
      const message = toErrorText(value);
      setStatus("error");
      setError(message);
      updateSession({ status: "error", errorMessage: message });
    },
    [toErrorText, updateSession],
  );

  const markConnected = useCallback(
    (info: FtpSessionInfo) => {
      backendRef.current = info.id;
      setBackendSessionId(info.id);
      setSessionInfo(info);
      setCurrentPath(normalizeFtpPath(info.currentDirectory || initialPath));
      setStatus("connected");
      setError(null);
      updateSession({
        backendSessionId: info.id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [initialPath, updateSession],
  );

  const requireSession = useCallback((): string => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("FTP is not connected.");
    return sessionId;
  }, []);

  const loadDirectory = useCallback(
    async (requestedPath: string, options?: FtpListOptions) => {
      const sessionId = requireSession();
      const path = normalizeFtpPath(requestedPath);
      const requestGeneration = ++listGenerationRef.current;
      setIsBusy(true);
      setError(null);
      try {
        const list = await ftpApi.listDirectory(sessionId, path, options);
        if (requestGeneration !== listGenerationRef.current) return list;
        setEntries(
          list.filter((entry) => entry.name !== "." && entry.name !== ".."),
        );
        setCurrentPath(path);
        setSelectedName(null);
        return list;
      } catch (value) {
        const message = toErrorText(value);
        if (requestGeneration === listGenerationRef.current) {
          setError(message);
        }
        throw new Error(message);
      } finally {
        if (requestGeneration === listGenerationRef.current) setIsBusy(false);
      }
    },
    [requireSession, toErrorText],
  );

  const initialize = useCallback(
    async (generation: number) => {
      const currentConnection = connectionRef.current;
      const currentSession = sessionRef.current;
      if (!currentConnection) {
        markError(
          "The saved or Quick Connect FTP connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedFtpRouteReason(currentConnection);
      if (routeError) {
        markError(routeError);
        return;
      }

      setStatus("connecting");
      setError(null);

      let info: FtpSessionInfo | null = null;
      if (currentSession.backendSessionId) {
        info = await ftpApi
          .getSessionInfo(currentSession.backendSessionId)
          .catch(() => null);
        if (generationRef.current !== generation) return;
      }

      try {
        if (!info?.connected) {
          info = await ftpApi.connect(
            buildFtpConnectionConfig(currentConnection, currentSession),
          );
        }
        if (generationRef.current !== generation) {
          await ftpApi.disconnect(info.id).catch(() => undefined);
          return;
        }
        markConnected(info);
        void loadDirectory(info.currentDirectory || initialPath).catch(() => {
          /* The directory error remains visible while the session stays connected. */
        });
      } catch (value) {
        if (generationRef.current === generation) markError(value);
      }
    },
    [initialPath, loadDirectory, markConnected, markError],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    void initialize(generation);

    return () => {
      generationRef.current += 1;
      listGenerationRef.current += 1;
      // Established handles survive renderer remounts and detach/reattach.
      // The session manager is the final lifecycle owner and closes the
      // published backendSessionId. A connect that resolves after cleanup is
      // still closed inside initialize before it can be published.
    };
  }, [initialize, session.id]);

  const disconnect = useCallback((): Promise<void> => {
    if (disconnectPromiseRef.current) return disconnectPromiseRef.current;
    const sessionId = backendRef.current;
    if (!sessionId) return Promise.resolve();

    const request = ftpApi
      .disconnect(sessionId)
      .catch((value) => {
        const message = toErrorText(value);
        if (!/session .* not found/i.test(message)) throw value;
      })
      .then(() => {
        if (backendRef.current === sessionId) backendRef.current = null;
        setBackendSessionId(null);
        setSessionInfo(null);
        setEntries([]);
        setSelectedName(null);
        setStatus("disconnected");
        setError(null);
        updateSession({
          backendSessionId: undefined,
          status: "disconnected",
          errorMessage: undefined,
        });
      })
      .catch((value) => {
        markError(value);
        throw new Error(toErrorText(value));
      })
      .finally(() => {
        disconnectPromiseRef.current = null;
      });

    disconnectPromiseRef.current = request;
    return request;
  }, [markError, toErrorText, updateSession]);

  const refreshDirectory = useCallback(
    () => loadDirectory(currentPath),
    [currentPath, loadDirectory],
  );

  const navigateUp = useCallback(
    () => loadDirectory(parentFtpPath(currentPath)),
    [currentPath, loadDirectory],
  );

  const navigateInto = useCallback(
    (entry: FtpEntry) => {
      if (entry.kind !== "directory") return Promise.resolve();
      return loadDirectory(joinFtpPath(currentPath, entry.name)).then(
        () => undefined,
      );
    },
    [currentPath, loadDirectory],
  );

  const runMutation = useCallback(
    async <T>(operation: () => Promise<T>, refresh = true): Promise<T> => {
      setIsBusy(true);
      setError(null);
      try {
        const result = await operation();
        if (refresh) await loadDirectory(currentPath);
        return result;
      } catch (value) {
        const message = toErrorText(value);
        setError(message);
        throw new Error(message);
      } finally {
        setIsBusy(false);
      }
    },
    [currentPath, loadDirectory, toErrorText],
  );

  const createDirectory = useCallback(
    (name: string) => {
      const path = joinFtpPath(currentPath, name);
      return runMutation(() => ftpApi.mkdir(requireSession(), path));
    },
    [currentPath, requireSession, runMutation],
  );

  const renameEntry = useCallback(
    (entry: FtpEntry, newName: string) =>
      runMutation(() =>
        ftpApi.rename(
          requireSession(),
          joinFtpPath(currentPath, entry.name),
          joinFtpPath(currentPath, newName),
        ),
      ),
    [currentPath, requireSession, runMutation],
  );

  const deleteEntry = useCallback(
    (entry: FtpEntry) => {
      const path = joinFtpPath(currentPath, entry.name);
      return runMutation(() =>
        entry.kind === "directory"
          ? ftpApi.removeDirectory(requireSession(), path, true)
          : ftpApi.deleteFile(requireSession(), path),
      );
    },
    [currentPath, requireSession, runMutation],
  );

  const chmodEntry = useCallback(
    (entry: FtpEntry, mode: string) =>
      runMutation(() =>
        ftpApi.chmod(
          requireSession(),
          joinFtpPath(currentPath, entry.name),
          mode,
        ),
      ),
    [currentPath, requireSession, runMutation],
  );

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string) => {
      const normalizedRemotePath = normalizeFtpPath(remotePath);
      const bytesTransferred = await runMutation(() =>
        ftpApi.uploadFile(requireSession(), localPath, normalizedRemotePath),
      );
      const result: FtpTransferResult = {
        direction: "upload",
        localPath,
        remotePath: normalizedRemotePath,
        bytesTransferred,
      };
      setLastTransfer(result);
      return result;
    },
    [requireSession, runMutation],
  );

  const downloadFile = useCallback(
    async (remotePath: string, localPath: string) => {
      const normalizedRemotePath = normalizeFtpPath(remotePath);
      const bytesTransferred = await runMutation(
        () =>
          ftpApi.downloadFile(
            requireSession(),
            normalizedRemotePath,
            localPath,
          ),
        false,
      );
      const result: FtpTransferResult = {
        direction: "download",
        localPath,
        remotePath: normalizedRemotePath,
        bytesTransferred,
      };
      setLastTransfer(result);
      return result;
    },
    [requireSession, runMutation],
  );

  const selectedEntry =
    entries.find((entry) => entry.name === selectedName) ?? null;

  return {
    status,
    error,
    backendSessionId,
    sessionInfo,
    currentPath,
    entries,
    selectedName,
    selectedEntry,
    isBusy,
    lastTransfer,
    setSelectedName,
    loadDirectory,
    refreshDirectory,
    navigateUp,
    navigateInto,
    createDirectory,
    renameEntry,
    deleteEntry,
    chmodEntry,
    uploadFile,
    downloadFile,
    disconnect,
  };
}
