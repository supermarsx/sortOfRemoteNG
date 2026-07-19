import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { TOTPConfig } from "../../types/settings/settings";
import { useTerminalRecorder } from "../recording/useTerminalRecorder";
import { useMacroRecorder } from "../recording/useMacroRecorder";
import {
  TerminalMacro,
  SavedRecording,
} from "../../types/recording/macroTypes";
import * as macroService from "../../utils/recording/macroService";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import { useToastContext } from "../../contexts/ToastContext";
import { useSettings } from "../../contexts/SettingsContext";
import {
  mergeSSHTerminalConfig,
  mergeSSHConnectionConfig,
  defaultSSHConnectionConfig,
} from "../../types/settings/settings";
import {
  ManagedScript,
  getDefaultScripts,
  OSTag,
} from "../../components/recording/ScriptManager";
import {
  verifyIdentity,
  trustIdentity,
  resolveEffectiveTrustPolicy,
  type SshHostKeyIdentity,
  type TrustVerifyResult,
} from "../../utils/auth/trustStore";
import {
  formatRuntimeNetworkPathError,
  resolveRuntimeNetworkPath,
  type RuntimeNetworkPath,
} from "../../utils/network/resolveRuntimeNetworkPath";
import {
  acquireSessionVpnLeases,
  createVpnLeaseAttemptOwnerId,
  releaseSessionVpnLeases,
  vpnLeaseCleanupError,
} from "../../utils/network/vpnSessionLeases";
import { redactSecrets } from "../../utils/errors/redact";
import { useSSHCommandHistory } from "./useSSHCommandHistory";

/* ── Internal types ────────────────────────────────────────────── */

/**
 * Stable prefix the backend uses to refuse an unconfirmed (imported/synced)
 * ProxyCommand. Mirrors Rust `PROXY_COMMAND_CONFIRMATION_REQUIRED_CODE`.
 */
const PROXY_COMMAND_CONFIRMATION_REQUIRED =
  "PROXY_COMMAND_CONFIRMATION_REQUIRED";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type SshOutputEvent = { session_id: string; data: string };
type SshErrorEvent = { session_id: string; message: string };
type SshClosedEvent = { session_id: string };
type HostKeyPromptDecision = "accept_once" | "accept_and_save" | "reject";
type SshHostKeyPromptEvent = {
  session_id: string;
  host: string;
  port: number;
  username: string;
  status: "first_use" | "mismatch";
  fingerprint: string;
  key_type: string | null;
  key_bits: number | null;
  public_key: string | null;
};

interface VpnLeaseOwnerTracker {
  current: string | null;
  persisted: string | null;
  pending: Set<string>;
}

const MAX_TRACKED_VPN_LEASE_OWNERS = 32;

const trackedVpnLeaseOwnerIds = (tracker: VpnLeaseOwnerTracker): string[] => {
  const owners = new Set(tracker.pending);
  if (tracker.current) owners.add(tracker.current);
  if (tracker.persisted) owners.add(tracker.persisted);
  return [...owners];
};

const trackPendingVpnLeaseOwner = (
  tracker: VpnLeaseOwnerTracker,
  ownerId: string,
): void => {
  if (trackedVpnLeaseOwnerIds(tracker).includes(ownerId)) {
    tracker.pending.add(ownerId);
    return;
  }
  if (trackedVpnLeaseOwnerIds(tracker).length >= MAX_TRACKED_VPN_LEASE_OWNERS) {
    throw new Error(
      "VPN cleanup is still pending for too many SSH attempts. Retry disconnect before reconnecting.",
    );
  }
  tracker.pending.add(ownerId);
};

const persistTrackedVpnLeaseOwners = (
  tracker: VpnLeaseOwnerTracker,
): Pick<ConnectionSession, "vpnLeaseOwnerId" | "vpnLeaseOwnerIds"> => {
  const ownerIds = trackedVpnLeaseOwnerIds(tracker).slice(
    0,
    MAX_TRACKED_VPN_LEASE_OWNERS,
  );
  const primaryOwnerId =
    tracker.current ?? tracker.persisted ?? ownerIds[0] ?? null;
  tracker.persisted = primaryOwnerId;
  return {
    vpnLeaseOwnerId: primaryOwnerId ?? undefined,
    vpnLeaseOwnerIds: ownerIds.length > 0 ? ownerIds : undefined,
  };
};

/* ── Hook ──────────────────────────────────────────────────────── */

