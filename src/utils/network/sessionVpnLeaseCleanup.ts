import type {
  ConnectionSession,
  SessionVpnLeaseBinding,
  SessionVpnLeaseCleanupProof,
  SessionVpnLeaseReleaseTombstone,
} from "../../types/connection/connection";
import { MAX_SESSION_VPN_LEASE_BINDINGS } from "../../types/connection/connection";
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
  sessions: ConnectionSession[];
  backendClosed: boolean;
  releasedOwnerIds: string[];
  failures: VpnLeaseCleanupFailure[];
  blockedReason?: string;
}

export interface SessionVpnLeaseOwnerFields {
  vpnLeaseOwnerId?: string;
  vpnLeaseOwnerIds?: string[];
  vpnLeaseBindings?: SessionVpnLeaseBinding[];
  vpnLeaseReleaseTombstones?: SessionVpnLeaseReleaseTombstone[];
}

export interface CleanupSessionVpnBackendOptions {
  sessions: readonly ConnectionSession[];
  protocol: VpnSessionProtocol;
  backendSessionId: string;
  closeBackend: () => Promise<void>;
  backendAlreadyClosed?: boolean;
  /** Persist every proof transition before the next destructive step. */
  onSessionsUpdated?: (
    sessions: readonly ConnectionSession[],
  ) => void | Promise<void>;
}

type OwnerCleanupResult =
  | { ownerId: string }
  | { ownerId: string; message: string };

const cleanupOwnersInFlight = new Map<string, Promise<OwnerCleanupResult>>();
const RELEASE_PROOF_LEDGER_FULL =
  "VPN release completed, but the bounded cleanup proof ledger is full.";
const QUARANTINED_CLEANUP_ERROR =
  "VPN cleanup evidence is quarantined. Manual cleanup is required before reconnecting.";

const bindingKey = (
  binding: SessionVpnLeaseBinding | SessionVpnLeaseReleaseTombstone,
): string =>
  `${binding.protocol}\0${binding.backendSessionId}\0${binding.ownerId}`;

const withReleaseTombstones = (
  session: ConnectionSession,
  releasedBindings: readonly SessionVpnLeaseBinding[],
): ConnectionSession => {
  if (releasedBindings.length === 0) return session;
  const tombstones = [...(session.vpnLeaseReleaseTombstones ?? [])];
  const quarantineProofs = [
    ...(session.vpnLeaseCleanupQuarantine?.proofs ?? []),
  ];
  let proofIncomplete =
    session.vpnLeaseCleanupQuarantine?.proofIncomplete ?? false;
  const keys = new Set([
    ...tombstones.map(bindingKey),
    ...quarantineProofs
      .filter((proof) => proof.kind === "release-tombstone")
      .map(bindingKey),
  ]);
  for (const binding of releasedBindings) {
    const key = bindingKey(binding);
    if (keys.has(key)) continue;
    if (tombstones.length >= MAX_SESSION_VPN_LEASE_BINDINGS) {
      if (quarantineProofs.length >= MAX_SESSION_VPN_LEASE_BINDINGS) {
        proofIncomplete = true;
      } else {
        quarantineProofs.push({
          kind: "release-tombstone",
          ownerId: binding.ownerId,
          backendSessionId: binding.backendSessionId,
          protocol: binding.protocol,
        });
      }
      keys.add(key);
      continue;
    }
    keys.add(key);
    tombstones.push({
      ownerId: binding.ownerId,
      backendSessionId: binding.backendSessionId,
      protocol: binding.protocol,
    });
  }
  const quarantined = quarantineProofs.length > 0 || proofIncomplete;
  if (!quarantined) {
    return { ...session, vpnLeaseReleaseTombstones: tombstones };
  }

  return {
    ...session,
    vpnLeaseReleaseTombstones: tombstones,
    vpnLeaseCleanupQuarantine: {
      proofs: quarantineProofs,
      proofIncomplete,
    },
    status: "error",
    errorMessage: `${RELEASE_PROOF_LEDGER_FULL} ${QUARANTINED_CLEANUP_ERROR}`,
  };
};

