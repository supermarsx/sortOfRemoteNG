import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  normalizeRawSocketSettings,
  type RawSocketSettingsV1,
} from "../../types/protocols/rawSocket";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import {
  appendRawSocketTranscript,
  clearRawSocketTranscript,
  createRawSocketTranscript,
  type RawSocketTranscript,
} from "../../utils/protocols/rawSocket/transcript";
import {
  formatRuntimeNetworkPathError,
  resolveRuntimeNetworkPath,
  type RuntimeNetworkPath,
} from "../../utils/network/resolveRuntimeNetworkPath";
import {
  buildRawSocketConnectOptions,
  RawSocketChannelAssembler,
  RawSocketSequenceCursor,
  type RawSocketBackendFrame,
  type RawSocketBackendSession,
  type RawSocketDeliveredFrame,
  type RawSocketEvent,
  type RawSocketReplay,
  type RawSocketStats,
  type RawSocketStatus,
} from "./rawSocketRuntime";

export type RawSocketFrontendStatus =
  | "connecting"
  | "connected"
  | "write_closed"
  | "disconnected"
  | "error";

export interface RawSocketSessionModel {
  status: RawSocketFrontendStatus;
  error: string | null;
  backendSessionId: string | null;
  settings: RawSocketSettingsV1;
  transcript: RawSocketTranscript;
  stats: RawSocketStats | null;
  localAddress: string | null;
  remoteAddress: string | null;
  send(data: Uint8Array): Promise<void>;
  shutdownWrite(): Promise<void>;
  disconnect(): Promise<void>;
  clearTranscript(): void;
}

const frontendStatus = (status: RawSocketStatus): RawSocketFrontendStatus => {
  if (status === "connected") return "connected";
  if (status === "write_closed") return "write_closed";
  if (status === "failed") return "error";
  return "disconnected";
};

