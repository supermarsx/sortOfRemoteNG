import { describe, expect, it } from "vitest";
import type {
  Connection,
  TunnelChainLayer,
} from "../../src/types/connection/connection";
import type {
  ProxyCollectionData,
  ProxyConfig,
  SavedProxyChain,
  SavedProxyProfile,
  SavedTunnelChain,
  SavedTunnelProfile,
} from "../../src/types/settings/settings";
import type {
  ConnectionChain,
  ChainLayer,
} from "../../src/utils/network/proxyOpenVPNManager";
import {
  NETWORK_PATH_POLICY,
  NETWORK_PATH_REDACTED,
  redactNetworkPathSecrets,
  resolveNetworkPath,
  type NetworkPathCatalog,
} from "../../src/utils/network/resolveNetworkPath";

const NOW = "2026-07-15T00:00:00.000Z";

function connection(
  id: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    name: id,
    hostname: `${id}.example.test`,
    port: 22,
    protocol: "ssh",
    ...overrides,
  } as Connection;
}

function tunnelLayer(
  id: string,
  overrides: Partial<TunnelChainLayer> = {},
): TunnelChainLayer {
  return {
    id,
    type: "proxy",
    enabled: true,
    proxy: {
      proxyType: "socks5",
      host: `${id}.proxy.test`,
      port: 1080,
    },
    ...overrides,
  };
}

function proxyConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    type: "socks5",
    host: "saved.proxy.test",
    port: 1080,
    enabled: true,
    ...overrides,
  };
}

