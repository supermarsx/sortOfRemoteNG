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
const MAX_PENDING_OUTPUT_CHUNKS = 64;
const MAX_PENDING_OUTPUT_BYTES = 256 * 1024;
const MAX_PENDING_SESSION_CANDIDATES = 4;
const MAX_SERIAL_EVENT_BYTES = 1024 * 1024;
const MAX_SERIAL_EVENT_BASE64_CHARS =
  Math.ceil(MAX_SERIAL_EVENT_BYTES / 3) * 4 + 4;
const MAX_SERIAL_WRITE_BYTES = 1024 * 1024;
const MAX_SERIAL_SESSION_ID_CHARS = 128;
const MAX_SERIAL_EVENT_MESSAGE_CHARS = 4_096;

interface PendingSerialOutputBucket {
  chunks: Uint8Array[];
  bytes: number;
  droppedBytes: number;
  malformedOutput: boolean;
  error: { message: string; recoverable: boolean } | null;
  closedReason: string | null;
  controlLines: SerialControlLines | null;
}

const boundedSerialEventMessage = (value: unknown, fallback: string): string => {
  const raw =
    typeof value === "string"
      ? value.slice(0, MAX_SERIAL_EVENT_MESSAGE_CHARS)
      : fallback;
  return sanitizeBehaviorText(raw).slice(0, MAX_SERIAL_EVENT_MESSAGE_CHARS);
};

