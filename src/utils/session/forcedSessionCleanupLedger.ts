import type {
  ConnectionSession,
  SessionVpnLeaseBinding,
  SessionVpnLeaseCleanupQuarantine,
  SessionVpnLeaseReleaseTombstone,
} from "../../types/connection/connection";

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
    vpnLeaseOwnerId: session.vpnLeaseOwnerId,
    vpnLeaseOwnerIds: session.vpnLeaseOwnerIds
      ? [...session.vpnLeaseOwnerIds]
      : undefined,
    vpnLeaseBindings: copyBindings(session.vpnLeaseBindings),
    vpnLeaseReleaseTombstones: copyTombstones(
      session.vpnLeaseReleaseTombstones,
    ),
    vpnLeaseCleanupQuarantine: copyQuarantine(
      session.vpnLeaseCleanupQuarantine,
    ),
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
