import React, { createContext } from "react";
import {
  Connection,
  ConnectionSession,
  ConnectionFilter,
} from "../types/connection";

/**
 * Describes the shape of the connection related state used by the application.
 */
export interface ConnectionState {
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
export type ConnectionAction =
  | { type: "SET_CONNECTIONS"; payload: Connection[] }
  | { type: "ADD_CONNECTION"; payload: Connection }
  | { type: "UPDATE_CONNECTION"; payload: Connection }
  | { type: "DELETE_CONNECTION"; payload: string }
  | { type: "SELECT_CONNECTION"; payload: Connection | null }
  | { type: "SET_FILTER"; payload: Partial<ConnectionFilter> }
  | { type: "ADD_SESSION"; payload: ConnectionSession }
  | { type: "UPDATE_SESSION"; payload: ConnectionSession }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "REORDER_SESSIONS"; payload: { fromIndex: number; toIndex: number } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_SIDEBAR_COLLAPSED"; payload: boolean };

export interface ConnectionContextType {
  state: ConnectionState;
  dispatch: React.Dispatch<ConnectionAction>;
  saveData: () => Promise<void>;
  loadData: () => Promise<void>;
}

export const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);
