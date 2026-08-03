import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { bytesToHex } from "../../utils/protocols/rawSocket/codecs";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

type TelnetStatus =
  | "approval-required"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface TelnetOutputEvent {
  session_id: string;
  client_correlation_id?: string | null;
  data: string;
}

interface TelnetErrorEvent {
  session_id: string;
  client_correlation_id?: string | null;
  message: string;
}

interface TelnetClosedEvent {
  session_id: string;
  client_correlation_id?: string | null;
  reason: string;
}

interface TelnetEarlyFailure {
  correlationId: string;
  message: string;
}

const MAX_OUTPUT_CHUNKS = 2_048;
const MAX_OUTPUT_CHARACTERS = 1024 * 1024;
const MAX_ERROR_CHARACTERS = 2_048;

const boundedBehaviorMessage = (value: unknown): string =>
  sanitizeBehaviorText(
    value instanceof Error ? value.message : String(value),
  ).slice(0, MAX_ERROR_CHARACTERS);

const createConnectCorrelationId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes, { separator: "" });
};

const readEarlyFailure = (ref: {
  readonly current: TelnetEarlyFailure | null;
}): TelnetEarlyFailure | null => ref.current;

const appendBoundedOutput = (
  current: readonly string[],
  chunk: string,
): string[] => {
  const next = [...current, chunk];
  let characters = next.reduce((total, value) => total + value.length, 0);
  while (
    next.length > MAX_OUTPUT_CHUNKS ||
    characters > MAX_OUTPUT_CHARACTERS
  ) {
    characters -= next.shift()?.length ?? 0;
  }
  return next;
};

