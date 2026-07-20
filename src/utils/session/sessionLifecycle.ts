import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
  type SessionVpnLeaseBinding,
  type SessionVpnLeaseCleanupProof,
  type SessionVpnLeaseCleanupQuarantine,
  type SessionVpnLeaseReleaseTombstone,
} from "../../types/connection/connection";
import type { SessionLifecyclePatch } from "../../types/windowManager";

const SESSION_STATUSES = new Set<ConnectionSession["status"]>([
  "connecting",
  "connected",
  "disconnected",
  "error",
  "reconnecting",
]);

const copyOwnerIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return undefined;
  }
  if (
    !value.every((ownerId) => typeof ownerId === "string" && ownerId.length > 0)
  ) {
    return undefined;
  }
  return [...new Set(value)];
};

const copyBindings = (value: unknown): SessionVpnLeaseBinding[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return undefined;
  }

  const bindings: SessionVpnLeaseBinding[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const binding = candidate as Record<string, unknown>;
    if (
      typeof binding.ownerId !== "string" ||
      binding.ownerId.length === 0 ||
      typeof binding.backendSessionId !== "string" ||
      binding.backendSessionId.length === 0 ||
      (binding.protocol !== "ssh" && binding.protocol !== "rdp") ||
      (binding.status !== "active" &&
        binding.status !== "cleanup-pending" &&
        binding.status !== "backend-closed")
    ) {
      return undefined;
    }
    bindings.push({
      ownerId: binding.ownerId,
      backendSessionId: binding.backendSessionId,
      protocol: binding.protocol,
      status: binding.status,
    });
  }
  return bindings;
};

