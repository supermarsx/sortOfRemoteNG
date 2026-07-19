import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { normalizePowerShellRemotingSettings } from "../../utils/powershell/normalizePowerShellRemoting";
import { resolveRuntimeNetworkPath } from "../../utils/network/resolveRuntimeNetworkPath";
import {
  buildPowerShellSessionOptions,
  PowerShellSequenceCursor,
  type PowerShellBackendSession,
  type PowerShellEventEnvelope,
  type PowerShellEventReplay,
  type PowerShellPipelineInput,
  type PowerShellPipelineStarted,
  type PowerShellSessionEvent,
  type PowerShellSessionPhase,
} from "./powerShellSessionRuntime";

export type PowerShellViewerStatus = "connecting" | PowerShellSessionPhase;

export interface PowerShellSessionModel {
  transport: "ssh" | "wsman";
  status: PowerShellViewerStatus;
  error: string | null;
  backendSessionId: string | null;
  backend: PowerShellBackendSession | null;
  events: PowerShellSessionEvent[];
  replayTruncated: boolean;
  execute(
    script: string,
    acceptsInput: boolean,
  ): Promise<PowerShellPipelineStarted>;
  sendInput(value: PowerShellPipelineInput): Promise<void>;
  endInput(): Promise<void>;
  cancel(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  clear(): void;
}

const MAX_FRONTEND_EVENTS = 2_048;

const isLivePhase = (phase: PowerShellSessionPhase): boolean =>
  phase !== "closed" && phase !== "failed";

export function usePowerShellSession(
  session: ConnectionSession,
): PowerShellSessionModel {
  const { state, dispatch } = useConnections();
  const connection = state.connections.find(
    (candidate) => candidate.id === session.connectionId,
  );
  const settings = useMemo(
    () =>
      normalizePowerShellRemotingSettings(connection?.powerShellRemoting)
        .settings,
    [connection?.powerShellRemoting],
  );
  const [status, setStatus] = useState<PowerShellViewerStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [backend, setBackend] = useState<PowerShellBackendSession | null>(null);
  const [events, setEvents] = useState<PowerShellSessionEvent[]>([]);
  const [replayTruncated, setReplayTruncated] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef<Connection | undefined>(connection);
  connectionRef.current = connection;
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const cursorRef = useRef(new PowerShellSequenceCursor());
  const mountedRef = useRef(true);
  const preserveOnUnmountRef = useRef(false);
  const channelGenerationRef = useRef(0);
  const initializedTokenRef = useRef<string | null>(null);
  const initializePromiseRef = useRef<Promise<void> | null>(null);
  const cleanupControllerRef = useRef<AbortController | null>(null);

  const updateFrontendSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const applyBackend = useCallback(
    (next: PowerShellBackendSession) => {
      if (!mountedRef.current) return;
      backendRef.current = next.id;
      setBackendSessionId(next.id);
      setBackend(next);
      setStatus(next.phase);
      updateFrontendSession({
        backendSessionId: next.id,
        status: isLivePhase(next.phase)
          ? "connected"
          : next.phase === "failed"
            ? "error"
            : "disconnected",
        errorMessage:
          next.phase === "failed"
            ? `PowerShell session failed (${next.terminalErrorCode || "protocol_failed"}).`
            : undefined,
      });
    },
    [updateFrontendSession],
  );

  const refresh = useCallback(async () => {
    const id = backendRef.current;
    if (!id) return;
    const next = await invoke<PowerShellBackendSession>(
      "get_powershell_session",
      {
        sessionId: id,
      },
    );
    applyBackend(next);
  }, [applyBackend]);

  const acceptEvent = useCallback(
    (envelope: PowerShellEventEnvelope) => {
      if (
        !mountedRef.current ||
        !cursorRef.current.accept(envelope.event.sequence)
      )
        return;
      const event = envelope.event;
      setEvents((current) => {
        const next = [...current, event];
        return next.length > MAX_FRONTEND_EVENTS
          ? next.slice(next.length - MAX_FRONTEND_EVENTS)
          : next;
      });

      if (event.kind === "session_state" || event.kind === "pipeline_state") {
        const nextPhase = event.pipelineState;
        if (
          nextPhase === "ready" ||
          nextPhase === "running" ||
          nextPhase === "cancelling" ||
          nextPhase === "closing" ||
          nextPhase === "closed" ||
          nextPhase === "failed"
        ) {
          setStatus(nextPhase);
        }
        if (
          nextPhase === "completed" ||
          nextPhase === "failed" ||
          nextPhase === "stopped" ||
          event.kind === "session_state"
        ) {
          void refresh().catch(() => undefined);
        }
      }
    },
    [refresh],
  );

  const createChannel = useCallback(() => {
    const generation = ++channelGenerationRef.current;
    return new Channel<PowerShellEventEnvelope>((envelope) => {
      if (mountedRef.current && channelGenerationRef.current === generation) {
        acceptEvent(envelope);
      }
    });
  }, [acceptEvent]);

  const ingestReplay = useCallback(
    (replay: PowerShellEventReplay) => {
      setReplayTruncated((current) => current || replay.truncated);
      for (const event of replay.events) acceptEvent({ event, replayed: true });
    },
    [acceptEvent],
  );

  const markConnected = useCallback(
    (id: string, recordConnection: boolean) => {
      setError(null);
      updateFrontendSession({
        backendSessionId: id,
        status: "connected",
        errorMessage: undefined,
      });
      const current = connectionRef.current;
      if (current && recordConnection) {
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...current,
            lastConnected: new Date().toISOString(),
            connectionCount: (current.connectionCount ?? 0) + 1,
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
        throw new Error("PowerShell connection settings are unavailable.");
      }
      const existingId = backendRef.current;
      const eventChannel = createChannel();

      if (existingId && !forceNew) {
        const info = await invoke<PowerShellBackendSession>(
          "get_powershell_session",
          { sessionId: existingId },
        );
        if (!isLivePhase(info.phase)) {
          throw new Error("The detached PowerShell backend session has ended.");
        }
        applyBackend(info);
        const replay = await invoke<PowerShellEventReplay>(
          "attach_powershell_session",
          {
            sessionId: existingId,
            afterSequence: cursorRef.current.value || null,
            eventChannel,
          },
        );
        ingestReplay(replay);
        preserveOnUnmountRef.current = false;
        markConnected(existingId, false);
        return;
      }

      // Shared connection/proxy/tunnel/VPN routes are intentionally not
      // materialized by the current PowerShell backend. Resolve the canonical
      // path before opening or replacing a backend actor so any configured
      // route fails closed instead of being silently bypassed. Reattachment to
      // an already-live detached actor remains unaffected above.
      await resolveRuntimeNetworkPath(
        currentConnection,
        connectionsRef.current,
        "powershell",
      );

      if (existingId && forceNew) {
        await invoke("close_powershell_session", {
          sessionId: existingId,
        }).catch(() => undefined);
      }
      backendRef.current = null;
      setBackendSessionId(null);
      setBackend(null);
      setEvents([]);
      setReplayTruncated(false);
      cursorRef.current.reset();

      const options = buildPowerShellSessionOptions(
        currentConnection,
        settingsRef.current,
      );
      const id = await invoke<string>("open_powershell_session", {
        options,
        eventChannel,
      });
      backendRef.current = id;
      setBackendSessionId(id);
      preserveOnUnmountRef.current = false;
      await refresh();
      markConnected(id, true);
    },
    [applyBackend, createChannel, ingestReplay, markConnected, refresh],
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
          const safe = sanitizeBehaviorText(cause);
          setStatus("failed");
          setError(safe || "PowerShell remoting failed.");
          updateFrontendSession({
            status: "error",
            errorMessage: safe || "PowerShell remoting failed.",
          });
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
    startInitialize(
      forceNew,
      forceNew ? `reconnect:${reconnectAttempt}` : "initial",
    );
  }, [reconnectAttempt, session.status, startInitialize]);

