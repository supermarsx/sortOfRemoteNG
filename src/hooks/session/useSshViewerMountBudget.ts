import { useEffect, useMemo, useState } from "react";
import type { ConnectionSession } from "../../types/connection/connection";

export const DEFAULT_MAX_MOUNTED_SSH_VIEWERS = 32;
export const HARD_MAX_MOUNTED_SSH_VIEWERS = 64;

export const normalizeMaxMountedSshViewers = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_MOUNTED_SSH_VIEWERS;
  }
  return Math.min(HARD_MAX_MOUNTED_SSH_VIEWERS, Math.max(1, Math.floor(value)));
};

/**
 * Only an established SSH actor can outlive its React/xterm view safely.
 * Connecting/reconnecting/error viewers still own frontend lifecycle work and
 * must remain mounted, as must every other protocol until separately audited.
 */
export const isSuspendableSshViewer = (session: ConnectionSession): boolean =>
  session.protocol === "ssh" &&
  session.status === "connected" &&
  Boolean(session.backendSessionId) &&
  Boolean(session.shellId);

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

const mergeMru = (
  previous: readonly string[],
  priorityIds: readonly string[],
  eligibleIds: readonly string[],
): string[] => {
  const eligible = new Set(eligibleIds);
  return unique([
    ...priorityIds.filter((id) => eligible.has(id)),
    ...previous.filter((id) => eligible.has(id)),
    ...eligibleIds,
  ]);
};

const arraysEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export interface SshViewerMountBudgetResult {
  maxMounted: number;
  eligibleCount: number;
  mountedSessionIds: ReadonlySet<string>;
}

/**
 * Keeps a deterministic MRU window of established SSH viewers mounted.
 * Active/visible priority viewers are mandatory and may exceed the configured
 * budget when the layout itself displays more viewers than the budget.
 */
export const useSshViewerMountBudget = (
  sessions: readonly ConnectionSession[],
  prioritySessionIds: readonly string[],
  requestedMaxMounted?: number,
): SshViewerMountBudgetResult => {
  const maxMounted = normalizeMaxMountedSshViewers(requestedMaxMounted);
  const eligibleIds = useMemo(
    () =>
      unique(
        sessions.filter(isSuspendableSshViewer).map((session) => session.id),
      ),
    [sessions],
  );
  const [mru, setMru] = useState<string[]>([]);

  const orderedMru = useMemo(
    () => mergeMru(mru, prioritySessionIds, eligibleIds),
    [eligibleIds, mru, prioritySessionIds],
  );

  useEffect(() => {
    setMru((previous) => {
      const next = mergeMru(previous, prioritySessionIds, eligibleIds);
      return arraysEqual(previous, next) ? previous : next;
    });
  }, [eligibleIds, prioritySessionIds]);

  const mountedSessionIds = useMemo(() => {
    const eligible = new Set(eligibleIds);
    const mandatory = unique(prioritySessionIds).filter((id) =>
      eligible.has(id),
    );
    const mounted = new Set(mandatory);
    for (const sessionId of orderedMru) {
      if (mounted.has(sessionId)) continue;
      if (mounted.size >= maxMounted) break;
      mounted.add(sessionId);
    }
    return mounted;
  }, [eligibleIds, maxMounted, orderedMru, prioritySessionIds]);

  return {
    maxMounted,
    eligibleCount: eligibleIds.length,
    mountedSessionIds,
  };
};
