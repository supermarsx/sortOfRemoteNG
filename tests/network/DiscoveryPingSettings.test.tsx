import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryPingSettings } from "../../src/components/network/DiscoveryPingSettings";
import { DiscoveryHostsTable } from "../../src/components/network/DiscoveryHostsTable";
import type { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import type { DiscoveredHost } from "../../src/types/connection/connection";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const initial: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.0/24",
  protocols: ["ssh"],
  portRanges: ["8000-8010"],
  customPorts: { ssh: [2222] },
  timeout: 5000,
  maxConcurrent: 12,
  maxPortConcurrent: 24,
  absoluteMaxProbes: 32,
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};

function Harness({
  config: supplied = {},
  native = true,
  isScanning = false,
}: {
  config?: Partial<NetworkDiscoveryConfig>;
  native?: boolean;
  isScanning?: boolean;
}) {
  const [config, setConfig] = useState({ ...initial, ...supplied });
  return (
    <>
      <DiscoveryPingSettings mgr={{ config, setConfig, native, isScanning }} />
      <output data-testid="config">{JSON.stringify(config)}</output>
    </>
  );
}

const readConfig = (): NetworkDiscoveryConfig =>
  JSON.parse(screen.getByTestId("config").textContent!);
const choose = (label: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
};
const openMethods = () => fireEvent.click(screen.getByText(/^Probe methods ·/));

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ platform: "windows", methods: [] });
});
afterEach(cleanup);

