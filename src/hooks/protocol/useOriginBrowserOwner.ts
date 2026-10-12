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
    const owner = session.ownerDatabaseId;
    let disposed = false;
    let held: OriginBrowserOwnerProof | null = null;
    const revoke = () => {
      held = null;
      void closeRef.current?.();
      setCaptured(null);
    };
    const acquire = () => {
      try {
        if (
          !owner ||
          availability?.status !== "ready" ||
          availability.databaseId !== owner ||
          manager.getCurrentDatabase()?.id !== owner
        )
          return null;
        const proof = manager.captureOriginBrowserOwnerProof(owner);
        if (
          !proof ||
          proof.ownerDatabaseId !== owner ||
          !proof.expectedSecurityRevision ||
          !proof.sourceSessionId
        )
          return null;
        proof.assertCurrent();
        return proof;
      } catch {
        /* An unavailable owner must never acquire a fallback grant. */
        return null;
      }
    };
    const lapsed = () => {
      try {
        held?.assertCurrent();
        return false;
      } catch {
        return true;
      }
    };
    const capture = () => {
      if (disposed) return;
      const proof = acquire();
      // Native binds the attempt to exactly these values. A re-capture that
      // repeats them is the same authority; closing would end the tab with
      // nothing changed to start it again.
      if (
        held &&
        proof &&
        proof.expectedSecurityRevision === held.expectedSecurityRevision &&
        proof.sourceSessionId === held.sourceSessionId
      ) {
        if (!lapsed()) return;
        held = proof;
        setCaptured({ scope, proof });
        return;
      }
      revoke();
      if (!proof) return;
      held = proof;
      setCaptured({ scope, proof });
    };
    const offCurrent = manager.onCurrentDatabaseChange((change) => {
      // Creating, unlocking, locking, closing or deleting another database
      // neither names this owner nor moves the selection to or from it. A
      // null id means the event ended the selection it names as previous.
      const subject = change.databaseId ?? change.previousDatabaseId;
      const selected = change.database?.id ?? null;
      if (
        subject !== owner &&
        (change.previousDatabaseId === owner) === (selected === owner) &&
        !lapsed()
      )
        return;
      capture();
    });
    const offAccess = manager.onDatabaseAccessChange((event) => {
      if (event.databaseId === owner) capture();
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
