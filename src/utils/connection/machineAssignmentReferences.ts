import type { Connection } from "../../types/connection/connection";

export interface MachineAssignmentReferenceRemap {
  sourceDatabaseId: string;
  destinationDatabaseId: string;
  /** Only targets actually included in this copy, including unchanged IDs. */
  connectionIds: ReadonlyMap<string, string>;
}

/** Advisory notes retain their original identity unless the copy owns the target. */
export function remapMachineAssignmentReference(
  connection: Connection,
  {
    sourceDatabaseId,
    destinationDatabaseId,
    connectionIds,
  }: MachineAssignmentReferenceRemap,
): Connection {
  const assignment = connection.machineAssignment;
  const reference = assignment?.connectionRef;
  if (
    !sourceDatabaseId ||
    !destinationDatabaseId ||
    !reference ||
    reference.databaseId !== sourceDatabaseId
  )
    return connection;
  const connectionId = connectionIds.get(reference.connectionId);
  if (
    !connectionId ||
    (reference.databaseId === destinationDatabaseId &&
      reference.connectionId === connectionId)
  )
    return connection;
  return {
    ...connection,
    machineAssignment: {
      ...assignment,
      connectionRef: { databaseId: destinationDatabaseId, connectionId },
    },
  };
}
