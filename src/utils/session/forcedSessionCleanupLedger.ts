import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
  type SessionVpnLeaseBinding,
  type SessionVpnLeaseCleanupQuarantine,
  type SessionVpnLeaseReleaseTombstone,
} from "../../types/connection/connection";
import {
  getSessionLifecycleActorGeneration,
  getSessionLifecycleWriterId,
  mergeLocalSessionUpdate,
} from "./sessionLifecycle";

export const FORCED_SESSION_CLEANUP_LEDGER_KEY =
  "sorng-forced-session-cleanup-ledger-v1";
export const MAX_FORCED_SESSION_CLEANUP_RECORDS = 64;

export interface ForcedSessionCleanupRecord {
  readonly id: string;
  readonly forcedAt: string;
  readonly closeAttemptId: number;
  readonly sessionId: string;
  readonly connectionId: string;
  readonly sessionName: string;
  readonly protocol: string;
  readonly backendSessionId?: string;
  readonly lifecycleRevision?: number;
  readonly lifecycleActorGeneration?: number;
  readonly lifecycleWriterId?: string;
  readonly vpnLeaseOwnerId?: string;
  readonly vpnLeaseOwnerIds?: string[];
  readonly vpnLeaseBindings?: SessionVpnLeaseBinding[];
  readonly vpnLeaseReleaseTombstones?: SessionVpnLeaseReleaseTombstone[];
  readonly vpnLeaseCleanupQuarantine?: SessionVpnLeaseCleanupQuarantine;
  readonly cleanupPending: true;
}

export interface ForcedSessionCleanupEvidenceResult {
  readonly record: ForcedSessionCleanupRecord;
  readonly persisted: boolean;
  readonly error?: string;
}

export type ForcedSessionCleanupActor = Pick<
  ConnectionSession,
  | "id"
  | "connectionId"
  | "protocol"
  | "backendSessionId"
  | "lifecycleActorGeneration"
  | "lifecycleWriterId"
>;

const copyEvidence = (session: Partial<ConnectionSession>) => ({
  vpnLeaseOwnerId: session.vpnLeaseOwnerId,
  vpnLeaseOwnerIds: session.vpnLeaseOwnerIds
    ? [...session.vpnLeaseOwnerIds]
    : undefined,
  vpnLeaseBindings: copyBindings(session.vpnLeaseBindings),
  vpnLeaseReleaseTombstones: copyTombstones(session.vpnLeaseReleaseTombstones),
  vpnLeaseCleanupQuarantine: copyQuarantine(session.vpnLeaseCleanupQuarantine),
});

const copyBindings = (
  bindings: readonly SessionVpnLeaseBinding[] | undefined,
): SessionVpnLeaseBinding[] | undefined =>
  bindings?.map((binding) => ({ ...binding }));

const copyTombstones = (
  tombstones: readonly SessionVpnLeaseReleaseTombstone[] | undefined,
): SessionVpnLeaseReleaseTombstone[] | undefined =>
  tombstones?.map((tombstone) => ({ ...tombstone }));

const copyQuarantine = (
  quarantine: SessionVpnLeaseCleanupQuarantine | undefined,
): SessionVpnLeaseCleanupQuarantine | undefined =>
  quarantine
    ? {
        proofIncomplete: quarantine.proofIncomplete,
        proofs: quarantine.proofs.map((proof) => ({ ...proof })),
      }
    : undefined;

const parseLedger = (raw: string | null): ForcedSessionCleanupRecord[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is ForcedSessionCleanupRecord =>
      Boolean(
        record &&
        typeof record === "object" &&
        typeof (record as ForcedSessionCleanupRecord).id === "string" &&
        typeof (record as ForcedSessionCleanupRecord).sessionId === "string" &&
        (record as ForcedSessionCleanupRecord).cleanupPending === true,
      ),
    );
  } catch {
    return [];
  }
};

export const readForcedSessionCleanupLedger =
  (): ForcedSessionCleanupRecord[] => {
    if (typeof window === "undefined") return [];
    try {
      return parseLedger(
        window.localStorage.getItem(FORCED_SESSION_CLEANUP_LEDGER_KEY),
      );
    } catch {
      return [];
    }
  };

/**
 * Preserve only opaque backend ownership and VPN cleanup proof. Connection
 * credentials and protocol configuration never enter this emergency ledger.
 */