export function useWebTerminal(
  session: ConnectionSession,
  onResize?: (cols: number, rows: number) => void,
) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();

  const connection = useMemo(
    () => resolveRuntimeConnection(state.connections, session.connectionId),
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

  const sshConnectionConfig = useMemo(
    () =>
      mergeSSHConnectionConfig(
        settings.sshConnection ?? defaultSSHConnectionConfig,
        connection?.sshConnectionConfigOverride,
      ),
    [settings.sshConnection, connection?.sshConnectionConfigOverride],
  );

  /* ── terminal refs ── */
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /* ── SSH refs ── */
  const sshSessionId = useRef<string | null>(null);
  const initialVpnLeaseOwners = [
    ...new Set(
      [...(session.vpnLeaseOwnerIds ?? []), session.vpnLeaseOwnerId].filter(
        (ownerId): ownerId is string => Boolean(ownerId),
      ),
    ),
  ].slice(0, MAX_TRACKED_VPN_LEASE_OWNERS);
  const initialVpnLeaseOwner =
    session.vpnLeaseOwnerId ?? initialVpnLeaseOwners[0] ?? null;
  const vpnLeaseOwnersRef = useRef<VpnLeaseOwnerTracker>({
    current: initialVpnLeaseOwner,
    persisted: initialVpnLeaseOwner,
    pending: new Set(
      initialVpnLeaseOwners.filter(
        (ownerId) => ownerId !== initialVpnLeaseOwner,
      ),
    ),
  });
  const vpnLeaseReleasesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const pendingSshBackendCleanupRef = useRef(new Set<string>());
  const pendingSshBackendOwnersRef = useRef(new Map<string, string>());
  const protectedVpnLeaseOwnersRef = useRef(new Set<string>());
  const sshInitGenRef = useRef(0);
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
  const [scriptCategoryFilter, setScriptCategoryFilter] =
    useState<string>("all");
  const [scriptLanguageFilter, setScriptLanguageFilter] =
    useState<string>("all");
  const [scriptOsTagFilter, setScriptOsTagFilter] = useState<string>("all");

  /* ── SSH host-key trust state ── */
  const [showKeyPopup, setShowKeyPopup] = useState(false);
  const [hostKeyIdentity, setHostKeyIdentity] =
    useState<SshHostKeyIdentity | null>(null);
  const [sshTrustPrompt, setSshTrustPrompt] =
    useState<TrustVerifyResult | null>(null);
  const sshTrustResolveRef = useRef<
    ((decision: HostKeyPromptDecision) => void) | null
  >(null);

  /* ── ProxyCommand import-confirmation gate state ── */
  const [proxyCommandPrompt, setProxyCommandPrompt] = useState<{
    command: string;
  } | null>(null);
  const proxyCommandResolveRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const keyPopupRef = useRef<HTMLDivElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);
  const [showTotpPanel, setShowTotpPanel] = useState(false);

  /* ── Recording & macro state ── */
  const terminalRecorder = useTerminalRecorder();
  const macroRecorder = useMacroRecorder();
  const macroRecorderRef = useRef(macroRecorder);
  useEffect(() => {
    macroRecorderRef.current = macroRecorder;
  }, [macroRecorder]);
  const [showMacroList, setShowMacroList] = useState(false);
  const [savedMacros, setSavedMacros] = useState<TerminalMacro[]>([]);
  const [replayingMacro, setReplayingMacro] = useState(false);
  const replayAbortRef = useRef<AbortController | null>(null);
  const macroListRef = useRef<HTMLDivElement>(null);

  /* ── SSH command history ── */
  const commandHistory = useSSHCommandHistory(session.id);

  /* ── Stable refs for callbacks ── */
  const sessionRef = useRef(session);
  const connectionRef = useRef(connection);
  const settingsRef = useRef(settings);
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;
  const isSsh = session.protocol === "ssh";

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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
          if (
            parsed &&
            typeof parsed === "object" &&
            "customScripts" in parsed
          ) {
            const {
              customScripts = [],
              modifiedDefaults = [],
              deletedDefaultIds = [],
            } = parsed;
            const activeDefaults = defaults
              .filter((d: ManagedScript) => !deletedDefaultIds.includes(d.id))
              .map(
                (d: ManagedScript) =>
                  modifiedDefaults.find((m: ManagedScript) => m.id === d.id) ||
                  d,
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
      result = result.filter(
        (s) => (s.category || "Uncategorized") === scriptCategoryFilter,
      );
    if (scriptLanguageFilter !== "all")
      result = result.filter((s) => s.language === scriptLanguageFilter);
    if (scriptOsTagFilter !== "all")
      result = result.filter(
        (s) => s.osTags && s.osTags.includes(scriptOsTagFilter as OSTag),
      );
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
  }, [
    scripts,
    scriptSearchQuery,
    scriptCategoryFilter,
    scriptLanguageFilter,
    scriptOsTagFilter,
  ]);

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
    return lastNonEmptyLine >= 0
      ? lines.slice(0, lastNonEmptyLine + 1).join("\n")
      : "";
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
          buffer = await invoke<string>("get_terminal_buffer", {
            sessionId: sshSessionId.current,
          });
        } catch {
          buffer = serializeBuffer();
        }
      } else {
        buffer = serializeBuffer();
      }
      await emit("terminal-buffer-response", { sessionId: session.id, buffer });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, [session.id, session.protocol, serializeBuffer]);

  const bufferRestoredRef = useRef(false);

  useEffect(() => {
    if (!session.terminalBuffer || bufferRestoredRef.current) return;
    const tryRestore = (attempts = 0) => {
      if (attempts > 30) return;
      if (!termRef.current) {
        setTimeout(() => tryRestore(attempts + 1), 100);
        return;
      }
      const core = (termRef.current as any)?._core;
      const renderService = core?.renderService ?? core?._renderService;
      if (!renderService?.dimensions) {
        setTimeout(() => tryRestore(attempts + 1), 100);
        return;
      }
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
    if (typeof dims.css?.cell?.width !== "number" || dims.css?.cell?.width <= 0)
      return false;
    return true;
  }, []);

  const safeWrite = useCallback(
    (text: string) => {
      if (isDisposed.current || !termRef.current) return;
      if (termRef.current.element && !termRef.current.element.isConnected)
        return;
      if (!canRender()) return;
      try {
        termRef.current.write(text);
      } catch {
        /* ignore */
      }
    },
    [canRender],
  );

  const safeWriteln = useCallback(
    (text: string) => {
      if (isDisposed.current || !termRef.current) return;
      if (termRef.current.element && !termRef.current.element.isConnected)
        return;
      if (!canRender()) return;
      try {
        termRef.current.writeln(text);
      } catch {
        /* ignore */
      }
    },
    [canRender],
  );

  const writeLine = useCallback(
    (text: string) => {
      safeWriteln(text);
    },
    [safeWriteln],
  );

  /* ── Theme ── */

  const getTerminalTheme = useCallback(() => {
    if (typeof window === "undefined") {
      return {
        background: "#0b1120",
        foreground: "#e2e8f0",
        cursor: "#7dd3fc",
        selectionBackground: "rgba(59, 130, 246, 0.4)",
        selectionForeground: "#ffffff",
        selectionInactiveBackground: "rgba(59, 130, 246, 0.2)",
      };
    }
    const styles = getComputedStyle(document.body);
    const background =
      styles.getPropertyValue("--color-background").trim() || "#0b1120";
    const foreground =
      styles.getPropertyValue("--color-text").trim() || "#e2e8f0";
    const cursor =
      styles.getPropertyValue("--color-primary").trim() || "#7dd3fc";
    const primaryRgb =
      styles.getPropertyValue("--color-primary-rgb").trim() || "59 130 246";
    const rgb = primaryRgb.replace(/ /g, ", ");
    return {
      background,
      foreground,
      cursor,
      selectionBackground: `rgba(${rgb}, 0.4)`,
      selectionForeground: "#ffffff",
      selectionInactiveBackground: `rgba(${rgb}, 0.2)`,
    };
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
      if (terminal.options) terminal.options.theme = theme;
    } catch {
      /* ignore */
    }
  }, [canRender, getTerminalTheme]);

  /* ── Error helpers ── */

  const formatErrorDetails = useCallback(
    (err: unknown, secrets: readonly string[] = []) => {
      if (err instanceof Error)
        return {
          message: redactSecrets(err.message || "Unknown error", secrets),
          name: err.name || "Error",
          stack: redactSecrets(err.stack || "", secrets),
        };
      if (typeof err === "string")
        return {
          message: redactSecrets(err, secrets),
          name: "Error",
          stack: "",
        };
      try {
        return {
          message: redactSecrets(JSON.stringify(err), secrets),
          name: "Error",
          stack: "",
        };
      } catch {
        return {
          message: redactSecrets(String(err), secrets),
          name: "Error",
          stack: "",
        };
      }
    },
    [],
  );

  const classifySshError = useCallback((message: string) => {
    const lower = message.toLowerCase();
    if (
      message.includes("All authentication methods failed") ||
      message.includes("Authentication failed")
    )
      return {
        kind: "auth",
        friendly: "Authentication failed - please check your credentials",
      };
    if (
      lower.includes("connection refused") ||
      lower.includes("os error 10061")
    )
      return {
        kind: "connection_refused",
        friendly: "Connection refused - please check the host and port",
      };
    if (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("os error 10060") ||
      lower.includes("connection attempt failed")
    )
      return {
        kind: "timeout",
        friendly: "Connection timeout - please check network connectivity",
      };
    if (message.includes("Host key verification failed"))
      return {
        kind: "host_key",
        friendly: "Host key verification failed - server may have changed",
      };
    if (lower.includes("certificate") || lower.includes("x509"))
      return {
        kind: "certificate",
        friendly:
          "Certificate validation failed - please verify the server identity",
      };
    if (
      message.includes("No such file or directory") &&
      message.includes("private key")
    )
      return {
        kind: "key_missing",
        friendly: "Private key file not found - please check the key path",
      };
    if (message.includes("Permission denied"))
      return {
        kind: "permission",
        friendly: "Permission denied - please check your credentials",
      };
    if (
      lower.includes("failed to establish tcp connection") ||
      lower.includes("failed to connect")
    )
      return {
        kind: "tcp_connect",
        friendly: "TCP connection failed - please verify the host and port",
      };
    if (
      lower.includes("no route to host") ||
      lower.includes("network unreachable")
    )
      return {
        kind: "network_unreachable",
        friendly: "Network unreachable - please check routing or VPN",
      };
    return {
      kind: "unknown",
      friendly: "SSH connection failed - please check credentials and network",
    };
  }, []);

  /* ── SSH connect / disconnect ── */

  const releaseVpnLeaseOwner = useCallback(
    async (ownerId: string): Promise<boolean> => {
      const existing = vpnLeaseReleasesRef.current.get(ownerId);
      if (existing) return existing;

      const release = (async (): Promise<boolean> => {
        try {
          const result = await releaseSessionVpnLeases(ownerId);
          const cleanupError = vpnLeaseCleanupError(result);
          if (cleanupError) {
            writeLine(
              `\x1b[33mVPN cleanup needs attention: ${cleanupError}\x1b[0m`,
            );
          }
          return !cleanupError;
        } catch (releaseError) {
          writeLine(
            `\x1b[33mVPN cleanup could not be confirmed: ${String(releaseError)}\x1b[0m`,
          );
          return false;
        }
      })();

      vpnLeaseReleasesRef.current.set(ownerId, release);
      try {
        return await release;
      } finally {
        vpnLeaseReleasesRef.current.delete(ownerId);
      }
    },
    [writeLine],
  );

  const settleVpnLeaseOwner = useCallback(
    async (ownerId: string): Promise<boolean> => {
      const tracked = vpnLeaseOwnersRef.current;
      if (!trackedVpnLeaseOwnerIds(tracked).includes(ownerId)) return true;

      const clean = await releaseVpnLeaseOwner(ownerId);
      const tracker = vpnLeaseOwnersRef.current;
      if (!clean) {
        trackPendingVpnLeaseOwner(tracker, ownerId);
        const updatedSession = {
          ...sessionRef.current,
          ...persistTrackedVpnLeaseOwners(tracker),
        };
        sessionRef.current = updatedSession;
        dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
        return false;
      }

      tracker.pending.delete(ownerId);
      if (tracker.current === ownerId) tracker.current = null;
      if (tracker.persisted === ownerId) tracker.persisted = null;
      const updatedSession = {
        ...sessionRef.current,
        ...persistTrackedVpnLeaseOwners(tracker),
      };
      sessionRef.current = updatedSession;
      dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
      return true;
    },
    [dispatch, releaseVpnLeaseOwner],
  );

  const releaseOwnedVpnLeases = useCallback(async (): Promise<boolean> => {
    const ownerIds = trackedVpnLeaseOwnerIds(
      vpnLeaseOwnersRef.current,
    ).filter((ownerId) => !protectedVpnLeaseOwnersRef.current.has(ownerId));
    const results = await Promise.all(
      ownerIds.map((ownerId) => settleVpnLeaseOwner(ownerId)),
    );
    return results.every(Boolean);
  }, [settleVpnLeaseOwner]);

  const disconnectCurrentSsh = useCallback(
    async (preserveConnecting = false): Promise<boolean> => {
      const sid =
        sshSessionId.current ?? sessionRef.current.backendSessionId ?? null;
      const backendSessionIds = [
        ...new Set(
          [
            ...pendingSshBackendCleanupRef.current,
            sid,
            sessionRef.current.backendSessionId,
          ].filter((sessionId): sessionId is string => Boolean(sessionId)),
        ),
      ];
      const hadManagedState =
        backendSessionIds.length > 0 ||
        trackedVpnLeaseOwnerIds(vpnLeaseOwnersRef.current).length > 0;
      for (const backendSessionId of backendSessionIds) {
        // Fire "disconnected" lifecycle event and unregister from scripts engine
        invoke("ssh_scripts_notify_event", {
          event: {
            sessionId: backendSessionId,
            eventType: "disconnected",
            timestamp: new Date().toISOString(),
          },
        }).catch(() => {});
        invoke("ssh_scripts_unregister_session", {
          sessionId: backendSessionId,
        }).catch(() => {});

        try {
          await invoke("disconnect_ssh", { sessionId: backendSessionId });
        } catch (disconnectError) {
          pendingSshBackendCleanupRef.current.add(backendSessionId);
          const message = `SSH disconnect failed: ${String(disconnectError)}`;
          setStatusState("error");
          setError(message);
          const updatedSession = {
            ...sessionRef.current,
            backendSessionId,
            status: "error" as const,
            errorMessage: message,
            ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
          };
          sessionRef.current = updatedSession;
          dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
          return false;
        }
        pendingSshBackendCleanupRef.current.delete(backendSessionId);
        const pendingOwnerId =
          pendingSshBackendOwnersRef.current.get(backendSessionId);
        if (pendingOwnerId) {
          protectedVpnLeaseOwnersRef.current.delete(pendingOwnerId);
          pendingSshBackendOwnersRef.current.delete(backendSessionId);
        }
        if (sshSessionId.current === backendSessionId) {
          sshSessionId.current = null;
        }
      }
      if (backendSessionIds.length > 0) {
        isSshReady.current = false;
        if (!preserveConnecting) isConnecting.current = false;
        writeLine("\x1b[33mDisconnected from SSH session\x1b[0m");
      }

      const vpnClean = await releaseOwnedVpnLeases();
      if (!vpnClean) {
        const message =
          "SSH disconnected, but VPN cleanup needs attention. Disconnect again to retry.";
        setStatusState("error");
        setError(message);
        const updatedSession = {
          ...sessionRef.current,
          backendSessionId: undefined,
          shellId: undefined,
          status: "error" as const,
          errorMessage: message,
        };
        sessionRef.current = updatedSession;
        dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
        return false;
      }

      setStatusState("idle");
      setError("");
      if (!hadManagedState) return true;
      const updatedSession = {
        ...sessionRef.current,
        backendSessionId: undefined,
        shellId: undefined,
        status: "disconnected" as const,
        errorMessage: undefined,
      };
      sessionRef.current = updatedSession;
      dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
      return true;
    },
    [dispatch, releaseOwnedVpnLeases, setStatusState, writeLine],
  );

  const disconnectSsh = useCallback(async (): Promise<boolean> => {
    sshInitGenRef.current++;
    return disconnectCurrentSsh();
  }, [disconnectCurrentSsh]);

  const initSsh = useCallback(
    async (force = false) => {
      const currentSession = sessionRef.current;
      const currentConnection = connectionRef.current;
      if (!isSsh || !currentConnection || !termRef.current) return;
      if (!force && (isConnecting.current || isSshReady.current)) return;
      if (!force && sshSessionId.current && currentSession.shellId) {
        setStatusState("connected");
        return;
      }

      const gen = ++sshInitGenRef.current;
      const stale = () => sshInitGenRef.current !== gen;
      let attemptVpnLeaseOwnerId: string | null = null;
      let attemptSshSessionId: string | null = null;

      const releaseAttemptVpnLease = async () => {
        const ownerId = attemptVpnLeaseOwnerId;
        if (!ownerId) return;
        attemptVpnLeaseOwnerId = null;
        protectedVpnLeaseOwnersRef.current.delete(ownerId);
        await settleVpnLeaseOwner(ownerId);
      };

      const cleanupAttemptSsh = async (): Promise<boolean> => {
        const sessionId = attemptSshSessionId;
        if (!sessionId) return true;
        try {
          await invoke("disconnect_ssh", { sessionId });
        } catch (cleanupError) {
          pendingSshBackendCleanupRef.current.add(sessionId);
          if (attemptVpnLeaseOwnerId) {
            pendingSshBackendOwnersRef.current.set(
              sessionId,
              attemptVpnLeaseOwnerId,
            );
          }
          const message = `SSH stale session cleanup failed: ${String(cleanupError)}. Retry disconnect before releasing its VPN route.`;
          setStatusState("error");
          setError(message);
          const updatedSession = {
            ...sessionRef.current,
            backendSessionId: sessionId,
            status: "error" as const,
            errorMessage: message,
            ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
          };
          sessionRef.current = updatedSession;
          dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
          return false;
        }
        attemptSshSessionId = null;
        pendingSshBackendCleanupRef.current.delete(sessionId);
        pendingSshBackendOwnersRef.current.delete(sessionId);
        if (sshSessionId.current === sessionId) {
          sshSessionId.current = null;
        }
        return true;
      };

      const stopIfStale = async () => {
        if (!stale()) return false;
        if (await cleanupAttemptSsh()) {
          await releaseAttemptVpnLease();
        }
        return true;
      };

      const handoffAttempt = async (targetSessionId: string) => {
        const tracker = vpnLeaseOwnersRef.current;
        const primaryOwnerIds = [
          ...new Set(
            [tracker.current, tracker.persisted].filter(
              (ownerId): ownerId is string => Boolean(ownerId),
            ),
          ),
        ];
        const nextOwnerId = attemptVpnLeaseOwnerId;
        const previousOwnerIds = primaryOwnerIds.filter(
          (ownerId) => !protectedVpnLeaseOwnersRef.current.has(ownerId),
        );

        sshSessionId.current = targetSessionId;
        for (const previousOwnerId of primaryOwnerIds) {
          if (previousOwnerId !== nextOwnerId) {
            trackPendingVpnLeaseOwner(tracker, previousOwnerId);
          }
        }
        tracker.current = nextOwnerId;
        if (nextOwnerId) tracker.pending.delete(nextOwnerId);

        for (const previousOwnerId of previousOwnerIds) {
          if (previousOwnerId !== nextOwnerId) {
            await settleVpnLeaseOwner(previousOwnerId);
          }
        }
      };

      const commitAttemptHandoff = () => {
        attemptSshSessionId = null;
        if (attemptVpnLeaseOwnerId) {
          protectedVpnLeaseOwnersRef.current.delete(attemptVpnLeaseOwnerId);
        }
        attemptVpnLeaseOwnerId = null;
      };

      const ignoreHostKey = currentConnection.ignoreSshSecurityErrors ?? false;
      const currentSettings = settingsRef.current;
      const sshTrustPolicy = resolveEffectiveTrustPolicy(
        currentConnection.sshTrustPolicy,
        currentSettings.sshTrustPolicy,
        currentSettings.trustPolicy,
      );
      const strictHostKeyChecking =
        !ignoreHostKey && sshTrustPolicy !== "always-trust";
      isConnecting.current = true;
      setStatusState("connecting");
      setError("");
      if (typeof (termRef.current as any).reset === "function") {
        try {
          (termRef.current as any).reset();
        } catch {
          /* ignore */
        }
      } else {
        try {
          termRef.current.clear();
        } catch {
          /* ignore */
        }
      }

      writeLine("\x1b[36mConnecting to SSH server...\x1b[0m");
      writeLine(`\x1b[90mHost: ${currentSession.hostname}\x1b[0m`);
      writeLine(`\x1b[90mPort: ${currentConnection.port || 22}\x1b[0m`);
      writeLine(
        `\x1b[90mUser: ${currentConnection.username || "unknown"}\x1b[0m`,
      );

      const authMethod =
        currentConnection.authType ||
        (currentConnection.privateKey ? "key" : "password");
      writeLine(`\x1b[90mAuth: ${authMethod}\x1b[0m`);
      writeLine(
        `\x1b[90mHost key checking: ${strictHostKeyChecking ? "enabled" : "disabled"}\x1b[0m`,
      );

      let unlistenHostKeyPrompt: (() => void) | null = null;
      let sshPassword: string | null = null;
      let privateKeyPassphrase: string | null = null;
      let totpSecret: string | null = null;
      let proxyCommandPassword: string | null = null;
      let runtimePath: RuntimeNetworkPath | null = null;

      // ── ProxyCommand config (snake_case, mirrors Rust ProxyCommandConfig) ──
      // Built once and reused for connect, expand, and confirm so the backend
      // rebuilds the EXACT same expanded command (the confirmation fingerprint
      // must match). Declared outside the try so the import-confirmation gate in
      // the catch block can re-expand/confirm with identical inputs.
      const hasProxyCommand = Boolean(
        sshConnectionConfig.proxyCommand ||
        sshConnectionConfig.proxyCommandTemplate,
      );
      const buildProxyCommandConfig = (): Record<string, unknown> | null =>
        hasProxyCommand
          ? {
              command: sshConnectionConfig.proxyCommand || null,
              template: sshConnectionConfig.proxyCommandTemplate || null,
              proxy_host: sshConnectionConfig.proxyCommandHost || null,
              proxy_port: sshConnectionConfig.proxyCommandPort || null,
              proxy_username: sshConnectionConfig.proxyCommandUsername || null,
              proxy_password: proxyCommandPassword,
              proxy_type: sshConnectionConfig.proxyCommandProxyType || null,
              timeout_secs: sshConnectionConfig.proxyCommandTimeout || null,
              // Never trust persisted/imported confirmation state; the backend
              // only honors its fingerprint-scoped runtime confirmation registry.
              command_confirmed: false,
            }
          : null;

      const resolveAndAcquireVpnPath = async () => {
        // Resolve every configured source against one live snapshot. Resolution
        // is deliberately fail-closed: an invalid/missing/unsupported layer
        // must never degrade into a direct connection.
        const resolvedPath = await resolveRuntimeNetworkPath(
          currentConnection,
          connectionsRef.current,
          "ssh",
        );
        const steps = resolvedPath.transport.vpnPreSteps;
        if (steps.length === 0) return resolvedPath;

        writeLine("\x1b[36mEstablishing session-owned VPN path...\x1b[0m");
        attemptVpnLeaseOwnerId = createVpnLeaseAttemptOwnerId(
          currentSession.id,
          "ssh",
        );
        protectedVpnLeaseOwnersRef.current.add(attemptVpnLeaseOwnerId);
        trackPendingVpnLeaseOwner(
          vpnLeaseOwnersRef.current,
          attemptVpnLeaseOwnerId,
        );
        const trackedSession = {
          ...sessionRef.current,
          ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
        };
        sessionRef.current = trackedSession;
        dispatch({ type: "UPDATE_SESSION", payload: trackedSession });
        const leaseResult = await acquireSessionVpnLeases(
          attemptVpnLeaseOwnerId,
          steps,
        );
        for (const lease of leaseResult.leases) {
          const detail = lease.already_owned
            ? "lease retained"
            : lease.was_already_connected
              ? "already connected; lease acquired"
              : "connected; lease acquired";
          writeLine(
            `\x1b[32m  ${lease.vpn_type}: ${detail} (${lease.lease_count} session${lease.lease_count === 1 ? "" : "s"})\x1b[0m`,
          );
        }
        return resolvedPath;
      };

      try {
        // Try reattaching to existing backend session
        if (currentSession.backendSessionId && !force) {
          const isAlive = await invoke<boolean>("is_session_alive", {
            sessionId: currentSession.backendSessionId,
          }).catch(() => false);
          if (await stopIfStale()) return;
          if (isAlive) {
            // Reattachment still verifies/acquires the configured VPN path. A
            // remounted view must not assume machine-wide VPN state survived.
            runtimePath = await resolveAndAcquireVpnPath();
            if (await stopIfStale()) return;
            const buffer = await invoke<string>("get_terminal_buffer", {
              sessionId: currentSession.backendSessionId,
            }).catch(() => "");
            if (await stopIfStale()) return;
            if (buffer) {
              restoreBuffer(buffer);
              writeLine("\x1b[32mRestored terminal buffer from session\x1b[0m");
            }
            const existingShellId = await invoke<string | null>(
              "get_shell_info",
              { sessionId: currentSession.backendSessionId },
            ).catch(() => null);
            if (await stopIfStale()) return;
            if (existingShellId) {
              await handoffAttempt(currentSession.backendSessionId);
              if (await stopIfStale()) return;
              commitAttemptHandoff();
              const updatedSession = {
                ...currentSession,
                shellId: existingShellId,
                status: "connected" as const,
                errorMessage: undefined,
                networkPath: runtimePath?.snapshot,
                ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
              };
              sessionRef.current = updatedSession;
              dispatch({
                type: "UPDATE_SESSION",
                payload: updatedSession,
              });
              writeLine("\x1b[32mReattached to existing SSH session\x1b[0m");
              setStatusState("connected");
              return;
            }
            const shellId = await invoke<string>("reattach_session", {
              sessionId: currentSession.backendSessionId,
            });
            if (await stopIfStale()) return;
            await handoffAttempt(currentSession.backendSessionId);
            if (await stopIfStale()) return;
            commitAttemptHandoff();
            const updatedSession = {
              ...currentSession,
              shellId,
              status: "connected" as const,
              errorMessage: undefined,
              networkPath: runtimePath?.snapshot,
              ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
            };
            sessionRef.current = updatedSession;
            dispatch({
              type: "UPDATE_SESSION",
              payload: updatedSession,
            });
            writeLine(
              "\x1b[32mRestarted shell on existing SSH connection\x1b[0m",
            );
            setStatusState("connected");
            return;
          } else {
            writeLine(
              "\x1b[33mPrevious session expired, creating new connection...\x1b[0m",
            );
          }
        }

        if (!(await disconnectCurrentSsh(true))) return;
        if (await stopIfStale()) return;
        runtimePath = await resolveAndAcquireVpnPath();
        if (await stopIfStale()) return;
        const resolved = runtimePath.transport;

        const tcpOptions = sshTerminalConfig?.tcpOptions;
        proxyCommandPassword = sshConnectionConfig.proxyCommandPassword || null;

        unlistenHostKeyPrompt = await listen<SshHostKeyPromptEvent>(
          "ssh://host-key-prompt",
          async (event) => {
            const payload = event.payload;
            const expectedPort = currentConnection.port || 22;
            const expectedUsername = currentConnection.username || "";
            if (
              payload.host !== currentSession.hostname ||
              payload.port !== expectedPort ||
              payload.username !== expectedUsername
            ) {
              return;
            }

            const identity: SshHostKeyIdentity = {
              fingerprint: payload.fingerprint,
              keyType: payload.key_type ?? undefined,
              keyBits: payload.key_bits ?? undefined,
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
              publicKey: payload.public_key ?? undefined,
            };
            setHostKeyIdentity(identity);

            const connectionId = currentConnection.id;
            const verification = verifyIdentity(
              currentSession.hostname,
              expectedPort,
              "ssh",
              identity,
              connectionId,
            );
            const isMismatchPrompt =
              payload.status === "mismatch" ||
              verification.status === "mismatch";

            writeLine(
              `\x1b[90mHost key fingerprint (SHA-256): ${payload.fingerprint}\x1b[0m`,
            );
            writeLine(
              `\x1b[90mKey type: ${payload.key_type ?? "unknown"}\x1b[0m`,
            );

            if (verification.status === "trusted" && !isMismatchPrompt) {
              writeLine("\x1b[32mHost key matches stored identity\x1b[0m");
              await invoke("ssh_respond_to_host_key_prompt", {
                sessionId: payload.session_id,
                decision: "accept_and_save",
              });
              return;
            }

            if (
              (verification.status === "first-use" || isMismatchPrompt) &&
              sshTrustPolicy === "strict"
            ) {
              writeLine(
                "\x1b[31mConnection rejected: strict host-key policy requires pre-approved identities\x1b[0m",
              );
              await invoke("ssh_respond_to_host_key_prompt", {
                sessionId: payload.session_id,
                decision: "reject",
              });
              return;
            }

            if (isMismatchPrompt) {
              writeLine(
                "\x1b[31;1m*** WARNING: HOST KEY HAS CHANGED! ***\x1b[0m",
              );
            } else {
              writeLine(
                "\x1b[33mNew host key — user confirmation required\x1b[0m",
              );
            }

            const decision = await new Promise<HostKeyPromptDecision>(
              (resolve) => {
                sshTrustResolveRef.current = resolve;
                setSshTrustPrompt(verification);
              },
            );

            if (decision === "accept_and_save") {
              trustIdentity(
                currentSession.hostname,
                expectedPort,
                "ssh",
                identity,
                true,
                connectionId,
              );
              writeLine("\x1b[32mHost key accepted and memorized\x1b[0m");
            } else if (decision === "accept_once") {
              writeLine(
                "\x1b[33mHost key accepted for this session only\x1b[0m",
              );
            } else {
              writeLine("\x1b[31mConnection aborted by user\x1b[0m");
            }

            await invoke("ssh_respond_to_host_key_prompt", {
              sessionId: payload.session_id,
              decision,
            });
          },
        );

        const sshConfig: Record<string, unknown> = {
          host: currentSession.hostname,
          port: currentConnection.port || 22,
          username: currentConnection.username || "",
          jump_hosts: resolved.jump_hosts,
          proxy_config: resolved.proxy_config,
          proxy_chain: resolved.proxy_chain,
          mixed_chain: resolved.mixed_chain,
          openvpn_config: resolved.openvpn_config,
          connect_timeout:
            tcpOptions?.connectionTimeout ??
            currentConnection.sshConnectTimeout ??
            30,
          keep_alive_interval: tcpOptions?.tcpKeepAlive
            ? (tcpOptions?.keepAliveInterval ??
              currentConnection.sshKeepAliveInterval ??
              60)
            : null,
          strict_host_key_checking: strictHostKeyChecking,
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
          preferred_host_key_algorithms:
            sshTerminalConfig?.preferredHostKeyAlgorithms ?? [],

          // ── Agent forwarding ──
          agent_forwarding: sshConnectionConfig.agentForwarding ?? false,

          // ── PTY type & environment ──
          pty_type: sshConnectionConfig.ptyType || null,
          environment: sshConnectionConfig.environment ?? {},

          // ── X11 forwarding ──
          x11_forwarding: sshConnectionConfig.enableX11Forwarding
            ? {
                enabled: true,
                trusted: sshConnectionConfig.x11Trusted ?? false,
                display_offset: sshConnectionConfig.x11DisplayOffset ?? 10,
                screen: sshConnectionConfig.x11Screen ?? 0,
                display_override:
                  sshConnectionConfig.x11DisplayOverride || null,
                xauthority_path: sshConnectionConfig.x11XauthorityPath || null,
                timeout_secs: sshConnectionConfig.x11TimeoutSecs ?? 0,
              }
            : null,

          // ── ProxyCommand ──
          // Confirmation is intentionally runtime/fingerprint-scoped. Persisted
          // or imported booleans must not bypass the review gate for new command
          // contents.
          proxy_command: buildProxyCommandConfig(),
        };

        switch (authMethod) {
          case "password":
            if (!currentConnection.password)
              throw new Error("Password authentication requires a password");
            sshPassword = currentConnection.password;
            sshConfig.password = sshPassword;
            sshConfig.private_key_path = null;
            sshConfig.private_key_passphrase = null;
            break;
          case "key":
            if (!currentConnection.privateKey)
              throw new Error("Key authentication requires a key path");
            privateKeyPassphrase = currentConnection.passphrase || null;
            sshConfig.password = null;
            sshConfig.private_key_path = currentConnection.privateKey;
            sshConfig.private_key_passphrase = privateKeyPassphrase;
            break;
          case "totp":
            if (!currentConnection.password || !currentConnection.totpSecret)
              throw new Error("TOTP requires password and TOTP secret");
            sshPassword = currentConnection.password;
            totpSecret = currentConnection.totpSecret;
            sshConfig.password = sshPassword;
            sshConfig.totp_secret = totpSecret;
            sshConfig.private_key_path = null;
            sshConfig.private_key_passphrase = null;
            break;
          default:
            throw new Error(`Unsupported authentication method: ${authMethod}`);
        }

        const sessionId = await invoke<string>("connect_ssh", {
          config: sshConfig,
        });
        attemptSshSessionId = sessionId;
        if (await stopIfStale()) return;
        unlistenHostKeyPrompt?.();
        unlistenHostKeyPrompt = null;
        writeLine("\x1b[32mSSH connection established\x1b[0m");

        const shellId = await invoke<string>("start_shell", { sessionId });
        if (await stopIfStale()) return;
        await handoffAttempt(sessionId);
        if (await stopIfStale()) return;
        commitAttemptHandoff();
        const updatedSession = {
          ...currentSession,
          backendSessionId: sessionId,
          shellId,
          status: "connected" as const,
          errorMessage: undefined,
          networkPath: runtimePath.snapshot,
          ...persistTrackedVpnLeaseOwners(vpnLeaseOwnersRef.current),
        };
        sessionRef.current = updatedSession;
        dispatch({
          type: "UPDATE_SESSION",
          payload: updatedSession,
        });
        writeLine("\x1b[32mShell started successfully\x1b[0m");
        setStatusState("connected");

        // Register session with the SSH scripts engine for event-driven scripts
        invoke("ssh_scripts_register_session", {
          sessionId,
          connectionId: currentConnection.id ?? null,
          host: currentSession.hostname ?? null,
          username: currentConnection.username ?? null,
        }).catch(() => {});

        // Fire the "connected" lifecycle event
        invoke("ssh_scripts_notify_event", {
          event: {
            sessionId,
            connectionId: currentConnection.id,
            host: currentSession.hostname,
            username: currentConnection.username,
            port: currentConnection.port || 22,
            eventType: "connected",
            timestamp: new Date().toISOString(),
          },
        }).catch(() => {});
      } catch (err: unknown) {
        // Any failure after VPN acquisition must tear down a partially-created
        // SSH backend first, then release only this attempt's VPN owner. A
        // superseded attempt must never touch the replacement's target/lease.
        const superseded = stale();
        const backendClean = await cleanupAttemptSsh();
        if (backendClean) await releaseAttemptVpnLease();
        if (!backendClean) return;
        if (superseded || stale()) return;

        // ── ProxyCommand import-confirmation gate ──
        // The backend refuses an unconfirmed (imported/synced) ProxyCommand with a
        // distinct error. This is NOT a normal failure: show the user the exact
        // (redacted) command, and on approval confirm + persist + retry.
        const rawErr =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : String(err);
        if (
          rawErr.startsWith(PROXY_COMMAND_CONFIRMATION_REQUIRED) &&
          hasProxyCommand
        ) {
          try {
            unlistenHostKeyPrompt?.();
            unlistenHostKeyPrompt = null;
            const proxyConfig = buildProxyCommandConfig();
            const host = currentSession.hostname;
            const port = currentConnection.port || 22;
            const username = currentConnection.username || "";
            // Fetch the exact redacted command for review.
            const expanded = await invoke<string>("expand_proxy_command", {
              config: proxyConfig,
              host,
              port,
              username,
            });
            writeLine(
              "\x1b[33mThis connection's ProxyCommand has not been confirmed (imported/synced).\x1b[0m",
            );
            const confirmed = await new Promise<boolean>((resolve) => {
              proxyCommandResolveRef.current = resolve;
              setProxyCommandPrompt({ command: expanded });
            });
            if (await stopIfStale()) return;
            if (confirmed) {
              // Record runtime confirmation (fingerprint-scoped) ...
              await invoke<string>("confirm_proxy_command", {
                config: proxyConfig,
                host,
                port,
                username,
              });
              writeLine(
                "\x1b[32mProxyCommand confirmed — retrying connection...\x1b[0m",
              );
              isConnecting.current = false;
              // Retry; the gate is now cleared (runtime fingerprint confirmation).
              await initSshRef.current(true);
              return;
            }
            // Declined: abort gracefully, do not execute the command.
            writeLine(
              "\x1b[31mProxyCommand not confirmed — connection aborted.\x1b[0m",
            );
            setStatusState("error");
            setError("ProxyCommand not confirmed — connection aborted");
            const updatedSession = {
              ...sessionRef.current,
              status: "error" as const,
              errorMessage: "ProxyCommand not confirmed — connection aborted",
            };
            sessionRef.current = updatedSession;
            dispatch({
              type: "UPDATE_SESSION",
              payload: updatedSession,
            });
            return;
          } catch (gateErr) {
            console.error("ProxyCommand confirmation flow failed:", gateErr);
            // fall through to normal error handling below
          } finally {
            proxyCommandResolveRef.current = null;
            setProxyCommandPrompt(null);
          }
        }
        const secrets = [
          ...(runtimePath?.redactionSecrets ?? []),
          currentConnection.password,
          currentConnection.passphrase,
          currentConnection.totpSecret,
          sshConnectionConfig.proxyCommandPassword,
        ].filter((value): value is string => Boolean(value));
        const details = formatErrorDetails(
          formatRuntimeNetworkPathError(err, runtimePath, secrets),
          secrets,
        );
        const classification = classifySshError(details.message);
        console.error("SSH connection failed:", {
          kind: classification.kind,
          message: details.message,
          name: details.name,
          stack: details.stack,
        });
        setStatusState("error");
        setError(classification.friendly);
        const updatedSession = {
          ...sessionRef.current,
          status: "error" as const,
          errorMessage: classification.friendly,
        };
        sessionRef.current = updatedSession;
        dispatch({
          type: "UPDATE_SESSION",
          payload: updatedSession,
        });
        writeLine(`\x1b[31m${classification.friendly}\x1b[0m`);
        writeLine(`\x1b[90mFailure reason: ${classification.kind}\x1b[0m`);
        writeLine(`\x1b[90mRaw error: ${details.message}\x1b[0m`);
      } finally {
        sshPassword = null;
        privateKeyPassphrase = null;
        totpSecret = null;
        proxyCommandPassword = null;
        if (!stale()) {
          isConnecting.current = false;
          sshTrustResolveRef.current = null;
        }
        unlistenHostKeyPrompt?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- all used functions are listed; refs read at call time
    [
      classifySshError,
      disconnectCurrentSsh,
      formatErrorDetails,
      isSsh,
      dispatch,
      restoreBuffer,
      setStatusState,
      settleVpnLeaseOwner,
      writeLine,
    ],
  );

  // Self-ref so the ProxyCommand confirm flow can retry the connection after
  // the user approves the imported command (avoids a useCallback self-cycle).
  const initSshRef = useRef(initSsh);
  useEffect(() => {
    initSshRef.current = initSsh;
  }, [initSsh]);

  /* ── Input handling ── */

  const handleInput = useCallback(
    async (data: string) => {
      if (!termRef.current || isDisposed.current) return;
      if (isSsh) {
        if (
          !sshSessionId.current ||
          !isSshReady.current ||
          isConnecting.current
        )
          return;
        const currentMacroRecorder = macroRecorderRef.current;
        if (currentMacroRecorder.isRecording) {
          currentMacroRecorder.recordInput(data);
        }
        try {
          await invoke("send_ssh_input", {
            sessionId: sshSessionId.current,
            data,
          });
        } catch (err) {
          console.error("Failed to send SSH input:", err);
        }
        return;
      }
      safeWrite(data);
    },
    [isSsh, safeWrite],
  );

  /* ── Run script ── */

  const runScript = useCallback(
    async (script: ManagedScript) => {
      if (
        !isSsh ||
        !sshSessionId.current ||
        !isSshReady.current ||
        isConnecting.current
      )
        return;
      try {
        const lines = script.script
          .split("\n")
          .filter((line) => !line.startsWith("#!"));
        const command = lines.join("\n");
        const isSingleLine = lines.length === 1;

        if (isSingleLine) {
          // Single-line: pipe directly into the shell
          await invoke("send_ssh_input", {
            sessionId: sshSessionId.current,
            data: command + "\n",
          });
        } else {
          // Multi-line: upload as temp file on the remote server, execute, capture output, clean up
          const interpreter =
            script.language === "powershell"
              ? "powershell"
              : script.language === "sh"
                ? "sh"
                : "bash";

          try {
            const result = await invoke<{
              stdout: string;
              stderr: string;
              exitCode: number;
            }>("execute_script", {
              sessionId: sshSessionId.current,
              script: command,
              interpreter,
            });
            const term = termRef.current;
            if (term) {
              term.write(`\r\n\x1b[90m── Script: ${script.name} ──\x1b[0m\r\n`);
              if (result.stdout) {
                for (const line of result.stdout.split("\n")) {
                  term.write(line + "\r\n");
                }
              }
              if (result.stderr) {
                term.write(`\x1b[31m${result.stderr}\x1b[0m\r\n`);
              }
              const codeColor = result.exitCode === 0 ? "32" : "31";
              term.write(
                `\x1b[90m── Exit: \x1b[${codeColor}m${result.exitCode}\x1b[90m ──\x1b[0m\r\n`,
              );
            }
          } catch (execErr) {
            // Fall back to shell piping if execute_script fails
            console.warn(
              "execute_script failed, falling back to shell piping:",
              execErr,
            );
            await invoke("send_ssh_input", {
              sessionId: sshSessionId.current,
              data: command + "\n",
            });
          }
        }
        closeScriptSelector();
      } catch (err) {
        console.error("Failed to run script:", err);
      }
    },
    [isSsh, closeScriptSelector],
  );

  /* ──────────────────────────────────────────────────────────────
   * Terminal creation & lifecycle effect
   * ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    isDisposed.current = false;

    const fontFamily =
      sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.family
        ? sshTerminalConfig.font.family
        : '"Cascadia Code", "Fira Code", Menlo, Monaco, "Ubuntu Mono", "Courier New", monospace';
    const fontSize =
      sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.size
        ? sshTerminalConfig.font.size
        : 13;
    const lineHeight =
      sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.lineHeight
        ? sshTerminalConfig.font.lineHeight
        : 1.25;
    const letterSpacing =
      sshTerminalConfig?.useCustomFont && sshTerminalConfig?.font?.letterSpacing
        ? sshTerminalConfig.font.letterSpacing
        : 0;
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
      altClickMovesCursor: false,
      macOptionIsMeta: true,
      disableStdin: false,
      wordSeparator: wordSeparator || " ()[]{}'\":;,.<>~!@#$%^&*|+=`",
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
        bellResetTimer = setTimeout(
          () => {
            bellCount = 0;
          },
          (overuseProtection.timeWindowSeconds ?? 2) * 1000,
        );
        if (bellCount > (overuseProtection.maxBells ?? 5)) {
          if (!bellSilenced) {
            bellSilenced = true;
            bellSilenceTimer = setTimeout(
              () => {
                bellSilenced = false;
                bellCount = 0;
              },
              (overuseProtection.silenceDurationSeconds ?? 5) * 1000,
            );
          }
          return;
        }
      }

      if (bellSilenced) return;

      switch (bellStyle) {
        case "none":
          break;
        case "system":
          try {
            const audioCtx = new (
              window.AudioContext || (window as any).webkitAudioContext
            )();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 800;
            osc.type = "sine";
            gain.gain.value = 0.1;
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
          } catch {
            /* audio not available */
          }
          break;
        case "visual":
          if (containerRef.current) {
            containerRef.current.style.backgroundColor = "#ff0";
            setTimeout(() => {
              if (containerRef.current)
                containerRef.current.style.backgroundColor = "";
            }, 100);
          }
          break;
        case "flash-window":
          invoke("flash_window").catch(() => {});
          break;
        case "pc-speaker":
          try {
            const audioCtx = new (
              window.AudioContext || (window as any).webkitAudioContext
            )();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 1000;
            osc.type = "square";
            gain.gain.value = 0.05;
            osc.start();
            osc.stop(audioCtx.currentTime + 0.05);
          } catch {
            /* fallback */
          }
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
      } catch (err) {
        console.warn("Failed to open terminal:", err);
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
      const dims = renderService.dimensions;
      return (
        typeof dims.css?.cell?.width === "number" && dims.css?.cell?.width > 0
      );
    };

    const doFit = () => {
      if (isDisposed.current || !fitRef.current || !termRef.current) return;
      if (!container.isConnected || !termRef.current.element?.isConnected)
        return;
      if (!canFit()) {
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
        /* ignore */
      }
    };

    const scheduleFit = () => {
      if (isDisposed.current) return;
      if (rafId) cancelAnimationFrame(rafId);
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
    let outputBuffer: string[] = [];
    let flushScheduled = false;
    const BATCH_INTERVAL_MS = 8;

    const flushOutputBuffer = () => {
      if (outputBuffer.length === 0 || isDisposed.current || !termRef.current) {
        flushScheduled = false;
        return;
      }
      const data = outputBuffer.join("");
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
        const unlistenOutput = await listen<SshOutputEvent>(
          "ssh-output",
          (event) => {
            if (event.payload.session_id !== sshSessionId.current) return;
            outputBuffer.push(event.payload.data);
            scheduleFlush();
            // Blink window when output arrives and window is not focused
            if (
              sshTerminalConfig?.blinkWindowOnActivity &&
              document.visibilityState === "hidden"
            ) {
              invoke("flash_window").catch(() => {});
            }
          },
        );
        if (!cancelled) outputUnlistenRef.current = unlistenOutput;
        else unlistenOutput();

        const unlistenError = await listen<SshErrorEvent>(
          "ssh-error",
          (event) => {
            if (event.payload.session_id !== sshSessionId.current) return;
            safeWriteln(
              `\r\n\x1b[31mSSH error: ${event.payload.message}\x1b[0m`,
            );
          },
        );
        if (!cancelled) errorUnlistenRef.current = unlistenError;
        else unlistenError();

        const unlistenClosed = await listen<SshClosedEvent>(
          "ssh-shell-closed",
          (event) => {
            if (event.payload.session_id !== sshSessionId.current) return;
            sshSessionId.current = null;
            isSshReady.current = false;
            void (async () => {
              const vpnClean = await releaseOwnedVpnLeases();
              const message = vpnClean
                ? "Shell closed"
                : "Shell closed; VPN cleanup needs attention. Disconnect again to retry.";
              setStatusState("error");
              setError(message);
              const updatedSession = {
                ...sessionRef.current,
                backendSessionId: undefined,
                shellId: undefined,
                status: "error" as const,
                errorMessage: message,
              };
              sessionRef.current = updatedSession;
              dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
            })();
          },
        );
        if (!cancelled) closeUnlistenRef.current = unlistenClosed;
        else unlistenClosed();
      } catch (error) {
        console.error("Failed to attach SSH listeners:", error);
      }
    };

    attachListeners();

    if (isSsh) {
      initSsh();
    } else {
      const s = sessionRef.current;
      safeWriteln(
        `\x1b[32mTerminal ready for ${s.protocol.toUpperCase()} session\x1b[0m`,
      );
      safeWriteln(`\x1b[36mConnected to: ${s.hostname}\x1b[0m`);
      setStatusState("connected");
    }

    return () => {
      // Supersede in-flight connection attempts. Their own continuation owns
      // cleanup of attempt-local SSH and VPN resources.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally invalidate the latest shared generation
      sshInitGenRef.current++;
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
      outputUnlistenRef.current?.();
      errorUnlistenRef.current?.();
      closeUnlistenRef.current?.();
      outputUnlistenRef.current = null;
      errorUnlistenRef.current = null;
      closeUnlistenRef.current = null;
      requestAnimationFrame(() => {
        try {
          term.dispose();
        } catch {
          /* ignore */
        }
      });
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-init terminal when session changes; callbacks are memoized
  }, [
    getTerminalTheme,
    handleInput,
    initSsh,
    isSsh,
    onResize,
    releaseOwnedVpnLeases,
    session.id,
    safeWrite,
    safeWriteln,
    setStatusState,
  ]);

  /* ── Apply theme on settings change ── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSettingsUpdate = () => {
      applyTerminalTheme();
    };
    window.addEventListener("settings-updated", handleSettingsUpdate);
    return () =>
      window.removeEventListener("settings-updated", handleSettingsUpdate);
  }, [applyTerminalTheme]);

  /* ── Simple actions ── */

  const safeFit = useCallback(() => {
    if (isDisposed.current || !fitRef.current || !termRef.current) return;
    if (!termRef.current.element?.isConnected) return;
    const core = (termRef.current as any)?._core;
    const renderService = core?.renderService ?? core?._renderService;
    if (!renderService?.dimensions) return;
    try {
      fitRef.current.fit();
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    setTimeout(() => safeFit(), 60);
  }, [safeFit]);

  const handleReconnect = useCallback(async () => {
    if (!isSsh) return;
    setStatusState("connecting");
    if (!(await disconnectSsh())) return;
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

  const clearTerminal = useCallback(() => {
    if (!termRef.current || !canRender()) return;
    try {
      termRef.current.clear();
    } catch {
      /* ignore */
    }
  }, [canRender]);

  const copySelection = useCallback(() => {
    const selection = termRef.current?.getSelection();
    if (!selection) return;
    navigator.clipboard
      .writeText(selection)
      .then(() => toast.success("Copied to clipboard", 2000))
      .catch(() => toast.error("Failed to copy to clipboard", 2000));
  }, [toast]);

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
    try {
      await invoke("send_ssh_input", {
        sessionId: sshSessionId.current,
        data: "\x03",
      });
    } catch (err) {
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
      await terminalRecorder.startRecording(
        sshSessionId.current,
        settings.recording?.recordInput ?? false,
        cols,
        rows,
      );
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [terminalRecorder, settings]);

  const handleStopRecording = useCallback(async () => {
    if (!sshSessionId.current) return;
    const recording = await terminalRecorder.stopRecording(
      sshSessionId.current,
    );
    if (recording) {
      const name = `${session.hostname} - ${new Date().toLocaleString()}`;
      const saved: SavedRecording = {
        id: crypto.randomUUID(),
        name,
        recording,
        savedAt: new Date().toISOString(),
        connectionId: session.connectionId,
      };
      await macroService.saveRecording(saved);
    }
  }, [terminalRecorder, session.hostname, session.connectionId]);

  /* ── Macro handlers ── */

  const handleStartMacroRecording = useCallback(() => {
    macroRecorder.startRecording();
  }, [macroRecorder]);

  const handleStopMacroRecording = useCallback(async () => {
    const steps = macroRecorder.stopRecording();
    if (steps.length > 0) {
      const macro: TerminalMacro = {
        id: crypto.randomUUID(),
        name: `Macro - ${new Date().toLocaleString()}`,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await macroService.saveMacro(macro);
      setSavedMacros(await macroService.loadMacros());
    }
  }, [macroRecorder]);

  const handleReplayMacro = useCallback(
    async (macro: TerminalMacro) => {
      if (!sshSessionId.current || replayingMacro) return;
      setShowMacroList(false);
      setReplayingMacro(true);
      const controller = new AbortController();
      replayAbortRef.current = controller;
      try {
        await macroService.replayMacro(
          sshSessionId.current,
          macro,
          undefined,
          controller.signal,
        );
      } catch (err) {
        console.error("Macro replay failed:", err);
      } finally {
        setReplayingMacro(false);
        replayAbortRef.current = null;
      }
    },
    [replayingMacro],
  );

  const handleStopReplay = useCallback(() => {
    replayAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (showMacroList) macroService.loadMacros().then(setSavedMacros);
  }, [showMacroList]);

  /* ── TOTP ── */

  const totpConfigs = connection?.totpConfigs ?? [];

  const handleUpdateTotpConfigs = useCallback(
    (configs: TOTPConfig[]) => {
      if (connection)
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: { ...connection, totpConfigs: configs },
        });
    },
    [connection, dispatch],
  );

  /* ── Computed ── */

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
    sshTerminalConfig,
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
    /* ProxyCommand import-confirmation gate */
    proxyCommandPrompt,
    setProxyCommandPrompt,
    proxyCommandResolveRef,
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
    /* command history */
    commandHistory,
  };
}

export type WebTerminalMgr = ReturnType<typeof useWebTerminal>;
