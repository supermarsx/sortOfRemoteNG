import type { DatabaseAvailability } from "../../contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

/** Saved rows may cross windows only with their exact, currently loaded owner. */
export function selectDetachedSessionConnections(
  sessions: readonly ConnectionSession[],
  connections: readonly Connection[],
  availability: DatabaseAvailability | undefined,
): Connection[] {
  if (availability?.status !== "ready" || !availability.databaseId) return [];
  const ownersByConnection = new Map<string, Set<string | undefined>>();
  for (const session of sessions) {
    const owners = ownersByConnection.get(session.connectionId) ?? new Set();
    owners.add(session.ownerDatabaseId);
    ownersByConnection.set(session.connectionId, owners);
  }
  const counts = new Map<string, number>();
  for (const connection of connections)
    counts.set(connection.id, (counts.get(connection.id) ?? 0) + 1);
  return connections.filter((connection) => {
    const owners = ownersByConnection.get(connection.id);
    // A flat snapshot cannot represent two databases' rows with the same ID.
    // Reject the ambiguous ID rather than giving either tab the other's row.
    return (
      counts.get(connection.id) === 1 &&
      owners?.size === 1 &&
      owners.has(availability.databaseId)
    );
  });
}
