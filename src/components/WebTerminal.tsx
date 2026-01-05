import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, Maximize2, Minimize2, RotateCcw, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
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

  // Serialize terminal buffer content for detach/reattach
  const serializeBuffer = useCallback(() => {
    if (!termRef.current) {
      console.log("serializeBuffer: no terminal ref");
      return "";
    }
    const buffer = termRef.current.buffer.active;
    const lines: string[] = [];
    
    // Get all non-empty lines from buffer
    let lastNonEmptyLine = -1;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        const text = line.translateToString(true);
        lines.push(text);
        if (text.trim()) {
          lastNonEmptyLine = i;
        }
      }
    }
    
    // Trim trailing empty lines but keep internal ones
    const trimmedLines = lastNonEmptyLine >= 0 ? lines.slice(0, lastNonEmptyLine + 1) : [];
    console.log("serializeBuffer: captured", trimmedLines.length, "lines");
    return trimmedLines.join("\n");
  }, []);

  // Restore terminal buffer from serialized content
  const restoreBuffer = useCallback((content: string) => {
    if (!termRef.current || !content || isDisposed.current) return;
    try {
      // Check if terminal is ready for writing
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) {
        // Terminal not ready, retry later
        setTimeout(() => restoreBuffer(content), 100);
        return;
      }
      
      termRef.current.clear();
      const lines = content.split("\n");
      for (const line of lines) {
        termRef.current.writeln(line);
      }
      console.log("Terminal buffer restored:", lines.length, "lines");
    } catch (err) {
      console.error("Failed to restore terminal buffer:", err);
    }
  }, []);

  // Listen for buffer request events (from main window before detach)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    listen<{ sessionId: string }>("request-terminal-buffer", async (event) => {
      if (event.payload.sessionId !== session.id) return;
      
      // Try to get buffer from Rust backend first (most reliable)
      let buffer = "";
      if (sshSessionId.current && session.protocol === "ssh") {
        try {
          buffer = await invoke<string>("get_terminal_buffer", { 
            sessionId: sshSessionId.current 
          });
          console.log("Got buffer from Rust backend:", buffer?.length || 0, "chars");
        } catch (err) {
          console.warn("Failed to get buffer from backend, using local:", err);
          buffer = serializeBuffer();
        }
      } else {
        // For non-SSH sessions, use local buffer
        buffer = serializeBuffer();
      }
      
      await emit("terminal-buffer-response", { 
        sessionId: session.id, 
        buffer 
      });
    }).then(fn => {
      unlisten = fn;
    }).catch(console.error);

    return () => {
      unlisten?.();
    };
  }, [session.id, session.protocol, serializeBuffer]);

  // Track if we've already restored buffer for this session
  const bufferRestoredRef = useRef(false);
  
  // Restore buffer from session data on mount - with retry logic
  useEffect(() => {
    if (!session.terminalBuffer || bufferRestoredRef.current) return;
    
    const tryRestore = (attempts = 0) => {
      if (attempts > 30) {
        console.warn("Failed to restore terminal buffer after max attempts");
        return;
      }
      
      if (!termRef.current) {
        // Terminal not created yet, retry
        setTimeout(() => tryRestore(attempts + 1), 100);
        return;
      }
      
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) {
        // Terminal not ready, retry
        setTimeout(() => tryRestore(attempts + 1), 100);
        return;
      }
      
      bufferRestoredRef.current = true;
      restoreBuffer(session.terminalBuffer!);
    };
    
    // Start restore attempt after a small delay
    const timer = setTimeout(() => tryRestore(0), 300);
    return () => clearTimeout(timer);
  }, [session.terminalBuffer, restoreBuffer]);

  const canRender = useCallback(() => {
    if (!termRef.current) return false;
    const core = (termRef.current as any)?._core;
    if (!core) return false;
    const renderService = core?.renderService ?? core?._renderService;
    if (!renderService) return false;
    // Check dimensions exists and has valid values
    const dims = renderService?.dimensions;
    if (!dims) return false;
    // Ensure dimensions are actually computed (not zero/undefined)
    if (typeof dims.css?.cell?.width !== 'number' || dims.css?.cell?.width <= 0) return false;
    return true;
  }, []);

  const safeWrite = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (termRef.current.element && !termRef.current.element.isConnected) return;
    if (!canRender()) return;
    try {
      termRef.current.write(text);
    } catch {
      // Ignore transient render errors during resize/dispose.
    }
  }, [canRender]);

  const safeWriteln = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (termRef.current.element && !termRef.current.element.isConnected) return;
    if (!canRender()) return;
    try {
      termRef.current.writeln(text);
    } catch {
      // Ignore transient render errors during resize/dispose.
    }
  }, [canRender]);

  const writeLine = useCallback(
    (text: string) => {
      safeWriteln(text);
    },
    [safeWriteln],
  );

  const getTerminalTheme = useCallback(() => {
    if (typeof window === "undefined") {
      return {
        background: "#0b1120",
        foreground: "#e2e8f0",
        cursor: "#7dd3fc",
        selectionBackground: "#1e293b",
      };
    }
    const styles = getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue("--color-background").trim() || "#0b1120";
    const foreground = styles.getPropertyValue("--color-text").trim() || "#e2e8f0";
    const cursor = styles.getPropertyValue("--color-primary").trim() || "#7dd3fc";
    const selectionBackground =
      styles.getPropertyValue("--color-border").trim() || "#1e293b";
    return { background, foreground, cursor, selectionBackground };
  }, []);

  const applyTerminalTheme = useCallback(() => {
    if (!termRef.current || isDisposed.current) return;
    if (!canRender()) return;
    const theme = getTerminalTheme();
    const terminal = termRef.current as any;
    try {
      if (typeof terminal.setOption === "function") {
        terminal.setOption("theme", theme);
        return;
      }
      if (terminal.options) {
        terminal.options.theme = theme;
      }
    } catch {
      // Ignore theme updates during teardown.
    }
  }, [canRender, getTerminalTheme]);

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
    const lower = message.toLowerCase();
    if (message.includes("All authentication methods failed") || message.includes("Authentication failed")) {
      return { kind: "auth", friendly: "Authentication failed - please check your credentials" };
    }
    if (lower.includes("connection refused") || lower.includes("os error 10061")) {
      return { kind: "connection_refused", friendly: "Connection refused - please check the host and port" };
    }
    if (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("os error 10060") ||
      lower.includes("connection attempt failed")
    ) {
      return { kind: "timeout", friendly: "Connection timeout - please check network connectivity" };
    }
    if (message.includes("Host key verification failed")) {
      return { kind: "host_key", friendly: "Host key verification failed - server may have changed" };
    }
    if (lower.includes("certificate") || lower.includes("x509")) {
      return { kind: "certificate", friendly: "Certificate validation failed - please verify the server identity" };
    }
    if (message.includes("No such file or directory") && message.includes("private key")) {
      return { kind: "key_missing", friendly: "Private key file not found - please check the key path" };
    }
    if (message.includes("Permission denied")) {
      return { kind: "permission", friendly: "Permission denied - please check your credentials" };
    }
    if (lower.includes("failed to establish tcp connection") || lower.includes("failed to connect")) {
      return { kind: "tcp_connect", friendly: "TCP connection failed - please verify the host and port" };
    }
    if (lower.includes("no route to host") || lower.includes("network unreachable")) {
      return { kind: "network_unreachable", friendly: "Network unreachable - please check routing or VPN" };
    }
    return { kind: "unknown", friendly: "SSH connection failed - please check credentials and network" };
  }, []);

  const disconnectSsh = useCallback(() => {
    if (sshSessionId.current) {
      invoke("disconnect_ssh", { sessionId: sshSessionId.current }).catch(() => undefined);
      sshSessionId.current = null;
    }
  }, []);

  const initSsh = useCallback(async (force = false) => {
    const currentSession = sessionRef.current;
    const currentConnection = connectionRef.current;
    if (!isSsh || !currentConnection || !termRef.current) return;
    if (!force && (isConnecting.current || isSshReady.current)) {
      return;
    }
    if (!force && sshSessionId.current && currentSession.shellId) {
      setStatusState("connected");
      return;
    }
    if (force) {
      sshSessionId.current = null;
    }
    const ignoreHostKey = currentConnection.ignoreSshSecurityErrors ?? true;
    setStatusState("connecting");
    setError("");
    if (typeof (termRef.current as any).reset === "function") {
      try {
        (termRef.current as any).reset();
      } catch {
        // Ignore reset failures during early render.
      }
    } else {
      try {
        termRef.current.clear();
      } catch {
        // Ignore clear failures during early render.
      }
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
      // Check if we have an existing backend session that might still be alive
      if (currentSession.backendSessionId && !force) {
        // First, check if the session is still alive in the Rust backend
        const isAlive = await invoke<boolean>("is_session_alive", {
          sessionId: currentSession.backendSessionId,
        }).catch(() => false);
        
        if (isAlive) {
          sshSessionId.current = currentSession.backendSessionId;
          
          // Get the buffer from Rust backend and restore it
          const buffer = await invoke<string>("get_terminal_buffer", {
            sessionId: currentSession.backendSessionId,
          }).catch(() => "");
          
          if (buffer) {
            restoreBuffer(buffer);
            writeLine("\x1b[32mRestored terminal buffer from session\x1b[0m");
          }
          
          // Check if shell exists, if not, start a new one
          const existingShellId = await invoke<string | null>("get_shell_info", {
            sessionId: currentSession.backendSessionId,
          }).catch(() => null);
          
          if (existingShellId) {
            // Shell already exists, just reconnect to events
            dispatch({
              type: "UPDATE_SESSION",
              payload: { ...currentSession, shellId: existingShellId },
            });
            writeLine("\x1b[32mReattached to existing SSH session\x1b[0m");
            setStatusState("connected");
            return;
          }
          
          // No shell, start a new one on the existing connection
          const shellId = await invoke<string>("reattach_session", {
            sessionId: currentSession.backendSessionId,
          });
          dispatch({
            type: "UPDATE_SESSION",
            payload: { ...currentSession, shellId },
          });
          writeLine("\x1b[32mRestarted shell on existing SSH connection\x1b[0m");
          setStatusState("connected");
          return;
        } else {
          // Session no longer alive, will create new connection
          writeLine("\x1b[33mPrevious session expired, creating new connection...\x1b[0m");
        }
      }

      disconnectSsh();

      const sshConfig: Record<string, unknown> = {
        host: currentSession.hostname,
        port: currentConnection.port || 22,
        username: currentConnection.username || "",
        jump_hosts: [],
        proxy_config: null,
        openvpn_config: null,
        connect_timeout: currentConnection.sshConnectTimeout ?? 30,
        keep_alive_interval: currentConnection.sshKeepAliveInterval ?? 60,
        strict_host_key_checking: !ignoreHostKey,
        known_hosts_path: currentConnection.sshKnownHostsPath || null,
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
    restoreBuffer,
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
      theme: getTerminalTheme(),
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
    
    // Defer terminal open to next frame to ensure DOM is ready
    const openTimer = requestAnimationFrame(() => {
      if (isDisposed.current) return;
      try {
        term.open(container);
        if (container.isConnected && !isDisposed.current) {
          term.focus();
        }
      } catch (err) {
        console.warn('Failed to open terminal:', err);
      }
    });

    termRef.current = term;
    fitRef.current = fit;

    let rafId = 0;
    let initRetryCount = 0;
    const maxInitRetries = 20;

    const canFit = () => {
      if (!termRef.current) return false;
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) return false;
      // Check dimensions are actually computed
      const dims = renderService.dimensions;
      if (typeof dims.css?.cell?.width !== 'number' || dims.css?.cell?.width <= 0) return false;
      return true;
    };

    const doFit = () => {
      if (isDisposed.current || !fitRef.current || !termRef.current) return;
      if (!container.isConnected || !termRef.current.element?.isConnected) return;
      if (!canFit()) {
        // If dimensions not ready yet, retry a few times during initial setup
        if (initRetryCount < maxInitRetries) {
          initRetryCount++;
          setTimeout(doFit, 50);
        }
        return;
      }
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

    const scheduleFit = () => {
      if (isDisposed.current) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(doFit);
    };

    const resizeTimer = setTimeout(scheduleFit, 50);
    window.addEventListener("resize", scheduleFit);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleFit)
        : null;
    resizeObserver?.observe(container);

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
      cancelAnimationFrame(openTimer);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", scheduleFit);
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      outputUnlistenRef.current?.();
      errorUnlistenRef.current?.();
      closeUnlistenRef.current?.();
      outputUnlistenRef.current = null;
      errorUnlistenRef.current = null;
      closeUnlistenRef.current = null;
      // Dispose terminal in next frame to avoid sync scroll errors
      requestAnimationFrame(() => {
        try {
          term.dispose();
        } catch {
          // Ignore disposal errors
        }
      });
      termRef.current = null;
      fitRef.current = null;
    };
  }, [
    getTerminalTheme,
    handleInput,
    initSsh,
    isSsh,
    onResize,
    session.id,
    safeWrite,
    safeWriteln,
    setStatusState,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSettingsUpdate = () => {
      applyTerminalTheme();
    };
    window.addEventListener("settings-updated", handleSettingsUpdate);
    return () => window.removeEventListener("settings-updated", handleSettingsUpdate);
  }, [applyTerminalTheme]);

  const safeFit = useCallback(() => {
    if (isDisposed.current || !fitRef.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    const core = (termRef.current as any)?._core;
    const renderService = core?.renderService ?? core?._renderService;
    if (!renderService?.dimensions) return;
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

  const handleReconnect = useCallback(async () => {
    if (!isSsh) return;
    setStatusState("connecting");
    disconnectSsh();
    const currentSession = sessionRef.current;
    if (currentSession.backendSessionId || currentSession.shellId) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          ...currentSession,
          backendSessionId: undefined,
          shellId: undefined,
        },
      });
    }
    await initSsh(true);
    setTimeout(() => safeFit(), 80);
  }, [dispatch, disconnectSsh, initSsh, isSsh, safeFit, setStatusState]);

  const clearTerminal = () => {
    if (!termRef.current || !canRender()) return;
    try {
      termRef.current.clear();
    } catch {
      // Ignore clear failures during teardown.
    }
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

  const statusToneClass = useMemo(() => {
    switch (status) {
      case "connected":
        return "app-badge--success";
      case "connecting":
        return "app-badge--warning";
      case "error":
        return "app-badge--error";
      default:
        return "app-badge--neutral";
    }
  }, [status]);

  return (
    <div
      className={`flex flex-col ${isFullscreen ? "fixed inset-0 z-50" : "h-full"}`}
      style={{
        backgroundColor: "var(--color-background)",
        color: "var(--color-text)",
      }}
    >
      <div className="app-bar border-b">
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {session.name || "Terminal"}
            </div>
            <div className="truncate text-xs uppercase tracking-[0.2em] text-gray-400">
              {session.protocol.toUpperCase()} - {session.hostname}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copySelection}
              className="app-bar-button p-2"
              data-tooltip="Copy selection"
              aria-label="Copy selection"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={pasteFromClipboard}
              className="app-bar-button p-2"
              data-tooltip="Paste"
              aria-label="Paste"
            >
              <Clipboard size={14} />
            </button>
            {isSsh && (
              <button
                onClick={handleReconnect}
                className="app-bar-button p-2"
                data-tooltip="Reconnect"
                aria-label="Reconnect"
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              onClick={clearTerminal}
              className="app-bar-button p-2"
              data-tooltip="Clear"
              aria-label="Clear"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="app-bar-button p-2"
              data-tooltip={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[10px] uppercase tracking-[0.2em]">
          <span className={`app-badge ${statusToneClass}`}>
            {status === "connected"
              ? "Connected"
              : status === "connecting"
                ? "Connecting"
                : status === "error"
                  ? "Error"
                  : "Idle"}
          </span>
          {error && (
            <span className="app-badge app-badge--error normal-case tracking-normal">
              {error}
            </span>
          )}
          {isSsh && (
            <span className="app-badge app-badge--info">
              SSH lib: Rust
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          ref={containerRef}
          className="h-full w-full rounded-lg border relative overflow-hidden"
          style={{
            backgroundColor: "var(--color-background)",
            borderColor: "var(--color-border)",
          }}
        />
      </div>
    </div>
  );
};
