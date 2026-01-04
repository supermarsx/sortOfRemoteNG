import React, { useReducer, useEffect, useCallback, useMemo } from "react";
import { CollectionManager } from "../utils/collectionManager";
import { StorageData } from "../utils/storage";
import {
  ConnectionState,
  ConnectionAction,
  ConnectionContext
} from "./ConnectionContextTypes";

const initialState: ConnectionState = {
  connections: [],
  sessions: [],
  selectedConnection: null,
  filter: {
    searchTerm: "",
    protocols: [],
    tags: [],
    colorTags: [],
    showRecent: false,
    showFavorites: false,
  },
  isLoading: false,
  sidebarCollapsed: false,
};

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
      // Track the currently selected connection
      return { ...state, selectedConnection: action.payload };
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
  const [state, dispatch] = useReducer(connectionReducer, initialState);
  const collectionManager = useMemo(() => CollectionManager.getInstance(), []);

  const saveData = useCallback(async () => {
    try {
      const data: StorageData = {
        connections: state.connections,
        settings: {},
        timestamp: Date.now(),
      };

      await collectionManager.saveCurrentCollectionData(data);
    } catch (error) {
      console.error("Failed to save data:", error);
      throw error;
    }
  }, [state.connections, collectionManager]);

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
        dispatch({ type: "SET_CONNECTIONS", payload: connections });
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      throw error;
    }
  }, [collectionManager]);

  // Auto-save whenever the list of connections is modified
  useEffect(() => {
    if (collectionManager.getCurrentCollection()) {
      // Persist updated connections to storage
      saveData().catch(console.error);
    }
  }, [state.connections, collectionManager, saveData]);

  return (
    <ConnectionContext.Provider value={{ state, dispatch, saveData, loadData }}>
      {children}
    </ConnectionContext.Provider>
  );
};