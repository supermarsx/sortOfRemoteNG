export const CONNECTION_BEHAVIOR_AUTOMATION_VERSION = 1 as const;

export const CONNECTION_BEHAVIOR_EVENT_TYPES = [
  "session.started",
  "session.connected",
  "session.connectFailed",
  "session.reconnectStarted",
  "session.reconnected",
  "session.reconnectFailed",
  "session.disconnected",
  "session.ended",
  "window.focused",
  "window.blurred",
  "window.minimized",
  "window.restored",
  "window.closeRequested",
  "window.closed",
] as const;

export type ConnectionBehaviorEventType =
  (typeof CONNECTION_BEHAVIOR_EVENT_TYPES)[number];

export const CONNECTION_BEHAVIOR_EVENT_REASONS = [
  "user",
  "remote",
  "network",
  "error",
  "appExit",
  "windowClose",
  "restore",
  "unknown",
] as const;

export type ConnectionBehaviorEventReason =
  (typeof CONNECTION_BEHAVIOR_EVENT_REASONS)[number];

export const CONNECTION_BEHAVIOR_WINDOW_KINDS = ["main", "detached"] as const;

export type ConnectionBehaviorWindowKind =
  (typeof CONNECTION_BEHAVIOR_WINDOW_KINDS)[number];

export type ConnectionBehaviorActionV1 =
  | {
      type: "notify";
      title?: string;
      message?: string;
      level?: "info" | "warning" | "error";
      sound?: "inherit" | "on" | "off";
    }
  | {
      type: "focusSession";
      raiseWindow?: boolean;
      restoreIfMinimized?: boolean;
    }
  | {
      type: "reconnect";
      delayMs?: number;
      maxAttempts?: number;
      backoff?: "fixed" | "exponential";
    }
  | {
      type: "closeTab";
      /** Phase 1 never bypasses the existing close/warning policy. */
      respectClosePolicy?: true;
    }
  | {
      type: "runCustomScript";
      scriptId: string;
      timeoutMs?: number;
    }
  | {
      type: "writeLog";
      level?: "info" | "warn" | "error";
      message?: string;
    }
  | {
      type: "setOwningWindowState";
      state: "focused" | "minimized" | "restored";
    };

export interface ConnectionBehaviorRuleFiltersV1 {
  reasons?: ConnectionBehaviorEventReason[];
  windowKinds?: ConnectionBehaviorWindowKind[];
}

export interface ConnectionBehaviorRuleOptionsV1 {
  delayMs?: number;
  cooldownMs?: number;
  oncePerSession?: boolean;
  stopOnActionError?: boolean;
}

export interface ConnectionBehaviorRuleV1 {
  id: string;
  name: string;
  /** Omitted is intentionally equivalent to enabled for compact persistence. */
  enabled?: boolean;
  event: ConnectionBehaviorEventType;
  when?: ConnectionBehaviorRuleFiltersV1;
  actions: ConnectionBehaviorActionV1[];
  options?: ConnectionBehaviorRuleOptionsV1;
}

export interface ConnectionBehaviorAutomationV1 {
  version: typeof CONNECTION_BEHAVIOR_AUTOMATION_VERSION;
  rules: ConnectionBehaviorRuleV1[];
}

export interface ConnectionBehaviorConnectionContext {
  id: string;
  name: string;
  protocol: string;
  hostname: string;
  port?: number;
}

export interface ConnectionBehaviorSessionContext {
  id: string;
  name: string;
  status: string;
}

export interface ConnectionBehaviorWindowContext {
  id: string;
  kind: ConnectionBehaviorWindowKind;
  activeSessionId?: string;
}

/**
 * Runtime event input deliberately exposes only an allowlist of non-credential
 * connection/session properties. The dispatcher rebuilds and sanitizes this
 * object before it reaches an action handler.
 */
export interface ConnectionBehaviorEventContextInput {
  eventId: string;
  parentEventId?: string;
  type: ConnectionBehaviorEventType;
  timestamp: number;
  source: string;
  reason?: ConnectionBehaviorEventReason;
  previousStatus?: string;
  connection: ConnectionBehaviorConnectionContext;
  session?: ConnectionBehaviorSessionContext;
  window?: ConnectionBehaviorWindowContext;
  error?: {
    message: string;
    code?: string;
  };
}

export type SafeConnectionBehaviorEventContext =
  ConnectionBehaviorEventContextInput;
