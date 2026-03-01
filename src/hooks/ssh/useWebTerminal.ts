import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { TOTPConfig } from "../../types/settings";
import { useTerminalRecorder } from "../recording/useTerminalRecorder";
import { useMacroRecorder } from "../recording/useMacroRecorder";
import { TerminalMacro, SavedRecording } from "../../types/macroTypes";
import * as macroService from "../../utils/macroService";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { ConnectionSession } from "../../types/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { mergeSSHTerminalConfig } from "../../types/settings";
import { ManagedScript, getDefaultScripts, OSTag } from "../../components/recording/ScriptManager";
import {
  verifyIdentity,
  trustIdentity,
  getStoredIdentity,
  getEffectiveTrustPolicy,
  formatFingerprint,
  type SshHostKeyIdentity,
  type TrustVerifyResult,
} from "../../utils/trustStore";

/* ── Internal types ────────────────────────────────────────────── */

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type SshOutputEvent = { session_id: string; data: string };
type SshErrorEvent = { session_id: string; message: string };
type SshClosedEvent = { session_id: string };

/* ── Hook ──────────────────────────────────────────────────────── */

export function useWebTerminal(
  session: ConnectionSession,
  onResize?: (cols: number, rows: number) => void,
) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();

  const connection = useMemo(
    () => state.connections.find((c) => c.id === session.connectionId),
    [state.connections, session.connectionId],
  );

  const sshTerminalConfig = useMemo(
    () =>
      mergeSSHTerminalConfig(
        settings.sshTerminal,
        connection?.sshTerminalConfigOverride,
      ),
    [settings.sshTerminal, connection?.sshTerminalConfigOverride],
  );

  /* ── terminal refs ── */
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /* ── SSH refs ── */
  const sshSessionId = useRef<string | null>(null);
  const isSshReady = useRef(false);
  const isConnecting = useRef(false);
  const isDisposed = useRef(false);
  const outputUnlistenRef = useRef<(() => void) | null>(null);
  const errorUnlistenRef = useRef<(() => void) | null>(null);
  const closeUnlistenRef = useRef<(() => void) | null>(null);

  /* ── UI state ── */
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  /* ── Script selector state ── */
  const [showScriptSelector, setShowScriptSelector] = useState(false);
  const [scripts, setScripts] = useState<ManagedScript[]>([]);
  const [scriptSearchQuery, setScriptSearchQuery] = useState("");
  const [scriptCategoryFilter, setScriptCategoryFilter] = useState<string>("all");
  const [scriptLanguageFilter, setScriptLanguageFilter] = useState<string>("all");
  const [scriptOsTagFilter, setScriptOsTagFilter] = useState<string>("all");

  /* ── SSH host-key trust state ── */
  const [showKeyPopup, setShowKeyPopup] = useState(false);
  const [hostKeyIdentity, setHostKeyIdentity] = useState<SshHostKeyIdentity | null>(null);
  const [sshTrustPrompt, setSshTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const sshTrustResolveRef = useRef<((accept: boolean) => void) | null>(null);
  const keyPopupRef = useRef<HTMLDivElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);
  const [showTotpPanel, setShowTotpPanel] = useState(false);

  /* ── Recording & macro state ── */
  const terminalRecorder = useTerminalRecorder();
  const macroRecorder = useMacroRecorder();
  const [showMacroList, setShowMacroList] = useState(false);
  const [savedMacros, setSavedMacros] = useState<TerminalMacro[]>([]);
  const [replayingMacro, setReplayingMacro] = useState(false);
  const replayAbortRef = useRef<AbortController | null>(null);
  const macroListRef = useRef<HTMLDivElement>(null);

  /* ── Stable refs for callbacks ── */
  const sessionRef = useRef(session);
  const connectionRef = useRef(connection);
  const isSsh = session.protocol === "ssh";

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { connectionRef.current = connection; }, [connection]);

  /* ──────────────────────────────────────────────────────────────
   * Script loading
   * ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const loadScripts = () => {
      try {
        const defaults = getDefaultScripts();
        const stored = localStorage.getItem("managedScripts");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === "object" && "customScripts" in parsed) {
            const { customScripts = [], modifiedDefaults = [], deletedDefaultIds = [] } = parsed;
            const activeDefaults = defaults
              .filter((d: ManagedScript) => !deletedDefaultIds.includes(d.id))
              .map(
                (d: ManagedScript) =>
                  modifiedDefaults.find((m: ManagedScript) => m.id === d.id) || d,
              );
            setScripts([...activeDefaults, ...customScripts]);
          } else if (Array.isArray(parsed)) {
            setScripts([...defaults, ...parsed]);
          } else {
            setScripts(defaults);
          }
        } else {
          setScripts(defaults);
        }
      } catch (e) {
        console.error("Failed to load scripts:", e);
        setScripts(getDefaultScripts());
      }
    };
    loadScripts();
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "managedScripts") loadScripts();
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  /* ── script filter memos ── */
  const uniqueCategories = useMemo(() => {
    const s = new Set<string>();
    scripts.forEach((sc) => s.add(sc.category || "Uncategorized"));
    return Array.from(s).sort();
  }, [scripts]);

  const uniqueLanguages = useMemo(() => {
    const s = new Set<string>();
    scripts.forEach((sc) => s.add(sc.language));
    return Array.from(s).sort();
  }, [scripts]);

  const uniqueOsTags = useMemo(() => {
    const s = new Set<string>();
    scripts.forEach((sc) => {
      if (sc.osTags) sc.osTags.forEach((tag) => s.add(tag));
    });
    return Array.from(s).sort();
  }, [scripts]);

  const filteredScripts = useMemo(() => {
    let result = scripts;
    if (scriptCategoryFilter !== "all")
      result = result.filter((s) => (s.category || "Uncategorized") === scriptCategoryFilter);
    if (scriptLanguageFilter !== "all")
      result = result.filter((s) => s.language === scriptLanguageFilter);
    if (scriptOsTagFilter !== "all")
      result = result.filter((s) => s.osTags && s.osTags.includes(scriptOsTagFilter as OSTag));
    if (scriptSearchQuery.trim()) {
      const q = scriptSearchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [scripts, scriptSearchQuery, scriptCategoryFilter, scriptLanguageFilter, scriptOsTagFilter]);

  const scriptsByCategory = useMemo(() => {
    const groups: Record<string, ManagedScript[]> = {};
    filteredScripts.forEach((script) => {
      const cat = script.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(script);
    });
    return groups;
  }, [filteredScripts]);

  const resetScriptSelectorFilters = useCallback(() => {
    setScriptSearchQuery("");
    setScriptCategoryFilter("all");
    setScriptLanguageFilter("all");
    setScriptOsTagFilter("all");
  }, []);

  const closeScriptSelector = useCallback(() => {
    setShowScriptSelector(false);
    resetScriptSelectorFilters();
  }, [resetScriptSelectorFilters]);

  /* ──────────────────────────────────────────────────────────────
   * SSH helpers
   * ────────────────────────────────────────────────────────────── */

  const setStatusState = useCallback((next: ConnectionStatus) => {
    setStatus(next);
    isConnecting.current = next === "connecting";
    isSshReady.current = next === "connected";
  }, []);

  /* ── Buffer serialize / restore ── */

  const serializeBuffer = useCallback(() => {
    if (!termRef.current) return "";
    const buffer = termRef.current.buffer.active;
    const lines: string[] = [];
    let lastNonEmptyLine = -1;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        const text = line.translateToString(true);
        lines.push(text);
        if (text.trim()) lastNonEmptyLine = i;
      }
    }
    return lastNonEmptyLine >= 0 ? lines.slice(0, lastNonEmptyLine + 1).join("\n") : "";
  }, []);

  const restoreBuffer = useCallback((content: string) => {
    if (!termRef.current || !content || isDisposed.current) return;
    try {
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) {
        setTimeout(() => restoreBuffer(content), 100);
        return;
      }
      termRef.current.clear();
      const lines = content.split("\n");
      for (const line of lines) termRef.current.writeln(line);
    } catch (err) {
      console.error("Failed to restore terminal buffer:", err);
    }
  }, []);

  /* ── Buffer request/restore effects ── */

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ sessionId: string }>("request-terminal-buffer", async (event) => {
      if (event.payload.sessionId !== session.id) return;
      let buffer = "";
      if (sshSessionId.current && session.protocol === "ssh") {
        try {
          buffer = await invoke<string>("get_terminal_buffer", { sessionId: sshSessionId.current });
        } catch {
          buffer = serializeBuffer();
        }
      } else {
        buffer = serializeBuffer();
      }
      await emit("terminal-buffer-response", { sessionId: session.id, buffer });
    })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);
    return () => { unlisten?.(); };
  }, [session.id, session.protocol, serializeBuffer]);

  const bufferRestoredRef = useRef(false);

  useEffect(() => {
    if (!session.terminalBuffer || bufferRestoredRef.current) return;
    const tryRestore = (attempts = 0) => {
      if (attempts > 30) return;
      if (!termRef.current) { setTimeout(() => tryRestore(attempts + 1), 100); return; }
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) { setTimeout(() => tryRestore(attempts + 1), 100); return; }
      bufferRestoredRef.current = true;
      restoreBuffer(session.terminalBuffer!);
    };
    const timer = setTimeout(() => tryRestore(0), 300);
    return () => clearTimeout(timer);
  }, [session.terminalBuffer, restoreBuffer]);

  /* ── Terminal write helpers ── */

  const canRender = useCallback(() => {
    if (!termRef.current) return false;
    const core = (termRef.current as any)?._core;
    if (!core) return false;
    const renderService = core?.renderService ?? core?._renderService;
    if (!renderService) return false;
    const dims = renderService?.dimensions;
    if (!dims) return false;
    if (typeof dims.css?.cell?.width !== "number" || dims.css?.cell?.width <= 0) return false;
    return true;
  }, []);

  const safeWrite = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (termRef.current.element && !termRef.current.element.isConnected) return;
    if (!canRender()) return;
    try { termRef.current.write(text); } catch { /* ignore */ }
  }, [canRender]);

  const safeWriteln = useCallback((text: string) => {
    if (isDisposed.current || !termRef.current) return;
    if (termRef.current.element && !termRef.current.element.isConnected) return;
    if (!canRender()) return;
    try { termRef.current.writeln(text); } catch { /* ignore */ }
  }, [canRender]);

  const writeLine = useCallback((text: string) => { safeWriteln(text); }, [safeWriteln]);

  /* ── Theme ── */

  const getTerminalTheme = useCallback(() => {
    if (typeof window === "undefined") {
      return { background: "#0b1120", foreground: "#e2e8f0", cursor: "#7dd3fc", selectionBackground: "#1e293b" };
    }
    const styles = getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue("--color-background").trim() || "#0b1120";
    const foreground = styles.getPropertyValue("--color-text").trim() || "#e2e8f0";
    const cursor = styles.getPropertyValue("--color-primary").trim() || "#7dd3fc";
    const selectionBackground = styles.getPropertyValue("--color-border").trim() || "#1e293b";
    return { background, foreground, cursor, selectionBackground };
  }, []);

  const applyTerminalTheme = useCallback(() => {
    if (!termRef.current || isDisposed.current) return;
    if (!canRender()) return;
    const theme = getTerminalTheme();
    const terminal = termRef.current as any;
    try {
      if (typeof terminal.setOption === "function") { terminal.setOption("theme", theme); return; }
      if (terminal.options) terminal.options.theme = theme;
    } catch { /* ignore */ }
  }, [canRender, getTerminalTheme]);

  /* ── Error helpers ── */

  const formatErrorDetails = useCallback((err: unknown) => {
    if (err instanceof Error)
      return { message: err.message || "Unknown error", name: err.name || "Error", stack: err.stack || "" };
    if (typeof err === "string") return { message: err, name: "Error", stack: "" };
    try { return { message: JSON.stringify(err), name: "Error", stack: "" }; } catch {
      return { message: String(err), name: "Error", stack: "" };
    }
  }, []);

  const classifySshError = useCallback((message: string) => {
    const lower = message.toLowerCase();
    if (message.includes("All authentication methods failed") || message.includes("Authentication failed"))
      return { kind: "auth", friendly: "Authentication failed - please check your credentials" };
    if (lower.includes("connection refused") || lower.includes("os error 10061"))
      return { kind: "connection_refused", friendly: "Connection refused - please check the host and port" };
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("os error 10060") || lower.includes("connection attempt failed"))
      return { kind: "timeout", friendly: "Connection timeout - please check network connectivity" };
    if (message.includes("Host key verification failed"))
      return { kind: "host_key", friendly: "Host key verification failed - server may have changed" };
    if (lower.includes("certificate") || lower.includes("x509"))
      return { kind: "certificate", friendly: "Certificate validation failed - please verify the server identity" };
    if (message.includes("No such file or directory") && message.includes("private key"))
      return { kind: "key_missing", friendly: "Private key file not found - please check the key path" };
    if (message.includes("Permission denied"))
      return { kind: "permission", friendly: "Permission denied - please check your credentials" };
    if (lower.includes("failed to establish tcp connection") || lower.includes("failed to connect"))
      return { kind: "tcp_connect", friendly: "TCP connection failed - please verify the host and port" };
    if (lower.includes("no route to host") || lower.includes("network unreachable"))
      return { kind: "network_unreachable", friendly: "Network unreachable - please check routing or VPN" };
    return { kind: "unknown", friendly: "SSH connection failed - please check credentials and network" };
  }, []);

  /* ── SSH connect / disconnect ── */

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
    if (!force && (isConnecting.current || isSshReady.current)) return;
    if (!force && sshSessionId.current && currentSession.shellId) {
      setStatusState("connected");
      return;
    }
    if (force) sshSessionId.current = null;

    const ignoreHostKey = currentConnection.ignoreSshSecurityErrors ?? true;
    setStatusState("connecting");
    setError("");
    if (typeof (termRef.current as any).reset === "function") {
      try { (termRef.current as any).reset(); } catch { /* ignore */ }
    } else {
      try { termRef.current.clear(); } catch { /* ignore */ }
    }

    writeLine("\x1b[36mConnecting to SSH server...\x1b[0m");
    writeLine(`\x1b[90mHost: ${currentSession.hostname}\x1b[0m`);
    writeLine(`\x1b[90mPort: ${currentConnection.port || 22}\x1b[0m`);
    writeLine(`\x1b[90mUser: ${currentConnection.username || "unknown"}\x1b[0m`);

    const authMethod = currentConnection.authType || (currentConnection.privateKey ? "key" : "password");
    writeLine(`\x1b[90mAuth: ${authMethod}\x1b[0m`);
    writeLine(`\x1b[90mHost key checking: ${ignoreHostKey ? "disabled (ignore errors)" : "enabled"}\x1b[0m`);

    try {
      // Try reattaching to existing backend session
      if (currentSession.backendSessionId && !force) {
        const isAlive = await invoke<boolean>("is_session_alive", { sessionId: currentSession.backendSessionId }).catch(() => false);
        if (isAlive) {
          sshSessionId.current = currentSession.backendSessionId;
          const buffer = await invoke<string>("get_terminal_buffer", { sessionId: currentSession.backendSessionId }).catch(() => "");
          if (buffer) { restoreBuffer(buffer); writeLine("\x1b[32mRestored terminal buffer from session\x1b[0m"); }
          const existingShellId = await invoke<string | null>("get_shell_info", { sessionId: currentSession.backendSessionId }).catch(() => null);
          if (existingShellId) {
            dispatch({ type: "UPDATE_SESSION", payload: { ...currentSession, shellId: existingShellId } });
            writeLine("\x1b[32mReattached to existing SSH session\x1b[0m");
            setStatusState("connected");
            return;
          }
          const shellId = await invoke<string>("reattach_session", { sessionId: currentSession.backendSessionId });
          dispatch({ type: "UPDATE_SESSION", payload: { ...currentSession, shellId } });
          writeLine("\x1b[32mRestarted shell on existing SSH connection\x1b[0m");
          setStatusState("connected");
          return;
        } else {
          writeLine("\x1b[33mPrevious session expired, creating new connection...\x1b[0m");
        }
      }

      disconnectSsh();

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
        tcp_no_delay: tcpOptions?.tcpNoDelay ?? true,
        tcp_keepalive: tcpOptions?.tcpKeepAlive ?? true,
        keepalive_probes: tcpOptions?.keepAliveProbes ?? 3,
        ip_protocol: tcpOptions?.ipProtocol ?? "auto",
        compression: sshTerminalConfig?.enableCompression ?? false,
        compression_level: sshTerminalConfig?.compressionLevel ?? 6,
        ssh_version: sshTerminalConfig?.sshVersion ?? "auto",
        preferred_ciphers: sshTerminalConfig?.preferredCiphers ?? [],
        preferred_macs: sshTerminalConfig?.preferredMACs ?? [],
        preferred_kex: sshTerminalConfig?.preferredKeyExchanges ?? [],
        preferred_host_key_algorithms: sshTerminalConfig?.preferredHostKeyAlgorithms ?? [],
      };

      switch (authMethod) {
        case "password":
          if (!currentConnection.password) throw new Error("Password authentication requires a password");
          sshConfig.password = currentConnection.password;
          sshConfig.private_key_path = null;
          sshConfig.private_key_passphrase = null;
          break;
        case "key":
          if (!currentConnection.privateKey) throw new Error("Key authentication requires a key path");
          sshConfig.password = null;
          sshConfig.private_key_path = currentConnection.privateKey;
          sshConfig.private_key_passphrase = currentConnection.passphrase || null;
          break;
        case "totp":
          if (!currentConnection.password || !currentConnection.totpSecret) throw new Error("TOTP requires password and TOTP secret");
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
      dispatch({ type: "UPDATE_SESSION", payload: { ...currentSession, backendSessionId: sessionId } });
      writeLine("\x1b[32mSSH connection established\x1b[0m");

      /* ── host key trust verification ── */
      const sshTrustPolicy = getEffectiveTrustPolicy(currentConnection.sshTrustPolicy, settings.sshTrustPolicy);
      if (sshTrustPolicy !== "always-trust") {
        try {
          const keyInfo = await invoke<{ fingerprint: string; key_type: string | null; key_bits: number | null; public_key: string | null }>("get_ssh_host_key_info", { sessionId });
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
          const connId = currentConnection.id;
          const result = verifyIdentity(currentSession.hostname, sshPort, "ssh", identity, connId);

          if (result.status === "first-use" && sshTrustPolicy === "tofu") {
            trustIdentity(currentSession.hostname, sshPort, "ssh", identity, false, connId);
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            writeLine(`\x1b[90mKey type: ${keyInfo.key_type ?? "unknown"}\x1b[0m`);
            writeLine("\x1b[33mHost key memorized (Trust-On-First-Use)\x1b[0m");
          } else if (result.status === "trusted") {
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            writeLine("\x1b[32mHost key matches stored identity\x1b[0m");
          } else {
            writeLine(`\x1b[90mHost key fingerprint (SHA-256): ${keyInfo.fingerprint}\x1b[0m`);
            if (result.status === "mismatch") {
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

            trustIdentity(currentSession.hostname, sshPort, "ssh", identity, true, connId);
            writeLine("\x1b[32mHost key accepted and memorized\x1b[0m");
          }
        } catch (err) {
          writeLine(`\x1b[33mCould not retrieve host key info: ${err}\x1b[0m`);
        }
      }

      const shellId = await invoke<string>("start_shell", { sessionId });
      dispatch({ type: "UPDATE_SESSION", payload: { ...currentSession, backendSessionId: sessionId, shellId } });
      writeLine("\x1b[32mShell started successfully\x1b[0m");
      setStatusState("connected");
    } catch (err: unknown) {
      const details = formatErrorDetails(err);
      const classification = classifySshError(details.message);
      console.error("SSH connection failed:", { kind: classification.kind, message: details.message, name: details.name, stack: details.stack });
      setStatusState("error");
      setError(classification.friendly);
      writeLine(`\x1b[31m${classification.friendly}\x1b[0m`);
      writeLine(`\x1b[90mFailure reason: ${classification.kind}\x1b[0m`);
      writeLine(`\x1b[90mRaw error: ${details.message}\x1b[0m`);
    }
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [classifySshError, disconnectSsh, formatErrorDetails, isSsh, dispatch, restoreBuffer, setStatusState, writeLine]);

  /* ── Input handling ── */

  const handleInput = useCallback(async (data: string) => {
    if (!termRef.current || isDisposed.current) return;
    if (isSsh) {
      if (!sshSessionId.current || !isSshReady.current || isConnecting.current) return;
      if (macroRecorder.isRecording) macroRecorder.recordInput(data);
      try { await invoke("send_ssh_input", { sessionId: sshSessionId.current, data }); } catch (err) {
        console.error("Failed to send SSH input:", err);
      }
      return;
    }
    safeWrite(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSsh, safeWrite]);

  /* ── Run script ── */

  const runScript = useCallback(async (script: ManagedScript) => {
    if (!isSsh || !sshSessionId.current || !isSshReady.current || isConnecting.current) return;
    try {
      const lines = script.script.split("\n").filter((line) => !line.startsWith("#!"));
      const command = lines.join("\n");
      await invoke("send_ssh_input", { sessionId: sshSessionId.current, data: command + "\n" });
      closeScriptSelector();
    } catch (err) {
      console.error("Failed to run script:", err);
    }
  }, [isSsh, closeScriptSelector]);

  /* ──────────────────────────────────────────────────────────────
   * Terminal creation & lifecycle effect
   * ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    isDisposed.current = false;

    const fontFamily = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.family
      ? sshTerminalConfig.font.family
      : '"Cascadia Code", "Fira Code", Menlo, Monaco, "Ubuntu Mono", "Courier New", monospace';
    const fontSize = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.size ? sshTerminalConfig.font.size : 13;
    const lineHeight = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.lineHeight ? sshTerminalConfig.font.lineHeight : 1.25;
    const letterSpacing = sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.letterSpacing ? sshTerminalConfig.font.letterSpacing : 0;
    const scrollbackLines = sshTerminalConfig?.scrollbackLines ?? 10000;
    const wordSeparator = sshTerminalConfig?.wordSeparators ?? " \t";
    const dimensionOptions = sshTerminalConfig?.useCustomDimensions
      ? { cols: sshTerminalConfig.columns, rows: sshTerminalConfig.rows }
      : {};

    const term = new Terminal({
      theme: getTerminalTheme(),
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      cursorBlink: true,
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

    /* ── bell handling ── */
    let bellCount = 0;
    let bellSilenced = false;
    let bellResetTimer: ReturnType<typeof setTimeout> | null = null;
    let bellSilenceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleBell = () => {
      const bellStyle = sshTerminalConfig?.bellStyle ?? "system";
      const overuseProtection = sshTerminalConfig?.bellOveruseProtection;

      if (overuseProtection?.enabled) {
        bellCount++;
        if (bellResetTimer) clearTimeout(bellResetTimer);
        bellResetTimer = setTimeout(() => { bellCount = 0; }, (overuseProtection.timeWindowSeconds ?? 2) * 1000);
        if (bellCount > (overuseProtection.maxBells ?? 5)) {
          if (!bellSilenced) {
            bellSilenced = true;
            bellSilenceTimer = setTimeout(() => { bellSilenced = false; bellCount = 0; }, (overuseProtection.silenceDurationSeconds ?? 5) * 1000);
          }
          return;
        }
      }

      if (bellSilenced) return;

      switch (bellStyle) {
        case "none": break;
        case "system":
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = 800; osc.type = "sine"; gain.gain.value = 0.1;
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
          } catch { /* audio not available */ }
          break;
        case "visual":
          if (containerRef.current) {
            containerRef.current.style.backgroundColor = "#ff0";
            setTimeout(() => { if (containerRef.current) containerRef.current.style.backgroundColor = ""; }, 100);
          }
          break;
        case "flash-window":
          invoke("flash_window").catch(() => {});
          break;
        case "pc-speaker":
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = 1000; osc.type = "square"; gain.gain.value = 0.05;
            osc.start(); osc.stop(audioCtx.currentTime + 0.05);
          } catch { /* fallback */ }
          break;
      }

      const taskbarFlash = sshTerminalConfig?.taskbarFlash ?? "disabled";
      if (taskbarFlash !== "disabled") invoke("flash_window").catch(() => {});
    };

    term.onBell(handleBell);

    const openTimer = requestAnimationFrame(() => {
      if (isDisposed.current) return;
      try {
        term.open(container);
        if (container.isConnected && !isDisposed.current) term.focus();
      } catch (err) { console.warn("Failed to open terminal:", err); }
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
      const dims = renderService.dimensions;
      return typeof dims.css?.cell?.width === "number" && dims.css?.cell?.width > 0;
    };

    const doFit = () => {
      if (isDisposed.current || !fitRef.current || !termRef.current) return;
      if (!container.isConnected || !termRef.current.element?.isConnected) return;
      if (!canFit()) {
        if (initRetryCount < maxInitRetries) { initRetryCount++; setTimeout(doFit, 50); }
        return;
      }
      try {
        fitRef.current.fit();
        onResize?.(termRef.current.cols, termRef.current.rows);
        if (isSsh && sshSessionId.current) {
          invoke("resize_ssh_shell", { sessionId: sshSessionId.current, cols: termRef.current.cols, rows: termRef.current.rows }).catch(() => undefined);
        }
      } catch { /* ignore */ }
    };

    const scheduleFit = () => {
      if (isDisposed.current) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(doFit);
    };

    const resizeTimer = setTimeout(scheduleFit, 50);
    window.addEventListener("resize", scheduleFit);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleFit) : null;
    resizeObserver?.observe(container);

    const dataDisposable = term.onData(handleInput);

    let cancelled = false;
    let outputBuffer: string[] = [];
    let flushScheduled = false;
    const BATCH_INTERVAL_MS = 8;

    const flushOutputBuffer = () => {
      if (outputBuffer.length === 0 || isDisposed.current || !termRef.current) { flushScheduled = false; return; }
      const data = outputBuffer.join("");
      outputBuffer = [];
      flushScheduled = false;
      safeWrite(data);
    };

    const scheduleFlush = () => { if (!flushScheduled) { flushScheduled = true; setTimeout(flushOutputBuffer, BATCH_INTERVAL_MS); } };

    const attachListeners = async () => {
      if (!isSsh) return;
      try {
        const unlistenOutput = await listen<SshOutputEvent>("ssh-output", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          outputBuffer.push(event.payload.data);
          scheduleFlush();
        });
        if (!cancelled) outputUnlistenRef.current = unlistenOutput; else unlistenOutput();

        const unlistenError = await listen<SshErrorEvent>("ssh-error", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          safeWriteln(`\r\n\x1b[31mSSH error: ${event.payload.message}\x1b[0m`);
        });
        if (!cancelled) errorUnlistenRef.current = unlistenError; else unlistenError();

        const unlistenClosed = await listen<SshClosedEvent>("ssh-shell-closed", (event) => {
          if (event.payload.session_id !== sshSessionId.current) return;
          setStatusState("error");
          setError("Shell closed");
        });
        if (!cancelled) closeUnlistenRef.current = unlistenClosed; else unlistenClosed();
      } catch (error) {
        console.error("Failed to attach SSH listeners:", error);
      }
    };

    attachListeners();

    if (isSsh) {
      initSsh();
    } else {
      const s = sessionRef.current;
      safeWriteln(`\x1b[32mTerminal ready for ${s.protocol.toUpperCase()} session\x1b[0m`);
      safeWriteln(`\x1b[36mConnected to: ${s.hostname}\x1b[0m`);
      setStatusState("connected");
    }

    return () => {
      isDisposed.current = true;
      cancelled = true;
      cancelAnimationFrame(openTimer);
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      if (bellResetTimer) clearTimeout(bellResetTimer);
      if (bellSilenceTimer) clearTimeout(bellSilenceTimer);
      window.removeEventListener("resize", scheduleFit);
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      outputUnlistenRef.current?.(); errorUnlistenRef.current?.(); closeUnlistenRef.current?.();
      outputUnlistenRef.current = null; errorUnlistenRef.current = null; closeUnlistenRef.current = null;
      requestAnimationFrame(() => { try { term.dispose(); } catch { /* ignore */ } });
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTerminalTheme, handleInput, initSsh, isSsh, onResize, session.id, safeWrite, safeWriteln, setStatusState]);

  /* ── Apply theme on settings change ── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSettingsUpdate = () => { applyTerminalTheme(); };
    window.addEventListener("settings-updated", handleSettingsUpdate);
    return () => window.removeEventListener("settings-updated", handleSettingsUpdate);
  }, [applyTerminalTheme]);

  /* ── Simple actions ── */

  const safeFit = useCallback(() => {
    if (isDisposed.current || !fitRef.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    const core = (termRef.current as any)?._core;
    const renderService = core?.renderService ?? core?._renderService;
    if (!renderService?.dimensions) return;
    try { fitRef.current.fit(); } catch { /* ignore */ }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    setTimeout(() => safeFit(), 60);
  }, [safeFit]);

  const handleReconnect = useCallback(async () => {
    if (!isSsh) return;
    setStatusState("connecting");
    disconnectSsh();
    const currentSession = sessionRef.current;
    if (currentSession.backendSessionId || currentSession.shellId) {
      dispatch({ type: "UPDATE_SESSION", payload: { ...currentSession, backendSessionId: undefined, shellId: undefined } });
    }
    await initSsh(true);
    setTimeout(() => safeFit(), 80);
  }, [dispatch, disconnectSsh, initSsh, isSsh, safeFit, setStatusState]);

  const clearTerminal = useCallback(() => {
    if (!termRef.current || !canRender()) return;
    try { termRef.current.clear(); } catch { /* ignore */ }
  }, [canRender]);

  const copySelection = useCallback(() => {
    const selection = termRef.current?.getSelection();
    if (!selection) return;
    navigator.clipboard.writeText(selection).catch(() => undefined);
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      await handleInput(text);
    } catch (err) {
      console.error("Failed to paste from clipboard:", err);
    }
  }, [handleInput]);

  const sendCancel = useCallback(async () => {
    if (!isSsh || !sshSessionId.current || !isSshReady.current) return;
    try { await invoke("send_ssh_input", { sessionId: sshSessionId.current, data: "\x03" }); } catch (err) {
      console.error("Failed to send Ctrl+C:", err);
    }
  }, [isSsh]);

  /* ── Recording handlers ── */

  const handleStartRecording = useCallback(async () => {
    if (!sshSessionId.current) return;
    const fit = fitRef.current;
    const cols = fit ? (fit.proposeDimensions()?.cols ?? 80) : 80;
    const rows = fit ? (fit.proposeDimensions()?.rows ?? 24) : 24;
    try {
      await terminalRecorder.startRecording(sshSessionId.current, settings.recording?.recordInput ?? false, cols, rows);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [terminalRecorder, settings]);

  const handleStopRecording = useCallback(async () => {
    if (!sshSessionId.current) return;
    const recording = await terminalRecorder.stopRecording(sshSessionId.current);
    if (recording) {
      const name = `${session.hostname} - ${new Date().toLocaleString()}`;
      const saved: SavedRecording = { id: crypto.randomUUID(), name, recording, savedAt: new Date().toISOString(), connectionId: session.connectionId };
      await macroService.saveRecording(saved);
    }
  }, [terminalRecorder, session.hostname, session.connectionId]);

  /* ── Macro handlers ── */

  const handleStartMacroRecording = useCallback(() => { macroRecorder.startRecording(); }, [macroRecorder]);

  const handleStopMacroRecording = useCallback(async () => {
    const steps = macroRecorder.stopRecording();
    if (steps.length > 0) {
      const macro: TerminalMacro = { id: crypto.randomUUID(), name: `Macro - ${new Date().toLocaleString()}`, steps, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await macroService.saveMacro(macro);
      setSavedMacros(await macroService.loadMacros());
    }
  }, [macroRecorder]);

  const handleReplayMacro = useCallback(async (macro: TerminalMacro) => {
    if (!sshSessionId.current || replayingMacro) return;
    setShowMacroList(false);
    setReplayingMacro(true);
    const controller = new AbortController();
    replayAbortRef.current = controller;
    try {
      await macroService.replayMacro(sshSessionId.current, macro, undefined, controller.signal);
    } catch (err) {
      console.error("Macro replay failed:", err);
    } finally {
      setReplayingMacro(false);
      replayAbortRef.current = null;
    }
  }, [replayingMacro]);

  const handleStopReplay = useCallback(() => { replayAbortRef.current?.abort(); }, []);

  useEffect(() => {
    if (showMacroList) macroService.loadMacros().then(setSavedMacros);
  }, [showMacroList]);

  /* ── TOTP ── */

  const totpConfigs = connection?.totpConfigs ?? [];

  const handleUpdateTotpConfigs = useCallback((configs: TOTPConfig[]) => {
    if (connection) dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, totpConfigs: configs } });
  }, [connection, dispatch]);

  /* ── Computed ── */

  const statusToneClass = useMemo(() => {
    switch (status) {
      case "connected": return "app-badge--success";
      case "connecting": return "app-badge--warning";
      case "error": return "app-badge--error";
      default: return "app-badge--neutral";
    }
  }, [status]);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return {
    /* context */
    session,
    connection,
    settings,
    isSsh,
    /* refs */
    containerRef,
    keyPopupRef,
    totpBtnRef,
    macroListRef,
    /* status */
    status,
    error,
    isFullscreen,
    statusToneClass,
    /* script selector */
    showScriptSelector,
    setShowScriptSelector,
    scriptSearchQuery,
    setScriptSearchQuery,
    scriptCategoryFilter,
    setScriptCategoryFilter,
    scriptLanguageFilter,
    setScriptLanguageFilter,
    scriptOsTagFilter,
    setScriptOsTagFilter,
    uniqueCategories,
    uniqueLanguages,
    uniqueOsTags,
    scriptsByCategory,
    closeScriptSelector,
    runScript,
    /* SSH trust */
    showKeyPopup,
    setShowKeyPopup,
    hostKeyIdentity,
    sshTrustPrompt,
    setSshTrustPrompt,
    sshTrustResolveRef,
    /* TOTP */
    showTotpPanel,
    setShowTotpPanel,
    totpConfigs,
    handleUpdateTotpConfigs,
    /* recording */
    terminalRecorder,
    macroRecorder,
    handleStartRecording,
    handleStopRecording,
    handleStartMacroRecording,
    handleStopMacroRecording,
    /* macros */
    showMacroList,
    setShowMacroList,
    savedMacros,
    replayingMacro,
    handleReplayMacro,
    handleStopReplay,
    /* actions */
    copySelection,
    pasteFromClipboard,
    sendCancel,
    disconnectSsh,
    handleReconnect,
    clearTerminal,
    toggleFullscreen,
    /* helpers */
    formatDuration,
  };
}

export type WebTerminalMgr = ReturnType<typeof useWebTerminal>;
