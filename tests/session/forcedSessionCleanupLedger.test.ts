import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import {
  FORCED_SESSION_CLEANUP_LEDGER_KEY,
  preserveForcedSessionCleanupEvidence,
  readForcedSessionCleanupLedger,
  recordForcedSessionCleanupEvidence,
} from "../../src/utils/session/forcedSessionCleanupLedger";

const session = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "tab-a",
  connectionId: "connection-a",
  protocol: "rdp",
  name: "RDP",
  hostname: "example.test",
  status: "connecting",
  startTime: new Date(0),
  lifecycleActorGeneration: 7,
  lifecycleWriterId: "main",
  lifecycleRevision: 11,
  ...patch,
});

const binding = (backendSessionId = "actor-a", ownerId = "owner-a") => ({
  backendSessionId,
  ownerId,
  protocol: "rdp" as const,
  status: "active" as const,
});

describe("late forced-session cleanup evidence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does nothing without a force-close record", () => {
    expect(
      preserveForcedSessionCleanupEvidence(
        session({ backendSessionId: "actor-a", vpnLeaseBindings: [binding()] }),
      ),
    ).toBeNull();
    expect(readForcedSessionCleanupLedger()).toEqual([]);
  });

  it("adopts a late exact actor without persisting connection configuration", () => {
    const forced = recordForcedSessionCleanupEvidence(session(), 3);
    const late = session({
      backendSessionId: "actor-a",
      vpnLeaseBindings: [binding()],
      networkPath: {
        version: 1,
        transports: ["ssh"],
        connectionIds: ["secret"],
      },
      terminalBuffer: "private-output",
    });
    const retained = preserveForcedSessionCleanupEvidence(late);
    expect(retained?.persisted).toBe(true);
    expect(readForcedSessionCleanupLedger()).toEqual([
      expect.objectContaining({
        id: forced.record.id,
        closeAttemptId: 3,
        backendSessionId: "actor-a",
        vpnLeaseOwnerIds: ["owner-a"],
        vpnLeaseBindings: [{ ...binding(), status: "cleanup-pending" }],
      }),
    ]);
    expect(localStorage.getItem(FORCED_SESSION_CLEANUP_LEDGER_KEY)).not.toMatch(
      /private-output|secret|networkPath|terminalBuffer|hostname/,
    );
  });

  it("keeps closure and release proofs monotonic across stale publications", () => {
    const actor = session({ backendSessionId: "actor-a" });
    recordForcedSessionCleanupEvidence(actor, 3);
    const publish = (patch: Partial<ConnectionSession>) =>
      preserveForcedSessionCleanupEvidence(session(patch), actor);
    publish({ vpnLeaseBindings: [binding()] });
    publish({ vpnLeaseBindings: [{ ...binding(), status: "backend-closed" }] });
    publish({ vpnLeaseBindings: [binding()] });
    expect(readForcedSessionCleanupLedger()[0].vpnLeaseBindings).toEqual([
      { ...binding(), status: "backend-closed" },
    ]);
    const proof = {
      ownerId: "owner-a",
      backendSessionId: "actor-a",
      protocol: "rdp" as const,
    };
    publish({ vpnLeaseReleaseTombstones: [proof] });
    publish({ vpnLeaseBindings: [binding()], vpnLeaseOwnerIds: ["owner-a"] });
    expect(readForcedSessionCleanupLedger()[0]).toMatchObject({
      backendSessionId: "actor-a",
      vpnLeaseReleaseTombstones: [proof],
    });
    expect(
      readForcedSessionCleanupLedger()[0].vpnLeaseBindings,
    ).toBeUndefined();
    expect(
      readForcedSessionCleanupLedger()[0].vpnLeaseOwnerIds,
    ).toBeUndefined();
  });

  it.each([
    { lifecycleActorGeneration: 8 },
    { lifecycleWriterId: "detached-other" },
    { id: "another-tab" },
    { connectionId: "another-connection" },
    { protocol: "ssh" },
  ])(
    "rejects a replacement authority %j when the backend is still unknown",
    (patch) => {
      const forced = recordForcedSessionCleanupEvidence(session(), 3);
      expect(
        preserveForcedSessionCleanupEvidence(
          session({
            ...patch,
            backendSessionId: "replacement",
            vpnLeaseBindings: [binding("replacement", "other-owner")],
          }),
        ),
      ).toBeNull();
      expect(readForcedSessionCleanupLedger()).toEqual([forced.record]);
    },
  );

  it("filters replacement evidence even when a stale callback reads a mixed snapshot", () => {
    const actor = session({ backendSessionId: "actor-a" });
    const forced = recordForcedSessionCleanupEvidence(actor, 3);
    const replacement = session({
      lifecycleActorGeneration: 8,
      backendSessionId: "actor-b",
      vpnLeaseOwnerIds: ["owner-b"],
      vpnLeaseBindings: [
        binding("actor-b", "owner-b"),
        { ...binding(), status: "backend-closed" },
      ],
    });
    expect(preserveForcedSessionCleanupEvidence(replacement)).toBeNull();
    expect(
      preserveForcedSessionCleanupEvidence(replacement, actor)?.persisted,
    ).toBe(true);
    const [retained] = readForcedSessionCleanupLedger();
    expect(retained.id).toBe(forced.record.id);
    expect(retained.backendSessionId).toBe("actor-a");
    expect(retained.vpnLeaseBindings).toEqual([
      { ...binding(), status: "backend-closed" },
    ]);
    expect(retained.vpnLeaseOwnerIds).toEqual(["owner-a"]);
    expect(replacement.backendSessionId).toBe("actor-b");
    expect(replacement.vpnLeaseBindings![0]).toEqual(
      binding("actor-b", "owner-b"),
    );
  });

  it("accepts exact cleanup proof after the terminal generation advances", () => {
    const actor = session({ backendSessionId: "actor-a" });
    recordForcedSessionCleanupEvidence(
      session({
        lifecycleActorGeneration: 8,
        vpnLeaseBindings: [{ ...binding(), status: "backend-closed" }],
      }),
      3,
    );
    const proof = {
      ownerId: "owner-a",
      backendSessionId: "actor-a",
      protocol: "rdp" as const,
    };
    expect(
      preserveForcedSessionCleanupEvidence(
        session({ vpnLeaseReleaseTombstones: [proof] }),
        actor,
      )?.persisted,
    ).toBe(true);
    expect(
      readForcedSessionCleanupLedger()[0].vpnLeaseReleaseTombstones,
    ).toEqual([proof]);
  });

  it("does not throw into cleanup when a matching stored record is malformed", () => {
    const forced = recordForcedSessionCleanupEvidence(
      session({ backendSessionId: "actor-a" }),
      3,
    );
    localStorage.setItem(
      FORCED_SESSION_CLEANUP_LEDGER_KEY,
      JSON.stringify([{ ...forced.record, vpnLeaseBindings: {} }]),
    );
    expect(
      preserveForcedSessionCleanupEvidence(
        session({ backendSessionId: "actor-a" }),
      ),
    ).toMatchObject({ persisted: false });
  });

  it("retains backendless owners and quarantine without guessing a binding", () => {
    recordForcedSessionCleanupEvidence(session(), 3);
    preserveForcedSessionCleanupEvidence(
      session({ vpnLeaseOwnerIds: ["unbound"] }),
    );
    preserveForcedSessionCleanupEvidence(
      session({
        vpnLeaseCleanupQuarantine: { proofs: [], proofIncomplete: true },
      }),
    );
    expect(readForcedSessionCleanupLedger()[0]).toMatchObject({
      vpnLeaseOwnerIds: ["unbound"],
      vpnLeaseCleanupQuarantine: { proofs: [], proofIncomplete: true },
    });
    expect(
      readForcedSessionCleanupLedger()[0].backendSessionId,
    ).toBeUndefined();
    expect(
      readForcedSessionCleanupLedger()[0].vpnLeaseBindings,
    ).toBeUndefined();
  });

  it("returns matched evidence when storage fails so cleanup can continue", () => {
    recordForcedSessionCleanupEvidence(session(), 3);
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    try {
      expect(
        preserveForcedSessionCleanupEvidence(
          session({
            backendSessionId: "actor-a",
            vpnLeaseBindings: [binding()],
          }),
        ),
      ).toMatchObject({
        persisted: false,
        error: "storage unavailable",
        record: { backendSessionId: "actor-a" },
      });
    } finally {
      write.mockRestore();
    }
  });
});
