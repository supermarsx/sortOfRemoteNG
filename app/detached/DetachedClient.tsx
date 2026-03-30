"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import "../../src/i18n";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { SettingsProvider } from "../../src/contexts/SettingsContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import { Connection, ConnectionSession } from "../../src/types/connection/connection";
import { SessionViewer } from "../../src/components/session/SessionViewer";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  AlertCircle, ArrowLeft, ArrowLeftFromLine, ArrowRight, ArrowRightFromLine,
  ChevronRight, ClipboardCopy, Copy, CornerUpLeft, Eye, ExternalLink,
  FolderMinus, FolderPlus, Globe, Info, Layers, Loader2, Minus, Monitor,
  Palette, Pencil, Phone, Pin, PinOff, RefreshCw, Send, Server, Square,
  Terminal, X, XCircle,
} from "lucide-react";
import { useSettings } from "../../src/contexts/SettingsContext";
import { generateId } from "../../src/utils/core/id";
import MenuSurface from "../../src/components/ui/overlays/MenuSurface";
import { useTooltipSystem } from "../../src/hooks/window/useTooltipSystem";
import type { WindowSessionSync, WindowCommand } from "../../src/types/windowManager";

/** Protocol → Icon mapping matching main window SessionTabs. */
const SessionIcon: React.FC<{ protocol: string }> = ({ protocol }) => {
  const p = protocol.replace(/^tool:/, "");
  switch (p) {
    case "rdp": return <Monitor size={14} className="mr-2 flex-shrink-0" />;
    case "ssh": return <Terminal size={14} className="mr-2 flex-shrink-0" />;
    case "vnc": return <Eye size={14} className="mr-2 flex-shrink-0" />;
    case "http": case "https": return <Globe size={14} className="mr-2 flex-shrink-0" />;
    case "telnet": case "rlogin": return <Phone size={14} className="mr-2 flex-shrink-0" />;
    case "winrm": return <Server size={14} className="mr-2 flex-shrink-0" />;
    default: return <Monitor size={14} className="mr-2 flex-shrink-0" />;
  }
};

const reviveSession = (session: ConnectionSession): ConnectionSession => ({
  ...session,
  startTime: new Date(session.startTime),
  lastActivity: session.lastActivity ? new Date(session.lastActivity) : undefined,
});

const reviveConnection = (connection: Connection): Connection => ({
  ...connection,
  createdAt: connection.createdAt ? new Date(connection.createdAt) : new Date(),
  updatedAt: connection.updatedAt ? new Date(connection.updatedAt) : new Date(),
  lastConnected: connection.lastConnected ? new Date(connection.lastConnected) : undefined,
});

const SUBMENU_ITEM_SELECTOR = [
  '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
  "button:not([disabled]):not([role])",
  "[href]:not([role])",
  '[tabindex]:not([tabindex="-1"]):not([role])',
].join(", ");

const focusFirstSubmenuItem = (panel: HTMLElement | null) => {
  const first = panel?.querySelector<HTMLElement>(SUBMENU_ITEM_SELECTOR);
  first?.focus();
};

