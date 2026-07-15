import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { RloginSettings } from "../../types/connection/rloginSettings";
import {
  formatRuntimeNetworkPathError,
  resolveRuntimeNetworkPath,
  type RuntimeNetworkPath,
} from "../../utils/network/resolveRuntimeNetworkPath";
import {
  encodeRloginTerminalInput,
  migrateRloginSettings,
} from "../../utils/rlogin/rloginSettings";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import {
  buildRloginConnectOptions,
  RLOGIN_RUNTIME_CAPABILITIES,
  RloginChannelAssembler,
  RloginSequenceCursor,
  type RloginBackendSession,
  type RloginCapabilities,
  type RloginDeliveredOutput,
  type RloginDiagnosis,
  type RloginEvent,
  type RloginOutputFrame,
  type RloginReplaySnapshot,
  type RloginStats,
} from "./rloginRuntime";

export type RloginFrontendStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface RloginSessionModel {
  status: RloginFrontendStatus;
  error: string | null;
  backendSessionId: string | null;
  settings: RloginSettings;
  outputFrames: readonly RloginDeliveredOutput[];
  replayTruncated: boolean;
  stats: RloginStats | null;
  capabilities: RloginCapabilities;
  sourcePortFallback: boolean;
  diagnosisWarnings: readonly string[];
  localAddress: string | null;
  remoteAddress: string | null;
  sendInput(data: string): Promise<{ lossy: boolean }>;
  resize(
    columns: number,
    rows: number,
    widthPixels?: number,
    heightPixels?: number,
  ): Promise<void>;
  disconnect(): Promise<void>;
}

const MAX_FRONTEND_OUTPUT_FRAMES = 2_048;
const MAX_FRONTEND_OUTPUT_BYTES = 1024 * 1024;
const SNAPSHOT_POLL_MS = 400;

const appendBoundedOutput = (
  current: readonly RloginDeliveredOutput[],
  frame: RloginDeliveredOutput,
): RloginDeliveredOutput[] => {
  const next = [...current, { ...frame, data: frame.data.slice() }];
  let bytes = next.reduce((total, entry) => total + entry.data.length, 0);
  while (
    next.length > MAX_FRONTEND_OUTPUT_FRAMES ||
    bytes > MAX_FRONTEND_OUTPUT_BYTES
  ) {
    const removed = next.shift();
    if (!removed) break;
    bytes -= removed.data.length;
  }
  return next;
};

const copyFrame = (
  sessionId: string,
  frame: RloginOutputFrame,
): RloginDeliveredOutput => ({
  sessionId,
  sequence: frame.sequence,
  byteLength: frame.data.length,
  prefixTruncated: frame.prefixTruncated,
  replayed: true,
  data:
    frame.data instanceof Uint8Array
      ? frame.data.slice()
      : Uint8Array.from(frame.data),
});

