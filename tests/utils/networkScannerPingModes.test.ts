import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../src/utils/network/networkScanner";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const config: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  protocols: [],
  portRanges: [],
  timeout: 1000,
  maxConcurrent: 8,
  maxPortConcurrent: 8,
  absoluteMaxProbes: 1,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
  pingMethod: "combined",
  pingMethods: ["arp", "tcp", "udp"],
  pingUdpPort: 5353,
  scanUnresponsiveHosts: false,
};
beforeEach(() => {
  invoke.mockReset();
});
describe("native discovery modes", () => {
  it("skips host discovery while retaining its configured mode", async () => {
    invoke.mockResolvedValue({ open: true, time_ms: 1 });
    const selected = {
      ...config,
      hostDiscoveryEnabled: false,
      serviceScanEnabled: true,
      portRanges: ["22"],
    };
    const hosts = await new NetworkScanner(true).scanNetwork(selected);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("check_port", {
      host: "192.0.2.1",
      port: 22,
      timeoutSecs: 1,
    });
    expect(hosts[0].reachability).toBe("not-checked");
    expect(selected.pingMethod).toBe("combined");
  });
  it("runs host-only discovery without probing retained service selections", async () => {
    invoke.mockResolvedValue({ reachable: true, status: "responsive" });
    const selected = {
      ...config,
      hostDiscoveryEnabled: true,
      serviceScanEnabled: false,
      portRanges: ["22", "443"],
    };
    const statuses: DiscoveryScanStatus[] = [];
    const hosts = await new NetworkScanner(true).scanNetwork(
      selected,
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("probe_discovery_host");
    expect(hosts[0].openPorts).toEqual([]);
    expect(statuses[statuses.length - 1].totalProbes).toBe(1);
    expect(selected.portRanges).toEqual(["22", "443"]);
  });
  it("performs no I/O when both stages are disabled", async () => {
    await expect(
      new NetworkScanner(true).scanNetwork({
        ...config,
        hostDiscoveryEnabled: false,
        serviceScanEnabled: false,
        portRanges: ["22"],
      }),
    ).rejects.toThrow("enable a host discovery sweep");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("defaults an explicitly enabled discovery stage to adaptive", async () => {
    invoke.mockResolvedValue({ reachable: true });
    await new NetworkScanner(true).scanNetwork({
      ...config,
      pingMethod: "none",
      hostDiscoveryEnabled: true,
      serviceScanEnabled: false,
    });
    expect(invoke.mock.calls[0][1].method).toBe("adaptive");
  });
  it("supplies the default UDP port and ignores retained composite options in single mode", async () => {
    invoke.mockResolvedValue({ reachable: true, status: "responsive" });
    await new NetworkScanner(true).scanNetwork({
      ...config,
      pingMethod: "udp",
      pingUdpPort: undefined,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("probe_discovery_host", {
      host: "192.0.2.1",
      method: "udp",
      timeoutMs: 1000,
      port: 443,
      udpPort: 53,
    });
  });
  it("runs a port-free sweep and retains MAC and method evidence without inventing open ports", async () => {
    invoke.mockResolvedValue({
      reachable: true,
      status: "responsive",
      elapsed_ms: 2,
      mac_address: "02:00:00:00:00:01",
      attempts: [{ method: "arp", status: "responsive", elapsed_ms: 2 }],
    });
    const hosts = await new NetworkScanner(true).scanNetwork(config);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("probe_discovery_host", {
      host: "192.0.2.1",
      method: "combined",
      methods: ["arp", "tcp", "udp"],
      timeoutMs: 1000,
      port: 443,
      udpPort: 5353,
    });
    expect(hosts[0]).toMatchObject({
      openPorts: [],
      services: [],
      macAddress: "02:00:00:00:00:01",
      discoveryProbes: [{ method: "arp", status: "responsive", elapsedMs: 2 }],
    });
  });
  it("does not skip TCP services when discovery is unavailable", async () => {
    const statuses: DiscoveryScanStatus[] = [];
    invoke.mockImplementation(async (command) =>
      command === "probe_discovery_host"
        ? {
            reachable: false,
            status: "unavailable",
            error: "arping unavailable",
          }
        : { open: true, banner: "SSH-2.0-OpenSSH", time_ms: 1 },
    );
    const hosts = await new NetworkScanner(true).scanNetwork(
      { ...config, portRanges: ["22"] },
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    expect(hosts[0].openPorts).toEqual([22]);
    expect(statuses[statuses.length - 1]?.discoveryWarning).toBe(
      "arping unavailable",
    );
    expect(statuses[statuses.length - 1]?.liveHosts).toBe(1);
  });
  it("reports an all-unavailable pure sweep instead of silently reporting zero hosts", async () => {
    invoke.mockResolvedValue({
      reachable: false,
      status: "unavailable",
      error: "ARP requires a directly connected IPv4 network",
    });
    await expect(new NetworkScanner(true).scanNetwork(config)).rejects.toThrow(
      "directly connected",
    );
  });
  it("continues mixed-family sweeps when ARP is unavailable for some targets", async () => {
    invoke.mockImplementation(async (_command, { host }) =>
      host.includes(":")
        ? { reachable: false, status: "unavailable" }
        : { reachable: true, status: "responsive" },
    );
    const hosts = await new NetworkScanner(true).scanNetwork({
      ...config,
      ipRange: "2001:db8::1,192.0.2.1",
      pingMethod: "arp",
    });
    expect(hosts.map((host) => host.ip)).toEqual(["192.0.2.1"]);
  });
  it("does not publish nonresponsive sweep hosts as live", async () => {
    invoke.mockResolvedValue({ reachable: false, status: "unresponsive" });
    expect(await new NetworkScanner(true).scanNetwork(config)).toEqual([]);
  });
  it.each([
    { pingMethods: [] },
    { pingMethods: ["combined"] },
    { pingMethods: ["icmp", "icmp"] },
    { pingUdpPort: 0 },
    { pingUdpPort: 65536 },
  ])("rejects invalid mode settings before I/O %j", async (override) => {
    await expect(
      new NetworkScanner(true).scanNetwork({
        ...config,
        ...override,
      } as NetworkDiscoveryConfig),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("holds the global permit for the whole native discovery call and drains cancellation", async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const scanning = new NetworkScanner(true).scanNetwork(
      { ...config, ipRange: "192.0.2.0/29" },
      undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    controller.abort();
    finish({ reachable: true, status: "responsive" });
    expect(await scanning).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
