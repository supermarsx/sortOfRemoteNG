import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  hasSerialMatchFilter,
  normalizeSerialSettings,
  toNativeSerialConfig,
  type SerialBackendSession,
  type SerialControlLines,
  type SerialLineEnding,
  type SerialPortSelectionMode,
} from "../../types/protocols/serial";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { shouldDisconnectOnUnmount } from "../../utils/session/closeIntent";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import { SerialOutputStream, SerialSendQueue } from "./serialIo";

export type SerialStatus =
  "connecting" | "connected" | "disconnected" | "error";

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

const PORT_NOT_FOUND_PREFIX = "PortNotFound:";

/** Friendly copy for the common "cannot open the port" failures. */
function describeOpenFailure(raw: string): string {
  if (/access is denied|permission denied|EACCES/i.test(raw)) {
    return `The serial port is busy or access was denied. Close any other program using it (another terminal, PuTTY, a flashing tool) or, on Linux, add your user to the dialout group.\n${raw}`;
  }
  if (/resource busy|EBUSY/i.test(raw)) {
    return `The serial port is already in use by another program. Close it and reconnect.\n${raw}`;
  }
  if (
    /cannot find the (file|path)|no such file|ENOENT|ENODEV|device not configured/i.test(
      raw,
    )
  ) {
    return `The serial port was not found. It may have been unplugged; reconnect the adapter and try again.\n${raw}`;
  }
  return raw;
}

/** Short human labels for the auto selection modes (badge + error copy). */
export const SERIAL_SELECTION_MODE_LABELS: Readonly<
  Record<SerialPortSelectionMode, string>
> = Object.freeze({
  fixed: "fixed device",
  firstAny: "first device",
  firstUsb: "first USB",
  match: "match",
});

/**
 * Map a backend `PortNotFound: …` rejection to a friendly message; every other
 * message is returned unchanged.
 */
export function describeSerialConnectError(
  raw: string,
  mode: SerialPortSelectionMode,
): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith(PORT_NOT_FOUND_PREFIX)) {
    return describeOpenFailure(raw);
  }
  const detail = trimmed.slice(PORT_NOT_FOUND_PREFIX.length).trim();
  const headline = `No serial device is attached that matches "${SERIAL_SELECTION_MODE_LABELS[mode]}". Plug in the adapter and reconnect.`;
  return detail ? `${headline}\n${detail}` : headline;
}

/**
 * Friendly copy for the backend's runtime write failures. Unknown messages are
 * returned unchanged.
 */
export function describeSerialRuntimeError(raw: string): string {
  if (/^Serial write timed out/i.test(raw)) {
    return `The serial device did not accept the data in time (check flow control, cabling, or that the device is powered).
${raw}`;
  }
  if (/Serial command dropped: it waited in the queue/i.test(raw)) {
    return `Input was dropped because the serial port could not keep up. Slow down pasting or check the link.
${raw}`;
  }
  if (/^Serial command completion timed out/i.test(raw)) {
    return `The serial port stopped responding while sending. The adapter may be stalled or unplugged.
${raw}`;
  }
  return raw;
}