function proxyProfile(
  id: string,
  overrides: Partial<SavedProxyProfile> = {},
): SavedProxyProfile {
  return {
    id,
    name: id,
    config: proxyConfig(),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function proxyChain(
  id: string,
  overrides: Partial<SavedProxyChain> = {},
): SavedProxyChain {
  return {
    id,
    name: id,
    layers: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function savedTunnelChain(
  id: string,
  layers: TunnelChainLayer[],
): SavedTunnelChain {
  return {
    id,
    name: id,
    layers,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function tunnelProfile(
  id: string,
  config: TunnelChainLayer,
): SavedTunnelProfile {
  return {
    id,
    name: id,
    type: config.type,
    config,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function backendLayer(
  id: string,
  connectionType: string,
  connectionId: string,
  position: number,
): ChainLayer {
  return {
    id,
    connection_type: connectionType,
    connection_id: connectionId,
    position,
    status: "Disconnected",
  } as ChainLayer;
}

function backendChain(id: string, layers: ChainLayer[]): ConnectionChain {
  return {
    id,
    name: id,
    layers,
    status: "Disconnected",
    created_at: NOW,
  } as ConnectionChain;
}

function catalog(
  proxyCollection: Partial<ProxyCollectionData> = {},
  options: {
    connections?: Connection[];
    connectionChains?: ConnectionChain[];
    vpnProfiles?: NetworkPathCatalog["vpnProfiles"];
  } = {},
): NetworkPathCatalog {
  return {
    proxyCollection: {
      profiles: proxyCollection.profiles ?? [],
      chains: proxyCollection.chains ?? [],
      tunnelChains: proxyCollection.tunnelChains ?? [],
      tunnelProfiles: proxyCollection.tunnelProfiles ?? [],
    },
    connections: options.connections ?? [],
    connectionChains: options.connectionChains ?? [],
    vpnProfiles: options.vpnProfiles,
  };
}

function comparableLayers(result: ReturnType<typeof resolveNetworkPath>) {
  return result.layers.map((layer) => ({
    kind: layer.kind,
    transport: layer.transport,
    config: layer.config,
  }));
}

describe("resolveNetworkPath", () => {
  it("documents and returns a direct, valid path when nothing is configured", () => {
    const result = resolveNetworkPath(connection("target"));

    expect(NETWORK_PATH_POLICY.sourceOrder).toEqual([
      "connection-chain",
      "proxy-chain",
      "tunnel-chain",
      "inline-tunnel",
      "legacy-vpn",
      "legacy-proxy",
    ]);
    expect(result.layers).toEqual([]);
    expect(result.validation).toEqual({
      valid: true,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });
    expect(result.summary).toMatchObject({
      status: "direct",
      description: "Direct to target",
      layerCount: 0,
    });
  });

  it("normalizes the legacy per-connection security.proxy source", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          proxy: proxyConfig({
            type: "http",
            host: "legacy.proxy.test",
            port: 8080,
            username: "operator",
            password: "legacy-secret",
          }),
        },
      }),
    );

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({
      order: 0,
      kind: "proxy",
      transport: "http",
      source: {
        kind: "legacy-proxy",
        ownerConnectionId: "target",
        layerId: "security.proxy",
      },
      config: {
        host: "legacy.proxy.test",
        port: 8080,
        username: "operator",
        password: "legacy-secret",
      },
    });
    expect(result.summary.description).toBe("http -> target");
  });

  it("preserves inline tunnel-layer order and reports omitted disabled layers", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("vpn", {
              type: "openvpn",
              vpn: { configId: "vpn-1" },
              proxy: undefined,
            }),
            tunnelLayer("off", { enabled: false }),
            tunnelLayer("proxy"),
            tunnelLayer("ssh", {
              type: "ssh-jump",
              proxy: undefined,
              sshTunnel: {
                host: "jump.test",
                port: 2222,
                username: "jump-user",
                forwardType: "local",
              },
            }),
          ],
        },
      }),
    );

    expect(result.layers.map((layer) => layer.transport)).toEqual([
      "openvpn",
      "socks5",
      "ssh-jump",
    ]);
    expect(result.layers.map((layer) => layer.order)).toEqual([0, 1, 2]);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "disabled-layer", severity: "warning" }),
    );
  });

  it("resolves an imported VPN layer by configId rather than its layer ID", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("imported-layer-id", {
              type: "wireguard",
              proxy: undefined,
              vpn: { configId: "wireguard-profile-id" },
            }),
          ],
        },
      }),
      catalog(
        {},
        {
          vpnProfiles: {
            profiles: [
              {
                id: "wireguard-profile-id",
                name: "Imported WireGuard",
                vpnType: "wireguard",
                status: "disconnected",
                createdAt: new Date(NOW),
              },
            ],
            providerStatus: { wireguard: "loaded" },
          },
        },
      ),
    );

    expect(result.validation.valid).toBe(true);
    expect(result.layers[0]).toMatchObject({
      kind: "vpn",
      transport: "wireguard",
      source: { layerId: "imported-layer-id" },
      config: { connectionId: "wireguard-profile-id" },
    });
  });

  it("distinguishes a deleted VPN profile from an unavailable provider store", () => {
    const target = connection("target", {
      security: {
        tunnelChain: [
          tunnelLayer("layer-id", {
            type: "openvpn",
            proxy: undefined,
            vpn: { configId: "deleted-profile" },
          }),
        ],
      },
    });

    const deleted = resolveNetworkPath(
      target,
      catalog(
        {},
        {
          vpnProfiles: {
            profiles: [],
            providerStatus: { openvpn: "loaded" },
          },
        },
      ),
    );
    expect(deleted.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "missing-reference",
        message: expect.stringMatching(/no longer exists/i),
      }),
    );

    const unavailable = resolveNetworkPath(
      target,
      catalog(
        {},
        {
          vpnProfiles: {
            profiles: [],
            providerStatus: { openvpn: "error" },
          },
        },
      ),
    );
    expect(unavailable.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "snapshot-unavailable",
        message: expect.stringMatching(/cannot be verified yet/i),
      }),
    );
    expect(unavailable.validation.issues).not.toContainEqual(
      expect.objectContaining({ code: "missing-reference" }),
    );
  });

  it("recognizes legacy VPN references but blocks unsupported providers", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("legacy-layer", {
              type: "pptp",
              proxy: undefined,
              vpn: { configId: "legacy-office" },
            }),
          ],
        },
      }),
      catalog(
        {},
        {
          vpnProfiles: {
            profiles: [
              {
                id: "legacy-office",
                name: "Legacy Office",
                vpnType: "pptp",
                status: "disconnected",
                createdAt: new Date(NOW),
              },
            ],
            providerStatus: { pptp: "unsupported" },
            providerErrors: {
              pptp: "Encrypted persistent profiles are unavailable.",
            },
          },
        },
      ),
    );

    expect(result.layers).toEqual([]);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-layer",
        message: expect.stringMatching(/PPTP.*not executable.*persistent/i),
      }),
    );
  });

  it("validates split routing against the target literal IP", () => {
    const resolveIke = (hostname: string, mode: "full" | "split") =>
      resolveNetworkPath(
        connection("target", {
          hostname,
          security: {
            tunnelChain: [
              tunnelLayer("ike-layer", {
                type: "ikev2",
                proxy: undefined,
                vpn: { configId: "ike-office" },
              }),
            ],
          },
        }),
        catalog(
          {},
          {
            vpnProfiles: {
              profiles: [
                {
                  id: "ike-office",
                  name: "IKE Office",
                  vpnType: "ikev2",
                  status: "disconnected",
                  createdAt: new Date(NOW),
                  routing: {
                    mode,
                    remoteSubnets:
                      mode === "full"
                        ? ["0.0.0.0/0", "::/0"]
                        : ["10.20.0.0/16", "2001:db8:42::/48"],
                  },
                },
              ],
              providerStatus: { ikev2: "loaded" },
            },
          },
        ),
      );

    expect(resolveIke("vpn-target.example.test", "full").validation.valid).toBe(
      true,
    );
    expect(resolveIke("10.20.30.40", "split").validation.valid).toBe(true);

    const dnsTarget = resolveIke("vpn-target.example.test", "split");
    expect(dnsTarget.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-layer",
        message: expect.stringMatching(/literal.*full-tunnel.*DNS/i),
      }),
    );

    const outsideTarget = resolveIke("10.21.30.40", "split");
    expect(outsideTarget.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-layer",
        message: expect.stringMatching(/does not cover.*target IP/i),
      }),
    );
  });

  it("keeps legacy profile IDs routable while exposing their migration source", () => {
    const legacySecurity = resolveNetworkPath(
      connection("target", {
        security: {
          openvpn: { enabled: true, configId: "legacy-openvpn-profile" },
        },
      }),
    );
    expect(legacySecurity.layers[0]).toMatchObject({
      kind: "vpn",
      transport: "openvpn",
      source: { kind: "legacy-vpn" },
      config: { connectionId: "legacy-openvpn-profile" },
    });

    const legacyLayerId = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("legacy-profile-as-layer-id", {
              type: "openvpn",
              proxy: undefined,
            }),
          ],
        },
      }),
    );
    expect(legacyLayerId.layers[0]).toMatchObject({
      config: { connectionId: "legacy-profile-as-layer-id" },
    });
  });

  it("normalizes inline and referenced tunnel chains to equivalent runtime layers", () => {
    const layers = [
      tunnelLayer("proxy-a", {
        proxy: {
          proxyType: "https",
          host: "proxy-a.test",
          port: 8443,
          username: "same-user",
          password: "same-password",
        },
      }),
      tunnelLayer("vpn-a", {
        type: "wireguard",
        proxy: undefined,
        vpn: { configId: "wg-a" },
      }),
    ];
    const snapshots = catalog({
      tunnelChains: [savedTunnelChain("tunnel-a", layers)],
    });

    const inline = resolveNetworkPath(
      connection("inline", { security: { tunnelChain: layers } }),
      snapshots,
    );
    const referenced = resolveNetworkPath(
      connection("referenced", { tunnelChainId: "tunnel-a" }),
      snapshots,
    );

    expect(comparableLayers(referenced)).toEqual(comparableLayers(inline));
    expect(
      referenced.layers.every((layer) => layer.source.kind === "tunnel-chain"),
    ).toBe(true);
    expect(
      inline.layers.every((layer) => layer.source.kind === "inline-tunnel"),
    ).toBe(true);
  });

  it("gives tunnelChainId strict precedence over inline layers", () => {
    const result = resolveNetworkPath(
      connection("target", {
        tunnelChainId: "selected",
        security: { tunnelChain: [tunnelLayer("inline")] },
      }),
      catalog({
        tunnelChains: [
          savedTunnelChain("selected", [
            tunnelLayer("referenced", {
              proxy: {
                proxyType: "http",
                host: "selected.test",
                port: 3128,
              },
            }),
          ]),
        ],
      }),
    );

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].source.kind).toBe("tunnel-chain");
    expect(result.layers[0].config).toMatchObject({ host: "selected.test" });
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "shadowed-source" }),
    );
  });

  it("composes every independent source in deterministic outermost-to-target order", () => {
    const profile = proxyProfile("proxy-profile", {
      config: proxyConfig({ type: "socks4", host: "saved.test" }),
    });
    const result = resolveNetworkPath(
      connection("target", {
        connectionChainId: "backend-chain",
        proxyChainId: "proxy-chain",
        security: {
          tunnelChain: [
            tunnelLayer("ssh", {
              type: "ssh-jump",
              proxy: undefined,
              sshTunnel: {
                host: "jump.test",
                forwardType: "local",
              },
            }),
          ],
          proxy: proxyConfig({ type: "http", host: "legacy.test", port: 80 }),
        },
      }),
      catalog(
        {
          profiles: [profile],
          chains: [
            proxyChain("proxy-chain", {
              layers: [
                {
                  position: 0,
                  type: "proxy",
                  proxyProfileId: "proxy-profile",
                },
              ],
            }),
          ],
        },
        {
          connectionChains: [
            backendChain("backend-chain", [
              backendLayer("vpn", "OpenVPN", "vpn-connection", 0),
            ]),
          ],
        },
      ),
    );

    expect(result.layers.map((layer) => layer.transport)).toEqual([
      "OpenVPN",
      "socks4",
      "ssh-jump",
      "http",
    ]);
    expect(result.layers.map((layer) => layer.source.kind)).toEqual([
      "connection-chain",
      "proxy-chain",
      "inline-tunnel",
      "legacy-proxy",
    ]);
    expect(result.summary.status).toBe("ready");
  });

  it.each([
    ["proxyChainId", "missing-proxy", "proxy-chain"],
    ["connectionChainId", "missing-connection", "connection-chain"],
    ["tunnelChainId", "missing-tunnel", "tunnel-chain"],
  ] as const)(
    "reports a missing %s without silently selecting another source",
    (field, referenceId, sourceKind) => {
      const result = resolveNetworkPath(
        connection("target", {
          [field]: referenceId,
          security: { tunnelChain: [tunnelLayer("would-be-fallback")] },
        }),
        catalog(),
      );

      expect(result.validation.valid).toBe(false);
      expect(result.validation.issues).toContainEqual(
        expect.objectContaining({
          code: "missing-reference",
          severity: "error",
          source: expect.objectContaining({ kind: sourceKind, referenceId }),
        }),
      );
      if (field === "tunnelChainId") {
        expect(result.layers).toEqual([]);
        expect(result.validation.issues).toContainEqual(
          expect.objectContaining({ code: "shadowed-source" }),
        );
      }
    },
  );

  it("detects a disabled proxy profile reference and rejects an unusable chain", () => {
    const result = resolveNetworkPath(
      connection("target", { proxyChainId: "proxy-chain" }),
      catalog({
        profiles: [
          proxyProfile("disabled-profile", {
            config: proxyConfig({ enabled: false }),
          }),
        ],
        chains: [
          proxyChain("proxy-chain", {
            layers: [
              {
                position: 0,
                type: "proxy",
                proxyProfileId: "disabled-profile",
              },
            ],
          }),
        ],
      }),
    );

    expect(result.layers).toEqual([]);
    expect(result.validation.issues.map((issue) => issue.code)).toEqual([
      "disabled-reference",
      "disabled-chain",
    ]);
    expect(result.summary.status).toBe("invalid");
  });

  it("detects tunnel chains whose layers are all disabled", () => {
    const result = resolveNetworkPath(
      connection("target", { tunnelChainId: "disabled-chain" }),
      catalog({
        tunnelChains: [
          savedTunnelChain("disabled-chain", [
            tunnelLayer("off-a", { enabled: false }),
            tunnelLayer("off-b", { enabled: false }),
          ]),
        ],
      }),
    );

    expect(result.layers).toEqual([]);
    expect(
      result.validation.issues.filter(
        (issue) => issue.code === "disabled-layer",
      ),
    ).toHaveLength(2);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "disabled-chain", severity: "error" }),
    );
  });

  it("materializes tunnel profiles with inline overrides and preserves reference parity", () => {
    const profileConfig = tunnelLayer("profile-config", {
      proxy: {
        proxyType: "socks5",
        host: "profile.test",
        port: 1080,
        username: "profile-user",
        password: "profile-password",
      },
    });
    const profile = tunnelProfile("profile-a", profileConfig);
    const referencedLayer = tunnelLayer("use-profile", {
      tunnelProfileId: "profile-a",
      proxy: { proxyType: "socks5", host: "override.test", port: 1080 },
    });
    const equivalentInline = tunnelLayer("equivalent", {
      proxy: {
        proxyType: "socks5",
        host: "override.test",
        port: 1080,
        username: "profile-user",
        password: "profile-password",
      },
    });
    const snapshots = catalog({ tunnelProfiles: [profile] });

    const fromProfile = resolveNetworkPath(
      connection("profile-user", {
        security: { tunnelChain: [referencedLayer] },
      }),
      snapshots,
    );
    const inline = resolveNetworkPath(
      connection("inline-user", {
        security: { tunnelChain: [equivalentInline] },
      }),
      snapshots,
    );

    expect(comparableLayers(fromProfile)).toEqual(comparableLayers(inline));
  });

  it("reports missing tunnel profiles", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("profile-ref", { tunnelProfileId: "missing-profile" }),
          ],
        },
      }),
      catalog(),
    );

    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "missing-reference", severity: "error" }),
    );
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "disabled-chain" }),
    );
  });

  it("detects tunnel-profile cycles", () => {
    const profileA = tunnelProfile(
      "profile-a",
      tunnelLayer("a", { tunnelProfileId: "profile-b" }),
    );
    const profileB = tunnelProfile(
      "profile-b",
      tunnelLayer("b", { tunnelProfileId: "profile-a" }),
    );
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [tunnelLayer("root", { tunnelProfileId: "profile-a" })],
        },
      }),
      catalog({ tunnelProfiles: [profileA, profileB] }),
    );

    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "cycle",
        message: expect.stringContaining("profile-a -> profile-b -> profile-a"),
      }),
    );
    expect(result.validation.valid).toBe(false);
  });

  it("resolves SSH connection references and prepends the referenced connection path", () => {
    const jump = connection("jump", {
      hostname: "jump.resolved.test",
      port: 2200,
      username: "jump-user",
      password: "jump-password",
      security: {
        proxy: proxyConfig({
          type: "http",
          host: "jump-proxy.test",
          port: 8080,
        }),
      },
    });
    const target = connection("target", {
      security: {
        tunnelChain: [
          tunnelLayer("jump-ref", {
            type: "ssh-jump",
            proxy: undefined,
            sshTunnel: { connectionId: "jump", forwardType: "local" },
          }),
        ],
      },
    });
    const result = resolveNetworkPath(
      target,
      catalog({}, { connections: [jump] }),
    );

    expect(result.layers.map((layer) => layer.transport)).toEqual([
      "http",
      "ssh-jump",
    ]);
    expect(result.layers[1]).toMatchObject({
      kind: "ssh",
      config: {
        host: "jump.resolved.test",
        port: 2200,
        username: "jump-user",
        password: "jump-password",
      },
    });
  });

  it("reports missing SSH connection references", () => {
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("missing-jump", {
              type: "ssh-jump",
              proxy: undefined,
              sshTunnel: {
                connectionId: "no-such-connection",
                forwardType: "local",
              },
            }),
          ],
        },
      }),
    );

    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "missing-reference", severity: "error" }),
    );
  });

  it("detects cycles across connection-referenced tunnel paths", () => {
    const a = connection("a", {
      security: {
        tunnelChain: [
          tunnelLayer("to-b", {
            type: "ssh-jump",
            proxy: undefined,
            sshTunnel: { connectionId: "b", forwardType: "local" },
          }),
        ],
      },
    });
    const b = connection("b", {
      security: {
        tunnelChain: [
          tunnelLayer("to-a", {
            type: "ssh-jump",
            proxy: undefined,
            sshTunnel: { connectionId: "a", forwardType: "local" },
          }),
        ],
      },
    });

    const result = resolveNetworkPath(a, catalog({}, { connections: [a, b] }));

    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "cycle",
        message: expect.stringContaining("a -> b -> a"),
      }),
    );
    expect(result.layers).toEqual([]);
  });

  it("detects cycles and missing references in proxy fallback graphs", () => {
    const a = proxyChain("a", {
      layers: [
        {
          position: 0,
          type: "proxy",
          inlineConfig: proxyConfig({ host: "a.test" }),
        },
      ],
      dynamics: { strategy: "failover", fallbackChainIds: ["b", "missing"] },
    });
    const b = proxyChain("b", {
      layers: [
        {
          position: 0,
          type: "proxy",
          inlineConfig: proxyConfig({ host: "b.test" }),
        },
      ],
      dynamics: { strategy: "failover", fallbackChainIds: ["a"] },
    });
    const result = resolveNetworkPath(
      connection("target", { proxyChainId: "a" }),
      catalog({ chains: [a, b] }),
    );

    expect(result.layers).toHaveLength(1);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "cycle" }),
    );
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({ code: "missing-reference" }),
    );
  });

  it("sorts positioned chains stably and reports duplicate positions", () => {
    const result = resolveNetworkPath(
      connection("target", {
        connectionChainId: "backend",
        proxyChainId: "saved",
      }),
      catalog(
        {
          profiles: [
            proxyProfile("p-a", { config: proxyConfig({ host: "a.test" }) }),
            proxyProfile("p-b", { config: proxyConfig({ host: "b.test" }) }),
            proxyProfile("p-c", { config: proxyConfig({ host: "c.test" }) }),
          ],
          chains: [
            proxyChain("saved", {
              layers: [
                { position: 2, type: "proxy", proxyProfileId: "p-c" },
                { position: 1, type: "proxy", proxyProfileId: "p-a" },
                { position: 1, type: "proxy", proxyProfileId: "p-b" },
              ],
            }),
          ],
        },
        {
          connectionChains: [
            backendChain("backend", [
              backendLayer("late", "WireGuard", "wg", 5),
              backendLayer("early", "OpenVPN", "ovpn", 1),
            ]),
          ],
        },
      ),
    );

    expect(result.layers.map((layer) => layer.transport)).toEqual([
      "OpenVPN",
      "WireGuard",
      "socks5",
      "socks5",
      "socks5",
    ]);
    expect(
      result.layers
        .slice(2)
        .map((layer) => (layer.kind === "proxy" ? layer.config.host : "")),
    ).toEqual(["a.test", "b.test", "c.test"]);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "duplicate-position",
        severity: "warning",
      }),
    );
  });

  it("returns UI-safe summaries and deeply redacts every secret-bearing field", () => {
    const secrets = [
      "proxy-password",
      "ssh-password",
      "private-key-material",
      "key-passphrase",
      "proxy-command-password",
      "vpn-private-key",
      "vpn-preshared-key",
      "tunnel-auth-token",
      "mesh-auth-key",
      "authorization-header",
    ];
    const result = resolveNetworkPath(
      connection("target", {
        security: {
          tunnelChain: [
            tunnelLayer("proxy", {
              proxy: {
                proxyType: "http",
                host: "proxy.test",
                port: 8080,
                password: secrets[0],
              },
            }),
            tunnelLayer("ssh", {
              type: "ssh-jump",
              proxy: undefined,
              sshTunnel: {
                host: "jump.test",
                forwardType: "local",
                password: secrets[1],
                privateKey: secrets[2],
                passphrase: secrets[3],
                proxyCommand: { proxyPassword: secrets[4] },
              },
            }),
            tunnelLayer("vpn", {
              type: "wireguard",
              proxy: undefined,
              vpn: { privateKey: secrets[5], presharedKey: secrets[6] },
            }),
            tunnelLayer("tunnel", {
              type: "ngrok",
              proxy: undefined,
              tunnel: { authToken: secrets[7] },
            }),
            tunnelLayer("mesh", {
              type: "tailscale",
              proxy: undefined,
              mesh: { authKey: secrets[8] },
            }),
          ],
          proxy: proxyConfig({
            type: "http",
            host: "legacy.test",
            customHeaders: { Authorization: secrets[9] },
          }),
        },
      }),
    );

    const uiJson = JSON.stringify({
      validation: result.validation,
      summary: result.summary,
    });
    const redactedJson = JSON.stringify(
      redactNetworkPathSecrets(result.layers),
    );
    secrets.forEach((secret) => {
      expect(uiJson).not.toContain(secret);
      expect(redactedJson).not.toContain(secret);
    });
    expect(redactedJson).toContain(NETWORK_PATH_REDACTED);
    expect(JSON.stringify(result.layers)).toContain("proxy-password");
  });

  it("does not mutate connection or catalog snapshots", () => {
    const layers = [
      tunnelLayer("first", { enabled: false }),
      tunnelLayer("second"),
    ];
    const chain = savedTunnelChain("saved", layers);
    const target = connection("target", { tunnelChainId: "saved" });
    const snapshots = catalog({ tunnelChains: [chain] });
    const before = JSON.stringify({ target, snapshots });

    resolveNetworkPath(target, snapshots);

    expect(JSON.stringify({ target, snapshots })).toBe(before);
    expect(chain.layers.map((layer) => layer.id)).toEqual(["first", "second"]);
  });
});
