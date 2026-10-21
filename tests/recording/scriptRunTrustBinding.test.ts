import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  captureScriptTrustSourceBinding,
  resolveSavedConnectionTrustBinding,
  resolveScriptTrustBinding,
  type ScriptTrustBindingContext,
  type ScriptTrustBindingSession,
} from "../../src/utils/recording/scriptRunTrustBinding";
import {
  registerRuntimeConnection,
  releaseRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { SENTINELS, containsSentinel } from "./scriptTrustTestBackend";

const row = (overrides: Partial<Connection> = {}): Connection =>
  ({
    id: "conn-1",
    name: "Build server",
    protocol: "ssh",
    hostname: "host-a.example",
    port: 22,
    username: "operator",
    isGroup: false,
    ...overrides,
  }) as Connection;

const session = (
  overrides: Partial<ScriptTrustBindingSession> = {},
): ScriptTrustBindingSession => ({
  connectionId: "conn-1",
  protocol: "ssh",
  hostname: "host-a.example",
  ownerDatabaseId: "db-1",
  ...overrides,
});

const context = (
  connections: Connection[],
  overrides: Partial<ScriptTrustBindingContext> = {},
): ScriptTrustBindingContext => ({
  state: { connections },
  databaseAvailability: { status: "ready", databaseId: "db-1", generation: 4 },
  getCurrentConnections: () => connections,
  ...overrides,
});

const endpointDigest = (values: unknown[]) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(["sorng.run-trust.endpoint.v1", ...values]), "utf8")
    .digest("hex")}`;

describe("the binding of a session's saved connection", () => {
  it("names the database, the connection and the digest of the saved endpoint", async () => {
    expect(
      await resolveScriptTrustBinding(context([row()]), session()),
    ).toStrictEqual({
      databaseId: "db-1",
      connectionId: "conn-1",
      endpointDigest: endpointDigest([
        "db-1",
        "conn-1",
        "ssh",
        "host-a.example",
        22,
        "operator",
        null,
        null,
        null,
      ]),
    });
    const vault = row({
      domain: "CORP",
      credentialSource: { kind: "vault", credentialId: "cred-1", totpId: "t" },
    });
    expect(
      (await resolveScriptTrustBinding(context([vault]), session()))
        ?.endpointDigest,
    ).toBe(
      endpointDigest([
        "db-1",
        "conn-1",
        "ssh",
        "host-a.example",
        22,
        "operator",
        "CORP",
        "vault",
        "cred-1",
      ]),
    );
  });

  it("asks the provider for the rows of exactly the ready database and generation", async () => {
    const getCurrentConnections = vi.fn(() => [row()]);
    await resolveScriptTrustBinding(
      context([], { getCurrentConnections }),
      session(),
    );
    expect(getCurrentConnections).toHaveBeenCalledExactlyOnceWith({
      databaseId: "db-1",
      generation: 4,
    });
    // An older context without the guarded reader: the committed rows.
    expect(
      await resolveScriptTrustBinding(
        context([row()], { getCurrentConnections: undefined }),
        session(),
      ),
    ).not.toBeNull();
  });

  it("binds SSH to its canonical saved hostname despite stale integration metadata", async () => {
    const integration = row({
      hostname: "host-a.example",
      integration: { descriptorKey: "x", host: "stale-integration.example" },
    } as Partial<Connection>);
    const binding = await resolveScriptTrustBinding(
      context([integration]),
      session(),
    );
    expect(binding?.endpointDigest).toBe(
      endpointDigest([
        "db-1",
        "conn-1",
        "ssh",
        "host-a.example",
        22,
        "operator",
        null,
        null,
        null,
      ]),
    );
    expect(
      await resolveScriptTrustBinding(
        context([integration]),
        session({ hostname: "stale-integration.example" }),
      ),
    ).toBeNull();
  });
  it("does not grant SSH script trust to an integration protocol using its integration endpoint", async () => {
    const integration = row({
      protocol: "integration:example",
      hostname: "canonical.example",
      integration: { descriptorKey: "example", host: "integration.example" },
    } as Partial<Connection>);
    expect(
      await resolveScriptTrustBinding(
        context([integration]),
        session({
          protocol: "integration:example",
          hostname: "integration.example",
        }),
      ),
    ).toBeNull();
    expect(
      await resolveSavedConnectionTrustBinding(context([integration]), {
        databaseId: "db-1",
        connectionId: integration.id,
      }),
    ).toBeNull();
  });

  const refusals: [
    string,
    ScriptTrustBindingContext,
    ScriptTrustBindingSession,
  ][] = [
    [
      "a session without an owning database (Quick Connect)",
      context([row()]),
      session({ ownerDatabaseId: undefined }),
    ],
    ["an empty owner", context([row()]), session({ ownerDatabaseId: "" })],
    [
      "a session that is not SSH",
      context([row()]),
      session({ protocol: "telnet" }),
    ],
    [
      "a context that does not report availability",
      context([row()], { databaseAvailability: undefined }),
      session(),
    ],
    ...(["none", "loading", "suspended", "error"] as const).map(
      (
        status,
      ): [string, ScriptTrustBindingContext, ScriptTrustBindingSession] => [
        `a database that is ${status}`,
        context([row()], {
          databaseAvailability: { status, databaseId: "db-1", generation: 4 },
        }),
        session(),
      ],
    ),
    [
      "another database being the open one",
      context([row()], {
        databaseAvailability: {
          status: "ready",
          databaseId: "db-2",
          generation: 4,
        },
      }),
      session(),
    ],
    [
      "a ready database without an id",
      context([row()], {
        databaseAvailability: { status: "ready", generation: 4 },
      }),
      session(),
    ],
    ["no saved row with the session's id", context([]), session()],
    ["only another row", context([row({ id: "conn-2" })]), session()],
    [
      "a provider that refuses the read",
      context([row()], {
        getCurrentConnections: () => {
          throw new Error("Open and unlock the original database.");
        },
      }),
      session(),
    ],
    [
      "a session opened to another host than the row names now",
      context([row({ hostname: "host-b.example" })]),
      session(),
    ],
    [
      "a row that is no longer SSH",
      context([row({ protocol: "rdp" })]),
      session(),
    ],
    ["a folder", context([row({ isGroup: true })]), session()],
    [
      "two rows with the session's id",
      context([row(), row({ name: "Copy" })]),
      session(),
    ],
    [
      "a row without a usable port",
      context([row({ port: Number.NaN })]),
      session(),
    ],
    [
      "a connection id that is not an id",
      context([row({ id: "a\nb" })]),
      session({ connectionId: "a\nb" }),
    ],
  ];

  it.each(refusals)("is null for %s", async (_label, where, which) => {
    expect(await resolveScriptTrustBinding(where, which)).toBeNull();
  });

  it("never takes the row from the runtime registry", async () => {
    const runtime = row({ id: "quick-1" });
    registerRuntimeConnection(runtime);
    try {
      // The terminal's own lookup finds it; the binding must not.
      expect(resolveRuntimeConnection([], "quick-1")).toBe(runtime);
      expect(
        await resolveScriptTrustBinding(
          context([]),
          session({ connectionId: "quick-1" }),
        ),
      ).toBeNull();
      expect(
        await resolveSavedConnectionTrustBinding(context([]), {
          databaseId: "db-1",
          connectionId: "quick-1",
        }),
      ).toBeNull();
    } finally {
      releaseRuntimeConnection("quick-1");
    }
  });

  it("is the same across a rename, a move, tags, a colour and a favourite", async () => {
    const base = await resolveScriptTrustBinding(context([row()]), session());
    expect(base).not.toBeNull();
    for (const change of [
      { name: SENTINELS.name },
      { parentId: "folder-2" },
      { tags: ["prod", "db"] },
      { colorTag: "red" },
      { favorite: true },
      { description: "Notes" },
      { password: "changed-secret" },
      { order: 9 },
    ] as Partial<Connection>[])
      expect(
        await resolveScriptTrustBinding(
          context([row(change)]),
          session({ name: change.name } as never),
        ),
        JSON.stringify(change),
      ).toStrictEqual(base);
  });

  it("differs after a port, user, domain or credential-reference edit, and returns when they do (S13)", async () => {
    const base = await resolveScriptTrustBinding(context([row()]), session());
    const digests = new Set([base!.endpointDigest]);
    const changes: Partial<Connection>[] = [
      { port: 2222 },
      { username: "root" },
      { username: undefined },
      { domain: "CORP" },
      { credentialSource: { kind: "local" } },
      { credentialSource: { kind: "vault", credentialId: "cred-1" } },
      { credentialSource: { kind: "vault", credentialId: "cred-2" } },
    ];
    for (const change of changes) {
      const edited = await resolveScriptTrustBinding(
        context([row(change)]),
        session(),
      );
      expect(edited, JSON.stringify(change)).not.toBeNull();
      expect(edited!.databaseId).toBe("db-1");
      expect(edited!.connectionId).toBe("conn-1");
      digests.add(edited!.endpointDigest);
    }
    expect(digests.size).toBe(changes.length + 1);
    // A host edit: the live session no longer matches the row at all.
    expect(
      await resolveScriptTrustBinding(
        context([row({ hostname: "host-b.example" })]),
        session(),
      ),
    ).toBeNull();
    // The session reconnected to the new host: bound again, to another endpoint.
    const moved = await resolveScriptTrustBinding(
      context([row({ hostname: "host-b.example" })]),
      session({ hostname: "host-b.example" }),
    );
    expect(digests.has(moved!.endpointDigest)).toBe(false);
    // Edited back: exactly the binding that was trusted.
    expect(
      await resolveScriptTrustBinding(context([row()]), session()),
    ).toStrictEqual(base);
  });

  it("differs for the same row in another database and for a duplicate (S2)", async () => {
    const base = await resolveScriptTrustBinding(context([row()]), session());
    const cloned = await resolveScriptTrustBinding(
      context([row()], {
        databaseAvailability: {
          status: "ready",
          databaseId: "db-2",
          generation: 1,
        },
      }),
      session({ ownerDatabaseId: "db-2" }),
    );
    const duplicate = await resolveScriptTrustBinding(
      context([row(), row({ id: "conn-1-copy" })]),
      session({ connectionId: "conn-1-copy" }),
    );
    expect(cloned).toMatchObject({
      databaseId: "db-2",
      connectionId: "conn-1",
    });
    expect(duplicate).toMatchObject({
      databaseId: "db-1",
      connectionId: "conn-1-copy",
    });
    expect(
      new Set([
        base!.endpointDigest,
        cloned!.endpointDigest,
        duplicate!.endpointDigest,
      ]).size,
    ).toBe(3);
  });

  it("carries no host, user, domain, name or credential id", async () => {
    const binding = await resolveScriptTrustBinding(
      context([
        row({
          name: SENTINELS.name,
          hostname: SENTINELS.host,
          username: SENTINELS.user,
          domain: SENTINELS.domain,
          credentialSource: {
            kind: "vault",
            credentialId: SENTINELS.credential,
          },
        }),
      ]),
      session({ hostname: SENTINELS.host }),
    );
    expect(Object.keys(binding!)).toEqual([
      "databaseId",
      "connectionId",
      "endpointDigest",
    ]);
    expect(containsSentinel(JSON.stringify(binding))).toBe(false);
  });
});

describe("the binding of a saved row, without a session", () => {
  it("cannot capture a vault actor whose resolved account cannot be freshly verified", async () => {
    const source = row({
      credentialSource: {
        kind: "vault",
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    const where = context([source]);
    expect(
      await resolveSavedConnectionTrustBinding(where, {
        databaseId: "db-1",
        connectionId: "conn-1",
      }),
    ).not.toBeNull();
    expect(
      await captureScriptTrustSourceBinding(where, session(), source),
    ).toBeNull();
  });
  it("is what a session on that row would get, and null when the row cannot be verified", async () => {
    const where = context([row(), row({ id: "conn-2", protocol: "rdp" })]);
    expect(
      await resolveSavedConnectionTrustBinding(where, {
        databaseId: "db-1",
        connectionId: "conn-1",
      }),
    ).toStrictEqual(await resolveScriptTrustBinding(where, session()));
    for (const reference of [
      { databaseId: "db-2", connectionId: "conn-1" },
      { databaseId: "db-1", connectionId: "conn-9" },
      { databaseId: "db-1", connectionId: "conn-2" },
      { databaseId: "", connectionId: "conn-1" },
    ])
      expect(
        await resolveSavedConnectionTrustBinding(where, reference),
      ).toBeNull();
    expect(
      await resolveSavedConnectionTrustBinding(
        context([row()], {
          databaseAvailability: {
            status: "loading",
            databaseId: "db-1",
            generation: 4,
          },
        }),
        { databaseId: "db-1", connectionId: "conn-1" },
      ),
    ).toBeNull();
  });
});
