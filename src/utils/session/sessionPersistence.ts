import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
  type SessionVpnLeaseBinding,
  type SessionVpnLeaseCleanupProof,
  type SessionVpnLeaseCleanupQuarantine,
  type SessionVpnLeaseReleaseTombstone,
} from "../../types/connection/connection";

const SESSION_STATUSES = new Set<ConnectionSession["status"]>([
  "connecting",
  "connected",
  "disconnected",
  "error",
  "reconnecting",
]);

export interface PersistedConnectionSession {
  id: string;
  connectionId: string;
  name: string;
  protocol: string;
  hostname: string;
  status: ConnectionSession["status"];
  backendSessionId?: string;
  shellId?: string;
  vpnLeaseOwnerId?: string;
  vpnLeaseOwnerIds?: string[];
  vpnLeaseBindings?: SessionVpnLeaseBinding[];
  vpnLeaseReleaseTombstones?: SessionVpnLeaseReleaseTombstone[];
  vpnLeaseCleanupQuarantine?: SessionVpnLeaseCleanupQuarantine;
  lifecycleRevision?: number;
  lifecycleActorGeneration?: number;
  lifecycleWriterId?: string;
  zoomLevel?: number;
  layout?: ConnectionSession["layout"];
  group?: string;
  startTime?: string;
  lastActivity?: string;
}

export type PersistedSessionParseResult =
  | { valid: true; session: PersistedConnectionSession }
  | { valid: false; reason: string };

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseOwnerIds = (value: unknown): string[] | undefined => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_SESSION_VPN_LEASE_BINDINGS ||
    !value.every(nonEmptyString)
  ) {
    return undefined;
  }
  return [...new Set(value)];
};

const parseBindings = (
  value: unknown,
): SessionVpnLeaseBinding[] | undefined => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return undefined;
  }
  const result: SessionVpnLeaseBinding[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const binding = candidate as Record<string, unknown>;
    if (
      !nonEmptyString(binding.ownerId) ||
      !nonEmptyString(binding.backendSessionId) ||
      (binding.protocol !== "ssh" && binding.protocol !== "rdp") ||
      (binding.status !== "active" &&
        binding.status !== "cleanup-pending" &&
        binding.status !== "backend-closed")
    ) {
      return undefined;
    }
    const key = `${binding.protocol}\0${binding.backendSessionId}\0${binding.ownerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ownerId: binding.ownerId,
      backendSessionId: binding.backendSessionId,
      protocol: binding.protocol,
      status: binding.status,
    });
  }
  return result;
};

const parseReleaseTombstones = (
  value: unknown,
): SessionVpnLeaseReleaseTombstone[] | undefined => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return undefined;
  }
  const result: SessionVpnLeaseReleaseTombstone[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const tombstone = candidate as Record<string, unknown>;
    if (
      !nonEmptyString(tombstone.ownerId) ||
      !nonEmptyString(tombstone.backendSessionId) ||
      (tombstone.protocol !== "ssh" && tombstone.protocol !== "rdp")
    ) {
      return undefined;
    }
    const key = `${tombstone.protocol}\0${tombstone.backendSessionId}\0${tombstone.ownerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ownerId: tombstone.ownerId,
      backendSessionId: tombstone.backendSessionId,
      protocol: tombstone.protocol,
    });
  }
  return result;
};

const parseCleanupQuarantine = (
  value: unknown,
): SessionVpnLeaseCleanupQuarantine | undefined => {
  if (value === undefined) return { proofs: [], proofIncomplete: false };
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.proofs) ||
    raw.proofs.length > MAX_SESSION_VPN_LEASE_BINDINGS ||
    typeof raw.proofIncomplete !== "boolean"
  ) {
    return undefined;
  }
  const proofs: SessionVpnLeaseCleanupProof[] = [];
  for (const candidate of raw.proofs) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const proof = candidate as Record<string, unknown>;
    let parsed: SessionVpnLeaseCleanupProof | undefined;
    if (proof.kind === "binding") {
      const binding = parseBindings([proof])?.[0];
      if (binding) parsed = { kind: "binding", ...binding };
    } else if (proof.kind === "release-tombstone") {
      const tombstone = parseReleaseTombstones([proof])?.[0];
      if (tombstone) parsed = { kind: "release-tombstone", ...tombstone };
    }
    if (!parsed) return undefined;
    const key = `${parsed.protocol}\0${parsed.backendSessionId}\0${parsed.ownerId}`;
    const index = proofs.findIndex(
      (proof) =>
        `${proof.protocol}\0${proof.backendSessionId}\0${proof.ownerId}` ===
        key,
    );
    if (index !== -1) {
      const existing = proofs[index];
      if (existing.kind === "release-tombstone") continue;
      if (parsed.kind === "release-tombstone") {
        proofs[index] = parsed;
      } else {
        const rank = (status: SessionVpnLeaseBinding["status"]) =>
          status === "backend-closed"
            ? 2
            : status === "cleanup-pending"
              ? 1
              : 0;
        if (rank(parsed.status) > rank(existing.status)) {
          proofs[index] = parsed;
        }
      }
      continue;
    }
    proofs.push(parsed);
  }
  return { proofs, proofIncomplete: raw.proofIncomplete };
};

