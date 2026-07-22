import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssociationsTab from "../../src/components/network/proxyChainMenu/AssociationsTab";
import type { Connection } from "../../src/types/connection/connection";

const collection = vi.hoisted(() => ({
  tunnelChains: [
    {
      id: "tunnel-1",
      name: "Corporate VPN Path",
      description: "",
      layers: [
        {
          id: "vpn-layer",
          type: "openvpn",
          enabled: true,
          name: "Corporate VPN",
          vpn: { configId: "vpn-1" },
        },
      ],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ],
}));

const capabilityMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

const translate = vi.hoisted(
  () => (_key: string, fallback?: string, values?: Record<string, unknown>) => {
    let text = fallback ?? _key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.split(`{{${name}}}`).join(String(value));
    }
    return text;
  },
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getTunnelChains: vi.fn(() => collection.tunnelChains),
    getTunnelChain: vi.fn((id: string) =>
      collection.tunnelChains.find((chain) => chain.id === id),
    ),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("../../src/utils/network/vpnRuntimeCapabilities", () => ({
  loadVpnRuntimeCapabilities: capabilityMocks.load,
}));

const connection = (
  id: string,
  name: string,
  overrides: Partial<Connection> = {},
): Connection =>
  ({
    id,
    name,
    protocol: "ssh",
    hostname: `${id}.example.com`,
    port: 22,
    ...overrides,
  }) as Connection;

function manager(connections: Connection[]) {
  return {
    connectionOptions: connections,
    connectionChains: [
      { id: "connection-chain-1", name: "Jump Hosts", layers: [] },
    ],
    proxyChains: [{ id: "proxy-chain-1", name: "Office Proxy", layers: [] }],
    updateConnectionChain: vi.fn(),
    updateProxyChain: vi.fn(),
    updateTunnelChainRef: vi.fn(),
    clearTunnelChain: vi.fn(),
  } as any;
}

describe("AssociationsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilityMocks.load.mockResolvedValue([
      { vpnType: "openvpn", executable: true },
    ]);
  });
  afterEach(() => cleanup());

  it("adds a consistent title and semantic association table", () => {
    render(<AssociationsTab mgr={manager([connection("alpha", "Alpha")])} />);

    expect(
      screen.getByRole("heading", { name: "Connection Associations" }),
    ).toBeInTheDocument();
    const table = screen.getByTestId("associations-table");
    expect(table.tagName).toBe("TABLE");
    for (const header of [
      "Connection",
      "Connection Chain",
      "Proxy Chain",
      "Tunnel Chain",
      "Tunnel Path",
      "VPN execution",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  it("shows provider icons with executable and fail-closed status", async () => {
    capabilityMocks.load.mockResolvedValue([
      { vpnType: "openvpn", executable: true },
      { vpnType: "ikev2", executable: true },
      {
        vpnType: "ipsec",
        executable: false,
        reason: "Windows RAS cannot safely implement this IPsec profile.",
      },
    ]);
    render(
      <AssociationsTab
        mgr={manager([
          connection("openvpn", "OpenVPN target", {
            tunnelChainId: "tunnel-1",
          }),
          connection("ikev2", "IKEv2 target", {
            security: {
              tunnelChain: [
                {
                  id: "ike-layer",
                  name: "IKEv2 Office",
                  type: "ikev2",
                  enabled: true,
                  vpn: { configId: "ike-office" },
                },
              ],
            },
          }),
          connection("ipsec", "IPsec target", {
            security: {
              tunnelChain: [
                {
                  id: "ipsec-layer",
                  name: "IPsec Office",
                  type: "ipsec",
                  enabled: true,
                  vpn: { configId: "ipsec-office" },
                },
              ],
            },
          }),
        ])}
      />,
    );

    await waitFor(() =>
      expect(
        within(screen.getByTestId("association-row-openvpn")).getByLabelText(
          "OpenVPN: Executable",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByTestId("association-row-ikev2")).getByLabelText(
        "IKEv2: Executable",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("association-row-ipsec")).getByLabelText(
        "IPsec: Unsupported",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("association-row-ipsec")).getByTitle(
        /Windows RAS cannot safely implement this IPsec profile/i,
      ),
    ).toBeInTheDocument();
  });

  it("marks every associated provider unsupported when capability loading fails", async () => {
    capabilityMocks.load.mockRejectedValue(new Error("malformed response"));
    render(
      <AssociationsTab
        mgr={manager([
          connection("ikev2", "IKEv2 target", {
            security: {
              tunnelChain: [
                {
                  id: "ike-layer",
                  type: "ikev2",
                  enabled: true,
                  vpn: { configId: "ike-office" },
                },
              ],
            },
          }),
        ])}
      />,
    );

    await waitFor(() =>
      expect(
        within(screen.getByTestId("association-row-ikev2")).getByLabelText(
          "IKEv2: Unsupported",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("searches, filters, and sorts association rows", () => {
    const mgr = manager([
      connection("zulu", "Zulu"),
      connection("alpha", "Alpha", { proxyChainId: "proxy-chain-1" }),
      connection("bravo", "Bravo", { tunnelChainId: "tunnel-1" }),
    ]);
    render(<AssociationsTab mgr={mgr} />);

    fireEvent.change(screen.getByTestId("associations-search"), {
      target: { value: "zulu.example.com" },
    });
    expect(screen.getByTestId("association-row-zulu")).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-alpha"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("associations-search"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("associations-filter"), {
      target: { value: "configured" },
    });
    expect(screen.getByTestId("association-row-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("association-row-bravo")).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-zulu"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("associations-filter"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByTestId("associations-sort"));
    const bodyRows = within(screen.getByTestId("associations-table"))
      .getAllByRole("row")
      .slice(1);
    expect(bodyRows[0]).toHaveTextContent("Zulu");
    expect(bodyRows[2]).toHaveTextContent("Alpha");
  });

  it("searches assigned rows by the visible chain names", () => {
    const mgr = manager([
      connection("alpha", "Alpha", { proxyChainId: "proxy-chain-1" }),
      connection("bravo", "Bravo", { tunnelChainId: "tunnel-1" }),
      connection("charlie", "Charlie"),
    ]);
    render(<AssociationsTab mgr={mgr} />);

    fireEvent.change(screen.getByTestId("associations-search"), {
      target: { value: "Office Proxy" },
    });
    expect(screen.getByTestId("association-row-alpha")).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-bravo"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-charlie"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("associations-search"), {
      target: { value: "Corporate VPN Path" },
    });
    expect(screen.getByTestId("association-row-bravo")).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-alpha"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-charlie"),
    ).not.toBeInTheDocument();
  });

  it("paginates 1000+ connections and renders only the active page", () => {
    const connections = Array.from({ length: 1050 }, (_, index) => {
      const number = String(index + 1).padStart(4, "0");
      return connection(`connection-${number}`, `Connection ${number}`);
    });
    render(<AssociationsTab mgr={manager(connections)} />);

    expect(
      screen.getByTestId("association-row-connection-0001"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-connection-0051"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("associations-table")).getAllByRole("row"),
    ).toHaveLength(51);

    fireEvent.click(screen.getByTestId("associations-next-page"));
    expect(
      screen.getByTestId("association-row-connection-0051"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("association-row-connection-0001"),
    ).not.toBeInTheDocument();
  });

  it("preserves chain assignment and tunnel clear dispatch behavior", () => {
    const mgr = manager([
      connection("alpha", "Alpha", { tunnelChainId: "tunnel-1" }),
    ]);
    render(<AssociationsTab mgr={mgr} />);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Connection chain for Alpha" }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "Jump Hosts" }));
    expect(mgr.updateConnectionChain).toHaveBeenCalledWith(
      "alpha",
      "connection-chain-1",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear tunnel path for Alpha" }),
    );
    expect(mgr.updateTunnelChainRef).toHaveBeenCalledWith("alpha", "");
    expect(mgr.clearTunnelChain).toHaveBeenCalledWith("alpha");
  });
});
