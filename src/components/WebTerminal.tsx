import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConnectionSession } from "../types/connection";
import { useConnections } from "../contexts/useConnections";

interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type SshOutputEvent = { session_id: string; data: string };
type SshErrorEvent = { session_id: string; message: string };
type SshClosedEvent = { session_id: string };

/**
 * Ground-up SSH/web terminal built to keep IO clean and selection intact.
 */
export const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const { state, dispatch } = useConnections();

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sshSessionId = useRef<string | null>(null);
  const isSshReady = useRef(false);
  const isConnecting = useRef(false);
  const isDisposed = useRef(false);
  const outputUnlistenRef = useRef<(() => void) | null>(null);
  const errorUnlistenRef = useRef<(() => void) | null>(null);
  const closeUnlistenRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sessionRef = useRef(session);
  const connection = useMemo(
    () => state.connections.find((c) => c.id === session.connectionId),
    [state.connections, session.connectionId],
  );
  const connectionRef = useRef(connection);
  const isSsh = session.protocol === "ssh";

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const setStatusState = useCallback((next: ConnectionStatus) => {
    setStatus(next);
    isConnecting.current = next === "connecting";
    isSshReady.current = next === "connected";
  }, []);

  const safeWrite = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    termRef.current.write(text);
  }, []);

  const safeWriteln = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    termRef.current.writeln(text);
  }, []);

  const writeLine = useCallback(
    (text: string) => {
      safeWriteln(text);
    },
    [safeWriteln],
  );

  const formatErrorDetails = useCallback((err: unknown) => {
    if (err instanceof Error) {
      return {
        message: err.message || "Unknown error",
        name: err.name || "Error",
        stack: err.stack || "",
      };
    }
    if (typeof err === "string") {
      return { message: err, name: "Error", stack: "" };
    }
    try {
      return { message: JSON.stringify(err), name: "Error", stack: "" };
    } catch {
      return { message: String(err), name: "Error", stack: "" };
    }
  }, []);

  const classifySshError = useCallback((message: string) => {
    if (message.includes("All authentication methods failed") || message.includes("Authentication failed")) {
      return { kind: "auth", friendly: "Authentication failed - please check your credentials" };
    }
    if (message.includes("Connection refused")) {
      return { kind: "connection_refused", friendly: "Connection refused - please check the host and port" };
    }
    if (message.toLowerCase().includes("timeout")) {
      return { kind: "timeout", friendly: "Connection timeout - please check network connectivity" };
    }
    if (message.includes("Host key verification failed")) {
      return { kind: "host_key", friendly: "Host key verification failed - server may have changed" };
    }
    if (message.toLowerCase().includes("certificate") || message.toLowerCase().includes("x509")) {
      return { kind: "certificate", friendly: "Certificate validation failed - please verify the server identity" };
    }
    if (message.includes("No such file or directory") && message.includes("private key")) {
      return { kind: "key_missing", friendly: "Private key file not found - please check the key path" };
    }
    if (message.includes("Permission denied")) {
      return { kind: "permission", friendly: "Permission denied - please check your credentials" };
    }
    if (message.includes("Failed to establish TCP connection")) {
      return { kind: "tcp_connect", friendly: "TCP connection failed - please verify the host and port" };
    }
    return { kind: "unknown", friendly: "SSH connection failed - please check credentials and network" };
  }, []);

  const disconnectSsh = useCallback(() => {
    if (sshSessionId.current) {
      invoke("disconnect_ssh", { sessionId: sshSessionId.current }).catch(() => undefined);
      sshSessionId.current = null;
    }
  }, []);

  const initSsh = useCallback(async () => {
    const currentSession = sessionRef.current;
    const currentConnection = connectionRef.current;
    if (!isSsh || !currentConnection || !termRef.current) return;
    const ignoreHostKey = currentConnection.ignoreSshSecurityErrors ?? true;
    setStatusState("connecting");
    setError("");
    if (typeof (termRef.current as any).reset === "function") {
      (termRef.current as any).reset();
    } else {
      termRef.current.clear();
    }

    writeLine("\x1b[36mConnecting to SSH server...\x1b[0m");
    writeLine(`\x1b[90mHost: ${currentSession.hostname}\x1b[0m`);
    writeLine(`\x1b[90mPort: ${currentConnection.port || 22}\x1b[0m`);
    writeLine(`\x1b[90mUser: ${currentConnection.username || "unknown"}\x1b[0m`);

    const authMethod =
      currentConnection.authType || (currentConnection.privateKey ? "key" : "password");
    writeLine(`\x1b[90mAuth: ${authMethod}\x1b[0m`);
    writeLine(
      `\x1b[90mHost key checking: ${ignoreHostKey ? "disabled (ignore errors)" : "enabled"}\x1b[0m`,
    );

    try {
      if (currentSession.backendSessionId) {
        sshSessionId.current = currentSession.backendSessionId;
        const shellId = await invoke<string>("start_shell", {
          sessionId: currentSession.backendSessionId,
        });
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...currentSession, shellId },
        });
        writeLine("\x1b[32mReattached to SSH session\x1b[0m");
        setStatusState("connected");
        return;
      }

      disconnectSsh();

      const sshConfig: Record<string, unknown> = {
        host: currentSession.hostname,
        port: currentConnection.port || 22,
        username: currentConnection.username || "",
        jump_hosts: [],
        proxy_config: null,
        openvpn_config: null,
        connect_timeout: 30000,
        keep_alive_interval: 60,
        strict_host_key_checking: !ignoreHostKey,
        known_hosts_path: null,
      };

      switch (authMethod) {
        case "password":
          if (!currentConnection.password) {
            throw new Error("Password authentication requires a password");
          }
          sshConfig.password = currentConnection.password;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;
        case "key":
          if (!currentConnection.privateKey) {
            throw new Error("Key authentication requires a key path");
          }
          sshConfig.password = null;
          sshConfig.private_key_path = currentConnection.privateKey;
          sshConfig.private_key_passphrase = currentConnection.passphrase || null;
          break;
        case "totp":
          if (!currentConnection.password || !currentConnection.totpSecret) {
            throw new Error("TOTP requires password and TOTP secret");
          }
          sshConfig.password = currentConnection.password;
          sshConfig.totp_secret = currentConnection.totpSecret;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;
        default:
          throw new Error(`Unsupported authentication method: ${authMethod}`);
      }

      const sessionId = await invoke<string>("connect_ssh", { config: sshConfig });
      sshSessionId.current = sessionId;
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...currentSession, backendSessionId: sessionId },
      });
      writeLine("\x1b[32mSSH connection established\x1b[0m");

      const shellId = await invoke<string>("start_shell", { sessionId });
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...currentSession, backendSessionId: sessionId, shellId },
      });
      writeLine("\x1b[32mShell started successfully\x1b[0m");
      setStatusState("connected");
    } catch (err: unknown) {
      const details = formatErrorDetails(err);
      const msg = details.message;
      const classification = classifySshError(msg);
      const friendly = classification.friendly;
      console.error("SSH connection failed:", {
        kind: classification.kind,
        message: details.message,
        name: details.name,
        stack: details.stack,
      });
      setStatusState("error");
      setError(friendly);
      writeLine(`\x1b[31m${friendly}\x1b[0m`);
      writeLine(`\x1b[90mFailure reason: ${classification.kind}\x1b[0m`);
      writeLine(`\x1b[90mRaw error: ${details.message}\x1b[0m`);
    }
  }, [
    classifySshError,
    disconnectSsh,
    formatErrorDetails,
    isSsh,
    dispatch,
    setStatusState,
    writeLine,
  ]);

  const handleInput = useCallback(
    async (data: string) => {
      if (!termRef.current || isDisposed.current) return;

      if (isSsh) {
        if (!sshSessionId.current || !isSshReady.current || isConnecting.current) return;
        try {
          await invoke("send_ssh_input", { sessionId: sshSessionId.current, data });
        } catch (err) {
          console.error("Failed to send SSH input:", err);
        }
        return;
      }

      // Local echo for non-SSH sessions
      safeWrite(data);
    },
    [isSsh, safeWrite],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    isDisposed.current = false;
    const term = new Terminal({
      theme: {
        background: "#0b1120",
        foreground: "#e2e8f0",
        cursor: "#7dd3fc",
        selectionBackground: "#1e293b",
      },
      fontFamily:
        '"Cascadia Code", "Fira Code", Menlo, Monaco, "Ubuntu Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      convertEol: true,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      disableStdin: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    if (container.isConnected) {
      term.focus();
    }

    termRef.current = term;
    fitRef.current = fit;

    const doFit = () => {
      if (isDisposed.current || !fitRef.current || !termRef.current) return;
      if (!container.isConnected || !termRef.current.element?.isConnected) return;
      try {
        fitRef.current.fit();
        onResize?.(termRef.current.cols, termRef.current.rows);
        if (isSsh && sshSessionId.current) {
          invoke("resize_ssh_shell", {
            sessionId: sshSessionId.current,
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          }).catch(() => undefined);
        }
      } catch {
        // ignore fit failures
      }
    };

    const resizeTimer = setTimeout(doFit, 50);
    window.addEventListener("resize", doFit);

    const dataDisposable = term.onData(handleInput);

    let cancelled = false;

    const attachListeners = async () => {
      if (!isSsh) return;
      try {
        const unlistenOutput = await listen<SshOutputEvent>("ssh-output", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          safeWrite(event.payload.data);
        });
        if (!cancelled) {
          outputUnlistenRef.current = unlistenOutput;
        } else {
          unlistenOutput();
        }

        const unlistenError = await listen<SshErrorEvent>("ssh-error", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          safeWriteln(`\r\n\x1b[31mSSH error: ${event.payload.message}\x1b[0m`);
        });
        if (!cancelled) {
          errorUnlistenRef.current = unlistenError;
        } else {
          unlistenError();
        }

        const unlistenClosed = await listen<SshClosedEvent>("ssh-shell-closed", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          setStatusState("error");
          setError("Shell closed");
        });
        if (!cancelled) {
          closeUnlistenRef.current = unlistenClosed;
        } else {
          unlistenClosed();
        }
      } catch (error) {
        console.error("Failed to attach SSH listeners:", error);
      }
    };

    attachListeners();

    if (isSsh) {
      initSsh();
    } else {
      const currentSession = sessionRef.current;
      safeWriteln(
        `\x1b[32mTerminal ready for ${currentSession.protocol.toUpperCase()} session\x1b[0m`,
      );
      safeWriteln(`\x1b[36mConnected to: ${currentSession.hostname}\x1b[0m`);
      setStatusState("connected");
    }

    return () => {
      isDisposed.current = true;
      cancelled = true;
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", doFit);
      dataDisposable.dispose();
      outputUnlistenRef.current?.();
      errorUnlistenRef.current?.();
      closeUnlistenRef.current?.();
      outputUnlistenRef.current = null;
      errorUnlistenRef.current = null;
      closeUnlistenRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [
    handleInput,
    initSsh,
    isSsh,
    onResize,
    session.id,
    safeWriteln,
    setStatusState,
  ]);

  const safeFit = useCallback(() => {
    if (isDisposed.current || !fitRef.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    try {
      fitRef.current.fit();
    } catch {
      // ignore fit failures
    }
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
    setTimeout(() => safeFit(), 60);
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (!selection) return;
    navigator.clipboard.writeText(selection).catch(() => undefined);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      await handleInput(text);
    } catch (err) {
      console.error("Failed to paste from clipboard:", err);
    }
  };

  const statusTone = useMemo(() => {
    switch (status) {
      case "connected":
        return "bg-emerald-400/20 text-emerald-200";
      case "connecting":
        return "bg-amber-400/20 text-amber-200";
      case "error":
        return "bg-rose-400/20 text-rose-200";
      default:
        return "bg-slate-700/50 text-slate-300";
    }
  }, [status]);

  return (
    <div className={`flex flex-col bg-slate-950 ${isFullscreen ? "fixed inset-0 z-50" : "h-full"}`}>
      <div className="border-b border-slate-800 bg-slate-900/90">
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">
              {session.name || "Terminal"}
            </div>
            <div className="truncate text-xs uppercase tracking-[0.2em] text-slate-400">
              {session.protocol.toUpperCase()} · {session.hostname}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copySelection}
              className="rounded-md p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              title="Copy selection"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={pasteFromClipboard}
              className="rounded-md p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              title="Paste"
            >
              <Clipboard size={14} />
            </button>
            <button
              onClick={clearTerminal}
              className="rounded-md p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              title="Clear"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="rounded-md p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[10px] uppercase tracking-[0.2em]">
          <span className={`rounded-full px-2 py-1 ${statusTone}`}>
            {status === "connected"
              ? "Connected"
              : status === "connecting"
                ? "Connecting"
                : status === "error"
                  ? "Error"
                  : "Idle"}
          </span>
          {error && (
            <span className="rounded-full bg-rose-500/10 px-2 py-1 text-rose-200 normal-case tracking-normal">
              {error}
            </span>
          )}
          {isSsh && (
            <span className="rounded-full bg-sky-500/10 px-2 py-1 text-sky-200">
              SSH lib: Rust
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          ref={containerRef}
          className="h-full w-full rounded-lg border border-slate-800 bg-slate-950/80 relative overflow-hidden"
        />
      </div>
    </div>
  );
};
