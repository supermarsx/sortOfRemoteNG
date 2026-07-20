import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
} from "../../src/types/connection/connection";
import {
  parsePersistedConnectionSession,
  serializePersistedConnectionSession,
} from "../../src/utils/session/sessionPersistence";

const makeSession = (): ConnectionSession => ({
  id: "session-1",
  connectionId: "connection-1",
  name: "Persistent SSH",
  protocol: "ssh",
  hostname: "host.example",
  status: "connected",
  startTime: new Date("2026-07-19T08:00:00.000Z"),
  lastActivity: new Date("2026-07-19T09:00:00.000Z"),
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
  lifecycleRevision: 7,
  lifecycleActorGeneration: 3,
  lifecycleWriterId: "detached-session-1",
});

describe("session reload persistence", () => {
  it("round-trips exact VPN ownership and lifecycle revision", () => {
    const serialized = serializePersistedConnectionSession(makeSession());
    const parsed = parsePersistedConnectionSession(
      JSON.parse(JSON.stringify(serialized)),
    );

    expect(parsed).toEqual({
      valid: true,
      session: expect.objectContaining({
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
        lifecycleRevision: 7,
        lifecycleActorGeneration: 3,
        lifecycleWriterId: "detached-session-1",
      }),
    });
  });

  it("round-trips quarantined exact cleanup proof and incomplete sentinel", () => {
    const session: ConnectionSession = {
      ...makeSession(),
      status: "error",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-quarantined",
            backendSessionId: "backend-quarantined",
            protocol: "ssh",
            status: "cleanup-pending",
          },
        ],
        proofIncomplete: true,
      },
    };

    const serialized = serializePersistedConnectionSession(session);
    const parsed = parsePersistedConnectionSession(
      JSON.parse(JSON.stringify(serialized)),
    );

    expect(parsed).toEqual({
      valid: true,
      session: expect.objectContaining({
        vpnLeaseCleanupQuarantine: session.vpnLeaseCleanupQuarantine,
      }),
    });
  });

  it("canonicalizes adverse quarantine ordering to max status and release dominance", () => {
    const base = serializePersistedConnectionSession(makeSession());
    const exact = {
      ownerId: "owner-quarantined",
      backendSessionId: "backend-quarantined",
      protocol: "ssh" as const,
    };
    const ranked = parsePersistedConnectionSession({
      ...base,
      vpnLeaseCleanupQuarantine: {
        proofs: [
          { kind: "binding", ...exact, status: "cleanup-pending" },
          { kind: "binding", ...exact, status: "backend-closed" },
        ],
        proofIncomplete: false,
      },
    });
    expect(ranked).toEqual({
      valid: true,
      session: expect.objectContaining({
        vpnLeaseCleanupQuarantine: {
          proofs: [{ kind: "binding", ...exact, status: "backend-closed" }],
          proofIncomplete: false,
        },
      }),
    });

    const released = parsePersistedConnectionSession({
      ...base,
      vpnLeaseCleanupQuarantine: {
        proofs: [
          { kind: "binding", ...exact, status: "backend-closed" },
          { kind: "release-tombstone", ...exact },
          { kind: "binding", ...exact, status: "cleanup-pending" },
        ],
        proofIncomplete: false,
      },
    });
    expect(released).toEqual({
      valid: true,
      session: expect.objectContaining({
        vpnLeaseCleanupQuarantine: {
          proofs: [{ kind: "release-tombstone", ...exact }],
          proofIncomplete: false,
        },
      }),
    });
  });

  it("rejects malformed exact bindings", () => {
    const parsed = parsePersistedConnectionSession({
      ...serializePersistedConnectionSession(makeSession()),
      vpnLeaseBindings: [
        {
          ownerId: "owner-1",
          backendSessionId: "",
          protocol: "ssh",
          status: "active",
        },
      ],
    });

    expect(parsed).toEqual(
      expect.objectContaining({ valid: false, reason: expect.any(String) }),
    );
  });

  it("rejects ownership beyond the bounded safety limit", () => {
    const parsed = parsePersistedConnectionSession({
      ...serializePersistedConnectionSession(makeSession()),
      vpnLeaseOwnerIds: Array.from(
        { length: MAX_SESSION_VPN_LEASE_BINDINGS + 1 },
        (_, index) => `owner-${index}`,
      ),
    });

    expect(parsed).toEqual(
      expect.objectContaining({ valid: false, reason: expect.any(String) }),
    );
  });

  it("rejects ambiguous legacy multi-owner data without exact bindings", () => {
    const legacy = serializePersistedConnectionSession(makeSession());
    delete legacy.vpnLeaseBindings;
    legacy.vpnLeaseOwnerId = "owner-1";
    legacy.vpnLeaseOwnerIds = ["owner-1", "owner-2"];

    const parsed = parsePersistedConnectionSession(legacy);

    expect(parsed).toEqual({
      valid: false,
      reason: expect.stringMatching(/ambiguous/i),
    });
  });

  it("rejects an owner that is not represented by an exact binding", () => {
    const persisted = serializePersistedConnectionSession(makeSession());
    persisted.vpnLeaseOwnerIds = ["owner-1", "owner-unbound"];

    const parsed = parsePersistedConnectionSession(persisted);

    expect(parsed).toEqual({
      valid: false,
      reason: expect.stringMatching(/without an exact backend binding/i),
    });
  });

  it("rejects a single legacy owner when no backend exists for migration", () => {
    const legacy = serializePersistedConnectionSession(makeSession());
    delete legacy.backendSessionId;
    delete legacy.shellId;
    delete legacy.vpnLeaseBindings;

    const parsed = parsePersistedConnectionSession(legacy);

    expect(parsed).toEqual({
      valid: false,
      reason: expect.stringMatching(/no exact backend session/i),
    });
  });

  it("rejects a shell handle without an exact backend session", () => {
    const persisted = serializePersistedConnectionSession(makeSession());
    delete persisted.backendSessionId;

    const parsed = parsePersistedConnectionSession(persisted);

    expect(parsed).toEqual({
      valid: false,
      reason: expect.stringMatching(/shell id has no exact backend/i),
    });
  });

  it("migrates one legacy backend-owner pair into an exact binding", () => {
    const legacy = serializePersistedConnectionSession(makeSession());
    delete legacy.vpnLeaseBindings;

    const parsed = parsePersistedConnectionSession(legacy);

    expect(parsed).toEqual({
      valid: true,
      session: expect.objectContaining({
        vpnLeaseBindings: [
          {
            ownerId: "owner-1",
            backendSessionId: "backend-1",
            protocol: "ssh",
            status: "active",
          },
        ],
      }),
    });
  });

  it("rejects incomplete lifecycle provenance", () => {
    const persisted = serializePersistedConnectionSession(makeSession());
    delete persisted.lifecycleWriterId;

    expect(parsePersistedConnectionSession(persisted)).toEqual({
      valid: false,
      reason: expect.stringMatching(/provenance is incomplete/i),
    });
  });

  it("rejects an exact binding contradicted by a release tombstone", () => {
    const persisted = serializePersistedConnectionSession(makeSession());
    persisted.vpnLeaseReleaseTombstones = [
      {
        ownerId: "owner-1",
        backendSessionId: "backend-1",
        protocol: "ssh",
      },
    ];

    expect(parsePersistedConnectionSession(persisted)).toEqual({
      valid: false,
      reason: expect.stringMatching(/contradicts an exact release tombstone/i),
    });
  });

  it("rejects a release tombstone for another protocol", () => {
    const persisted = serializePersistedConnectionSession(makeSession());
    persisted.vpnLeaseReleaseTombstones = [
      {
        ownerId: "released-rdp-owner",
        backendSessionId: "released-rdp-backend",
        protocol: "rdp",
      },
    ];

    expect(parsePersistedConnectionSession(persisted)).toEqual({
      valid: false,
      reason: expect.stringMatching(/tombstone protocol/i),
    });
  });
});
