import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  normalizeSerialSettings,
  toNativeSerialConfig,
  type SerialBackendSession,
  type SerialControlLines,
  type SerialLineEnding,
} from "../../types/protocols/serial";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type SerialStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface SerialOutputEvent {
  sessionId: string;
  data: string;
  text: string;
}

interface SerialErrorEvent {
  sessionId: string;
  message: string;
  recoverable: boolean;
}

interface SerialClosedEvent {
  sessionId: string;
  reason: string;
}

interface SerialControlLinesEvent {
  sessionId: string;
  lines: SerialControlLines;
}

const MAX_OUTPUT_CHUNKS = 2_048;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const EMPTY_CONTROL_LINES: SerialControlLines = {
  dtr: false,
  rts: false,
  cts: false,
  dsr: false,
  ri: false,
  dcd: false,
};

const LINE_ENDINGS: Readonly<Record<SerialLineEnding, string>> = {
  none: "",
  cr: "\r",
  lf: "\n",
  crLf: "\r\n",
};

export function encodeSerialTerminalInput(
  input: string,
  lineEnding: SerialLineEnding,
): Uint8Array {
  const normalized = input.replace(/\r\n|\r|\n/g, LINE_ENDINGS[lineEnding]);
  return new TextEncoder().encode(normalized);
}

