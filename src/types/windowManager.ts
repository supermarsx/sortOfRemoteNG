import { Connection, ConnectionSession, TabGroup } from "./connection/connection";

/** Identifies which window a session lives in. */
export type WindowId = "main" | `detached-${string}`;

/** Registry entry for each known window. */
export interface WindowEntry {
  windowId: WindowId;
  /** Ordered list of session IDs assigned to this window. */
  sessionIds: string[];
  /** Currently focused tab in this window. */
  activeSessionId?: string;
  createdAt: number;
}

/** Centralized state tracking all windows and session ownership. */
export interface WindowRegistry {
  windows: Map<WindowId, WindowEntry>;
  /** Reverse lookup: sessionId → windowId. */
  sessionOwnership: Map<string, WindowId>;
}

/** Commands sent from any window to the main window's WindowManager. */
export type WindowCommand =
  | { type: "MOVE_SESSION"; sessionId: string; targetWindow: WindowId; insertIndex?: number }
  | { type: "CLOSE_SESSION"; sessionId: string }
  | { type: "REATTACH_SESSION"; sessionId: string; terminalBuffer?: string }
  | { type: "REORDER_SESSIONS"; windowId: WindowId; sessionIds: string[] }
  | { type: "WINDOW_READY"; windowId: WindowId }
  | { type: "WINDOW_CLOSING"; windowId: WindowId }
  | { type: "SET_ACTIVE_SESSION"; windowId: WindowId; sessionId: string }
  | {
      type: "DROP_ON_WINDOW";
      sessionId: string;
      sourceWindow: WindowId;
      screenX: number;
      screenY: number;
    };

/** Data pushed from main to a detached window after any state change. */
export interface WindowSessionSync {
  windowId: WindowId;
  sessions: ConnectionSession[];
  connections: Connection[];
  tabGroups: TabGroup[];
  activeSessionId?: string;
}
