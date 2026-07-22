import { describe, expect, it, vi } from "vitest";
import type { TunnelChainLayer } from "../../src/types/connection/connection";
import {
  EXECUTABLE_VPN_PROVIDERS,
  SESSION_VPN_PROVIDERS,
  VPN_PROVIDER_CATALOG,
  isExecutableVpnType,
  normalizeExecutableVpnType,
  normalizeSessionVpnType,
  resolveTunnelLayerVpnProfileId,
  withTunnelLayerVpnProfileId,
} from "../../src/utils/network/vpnProviderCatalog";
import { loadVpnProfileCatalog } from "../../src/utils/network/vpnProfiles";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";

describe("VPN provider capability catalog", () => {
  it("advertises exactly the providers with persisted session runtime support", () => {
    expect(EXECUTABLE_VPN_PROVIDERS.map((provider) => provider.type)).toEqual([
      "openvpn",
      "wireguard",
      "tailscale",
      "zerotier",
      "pptp",
      "l2tp",
      "ikev2",
      "ipsec",
      "sstp",
    ]);
    expect(
      VPN_PROVIDER_CATALOG.filter((provider) => !provider.executable).map(
        (provider) => provider.type,
      ),
    ).toEqual(["softether"]);
    expect(isExecutableVpnType("pptp")).toBe(true);
    expect(isExecutableVpnType("softether")).toBe(false);
    expect(normalizeSessionVpnType(" PPTP ")).toBe("pptp");
    expect(SESSION_VPN_PROVIDERS.map((provider) => provider.type)).toEqual([
      "openvpn",
      "wireguard",
      "tailscale",
      "zerotier",
      "pptp",
      "l2tp",
      "ikev2",
      "ipsec",
      "sstp",
    ]);
    expect(normalizeExecutableVpnType(" ZeroTier ")).toBe("zerotier");
    expect(
      VPN_PROVIDER_CATALOG.every((provider) =>
        Boolean(getConnectionIconDefinition(provider.iconKey)),
      ),
    ).toBe(true);
  });

  it("keeps a layer identity distinct from its canonical VPN profile ID", () => {
    const importedLayer = {
      id: "imported-layer-17",
      type: "wireguard",
      enabled: true,
      vpn: { configId: "persisted-profile-42" },
    } satisfies TunnelChainLayer;

    expect(resolveTunnelLayerVpnProfileId(importedLayer)).toBe(
      "persisted-profile-42",
    );
    expect(
      withTunnelLayerVpnProfileId(importedLayer, "remapped-profile-99"),
    ).toMatchObject({
      id: "imported-layer-17",
      vpn: { configId: "remapped-profile-99" },
    });
  });

  it("migrates mesh and layer-id legacy references only when configId is absent", () => {
    expect(
      resolveTunnelLayerVpnProfileId({
        id: "layer-id",
        type: "zerotier",
        mesh: { networkId: "legacy-mesh-profile" },
      }),
    ).toBe("legacy-mesh-profile");
    expect(
      resolveTunnelLayerVpnProfileId({
        id: "legacy-profile-as-layer-id",
        type: "openvpn",
      }),
    ).toBe("legacy-profile-as-layer-id");
    expect(
      resolveTunnelLayerVpnProfileId({
        id: "not-a-vpn-profile",
        type: "ssh-jump",
      }),
    ).toBeUndefined();
  });

  it("lets an explicit empty canonical reference suppress legacy fallbacks", () => {
    expect(
      resolveTunnelLayerVpnProfileId({
        id: "legacy-profile-as-layer-id",
        type: "tailscale",
        vpn: { configId: "" },
        mesh: { networkId: "legacy-mesh-profile" },
      }),
    ).toBeUndefined();
  });

  it("records provider load failures separately from an empty loaded provider", async () => {
    const snapshot = await loadVpnProfileCatalog(
      {
        listOpenVPNConnections: vi.fn(async () => [
          {
            id: "ovpn-1",
            name: "Office",
            config: { enabled: true, remoteHost: "vpn.example.test" },
            status: "disconnected" as const,
            createdAt: new Date("2026-07-19T00:00:00.000Z"),
          },
        ]),
        listWireGuardConnections: vi.fn(async () => {
          throw new Error("profile store unavailable");
        }),
        listTailscaleConnections: vi.fn(async () => []),
        listZeroTierConnections: vi.fn(async () => []),
        listPPTPConnections: vi.fn(async () => []),
        listL2TPConnections: vi.fn(async () => []),
        listIKEv2Connections: vi.fn(async () => []),
        listIPsecConnections: vi.fn(async () => []),
        listSSTPConnections: vi.fn(async () => []),
      },
      async () =>
        VPN_PROVIDER_CATALOG.map((provider) => ({
          vpnType: provider.type,
          executable: provider.executable,
          ...(!provider.executable
            ? { reason: "Provider is not association-ready." }
            : {}),
        })),
    );

    expect(snapshot.profiles).toEqual([
      expect.objectContaining({
        id: "ovpn-1",
        vpnType: "openvpn",
        host: "vpn.example.test",
      }),
    ]);
    expect(snapshot.providerStatus).toEqual({
      openvpn: "loaded",
      wireguard: "error",
      tailscale: "loaded",
      zerotier: "loaded",
      pptp: "loaded",
      l2tp: "loaded",
      ikev2: "loaded",
      ipsec: "loaded",
      sstp: "loaded",
    });
    expect(snapshot.providerErrors?.wireguard).toBe(
      "profile store unavailable",
    );
  });

  it("normalizes profile-owned IKEv2 split routing without target-specific routes", async () => {
    const empty = vi.fn(async () => []);
    const snapshot = await loadVpnProfileCatalog(
      {
        listOpenVPNConnections: empty,
        listWireGuardConnections: empty,
        listTailscaleConnections: empty,
        listZeroTierConnections: empty,
        listPPTPConnections: empty,
        listL2TPConnections: empty,
        listIKEv2Connections: vi.fn(async () => [
          {
            id: "ike-office",
            name: "IKE Office",
            config: {
              enabled: true,
              server: "gateway.example.test",
              username: "operator",
              routingMode: "split",
              remoteSubnets: ["10.20.0.0/16", "2001:db8:42::/48"],
            },
            status: "disconnected" as const,
            createdAt: new Date("2026-07-21T00:00:00.000Z"),
          } as any,
        ]),
        listIPsecConnections: empty,
        listSSTPConnections: empty,
      },
      async () =>
        VPN_PROVIDER_CATALOG.map((provider) => ({
          vpnType: provider.type,
          executable: provider.executable,
          ...(!provider.executable
            ? { reason: "Encrypted persistent profiles are unavailable." }
            : {}),
        })),
    );

    expect(snapshot.profiles).toContainEqual(
      expect.objectContaining({
        id: "ike-office",
        vpnType: "ikev2",
        host: "gateway.example.test",
        routing: {
          mode: "split",
          remoteSubnets: ["10.20.0.0/16", "2001:db8:42::/48"],
        },
      }),
    );
    expect(snapshot.providerStatus.ikev2).toBe("loaded");
  });

  it("keeps platform capability authoritative over product eligibility", async () => {
    const empty = vi.fn(async () => []);
    const snapshot = await loadVpnProfileCatalog(
      {
        listOpenVPNConnections: empty,
        listWireGuardConnections: empty,
        listTailscaleConnections: empty,
        listZeroTierConnections: empty,
        listPPTPConnections: empty,
        listL2TPConnections: empty,
        listIKEv2Connections: empty,
        listIPsecConnections: vi.fn(async () => [
          {
            id: "ipsec-office",
            name: "IPsec Office",
            config: { enabled: true, server: "gateway.example.test" },
            status: "disconnected" as const,
            createdAt: new Date("2026-07-21T00:00:00.000Z"),
          } as any,
        ]),
        listSSTPConnections: empty,
      },
      async () =>
        VPN_PROVIDER_CATALOG.map((provider) => ({
          vpnType: provider.type,
          executable: provider.type !== "ipsec" && provider.executable,
          ...(provider.type === "ipsec"
            ? { reason: "Windows cannot safely execute this IPsec profile." }
            : {}),
        })),
    );

    expect(snapshot.providerStatus.ipsec).toBe("unsupported");
    expect(snapshot.profiles).toContainEqual(
      expect.objectContaining({
        id: "ipsec-office",
        vpnType: "ipsec",
        connectDisabledReason:
          "Windows cannot safely execute this IPsec profile.",
      }),
    );
  });
});