const boundedSerialEventMessage = (
  value: unknown,
  fallback: string,
): string => {
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
  // Output lives in a ref-style stream (no per-chunk React state). The
  // version counter only re-renders consumers that have not subscribed.
  const outputStreamRef = useRef<SerialOutputStream | null>(null);
  if (outputStreamRef.current === null) {
    outputStreamRef.current = new SerialOutputStream();
  }
  const outputStream = outputStreamRef.current;
  const [, setOutputVersion] = useState(0);
  const pushOutput = useCallback(
    (chunk: Uint8Array) => {
      outputStream.append(chunk);
      if (outputStream.subscriberCount === 0) {
        setOutputVersion((value) => value + 1);
      }
    },
    [outputStream],
  );
  const resetOutput = useCallback(() => {
    outputStream.reset();
    if (outputStream.subscriberCount === 0) {
      setOutputVersion((value) => value + 1);
    }
  }, [outputStream]);
  const [sendBacklogged, setSendBacklogged] = useState(false);
  const [controlLines, setControlLines] =
    useState<SerialControlLines>(EMPTY_CONTROL_LINES);
  const [requestedDtr, setRequestedDtr] = useState(settings.dtrOnOpen);
  const [requestedRts, setRequestedRts] = useState(settings.rtsOnOpen);
  const [resolvedPortName, setResolvedPortName] = useState<string | null>(null);
  const [resolvedDisplayName, setResolvedDisplayName] = useState<string | null>(
    null,
  );
  const [autoSelected, setAutoSelected] = useState(false);

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
        if (sessionChanged) resetOutput();
        for (const chunk of pendingForSession) pushOutput(chunk);
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
      const wasAutoSelected = backend.autoSelected === true;
      const portName =
        typeof backend.portName === "string" && backend.portName.length > 0
          ? sanitizeBehaviorText(backend.portName).slice(0, 256)
          : null;
      const displayName =
        typeof backend.portDisplayName === "string" &&
        backend.portDisplayName.length > 0
          ? sanitizeBehaviorText(backend.portDisplayName).slice(0, 256)
          : null;
      setResolvedPortName(portName);
      setResolvedDisplayName(displayName);
      setAutoSelected(wasAutoSelected);
      setControlLines(pending?.controlLines ?? backend.controlLines);
      if (sessionChanged) resetOutput();
      for (const chunk of pendingForSession) pushOutput(chunk);

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
        // The resolved device is a display snapshot on the session only; it is
        // never written back into the connection record.
        ...(wasAutoSelected && portName ? { hostname: portName } : {}),
      });
    },
    [updateSession, pushOutput, resetOutput],
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
        describeSerialConnectError(
          raw.slice(0, MAX_SERIAL_EVENT_MESSAGE_CHARS),
          settingsRef.current.portSelection.mode,
        ),
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
      const selection = currentSettings.portSelection;
      if (selection.mode === "fixed" && !currentSettings.portName) {
        markError("Choose a local serial device before connecting.");
        return;
      }
      if (selection.mode === "match" && !hasSerialMatchFilter(selection)) {
        markError(
          "Add a VID, PID, or name filter for the matching serial device.",
        );
        return;
      }

      setStatus("connecting");
      setError(null);
      // Auto modes re-resolve on every connect; drop the previous snapshot so
      // a failed reconnect never shows a stale device name.
      setResolvedPortName(null);
      setResolvedDisplayName(null);
      setAutoSelected(false);
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

  // Declared before the main effect so its cleanup runs first on unmount.
  const unmountingRef = useRef(false);
  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
    };
  }, []);

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
          pushOutput(chunk);
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
              const message = describeSerialRuntimeError(
                boundedSerialEventMessage(
                  payload.message,
                  "The serial backend reported an error.",
                ),
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
      // A plain unmount (Fast Refresh, tab remount) must not kill a healthy
      // session: the next mount re-adopts session.backendSessionId. Only a
      // user close, or a dependency change, disconnects.
      const keepAlive =
        unmountingRef.current && !shouldDisconnectOnUnmount(session.id);
      if (sessionId && !keepAlive) {
        void invoke("serial_disconnect", { sessionId }).catch(() => {});
      }
    };
  }, [initialize, markError, pushOutput, session.id, updateSession]);

  const sendQueueRef = useRef<SerialSendQueue | null>(null);
  if (sendQueueRef.current === null) {
    sendQueueRef.current = new SerialSendQueue({
      write: async (data) => {
        const sessionId = backendRef.current;
        if (!sessionId) throw new Error("Serial is not connected.");
        // One IPC per coalesced batch; the number[] is built once here.
        const payload = Array.from(data);
        try {
          await invoke("serial_send_raw", { sessionId, data: payload });
        } finally {
          payload.fill(0);
        }
      },
      onBacklogChange: setSendBacklogged,
    });
  }
  const sendQueue = sendQueueRef.current;
  useEffect(
    () => () => {
      sendQueue.clear(new Error("Serial session closed."));
    },
    [sendQueue],
  );

  const sendBytes = useCallback(
    async (data: Uint8Array) => {
      if (!backendRef.current) throw new Error("Serial is not connected.");
      if (data.byteLength === 0) return;
      if (data.byteLength > MAX_SERIAL_WRITE_BYTES) {
        throw new Error("Serial write exceeds the 1 MiB limit.");
      }
      await sendQueue.enqueue(data);
    },
    [sendQueue],
  );

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
    outputStream,
    /** Snapshot of retained output; prefer subscribing to `outputStream`. */
    outputChunks: outputStream.snapshot(),
    sendBacklogged,
    controlLines,
    requestedDtr,
    requestedRts,
    resolvedPortName,
    resolvedDisplayName,
    autoSelected,
    selectionMode: settings.portSelection.mode,
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
