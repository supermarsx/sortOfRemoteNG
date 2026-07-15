import type { ConnectionSession } from "../../types/connection/connection";
import type {
  ConnectionBehaviorEventType,
  ConnectionBehaviorWindowContext,
} from "../../types/connection/behavior";
import { isRealConnectionSession } from "../session/sessionClassification";

export const BEHAVIOR_WINDOW_LIFECYCLE_EVENT =
  "sortofremoteng:behavior-window-lifecycle" as const;

export type BehaviorWindowLifecycleEdge =
  | "focused"
  | "blurred"
  | "minimized"
  | "restored"
  | "closeRequested"
  | "closeCancelled"
  | "closed";

export interface BehaviorWindowLifecycleSignal {
  version: 1;
  eventId: string;
  edge: BehaviorWindowLifecycleEdge;
  timestamp: number;
  window: ConnectionBehaviorWindowContext;
  closeAttemptId?: string;
}

export interface AcceptedBehaviorWindowLifecycleEvent {
  eventId: string;
  parentEventId?: string;
  timestamp: number;
  type: Extract<ConnectionBehaviorEventType, `window.${string}`>;
  session: ConnectionSession;
  window: ConnectionBehaviorWindowContext;
}

interface WindowLifecycleState {
  focused?: boolean;
  minimized?: boolean;
  pendingClose?: {
    attemptId: string;
    requestEventId: string;
  };
  closed: boolean;
}

const publicEventType = (
  edge: Exclude<BehaviorWindowLifecycleEdge, "closeCancelled">,
): AcceptedBehaviorWindowLifecycleEvent["type"] => `window.${edge}`;

/**
 * Resolves a lifecycle signal to the only session it may describe. Signals
 * never fall back to another tab: the originating window's active real
 * session must still be owned by that exact window.
 */
export function resolveBehaviorWindowSession(
  signal: BehaviorWindowLifecycleSignal,
  sessions: readonly ConnectionSession[],
): ConnectionSession | undefined {
  const activeSessionId = signal.window.activeSessionId;
  if (!activeSessionId) return undefined;
  const session = sessions.find(
    (candidate) => candidate.id === activeSessionId,
  );
  if (!session || !isRealConnectionSession(session)) return undefined;

  if (signal.window.kind === "main") {
    return signal.window.id === "main" && !session.layout?.isDetached
      ? session
      : undefined;
  }

  return session.layout?.isDetached &&
    session.layout.windowId === signal.window.id
    ? session
    : undefined;
}

/**
 * Main-window coordinator for lifecycle edges from every webview. It owns
 * cross-window de-duplication and the close request/cancel/confirm state
 * machine before anything reaches the behavior dispatcher.
 */
export class BehaviorWindowLifecycleCoordinator {
  private readonly windowStates = new Map<string, WindowLifecycleState>();
  private readonly seenEventIds = new Set<string>();

  accept(
    signal: BehaviorWindowLifecycleSignal,
    sessions: readonly ConnectionSession[],
  ): AcceptedBehaviorWindowLifecycleEvent | undefined {
    if (signal.version !== 1 || this.seenEventIds.has(signal.eventId)) {
      return undefined;
    }
    this.seenEventIds.add(signal.eventId);

    const session = resolveBehaviorWindowSession(signal, sessions);
    if (!session) return undefined;

    const state = this.windowStates.get(signal.window.id) ?? { closed: false };
    this.windowStates.set(signal.window.id, state);

    switch (signal.edge) {
      case "focused":
        if (state.focused === true || state.closed) return undefined;
        state.focused = true;
        break;
      case "blurred":
        if (state.focused === false || state.closed) return undefined;
        state.focused = false;
        break;
      case "minimized":
        if (state.minimized === true || state.closed) return undefined;
        state.minimized = true;
        state.focused = false;
        break;
      case "restored":
        if (state.minimized === false || state.closed) return undefined;
        state.minimized = false;
        break;
      case "closeRequested": {
        if (!signal.closeAttemptId || state.pendingClose || state.closed) {
          return undefined;
        }
        state.pendingClose = {
          attemptId: signal.closeAttemptId,
          requestEventId: signal.eventId,
        };
        break;
      }
      case "closeCancelled":
        if (
          !signal.closeAttemptId ||
          state.pendingClose?.attemptId !== signal.closeAttemptId
        ) {
          return undefined;
        }
        state.pendingClose = undefined;
        return undefined;
      case "closed": {
        if (
          !signal.closeAttemptId ||
          state.pendingClose?.attemptId !== signal.closeAttemptId ||
          state.closed
        ) {
          return undefined;
        }
        const parentEventId = state.pendingClose.requestEventId;
        state.pendingClose = undefined;
        state.closed = true;
        return {
          eventId: signal.eventId,
          parentEventId,
          timestamp: signal.timestamp,
          type: "window.closed",
          session,
          window: signal.window,
        };
      }
    }

    return {
      eventId: signal.eventId,
      timestamp: signal.timestamp,
      type: publicEventType(signal.edge),
      session,
      window: signal.window,
    };
  }

  forgetWindow(windowId: string): void {
    this.windowStates.delete(windowId);
  }
}
