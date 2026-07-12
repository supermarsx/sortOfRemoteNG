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

import PfsenseServicesTab from "./PfsenseServicesTab";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("PfsenseServicesTab (services category)", () => {
  it("renders the DHCP section and its sub-nav", async () => {
    render(<PfsenseServicesTab connectionId="conn-1" />);
    // DHCP tab label appears both in the sub-nav and the section heading.
    expect(await screen.findAllByText("DHCP")).not.toHaveLength(0);
    expect(screen.getByText("Services")).toBeInTheDocument();
    expect(screen.getByText("Diagnostics")).toBeInTheDocument();
  });

  it("maps 'Load leases' to pfsense_list_dhcp_leases with the connection id", async () => {
    render(<PfsenseServicesTab connectionId="conn-1" />);
    fireEvent.click(await screen.findByText("Load leases"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_list_dhcp_leases", {
        id: "conn-1",
      }),
    );
  });

  it("loads services on mount once its section is selected", async () => {
    render(<PfsenseServicesTab connectionId="conn-1" />);
    fireEvent.click(await screen.findByText("Services"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_list_services", {
        id: "conn-1",
      }),
    );
  });

  it("passes the DHCP interface arg as `interface` (not camelCased)", async () => {
    render(<PfsenseServicesTab connectionId="conn-1" />);
    fireEvent.click(await screen.findByText("Load config"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("pfsense_get_dhcp_config", {
        id: "conn-1",
        interface: "lan",
      }),
    );
  });
});
