import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../contexts/useConnections";
import { Connection, ConnectionSession } from "../types/connection";
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

    if (connection.protocol === "ssh") {
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
  const handleQuickConnect = (hostname: string, protocol: string) => {
    const tempConnection: Connection = {
      id: generateId(),
      name: `${t("connections.quickConnect")} - ${hostname}`,
      protocol: protocol as Connection["protocol"],
      hostname,
      port: getDefaultPort(protocol),
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    handleConnect(tempConnection);
  };

  /**
   * Closes an active session and performs cleanup.
   * @param sessionId - ID of the session to close.
   */
  const handleSessionClose = async (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const connection = state.connections.find(
      (c) => c.id === session.connectionId,
    );
    const settings = settingsManager.getSettings();

    const shouldWarn = connection?.warnOnClose || settings.warnOnClose;
    if (shouldWarn) {
      const confirmed = await showConfirm(t("dialogs.confirmClose"));
      if (!confirmed) {
        return;
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
    confirmDialog,
  };
};