const isSerialControlLines = (value: unknown): value is SerialControlLines => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (["dtr", "rts", "cts", "dsr", "ri", "dcd"] as const).every(
    (line) => typeof candidate[line] === "boolean",
  );
};

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
  if (typeof data !== "string" || data.length > MAX_SERIAL_EVENT_BASE64_CHARS) {
    throw new Error("Serial output event exceeds the 1 MiB limit.");
  }
  const binary = atob(data);
  if (binary.length > MAX_SERIAL_EVENT_BYTES) {
    throw new Error("Serial output event exceeds the 1 MiB limit.");
  }
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
  const connectingRef = useRef(false);
  const pendingOutputRef = useRef<Map<string, PendingSerialOutputBucket>>(
    new Map(),
  );

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
      const sessionChanged = backendRef.current !== backend.id;
      const pending = pendingOutputRef.current.get(backend.id);
      const pendingForSession = pending?.chunks ?? [];
      pendingOutputRef.current.clear();
      connectingRef.current = false;

      if (
        pending?.closedReason !== null &&
        pending?.closedReason !== undefined
      ) {
        backendRef.current = null;
        setBackendSessionId(null);
        setControlLines(pending.controlLines ?? backend.controlLines);
        setOutputChunks((current) => {
          let next: readonly Uint8Array[] = sessionChanged ? [] : current;
          for (const chunk of pendingForSession) {
            next = appendBoundedOutput(next, chunk);
          }
          return next;
        });
        setStatus("disconnected");
        setError(pending.closedReason);
        updateSession({
          backendSessionId: undefined,
          status: "disconnected",
          errorMessage: pending.closedReason,
        });
        void invoke("serial_disconnect", { sessionId: backend.id }).catch(
          () => {},
        );
        return;
      }

      backendRef.current = backend.id;
      setBackendSessionId(backend.id);
      setControlLines(pending?.controlLines ?? backend.controlLines);
      setOutputChunks((current) => {
        let next: readonly Uint8Array[] = sessionChanged ? [] : current;
        for (const chunk of pendingForSession) {
          next = appendBoundedOutput(next, chunk);
        }
        return next;
      });

      const fatalError =
        pending?.error && !pending.error.recoverable
          ? pending.error.message
          : null;
      const warning =
        pending?.error?.message ??
        (pending?.malformedOutput
          ? "Malformed early serial output was discarded."
          : pending && pending.droppedBytes > 0
            ? "Some early serial output was discarded to enforce the 256 KiB safety limit."
            : null);
      const nextStatus: SerialStatus = fatalError ? "error" : "connected";
      setStatus(nextStatus);
      setError(fatalError ?? warning);
      updateSession({
        backendSessionId: backend.id,
        status: nextStatus,
        errorMessage: fatalError ?? warning ?? undefined,
      });
    },
    [updateSession],
  );

  const markError = useCallback(
    (value: unknown) => {
      const raw =
        value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : "Serial operation failed.";
      const message = sanitizeBehaviorText(
        raw.slice(0, MAX_SERIAL_EVENT_MESSAGE_CHARS),
      ).slice(0, MAX_SERIAL_EVENT_MESSAGE_CHARS);
      connectingRef.current = false;
      pendingOutputRef.current.clear();
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
      connectingRef.current = true;
      pendingOutputRef.current.clear();

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
        backendRef.current = null;
        setBackendSessionId(null);
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
    const pendingOutput = pendingOutputRef.current;

    const pendingBucketFor = (sessionId: string): PendingSerialOutputBucket => {
      const existing = pendingOutput.get(sessionId);
      if (existing) return existing;

      if (pendingOutput.size >= MAX_PENDING_SESSION_CANDIDATES) {
        const oldest = pendingOutput.keys().next().value;
        if (oldest !== undefined) pendingOutput.delete(oldest);
      }

      const bucket: PendingSerialOutputBucket = {
        chunks: [],
        bytes: 0,
        droppedBytes: 0,
        malformedOutput: false,
        error: null,
        closedReason: null,
        controlLines: null,
      };
      pendingOutput.set(sessionId, bucket);
      return bucket;
    };

    const appendEventOutput = (payload: SerialOutputEvent) => {
      if (
        !payload ||
        typeof payload.sessionId !== "string" ||
        payload.sessionId.length === 0 ||
        payload.sessionId.length > MAX_SERIAL_SESSION_ID_CHARS
      ) {
        return;
      }

      const activeSessionId = backendRef.current;
      const isActiveSession = payload.sessionId === activeSessionId;
      if (!isActiveSession && !connectingRef.current) {
        return;
      }

      if (typeof payload.data !== "string") {
        if (isActiveSession) {
          markError("The serial backend emitted malformed output data.");
        } else {
          pendingBucketFor(payload.sessionId).malformedOutput = true;
        }
        return;
      }

      try {
        const chunk = decodeSerialEventData(payload.data);
        if (isActiveSession) {
          setOutputChunks((current) => appendBoundedOutput(current, chunk));
          return;
        }

        if (chunk.byteLength === 0) return;
        const bucket = pendingBucketFor(payload.sessionId);
        let retained = chunk;
        if (retained.byteLength > MAX_PENDING_OUTPUT_BYTES) {
          bucket.droppedBytes += retained.byteLength - MAX_PENDING_OUTPUT_BYTES;
          retained = retained.slice(
            retained.byteLength - MAX_PENDING_OUTPUT_BYTES,
          );
        }
        bucket.chunks.push(retained);
        bucket.bytes += retained.byteLength;
        while (
          bucket.chunks.length > MAX_PENDING_OUTPUT_CHUNKS ||
          bucket.bytes > MAX_PENDING_OUTPUT_BYTES
        ) {
          const removedBytes = bucket.chunks.shift()?.byteLength ?? 0;
          bucket.bytes -= removedBytes;
          bucket.droppedBytes += removedBytes;
        }
      } catch {
        if (isActiveSession) {
          markError("The serial backend emitted malformed output data.");
        } else {
          pendingBucketFor(payload.sessionId).malformedOutput = true;
        }
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
              const payload = event.payload;
              if (
                !payload ||
                typeof payload.sessionId !== "string" ||
                payload.sessionId.length === 0 ||
                payload.sessionId.length > MAX_SERIAL_SESSION_ID_CHARS
              ) {
                return;
              }
              const message = boundedSerialEventMessage(
                payload.message,
                "The serial backend reported an error.",
              );
              if (payload.sessionId === backendRef.current) {
                if (payload.recoverable === true) {
                  setError(message);
                } else {
                  markError(message);
                }
              } else if (connectingRef.current) {
                pendingBucketFor(payload.sessionId).error = {
                  message,
                  recoverable: payload.recoverable === true,
                };
              }
            }),
          )) ||
          !(await register(
            listen<SerialClosedEvent>("serial:closed", (event) => {
              const payload = event.payload;
              if (
                !payload ||
                typeof payload.sessionId !== "string" ||
                payload.sessionId.length === 0 ||
                payload.sessionId.length > MAX_SERIAL_SESSION_ID_CHARS
              ) {
                return;
              }
              const reason = boundedSerialEventMessage(
                payload.reason,
                "The serial session closed.",
              );
              if (payload.sessionId !== backendRef.current) {
                if (connectingRef.current) {
                  pendingBucketFor(payload.sessionId).closedReason = reason;
                }
                return;
              }
              connectingRef.current = false;
              pendingOutput.clear();
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
              const payload = event.payload;
              if (
                !payload ||
                typeof payload.sessionId !== "string" ||
                payload.sessionId.length === 0 ||
                payload.sessionId.length > MAX_SERIAL_SESSION_ID_CHARS ||
                !isSerialControlLines(payload.lines)
              ) {
                return;
              }
              if (payload.sessionId === backendRef.current) {
                setControlLines(payload.lines);
              } else if (connectingRef.current) {
                pendingBucketFor(payload.sessionId).controlLines =
                  payload.lines;
              }
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
      connectingRef.current = false;
      pendingOutput.clear();
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
    if (data.byteLength > MAX_SERIAL_WRITE_BYTES) {
      throw new Error("Serial write exceeds the 1 MiB limit.");
    }
    const payload = Array.from(data);
    try {
      await invoke("serial_send_raw", {
        sessionId,
        data: payload,
      });
    } finally {
      payload.fill(0);
    }
  }, []);

  const sendInput = useCallback(
    async (data: string) => {
      const encoded = encodeSerialTerminalInput(
        data,
        settingsRef.current.lineEnding,
      );
      try {
        await sendBytes(encoded);
      } finally {
        encoded.fill(0);
      }
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
      connectingRef.current = false;
      pendingOutputRef.current.clear();
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