  useEffect(() => {
    mountedRef.current = true;
    const preserveForDetach = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId === sessionRef.current.id) {
        preserveOnUnmountRef.current = true;
      }
    };
    window.addEventListener("sorng:session-will-detach", preserveForDetach);
    cleanupControllerRef.current?.abort();
    const cleanupController = new AbortController();
    cleanupControllerRef.current = cleanupController;
    return () => {
      mountedRef.current = false;
      window.removeEventListener(
        "sorng:session-will-detach",
        preserveForDetach,
      );
      queueMicrotask(() => {
        if (
          mountedRef.current ||
          cleanupController.signal.aborted ||
          !backendRef.current
        ) {
          return;
        }
        const preserve =
          preserveOnUnmountRef.current ||
          sessionRef.current.layout?.isDetached === true;
        void invoke(
          preserve ? "detach_powershell_session" : "close_powershell_session",
          { sessionId: backendRef.current },
        ).catch(() => undefined);
      });
    };
  }, []);

  const execute = useCallback(
    async (script: string, acceptsInput: boolean) => {
      const id = backendRef.current;
      if (!id) throw new Error("PowerShell session is not connected.");
      const started = await invoke<PowerShellPipelineStarted>(
        "start_powershell_pipeline",
        { sessionId: id, script, acceptsInput },
      );
      await refresh();
      return started;
    },
    [refresh],
  );

  const sendInput = useCallback(
    async (input: PowerShellPipelineInput) => {
      const id = backendRef.current;
      if (!id) throw new Error("PowerShell session is not connected.");
      await invoke("write_powershell_pipeline_input", { sessionId: id, input });
      await refresh();
    },
    [refresh],
  );

  const endInput = useCallback(async () => {
    const id = backendRef.current;
    if (!id) throw new Error("PowerShell session is not connected.");
    await invoke("end_powershell_pipeline_input", { sessionId: id });
    await refresh();
  }, [refresh]);

  const cancel = useCallback(async () => {
    const id = backendRef.current;
    if (!id) throw new Error("PowerShell session is not connected.");
    await invoke("cancel_powershell_pipeline", { sessionId: id });
    await refresh();
  }, [refresh]);

  const reconnect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    await initialize(true);
  }, [initialize]);

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (!id) return;
    preserveOnUnmountRef.current = false;
    await invoke("close_powershell_session", { sessionId: id });
    setStatus("closed");
    updateFrontendSession({ status: "disconnected", errorMessage: undefined });
  }, [updateFrontendSession]);

  const clear = useCallback(() => setEvents([]), []);

  return {
    transport: settings.transport,
    status,
    error,
    backendSessionId,
    backend,
    events,
    replayTruncated,
    execute,
    sendInput,
    endInput,
    cancel,
    reconnect,
    disconnect,
    clear,
  };
}
