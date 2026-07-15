import { useCallback, useEffect, useRef } from "react";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorEventReason,
  ConnectionBehaviorEventType,
} from "../../types/connection/behavior";
import type { CustomScript } from "../../types/settings/settings";
import {
  ConnectionBehaviorDispatcher,
  type ConnectionBehaviorDispatchResult,
} from "../../utils/behavior/dispatcher";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { generateId } from "../../utils/core/id";
import { isRealConnectionSession } from "../../utils/session/sessionClassification";

type ReconnectAction = Extract<
  ConnectionBehaviorActionV1,
  { type: "reconnect" }
>;

export interface SessionLifecycleNotification {
  title: string;
  body: string;
  silent: boolean;
  tag: string;
}

export interface SessionBehaviorSettingsRuntime {
  getSettings(): { notificationSound?: boolean };
  getCustomScripts(): CustomScript[];
  logAction(
    level: "debug" | "info" | "warn" | "error",
    action: string,
    connectionId?: string,
    details?: string,
    duration?: number,
    connectionName?: string,
  ): void;
}

export interface SessionBehaviorScriptRuntime {
  executeScript<T = unknown>(
    script: CustomScript,
    context: {
      connection?: Connection;
      session?: ConnectionSession;
      trigger: "manual";
    },
    signal?: AbortSignal,
  ): Promise<T>;
}

export interface SessionReconnectRequest {
  session: ConnectionSession;
  connection: Connection;
  action: ReconnectAction;
  parentEventId?: string;
}

export type SessionLifecycleNotificationKind =
  | "connect"
  | "reconnect"
  | "disconnect"
  | "error";

export interface UseSessionLifecycleEventsOptions {
  sessions: readonly ConnectionSession[];
  connections: readonly Connection[];
  activeSessionId?: string;
  settingsManager: SessionBehaviorSettingsRuntime;
  scriptEngine: SessionBehaviorScriptRuntime;
  showNotification(notification: SessionLifecycleNotification): void;
  requestReconnect(request: SessionReconnectRequest): Promise<boolean>;
  onTransition?(
    kind: SessionLifecycleNotificationKind,
    session: ConnectionSession,
  ): void;
  now?: () => number;
  createEventId?: () => string;
}

export interface SessionLifecycleEventMetadata {
  parentEventId?: string;
  reason?: ConnectionBehaviorEventReason;
  previousStatus?: string;
}

interface SessionRuntimeSnapshot {
  connection: Connection;
  session: ConnectionSession;
}

