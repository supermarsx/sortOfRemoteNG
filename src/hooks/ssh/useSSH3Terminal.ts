import { useCallback, useEffect, useRef, useState } from "react";
import {
  SSH3Client,
  type SSHLibraryConfig,
} from "../../utils/ssh/sshLibraries";

/* ──────────────────────────────────────────────────────────────────────────
 * useSSH3Terminal
 *
 * Thin React glue around the real `SSH3Client` (which drives the native
 * `ssh3_*` Tauri commands + `ssh3-*` events). It owns the client lifecycle and
 * surfaces the terminal-data / status callbacks so an xterm-style terminal
 * component can render an interactive SSH3 (HTTP/3 over QUIC) session WITHOUT
 * reimplementing the client transport.
 *
 * Reuses the existing SSH client infrastructure (`SSH3Client` extends the same
 * `BaseSSHClient` contract the terminal layer already speaks) rather than
 * building a parallel UI. The hook is intentionally small: terminal rendering
 * (xterm) stays in the terminal component; this hook is the connect/send/resize
 * /disconnect bridge.
 *
 * HONESTY: real-server interop is currently blocked on the extended-CONNECT
 * `:protocol = ssh3` pseudo-header (the pinned `h3` 0.0.8 crate can't emit it —
 * see `.orchestration/logs/t23-e6.md`). `connect()` makes a GENUINE attempt and
 * surfaces the real backend error via `status === "error"` + `error`; it never
 * fakes a connected state.
 * ────────────────────────────────────────────────────────────────────────── */

export type SSH3Status = "idle" | "connecting" | "connected" | "error";

export interface UseSSH3TerminalOptions {
  /** Called with raw terminal output bytes from the server (server → client). */
  onData?: (data: string) => void;
  /** Called once when the interactive shell is established. */
  onConnect?: () => void;
  /** Called when the shell stream closes (clean EOF or teardown). */
  onClose?: () => void;
  /** Called with a fatal connection/stream error message. */
  onError?: (message: string) => void;
}

export function useSSH3Terminal(
  config: SSHLibraryConfig | null,
  options: UseSSH3TerminalOptions = {},
) {
  const clientRef = useRef<SSH3Client | null>(null);
  const [status, setStatus] = useState<SSH3Status>("idle");
  const [error, setError] = useState<string>("");

  // Keep the latest callbacks in a ref so connect() can wire them without
  // re-subscribing on every render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) client.disconnect();
    setStatus("idle");
  }, []);

  const connect = useCallback(async () => {
    if (!config) {
      setStatus("error");
      setError("SSH3: no connection configuration provided");
      return;
    }
    // Tear down any prior client before reconnecting.
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    setStatus("connecting");
    setError("");

    const client = new SSH3Client(config);
    clientRef.current = client;

    client.onData((data) => optionsRef.current.onData?.(data));
    client.onConnect(() => {
      setStatus("connected");
      optionsRef.current.onConnect?.();
    });
    client.onError((message) => {
      setStatus("error");
      setError(message);
      optionsRef.current.onError?.(message);
    });
    client.onClose(() => {
      // Only flip to idle if we are still the active client (avoid clobbering a
      // freshly-started reconnect).
      if (clientRef.current === client) {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      }
      optionsRef.current.onClose?.();
    });

    await client.connect();
  }, [config]);

  const sendInput = useCallback((data: string) => {
    clientRef.current?.sendData(data);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    clientRef.current?.resize(cols, rows);
  }, []);

  // Always disconnect the live client on unmount.
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    isConnected: status === "connected",
    connect,
    disconnect,
    sendInput,
    resize,
  };
}

export type SSH3TerminalMgr = ReturnType<typeof useSSH3Terminal>;
