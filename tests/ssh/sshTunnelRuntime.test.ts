import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionContextType } from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";

const mock = vi.hoisted(() => ({
  target: vi.fn(),
  read: vi.fn(),
  assert: vi.fn(),
  resolveVault: vi.fn(),
}));

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({ captureCurrentDatabaseDataTarget: mock.target }),
  },
}));

vi.mock("../../src/utils/security/runtimeCredentialVault", () => ({
  resolveRuntimeVaultCredential: mock.resolveVault,
}));

import { resolveSavedTunnelBase } from "../../src/utils/ssh/sshTunnelRuntime";

const connection = {
  id: "base",
  name: "SSH",
  protocol: "ssh",
  hostname: "ssh.example",
  port: 22,
  username: "alice",
  password: "saved-secret",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as Connection;

let context: ConnectionContextType;

const persisted = (saved: Connection = connection) => ({
  connections: [
    JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(saved).reverse())),
    ),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  context = {
    state: { connections: [connection] },
    databaseAvailability: { status: "ready", databaseId: "db", generation: 1 },
  } as ConnectionContextType;
  mock.target.mockReturnValue({
    databaseId: "db",
    readCurrent: mock.read,
    assertAccessible: mock.assert,
  });
  // Reverse field order and serialize Dates as the database does.
  mock.read.mockResolvedValue(persisted());
});

