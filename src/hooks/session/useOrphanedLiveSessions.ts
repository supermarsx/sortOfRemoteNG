import { useCallback, useMemo, useState } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { listLiveSessions } from "../../services/session/liveSessionRegistry";
import {
  closeOrphanedLiveSession,
  computeOrphanedLiveSessions,
} from "../../services/session/orphanSessions";
import type { LiveSessionDescriptor } from "../../services/session/reconcileWorkspace";
import {
  sameSessionSnapshot,
  useVisibleSessionRefresh,
} from "./useVisibleSessionRefresh";

/**
 * Live backend sessions with no owning tab ("Orphaned (live)" rows). Polls
 * only while enabled and visible (one in-flight request, no hidden polling).
 */
export function useOrphanedLiveSessions(
  enabled: boolean,
  sessions: readonly ConnectionSession[],
) {
  const [live, setLive] = useState<LiveSessionDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresher = useVisibleSessionRefresh({
    enabled,
    load: async (lease) => {
      const next = await listLiveSessions();
      if (lease.isCurrent()) {
        setLive((current) =>
          sameSessionSnapshot(current, next) ? current : next,
        );
      }
    },
  });

  const orphans = useMemo(
    () => computeOrphanedLiveSessions(sessions, live),
    [sessions, live],
  );

  const close = useCallback(async (descriptor: LiveSessionDescriptor) => {
    try {
      await closeOrphanedLiveSession(descriptor);
      setError(null);
      setLive((current) =>
        current.filter(
          (item) =>
            !(
              item.protocol === descriptor.protocol &&
              item.backendSessionId === descriptor.backendSessionId
            ),
        ),
      );
    } catch (closeError) {
      setError(
        closeError instanceof Error ? closeError.message : String(closeError),
      );
    }
  }, []);

  return { orphans, error, close, refresh: refresher.refresh };
}