export const recordForcedSessionCleanupEvidence = (
  session: ConnectionSession,
  closeAttemptId: number,
  forcedAt = new Date(),
): ForcedSessionCleanupEvidenceResult => {
  const timestamp = forcedAt.toISOString();
  const record: ForcedSessionCleanupRecord = {
    id: `${session.id}:${closeAttemptId}:${timestamp}`,
    forcedAt: timestamp,
    closeAttemptId,
    sessionId: session.id,
    connectionId: session.connectionId,
    sessionName: session.name,
    protocol: session.protocol,
    backendSessionId: session.backendSessionId,
    lifecycleRevision: session.lifecycleRevision,
    lifecycleActorGeneration: session.lifecycleActorGeneration,
    lifecycleWriterId: session.lifecycleWriterId,
    ...copyEvidence(session),
    cleanupPending: true,
  };

  if (typeof window === "undefined") {
    return {
      record,
      persisted: false,
      error: "Browser storage is unavailable.",
    };
  }

  try {
    const ledger = readForcedSessionCleanupLedger().filter(
      (candidate) => candidate.id !== record.id,
    );
    ledger.unshift(record);
    window.localStorage.setItem(
      FORCED_SESSION_CLEANUP_LEDGER_KEY,
      JSON.stringify(ledger.slice(0, MAX_FORCED_SESSION_CLEANUP_RECORDS)),
    );
    return { record, persisted: true };
  } catch (error) {
    return {
      record,
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Route a late publication to an existing force-close record, never create one.
 * Capture `actor` before async cleanup; its backend ID must be the exact native
 * target, not a connection-slot fallback or a replacement read after an await.
 * An unknown backend can be adopted only by the same generation/writer. Known
 * backend proofs can advance across a terminal lifecycle generation change.
 * Returns null when no record owns this actor. A matched result (even a storage
 * failure) means the caller must not publish this removed actor back to the UI.
 */
export const preserveForcedSessionCleanupEvidence = (
  session: ConnectionSession,
  actor: ForcedSessionCleanupActor = session,
): ForcedSessionCleanupEvidenceResult | null => {
  const ledger = readForcedSessionCleanupLedger();
  const index = ledger.findIndex((record) => {
    if (
      record.sessionId !== actor.id ||
      record.connectionId !== actor.connectionId ||
      record.protocol !== actor.protocol
    ) {
      return false;
    }
    const backendId = actor.backendSessionId;
    const knownBackend = Boolean(
      backendId &&
      (record.backendSessionId === backendId ||
        [
          record.vpnLeaseBindings,
          record.vpnLeaseReleaseTombstones,
          record.vpnLeaseCleanupQuarantine?.proofs,
        ]
          .flatMap((proofs) => (Array.isArray(proofs) ? proofs : []))
          .some(
            (proof) =>
              proof?.protocol === actor.protocol &&
              proof.backendSessionId === backendId,
          )),
    );
    return (
      knownBackend ||
      (getSessionLifecycleActorGeneration(record) ===
        getSessionLifecycleActorGeneration(actor) &&
        getSessionLifecycleWriterId(record) ===
          getSessionLifecycleWriterId(actor) &&
        (!backendId ||
          !record.backendSessionId ||
          record.backendSessionId === backendId))
    );
  });
  if (index < 0) return null;

  let record = ledger[index];
  try {
    const backendSessionId = actor.backendSessionId ?? record.backendSessionId;
    const belongsToActor = (proof: SessionVpnLeaseReleaseTombstone) =>
      proof.protocol === actor.protocol &&
      proof.backendSessionId === backendSessionId;
    const current: ConnectionSession = {
      id: record.sessionId,
      connectionId: record.connectionId,
      protocol: record.protocol,
      name: record.sessionName,
      hostname: "",
      status: "error",
      startTime: new Date(record.forcedAt),
      lifecycleActorGeneration: getSessionLifecycleActorGeneration(record),
      lifecycleWriterId: getSessionLifecycleWriterId(record),
      lifecycleRevision: record.lifecycleRevision,
      ...copyEvidence(record),
    };
    // Reuse the bounded, monotonic cleanup-proof merger. These updates have no
    // actor authority: active evidence becomes pending, never proof of closure.
    const merged = mergeLocalSessionUpdate(current, {
      id: current.id,
      lifecycleActorGeneration: current.lifecycleActorGeneration,
      lifecycleWriterId: current.lifecycleWriterId,
      lifecycleRevision: 0,
      vpnLeaseBindings: session.vpnLeaseBindings
        ?.filter(belongsToActor)
        .map((binding) => ({
          ...binding,
          status:
            binding.status === "active" ? "cleanup-pending" : binding.status,
        })),
      vpnLeaseReleaseTombstones:
        session.vpnLeaseReleaseTombstones?.filter(belongsToActor),
      vpnLeaseCleanupQuarantine: session.vpnLeaseCleanupQuarantine
        ? {
            proofIncomplete: session.vpnLeaseCleanupQuarantine.proofIncomplete,
            proofs:
              session.vpnLeaseCleanupQuarantine.proofs.filter(belongsToActor),
          }
        : undefined,
    });
    // Before native connect returns, an owner may have no backend correlation.
    // Retain it without inventing one; absence from later snapshots is not a
    // release proof. Once bound, the exact proof merger above owns settlement.
    if (!backendSessionId) {
      const ownerIds = [
        ...new Set(
          [
            merged.vpnLeaseOwnerId,
            ...(merged.vpnLeaseOwnerIds ?? []),
            session.vpnLeaseOwnerId,
            ...(session.vpnLeaseOwnerIds ?? []),
          ].filter((ownerId): ownerId is string => Boolean(ownerId)),
        ),
      ];
      merged.vpnLeaseOwnerIds = ownerIds.slice(
        0,
        MAX_SESSION_VPN_LEASE_BINDINGS,
      );
      merged.vpnLeaseOwnerId ??= ownerIds[0];
      if (ownerIds.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
        merged.vpnLeaseCleanupQuarantine = {
          proofs: merged.vpnLeaseCleanupQuarantine?.proofs ?? [],
          proofIncomplete: true,
        };
      }
    }
    record = {
      ...record,
      // Preserve the original primary actor if this is another retained binding.
      backendSessionId: record.backendSessionId ?? backendSessionId,
      ...copyEvidence(merged),
    };
    ledger[index] = record;
    window.localStorage.setItem(
      FORCED_SESSION_CLEANUP_LEDGER_KEY,
      JSON.stringify(ledger.slice(0, MAX_FORCED_SESSION_CLEANUP_RECORDS)),
    );
    return { record, persisted: true };
  } catch (error) {
    return {
      record,
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
