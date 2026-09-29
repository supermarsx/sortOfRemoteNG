import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { webPopupTabs } from "../../utils/protocol/webPopupTabs";
import { WebBrowser } from "./WebBrowser";

/** Browser chrome for a runtime child; the source retains proxy ownership. */
export function WebPopupTab({
  session,
  onActivateSession,
}: {
  session: ConnectionSession;
  onActivateSession?: (sessionId: string) => void;
}) {
  const { state, databaseAvailability } = useConnections();
  const subscribe = useCallback(
    (listener: () => void) => webPopupTabs.subscribe(session.id, listener),
    [session.id],
  );
  const getSnapshot = useCallback(
    () => webPopupTabs.getSnapshot(session.id),
    [session.id],
  );
  const popup = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const source =
    popup &&
    state.sessions.find((candidate) => candidate.id === popup.sourceSessionId);
  const permitted = !!(
    popup &&
    source &&
    source.status === "connected" &&
    source.connectionId === popup.sourceConnectionId &&
    source.ownerDatabaseId === popup.ownerDatabaseId &&
    session.ownerDatabaseId === popup.ownerDatabaseId &&
    source.layout?.windowId === popup.sourceWindowId &&
    session.layout?.windowId === popup.sourceWindowId &&
    (!popup.ownerDatabaseId ||
      (databaseAvailability?.status === "ready" &&
        databaseAvailability.databaseId === popup.ownerDatabaseId)) &&
    webPopupTabs.isCurrent(session.id)
  );

  // Adapt only the view; never mutate the runtime tool session record.
  const adaptedSession = useMemo(
    () =>
      source
        ? {
            ...source,
            ...session,
            connectionId: source.connectionId,
            hostname: source.hostname,
            protocol: source.protocol,
          }
        : null,
    [source, session],
  );
  useLayoutEffect(() => {
    if (!permitted) webPopupTabs.close(session.id);
  }, [session.id, permitted]);

  if (!permitted || !adaptedSession)
    return (
      <p
        role="status"
        className="p-6 text-sm text-[var(--color-textSecondary)]"
      >
        This Take Control tab has expired. Open it again from its browser
        session.
      </p>
    );
  return (
    <WebBrowser
      session={adaptedSession}
      sharedPopupId={session.id}
      onActivateSession={onActivateSession}
    />
  );
}
