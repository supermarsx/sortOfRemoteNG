import { describe, expect, it, vi } from "vitest";
import type { TunnelChainLayer } from "../../src/types/connection/connection";
import {
  EXECUTABLE_VPN_PROVIDERS,
  VPN_PROVIDER_CATALOG,
  isExecutableVpnType,
  normalizeExecutableVpnType,
  resolveTunnelLayerVpnProfileId,
  withTunnelLayerVpnProfileId,
} from "../../src/utils/network/vpnProviderCatalog";
import { loadVpnProfileCatalog } from "../../src/utils/network/vpnProfiles";

describe("VPN provider capability catalog", () => {
  it("advertises exactly the providers with persisted session runtime support", () => {
    expect(EXECUTABLE_VPN_PROVIDERS.map((provider) => provider.type)).toEqual([
      "openvpn",
      "wireguard",
      "tailscale",
      "zerotier",
    ]);
    expect(
      VPN_PROVIDER_CATALOG.filter((provider) => !provider.executable).map(
        (provider) => provider.type,
      ),
    ).toEqual(["pptp", "l2tp", "ikev2", "ipsec", "sstp", "softether"]);
    expect(isExecutableVpnType("pptp")).toBe(false);
    expect(normalizeExecutableVpnType(" ZeroTier ")).toBe("zerotier");
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
    const snapshot = await loadVpnProfileCatalog({
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
    });

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
    });
    expect(snapshot.providerErrors?.wireguard).toBe(
      "profile store unavailable",
    );
  });
});