export const parsePersistedConnectionSession = (
  value: unknown,
): PersistedSessionParseResult => {
  if (!value || typeof value !== "object") {
    return { valid: false, reason: "Saved session is not an object." };
  }
  const raw = value as Record<string, unknown>;
  if (
    !nonEmptyString(raw.id) ||
    !nonEmptyString(raw.connectionId) ||
    !nonEmptyString(raw.name) ||
    !nonEmptyString(raw.protocol) ||
    typeof raw.hostname !== "string" ||
    !SESSION_STATUSES.has(raw.status as ConnectionSession["status"])
  ) {
    return { valid: false, reason: "Saved session identity is invalid." };
  }
  if (
    raw.backendSessionId !== undefined &&
    !nonEmptyString(raw.backendSessionId)
  ) {
    return { valid: false, reason: "Saved backend session ID is invalid." };
  }
  if (raw.shellId !== undefined && !nonEmptyString(raw.shellId)) {
    return { valid: false, reason: "Saved shell ID is invalid." };
  }
  if (raw.shellId !== undefined && raw.backendSessionId === undefined) {
    return {
      valid: false,
      reason: "Saved shell ID has no exact backend session.",
    };
  }
  if (
    raw.vpnLeaseOwnerId !== undefined &&
    !nonEmptyString(raw.vpnLeaseOwnerId)
  ) {
    return { valid: false, reason: "Saved VPN owner ID is invalid." };
  }

  const ownerIds = parseOwnerIds(raw.vpnLeaseOwnerIds);
  const bindings = parseBindings(raw.vpnLeaseBindings);
  const releaseTombstones = parseReleaseTombstones(
    raw.vpnLeaseReleaseTombstones,
  );
  const cleanupQuarantine = parseCleanupQuarantine(
    raw.vpnLeaseCleanupQuarantine,
  );
  if (!ownerIds || !bindings || !releaseTombstones || !cleanupQuarantine) {
    return {
      valid: false,
      reason: `Saved VPN ownership exceeds the ${MAX_SESSION_VPN_LEASE_BINDINGS}-binding safety limit or is malformed.`,
    };
  }
  const releaseKeys = new Set(
    [
      ...releaseTombstones,
      ...cleanupQuarantine.proofs.filter(
        (proof) => proof.kind === "release-tombstone",
      ),
    ].map(
      (tombstone) =>
        `${tombstone.protocol}\0${tombstone.backendSessionId}\0${tombstone.ownerId}`,
    ),
  );
  if (
    [
      ...bindings,
      ...cleanupQuarantine.proofs.filter(
        (
          proof,
        ): proof is Extract<SessionVpnLeaseCleanupProof, { kind: "binding" }> =>
          proof.kind === "binding",
      ),
    ].some((binding) =>
      releaseKeys.has(
        `${binding.protocol}\0${binding.backendSessionId}\0${binding.ownerId}`,
      ),
    )
  ) {
    return {
      valid: false,
      reason: "Saved VPN ownership contradicts an exact release tombstone.",
    };
  }

  const allOwners = [
    ...new Set([
      ...ownerIds,
      ...(nonEmptyString(raw.vpnLeaseOwnerId) ? [raw.vpnLeaseOwnerId] : []),
      ...bindings.map((binding) => binding.ownerId),
    ]),
  ];
  if (allOwners.length > MAX_SESSION_VPN_LEASE_BINDINGS) {
    return {
      valid: false,
      reason: `Saved VPN ownership exceeds the ${MAX_SESSION_VPN_LEASE_BINDINGS}-owner safety limit.`,
    };
  }

  if (bindings.length === 0 && allOwners.length > 1) {
    return {
      valid: false,
      reason:
        "Saved legacy VPN ownership is ambiguous because multiple owners have no exact backend binding.",
    };
  }

  if (bindings.length > 0) {
    const boundOwners = new Set(bindings.map((binding) => binding.ownerId));
    const unboundOwners = allOwners.filter(
      (ownerId) => !boundOwners.has(ownerId),
    );
    if (unboundOwners.length > 0) {
      return {
        valid: false,
        reason:
          "Saved VPN ownership contains an owner without an exact backend binding.",
      };
    }
  }

  if (
    bindings.some(
      (binding) =>
        binding.protocol !== raw.protocol &&
        !(
          (raw.protocol === "ssh" || raw.protocol === "rdp") &&
          binding.protocol === raw.protocol
        ),
    )
  ) {
    return {
      valid: false,
      reason: "Saved VPN binding protocol does not match the session.",
    };
  }
  if (
    releaseTombstones.some(
      (tombstone) => tombstone.protocol !== raw.protocol,
    ) ||
    cleanupQuarantine.proofs.some((proof) => proof.protocol !== raw.protocol)
  ) {
    return {
      valid: false,
      reason:
        "Saved VPN release tombstone protocol does not match the session.",
    };
  }

  // Safely migrate the only unambiguous legacy shape.
  if (
    bindings.length === 0 &&
    allOwners.length === 1 &&
    nonEmptyString(raw.backendSessionId) &&
    (raw.protocol === "ssh" || raw.protocol === "rdp")
  ) {
    bindings.push({
      ownerId: allOwners[0],
      backendSessionId: raw.backendSessionId,
      protocol: raw.protocol,
      status: "active",
    });
  }

  if (bindings.length === 0 && allOwners.length === 1) {
    return {
      valid: false,
      reason:
        "Saved legacy VPN owner has no exact backend session for safe migration.",
    };
  }

  const revision = raw.lifecycleRevision;
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) || (revision as number) < 0)
  ) {
    return { valid: false, reason: "Saved lifecycle revision is invalid." };
  }
  const actorGeneration = raw.lifecycleActorGeneration;
  const lifecycleWriterId = raw.lifecycleWriterId;
  if (
    actorGeneration !== undefined &&
    (!Number.isSafeInteger(actorGeneration) || (actorGeneration as number) < 0)
  ) {
    return {
      valid: false,
      reason: "Saved lifecycle actor generation is invalid.",
    };
  }
  if (
    lifecycleWriterId !== undefined &&
    (!nonEmptyString(lifecycleWriterId) || lifecycleWriterId.length > 128)
  ) {
    return { valid: false, reason: "Saved lifecycle writer is invalid." };
  }
  if ((actorGeneration === undefined) !== (lifecycleWriterId === undefined)) {
    return {
      valid: false,
      reason: "Saved lifecycle provenance is incomplete.",
    };
  }

  return {
    valid: true,
    session: {
      id: raw.id,
      connectionId: raw.connectionId,
      name: raw.name,
      protocol: raw.protocol,
      hostname: raw.hostname as string,
      status: raw.status as ConnectionSession["status"],
      ...(nonEmptyString(raw.backendSessionId)
        ? { backendSessionId: raw.backendSessionId }
        : {}),
      ...(nonEmptyString(raw.shellId) ? { shellId: raw.shellId } : {}),
      ...(allOwners.length > 0
        ? {
            vpnLeaseOwnerId:
              (nonEmptyString(raw.vpnLeaseOwnerId) && raw.vpnLeaseOwnerId) ||
              allOwners[0],
            vpnLeaseOwnerIds: allOwners,
          }
        : {}),
      ...(bindings.length > 0 ? { vpnLeaseBindings: bindings } : {}),
      ...(releaseTombstones.length > 0
        ? { vpnLeaseReleaseTombstones: releaseTombstones }
        : {}),
      ...(cleanupQuarantine.proofs.length > 0 ||
      cleanupQuarantine.proofIncomplete
        ? { vpnLeaseCleanupQuarantine: cleanupQuarantine }
        : {}),
      ...(typeof revision === "number" ? { lifecycleRevision: revision } : {}),
      ...(typeof actorGeneration === "number"
        ? { lifecycleActorGeneration: actorGeneration }
        : {}),
      ...(typeof lifecycleWriterId === "string" ? { lifecycleWriterId } : {}),
      ...(typeof raw.zoomLevel === "number"
        ? { zoomLevel: raw.zoomLevel }
        : {}),
      ...(raw.layout && typeof raw.layout === "object"
        ? { layout: raw.layout as ConnectionSession["layout"] }
        : {}),
      ...(typeof raw.group === "string" ? { group: raw.group } : {}),
      ...(typeof raw.startTime === "string"
        ? { startTime: raw.startTime }
        : {}),
      ...(typeof raw.lastActivity === "string"
        ? { lastActivity: raw.lastActivity }
        : {}),
    },
  };
};