const DetachedSessionContent: React.FC<{
  onRegisterDisconnect: (handler: () => Promise<boolean>) => void;
}> = ({ onRegisterDisconnect }) => {
  useTooltipSystem();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const { state, dispatch } = useConnections();
  const [error, setError] = useState("");
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [isTransparent, setIsTransparent] = useState(false);
  const [warnOnDetachClose, setWarnOnDetachClose] = useState(true);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [windowTitleOverride, setWindowTitleOverride] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [sendToSubmenuOpen, setSendToSubmenuOpen] = useState(false);
  const [otherWindows, setOtherWindows] = useState<Array<{ label: string; title: string }>>([]);
  const [tabCloseConfirm, setTabCloseConfirm] = useState<{ sessionId: string; name: string } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [groupSubmenuOpen, setGroupSubmenuOpen] = useState(false);
  const groupSubmenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const groupSubmenuPanelRef = useRef<HTMLDivElement | null>(null);
  const sendToSubmenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sendToSubmenuPanelRef = useRef<HTMLDivElement | null>(null);
  const groupSubmenuTriggerId = useId();
  const groupSubmenuPanelId = useId();
  const sendToSubmenuTriggerId = useId();
  const sendToSubmenuPanelId = useId();

  const { settings: appSettings } = useSettings();
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isTauri =
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
  const closingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const skipNextConfirmRef = useRef(false);
  const reattachRef = useRef(false);
  const handleReattachRef = useRef<(() => void) | null>(null);
  const closeResolverRef = useRef<((value: boolean) => void) | null>(null);

  const isTauriRef = useRef(isTauri);
  const applyTransparency = useCallback(
    (enabled: boolean, opacity?: number) => {
      const targetOpacity = enabled ? Math.min(1, Math.max(0, opacity ?? 1)) : 1;
      setIsTransparent(enabled);
      const alpha = enabled ? targetOpacity : 1;
      const root = document.documentElement;
      root.style.setProperty("--app-surface-900", `rgba(17, 24, 39, ${alpha})`);
      root.style.setProperty("--app-surface-800", `rgba(31, 41, 55, ${alpha})`);
      root.style.setProperty("--app-surface-700", `rgba(55, 65, 81, ${alpha})`);
      root.style.setProperty("--app-surface-600", `rgba(75, 85, 99, ${alpha})`);
      root.style.setProperty("--app-surface-500", `rgba(107, 114, 128, ${alpha})`);
      root.style.setProperty("--app-slate-950", `rgba(2, 6, 23, ${alpha})`);
      root.style.setProperty("--app-slate-900", `rgba(15, 23, 42, ${alpha})`);
      root.style.setProperty("--app-slate-800", `rgba(30, 41, 59, ${alpha})`);
      root.style.setProperty("--app-slate-700", `rgba(51, 65, 85, ${alpha})`);
      document.documentElement.style.backgroundColor = enabled ? "transparent" : "";
      document.body.style.backgroundColor = enabled ? "transparent" : "";
      if (isTauriRef.current) {
        const currentWindow = getCurrentWindow();
        const setBackgroundColor = currentWindow.setBackgroundColor;
        if (typeof setBackgroundColor === "function") {
          const alphaByte = Math.round(255 * targetOpacity);
          setBackgroundColor([17, 24, 39, alphaByte]).catch(() => undefined);
        }
      }
    },
    [], // stable — isTauri read from ref
  );

  const requestCloseConfirmation = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      closeResolverRef.current = resolve;
      setShowCloseConfirm(true);
    });
  }, []);

  const resolveCloseConfirmation = useCallback((confirmed: boolean) => {
    closeResolverRef.current?.(confirmed);
    closeResolverRef.current = null;
    setShowCloseConfirm(false);
  }, []);

  // ── Bootstrap: request sessions from main window via WindowManager ──
  // Emits WINDOW_READY → main pushes wm:sync with our assigned sessions.
  // Falls back to localStorage after 2 seconds for backward compatibility.
  useEffect(() => {
    if (hasLoadedRef.current || !sessionId) {
      if (!sessionId) setError("Missing detached session id.");
      return;
    }

    const myWindowId = getCurrentWindow().label;
    let mounted = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // Listen for wm:sync from main window
    const unlistenPromise = listen<WindowSessionSync>("wm:sync", (event) => {
      if (!mounted || event.payload.windowId !== myWindowId) return;
      hasLoadedRef.current = true;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }

      const sessions = event.payload.sessions.map(reviveSession);
      const conns = event.payload.connections.map(reviveConnection);

      dispatch({ type: "SET_CONNECTIONS", payload: conns });
      dispatch({ type: "SET_SESSIONS", payload: sessions });
      if (event.payload.tabGroups) dispatch({ type: "SET_TAB_GROUPS", payload: event.payload.tabGroups });
      if (event.payload.activeSessionId) setActiveTabId(event.payload.activeSessionId);
    });

    // Request data from main
    const cmd: WindowCommand = { type: "WINDOW_READY", windowId: myWindowId as any };
    emit("wm:command", cmd).catch(() => {});

    // Fallback: if main doesn't respond in 2s, try localStorage
    fallbackTimer = setTimeout(() => {
      if (!mounted || hasLoadedRef.current) return;
      try {
        const raw = localStorage.getItem(`detached-session-${sessionId}`);
        if (!raw) { setError("Detached session data not found."); return; }
        const payload = JSON.parse(raw) as { session: ConnectionSession; connection?: Connection | null };
        if (!payload.session) { setError("Detached session payload is invalid."); return; }
        hasLoadedRef.current = true;
        const s = reviveSession(payload.session);
        const c = payload.connection ? reviveConnection(payload.connection) : null;
        if (c) dispatch({ type: "SET_CONNECTIONS", payload: [c] });
        dispatch({ type: "ADD_SESSION", payload: s });
      } catch (err) {
        console.error("Failed to load detached session:", err);
        setError("Unable to load detached session data.");
      }
    }, 2000);

    return () => {
      mounted = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      unlistenPromise.then(fn => fn()).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 30-second loading timeout — if session never loads, show recovery options
  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoadingTimedOut(true);
    }, 30000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const currentWindow = getCurrentWindow();
    currentWindow
      .isAlwaysOnTop()
      .then(setIsAlwaysOnTop)
      .catch(() => undefined);
  }, [isTauri]);

  // wm:sync listener — main window pushes updated session data after
  // any tab operation (move, close, reorder). Keeps this window in sync.
  useEffect(() => {
    if (!isTauri) return;
    const myWindowId = getCurrentWindow().label;
    const unlistenPromise = listen<WindowSessionSync>("wm:sync", (event) => {
      if (event.payload.windowId !== myWindowId) return;
      const sessions = event.payload.sessions.map(reviveSession);
      const conns = event.payload.connections.map(reviveConnection);
      dispatch({ type: "SET_CONNECTIONS", payload: conns });
      dispatch({ type: "SET_SESSIONS", payload: sessions });
      if (event.payload.tabGroups) dispatch({ type: "SET_TAB_GROUPS", payload: event.payload.tabGroups });
      if (event.payload.activeSessionId) setActiveTabId(event.payload.activeSessionId);
      // If main pushed zero sessions, window should close
      if (sessions.length === 0) {
        skipNextConfirmRef.current = true;
        getCurrentWindow().close().catch(() => {});
      }
    });
    return () => { unlistenPromise.then(fn => fn()).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);

  useEffect(() => {
    const manager = SettingsManager.getInstance();
    const themeManager = ThemeManager.getInstance();
    manager
      .loadSettings()
      .then((settings) => {
        applyTransparency(
          settings.windowTransparencyEnabled,
          settings.windowTransparencyOpacity,
        );
        setWarnOnDetachClose(settings.warnOnDetachClose);
        // Apply theme without emitting back to other windows
        themeManager.applyThemeFromSync(
          settings.theme,
          settings.colorScheme,
          settings.useCustomAccent ? settings.primaryAccentColor : undefined,
        );
        // Dispatch settings-updated event so WebTerminal can sync xterm theme on initial load
        window.dispatchEvent(new CustomEvent("settings-updated"));
      })
      .catch(() => undefined);
  }, [applyTransparency]);

  // Listen for theme changes from main window
  useEffect(() => {
    if (!isTauri) return;
    
    const unlistenPromise = listen<{
      theme: string;
      colorScheme: string;
      primaryAccentColor?: string;
    }>("theme-changed", (event) => {
      // Use applyThemeFromSync — does NOT re-emit theme-changed,
      // preventing the infinite loop between windows.
      ThemeManager.getInstance().applyThemeFromSync(
        event.payload.theme as any,
        event.payload.colorScheme as any,
        event.payload.primaryAccentColor,
      );
      window.dispatchEvent(new CustomEvent("settings-updated"));
    });

    return () => {
      unlistenPromise.then((unlisten) => { try { Promise.resolve(unlisten()).catch(() => {}); } catch { /* ignore */ } }).catch(() => undefined);
    };
  }, [isTauri]);

  // Listen for session closed from main window
  useEffect(() => {
    if (!isTauri || !sessionId) return;

    const unlistenPromise = listen<{ sessionId: string }>("main-session-closed", async (event) => {
      if (event.payload.sessionId === sessionId) {
        // Main window closed this session, close the detached window
        closingRef.current = true;
        skipNextConfirmRef.current = true;
        if (sessionId) {
          localStorage.removeItem(`detached-session-${sessionId}`);
        }
        const currentWindow = getCurrentWindow();
        await currentWindow.close();
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => { try { Promise.resolve(unlisten()).catch(() => {}); } catch { /* ignore */ } }).catch(() => undefined);
    };
  }, [isTauri, sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSettingsUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        windowTransparencyEnabled?: boolean;
        windowTransparencyOpacity?: number;
        warnOnDetachClose?: boolean;
      };
      if (!detail) return;
      applyTransparency(
        Boolean(detail.windowTransparencyEnabled),
        detail.windowTransparencyOpacity,
      );
      if (typeof detail.warnOnDetachClose === "boolean") {
        setWarnOnDetachClose(detail.warnOnDetachClose);
      }
    };
    window.addEventListener("settings-updated", handleSettingsUpdate);
    return () => window.removeEventListener("settings-updated", handleSettingsUpdate);
  }, [applyTransparency]);

  // Multi-session support: track which tab is active in this detached window
  const activeSession = useMemo(() => {
    if (activeTabId) {
      const found = state.sessions.find((s) => s.id === activeTabId);
      if (found) return found;
    }
    return state.sessions.find((s) => s.id === sessionId) ?? state.sessions[0] ?? null;
  }, [state.sessions, sessionId, activeTabId]);

  // Auto-set activeTabId when first session loads
  useEffect(() => {
    if (!activeTabId && activeSession) setActiveTabId(activeSession.id);
  }, [activeTabId, activeSession]);

  // Refs for state accessed inside stable-deps effects
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;

  // ── Ref-based access for callbacks to avoid dependency cascades ──
  // activeSession changes on every state.sessions update (new object ref).
  // If callbacks depend on it directly, the entire close-handler chain
  // recreates → parent re-renders → DetachedWindowLifecycle re-registers
  // onCloseRequested → Tauri listener leak. Using a ref breaks the chain.
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const warnRef = useRef(warnOnDetachClose);
  warnRef.current = warnOnDetachClose;

  /** Close a tab with confirmation if the setting requires it. */
  const handleTabClose = useCallback((sessionId: string) => {
    const sess = sessionsRef.current.find(s => s.id === sessionId);
    if (!sess) return;
    const settings = SettingsManager.getInstance().getSettings();
    // Show confirm if this is the active tab, it's connected, and the setting is on
    if (
      settings.confirmCloseActiveTab &&
      sessionId === activeSessionRef.current?.id &&
      sess.status === "connected"
    ) {
      setTabCloseConfirm({ sessionId, name: sess.name });
      return;
    }
    emit("wm:command", { type: "CLOSE_SESSION", sessionId } as WindowCommand).catch(() => {});
  }, []);

  /** Middle-click close handler. */
  const handleMiddleClick = useCallback((sessionId: string, e: React.MouseEvent) => {
    const settings = SettingsManager.getInstance().getSettings();
    if (e.button === 1 && settings.middleClickCloseTab) {
      e.preventDefault();
      e.stopPropagation();
      handleTabClose(sessionId);
    }
  }, [handleTabClose]);

  /** Start inline rename for a tab. */
  const handleStartRename = useCallback((sid: string) => {
    const sess = sessionsRef.current.find(s => s.id === sid);
    if (sess) { setRenamingTabId(sid); setRenameValue(sess.name); requestAnimationFrame(() => renameInputRef.current?.select()); }
  }, []);

  const handleCommitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim()) {
      emit("wm:command", { type: "RENAME_SESSION", sessionId: renamingTabId, name: renameValue.trim() } as WindowCommand).catch(() => {});
      // Also update locally for immediate feedback
      const sess = sessionsRef.current.find(s => s.id === renamingTabId);
      if (sess) dispatch({ type: "UPDATE_SESSION", payload: { ...sess, name: renameValue.trim() } });
    }
    setRenamingTabId(null);
  }, [renamingTabId, renameValue, dispatch]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCommitRename();
    if (e.key === "Escape") setRenamingTabId(null);
  }, [handleCommitRename]);

  const closeTabContextMenu = useCallback(() => {
    setTabContextMenu(null);
    setGroupSubmenuOpen(false);
    setSendToSubmenuOpen(false);
  }, []);

  const visibleTabIds = useMemo(() => state.sessions.map((session) => session.id), [state.sessions]);

  const handleDetachedTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, sessionId: string) => {
    if (visibleTabIds.length === 0) return;
    const currentIndex = visibleTabIds.indexOf(sessionId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = currentIndex === 0 ? visibleTabIds.length - 1 : currentIndex - 1;
        break;
      case "ArrowRight":
        nextIndex = currentIndex === visibleTabIds.length - 1 ? 0 : currentIndex + 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = visibleTabIds.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextSessionId = visibleTabIds[nextIndex];
    if (!nextSessionId) return;
    setActiveTabId(nextSessionId);
    requestAnimationFrame(() => {
      const nextTab = document.getElementById(`detached-session-tab-${nextSessionId}`);
      if (nextTab instanceof HTMLElement) nextTab.focus();
    });
  }, [visibleTabIds]);

  const handleSubmenuTriggerKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    panelRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
    requestAnimationFrame(() => {
      focusFirstSubmenuItem(panelRef.current);
    });
  }, []);

  const handleSubmenuPanelKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLDivElement>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    triggerRef: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  /** Resolve tab tint color: connection → parent folder → global default. */
  const resolveTabColor = useCallback((sess: ConnectionSession): string | undefined => {
    const conn = connectionsRef.current.find(c => c.id === sess.connectionId);
    if (conn?.tabColor) return conn.tabColor;
    if (conn?.parentId) {
      const parent = connectionsRef.current.find(c => c.id === conn.parentId);
      if (parent?.tabColor) return parent.tabColor;
    }
    return appSettings?.defaultTabColor || undefined;
  }, [appSettings?.defaultTabColor]);

  // Derive window title: "sortOfRemoteNG - ActiveTabName" (or custom override)
  const windowTitle = windowTitleOverride ?? (activeSession ? `sortOfRemoteNG - ${activeSession.name}` : "sortOfRemoteNG");

  // Sync to OS window title for taskbar
  useEffect(() => {
    if (isTauri && windowTitle) {
      getCurrentWindow().setTitle(windowTitle).catch(() => {});
    }
  }, [isTauri, windowTitle]);

  /** Emit reconnect command to main window's WindowManager. */
  const handleReconnect = useCallback((sid: string) => {
    emit("wm:command", { type: "RECONNECT_SESSION", sessionId: sid } as WindowCommand).catch(() => {});
  }, []);

  const disconnectActiveSession = useCallback(async () => {
    const s = activeSessionRef.current;
    if (!s || closingRef.current) return;
    closingRef.current = true;
    try {
      if (s.protocol === "ssh" && s.backendSessionId) {
        await invoke("disconnect_ssh", { sessionId: s.backendSessionId });
      }
      if (isTauri) {
        await emit("detached-session-closed", { sessionId: s.id });
      }
      if (sessionId) {
        localStorage.removeItem(`detached-session-${sessionId}`);
      }
    } catch (err) {
      console.error("Failed to disconnect detached session:", err);
    }
  }, [isTauri, sessionId]);

  const handleReattach = useCallback(async () => {
    const s = activeSessionRef.current;
    if (!s) return;
    try {
      reattachRef.current = true;
      skipNextConfirmRef.current = true;

      let terminalBuffer = "";
      if (s.protocol === "ssh" && s.backendSessionId) {
        try {
          terminalBuffer = await invoke<string>("get_terminal_buffer", {
            sessionId: s.backendSessionId,
          });
        } catch { /* ignore */ }
      }
      if (!terminalBuffer) {
        try {
          const bufferPromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => resolve(""), 1000);
            listen<{ sessionId: string; buffer: string }>("terminal-buffer-response", (event) => {
              if (event.payload.sessionId === s.id) {
                clearTimeout(timeout);
                resolve(event.payload.buffer);
              }
            }).then((unlisten) => { setTimeout(() => unlisten(), 1200); });
          });
          await emit("request-terminal-buffer", { sessionId: s.id });
          terminalBuffer = await bufferPromise;
        } catch { /* ignore */ }
      }
      await emit("detached-session-reattach", { sessionId: s.id, terminalBuffer });
      // Clean up localStorage
      localStorage.removeItem(`detached-session-${s.id}`);
      if (s.id !== sessionId) localStorage.removeItem(`detached-session-${sessionId}`);

      // Only close window if this was the last tab
      if (sessionsRef.current.length <= 1) {
        if (isTauri) await getCurrentWindow().close();
      } else {
        // Remove just this tab, keep the window open
        dispatch({ type: "REMOVE_SESSION", payload: s.id });
        reattachRef.current = false;
        skipNextConfirmRef.current = false;
      }
    } catch (err) {
      console.error("Failed to reattach detached session:", err);
    }
  }, [isTauri, sessionId]);

  // Keep ref in sync for the cross-window drop listener
  handleReattachRef.current = handleReattach;

  const handleCloseRequest = useCallback(async () => {
    if (reattachRef.current) { reattachRef.current = false; return true; }
    if (warnRef.current && !skipNextConfirmRef.current) {
      const confirmed = await requestCloseConfirmation();
      if (!confirmed) return false;
    }
    skipNextConfirmRef.current = false;
    await disconnectActiveSession();
    return true;
  }, [disconnectActiveSession, requestCloseConfirmation]);

  // Register close handler ONCE — stable because all deps are stable
  useEffect(() => {
    onRegisterDisconnect(handleCloseRequest);
  }, [handleCloseRequest, onRegisterDisconnect]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-background,#111827)]">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-xl bg-error/15 border border-error/25 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={24} className="text-error" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text,#f9fafb)] mb-1">Session Error</h3>
          <p className="text-xs text-[var(--color-textSecondary,#9ca3af)] mb-5">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => { hasLoadedRef.current = false; setError(""); window.location.reload(); }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              <CornerUpLeft size={12} />
              Reload
            </button>
            <button
              onClick={async () => { if (isTauri) await getCurrentWindow().close(); else window.close(); }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-surface,#1f2937)] text-[var(--color-textSecondary,#9ca3af)] border border-[var(--color-border,#374151)] hover:text-[var(--color-text,#f9fafb)] transition-colors"
            >
              <X size={12} />
              Close Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-background,#111827)]">
        <div className="text-center max-w-sm px-6">
          {loadingTimedOut ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-warning/15 border border-warning/25 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={24} className="text-warning" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text,#f9fafb)] mb-1">Loading Timed Out</h3>
              <p className="text-xs text-[var(--color-textSecondary,#9ca3af)] mb-5">
                The detached session failed to load within 30 seconds. The session data may be missing or corrupted.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => { hasLoadedRef.current = false; setLoadingTimedOut(false); setError(""); window.location.reload(); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
                >
                  <CornerUpLeft size={12} />
                  Retry
                </button>
                <button
                  onClick={async () => { if (isTauri) await getCurrentWindow().close(); else window.close(); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-surface,#1f2937)] text-[var(--color-textSecondary,#9ca3af)] border border-[var(--color-border,#374151)] hover:text-[var(--color-text,#f9fafb)] transition-colors"
                >
                  <X size={12} />
                  Close Window
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center mx-auto mb-4">
                <Loader2 size={22} className="text-primary animate-spin" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text,#f9fafb)] mb-1">Loading Session</h3>
              <p className="text-xs text-[var(--color-textSecondary,#9ca3af)]">Preparing detached session...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`h-full w-screen flex flex-col app-shell ${
          isTransparent ? "app-transparent" : "bg-gray-900"
        }`}
      >
      {/* ── Title bar ── */}
      <div
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="group/bar flex items-center gap-2 min-w-0 max-w-[60%]" data-tauri-disable-drag="true">
          <Monitor size={16} className="text-primary flex-shrink-0" />
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              aria-label="Edit window title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { const t = titleDraft.trim() || null; setWindowTitleOverride(t); setEditingTitle(false); if (isTauri && t) getCurrentWindow().setTitle(t).catch(() => {}); }
                if (e.key === "Escape") setEditingTitle(false);
              }}
              onBlur={() => { const t = titleDraft.trim() || null; setWindowTitleOverride(t); setEditingTitle(false); if (isTauri && t) getCurrentWindow().setTitle(t).catch(() => {}); }}
              style={{ width: `${Math.max(10, titleDraft.length + 2)}ch` }}
              className="text-sm font-semibold bg-[var(--color-surface)] border border-[var(--color-borderActive,var(--color-border))] rounded px-1.5 py-0.5 outline-none text-[var(--color-text)] min-w-[80px] max-w-[50vw]"
            />
          ) : (
            <span
              className="text-sm font-semibold tracking-tight text-[var(--color-text)] truncate cursor-default"
              onDoubleClick={() => { setTitleDraft(windowTitle); setEditingTitle(true); requestAnimationFrame(() => { const el = titleInputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }}
            >
              {windowTitle}
            </span>
          )}
          {!editingTitle && (
            <button
              onClick={() => { setTitleDraft(windowTitle); setEditingTitle(true); requestAnimationFrame(() => { const el = titleInputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }}
              className="p-1 rounded text-[var(--color-textMuted)] hover:text-[var(--color-text)] opacity-0 group-hover/bar:opacity-100 transition-opacity flex-shrink-0"
              data-tooltip="Rename window"
              aria-label="Rename window"
            >
              <Pencil size={10} />
            </button>
          )}
        </div>
        <div className="flex items-center space-x-1">
          <button onClick={async () => { if (!isTauri) return; const w = getCurrentWindow(); const v = !isAlwaysOnTop; await w.setAlwaysOnTop(v); setIsAlwaysOnTop(v); }} className="app-bar-button p-2" data-tooltip={isAlwaysOnTop ? "Unpin window" : "Pin window"} aria-label={isAlwaysOnTop ? "Unpin window" : "Pin window"}>
            <Pin size={14} className={isAlwaysOnTop ? "rotate-45 text-primary" : ""} />
          </button>
          <button onClick={async () => { if (isTauri) await getCurrentWindow().minimize(); }} className="app-bar-button p-2" data-tooltip="Minimize" aria-label="Minimize window"><Minus size={14} /></button>
          <button onClick={async () => { if (!isTauri) return; const w = getCurrentWindow(); if (await w.isMaximized()) { await w.unmaximize(); } else { await w.maximize(); } }} className="app-bar-button p-2" data-tooltip="Maximize" aria-label="Toggle maximize window"><Square size={12} /></button>
          <button onClick={async () => { if (isTauri) await getCurrentWindow().close(); }} className="app-bar-button app-bar-button-danger p-2" data-tooltip="Close" aria-label="Close window"><X size={14} /></button>
        </div>
      </div>

      {/* ── Tab bar — renders all sessions, supports drag reorder ── */}
      <div
        className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center overflow-x-auto"
        data-tauri-disable-drag="true"
        role="tablist"
        aria-label="Detached session tabs"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={(e) => {
          e.preventDefault();
          const draggedId = e.dataTransfer.getData("application/x-detached-session");
          if (!draggedId) return;
          // Find drop target tab
          const target = (e.target as HTMLElement).closest<HTMLElement>("[data-session-id]");
          const targetId = target?.dataset.sessionId;
          if (!targetId || targetId === draggedId) return;
          // Reorder locally, then notify main
          const fromIdx = state.sessions.findIndex(s => s.id === draggedId);
          const toIdx = state.sessions.findIndex(s => s.id === targetId);
          if (fromIdx !== -1 && toIdx !== -1) {
            dispatch({ type: "REORDER_SESSIONS", payload: { fromIndex: fromIdx, toIndex: toIdx } });
            // Notify main of new order
            const myWindowId = getCurrentWindow().label;
            const reordered = [...state.sessions.map(s => s.id)];
            const [moved] = reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, moved);
            const cmd: WindowCommand = { type: "REORDER_SESSIONS", windowId: myWindowId as any, sessionIds: reordered };
            emit("wm:command", cmd).catch(() => {});
          }
        }}
      >
        {/* Render tabs with group color, tint, pin, rename */}
        {state.sessions.map((sess) => {
          const isActive = sess.id === activeSession?.id;
          const isReal = !sess.protocol.startsWith("tool:") && !sess.protocol.startsWith("winmgmt:");
          const group = sess.tabGroupId ? state.tabGroups.find(g => g.id === sess.tabGroupId) : null;
          const tabTint = resolveTabColor(sess);
          const isPinned = (sess as any).pinned ?? false;
          return (
            <div
              key={sess.id}
              id={`detached-session-tab-${sess.id}`}
              data-session-id={sess.id}
              draggable
              data-tauri-disable-drag="true"
              role="tab"
              aria-selected={isActive}
              aria-controls={`detached-session-panel-${sess.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`group relative flex items-center h-full px-3 cursor-pointer border-r border-[var(--color-border)] min-w-0 transition-all ${
                isActive
                  ? "bg-[var(--color-border)] text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]/50"
              }`}
              style={tabTint ? {
                backgroundColor: isActive ? `color-mix(in srgb, ${tabTint} 18%, var(--color-border))` : undefined,
                backgroundImage: !isActive ? `linear-gradient(to right, color-mix(in srgb, ${tabTint} 10%, transparent), color-mix(in srgb, ${tabTint} 10%, transparent))` : undefined,
              } : undefined}
              onClick={() => setActiveTabId(sess.id)}
              onKeyDown={(event) => handleDetachedTabKeyDown(event, sess.id)}
              onAuxClick={(e) => handleMiddleClick(sess.id, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveTabId(sess.id);
                setSendToSubmenuOpen(false);
                setGroupSubmenuOpen(false);
                setTabContextMenu({ x: e.clientX, y: e.clientY, sessionId: sess.id });
                const myLabel = getCurrentWindow().label;
                import("@tauri-apps/api/window").then(({ getAllWindows }) =>
                  getAllWindows().then(async (wins) => {
                    const others = wins.filter(w => w.label !== myLabel);
                    const entries = await Promise.all(
                      others.map(async (w) => {
                        if (w.label === "main") return { label: w.label, title: "Main Window" };
                        const title = await w.title().catch(() => w.label);
                        return { label: w.label, title: title || w.label };
                      })
                    );
                    setOtherWindows(entries);
                  })
                ).catch(() => setOtherWindows([]));
              }}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-detached-session", sess.id); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnd={async (e) => {
                const { clientX, clientY } = e;
                if (clientX <= 0 || clientY <= 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) {
                  // Dragged outside — let main's WindowManager decide the target
                  try {
                    const myWin = getCurrentWindow();
                    const myPos = await myWin.outerPosition();
                    const cmd: WindowCommand = {
                      type: "DROP_ON_WINDOW",
                      sessionId: sess.id,
                      sourceWindow: myWin.label as any,
                      screenX: myPos.x + clientX,
                      screenY: myPos.y + clientY,
                    };
                    await emit("wm:command", cmd);
                  } catch {
                    // Fallback: reattach to main
                    const cmd: WindowCommand = { type: "REATTACH_SESSION", sessionId: sess.id };
                    emit("wm:command", cmd).catch(() => {});
                  }
                }
              }}
            >
              {/* Tint left-edge bar */}
              {tabTint && <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: tabTint }} />}
              <SessionIcon protocol={sess.protocol} />
              {isPinned && <Pin size={10} className="mr-1 flex-shrink-0 text-[var(--color-textMuted)]" />}
              {renamingTabId === sess.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  aria-label={`Rename tab ${sess.name || "Session"}`}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleCommitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm mr-2 max-w-32 bg-[var(--color-surface)] border border-[var(--color-borderActive)] rounded px-1 py-0 outline-none text-[var(--color-text)]"
                />
              ) : (
                <span className="truncate text-sm mr-2 max-w-[30vw]">{sess.name || "Session"}</span>
              )}
              {isReal && (
                <>
                  {sess.status === "connected" && <div className="w-2 h-2 rounded-full bg-success mr-1 flex-shrink-0" role="status" aria-label="Connected" />}
                  {sess.status === "connecting" && <div className="w-2 h-2 rounded-full bg-warning mr-1 flex-shrink-0" role="status" aria-label="Connecting" />}
                  {sess.status === "disconnected" && <div className="w-2 h-2 rounded-full bg-[var(--color-textMuted)] mr-1 flex-shrink-0" role="status" aria-label="Disconnected" />}
                  {sess.status === "error" && <div className="w-2 h-2 rounded-full bg-error mr-1 flex-shrink-0" role="status" aria-label="Error" />}
                </>
              )}
              <button onClick={(e) => { e.stopPropagation(); emit("wm:command", { type: "REATTACH_SESSION", sessionId: sess.id } as WindowCommand).catch(() => {}); }} className="flex-shrink-0 p-1 hover:bg-[var(--color-surface)] rounded transition-colors opacity-0 group-hover:opacity-100" data-tooltip="Reattach" aria-label={`Reattach ${sess.name || "session"}`}><CornerUpLeft size={11} /></button>
              <button onClick={(e) => { e.stopPropagation(); handleTabClose(sess.id); }} className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors" data-tooltip="Close" aria-label={`Close ${sess.name || "session"}`}><X size={11} /></button>
              {/* Group color bar at bottom */}
              {group && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: group.color }} />}
            </div>
          );
        })}
      </div>

      {/* ── Tab context menu ── */}
      <MenuSurface
        isOpen={tabContextMenu !== null}
        onClose={closeTabContextMenu}
        position={tabContextMenu}
        className="min-w-[180px]"
        ariaLabel="Detached tab actions"
      >
        {tabContextMenu && (() => {
          const sid = tabContextMenu.sessionId;
          const sess = state.sessions.find(s => s.id === sid);
          const idx = state.sessions.findIndex(s => s.id === sid);
          const conn = sess ? connectionsRef.current.find(c => c.id === sess.connectionId) : null;
          const isFirst = idx === 0;
          const isLast = idx === state.sessions.length - 1;
          const hasOthers = state.sessions.length > 1;
          const hasTabsToRight = idx < state.sessions.length - 1;
          const hasTabsToLeft = idx > 0;
          const isReal = sess && !sess.protocol.startsWith("tool:") && !sess.protocol.startsWith("winmgmt:");
          const isPinned = (sess as any)?.pinned ?? false;
          const isInGroup = !!sess?.tabGroupId;
          const act = (fn: () => void) => { fn(); closeTabContextMenu(); };

          return (
            <>
              {/* ── Info header ── */}
              <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)] select-text">
                <div className="font-medium text-[var(--color-textSecondary)]">{sess?.name}</div>
                {isReal && sess?.hostname && <div className="font-mono">{sess.hostname}{conn?.port ? `:${conn.port}` : ''}</div>}
                {isReal && sess?.status && <div>Status: {sess.status}</div>}
                {!isReal && <div>Tool</div>}
              </div>

              {/* ── Tab group actions ── */}
              <div
                className="sor-menu-submenu"
                data-submenu-open={groupSubmenuOpen ? "true" : "false"}
                onMouseEnter={() => setGroupSubmenuOpen(true)}
                onMouseLeave={() => setGroupSubmenuOpen(false)}
                onBlurCapture={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (!event.currentTarget.contains(next)) {
                    setGroupSubmenuOpen(false);
                  }
                }}
              >
                <button
                  id={groupSubmenuTriggerId}
                  ref={groupSubmenuTriggerRef}
                  className="sor-menu-item"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={groupSubmenuOpen}
                  aria-controls={groupSubmenuPanelId}
                  onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, setGroupSubmenuOpen, groupSubmenuPanelRef)}
                >
                  <Layers size={14} className="mr-2" />
                  <span className="flex-1">Add to Group</span>
                  <ChevronRight size={12} className="ml-2" />
                </button>
                <div
                  id={groupSubmenuPanelId}
                  ref={groupSubmenuPanelRef}
                  className="sor-menu-submenu-panel"
                  role="menu"
                  tabIndex={-1}
                  aria-label="Add to group submenu"
                  aria-labelledby={groupSubmenuTriggerId}
                  onKeyDown={(event) => handleSubmenuPanelKeyDown(event, setGroupSubmenuOpen, groupSubmenuTriggerRef)}
                >
                  {state.tabGroups.map(g => (
                    <button key={g.id} role="menuitem" onClick={() => act(() => {
                      if (sess) dispatch({ type: "UPDATE_SESSION", payload: { ...sess, tabGroupId: g.id } });
                    })} className="sor-menu-item">
                      <span className="w-3 h-3 rounded-full flex-shrink-0 mr-2" style={{ backgroundColor: g.color }} />
                      {g.name}
                    </button>
                  ))}
                  {state.tabGroups.length > 0 && <div className="sor-menu-divider" />}
                  <button role="menuitem" onClick={() => act(() => {
                    const newGroup = { id: generateId(), name: `Group ${state.tabGroups.length + 1}`, color: '#3b82f6', collapsed: false };
                    dispatch({ type: "ADD_TAB_GROUP", payload: newGroup });
                    if (sess) dispatch({ type: "UPDATE_SESSION", payload: { ...sess, tabGroupId: newGroup.id } });
                  })} className="sor-menu-item">
                    <FolderPlus size={14} className="mr-2" /> New Group...
                  </button>
                </div>
              </div>
              {isInGroup && (
                <button onClick={() => act(() => { if (sess) dispatch({ type: "UPDATE_SESSION", payload: { ...sess, tabGroupId: undefined } }); })} className="sor-menu-item">
                  <FolderMinus size={14} className="mr-2" /> Remove from Group
                </button>
              )}

              <div className="sor-menu-divider" />

              {/* ── Window actions ── */}
              <button onClick={() => act(() => { emit("wm:command", { type: "REATTACH_SESSION", sessionId: sid } as WindowCommand).catch(() => {}); })} className="sor-menu-item">
                <CornerUpLeft size={14} className="mr-2" /> Reattach to Main
              </button>
              {otherWindows.length > 0 && (
                <div
                  className="sor-menu-submenu"
                  data-submenu-open={sendToSubmenuOpen ? "true" : "false"}
                  onMouseEnter={() => setSendToSubmenuOpen(true)}
                  onMouseLeave={() => setSendToSubmenuOpen(false)}
                  onBlurCapture={(event) => {
                    const next = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(next)) {
                      setSendToSubmenuOpen(false);
                    }
                  }}
                >
                  <button
                    id={sendToSubmenuTriggerId}
                    ref={sendToSubmenuTriggerRef}
                    className="sor-menu-item"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={sendToSubmenuOpen}
                    aria-controls={sendToSubmenuPanelId}
                    onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, setSendToSubmenuOpen, sendToSubmenuPanelRef)}
                  >
                    <Send size={14} className="mr-2" />
                    <span className="flex-1">Send to Window</span>
                    <ChevronRight size={12} className="ml-2" />
                  </button>
                  <div
                    id={sendToSubmenuPanelId}
                    ref={sendToSubmenuPanelRef}
                    className="sor-menu-submenu-panel"
                    role="menu"
                    tabIndex={-1}
                    aria-label="Send to window submenu"
                    aria-labelledby={sendToSubmenuTriggerId}
                    onKeyDown={(event) => handleSubmenuPanelKeyDown(event, setSendToSubmenuOpen, sendToSubmenuTriggerRef)}
                  >
                    {otherWindows.map(w => (
                      <button key={w.label} role="menuitem" onClick={() => act(() => {
                        emit("wm:command", { type: "MOVE_SESSION", sessionId: sid, targetWindow: w.label } as WindowCommand).catch(() => {});
                      })} className="sor-menu-item">
                        <Monitor size={14} className="mr-2" />{w.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="sor-menu-divider" />

              {/* ── Edit actions ── */}
              <button onClick={() => act(() => handleStartRename(sid))} className="sor-menu-item">
                <Pencil size={14} className="mr-2" /> Rename Tab
              </button>
              {isReal && (
                <>
                  <button onClick={() => act(() => {
                    if (sess?.hostname) navigator.clipboard.writeText(sess.hostname).catch(() => {});
                  })} className="sor-menu-item">
                    <ClipboardCopy size={14} className="mr-2" /> Copy Hostname
                  </button>
                  <button onClick={() => act(() => {
                    const info = [sess?.name, `${sess?.protocol ?? ''}://${sess?.hostname ?? ''}${conn?.port ? ':' + conn.port : ''}`, `Status: ${sess?.status ?? 'unknown'}`, conn?.username ? `User: ${conn.username}` : ''].filter(Boolean).join('\n');
                    navigator.clipboard.writeText(info).catch(() => {});
                  })} className="sor-menu-item">
                    <Info size={14} className="mr-2" /> Copy Connection Info
                  </button>
                  <button onClick={() => act(() => {
                    if (sess?.connectionId) emit("wm:command", { type: "REVEAL_IN_SIDEBAR", connectionId: sess.connectionId } as WindowCommand).catch(() => {});
                  })} className="sor-menu-item">
                    <Eye size={14} className="mr-2" /> Reveal in Sidebar
                  </button>
                </>
              )}

              <div className="sor-menu-divider" />

              {/* ── Session actions (connections only) ── */}
              {isReal && (
                <>
                  <button onClick={() => act(() => { emit("wm:command", { type: "RECONNECT_SESSION", sessionId: sid } as WindowCommand).catch(() => {}); })} className="sor-menu-item">
                    <RefreshCw size={14} className="mr-2" /> Reconnect
                  </button>
                  <button onClick={() => act(() => { emit("wm:command", { type: "DUPLICATE_SESSION", sessionId: sid } as WindowCommand).catch(() => {}); })} className="sor-menu-item">
                    <Copy size={14} className="mr-2" /> Duplicate Tab
                  </button>
                </>
              )}
              <button onClick={() => act(() => {
                if (sess) dispatch({ type: "UPDATE_SESSION", payload: { ...sess, pinned: !isPinned } as any });
              })} className="sor-menu-item">
                {isPinned ? <><PinOff size={14} className="mr-2" /> Unpin Tab</> : <><Pin size={14} className="mr-2" /> Pin Tab</>}
              </button>

              <div className="sor-menu-divider" />

              {/* ── Move ── */}
              <button onClick={() => act(() => { if (idx > 0) dispatch({ type: "REORDER_SESSIONS", payload: { fromIndex: idx, toIndex: idx - 1 } }); })} className={`sor-menu-item ${isFirst ? "opacity-40 pointer-events-none" : ""}`} disabled={isFirst}>
                <ArrowLeft size={14} className="mr-2" /> Move Left
              </button>
              <button onClick={() => act(() => { if (!isLast) dispatch({ type: "REORDER_SESSIONS", payload: { fromIndex: idx, toIndex: idx + 1 } }); })} className={`sor-menu-item ${isLast ? "opacity-40 pointer-events-none" : ""}`} disabled={isLast}>
                <ArrowRight size={14} className="mr-2" /> Move Right
              </button>

              <div className="sor-menu-divider" />

              {/* ── Close actions ── */}
              <button onClick={() => act(() => handleTabClose(sid))} className="sor-menu-item sor-menu-item-danger">
                <X size={14} className="mr-2" /> Close Tab
              </button>
              {hasOthers && (
                <button onClick={() => act(() => {
                  state.sessions.filter(s => s.id !== sid).forEach(s => { emit("wm:command", { type: "CLOSE_SESSION", sessionId: s.id } as WindowCommand).catch(() => {}); });
                })} className="sor-menu-item sor-menu-item-danger">
                  <XCircle size={14} className="mr-2" /> Close Other Tabs
                </button>
              )}
              {hasTabsToRight && (
                <button onClick={() => act(() => {
                  state.sessions.slice(idx + 1).forEach(s => { emit("wm:command", { type: "CLOSE_SESSION", sessionId: s.id } as WindowCommand).catch(() => {}); });
                })} className="sor-menu-item sor-menu-item-danger">
                  <ArrowRightFromLine size={14} className="mr-2" /> Close Tabs to Right
                </button>
              )}
              {hasTabsToLeft && (
                <button onClick={() => act(() => {
                  state.sessions.slice(0, idx).forEach(s => { emit("wm:command", { type: "CLOSE_SESSION", sessionId: s.id } as WindowCommand).catch(() => {}); });
                })} className="sor-menu-item sor-menu-item-danger">
                  <ArrowLeftFromLine size={14} className="mr-2" /> Close Tabs to Left
                </button>
              )}
            </>
          );
        })()}
      </MenuSurface>

      {/* ── Reconnect banner for disconnected/error sessions ── */}
      {(activeSession.status === 'disconnected' || activeSession.status === 'error') && (
        <div className="flex items-center justify-between px-4 py-2 bg-warning/10 border-b border-warning/25 text-warning text-xs" role="alert" aria-live="assertive">
          <span className="flex items-center gap-2">
            <AlertCircle size={14} />
            {activeSession.status === 'disconnected' ? 'Connection lost. Attempting to reconnect...' : 'Connection error occurred.'}
          </span>
          <button
            onClick={() => handleReconnect(activeSession.id)}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-warning/20 hover:bg-warning/30 transition-colors"
            aria-label={`Retry connection for ${activeSession.name || 'session'}`}
          >
            <RefreshCw size={12} />
            Retry Now
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-hidden min-h-0 h-full"
        id={`detached-session-panel-${activeSession.id}`}
        role="tabpanel"
        aria-labelledby={`detached-session-tab-${activeSession.id}`}
      >
        <SessionViewer session={activeSession} />
      </div>
      </div>
      <ConfirmDialog
        isOpen={showCloseConfirm}
        message={t("dialogs.confirmCloseDetached") || "Close detached window?"}
        onConfirm={() => resolveCloseConfirmation(true)}
        onCancel={() => resolveCloseConfirmation(false)}
      />
      <ConfirmDialog
        isOpen={tabCloseConfirm !== null}
        message={`Close the active session "${tabCloseConfirm?.name}"?`}
        onConfirm={() => {
          if (tabCloseConfirm) emit("wm:command", { type: "CLOSE_SESSION", sessionId: tabCloseConfirm.sessionId } as WindowCommand).catch(() => {});
          setTabCloseConfirm(null);
        }}
        onCancel={() => setTabCloseConfirm(null)}
      />
    </>
  );
};

