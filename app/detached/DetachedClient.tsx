"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AlertCircle, CornerUpLeft, Eye, Globe, Loader2, Minus, Monitor, Pencil, Phone, Pin, Server, Square, Terminal, X } from "lucide-react";
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

  // Derive window title: "sortOfRemoteNG - ActiveTabName" (or custom override)
  const windowTitle = windowTitleOverride ?? (activeSession ? `sortOfRemoteNG - ${activeSession.name}` : "sortOfRemoteNG");

  // Sync to OS window title for taskbar
  useEffect(() => {
    if (isTauri && windowTitle) {
      getCurrentWindow().setTitle(windowTitle).catch(() => {});
    }
  }, [isTauri, windowTitle]);

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
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { const t = titleDraft.trim() || null; setWindowTitleOverride(t); setEditingTitle(false); if (isTauri && t) getCurrentWindow().setTitle(t).catch(() => {}); }
                if (e.key === "Escape") setEditingTitle(false);
              }}
              onBlur={() => { const t = titleDraft.trim() || null; setWindowTitleOverride(t); setEditingTitle(false); if (isTauri && t) getCurrentWindow().setTitle(t).catch(() => {}); }}
              className="text-sm font-semibold bg-[var(--color-surface)] border border-[var(--color-borderActive,var(--color-border))] rounded px-1.5 py-0.5 outline-none text-[var(--color-text)] min-w-[120px] max-w-[40vw]"
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
            >
              <Pencil size={10} />
            </button>
          )}
        </div>
        <div className="flex items-center space-x-1">
          <button onClick={async () => { if (!isTauri) return; const w = getCurrentWindow(); const v = !isAlwaysOnTop; await w.setAlwaysOnTop(v); setIsAlwaysOnTop(v); }} className="app-bar-button p-2" data-tooltip={isAlwaysOnTop ? "Unpin window" : "Pin window"}>
            <Pin size={14} className={isAlwaysOnTop ? "rotate-45 text-primary" : ""} />
          </button>
          <button onClick={async () => { if (isTauri) await getCurrentWindow().minimize(); }} className="app-bar-button p-2" data-tooltip="Minimize"><Minus size={14} /></button>
          <button onClick={async () => { if (!isTauri) return; const w = getCurrentWindow(); (await w.isMaximized()) ? await w.unmaximize() : await w.maximize(); }} className="app-bar-button p-2" data-tooltip="Maximize"><Square size={12} /></button>
          <button onClick={async () => { if (isTauri) await getCurrentWindow().close(); }} className="app-bar-button app-bar-button-danger p-2" data-tooltip="Close"><X size={14} /></button>
        </div>
      </div>

      {/* ── Tab bar — renders all sessions, supports drag reorder ── */}
      <div
        className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center overflow-x-auto"
        data-tauri-disable-drag="true"
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
        {state.sessions.map((sess) => {
          const isActive = sess.id === activeSession?.id;
          const isReal = !sess.protocol.startsWith("tool:") && !sess.protocol.startsWith("winmgmt:");
          return (
            <div
              key={sess.id}
              data-session-id={sess.id}
              draggable
              data-tauri-disable-drag="true"
              className={`group relative flex items-center h-full px-3 cursor-pointer border-r border-[var(--color-border)] min-w-0 transition-all ${
                isActive
                  ? "bg-[var(--color-border)] text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]/50"
              }`}
              onClick={() => setActiveTabId(sess.id)}
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
              <SessionIcon protocol={sess.protocol} />
              <span className="truncate text-sm mr-2 max-w-[30vw]">{sess.name || "Session"}</span>
              {isReal && (
                <>
                  {sess.status === "connected" && <div className="w-2 h-2 rounded-full bg-success mr-1 flex-shrink-0" />}
                  {sess.status === "connecting" && <div className="w-2 h-2 rounded-full bg-warning mr-1 flex-shrink-0" />}
                  {sess.status === "error" && <div className="w-2 h-2 rounded-full bg-error mr-1 flex-shrink-0" />}
                </>
              )}
              <button onClick={(e) => { e.stopPropagation(); emit("wm:command", { type: "REATTACH_SESSION", sessionId: sess.id } as WindowCommand).catch(() => {}); }} className="flex-shrink-0 p-1 hover:bg-[var(--color-surface)] rounded transition-colors opacity-0 group-hover:opacity-100" data-tooltip="Reattach"><CornerUpLeft size={11} /></button>
              <button onClick={(e) => { e.stopPropagation(); emit("wm:command", { type: "CLOSE_SESSION", sessionId: sess.id } as WindowCommand).catch(() => {}); }} className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors" data-tooltip="Close"><X size={11} /></button>
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden min-h-0 h-full">
        <SessionViewer session={activeSession} />
      </div>
      </div>
      <ConfirmDialog
        isOpen={showCloseConfirm}
        message={t("dialogs.confirmCloseDetached") || "Close detached window?"}
        onConfirm={() => resolveCloseConfirmation(true)}
        onCancel={() => resolveCloseConfirmation(false)}
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
