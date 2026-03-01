"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import "../../src/i18n";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { Connection, ConnectionSession } from "../../src/types/connection";
import { SessionViewer } from "../../src/components/session/SessionViewer";
import { ConfirmDialog } from "../../src/components/shared/ConfirmDialog";
import { SettingsManager } from "../../src/utils/settingsManager";
import { ThemeManager } from "../../src/utils/themeManager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { CornerUpLeft, Minus, Monitor, Pin, Square, X } from "lucide-react";

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
  const closeResolverRef = useRef<((value: boolean) => void) | null>(null);

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
      if (isTauri) {
        const currentWindow = getCurrentWindow();
        const setBackgroundColor = currentWindow.setBackgroundColor;
        if (typeof setBackgroundColor === "function") {
          const alphaByte = Math.round(255 * targetOpacity);
          setBackgroundColor([17, 24, 39, alphaByte]).catch(() => undefined);
        }
      }
    },
    [isTauri],
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

      if (!state.sessions.some((session) => session.id === revivedSession.id)) {
        dispatch({ type: "ADD_SESSION", payload: revivedSession });
      } else {
        dispatch({ type: "UPDATE_SESSION", payload: revivedSession });
      }
    } catch (err) {
      console.error("Failed to load detached session:", err);
      setError("Unable to load detached session data.");
    }
  }, [dispatch, sessionId, state.sessions]);

  useEffect(() => {
    if (!isTauri) return;
    const currentWindow = getCurrentWindow();
    currentWindow
      .isAlwaysOnTop()
      .then(setIsAlwaysOnTop)
      .catch(() => undefined);
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
        // Apply the same theme as main window
        themeManager.applyTheme(
          settings.theme,
          settings.colorScheme,
          settings.primaryAccentColor,
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
      const themeManager = ThemeManager.getInstance();
      themeManager.applyTheme(
        event.payload.theme as any,
        event.payload.colorScheme as any,
        event.payload.primaryAccentColor,
      );
      // Dispatch settings-updated event so WebTerminal can sync xterm theme
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

  const disconnectActiveSession = useCallback(async () => {
    if (!activeSession || closingRef.current) return;
    closingRef.current = true;
    try {
      if (activeSession.protocol === "ssh" && activeSession.backendSessionId) {
        await invoke("disconnect_ssh", { sessionId: activeSession.backendSessionId });
      }
      if (isTauri) {
        await emit("detached-session-closed", { sessionId: activeSession.id });
      }
      if (sessionId) {
        localStorage.removeItem(`detached-session-${sessionId}`);
      }
    } catch (err) {
      console.error("Failed to disconnect detached session:", err);
    }
  }, [activeSession, isTauri, sessionId]);

  const handleReattach = useCallback(async () => {
    if (!activeSession) return;
    try {
      reattachRef.current = true;
      skipNextConfirmRef.current = true;
      
      // Get terminal buffer before reattaching
      let terminalBuffer = "";
      
      // For SSH sessions, get buffer directly from Rust backend (most reliable)
      if (activeSession.protocol === "ssh" && activeSession.backendSessionId) {
        try {
          terminalBuffer = await invoke<string>("get_terminal_buffer", { 
            sessionId: activeSession.backendSessionId 
          });
          console.log("Got buffer from Rust backend:", terminalBuffer?.length || 0, "chars");
        } catch (err) {
          console.warn("Failed to get buffer from backend:", err);
        }
      }
      
      // Fallback to event-based buffer request if backend didn't return anything
      if (!terminalBuffer) {
        try {
          const bufferPromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => {
              console.log("Buffer request timed out");
              resolve("");
            }, 1000);
            
            listen<{ sessionId: string; buffer: string }>("terminal-buffer-response", (event) => {
              if (event.payload.sessionId === activeSession.id) {
                clearTimeout(timeout);
                console.log("Received buffer response:", event.payload.buffer?.length || 0, "chars");
                resolve(event.payload.buffer);
              }
            }).then(unlisten => {
              setTimeout(() => unlisten(), 1200);
            });
          });
          
          console.log("Requesting terminal buffer for session:", activeSession.id);
          await emit("request-terminal-buffer", { sessionId: activeSession.id });
          terminalBuffer = await bufferPromise;
          console.log("Got terminal buffer via event:", terminalBuffer?.length || 0, "chars");
        } catch (error) {
          console.warn("Failed to get terminal buffer:", error);
        }
      }
      
      await emit("detached-session-reattach", { 
        sessionId: activeSession.id,
        terminalBuffer,
      });
      if (sessionId) {
        localStorage.removeItem(`detached-session-${sessionId}`);
      }
      if (isTauri) {
        const currentWindow = getCurrentWindow();
        await currentWindow.close();
      }
    } catch (err) {
      console.error("Failed to reattach detached session:", err);
    }
  }, [activeSession, isTauri, sessionId]);

  const handleCloseRequest = useCallback(async () => {
    // Skip confirmation if reattaching
    if (reattachRef.current) {
      reattachRef.current = false;
      return true;
    }
    
    // Show confirmation dialog if warning is enabled and not already confirmed
    if (warnOnDetachClose && !skipNextConfirmRef.current) {
      const confirmed = await requestCloseConfirmation();
      if (!confirmed) {
        return false;
      }
    }
    
    // Reset the skip flag
    skipNextConfirmRef.current = false;
    
    // Disconnect and close
    await disconnectActiveSession();
    return true;
  }, [disconnectActiveSession, requestCloseConfirmation, warnOnDetachClose]);

  useEffect(() => {
    onRegisterDisconnect(handleCloseRequest);
  }, [handleCloseRequest, onRegisterDisconnect]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-200">
        <div className="text-center">
          <Monitor className="mx-auto mb-4 h-10 w-10 text-red-400" />
          <p className="text-sm">{error}</p>
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
      <div
        className="h-10 app-bar border-b flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-blue-400" />
          <div className="text-xs text-gray-200 truncate max-w-[60vw]">
            {activeSession.name || "Detached Session"}
          </div>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              const nextValue = !isAlwaysOnTop;
              await currentWindow.setAlwaysOnTop(nextValue);
              setIsAlwaysOnTop(nextValue);
            }}
            className="app-bar-button p-1.5"
            data-tooltip={isAlwaysOnTop ? "Unpin window" : "Pin window"}
          >
            <Pin size={12} className={isAlwaysOnTop ? "rotate-45 text-blue-400" : ""} />
          </button>
          <button
            onClick={handleReattach}
            className="app-bar-button p-1.5"
            data-tooltip="Reattach"
          >
            <CornerUpLeft size={12} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              await currentWindow.minimize();
            }}
            className="app-bar-button p-1.5"
            data-tooltip="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              const isMaximized = await currentWindow.isMaximized();
              if (isMaximized) {
                await currentWindow.unmaximize();
                return;
              }
              await currentWindow.maximize();
            }}
            className="app-bar-button p-1.5"
            data-tooltip="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              // Just request close - the onCloseRequested handler will handle confirmation
              const currentWindow = getCurrentWindow();
              await currentWindow.close();
            }}
            className="app-bar-button app-bar-button-danger p-1.5"
            data-tooltip="Close"
          >
            <X size={12} />
          </button>
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
      const shouldClose = await onBeforeClose();
      if (!shouldClose) {
        isClosing = false;
        return;
      }
      await currentWindow.close();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [onBeforeClose]);

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
    <ConnectionProvider>
      {disconnectHandler && (
        <DetachedWindowLifecycle onBeforeClose={disconnectHandler} />
      )}
      <DetachedSessionContent onRegisterDisconnect={handleRegisterDisconnect} />
    </ConnectionProvider>
  );
};

export default DetachedClient;
