import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../contexts/useConnections";
import { Connection, ConnectionSession } from "../types/connection";
import { isToolProtocol } from "../components/ToolPanel";
import { SettingsManager } from "../utils/settingsManager";
import { StatusChecker } from "../utils/statusChecker";
// import { ScriptEngine } from "../utils/scriptEngine"; // Disabled for Tauri migration
import { getDefaultPort } from "../utils/defaultPorts";
import { raceWithTimeout } from "../utils/raceWithTimeout";
import { generateId } from "../utils/id";
import { ConfirmDialog } from "../components/ConfirmDialog";

/**
 * Manages connection sessions and exposes helpers for session workflows.
 *
 * @returns Collection of session management utilities and state.
 */
export const useSessionManager = () => {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();

  const settingsManager = SettingsManager.getInstance();
  const statusChecker = StatusChecker.getInstance();
  // const scriptEngine = ScriptEngine.getInstance(); // Disabled for Tauri

  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  // Store active timeout IDs so they can be cleared on unmount
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [dialogState, setDialogState] = useState<{
    message: string;
    showCancel: boolean;
    resolve: (value: boolean) => void;
  } | null>(null);

  // Dialog helper used by confirm/alert wrappers
  const showDialog = (message: string, showCancel: boolean) =>
    new Promise<boolean>((resolve) => {
      setDialogState({ message, showCancel, resolve });
    });

  // Convenient wrappers around showDialog
  const showConfirm = (message: string) => showDialog(message, true);
  const showAlert = (message: string) => showDialog(message, false);

  // Register a timeout and track it for cleanup
  const startTimer = (fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay);
    timers.current.push(id);
    return id;
  };

  useEffect(() => {
    return () => {
      // Clear any active timers when the hook unmounts
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  const connectSession = async (
    session: ConnectionSession,
    connection: Connection,
  ) => {
    const settings = settingsManager.getSettings();
    const startTime = Date.now();

    settingsManager.logAction(
      "info",
      "Connection initiated",
      connection.id,
      `Connecting to ${connection.hostname}:${connection.port}`,
    );

    try {
      // await scriptEngine.executeScriptsForTrigger("onConnect", {
      //   connection,
      //   session,
      // });
    } catch (error) {
      console.error("Script execution failed:", error);
    }

    if (connection.statusCheck?.enabled) {
      statusChecker.startChecking(connection);
    }

    const timeout = (connection.timeout ?? settings.connectionTimeout) * 1000;
    let connectionTimer: ReturnType<typeof setTimeout>;
    const connectionPromise = new Promise<void>((resolve) => {
      connectionTimer = startTimer(() => {
        const connectionTime = Date.now() - startTime;

        settingsManager.recordPerformanceMetric({
          connectionTime,
          dataTransferred: 0,
          latency: Math.random() * 50 + 10,
          throughput: Math.random() * 1000 + 500,
          cpuUsage: Math.random() * 30 + 10,
          memoryUsage: Math.random() * 50 + 20,
          timestamp: Date.now(),
        });

        dispatch({
          type: "UPDATE_SESSION",
          payload: {
            ...session,
            status: "connected",
            metrics: {
              connectionTime,
              dataTransferred: 0,
              latency: Math.random() * 50 + 10,
              throughput: Math.random() * 1000 + 500,
            },
          },
        });

        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...connection,
            lastConnected: new Date(),
            connectionCount: (connection.connectionCount || 0) + 1,
          },
        });

        settingsManager.logAction(
          "info",
          "Connection established",
          connection.id,
          `Connected successfully in ${connectionTime}ms`,
          connectionTime,
        );
        resolve();
      }, 2000);
    });
    let raced: Promise<void>;
    if (timeout === 0) {
      raced = connectionPromise;
    } else {
      const { promise, timer: timeoutTimer } = raceWithTimeout(
        connectionPromise,
        timeout,
        () => clearTimeout(connectionTimer),
      );
      raced = promise;
      timers.current.push(timeoutTimer);
    }

    try {
      await raced;
    } catch (error) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...session, status: "error" },
      });

      settingsManager.logAction(
        "error",
        "Connection failed",
        connection.id,
        error instanceof Error ? error.message : "Unknown error",
      );

      if (
        (session.reconnectAttempts || 0) < (session.maxReconnectAttempts || 0)
      ) {
        // Schedule another attempt when the retry delay expires
        startTimer(() => {
          handleReconnect(session);
        }, connection.retryDelay || settings.retryDelay);
      }
    }
  };

  /**
   * Creates a new session for a given connection and begins establishing it.
   * @param connection - Connection definition to open.
   */
  const handleConnect = async (connection: Connection) => {
    const settings = settingsManager.getSettings();

    // Check for existing session for protocols that should reuse connections
    const reuseSessionProtocols = ["ssh", "http", "https"];
    if (reuseSessionProtocols.includes(connection.protocol)) {
      const existingSession = state.sessions.find(
        (session) =>
          session.connectionId === connection.id &&
          session.protocol === connection.protocol &&
          session.status !== "disconnected" &&
          session.status !== "error",
      );
      if (existingSession) {
        setActiveSessionId(existingSession.id);
        return;
      }
    }

    if (settings.singleConnectionMode && state.sessions.length > 0) {
      const proceed = await showConfirm(
        "Close existing connection and open new one?",
      );
      if (!proceed) {
        return;
      }
      state.sessions.forEach((session) => {
        dispatch({ type: "REMOVE_SESSION", payload: session.id });
      });
    }

    if (state.sessions.length >= settings.maxConcurrentConnections) {
      await showAlert(
        `Maximum concurrent connections (${settings.maxConcurrentConnections}) reached.`,
      );
      return;
    }

    const session: ConnectionSession = {
      id: generateId(),
      connectionId: connection.id,
      name:
        settings.hostnameOverride && connection.hostname
          ? connection.hostname
          : connection.name,
      status: "connecting",
      startTime: new Date(),
      protocol: connection.protocol,
      hostname: connection.hostname,
      reconnectAttempts: 0,
      maxReconnectAttempts: connection.retryAttempts || settings.retryAttempts,
    };

    dispatch({ type: "ADD_SESSION", payload: session });
    setActiveSessionId(session.id);

    await connectSession(session, connection);
  };

  const reconnectSession = async (
    session: ConnectionSession,
    connection: Connection,
  ) => {
    const updatedSession: ConnectionSession = {
      ...session,
      status: "reconnecting",
      reconnectAttempts: (session.reconnectAttempts || 0) + 1,
      startTime: new Date(),
    };

    dispatch({ type: "UPDATE_SESSION", payload: updatedSession });
    settingsManager.logAction(
      "info",
      "Reconnection attempt",
      connection.id,
      `Attempt ${updatedSession.reconnectAttempts}/${updatedSession.maxReconnectAttempts}`,
    );

    await connectSession(updatedSession, connection);
  };

  /**
   * Initiates a reconnect for a given session.
   * @param session - Session to re-establish.
   */
  const handleReconnect = async (session: ConnectionSession) => {
    const connection = state.connections.find(
      (c) => c.id === session.connectionId,
    );
    if (!connection) return;

    // Retry the connection after a short delay
    startTimer(() => {
      reconnectSession(session, connection);
    }, 2000);
  };

  /**
   * Opens a temporary connection based on hostname and protocol.
   * @param hostname - Target host name.
   * @param protocol - Connection protocol.
   */
  const handleQuickConnect = (payload: {
    hostname: string;
    protocol: string;
    username?: string;
    password?: string;
    domain?: string;
    authType?: "password" | "key";
    privateKey?: string;
    passphrase?: string;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    httpVerifySsl?: boolean;
  }) => {
    const tempConnection: Connection = {
      id: generateId(),
      name: `${t("connections.quickConnect")} - ${payload.hostname}`,
      protocol: payload.protocol as Connection["protocol"],
      hostname: payload.hostname,
      port: getDefaultPort(payload.protocol),
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (payload.protocol === "ssh") {
      tempConnection.username = payload.username;
      tempConnection.authType = payload.authType;
      tempConnection.password = payload.password;
      tempConnection.privateKey = payload.privateKey;
      tempConnection.passphrase = payload.passphrase;
    } else if (payload.protocol === "rdp") {
      tempConnection.username = payload.username;
      tempConnection.password = payload.password;
      tempConnection.domain = payload.domain;
    } else if (payload.protocol === "vnc") {
      tempConnection.password = payload.password;
    } else if (payload.protocol === "http" || payload.protocol === "https") {
      if (payload.basicAuthUsername || payload.basicAuthPassword) {
        tempConnection.authType = "basic";
        tempConnection.basicAuthUsername = payload.basicAuthUsername;
        tempConnection.basicAuthPassword = payload.basicAuthPassword;
      }
      if (payload.protocol === "https" && payload.httpVerifySsl !== undefined) {
        tempConnection.httpVerifySsl = payload.httpVerifySsl;
      }
    } else if (payload.protocol === "telnet") {
      tempConnection.username = payload.username;
      tempConnection.password = payload.password;
    }

    handleConnect(tempConnection);
  };

  /**
   * Closes an active session and performs cleanup.
   * @param sessionId - ID of the session to close.
   */
  const handleSessionClose = async (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // Tool tabs just get removed — no connection lifecycle
    if (isToolProtocol(session.protocol)) {
      dispatch({ type: "REMOVE_SESSION", payload: sessionId });
      return;
    }

    const connection = state.connections.find(
      (c) => c.id === session.connectionId,
    );
    const settings = settingsManager.getSettings();

    // RDP sessions use their own close policy instead of the generic warnOnClose.
    if (session.protocol === "rdp") {
      const closePolicy = settings.rdpSessionClosePolicy || "ask";

      if (closePolicy === "ask") {
        // Single confirmation — OK closes tab (session stays running), Cancel aborts.
        const confirmed = await showConfirm(
          "Close this RDP tab? The session will keep running in the background — you can reattach later from the RDP Sessions panel.",
        );
        if (!confirmed) return;
        // Tab closes, RDPClient unmount calls detach_rdp_session, backend stays alive
      } else if (closePolicy === "disconnect") {
        // Fully disconnect — ask for confirmation if warnOnClose is on
        const shouldWarn = connection?.warnOnClose || settings.warnOnClose;
        if (shouldWarn) {
          const confirmed = await showConfirm(
            "Disconnect this RDP session? The remote session will be ended.",
          );
          if (!confirmed) return;
        }
        try {
          await invoke("disconnect_rdp", { connectionId: session.connectionId });
        } catch (error) {
          console.error("Failed to disconnect RDP session:", error);
        }
      }
      // 'detach' policy: silently close the tab; RDPClient unmount calls detach_rdp_session
    } else {
      // Non-RDP protocols: original warnOnClose flow
      const shouldWarn = connection?.warnOnClose || settings.warnOnClose;
      if (shouldWarn) {
        const confirmed = await showConfirm(t("dialogs.confirmClose"));
        if (!confirmed) return;
      }
    }

    if (connection) {
      try {
        // await scriptEngine.executeScriptsForTrigger("onDisconnect", {
        //   connection,
        //   session,
        // });
      } catch (error) {
        console.error("Script execution failed:", error);
      }
    }

    if (session.protocol === "ssh" && session.backendSessionId) {
      try {
        await invoke("disconnect_ssh", { sessionId: session.backendSessionId });
      } catch (error) {
        console.error("Failed to disconnect SSH session:", error);
      }
    }

    // Notify detached windows that this session has been closed from main window
    const isTauri = typeof window !== "undefined" && 
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (isTauri && session.layout?.isDetached) {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("main-session-closed", { sessionId });
      } catch (error) {
        console.error("Failed to emit main-session-closed event:", error);
      }
    }

    dispatch({ type: "REMOVE_SESSION", payload: sessionId });

    if (connection) {
      statusChecker.stopChecking(connection.id);
      settingsManager.logAction(
        "info",
        "Session closed",
        connection.id,
        `Session "${session.name}" closed`,
      );
    }

    if (activeSessionId === sessionId) {
      const remaining = state.sessions.filter((s) => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : undefined);
    }
  };

  const activeSession = state.sessions.find((s) => s.id === activeSessionId);

  /**
   * Restores a session from persisted data without creating a new one.
   * Used to restore sessions on page reload.
   * @param sessionData - Saved session data to restore.
   * @param connection - The connection definition.
   */
  const restoreSession = async (
    sessionData: {
      id: string;
      connectionId: string;
      name: string;
      protocol: string;
      hostname: string;
      status: string;
      backendSessionId?: string;
      shellId?: string;
      zoomLevel?: number;
      layout?: ConnectionSession["layout"];
      group?: string;
      startTime?: string;
      lastActivity?: string;
    },
    connection: Connection,
  ) => {
    const settings = settingsManager.getSettings();

    // Check if session already exists (avoid duplicates)
    const existingSession = state.sessions.find(
      (s) =>
        s.id === sessionData.id ||
        (s.connectionId === sessionData.connectionId &&
          s.protocol === sessionData.protocol &&
          s.status !== "disconnected" &&
          s.status !== "error"),
    );
    if (existingSession) {
      setActiveSessionId(existingSession.id);
      return;
    }

    // Restore the session with its original state
    const restoredSession: ConnectionSession = {
      id: sessionData.id,
      connectionId: sessionData.connectionId,
      name: sessionData.name || connection.name,
      status: "reconnecting", // Start as reconnecting since we need to re-establish
      startTime: sessionData.startTime
        ? new Date(sessionData.startTime)
        : new Date(),
      protocol: sessionData.protocol as Connection["protocol"],
      hostname: sessionData.hostname,
      reconnectAttempts: 0,
      maxReconnectAttempts: connection.retryAttempts || settings.retryAttempts,
      backendSessionId: sessionData.backendSessionId,
      shellId: sessionData.shellId,
      zoomLevel: sessionData.zoomLevel,
      layout: sessionData.layout,
      group: sessionData.group,
      lastActivity: sessionData.lastActivity
        ? new Date(sessionData.lastActivity)
        : undefined,
    };

    dispatch({ type: "ADD_SESSION", payload: restoredSession });
    setActiveSessionId(restoredSession.id);

    // For protocols that need backend reconnection, attempt to re-establish
    await connectSession(restoredSession, connection);
  };

  const confirmDialog = dialogState ? (
    <ConfirmDialog
      isOpen={true}
      message={dialogState.message}
      onConfirm={() => {
        dialogState.resolve(true);
        setDialogState(null);
      }}
      onCancel={
        dialogState.showCancel
          ? () => {
              dialogState.resolve(false);
              setDialogState(null);
            }
          : undefined
      }
    />
  ) : null;

  return {
    activeSessionId,
    setActiveSessionId,
    activeSession,
    handleConnect,
    handleReconnect,
    handleQuickConnect,
    handleSessionClose,
    restoreSession,
    confirmDialog,
  };
};
