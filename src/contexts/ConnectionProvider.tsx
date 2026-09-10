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
import { activateConnectionNotes } from "../utils/storage/connectionNotesVault";
import { generateId } from "../utils/core/id";
import {
  archiveConnections,
  emptyRecycleBin,
  expiredRecycleBinIds,
  normalizeRecycleBin,
  normalizeRecycleBinPolicy,
  recycleBinRows,
  restoreRecycledConnections,
  selectedRecycleBinIds,
  RECYCLE_BIN_PURGE_WARNING,
} from "../utils/connection/recycleBin";
import type {
  ConnectionRecycleBinApi,
  DatabaseRecycleBin,
  RecycleBinOutcome,
  RecycleBinPolicy,
  RecycleBinReview,
  RecycleBinScope,
} from "../types/connection/recycleBin";
import { SettingsManager } from "../utils/settings/settingsManager";
import type {
  DatabaseAutomationApi,
  DatabaseAutomationScope,
} from "../types/recording/automationLibrary";
import { normalizeDatabaseAutomationLibrary } from "../utils/recording/automationLibraryValidation";
import { AutomationLibraryAccessError } from "../utils/recording/automationLibraryAccess";
import { getInvoke } from "../utils/tauri/invoke";
import {
  ConnectionState,
  ConnectionAction,
  ConnectionContext,
  type DatabaseAvailability,
} from "./ConnectionContextTypes";
import { Connection, ConnectionSession } from "../types/connection/connection";
import {
  diffConnection,
  formatConnectionDiff,
} from "../utils/connection/diffConnection";
import { normalizeAdvancedProtocolConnection } from "../utils/connection/normalizeAdvancedProtocolConnection";
import { resolveDefaultTabGroup } from "../utils/session/resolveDefaultTabGroup";
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

/** Both active loads and restored archives use the same runtime boundary. */
function normalizeLoadedConnection(connection: Connection): Connection {
  const date = (value: unknown): Date => {
    const parsed = value ? new Date(value as string | number) : new Date();
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  };
  // Persisted Connection dates remain strings; the existing provider runtime
  // contract rehydrates them without changing the serialized schema.
  return normalizeAdvancedProtocolConnection({
    ...connection,
    createdAt: date(connection.createdAt),
    updatedAt: date(connection.updatedAt),
  } as unknown as Connection);
}

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

export interface SessionSnapshotReconciliationDiagnostics {
  indexedSessions: number;
  lookupSessions: number;
  matchedSessions: number;
}

/**
 * Reconciles a full session snapshot in O(current + incoming) time while
 * preserving the incoming snapshot's ordering and lifecycle merge semantics.
 */
// Exported for deterministic reducer scalability coverage.
// eslint-disable-next-line react-refresh/only-export-components, react/only-export-components
export const reconcileSessionSnapshot = (
  currentSessions: readonly ConnectionSession[],
  incomingSessions: readonly ConnectionSession[],
  onDiagnostics?: (
    diagnostics: SessionSnapshotReconciliationDiagnostics,
  ) => void,
): ConnectionSession[] => {
  const currentById = new Map<string, ConnectionSession>();
  let indexedSessions = 0;
  for (const session of currentSessions) {
    indexedSessions++;
    // Session ids are unique in application state. Keeping the first entry also
    // exactly matches the previous Array.find behavior for malformed snapshots.
    if (!currentById.has(session.id)) currentById.set(session.id, session);
  }
  let lookupSessions = 0;
  let matchedSessions = 0;
  const reconciled = incomingSessions.map((incoming) => {
    lookupSessions++;
    const current = currentById.get(incoming.id);
    if (!current) return incoming;
    matchedSessions++;
    const reconciled = reconcileSessionLifecycleSnapshot(current, incoming);
    // A previously ownerless tool may have been explicitly bound in its
    // owning window. Carry that first authoritative owner across window moves;
    // a nonempty existing owner remains immutable even in newer snapshots.
    const ownerDatabaseId = current.ownerDatabaseId || incoming.ownerDatabaseId;
    return reconciled.ownerDatabaseId === ownerDatabaseId
      ? reconciled
      : { ...reconciled, ownerDatabaseId };
  });
  onDiagnostics?.({
    indexedSessions,
    lookupSessions,
    matchedSessions,
  });
  return reconciled;
};

