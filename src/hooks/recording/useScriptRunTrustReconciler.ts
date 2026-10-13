import { useContext, useEffect, useMemo } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import {
  onCurrentDatabaseChange,
  type CurrentDatabaseChange,
} from "../../utils/connection/databaseManager";
import { isScriptTrustId } from "../../utils/recording/scriptRunTrust";
import {
  pruneScriptTrust,
  readScriptTrustRecord,
  subscribeScriptTrust,
} from "../../utils/recording/scriptRunTrustStore";

/**
 * Removes trust that can no longer apply: the entries bound to a connection
 * that was deleted, and the entries of a database that was deleted. It acts
 * on positive signals only. An empty, loading or unreadable list removes
 * nothing, and the worst a wrong removal can do is make a script ask again.
 * Mount it once, in the main window.
 */

/**
 * The database a `delete` event is about, or null when the event does not
 * name it with certainty. For another database than the open one the event
 * carries its id; for the open one it carries null and the id that was open.
 */
export function deletedDatabaseId(
  change: Pick<
    CurrentDatabaseChange,
    "reason" | "database" | "databaseId" | "previousDatabaseId"
  >,
): string | null {
  if (change.reason !== "delete") return null;
  const deleted =
    change.databaseId !== null
      ? change.databaseId !== change.database?.id
        ? change.databaseId
        : null
      : change.database === null
        ? change.previousDatabaseId
        : null;
  return isScriptTrustId(deleted) ? deleted : null;
}

export function useScriptRunTrustReconciler(): void {
  const context = useContext(ConnectionContext);
  const availability = context?.databaseAvailability;
  // The bin's own view names the database it belongs to.
  const snapshot = context?.recycleBin?.snapshot ?? null;
  const connections = context?.state.connections;

  const deleted = useMemo(() => {
    if (
      !availability ||
      availability.status !== "ready" ||
      !availability.databaseId ||
      !snapshot ||
      snapshot.scope.databaseId !== availability.databaseId
    )
      return "";
    const live = new Set((connections ?? []).map((row) => row.id));
    const connectionIds = Array.from(
      new Set(
        snapshot.entries
          .map((row) => row.connectionId)
          .filter((id) => isScriptTrustId(id) && !live.has(id)),
      ),
    ).sort();
    return connectionIds.length === 0
      ? ""
      : JSON.stringify({
          databaseId: availability.databaseId,
          connectionIds,
        });
  }, [availability, snapshot, connections]);

  useEffect(() => {
    if (!deleted) return;
    const target = JSON.parse(deleted) as {
      databaseId: string;
      connectionIds: string[];
    };
    const ids = new Set(target.connectionIds);
    let live = true;
    let running = false;
    let again = false;
    const reconcile = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          // Look first: a prune tells every listener, this one included.
          const read = await readScriptTrustRecord();
          if (!live || read.status !== "ready") break;
          const bound = read.record.entries.some(
            (entry) =>
              entry.connection?.databaseId === target.databaseId &&
              ids.has(entry.connection.connectionId),
          );
          if (bound) await pruneScriptTrust({ kind: "connections", ...target });
        } while (again && live);
      } finally {
        running = false;
      }
    };
    void reconcile();
    // A grant from another window can land after the connection was deleted.
    const stop = subscribeScriptTrust(() => void reconcile());
    return () => {
      live = false;
      stop();
    };
  }, [deleted]);

  useEffect(
    () =>
      onCurrentDatabaseChange((change) => {
        const databaseId = deletedDatabaseId(change);
        if (databaseId) void pruneScriptTrust({ kind: "database", databaseId });
      }),
    [],
  );
}
