import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { ConnectionContextType } from "../../src/contexts/ConnectionContextTypes";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import type {
  ProxyCollectionData,
  ProxyConfig,
} from "../../src/types/settings/settings";

const mocks = vi.hoisted(() => ({
  collection: {} as ProxyCollectionData,
  target: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({ captureCurrentDatabaseDataTarget: mocks.target }),
  },
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    initialize: async () => {},
    getProfiles: () => mocks.collection.profiles,
    getChains: () => mocks.collection.chains,
    getTunnelChains: () => mocks.collection.tunnelChains,
    getTunnelProfiles: () => mocks.collection.tunnelProfiles,
  },
}));
import {
  buildRuntimeNetworkPath,
  resolveRuntimeNetworkPath,
  formatRuntimeNetworkPathError,
} from "../../src/utils/network/resolveRuntimeNetworkPath";
import {
  redactNetworkPathSecrets,
  resolveNetworkPath,
} from "../../src/utils/network/resolveNetworkPath";

const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let context: ConnectionContextType;
let base: Connection;
let destination: Connection;
let api: DatabaseCredentialVaultApi;
function installProxy(config: Partial<ProxyConfig>) {
  mocks.collection.profiles = [
    {
      id: "profile",
      name: "SSH proxy",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: { type: "ssh", enabled: true, host: "", port: 22, ...config },
    },
  ];
  mocks.collection.chains = [
    {
      id: "chain",
      name: "Chain",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      layers: [{ type: "proxy", proxyProfileId: "profile", position: 0 }],
    },
  ];
}
const resolve = (protocol: "ssh" | "rdp" | "http" = "ssh") =>
  resolveRuntimeNetworkPath(
    destination,
    context.state.connections,
    protocol,
    () => context,
  );

beforeEach(() => {
  vi.clearAllMocks();
  base = {
    id: "base",
    name: "Bastion",
    hostname: "bastion.test",
    port: 2222,
    protocol: "ssh",
    authType: "password",
    username: "local-user",
    password: "local-secret",
    isGroup: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  destination = {
    ...base,
    id: "destination",
    hostname: "target.test",
    proxyChainId: "chain",
  };
  api = {
    scope: { databaseId: "db", generation: 1 },
    changeRevision: 1,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { databaseId: "db", generation: 1 },
      revision: 1,
      receipt: "r",
      entries: [
        {
          id: credentialId,
          name: "Vault entry",
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          availableFacets: ["username", "password"],
        },
      ],
    })),
    resolve: vi.fn(async () => ({
      username: "vault-user",
      password: "vault-secret",
    })),
    compareAndSwap: vi.fn(),
  };
  context = {
    state: { connections: [base, destination] },
    databaseAvailability: { status: "ready", databaseId: "db", generation: 1 },
    credentialVault: api,
  } as ConnectionContextType;
  mocks.read.mockImplementation(async () => ({
    connections: context.state.connections,
  }));
  mocks.target.mockReturnValue({
    databaseId: "db",
    readCurrent: mocks.read,
    assertAccessible: vi.fn(),
  });
  mocks.collection = {
    version: 1,
    profiles: [],
    chains: [],
    tunnelChains: [],
    tunnelProfiles: [],
  };
  installProxy({ sshConnectionId: "base", sshConnectionDatabaseId: "db" });
});

