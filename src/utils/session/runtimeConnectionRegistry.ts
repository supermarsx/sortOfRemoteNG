import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

/**
 * Volatile connection definitions used by Quick Connect sessions.
 *
 * Credentials must not be copied onto ConnectionSession because sessions can
 * be restored and serialized. This registry lives only in the renderer
 * process, is never persisted, and is cleared when its session closes.
 */
const runtimeConnections = new Map<string, Connection>();
/** Reference-only, renderer-local provenance. Never serialize onto a session. */
export interface TrustedRedirectSource {
  databaseId: string;
  savedConnectionId: string;
  originalOrigin: string;
  /** The original lease, not a freshly acquired lease on a later redirect hop. */
  assertOwner: () => void;
  /** Compare a freshly resolved saved source without exposing its credentials. */
  assertIdentity: (connection: Connection) => void;
}
/** Original website's built-in routing preference, never an imported trust grant. */
export interface SynologyRedirectSource {
  originalOrigin: string;
  enabled: boolean;
  databaseId: string;
  savedConnectionId?: string;
  assertOwner: () => void;
  assertIdentity: (connection: Connection) => void;
}
export interface RuntimeWebNavigation {
  initialUrl: string;
  redirectHops: number;
  /** Checked by canonical launch after asynchronous capability/confirmation work. */
  assertCurrent: () => void;
  trustedRedirectSource?: TrustedRedirectSource;
  /** Volatile original-source lease; never learn a NAS alias from a later hop. */
  synologyRedirectSource?: SynologyRedirectSource;
  /** Native-issued, one-use handoff; never saved or exposed to website frames. */
  nativeContinuation?: { id: string; cancel: () => void };
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
  webNavigation.get(connectionId)?.nativeContinuation?.cancel();
  runtimeConnections.delete(connectionId);
  webNavigation.delete(connectionId);
}

/** Synchronous same-tab handoff: retain an old ephemeral definition while any
 * other session still owns it. Saved connections are never modified. */
export function releaseReplacedRuntimeConnection(
  previousConnectionId: string,
  replacingSessionId: string,
  sessions: readonly ConnectionSession[],
): boolean {
  if (
    sessions.some(
      (session) =>
        session.id !== replacingSessionId &&
        session.connectionId === previousConnectionId,
    )
  )
    return false;
  releaseRuntimeConnection(previousConnectionId);
  return true;
}

export function clearRuntimeConnectionsForTests(): void {
  for (const navigation of webNavigation.values())
    navigation.nativeContinuation?.cancel();
  runtimeConnections.clear();
  webNavigation.clear();
}