const DetachedWindowLifecycle: React.FC<{
  onBeforeClose: () => Promise<boolean>;
}> = ({ onBeforeClose }) => {
  // Use a ref so the effect registers onCloseRequested ONCE and the
  // handler always calls the latest onBeforeClose without re-registering.
  const handlerRef = useRef(onBeforeClose);
  handlerRef.current = onBeforeClose;

  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let isClosing = false;
    const currentWindow = getCurrentWindow();
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      if (isClosing) return;
      event.preventDefault();
      isClosing = true;
      const shouldClose = await handlerRef.current();
      if (!shouldClose) {
        isClosing = false;
        return;
      }
      await currentWindow.close();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

const DetachedClient: React.FC = () => {
  const [disconnectHandler, setDisconnectHandler] = useState<
    (() => Promise<boolean>) | null
  >(null);
  const handleRegisterDisconnect = useCallback(
    (handler: () => Promise<boolean>) => setDisconnectHandler(() => handler),
    [],
  );

  return (
    <SettingsProvider>
      <ConnectionProvider>
        <ToastProvider>
          {disconnectHandler && (
            <DetachedWindowLifecycle onBeforeClose={disconnectHandler} />
          )}
          <DetachedSessionContent onRegisterDisconnect={handleRegisterDisconnect} />
        </ToastProvider>
      </ConnectionProvider>
    </SettingsProvider>
  );
};

export default DetachedClient;
