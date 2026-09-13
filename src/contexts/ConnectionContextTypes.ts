import React, { createContext } from "react";
import type {
  DatabaseRecycleBin,
  ConnectionRecycleBinApi,
} from "../types/connection/recycleBin";
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
  /** Private collection data; bin UI consumes the redacted facade instead. */
  recycleBinData?: DatabaseRecycleBin;
}

/**
 * Union of actions that can modify the connection state.
 */
export type ConnectionAction =
  | { type: "SET_CONNECTIONS"; payload: Connection[] }
  | { type: "ADD_CONNECTION"; payload: Connection }
  | { type: "UPDATE_CONNECTION"; payload: Connection }
  | {
      type: "UPDATE_HTTP_TRUSTED_REDIRECTS";
      payload: {
        databaseId: string;
        generation: number;
        changes: readonly import("../utils/security/trustedRedirectManagement").TrustedRedirectChange[];
      };
    }
  | { type: "DELETE_CONNECTION"; payload: string }
  | {
      type: "RECYCLE_CONNECTIONS";
      payload: { ids: readonly string[]; now: number; operationId: string };
    }
  | { type: "SET_RECYCLE_BIN"; payload: DatabaseRecycleBin }
  | {
      type: "APPLY_RECYCLE_BIN";
      payload: { connections: Connection[]; bin: DatabaseRecycleBin };
    }
  | { type: "SELECT_CONNECTION"; payload: Connection | null }
  | {
      type: "TOGGLE_SELECT_CONNECTION";
      payload: { id: string; ctrl: boolean; shift: boolean };
    }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_FILTER"; payload: Partial<ConnectionFilter> }
  | { type: "ADD_SESSION"; payload: ConnectionSession }
  | {
      type: "BIND_TOOL_DATABASE_OWNER";
      payload: { sessionId: string; databaseId: string; generation: number };
    }
  | {
      type: "UPDATE_SESSION";
      payload: Pick<ConnectionSession, "id"> & Partial<ConnectionSession>;
    }
  | { type: "REMOVE_SESSION"; payload: string }
  | { type: "SET_SESSIONS"; payload: ConnectionSession[] }
  | {
      type: "REORDER_SESSIONS";
      payload: { fromIndex: number; toIndex: number };
    }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_SIDEBAR_COLLAPSED"; payload: boolean }
  | { type: "ADD_TAB_GROUP"; payload: TabGroup }
  | { type: "UPDATE_TAB_GROUP"; payload: TabGroup }
  | { type: "REMOVE_TAB_GROUP"; payload: string }
  | { type: "SET_TAB_GROUPS"; payload: TabGroup[] };

export interface ConnectionPersistenceState {
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/** Authoritative current database access, independent of optional tool features. */
export interface DatabaseAvailability {
  status: "none" | "loading" | "ready" | "suspended" | "error";
  databaseId?: string;
  /** Changes when the loaded owner or its access lease changes. */
  generation: number;
}

export interface ConnectionContextType {
  state: ConnectionState;
  dispatch: React.Dispatch<ConnectionAction>;
  dispatchAndFlush: (action: ConnectionAction) => Promise<void>;
  persistence: ConnectionPersistenceState;
  saveData: () => Promise<void>;
  flushPendingSave: () => Promise<void>;
  loadData: (expectedDatabaseId?: string) => Promise<boolean>;
  /** Guarded synchronous Provider state, including updates awaiting a React commit. */
  getCurrentConnections?: (scope: {
    databaseId: string;
    generation: number;
  }) => readonly Connection[];
  /** Older embedded contexts omit this; database-dependent tools fail closed. */
  databaseAvailability?: DatabaseAvailability;
  /** Absent only in older embedded/test contexts; never fall back to side storage. */
  recycleBin?: ConnectionRecycleBinApi;
  automationLibrary?: import("../types/recording/automationLibrary").DatabaseAutomationApi;
  documents?: import("../types/documents/document").DatabaseDocumentStore;
  databaseSettings?: import("../types/settings/databaseSettings").DatabaseSettingsApi;
  credentialVault?: import("../types/security/databaseCredentialVault").DatabaseCredentialVaultApi;
}

export const ConnectionContext = createContext<
  ConnectionContextType | undefined
>(undefined);
