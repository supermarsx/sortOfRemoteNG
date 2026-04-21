import React, { createContext } from "react";
import {
  Connection,
  ConnectionSession,
  ConnectionFilter,
  TabGroup,
} from "../types/connection/connection";

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
  /** IDs of all selected connections (for multi-select via Ctrl/Shift) */
  selectedConnectionIds: Set<string>;
  /** Applied filter options for the connection list */
  filter: ConnectionFilter;
  /** Indicates whether connection data is being loaded */
  isLoading: boolean;
  /** Tracks whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Tab group definitions */
  tabGroups: TabGroup[];
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
  | { type: "TOGGLE_SELECT_CONNECTION"; payload: { id: string; ctrl: boolean; shift: boolean } }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_FILTER"; payload: Partial<ConnectionFilter> }
  | { type: "ADD_SESSION"; payload: ConnectionSession }
  | { type: "UPDATE_SESSION"; payload: ConnectionSession }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "SET_SESSIONS"; payload: ConnectionSession[] }
  | { type: "REORDER_SESSIONS"; payload: { fromIndex: number; toIndex: number } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_SIDEBAR_COLLAPSED"; payload: boolean }
  | { type: "ADD_TAB_GROUP"; payload: TabGroup }
  | { type: "UPDATE_TAB_GROUP"; payload: TabGroup }
  | { type: "REMOVE_TAB_GROUP"; payload: string }
  | { type: "SET_TAB_GROUPS"; payload: TabGroup[] };

export interface ConnectionContextType {
  state: ConnectionState;
  dispatch: React.Dispatch<ConnectionAction>;
  saveData: () => Promise<void>;
  loadData: () => Promise<void>;
}

export const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);
