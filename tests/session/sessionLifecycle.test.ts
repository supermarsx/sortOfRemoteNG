import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
} from "../../src/types/connection/connection";
import {
  advanceSessionLifecycleAuthority,
  applySessionLifecyclePatch,
  cancelSessionLifecycleActorAttempts,
  finishSessionLifecycleActorAttempt,
  hasSessionLifecycleActorAttempt,
  mergeLocalSessionUpdate,
  reconcileSessionLifecycleSnapshot,
  resetSessionLifecycleAllocatorForTests,
  reserveSessionLifecycleActorAttempt,
  toSessionLifecyclePatch,
  withSessionLifecycleAttempt,
} from "../../src/utils/session/sessionLifecycle";
import {
  withSessionVpnLeaseBinding,
  withoutSessionVpnLeaseOwner,
} from "../../src/utils/network/sessionVpnLeaseCleanup";
import { serializePersistedConnectionSession } from "../../src/utils/session/sessionPersistence";

const makeSession = (): ConnectionSession => ({
  id: "session-1",
  connectionId: "connection-1",
  name: "Protected session",
  status: "connected",
  startTime: new Date("2026-07-19T08:00:00.000Z"),
  lastActivity: new Date("2026-07-19T09:00:00.000Z"),
  protocol: "ssh",
  hostname: "host.example",
  backendSessionId: "backend-1",
  shellId: "shell-1",
  vpnLeaseOwnerId: "owner-1",
  vpnLeaseOwnerIds: ["owner-1"],
  vpnLeaseBindings: [
    {
      ownerId: "owner-1",
      backendSessionId: "backend-1",
      protocol: "ssh",
      status: "active",
    },
  ],
  errorMessage: "retry pending",
});

beforeEach(() => {
  resetSessionLifecycleAllocatorForTests();
});

