import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  ScpConnectionConfig,
  ScpDirectoryTransferRequest,
  ScpDirectoryTransferResult,
  ScpRemoteDirEntry,
  ScpRemoteFileInfo,
  ScpSessionInfo,
  ScpTransferRequest,
  ScpTransferResult,
} from "../../types/scp";
import { formatErrorForDisplay } from "../../utils/errors/formatError";
import {
  resolveEffectiveTrustPolicy,
  type InheritableTrustPolicy,
} from "../../utils/auth/trustStore";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type ScpClientStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export const scpApi = {
  connect: (config: ScpConnectionConfig) =>
    invoke<ScpSessionInfo>("scp_connect", { config }),
  disconnect: (sessionId: string) =>
    invoke<void>("scp_disconnect", { sessionId }),
  getSessionInfo: (sessionId: string) =>
    invoke<ScpSessionInfo>("scp_get_session_info", { sessionId }),
  ping: (sessionId: string) => invoke<boolean>("scp_ping", { sessionId }),
  listDirectory: (sessionId: string, path: string) =>
    invoke<ScpRemoteDirEntry[]>("scp_remote_ls", { sessionId, path }),
  stat: (sessionId: string, path: string) =>
    invoke<ScpRemoteFileInfo>("scp_remote_stat", { sessionId, path }),
  exists: (sessionId: string, path: string) =>
    invoke<boolean>("scp_remote_exists", { sessionId, path }),
  isDirectory: (sessionId: string, path: string) =>
    invoke<boolean>("scp_remote_is_dir", { sessionId, path }),
  fileSize: (sessionId: string, path: string) =>
    invoke<number>("scp_remote_file_size", { sessionId, path }),
  mkdirP: (sessionId: string, path: string) =>
    invoke<void>("scp_remote_mkdir_p", { sessionId, path }),
  deleteFile: (sessionId: string, path: string) =>
    invoke<void>("scp_remote_rm", { sessionId, path }),
  deleteRecursive: (sessionId: string, path: string) =>
    invoke<void>("scp_remote_rm_rf", { sessionId, path }),
  checksum: (sessionId: string, path: string) =>
    invoke<string>("scp_remote_checksum", { sessionId, path }),
  upload: (request: ScpTransferRequest) =>
    invoke<ScpTransferResult>("scp_upload", { request }),
  download: (request: ScpTransferRequest) =>
    invoke<ScpTransferResult>("scp_download", { request }),
  uploadDirectory: (request: ScpDirectoryTransferRequest) =>
    invoke<ScpDirectoryTransferResult>("scp_upload_directory", { request }),
  downloadDirectory: (request: ScpDirectoryTransferRequest) =>
    invoke<ScpDirectoryTransferResult>("scp_download_directory", { request }),
};

const scpErrorSecrets = (
  connection: Readonly<Connection> | undefined,
): string[] => {
  if (!connection) return [];
  const inlineSecrets = (connection.security?.tunnelChain ?? []).flatMap(
    (layer) => [
      layer.proxy?.password,
      layer.sshTunnel?.password,
      layer.sshTunnel?.passphrase,
      layer.sshTunnel?.privateKey,
      layer.sshTunnel?.proxyCommand?.proxyPassword,
      layer.vpn?.privateKey,
      layer.vpn?.presharedKey,
      layer.tunnel?.authToken,
      layer.mesh?.authKey,
    ],
  );
  return [
    connection.password,
    connection.passphrase,
    connection.privateKey,
    connection.security?.proxy?.password,
    ...inlineSecrets,
  ].filter((value): value is string => Boolean(value));
};

const toErrorMessage = (
  cause: unknown,
  connection?: Readonly<Connection>,
): string => formatErrorForDisplay(cause, scpErrorSecrets(connection));

const commaList = (values: readonly string[] | undefined): string | null =>
  values && values.length > 0 ? values.join(",") : null;