function isBindingStatus(
  value: unknown,
): value is SessionVpnLeaseBinding["status"] {
  return (
    value === "active" ||
    value === "cleanup-pending" ||
    value === "backend-closed"
  );
}

function normalizeBindings(session: ConnectionSession): {
  bindings: SessionVpnLeaseBinding[];
  invalidReason?: string;
} {
  const persisted = session.vpnLeaseBindings ?? [];
  if (persisted.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return {
      bindings: [],
      invalidReason: `VPN ownership record exceeds the ${MAX_SESSION_VPN_LEASE_BINDINGS}-binding safety limit.`,
    };
  }

  const bindings: SessionVpnLeaseBinding[] = [];
  const seen = new Set<string>();
  for (const candidate of persisted) {
    if (
      !candidate ||
      typeof candidate.ownerId !== "string" ||
      candidate.ownerId.length === 0 ||
      typeof candidate.backendSessionId !== "string" ||
      candidate.backendSessionId.length === 0 ||
      (candidate.protocol !== "ssh" && candidate.protocol !== "rdp") ||
      !isBindingStatus(candidate.status)
    ) {
      return {
        bindings: [],
        invalidReason:
          "VPN ownership record is invalid and cannot be cleaned automatically.",
      };
    }
    const key = `${candidate.protocol}\u0000${candidate.backendSessionId}\u0000${candidate.ownerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bindings.push({ ...candidate });
  }
  const quarantine = session.vpnLeaseCleanupQuarantine;
  if (quarantine) {
    if (
      !Array.isArray(quarantine.proofs) ||
      quarantine.proofs.length > MAX_SESSION_VPN_LEASE_BINDINGS ||
      typeof quarantine.proofIncomplete !== "boolean"
    ) {
      return {
        bindings: [],
        invalidReason: "VPN cleanup quarantine is malformed.",
      };
    }
    if (quarantine.proofIncomplete) {
      return {
        bindings: [],
        invalidReason:
          "VPN cleanup quarantine is incomplete and requires manual cleanup.",
      };
    }
    for (const proof of quarantine.proofs) {
      if (proof.kind !== "binding") continue;
      if (
        !proof.ownerId ||
        !proof.backendSessionId ||
        (proof.protocol !== "ssh" && proof.protocol !== "rdp") ||
        !isBindingStatus(proof.status)
      ) {
        return {
          bindings: [],
          invalidReason: "VPN cleanup quarantine is malformed.",
        };
      }
      const key = bindingKey(proof);
      if (seen.has(key)) continue;
      seen.add(key);
      bindings.push({
        ownerId: proof.ownerId,
        backendSessionId: proof.backendSessionId,
        protocol: proof.protocol,
        status: proof.status,
      });
    }
  }
  return { bindings };
}

/** Return every persisted owner, including the legacy primary-only shape. */
export function sessionVpnLeaseOwnerIds(
  session: Pick<
    ConnectionSession,
    | "vpnLeaseOwnerId"
    | "vpnLeaseOwnerIds"
    | "vpnLeaseBindings"
    | "vpnLeaseCleanupQuarantine"
  >,
): string[] {
  return [
    ...new Set(
      [
        ...(session.vpnLeaseOwnerIds ?? []),
        session.vpnLeaseOwnerId,
        ...(session.vpnLeaseBindings ?? []).map((binding) => binding.ownerId),
        ...(session.vpnLeaseCleanupQuarantine?.proofs ?? [])
          .filter(
            (
              proof,
            ): proof is Extract<
              SessionVpnLeaseCleanupProof,
              { kind: "binding" }
            > => proof.kind === "binding",
          )
          .map((proof) => proof.ownerId),
      ].filter((ownerId): ownerId is string => Boolean(ownerId)),
    ),
  ];
}

function persistBindings(
  session: ConnectionSession,
  bindings: readonly SessionVpnLeaseBinding[],
  releasedOwnerIds: ReadonlySet<string> = new Set(),
  preferredOwnerId?: string,
): ConnectionSession {
  const mainBindings = [...bindings].slice(0, MAX_SESSION_VPN_LEASE_BINDINGS);
  const overflowBindings = [...bindings]
    .slice(MAX_SESSION_VPN_LEASE_BINDINGS)
    .map(
      (binding): SessionVpnLeaseCleanupProof => ({
        kind: "binding",
        ...binding,
      }),
    );
  const existingReleaseProofs = (
    session.vpnLeaseCleanupQuarantine?.proofs ?? []
  ).filter((proof) => proof.kind === "release-tombstone");
  const candidateProofs = [...existingReleaseProofs, ...overflowBindings];
  const proofs = candidateProofs.slice(0, MAX_SESSION_VPN_LEASE_BINDINGS);
  const proofIncomplete = Boolean(
    session.vpnLeaseCleanupQuarantine?.proofIncomplete ||
    candidateProofs.length > MAX_SESSION_VPN_LEASE_BINDINGS,
  );
  const quarantined = proofs.length > 0 || proofIncomplete;
  const mainOwnerIds = new Set(mainBindings.map((binding) => binding.ownerId));
  const ownerIds = [
    ...new Set(
      [
        ...sessionVpnLeaseOwnerIds(session).filter(
          (ownerId) =>
            !releasedOwnerIds.has(ownerId) &&
            (mainOwnerIds.has(ownerId) || mainBindings.length === 0),
        ),
        ...mainBindings.map((binding) => binding.ownerId),
      ].filter(Boolean),
    ),
  ].slice(0, MAX_SESSION_VPN_LEASE_BINDINGS);
  const primary =
    (preferredOwnerId && ownerIds.includes(preferredOwnerId)
      ? preferredOwnerId
      : undefined) ??
    (session.vpnLeaseOwnerId && ownerIds.includes(session.vpnLeaseOwnerId)
      ? session.vpnLeaseOwnerId
      : ownerIds[0]);

  return {
    ...session,
    vpnLeaseOwnerId: primary,
    vpnLeaseOwnerIds: ownerIds.length > 0 ? ownerIds : undefined,
    vpnLeaseBindings: mainBindings.length > 0 ? mainBindings : undefined,
    vpnLeaseCleanupQuarantine: quarantined
      ? { proofs, proofIncomplete }
      : undefined,
  };
}

/** Add or update one exact actor-owner binding without silently truncating it. */
export function withSessionVpnLeaseBinding(
  session: ConnectionSession,
  binding: SessionVpnLeaseBinding,
): ConnectionSession {
  if (
    session.vpnLeaseCleanupQuarantine &&
    (session.vpnLeaseCleanupQuarantine.proofIncomplete ||
      session.vpnLeaseCleanupQuarantine.proofs.length > 0)
  ) {
    throw new Error(
      "VPN cleanup evidence is quarantined; manual cleanup is required before acquiring another lease.",
    );
  }
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) throw new Error(normalized.invalidReason);
  const bindings = normalized.bindings.filter(
    (candidate) =>
      !(
        candidate.protocol === binding.protocol &&
        candidate.backendSessionId === binding.backendSessionId &&
        candidate.ownerId === binding.ownerId
      ),
  );
  if (bindings.length >= MAX_SESSION_VPN_LEASE_BINDINGS) {
    throw new Error(
      `VPN ownership record reached the ${MAX_SESSION_VPN_LEASE_BINDINGS}-binding safety limit.`,
    );
  }
  bindings.push({ ...binding });
  const next = persistBindings(session, bindings, new Set(), binding.ownerId);
  const tombstones = (next.vpnLeaseReleaseTombstones ?? []).filter(
    (tombstone) => bindingKey(tombstone) !== bindingKey(binding),
  );
  return {
    ...next,
    vpnLeaseReleaseTombstones: tombstones.length > 0 ? tombstones : undefined,
  };
}

export function sessionVpnLeaseBindings(
  session: ConnectionSession,
): SessionVpnLeaseBinding[] {
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) throw new Error(normalized.invalidReason);
  return normalized.bindings;
}

/** Exact native actors still represented by this session, including legacy. */
export function sessionVpnBackendIds(
  session: ConnectionSession,
  protocol: VpnSessionProtocol,
): string[] {
  const normalized = normalizeBindings(session);
  const boundIds = normalized.invalidReason
    ? []
    : normalized.bindings
        .filter((binding) => binding.protocol === protocol)
        .map((binding) => binding.backendSessionId);
  return [
    ...new Set(
      [
        ...boundIds,
        session.protocol.toLowerCase() === protocol
          ? session.backendSessionId
          : undefined,
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
}

export function withSessionVpnBackendStatus(
  session: ConnectionSession,
  protocol: VpnSessionProtocol,
  backendSessionId: string,
  status: SessionVpnLeaseBinding["status"],
): ConnectionSession {
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) return session;
  const bindings = normalized.bindings.map((binding) =>
    binding.protocol === protocol &&
    binding.backendSessionId === backendSessionId
      ? { ...binding, status }
      : binding,
  );
  return persistBindings(session, bindings);
}

/** Remove one released owner and every durable binding protected by it. */
export function withoutSessionVpnLeaseOwner(
  session: ConnectionSession,
  ownerId: string,
): ConnectionSession {
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) return session;
  const releasedBindings = normalized.bindings.filter(
    (binding) => binding.ownerId === ownerId,
  );
  return withReleaseTombstones(
    persistBindings(
      session,
      normalized.bindings.filter((binding) => binding.ownerId !== ownerId),
      new Set([ownerId]),
    ),
    releasedBindings,
  );
}

function moveCurrentBackendAfterClose(
  session: ConnectionSession,
  protocol: VpnSessionProtocol,
  backendSessionId: string,
): ConnectionSession {
  if (session.backendSessionId !== backendSessionId) return session;
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) return session;
  const replacement = normalized.bindings.find(
    (binding) =>
      binding.protocol === protocol &&
      binding.backendSessionId !== backendSessionId &&
      binding.status !== "backend-closed",
  );
  return {
    ...session,
    backendSessionId: replacement?.backendSessionId,
    // shellId is correlated with the backend being closed. A replacement
    // binding does not carry a shell handle, so retaining A's shell for B
    // would target the wrong actor.
    shellId: protocol === "ssh" ? undefined : session.shellId,
  };
}

function removeReleasedBindings(
  session: ConnectionSession,
  releasedOwnerIds: ReadonlySet<string>,
): ConnectionSession {
  const normalized = normalizeBindings(session);
  if (normalized.invalidReason) return session;
  const releasedBindings = normalized.bindings.filter((binding) =>
    releasedOwnerIds.has(binding.ownerId),
  );
  return withReleaseTombstones(
    persistBindings(
      session,
      normalized.bindings.filter(
        (binding) => !releasedOwnerIds.has(binding.ownerId),
      ),
      releasedOwnerIds,
    ),
    releasedBindings,
  );
}

function manualCleanupReason(
  protocol: VpnSessionProtocol,
  detail: string,
): string {
  return `${protocol.toUpperCase()} backend closed, but VPN ownership cannot be released safely: ${detail} Use the VPN manager to verify the route, then retry or remove it manually.`;
}

function prepareBackendCleanup(
  inputSessions: readonly ConnectionSession[],
  protocol: VpnSessionProtocol,
  backendSessionId: string,
): {
  sessions: ConnectionSession[];
  ownerIds: string[];
  blockedReason?: string;
} {
  let blockedReason: string | undefined;
  const sessions = inputSessions.map((original) => {
    const normalized = normalizeBindings(original);
    if (normalized.invalidReason) {
      blockedReason ??= manualCleanupReason(protocol, normalized.invalidReason);
      return original;
    }

    let session = persistBindings(original, normalized.bindings);
    const boundOwnerIds = new Set(
      normalized.bindings.map((binding) => binding.ownerId),
    );
    const uncorrelatedOwners = sessionVpnLeaseOwnerIds(original).filter(
      (ownerId) => !boundOwnerIds.has(ownerId),
    );
    const targetIsLegacyBackend =
      original.backendSessionId === backendSessionId;

    if (targetIsLegacyBackend && uncorrelatedOwners.length === 1) {
      session = withSessionVpnLeaseBinding(session, {
        ownerId: uncorrelatedOwners[0],
        backendSessionId,
        protocol,
        status: "active",
      });
    } else if (targetIsLegacyBackend && uncorrelatedOwners.length > 1) {
      blockedReason ??= manualCleanupReason(
        protocol,
        "this older session has multiple uncorrelated lease owners",
      );
    }
    return session;
  });

  const ownerIds = [
    ...new Set(
      sessions.flatMap((session) => {
        const normalized = normalizeBindings(session);
        if (normalized.invalidReason) return [];
        return normalized.bindings
          .filter(
            (binding) =>
              binding.protocol === protocol &&
              binding.backendSessionId === backendSessionId,
          )
          .map((binding) => binding.ownerId);
      }),
    ),
  ];
  return { sessions, ownerIds, blockedReason };
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
 * Close one exact native actor, durably record that proof, then release only
 * owners correlated with that actor. Replacement actors and their owners are
 * never inferred from the legacy owner array.
 */
export async function cleanupSessionVpnBackend(
  options: CleanupSessionVpnBackendOptions,
): Promise<VpnLeaseCleanupResult> {
  const {
    protocol,
    backendSessionId,
    closeBackend,
    backendAlreadyClosed = false,
    onSessionsUpdated,
  } = options;
  const prepared = prepareBackendCleanup(
    options.sessions,
    protocol,
    backendSessionId,
  );
  let sessions = prepared.sessions;
  await onSessionsUpdated?.(sessions);

  const targetBindings = sessions.flatMap((session) => {
    const normalized = normalizeBindings(session);
    return normalized.invalidReason
      ? []
      : normalized.bindings.filter(
          (binding) =>
            binding.protocol === protocol &&
            binding.backendSessionId === backendSessionId,
        );
  });
  const bindingAlreadyClosed =
    targetBindings.length > 0 &&
    targetBindings.every((binding) => binding.status === "backend-closed");

  if (!backendAlreadyClosed && !bindingAlreadyClosed) {
    try {
      await closeBackend();
    } catch (error) {
      const message = `${protocol.toUpperCase()} disconnect failed: ${String(error)}`;
      sessions = sessions.map((session) => ({
        ...withSessionVpnBackendStatus(
          session,
          protocol,
          backendSessionId,
          "cleanup-pending",
        ),
        status: "error" as const,
        errorMessage: message,
        lastActivity: new Date(),
      }));
      await onSessionsUpdated?.(sessions);
      return {
        sessions,
        backendClosed: false,
        releasedOwnerIds: [],
        failures: [],
        blockedReason: message,
      };
    }
  }

  sessions = sessions.map((session) =>
    moveCurrentBackendAfterClose(
      withSessionVpnBackendStatus(
        session,
        protocol,
        backendSessionId,
        "backend-closed",
      ),
      protocol,
      backendSessionId,
    ),
  );
  // This publication is the durable close proof. Owner release must be later.
  await onSessionsUpdated?.(sessions);

  if (prepared.blockedReason) {
    sessions = sessions.map((session) => ({
      ...session,
      status: "error" as const,
      errorMessage: prepared.blockedReason,
      lastActivity: new Date(),
    }));
    await onSessionsUpdated?.(sessions);
    return {
      sessions,
      backendClosed: true,
      releasedOwnerIds: [],
      failures: [],
      blockedReason: prepared.blockedReason,
    };
  }

  const releasableOwnerIds: string[] = [];
  let sharedOwnerBlockedReason: string | undefined;
  for (const ownerId of prepared.ownerIds) {
    const ownerBindings = sessions.flatMap((session) => {
      const normalized = normalizeBindings(session);
      return normalized.invalidReason
        ? []
        : normalized.bindings.filter((binding) => binding.ownerId === ownerId);
    });
    if (ownerBindings.some((binding) => binding.status !== "backend-closed")) {
      sharedOwnerBlockedReason ??= manualCleanupReason(
        protocol,
        "one owner is still bound to a live replacement backend",
      );
    } else {
      releasableOwnerIds.push(ownerId);
    }
  }

  const settled = await Promise.all(releasableOwnerIds.map(cleanupOwner));
  const releasedOwnerIds = settled
    .filter((result) => !("message" in result))
    .map((result) => result.ownerId);
  const failures = settled.filter(
    (result): result is VpnLeaseCleanupFailure => "message" in result,
  );
  const releasedOwners = new Set(releasedOwnerIds);
  const cleanupError =
    failures.length > 0
      ? vpnLeaseCleanupFailureMessage(protocol, {
          failures,
        })
      : sharedOwnerBlockedReason;

  let proofLedgerBlockedReason: string | undefined;

  sessions = sessions.map((original) => {
    const session = removeReleasedBindings(original, releasedOwners);
    const proofLedgerFull = Boolean(
      session.vpnLeaseCleanupQuarantine &&
      (session.vpnLeaseCleanupQuarantine.proofIncomplete ||
        session.vpnLeaseCleanupQuarantine.proofs.length > 0),
    );
    if (proofLedgerFull) proofLedgerBlockedReason ??= session.errorMessage;
    const normalized = normalizeBindings(session);
    const hasTargetBinding =
      !normalized.invalidReason &&
      normalized.bindings.some(
        (binding) =>
          binding.protocol === protocol &&
          binding.backendSessionId === backendSessionId,
      );
    const hasReplacement =
      !normalized.invalidReason &&
      normalized.bindings.some(
        (binding) =>
          binding.protocol === protocol &&
          binding.backendSessionId !== backendSessionId &&
          binding.status !== "backend-closed",
      );
    const failed =
      hasTargetBinding ||
      Boolean(sharedOwnerBlockedReason) ||
      Boolean(proofLedgerFull);
    return {
      ...session,
      status: failed
        ? ("error" as const)
        : hasReplacement
          ? session.status === "error"
            ? ("connected" as const)
            : session.status
          : ("disconnected" as const),
      errorMessage: failed
        ? proofLedgerFull
          ? session.errorMessage
          : cleanupError
        : undefined,
      lastActivity: new Date(),
    };
  });
  await onSessionsUpdated?.(sessions);

  return {
    sessions,
    backendClosed: true,
    releasedOwnerIds,
    failures,
    blockedReason: sharedOwnerBlockedReason ?? proofLedgerBlockedReason,
  };
}

/**
 * Resolve frontend rows that own a native SSH/RDP actor. Exact durable
 * bindings win even when `backendSessionId` already points at a replacement.
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
    (session) =>
      session.backendSessionId === backendSessionId ||
      (session.vpnLeaseBindings ?? []).some(
        (binding) =>
          binding.protocol === protocol &&
          binding.backendSessionId === backendSessionId,
      ) ||
      (session.vpnLeaseCleanupQuarantine?.proofs ?? []).some(
        (proof) =>
          proof.kind === "binding" &&
          proof.protocol === protocol &&
          proof.backendSessionId === backendSessionId,
      ),
  );
  if (exact.length > 0 || protocol !== "rdp" || !connectionId) return exact;

  return protocolRows.filter(
    (session) =>
      session.connectionId === connectionId &&
      (!session.backendSessionId || session.backendSessionId === connectionId),
  );
}

export function vpnLeaseCleanupFailureMessage(
  protocol: VpnSessionProtocol,
  result: Pick<VpnLeaseCleanupResult, "failures">,
): string {
  const detail = result.failures.map((failure) => failure.message).join("; ");
  return `${protocol.toUpperCase()} disconnected, but VPN cleanup needs attention${detail ? `: ${detail}` : "."} Retry disconnect to finish cleanup.`;
}
