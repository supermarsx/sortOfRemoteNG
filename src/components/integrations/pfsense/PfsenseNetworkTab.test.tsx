import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import PfsenseNetworkTab from "./PfsenseNetworkTab";

const IFACE = {
  name: "wan",
  if_descr: "WAN",
  if_name: "em0",
  enabled: true,
  ipaddr: "203.0.113.2",
  subnet: "24",
  ipaddrv6: "",
  subnetv6: "",
  gateway: "203.0.113.1",
  gatewayv6: "",
  mac: "",
  media: "",
  mtu: 1500,
  mss: 0,
  spoofmac: "",
  type: "static",
  descr: "WAN uplink",
  blockpriv: true,
  blockbogons: true,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "pfsense_list_interfaces":
        return Promise.resolve([IFACE]);
      case "pfsense_get_interface":
        return Promise.resolve(IFACE);
      case "pfsense_create_interface":
        return Promise.resolve(IFACE);
      case "pfsense_list_firewall_rules":
        return Promise.resolve([]);
      default:
        // list_* / apply_* etc. — harmless empty result.
        return Promise.resolve([]);
    }
  });
});

describe("PfsenseNetworkTab", () => {
  it("renders the five section tabs", async () => {
    render(<PfsenseNetworkTab connectionId="conn-1" />);
    // "Interfaces" also appears as a list heading, so scope to the tab buttons.
    expect(
      await screen.findByRole("button", { name: "Interfaces" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firewall" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "NAT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Routing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VPN" })).toBeInTheDocument();
  });

  it("auto-loads interfaces with the connection id", async () => {
    render(<PfsenseNetworkTab connectionId="conn-1" />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_list_interfaces", {
        id: "conn-1",
      }),
    );
    // The loaded row renders.
    expect(await screen.findByText("wan")).toBeInTheDocument();
  });

  it("maps row View to pfsense_get_interface with { id, name }", async () => {
    render(<PfsenseNetworkTab connectionId="conn-1" />);
    await screen.findByText("wan");
    fireEvent.click(screen.getAllByTitle("View")[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_get_interface", {
        id: "conn-1",
        name: "wan",
      }),
    );
  });

  it("maps Add → Save to pfsense_create_interface with { id, iface }", async () => {
    render(<PfsenseNetworkTab connectionId="conn-1" />);
    await screen.findByText("wan");
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "pfsense_create_interface",
        expect.objectContaining({
          id: "conn-1",
          iface: expect.objectContaining({ name: expect.any(String) }),
        }),
      ),
    );
  });

  it("loads firewall rules when the Firewall section is opened", async () => {
    render(<PfsenseNetworkTab connectionId="conn-1" />);
    await screen.findByText("wan");
    fireEvent.click(screen.getByText("Firewall"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_list_firewall_rules", {
        id: "conn-1",
      }),
    );
  });
});