export function buildScpConnectionConfig(
  connection: Readonly<Connection>,
  sessionHostname: string,
  globalSshTrustPolicy?: InheritableTrustPolicy,
  rootTrustPolicy?: InheritableTrustPolicy,
): ScpConnectionConfig {
  const ssh = connection.sshConnectionConfigOverride;
  const usesPrivateKey =
    connection.authType === "key" ||
    (connection.authType === undefined && Boolean(connection.privateKey));

  return {
    host: connection.hostname || sessionHostname,
    port: connection.port || 22,
    username: connection.username || "",
    password: usesPrivateKey ? null : connection.password || null,
    privateKeyPath: null,
    privateKeyPassphrase: usesPrivateKey ? connection.passphrase || null : null,
    privateKeyData: usesPrivateKey ? connection.privateKey || null : null,
    useAgent: false,
    knownHostsPolicy: resolveScpKnownHostsPolicy(
      connection,
      globalSshTrustPolicy,
      rootTrustPolicy,
    ),
    knownHostsPath: connection.sshKnownHostsPath?.trim() || null,
    timeoutSecs: connection.sshConnectTimeout ?? connection.timeout ?? 30,
    // The backend configures libssh2 keepalive but never schedules a send.
    // Keep the inert setting disabled until the service owns a worker.
    keepaliveIntervalSecs: 0,
    // `sorng-scp` currently declares a proxy DTO but connects with a direct
    // TcpStream. Passing a proxy here would falsely imply that it is applied.
    proxy: null,
    compress: ssh?.enableCompression ?? false,
    label: connection.name,
    colorTag: connection.colorTag || null,
    preferredCiphers: commaList(ssh?.preferredCiphers),
    preferredMacs: commaList(ssh?.preferredMACs),
    preferredKex: commaList(ssh?.preferredKeyExchanges),
  };
}

/**
 * Translate saved/global SSH trust settings to the native SCP policy. The
 * `ask` backend policy deliberately fails closed for an unknown host because
 * the SCP viewer does not yet implement an interactive fingerprint prompt.
 */
export function resolveScpKnownHostsPolicy(
  connection: Readonly<Connection>,
  globalSshTrustPolicy?: InheritableTrustPolicy,
  rootTrustPolicy?: InheritableTrustPolicy,
): ScpConnectionConfig["knownHostsPolicy"] {
  if (connection.ignoreSshSecurityErrors === true) return "ignore";

  const persisted = connection as Readonly<Connection> & {
    sshHostKeyPolicy?: string;
    sshConnectionConfigOverride?: Connection["sshConnectionConfigOverride"] & {
      strictHostKeyChecking?: boolean | string;
    };
  };
  const legacyPolicy = String(
    persisted.sshHostKeyPolicy ??
      persisted.sshConnectionConfigOverride?.strictHostKeyChecking ??
      "",
  )
    .trim()
    .toLowerCase();
  if (
    legacyPolicy === "strict" ||
    legacyPolicy === "yes" ||
    legacyPolicy === "true"
  ) {
    return "strict";
  }
  if (
    legacyPolicy === "acceptnew" ||
    legacyPolicy === "accept-new" ||
    legacyPolicy === "tofu"
  ) {
    return "acceptNew";
  }
  if (legacyPolicy === "ask") return "ask";
  if (legacyPolicy === "no" || legacyPolicy === "false") return "ignore";

  const effective = resolveEffectiveTrustPolicy(
    connection.sshTrustPolicy,
    globalSshTrustPolicy,
    rootTrustPolicy,
  );
  if (effective === "strict") return "strict";
  if (effective === "tofu") return "acceptNew";
  if (effective === "always-trust") return "ignore";
  return "ask";
}

export function getUnsupportedScpRouteReason(
  connection: Readonly<Connection>,
): string | null {
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
    return "The native SCP backend currently supports direct connections only; remove the configured proxy, VPN, or tunnel chain for this session.";
  }
  return null;
}

export const normalizeScpRemotePath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  if (trimmed === "/" || trimmed === "~") return trimmed;
  return trimmed.replace(/\/{2,}/g, "/").replace(/\/$/, "");
};

export const joinScpRemotePath = (directory: string, name: string): string => {
  const base = normalizeScpRemotePath(directory);
  const child = name.replace(/^\/+/, "");
  return base === "/" ? `/${child}` : `${base}/${child}`;
};

export const parentScpRemotePath = (path: string): string => {
  const normalized = normalizeScpRemotePath(path);
  if (normalized === "/" || normalized === "~") return normalized;
  const segments = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("/")) {
    return segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
  }
  return segments.length <= 1 ? "~" : segments.slice(0, -1).join("/");
};

