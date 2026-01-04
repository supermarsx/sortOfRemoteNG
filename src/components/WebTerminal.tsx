import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionSession } from "../types/connection";
import { useConnections } from "../contexts/useConnections";

interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/**
 * Ground-up SSH/web terminal built to keep IO clean and selection intact.
 */
export const WebTerminal: React.FC<WebTerminalProps> = ({ session, onResize }) => {
  const { state } = useConnections();

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sshSessionId = useRef<string | null>(null);
  const pollTimer = useRef<NodeJS.Timeout | null>(null);
  const isSshReady = useRef(false);
  const isConnecting = useRef(false);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const connection = useMemo(
    () => state.connections.find((c) => c.id === session.connectionId),
    [state.connections, session.connectionId],
  );
  const isSsh = session.protocol === "ssh";
  const ignoreHostKey = connection?.ignoreSshSecurityErrors ?? true;

  const setStatusState = useCallback((next: ConnectionStatus) => {
    setStatus(next);
    isConnecting.current = next === "connecting";
    isSshReady.current = next === "connected";
  }, []);

  const writeLine = useCallback((text: string) => {
    termRef.current?.writeln(text);
  }, []);

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

  const clearPoller = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPoller = useCallback(() => {
    clearPoller();
    pollTimer.current = setInterval(async () => {
      if (!sshSessionId.current || !isSshReady.current || !termRef.current) return;
      try {
        const output = await invoke<string>("receive_ssh_output", {
          sessionId: sshSessionId.current,
        });
        if (output) {
          termRef.current.write(output);
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 200);
  }, [clearPoller]);

  const disconnectSsh = useCallback(() => {
    if (sshSessionId.current) {
      invoke("disconnect_ssh", { sessionId: sshSessionId.current }).catch(() => undefined);
      sshSessionId.current = null;
    }
    clearPoller();
  }, [clearPoller]);

  const initSsh = useCallback(async () => {
    if (!isSsh || !connection || !termRef.current) return;
    setStatusState("connecting");
    setError("");
    disconnectSsh();
    if (typeof (termRef.current as any).reset === "function") {
      (termRef.current as any).reset();
    } else {
      termRef.current.clear();
    }

    writeLine("\x1b[36mConnecting to SSH server...\x1b[0m");
    writeLine(`\x1b[90mHost: ${session.hostname}\x1b[0m`);
    writeLine(`\x1b[90mPort: ${connection.port || 22}\x1b[0m`);
    writeLine(`\x1b[90mUser: ${connection.username || "unknown"}\x1b[0m`);

    const authMethod = connection.authType || (connection.privateKey ? "key" : "password");
    writeLine(`\x1b[90mAuth: ${authMethod}\x1b[0m`);
    writeLine(
      `\x1b[90mHost key checking: ${ignoreHostKey ? "disabled (ignore errors)" : "enabled"}\x1b[0m`,
    );

    const sshConfig: Record<string, unknown> = {
      host: session.hostname,
      port: connection.port || 22,
      username: connection.username || "",
      jump_hosts: [],
      proxy_config: null,
      openvpn_config: null,
      connect_timeout: 30000,
      keep_alive_interval: 60,
      strict_host_key_checking: !ignoreHostKey,
      known_hosts_path: null,
    };

    try {
      switch (authMethod) {
        case "password":
          if (!connection.password) throw new Error("Password authentication requires a password");
          sshConfig.password = connection.password;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;
        case "key":
          if (!connection.privateKey) throw new Error("Key authentication requires a key path");
          sshConfig.password = null;
          sshConfig.private_key_path = connection.privateKey;
          sshConfig.private_key_passphrase = connection.passphrase || null;
          break;
        case "totp":
          if (!connection.password || !connection.totpSecret) {
            throw new Error("TOTP requires password and TOTP secret");
          }
          sshConfig.password = connection.password;
          sshConfig.totp_secret = connection.totpSecret;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;
        default:
          throw new Error(`Unsupported authentication method: ${authMethod}`);
      }

      const sessionId = await invoke<string>("connect_ssh", { config: sshConfig });
      sshSessionId.current = sessionId;
      writeLine("\x1b[32mSSH connection established\x1b[0m");

      await invoke("start_shell", { sessionId });
      writeLine("\x1b[32mShell started successfully\x1b[0m");
      setStatusState("connected");
      startPoller();
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
    connection,
    disconnectSsh,
    formatErrorDetails,
    ignoreHostKey,
    isSsh,
    session.hostname,
    setStatusState,
    startPoller,
    writeLine,
  ]);

  const handleInput = useCallback(
    async (data: string) => {
      if (!termRef.current) return;

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
      termRef.current.write(data);
    },
    [isSsh],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    const doFit = () => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
        onResize?.(termRef.current.cols, termRef.current.rows);
      } catch {
        // ignore fit failures
      }
    };

    const resizeTimer = setTimeout(doFit, 50);
    window.addEventListener("resize", doFit);

    const dataDisposable = term.onData(handleInput);

    if (isSsh) {
      initSsh();
    } else {
      term.writeln(`\x1b[32mTerminal ready for ${session.protocol.toUpperCase()} session\x1b[0m`);
      term.writeln(`\x1b[36mConnected to: ${session.hostname}\x1b[0m`);
      setStatusState("connected");
    }

    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", doFit);
      dataDisposable.dispose();
      disconnectSsh();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setStatusState("idle");
      setError("");
    };
  }, [
    handleInput,
    initSsh,
    isSsh,
    onResize,
    session.hostname,
    session.protocol,
    setStatusState,
    disconnectSsh,
  ]);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
    setTimeout(() => fitRef.current?.fit(), 60);
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