describe("discovery ping settings", () => {
  it.each([undefined, "none"] as const)(
    "shows effective adaptive discovery when enabled with saved method %s",
    async (pingMethod) => {
      render(<Harness config={{ hostDiscoveryEnabled: true, pingMethod }} />);
      await screen.findByText("Probe capabilities: windows");
      expect(
        screen.getByRole("checkbox", {
          name: "Discover hosts with ping / ARP",
        }),
      ).toBeChecked();
      expect(
        screen.getByRole("combobox", { name: "Ping method" }),
      ).toHaveTextContent("Adaptive — stop on response");
      expect(screen.getByText("Probe methods · 3 selected")).toBeVisible();
      expect(readConfig()).toEqual({
        ...initial,
        hostDiscoveryEnabled: true,
        ...(pingMethod ? { pingMethod } : {}),
      });
    },
  );

  it.each([undefined, "none", "combined"] as const)(
    "infers discovery from legacy method %s and retains settings on toggles",
    async (pingMethod) => {
      const saved = { pingMethod, pingMethods: ["tcp", "udp"] as const };
      render(
        <Harness config={{ ...saved, pingMethods: [...saved.pingMethods] }} />,
      );
      await screen.findByText("Probe capabilities: windows");
      const toggle = screen.getByRole("checkbox", {
        name: "Discover hosts with ping / ARP",
      });
      const enabled = pingMethod === "combined";
      if (enabled) expect(toggle).toBeChecked();
      else expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);
      expect(readConfig()).toEqual({
        ...initial,
        pingMethod: enabled ? "combined" : "adaptive",
        pingMethods: ["tcp", "udp"],
        hostDiscoveryEnabled: !enabled,
      });
      fireEvent.click(toggle);
      expect(readConfig().pingMethod).toBe(enabled ? "combined" : "adaptive");
      expect(readConfig().hostDiscoveryEnabled).toBe(enabled);
    },
  );

  it("honors explicit disabled host discovery while retaining its saved method", async () => {
    render(
      <Harness config={{ pingMethod: "icmp", hostDiscoveryEnabled: false }} />,
    );
    await screen.findByText("Probe capabilities: windows");
    const toggle = screen.getByRole("checkbox", {
      name: "Discover hosts with ping / ARP",
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(readConfig()).toEqual({
      ...initial,
      pingMethod: "icmp",
      hostDiscoveryEnabled: true,
    });
  });

  it("offers all ten modes without changing the config on capability discovery", async () => {
    render(<Harness />);
    await screen.findByText("Probe capabilities: windows");
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "get_discovery_probe_capabilities",
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
    expect(screen.getAllByRole("option")).toHaveLength(10);
    for (const name of [
      "ICMP echo",
      "ICMP echo (IPv4)",
      "ICMP echo (IPv6)",
      "Windows native ICMPv4",
      "ARP — LAN IPv4",
      "TCP connection",
      "UDP probe",
    ])
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    expect(readConfig()).toEqual(initial);
  });

  it.each(["Adaptive — stop on response", "Combined — try all selected"])(
    "uses explicit selectable defaults for %s",
    async (label) => {
      render(<Harness />);
      await screen.findByText("Probe capabilities: windows");
      choose(label);
      const summary = screen.getByText("Probe methods · 3 selected");
      expect(summary.closest("details")).not.toHaveAttribute("open");
      expect(screen.getByText(/sequentially/)).toHaveTextContent(
        /per-host timeout budget/,
      );
      expect(screen.getByText(/sequentially/)).toHaveTextContent(
        "No later method starts after the total deadline.",
      );
      expect(screen.getByLabelText("TCP ping port")).toHaveValue(443);
      openMethods();
      const methods = within(summary.closest("details")!);
      expect(methods.getAllByRole("checkbox")).toHaveLength(7);
      for (const name of ["ARP — LAN IPv4", "ICMP echo", "TCP connection"])
        expect(methods.getByRole("checkbox", { name })).toBeChecked();
      fireEvent.click(methods.getByRole("checkbox", { name: "UDP probe" }));
      expect(readConfig().pingMethods).toEqual(["arp", "icmp", "tcp", "udp"]);
      expect(screen.getByLabelText("UDP ping port")).toHaveValue(53);
      fireEvent.click(methods.getByRole("checkbox", { name: "ICMP echo" }));
      expect(readConfig().pingMethods).toEqual(["arp", "tcp", "udp"]);
    },
  );

  it.each(["arp", "icmp-native", "adaptive", "combined"] as const)(
    "explains OS completion can exceed the requested timeout for %s",
    async (pingMethod) => {
      render(<Harness config={{ pingMethod }} />);
      await screen.findByText("Probe capabilities: windows");
      const explanation = screen.getByText(
        /Windows native ARP\/ICMP calls wait/,
      );
      expect(explanation).toBeVisible();
      expect(explanation).toHaveTextContent(
        "OS completion before releasing their probe slot",
      );
      expect(explanation).toHaveTextContent("can exceed the requested timeout");
      expect(explanation).toHaveTextContent("not a hard limit on elapsed time");
    },
  );

  it("edits independent TCP and UDP ports and the shared timeout", async () => {
    render(
      <Harness
        config={{ pingMethod: "combined", pingMethods: ["tcp", "udp"] }}
      />,
    );
    await screen.findByText("Probe capabilities: windows");
    fireEvent.change(screen.getByLabelText("Ping timeout (ms)"), {
      target: { value: "2300" },
    });
    fireEvent.change(screen.getByLabelText("TCP ping port"), {
      target: { value: "8443" },
    });
    fireEvent.change(screen.getByLabelText("UDP ping port"), {
      target: { value: "5353" },
    });
    expect(readConfig()).toMatchObject({
      pingTimeout: 2300,
      pingPort: 8443,
      pingUdpPort: 5353,
    });
    choose("UDP probe");
    expect(screen.queryByLabelText("TCP ping port")).toBeNull();
    expect(screen.getByLabelText("UDP ping port")).toHaveValue(5353);
    choose("TCP connection");
    expect(screen.getByLabelText("TCP ping port")).toHaveValue(8443);
    expect(screen.queryByLabelText("UDP ping port")).toBeNull();
  });

  it("keeps an explicit empty method list and warns instead of restoring defaults", async () => {
    render(<Harness config={{ pingMethod: "adaptive", pingMethods: [] }} />);
    await screen.findByText("Probe capabilities: windows");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one probe method",
    );
    expect(readConfig().pingMethods).toEqual([]);
    expect(screen.getByText("Probe methods · 0 selected")).toBeInTheDocument();
  });

  it("disables known unavailable choices, explains why, and retains defaults", async () => {
    invoke.mockResolvedValue({
      platform: "linux",
      methods: [
        { id: "arp", available: false, description: "arping is missing" },
        { id: "icmp-native", available: false, description: "Windows only" },
        { id: "icmp", available: true, description: "ping is installed" },
      ],
    });
    render(<Harness config={{ pingMethod: "adaptive" }} />);
    await screen.findByText("Probe capabilities: linux");
    expect(
      screen.getByText(/ARP — LAN IPv4 unavailable: arping is missing/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "ARP sweep only" }),
    ).toBeDisabled();
    openMethods();
    expect(
      screen.getByRole("checkbox", { name: "ARP — LAN IPv4" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "ARP — LAN IPv4" }),
    ).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "ICMP echo" })).toBeEnabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
    const option = screen.getByRole("option", {
      name: /Windows native ICMPv4/,
    });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveTextContent("Windows only");
    fireEvent.mouseDown(option);
    expect(readConfig()).toEqual({ ...initial, pingMethod: "adaptive" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("checkbox", { name: "ARP — LAN IPv4" }));
    expect(readConfig().pingMethods).toEqual(["icmp", "tcp"]);
    expect(
      screen.getByRole("checkbox", { name: "ARP — LAN IPv4" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "ARP — LAN IPv4" }));
    expect(readConfig().pingMethods).toEqual(["icmp", "tcp"]);
  });

  it("preserves saved Windows method selections on Unix until explicitly removed", async () => {
    invoke.mockResolvedValue({
      platform: "linux",
      methods: [
        { id: "icmp-native", available: false, description: "Windows only" },
      ],
    });
    render(
      <Harness
        config={{ pingMethod: "combined", pingMethods: ["icmp-native", "tcp"] }}
      />,
    );
    await screen.findByText("Probe capabilities: linux");
    expect(readConfig().pingMethods).toEqual(["icmp-native", "tcp"]);
    openMethods();
    const checkbox = screen.getByRole("checkbox", {
      name: "Windows native ICMPv4",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(readConfig().pingMethods).toEqual(["tcp"]);
    expect(checkbox).toBeDisabled();
  });

  it.each(["reject", "malformed", "missing", "throw"])(
    "treats %s capability responses as unknown",
    async (kind) => {
      if (kind === "reject")
        invoke.mockRejectedValue(new Error("command not found"));
      else if (kind === "missing") invoke.mockReturnValue(undefined);
      else if (kind === "throw")
        invoke.mockImplementation(() => {
          throw new Error("native bridge unavailable");
        });
      else invoke.mockResolvedValue({ methods: null });
      render(<Harness config={{ pingMethod: "arp" }} />);
      await screen.findByText("Probe capabilities unknown.");
      expect(
        screen.getByRole("button", { name: "ARP sweep only" }),
      ).toBeEnabled();
      expect(readConfig()).toEqual({ ...initial, pingMethod: "arp" });
      expect(screen.getByText(/Unix requires arping/)).toBeVisible();
    },
  );

  it.each([false, true])(
    "locks every edit in browser mode or during scanning (native=%s)",
    async (native) => {
      render(
        <Harness
          native={native}
          isScanning={native}
          config={{ pingMethod: "combined", pingMethods: ["tcp", "udp"] }}
        />,
      );
      if (native) await screen.findByText("Probe capabilities: windows");
      else expect(invoke).not.toHaveBeenCalled();
      openMethods();
      for (const control of [
        ...screen.getAllByRole("button"),
        ...screen.getAllByRole("checkbox"),
        ...screen.getAllByRole("spinbutton"),
        screen.getByRole("combobox"),
      ])
        expect(control).toBeDisabled();
      fireEvent.change(screen.getByLabelText("UDP ping port"), {
        target: { value: "9999" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Ping sweep only" }));
      expect(readConfig()).toEqual({
        ...initial,
        pingMethod: "combined",
        pingMethods: ["tcp", "udp"],
      });
    },
  );

  it("closes a live dropdown and locks its edits when scanning starts", async () => {
    const view = render(<Harness />);
    await screen.findByText("Probe capabilities: windows");
    fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    view.rerender(<Harness isScanning />);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(readConfig()).toEqual(initial);
    view.rerender(<Harness />);
    choose("ICMP echo (IPv6)");
    expect(readConfig().pingMethod).toBe("icmp6");
  });

  it.each([
    ["ARP sweep only", "arp"],
    ["Ping sweep only", "adaptive"],
  ] as const)(
    "applies %s without overwriting targets, caps or selected methods",
    async (label, pingMethod) => {
      const config = {
        pingMethods: ["udp", "icmp6"] as NonNullable<
          NetworkDiscoveryConfig["pingMethods"]
        >,
        pingUdpPort: 5353,
      };
      render(<Harness config={config} />);
      await screen.findByText("Probe capabilities: windows");
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(readConfig()).toEqual({
        ...initial,
        ...config,
        hostDiscoveryEnabled: true,
        serviceScanEnabled: false,
        pingMethod,
        scanUnresponsiveHosts: false,
      });
    },
  );

  it("ignores a capability response after switching to browser mode", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<Harness />);
    view.rerender(<Harness native={false} />);
    await act(async () => resolve({ platform: "linux", methods: [] }));
    expect(screen.queryByText("Probe capabilities: linux")).toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(readConfig()).toEqual(initial);
  });
});

describe("host probe details", () => {
  it.each(["responsive", "unavailable", "unresponsive"] as const)(
    "shows %s host evidence with no services and preserves its MAC",
    (reachability) => {
      const host: DiscoveredHost = {
        ip: "192.0.2.8",
        openPorts: [],
        services: [],
        responseTime: 8,
        macAddress: "00:11:22:33:44:55",
        reachability,
        discoveryProbes: [
          { method: "arp", status: "responsive", elapsedMs: 2 },
          {
            method: "icmp-native",
            status: "unavailable",
            elapsedMs: 0,
            error: "Windows only",
          },
          { method: "udp", status: "unresponsive", elapsedMs: 6 },
        ],
      };
      const mgr = {
        discoveredHosts: [host],
        filteredHosts: [host],
        selectedServices: new Set(),
        filterText: "",
        allowCreateConnections: false,
        t: (key: string) => key,
        setFilterText: vi.fn(),
        handleExportCSV: vi.fn(),
      } as unknown as ReturnType<typeof useNetworkDiscovery>;
      render(<DiscoveryHostsTable mgr={mgr} />);
      expect(screen.getByText(host.macAddress!)).toBeVisible();
      const summary = screen.getByLabelText(`Probe details for ${host.ip}`);
      expect(summary).toHaveTextContent("1 responsive");
      expect(summary).toHaveTextContent("probes unavailable");
      expect(summary.closest("details")).not.toHaveAttribute("open");
      fireEvent.click(summary);
      expect(screen.getByText("Windows only")).toBeVisible();
      const rows = within(
        screen.getByRole("list", { name: `Discovery probes for ${host.ip}` }),
      ).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("ARP · responsive · 2 ms");
      expect(rows[1]).toHaveTextContent("ICMP-NATIVE · unavailable · 0 ms");
      expect(rows[2]).toHaveTextContent("UDP · unresponsive · 6 ms");
      if (reachability === "unavailable")
        expect(
          screen.getByText("Reachability probes unavailable"),
        ).toBeVisible();
      expect(screen.queryByText(/TCP scanned/)).toBeNull();
    },
  );
});
