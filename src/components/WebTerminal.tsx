import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, FileCode, Maximize2, Minimize2, RotateCcw, StopCircle, Trash2, X, Play, Search, Filter, Unplug, Fingerprint } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { ConnectionSession } from "../types/connection";
import { useConnections } from "../contexts/useConnections";
import { useSettings } from "../contexts/SettingsContext";
import { mergeSSHTerminalConfig } from "../types/settings";
import { ManagedScript, getDefaultScripts, OSTag, OS_TAG_LABELS, OS_TAG_ICONS } from "./ScriptManager";
import { CertificateInfoPopup } from './CertificateInfoPopup';
import { TrustWarningDialog } from './TrustWarningDialog';
import {
  verifyIdentity,
  trustIdentity,
  getStoredIdentity,
  getEffectiveTrustPolicy,
  type SshHostKeyIdentity,
  type TrustVerifyResult,
} from '../utils/trustStore';

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
  const { settings } = useSettings();
  
  // Find the connection to get per-connection overrides
  const connection = useMemo(
    () => state.connections.find((c) => c.id === session.connectionId),
    [state.connections, session.connectionId],
  );
  
  // Merge global SSH terminal config with per-connection overrides
  const sshTerminalConfig = useMemo(
    () => mergeSSHTerminalConfig(settings.sshTerminal, connection?.sshTerminalConfigOverride),
    [settings.sshTerminal, connection?.sshTerminalConfigOverride],
  );

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
  const [showScriptSelector, setShowScriptSelector] = useState(false);
  const [scripts, setScripts] = useState<ManagedScript[]>([]);
  const [scriptSearchQuery, setScriptSearchQuery] = useState("");
  const [scriptCategoryFilter, setScriptCategoryFilter] = useState<string>("all");
  const [scriptLanguageFilter, setScriptLanguageFilter] = useState<string>("all");
  const [scriptOsTagFilter, setScriptOsTagFilter] = useState<string>("all");

  // ---- SSH host key trust state ----
  const [showKeyPopup, setShowKeyPopup] = useState(false);
  const [hostKeyIdentity, setHostKeyIdentity] = useState<SshHostKeyIdentity | null>(null);
  const [sshTrustPrompt, setSshTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const sshTrustResolveRef = useRef<((accept: boolean) => void) | null>(null);
  const keyPopupRef = useRef<HTMLDivElement>(null);

  const sessionRef = useRef(session);
  const connectionRef = useRef(connection);
  const isSsh = session.protocol === "ssh";

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  // Load scripts from storage
  useEffect(() => {
    const loadScripts = () => {
      try {
        const defaults = getDefaultScripts();
        const stored = localStorage.getItem('managedScripts');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Handle new format with customScripts, modifiedDefaults, deletedDefaultIds
          if (parsed && typeof parsed === 'object' && 'customScripts' in parsed) {
            const { customScripts = [], modifiedDefaults = [], deletedDefaultIds = [] } = parsed;
            // Start with modified defaults (or original defaults if not modified)
            const activeDefaults = defaults
              .filter((d: ManagedScript) => !deletedDefaultIds.includes(d.id))
              .map((d: ManagedScript) => modifiedDefaults.find((m: ManagedScript) => m.id === d.id) || d);
            setScripts([...activeDefaults, ...customScripts]);
          } else if (Array.isArray(parsed)) {
            // Handle old format (just an array of custom scripts)
            setScripts([...defaults, ...parsed]);
          } else {
            setScripts(defaults);
          }
        } else {
          setScripts(defaults);
        }
      } catch (e) {
        console.error('Failed to load scripts:', e);
        setScripts(getDefaultScripts());
      }
    };
    loadScripts();
    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'managedScripts') {
        loadScripts();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Get unique categories, languages, and OS tags from scripts
  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    scripts.forEach(s => categories.add(s.category || 'Uncategorized'));
    return Array.from(categories).sort();
  }, [scripts]);

  const uniqueLanguages = useMemo(() => {
    const languages = new Set<string>();
    scripts.forEach(s => languages.add(s.language));
    return Array.from(languages).sort();
  }, [scripts]);

  const uniqueOsTags = useMemo(() => {
    const tags = new Set<string>();
    scripts.forEach(s => {
      if (s.osTags) {
        s.osTags.forEach(tag => tags.add(tag));
      }
    });
    return Array.from(tags).sort();
  }, [scripts]);

  // Filter scripts by search query, category, language, and OS tag
  const filteredScripts = useMemo(() => {
    let result = scripts;
    
    // Apply category filter
    if (scriptCategoryFilter !== 'all') {
      result = result.filter(s => (s.category || 'Uncategorized') === scriptCategoryFilter);
    }
    
    // Apply language filter
    if (scriptLanguageFilter !== 'all') {
      result = result.filter(s => s.language === scriptLanguageFilter);
    }
    
    // Apply OS tag filter
    if (scriptOsTagFilter !== 'all') {
      result = result.filter(s => s.osTags && s.osTags.includes(scriptOsTagFilter as OSTag));
    }
    
    // Apply search query
    if (scriptSearchQuery.trim()) {
      const query = scriptSearchQuery.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.category.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [scripts, scriptSearchQuery, scriptCategoryFilter, scriptLanguageFilter, scriptOsTagFilter]);

  // Group scripts by category
  const scriptsByCategory = useMemo(() => {
    const groups: Record<string, ManagedScript[]> = {};
    filteredScripts.forEach(script => {
      const cat = script.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(script);
    });
    return groups;
  }, [filteredScripts]);

  // Handle ESC key to close script selector
  useEffect(() => {
    if (!showScriptSelector) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowScriptSelector(false);
        setScriptSearchQuery("");
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScriptSelector]);

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
      isSshReady.current = false;
      isConnecting.current = false;
      setStatusState("idle");
      setError("");
      writeLine("\x1b[33mDisconnected from SSH session\x1b[0m");
    }
  }, [setStatusState, writeLine]);

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

      // Build TCP options from settings
      const tcpOptions = sshTerminalConfig?.tcpOptions;
      
      const sshConfig: Record<string, unknown> = {
        host: currentSession.hostname,
        port: currentConnection.port || 22,
        username: currentConnection.username || "",
        jump_hosts: [],
        proxy_config: null,
        openvpn_config: null,
        connect_timeout: tcpOptions?.connectionTimeout ?? currentConnection.sshConnectTimeout ?? 30,
        keep_alive_interval: tcpOptions?.tcpKeepAlive ? (tcpOptions?.keepAliveInterval ?? currentConnection.sshKeepAliveInterval ?? 60) : null,
        strict_host_key_checking: !ignoreHostKey,
        known_hosts_path: currentConnection.sshKnownHostsPath || null,
        // TCP options from settings
        tcp_no_delay: tcpOptions?.tcpNoDelay ?? true,
        tcp_keepalive: tcpOptions?.tcpKeepAlive ?? true,
        keepalive_probes: tcpOptions?.keepAliveProbes ?? 3,
        ip_protocol: tcpOptions?.ipProtocol ?? 'auto',
        // SSH options from settings
        compression: sshTerminalConfig?.enableCompression ?? false,
        compression_level: sshTerminalConfig?.compressionLevel ?? 6,
        ssh_version: sshTerminalConfig?.sshVersion ?? 'auto',
        // Cipher preferences
        preferred_ciphers: sshTerminalConfig?.preferredCiphers ?? [],
        preferred_macs: sshTerminalConfig?.preferredMACs ?? [],
        preferred_kex: sshTerminalConfig?.preferredKeyExchanges ?? [],
        preferred_host_key_algorithms: sshTerminalConfig?.preferredHostKeyAlgorithms ?? [],
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

      // ---- Host key trust verification ----
      const sshTrustPolicy = getEffectiveTrustPolicy(
        currentConnection.sshTrustPolicy,
        settings.sshTrustPolicy,
      );
      if (sshTrustPolicy !== 'always-trust') {
        try {
          const keyInfo = await invoke<{
            fingerprint: string;
            key_type: string | null;
            key_bits: number | null;
            public_key: string | null;
          }>("get_ssh_host_key_info", { sessionId });

          const now = new Date().toISOString();
          const identity: SshHostKeyIdentity = {
            fingerprint: keyInfo.fingerprint,
            keyType: keyInfo.key_type ?? undefined,
            keyBits: keyInfo.key_bits ?? undefined,
            firstSeen: now,
            lastSeen: now,
            publicKey: keyInfo.public_key ?? undefined,
          };
          setHostKeyIdentity(identity);

          const sshPort = currentConnection.port || 22;
          const result = verifyIdentity(currentSession.hostname, sshPort, 'ssh', identity);

          if (result.status === 'first-use' && sshTrustPolicy === 'tofu') {
            trustIdentity(currentSession.hostname, sshPort, 'ssh', identity, false);
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            writeLine(`\x1b[90mKey type: ${keyInfo.key_type ?? 'unknown'}\x1b[0m`);
            writeLine("\x1b[33mHost key memorized (Trust-On-First-Use)\x1b[0m");
          } else if (result.status === 'trusted') {
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            writeLine("\x1b[32mHost key matches stored identity\x1b[0m");
          } else {
            // mismatch, first-use with always-ask/strict
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            if (result.status === 'mismatch') {
              writeLine("\x1b[31;1m*** WARNING: HOST KEY HAS CHANGED! ***\x1b[0m");
            } else {
              writeLine("\x1b[33mNew host key — user confirmation required\x1b[0m");
            }

            const accepted = await new Promise<boolean>((resolve) => {
              sshTrustResolveRef.current = resolve;
              setSshTrustPrompt(result);
            });

            if (!accepted) {
              await invoke("disconnect_ssh", { sessionId }).catch(() => {});
              sshSessionId.current = null;
              setStatusState("error");
              setError("Connection aborted: host key not trusted by user.");
              writeLine("\x1b[31mConnection aborted by user\x1b[0m");
              return;
            }

            trustIdentity(currentSession.hostname, sshPort, 'ssh', identity, true);
            writeLine("\x1b[32mHost key accepted and memorized\x1b[0m");
          }
        } catch (err) {
          writeLine(`\x1b[33mCould not retrieve host key info: ${err}\x1b[0m`);
        }
      }

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
  // sshTerminalConfig settings are intentionally read once at connection time to avoid
  // reconnecting when settings change mid-session
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Run a script in the terminal
  const runScript = useCallback(async (script: ManagedScript) => {
    if (!isSsh || !sshSessionId.current || !isSshReady.current || isConnecting.current) {
      return;
    }
    try {
      // Send script content line by line, or as a single command
      const scriptContent = script.script;
      // Remove shebang and send the rest
      const lines = scriptContent.split('\n').filter(line => !line.startsWith('#!'));
      const command = lines.join('\n');
      await invoke("send_ssh_input", { sessionId: sshSessionId.current, data: command + '\n' });
      setShowScriptSelector(false);
      setScriptSearchQuery("");
    } catch (err) {
      console.error("Failed to run script:", err);
    }
  }, [isSsh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    isDisposed.current = false;
    
    // Build terminal options from settings
    const fontFamily = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.family
      ? sshTerminalConfig.font.family
      : '"Cascadia Code", "Fira Code", Menlo, Monaco, "Ubuntu Mono", "Courier New", monospace';
    const fontSize = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.size
      ? sshTerminalConfig.font.size
      : 13;
    const lineHeight = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.lineHeight
      ? sshTerminalConfig.font.lineHeight
      : 1.25;
    const letterSpacing = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.letterSpacing
      ? sshTerminalConfig.font.letterSpacing
      : 0;
    const scrollbackLines = sshTerminalConfig?.scrollbackLines ?? 10000;
    const cursorBlink = true;
    const wordSeparator = sshTerminalConfig?.wordSeparators ?? ' \t';
    
    // Terminal dimensions from settings (if custom) - only include if defined
    const dimensionOptions = sshTerminalConfig?.useCustomDimensions
      ? { cols: sshTerminalConfig.columns, rows: sshTerminalConfig.rows }
      : {};
    
    const term = new Terminal({
      theme: getTerminalTheme(),
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      cursorBlink,
      cursorStyle: "block",
      scrollback: scrollbackLines,
      convertEol: sshTerminalConfig?.implicitCrInLf ?? false,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      disableStdin: false,
      wordSeparator,
      scrollOnUserInput: sshTerminalConfig?.scrollOnKeystroke ?? true,
      ...dimensionOptions,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    
    // Bell handling with overuse protection
    let bellCount = 0;
    let bellSilenced = false;
    let bellResetTimer: ReturnType<typeof setTimeout> | null = null;
    let bellSilenceTimer: ReturnType<typeof setTimeout> | null = null;
    
    const handleBell = () => {
      const bellStyle = sshTerminalConfig?.bellStyle ?? 'system';
      const overuseProtection = sshTerminalConfig?.bellOveruseProtection;
      
      // Check overuse protection
      if (overuseProtection?.enabled) {
        bellCount++;
        
        // Reset counter after time window
        if (bellResetTimer) clearTimeout(bellResetTimer);
        bellResetTimer = setTimeout(() => {
          bellCount = 0;
        }, (overuseProtection.timeWindowSeconds ?? 2) * 1000);
        
        // Check if we exceeded max bells
        if (bellCount > (overuseProtection.maxBells ?? 5)) {
          if (!bellSilenced) {
            bellSilenced = true;
            console.log('Bell silenced due to overuse');
            // Clear silence after duration
            bellSilenceTimer = setTimeout(() => {
              bellSilenced = false;
              bellCount = 0;
            }, (overuseProtection.silenceDurationSeconds ?? 5) * 1000);
          }
          return; // Don't play bell
        }
      }
      
      if (bellSilenced) return;
      
      // Play bell based on style
      switch (bellStyle) {
        case 'none':
          // Do nothing
          break;
        case 'system':
          // Use system beep via audio context
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.1);
          } catch {
            // Fallback: do nothing if audio not available
          }
          break;
        case 'visual':
          // Flash the terminal background
          if (containerRef.current) {
            containerRef.current.style.backgroundColor = '#ff0';
            setTimeout(() => {
              if (containerRef.current) {
                containerRef.current.style.backgroundColor = '';
              }
            }, 100);
          }
          break;
        case 'flash-window':
          // Request window attention via Tauri
          invoke('flash_window').catch(() => {});
          break;
        case 'pc-speaker':
          // Try system beep (same as system for web)
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.frequency.value = 1000;
            oscillator.type = 'square';
            gainNode.gain.value = 0.05;
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.05);
          } catch {
            // Fallback
          }
          break;
      }
      
      // Handle taskbar flash if configured
      const taskbarFlash = sshTerminalConfig?.taskbarFlash ?? 'disabled';
      if (taskbarFlash !== 'disabled') {
        invoke('flash_window').catch(() => {});
      }
    };
    
    // Subscribe to bell events
    term.onBell(handleBell);
    
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
    
    // Output batching for better rendering performance
    let outputBuffer: string[] = [];
    let flushScheduled = false;
    const BATCH_INTERVAL_MS = 8; // ~120fps, smooth but responsive
    
    const flushOutputBuffer = () => {
      if (outputBuffer.length === 0 || isDisposed.current || !termRef.current) {
        flushScheduled = false;
        return;
      }
      const data = outputBuffer.join('');
      outputBuffer = [];
      flushScheduled = false;
      safeWrite(data);
    };
    
    const scheduleFlush = () => {
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(flushOutputBuffer, BATCH_INTERVAL_MS);
      }
    };

    const attachListeners = async () => {
      if (!isSsh) return;
      try {
        const unlistenOutput = await listen<SshOutputEvent>("ssh-output", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          // Batch output for smoother rendering
          outputBuffer.push(event.payload.data);
          scheduleFlush();
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
  // sshTerminalConfig settings are intentionally read once at terminal creation to avoid
  // recreating terminal when settings change mid-session
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Send Ctrl+C (cancel) to the SSH session
  const sendCancel = useCallback(async () => {
    if (!isSsh || !sshSessionId.current || !isSshReady.current) return;
    try {
      // Ctrl+C is ASCII code 3
      await invoke("send_ssh_input", { sessionId: sshSessionId.current, data: "\x03" });
    } catch (err) {
      console.error("Failed to send Ctrl+C:", err);
    }
  }, [isSsh]);

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
              <>
                <button
                  onClick={() => setShowScriptSelector(true)}
                  className="app-bar-button p-2"
                  data-tooltip="Run Script"
                  aria-label="Run Script"
                >
                  <FileCode size={14} />
                </button>
                <button
                  onClick={sendCancel}
                  className="app-bar-button p-2 hover:text-red-500"
                  data-tooltip="Send Ctrl+C"
                  aria-label="Send Ctrl+C"
                >
                  <StopCircle size={14} />
                </button>
                <button
                  onClick={disconnectSsh}
                  className="app-bar-button p-2 hover:text-red-500"
                  data-tooltip="Disconnect"
                  aria-label="Disconnect"
                  disabled={status !== "connected"}
                >
                  <Unplug size={14} />
                </button>
                <button
                  onClick={handleReconnect}
                  className="app-bar-button p-2"
                  data-tooltip="Reconnect"
                  aria-label="Reconnect"
                >
                  <RotateCcw size={14} />
                </button>
                <div className="relative" ref={keyPopupRef}>
                  <button
                    onClick={() => setShowKeyPopup(v => !v)}
                    className={`app-bar-button p-2 ${hostKeyIdentity ? 'text-green-400' : 'text-gray-500'}`}
                    data-tooltip="Host key info"
                    aria-label="Host key info"
                  >
                    <Fingerprint size={14} />
                  </button>
                  {showKeyPopup && (
                    <CertificateInfoPopup
                      type="ssh"
                      host={session.hostname}
                      port={connection?.port || 22}
                      currentIdentity={hostKeyIdentity ?? undefined}
                      trustRecord={getStoredIdentity(session.hostname, connection?.port || 22, 'ssh')}
                      onClose={() => setShowKeyPopup(false)}
                    />
                  )}
                </div>
              </>
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

      {/* Script Selector Modal */}
      {showScriptSelector && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowScriptSelector(false);
              setScriptSearchQuery("");
              setScriptCategoryFilter("all");
              setScriptLanguageFilter("all");
              setScriptOsTagFilter("all");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowScriptSelector(false);
              setScriptSearchQuery("");
              setScriptCategoryFilter("all");
              setScriptLanguageFilter("all");
              setScriptOsTagFilter("all");
            }
          }}
        >
          <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col border border-[var(--color-border)]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <FileCode size={18} className="text-green-500" />
                <h3 className="text-base font-semibold text-[var(--color-text)]">Run Script</h3>
              </div>
              <button
                onClick={() => {
                  setShowScriptSelector(false);
                  setScriptSearchQuery("");
                  setScriptCategoryFilter("all");
                  setScriptLanguageFilter("all");
                  setScriptOsTagFilter("all");
                }}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b border-[var(--color-border)]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]" />
                <input
                  type="text"
                  value={scriptSearchQuery}
                  onChange={(e) => setScriptSearchQuery(e.target.value)}
                  placeholder="Search scripts..."
                  className="w-full pl-9 pr-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Compact Filters Bar */}
            <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[var(--color-textMuted)]">
                <Filter size={12} />
                <span className="text-xs font-medium">Filters:</span>
              </div>
              
              {/* Category Filter */}
              <select
                value={scriptCategoryFilter}
                onChange={(e) => setScriptCategoryFilter(e.target.value)}
                className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
              >
                <option value="all">All Categories</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              {/* Language Filter */}
              <select
                value={scriptLanguageFilter}
                onChange={(e) => setScriptLanguageFilter(e.target.value)}
                className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
              >
                <option value="all">All Languages</option>
                {uniqueLanguages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>

              {/* OS Tag Filter */}
              <select
                value={scriptOsTagFilter}
                onChange={(e) => setScriptOsTagFilter(e.target.value)}
                className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer"
              >
                <option value="all">All Platforms</option>
                {uniqueOsTags.map(tag => (
                  <option key={tag} value={tag}>{OS_TAG_ICONS[tag as OSTag]} {OS_TAG_LABELS[tag as OSTag]}</option>
                ))}
              </select>

              {/* Clear Filters */}
              {(scriptCategoryFilter !== 'all' || scriptLanguageFilter !== 'all' || scriptOsTagFilter !== 'all') && (
                <button
                  onClick={() => {
                    setScriptCategoryFilter("all");
                    setScriptLanguageFilter("all");
                    setScriptOsTagFilter("all");
                  }}
                  className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors ml-auto"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Script List */}
            <div className="flex-1 overflow-auto p-2">
              {Object.keys(scriptsByCategory).length === 0 ? (
                <div className="text-center py-8 text-[var(--color-textMuted)]">
                  <FileCode size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No scripts found</p>
                  <p className="text-xs mt-1">Add scripts in the Script Manager</p>
                </div>
              ) : (
                Object.entries(scriptsByCategory).map(([category, categoryScripts]) => (
                  <div key={category} className="mb-3">
                    <div className="text-xs font-semibold text-[var(--color-textMuted)] uppercase tracking-wider px-2 py-1">
                      {category}
                    </div>
                    <div className="space-y-1">
                      {categoryScripts.map((script) => (
                        <button
                          key={script.id}
                          onClick={() => runScript(script)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surfaceHover)] transition-colors group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-[var(--color-text)] truncate">
                                  {script.name}
                                </span>
                                {script.osTags && script.osTags.length > 0 && (
                                  <div className="flex items-center gap-0.5 flex-shrink-0">
                                    {script.osTags.slice(0, 2).map(tag => (
                                      <span key={tag} className="text-[10px]" title={OS_TAG_LABELS[tag]}>
                                        {OS_TAG_ICONS[tag]}
                                      </span>
                                    ))}
                                    {script.osTags.length > 2 && (
                                      <span className="text-[10px] text-[var(--color-textMuted)]">+{script.osTags.length - 2}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {script.description && (
                                <div className="text-xs text-[var(--color-textMuted)] truncate">
                                  {script.description}
                                </div>
                              )}
                            </div>
                            <Play size={14} className="text-green-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SSH Host Key Trust Warning Dialog */}
      {sshTrustPrompt && hostKeyIdentity && (
        <TrustWarningDialog
          type="ssh"
          host={session.hostname}
          port={connection?.port || 22}
          reason={sshTrustPrompt.status === 'mismatch' ? 'mismatch' : 'first-use'}
          receivedIdentity={hostKeyIdentity}
          storedIdentity={sshTrustPrompt.status === 'mismatch' ? sshTrustPrompt.stored : undefined}
          onAccept={() => {
            setSshTrustPrompt(null);
            sshTrustResolveRef.current?.(true);
            sshTrustResolveRef.current = null;
          }}
          onReject={() => {
            setSshTrustPrompt(null);
            sshTrustResolveRef.current?.(false);
            sshTrustResolveRef.current = null;
          }}
        />
      )}
    </div>
  );
};