// Exported for deterministic reducer regression coverage.
// eslint-disable-next-line react-refresh/only-export-components, react/only-export-components
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
    case "RECYCLE_CONNECTIONS": {
      const operation =
        action.type === "RECYCLE_CONNECTIONS"
          ? action.payload
          : {
              ids: [action.payload],
              now: Date.now(),
              operationId: `legacy-${Date.now()}`,
            };
      const next = archiveConnections(
        state.connections,
        state.recycleBinData ?? emptyRecycleBin(),
        operation.ids,
        operation.now,
        operation.operationId,
      );
      if (!next.archived) return state;
      const liveIds = new Set(
        next.connections.map((connection) => connection.id),
      );
      return {
        ...state,
        connections: next.connections,
        recycleBinData: next.bin,
        selectedConnection:
          state.selectedConnection && liveIds.has(state.selectedConnection.id)
            ? state.selectedConnection
            : null,
        selectedConnectionIds: new Set(
          [...state.selectedConnectionIds].filter((id) => liveIds.has(id)),
        ),
      };
    }
    case "SET_RECYCLE_BIN":
      return { ...state, recycleBinData: action.payload };
    case "APPLY_RECYCLE_BIN": {
      const live = new Map(
        action.payload.connections.map((connection) => [
          connection.id,
          connection,
        ]),
      );
      return {
        ...state,
        connections: action.payload.connections,
        recycleBinData: action.payload.bin,
        selectedConnection: state.selectedConnection
          ? (live.get(state.selectedConnection.id) ?? null)
          : null,
        selectedConnectionIds: new Set(
          [...state.selectedConnectionIds].filter((id) => live.has(id)),
        ),
      };
    }
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
      // Explicit session > connection > nearest ancestor folder. Missing group
      // references are skipped, and existing tabs/child records remain untouched.
      const tabGroupId = resolveDefaultTabGroup(
        action.payload.connectionId,
        state.connections,
        state.tabGroups,
        action.payload.tabGroupId,
      );
      const session =
        tabGroupId === action.payload.tabGroupId
          ? action.payload
          : { ...action.payload, tabGroupId };
      return { ...state, sessions: [...state.sessions, session] };
    }
    case "UPDATE_SESSION":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.payload.id
            ? {
                ...mergeLocalSessionUpdate(session, action.payload),
                ownerDatabaseId: session.ownerDatabaseId,
              }
            : session,
        ),
      };
    case "BIND_TOOL_DATABASE_OWNER":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.payload.sessionId &&
          session.protocol.startsWith("tool:") &&
          !session.ownerDatabaseId
            ? { ...session, ownerDatabaseId: action.payload.databaseId }
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
        sessions: reconcileSessionSnapshot(state.sessions, action.payload),
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
  const saveGenerationRef = useRef(0);
  // Stable live snapshot used by logging and persistence callbacks.
  const stateRef = useRef(state);
  const connectionsRef = useRef(state.connections);
  const recycleBinRef = useRef(state.recycleBinData ?? emptyRecycleBin());
  const loadedStorageRef = useRef<StorageData | null>(null);
  const automationBusyRef = useRef(false);
  const automationFaultRef = useRef(false);
  const [automationChangeRevision, setAutomationChangeRevision] = useState(0);
  const recycleReviewsRef = useRef(
    new Map<
      string,
      { review: RecycleBinReview; ids: string[]; deadline: number }
    >(),
  );
  const recycleBusyRef = useRef(false);
  const [recycleBusy, setRecycleBusy] = useState(false);
  const [recycleAccessGeneration, setRecycleAccessGeneration] = useState(0);
  const recycleLoadingRef = useRef(false);
  const [recycleLoading, setRecycleLoading] = useState(false);
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
  const availabilityGenerationRef = useRef(0);
  const [databaseAvailability, setDatabaseAvailability] =
    useState<DatabaseAvailability>(() => {
      const databaseId = databaseManager.getCurrentDatabase()?.id;
      return {
        status: databaseId ? "loading" : "none",
        databaseId,
        generation: 0,
      };
    });
  const databaseAvailabilityRef = useRef(databaseAvailability);
  databaseAvailabilityRef.current = databaseAvailability;
  const publishDatabaseAvailability = useCallback(
    (requestedStatus?: "loading" | "error") => {
      const databaseId = databaseManager.getCurrentDatabase()?.id;
      let status: DatabaseAvailability["status"] = "none";
      if (databaseId) {
        const access = databaseManager.getDatabaseAccessState?.(databaseId);
        if (access && access.status !== "ready") status = "suspended";
        else if (requestedStatus) status = requestedStatus;
        else if (
          hasLoadedRef.current &&
          !recycleLoadingRef.current &&
          activeDatabaseTargetRef.current?.databaseId === databaseId
        ) {
          try {
            activeDatabaseTargetRef.current.assertAccessible?.();
            status = "ready";
          } catch {
            status = "suspended";
          }
        } else status = "loading";
      }
      const available: DatabaseAvailability = {
        status,
        databaseId,
        generation: ++availabilityGenerationRef.current,
      };
      databaseAvailabilityRef.current = available;
      setDatabaseAvailability(available);
    },
    [databaseManager],
  );

  stateRef.current = state;
  connectionsRef.current = state.connections;
  recycleBinRef.current = state.recycleBinData ?? emptyRecycleBin();

  useEffect(
    () =>
      databaseManager.onDatabaseAccessChange?.((access) => {
        if (access.databaseId !== databaseManager.getCurrentDatabase()?.id)
          return;
        recycleReviewsRef.current.clear();
        loadGenerationRef.current += 1;
        // Suspension masks the bin and invalidates reviews without discarding the
        // provider's recoverable dirty data. Global close/switch clears it below.
        setRecycleAccessGeneration((generation) => generation + 1);
        publishDatabaseAvailability();
      }),
    [databaseManager, publishDatabaseAvailability],
  );

  useEffect(
    () =>
      databaseManager.onCurrentDatabaseChange((change) => {
        // An unrelated database being created/unlocked is not a new lease for
        // the current tree or its open tool drafts.
        if (
          change.database?.id === databaseAvailabilityRef.current.databaseId &&
          change.databaseId !== change.database?.id
        )
          return;
        const changedOwner =
          !!change.database &&
          !!activeDatabaseTargetRef.current &&
          change.database.id !== activeDatabaseTargetRef.current.databaseId;
        if (
          changedOwner ||
          (!change.database &&
            ["close", "lock", "delete"].includes(change.reason))
        ) {
          const lostUnsaved =
            dirtyRevisionRef.current > persistedRevisionRef.current;
          loadGenerationRef.current += 1;
          saveGenerationRef.current += 1;
          setRecycleAccessGeneration((generation) => generation + 1);
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
          saveLoopRef.current = null;
          activeDatabaseTargetRef.current = null;
          pendingSnapshotRef.current = null;
          hasLoadedRef.current = false;
          dirtyRevisionRef.current = 0;
          persistedRevisionRef.current = 0;
          tabGroupSavePendingRef.current = false;
          connectionsRef.current = [];
          tabGroupsRef.current = [];
          recycleBinRef.current = emptyRecycleBin();
          loadedStorageRef.current = null;
          automationFaultRef.current = false;
          recycleReviewsRef.current.clear();
          stateRef.current = {
            ...stateRef.current,
            connections: [],
            tabGroups: [],
            selectedConnection: null,
            selectedConnectionIds: new Set(),
            recycleBinData: recycleBinRef.current,
          };
          baseDispatch({ type: "SET_CONNECTIONS", payload: [] });
          baseDispatch({ type: "SET_TAB_GROUPS", payload: [] });
          baseDispatch({ type: "CLEAR_SELECTION" });
          baseDispatch({ type: "SELECT_CONNECTION", payload: null });
          baseDispatch({
            type: "SET_RECYCLE_BIN",
            payload: recycleBinRef.current,
          });
          setPersistence({
            dirty: false,
            saving: false,
            error: lostUnsaved
              ? "Database closed before pending changes could be saved. Decrypted pending data was cleared; it was not persisted."
              : null,
          });
          publishDatabaseAvailability();
          return;
        }
        if (
          change.reason !== "security-change" ||
          !change.database ||
          change.database.id !== activeDatabaseTargetRef.current?.databaseId
        ) {
          publishDatabaseAvailability();
          return;
        }
        const target = databaseManager.captureCurrentDatabaseDataTarget();
        if (!target || target.databaseId !== change.database.id) return;
        activeDatabaseTargetRef.current = target;
        // Keep any failed/dirty snapshot and its revision, but stop routing its
        // retry through a revoked credential capture after a committed change.
        if (
          pendingSnapshotRef.current?.target.databaseId === target.databaseId
        ) {
          pendingSnapshotRef.current = {
            ...pendingSnapshotRef.current,
            target,
          };
        }
        publishDatabaseAvailability();
      }),
    [databaseManager, publishDatabaseAvailability],
  );

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
      if (action.type === "BIND_TOOL_DATABASE_OWNER") {
        const available = databaseAvailabilityRef.current;
        if (
          available.status !== "ready" ||
          available.databaseId !== action.payload.databaseId ||
          available.generation !== action.payload.generation ||
          databaseManager.getCurrentDatabase()?.id !==
            action.payload.databaseId ||
          activeDatabaseTargetRef.current?.databaseId !==
            action.payload.databaseId
        )
          return;
        try {
          activeDatabaseTargetRef.current.assertAccessible?.();
          const access = databaseManager.getDatabaseAccessState?.(
            action.payload.databaseId,
          );
          if (access && access.status !== "ready") return;
        } catch {
          return;
        }
      }
      if (action.type === "ADD_SESSION" && !action.payload.ownerDatabaseId) {
        // Capture ownership at creation, not when a lazy viewer later mounts.
        // Window hydration uses SET_SESSIONS and retains the source owner.
        action = {
          ...action,
          payload: {
            ...action.payload,
            ownerDatabaseId: activeDatabaseTargetRef.current?.databaseId,
          },
        };
      }
      if (action.type === "DELETE_CONNECTION") {
        action = {
          type: "RECYCLE_CONNECTIONS",
          payload: {
            ids: [action.payload],
            now: Date.now(),
            operationId: generateId(),
          },
        };
      }
      if (
        action.type === "RECYCLE_CONNECTIONS" &&
        (!hasLoadedRef.current ||
          !activeDatabaseTargetRef.current ||
          databaseManager.getCurrentDatabase()?.id !==
            activeDatabaseTargetRef.current.databaseId)
      )
        throw new Error(
          "Open and unlock the owning database before deleting connections.",
        );
      if (action.type === "RECYCLE_CONNECTIONS")
        activeDatabaseTargetRef.current?.assertAccessible?.();
      try {
        switch (action.type) {
          case "SET_CONNECTIONS": {
            const previousIds = new Set(
              connectionsRef.current.map((connection) => connection.id),
            );
            const nextIds = new Set(
              action.payload.map((connection) => connection.id),
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
            // SET_CONNECTIONS also hydrates filtered detached-window snapshots.
            // Absence here is never deletion and must never remove shared notes.
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
          case "RECYCLE_CONNECTIONS": {
            settingsManager.logAction(
              "info",
              "Connections moved to Recycle Bin",
              undefined,
              `${action.payload.ids.length} selected connection IDs; pending database save.`,
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
      recycleBinRef.current = nextState.recycleBinData ?? emptyRecycleBin();

      if (
        hasLoadedRef.current &&
        activeDatabaseTargetRef.current &&
        databaseManager.getCurrentDatabase() &&
        (nextState.connections !== currentState.connections ||
          nextState.tabGroups !== currentState.tabGroups ||
          nextState.recycleBinData !== currentState.recycleBinData)
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
      ...loadedStorageRef.current,
      connections: connectionsRef.current,
      settings: loadedStorageRef.current?.settings ?? {},
      timestamp: Date.now(),
      tabGroups: tabGroupsRef.current,
      recycleBin: recycleBinRef.current,
    }),
    [],
  );

  const flushPendingSave = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (saveLoopRef.current) return saveLoopRef.current;
    if (
      !hasLoadedRef.current ||
      !activeDatabaseTargetRef.current ||
      dirtyRevisionRef.current <= persistedRevisionRef.current
    ) {
      return;
    }

    if (automationFaultRef.current)
      throw new Error(
        "A database library write could not be verified. Reload the database before saving; pending connection edits were retained.",
      );

    const generation = saveGenerationRef.current;
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
          if (generation !== saveGenerationRef.current) throw error;
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

        if (generation !== saveGenerationRef.current) return;

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
  }, [buildStorageSnapshot]);

  // Every DatabaseManager selection path (including import/restore callers)
  // must cross the same durable barrier before the mutable current database
  // can advance.
  useEffect(
    () => databaseManager.registerBeforeDatabaseTransition(flushPendingSave),
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

  const loadData = useCallback(
    async (expectedDatabaseId?: string) => {
      const generation = ++loadGenerationRef.current;
      recycleLoadingRef.current = true;
      setRecycleLoading(true);
      recycleReviewsRef.current.clear();
      publishDatabaseAvailability("loading");
      try {
        // Never replace the rendered rows while their owning database still has
        // a dirty generation. This also covers callers that changed the manager
        // selection without going through App.handleDatabaseSelect.
        await flushPendingSave();

        const target = databaseManager.captureCurrentDatabaseDataTarget();
        if (!target) {
          throw new Error("No collection selected");
        }
        if (expectedDatabaseId && target.databaseId !== expectedDatabaseId) {
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

        if (!data || !Array.isArray(data.connections))
          throw new Error(
            "Invalid database data; Recycle Bin remains unavailable until a successful reload.",
          );
        {
          const recycleBin = normalizeRecycleBin(data.recycleBin);
          const connections = data.connections.map(normalizeLoadedConnection);
          const tabGroups = Array.isArray(data.tabGroups) ? data.tabGroups : [];
          stateRef.current = {
            ...stateRef.current,
            connections,
            tabGroups,
            recycleBinData: recycleBin,
          };
          connectionsRef.current = connections;
          tabGroupsRef.current = tabGroups;
          recycleBinRef.current = recycleBin;
          loadedStorageRef.current = data;
          automationFaultRef.current = false;
          setAutomationChangeRevision((value) => value + 1);
          recycleReviewsRef.current.clear();
          baseDispatch({ type: "SET_CONNECTIONS", payload: connections });
          baseDispatch({ type: "SET_TAB_GROUPS", payload: tabGroups });
          baseDispatch({ type: "SET_RECYCLE_BIN", payload: recycleBin });
        }
        // Mark as loaded after successfully loading data
        activeDatabaseTargetRef.current = target;
        hasLoadedRef.current = true;
        recycleLoadingRef.current = false;
        setRecycleLoading(false);
        dirtyRevisionRef.current = 0;
        persistedRevisionRef.current = 0;
        pendingSnapshotRef.current = null;
        setPersistence({
          dirty: false,
          saving: false,
          error: null,
        });
        publishDatabaseAvailability();
        return true;
      } catch (error) {
        if (
          generation !== loadGenerationRef.current ||
          (expectedDatabaseId !== undefined &&
            databaseManager.getCurrentDatabase()?.id !== expectedDatabaseId)
        ) {
          return false;
        }
        publishDatabaseAvailability("error");
        console.error("Failed to load data:", error);
        throw error;
      }
    },
    [databaseManager, flushPendingSave, publishDatabaseAvailability],
  );

  const captureRecycleScope = useCallback((): RecycleBinScope => {
    const target = activeDatabaseTargetRef.current;
    if (
      recycleLoadingRef.current ||
      !hasLoadedRef.current ||
      !target ||
      databaseManager.getCurrentDatabase()?.id !== target.databaseId
    )
      throw new Error(
        "Open and unlock the owning database to use its Recycle Bin.",
      );
    target.assertAccessible?.();
    const access = databaseManager.getDatabaseAccessState?.(target.databaseId);
    if (access && access.status !== "ready")
      throw new Error(
        "Database access is suspended. Unlock before using its Recycle Bin.",
      );
    return {
      databaseId: target.databaseId,
      generation: loadGenerationRef.current,
      revision: recycleBinRef.current.revision,
    };
  }, [databaseManager]);
  const assertRecycleScope = useCallback(
    (expected: RecycleBinScope, checkRevision = true) => {
      const current = captureRecycleScope();
      if (
        current.databaseId !== expected.databaseId ||
        current.generation !== expected.generation ||
        (checkRevision && current.revision !== expected.revision)
      )
        throw new Error(
          "Recycle Bin or database changed. Refresh and review the action again.",
        );
    },
    [captureRecycleScope],
  );

  const runRecycleMutation = useCallback(
    async (
      scope: RecycleBinScope,
      operation: (
        connections: Connection[],
        bin: DatabaseRecycleBin,
        now: number,
        operationId: string,
      ) => {
        connections: Connection[];
        bin: DatabaseRecycleBin;
        archived?: number;
        restored?: number;
        purged?: number;
        skipped?: number;
      },
    ): Promise<RecycleBinOutcome> => {
      scope = { ...scope };
      if (recycleBusyRef.current)
        throw new Error("A Recycle Bin operation is already in progress.");
      assertRecycleScope(scope);
      recycleBusyRef.current = true;
      setRecycleBusy(true);
      try {
        await flushPendingSave();
        assertRecycleScope(scope);
        const result = operation(
          stateRef.current.connections,
          recycleBinRef.current,
          Date.now(),
          generateId(),
        );
        if (
          result.connections !== stateRef.current.connections ||
          result.bin !== recycleBinRef.current
        ) {
          dispatch({ type: "APPLY_RECYCLE_BIN", payload: result });
          await flushPendingSave();
        }
        assertRecycleScope(scope, false);
        recycleReviewsRef.current.clear();
        return {
          committed: true,
          archived: result.archived ?? 0,
          restored: result.restored ?? 0,
          purged: result.purged ?? 0,
          skipped: result.skipped ?? 0,
          warnings: [
            ...(result.purged ? [RECYCLE_BIN_PURGE_WARNING] : []),
            ...(result.skipped
              ? [
                  "Some entries were not restored because they expired or their connection IDs already exist. Conflicting archive entries were retained.",
                ]
              : []),
          ],
        };
      } finally {
        recycleBusyRef.current = false;
        if (mountedRef.current) setRecycleBusy(false);
      }
    },
    [assertRecycleScope, dispatch, flushPendingSave],
  );

  const archive = useCallback<ConnectionRecycleBinApi["archive"]>(
    (ids, options) => {
      const scope = options?.expectedScope
        ? { ...options.expectedScope }
        : captureRecycleScope();
      assertRecycleScope(scope);
      const selected = [...ids];
      const keepChildren = options?.keepChildren === true;
      return runRecycleMutation(scope, (connections, bin, now, operationId) =>
        archiveConnections(
          connections,
          bin,
          selected,
          now,
          operationId,
          keepChildren,
        ),
      );
    },
    [assertRecycleScope, captureRecycleScope, runRecycleMutation],
  );
  const restore = useCallback<ConnectionRecycleBinApi["restore"]>(
    (ids, scope) => {
      const selected = [...ids];
      return runRecycleMutation(scope, (connections, bin, now, operationId) => {
        const restored = restoreRecycledConnections(
          connections,
          bin,
          selected,
          now,
          operationId,
        );
        if (!restored.restored) return restored;
        const liveIds = new Set(connections.map((connection) => connection.id));
        return {
          ...restored,
          connections: restored.connections.map((connection) =>
            liveIds.has(connection.id)
              ? connection
              : normalizeLoadedConnection(connection),
          ),
        };
      });
    },
    [runRecycleMutation],
  );

  const makeRecycleReview = useCallback(
    async (
      kind: "purge" | "retention",
      scope: RecycleBinScope,
      ids: readonly string[] | null,
      proposedPolicy?: RecycleBinPolicy,
    ): Promise<RecycleBinReview> => {
      scope = { ...scope };
      const policy = proposedPolicy
        ? normalizeRecycleBinPolicy(proposedPolicy)
        : undefined;
      if (recycleBusyRef.current)
        throw new Error("A Recycle Bin operation is already in progress.");
      assertRecycleScope(scope);
      await flushPendingSave();
      assertRecycleScope(scope);
      const selected =
        kind === "retention"
          ? expiredRecycleBinIds(recycleBinRef.current, Date.now(), policy)
          : [...selectedRecycleBinIds(recycleBinRef.current, ids)];
      const review: RecycleBinReview = {
        token: generateId(),
        kind,
        scope: { ...scope },
        entryCount: selected.length,
        expiresAt: Date.now() + 120_000,
        ...(policy ? { policy } : {}),
      };
      // Bounded, one-use, monotonic expiry. UI cannot supply arbitrary purge paths.
      while (recycleReviewsRef.current.size >= 8)
        recycleReviewsRef.current.delete(
          recycleReviewsRef.current.keys().next().value!,
        );
      recycleReviewsRef.current.set(review.token, {
        review: structuredClone(review),
        ids: selected,
        deadline: performance.now() + 120_000,
      });
      return review;
    },
    [assertRecycleScope, flushPendingSave],
  );
  const reviewPurge = useCallback<ConnectionRecycleBinApi["reviewPurge"]>(
    (ids, scope) =>
      makeRecycleReview("purge", scope, ids === null ? null : [...ids]),
    [makeRecycleReview],
  );
  const reviewRetention = useCallback<
    ConnectionRecycleBinApi["reviewRetention"]
  >(
    (policy, scope) => makeRecycleReview("retention", scope, null, policy),
    [makeRecycleReview],
  );
  const cancelReview = useCallback((token: string) => {
    recycleReviewsRef.current.delete(token);
  }, []);
  const commitReview = useCallback<ConnectionRecycleBinApi["commitReview"]>(
    async (token) => {
      const pending = recycleReviewsRef.current.get(token);
      recycleReviewsRef.current.delete(token);
      if (!pending || performance.now() >= pending.deadline)
        throw new Error(
          "Recycle Bin review expired or was cancelled. Review the action again.",
        );
      return runRecycleMutation(
        pending.review.scope,
        (connections, bin, now, operationId) => {
          if (performance.now() >= pending.deadline)
            throw new Error(
              "Recycle Bin review expired. Review the action again.",
            );
          if (pending.review.kind === "retention") {
            const currentIds = expiredRecycleBinIds(
              bin,
              now,
              pending.review.policy,
            ).sort();
            const reviewedIds = [...pending.ids].sort();
            if (
              currentIds.length !== reviewedIds.length ||
              currentIds.some((id, index) => id !== reviewedIds[index])
            )
              throw new Error(
                "More entries expired since the retention preview. Review the updated count again.",
              );
          }
          const selected = new Set(pending.ids);
          return {
            connections,
            bin: {
              ...bin,
              revision: operationId,
              policy: pending.review.policy ?? bin.policy,
              entries: bin.entries.filter((entry) => !selected.has(entry.id)),
            },
            purged: selected.size,
          };
        },
      );
    },
    [runRecycleMutation],
  );

  // Only the loaded, unlocked owner is eligible. No inactive databases or vaults
  // are scanned. Failed writes retain the recoverable dirty database snapshot.
  useEffect(() => {
    if (
      !state.recycleBinData?.entries.length ||
      state.recycleBinData.policy.mode === "forever"
    )
      return;
    const expire = () => {
      if (recycleBusyRef.current) return;
      let scope: RecycleBinScope;
      try {
        scope = captureRecycleScope();
      } catch {
        return;
      }
      if (!expiredRecycleBinIds(recycleBinRef.current, Date.now()).length)
        return;
      void runRecycleMutation(scope, (connections, bin, now, operationId) => {
        const expiredIds = new Set(expiredRecycleBinIds(bin, now));
        return {
          connections,
          bin: expiredIds.size
            ? {
                ...bin,
                revision: operationId,
                entries: bin.entries.filter(
                  (entry) => !expiredIds.has(entry.id),
                ),
              }
            : bin,
          purged: expiredIds.size,
        };
      }).catch(() => {
        /* The durable writer retains failed state for retry. */
      });
    };
    expire();
    const timer = setInterval(expire, 3_600_000);
    return () => clearInterval(timer);
  }, [captureRecycleScope, runRecycleMutation, state.recycleBinData]);

  const recycleBin = useMemo<ConnectionRecycleBinApi>(() => {
    // The external access event advances this invalidation epoch even when the
    // private payload stays unchanged. It must invalidate this redacted view.
    void recycleAccessGeneration;
    let scope: RecycleBinScope | null = null;
    try {
      if (!recycleLoading) scope = captureRecycleScope();
    } catch {
      /* Closed/locked/loading. */
    }
    const bin = state.recycleBinData ?? emptyRecycleBin();
    return {
      snapshot: scope
        ? {
            scope,
            policy: { ...bin.policy },
            entries: recycleBinRows(bin, state.connections),
          }
        : null,
      busy: recycleBusy,
      archive,
      restore,
      reviewPurge,
      reviewRetention,
      commitReview,
      cancelReview,
    };
  }, [
    state.recycleBinData,
    state.connections,
    recycleBusy,
    recycleAccessGeneration,
    recycleLoading,
    captureRecycleScope,
    archive,
    restore,
    reviewPurge,
    reviewRetention,
    commitReview,
    cancelReview,
  ]);

  const assertAutomationScope = useCallback(
    (expected: DatabaseAutomationScope) => {
      let current: RecycleBinScope;
      try {
        current = captureRecycleScope();
      } catch {
        throw new AutomationLibraryAccessError({
          code: "database-unavailable",
          message:
            "Open and unlock the exact owning database to access its automation library.",
          retryable: true,
        });
      }
      if (
        current.databaseId !== expected.databaseId ||
        current.generation !== expected.generation
      )
        throw new AutomationLibraryAccessError({
          code: "access-changed",
          message:
            "The owning database changed. Reload and review its library before continuing.",
          retryable: true,
        });
    },
    [captureRecycleScope],
  );
  const automationLibrary = useMemo<DatabaseAutomationApi>(() => {
    void recycleAccessGeneration;
    let scope: DatabaseAutomationScope | null = null;
    try {
      if (!recycleLoading) {
        const current = captureRecycleScope();
        scope = {
          databaseId: current.databaseId,
          generation: current.generation,
        };
      }
    } catch {
      /* Locked/closed/loading libraries remain private. */
    }
    const requireDesktop = async () => {
      if (!(await getInvoke()))
        throw new AutomationLibraryAccessError({
          code: "desktop-required",
          message:
            "Database automation libraries require the desktop app. No side store or browser fallback was created.",
          retryable: true,
        });
    };
    return {
      scope,
      changeRevision: automationChangeRevision,
      async read(expectedScope) {
        expectedScope = { ...expectedScope };
        assertAutomationScope(expectedScope);
        if (automationFaultRef.current)
          throw new Error(
            "The database library write could not be verified. Reload the database before reading or retrying; the prior preview was not replaced.",
          );
        await requireDesktop();
        assertAutomationScope(expectedScope);
        await flushPendingSave();
        assertAutomationScope(expectedScope);
        const target = activeDatabaseTargetRef.current;
        if (!target?.verifyCurrent)
          throw new Error(
            "Database content verification is unavailable. Reopen the updated desktop app before using this library.",
          );
        await target.verifyCurrent();
        assertAutomationScope(expectedScope);
        return normalizeDatabaseAutomationLibrary(
          loadedStorageRef.current?.automationLibrary,
        );
      },
      async compareAndSwap(expectedScope, expected, replacement) {
        expectedScope = { ...expectedScope };
        const reviewed = normalizeDatabaseAutomationLibrary(expected);
        const proposed = normalizeDatabaseAutomationLibrary(replacement);
        if (proposed.revision !== reviewed.revision + 1)
          throw new Error("Invalid automation library revision.");
        assertAutomationScope(expectedScope);
        if (automationFaultRef.current)
          throw new Error(
            "The database library write could not be verified. Reload before applying another edit.",
          );
        if (automationBusyRef.current)
          throw new Error(
            "Another automation library write is pending. Reload before retrying.",
          );
        automationBusyRef.current = true;
        try {
          await requireDesktop();
          assertAutomationScope(expectedScope);
          await flushPendingSave();
          assertAutomationScope(expectedScope);
          const current = normalizeDatabaseAutomationLibrary(
            loadedStorageRef.current?.automationLibrary,
          );
          if (JSON.stringify(current) !== JSON.stringify(reviewed))
            throw new AutomationLibraryAccessError({
              code: "conflict",
              message:
                "The database library changed. Reload and review before saving.",
              retryable: true,
            });
          const proposedSnapshot = {
            ...buildStorageSnapshot(),
            automationLibrary: proposed,
          };
          const target = activeDatabaseTargetRef.current!;
          // Serialize with connection autosave, but do not publish or mark the
          // private edit dirty until the native durable write has succeeded.
          const write = (async () => {
            try {
              await target.save(proposedSnapshot);
              assertAutomationScope(expectedScope);
              loadedStorageRef.current = {
                ...loadedStorageRef.current!,
                automationLibrary: proposed,
              };
              setAutomationChangeRevision((value) => value + 1);
            } catch (error) {
              if (
                expectedScope.generation === loadGenerationRef.current &&
                target === activeDatabaseTargetRef.current
              )
                automationFaultRef.current = true;
              throw error;
            }
          })();
          saveLoopRef.current = write;
          try {
            await write;
          } finally {
            if (saveLoopRef.current === write) saveLoopRef.current = null;
          }
          // Edits made while the native write was pending keep their own dirty
          // revision and now save against the advanced content baseline.
          if (dirtyRevisionRef.current > persistedRevisionRef.current)
            await flushPendingSave();
        } finally {
          automationBusyRef.current = false;
        }
      },
    };
  }, [
    recycleAccessGeneration,
    recycleLoading,
    captureRecycleScope,
    assertAutomationScope,
    flushPendingSave,
    buildStorageSnapshot,
    automationChangeRevision,
  ]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [
    state.connections,
    state.tabGroups,
    state.recycleBinData,
    databaseManager,
  ]);

  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      dispatchAndFlush,
      persistence,
      saveData,
      flushPendingSave,
      loadData,
      recycleBin,
      automationLibrary,
      databaseAvailability,
    }),
    [
      state,
      dispatch,
      dispatchAndFlush,
      persistence,
      saveData,
      flushPendingSave,
      loadData,
      recycleBin,
      automationLibrary,
      databaseAvailability,
    ],
  );

  return (
    <ConnectionContext.Provider value={contextValue}>
      {children}
    </ConnectionContext.Provider>
  );
};
