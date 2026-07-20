import {
  Connection,
  ConnectionSession,
  SessionVpnLeaseBinding,
  SessionVpnLeaseCleanupQuarantine,
  SessionVpnLeaseReleaseTombstone,
  TabGroup,
} from "./connection/connection";

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

/**
 * The only session lifecycle data a detached webview may send to main.
 * Nullable values explicitly clear an optional field across JSON IPC; omitted
 * values leave the canonical main-window value untouched.
 */
export interface SessionLifecyclePatch {
  /** Sender's monotonic lifecycle version. Older/equal patches are ignored. */
  revision?: number;
  /** Native actor generation, ordered independently from status/cleanup writes. */
  actorGeneration?: number;
  /** Explicit writer provenance used to resolve equal-generation conflicts. */
  writerId?: string;
  backendSessionId?: string | null;
  shellId?: string | null;
  vpnLeaseOwnerId?: string | null;
  vpnLeaseOwnerIds?: string[] | null;
  vpnLeaseBindings?: SessionVpnLeaseBinding[] | null;
  vpnLeaseReleaseTombstones?: SessionVpnLeaseReleaseTombstone[] | null;
  vpnLeaseCleanupQuarantine?: SessionVpnLeaseCleanupQuarantine | null;
  status?: ConnectionSession["status"];
  errorMessage?: string | null;
  lastActivity?: string | null;
}

/** Commands sent from any window to the main window's WindowManager. */
export type WindowCommand =
  | {
      type: "MOVE_SESSION";
      sessionId: string;
      targetWindow: WindowId;
      sourceWindow?: WindowId;
      insertIndex?: number;
    }
  | {
      type: "CLOSE_SESSION";
      sessionId: string;
      lifecycle?: SessionLifecyclePatch;
      /** Detached-window close acknowledgement correlation. */
      requestId?: string;
      sourceWindow?: WindowId;
    }
  | {
      type: "REATTACH_SESSION";
      sessionId: string;
      terminalBuffer?: string;
      lifecycle?: SessionLifecyclePatch;
      sourceWindow?: WindowId;
    }
  | {
      type: "SYNC_SESSION_LIFECYCLE";
      sessionId: string;
      lifecycle: SessionLifecyclePatch;
    }
  | { type: "REORDER_SESSIONS"; windowId: WindowId; sessionIds: string[] }
  | { type: "WINDOW_READY"; windowId: WindowId }
  | { type: "WINDOW_CLOSING"; windowId: WindowId }
  | { type: "SET_ACTIVE_SESSION"; windowId: WindowId; sessionId: string }
  | { type: "RENAME_SESSION"; sessionId: string; name: string }
  | { type: "RECONNECT_SESSION"; sessionId: string }
  | { type: "DUPLICATE_SESSION"; sessionId: string }
  | { type: "REVEAL_IN_SIDEBAR"; connectionId: string }
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

export const WINDOW_SESSION_CLOSE_RESULT_EVENT = "wm:close-result";

/** Result returned by the main-window authoritative session closer. */
export interface WindowSessionCloseResult {
  requestId: string;
  sessionId: string;
  success: boolean;
}
