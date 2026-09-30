import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Connection } from "../../../types/connection/connection";
import type { NormalizedVpnConnection } from "../../../hooks/network/useVpnManager";
import type { NetworkPathCatalog } from "../../../utils/network/resolveNetworkPath";
import { NetworkPathSectionView } from "./NetworkPathSection";
import { createDefaultRawSocketSettings } from "../../../types/protocols/rawSocket";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../../contexts/ConnectionContextTypes";
import {
  INLINE_SSH_LAYER_ID,
  setInlineSsh,
  setNetworkPathReference,
  resetNetworkPath,
  getRuntimeNetworkPathProtocol,
  getNetworkPathEditorModel,
} from "./networkPathModel";

const directCatalog: NetworkPathCatalog = {
  connections: [],
  connectionChains: [],
  proxyCollection: {
    profiles: [
      {
        id: "proxy-one",
        name: "Office proxy",
        config: {
          type: "socks5",
          enabled: true,
          host: "proxy.test",
          port: 1080,
          password: "saved-proxy-secret",
        },
        createdAt: "",
        updatedAt: "",
      },
    ],
    tunnelProfiles: [
      {
        id: "tunnel-one",
        name: "Office bastion",
        type: "ssh-jump",
        config: {
          id: "saved-hop",
          type: "ssh-jump",
          enabled: true,
          sshTunnel: {
            forwardType: "local",
            host: "bastion.test",
            port: 22,
            username: "operator",
            password: "saved-tunnel-secret",
          },
        },
        createdAt: "",
        updatedAt: "",
      },
    ],
    chains: [
      {
        id: "chain-one",
        name: "Chain alternative",
        layers: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
    tunnelChains: [
      {
        id: "tunnel-chain-one",
        name: "Tunnel alternative",
        layers: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
  },
};
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

describe("direct network-path sources", () => {
  it("searches saved profiles, stores identities, replaces chains, and clears/reset references", () => {
    render(
      <Harness
        initial={{
          protocol: "ssh",
          proxyChainId: "chain-one",
          tunnelChainId: "tunnel-chain-one",
        }}
        catalog={directCatalog}
      />,
    );
    fireEvent.click(screen.getByLabelText("Saved proxy"));
    fireEvent.change(
      screen.getByPlaceholderText("Search saved proxy profiles…"),
      { target: { value: "office" } },
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "Office proxy" }));
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"proxyProfileId":"proxy-one"',
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      '"proxyChainId"',
    );
    choose("Saved tunnel", "Office bastion");
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"tunnelProfileId":"tunnel-one"',
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      '"tunnelChainId"',
    );
    expect(
      screen.getByRole("list", { name: "Resolved network path layers" }),
    ).toHaveTextContent(/Saved proxy.*Saved tunnel/s);
    expect(document.body.textContent).not.toMatch(
      /saved-proxy-secret|saved-tunnel-secret/,
    );
    choose("Proxy chain", "Chain alternative (0 layers)");
    choose("Tunnel chain", "Tunnel alternative (0 layers)");
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      '"proxyProfileId"',
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      '"tunnelProfileId"',
    );
    choose("Saved proxy", "Office proxy");
    fireEvent.click(screen.getByRole("button", { name: "Clear Saved proxy" }));
    expect(screen.getByLabelText("Saved proxy")).toHaveTextContent("None");
    choose("Saved tunnel", "Office bastion");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset all network path settings" }),
    );
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent("{}");
  });

  it("keeps orphan profiles visible and individually clearable", () => {
    render(
      <Harness
        initial={{
          protocol: "ssh",
          proxyProfileId: "missing-proxy",
          tunnelProfileId: "missing-tunnel",
        }}
      />,
    );
    expect(screen.getByLabelText("Saved proxy")).toHaveTextContent(
      "Unavailable proxy profile",
    );
    expect(screen.getByLabelText("Saved tunnel")).toHaveTextContent(
      "Unavailable tunnel profile",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Saved tunnel" }));
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      "missing-proxy",
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      "missing-tunnel",
    );
  });

  it("edits standalone SSH password/key fields and removes only its own layer", () => {
    render(
      <Harness
        initial={{
          protocol: "ssh",
          security: {
            tunnelChain: [
              {
                id: "vpn",
                type: "wireguard",
                enabled: true,
                vpn: { configId: "keep-vpn" },
              },
            ],
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add SSH hop" }));
    fireEvent.change(screen.getByLabelText("SSH host"), {
      target: { value: "jump.test" },
    });
    fireEvent.change(screen.getByLabelText("SSH username"), {
      target: { value: "operator" },
    });
    fireEvent.change(screen.getByLabelText("SSH password"), {
      target: { value: "private-secret" },
    });
    expect(screen.getByLabelText("SSH password")).toHaveAttribute(
      "type",
      "password",
    );
    choose("SSH authentication", "Private key file");
    fireEvent.change(screen.getByLabelText("SSH key file"), {
      target: { value: "C:/keys/jump" },
    });
    expect(screen.queryByLabelText("SSH password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Key passphrase")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"authMethod":"key"',
    );
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent("keep-vpn");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove per-connection SSH" }),
    );
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      INLINE_SSH_LAYER_ID,
    );
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent("keep-vpn");
  });

  it("links an existing SSH identity without copying credentials and explains vault requirements", () => {
    const linked = {
      id: "linked",
      name: "Vault bastion",
      protocol: "ssh",
      hostname: "bastion.test",
      port: 22,
      isGroup: false,
      createdAt: "",
      updatedAt: "",
      authType: "password",
      credentialSource: {
        kind: "vault",
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    } as Connection;
    const catalog = { ...EMPTY_CATALOG, connections: [linked] };
    const context = {
      state: { connections: [linked] },
      databaseAvailability: {
        status: "ready",
        databaseId: "owner-db",
        generation: 1,
      },
    } as unknown as ConnectionContextType;
    render(
      <ConnectionContext.Provider value={context}>
        <Harness initial={{ protocol: "ssh" }} catalog={catalog} />
      </ConnectionContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add SSH hop" }));
    fireEvent.change(screen.getByLabelText("SSH password"), {
      target: { value: "discard-inline-secret" },
    });
    choose("SSH source", "Saved SSH connection");
    choose("Saved SSH connection", /Vault bastion/);
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"sshConnectionId":"linked"',
    );
    expect(screen.getByTestId("safe-form-state")).toHaveTextContent(
      '"ownerDatabaseId":"owner-db"',
    );
    expect(screen.queryByLabelText("SSH password")).not.toBeInTheDocument();
    expect(screen.getByText("Needs owning vault")).toBeInTheDocument();
    expect(
      screen.getByText(/availability has not been verified/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("discard-inline-secret");
  });

  it.each(["http", "https"] as const)(
    "checks %s as HTTP and blocks an unsupported SSH route",
    (protocol) => {
      expect(getRuntimeNetworkPathProtocol({ protocol })).toBe("http");
      render(
        <Harness
          initial={{ protocol, tunnelProfileId: "tunnel-one" }}
          catalog={directCatalog}
        />,
      );
      expect(screen.getByText("Connect blocked")).toBeInTheDocument();
      expect(screen.queryByText("Runtime supported")).not.toBeInTheDocument();
      expect(screen.getByText("HTTP support")).toBeInTheDocument();
    },
  );

  it("preserves unrelated inline layers/security and never copies saved profile configuration", () => {
    const initial: Partial<Connection> = {
      protocol: "ssh",
      tunnelProfileId: "old",
      security: {
        encryptionAlgorithm: "aes256",
        tunnelChain: [
          { id: "vpn", type: "wireguard", enabled: true },
          { id: "unrelated", type: "ssh-jump", enabled: false },
        ],
      },
    };
    const added = setInlineSsh(initial, {
      forwardType: "local",
      host: "jump.test",
      username: "operator",
      password: "secret",
    });
    expect(added.tunnelProfileId).toBeUndefined();
    expect(added.security?.tunnelChain?.slice(0, 2)).toEqual(
      initial.security?.tunnelChain,
    );
    expect(setInlineSsh(added).security).toEqual(initial.security);
    const saved = setNetworkPathReference(
      added,
      "tunnelProfileId",
      "tunnel-one",
    );
    expect(saved.security?.tunnelChain).toBeUndefined();
    expect(saved.security?.encryptionAlgorithm).toBe("aes256");
    expect(JSON.stringify(saved)).not.toContain("secret");
    expect(resetNetworkPath(saved).tunnelProfileId).toBeUndefined();
    expect(
      getNetworkPathEditorModel(
        { protocol: "http", tunnelProfileId: "tunnel-one" },
        directCatalog,
        "http",
      ).runtime.supported,
    ).toBe(false);
  });
});

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
          proxyProfileId: formData.proxyProfileId,
          tunnelProfileId: formData.tunnelProfileId,
          tunnelChainId: formData.tunnelChainId,
          inline: formData.security?.tunnelChain?.map((layer) => ({
            id: layer.id,
            type: layer.type,
            profileId: layer.vpn?.configId,
            sshConnectionId: layer.sshTunnel?.connectionId,
            ownerDatabaseId: layer.sshTunnel?.ownerDatabaseId,
            authMethod: layer.sshTunnel?.authMethod,
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
      vpnProfiles: {
        profiles: [vpn],
        providerStatus: { openvpn: "loaded", wireguard: "loaded" },
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
      '"inline":[{"id":"inline-vpn","type":"wireguard","profileId":"vpn-stable-id"}]',
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
                id: "imported-layer-id",
                name: "Production WireGuard",
                type: "wireguard",
                enabled: true,
                vpn: { configId: "vpn-stable-id" },
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

  it("classifies a VPN reference as deleted only after its provider loads", () => {
    const initial: Partial<Connection> = {
      id: "ssh-vpn-orphan",
      protocol: "ssh",
      security: {
        tunnelChain: [
          {
            id: "independent-layer-id",
            type: "wireguard",
            enabled: true,
            vpn: { configId: "deleted-profile-id" },
          },
        ],
      },
    };

    const loading = render(<Harness initial={initial} />);
    expect(screen.getByLabelText("Inline VPN")).toHaveTextContent(
      /Checking VPN connection/i,
    );
    loading.unmount();

    const failedCatalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      vpnProfiles: {
        profiles: [],
        providerStatus: { wireguard: "error" },
      },
    };
    const failed = render(
      <Harness initial={initial} catalog={failedCatalog} />,
    );
    expect(screen.getByLabelText("Inline VPN")).toHaveTextContent(
      /Unverified VPN connection/i,
    );
    expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
    failed.unmount();

    const loadedCatalog: NetworkPathCatalog = {
      ...EMPTY_CATALOG,
      vpnProfiles: {
        profiles: [],
        providerStatus: { wireguard: "loaded" },
      },
    };
    render(<Harness initial={initial} catalog={loadedCatalog} />);
    expect(screen.getByLabelText("Inline VPN")).toHaveTextContent(
      /Unavailable VPN connection/i,
    );
    expect(screen.getAllByText(/no longer exists/i)).toHaveLength(2);
  });

  it("shows unsupported VPN profiles without allowing a new association", () => {
    const unsupported: NormalizedVpnConnection = {
      id: "legacy-pptp",
      name: "Legacy PPTP",
      vpnType: "pptp",
      status: "disconnected",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      connectDisabledReason: "Encrypted persistent profiles are unavailable.",
    };
    render(
      <Harness
        initial={{ id: "ssh", protocol: "ssh" }}
        vpnConnections={[unsupported]}
      />,
    );

    fireEvent.click(screen.getByTestId("network-path-inline-vpn"));
    const option = screen.getByRole("option", {
      name: /Legacy PPTP.*unsupported/i,
    });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveAttribute(
      "title",
      "Encrypted persistent profiles are unavailable.",
    );
    fireEvent.mouseDown(option);
    expect(screen.getByTestId("safe-form-state")).not.toHaveTextContent(
      "legacy-pptp",
    );
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
