import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Connection } from "../../../types/connection/connection";
import type { NormalizedVpnConnection } from "../../../hooks/network/useVpnManager";
import type { NetworkPathCatalog } from "../../../utils/network/resolveNetworkPath";
import { NetworkPathSectionView } from "./NetworkPathSection";
import { createDefaultRawSocketSettings } from "../../../types/protocols/rawSocket";

const EMPTY_CATALOG: NetworkPathCatalog = {
  connections: [],
  connectionChains: [],
  proxyCollection: {
    profiles: [],
    chains: [],
    tunnelChains: [],
    tunnelProfiles: [],
  },
};

const vpn: NormalizedVpnConnection = {
  id: "vpn-stable-id",
  name: "Production WireGuard",
  vpnType: "wireguard",
  status: "connected",
  createdAt: new Date("2026-07-15T00:00:00.000Z"),
};

const Harness: React.FC<{
  initial: Partial<Connection>;
  catalog?: NetworkPathCatalog;
  vpnConnections?: readonly NormalizedVpnConnection[];
}> = ({ initial, catalog = EMPTY_CATALOG, vpnConnections = [] }) => {
  const [formData, setFormData] = useState(initial);
  return (
    <>
      <NetworkPathSectionView
        formData={formData}
        setFormData={setFormData}
        catalog={catalog}
        vpnConnections={vpnConnections}
      />
      <output data-testid="safe-form-state">
        {JSON.stringify({
          connectionChainId: formData.connectionChainId,
          proxyChainId: formData.proxyChainId,
          tunnelChainId: formData.tunnelChainId,
          inline: formData.security?.tunnelChain?.map((layer) => ({
            id: layer.id,
            type: layer.type,
          })),
        })}
      </output>
    </>
  );
};