export function useRloginSession(
  session: ConnectionSession,
): RloginSessionModel {
  const { state, dispatch } = useConnections();
  const connection = state.connections.find(
    (candidate) => candidate.id === session.connectionId,
  );
  const settings = useMemo(
    () => migrateRloginSettings(connection?.rloginSettings),
    [connection?.rloginSettings],
  );
  const [status, setStatus] = useState<RloginFrontendStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [outputFrames, setOutputFrames] = useState<
    readonly RloginDeliveredOutput[]
  >([]);
  const [replayTruncated, setReplayTruncated] = useState(false);
  const [stats, setStats] = useState<RloginStats | null>(null);
  const [capabilities, setCapabilities] = useState<RloginCapabilities>(
    RLOGIN_RUNTIME_CAPABILITIES,
  );
  const [sourcePortFallback, setSourcePortFallback] = useState(false);
  const [diagnosisWarnings, setDiagnosisWarnings] = useState<readonly string[]>(
    [],
  );
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef<Connection | undefined>(connection);
  connectionRef.current = connection;
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const mountedRef = useRef(true);
  const cleanupGenerationRef = useRef(0);
  const channelGenerationRef = useRef(0);
  const pollingGenerationRef = useRef(0);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollCountRef = useRef(0);
  const initializedTokenRef = useRef<string | null>(null);
  const cursorRef = useRef(new RloginSequenceCursor());
  const assemblerRef = useRef<RloginChannelAssembler | null>(null);
  const runtimePathRef = useRef<RuntimeNetworkPath | null>(null);
  const ignoredDisconnectsRef = useRef(new Set<string>());
  const preserveOnUnmountRef = useRef(false);

  const updateFrontendSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const acceptOutput = useCallback((frame: RloginDeliveredOutput) => {
    if (!mountedRef.current || !cursorRef.current.accept(frame.sequence))
      return;
    if (frame.prefixTruncated) setReplayTruncated(true);
    setOutputFrames((current) => appendBoundedOutput(current, frame));
  }, []);

  const assembler = useMemo(
    () => new RloginChannelAssembler(acceptOutput),
    [acceptOutput],
  );
  assemblerRef.current = assembler;

  const applyBackendSession = useCallback((backend: RloginBackendSession) => {
    if (!mountedRef.current) return;
    backendRef.current = backend.id;
    setBackendSessionId(backend.id);
    setStats(backend.stats);
    setCapabilities(backend.capabilities);
    setSourcePortFallback(backend.sourcePortFallback);
    setLocalAddress(backend.localAddress);
    setRemoteAddress(backend.remoteAddress);
    if (backend.lifecycle === "error") setStatus("error");
    else if (backend.connected || backend.lifecycle === "connected") {
      setStatus("connected");
    } else if (backend.lifecycle === "closed") {
      setStatus("disconnected");
    }
  }, []);

  const handleEvent = useCallback(
    (event: RloginEvent) => {
      if (!mountedRef.current) return;
      if (event.type === "output") {
        assemblerRef.current?.acceptMetadata(event.frame);
        return;
      }
      if (event.type === "connected") {
        applyBackendSession(event.session);
        return;
      }
      if (event.type === "capability_notice") {
        setCapabilities(event.capabilities);
        setSourcePortFallback(event.sourcePortFallback);
        return;
      }
      if (event.type === "replay_started") {
        if (event.truncated) setReplayTruncated(true);
        return;
      }
      if (event.type === "lifecycle_changed") {
        if (event.lifecycle === "error") {
          setStatus("error");
          updateFrontendSession({
            status: "error",
            errorMessage: "RLogin transport failed.",
          });
        }
        return;
      }
      if (event.type === "disconnected") {
        if (ignoredDisconnectsRef.current.delete(event.session.id)) return;
        applyBackendSession(event.session);
        setStatus("disconnected");
        updateFrontendSession({
          backendSessionId: event.session.id,
          status: "disconnected",
          errorMessage: undefined,
        });
      }
    },
    [applyBackendSession, updateFrontendSession],
  );

  const createChannels = useCallback(() => {
    const generation = ++channelGenerationRef.current;
    assembler.clear();
    return {
      dataChannel: new Channel<ArrayBuffer>((data) => {
        if (mountedRef.current && channelGenerationRef.current === generation) {
          assembler.acceptData(data);
        }
      }),
      eventChannel: new Channel<RloginEvent>((event) => {
        if (mountedRef.current && channelGenerationRef.current === generation) {
          handleEvent(event);
        }
      }),
    };
  }, [assembler, handleEvent]);

  const ingestSnapshot = useCallback(
    (sessionId: string, snapshot: RloginReplaySnapshot) => {
      if (snapshot.truncated) setReplayTruncated(true);
      for (const frame of snapshot.frames) {
        acceptOutput(copyFrame(sessionId, frame));
      }
    },
    [acceptOutput],
  );

  const stopPolling = useCallback(() => {
    pollingGenerationRef.current += 1;
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    pollingTimerRef.current = null;
    pollInFlightRef.current = false;
  }, []);

  const pollSnapshot = useCallback(
    async (id: string, generation: number) => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const snapshot = await invoke<RloginReplaySnapshot>(
          "get_rlogin_output_snapshot",
          { sessionId: id, afterSequence: cursorRef.current.value },
        );
        if (
          !mountedRef.current ||
          pollingGenerationRef.current !== generation ||
          backendRef.current !== id
        ) {
          return;
        }
        ingestSnapshot(id, snapshot);
        pollCountRef.current += 1;
        if (pollCountRef.current % 5 === 0) {
          const info = await invoke<RloginBackendSession>(
            "get_rlogin_session_info",
            { sessionId: id },
          );
          if (
            mountedRef.current &&
            pollingGenerationRef.current === generation &&
            backendRef.current === id
          ) {
            applyBackendSession(info);
          }
        }
      } catch {
        // Lifecycle events own user-visible failure state. Snapshot polling is
        // best-effort recovery for detach and missed channel delivery.
      } finally {
        if (pollingGenerationRef.current === generation) {
          pollInFlightRef.current = false;
        }
      }
    },
    [applyBackendSession, ingestSnapshot],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollCountRef.current = 0;
      const generation = pollingGenerationRef.current;
      void pollSnapshot(id, generation);
      pollingTimerRef.current = setInterval(
        () => void pollSnapshot(id, generation),
        SNAPSHOT_POLL_MS,
      );
    },
    [pollSnapshot, stopPolling],
  );

  const markConnected = useCallback(
    (
      id: string,
      runtimePath: RuntimeNetworkPath,
      recordConnection: boolean,
    ) => {
      setStatus("connected");
      setError(null);
      updateFrontendSession({
        backendSessionId: id,
        status: "connected",
        errorMessage: undefined,
        networkPath: runtimePath.snapshot,
      });
      const currentConnection = connectionRef.current;
      if (currentConnection && recordConnection) {
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...currentConnection,
            lastConnected: new Date().toISOString(),
            connectionCount: (currentConnection.connectionCount ?? 0) + 1,
          },
        });
      }
    },
    [dispatch, updateFrontendSession],
  );

  const initialize = useCallback(
    async (forceNew: boolean) => {
      const currentConnection = connectionRef.current;
      if (!currentConnection)
        throw new Error("RLogin settings are unavailable.");
      const runtimePath = await resolveRuntimeNetworkPath(
        currentConnection,
        connectionsRef.current,
        "rlogin",
      );
      runtimePathRef.current = runtimePath;
      const existingId = backendRef.current;

      if (existingId && !forceNew) {
        const info = await invoke<RloginBackendSession>(
          "get_rlogin_session_info",
          { sessionId: existingId },
        );
        if (!info.connected || info.lifecycle !== "connected") {
          throw new Error("The detached RLogin backend session has ended.");
        }
        applyBackendSession(info);
        preserveOnUnmountRef.current = false;
        markConnected(existingId, runtimePath, false);
        startPolling(existingId);
        return;
      }

      if (existingId && forceNew) {
        stopPolling();
        ignoredDisconnectsRef.current.add(existingId);
        await invoke("disconnect_rlogin", { sessionId: existingId }).catch(
          () => undefined,
        );
        backendRef.current = null;
        setBackendSessionId(null);
      }

      cursorRef.current.reset();
      assembler.clear();
      setOutputFrames([]);
      setReplayTruncated(false);
      setStats(null);
      const currentSettings = settingsRef.current;
      const options = buildRloginConnectOptions(
        currentConnection.id,
        sessionRef.current.hostname,
        currentConnection.port || 513,
        currentSettings,
      );
      const diagnosis = await invoke<RloginDiagnosis>(
        "diagnose_rlogin_connection",
        { options },
      );
      setCapabilities(diagnosis.capabilities);
      setDiagnosisWarnings(diagnosis.warnings);
      if (!diagnosis.compatible) {
        throw new Error(
          diagnosis.blockers.join(" ") || "RLogin settings are incompatible.",
        );
      }
      const channels = createChannels();
      const id = await invoke<string>("connect_rlogin", {
        options,
        ...channels,
      });
      backendRef.current = id;
      preserveOnUnmountRef.current = false;
      setBackendSessionId(id);
      markConnected(id, runtimePath, true);
      startPolling(id);
      const info = await invoke<RloginBackendSession>(
        "get_rlogin_session_info",
        { sessionId: id },
      ).catch(() => null);
      if (info) applyBackendSession(info);
    },
    [
      applyBackendSession,
      assembler,
      createChannels,
      markConnected,
      startPolling,
      stopPolling,
    ],
  );

  const startInitialize = useCallback(
    (forceNew: boolean, token: string) => {
      if (initializedTokenRef.current === token) return;
      initializedTokenRef.current = token;
      setStatus("connecting");
      setError(null);
      void initialize(forceNew).catch((cause) => {
        if (!mountedRef.current) return;
        stopPolling();
        const safe = sanitizeBehaviorText(
          formatRuntimeNetworkPathError(cause, runtimePathRef.current),
        );
        setStatus("error");
        setError(safe);
        updateFrontendSession({ status: "error", errorMessage: safe });
      });
    },
    [initialize, stopPolling, updateFrontendSession],
  );

  const reconnectAttempt = session.reconnectAttempts ?? 0;
  useEffect(() => {
    const forceNew = session.status === "reconnecting";
    startInitialize(
      forceNew,
      forceNew ? `reconnect:${reconnectAttempt}` : "initial",
    );
  }, [reconnectAttempt, session.status, startInitialize]);

  const shouldRunUnmountCleanup = useCallback(
    (generation: number) =>
      !mountedRef.current && cleanupGenerationRef.current === generation,
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const preserveForDetach = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId === sessionRef.current.id) {
        preserveOnUnmountRef.current = true;
      }
    };
    window.addEventListener("sorng:session-will-detach", preserveForDetach);
    const generation = ++cleanupGenerationRef.current;
    return () => {
      mountedRef.current = false;
      stopPolling();
      window.removeEventListener(
        "sorng:session-will-detach",
        preserveForDetach,
      );
      queueMicrotask(() => {
        if (!shouldRunUnmountCleanup(generation)) return;
        const id = backendRef.current;
        if (
          !id ||
          preserveOnUnmountRef.current ||
          sessionRef.current.layout?.isDetached === true
        ) {
          return;
        }
        void invoke("disconnect_rlogin", { sessionId: id }).catch(
          () => undefined,
        );
      });
    };
  }, [shouldRunUnmountCleanup, stopPolling]);

  const refreshInfo = useCallback(
    async (id: string) => {
      const info = await invoke<RloginBackendSession>(
        "get_rlogin_session_info",
        { sessionId: id },
      ).catch(() => null);
      if (info && mountedRef.current && backendRef.current === id) {
        applyBackendSession(info);
      }
    },
    [applyBackendSession],
  );

  const sendInput = useCallback(
    async (data: string) => {
      const id = backendRef.current;
      if (!id) throw new Error("RLogin session is not connected.");
      const encoded = encodeRloginTerminalInput(
        data,
        settingsRef.current.encoding,
      );
      await invoke("send_rlogin_input", {
        sessionId: id,
        data: Array.from(encoded.bytes),
      });
      void refreshInfo(id);
      return { lossy: encoded.lossy };
    },
    [refreshInfo],
  );

  const resize = useCallback(
    async (
      columns: number,
      rows: number,
      widthPixels = 0,
      heightPixels = 0,
    ) => {
      const id = backendRef.current;
      if (!id) return;
      const bounded = (value: number) =>
        Math.max(0, Math.min(65_535, Math.trunc(value)));
      await invoke("resize_rlogin", {
        sessionId: id,
        size: {
          rows: Math.max(1, bounded(rows)),
          columns: Math.max(1, bounded(columns)),
          widthPixels: bounded(widthPixels),
          heightPixels: bounded(heightPixels),
        },
      });
      void refreshInfo(id);
    },
    [refreshInfo],
  );

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (!id) return;
    stopPolling();
    ignoredDisconnectsRef.current.add(id);
    preserveOnUnmountRef.current = false;
    await invoke("disconnect_rlogin", { sessionId: id });
    setStatus("disconnected");
    updateFrontendSession({ status: "disconnected", errorMessage: undefined });
  }, [stopPolling, updateFrontendSession]);

  return {
    status,
    error,
    backendSessionId,
    settings,
    outputFrames,
    replayTruncated,
    stats,
    capabilities,
    sourcePortFallback,
    diagnosisWarnings,
    localAddress,
    remoteAddress,
    sendInput,
    resize,
    disconnect,
  };
}