export function useScpClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const initialPath = normalizeScpRemotePath(connection?.remotePath || "/");
  const reconnectToken =
    session.status === "reconnecting"
      ? `${session.reconnectAttempts ?? 0}`
      : "stable";

  const [status, setStatus] = useState<ScpClientStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [homePath, setHomePath] = useState(initialPath);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<ScpRemoteDirEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [lastTransfer, setLastTransfer] = useState<
    ScpTransferResult | ScpDirectoryTransferResult | null
  >(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const disconnectedSessionIdsRef = useRef(new Set<string>());
  const disconnectPromisesRef = useRef(new Map<string, Promise<void>>());
  const pendingOperationsRef = useRef(0);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const setTrackedBusy = useCallback((delta: 1 | -1) => {
    pendingOperationsRef.current = Math.max(
      0,
      pendingOperationsRef.current + delta,
    );
    if (mountedRef.current) {
      setIsBusy(pendingOperationsRef.current > 0);
    }
  }, []);

  const runTracked = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      setTrackedBusy(1);
      try {
        return await operation();
      } finally {
        setTrackedBusy(-1);
      }
    },
    [setTrackedBusy],
  );

  const disconnectBackendOnce = useCallback(async (sessionId: string) => {
    if (disconnectedSessionIdsRef.current.has(sessionId)) return;
    const pending = disconnectPromisesRef.current.get(sessionId);
    if (pending) return pending;

    const operation = scpApi
      .disconnect(sessionId)
      .catch((cause) => {
        const message = toErrorMessage(cause, connectionRef.current);
        if (!/session .* not found/i.test(message)) throw new Error(message);
      })
      .then(() => {
        disconnectedSessionIdsRef.current.add(sessionId);
      })
      .finally(() => {
        disconnectPromisesRef.current.delete(sessionId);
      });
    disconnectPromisesRef.current.set(sessionId, operation);
    return operation;
  }, []);

  const markError = useCallback(
    (cause: unknown, retainedBackendId?: string | null) => {
      const message = toErrorMessage(cause, connectionRef.current);
      if (!mountedRef.current) return;
      setStatus("error");
      setError(message);
      updateSession({
        backendSessionId: retainedBackendId || undefined,
        status: "error",
        errorMessage: message,
      });
    },
    [updateSession],
  );

  const applyConnectedSession = useCallback(
    (info: ScpSessionInfo, path: string, listing: ScpRemoteDirEntry[]) => {
      backendRef.current = info.id;
      setBackendSessionId(info.id);
      const nextHome = normalizeScpRemotePath(
        info.remoteHome || connectionRef.current?.remotePath || "/",
      );
      setHomePath(nextHome);
      setCurrentPath(path);
      setEntries(listing);
      setStatus("connected");
      setError(null);
      updateSession({
        backendSessionId: info.id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const initialize = useCallback(
    async (generation: number, forceNew: boolean) => {
      const saved = connectionRef.current;
      if (!saved) {
        markError(
          "The saved or volatile SCP connection could not be found.",
          backendRef.current ?? sessionRef.current.backendSessionId,
        );
        return;
      }
      const routeError = getUnsupportedScpRouteReason(saved);
      if (routeError) {
        const existingId =
          backendRef.current ?? sessionRef.current.backendSessionId ?? null;
        if (existingId) {
          try {
            await disconnectBackendOnce(existingId);
            backendRef.current = null;
          } catch (cause) {
            markError(cause, existingId);
            return;
          }
        }
        markError(routeError);
        return;
      }

      setStatus("connecting");
      setError(null);
      let existingId: string | null =
        backendRef.current ?? sessionRef.current.backendSessionId ?? null;
      if (forceNew && existingId) {
        try {
          await disconnectBackendOnce(existingId);
        } catch (cause) {
          markError(cause, existingId);
          return;
        }
        backendRef.current = null;
        existingId = null;
      }

      if (existingId) {
        try {
          const info = await scpApi.getSessionInfo(existingId);
          if (generationRef.current !== generation) return;
          if (!info.connected) {
            try {
              await disconnectBackendOnce(existingId);
            } catch (cause) {
              markError(cause, existingId);
              return;
            }
            existingId = null;
          } else {
            const path = normalizeScpRemotePath(
              saved.remotePath || info.remoteHome || "/",
            );
            try {
              const listing = await scpApi.listDirectory(info.id, path);
              if (generationRef.current !== generation) return;
              applyConnectedSession(info, path, listing);
            } catch (cause) {
              if (generationRef.current === generation) {
                markError(cause, info.id);
              }
            }
            return;
          }
        } catch {
          // A restored handle can be stale after an app/backend restart. The
          // authoritative connect below creates one replacement session.
          existingId = null;
          backendRef.current = null;
        }
      }

      let createdId: string | null = null;
      try {
        const info = await scpApi.connect(
          buildScpConnectionConfig(
            saved,
            sessionRef.current.hostname,
            settingsRef.current.sshTrustPolicy,
            settingsRef.current.trustPolicy,
          ),
        );
        createdId = info.id;
        if (generationRef.current !== generation) {
          await disconnectBackendOnce(info.id).catch(() => undefined);
          return;
        }
        if (!info.connected) {
          throw new Error("The SCP backend returned a disconnected session.");
        }
        const path = normalizeScpRemotePath(
          saved.remotePath || info.remoteHome || "/",
        );
        const listing = await scpApi.listDirectory(info.id, path);
        if (generationRef.current !== generation) {
          await disconnectBackendOnce(info.id).catch(() => undefined);
          return;
        }
        applyConnectedSession(info, path, listing);
      } catch (cause) {
        if (createdId) {
          await disconnectBackendOnce(createdId).catch(() => undefined);
        }
        if (generationRef.current === generation) markError(cause);
      }
    },
    [applyConnectedSession, disconnectBackendOnce, markError],
  );

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    void initialize(generation, reconnectToken !== "stable");
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      // Established SCP handles intentionally survive React remounts and
      // detach/reattach. The session manager owns final close via
      // `scp_disconnect({ sessionId })`; a connect that resolves after this
      // cleanup is closed inside `initialize` before it can be published.
    };
  }, [initialize, reconnectToken, session.id]);

  const requireSessionId = useCallback((): string => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("SCP is not connected.");
    return sessionId;
  }, []);

  const runFileOperation = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      if (mountedRef.current) setError(null);
      try {
        return await runTracked(operation);
      } catch (cause) {
        const message = toErrorMessage(cause, connectionRef.current);
        if (mountedRef.current) setError(message);
        throw new Error(message);
      }
    },
    [runTracked],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      const normalized = normalizeScpRemotePath(path);
      const sessionId = requireSessionId();
      const listing = await runFileOperation(() =>
        scpApi.listDirectory(sessionId, normalized),
      );
      if (backendRef.current === sessionId && mountedRef.current) {
        setEntries(listing);
        setCurrentPath(normalized);
      }
      return listing;
    },
    [requireSessionId, runFileOperation],
  );

  const refreshDirectory = useCallback(
    () => loadDirectory(currentPath),
    [currentPath, loadDirectory],
  );

  const navigateUp = useCallback(
    () => loadDirectory(parentScpRemotePath(currentPath)),
    [currentPath, loadDirectory],
  );

  const stat = useCallback(
    (path: string) =>
      runFileOperation(() => scpApi.stat(requireSessionId(), path)),
    [requireSessionId, runFileOperation],
  );

  const checksum = useCallback(
    (path: string) =>
      runFileOperation(() => scpApi.checksum(requireSessionId(), path)),
    [requireSessionId, runFileOperation],
  );

  const mkdir = useCallback(
    async (path: string) => {
      const sessionId = requireSessionId();
      await runFileOperation(() => scpApi.mkdirP(sessionId, path));
      return loadDirectory(currentPath);
    },
    [currentPath, loadDirectory, requireSessionId, runFileOperation],
  );

  const deleteEntry = useCallback(
    async (entry: Pick<ScpRemoteDirEntry, "path" | "isDir">) => {
      const sessionId = requireSessionId();
      await runFileOperation(() =>
        entry.isDir
          ? scpApi.deleteRecursive(sessionId, entry.path)
          : scpApi.deleteFile(sessionId, entry.path),
      );
      return loadDirectory(currentPath);
    },
    [currentPath, loadDirectory, requireSessionId, runFileOperation],
  );

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string) => {
      const result = await runFileOperation(() =>
        scpApi.upload({
          sessionId: requireSessionId(),
          localPath,
          remotePath,
          createParents: true,
          overwrite: true,
        }),
      );
      if (!result.success) {
        const failure = new Error(result.error || "SCP upload failed.");
        const message = toErrorMessage(failure, connectionRef.current);
        if (mountedRef.current) setError(message);
        throw new Error(message);
      }
      if (mountedRef.current) setLastTransfer(result);
      await loadDirectory(currentPath);
      return result;
    },
    [currentPath, loadDirectory, requireSessionId, runFileOperation],
  );

  const downloadFile = useCallback(
    async (remotePath: string, localPath: string) => {
      const result = await runFileOperation(() =>
        scpApi.download({
          sessionId: requireSessionId(),
          localPath,
          remotePath,
          overwrite: true,
        }),
      );
      if (!result.success) {
        const failure = new Error(result.error || "SCP download failed.");
        const message = toErrorMessage(failure, connectionRef.current);
        if (mountedRef.current) setError(message);
        throw new Error(message);
      }
      if (mountedRef.current) setLastTransfer(result);
      return result;
    },
    [requireSessionId, runFileOperation],
  );

  const uploadDirectory = useCallback(
    async (localPath: string, remotePath: string) => {
      const result = await runFileOperation(() =>
        scpApi.uploadDirectory({
          sessionId: requireSessionId(),
          localPath,
          remotePath,
          overwrite: true,
        }),
      );
      if (mountedRef.current) setLastTransfer(result);
      if (result.filesFailed > 0) {
        const failure = new Error(
          result.errors[0] ||
            `${result.filesFailed} file(s) failed during the SCP directory upload.`,
        );
        const message = toErrorMessage(failure, connectionRef.current);
        if (mountedRef.current) setError(message);
        throw new Error(message);
      }
      await loadDirectory(currentPath);
      return result;
    },
    [currentPath, loadDirectory, requireSessionId, runFileOperation],
  );

  const downloadDirectory = useCallback(
    async (remotePath: string, localPath: string) => {
      const result = await runFileOperation(() =>
        scpApi.downloadDirectory({
          sessionId: requireSessionId(),
          localPath,
          remotePath,
          overwrite: true,
        }),
      );
      if (mountedRef.current) setLastTransfer(result);
      if (result.filesFailed > 0) {
        const failure = new Error(
          result.errors[0] ||
            `${result.filesFailed} file(s) failed during the SCP directory download.`,
        );
        const message = toErrorMessage(failure, connectionRef.current);
        if (mountedRef.current) setError(message);
        throw new Error(message);
      }
      return result;
    },
    [requireSessionId, runFileOperation],
  );

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    generationRef.current += 1;
    if (!sessionId) {
      if (mountedRef.current) {
        setBackendSessionId(null);
        setEntries([]);
        setStatus("disconnected");
        setError(null);
      }
      updateSession({
        backendSessionId: undefined,
        status: "disconnected",
        errorMessage: undefined,
      });
      return;
    }

    try {
      await disconnectBackendOnce(sessionId);
    } catch (cause) {
      const message = toErrorMessage(cause, connectionRef.current);
      if (mountedRef.current) {
        setBackendSessionId(sessionId);
        setStatus("error");
        setError(message);
      }
      updateSession({
        backendSessionId: sessionId,
        status: "error",
        errorMessage: message,
      });
      throw new Error(message);
    }

    backendRef.current = null;
    if (mountedRef.current) {
      setBackendSessionId(null);
      setEntries([]);
      setStatus("disconnected");
      setError(null);
    }
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [disconnectBackendOnce, updateSession]);

  return useMemo(
    () => ({
      status,
      error,
      backendSessionId,
      homePath,
      currentPath,
      entries,
      isBusy,
      lastTransfer,
      loadDirectory,
      refreshDirectory,
      navigateUp,
      stat,
      checksum,
      mkdir,
      deleteEntry,
      uploadFile,
      downloadFile,
      uploadDirectory,
      downloadDirectory,
      disconnect,
    }),
    [
      backendSessionId,
      checksum,
      currentPath,
      deleteEntry,
      disconnect,
      downloadDirectory,
      downloadFile,
      entries,
      error,
      homePath,
      isBusy,
      lastTransfer,
      loadDirectory,
      mkdir,
      navigateUp,
      refreshDirectory,
      stat,
      status,
      uploadDirectory,
      uploadFile,
    ],
  );
}
