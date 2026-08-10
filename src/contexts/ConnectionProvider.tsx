import React, {
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DatabaseManager,
  type DatabaseDataTarget,
} from "../utils/connection/databaseManager";
import { StorageData } from "../utils/storage/storage";
import {
  activateConnectionNotes,
  deleteConnectionNotesSecret,
  deleteConnectionNotesSecrets,
} from "../utils/storage/connectionNotesVault";
import { SettingsManager } from "../utils/settings/settingsManager";
import {
  ConnectionState,
  ConnectionAction,
  ConnectionContext,
} from "./ConnectionContextTypes";
import { Connection } from "../types/connection/connection";
import {
  diffConnection,
  formatConnectionDiff,
} from "../utils/connection/diffConnection";
import { normalizeAdvancedProtocolConnection } from "../utils/connection/normalizeAdvancedProtocolConnection";
import {
  mergeLocalSessionUpdate,
  reconcileSessionLifecycleSnapshot,
} from "../utils/session/sessionLifecycle";

const initialState: ConnectionState = {
  connections: [],
  sessions: [],
  selectedConnection: null,
  selectedConnectionIds: new Set(),
  filter: {
    searchTerm: "",
    protocols: [],
    tags: [],
    colorTags: [],
    showRecent: false,
    showFavorites: false,
    sortBy: "custom",
    sortDirection: "asc",
  },
  isLoading: false,
  sidebarCollapsed: false,
  tabGroups: [],
};

/** Flatten the connection tree into an ordered list of IDs for range-select. */
function flattenConnectionIds(connections: Connection[]): string[] {
  const result: string[] = [];
  const roots = connections.filter((c) => !c.parentId);
  const childrenOf = (parentId: string) =>
    connections.filter((c) => c.parentId === parentId);
  const walk = (items: Connection[]) => {
    for (const item of items) {
      result.push(item.id);
      if (item.isGroup) walk(childrenOf(item.id));
    }
  };
  walk(roots);
  return result;
}

