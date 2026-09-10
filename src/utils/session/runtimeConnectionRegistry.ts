import type { Connection } from "../../types/connection/connection";

/**
 * Volatile connection definitions used by Quick Connect sessions.
 *
 * Credentials must not be copied onto ConnectionSession because sessions can
 * be restored and serialized. This registry lives only in the renderer
 * process, is never persisted, and is cleared when its session closes.
 */
const runtimeConnections = new Map<string, Connection>();
export interface RuntimeWebNavigation {
  initialUrl: string;
  redirectHops: number;
  /** Checked by canonical launch after asynchronous capability/confirmation work. */
  assertCurrent: () => void;
}
const webNavigation = new Map<string, RuntimeWebNavigation>();

export function registerRuntimeConnection(
  connection: Connection,
  navigation?: RuntimeWebNavigation,
): void {
  runtimeConnections.set(connection.id, connection);
  if (navigation) webNavigation.set(connection.id, navigation);
  else webNavigation.delete(connection.id);
}
export function getRuntimeWebNavigation(
  connectionId: string,
): RuntimeWebNavigation | undefined {
  return webNavigation.get(connectionId);
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
  webNavigation.delete(connectionId);
}

export function clearRuntimeConnectionsForTests(): void {
  runtimeConnections.clear();
  webNavigation.clear();
}
