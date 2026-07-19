import type { ConnectionSession } from "../../types/connection/connection";
import {
  releaseSessionVpnLeases,
  vpnLeaseCleanupError,
} from "./vpnSessionLeases";

export type VpnSessionProtocol = "ssh" | "rdp";

export interface VpnLeaseCleanupFailure {
  ownerId: string;
  message: string;
}

export interface VpnLeaseCleanupResult {
  releasedOwnerIds: string[];
  failures: VpnLeaseCleanupFailure[];
}

export interface SessionVpnLeaseOwnerFields {
  vpnLeaseOwnerId?: string;
  vpnLeaseOwnerIds?: string[];
}

type OwnerCleanupResult =
  | { ownerId: string }
  | { ownerId: string; message: string };

const cleanupOwnersInFlight = new Map<string, Promise<OwnerCleanupResult>>();

/** Return every persisted owner, including the legacy primary-only shape. */
export function sessionVpnLeaseOwnerIds(
  session: Pick<ConnectionSession, "vpnLeaseOwnerId" | "vpnLeaseOwnerIds">,
): string[] {
  return [
    ...new Set(
      [...(session.vpnLeaseOwnerIds ?? []), session.vpnLeaseOwnerId].filter(
        (ownerId): ownerId is string => Boolean(ownerId),
      ),
    ),
  ];
}

/** Build the retry snapshot after a subset of owners was released. */
export function remainingSessionVpnLeaseOwnerFields(
  session: Pick<ConnectionSession, "vpnLeaseOwnerId" | "vpnLeaseOwnerIds">,
  releasedOwnerIds: ReadonlySet<string>,
): SessionVpnLeaseOwnerFields {
  const remaining = sessionVpnLeaseOwnerIds(session).filter(
    (ownerId) => !releasedOwnerIds.has(ownerId),
  );
  const primary =
    session.vpnLeaseOwnerId && remaining.includes(session.vpnLeaseOwnerId)
      ? session.vpnLeaseOwnerId
      : remaining[0];
  return {
    vpnLeaseOwnerId: primary,
    vpnLeaseOwnerIds: remaining.length > 0 ? remaining : undefined,
  };
}

function cleanupOwner(ownerId: string): Promise<OwnerCleanupResult> {
  const existing = cleanupOwnersInFlight.get(ownerId);
  if (existing) return existing;

  const cleanup = (async (): Promise<OwnerCleanupResult> => {
    try {
      const result = await releaseSessionVpnLeases(ownerId);
      const cleanupError = vpnLeaseCleanupError(result);
      return cleanupError ? { ownerId, message: cleanupError } : { ownerId };
    } catch (error) {
      return { ownerId, message: String(error) };
    }
  })();
  cleanupOwnersInFlight.set(ownerId, cleanup);
  void cleanup.finally(() => {
    if (cleanupOwnersInFlight.get(ownerId) === cleanup) {
      cleanupOwnersInFlight.delete(ownerId);
    }
  });
  return cleanup;
}

/**
 * Resolve frontend rows that own a native SSH/RDP backend. Exact backend ids
 * win. RDP's legacy connection-id fallback is used only when no exact row is
 * available, avoiding accidental cleanup of a newer backend for the same host.
 */
export function findAssociatedVpnSessions(
  sessions: readonly ConnectionSession[],
  protocol: VpnSessionProtocol,
  backendSessionId: string,
  connectionId?: string,
): ConnectionSession[] {
  const protocolRows = sessions.filter(
    (session) => session.protocol.toLowerCase() === protocol,
  );
  const exact = protocolRows.filter(
    (session) => session.backendSessionId === backendSessionId,
  );
  if (exact.length > 0 || protocol !== "rdp" || !connectionId) return exact;

  return protocolRows.filter(
    (session) =>
      session.connectionId === connectionId &&
      (!session.backendSessionId || session.backendSessionId === connectionId),
  );
}

/** Release every distinct owner and report partial cleanup without dropping ids. */
export async function cleanupSessionVpnLeases(
  sessions: readonly ConnectionSession[],
): Promise<VpnLeaseCleanupResult> {
  const ownerIds = [
    ...new Set(sessions.flatMap((session) => sessionVpnLeaseOwnerIds(session))),
  ];
  const settled = await Promise.all(ownerIds.map(cleanupOwner));

  return {
    releasedOwnerIds: settled
      .filter((result) => !("message" in result))
      .map((result) => result.ownerId),
    failures: settled.filter(
      (result): result is VpnLeaseCleanupFailure => "message" in result,
    ),
  };
}

export function vpnLeaseCleanupFailureMessage(
  protocol: VpnSessionProtocol,
  result: VpnLeaseCleanupResult,
): string {
  const detail = result.failures.map((failure) => failure.message).join("; ");
  return `${protocol.toUpperCase()} disconnected, but VPN cleanup needs attention${detail ? `: ${detail}` : "."} Retry disconnect to finish cleanup.`;
}