export const serializePersistedConnectionSession = (
  session: ConnectionSession,
): PersistedConnectionSession => {
  const parsed = parsePersistedConnectionSession({
    id: session.id,
    connectionId: session.connectionId,
    name: session.name,
    protocol: session.protocol,
    hostname: session.hostname,
    status: session.status,
    backendSessionId: session.backendSessionId,
    shellId: session.shellId,
    vpnLeaseOwnerId: session.vpnLeaseOwnerId,
    vpnLeaseOwnerIds: session.vpnLeaseOwnerIds,
    vpnLeaseBindings: session.vpnLeaseBindings,
    vpnLeaseReleaseTombstones: session.vpnLeaseReleaseTombstones,
    vpnLeaseCleanupQuarantine: session.vpnLeaseCleanupQuarantine,
    lifecycleRevision: session.lifecycleRevision,
    lifecycleActorGeneration: session.lifecycleActorGeneration,
    lifecycleWriterId: session.lifecycleWriterId,
    zoomLevel: session.zoomLevel,
    layout: session.layout,
    group: session.group,
    startTime:
      session.startTime instanceof Date
        ? session.startTime.toISOString()
        : session.startTime,
    lastActivity:
      session.lastActivity instanceof Date
        ? session.lastActivity.toISOString()
        : session.lastActivity,
  });
  if (!parsed.valid) throw new Error(parsed.reason);
  return parsed.session;
};
