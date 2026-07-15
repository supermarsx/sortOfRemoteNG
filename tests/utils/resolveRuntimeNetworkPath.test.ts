import { describe, expect, it } from "vitest";
import type {
  Connection,
  TunnelChainLayer,
} from "../../src/types/connection/connection";
import type { NetworkPathCatalog } from "../../src/utils/network/resolveNetworkPath";
import {
  RuntimeNetworkPathError,
  buildRuntimeNetworkPath,
  formatRuntimeNetworkPathError,
  networkPathConnectionIds,
} from "../../src/utils/network/resolveRuntimeNetworkPath";

function connection(
  protocol: "ssh" | "rdp",
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id: `${protocol}-target`,
    name: `${protocol} target`,
    hostname: `${protocol}.example.test`,
    port: protocol === "ssh" ? 22 : 3389,
    protocol,
    ...overrides,
  } as Connection;
}

function layer(
  id: string,
  overrides: Partial<TunnelChainLayer>,
): TunnelChainLayer {
  return {
    id,
    type: "proxy",
    enabled: true,
    ...overrides,
  } as TunnelChainLayer;
}

const EMPTY_CATALOG: NetworkPathCatalog = {
  connections: [],
  proxyCollection: {
    profiles: [],
    chains: [],
    tunnelChains: [],
    tunnelProfiles: [],
  },
  connectionChains: [],
};

