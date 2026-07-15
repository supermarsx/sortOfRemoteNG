import type { ConnectionSession } from "../../types/connection/connection";
import type { ConnectionBehaviorActionV1 } from "../../types/connection/behavior";

export const BEHAVIOR_ACTIVATE_SESSION_EVENT =
  "sortofremoteng:behavior-activate-session" as const;

export interface BehaviorActivateSessionPayload {
  windowId: string;
  sessionId: string;
}

type FocusSessionAction = Extract<
  ConnectionBehaviorActionV1,
  { type: "focusSession" }
>;
type SetOwningWindowStateAction = Extract<
  ConnectionBehaviorActionV1,
  { type: "setOwningWindowState" }
>;

export interface BehaviorWindowHandle {
  isMinimized(): Promise<boolean>;
  minimize(): Promise<void>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
}

export interface BehaviorWindowActionDependencies {
  getWindow(windowId: string): Promise<BehaviorWindowHandle | undefined>;
  activateSession(windowId: string, sessionId: string): Promise<boolean>;
  closeSession(sessionId: string): Promise<boolean>;
}

export const getBehaviorOwningWindowId = (
  session: ConnectionSession,
): string =>
  session.layout?.isDetached && session.layout.windowId
    ? session.layout.windowId
    : "main";

/** Truthful, injectable adapters for behavior actions that affect windows. */
export class BehaviorWindowActionRuntime {
  private readonly closeInFlight = new Set<string>();

  constructor(
    private readonly dependencies: BehaviorWindowActionDependencies,
  ) {}

  async focusSession(
    session: ConnectionSession,
    action: FocusSessionAction,
  ): Promise<boolean> {
    const windowId = getBehaviorOwningWindowId(session);
    const window = await this.dependencies.getWindow(windowId);
    if (!window) return false;
    if (!(await this.dependencies.activateSession(windowId, session.id))) {
      return false;
    }

    if (action.restoreIfMinimized !== false && (await window.isMinimized())) {
      await window.unminimize();
    }
    if (action.raiseWindow !== false) await window.setFocus();
    return true;
  }

  async setOwningWindowState(
    session: ConnectionSession,
    action: SetOwningWindowStateAction,
  ): Promise<boolean> {
    const windowId = getBehaviorOwningWindowId(session);
    const window = await this.dependencies.getWindow(windowId);
    if (!window) return false;

    switch (action.state) {
      case "focused":
        if (!(await this.dependencies.activateSession(windowId, session.id))) {
          return false;
        }
        await window.setFocus();
        return true;
      case "minimized":
        await window.minimize();
        return true;
      case "restored":
        if (await window.isMinimized()) await window.unminimize();
        return true;
    }
  }

  async closeTab(session: ConnectionSession): Promise<boolean> {
    if (this.closeInFlight.has(session.id)) return false;
    this.closeInFlight.add(session.id);
    try {
      return await this.dependencies.closeSession(session.id);
    } finally {
      this.closeInFlight.delete(session.id);
    }
  }
}
