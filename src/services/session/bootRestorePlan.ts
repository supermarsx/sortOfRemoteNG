/**
 * Bridges persisted session rows (legacy `mremote-active-sessions` format and
 * the durable workspace snapshot) to the pure reconciler, and returns the rows
 * the restore loop should actually restore.
 *
 * - Rows whose backend session is still alive keep `backendSessionId`, so the
 *   protocol hook re-adopts the live session (SSH replay / RDP attach) instead
 *   of dialling a new one.
 * - Rows whose backend session is gone lose `backendSessionId`/`shellId` and
 *   are redialled (`reconnectOnReload`) exactly as before.
 * - Quarantined rows are never touched: their backend ids are cleanup
 *   evidence, not adoption candidates.
 */

import type { PersistedConnectionSession } from "../../utils/session/sessionPersistence";
import {
  reconcileWorkspace,
  type LiveSessionDescriptor,
  type ReconcileResult,
} from "./reconcileWorkspace";
import {
  ADOPTABLE_PROTOCOLS,
  type WorkspaceSnapshot,
} from "./workspaceSnapshot";

export interface BootRestorePlanInput {
  rows: readonly PersistedConnectionSession[];
  live: readonly LiveSessionDescriptor[];
  activeTabId?: string;
  reconnectOnReload: boolean;
  adoptLiveSessions: boolean;
  isQuarantined: (row: PersistedConnectionSession) => boolean;
  /**
   * Durable-snapshot recovery of a lost window: only rows that can be adopted
   * are restored. Everything else would be a surprise redial after an app
   * restart, which the legacy sessionStorage path never did.
   */
  adoptOnly?: boolean;
}

export interface BootRestorePlan {
  rows: PersistedConnectionSession[];
  adoptedTabIds: string[];
  deadTabIds: string[];
  activeTabId?: string;
  reconcile: ReconcileResult;
}

export function planBootRestore(input: BootRestorePlanInput): BootRestorePlan {
  const quarantined = input.rows.filter(input.isQuarantined);
  const candidates = input.rows.filter((row) => !input.isQuarantined(row));
  const reconcile = reconcileWorkspace({
    tabs: candidates.map((row, order) => ({
      tabId: row.id,
      protocol: row.protocol,
      backendSessionId: row.backendSessionId,
      order,
    })),
    live: input.live,
    activeTabId: input.activeTabId,
    options: {
      reconnectOnReload: input.reconnectOnReload,
      adoptLiveSessions: input.adoptLiveSessions,
    },
  });

  const byId = new Map(candidates.map((row) => [row.id, row]));
  const rows: PersistedConnectionSession[] = [];
  const adoptedTabIds: string[] = [];
  const deadTabIds: string[] = [];

  for (const tab of reconcile.tabs) {
    const row = byId.get(tab.tabId);
    if (!row) continue;
    if (tab.action === "adopt") {
      adoptedTabIds.push(row.id);
      rows.push(row);
      continue;
    }
    if (input.adoptOnly) continue;
    if (tab.action === "mark-dead") deadTabIds.push(row.id);
    // Drop stale ids so the restore path dials fresh.
    const { backendSessionId: _b, shellId: _s, ...rest } = row;
    void _b;
    void _s;
    rows.push(rest);
  }
  // Quarantined rows keep their original (cleanup-evidence) shape and order.
  rows.push(...quarantined);

  return {
    rows,
    adoptedTabIds,
    deadTabIds,
    activeTabId: reconcile.activeTabId,
    reconcile,
  };
}

/** Convert a durable snapshot into restore rows (always status disconnected). */
export function snapshotToRows(
  snapshot: WorkspaceSnapshot,
): PersistedConnectionSession[] {
  return [...snapshot.tabs]
    .sort((a, b) => a.order - b.order)
    .map((tab) => ({
      id: tab.tabId,
      connectionId: tab.connectionId,
      name: tab.name,
      protocol: tab.protocol,
      hostname: tab.hostname,
      status: "disconnected" as const,
      ...(tab.group ? { group: tab.group } : {}),
      ...(tab.backendSessionId && ADOPTABLE_PROTOCOLS.has(tab.protocol)
        ? { backendSessionId: tab.backendSessionId }
        : {}),
    }));
}