describe("buildRuntimeNetworkPath", () => {
  it("keeps a connection direct only when no path is configured", () => {
    const result = buildRuntimeNetworkPath(
      connection("ssh"),
      EMPTY_CATALOG,
      "ssh",
    );

    expect(result.transport).toEqual({
      jump_hosts: [],
      proxy_config: null,
      proxy_chain: null,
      mixed_chain: null,
      openvpn_config: null,
      vpnPreSteps: [],
    });
    expect(result.snapshot).toEqual({
      version: 1,
      transports: [],
      connectionIds: [],
    });
  });

  it("allows direct advanced protocols without inventing route material", () => {
    for (const protocol of [
      "raw-tcp",
      "raw-udp",
      "rlogin",
      "powershell",
    ] as const) {
      const result = buildRuntimeNetworkPath(
        connection("ssh"),
        EMPTY_CATALOG,
        protocol,
      );
      expect(result.protocol).toBe(protocol);
      expect(result.snapshot.transports).toEqual([]);
      expect(result.transport.mixed_chain).toBeNull();
    }
  });

  it("fails closed instead of bypassing configured advanced-protocol hops", () => {
    const target = connection("ssh", {
      security: {
        tunnelChain: [
          layer("proxy", {
            proxy: {
              proxyType: "socks5",
              host: "proxy.example.test",
              port: 1080,
            },
          }),
        ],
      },
    });

    for (const protocol of [
      "raw-tcp",
      "raw-udp",
      "rlogin",
      "powershell",
    ] as const) {
      expect(() =>
        buildRuntimeNetworkPath(target, EMPTY_CATALOG, protocol),
      ).toThrowError(/will not be bypassed|backend.*adapter/i);
    }
  });

  it("maps an ordered proxy and SSH path to the SSH backend mixed chain", () => {
    const target = connection("ssh", {
      security: {
        tunnelChain: [
          layer("proxy", {
            proxy: {
              proxyType: "http-connect",
              host: "proxy.example.test",
              port: 8080,
              username: "proxy-user",
              password: "proxy-password",
            },
          }),
          layer("jump", {
            type: "ssh-jump",
            proxy: undefined,
            sshTunnel: {
              host: "jump.example.test",
              port: 2200,
              username: "jump-user",
              password: "jump-password",
              forwardType: "local",
            },
          }),
        ],
      },
    });

    const result = buildRuntimeNetworkPath(target, EMPTY_CATALOG, "ssh");

    expect(result.transport.mixed_chain).toEqual({
      hops: [
        {
          type: "proxy",
          proxy_type: "http",
          host: "proxy.example.test",
          port: 8080,
          username: "proxy-user",
          password: "proxy-password",
        },
        {
          type: "ssh_jump",
          host: "jump.example.test",
          port: 2200,
          username: "jump-user",
          password: "jump-password",
          private_key_path: null,
          private_key_passphrase: null,
          agent_forwarding: false,
        },
      ],
    });
    expect(result.snapshot.transports).toEqual(["http-connect", "ssh-jump"]);
    expect(JSON.stringify(result.snapshot)).not.toContain("proxy.example.test");
    expect(JSON.stringify(result.snapshot)).not.toContain("proxy-password");
  });

  it("uses the final SSH hop as the RDP bastion and preserves preceding hops", () => {
    const target = connection("rdp", {
      security: {
        tunnelChain: [
          layer("proxy", {
            proxy: {
              proxyType: "socks5",
              host: "proxy.example.test",
              port: 1080,
            },
          }),
          layer("bastion", {
            type: "ssh-tunnel",
            proxy: undefined,
            sshTunnel: {
              host: "bastion.example.test",
              username: "rdp-jump",
              forwardType: "local",
            },
          }),
        ],
      },
    });

    const result = buildRuntimeNetworkPath(target, EMPTY_CATALOG, "rdp");

    expect(result.rdpTunnel?.bastion).toMatchObject({
      host: "bastion.example.test",
      port: 22,
      username: "rdp-jump",
    });
    expect(result.transport.proxy_config).toMatchObject({
      proxy_type: "socks5",
      host: "proxy.example.test",
      port: 1080,
    });
    expect(result.transport.jump_hosts).toEqual([]);
  });

  it("fails closed for an invalid saved reference", () => {
    const target = connection("ssh", { tunnelChainId: "missing-chain" });

    expect(() =>
      buildRuntimeNetworkPath(target, EMPTY_CATALOG, "ssh"),
    ).toThrowError(/Network path blocked.*does not exist/i);
  });

  it("fails closed for unsupported nested ProxyCommand layers", () => {
    const target = connection("ssh", {
      security: {
        tunnelChain: [
          layer("command", {
            type: "ssh-proxycmd",
            proxy: undefined,
            sshTunnel: {
              host: "jump.example.test",
              username: "jump-user",
              forwardType: "local",
              proxyCommand: { command: "nc %h %p" },
            },
          }),
        ],
      },
    });

    expect(() =>
      buildRuntimeNetworkPath(target, EMPTY_CATALOG, "ssh"),
    ).toThrowError(RuntimeNetworkPathError);
  });

  it("rejects an RDP proxy path that has no final SSH bastion", () => {
    const target = connection("rdp", {
      security: {
        tunnelChain: [
          layer("proxy", {
            proxy: {
              proxyType: "socks5",
              host: "proxy.example.test",
              port: 1080,
            },
          }),
        ],
      },
    });

    expect(() =>
      buildRuntimeNetworkPath(target, EMPTY_CATALOG, "rdp"),
    ).toThrowError(/requires a final SSH bastion/i);
  });

  it("rejects non-strict saved proxy-chain strategies", () => {
    const target = connection("ssh", { proxyChainId: "dynamic-chain" });
    const catalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      proxyCollection: {
        ...EMPTY_CATALOG.proxyCollection!,
        chains: [
          {
            id: "dynamic-chain",
            name: "Dynamic",
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
            dynamics: { strategy: "dynamic" },
            layers: [
              {
                position: 0,
                type: "proxy",
                inlineConfig: {
                  type: "socks5",
                  host: "proxy.example.test",
                  port: 1080,
                  enabled: true,
                },
              },
            ],
          },
        ],
      },
    };

    expect(() => buildRuntimeNetworkPath(target, catalog, "ssh")).toThrowError(
      /dynamic routing.*not supported/i,
    );
  });

  it("redacts path secrets and exposes only safe dependency IDs", () => {
    const jump = connection("ssh", {
      id: "jump-connection",
      hostname: "jump.example.test",
      username: "jump-user",
      password: "jump-password",
    });
    const target = connection("ssh", {
      security: {
        tunnelChain: [
          layer("jump", {
            type: "ssh-jump",
            proxy: undefined,
            sshTunnel: {
              connectionId: jump.id,
              forwardType: "local",
            },
          }),
        ],
      },
    });
    const runtime = buildRuntimeNetworkPath(
      target,
      { ...EMPTY_CATALOG, connections: [target, jump] },
      "ssh",
    );

    expect(runtime.snapshot.connectionIds).toEqual(["jump-connection"]);
    expect(
      formatRuntimeNetworkPathError(
        new Error("backend rejected jump-password"),
        runtime,
      ),
    ).toBe("backend rejected [redacted]");
    expect(networkPathConnectionIds([runtime.snapshot])).toEqual(
      new Set(["jump-connection"]),
    );
  });
});
