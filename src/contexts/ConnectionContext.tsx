import React, { createContext, useContext, useReducer, useEffect } from "react";
import {
  Connection,
  ConnectionSession,
  ConnectionFilter,
} from "../types/connection";
import { CollectionManager } from "../utils/collectionManager";
import { StorageData } from "../utils/storage";

/**
 * Describes the shape of the connection related state used by the application.
 */
interface ConnectionState {
  /** List of all saved connections */
  connections: Connection[];
  /** Active connection sessions */
  sessions: ConnectionSession[];
  /** Currently selected connection in the UI */
  selectedConnection: Connection | null;
  /** Applied filter options for the connection list */
  filter: ConnectionFilter;
  /** Indicates whether connection data is being loaded */
  isLoading: boolean;
  /** Tracks whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
}

/**
 * Union of actions that can modify the connection state.
 */
type ConnectionAction =
  | { type: "SET_CONNECTIONS"; payload: Connection[] }
  | { type: "ADD_CONNECTION"; payload: Connection }
  | { type: "UPDATE_CONNECTION"; payload: Connection }
  | { type: "DELETE_CONNECTION"; payload: string }
  | { type: "SELECT_CONNECTION"; payload: Connection | null }
  | { type: "SET_FILTER"; payload: Partial<ConnectionFilter> }
  | { type: "ADD_SESSION"; payload: ConnectionSession }
  | { type: "UPDATE_SESSION"; payload: ConnectionSession }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "TOGGLE_SIDEBAR" };

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

/**
 * Reducer managing all connection state transitions.
 */
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

export const ConnectionContext = createContext<{
  state: ConnectionState;
  dispatch: React.Dispatch<ConnectionAction>;
  saveData: () => Promise<void>;
  loadData: () => Promise<void>;
} | null>(null);

export const useConnections = () => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnections must be used within a ConnectionProvider");
  }
  return context;
};

/**
 * Provides connection state and helper actions to descendant components.
 */
export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(connectionReducer, initialState);
  const collectionManager = CollectionManager.getInstance();

  const saveData = async () => {
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
  };

  const loadData = async () => {
    try {
      const data = await collectionManager.loadCurrentCollectionData();
      if (data && data.connections) {
        // Convert date strings back to Date objects
        const connections = data.connections.map((conn: any) => ({
          ...conn,
          createdAt: new Date(conn.createdAt),
          updatedAt: new Date(conn.updatedAt),
          lastConnected: conn.lastConnected
            ? new Date(conn.lastConnected)
            : undefined,
        }));
        // Restore previous sessions and connections from storage
        dispatch({ type: "SET_CONNECTIONS", payload: connections });
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      throw error;
    }
  };

  // Auto-save whenever the list of connections is modified
  useEffect(() => {
    if (collectionManager.getCurrentCollection()) {
      // Persist updated connections to storage
      saveData().catch(console.error);
    }
  }, [state.connections]);

  return (
    <ConnectionContext.Provider value={{ state, dispatch, saveData, loadData }}>
      {children}
    </ConnectionContext.Provider>
  );
};
