import { useLayoutEffect, useState, type RefObject } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import type { DatabaseAvailability } from "../../contexts/ConnectionContextTypes";
import { DatabaseManager } from "../../utils/connection/databaseManager";

export type OriginBrowserOwnerProof = ReturnType<
  DatabaseManager["captureOriginBrowserOwnerProof"]
>;

export function useOriginBrowserOwner(
  session: ConnectionSession,
  availability: DatabaseAvailability | undefined,
  closeRef: RefObject<(() => Promise<void>) | null>,
) {
  const scope = JSON.stringify([
    session.ownerDatabaseId,
    session.id,
    session.connectionId,
    availability,
  ]);
  const [captured, setCaptured] = useState<{
    scope: string;
    proof: OriginBrowserOwnerProof;
  } | null>(null);
  useLayoutEffect(() => {
    const manager = DatabaseManager.getInstance();
    let disposed = false;
    const revoke = () => {
      void closeRef.current?.();
      setCaptured(null);
    };
    const capture = () => {
      if (disposed) return;
      revoke();
      try {
        const owner = session.ownerDatabaseId;
        if (
          !owner ||
          availability?.status !== "ready" ||
          availability.databaseId !== owner ||
          manager.getCurrentDatabase()?.id !== owner
        )
          return;
        const proof = manager.captureOriginBrowserOwnerProof(owner);
        if (
          !proof ||
          proof.ownerDatabaseId !== owner ||
          !proof.expectedSecurityRevision ||
          !proof.sourceSessionId
        )
          return;
        proof.assertCurrent();
        setCaptured({ scope, proof });
      } catch {
        /* An unavailable owner must never acquire a fallback grant. */
      }
    };
    const offCurrent = manager.onCurrentDatabaseChange(capture);
    const offAccess = manager.onDatabaseAccessChange((event) => {
      if (event.databaseId === session.ownerDatabaseId) capture();
    });
    capture();
    return () => {
      disposed = true;
      offCurrent();
      offAccess();
      revoke();
    };
  }, [
    scope,
    closeRef,
    availability?.databaseId,
    availability?.status,
    session.ownerDatabaseId,
  ]);
  const proof = captured?.scope === scope ? captured.proof : null;
  try {
    proof?.assertCurrent();
  } catch {
    return null;
  }
  return proof;
}