const copyReleaseTombstones = (
  value: unknown,
): SessionVpnLeaseReleaseTombstone[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return undefined;
  }
  const tombstones: SessionVpnLeaseReleaseTombstone[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const tombstone = candidate as Record<string, unknown>;
    if (
      typeof tombstone.ownerId !== "string" ||
      tombstone.ownerId.length === 0 ||
      typeof tombstone.backendSessionId !== "string" ||
      tombstone.backendSessionId.length === 0 ||
      (tombstone.protocol !== "ssh" && tombstone.protocol !== "rdp")
    ) {
      return undefined;
    }
    const key = `${tombstone.protocol}\0${tombstone.backendSessionId}\0${tombstone.ownerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tombstones.push({
      ownerId: tombstone.ownerId,
      backendSessionId: tombstone.backendSessionId,
      protocol: tombstone.protocol,
    });
  }
  return tombstones;
};

const bindingKey = (
  binding: SessionVpnLeaseBinding | SessionVpnLeaseReleaseTombstone,
): string =>
  `${binding.protocol}\0${binding.backendSessionId}\0${binding.ownerId}`;

const copyCleanupQuarantine = (
  value: unknown,
): SessionVpnLeaseCleanupQuarantine | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.proofs) ||
    candidate.proofs.length > MAX_SESSION_VPN_LEASE_BINDINGS ||
    typeof candidate.proofIncomplete !== "boolean"
  ) {
    return undefined;
  }
  const proofs: SessionVpnLeaseCleanupProof[] = [];
  for (const rawProof of candidate.proofs) {
    if (!rawProof || typeof rawProof !== "object") return undefined;
    const proof = rawProof as Record<string, unknown>;
    let copied: SessionVpnLeaseCleanupProof | undefined;
    if (proof.kind === "binding") {
      const binding = copyBindings([proof])?.[0];
      if (binding) copied = { kind: "binding", ...binding };
    } else if (proof.kind === "release-tombstone") {
      const tombstone = copyReleaseTombstones([proof])?.[0];
      if (tombstone) copied = { kind: "release-tombstone", ...tombstone };
    }
    if (!copied) return undefined;
    const key = bindingKey(copied);
    const index = proofs.findIndex((proof) => bindingKey(proof) === key);
    if (index !== -1) {
      const existing = proofs[index];
      if (existing.kind === "release-tombstone") continue;
      if (copied.kind === "release-tombstone") {
        proofs[index] = copied;
      } else if (cleanupRank(copied.status) > cleanupRank(existing.status)) {
        proofs[index] = copied;
      }
      continue;
    }
    proofs.push(copied);
  }
  return { proofs, proofIncomplete: candidate.proofIncomplete };
};

export const VPN_CLEANUP_QUARANTINE_ERROR =
  "VPN cleanup evidence is quarantined. Manual cleanup is required before reconnecting.";

export const hasSessionVpnCleanupQuarantine = (
  session: Pick<ConnectionSession, "vpnLeaseCleanupQuarantine">,
): boolean =>
  Boolean(
    session.vpnLeaseCleanupQuarantine &&
    (session.vpnLeaseCleanupQuarantine.proofIncomplete ||
      session.vpnLeaseCleanupQuarantine.proofs.length > 0),
  );

export const getSessionLifecycleRevision = (
  session: Pick<ConnectionSession, "lifecycleRevision">,
): number => {
  const revision = session.lifecycleRevision;
  return typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 0
    ? revision
    : 0;
};

export const getSessionLifecycleActorGeneration = (
  session: Pick<ConnectionSession, "lifecycleActorGeneration">,
): number => {
  const generation = session.lifecycleActorGeneration;
  return typeof generation === "number" &&
    Number.isSafeInteger(generation) &&
    generation >= 0
    ? generation
    : 0;
};

export const getSessionLifecycleWriterId = (
  session: Pick<ConnectionSession, "lifecycleWriterId">,
): string =>
  typeof session.lifecycleWriterId === "string" &&
  session.lifecycleWriterId.length > 0
    ? session.lifecycleWriterId
    : "main";

const isDetachedWriter = (writerId: string): boolean =>
  writerId === "detached-browser" || writerId.startsWith("detached-");

export interface SessionLifecycleActorAttempt {
  sessionId: string;
  reservationId: number;
  generation: number;
  writerId: string;
  revision: number;
}

const lifecycleHighWater = new Map<string, number>();
const lifecycleAttempts = new Map<
  string,
  Map<number, { generation: number; writerId: string }>
>();
const lifecycleAuthorities = new Map<
  string,
  { generation: number; writerId: string }
>();
const lifecycleCancelledAuthorities = new Map<
  string,
  { generation: number; writerId: string }
>();
let nextLifecycleReservationId = 1;

const observeLifecycleGeneration = (
  sessionId: string,
  generation: number,
): number => {
  const observed = Math.max(lifecycleHighWater.get(sessionId) ?? 0, generation);
  lifecycleHighWater.set(sessionId, observed);
  return observed;
};

/** Reserve an actor generation before invoking a native SSH/RDP connect. */
export const reserveSessionLifecycleActorAttempt = (
  session: ConnectionSession,
  expectedAuthority: { generation: number; writerId: string } = {
    generation: getSessionLifecycleActorGeneration(session),
    writerId: getSessionLifecycleWriterId(session),
  },
): { attempt: SessionLifecycleActorAttempt; session: ConnectionSession } => {
  if (hasSessionVpnCleanupQuarantine(session)) {
    throw new Error(VPN_CLEANUP_QUARANTINE_ERROR);
  }
  const sessionAuthority = {
    generation: getSessionLifecycleActorGeneration(session),
    writerId: getSessionLifecycleWriterId(session),
  };
  let allocatedAuthority = lifecycleAuthorities.get(session.id);
  const cancelledAuthority = lifecycleCancelledAuthorities.get(session.id);
  const hasLiveAttempt = hasSessionLifecycleActorAttempt(session.id);
  if (
    allocatedAuthority &&
    !hasLiveAttempt &&
    sessionAuthority.generation > allocatedAuthority.generation
  ) {
    // A surviving window may receive the session back after ownership moved
    // elsewhere. A strictly newer synchronized authority supersedes the local
    // allocator's historical high-water owner.
    lifecycleAuthorities.set(session.id, sessionAuthority);
    observeLifecycleGeneration(session.id, sessionAuthority.generation);
    allocatedAuthority = sessionAuthority;
  }
  if (!allocatedAuthority && cancelledAuthority) {
    const sameWriterRemount =
      sessionAuthority.writerId === cancelledAuthority.writerId &&
      sessionAuthority.generation <= cancelledAuthority.generation;
    const strictlyNewerReturnedAuthority =
      sessionAuthority.generation > cancelledAuthority.generation;
    if (!sameWriterRemount && !strictlyNewerReturnedAuthority) {
      throw new Error(
        "Session lifecycle authority changed before the native actor reservation.",
      );
    }
  }
  if (
    sessionAuthority.generation !== expectedAuthority.generation ||
    sessionAuthority.writerId !== expectedAuthority.writerId ||
    (allocatedAuthority &&
      (allocatedAuthority.generation !== expectedAuthority.generation ||
        allocatedAuthority.writerId !== expectedAuthority.writerId))
  ) {
    throw new Error(
      "Session lifecycle authority changed before the native actor reservation.",
    );
  }
  lifecycleCancelledAuthorities.delete(session.id);
  const generation =
    observeLifecycleGeneration(
      session.id,
      getSessionLifecycleActorGeneration(session),
    ) + 1;
  lifecycleHighWater.set(session.id, generation);
  const reservationId = nextLifecycleReservationId++;
  const writerId = getSessionLifecycleWriterId(session);
  const attempts =
    lifecycleAttempts.get(session.id) ??
    new Map<number, { generation: number; writerId: string }>();
  attempts.set(reservationId, { generation, writerId });
  lifecycleAttempts.set(session.id, attempts);
  lifecycleAuthorities.set(session.id, { generation, writerId });
  return {
    attempt: {
      sessionId: session.id,
      reservationId,
      generation,
      writerId,
      revision: getSessionLifecycleRevision(session) + 1,
    },
    session: {
      ...session,
      lifecycleActorGeneration: generation,
      lifecycleWriterId: writerId,
      lifecycleActorReservationId: reservationId,
      lifecycleRevision: getSessionLifecycleRevision(session) + 1,
    },
  };
};

export const finishSessionLifecycleActorAttempt = (
  attempt: SessionLifecycleActorAttempt | null | undefined,
): void => {
  if (!attempt) return;
  const attempts = lifecycleAttempts.get(attempt.sessionId);
  attempts?.delete(attempt.reservationId);
  if (attempts?.size === 0) {
    lifecycleAttempts.delete(attempt.sessionId);
  }
};

/** Test isolation only; production must never reset lifecycle high-water. */
export const resetSessionLifecycleAllocatorForTests = (): void => {
  lifecycleAttempts.clear();
  lifecycleAuthorities.clear();
  lifecycleCancelledAuthorities.clear();
  lifecycleHighWater.clear();
  nextLifecycleReservationId = 1;
};

export const hasSessionLifecycleActorAttempt = (sessionId: string): boolean =>
  (lifecycleAttempts.get(sessionId)?.size ?? 0) > 0;

/**
 * Revoke all process-local reservations when a viewer is unmounted. Historical
 * authority/high-water is intentionally retained so a stale snapshot cannot
 * mint an actor generation that was already allocated.
 */
export const cancelSessionLifecycleActorAttempts = (
  sessionId: string,
): void => {
  const attempts = lifecycleAttempts.get(sessionId);
  if (!attempts || attempts.size === 0) return;
  const authority = lifecycleAuthorities.get(sessionId);
  if (
    authority &&
    [...attempts.values()].some(
      (attempt) =>
        attempt.generation === authority.generation &&
        attempt.writerId === authority.writerId,
    )
  ) {
    // Cancellation revokes only the authority still owned by one of these
    // attempts. A later window handoff must remain authoritative.
    lifecycleAuthorities.delete(sessionId);
    lifecycleCancelledAuthorities.set(sessionId, authority);
  }
  lifecycleAttempts.delete(sessionId);
};

/** Transfer authority past all in-flight reservations before window handoff. */
export const advanceSessionLifecycleAuthority = (
  session: ConnectionSession,
  writerId: string,
): ConnectionSession => {
  const generation =
    observeLifecycleGeneration(
      session.id,
      getSessionLifecycleActorGeneration(session),
    ) + 1;
  lifecycleHighWater.set(session.id, generation);
  lifecycleAuthorities.set(session.id, { generation, writerId });
  lifecycleCancelledAuthorities.delete(session.id);
  const advanced: ConnectionSession = {
    ...session,
    lifecycleActorGeneration: generation,
    lifecycleWriterId: writerId,
    lifecycleRevision: getSessionLifecycleRevision(session) + 1,
  };
  delete advanced.lifecycleActorReservationId;
  return advanced;
};

export const withSessionLifecycleAttempt = (
  session: ConnectionSession,
  attempt: SessionLifecycleActorAttempt | null | undefined,
): ConnectionSession => {
  if (!attempt) return session;
  attempt.revision =
    Math.max(attempt.revision, getSessionLifecycleRevision(session)) + 1;
  return {
    ...session,
    lifecycleActorGeneration: attempt.generation,
    lifecycleWriterId: attempt.writerId,
    lifecycleActorReservationId: attempt.reservationId,
    lifecycleRevision: attempt.revision,
  };
};

const liveActorIds = (session: Partial<ConnectionSession>): Set<string> => {
  const ids = new Set<string>();
  if (session.backendSessionId) ids.add(session.backendSessionId);
  for (const binding of session.vpnLeaseBindings ?? []) {
    if (binding.status !== "backend-closed") ids.add(binding.backendSessionId);
  }
  return ids;
};

const hasNewLiveActor = (
  current: ConnectionSession,
  candidate: ConnectionSession,
): boolean => {
  const currentActors = liveActorIds(current);
  return [...liveActorIds(candidate)].some(
    (actor) => !currentActors.has(actor),
  );
};

const cleanupRank = (status: SessionVpnLeaseBinding["status"]): number =>
  status === "backend-closed" ? 2 : status === "cleanup-pending" ? 1 : 0;

/**
 * Retain exact lower-generation cleanup proof without letting the obsolete
 * writer replace the current actor, shell, primary owner, or status.
 */
const mergeCleanupLedger = (
  current: ConnectionSession,
  obsolete: Partial<ConnectionSession>,
): ConnectionSession => {
  const currentQuarantine = copyCleanupQuarantine(
    current.vpnLeaseCleanupQuarantine,
  ) ?? {
    proofs: [],
    proofIncomplete: false,
  };
  const incomingQuarantine = copyCleanupQuarantine(
    obsolete.vpnLeaseCleanupQuarantine,
  );
  const quarantine: SessionVpnLeaseCleanupQuarantine = {
    proofs: [...currentQuarantine.proofs],
    proofIncomplete:
      currentQuarantine.proofIncomplete ||
      Boolean(incomingQuarantine?.proofIncomplete),
  };
  let changed =
    quarantine.proofIncomplete !== currentQuarantine.proofIncomplete;
  const quarantineProof = (proof: SessionVpnLeaseCleanupProof): void => {
    const key = bindingKey(proof);
    const sameKeyIndexes = quarantine.proofs
      .map((candidate, index) => (bindingKey(candidate) === key ? index : -1))
      .filter((index) => index >= 0);
    const releaseIndex = sameKeyIndexes.find(
      (index) => quarantine.proofs[index].kind === "release-tombstone",
    );
    const bindingIndex = sameKeyIndexes.find(
      (index) => quarantine.proofs[index].kind === "binding",
    );
    if (proof.kind === "binding") {
      if (releaseIndex !== undefined) return;
      if (bindingIndex !== undefined) {
        const existing = quarantine.proofs[bindingIndex];
        if (
          existing.kind === "binding" &&
          cleanupRank(proof.status) > cleanupRank(existing.status)
        ) {
          quarantine.proofs[bindingIndex] = proof;
          changed = true;
        }
        return;
      }
    } else {
      if (releaseIndex !== undefined) return;
      if (bindingIndex !== undefined) {
        quarantine.proofs.splice(bindingIndex, 1);
        changed = true;
      }
    }
    if (quarantine.proofs.length >= MAX_SESSION_VPN_LEASE_BINDINGS) {
      if (!quarantine.proofIncomplete) {
        quarantine.proofIncomplete = true;
        changed = true;
      }
      return;
    }
    quarantine.proofs.push(proof);
    changed = true;
  };
  const retainedCurrentProofs = [...quarantine.proofs];
  quarantine.proofs = [];
  const changedBeforeRebuild = changed;
  retainedCurrentProofs.forEach(quarantineProof);
  changed = changedBeforeRebuild;
  incomingQuarantine?.proofs.forEach(quarantineProof);

  const incomingTombstones =
    copyReleaseTombstones(obsolete.vpnLeaseReleaseTombstones) ?? [];
  const tombstones =
    copyReleaseTombstones(current.vpnLeaseReleaseTombstones) ?? [];
  const tombstoneKeys = new Set(tombstones.map(bindingKey));
  for (const proof of quarantine.proofs) {
    if (proof.kind === "release-tombstone") {
      tombstoneKeys.add(bindingKey(proof));
    }
  }
  const newTombstones: SessionVpnLeaseReleaseTombstone[] = [];
  const candidateTombstoneKeys = new Set(tombstoneKeys);
  for (const tombstone of incomingTombstones) {
    const key = bindingKey(tombstone);
    if (candidateTombstoneKeys.has(key)) continue;
    candidateTombstoneKeys.add(key);
    newTombstones.push(tombstone);
  }
  for (const tombstone of newTombstones) {
    const key = bindingKey(tombstone);
    if (tombstones.length < MAX_SESSION_VPN_LEASE_BINDINGS) {
      tombstones.push(tombstone);
    } else {
      quarantineProof({ kind: "release-tombstone", ...tombstone });
    }
    tombstoneKeys.add(key);
    changed = true;
  }
  const retainedQuarantineProofs = quarantine.proofs.filter(
    (proof) =>
      proof.kind === "release-tombstone" ||
      !tombstoneKeys.has(bindingKey(proof)),
  );
  if (retainedQuarantineProofs.length !== quarantine.proofs.length) {
    quarantine.proofs = retainedQuarantineProofs;
    changed = true;
  }

  const cleanupBindings = (
    copyBindings(obsolete.vpnLeaseBindings) ?? []
  ).filter(
    (binding) =>
      binding.status !== "active" && !tombstoneKeys.has(bindingKey(binding)),
  );

  let bindings = copyBindings(current.vpnLeaseBindings) ?? [];
  const retainedBindings = bindings.filter(
    (binding) => !tombstoneKeys.has(bindingKey(binding)),
  );
  if (retainedBindings.length !== bindings.length) changed = true;
  bindings = retainedBindings;
  for (const cleanup of cleanupBindings) {
    const index = bindings.findIndex(
      (binding) =>
        binding.ownerId === cleanup.ownerId &&
        binding.backendSessionId === cleanup.backendSessionId &&
        binding.protocol === cleanup.protocol,
    );
    if (index === -1) {
      const boundOwnerIds = new Set(bindings.map((binding) => binding.ownerId));
      const releasedOwnerIds = new Set(
        [
          ...tombstones.map((tombstone) => tombstone.ownerId),
          ...quarantine.proofs
            .filter((proof) => proof.kind === "release-tombstone")
            .map((proof) => proof.ownerId),
        ].filter((ownerId) => !boundOwnerIds.has(ownerId)),
      );
      const prospectiveOwnerIds = new Set([
        ...(current.vpnLeaseOwnerIds ?? []).filter(
          (ownerId) => !releasedOwnerIds.has(ownerId),
        ),
        ...(current.vpnLeaseOwnerId &&
        !releasedOwnerIds.has(current.vpnLeaseOwnerId)
          ? [current.vpnLeaseOwnerId]
          : []),
        ...boundOwnerIds,
        cleanup.ownerId,
      ]);
      if (
        bindings.length >= MAX_SESSION_VPN_LEASE_BINDINGS ||
        prospectiveOwnerIds.size > MAX_SESSION_VPN_LEASE_BINDINGS
      ) {
        quarantineProof({ kind: "binding", ...cleanup });
      } else {
        bindings.push(cleanup);
      }
      changed = true;
      continue;
    }
    if (cleanupRank(cleanup.status) > cleanupRank(bindings[index].status)) {
      bindings[index] = cleanup;
      changed = true;
    }
  }
  if (!changed) return current;

  const boundOwnerIds = new Set(bindings.map((binding) => binding.ownerId));
  const releasedOwnerIds = new Set(
    [
      ...tombstones.map((tombstone) => tombstone.ownerId),
      ...quarantine.proofs
        .filter((proof) => proof.kind === "release-tombstone")
        .map((proof) => proof.ownerId),
    ].filter((ownerId) => !boundOwnerIds.has(ownerId)),
  );
  const ownerIds = [
    ...new Set([
      ...(current.vpnLeaseOwnerIds ?? []).filter(
        (ownerId) => !releasedOwnerIds.has(ownerId),
      ),
      ...(current.vpnLeaseOwnerId &&
      !releasedOwnerIds.has(current.vpnLeaseOwnerId)
        ? [current.vpnLeaseOwnerId]
        : []),
      ...bindings.map((binding) => binding.ownerId),
    ]),
  ];
  const quarantined =
    quarantine.proofs.length > 0 || quarantine.proofIncomplete;
  const next: ConnectionSession = {
    ...current,
    vpnLeaseOwnerId:
      current.vpnLeaseOwnerId && ownerIds.includes(current.vpnLeaseOwnerId)
        ? current.vpnLeaseOwnerId
        : ownerIds[0],
    vpnLeaseOwnerIds: ownerIds.length > 0 ? ownerIds : undefined,
    vpnLeaseBindings: bindings.length > 0 ? bindings : undefined,
    vpnLeaseReleaseTombstones: tombstones.length > 0 ? tombstones : undefined,
    vpnLeaseCleanupQuarantine: quarantined ? quarantine : undefined,
    status: quarantined ? "error" : current.status,
    errorMessage: quarantined
      ? `${VPN_CLEANUP_QUARANTINE_ERROR}${quarantine.proofIncomplete ? " Additional cleanup proof could not be represented." : ""}`
      : current.errorMessage,
    lifecycleRevision: getSessionLifecycleRevision(current) + 1,
  };
  if (!next.vpnLeaseOwnerId) delete next.vpnLeaseOwnerId;
  return next;
};

const validLifecycleOwnership = (session: ConnectionSession): boolean =>
  (session.vpnLeaseOwnerId === undefined ||
    (typeof session.vpnLeaseOwnerId === "string" &&
      session.vpnLeaseOwnerId.length > 0)) &&
  (session.vpnLeaseOwnerIds === undefined ||
    copyOwnerIds(session.vpnLeaseOwnerIds) !== undefined) &&
  (session.vpnLeaseBindings === undefined ||
    copyBindings(session.vpnLeaseBindings) !== undefined) &&
  (session.vpnLeaseReleaseTombstones === undefined ||
    copyReleaseTombstones(session.vpnLeaseReleaseTombstones) !== undefined) &&
  (session.vpnLeaseCleanupQuarantine === undefined ||
    copyCleanupQuarantine(session.vpnLeaseCleanupQuarantine) !== undefined);

const lifecycleComparable = (session: ConnectionSession) => ({
  backendSessionId: session.backendSessionId,
  shellId: session.shellId,
  vpnLeaseOwnerId: session.vpnLeaseOwnerId,
  vpnLeaseOwnerIds: session.vpnLeaseOwnerIds ?? null,
  vpnLeaseBindings: session.vpnLeaseBindings ?? null,
  vpnLeaseReleaseTombstones: session.vpnLeaseReleaseTombstones ?? null,
  vpnLeaseCleanupQuarantine: session.vpnLeaseCleanupQuarantine ?? null,
  status: session.status,
  errorMessage: session.errorMessage,
  lastActivity:
    session.lastActivity instanceof Date
      ? session.lastActivity.toISOString()
      : session.lastActivity,
});

const hasLifecycleDifference = (
  current: ConnectionSession,
  candidate: ConnectionSession,
): boolean =>
  JSON.stringify(lifecycleComparable(current)) !==
  JSON.stringify(lifecycleComparable(candidate));

const copyLifecycle = (
  base: ConnectionSession,
  source: Partial<ConnectionSession>,
): ConnectionSession => {
  const next = { ...base };
  delete next.backendSessionId;
  delete next.shellId;
  delete next.vpnLeaseOwnerId;
  delete next.vpnLeaseOwnerIds;
  delete next.vpnLeaseBindings;
  delete next.vpnLeaseReleaseTombstones;
  delete next.vpnLeaseCleanupQuarantine;
  delete next.errorMessage;
  delete next.lastActivity;
  delete next.lifecycleActorGeneration;
  delete next.lifecycleWriterId;
  delete next.lifecycleActorReservationId;

  if (source.backendSessionId) next.backendSessionId = source.backendSessionId;
  if (source.shellId) next.shellId = source.shellId;
  if (source.vpnLeaseOwnerId) next.vpnLeaseOwnerId = source.vpnLeaseOwnerId;
  if (source.vpnLeaseOwnerIds) {
    next.vpnLeaseOwnerIds = copyOwnerIds(source.vpnLeaseOwnerIds);
  }
  if (source.vpnLeaseBindings) {
    next.vpnLeaseBindings = copyBindings(source.vpnLeaseBindings);
  }
  if (source.vpnLeaseReleaseTombstones) {
    next.vpnLeaseReleaseTombstones = copyReleaseTombstones(
      source.vpnLeaseReleaseTombstones,
    );
  }
  if (source.vpnLeaseCleanupQuarantine) {
    next.vpnLeaseCleanupQuarantine = copyCleanupQuarantine(
      source.vpnLeaseCleanupQuarantine,
    );
  }
  if (source.status && SESSION_STATUSES.has(source.status)) {
    next.status = source.status;
  }
  if (source.errorMessage) next.errorMessage = source.errorMessage;
  if (source.lastActivity) {
    next.lastActivity =
      source.lastActivity instanceof Date
        ? new Date(source.lastActivity)
        : source.lastActivity;
  }
  next.lifecycleRevision = getSessionLifecycleRevision(source);
  next.lifecycleActorGeneration = getSessionLifecycleActorGeneration(source);
  next.lifecycleWriterId = getSessionLifecycleWriterId(source);
  if (
    typeof source.lifecycleActorReservationId === "number" &&
    Number.isSafeInteger(source.lifecycleActorReservationId) &&
    source.lifecycleActorReservationId > 0
  ) {
    next.lifecycleActorReservationId = source.lifecycleActorReservationId;
  }
  return next;
};

/**
 * Merge a local UPDATE_SESSION payload and advance the lifecycle clock only
 * when native actor/VPN ownership fields actually changed.
 */
export const mergeLocalSessionUpdate = (
  current: ConnectionSession,
  update: Pick<ConnectionSession, "id"> & Partial<ConnectionSession>,
): ConnectionSession => {
  const currentRevision = getSessionLifecycleRevision(current);
  const updateHasRevision =
    typeof update.lifecycleRevision === "number" &&
    Number.isSafeInteger(update.lifecycleRevision) &&
    update.lifecycleRevision >= 0;
  const updateRevision = getSessionLifecycleRevision(update);
  const candidate = { ...current, ...update };
  const currentGeneration = getSessionLifecycleActorGeneration(current);
  const updateHasGeneration =
    typeof update.lifecycleActorGeneration === "number" &&
    Number.isSafeInteger(update.lifecycleActorGeneration) &&
    update.lifecycleActorGeneration >= 0;
  const updateGeneration = getSessionLifecycleActorGeneration(update);

  if (!validLifecycleOwnership(candidate)) {
    return copyLifecycle(candidate, current);
  }

  // A shell belongs to one exact SSH backend. Never carry the old shell ID
  // across a backend pointer replacement unless a distinct new shell arrived
  // atomically in the same update.
  if (
    candidate.backendSessionId !== current.backendSessionId &&
    candidate.shellId === current.shellId
  ) {
    delete candidate.shellId;
  }

  if (updateHasGeneration) {
    if (updateGeneration < currentGeneration) {
      return mergeCleanupLedger(current, update);
    }

    const updateWriter = getSessionLifecycleWriterId(update);
    const currentWriter = getSessionLifecycleWriterId(current);
    const backendConflict =
      candidate.backendSessionId !== current.backendSessionId &&
      Boolean(candidate.backendSessionId || current.backendSessionId);
    const incomingAuthorityWins =
      isDetachedWriter(updateWriter) && !isDetachedWriter(currentWriter);
    const matchingReservation =
      typeof update.lifecycleActorReservationId === "number" &&
      update.lifecycleActorReservationId ===
        current.lifecycleActorReservationId;
    const activeReservations = lifecycleAttempts.get(current.id);
    const reservationMayPublishActor =
      matchingReservation &&
      (current.backendSessionId === undefined ||
        activeReservations?.has(update.lifecycleActorReservationId!) === true);

    if (
      updateGeneration === currentGeneration &&
      (backendConflict || updateWriter !== currentWriter) &&
      !incomingAuthorityWins &&
      !reservationMayPublishActor
    ) {
      return mergeCleanupLedger(current, update);
    }

    if (
      updateGeneration === currentGeneration &&
      !incomingAuthorityWins &&
      !reservationMayPublishActor &&
      (!updateHasRevision || updateRevision <= currentRevision)
    ) {
      return mergeCleanupLedger(current, update);
    }

    const accepted = copyLifecycle(candidate, update);
    accepted.lifecycleRevision =
      updateRevision > currentRevision ? updateRevision : currentRevision + 1;
    return mergeCleanupLedger(accepted, current);
  }

  if (updateHasRevision && updateRevision < currentRevision) {
    return current;
  }

  if (updateHasRevision && updateRevision > currentRevision) {
    const accepted = copyLifecycle(candidate, update);
    if (hasNewLiveActor(current, accepted)) {
      accepted.lifecycleActorGeneration = currentGeneration + 1;
      accepted.lifecycleWriterId = getSessionLifecycleWriterId(current);
    }
    return mergeCleanupLedger(accepted, current);
  }

  const lifecycleChanged = hasLifecycleDifference(current, candidate);
  candidate.lifecycleRevision = lifecycleChanged
    ? currentRevision + 1
    : currentRevision;
  candidate.lifecycleActorGeneration = hasNewLiveActor(current, candidate)
    ? currentGeneration + 1
    : currentGeneration;
  candidate.lifecycleWriterId = lifecycleChanged
    ? getSessionLifecycleWriterId(candidate)
    : getSessionLifecycleWriterId(current);
  return mergeCleanupLedger(candidate, current);
};

/**
 * Reconcile a complete main-window snapshot into a detached provider. Older
 * or conflicting equal-revision lifecycle state may update presentation data,
 * but can never erase the local actor/owner proof.
 */
export const reconcileSessionLifecycleSnapshot = (
  current: ConnectionSession,
  incoming: ConnectionSession,
): ConnectionSession => {
  const currentRevision = getSessionLifecycleRevision(current);
  const incomingRevision = getSessionLifecycleRevision(incoming);
  const currentGeneration = getSessionLifecycleActorGeneration(current);
  const incomingGeneration = getSessionLifecycleActorGeneration(incoming);
  const presentation = {
    ...current,
    ...incoming,
    // Window ownership is authority state, not ordinary presentation data.
    layout: current.layout,
  };

  const backendConflict =
    current.backendSessionId !== incoming.backendSessionId &&
    Boolean(current.backendSessionId || incoming.backendSessionId);
  const incomingIsNewer =
    incomingGeneration > currentGeneration ||
    (incomingGeneration === currentGeneration &&
      !backendConflict &&
      incomingRevision > currentRevision);

  if (incomingIsNewer && validLifecycleOwnership(incoming)) {
    const accepted = copyLifecycle(presentation, incoming);
    if (
      incoming.backendSessionId !== current.backendSessionId &&
      incoming.shellId === current.shellId
    ) {
      delete accepted.shellId;
    }
    return mergeCleanupLedger(accepted, current);
  }

  return mergeCleanupLedger(copyLifecycle(presentation, current), incoming);
};

/** Build a complete, secret-safe lifecycle snapshot for cross-window IPC. */
export const toSessionLifecyclePatch = (
  session: ConnectionSession,
  writerId?: string,
): SessionLifecyclePatch => {
  const ownerIds = session.vpnLeaseOwnerIds
    ? copyOwnerIds(session.vpnLeaseOwnerIds)
    : null;
  const bindings = session.vpnLeaseBindings
    ? copyBindings(session.vpnLeaseBindings)
    : null;
  const releaseTombstones = session.vpnLeaseReleaseTombstones
    ? copyReleaseTombstones(session.vpnLeaseReleaseTombstones)
    : null;
  const cleanupQuarantine = session.vpnLeaseCleanupQuarantine
    ? copyCleanupQuarantine(session.vpnLeaseCleanupQuarantine)
    : null;
  const lastActivity = session.lastActivity;

  return {
    revision: getSessionLifecycleRevision(session),
    actorGeneration: getSessionLifecycleActorGeneration(session),
    writerId: writerId ?? getSessionLifecycleWriterId(session),
    backendSessionId: session.backendSessionId ?? null,
    shellId: session.shellId ?? null,
    vpnLeaseOwnerId: session.vpnLeaseOwnerId ?? null,
    vpnLeaseOwnerIds: ownerIds,
    vpnLeaseBindings: bindings,
    vpnLeaseReleaseTombstones: releaseTombstones,
    vpnLeaseCleanupQuarantine: cleanupQuarantine,
    status: session.status,
    errorMessage: session.errorMessage ?? null,
    lastActivity:
      lastActivity instanceof Date && Number.isFinite(lastActivity.getTime())
        ? lastActivity.toISOString()
        : null,
  };
};

/** Merge only a newer allow-listed lifecycle snapshot into the canonical row. */
export const applySessionLifecyclePatch = (
  session: ConnectionSession,
  patch: SessionLifecyclePatch | undefined,
): ConnectionSession => {
  if (!patch || typeof patch !== "object") return session;
  const currentRevision = getSessionLifecycleRevision(session);
  const currentGeneration = getSessionLifecycleActorGeneration(session);
  const currentWriter = getSessionLifecycleWriterId(session);
  const hasRevision =
    typeof patch.revision === "number" &&
    Number.isSafeInteger(patch.revision) &&
    patch.revision >= 0;
  const hasGeneration =
    typeof patch.actorGeneration === "number" &&
    Number.isSafeInteger(patch.actorGeneration) &&
    patch.actorGeneration >= 0;
  const hasWriter =
    typeof patch.writerId === "string" && patch.writerId.length > 0;
  // Safety proof ledgers can be union-merged without granting actor authority.
  // Every actor-owned lifecycle field requires complete versioned provenance.
  if (!hasRevision || !hasGeneration || !hasWriter) {
    return mergeCleanupLedger(session, {
      vpnLeaseBindings: patch.vpnLeaseBindings ?? undefined,
      vpnLeaseReleaseTombstones: patch.vpnLeaseReleaseTombstones ?? undefined,
      vpnLeaseCleanupQuarantine: patch.vpnLeaseCleanupQuarantine ?? undefined,
    });
  }
  const incomingRevision = patch.revision!;
  const incomingGeneration = patch.actorGeneration!;
  const incomingWriter = patch.writerId!;

  const next = { ...session };
  const previousBackendSessionId = next.backendSessionId;

  if (patch.backendSessionId === null) delete next.backendSessionId;
  else if (typeof patch.backendSessionId === "string") {
    next.backendSessionId = patch.backendSessionId;
  }
  if (patch.shellId === null) delete next.shellId;
  else if (typeof patch.shellId === "string") next.shellId = patch.shellId;
  if (
    next.backendSessionId !== previousBackendSessionId &&
    patch.shellId === undefined
  ) {
    delete next.shellId;
  }
  if (patch.vpnLeaseOwnerId === null) delete next.vpnLeaseOwnerId;
  else if (
    typeof patch.vpnLeaseOwnerId === "string" &&
    patch.vpnLeaseOwnerId.length > 0
  ) {
    next.vpnLeaseOwnerId = patch.vpnLeaseOwnerId;
  }
  if (patch.vpnLeaseOwnerIds === null) delete next.vpnLeaseOwnerIds;
  else if (patch.vpnLeaseOwnerIds !== undefined) {
    const ownerIds = copyOwnerIds(patch.vpnLeaseOwnerIds);
    if (!ownerIds) return session;
    next.vpnLeaseOwnerIds = ownerIds;
  }
  if (patch.vpnLeaseBindings === null) delete next.vpnLeaseBindings;
  else if (patch.vpnLeaseBindings !== undefined) {
    const bindings = copyBindings(patch.vpnLeaseBindings);
    if (!bindings) return session;
    next.vpnLeaseBindings = bindings;
  }
  if (patch.vpnLeaseReleaseTombstones === null) {
    delete next.vpnLeaseReleaseTombstones;
  } else if (patch.vpnLeaseReleaseTombstones !== undefined) {
    const tombstones = copyReleaseTombstones(patch.vpnLeaseReleaseTombstones);
    if (!tombstones) return session;
    next.vpnLeaseReleaseTombstones = tombstones;
  }
  if (patch.vpnLeaseCleanupQuarantine === null) {
    delete next.vpnLeaseCleanupQuarantine;
  } else if (patch.vpnLeaseCleanupQuarantine !== undefined) {
    const quarantine = copyCleanupQuarantine(patch.vpnLeaseCleanupQuarantine);
    if (!quarantine) return session;
    next.vpnLeaseCleanupQuarantine = quarantine;
  }
  if (patch.status && SESSION_STATUSES.has(patch.status)) {
    next.status = patch.status;
  }
  if (patch.errorMessage === null) delete next.errorMessage;
  else if (typeof patch.errorMessage === "string") {
    next.errorMessage = patch.errorMessage;
  }
  if (patch.lastActivity === null) delete next.lastActivity;
  else if (typeof patch.lastActivity === "string") {
    const parsed = new Date(patch.lastActivity);
    if (Number.isFinite(parsed.getTime())) next.lastActivity = parsed;
  }
  const backendConflict =
    next.backendSessionId !== session.backendSessionId &&
    Boolean(next.backendSessionId || session.backendSessionId);
  const incomingDetached = isDetachedWriter(incomingWriter);
  const currentDetached = isDetachedWriter(currentWriter);
  const authorityWins = incomingDetached && !currentDetached;
  const authorityLoses = currentDetached && !incomingDetached;
  const accept =
    incomingGeneration > currentGeneration ||
    (incomingGeneration === currentGeneration &&
      (authorityWins ||
        (!authorityLoses &&
          !backendConflict &&
          incomingWriter === currentWriter &&
          incomingRevision > currentRevision)));

  if (!accept) return mergeCleanupLedger(session, next);

  next.lifecycleRevision =
    incomingRevision > currentRevision ? incomingRevision : currentRevision + 1;
  next.lifecycleActorGeneration = incomingGeneration;
  next.lifecycleWriterId = incomingWriter;

  return validLifecycleOwnership(next)
    ? mergeCleanupLedger(next, session)
    : session;
};