const asBytes = (data: number[] | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? data.slice() : Uint8Array.from(data);

const updateLiveStats = (
  stats: RawSocketStats | null,
  frame: RawSocketDeliveredFrame,
): RawSocketStats | null => {
  if (!stats || frame.replayed) return stats;
  const next = { ...stats, lastActivityAtMs: frame.timestampMs };
  if (frame.direction === "inbound") {
    next.bytesReceived += frame.data.length;
    next.framesReceived += 1;
    if (frame.datagram) next.datagramsReceived += 1;
  } else {
    next.bytesSent += frame.data.length;
    next.framesSent += 1;
    if (frame.datagram) next.datagramsSent += 1;
  }
  return next;
};

export function useRawSocketSession(
  session: ConnectionSession,
): RawSocketSessionModel {
  const { state, dispatch } = useConnections();
  const connection = state.connections.find(
    (candidate) => candidate.id === session.connectionId,
  );
  const settings = useMemo(
    () => normalizeRawSocketSettings(connection?.rawSocketSettings),
    [connection?.rawSocketSettings],
  );
  const [status, setStatus] = useState<RawSocketFrontendStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [transcript, setTranscript] = useState(() =>
    createRawSocketTranscript({
      maxEntries: settings.advanced.replayFrames,
      maxBytes: settings.advanced.replayBytes,
    }),
  );
  const [stats, setStats] = useState<RawSocketStats | null>(null);
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
  const initializePromiseRef = useRef<Promise<void> | null>(null);
  const initializedTokenRef = useRef<string | null>(null);
  const cursorRef = useRef(new RawSocketSequenceCursor());
  const assemblerRef = useRef<RawSocketChannelAssembler | null>(null);
  const channelGenerationRef = useRef(0);
  const runtimePathRef = useRef<RuntimeNetworkPath | null>(null);
  const ignoredDisconnectsRef = useRef(new Set<string>());
  const preserveOnUnmountRef = useRef(false);

  const updateFrontendSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      const current = sessionRef.current;
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...current, ...patch },
      });
    },
    [dispatch],
  );

  const acceptFrame = useCallback((frame: RawSocketDeliveredFrame) => {
    if (!mountedRef.current || !cursorRef.current.accept(frame.sequence))
      return;
    const currentSettings = settingsRef.current;
    setTranscript((current) =>
      appendRawSocketTranscript(current, {
        id: `${frame.sessionId}:${frame.sequence}`,
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        direction: frame.direction,
        transport: currentSettings.connection.transport,
        data: frame.data,
      }),
    );
    setStats((current) => updateLiveStats(current, frame));
  }, []);

  const assembler = useMemo(
    () => new RawSocketChannelAssembler(acceptFrame),
    [acceptFrame],
  );
  assemblerRef.current = assembler;

  const applyBackendSession = useCallback(
    (backend: RawSocketBackendSession) => {
      backendRef.current = backend.id;
      setBackendSessionId(backend.id);
      setStats(backend.stats);
      setLocalAddress(backend.localAddress);
      setRemoteAddress(backend.remoteAddress);
      const nextStatus = frontendStatus(backend.status);
      setStatus(nextStatus);
      if (nextStatus === "error") {
        updateFrontendSession({
          backendSessionId: backend.id,
          status: "error",
          errorMessage: "Raw Socket transport failed.",
        });
      }
    },
    [updateFrontendSession],
  );

  const handleEvent = useCallback(
    (event: RawSocketEvent) => {
      if (!mountedRef.current) return;
      if (event.type === "data") {
        assemblerRef.current?.acceptMetadata(event.frame);
        return;
      }
      if (event.type === "detached") {
        preserveOnUnmountRef.current = true;
        return;
      }
      if (event.type === "connected") {
        applyBackendSession(event.session);
        return;
      }
      if (event.type === "write_closed") {
        setStatus("write_closed");
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
      eventChannel: new Channel<RawSocketEvent>((event) => {
        if (mountedRef.current && channelGenerationRef.current === generation) {
          handleEvent(event);
        }
      }),
    };
  }, [assembler, handleEvent]);

  const ingestReplay = useCallback(
    (replay: RawSocketReplay) => {
      for (const frame of replay.frames) {
        const backendFrame = frame as RawSocketBackendFrame;
        acceptFrame({
          sessionId: replay.sessionId,
          sequence: backendFrame.sequence,
          timestampMs: backendFrame.timestampMs,
          direction: backendFrame.direction,
          datagram: backendFrame.datagram,
          byteLength: backendFrame.data.length,
          replayed: true,
          data: asBytes(backendFrame.data),
        });
      }
    },
    [acceptFrame],
  );

  const markConnected = useCallback(
    (
      id: string,
      runtimePath: RuntimeNetworkPath,
      recordConnection: boolean,
    ) => {
      const currentConnection = connectionRef.current;
      const now = new Date().toISOString();
      setStatus("connected");
      setError(null);
      updateFrontendSession({
        backendSessionId: id,
        status: "connected",
        errorMessage: undefined,
        networkPath: runtimePath.snapshot,
      });
      if (currentConnection && recordConnection) {
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...currentConnection,
            lastConnected: now,
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
      if (!currentConnection) {
        throw new Error("Raw Socket connection settings are unavailable.");
      }
      const currentSettings = settingsRef.current;
      const protocol =
        currentSettings.connection.transport === "udp" ? "raw-udp" : "raw-tcp";
      const runtimePath = await resolveRuntimeNetworkPath(
        currentConnection,
        connectionsRef.current,
        protocol,
      );
      runtimePathRef.current = runtimePath;
      const existingId = backendRef.current;
      const channels = createChannels();

      if (existingId && !forceNew) {
        const info = await invoke<RawSocketBackendSession>(
          "get_raw_socket_session_info",
          { sessionId: existingId },
        );
        if (info.status !== "connected" && info.status !== "write_closed") {
          throw new Error("The detached Raw Socket backend session has ended.");
        }
        applyBackendSession(info);
        const replay = await invoke<RawSocketReplay>("attach_raw_socket", {
          sessionId: existingId,
          ...channels,
        });
        ingestReplay(replay);
        preserveOnUnmountRef.current = false;
        markConnected(existingId, runtimePath, false);
        if (info.status === "write_closed") setStatus("write_closed");
        return;
      }

      if (existingId && forceNew) {
        ignoredDisconnectsRef.current.add(existingId);
        await invoke("disconnect_raw_socket", { sessionId: existingId }).catch(
          () => undefined,
        );
        backendRef.current = null;
        setBackendSessionId(null);
      }
      cursorRef.current.reset();
      assembler.clear();
      setTranscript(
        createRawSocketTranscript({
          maxEntries: currentSettings.advanced.replayFrames,
          maxBytes: currentSettings.advanced.replayBytes,
        }),
      );
      setStats(null);
      const options = buildRawSocketConnectOptions(
        currentConnection.id,
        sessionRef.current.hostname,
        currentConnection.port || 23,
        currentSettings,
      );
      const id = await invoke<string>("connect_raw_socket", {
        options,
        ...channels,
      });
      backendRef.current = id;
      preserveOnUnmountRef.current = false;
      setBackendSessionId(id);
      markConnected(id, runtimePath, true);
    },
    [
      applyBackendSession,
      assembler,
      createChannels,
      ingestReplay,
      markConnected,
    ],
  );

  const startInitialize = useCallback(
    (forceNew: boolean, token: string) => {
      if (initializedTokenRef.current === token) return;
      initializedTokenRef.current = token;
      setStatus("connecting");
      setError(null);
      const operation = initialize(forceNew)
        .catch((cause) => {
          if (!mountedRef.current) return;
          const safe = sanitizeBehaviorText(
            formatRuntimeNetworkPathError(cause, runtimePathRef.current),
          );
          setStatus("error");
          setError(safe);
          updateFrontendSession({ status: "error", errorMessage: safe });
        })
        .finally(() => {
          if (initializePromiseRef.current === operation) {
            initializePromiseRef.current = null;
          }
        });
      initializePromiseRef.current = operation;
    },
    [initialize, updateFrontendSession],
  );

  const reconnectAttempt = session.reconnectAttempts ?? 0;
  useEffect(() => {
    const forceNew = session.status === "reconnecting";
    const token = forceNew ? `reconnect:${reconnectAttempt}` : "initial";
    startInitialize(forceNew, token);
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
      window.removeEventListener(
        "sorng:session-will-detach",
        preserveForDetach,
      );
      queueMicrotask(() => {
        if (!shouldRunUnmountCleanup(generation)) return;
        const id = backendRef.current;
        if (!id) return;
        const preserve =
          preserveOnUnmountRef.current ||
          sessionRef.current.layout?.isDetached === true;
        const command = preserve
          ? "detach_raw_socket"
          : "disconnect_raw_socket";
        void invoke(command, { sessionId: id }).catch(() => undefined);
      });
    };
  }, [shouldRunUnmountCleanup]);

  const send = useCallback(async (data: Uint8Array) => {
    const id = backendRef.current;
    if (!id) throw new Error("Raw Socket session is not connected.");
    await invoke("send_raw_socket_data", {
      sessionId: id,
      data: Array.from(data),
    });
  }, []);

  const shutdownWrite = useCallback(async () => {
    const id = backendRef.current;
    if (!id) throw new Error("Raw Socket session is not connected.");
    await invoke("shutdown_raw_socket_write", { sessionId: id });
    setStatus("write_closed");
  }, []);

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (!id) return;
    ignoredDisconnectsRef.current.add(id);
    preserveOnUnmountRef.current = false;
    await invoke("disconnect_raw_socket", { sessionId: id });
    setStatus("disconnected");
    updateFrontendSession({ status: "disconnected", errorMessage: undefined });
  }, [updateFrontendSession]);

  const clearTranscript = useCallback(() => {
    setTranscript((current) => clearRawSocketTranscript(current));
  }, []);

  return {
    status,
    error,
    backendSessionId,
    settings,
    transcript,
    stats,
    localAddress,
    remoteAddress,
    send,
    shutdownWrite,
    disconnect,
    clearTranscript,
  };
}