describe("resolveSavedTunnelBase", () => {
  it("ignores session bookkeeping and presentation changes before and during resolution", async () => {
    context.state.connections = [
      {
        ...connection,
        name: "Renamed",
        updatedAt: "2026-09-30T12:00:00Z",
        lastConnected: "2026-09-30T12:00:00Z",
        connectionCount: 2,
        favorite: true,
        colorTag: "blue",
        tabColor: "#123456",
        httpBookmarks: [],
      },
    ];
    mock.read.mockImplementationOnce(async () => {
      context.state.connections = [
        {
          ...context.state.connections[0],
          lastConnected: "2026-09-30T12:01:00Z",
          connectionCount: 3,
          icon: "server",
          description: "Presentation only",
          tags: ["renamed"],
          order: 2,
          expanded: true,
        },
      ];
      return persisted();
    });
    const result = await resolveSavedTunnelBase("base", "db", () => context);
    context.getCurrentConnections = () => [
      {
        ...context.state.connections[0],
        name: "Another name",
        connectionCount: 4,
        updatedAt: "2026-09-30T12:02:00Z",
      },
    ];
    expect(() => result.options.assertCurrent?.()).not.toThrow();
    expect(result.connection.password).toBe("saved-secret");
  });

  it("canonicalizes creation instants without discarding creation identity", async () => {
    mock.read.mockResolvedValueOnce(
      persisted({
        ...connection,
        createdAt: "2025-12-31T19:00:00-05:00",
      }),
    );
    const result = await resolveSavedTunnelBase("base", "db", () => context);
    context.state.connections = [
      { ...connection, createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(() => result.options.assertCurrent?.()).toThrow(
      "owning database changed",
    );
  });

  const sourceChanges: Array<[string, Partial<Connection>]> = [
    ["id", { id: "replacement" }],
    ["creation", { createdAt: "2026-01-02T00:00:00Z" }],
    ["password", { password: "changed" }],
    ["username", { username: "other" }],
    ["key authentication", { authType: "key", privateKey: "other-key" }],
    [
      "vault binding",
      {
        credentialSource: {
          kind: "vault",
          credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
    ],
    ["destination", { hostname: "other.example" }],
    ["port", { port: 2222 }],
    ["trust", { ignoreSshSecurityErrors: true }],
    ["known hosts", { sshKnownHostsPath: "other-known-hosts" }],
    ["trust policy", { sshTrustPolicy: "strict" }],
    ["proxy chain", { proxyChainId: "other-chain" }],
    ["parent routing scope", { parentId: "other-folder" }],
    [
      "transport override",
      {
        sshConnectionConfigOverride: {
          enableJumpHost: true,
          jumpHostConnectionId: "jump",
        },
      },
    ],
  ];
  it.each(sourceChanges)(
    "rejects unsaved %s changes",
    async (_label, change) => {
      context.state.connections = [{ ...connection, ...change }];
      await expect(
        resolveSavedTunnelBase("base", "db", () => context),
      ).rejects.toThrow("Save the SSH base connection");
    },
  );
  it.each(sourceChanges)(
    "invalidates the live guard on %s changes",
    async (_label, change) => {
      const result = await resolveSavedTunnelBase("base", "db", () => context);
      context.getCurrentConnections = () => [{ ...connection, ...change }];
      expect(() => result.options.assertCurrent?.()).toThrow(
        "owning database changed",
      );
    },
  );
  it("resolves persisted direct credentials from the owning database", async () => {
    const result = await resolveSavedTunnelBase("base", "db", () => context);

    expect(result.connection).toMatchObject({
      id: "base",
      hostname: "ssh.example",
      username: "alice",
      password: "saved-secret",
    });
    expect(result.options.connections).toHaveLength(1);
    expect(() => result.options.assertCurrent?.()).not.toThrow();
    expect(mock.assert).toHaveBeenCalled();
  });

  it("rejects an unowned legacy tunnel before reading any database", async () => {
    await expect(
      resolveSavedTunnelBase("base", undefined, () => context),
    ).rejects.toThrow("explicitly reselect");

    expect(mock.target).not.toHaveBeenCalled();
    expect(mock.read).not.toHaveBeenCalled();
  });

  it.each([
    ["another database", "ready", "other"],
    ["a locked database", "locked", "db"],
  ])("rejects access through %s", async (_label, status, databaseId) => {
    context = {
      ...context,
      databaseAvailability: {
        status,
        databaseId,
        generation: 1,
      },
    } as ConnectionContextType;

    await expect(
      resolveSavedTunnelBase("base", "db", () => context),
    ).rejects.toThrow("owning database");
    expect(mock.read).not.toHaveBeenCalled();
  });

  it.each([
    [
      "edited in memory",
      () => {
        context = {
          ...context,
          state: {
            ...context.state,
            connections: [{ ...connection, hostname: "edited.example" }],
          },
        } as ConnectionContextType;
      },
    ],
    [
      "missing from persisted data",
      () => mock.read.mockResolvedValueOnce({ connections: [] }),
    ],
  ])("rejects a base that is %s", async (_label, arrange) => {
    arrange();

    await expect(
      resolveSavedTunnelBase("base", "db", () => context),
    ).rejects.toThrow("Save the SSH base connection");
  });

  it("returns vault facets with the owning snapshot guard", async () => {
    const vaultConnection = {
      ...connection,
      password: undefined,
      credentialSource: {
        kind: "vault",
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    } as Connection;
    const vaultApi = {
      scope: { databaseId: "db", generation: 1 },
      changeRevision: 4,
    };
    context = {
      ...context,
      state: { ...context.state, connections: [vaultConnection] },
      credentialVault: vaultApi,
    } as ConnectionContextType;
    mock.read.mockResolvedValue(persisted(vaultConnection));
    mock.resolveVault.mockImplementationOnce(async (input) => ({
      facets: { username: "vault-user", password: "vault-secret" },
      assertCurrent: input.assertCurrent,
    }));

    const result = await resolveSavedTunnelBase("base", "db", () => context);

    expect(result.options.vault?.facets).toEqual({
      username: "vault-user",
      password: "vault-secret",
    });
    expect(mock.resolveVault).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ id: "base" }),
        session: expect.objectContaining({
          connectionId: "base",
          ownerDatabaseId: "db",
        }),
      }),
    );

    vaultApi.changeRevision++;
    expect(() => result.options.assertCurrent?.()).toThrow(
      "owning database changed",
    );
    expect(() => result.options.vault?.assertCurrent()).toThrow(
      "owning database changed",
    );
  });
});
