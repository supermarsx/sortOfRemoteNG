import React, { useReducer, useEffect, useCallback, useMemo, useRef } from "react";
import { CollectionManager } from "../utils/connection/collectionManager";
import { StorageData } from "../utils/storage/storage";
import { SettingsManager } from "../utils/settings/settingsManager";
import {
  ConnectionState,
  ConnectionAction,
  ConnectionContext
} from "./ConnectionContextTypes";
import { Connection } from "../types/connection/connection";

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
    sortBy: 'custom',
    sortDirection: 'asc',
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

const connectionReducer = (
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState => {
  switch (action.type) {
    case "SET_CONNECTIONS":
      // Replace all connections with a new list
      return { ...state, connections: action.payload };
    case "ADD_CONNECTION":
      // Append a new connection to the list
      return { ...state, connections: [...state.connections, action.payload] };
    case "UPDATE_CONNECTION":
      // Update an existing connection by id
      return {
        ...state,
        connections: state.connections.map((conn) =>
          conn.id === action.payload.id ? action.payload : conn,
        ),
      };
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
      return { ...state, selectedConnection: null, selectedConnectionIds: new Set() };
    case "SET_FILTER":
      // Update connection list filters
      return { ...state, filter: { ...state.filter, ...action.payload } };
    case "ADD_SESSION":
      // Register a new connection session
      return { ...state, sessions: [...state.sessions, action.payload] };
    case "UPDATE_SESSION":
      // Modify an existing session
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.payload.id ? action.payload : session,
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
  const collectionManager = useMemo(() => CollectionManager.getInstance(), []);
  const settingsManager = useMemo(() => SettingsManager.getInstance(), []);
  // Track whether data has been loaded to prevent overwriting on initial mount
  const hasLoadedRef = useRef(false);
  // Track if this is the first render to skip auto-save on mount
  const isInitialMountRef = useRef(true);

  // Wrap dispatch to add action logging
  const dispatch = useCallback((action: ConnectionAction) => {
    // Log specific actions
    switch (action.type) {
      case "ADD_CONNECTION": {
        const conn = action.payload;
        settingsManager.logAction(
          'info',
          conn.isGroup ? 'Folder created' : 'Connection created',
          conn.id,
          `Name: "${conn.name}"${conn.hostname ? `, Host: ${conn.hostname}` : ''}${conn.protocol ? `, Protocol: ${conn.protocol}` : ''}`
        );
        break;
      }
      case "UPDATE_CONNECTION": {
        const conn = action.payload;
        settingsManager.logAction(
          'info',
          'Connection edited',
          conn.id,
          `Name: "${conn.name}" updated`
        );
        break;
      }
      case "DELETE_CONNECTION": {
        settingsManager.logAction(
          'info',
          'Connection deleted',
          action.payload,
          `Connection ID: ${action.payload}`
        );
        break;
      }
      case "ADD_SESSION": {
        const session = action.payload;
        settingsManager.logAction(
          'info',
          'Session opened',
          session.connectionId,
          `Session "${session.name}" opened via ${session.protocol}`
        );
        break;
      }
      case "REMOVE_SESSION": {
        settingsManager.logAction(
          'info',
          'Session removed',
          undefined,
          `Session ID: ${action.payload}`
        );
        break;
      }
      case "REORDER_SESSIONS": {
        settingsManager.logAction(
          'debug',
          'Sessions reordered',
          undefined,
          `Moved from index ${action.payload.fromIndex} to ${action.payload.toIndex}`
        );
        break;
      }
    }
    
    baseDispatch(action);
  }, [settingsManager]);

  // Use a ref so saveData has a stable identity and doesn't cause effect re-runs
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;

  const saveData = useCallback(async () => {
    try {
      const data: StorageData = {
        connections: connectionsRef.current,
        settings: {},
        timestamp: Date.now(),
      };

      await collectionManager.saveCurrentCollectionData(data);
    } catch (error) {
      console.error("Failed to save data:", error);
      throw error;
    }
  }, [collectionManager]);

  const loadData = useCallback(async () => {
    try {
      const data = await collectionManager.loadCurrentCollectionData();
      if (data && data.connections) {
        // Convert date strings back to Date objects
        const connections = data.connections.map((conn: any) => ({
          ...conn,
          createdAt: conn.createdAt ? new Date(conn.createdAt) : new Date(),
          updatedAt: conn.updatedAt ? new Date(conn.updatedAt) : new Date(),
        }));
        baseDispatch({ type: "SET_CONNECTIONS", payload: connections });
      }
      // Mark as loaded after successfully loading data
      hasLoadedRef.current = true;
    } catch (error) {
      console.error("Failed to load data:", error);
      throw error;
    }
  }, [collectionManager]);

  // Auto-save whenever the list of connections is modified
  // BUT only after data has been loaded to prevent overwriting on mount/HMR
  useEffect(() => {
    // Skip auto-save on initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    // Only save if we've loaded data first and have a collection selected
    if (hasLoadedRef.current && collectionManager.getCurrentCollection()) {
      saveData().catch(console.error);
    }
  // saveData is stable (depends only on collectionManager) — safe to omit from lint
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connections, collectionManager]);

  return (
    <ConnectionContext.Provider value={{ state, dispatch, saveData, loadData }}>
      {children}
    </ConnectionContext.Provider>
  );
};
