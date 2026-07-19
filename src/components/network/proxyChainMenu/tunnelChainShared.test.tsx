import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TunnelChainLayer } from "../../../types/connection/connection";
import type { VpnProfileCatalogSnapshot } from "../../../utils/network/vpnProviderCatalog";
import { VpnLayerConfig } from "./tunnelChainShared";

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
});