describe("SSH proxy profiles at the runtime boundary", () => {
  it.each(["proxyProfileId", "tunnelProfileId"] as const)(
    "resolves direct %s linked SSH/vault credentials without changing saved settings",
    async (field) => {
      base.credentialSource = { kind: "vault", credentialId };
      delete destination.proxyChainId;
      destination[field] = "profile";
      if (field === "tunnelProfileId") {
        mocks.collection.tunnelProfiles = [
          {
            id: "profile",
            name: "Saved tunnel",
            type: "ssh-tunnel",
            createdAt: base.createdAt,
            updatedAt: base.updatedAt,
            config: {
              id: "saved-layer",
              type: "ssh-tunnel",
              enabled: true,
              sshTunnel: {
                connectionId: "base",
                ownerDatabaseId: "db",
                forwardType: "local",
              },
            },
          },
        ];
      }
      const before = JSON.stringify({
        collection: mocks.collection,
        connections: context.state.connections,
      });
      const runtime = await resolve();
      expect(runtime.transport.jump_hosts[0]).toMatchObject({
        host: "bastion.test",
        username: "vault-user",
        password: "vault-secret",
      });
      expect(runtime.snapshot.connectionIds).toEqual(["base"]);
      expect(
        field === "proxyProfileId"
          ? runtime.snapshot.proxyProfileIds
          : runtime.snapshot.tunnelProfileIds,
      ).toEqual(["profile"]);
      expect(
        JSON.stringify({
          collection: mocks.collection,
          connections: context.state.connections,
        }),
      ).toBe(before);
      expect(JSON.stringify(runtime.snapshot)).not.toContain("vault-secret");
      destination[field] = "replacement";
      expect(() => runtime.assertCurrent?.()).toThrow(/network path.*changed/);
    },
  );

  it("blocks a missing direct tunnel profile before disclosing an earlier direct SSH proxy credential", async () => {
    base.credentialSource = { kind: "vault", credentialId };
    destination.proxyProfileId = "profile";
    destination.tunnelProfileId = "deleted";
    await expect(resolve()).rejects.toThrow(/Tunnel profile.*does not exist/);
    expect(api.resolve).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("detects cycles through direct saved SSH proxy profile references", async () => {
    destination.proxyProfileId = "profile";
    base.proxyProfileId = "profile";
    await expect(resolve()).rejects.toThrow(/cycle/i);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it.each([
    { proxyCommand: "SECRET_COMMAND" },
    { proxyCommandTemplate: "nc" },
    { enableJumpHost: true },
    {
      mixedChain: {
        hops: [
          {
            type: "ssh_jump",
            host: "nested.test",
            port: 22,
            username: "alice",
          },
        ],
      },
    },
  ])(
    "rejects saved SSH transport overrides before disclosure %#",
    async (override) => {
      base.credentialSource = { kind: "vault", credentialId };
      base.sshConnectionConfigOverride =
        override as Connection["sshConnectionConfigOverride"];
      await expect(resolve()).rejects.toThrow(
        /unsupported transport overrides/,
      );
      expect(api.resolve).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      const result = resolveNetworkPath(destination, {
        connections: context.state.connections,
        proxyCollection: mocks.collection,
      });
      expect(JSON.stringify(result)).not.toContain("SECRET_COMMAND");
    },
  );

  it.each(["before", "during"])(
    "rejects a target route changed %s catalog capture",
    async (when) => {
      base.credentialSource = { kind: "vault", credentialId };
      const changeRoute = () => {
        context.state.connections = [
          base,
          { ...destination, proxyChainId: "replacement-chain" },
        ];
      };
      if (when === "before") changeRoute();
      const attempt = resolve();
      if (when === "during") changeRoute();
      await expect(attempt).rejects.toThrow(/network path.*changed/);
      expect(api.resolve).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it.each(["password", "key"] as const)(
    "executes standalone %s authentication without the other method's stale secret",
    async (method) => {
      installProxy({
        host: "inline.test",
        port: 22,
        username: "alice",
        sshAuthMethod: method,
        password: "inline-password",
        sshKeyFile: "C:/keys/id_ed25519",
        sshKeyPassphrase: "key-passphrase",
      });
      const runtime = await resolve();
      expect(runtime.transport.jump_hosts).toEqual([
        expect.objectContaining({
          host: "inline.test",
          username: "alice",
          password: method === "password" ? "inline-password" : null,
          private_key_path: method === "key" ? "C:/keys/id_ed25519" : null,
          private_key_passphrase: method === "key" ? "key-passphrase" : null,
        }),
      ]);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it("resolves linked local credentials afresh and ignores inline destination/secret overrides", async () => {
    installProxy({
      sshConnectionId: "base",
      sshConnectionDatabaseId: "db",
      host: "attacker.test",
      username: "stale-user",
      password: "stale-secret",
      sshKeyFile: "stale-key",
    });
    base.password = "updated-local-secret";
    const before = JSON.stringify(mocks.collection);
    const runtime = await resolve();
    expect(runtime.transport.jump_hosts[0]).toMatchObject({
      host: "bastion.test",
      port: 2222,
      username: "local-user",
      password: "updated-local-secret",
      private_key_path: null,
    });
    expect(JSON.stringify(runtime.transport)).not.toMatch(/attacker|stale/);
    expect(JSON.stringify(mocks.collection)).toBe(before);
    expect(api.resolve).not.toHaveBeenCalled();
    context.state.connections = context.state.connections.filter(
      (c) => c.id !== "base",
    );
    expect(() => runtime.assertCurrent?.()).toThrow(/changed/);
  });

  it.each(["ssh", "rdp"] as const)(
    "resolves linked vault passwords for %s with safe snapshots/redaction and revocation",
    async (protocol) => {
      base.credentialSource = { kind: "vault", credentialId };
      const before = JSON.stringify({
        collection: mocks.collection,
        connections: context.state.connections,
      });
      const runtime = await resolve(protocol);
      const hop =
        protocol === "rdp"
          ? runtime.rdpTunnel?.bastion
          : runtime.transport.jump_hosts[0];
      expect(hop).toMatchObject({
        username: "vault-user",
        password: "vault-secret",
        private_key_path: null,
      });
      expect(api.resolve).toHaveBeenCalledWith(
        expect.anything(),
        credentialId,
        ["username", "password"],
      );
      expect(JSON.stringify(runtime.snapshot)).not.toMatch(
        /secret|user|bastion/,
      );
      expect(
        formatRuntimeNetworkPathError(new Error("bad vault-secret"), runtime),
      ).not.toContain("vault-secret");
      expect(
        JSON.stringify({
          collection: mocks.collection,
          connections: context.state.connections,
        }),
      ).toBe(before);
      api.changeRevision += 1;
      expect(() => runtime.assertCurrent?.()).toThrow(/changed/);
    },
  );

  it.each([
    "deleted",
    "non-ssh",
    "group",
    "wrong-db",
    "ownerless",
    "cycle",
    "empty",
    "malformed",
  ])(
    "rejects %s sources without inline fallback or vault disclosure",
    async (failure) => {
      base.credentialSource = { kind: "vault", credentialId };
      const config = mocks.collection.profiles[0].config;
      config.host = "inline-fallback.test";
      config.username = "fallback";
      config.password = "fallback-secret";
      if (failure === "deleted") context.state.connections = [destination];
      if (failure === "non-ssh") base.protocol = "rdp";
      if (failure === "group") base.isGroup = true;
      if (failure === "wrong-db") config.sshConnectionDatabaseId = "other-db";
      if (failure === "ownerless") delete config.sshConnectionDatabaseId;
      if (failure === "cycle") base.proxyChainId = "chain";
      if (failure === "empty") config.sshConnectionId = "";
      if (failure === "malformed")
        config.sshConnectionId = null as unknown as string;
      await expect(resolve()).rejects.toThrow();
      expect(api.resolve).not.toHaveBeenCalled();
    },
  );

  it("rejects a locked vault and unsupported vault keys without local fallback", async () => {
    base.credentialSource = { kind: "vault", credentialId };
    api.scope = null;
    await expect(resolve()).rejects.toThrow(/Unlock|unlock/);
    base.authType = "key";
    await expect(resolve()).rejects.toThrow(/vault password/);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it("resolves nested linked tunnel hops through the same owner and vault boundary", async () => {
    base.credentialSource = { kind: "vault", credentialId };
    delete destination.proxyChainId;
    destination.security = {
      tunnelChain: [
        {
          id: "ssh",
          type: "ssh-tunnel",
          enabled: true,
          sshTunnel: {
            connectionId: "base",
            ownerDatabaseId: "db",
            forwardType: "local",
          },
        },
      ],
    };
    const runtime = await resolve();
    expect(runtime.transport.jump_hosts[0].password).toBe("vault-secret");
    expect(runtime.snapshot.connectionIds).toEqual(["base"]);
  });

  it("rejects HTTP SSH paths before credentials are disclosed", async () => {
    base.credentialSource = { kind: "vault", credentialId };
    await expect(resolve("http")).rejects.toThrow(/HTTP proxy backend/);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it("keeps unresolved vault material out of canonical diagnostics and fails closed in synchronous transports", () => {
    base.credentialSource = { kind: "vault", credentialId };
    const catalog = {
      connections: context.state.connections,
      proxyCollection: mocks.collection,
    };
    const resolution = resolveNetworkPath(destination, catalog, {
      allowUnresolvedVaultHops: true,
    });
    expect(resolution.validation.valid).toBe(true);
    expect(JSON.stringify(redactNetworkPathSecrets(resolution))).not.toContain(
      "local-secret",
    );
    expect(() => buildRuntimeNetworkPath(destination, catalog, "ssh")).toThrow(
      /unresolved vault/,
    );
  });
});
