import React, { createContext, useContext, useReducer, useEffect, useState } from 'react';
import { Connection, ConnectionSession, ConnectionFilter } from '../types/connection';
import { CollectionManager } from '../utils/collectionManager';
import { StorageData } from '../utils/storage';

interface ConnectionState {
  connections: Connection[];
  sessions: ConnectionSession[];
  selectedConnection: Connection | null;
  filter: ConnectionFilter;
  isLoading: boolean;
  sidebarCollapsed: boolean;
}

type ConnectionAction =
  | { type: 'SET_CONNECTIONS'; payload: Connection[] }
  | { type: 'ADD_CONNECTION'; payload: Connection }
  | { type: 'UPDATE_CONNECTION'; payload: Connection }
  | { type: 'DELETE_CONNECTION'; payload: string }
  | { type: 'SELECT_CONNECTION'; payload: Connection | null }
  | { type: 'SET_FILTER'; payload: Partial<ConnectionFilter> }
  | { type: 'ADD_SESSION'; payload: ConnectionSession }
  | { type: 'UPDATE_SESSION'; payload: ConnectionSession }
  | { type: 'REMOVE_SESSION'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'TOGGLE_SIDEBAR' };

const initialState: ConnectionState = {
  connections: [],
  sessions: [],
  selectedConnection: null,
  filter: {
    searchTerm: '',
    protocols: [],
    tags: [],
    colorTags: [],
    showRecent: false,
    showFavorites: false,
  },
  isLoading: false,
  sidebarCollapsed: false,
};

const connectionReducer = (state: ConnectionState, action: ConnectionAction): ConnectionState => {
  switch (action.type) {
    case 'SET_CONNECTIONS':
      return { ...state, connections: action.payload };
    case 'ADD_CONNECTION':
      return { ...state, connections: [...state.connections, action.payload] };
    case 'UPDATE_CONNECTION':
      return {
        ...state,
        connections: state.connections.map(conn =>
          conn.id === action.payload.id ? action.payload : conn
        ),
      };
    case 'DELETE_CONNECTION':
      return {
        ...state,
        connections: state.connections.filter(conn => conn.id !== action.payload),
      };
    case 'SELECT_CONNECTION':
      return { ...state, selectedConnection: action.payload };
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.payload } };
    case 'ADD_SESSION':
      return { ...state, sessions: [...state.sessions, action.payload] };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.id ? action.payload : session
        ),
      };
    case 'REMOVE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter(session => session.id !== action.payload),
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'TOGGLE_SIDEBAR':
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
    throw new Error('useConnections must be used within a ConnectionProvider');
  }
  return context;
};

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
      console.error('Failed to save data:', error);
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
          lastConnected: conn.lastConnected ? new Date(conn.lastConnected) : undefined,
        }));
        dispatch({ type: 'SET_CONNECTIONS', payload: connections });
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      throw error;
    }
  };

  // Auto-save when connections change
  useEffect(() => {
    if (collectionManager.getCurrentCollection()) {
      saveData().catch(console.error);
    }
  }, [state.connections]);

  return (
    <ConnectionContext.Provider value={{ state, dispatch, saveData, loadData }}>
      {children}
    </ConnectionContext.Provider>
  );
};