// Exported for deterministic reducer regression coverage.
// eslint-disable-next-line react-refresh/only-export-components
export const connectionReducer = (
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState => {
  switch (action.type) {
    case "SET_CONNECTIONS":
      // Replace all connections with a new list
      return {
        ...state,
        connections: action.payload.map((connection) =>
          normalizeAdvancedProtocolConnection(connection),
        ),
      };
    case "ADD_CONNECTION":
      // Append a new connection to the list
      return {
        ...state,
        connections: [
          ...state.connections,
          normalizeAdvancedProtocolConnection(action.payload),
        ],
      };
    case "UPDATE_CONNECTION": {
      // Update an existing connection by id
      const normalizedConnection = normalizeAdvancedProtocolConnection(
        action.payload,
      );
      return {
        ...state,
        connections: state.connections.map((conn) =>
          conn.id === normalizedConnection.id ? normalizedConnection : conn,
        ),
      };
    }
    case "DELETE_CONNECTION":
      // Remove a connection by id
      return {
        ...state,
        connections: state.connections.filter(
          (conn) => conn.id !== action.payload,
        ),
      };
    case "SELECT_CONNECTION":
      // Track the currently selected connection (clears multi-select)
      return {
        ...state,
        selectedConnection: action.payload,
        selectedConnectionIds: action.payload
          ? new Set([action.payload.id])
          : new Set(),
      };
    case "TOGGLE_SELECT_CONNECTION": {
      const { id, ctrl, shift } = action.payload;
      const conn = state.connections.find((c) => c.id === id) ?? null;
      if (shift && state.selectedConnection) {
        // Range select: select all connections between the anchor and target
        // Build a flat ordered list of visible connection IDs
        const flatIds = flattenConnectionIds(state.connections);
        const anchorIdx = flatIds.indexOf(state.selectedConnection.id);
        const targetIdx = flatIds.indexOf(id);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          const rangeIds = new Set(flatIds.slice(start, end + 1));
          // Merge with existing selection if Ctrl is also held
          const merged = ctrl
            ? new Set([...state.selectedConnectionIds, ...rangeIds])
            : rangeIds;
          return { ...state, selectedConnectionIds: merged };
        }
        return state;
      }
      if (ctrl) {
        // Toggle individual
        const next = new Set(state.selectedConnectionIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return {
          ...state,
          selectedConnection: conn,
          selectedConnectionIds: next,
        };
      }
      // Plain click — single select
      return {
        ...state,
        selectedConnection: conn,
        selectedConnectionIds: conn ? new Set([conn.id]) : new Set(),
      };
    }
    case "CLEAR_SELECTION":
      return {
        ...state,
        selectedConnection: null,
        selectedConnectionIds: new Set(),
      };
    case "SET_FILTER":
      // Update connection list filters
      return { ...state, filter: { ...state.filter, ...action.payload } };
    case "ADD_SESSION": {
      // Register a new connection session. If the session has no explicit
      // tabGroupId, fall back to the source connection's defaultTabGroupId
      // (only when that group still exists) so users can auto-route
      // sessions for a given host into a chosen tab group.
      let session = action.payload;
      if (!session.tabGroupId && session.connectionId) {
        const conn = state.connections.find(
          (c) => c.id === session.connectionId,
        );
        const defaultId = conn?.defaultTabGroupId;
        if (defaultId && state.tabGroups.some((g) => g.id === defaultId)) {
          session = { ...session, tabGroupId: defaultId };
        }
      }
      return { ...state, sessions: [...state.sessions, session] };
    }
    case "UPDATE_SESSION":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.payload.id
            ? mergeLocalSessionUpdate(session, action.payload)
            : session,
        ),
      };
    case "REMOVE_SESSION":
      // Drop a session from the list
      return {
        ...state,
        sessions: state.sessions.filter(
          (session) => session.id !== action.payload,
        ),
      };
    case "SET_SESSIONS":
      // Full main-window snapshots may arrive after a detached viewer already
      // acquired a newer native actor/VPN binding. Reconcile by lifecycle
      // revision instead of last-write-wins replacement.
      return {
        ...state,
        sessions: action.payload.map((incoming) => {
          const current = state.sessions.find(
            (session) => session.id === incoming.id,
          );
          return current
            ? reconcileSessionLifecycleSnapshot(current, incoming)
            : incoming;
        }),
      };
    case "REORDER_SESSIONS":
      // Reorder sessions by moving from one index to another
      const { fromIndex, toIndex } = action.payload;
      const sessions = [...state.sessions];
      const [movedSession] = sessions.splice(fromIndex, 1);
      sessions.splice(toIndex, 0, movedSession);
      return { ...state, sessions };
    case "SET_LOADING":
      // Toggle loading indicator
      return { ...state, isLoading: action.payload };
    case "TOGGLE_SIDEBAR":
      // Collapse or expand the sidebar
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case "SET_SIDEBAR_COLLAPSED":
      return { ...state, sidebarCollapsed: action.payload };
    case "ADD_TAB_GROUP":
      return { ...state, tabGroups: [...state.tabGroups, action.payload] };
    case "UPDATE_TAB_GROUP":
      return {
        ...state,
        tabGroups: state.tabGroups.map((g) =>
          g.id === action.payload.id ? action.payload : g,
        ),
      };
    case "REMOVE_TAB_GROUP":
      return {
        ...state,
        tabGroups: state.tabGroups.filter((g) => g.id !== action.payload),
        sessions: state.sessions.map((s) =>
          s.tabGroupId === action.payload ? { ...s, tabGroupId: undefined } : s,
        ),
      };
    case "SET_TAB_GROUPS":
      return { ...state, tabGroups: action.payload };
    default:
      return state;
  }
};

/**
 * Provides connection state and helper actions to descendant components.
 */
