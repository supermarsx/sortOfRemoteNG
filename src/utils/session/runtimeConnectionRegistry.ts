import type { Connection } from "../../types/connection/connection";

/**
 * Volatile connection definitions used by Quick Connect sessions.
 *
 * Credentials must not be copied onto ConnectionSession because sessions can
 * be restored and serialized. This registry lives only in the renderer
 * process, is never persisted, and is cleared when its session closes.
 */
const runtimeConnections = new Map<string, Connection>();

export function registerRuntimeConnection(connection: Connection): void {
  runtimeConnections.set(connection.id, connection);
}

export function resolveRuntimeConnection(
  savedConnections: readonly Connection[],
  connectionId: string,
): Connection | undefined {
  return (
    savedConnections.find((connection) => connection.id === connectionId) ??
    runtimeConnections.get(connectionId)
  );
}

export function releaseRuntimeConnection(connectionId: string): void {
  runtimeConnections.delete(connectionId);
}

export function clearRuntimeConnectionsForTests(): void {
  runtimeConnections.clear();
}
