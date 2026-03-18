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
import { AlertCircle, CornerUpLeft, Eye, Globe, Minus, Monitor, Phone, Pin, Server, Square, Terminal, X } from "lucide-react";
import { useTooltipSystem } from "../../src/hooks/window/useTooltipSystem";

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

  useEffect(() => {
    if (hasLoadedRef.current) return;
    if (!sessionId) {
      setError("Missing detached session id.");
      return;
    }

    hasLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(`detached-session-${sessionId}`);
      if (!raw) {
        setError("Detached session data not found.");
        return;
      }

      const payload = JSON.parse(raw) as {
        session: ConnectionSession;
        connection?: Connection | null;
      };

      if (!payload.session) {
        setError("Detached session payload is invalid.");
        return;
      }

      const revivedSession = reviveSession(payload.session);
      const revivedConnection = payload.connection ? reviveConnection(payload.connection) : null;

      if (revivedConnection) {
        dispatch({ type: "SET_CONNECTIONS", payload: [revivedConnection] });
      }

      dispatch({ type: "ADD_SESSION", payload: revivedSession });
    } catch (err) {
      console.error("Failed to load detached session:", err);
      setError("Unable to load detached session data.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!isTauri) return;
    const currentWindow = getCurrentWindow();
    currentWindow
      .isAlwaysOnTop()
      .then(setIsAlwaysOnTop)
      .catch(() => undefined);
  }, [isTauri]);

  // Listen for tabs dragged from other detached windows onto this one.
  // When claimed, we swap sessions: this window takes the dragged session,
  // and the source window takes ours.
  useEffect(() => {
    if (!isTauri || !sessionId) return;
    const cleanups: Array<() => void> = [];

    // 1. Another window dropped its tab — check if it landed on us
    const p1 = listen<{
      sessionId: string;
      sourceWindow: string;
      screenX: number;
      screenY: number;
    }>("detached-tab-dropped-outside", async (event) => {
      const { sessionId: draggedSessionId, sourceWindow, screenX, screenY } = event.payload;
      const myWin = getCurrentWindow();
      if (sourceWindow === myWin.label) return;
      try {
        const [pos, size] = await Promise.all([
          myWin.outerPosition(),
          myWin.outerSize(),
        ]);
        if (
          screenX >= pos.x && screenX <= pos.x + size.width &&
          screenY >= pos.y && screenY <= pos.y + size.height
        ) {
          // Claimed! Read the dragged session from localStorage
          const draggedRaw = localStorage.getItem(`detached-session-${draggedSessionId}`);
          if (!draggedRaw) return;

          // Save our current session data for the source window to pick up
          const mySession = activeSessionRef.current;
          if (mySession) {
            const myConn = state.connections.find(c => c.id === mySession.connectionId);
            localStorage.setItem(`detached-session-${mySession.id}`, JSON.stringify({
              session: mySession,
              connection: myConn || null,
              savedAt: Date.now(),
            }));
          }

          // Tell source window we claimed it, sending our session for the swap
          await emit("detached-tab-claimed", {
            claimedSessionId: draggedSessionId,
            sourceWindow,
            targetWindow: myWin.label,
            swapSessionId: mySession?.id || null,
          });

          // Load the dragged session into this window
          const draggedPayload = JSON.parse(draggedRaw);
          const newSession = reviveSession(draggedPayload.session);
          const newConn = draggedPayload.connection ? reviveConnection(draggedPayload.connection) : null;
          if (newConn) dispatch({ type: "SET_CONNECTIONS", payload: [newConn] });
          // Replace our session
          if (mySession) dispatch({ type: "REMOVE_SESSION", payload: mySession.id });
          dispatch({ type: "ADD_SESSION", payload: newSession });
        }
      } catch { /* ignore */ }
    });
    p1.then(fn => cleanups.push(fn)).catch(() => {});

    // 2. Our drag was claimed by another window — load their session (swap)
    const p2 = listen<{
      claimedSessionId: string;
      sourceWindow: string;
      targetWindow: string;
      swapSessionId: string | null;
    }>("detached-tab-claimed", async (event) => {
      const { claimedSessionId, sourceWindow, swapSessionId } = event.payload;
      const myWin = getCurrentWindow();
      // Only react if WE are the source
      if (sourceWindow !== myWin.label) return;
      // Cancel the reattach fallback
      closingRef.current = true;

      if (swapSessionId) {
        // Load the other window's session
        const swapRaw = localStorage.getItem(`detached-session-${swapSessionId}`);
        if (swapRaw) {
          const swapPayload = JSON.parse(swapRaw);
          const newSession = reviveSession(swapPayload.session);
          const newConn = swapPayload.connection ? reviveConnection(swapPayload.connection) : null;
          if (newConn) dispatch({ type: "SET_CONNECTIONS", payload: [newConn] });
          const mySession = activeSessionRef.current;
          if (mySession) dispatch({ type: "REMOVE_SESSION", payload: mySession.id });
          dispatch({ type: "ADD_SESSION", payload: newSession });
          // Clean up old localStorage entry
          localStorage.removeItem(`detached-session-${claimedSessionId}`);
          closingRef.current = false;
        }
      } else {
        // No swap — other window didn't have a session, just close us
        closingRef.current = false;
        handleReattachRef.current?.();
      }
    });
    p2.then(fn => cleanups.push(fn)).catch(() => {});

    return () => { cleanups.forEach(fn => fn()); };
  }, [isTauri, sessionId, dispatch, state.connections]);

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

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === sessionId),
    [state.sessions, sessionId],
  );

  // ── Ref-based access for callbacks to avoid dependency cascades ──
  // activeSession changes on every state.sessions update (new object ref).
  // If callbacks depend on it directly, the entire close-handler chain
  // recreates → parent re-renders → DetachedWindowLifecycle re-registers
  // onCloseRequested → Tauri listener leak. Using a ref breaks the chain.
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const warnRef = useRef(warnOnDetachClose);
  warnRef.current = warnOnDetachClose;

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
      if (sessionId) localStorage.removeItem(`detached-session-${sessionId}`);
      if (isTauri) await getCurrentWindow().close();
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
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-200">
        <div className="text-center">
          <Monitor className="mx-auto mb-4 h-10 w-10 text-blue-400" />
          <p className="text-sm">Loading detached session...</p>
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
      {/* ── Title bar — matches main window AppToolbar ── */}
      <div
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-primary" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-[var(--color-text)]">sortOfRemoteNG</div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">Remote Connection Manager</div>
          </div>
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

      {/* ── Tab bar — matches main window SessionTabs style ── */}
      <div className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center overflow-x-auto" data-tauri-disable-drag="true">
        <div
          draggable
          data-tauri-disable-drag="true"
          className="relative flex items-center h-full px-3 cursor-grab active:cursor-grabbing bg-[var(--color-border)] text-[var(--color-text)] border-r border-[var(--color-border)] min-w-0 transition-all"
          data-tooltip="Drag outside window to reattach"
          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-detached-session", activeSession.id); }}
          onDragEnd={async (e) => {
            const { clientX, clientY } = e;
            if (clientX <= 0 || clientY <= 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) {
              // Dropped outside — check if another detached window is at that screen position
              try {
                const myWin = getCurrentWindow();
                const myPos = await myWin.outerPosition();
                const screenX = myPos.x + clientX;
                const screenY = myPos.y + clientY;
                // Emit event so other detached windows can check if cursor landed on them
                await emit("detached-tab-dropped-outside", {
                  sessionId: activeSession.id,
                  sourceWindow: myWin.label,
                  screenX,
                  screenY,
                });
                // Give other windows a moment to claim it, then fall back to reattach to main
                setTimeout(() => {
                  if (!closingRef.current) handleReattach();
                }, 300);
              } catch {
                handleReattach();
              }
            }
          }}
        >
          <SessionIcon protocol={activeSession.protocol} />
          <span className="truncate text-sm mr-2 max-w-[40vw]">{activeSession.name || "Detached Session"}</span>
          {!activeSession.protocol.startsWith("tool:") && !activeSession.protocol.startsWith("winmgmt:") && (
            <>
              {activeSession.status === "connected" && <div className="w-2 h-2 rounded-full bg-success mr-2 flex-shrink-0" />}
              {activeSession.status === "connecting" && <div className="w-2 h-2 rounded-full bg-warning mr-2 flex-shrink-0" />}
              {activeSession.status === "error" && <div className="w-2 h-2 rounded-full bg-error mr-2 flex-shrink-0" />}
            </>
          )}
          <button onClick={handleReattach} className="flex-shrink-0 p-1 hover:bg-[var(--color-surface)] rounded transition-colors" data-tooltip="Reattach to main window"><CornerUpLeft size={12} /></button>
          <button onClick={async () => { if (isTauri) await getCurrentWindow().close(); }} className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors" data-tooltip="Close"><X size={12} /></button>
        </div>
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