export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, baseDispatch] = useReducer(connectionReducer, initialState);
  const databaseManager = useMemo(() => DatabaseManager.getInstance(), []);
  const settingsManager = useMemo(() => SettingsManager.getInstance(), []);
  // Track whether data has been loaded to prevent overwriting on initial mount
  const hasLoadedRef = useRef(false);
  // Track if this is the first render to skip auto-save on mount
  const isInitialMountRef = useRef(true);
  const mountedRef = useRef(true);
  // The database that owns the connection rows currently rendered by this
  // provider. This deliberately does not follow DatabaseManager.currentDatabase
  // during an in-flight switch.
  const activeDatabaseTargetRef = useRef<DatabaseDataTarget | null>(null);
  const loadGenerationRef = useRef(0);
  // Stable live snapshot used by logging and persistence callbacks.
  const stateRef = useRef(state);
  const connectionsRef = useRef(state.connections);
  const [persistence, setPersistence] = useState({
    dirty: false,
    saving: false,
    error: null as string | null,
  });
  const dirtyRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const pendingSnapshotRef = useRef<{
    revision: number;
    data: StorageData;
    target: DatabaseDataTarget;
  } | null>(null);

  stateRef.current = state;
  connectionsRef.current = state.connections;

  const markPersistenceDirty = useCallback(() => {
    dirtyRevisionRef.current += 1;
    setPersistence((current) => ({
      ...current,
      dirty: true,
    }));
  }, []);

  // Wrap dispatch to add action logging.
  // Logging is wrapped in try-catch so a logging failure never blocks state updates.
  const dispatch = useCallback(
    (action: ConnectionAction) => {
      try {
        switch (action.type) {
          case "SET_CONNECTIONS": {
            const previousIds = new Set(
              connectionsRef.current.map((connection) => connection.id),
            );
            const nextIds = new Set(
              action.payload.map((connection) => connection.id),
            );
            const removedIds = [...previousIds].filter(
              (connectionId) => !nextIds.has(connectionId),
            );
            for (const connectionId of nextIds) {
              if (!previousIds.has(connectionId)) {
                try {
                  activateConnectionNotes(connectionId);
                } catch {
                  // State replacement still proceeds; note persistence fails
                  // closed if its bounded lifecycle registry is unavailable.
                }
              }
            }
            if (removedIds.length > 0) {
              void deleteConnectionNotesSecrets(removedIds).then(
                (failures) => {
                  if (failures > 0) {
                    settingsManager.logAction(
                      "warn",
                      "Bulk secure note cleanup incomplete",
                      undefined,
                      `${failures} OS vault note entries could not be deleted.`,
                    );
                  }
                },
                () => {
                  settingsManager.logAction(
                    "warn",
                    "Bulk secure note cleanup failed",
                    undefined,
                    "The bounded OS vault cleanup queue rejected the request.",
                  );
                },
              );
            }
            break;
          }
          case "ADD_TAB_GROUP":
          case "UPDATE_TAB_GROUP":
          case "REMOVE_TAB_GROUP": {
            // Force a save right after a tab group mutation — belt and
            // suspenders so persistence does not rely on the state-deps
            // useEffect alone (which can be subtly bypassed by HMR or
            // double-dispatch quirks).
            tabGroupSavePendingRef.current = true;
            break;
          }
          case "ADD_CONNECTION": {
            const conn = action.payload;
            try {
              activateConnectionNotes(conn.id);
            } catch {
              // Connection creation is authoritative. Notes remain unavailable
              // until bounded lifecycle capacity becomes available.
            }
            settingsManager.logAction(
              "info",
              conn.isGroup ? "Folder created" : "Connection created",
              conn.id,
              `Name: "${conn.name}"${conn.hostname ? `, Host: ${conn.hostname}` : ""}${conn.protocol ? `, Protocol: ${conn.protocol}` : ""}`,
            );
            break;
          }
          case "UPDATE_CONNECTION": {
            const conn = action.payload;
            // P9: diff the previous snapshot against the incoming one
            // and log the field-level deltas (with secrets masked) so
            // the audit trail shows what actually changed, not just
            // that something did.
            const prev = connectionsRef.current.find((c) => c.id === conn.id);
            const deltas = diffConnection(prev, conn);
            const detail =
              deltas.length === 0
                ? `Name: "${conn.name}" — no field changes (save with no edits)`
                : `Name: "${conn.name}" — ${formatConnectionDiff(deltas)}`;
            settingsManager.logAction(
              "info",
              conn.isGroup ? "Folder edited" : "Connection edited",
              conn.id,
              detail,
            );
            break;
          }
          case "DELETE_CONNECTION": {
            void deleteConnectionNotesSecret(action.payload).catch(() => {
              settingsManager.logAction(
                "warn",
                "Secure note cleanup failed",
                action.payload,
                "The OS vault note entry could not be deleted and may require retry.",
              );
            });
            settingsManager.logAction(
              "info",
              "Connection deleted",
              action.payload,
              `Connection ID: ${action.payload}`,
            );
            break;
          }
          case "ADD_SESSION": {
            const session = action.payload;
            settingsManager.logAction(
              "info",
              "Session opened",
              session.connectionId,
              `Session "${session.name}" opened via ${session.protocol}`,
            );
            break;
          }
          case "REMOVE_SESSION": {
            settingsManager.logAction(
              "info",
              "Session removed",
              undefined,
              `Session ID: ${action.payload}`,
            );
            break;
          }
          case "REORDER_SESSIONS": {
            settingsManager.logAction(
              "debug",
              "Sessions reordered",
              undefined,
              `Moved from index ${action.payload.fromIndex} to ${action.payload.toIndex}`,
            );
            break;
          }
        }
      } catch (logErr) {
        console.error("Action logging failed:", logErr);
      }

      const currentState = stateRef.current;
      const nextState = connectionReducer(currentState, action);
      stateRef.current = nextState;
      connectionsRef.current = nextState.connections;
      tabGroupsRef.current = nextState.tabGroups;

      if (
        hasLoadedRef.current &&
        activeDatabaseTargetRef.current &&
        databaseManager.getCurrentDatabase() &&
        (nextState.connections !== currentState.connections ||
          nextState.tabGroups !== currentState.tabGroups)
      ) {
        markPersistenceDirty();
      }

      baseDispatch(action);
    },
    [databaseManager, markPersistenceDirty, settingsManager],
  );

  // Use refs so saveData has a stable identity and doesn't cause effect re-runs
  const tabGroupsRef = useRef(state.tabGroups);
  tabGroupsRef.current = state.tabGroups;
  // Marker set by the dispatch wrapper whenever a tab-group action runs.
  // The auto-save effect below treats it as a forced trigger so changes
  // to state.tabGroups always reach disk even if the dependency-array
  // path is bypassed.
  const tabGroupSavePendingRef = useRef(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveLoopRef = useRef<Promise<void> | null>(null);

  const buildStorageSnapshot = useCallback(
    (): StorageData => ({
      connections: connectionsRef.current,
      settings: {},
      timestamp: Date.now(),
      tabGroups: tabGroupsRef.current,
    }),
    [],
  );

  const flushPendingSave = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (
      !hasLoadedRef.current ||
      !activeDatabaseTargetRef.current ||
      dirtyRevisionRef.current <= persistedRevisionRef.current
    ) {
      return;
    }

    if (saveLoopRef.current) {
      return saveLoopRef.current;
    }

    const saveLoop = (async () => {
      while (dirtyRevisionRef.current > persistedRevisionRef.current) {
        const targetRevision = dirtyRevisionRef.current;
        const retainedSnapshot = pendingSnapshotRef.current;
        const snapshot =
          retainedSnapshot?.revision === targetRevision
            ? retainedSnapshot
            : (() => {
                const target = activeDatabaseTargetRef.current;
                if (!target) {
                  throw new Error(
                    "Cannot persist connection data without an owning collection",
                  );
                }
                return {
                  revision: targetRevision,
                  data: buildStorageSnapshot(),
                  target,
                };
              })();
        pendingSnapshotRef.current = snapshot;

        if (mountedRef.current) {
          setPersistence({
            dirty: true,
            saving: true,
            error: null,
          });
        }

        try {
          await snapshot.target.save(snapshot.data);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (mountedRef.current) {
            setPersistence({
              dirty: true,
              saving: false,
              error: message,
            });
          }
          console.error("Failed to save data:", error);
          throw error;
        }

        persistedRevisionRef.current = targetRevision;
        if (pendingSnapshotRef.current === snapshot) {
          pendingSnapshotRef.current = null;
        }

        const isDirty = dirtyRevisionRef.current > persistedRevisionRef.current;
        if (mountedRef.current) {
          setPersistence({
            dirty: isDirty,
            saving: isDirty,
            error: null,
          });
        }
      }
    })();

    saveLoopRef.current = saveLoop;
    try {
      await saveLoop;
    } finally {
      if (saveLoopRef.current === saveLoop) {
        saveLoopRef.current = null;
      }
    }
  }, [buildStorageSnapshot, databaseManager]);

  // Every DatabaseManager selection path (including import/restore callers)
  // must cross the same durable barrier before the mutable current database
  // can advance.
  useEffect(
    () =>
      databaseManager.registerBeforeDatabaseTransition(flushPendingSave),
    [databaseManager, flushPendingSave],
  );

  const saveData = useCallback(async () => {
    if (!hasLoadedRef.current || !databaseManager.getCurrentDatabase()) {
      return;
    }

    markPersistenceDirty();
    await flushPendingSave();
  }, [databaseManager, flushPendingSave, markPersistenceDirty]);

  const dispatchAndFlush = useCallback(
    async (action: ConnectionAction) => {
      dispatch(action);
      await flushPendingSave();
    },
    [dispatch, flushPendingSave],
  );

  const loadData = useCallback(async (expectedDatabaseId?: string) => {
    const generation = ++loadGenerationRef.current;
    try {
      // Never replace the rendered rows while their owning database still has
      // a dirty generation. This also covers callers that changed the manager
      // selection without going through App.handleDatabaseSelect.
      await flushPendingSave();

      const target = databaseManager.captureCurrentDatabaseDataTarget();
      if (!target) {
        throw new Error("No collection selected");
      }
      if (
        expectedDatabaseId &&
        target.databaseId !== expectedDatabaseId
      ) {
        return false;
      }

      const data = await target.load();
      if (
        generation !== loadGenerationRef.current ||
        databaseManager.getCurrentDatabase()?.id !== target.databaseId
      ) {
        return false;
      }

      // Edits can still arrive while an encrypted or recovered collection is
      // loading. Flush the old owner once more immediately before publishing.
      await flushPendingSave();
      if (
        generation !== loadGenerationRef.current ||
        databaseManager.getCurrentDatabase()?.id !== target.databaseId
      ) {
        return false;
      }

      if (data && data.connections) {
        // Convert date strings back to Date objects (with validation)
        const toValidDate = (
          value: unknown,
          field: string,
          connId?: string,
        ): Date => {
          if (!value) return new Date();
          const d = new Date(value as string | number);
          if (isNaN(d.getTime())) {
            console.warn(
              `Invalid ${field} date for connection ${connId}:`,
              value,
            );
            return new Date();
          }
          return d;
        };
        const connections = data.connections.map((conn: any) =>
          normalizeAdvancedProtocolConnection({
            ...conn,
            createdAt: toValidDate(conn.createdAt, "createdAt", conn.id),
            updatedAt: toValidDate(conn.updatedAt, "updatedAt", conn.id),
          } as Connection),
        );
        const tabGroups = Array.isArray(data.tabGroups) ? data.tabGroups : [];
        stateRef.current = {
          ...stateRef.current,
          connections,
          tabGroups,
        };
        connectionsRef.current = connections;
        tabGroupsRef.current = tabGroups;
        baseDispatch({ type: "SET_CONNECTIONS", payload: connections });
        baseDispatch({ type: "SET_TAB_GROUPS", payload: tabGroups });
      }
      // Mark as loaded after successfully loading data
      activeDatabaseTargetRef.current = target;
      hasLoadedRef.current = true;
      dirtyRevisionRef.current = 0;
      persistedRevisionRef.current = 0;
      pendingSnapshotRef.current = null;
      setPersistence({
        dirty: false,
        saving: false,
        error: null,
      });
      return true;
    } catch (error) {
      if (
        generation !== loadGenerationRef.current ||
        (expectedDatabaseId !== undefined &&
          databaseManager.getCurrentDatabase()?.id !== expectedDatabaseId)
      ) {
        return false;
      }
      console.error("Failed to load data:", error);
      throw error;
    }
  }, [databaseManager, flushPendingSave]);

  // Debounced auto-save: coalesces rapid connection changes into a single write.
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushPendingSave().catch(() => {
        // flushPendingSave records, logs, and retains the failed snapshot.
      });
    }, 500);
  }, [flushPendingSave]);

  // React cleanup cannot be awaited, so start the same durable flush used by
  // the awaited native close path instead of discarding the debounce.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void flushPendingSave().catch(() => {
        // The failed snapshot remains retained for an explicit retry.
      });
    };
  }, [flushPendingSave]);

  // Auto-save whenever connections or tab groups change.
  // BUT only after data has been loaded to prevent overwriting on mount/HMR.
  useEffect(() => {
    // Skip auto-save on initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      tabGroupSavePendingRef.current = false;
      return;
    }

    if (!hasLoadedRef.current || !databaseManager.getCurrentDatabase()) {
      // Drop the pending marker so it doesn't accidentally fire later
      // when a database isn't open.
      tabGroupSavePendingRef.current = false;
      return;
    }

    if (dirtyRevisionRef.current > persistedRevisionRef.current) {
      debouncedSave();
    }
    tabGroupSavePendingRef.current = false;
    // debouncedSave is stable (depends only on the database manager) — safe to omit from lint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connections, state.tabGroups, databaseManager]);

  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      dispatchAndFlush,
      persistence,
      saveData,
      flushPendingSave,
      loadData,
    }),
    [
      state,
      dispatch,
      dispatchAndFlush,
      persistence,
      saveData,
      flushPendingSave,
      loadData,
    ],
  );

  return (
    <ConnectionContext.Provider value={contextValue}>
      {children}
    </ConnectionContext.Provider>
  );
};