export function useTelnetSession(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const [status, setStatus] = useState<TelnetStatus>("approval-required");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [outputChunks, setOutputChunks] = useState<readonly string[]>([]);
  const [approvedSessionId, setApprovedSessionId] = useState<string | null>(
    null,
  );
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const insecureApproved = approvedSessionId === session.id;

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const generationRef = useRef(0);
  const connectCorrelationRef = useRef<string | null>(null);
  const earlyFailureRef = useRef<TelnetEarlyFailure | null>(null);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const markConnected = useCallback(
    (sessionId: string) => {
      backendRef.current = sessionId;
      setBackendSessionId(sessionId);
      setStatus("connected");
      setError(null);
      updateSession({
        backendSessionId: sessionId,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const markError = useCallback(
    (value: unknown) => {
      const message = boundedBehaviorMessage(value);
      setStatus("error");
      setError(message);
      updateSession({ status: "error", errorMessage: message });
    },
    [updateSession],
  );

  const initialize = useCallback(
    async (generation: number) => {
      const currentSession = sessionRef.current;
      const currentConnection = connectionRef.current;
      if (!currentConnection) {
        markError("The saved Telnet connection could not be found.");
        return;
      }

      setStatus("connecting");
      setError(null);

      const previousId = currentSession.backendSessionId;
      if (previousId) {
        const alive = await invoke<boolean>("is_telnet_connected", {
          sessionId: previousId,
        }).catch(() => false);
        if (generationRef.current !== generation) return;
        if (alive) {
          markConnected(previousId);
          return;
        }
        backendRef.current = null;
        setBackendSessionId(null);
        updateSession({ backendSessionId: undefined });
      }

      try {
        const correlationId = createConnectCorrelationId();
        connectCorrelationRef.current = correlationId;
        earlyFailureRef.current = null;
        const sessionId = await invoke<string>("connect_telnet", {
          config: {
            host: currentConnection.hostname || currentSession.hostname,
            client_correlation_id: correlationId,
            port: currentConnection.port || 23,
            allow_insecure_transport: true,
            username: null,
            password: null,
            terminal_type: "xterm-256color",
            cols: 80,
            rows: 24,
            connect_timeout_secs: currentConnection.timeout || 15,
            local_echo: false,
            crlf_mode: true,
            binary_mode: false,
            suppress_go_ahead: true,
            max_reconnect_attempts: 0,
            reconnect_delay_secs: currentConnection.retryDelay ?? 5,
            keepalive_interval_secs: 0,
            label: currentConnection.name || null,
            environment: {},
            encoding: "utf-8",
            terminal_speed: "38400,38400",
            escape_char: 0x1d,
          },
        });
        if (generationRef.current !== generation) {
          if (connectCorrelationRef.current === correlationId) {
            connectCorrelationRef.current = null;
            earlyFailureRef.current = null;
          }
          await invoke("disconnect_telnet", { sessionId }).catch(() => {});
          return;
        }
        const earlyFailure = readEarlyFailure(earlyFailureRef);
        if (earlyFailure?.correlationId === correlationId) {
          connectCorrelationRef.current = null;
          earlyFailureRef.current = null;
          await invoke("disconnect_telnet", { sessionId }).catch(() => {});
          backendRef.current = null;
          setBackendSessionId(null);
          setStatus("disconnected");
          setError(earlyFailure.message);
          updateSession({
            backendSessionId: undefined,
            status: "disconnected",
            errorMessage: earlyFailure.message,
          });
          return;
        }
        connectCorrelationRef.current = null;
        markConnected(sessionId);
      } catch (connectError) {
        if (generationRef.current === generation) {
          connectCorrelationRef.current = null;
          earlyFailureRef.current = null;
          markError(connectError);
        }
      }
    },
    [markConnected, markError, updateSession],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    const ownsEvent = (
      sessionId: string,
      clientCorrelationId?: string | null,
    ): boolean =>
      sessionId === backendRef.current ||
      (backendRef.current === null &&
        connectCorrelationRef.current !== null &&
        clientCorrelationId === connectCorrelationRef.current);

    if (!insecureApproved) {
      setStatus("approval-required");
      setError(null);
      return () => {
        disposed = true;
        generationRef.current += 1;
      };
    }

    const start = async () => {
      const outputUnlisten = await listen<TelnetOutputEvent>(
        "telnet-output",
        (event) => {
          if (
            generationRef.current !== generation ||
            !ownsEvent(
              event.payload.session_id,
              event.payload.client_correlation_id,
            )
          )
            return;
          setOutputChunks((current) =>
            appendBoundedOutput(current, event.payload.data),
          );
        },
      );
      if (disposed || generationRef.current !== generation) {
        outputUnlisten();
        return;
      }
      unlisteners.push(outputUnlisten);

      const errorUnlisten = await listen<TelnetErrorEvent>(
        "telnet-error",
        (event) => {
          if (
            generationRef.current !== generation ||
            !ownsEvent(
              event.payload.session_id,
              event.payload.client_correlation_id,
            )
          )
            return;
          const message = boundedBehaviorMessage(event.payload.message);
          const correlationId = event.payload.client_correlation_id;
          if (
            backendRef.current === null &&
            typeof correlationId === "string" &&
            correlationId === connectCorrelationRef.current
          ) {
            earlyFailureRef.current = {
              correlationId,
              message,
            };
          }
          markError(message);
        },
      );
      if (disposed || generationRef.current !== generation) {
        errorUnlisten();
        return;
      }
      unlisteners.push(errorUnlisten);

      const closedUnlisten = await listen<TelnetClosedEvent>(
        "telnet-closed",
        (event) => {
          if (
            generationRef.current !== generation ||
            !ownsEvent(
              event.payload.session_id,
              event.payload.client_correlation_id,
            )
          )
            return;
          const reason = boundedBehaviorMessage(event.payload.reason);
          const correlationId = event.payload.client_correlation_id;
          if (
            backendRef.current === null &&
            typeof correlationId === "string" &&
            correlationId === connectCorrelationRef.current
          ) {
            earlyFailureRef.current = {
              correlationId,
              message: reason || "Telnet connection closed during startup.",
            };
          }
          backendRef.current = null;
          setBackendSessionId(null);
          setStatus("disconnected");
          setError(reason || null);
          updateSession({
            backendSessionId: undefined,
            status: "disconnected",
            errorMessage: reason || undefined,
          });
        },
      );
      if (disposed || generationRef.current !== generation) {
        closedUnlisten();
        return;
      }
      unlisteners.push(closedUnlisten);

      if (generationRef.current === generation) {
        await initialize(generation);
      }
    };

    void start().catch((listenerError) => {
      unlisteners.splice(0).forEach((unlisten) => unlisten());
      if (!disposed && generationRef.current === generation) {
        markError(listenerError);
      }
    });
    return () => {
      disposed = true;
      generationRef.current += 1;
      connectCorrelationRef.current = null;
      earlyFailureRef.current = null;
      unlisteners.forEach((unlisten) => unlisten());
      const sessionId = backendRef.current;
      backendRef.current = null;
      if (sessionId) {
        void invoke("disconnect_telnet", { sessionId }).catch(() => {});
      }
    };
  }, [
    initialize,
    insecureApproved,
    markError,
    updateSession,
    session.id,
    reconnectGeneration,
  ]);

  const sendInput = useCallback(
    async (data: string) => {
      try {
        const sessionId = backendRef.current;
        if (!sessionId) throw new Error("Telnet is not connected.");
        const hexData = bytesToHex(new TextEncoder().encode(data), {
          separator: "",
        });
        await invoke("send_telnet_raw", { sessionId, hexData });
      } catch (sendError) {
        markError(sendError);
      }
    },
    [markError],
  );

  const resize = useCallback(
    async (cols: number, rows: number) => {
      const sessionId = backendRef.current;
      if (!sessionId) return;
      try {
        await invoke("resize_telnet", { sessionId, cols, rows });
      } catch (resizeError) {
        markError(resizeError);
      }
    },
    [markError],
  );

  const sendBreak = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    try {
      await invoke("send_telnet_break", { sessionId });
    } catch (controlError) {
      markError(controlError);
    }
  }, [markError]);

  const sendAreYouThere = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    try {
      await invoke("send_telnet_ayt", { sessionId });
    } catch (controlError) {
      markError(controlError);
    }
  }, [markError]);

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    if (sessionId) {
      try {
        await invoke("disconnect_telnet", { sessionId });
      } catch (disconnectError) {
        markError(disconnectError);
        return;
      }
    }
    backendRef.current = null;
    setBackendSessionId(null);
    setStatus("disconnected");
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [markError, updateSession]);

  const approveInsecureTransport = useCallback(() => {
    setApprovedSessionId(sessionRef.current.id);
  }, []);

  const reconnect = useCallback(() => {
    setError(null);
    setStatus("connecting");
    setReconnectGeneration((value) => value + 1);
  }, []);

  return {
    status,
    error,
    backendSessionId,
    outputChunks,
    sendInput,
    resize,
    sendBreak,
    sendAreYouThere,
    disconnect,
    requiresInsecureApproval: !insecureApproved,
    approveInsecureTransport,
    reconnect,
    savedCredentialsIgnored: Boolean(
      connection?.username || connection?.password,
    ),
  };
}
