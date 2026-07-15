import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import {
  Connection,
  ConnectionSession,
  isIntegrationConnectionProtocol,
} from "../../types/connection/connection";
import { isToolProtocol } from "../../components/app/toolSession";
import { isWinmgmtProtocol } from "../../components/windows/WindowsToolPanel.helpers";
import { isRealConnectionSession } from "../../utils/session/sessionClassification";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { StatusChecker } from "../../utils/connection/statusChecker";
import { ScriptEngine } from "../../utils/recording/scriptEngine";
import { getDefaultPort } from "../../utils/discovery/defaultPorts";
import { raceWithTimeout } from "../../utils/core/raceWithTimeout";
import { generateId } from "../../utils/core/id";
import { ConfirmDialog } from "../../components/ui/dialogs/ConfirmDialog";
import { recordRdpSessionHistory } from "../../utils/rdp/rdpSessionHistory";
import {
  resolveConnectionRetryAttempts,
  resolveConnectionRetryDelay,
  resolveConnectionWarnOnClose,
} from "../../utils/behavior/legacyBehavior";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { BehaviorWindowActionRuntime } from "../../utils/behavior/windowActions";
import {
  useSessionLifecycleEvents,
  type SessionLifecycleNotification,
  type SessionReconnectRequest,
} from "./useSessionLifecycleEvents";

const CLIENT_OWNED_CONNECT_PROTOCOLS = new Set<string>([
  "ssh",
  "rdp",
  "http",
  "https",
  "anydesk",
]);

const UNSUPPORTED_DIRECT_SESSION_PROTOCOLS = new Set<string>(["ftp", "scp"]);

export function usesGenericSessionTimer(protocol: string): boolean {
  return (
    !CLIENT_OWNED_CONNECT_PROTOCOLS.has(protocol) &&
    !isIntegrationConnectionProtocol(protocol)
  );
}