export function decodeSerialEventData(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const appendBoundedOutput = (
  current: readonly Uint8Array[],
  chunk: Uint8Array,
): readonly Uint8Array[] => {
  if (chunk.byteLength === 0) return current;
  const next = [...current, chunk];
  let bytes = next.reduce((total, value) => total + value.byteLength, 0);
  while (next.length > MAX_OUTPUT_CHUNKS || bytes > MAX_OUTPUT_BYTES) {
    bytes -= next.shift()?.byteLength ?? 0;
  }
  return next;
};

export function useSerialSession(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const settings = normalizeSerialSettings(connection?.serialSettings);
  const [status, setStatus] = useState<SerialStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [outputChunks, setOutputChunks] = useState<readonly Uint8Array[]>([]);
  const [controlLines, setControlLines] =
    useState<SerialControlLines>(EMPTY_CONTROL_LINES);
  const [requestedDtr, setRequestedDtr] = useState(settings.dtrOnOpen);
  const [requestedRts, setRequestedRts] = useState(settings.rtsOnOpen);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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

  const markConnected = useCallback(
    (backend: SerialBackendSession) => {
      backendRef.current = backend.id;
      setBackendSessionId(backend.id);
      setControlLines(backend.controlLines);
      setStatus("connected");
      setError(null);
      updateSession({
        backendSessionId: backend.id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const markError = useCallback(
    (value: unknown) => {
      const message = sanitizeBehaviorText(
        value instanceof Error ? value.message : String(value),
      );
      setStatus("error");
      setError(message);
      updateSession({ status: "error", errorMessage: message });
    },
    [updateSession],
  );

  const initialize = useCallback(
    async (generation: number) => {
      const currentConnection = connectionRef.current;
      if (!currentConnection) {
        markError("The saved Serial connection could not be found.");
        return;
      }

      const currentSettings = normalizeSerialSettings(
        currentConnection.serialSettings,
      );
      if (!currentSettings.portName) {
        markError("Choose a local serial device before connecting.");
        return;
      }

      setStatus("connecting");
      setError(null);

      const previousId = sessionRef.current.backendSessionId;
      if (previousId) {
        const existing = await invoke<SerialBackendSession>(
          "serial_get_session_info",
          { sessionId: previousId },
        ).catch(() => null);
        if (generationRef.current !== generation) return;
        if (existing?.state === "connected") {
          markConnected(existing);
          return;
        }
      }

      try {
        const backend = await invoke<SerialBackendSession>("serial_connect", {
          config: toNativeSerialConfig(currentSettings, currentConnection.name),
        });
        if (generationRef.current !== generation) {
          await invoke("serial_disconnect", {
            sessionId: backend.id,
          }).catch(() => {});
          return;
        }
        if (backend.state !== "connected") {
          throw new Error(
            `Serial backend returned an unexpected ${backend.state} state.`,
          );
        }
        markConnected(backend);
      } catch (connectError) {
        if (generationRef.current === generation) markError(connectError);
      }
    },
    [markConnected, markError],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    const unlisteners: UnlistenFn[] = [];

    const appendEventOutput = (payload: SerialOutputEvent) => {
      if (payload.sessionId !== backendRef.current) return;
      try {
        const chunk = decodeSerialEventData(payload.data);
        setOutputChunks((current) => appendBoundedOutput(current, chunk));
      } catch {
        setError("The serial backend emitted malformed output data.");
      }
    };

    const start = async () => {
      const register = async (registration: Promise<UnlistenFn>) => {
        const unlisten = await registration;
        if (generationRef.current !== generation) {
          unlisten();
          return false;
        }
        unlisteners.push(unlisten);
        return true;
      };

      try {
        if (
          !(await register(
            listen<SerialOutputEvent>("serial:output", (event) =>
              appendEventOutput(event.payload),
            ),
          )) ||
          !(await register(
            listen<SerialOutputEvent>("serial:echo", (event) =>
              appendEventOutput(event.payload),
            ),
          )) ||
          !(await register(
            listen<SerialErrorEvent>("serial:error", (event) => {
              if (event.payload.sessionId !== backendRef.current) return;
              if (event.payload.recoverable) {
                setError(sanitizeBehaviorText(event.payload.message));
              } else {
                markError(event.payload.message);
              }
            }),
          )) ||
          !(await register(
            listen<SerialClosedEvent>("serial:closed", (event) => {
              if (event.payload.sessionId !== backendRef.current) return;
              const reason = sanitizeBehaviorText(event.payload.reason);
              backendRef.current = null;
              setBackendSessionId(null);
              setStatus("disconnected");
              setError(reason || null);
              updateSession({
                backendSessionId: undefined,
                status: "disconnected",
                errorMessage: reason || undefined,
              });
            }),
          )) ||
          !(await register(
            listen<SerialControlLinesEvent>("serial:control-lines", (event) => {
              if (event.payload.sessionId !== backendRef.current) return;
              setControlLines(event.payload.lines);
            }),
          ))
        ) {
          return;
        }
      } catch (registrationError) {
        unlisteners.splice(0).forEach((unlisten) => unlisten());
        throw registrationError;
      }

      await initialize(generation);
    };

    void start().catch(markError);
    return () => {
      generationRef.current += 1;
      unlisteners.forEach((unlisten) => unlisten());
      const sessionId = backendRef.current;
      backendRef.current = null;
      if (sessionId) {
        void invoke("serial_disconnect", { sessionId }).catch(() => {});
      }
    };
  }, [initialize, markError, session.id, updateSession]);

  const sendBytes = useCallback(async (data: Uint8Array) => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    if (data.byteLength === 0) return;
    await invoke("serial_send_raw", {
      sessionId,
      data: Array.from(data),
    });
  }, []);

  const sendInput = useCallback(
    async (data: string) => {
      await sendBytes(
        encodeSerialTerminalInput(data, settingsRef.current.lineEnding),
      );
    },
    [sendBytes],
  );

  const sendBreak = useCallback(async (durationMs = 250) => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    await invoke("serial_send_break", { sessionId, durationMs });
  }, []);

  const flush = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    await invoke("serial_flush", { sessionId });
  }, []);

  const setDtr = useCallback(async (state: boolean) => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    await invoke("serial_set_dtr", { sessionId, state });
    setRequestedDtr(state);
  }, []);

  const setRts = useCallback(async (state: boolean) => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    await invoke("serial_set_rts", { sessionId, state });
    setRequestedRts(state);
  }, []);

  const refreshControlLines = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Serial is not connected.");
    const lines = await invoke<SerialControlLines>(
      "serial_read_control_lines",
      { sessionId },
    );
    setControlLines(lines);
    return lines;
  }, []);

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    try {
      if (sessionId) await invoke("serial_disconnect", { sessionId });
    } finally {
      backendRef.current = null;
      setBackendSessionId(null);
      setStatus("disconnected");
      setError(null);
      updateSession({
        backendSessionId: undefined,
        status: "disconnected",
        errorMessage: undefined,
      });
    }
  }, [updateSession]);

  return {
    status,
    error,
    backendSessionId,
    settings,
    outputChunks,
    controlLines,
    requestedDtr,
    requestedRts,
    sendBytes,
    sendInput,
    sendBreak,
    flush,
    setDtr,
    setRts,
    refreshControlLines,
    disconnect,
  };
}
