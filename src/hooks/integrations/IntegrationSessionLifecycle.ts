import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ConnectionSession } from "../../types/connection/connection";

export interface IntegrationSessionStateEvent {
  status: Extract<
    ConnectionSession["status"],
    "connecting" | "connected" | "disconnected" | "error" | "reconnecting"
  >;
  errorMessage?: string;
}

type AsyncOperation<T = void> = () => Promise<T>;

interface RegisteredConnection {
  connect?: AsyncOperation<unknown>;
  disconnect: AsyncOperation;
}

interface ConnectionPlan {
  connect: AsyncOperation<unknown>;
  disconnect: AsyncOperation;
}

interface IntegrationSessionLifecycleContextValue {
  reserveConnection(key: string, disconnect: AsyncOperation): Promise<void>;
  runConnect<T>(
    key: string,
    connect: AsyncOperation<T>,
    disconnect: AsyncOperation,
  ): Promise<T>;
  runDisconnect(key: string, fallback?: AsyncOperation): Promise<void>;
  releaseConnection(key: string, fallback?: AsyncOperation): Promise<void>;
  adoptConnection(
    key: string,
    disconnect: AsyncOperation,
    reconnect?: AsyncOperation<unknown>,
  ): void;
}

const IntegrationSessionLifecycleContext =
  createContext<IntegrationSessionLifecycleContextValue | null>(null);

const controllers = new Map<
  string,
  {
    reconnect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
    release: () => Promise<boolean>;
  }
>();

const PROCESS_GLOBAL_CONNECTION_KEYS = new Set([
  "exchange:global",
  "gdrive:global",
  "lxd:global",
  "vmware:global",
  "vmwareDesktop:global",
]);
const processGlobalConnectionOwners = new Map<string, string>();

const isProcessGlobalConnectionKey = (key: string): boolean =>
  PROCESS_GLOBAL_CONNECTION_KEYS.has(key);

const claimProcessGlobalConnection = (
  key: string,
  sessionId: string,
): boolean => {
  if (!isProcessGlobalConnectionKey(key)) return true;
  const owner = processGlobalConnectionOwners.get(key);
  if (owner && owner !== sessionId) return false;
  processGlobalConnectionOwners.set(key, sessionId);
  return true;
};

const releaseProcessGlobalConnection = (
  key: string,
  sessionId: string,
): void => {
  if (processGlobalConnectionOwners.get(key) === sessionId) {
    processGlobalConnectionOwners.delete(key);
  }
};

const processGlobalConflictError = (key: string): Error =>
  new Error(
    `${key.replace(":global", "")} is already owned by another active integration session. Disconnect or close that session before connecting this one.`,
  );

const processGlobalAdoptionError = (key: string): Error =>
  new Error(
    `${key.replace(":global", "")} is process-global and cannot be adopted by a cold integration session. Reconnect it from the session that owns its configuration.`,
  );

const errorMessage = (error: unknown): string =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * Ask a mounted integration panel to repeat the exact successful connection
 * operation it registered. Returns false when the panel has never established
 * a live backend connection (for example after a cold restore).
 */
export async function reconnectIntegrationSession(
  sessionId: string,
): Promise<boolean> {
  return (await controllers.get(sessionId)?.reconnect()) ?? false;
}

/** Disconnect every provider connection currently owned by a session panel. */
export async function disconnectIntegrationSession(
  sessionId: string,
): Promise<boolean> {
  return (await controllers.get(sessionId)?.disconnect()) ?? false;
}

/** Permanently release a session's live handles and reconnect recipes. */
export async function releaseIntegrationSession(
  sessionId: string,
): Promise<boolean> {
  return (await controllers.get(sessionId)?.release()) ?? false;
}

interface IntegrationSessionLifecycleProviderProps {
  sessionId: string;
  onStateChange?: (event: IntegrationSessionStateEvent) => void;
  children: React.ReactNode;
}

/**
 * Owns the live provider handles created beneath one integration session.
 * Cleanup is keyed, serialized, and idempotent so explicit Disconnect, tab
 * close, sub-tab unmount, and a concurrent session-close request cannot invoke
 * the same backend teardown twice.
 */
