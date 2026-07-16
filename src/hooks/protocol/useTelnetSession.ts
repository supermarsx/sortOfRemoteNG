import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { bytesToHex } from "../../utils/protocols/rawSocket/codecs";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

type TelnetStatus = "connecting" | "connected" | "disconnected" | "error";

interface TelnetOutputEvent {
  session_id: string;
  data: string;
}

interface TelnetErrorEvent {
  session_id: string;
  message: string;
}

interface TelnetClosedEvent {
  session_id: string;
  reason: string;
}

const MAX_OUTPUT_CHUNKS = 2_048;
const MAX_OUTPUT_CHARACTERS = 1024 * 1024;

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
  const [status, setStatus] = useState<TelnetStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [outputChunks, setOutputChunks] = useState<readonly string[]>([]);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
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
      }

      try {
        const sessionId = await invoke<string>("connect_telnet", {
          config: {
            host: currentConnection.hostname || currentSession.hostname,
            port: currentConnection.port || 23,
            username: currentConnection.username || null,
            password: currentConnection.password || null,
            terminal_type: "xterm-256color",
            cols: 80,
            rows: 24,
            connect_timeout_secs: currentConnection.timeout || 15,
            local_echo: false,
            crlf_mode: true,
            binary_mode: false,
            suppress_go_ahead: true,
            max_reconnect_attempts: currentConnection.retryAttempts ?? 0,
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
          await invoke("disconnect_telnet", { sessionId }).catch(() => {});
          return;
        }
        markConnected(sessionId);
      } catch (connectError) {
        if (generationRef.current === generation) markError(connectError);
      }
    },
    [markConnected, markError],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    const unlisteners: UnlistenFn[] = [];

    const start = async () => {
      unlisteners.push(
        await listen<TelnetOutputEvent>("telnet-output", (event) => {
          if (event.payload.session_id !== backendRef.current) return;
          setOutputChunks((current) =>
            appendBoundedOutput(current, event.payload.data),
          );
        }),
        await listen<TelnetErrorEvent>("telnet-error", (event) => {
          if (event.payload.session_id !== backendRef.current) return;
          markError(event.payload.message);
        }),
        await listen<TelnetClosedEvent>("telnet-closed", (event) => {
          if (event.payload.session_id !== backendRef.current) return;
          const reason = sanitizeBehaviorText(event.payload.reason);
          setStatus("disconnected");
          setError(reason || null);
          updateSession({
            status: "disconnected",
            errorMessage: reason || undefined,
          });
        }),
      );
      if (generationRef.current === generation) {
        await initialize(generation);
      }
    };

    void start().catch(markError);
    return () => {
      generationRef.current += 1;
      unlisteners.forEach((unlisten) => unlisten());
      const sessionId = backendRef.current;
      backendRef.current = null;
      if (sessionId) {
        void invoke("disconnect_telnet", { sessionId }).catch(() => {});
      }
    };
  }, [initialize, markError, updateSession, session.id]);

  const sendInput = useCallback(async (data: string) => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("Telnet is not connected.");
    const hexData = bytesToHex(new TextEncoder().encode(data), {
      separator: "",
    });
    await invoke("send_telnet_raw", { sessionId, hexData });
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    await invoke("resize_telnet", { sessionId, cols, rows });
  }, []);

  const sendBreak = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    await invoke("send_telnet_break", { sessionId });
  }, []);

  const sendAreYouThere = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    await invoke("send_telnet_ayt", { sessionId });
  }, []);

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    if (sessionId) {
      await invoke("disconnect_telnet", { sessionId });
    }
    backendRef.current = null;
    setBackendSessionId(null);
    setStatus("disconnected");
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [updateSession]);

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
  };
}
