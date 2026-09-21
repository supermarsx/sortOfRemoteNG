import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../types/security/databaseCredentialVault";

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
  databaseGeneration?: number;
  savedConnectionId?: string;
  assertOwner: () => void;
  assertIdentity: (connection: Connection) => void;
  /** Original saved login's revocation lease only. No secret or auth grant. */
  formLogin?: {
    assertCurrent: (
      source: Connection,
      vault: DatabaseCredentialVaultApi | undefined,
    ) => void;
    revoke: () => void;
    autoMfaAttempted: () => boolean;
    claimAutoMfaAttempt: () => void;
    revokeAutoMfa: () => void;
    assertAutoMfaCurrent: () => void;
  };
}
/** Created only after the native one-use continuation was successfully redeemed. */
export interface SynologyMfaProof {
  runtimeConnectionId: string;
  proxySessionId: string;
  origin: string;
  proxyOrigin: string;
  assertCurrent: () => void;
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
  synologyMfaProof?: SynologyMfaProof;
}
const webNavigation = new Map<string, RuntimeWebNavigation>();
const retiredSynologyMfaProofs = new WeakSet<SynologyMfaProof>();

export function isSynologyMfaProofRetired(proof: SynologyMfaProof): boolean {
  return retiredSynologyMfaProofs.has(proof);
}

/** Only a validated same-tab Synology handoff may retire a proof before stop.
 * The next proxy must redeem its own native continuation; this grants nothing. */
export function retireSynologyMfaProof(
  navigationKey: string,
  proxySessionId: string,
  runtimeConnectionId = navigationKey,
): void {
  const proof = webNavigation.get(navigationKey)?.synologyMfaProof;
  if (!proof) return;
  if (
    proof.runtimeConnectionId !== runtimeConnectionId ||
    proof.proxySessionId !== proxySessionId
  )
    throw new Error("The Synology MFA handoff source changed.");
  proof.assertCurrent();
  retiredSynologyMfaProofs.add(proof);
}

export function registerRuntimeConnection(
  connection: Connection,
  navigation?: RuntimeWebNavigation,
): void {
  runtimeConnections.set(connection.id, connection);
  if (navigation) webNavigation.set(connection.id, navigation);
  else webNavigation.delete(connection.id);
}
export function getRuntimeWebNavigation(
  navigationKey: string,
): RuntimeWebNavigation | undefined {
  return webNavigation.get(navigationKey);
}

/** Tab-local key for a saved connection whose native proxy continued in place. */
export function runtimeWebNavigationSessionKey(sessionId: string): string {
  return `web-session:${sessionId}`;
}

/** Store navigation provenance without shadowing a saved connection record. */
export function registerRuntimeWebNavigation(
  navigationKey: string,
  navigation: RuntimeWebNavigation,
): void {
  webNavigation.set(navigationKey, navigation);
}

export function releaseRuntimeWebNavigation(navigationKey: string): void {
  webNavigation.get(navigationKey)?.nativeContinuation?.cancel();
  webNavigation.delete(navigationKey);
}

/** Call only after a successful start_basic_auth_proxy reply and frame validation.
 * Merely registering/reviewing a redirect never grants MFA authority. */
export function activateSynologyMfaProof(
  navigationKey: string,
  continuation: NonNullable<RuntimeWebNavigation["nativeContinuation"]>,
  proxySessionId: string,
  proxyOrigin: string,
  assertActiveProxy: () => void,
  runtimeConnectionId = navigationKey,
): void {
  const navigation = webNavigation.get(navigationKey);
  if (
    !navigation ||
    navigation.nativeContinuation !== continuation ||
    !proxySessionId
  )
    throw new Error("The native Synology continuation is no longer current.");
  const destination = new URL(navigation.initialUrl);
  // HTTP portal continuations remain transport-only; never activate OTP there.
  if (
    destination.protocol !== "https:" ||
    !navigation.synologyRedirectSource?.formLogin
  )
    return;
  let revoked = false;
  const proof: SynologyMfaProof = Object.freeze({
    runtimeConnectionId,
    proxySessionId,
    origin: destination.origin,
    proxyOrigin,
    assertCurrent: () => {
      try {
        if (
          revoked ||
          isSynologyMfaProofRetired(proof) ||
          webNavigation.get(navigationKey) !== navigation ||
          navigation.synologyMfaProof !== proof
        )
          throw new Error();
        assertActiveProxy();
      } catch {
        revoked = true;
        throw new Error(
          "The redeemed Synology MFA session is no longer current.",
        );
      }
    },
  });
  navigation.synologyMfaProof = proof;
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