export const IntegrationSessionLifecycleProvider: React.FC<
  IntegrationSessionLifecycleProviderProps
> = ({ sessionId, onStateChange, children }) => {
  const connectionsRef = useRef(new Map<string, RegisteredConnection>());
  const reservedKeysRef = useRef(new Set<string>());
  const plansRef = useRef(new Map<string, ConnectionPlan>());
  const queuesRef = useRef(new Map<string, Promise<void>>());
  const versionsRef = useRef(new Map<string, number>());
  const closedRef = useRef(false);
  const stateChangeRef = useRef(onStateChange);

  useEffect(() => {
    stateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const emit = useCallback((event: IntegrationSessionStateEvent) => {
    if (!closedRef.current) stateChangeRef.current?.(event);
  }, []);

  const nextVersion = useCallback((key: string): number => {
    const version = (versionsRef.current.get(key) ?? 0) + 1;
    versionsRef.current.set(key, version);
    return version;
  }, []);

  const enqueue = useCallback(
    <T>(key: string, operation: () => Promise<T>): Promise<T> => {
      const previous = queuesRef.current.get(key) ?? Promise.resolve();
      const task = previous.catch(() => undefined).then(operation);
      const tail = task.then(
        () => undefined,
        () => undefined,
      );
      queuesRef.current.set(key, tail);
      void tail.then(() => {
        if (queuesRef.current.get(key) === tail) {
          queuesRef.current.delete(key);
        }
      });
      return task;
    },
    [],
  );

  const disconnectCurrent = useCallback(
    async (
      key: string,
      fallback?: AsyncOperation,
      emitDisconnected = true,
    ): Promise<boolean> => {
      const registered = connectionsRef.current.get(key);
      const wasReserved = reservedKeysRef.current.delete(key);
      const operation = registered?.disconnect ?? fallback;
      if (!operation) {
        if (emitDisconnected && connectionsRef.current.size === 0) {
          emit({ status: "disconnected" });
        }
        return false;
      }

      connectionsRef.current.delete(key);
      try {
        await operation();
      } catch (error) {
        if (registered && !connectionsRef.current.has(key)) {
          // A failed close may have left the provider handle alive. Keep it
          // registered so a later close/reconnect retries teardown instead of
          // creating an untracked duplicate.
          connectionsRef.current.set(key, registered);
          if (wasReserved) reservedKeysRef.current.add(key);
        }
        emit({ status: "error", errorMessage: errorMessage(error) });
        throw error;
      }
      releaseProcessGlobalConnection(key, sessionId);

      if (emitDisconnected && connectionsRef.current.size === 0) {
        emit({ status: "disconnected" });
      }
      return true;
    },
    [emit, sessionId],
  );

  const runConnect = useCallback(
    async <T>(
      key: string,
      connect: AsyncOperation<T>,
      disconnect: AsyncOperation,
    ): Promise<T> => {
      const version = nextVersion(key);
      const plan: ConnectionPlan = {
        connect: connect as AsyncOperation<unknown>,
        disconnect,
      };
      plansRef.current.set(key, plan);
      emit({ status: "connecting" });
      return enqueue(key, async () => {
        // A reserved OAuth/configuration phase already owns the global key and
        // is promoted in place. A normal second Connect remains a replacement
        // and tears down the prior live handle first.
        const promotingReservation = reservedKeysRef.current.delete(key);
        if (promotingReservation) {
          connectionsRef.current.delete(key);
        } else {
          await disconnectCurrent(key, undefined, false);
        }
        if (!claimProcessGlobalConnection(key, sessionId)) {
          const error = processGlobalConflictError(key);
          emit({ status: "error", errorMessage: error.message });
          throw error;
        }

        let result: T;
        try {
          result = await connect();
        } catch (error) {
          if (isProcessGlobalConnectionKey(key)) {
            try {
              await disconnect();
              releaseProcessGlobalConnection(key, sessionId);
            } catch (cleanupError) {
              // A failed global connect may still have created native state.
              // Keep ownership and the exact teardown recipe fail-closed.
              connectionsRef.current.set(key, plan);
              emit({
                status: "error",
                errorMessage: `${errorMessage(error)} Cleanup also failed: ${errorMessage(cleanupError)}`,
              });
              throw cleanupError;
            }
          }
          if (!closedRef.current && versionsRef.current.get(key) === version) {
            emit({ status: "error", errorMessage: errorMessage(error) });
          }
          throw error;
        }

        if (closedRef.current || versionsRef.current.get(key) !== version) {
          try {
            await disconnect();
            releaseProcessGlobalConnection(key, sessionId);
          } catch (error) {
            if (!connectionsRef.current.has(key)) {
              connectionsRef.current.set(key, plan);
            }
            throw error;
          }
          return result;
        }

        connectionsRef.current.set(key, plan);
        emit({ status: "connected" });
        return result;
      });
    },
    [disconnectCurrent, emit, enqueue, nextVersion, sessionId],
  );

  const reserveConnection = useCallback(
    async (key: string, disconnect: AsyncOperation): Promise<void> => {
      const version = nextVersion(key);
      plansRef.current.delete(key);
      emit({ status: "connecting" });
      await enqueue(key, async () => {
        if (reservedKeysRef.current.has(key)) {
          connectionsRef.current.set(key, { disconnect });
          return;
        }

        await disconnectCurrent(key, undefined, false);
        if (!claimProcessGlobalConnection(key, sessionId)) {
          const error = processGlobalConflictError(key);
          emit({ status: "error", errorMessage: error.message });
          throw error;
        }
        if (closedRef.current || versionsRef.current.get(key) !== version) {
          releaseProcessGlobalConnection(key, sessionId);
          throw new Error(
            `${key} reservation was superseded before native state changed`,
          );
        }

        connectionsRef.current.set(key, { disconnect });
        reservedKeysRef.current.add(key);
      });
    },
    [disconnectCurrent, emit, enqueue, nextVersion, sessionId],
  );

  const runDisconnect = useCallback(
    async (key: string, fallback?: AsyncOperation): Promise<void> => {
      const hadOwnedOperation =
        connectionsRef.current.has(key) ||
        plansRef.current.has(key) ||
        queuesRef.current.has(key);
      nextVersion(key);
      await enqueue(key, () =>
        disconnectCurrent(key, hadOwnedOperation ? undefined : fallback, true),
      );
    },
    [disconnectCurrent, enqueue, nextVersion],
  );

  const releaseConnection = useCallback(
    async (key: string, fallback?: AsyncOperation): Promise<void> => {
      const hadOwnedOperation =
        connectionsRef.current.has(key) ||
        plansRef.current.has(key) ||
        queuesRef.current.has(key);
      nextVersion(key);
      await enqueue(key, async () => {
        await disconnectCurrent(
          key,
          hadOwnedOperation ? undefined : fallback,
          false,
        );
        // Do not discard the reconnect/cleanup recipe until teardown really
        // succeeded. A failed tab close must remain safely retryable.
        plansRef.current.delete(key);
      });
    },
    [disconnectCurrent, enqueue, nextVersion],
  );

  const adoptConnection = useCallback(
    (
      key: string,
      disconnect: AsyncOperation,
      reconnect?: AsyncOperation<unknown>,
    ) => {
      // There is no trustworthy native owner identity for singleton services.
      // Adopting one would let a cold panel tear down another session's handle,
      // and a failed teardown could leave an untracked global owner.
      if (isProcessGlobalConnectionKey(key)) {
        const error = processGlobalAdoptionError(key);
        emit({ status: "error", errorMessage: error.message });
        return;
      }
      const version = nextVersion(key);
      if (reconnect) {
        plansRef.current.set(key, { connect: reconnect, disconnect });
      } else {
        plansRef.current.delete(key);
      }

      void enqueue(key, async () => {
        let claimedGlobal = false;
        try {
          await disconnectCurrent(key, undefined, false);
          if (!claimProcessGlobalConnection(key, sessionId)) {
            throw processGlobalConflictError(key);
          }
          claimedGlobal = isProcessGlobalConnectionKey(key);
          if (closedRef.current || versionsRef.current.get(key) !== version) {
            await disconnect();
            releaseProcessGlobalConnection(key, sessionId);
            return;
          }
          connectionsRef.current.set(key, {
            connect: reconnect,
            disconnect,
          });
          emit({ status: "connected" });
        } catch (error) {
          if (claimedGlobal) {
            await disconnect()
              .then(() => releaseProcessGlobalConnection(key, sessionId))
              .catch(() => undefined);
          }
          emit({ status: "error", errorMessage: errorMessage(error) });
        }
      });
    },
    [disconnectCurrent, emit, enqueue, nextVersion, sessionId],
  );

  const disconnectAll = useCallback(async (): Promise<boolean> => {
    const keys = [
      ...new Set([
        ...connectionsRef.current.keys(),
        ...plansRef.current.keys(),
        ...queuesRef.current.keys(),
      ]),
    ];
    if (keys.length === 0) return false;
    const results = await Promise.allSettled(
      keys.map((key) => runDisconnect(key)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    // Every provider gets its teardown attempt, but the aggregate controller
    // must never report success when any live handle may remain.
    if (failure) throw failure.reason;
    return true;
  }, [runDisconnect]);

  const releaseAll = useCallback(async (): Promise<boolean> => {
    const keys = [
      ...new Set([
        ...connectionsRef.current.keys(),
        ...plansRef.current.keys(),
        ...queuesRef.current.keys(),
      ]),
    ];
    if (keys.length === 0) return false;
    const results = await Promise.allSettled(
      keys.map((key) => releaseConnection(key)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    return true;
  }, [releaseConnection]);

  const reconnectAll = useCallback(async (): Promise<boolean> => {
    const keys = [
      ...new Set([
        ...connectionsRef.current.keys(),
        ...plansRef.current.keys(),
        ...queuesRef.current.keys(),
      ]),
    ];
    if (keys.length === 0) return false;

    const reconnects = keys.map((key) => {
      const registered = connectionsRef.current.get(key);
      const planned = plansRef.current.get(key);
      return {
        key,
        connect: planned?.connect ?? registered?.connect,
        disconnect: planned?.disconnect ?? registered?.disconnect,
      };
    });

    emit({ status: "reconnecting" });
    const tasks = reconnects.map(({ key, connect, disconnect }) => {
      const version = nextVersion(key);
      if (connect && disconnect) {
        plansRef.current.set(key, { connect, disconnect });
      } else {
        plansRef.current.delete(key);
      }

      return enqueue(key, async (): Promise<boolean> => {
        await disconnectCurrent(key, undefined, false);
        if (!connect || !disconnect) return false;
        if (!claimProcessGlobalConnection(key, sessionId)) {
          throw processGlobalConflictError(key);
        }

        let result: unknown;
        try {
          result = await connect();
        } catch (error) {
          if (isProcessGlobalConnectionKey(key)) {
            try {
              await disconnect();
              releaseProcessGlobalConnection(key, sessionId);
            } catch (cleanupError) {
              connectionsRef.current.set(key, { connect, disconnect });
              emit({
                status: "error",
                errorMessage: `${errorMessage(error)} Cleanup also failed: ${errorMessage(cleanupError)}`,
              });
              throw cleanupError;
            }
          }
          if (!closedRef.current && versionsRef.current.get(key) === version) {
            emit({ status: "error", errorMessage: errorMessage(error) });
          }
          throw error;
        }

        if (closedRef.current || versionsRef.current.get(key) !== version) {
          await disconnect();
          releaseProcessGlobalConnection(key, sessionId);
          return false;
        }

        void result;
        connectionsRef.current.set(key, { connect, disconnect });
        return true;
      });
    });

    const results = await Promise.allSettled(tasks);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;

    const reconnected = results.some(
      (result) => result.status === "fulfilled" && result.value,
    );
    emit({ status: reconnected ? "connected" : "disconnected" });
    return reconnected;
  }, [disconnectCurrent, emit, enqueue, nextVersion, sessionId]);

  useEffect(() => {
    closedRef.current = false;
    const connections = connectionsRef.current;
    const plans = plansRef.current;
    const queues = queuesRef.current;
    const controller = {
      reconnect: reconnectAll,
      disconnect: disconnectAll,
      release: releaseAll,
    };
    controllers.set(sessionId, controller);
    return () => {
      if (controllers.get(sessionId) === controller) {
        controllers.delete(sessionId);
      }
      closedRef.current = true;
      const keys = new Set([
        ...connections.keys(),
        ...plans.keys(),
        ...queues.keys(),
      ]);
      for (const key of keys) {
        void releaseConnection(key).catch(() => undefined);
      }
    };
  }, [disconnectAll, reconnectAll, releaseAll, releaseConnection, sessionId]);

  const value = useMemo<IntegrationSessionLifecycleContextValue>(
    () => ({
      reserveConnection,
      runConnect,
      runDisconnect,
      releaseConnection,
      adoptConnection,
    }),
    [
      adoptConnection,
      releaseConnection,
      reserveConnection,
      runConnect,
      runDisconnect,
    ],
  );

  return React.createElement(
    IntegrationSessionLifecycleContext.Provider,
    { value },
    children,
  );
};

/**
 * Hook used by each integration's primary connection wrapper. It also owns the
 * keys it registers, so a nested Mail daemon tab disconnects when that sub-tab
 * unmounts even though the parent Mail session host remains mounted.
 */
export function useIntegrationConnectionLifecycle() {
  const context = useContext(IntegrationSessionLifecycleContext);
  const ownedRef = useRef(new Map<string, AsyncOperation>());
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    const owned = ownedRef.current;
    return () => {
      unmountedRef.current = true;
      for (const [key, disconnect] of owned) {
        if (context) {
          void context
            .releaseConnection(key, disconnect)
            .catch(() => undefined);
        } else {
          void disconnect().catch(() => undefined);
        }
      }
      owned.clear();
    };
  }, [context]);

  const trackConnect = useCallback(
    async <T>(
      key: string,
      connect: AsyncOperation<T>,
      disconnect: AsyncOperation,
    ): Promise<T> => {
      ownedRef.current.set(key, disconnect);
      const result = context
        ? await context.runConnect(key, connect, disconnect)
        : await connect();
      if (unmountedRef.current && !context) {
        await disconnect().catch(() => undefined);
      }
      return result;
    },
    [context],
  );

  const reserveConnection = useCallback(
    async (key: string, disconnect: AsyncOperation): Promise<void> => {
      ownedRef.current.set(key, disconnect);
      try {
        await context?.reserveConnection(key, disconnect);
      } catch (error) {
        if (ownedRef.current.get(key) === disconnect) {
          ownedRef.current.delete(key);
        }
        throw error;
      }
    },
    [context],
  );

  const trackDisconnect = useCallback(
    async (key: string, disconnect?: AsyncOperation): Promise<void> => {
      const operation = ownedRef.current.get(key) ?? disconnect;
      if (context) {
        await context.runDisconnect(key, operation);
      } else {
        await operation?.();
      }
    },
    [context],
  );

  const releaseConnection = useCallback(
    async (key: string, disconnect?: AsyncOperation): Promise<void> => {
      const operation = ownedRef.current.get(key) ?? disconnect;
      ownedRef.current.delete(key);
      if (context) {
        await context.releaseConnection(key, operation);
      } else {
        await operation?.();
      }
    },
    [context],
  );

  const adoptConnection = useCallback(
    (
      key: string,
      disconnect: AsyncOperation,
      reconnect?: AsyncOperation<unknown>,
    ) => {
      if (isProcessGlobalConnectionKey(key)) {
        context?.adoptConnection(key, disconnect, reconnect);
        return;
      }
      ownedRef.current.set(key, disconnect);
      context?.adoptConnection(key, disconnect, reconnect);
    },
    [context],
  );

  return useMemo(
    () => ({
      reserveConnection,
      trackConnect,
      trackDisconnect,
      releaseConnection,
      adoptConnection,
    }),
    [
      adoptConnection,
      releaseConnection,
      reserveConnection,
      trackConnect,
      trackDisconnect,
    ],
  );
}
