import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import { NetworkScanner } from "../../src/utils/network/networkScanner";
import type { DiscoveredHost } from "../../src/types/connection/connection";
import { fingerprintService } from "../../src/utils/discovery/serviceFingerprint";

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch }),
}));
vi.mock("../../src/hooks/network/useDiscoveryScanHistory", () => ({
  useDiscoveryScanHistory: () => ({
    scans: [],
    loading: false,
    error: null,
    saveScan: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { count?: number; port?: number } | string) =>
      key === "networkDiscovery.createConnections" && typeof args === "object"
        ? `Create ${args.count} connections`
        : key === "networkDiscovery.port" && typeof args === "object"
          ? `Port ${args.port}`
          : typeof args === "string"
            ? args
            : key,
  }),
}));

const host: DiscoveredHost = {
  ip: "192.0.2.25",
  hostname: "server-one",
  responseTime: 5,
  openPorts: [22, 443],
  services: [
    { port: 22, protocol: "ssh", service: "SSH" },
    { port: 443, protocol: "https", service: "HTTPS" },
  ],
};
beforeEach(() => {
  localStorage.clear();
  dispatch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function scan(hosts = [host]) {
  vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue(
    structuredClone(hosts),
  );
  render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
  fireEvent.change(
    screen.getByRole("combobox", { name: "networkDiscovery.ipRange" }),
    { target: { value: "192.0.2.0/24" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "networkDiscovery.startScan" }),
  );
  return await screen.findByRole("table", {
    name: "Discovered hosts and services",
  });
}

describe("discovery result table", () => {
  it.each([undefined, "redirect_loop"])(
    "shows a prominent certificate warning alongside final-page identification (later error: %s)",
    async (laterError) => {
      const service = fingerprintService(80, undefined, "http", {
        http_status: 200,
        http_title: "Proxmox Virtual Environment",
        http_server: "nginx",
        http_redirects: 2,
        http_final_origin: "https://192.0.2.25:8006",
        identification_error: `certificate_validation_bypassed${laterError ? `;${laterError}` : ""}`,
      });
      const table = await scan([
        { ...host, openPorts: [80], services: [service] },
      ]);
      expect(within(table).getByText("TLS certificate warning")).toBeVisible();
      fireEvent.click(
        within(table).getByRole("button", {
          name: "Show services for 192.0.2.25",
        }),
      );
      expect(within(table).getByText("Identified from response")).toBeVisible();
      expect(within(table).getAllByText("Proxmox VE")).toHaveLength(2);
      const warning = within(table).getByText(
        /TLS certificate warning: validation failed/,
      );
      expect(warning).toBeVisible();
      expect(warning.closest("details")).toBeNull();
      expect(
        within(table).queryByText(/Identification unavailable:/),
      ).toBeNull();
      if (laterError) {
        fireEvent.click(within(table).getByText("Response details"));
        expect(
          within(table).getByText(/Identification incomplete: redirect_loop/),
        ).toBeVisible();
      } else {
        expect(
          within(table).queryByText(/Identification incomplete:/),
        ).toBeNull();
      }
    },
  );

  it("does not mislabel a generic TLS failure as an invalid certificate", async () => {
    const table = await scan([
      {
        ...host,
        services: [
          {
            ...host.services[1],
            identificationError: "tls_or_connection_failure",
          },
        ],
      },
    ]);
    expect(within(table).queryByText(/TLS certificate warning/)).toBeNull();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Show services for 192.0.2.25",
      }),
    );
    fireEvent.click(within(table).getByText("Response details"));
    expect(
      within(table).getByText(
        /Identification unavailable: tls_or_connection_failure/,
      ),
    ).toBeVisible();
    expect(within(table).queryByText(/TLS certificate warning/)).toBeNull();
  });

  it("creates only the selected service and port, never every service on the host", async () => {
    const table = await scan();
    expect(
      within(table).getByRole("columnheader", { name: "Host / service" }),
    ).toBeVisible();
    expect(
      within(table).queryByRole("checkbox", {
        name: "Select 192.0.2.25 port 22 SSH",
      }),
    ).toBeNull();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Show services for 192.0.2.25",
      }),
    );
    fireEvent.click(
      within(table).getByRole("checkbox", {
        name: "Select 192.0.2.25 port 22 SSH",
      }),
    );
    expect(
      within(table).getByRole("checkbox", {
        name: "Select 192.0.2.25 port 443 HTTPS",
      }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Create 1 connections" }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: expect.objectContaining({
        hostname: host.ip,
        port: 22,
        protocol: "ssh",
      }),
    });
  });

  it("selects all host services as a shortcut, with individually removable ports", async () => {
    const table = await scan();
    fireEvent.click(
      within(table).getByRole("checkbox", {
        name: "Select all services on 192.0.2.25",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Create 2 connections" }),
    ).toBeVisible();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Show services for 192.0.2.25",
      }),
    );
    fireEvent.click(
      within(table).getByRole("checkbox", {
        name: "Select 192.0.2.25 port 22 SSH",
      }),
    );
    expect(
      within(table).getByRole("checkbox", {
        name: "Select all services on 192.0.2.25",
      }),
    ).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(
      screen.getByRole("button", { name: "Create 1 connections" }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: expect.objectContaining({ port: 443, protocol: "https" }),
    });
  });

  it("creates one endpoint directly from its service row without selecting neighbors", async () => {
    const table = await scan();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Show services for 192.0.2.25",
      }),
    );
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Create connection for 192.0.2.25 port 443 HTTPS",
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: expect.objectContaining({ port: 443, protocol: "https" }),
    });
  });

  it("paginates host results and nested services instead of mounting an unbounded table", async () => {
    const manyHosts = Array.from({ length: 51 }, (_, index) => ({
      ...host,
      ip: `192.0.2.${index + 1}`,
      hostname: `host-${index + 1}`,
    }));
    manyHosts[0] = {
      ...manyHosts[0],
      openPorts: Array.from({ length: 30 }, (_, i) => i + 1000),
      services: Array.from({ length: 30 }, (_, i) => ({
        port: i + 1000,
        protocol: "raw",
        service: "RAW",
      })),
    };
    const table = await scan(manyHosts);
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    expect(
      within(table).queryByRole("heading", { name: "host-51" }),
    ).toBeNull();
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Show services for 192.0.2.1",
      }),
    );
    expect(
      within(table).getAllByRole("button", { name: /^Create connection for/ }),
    ).toHaveLength(25);
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Next services for 192.0.2.1",
      }),
    );
    expect(
      within(table).getAllByRole("button", { name: /^Create connection for/ }),
    ).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Next hosts" }));
    await waitFor(() =>
      expect(
        within(table).getByRole("heading", { name: "host-51" }),
      ).toBeVisible(),
    );
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });
});
