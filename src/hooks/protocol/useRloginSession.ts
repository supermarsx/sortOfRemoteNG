import { Channel, invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
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
import {
  rloginPollingScheduler,
  type RloginPollingRegistration,
} from "./rloginPollingScheduler";

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

export interface RloginBoundedOutputBatch {
  frames: RloginDeliveredOutput[];
  byteLength: number;
  truncated: boolean;
  examinedFrames: number;
}

export const appendBoundedRloginOutputBatch = (
  current: readonly RloginDeliveredOutput[],
  currentByteLength: number,
  incoming: readonly RloginDeliveredOutput[],
): RloginBoundedOutputBatch => {
  const combined = [...current, ...incoming];
  let byteLength = currentByteLength;
  for (const frame of incoming) byteLength += frame.data.byteLength;

  let start = Math.max(0, combined.length - MAX_FRONTEND_OUTPUT_FRAMES);
  for (let index = 0; index < start; index += 1) {
    byteLength -= combined[index].data.byteLength;
  }
  while (byteLength > MAX_FRONTEND_OUTPUT_BYTES && start < combined.length) {
    byteLength -= combined[start].data.byteLength;
    start += 1;
  }
  return {
    frames: combined.slice(start),
    byteLength: Math.max(0, byteLength),
    truncated: start > 0,
    examinedFrames: incoming.length + start,
  };
};

interface HeldOutputBuffer {
  slots: Array<RloginDeliveredOutput | undefined>;
  head: number;
  count: number;
  byteLength: number;
  truncated: boolean;
}

const createHeldOutputBuffer = (): HeldOutputBuffer => ({
  slots: [],
  head: 0,
  count: 0,
  byteLength: 0,
  truncated: false,
});

const removeOldestHeldOutput = (buffer: HeldOutputBuffer): void => {
  if (buffer.count === 0) return;
  const removed = buffer.slots[buffer.head];
  if (removed) buffer.byteLength -= removed.data.byteLength;
  buffer.slots[buffer.head] = undefined;
  buffer.head = (buffer.head + 1) % MAX_FRONTEND_OUTPUT_FRAMES;
  buffer.count -= 1;
  if (buffer.count === 0) buffer.head = 0;
};

const appendHeldOutput = (
  buffer: HeldOutputBuffer,
  frame: RloginDeliveredOutput,
): void => {
  const held = { ...frame, data: frame.data.slice() };
  while (
    buffer.count >= MAX_FRONTEND_OUTPUT_FRAMES ||
    buffer.byteLength + held.data.byteLength > MAX_FRONTEND_OUTPUT_BYTES
  ) {
    if (buffer.count === 0) {
      buffer.truncated = true;
      return;
    }
    removeOldestHeldOutput(buffer);
    buffer.truncated = true;
  }
  const index = (buffer.head + buffer.count) % MAX_FRONTEND_OUTPUT_FRAMES;
  buffer.slots[index] = held;
  buffer.count += 1;
  buffer.byteLength += held.data.byteLength;
  if (frame.prefixTruncated) buffer.truncated = true;
};

const drainHeldOutput = (
  buffer: HeldOutputBuffer,
): { frames: RloginDeliveredOutput[]; truncated: boolean } => {
  const frames: RloginDeliveredOutput[] = [];
  for (let offset = 0; offset < buffer.count; offset += 1) {
    const frame =
      buffer.slots[(buffer.head + offset) % MAX_FRONTEND_OUTPUT_FRAMES];
    if (frame) frames.push(frame);
  }
  return { frames, truncated: buffer.truncated };
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
  const { isActive: isRenderActive } = useSessionRenderActivity();
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
  const pollingRegistrationRef = useRef<RloginPollingRegistration | null>(null);
  const pollCountRef = useRef(0);
  const initializedTokenRef = useRef<string | null>(null);
  const cursorRef = useRef(new RloginSequenceCursor());
  const renderedOutputRef = useRef<readonly RloginDeliveredOutput[]>([]);
  const renderedOutputBytesRef = useRef(0);
  const heldOutputRef = useRef(createHeldOutputBuffer());
  const renderActiveRef = useRef(isRenderActive);
  const resumePendingRef = useRef(isRenderActive);
  const resumeGenerationRef = useRef(0);
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

  const commitOutputs = useCallback(
    (frames: readonly RloginDeliveredOutput[]) => {
      if (!mountedRef.current) return;
      const accepted: RloginDeliveredOutput[] = [];
      let truncated = false;
      for (const frame of frames) {
        if (!cursorRef.current.accept(frame.sequence)) continue;
        accepted.push(frame);
        truncated ||= frame.prefixTruncated;
      }
      if (accepted.length === 0) return;
      const bounded = appendBoundedRloginOutputBatch(
        renderedOutputRef.current,
        renderedOutputBytesRef.current,
        accepted,
      );
      truncated ||= bounded.truncated;
      if (truncated) setReplayTruncated(true);
      renderedOutputRef.current = bounded.frames;
      renderedOutputBytesRef.current = bounded.byteLength;
      setOutputFrames(bounded.frames);
    },
    [],
  );

  const holdOutput = useCallback((frame: RloginDeliveredOutput) => {
    appendHeldOutput(heldOutputRef.current, frame);
  }, []);

  const acceptLiveOutput = useCallback(
    (frame: RloginDeliveredOutput) => {
      if (!mountedRef.current) return;
      if (!renderActiveRef.current || resumePendingRef.current) {
        holdOutput(frame);
        return;
      }
      commitOutputs([frame]);
    },
    [commitOutputs, holdOutput],
  );

  const assembler = useMemo(
    () => new RloginChannelAssembler(acceptLiveOutput),
    [acceptLiveOutput],
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
      const replay = snapshot.frames
        .map((frame) => copyFrame(sessionId, frame))
        .sort((left, right) => left.sequence - right.sequence);
      commitOutputs(replay);
    },
    [commitOutputs],
  );

  const finishActivationReplay = useCallback(
    (sessionId: string, snapshot: RloginReplaySnapshot) => {
      const held = drainHeldOutput(heldOutputRef.current);
      const replay = snapshot.frames.map((frame) =>
        copyFrame(sessionId, frame),
      );
      const merged = [...replay, ...held.frames].sort(
        (left, right) => left.sequence - right.sequence,
      );
      heldOutputRef.current = createHeldOutputBuffer();
      if (snapshot.truncated || held.truncated) {
        setReplayTruncated(true);
      }
      commitOutputs(merged);
      resumePendingRef.current = false;
    },
    [commitOutputs],
  );

  const stopPolling = useCallback(() => {
    pollingGenerationRef.current += 1;
    pollingRegistrationRef.current?.unregister();
    pollingRegistrationRef.current = null;
  }, []);

  const executeSnapshotPoll = useCallback(
    async (id: string, generation: number) => {
      if (
        !mountedRef.current ||
        pollingGenerationRef.current !== generation ||
        backendRef.current !== id ||
        !renderActiveRef.current
      ) {
        return;
      }
      const resumeGeneration = resumeGenerationRef.current;
      const activationReplay = resumePendingRef.current;
      let snapshot: RloginReplaySnapshot;
      try {
        snapshot = await invoke<RloginReplaySnapshot>(
          "get_rlogin_output_snapshot",
          { sessionId: id, afterSequence: cursorRef.current.value },
        );
      } catch {
        // Keep activation gating and held frames intact. Advancing the cursor
        // without a replay could permanently skip missing retained output.
        return;
      }
      if (
        !mountedRef.current ||
        pollingGenerationRef.current !== generation ||
        backendRef.current !== id ||
        !renderActiveRef.current ||
        resumeGenerationRef.current !== resumeGeneration
      ) {
        return;
      }
      if (activationReplay) {
        if (!resumePendingRef.current) return;
        finishActivationReplay(id, snapshot);
      } else {
        if (resumePendingRef.current) return;
        ingestSnapshot(id, snapshot);
      }
      pollCountRef.current += 1;
      if (pollCountRef.current % 5 === 0) {
        const info = await invoke<RloginBackendSession>(
          "get_rlogin_session_info",
          { sessionId: id },
        ).catch(() => null);
        if (
          info &&
          mountedRef.current &&
          pollingGenerationRef.current === generation &&
          backendRef.current === id &&
          renderActiveRef.current &&
          resumeGenerationRef.current === resumeGeneration
        ) {
          applyBackendSession(info);
        }
      }
    },
    [applyBackendSession, finishActivationReplay, ingestSnapshot],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollCountRef.current = 0;
      const generation = pollingGenerationRef.current;
      pollingRegistrationRef.current = rloginPollingScheduler.register(
        () => executeSnapshotPoll(id, generation),
        renderActiveRef.current,
      );
    },
    [executeSnapshotPoll, stopPolling],
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
      renderedOutputRef.current = [];
      renderedOutputBytesRef.current = 0;
      heldOutputRef.current = createHeldOutputBuffer();
      resumeGenerationRef.current += 1;
      resumePendingRef.current = renderActiveRef.current;
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

  useLayoutEffect(() => {
    if (renderActiveRef.current === isRenderActive) return;
    renderActiveRef.current = isRenderActive;
    resumeGenerationRef.current += 1;
    resumePendingRef.current = isRenderActive;
    pollingRegistrationRef.current?.setActive(isRenderActive);
  }, [isRenderActive]);

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
      heldOutputRef.current = createHeldOutputBuffer();
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
