/**
 * Pure reconciliation of persisted workspace tabs against the backend sessions
 * that are still alive after a webview reload.
 *
 * No I/O, no React, no clock: given the same inputs it always returns the same
 * plan, which keeps the "adopt live / mark dead / offer reconnect" decision
 * table-testable.
 */

/** Non-secret description of a backend session that is currently alive. */
export interface LiveSessionDescriptor {
  protocol: string;
  backendSessionId: string;
  /** False when the backend still lists the session but its transport is gone. */
  alive: boolean;
  host?: string;
  port?: number;
  username?: string;
  /** Tab id the frontend bound to this backend session, when the registry knows it. */
  frontendSessionId?: string;
  connectionId?: string;
  /** Display title from the unified registry (`user@host` or a label). */
  title?: string;
  /** Registry state: connected | detached | disconnected. */
  state?: string;
  /** Replay-ring position (ssh, telnet, serial) from the unified registry. */
  buffer?: { generation: number; sequenceEnd: number };
  /** Backend claim bookkeeping: who last claimed it and when the reaper acts. */
  orphan?: {
    claimed: boolean;
    unclaimedForSecs: number;
    reapInSecs: number | null;
  };
}

/** The subset of a persisted tab the reconciler needs. */
export interface ReconcilePersistedTab {
  tabId: string;
  protocol: string;
  backendSessionId?: string;
  order?: number;
}

export type TabReconcileAction =
  /** Backend session is alive: bind the tab to it and replay/attach. */
  | "adopt"
  /** Backend session is gone: show the tab disconnected with an explanation. */
  | "mark-dead"
  /** No backend session was recorded: dial normally (legacy reconnect). */
  | "reconnect";

export interface ReconciledTab {
  tabId: string;
  action: TabReconcileAction;
  /** Present for "adopt" only. */
  backendSessionId?: string;
  /** Human-readable explanation for "mark-dead". */
  reason?: string;
}

export interface ReconcileOptions {
  /** `reconnectOnReload`: when false, dead tabs stay disconnected, no redial. */
  reconnectOnReload: boolean;
  /** `adoptLiveSessionsOnReload`: false falls back to always redialling. */
  adoptLiveSessions?: boolean;
}

export interface ReconcileInput {
  tabs: readonly ReconcilePersistedTab[];
  live: readonly LiveSessionDescriptor[];
  activeTabId?: string;
  options: ReconcileOptions;
}

export interface ReconcileResult {
  /** Tabs in restoration order (persisted order first, stable for ties). */
  tabs: ReconciledTab[];
  activeTabId?: string;
  /** Live sessions no tab claims: offer Adopt / Close in the session manager. */
  orphans: LiveSessionDescriptor[];
  /** Persisted tabs dropped as duplicates. */
  droppedDuplicateTabIds: string[];
}

export const SESSION_ENDED_WHILE_AWAY =
  "Session ended while the UI was away. Reconnect to start a new one.";

const liveKey = (protocol: string, id: string) => `${protocol}\0${id}`;

export function reconcileWorkspace(input: ReconcileInput): ReconcileResult {
  const adoptEnabled = input.options.adoptLiveSessions !== false;

  const liveByKey = new Map<string, LiveSessionDescriptor>();
  for (const descriptor of input.live) {
    if (!descriptor.backendSessionId) continue;
    const key = liveKey(descriptor.protocol, descriptor.backendSessionId);
    if (!liveByKey.has(key)) liveByKey.set(key, descriptor);
  }

  // Stable sort by persisted order; ties and missing order keep input order.
  const indexed = input.tabs.map((tab, index) => ({ tab, index }));
  indexed.sort((a, b) => {
    const ao = a.tab.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.tab.order ?? Number.MAX_SAFE_INTEGER;
    return ao !== bo ? ao - bo : a.index - b.index;
  });

  const seenTabs = new Set<string>();
  const claimed = new Set<string>();
  const droppedDuplicateTabIds: string[] = [];
  const tabs: ReconciledTab[] = [];

  for (const { tab } of indexed) {
    if (seenTabs.has(tab.tabId)) {
      droppedDuplicateTabIds.push(tab.tabId);
      continue;
    }
    seenTabs.add(tab.tabId);

    const dead = (reason: string): ReconciledTab => ({
      tabId: tab.tabId,
      action: input.options.reconnectOnReload ? "reconnect" : "mark-dead",
      reason,
    });

    if (!tab.backendSessionId) {
      tabs.push({ tabId: tab.tabId, action: "reconnect" });
      continue;
    }

    const key = liveKey(tab.protocol, tab.backendSessionId);
    const descriptor = liveByKey.get(key);
    if (!adoptEnabled) {
      tabs.push({ tabId: tab.tabId, action: "reconnect" });
      continue;
    }
    if (!descriptor || !descriptor.alive) {
      tabs.push(dead(SESSION_ENDED_WHILE_AWAY));
      continue;
    }
    if (claimed.has(key)) {
      // Two tabs recorded the same backend session: only one may own it.
      tabs.push(
        dead(
          "Another tab already owns this live session; reconnect to open a new one.",
        ),
      );
      continue;
    }
    claimed.add(key);
    tabs.push({
      tabId: tab.tabId,
      action: "adopt",
      backendSessionId: tab.backendSessionId,
    });
  }

  const orphans: LiveSessionDescriptor[] = [];
  for (const [key, descriptor] of liveByKey) {
    if (!descriptor.alive || claimed.has(key)) continue;
    orphans.push(descriptor);
  }

  const activeTabId =
    input.activeTabId && seenTabs.has(input.activeTabId)
      ? input.activeTabId
      : tabs[0]?.tabId;

  return { tabs, activeTabId, orphans, droppedDuplicateTabIds };
}