export function getUnsupportedDirectSessionMessage(
  protocol: string,
): string | null {
  const normalized = protocol.toLowerCase();
  if (!UNSUPPORTED_DIRECT_SESSION_PROTOCOLS.has(normalized)) return null;
  return `${normalized.toUpperCase()} sessions are not wired to a frontend runtime yet. Use SFTP for file-transfer sessions until the ${normalized.toUpperCase()} client is implemented.`;
}

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
  const scriptEngine = ScriptEngine.getInstance();

  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  // Keep a ref to the latest state so timer callbacks can read current sessions
  const stateRef = useRef(state);
  stateRef.current = state;
  // Store active timeout IDs so they can be cleared on unmount
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingReconnectsRef = useRef(new Set<string>());
  const reconnectsInFlightRef = useRef(new Set<string>());
  const permissionRequestRef = useRef<Promise<NotificationPermission> | null>(
    null,
  );
  const handleSessionCloseRef = useRef<(sessionId: string) => Promise<boolean>>(
    async () => false,
  );
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

  const showNotification = useCallback(
    (notification: SessionLifecycleNotification) => {
      if (typeof window === "undefined") return;
      const NotificationCtor = window.Notification;
      if (!NotificationCtor) return;

      const notify = () => {
        try {
          new NotificationCtor(notification.title, {
            body: notification.body,
            silent: notification.silent,
            tag: notification.tag,
          });
        } catch {
          // Notification support varies by shell/webview. This setting must not
          // interfere with the connection lifecycle when the platform rejects it.
        }
      };

      if (NotificationCtor.permission === "granted") {
        notify();
        return;
      }

      if (NotificationCtor.permission !== "default") return;

      permissionRequestRef.current ??= NotificationCtor.requestPermission();
      permissionRequestRef.current
        .then((permission) => {
          if (permission === "granted") notify();
        })
        .finally(() => {
          permissionRequestRef.current = null;
        });
    },
    [],
  );

  const sendSessionNotification = useCallback(
    (
      kind: "connect" | "reconnect" | "disconnect" | "error",
      session: ConnectionSession,
    ) => {
      const settings = settingsManager.getSettings();
      const enabled =
        (kind === "connect" && settings.notifyOnConnect) ||
        (kind === "reconnect" && settings.notifyOnReconnect) ||
        (kind === "disconnect" && settings.notifyOnDisconnect) ||
        (kind === "error" && settings.notifyOnError);
      if (!enabled) return;

      const title =
        kind === "connect"
          ? "Session connected"
          : kind === "reconnect"
            ? "Session reconnected"
            : kind === "disconnect"
              ? "Session disconnected"
              : "Session error";
      const body =
        kind === "error"
          ? `${session.name}: ${sanitizeBehaviorText(
              session.errorMessage || "Connection failed",
            )}`
          : `${session.name} (${session.protocol.toUpperCase()} ${session.hostname})`;
      showNotification({
        title,
        body,
        silent: !settings.notificationSound,
        tag: `sortofremoteng:${kind}:${session.id}`,
      });
    },
    [settingsManager, showNotification],
  );

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
      await scriptEngine.executeScriptsForTrigger("onConnect", {
        connection,
        session,
      });
    } catch (error) {
      console.error("Script execution failed:", error);
    }

    if (connection.statusCheck?.enabled) {
      statusChecker.startChecking(connection);
    }

    if (!usesGenericSessionTimer(connection.protocol)) {
      return;
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

        // Read the CURRENT session from state to avoid overwriting
        // fields set by protocol hooks (e.g. backendSessionId).
        const currentSession = stateRef.current.sessions.find(
          (s) => s.id === session.id,
        );
        if (currentSession) {
          dispatch({
            type: "UPDATE_SESSION",
            payload: {
              ...currentSession,
              status: "connected",
              metrics: {
                connectionTime,
                dataTransferred: 0,
                latency: Math.random() * 50 + 10,
                throughput: Math.random() * 1000 + 500,
              },
            },
          });
        }

        dispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...connection,
            lastConnected: new Date().toISOString(),
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
      const safeError = sanitizeBehaviorText(
        error instanceof Error ? error.message : "Unknown error",
      );
      const cur = stateRef.current.sessions.find((s) => s.id === session.id);
      if (cur) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...cur, status: "error", errorMessage: safeError },
        });
      }

      settingsManager.logAction(
        "error",
        "Connection failed",
        connection.id,
        safeError,
      );

      await requestReconnect({
        session: cur
          ? { ...cur, status: "error", errorMessage: safeError }
          : session,
        connection,
        action: {
          type: "reconnect",
          delayMs: resolveConnectionRetryDelay(
            connection.retryDelay,
            settings.retryDelay,
          ),
          maxAttempts: session.maxReconnectAttempts,
          backoff: "fixed",
        },
        reason: "error",
      });
    }
  };

  /**
   * Creates a new session for a given connection and begins establishing it.
   * @param connection - Connection definition to open.
   */
  const handleConnect = async (connection: Connection) => {
    const settings = settingsManager.getSettings();
    const unsupportedMessage = getUnsupportedDirectSessionMessage(
      connection.protocol,
    );

    // Check for existing session for protocols that should reuse connections
    const reuseSessionProtocols = ["ssh", "http", "https"];
    const shouldReuseSession =
      reuseSessionProtocols.includes(connection.protocol) ||
      isIntegrationConnectionProtocol(connection.protocol);
    if (shouldReuseSession) {
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

    // singleConnectionMode and maxConcurrentConnections both speak
    // about *connections*. Tool tabs and Windows management panels
    // share the session list for storage/UX reasons, but they are
    // not connections — counting them against these limits would
    // be misleading (and lock the user out of opening a session
    // because they have a Settings tab open).
    const realSessions = state.sessions.filter(isRealConnectionSession);

    if (settings.singleConnectionMode && realSessions.length > 0) {
      const proceed = await showConfirm(
        "Close existing connection and open new one?",
      );
      if (!proceed) {
        return;
      }
      // Only close real connections; leave tool tabs in place so
      // the user doesn't lose unsaved tool state when "switching".
      realSessions.forEach((session) => {
        dispatch({ type: "REMOVE_SESSION", payload: session.id });
      });
    }

    if (realSessions.length >= settings.maxConcurrentConnections) {
      await showAlert(
        `Maximum concurrent connections (${settings.maxConcurrentConnections}) reached.`,
      );
      return;
    }

    const isIntegrationSession = isIntegrationConnectionProtocol(
      connection.protocol,
    );
    const session: ConnectionSession = {
      id: generateId(),
      connectionId: connection.id,
      name:
        settings.hostnameOverride && connection.hostname
          ? connection.hostname
          : connection.name,
      status: isIntegrationSession ? "connected" : "connecting",
      startTime: new Date(),
      protocol: connection.protocol,
      hostname: connection.integration?.host || connection.hostname,
      backendSessionId: isIntegrationSession
        ? connection.integration?.instanceId
        : undefined,
      integration: isIntegrationSession ? connection.integration : undefined,
      reconnectAttempts: 0,
      maxReconnectAttempts: resolveConnectionRetryAttempts(
        connection.retryAttempts,
        settings.retryAttempts,
      ),
      ...(unsupportedMessage
        ? { status: "error" as const, errorMessage: unsupportedMessage }
        : {}),
    };

    dispatch({ type: "ADD_SESSION", payload: session });
    await lifecycle.emitStarted(session, connection, { reason: "user" });

    // Per-connection focusOnConnect overrides the global setting
    const shouldFocus =
      connection.focusOnConnect ?? !settings.openConnectionInBackground;
    if (shouldFocus) {
      setActiveSessionId(session.id);
    }

    if (unsupportedMessage) {
      settingsManager.logAction(
        "error",
        "Connection unavailable",
        connection.id,
        unsupportedMessage,
      );
      await lifecycle.emitInitialStatus(session, connection, {
        reason: "error",
      });
      return;
    }

    await connectSession(session, connection);
    await lifecycle.emitInitialStatus(session, connection);
  };

  const reconnectSession = async (
    session: ConnectionSession,
    connection: Connection,
  ) => {
    const updatedSession: ConnectionSession = {
      ...session,
      status: "reconnecting",
      reconnectAttempts: (session.reconnectAttempts ?? 0) + 1,
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

  type ManagedReconnectRequest = SessionReconnectRequest & {
    ignoreAttemptLimit?: boolean;
    reason?: "user" | "error" | "network" | "restore";
  };

  const requestReconnect = async (
    request: ManagedReconnectRequest,
  ): Promise<boolean> => {
    const latest =
      stateRef.current.sessions.find(
        (candidate) => candidate.id === request.session.id,
      ) ?? request.session;
    const attempts = latest.reconnectAttempts ?? 0;
    const maxAttempts =
      request.action.maxAttempts ?? latest.maxReconnectAttempts ?? 0;
    if (!request.ignoreAttemptLimit && attempts >= maxAttempts) return false;
    if (
      pendingReconnectsRef.current.has(latest.id) ||
      (reconnectsInFlightRef.current.has(latest.id) &&
        request.reason !== "error")
    ) {
      return false;
    }

    const baseDelay = request.action.delayMs ?? 0;
    const delay = Math.min(
      request.action.backoff === "exponential"
        ? baseDelay * 2 ** attempts
        : baseDelay,
      2_147_483_647,
    );
    lifecycle.prepareEvent(latest.id, "session.reconnectStarted", {
      parentEventId: request.parentEventId,
      reason: request.reason ?? "user",
    });
    pendingReconnectsRef.current.add(latest.id);
    startTimer(() => {
      pendingReconnectsRef.current.delete(latest.id);
      const current = stateRef.current.sessions.find(
        (candidate) => candidate.id === latest.id,
      );
      if (!current) {
        return;
      }
      const currentAttempts = current.reconnectAttempts ?? 0;
      if (!request.ignoreAttemptLimit && currentAttempts >= maxAttempts) {
        return;
      }
      const currentConnection =
        stateRef.current.connections.find(
          (candidate) => candidate.id === current.connectionId,
        ) ?? request.connection;
      reconnectsInFlightRef.current.add(latest.id);
      void reconnectSession(current, currentConnection).finally(() => {
        reconnectsInFlightRef.current.delete(latest.id);
      });
    }, delay);
    return true;
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

    await requestReconnect({
      session,
      connection,
      action: { type: "reconnect", delayMs: 2000, backoff: "fixed" },
      ignoreAttemptLimit: true,
      reason: "user",
    });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
  const handleSessionClose = async (sessionId: string): Promise<boolean> => {
    const currentState = stateRef.current;
    const session = currentState.sessions.find((s) => s.id === sessionId);
    if (!session) return false;

    // Tool/winmgmt tabs just get removed — no connection lifecycle.
    if (
      isToolProtocol(session.protocol) ||
      isWinmgmtProtocol(session.protocol)
    ) {
      dispatch({ type: "REMOVE_SESSION", payload: sessionId });
      return true;
    }

    const connection = currentState.connections.find(
      (c) => c.id === session.connectionId,
    );
    const settings = settingsManager.getSettings();

    // Integration tabs have no transport cleanup or legacy disconnect script,
    // but still own a real per-connection lifecycle.
    if (isIntegrationConnectionProtocol(session.protocol)) {
      lifecycle.beginEnding(sessionId);
      dispatch({ type: "REMOVE_SESSION", payload: sessionId });
      if (connection) {
        statusChecker.stopChecking(connection.id);
        settingsManager.logAction(
          "info",
          "Session closed",
          connection.id,
          `Session "${session.name}" closed`,
        );
        await lifecycle.emitEnded(session, connection, { reason: "user" });
      }
      if (activeSessionId === sessionId) {
        const remaining = currentState.sessions.filter(
          (s) => s.id !== sessionId,
        );
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : undefined);
      }
      return true;
    }

    // Global "confirm before closing an active tab" check —
    // applies to any connected session regardless of protocol.
    if (
      settings.confirmCloseActiveTab &&
      session.id === activeSessionId &&
      session.status === "connected"
    ) {
      const confirmed = await showConfirm(
        `Close the active session "${session.name}"?`,
      );
      if (!confirmed) return false;
    }

    // RDP sessions use their own close policy instead of the generic warnOnClose.
    // Per-connection override takes precedence over the global setting.
    if (session.protocol === "rdp") {
      const perConn = connection?.rdpSettings?.advanced?.sessionClosePolicy;
      const closePolicy =
        perConn && perConn !== "global"
          ? perConn
          : settings.rdpSessionClosePolicy || "detach";

      if (closePolicy === "ask") {
        // Single confirmation — OK closes tab (session stays running), Cancel aborts.
        const confirmed = await showConfirm(
          "Close this RDP tab? The session will keep running in the background — you can reattach later from the RDP Sessions panel.",
        );
        if (!confirmed) return false;
        // Tab closes, RDPClient unmount calls detach_rdp_session, backend stays alive
      } else if (closePolicy === "disconnect") {
        // Fully disconnect — ask for confirmation if warnOnClose is on
        const shouldWarn = resolveConnectionWarnOnClose(
          connection?.warnOnClose,
          settings.warnOnClose,
        );
        if (shouldWarn) {
          const confirmed = await showConfirm(
            "Disconnect this RDP session? The remote session will be ended.",
          );
          if (!confirmed) return false;
        }
        try {
          await invoke("disconnect_rdp", {
            connectionId: session.connectionId,
          });
        } catch (error) {
          console.error("Failed to disconnect RDP session:", error);
        }
      }
      // 'detach' policy: silently close the tab; RDPClient unmount calls detach_rdp_session
    } else {
      // Non-RDP protocols: original warnOnClose flow
      const shouldWarn = resolveConnectionWarnOnClose(
        connection?.warnOnClose,
        settings.warnOnClose,
      );
      if (shouldWarn) {
        const confirmed = await showConfirm(t("dialogs.confirmClose"));
        if (!confirmed) return false;
      }
    }

    // From this point onward every user-facing close policy has been accepted.
    // Cancelling in-flight rules here cannot bypass a confirmation dialog.
    lifecycle.beginEnding(sessionId);

    if (connection) {
      try {
        await scriptEngine.executeScriptsForTrigger("onDisconnect", {
          connection,
          session,
        });
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
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (isTauri && session.layout?.isDetached) {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("main-session-closed", { sessionId });
      } catch (error) {
        console.error("Failed to emit main-session-closed event:", error);
      }
    }

    // Record RDP session to history before removing
    if (session.protocol === "rdp") {
      const now = new Date();
      const durationSecs = session.startTime
        ? Math.round(
            (now.getTime() - new Date(session.startTime).getTime()) / 1000,
          )
        : 0;
      recordRdpSessionHistory({
        connectionId: session.connectionId || "",
        connectionName: session.name || connection?.name || session.hostname,
        hostname: session.hostname,
        port: connection?.port || 3389,
        username: connection?.username || "",
        lastConnected: session.startTime
          ? new Date(session.startTime).toISOString()
          : now.toISOString(),
        disconnectedAt: now.toISOString(),
        duration: durationSecs,
        desktopWidth: 0,
        desktopHeight: 0,
      });
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
      const remaining = currentState.sessions.filter((s) => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : undefined);
    }

    if (connection) {
      await lifecycle.emitEnded(session, connection, { reason: "user" });
    }
    return true;
  };

  handleSessionCloseRef.current = handleSessionClose;

  const behaviorWindowActionsRef = useRef<BehaviorWindowActionRuntime | null>(
    null,
  );
  if (!behaviorWindowActionsRef.current) {
    behaviorWindowActionsRef.current = new BehaviorWindowActionRuntime({
      getWindow: async (windowId) => {
        const isTauri =
          typeof window !== "undefined" &&
          Boolean(
            (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
          );
        if (!isTauri) return undefined;
        const { getAllWindows } = await import("@tauri-apps/api/window");
        return (await getAllWindows()).find(
          (candidate) => candidate.label === windowId,
        );
      },
      activateSession: async (windowId, sessionId) => {
        const session = stateRef.current.sessions.find(
          (candidate) => candidate.id === sessionId,
        );
        if (!session) return false;
        const owner =
          session.layout?.isDetached && session.layout.windowId
            ? session.layout.windowId
            : "main";
        if (owner !== windowId) return false;
        if (windowId === "main") {
          setActiveSessionId(sessionId);
          return true;
        }
        const { emitTo } = await import("@tauri-apps/api/event");
        const { BEHAVIOR_ACTIVATE_SESSION_EVENT } =
          await import("../../utils/behavior/windowActions");
        await emitTo(windowId, BEHAVIOR_ACTIVATE_SESSION_EVENT, {
          windowId,
          sessionId,
        });
        return true;
      },
      closeSession: (sessionId) => handleSessionCloseRef.current(sessionId),
    });
  }

  const lifecycle = useSessionLifecycleEvents({
    sessions: state.sessions,
    connections: state.connections,
    activeSessionId,
    settingsManager,
    scriptEngine,
    showNotification,
    requestReconnect: (request) => requestReconnect(request),
    windowActions: behaviorWindowActionsRef.current,
    onTransition: sendSessionNotification,
  });

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
      maxReconnectAttempts: resolveConnectionRetryAttempts(
        connection.retryAttempts,
        settings.retryAttempts,
      ),
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

    await lifecycle.emitStarted(restoredSession, connection, {
      reason: "restore",
    });
    await lifecycle.emitInitialStatus(restoredSession, connection, {
      reason: "restore",
    });

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
    emitWindowSignal: lifecycle.emitWindowSignal,
    confirmDialog,
  };
};