interface PendingEventMetadata extends SessionLifecycleEventMetadata {
  type: ConnectionBehaviorEventType;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

const createAbortError = (message = "Behavior action was cancelled.") => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const notificationKindForEvent = (
  type: ConnectionBehaviorEventType,
): SessionLifecycleNotificationKind | undefined => {
  if (type === "session.connected") return "connect";
  if (type === "session.reconnected") return "reconnect";
  if (type === "session.disconnected") return "disconnect";
  if (type === "session.connectFailed" || type === "session.reconnectFailed") {
    return "error";
  }
  return undefined;
};

export function classifySessionLifecycleTransition(
  previous: ConnectionSession | undefined,
  current: ConnectionSession,
  ending = false,
): ConnectionBehaviorEventType | undefined {
  if (previous?.status === current.status) return undefined;

  if (current.status === "reconnecting") {
    return "session.reconnectStarted";
  }
  if (current.status === "connected") {
    return previous?.status === "reconnecting" ||
      (current.reconnectAttempts ?? 0) > 0
      ? "session.reconnected"
      : "session.connected";
  }
  if (current.status === "error") {
    return previous?.status === "reconnecting" ||
      (current.reconnectAttempts ?? 0) > 0
      ? "session.reconnectFailed"
      : "session.connectFailed";
  }
  if (current.status === "disconnected" && !ending) {
    return "session.disconnected";
  }
  return undefined;
}

const eventMetadataKey = (
  sessionId: string,
  type: ConnectionBehaviorEventType,
) => `${sessionId}\u001f${type}`;

const executeWithTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) throw createAbortError();

  const controller = new AbortController();
  let rejectCancellation: ((reason: Error) => void) | undefined;
  const abort = () => {
    controller.abort();
    rejectCancellation?.(createAbortError());
  };
  signal.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const operationPromise = operation(controller.signal);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Custom script timed out after ${timeoutMs}ms.`));
      controller.abort();
    }, timeoutMs);
  });
  const cancellationPromise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });

  try {
    return await Promise.race([
      operationPromise,
      timeoutPromise,
      cancellationPromise,
    ]);
  } finally {
    rejectCancellation = undefined;
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    if (signal.aborted) controller.abort();
  }
};

/**
 * Bridges reducer-level session status edges to the versioned per-connection
 * behavior dispatcher. Explicit creation/removal events stay manager-owned so
 * they can be ordered around legacy scripts and confirmed transport cleanup.
 */
export const useSessionLifecycleEvents = (
  options: UseSessionLifecycleEventsOptions,
) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const statusRef = useRef(new Map<string, ConnectionSession>());
  const snapshotsRef = useRef(new Map<string, SessionRuntimeSnapshot>());
  const endingSessionsRef = useRef(new Set<string>());
  const pendingMetadataRef = useRef(new Map<string, PendingEventMetadata>());
  const directEventsRef = useRef(new Set<string>());
  const primedRef = useRef(false);

  const dispatcherRef = useRef<ConnectionBehaviorDispatcher | null>(null);
  if (!dispatcherRef.current) {
    const runtimeSnapshot = (
      sessionId: string | undefined,
    ): SessionRuntimeSnapshot => {
      const snapshot = sessionId
        ? snapshotsRef.current.get(sessionId)
        : undefined;
      if (!snapshot) {
        throw new Error("The behavior session is no longer available.");
      }
      return snapshot;
    };

    dispatcherRef.current = new ConnectionBehaviorDispatcher({
      handlers: {
        notify: (action, context) => {
          const inheritedSound =
            optionsRef.current.settingsManager.getSettings()
              .notificationSound === true;
          optionsRef.current.showNotification({
            title: sanitizeBehaviorText(
              action.title ||
                (action.level === "error"
                  ? "Session automation error"
                  : action.level === "warning"
                    ? "Session automation warning"
                    : "Session automation"),
            ),
            body: sanitizeBehaviorText(action.message || context.ruleName),
            silent:
              action.sound === "off"
                ? true
                : action.sound === "on"
                  ? false
                  : !inheritedSound,
            tag: `sortofremoteng:behavior:${context.event.eventId}:${context.ruleId}:${context.actionIndex}`,
          });
        },
        reconnect: async (action, context) => {
          const sessionId = context.event.session?.id;
          const snapshot = runtimeSnapshot(sessionId);
          if (endingSessionsRef.current.has(snapshot.session.id)) {
            throw new Error("A closing session cannot be reconnected.");
          }

          const key = eventMetadataKey(
            snapshot.session.id,
            "session.reconnectStarted",
          );
          pendingMetadataRef.current.set(key, {
            type: "session.reconnectStarted",
            parentEventId: context.event.eventId,
            reason: "user",
          });
          const accepted = await optionsRef.current.requestReconnect({
            ...snapshot,
            action,
            parentEventId: context.event.eventId,
          });
          if (!accepted) {
            pendingMetadataRef.current.delete(key);
            throw new Error("The reconnect request was not accepted.");
          }
        },
        runCustomScript: async (action, context) => {
          const snapshot = runtimeSnapshot(context.event.session?.id);
          const script = optionsRef.current.settingsManager
            .getCustomScripts()
            .find((candidate) => candidate.id === action.scriptId);
          if (!script) {
            throw new Error(`Saved script "${action.scriptId}" was not found.`);
          }
          if (!script.enabled) {
            throw new Error(`Saved script "${script.name}" is disabled.`);
          }
          if (
            script.protocol &&
            script.protocol !== snapshot.connection.protocol
          ) {
            throw new Error(
              `Saved script "${script.name}" does not apply to ${snapshot.connection.protocol}.`,
            );
          }

          await executeWithTimeout(
            (signal) =>
              optionsRef.current.scriptEngine.executeScript(
                script,
                {
                  connection: snapshot.connection,
                  session: snapshot.session,
                  trigger: "manual",
                },
                signal,
              ),
            action.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
            context.signal,
          );
        },
        writeLog: (action, context) => {
          optionsRef.current.settingsManager.logAction(
            action.level ?? "info",
            "Connection behavior",
            context.event.connection.id,
            sanitizeBehaviorText(
              action.message ||
                `Rule "${context.ruleName}" handled ${context.event.type}.`,
            ),
            undefined,
            context.event.connection.name,
          );
        },
      },
      onActionError: (error, context) => {
        optionsRef.current.settingsManager.logAction(
          "error",
          "Connection behavior action failed",
          context.connection.id,
          sanitizeBehaviorText(
            `Rule "${error.ruleId}" action ${error.actionIndex + 1} (${error.actionType}): ${error.message}`,
          ),
          undefined,
          context.connection.name,
        );
      },
    });
  }

  const emit = useCallback(
    async (
      type: ConnectionBehaviorEventType,
      session: ConnectionSession,
      connection: Connection,
      metadata: SessionLifecycleEventMetadata = {},
    ): Promise<ConnectionBehaviorDispatchResult> => {
      snapshotsRef.current.set(session.id, { connection, session });
      const runtime = optionsRef.current;
      const eventId = runtime.createEventId?.() ?? generateId();
      if (type === "session.reconnectStarted") {
        for (const outcomeType of [
          "session.reconnected",
          "session.reconnectFailed",
        ] as const) {
          pendingMetadataRef.current.set(
            eventMetadataKey(session.id, outcomeType),
            {
              type: outcomeType,
              parentEventId: eventId,
              reason: metadata.reason,
            },
          );
        }
      }
      const kind = notificationKindForEvent(type);
      if (kind) runtime.onTransition?.(kind, session);

      return dispatcherRef.current!.dispatch(connection.behaviorAutomation, {
        eventId,
        parentEventId: metadata.parentEventId,
        type,
        timestamp: runtime.now?.() ?? Date.now(),
        source: "session-manager",
        reason: metadata.reason,
        previousStatus: metadata.previousStatus,
        connection: {
          id: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
          port: connection.port,
        },
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
        },
        window: {
          id: session.layout?.windowId ?? "main",
          kind: session.layout?.isDetached ? "detached" : "main",
          activeSessionId: runtime.activeSessionId,
        },
        error: session.errorMessage
          ? { message: sanitizeBehaviorText(session.errorMessage) }
          : undefined,
      });
    },
    [],
  );

  const emitStarted = useCallback(
    async (
      session: ConnectionSession,
      connection: Connection,
      metadata: SessionLifecycleEventMetadata = { reason: "user" },
    ) => {
      const key = eventMetadataKey(session.id, "session.started");
      if (directEventsRef.current.has(key)) return undefined;
      directEventsRef.current.add(key);
      statusRef.current.set(session.id, session);
      snapshotsRef.current.set(session.id, { connection, session });
      return emit("session.started", session, connection, metadata);
    },
    [emit],
  );

  const emitInitialStatus = useCallback(
    async (
      session: ConnectionSession,
      connection: Connection,
      metadata: SessionLifecycleEventMetadata = {},
    ) => {
      const type = classifySessionLifecycleTransition(undefined, session);
      if (!type) return undefined;
      const key = `initial\u001f${eventMetadataKey(session.id, type)}`;
      if (directEventsRef.current.has(key)) return undefined;
      directEventsRef.current.add(key);
      return emit(type, session, connection, metadata);
    },
    [emit],
  );

  const beginEnding = useCallback((sessionId: string) => {
    endingSessionsRef.current.add(sessionId);
    dispatcherRef.current!.cancelSession(sessionId, false);
  }, []);

  const prepareEvent = useCallback(
    (
      sessionId: string,
      type: ConnectionBehaviorEventType,
      metadata: SessionLifecycleEventMetadata,
    ) => {
      pendingMetadataRef.current.set(eventMetadataKey(sessionId, type), {
        type,
        ...metadata,
      });
    },
    [],
  );

  const emitEnded = useCallback(
    async (
      session: ConnectionSession,
      connection: Connection,
      metadata: SessionLifecycleEventMetadata = { reason: "user" },
    ) => {
      const key = eventMetadataKey(session.id, "session.ended");
      if (directEventsRef.current.has(key)) return undefined;
      directEventsRef.current.add(key);
      try {
        return await emit("session.ended", session, connection, metadata);
      } finally {
        endingSessionsRef.current.delete(session.id);
        statusRef.current.delete(session.id);
        snapshotsRef.current.delete(session.id);
        dispatcherRef.current!.cancelSession(session.id, true);
      }
    },
    [emit],
  );

  useEffect(() => {
    const currentIds = new Set<string>();
    const connectionById = new Map(
      options.connections.map((connection) => [connection.id, connection]),
    );

    if (!primedRef.current) {
      for (const session of options.sessions) {
        if (!isRealConnectionSession(session)) continue;
        const connection = connectionById.get(session.connectionId);
        currentIds.add(session.id);
        statusRef.current.set(session.id, session);
        if (connection) {
          snapshotsRef.current.set(session.id, { connection, session });
        }
      }
      primedRef.current = true;
      return;
    }

    for (const session of options.sessions) {
      if (!isRealConnectionSession(session)) continue;
      const connection = connectionById.get(session.connectionId);
      currentIds.add(session.id);
      const previous = statusRef.current.get(session.id);
      const type = classifySessionLifecycleTransition(
        previous,
        session,
        endingSessionsRef.current.has(session.id),
      );
      statusRef.current.set(session.id, session);
      if (connection) {
        snapshotsRef.current.set(session.id, { connection, session });
      }
      if (!type) continue;

      const key = eventMetadataKey(session.id, type);
      const pending = pendingMetadataRef.current.get(key);
      pendingMetadataRef.current.delete(key);
      const metadata: SessionLifecycleEventMetadata = {
        parentEventId: pending?.parentEventId,
        reason:
          pending?.reason ??
          (type === "session.disconnected"
            ? "remote"
            : type.endsWith("Failed")
              ? "error"
              : undefined),
        previousStatus: previous?.status,
      };
      if (!connection) {
        const kind = notificationKindForEvent(type);
        if (kind) optionsRef.current.onTransition?.(kind, session);
        continue;
      }
      void emit(type, session, connection, metadata).catch((error) => {
        optionsRef.current.settingsManager.logAction(
          "error",
          "Connection behavior dispatch failed",
          connection.id,
          sanitizeBehaviorText(
            error instanceof Error ? error.message : "Unknown dispatch error",
          ),
          undefined,
          connection.name,
        );
      });
    }

    for (const sessionId of [...statusRef.current.keys()]) {
      if (currentIds.has(sessionId)) continue;
      statusRef.current.delete(sessionId);
      snapshotsRef.current.delete(sessionId);
    }
  }, [emit, options.connections, options.sessions]);

  useEffect(
    () => () => {
      dispatcherRef.current?.cancelAll();
    },
    [],
  );

  return {
    emitStarted,
    emitInitialStatus,
    prepareEvent,
    beginEnding,
    emitEnded,
  };
};