describe("session lifecycle IPC patches", () => {
  it("serializes only the secret-safe lifecycle allow-list", () => {
    const session = {
      ...makeSession(),
      password: "must-not-cross-window",
      privateKey: "must-not-cross-window",
      terminalBuffer: "not-lifecycle",
    } as ConnectionSession & Record<string, unknown>;

    const patch = toSessionLifecyclePatch(session);

    expect(patch).toEqual({
      revision: 0,
      actorGeneration: 0,
      writerId: "main",
      backendSessionId: "backend-1",
      shellId: "shell-1",
      vpnLeaseOwnerId: "owner-1",
      vpnLeaseOwnerIds: ["owner-1"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-1",
          backendSessionId: "backend-1",
          protocol: "ssh",
          status: "active",
        },
      ],
      vpnLeaseReleaseTombstones: null,
      vpnLeaseCleanupQuarantine: null,
      status: "connected",
      errorMessage: "retry pending",
      lastActivity: "2026-07-19T09:00:00.000Z",
    });
    expect(patch).not.toHaveProperty("password");
    expect(patch).not.toHaveProperty("privateKey");
    expect(patch).not.toHaveProperty("terminalBuffer");
  });

  it("reserves an actor generation before connect and hands off past it", () => {
    const initial = { ...makeSession(), id: "reserved-session" };
    const reservation = reserveSessionLifecycleActorAttempt(initial);

    expect(reservation.session).toEqual(
      expect.objectContaining({
        lifecycleActorGeneration: 1,
        lifecycleWriterId: "main",
        lifecycleRevision: 1,
      }),
    );
    expect(hasSessionLifecycleActorAttempt(initial.id)).toBe(true);

    const detached = advanceSessionLifecycleAuthority(
      reservation.session,
      "detached-reserved-session",
    );
    expect(detached).toEqual(
      expect.objectContaining({
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-reserved-session",
      }),
    );
    expect(() =>
      reserveSessionLifecycleActorAttempt(detached, {
        generation: reservation.attempt.generation,
        writerId: reservation.attempt.writerId,
      }),
    ).toThrow(/authority changed/i);

    finishSessionLifecycleActorAttempt(reservation.attempt);
    expect(hasSessionLifecycleActorAttempt(initial.id)).toBe(false);
  });

  it("refreshes a settled allocator from a strictly newer returned authority", () => {
    const initial = { ...makeSession(), id: "round-trip-authority" };
    const first = reserveSessionLifecycleActorAttempt(initial);
    finishSessionLifecycleActorAttempt(first.attempt);

    const returned: ConnectionSession = {
      ...first.session,
      lifecycleActorGeneration: first.attempt.generation + 3,
      lifecycleWriterId: "detached-round-trip-authority",
      lifecycleActorReservationId: undefined,
      lifecycleRevision: first.session.lifecycleRevision! + 3,
    };
    const next = reserveSessionLifecycleActorAttempt(returned);

    expect(next.attempt).toEqual(
      expect.objectContaining({
        generation: returned.lifecycleActorGeneration! + 1,
        writerId: "detached-round-trip-authority",
      }),
    );
    finishSessionLifecycleActorAttempt(next.attempt);
  });

  it("retains high-water after finish and rejects a stale post-finish snapshot", () => {
    const initial = { ...makeSession(), id: "post-finish-high-water" };
    const first = reserveSessionLifecycleActorAttempt(initial);
    finishSessionLifecycleActorAttempt(first.attempt);

    expect(() => reserveSessionLifecycleActorAttempt(initial)).toThrow(
      /authority changed/i,
    );

    const canonical: ConnectionSession = {
      ...first.session,
      lifecycleActorReservationId: undefined,
    };
    const second = reserveSessionLifecycleActorAttempt(canonical);
    expect(second.attempt.generation).toBe(first.attempt.generation + 1);
    finishSessionLifecycleActorAttempt(second.attempt);
  });

  it.each([
    ["older first", true],
    ["newer first", false],
  ])(
    "keeps newer actor B when overlapping attempts finish %s",
    (_label, finishOlderFirst) => {
      const initial: ConnectionSession = {
        ...makeSession(),
        id: `overlap-${String(finishOlderFirst)}`,
        backendSessionId: undefined,
        shellId: undefined,
        vpnLeaseOwnerId: undefined,
        vpnLeaseOwnerIds: undefined,
        vpnLeaseBindings: undefined,
      };
      const older = reserveSessionLifecycleActorAttempt(initial);
      const newer = reserveSessionLifecycleActorAttempt(older.session);
      const liveB = withSessionLifecycleAttempt(
        {
          ...newer.session,
          backendSessionId: "backend-b",
          shellId: "shell-b",
          vpnLeaseOwnerId: "owner-b",
          vpnLeaseOwnerIds: ["owner-b"],
          vpnLeaseBindings: [
            {
              ownerId: "owner-b",
              backendSessionId: "backend-b",
              protocol: "ssh",
              status: "active",
            },
          ],
          status: "connected",
        },
        newer.attempt,
      );

      if (finishOlderFirst) {
        finishSessionLifecycleActorAttempt(older.attempt);
        finishSessionLifecycleActorAttempt(newer.attempt);
      } else {
        finishSessionLifecycleActorAttempt(newer.attempt);
        finishSessionLifecycleActorAttempt(older.attempt);
      }

      const oldCleanup = withSessionLifecycleAttempt(
        {
          ...older.session,
          backendSessionId: "backend-a",
          shellId: undefined,
          vpnLeaseOwnerId: "owner-a",
          vpnLeaseOwnerIds: ["owner-a"],
          vpnLeaseBindings: [
            {
              ownerId: "owner-a",
              backendSessionId: "backend-a",
              protocol: "ssh",
              status: "cleanup-pending",
            },
          ],
          status: "error",
          errorMessage: "old A cleanup pending",
        },
        older.attempt,
      );
      const merged = mergeLocalSessionUpdate(liveB, oldCleanup);

      expect(merged).toEqual(
        expect.objectContaining({
          backendSessionId: "backend-b",
          shellId: "shell-b",
          status: "connected",
          lifecycleActorGeneration: newer.attempt.generation,
        }),
      );
      expect(merged.vpnLeaseOwnerIds).toEqual(["owner-b", "owner-a"]);
      expect(merged.vpnLeaseBindings).toEqual([
        liveB.vpnLeaseBindings![0],
        oldCleanup.vpnLeaseBindings![0],
      ]);
    },
  );

  it("allows a cancelled same-writer remount without reusing its generation", () => {
    const initial = { ...makeSession(), id: "cancelled-remount" };
    const hung = reserveSessionLifecycleActorAttempt(initial);
    cancelSessionLifecycleActorAttempts(initial.id);
    expect(hasSessionLifecycleActorAttempt(initial.id)).toBe(false);

    expect(() =>
      reserveSessionLifecycleActorAttempt({
        ...initial,
        lifecycleWriterId: "detached-stale",
      }),
    ).toThrow(/authority changed/i);

    const remounted = reserveSessionLifecycleActorAttempt(initial);
    expect(remounted.attempt.generation).toBeGreaterThan(
      hung.attempt.generation,
    );
    finishSessionLifecycleActorAttempt(remounted.attempt);
  });

  it("does not erase a later handoff authority when cancelling a hung attempt", () => {
    const initial = { ...makeSession(), id: "cancelled-handoff" };
    const hung = reserveSessionLifecycleActorAttempt(initial);
    const handedOff = advanceSessionLifecycleAuthority(
      hung.session,
      "detached-cancelled-handoff",
    );
    cancelSessionLifecycleActorAttempts(initial.id);
    expect(hasSessionLifecycleActorAttempt(initial.id)).toBe(false);

    expect(() => reserveSessionLifecycleActorAttempt(hung.session)).toThrow(
      /authority changed/i,
    );
    const next = reserveSessionLifecycleActorAttempt(handedOff);
    expect(next.attempt).toEqual(
      expect.objectContaining({
        generation: handedOff.lifecycleActorGeneration! + 1,
        writerId: "detached-cancelled-handoff",
      }),
    );
    finishSessionLifecycleActorAttempt(next.attempt);
  });

  it("refreshes cancelled local history only from a strictly newer return", () => {
    const initial = { ...makeSession(), id: "cancelled-return" };
    const hung = reserveSessionLifecycleActorAttempt(initial);
    cancelSessionLifecycleActorAttempts(initial.id);

    const returned: ConnectionSession = {
      ...hung.session,
      lifecycleActorGeneration: hung.attempt.generation + 2,
      lifecycleWriterId: "detached-cancelled-handoff",
      lifecycleActorReservationId: undefined,
      lifecycleRevision: hung.session.lifecycleRevision! + 2,
    };
    const next = reserveSessionLifecycleActorAttempt(returned);
    expect(next.attempt).toEqual(
      expect.objectContaining({
        generation: returned.lifecycleActorGeneration! + 1,
        writerId: "detached-cancelled-handoff",
      }),
    );
    expect(() => reserveSessionLifecycleActorAttempt(hung.session)).toThrow(
      /authority changed/i,
    );
    finishSessionLifecycleActorAttempt(next.attempt);
  });

  it("applies explicit null clears without accepting arbitrary fields", () => {
    const patched = applySessionLifecyclePatch(makeSession(), {
      revision: 1,
      actorGeneration: 1,
      writerId: "main",
      backendSessionId: "backend-2",
      shellId: null,
      vpnLeaseOwnerId: null,
      vpnLeaseOwnerIds: null,
      vpnLeaseBindings: null,
      errorMessage: null,
      lastActivity: null,
      password: "injected-secret",
    } as any);

    expect(patched.backendSessionId).toBe("backend-2");
    expect(patched).not.toHaveProperty("shellId");
    expect(patched).not.toHaveProperty("vpnLeaseOwnerId");
    expect(patched).not.toHaveProperty("vpnLeaseOwnerIds");
    expect(patched).not.toHaveProperty("vpnLeaseBindings");
    expect(patched).not.toHaveProperty("errorMessage");
    expect(patched).not.toHaveProperty("lastActivity");
    expect(patched).not.toHaveProperty("password");
    expect(patched.lifecycleRevision).toBe(1);
  });

  it("requires complete provenance before replacing actor-owned lifecycle fields", () => {
    const current = makeSession();
    const unversioned = applySessionLifecyclePatch(current, {
      backendSessionId: "backend-untrusted",
      shellId: "shell-untrusted",
      vpnLeaseOwnerId: "owner-untrusted",
      vpnLeaseOwnerIds: ["owner-untrusted"],
      status: "error",
    });
    expect(unversioned).toBe(current);

    const versioned = applySessionLifecyclePatch(current, {
      revision: 1,
      actorGeneration: 1,
      writerId: "detached-session-1",
      backendSessionId: "backend-trusted",
      shellId: "shell-trusted",
      vpnLeaseOwnerId: "owner-trusted",
      vpnLeaseOwnerIds: ["owner-trusted"],
      status: "connected",
    });
    expect(versioned).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-trusted",
        shellId: "shell-trusted",
        vpnLeaseOwnerId: "owner-trusted",
        lifecycleActorGeneration: 1,
        lifecycleWriterId: "detached-session-1",
      }),
    );
  });

  it("rejects stale nullable echo and republishes the newer detached binding", () => {
    const detached = {
      ...makeSession(),
      backendSessionId: "backend-detached-new",
      shellId: "shell-detached-new",
      vpnLeaseOwnerId: "owner-detached-new",
      vpnLeaseOwnerIds: ["owner-detached-new"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-detached-new",
          backendSessionId: "backend-detached-new",
          protocol: "ssh" as const,
          status: "active" as const,
        },
      ],
      lifecycleRevision: 2,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
    };
    const staleMain = {
      ...makeSession(),
      backendSessionId: undefined,
      shellId: undefined,
      vpnLeaseOwnerId: undefined,
      vpnLeaseOwnerIds: undefined,
      vpnLeaseBindings: undefined,
      lifecycleRevision: 1,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
    };

    const afterOldMainSync = reconcileSessionLifecycleSnapshot(
      detached,
      staleMain,
    );
    expect(afterOldMainSync).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-detached-new",
        vpnLeaseOwnerId: "owner-detached-new",
        lifecycleRevision: 2,
      }),
    );

    const echoedToMain = applySessionLifecyclePatch(
      staleMain,
      toSessionLifecyclePatch(afterOldMainSync),
    );
    expect(echoedToMain).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-detached-new",
        shellId: "shell-detached-new",
        vpnLeaseOwnerId: "owner-detached-new",
        lifecycleRevision: 2,
      }),
    );

    const staleNullableEcho = applySessionLifecyclePatch(echoedToMain, {
      revision: 2,
      backendSessionId: null,
      shellId: null,
      vpnLeaseOwnerId: null,
      vpnLeaseOwnerIds: null,
      vpnLeaseBindings: null,
    });
    expect(staleNullableEcho).toBe(echoedToMain);
  });

  it("keeps live detached B when obsolete main A has a higher scalar revision", () => {
    const mainA = {
      ...makeSession(),
      lifecycleRevision: 5,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
    };
    const detachedB = {
      ...makeSession(),
      backendSessionId: "backend-b",
      shellId: "shell-b",
      vpnLeaseOwnerId: "owner-b",
      vpnLeaseOwnerIds: ["owner-b"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-b",
          backendSessionId: "backend-b",
          protocol: "ssh" as const,
          status: "active" as const,
        },
      ],
      lifecycleRevision: 2,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
    };

    const canonicalB = applySessionLifecyclePatch(
      mainA,
      toSessionLifecyclePatch(detachedB, "detached-session-1"),
    );
    expect(canonicalB).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-b",
        shellId: "shell-b",
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-session-1",
      }),
    );
    expect(canonicalB.lifecycleRevision).toBeGreaterThan(5);

    const afterOldAFailedCleanup = applySessionLifecyclePatch(canonicalB, {
      revision: 99,
      actorGeneration: 1,
      writerId: "main",
      backendSessionId: "backend-1",
      shellId: null,
      vpnLeaseOwnerId: "owner-1",
      vpnLeaseOwnerIds: ["owner-1"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-1",
          backendSessionId: "backend-1",
          protocol: "ssh",
          status: "cleanup-pending",
        },
      ],
      status: "error",
      errorMessage: "old A cleanup failed",
    });

    expect(afterOldAFailedCleanup).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-b",
        shellId: "shell-b",
        status: "connected",
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-session-1",
      }),
    );
    expect(afterOldAFailedCleanup.vpnLeaseOwnerIds).toEqual([
      "owner-b",
      "owner-1",
    ]);
    expect(afterOldAFailedCleanup.vpnLeaseBindings).toEqual([
      detachedB.vpnLeaseBindings[0],
      {
        ownerId: "owner-1",
        backendSessionId: "backend-1",
        protocol: "ssh",
        status: "cleanup-pending",
      },
    ]);
  });

  it("resolves equal-generation main/detached actor conflicts to detached authority", () => {
    const mainA = {
      ...makeSession(),
      lifecycleRevision: 7,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "main",
    };
    const detachedB = {
      ...makeSession(),
      backendSessionId: "backend-b",
      shellId: "shell-b",
      lifecycleRevision: 7,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
    };

    const detachedWinsOnMain = applySessionLifecyclePatch(
      mainA,
      toSessionLifecyclePatch(detachedB, "detached-session-1"),
    );
    expect(detachedWinsOnMain.backendSessionId).toBe("backend-b");
    expect(detachedWinsOnMain.lifecycleWriterId).toBe("detached-session-1");

    const mainCannotReverse = applySessionLifecyclePatch(
      detachedB,
      toSessionLifecyclePatch({ ...mainA, lifecycleRevision: 100 }, "main"),
    );
    expect(mainCannotReverse).toBe(detachedB);

    const sameWriterConflict = applySessionLifecyclePatch(mainA, {
      ...toSessionLifecyclePatch(mainA, "main"),
      backendSessionId: "backend-conflict",
    });
    expect(sameWriterConflict).toBe(mainA);
  });

  it("keeps one reserved generation across reserve, bind, and final shell commit", () => {
    const initial: ConnectionSession = {
      ...makeSession(),
      id: "connect-sequence",
      status: "connecting",
      backendSessionId: undefined,
      shellId: undefined,
      vpnLeaseOwnerId: undefined,
      vpnLeaseOwnerIds: undefined,
      vpnLeaseBindings: undefined,
    };
    const reservation = reserveSessionLifecycleActorAttempt(initial);
    let canonical = reservation.session;

    const bound = withSessionLifecycleAttempt(
      withSessionVpnLeaseBinding(reservation.session, {
        ownerId: "owner-sequence",
        backendSessionId: "backend-sequence",
        protocol: "ssh",
        status: "active",
      }),
      reservation.attempt,
    );
    canonical = mergeLocalSessionUpdate(canonical, bound);

    const final = withSessionLifecycleAttempt(
      {
        ...bound,
        backendSessionId: "backend-sequence",
        shellId: "shell-sequence",
        status: "connected",
      },
      reservation.attempt,
    );
    canonical = mergeLocalSessionUpdate(canonical, final);

    expect(canonical).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-sequence",
        shellId: "shell-sequence",
        lifecycleActorGeneration: reservation.attempt.generation,
      }),
    );

    finishSessionLifecycleActorAttempt(reservation.attempt);
    const endedConflict = withSessionLifecycleAttempt(
      { ...final, backendSessionId: "backend-after-finish" },
      reservation.attempt,
    );
    expect(
      mergeLocalSessionUpdate(canonical, endedConflict).backendSessionId,
    ).toBe("backend-sequence");
  });

  it("uses a lower-generation release tombstone to remove only old A", () => {
    const liveB: ConnectionSession = {
      ...makeSession(),
      backendSessionId: "backend-b",
      shellId: "shell-b",
      vpnLeaseOwnerId: "owner-b",
      vpnLeaseOwnerIds: ["owner-b", "owner-a"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-b",
          backendSessionId: "backend-b",
          protocol: "ssh",
          status: "active",
        },
        {
          ownerId: "owner-a",
          backendSessionId: "backend-a",
          protocol: "ssh",
          status: "backend-closed",
        },
      ],
      lifecycleRevision: 10,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
    };
    const oldAReleased = withoutSessionVpnLeaseOwner(
      {
        ...liveB,
        backendSessionId: "backend-a",
        shellId: undefined,
        lifecycleRevision: 50,
        lifecycleActorGeneration: 1,
        lifecycleWriterId: "main",
      },
      "owner-a",
    );

    const merged = applySessionLifecyclePatch(
      liveB,
      toSessionLifecyclePatch(oldAReleased, "main"),
    );
    expect(merged.backendSessionId).toBe("backend-b");
    expect(merged.shellId).toBe("shell-b");
    expect(merged.vpnLeaseOwnerIds).toEqual(["owner-b"]);
    expect(merged.vpnLeaseBindings).toEqual([liveB.vpnLeaseBindings![0]]);
    expect(merged.vpnLeaseReleaseTombstones).toEqual([
      {
        ownerId: "owner-a",
        backendSessionId: "backend-a",
        protocol: "ssh",
      },
    ]);
  });

  it("quarantines exact cleanup proofs that exceed normal safety caps", () => {
    const ownerIds = Array.from(
      { length: MAX_SESSION_VPN_LEASE_BINDINGS },
      (_, index) => `owner-${index}`,
    );
    const currentBase: ConnectionSession = {
      ...makeSession(),
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-cap",
      lifecycleRevision: 10,
    };
    const obsoleteBase: ConnectionSession = {
      ...makeSession(),
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      lifecycleRevision: 50,
      backendSessionId: "backend-overflow",
      shellId: undefined,
      vpnLeaseOwnerId: "owner-overflow",
      vpnLeaseOwnerIds: ["owner-overflow"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-overflow",
          backendSessionId: "backend-overflow",
          protocol: "ssh",
          status: "cleanup-pending",
        },
      ],
    };

    const fullBindings: ConnectionSession = {
      ...currentBase,
      id: "binding-cap",
      vpnLeaseOwnerId: ownerIds[0],
      vpnLeaseOwnerIds: ownerIds,
      vpnLeaseBindings: ownerIds.map((ownerId, index) => ({
        ownerId,
        backendSessionId: `backend-${index}`,
        protocol: "ssh",
        status: "active",
      })),
      vpnLeaseReleaseTombstones: undefined,
    };
    const bindingOverflow = mergeLocalSessionUpdate(fullBindings, {
      ...obsoleteBase,
      id: fullBindings.id,
    });
    expect(bindingOverflow).toEqual(
      expect.objectContaining({
        backendSessionId: fullBindings.backendSessionId,
        shellId: fullBindings.shellId,
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-cap",
        status: "error",
        errorMessage: expect.stringMatching(/quarantined.*manual cleanup/i),
        vpnLeaseBindings: fullBindings.vpnLeaseBindings,
        vpnLeaseCleanupQuarantine: {
          proofs: [
            {
              kind: "binding",
              ownerId: "owner-overflow",
              backendSessionId: "backend-overflow",
              protocol: "ssh",
              status: "cleanup-pending",
            },
          ],
          proofIncomplete: false,
        },
      }),
    );
    expect(() => reserveSessionLifecycleActorAttempt(bindingOverflow)).toThrow(
      /quarantined/i,
    );
    expect(hasSessionLifecycleActorAttempt(bindingOverflow.id)).toBe(false);

    const fullTombstones: ConnectionSession = {
      ...currentBase,
      id: "tombstone-cap",
      backendSessionId: undefined,
      shellId: undefined,
      vpnLeaseOwnerId: undefined,
      vpnLeaseOwnerIds: undefined,
      vpnLeaseBindings: undefined,
      vpnLeaseReleaseTombstones: ownerIds.map((ownerId, index) => ({
        ownerId,
        backendSessionId: `released-${index}`,
        protocol: "ssh",
      })),
    };
    const tombstoneOverflow = mergeLocalSessionUpdate(fullTombstones, {
      ...obsoleteBase,
      id: fullTombstones.id,
      vpnLeaseOwnerId: undefined,
      vpnLeaseOwnerIds: undefined,
      vpnLeaseBindings: undefined,
      vpnLeaseReleaseTombstones: [
        {
          ownerId: "owner-new-release",
          backendSessionId: "backend-new-release",
          protocol: "ssh",
        },
      ],
    });
    expect(tombstoneOverflow).toEqual(
      expect.objectContaining({
        backendSessionId: fullTombstones.backendSessionId,
        shellId: fullTombstones.shellId,
        status: "error",
        vpnLeaseReleaseTombstones: fullTombstones.vpnLeaseReleaseTombstones,
        vpnLeaseCleanupQuarantine: {
          proofs: [
            {
              kind: "release-tombstone",
              ownerId: "owner-new-release",
              backendSessionId: "backend-new-release",
              protocol: "ssh",
            },
          ],
          proofIncomplete: false,
        },
      }),
    );

    const fullOwners: ConnectionSession = {
      ...currentBase,
      id: "owner-cap",
      backendSessionId: undefined,
      shellId: undefined,
      vpnLeaseOwnerId: ownerIds[0],
      vpnLeaseOwnerIds: ownerIds,
      vpnLeaseBindings: undefined,
      vpnLeaseReleaseTombstones: undefined,
    };
    const ownerOverflow = mergeLocalSessionUpdate(fullOwners, {
      ...obsoleteBase,
      id: fullOwners.id,
    });
    expect(ownerOverflow.vpnLeaseCleanupQuarantine?.proofs).toEqual([
      expect.objectContaining({
        kind: "binding",
        ownerId: "owner-overflow",
        status: "cleanup-pending",
      }),
    ]);

    const fullQuarantine: ConnectionSession = {
      ...fullBindings,
      id: "overflow-of-overflow",
      vpnLeaseCleanupQuarantine: {
        proofs: ownerIds.map((ownerId, index) => ({
          kind: "binding" as const,
          ownerId: `quarantine-${ownerId}`,
          backendSessionId: `quarantine-backend-${index}`,
          protocol: "ssh" as const,
          status: "cleanup-pending" as const,
        })),
        proofIncomplete: false,
      },
    };
    const incomplete = mergeLocalSessionUpdate(fullQuarantine, {
      ...obsoleteBase,
      id: fullQuarantine.id,
    });
    expect(incomplete.vpnLeaseCleanupQuarantine).toEqual(
      expect.objectContaining({
        proofs: fullQuarantine.vpnLeaseCleanupQuarantine!.proofs,
        proofIncomplete: true,
      }),
    );
    expect(incomplete.backendSessionId).toBe(fullQuarantine.backendSessionId);
    expect(incomplete.shellId).toBe(fullQuarantine.shellId);

    const staleClear = mergeLocalSessionUpdate(incomplete, {
      id: incomplete.id,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      lifecycleRevision: 100,
      vpnLeaseCleanupQuarantine: undefined,
      status: "connected",
      errorMessage: undefined,
    });
    expect(staleClear.vpnLeaseCleanupQuarantine).toEqual(
      incomplete.vpnLeaseCleanupQuarantine,
    );
    expect(staleClear.status).toBe("error");
  });

  it("normalizes quarantined proof rank and release dominance by exact key", () => {
    const current: ConnectionSession = {
      ...makeSession(),
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-proof",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-a",
            backendSessionId: "backend-a",
            protocol: "ssh",
            status: "cleanup-pending",
          },
        ],
        proofIncomplete: false,
      },
    };
    const upgraded = mergeLocalSessionUpdate(current, {
      id: current.id,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-a",
            backendSessionId: "backend-a",
            protocol: "ssh",
            status: "backend-closed",
          },
        ],
        proofIncomplete: false,
      },
    });
    expect(upgraded.vpnLeaseCleanupQuarantine?.proofs).toEqual([
      expect.objectContaining({ kind: "binding", status: "backend-closed" }),
    ]);

    const released = mergeLocalSessionUpdate(upgraded, {
      id: current.id,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "release-tombstone",
            ownerId: "owner-a",
            backendSessionId: "backend-a",
            protocol: "ssh",
          },
        ],
        proofIncomplete: false,
      },
    });
    expect(released.vpnLeaseCleanupQuarantine?.proofs).toEqual([
      expect.objectContaining({ kind: "release-tombstone" }),
    ]);

    const normalRelease = mergeLocalSessionUpdate(current, {
      id: current.id,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      vpnLeaseReleaseTombstones: [
        {
          ownerId: "owner-a",
          backendSessionId: "backend-a",
          protocol: "ssh",
        },
      ],
    });
    expect(normalRelease.vpnLeaseCleanupQuarantine).toBeUndefined();
    expect(normalRelease.vpnLeaseReleaseTombstones).toEqual([
      {
        ownerId: "owner-a",
        backendSessionId: "backend-a",
        protocol: "ssh",
      },
    ]);
    expect(() =>
      serializePersistedConnectionSession(normalRelease),
    ).not.toThrow();
  });
});
