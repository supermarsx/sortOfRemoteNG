import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TunnelChainLayer } from "../../../types/connection/connection";
import type { VpnProfileCatalogSnapshot } from "../../../utils/network/vpnProviderCatalog";
import { LayerConfigForm, VpnLayerConfig } from "./tunnelChainShared";
import {
  TUNNEL_TYPE_OPTIONS,
  getProfileConfigSummary,
} from "./tunnelChainShared.helpers";

const createdAt = new Date("2026-07-19T00:00:00.000Z");

function catalog(
  status: "loaded" | "error" = "loaded",
): VpnProfileCatalogSnapshot {
  return {
    profiles: [
      {
        id: "tailscale-office",
        name: "Office Tailnet",
        vpnType: "tailscale",
        status: "disconnected",
        createdAt,
      },
      {
        id: "wireguard-office",
        name: "Office WireGuard",
        vpnType: "wireguard",
        status: "connected",
        createdAt,
      },
    ],
    providerStatus: { tailscale: status },
  };
}

describe("saved tunnel VPN profile selector", () => {
  it("lists only the layer provider and migrates a legacy mesh reference", () => {
    const onUpdate = vi.fn();
    const layer: TunnelChainLayer = {
      id: "independent-layer-id",
      type: "tailscale",
      enabled: true,
      mesh: { networkId: "legacy-tailnet", authKey: "legacy-secret" },
    };

    render(
      <VpnLayerConfig
        layer={layer}
        onUpdate={onUpdate}
        vpnProfileCatalog={catalog()}
      />,
    );

    const selector = screen.getByRole("combobox");
    expect(selector).toHaveValue("legacy-tailnet");
    expect(screen.getByText(/Unavailable profile/)).toBeInTheDocument();
    expect(screen.getByText(/Office Tailnet/)).toBeInTheDocument();
    expect(screen.queryByText(/Office WireGuard/)).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "tailscale-office" } });
    expect(onUpdate).toHaveBeenCalledWith({
      vpn: { configId: "tailscale-office", configFile: undefined },
      mesh: {
        networkId: undefined,
        authKey: undefined,
      },
    });
  });

  it("keeps a provider-load failure unverified instead of calling it deleted", () => {
    render(
      <VpnLayerConfig
        layer={{
          id: "independent-layer-id",
          type: "tailscale",
          enabled: true,
          vpn: { configId: "saved-tailnet" },
        }}
        onUpdate={vi.fn()}
        vpnProfileCatalog={catalog("error")}
      />,
    );

    expect(screen.getByText(/Unverified profile/)).toBeInTheDocument();
    expect(screen.getByText(/not classified as deleted/)).toBeInTheDocument();
  });

  it.each(["pptp", "l2tp", "ikev2", "ipsec", "sstp"] as const)(
    "routes the %s layer through the saved-profile selector",
    (vpnType) => {
      render(
        <LayerConfigForm
          layer={{
            id: `${vpnType}-layer`,
            type: vpnType,
            enabled: true,
            vpn: { configId: "" },
          }}
          onUpdate={vi.fn()}
          vpnProfileCatalog={{
            profiles: [
              {
                id: `${vpnType}-office`,
                name: `${vpnType} Office`,
                vpnType,
                status: "disconnected",
                createdAt,
              },
            ],
            providerStatus: { [vpnType]: "loaded" },
          }}
        />,
      );

      expect(screen.getByRole("combobox")).toHaveTextContent(
        `${vpnType} Office`,
      );
    },
  );

  it("disables and explains profile- and platform-unsupported choices", () => {
    const profileReason = "The profile requires a stored certificate.";
    const platformReason =
      "Windows RAS cannot safely implement this IPsec profile.";
    const { rerender } = render(
      <VpnLayerConfig
        layer={{
          id: "ike-layer",
          type: "ikev2",
          enabled: true,
          vpn: { configId: "ike-office" },
        }}
        onUpdate={vi.fn()}
        vpnProfileCatalog={{
          profiles: [
            {
              id: "ike-office",
              name: "IKE Office",
              vpnType: "ikev2",
              status: "disconnected",
              createdAt,
              connectDisabledReason: profileReason,
            },
          ],
          providerStatus: { ikev2: "loaded" },
        }}
      />,
    );

    expect(screen.getByRole("option", { name: /IKE Office/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(profileReason);

    rerender(
      <VpnLayerConfig
        layer={{
          id: "ipsec-layer",
          type: "ipsec",
          enabled: true,
          vpn: { configId: "ipsec-office" },
        }}
        onUpdate={vi.fn()}
        vpnProfileCatalog={{
          profiles: [
            {
              id: "ipsec-office",
              name: "IPsec Office",
              vpnType: "ipsec",
              status: "disconnected",
              createdAt,
            },
          ],
          providerStatus: { ipsec: "unsupported" },
          providerErrors: { ipsec: platformReason },
        }}
      />,
    );

    expect(screen.getByRole("option", { name: /IPsec Office/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(platformReason);
  });

  it("uses catalog icons and canonical profile summaries for legacy VPN layers", () => {
    const legacyTypes = ["pptp", "l2tp", "ikev2", "ipsec", "sstp"] as const;

    for (const vpnType of legacyTypes) {
      const option = TUNNEL_TYPE_OPTIONS.find(
        (candidate) => candidate.value === vpnType,
      );
      expect(option?.category).toBe("VPN");
      expect(React.isValidElement(option?.icon)).toBe(true);
      expect(
        getProfileConfigSummary({
          id: `${vpnType}-layer`,
          type: vpnType,
          enabled: true,
          vpn: { configId: `${vpnType}-profile` },
        }),
      ).toBe(`${vpnType}-profile`);
    }
  });
});