describe("NetworkPathSectionView", () => {
  it("searches saved selectors and previews the canonical source order", () => {
    const catalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      proxyCollection: {
        ...EMPTY_CATALOG.proxyCollection!,
        chains: [
          {
            id: "production-proxy",
            name: "Production proxy route",
            createdAt: "",
            updatedAt: "",
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
    render(
      <Harness initial={{ id: "ssh", protocol: "ssh" }} catalog={catalog} />,
    );

    fireEvent.click(screen.getByTestId("network-path-proxy-chain"));
    fireEvent.change(screen.getByPlaceholderText("Search proxy chains…"), {
      target: { value: "production" },
    });
    fireEvent.mouseDown(
      screen.getByRole("option", { name: /Production proxy route/i }),
    );

    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"proxyChainId":"production-proxy"',
    );
    expect(
      screen.getByRole("list", { name: "Resolved network path layers" }),
    ).toHaveTextContent(/socks5.*Proxy chain/i);
    expect(screen.getByText("Runtime supported")).toBeInTheDocument();
  });

  it("replaces saved tunnel and inline VPN sources without duplicate controls", () => {
    const catalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      proxyCollection: {
        ...EMPTY_CATALOG.proxyCollection!,
        tunnelChains: [
          {
            id: "saved-tunnel",
            name: "Saved tunnel",
            createdAt: "",
            updatedAt: "",
            layers: [{ id: "old", type: "openvpn", enabled: true }],
          },
        ],
      },
    };
    const firstRender = render(
      <Harness
        initial={{
          id: "ssh",
          protocol: "ssh",
          tunnelChainId: "saved-tunnel",
        }}
        catalog={catalog}
        vpnConnections={[vpn]}
      />,
    );

    fireEvent.click(screen.getByTestId("network-path-inline-vpn"));
    fireEvent.change(screen.getByPlaceholderText("Search VPN connections…"), {
      target: { value: "wireguard" },
    });
    fireEvent.mouseDown(
      screen.getByRole("option", { name: /Production WireGuard/i }),
    );

    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"inline":[{"id":"vpn-stable-id","type":"wireguard"}]',
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      '"tunnelChainId":"saved-tunnel"',
    );
    expect(screen.getAllByLabelText("Inline VPN")).toHaveLength(1);

    firstRender.unmount();
    render(
      <Harness
        initial={{
          id: "ssh-reopened",
          protocol: "ssh",
          security: {
            tunnelChain: [
              {
                id: "vpn-stable-id",
                name: "Production WireGuard",
                type: "wireguard",
                enabled: true,
              },
            ],
          },
        }}
        vpnConnections={[vpn]}
      />,
    );
    expect(screen.getByLabelText("Inline VPN")).toHaveTextContent(
      /Production WireGuard/i,
    );
  });

  it("keeps orphan IDs visible and lets users clear them", () => {
    render(
      <Harness
        initial={{
          id: "ssh",
          protocol: "ssh",
          proxyChainId: "deleted-proxy-chain",
        }}
      />,
    );

    expect(screen.getByLabelText("Proxy chain")).toHaveTextContent(
      /Unavailable proxy chain/i,
    );
    expect(
      screen.getAllByText(/does not exist in the supplied collection/i),
    ).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Clear Proxy chain" }));
    expect(screen.getByLabelText("Proxy chain")).toHaveTextContent("None");
  });

  it("shows RDP fail-closed support without exposing proxy secrets", () => {
    const { container } = render(
      <Harness
        initial={{
          id: "rdp",
          protocol: "rdp",
          security: {
            proxy: {
              type: "socks5",
              host: "private.proxy.test",
              port: 1080,
              username: "private-user",
              password: "top-secret-password",
              enabled: true,
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Connect blocked")).toBeInTheDocument();
    expect(
      screen.getByText(/RDP requires a final SSH bastion/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/VPN prefix.*final hop is an SSH bastion/i),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("top-secret-password");
    expect(container.textContent).not.toContain("private.proxy.test");
    expect(container.textContent).not.toContain("private-user");
  });

  it("renders explicit Raw TCP and UDP capability summaries", () => {
    const first = render(
      <Harness
        initial={{
          id: "raw-tcp",
          protocol: "raw",
          rawSocketSettings: createDefaultRawSocketSettings("tcp"),
        }}
      />,
    );
    expect(
      screen.getByText(
        /Direct Raw TCP is supported by the native socket runtime/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Raw TCP support")).toBeInTheDocument();

    first.unmount();
    render(
      <Harness
        initial={{
          id: "raw-udp",
          protocol: "raw",
          rawSocketSettings: createDefaultRawSocketSettings("udp"),
        }}
      />,
    );
    expect(
      screen.getByText(
        /Direct Raw UDP is supported by the native socket runtime/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Raw UDP support")).toBeInTheDocument();
  });

  it("shows RLogin direct support and blocks a configured proxy visibly", () => {
    render(
      <Harness
        initial={{
          id: "rlogin",
          protocol: "rlogin",
          port: 513,
          security: {
            proxy: {
              type: "socks5",
              host: "proxy.example.test",
              port: 1080,
              enabled: true,
            },
          },
        }}
      />,
    );

    expect(screen.getAllByText("Connect blocked").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/RLogin runtime supports direct TCP only/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("RLogin support")).toBeInTheDocument();
  });

  it("marks configured PowerShell routes unavailable until an adapter exists", () => {
    render(
      <Harness
        initial={{
          id: "powershell",
          protocol: "winrm",
          security: {
            proxy: {
              type: "http",
              host: "proxy.example.test",
              port: 8080,
              enabled: true,
            },
          },
        }}
      />,
    );

    expect(screen.getAllByText("Connect blocked").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/backend exposes a network-path adapter/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("PowerShell Remoting support")).toBeInTheDocument();
  });

  it("renders disabled and cycle diagnostics from the canonical resolver", () => {
    const catalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      proxyCollection: {
        ...EMPTY_CATALOG.proxyCollection!,
        tunnelProfiles: [
          {
            id: "profile-a",
            name: "A",
            type: "proxy",
            createdAt: "",
            updatedAt: "",
            config: {
              id: "a",
              type: "proxy",
              enabled: true,
              tunnelProfileId: "profile-b",
            },
          },
          {
            id: "profile-b",
            name: "B",
            type: "proxy",
            createdAt: "",
            updatedAt: "",
            config: {
              id: "b",
              type: "proxy",
              enabled: true,
              tunnelProfileId: "profile-a",
            },
          },
        ],
      },
    };
    render(
      <Harness
        initial={{
          id: "ssh",
          protocol: "ssh",
          security: {
            tunnelChain: [
              {
                id: "disabled",
                type: "openvpn",
                enabled: false,
              },
              {
                id: "cycle",
                type: "proxy",
                enabled: true,
                tunnelProfileId: "profile-a",
              },
            ],
          },
        }}
        catalog={catalog}
      />,
    );

    expect(
      screen.getByText(/Disabled openvpn layer was omitted/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Tunnel-profile cycle detected/i),
    ).not.toHaveLength(0);
  });
});
