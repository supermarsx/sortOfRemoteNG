import { describe, expect, it } from "vitest";
import type {
  Connection,
  TunnelType,
} from "../../src/types/connection/connection";
import {
  resolveNetworkPath,
  type NetworkPathCatalog,
} from "../../src/utils/network/resolveNetworkPath";
import { buildRuntimeNetworkPath } from "../../src/utils/network/resolveRuntimeNetworkPath";

const vault = {
  kind: "vault",
  credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
function fixture(
  source: unknown,
  type: TunnelType = "ssh-jump",
  inline = false,
) {
  const hop = {
    id: "hop",
    name: "Hop",
    protocol: "ssh",
    hostname: "hop.example.test",
    port: 22,
    username: "IGNORED_USER",
    password: "IGNORED_PASSWORD",
    privateKey: "IGNORED_KEY",
    credentialSource: source,
  } as Connection;
  const target = {
    id: "target",
    name: "Target",
    protocol: "ssh",
    hostname: "target.example.test",
    port: 22,
    security: {
      tunnelChain: [
        {
          id: "transport",
          enabled: true,
          type,
          sshTunnel: {
            connectionId: hop.id,
            ...(inline
              ? {
                  host: "inline.example.test",
                  username: "INLINE_USER",
                  password: "INLINE_PASSWORD",
                }
              : {}),
          },
        },
      ],
    },
  } as Connection;
  const catalog: NetworkPathCatalog = {
    connections: [hop, target],
    connectionChains: [],
    proxyCollection: {
      profiles: [],
      chains: [],
      tunnelChains: [],
      tunnelProfiles: [],
    },
  };
  return { hop, target, catalog };
}

describe("referenced SSH transport credential boundaries", () => {
  it.each(["ssh-jump", "ssh-tunnel", "ssh-proxycmd", "ssh-stdio"] as const)(
    "refuses a vault-backed %s before exposing inherited or inline secrets",
    (type) => {
      for (const inline of [false, true]) {
        const { target, catalog } = fixture(vault, type, inline);
        const resolution = resolveNetworkPath(target, catalog);
        expect(resolution.layers).toEqual([]);
        expect(resolution.validation.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              severity: "error",
              message: expect.stringContaining("no local or inline fallback"),
            }),
          ]),
        );
        expect(JSON.stringify(resolution)).not.toMatch(/IGNORED_|INLINE_/);
        for (const protocol of ["ssh", "rdp"] as const)
          expect(() =>
            buildRuntimeNetworkPath(target, catalog, protocol),
          ).toThrow(/no local or inline fallback/);
      }
    },
  );

  it.each([
    null,
    "SECRET_SOURCE",
    1,
    true,
    {},
    { kind: "vault", credentialId: "SECRET_BAD_ID" },
    { kind: "local", credentialId: vault.credentialId },
    { kind: "local", password: "SECRET_EXTRA" },
  ])("fails closed for malformed source %# without echoing it", (source) => {
    const { target, catalog } = fixture(source);
    const resolution = resolveNetworkPath(target, catalog);
    expect(resolution.layers).toEqual([]);
    expect(JSON.stringify(resolution)).not.toMatch(/SECRET_|IGNORED_/);
    expect(() => buildRuntimeNetworkPath(target, catalog, "ssh")).toThrow(
      /invalid credential sources/,
    );
  });

  it.each([undefined, { kind: "local" }])(
    "preserves explicit and legacy local SSH/RDP transport authentication %#",
    (source) => {
      const { target, catalog } = fixture(source);
      const ssh = buildRuntimeNetworkPath(target, catalog, "ssh");
      expect(ssh.transport.jump_hosts).toEqual([
        expect.objectContaining({
          host: "hop.example.test",
          username: "IGNORED_USER",
          password: "IGNORED_PASSWORD",
          private_key_path: "IGNORED_KEY",
        }),
      ]);
      const rdp = buildRuntimeNetworkPath(target, catalog, "rdp");
      expect(rdp.rdpTunnel?.bastion.password).toBe("IGNORED_PASSWORD");
    },
  );

  it("does not flatten a vault hop's nested route before refusing it", () => {
    const { hop, target, catalog } = fixture(vault);
    hop.security = {
      tunnelChain: [
        {
          id: "nested",
          type: "ssh-jump",
          enabled: true,
          sshTunnel: {
            host: "nested.example.test",
            password: "NESTED_SECRET",
            forwardType: "local",
          },
        },
      ],
    };
    const resolution = resolveNetworkPath(target, catalog);
    expect(resolution.layers).toEqual([]);
    expect(JSON.stringify(resolution)).not.toContain("NESTED_SECRET");
  });
});
