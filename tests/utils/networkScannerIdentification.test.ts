import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../src/utils/network/networkScanner";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const base: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  portRanges: ["22", "443"],
  protocols: [],
  timeout: 1000,
  maxConcurrent: 2,
  maxPortConcurrent: 2,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};
beforeEach(() => {
  invoke.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("WebSocket", vi.fn());
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("native service identification", () => {
  it("uses bare IPv6 for HTTP identification and retains brackets for passive probes", async () => {
    invoke.mockResolvedValue({ open: false });
    await new NetworkScanner(true).scanNetwork({
      ...base,
      ipRange: "2001:db8::1",
      identifyServices: true,
    });
    expect(
      invoke.mock.calls.map(([, args]) => [
        args.port,
        args.host,
        args.identifyHttp,
      ]),
    ).toEqual([
      [22, "[2001:db8::1]", undefined],
      [443, "2001:db8::1", "https"],
    ]);
  });
  it.each([undefined, false])(
    "leaves legacy invocation unchanged with identifyServices=%s",
    async (identifyServices) => {
      invoke.mockResolvedValue({ open: true });
      await new NetworkScanner(true).scanNetwork({ ...base, identifyServices });
      expect(invoke.mock.calls.map(([, args]) => args)).toEqual([
        { host: "192.0.2.1", port: 22, timeoutSecs: 1 },
        { host: "192.0.2.1", port: 443, timeoutSecs: 1 },
      ]);
    },
  );

  it("identifies only selected web ports and preserves TCP-open results on HTTP failure", async () => {
    invoke.mockImplementation(async (_command, { port }) =>
      port === 443
        ? { open: true, identification_error: "TLS handshake failed" }
        : { open: true, banner: "SSH-2.0-OpenSSH_9.6" },
    );
    const [host] = await new NetworkScanner(true).scanNetwork({
      ...base,
      identifyServices: true,
    });
    expect(invoke.mock.calls.map(([, args]) => args.identifyHttp)).toEqual([
      undefined,
      "https",
    ]);
    expect(host).toMatchObject({
      openPorts: [22, 443],
      reachability: "not-checked",
      services: [
        { protocol: "ssh", product: "OpenSSH", detection: "identified" },
        {
          protocol: "https",
          detection: "port-hint",
          identificationError: "TLS handshake failed",
        },
      ],
    });
  });

  it.each([
    ["cpanel", 2083, "https"],
    ["cpanel-http", 2082, "http"],
    ["synology", 5001, "https"],
    ["synology-http", 5000, "http"],
    ["portainer-http", 12345, "http"],
    ["https", 12345, "https"],
    ["ssh", 443, undefined],
    ["rdp", 443, undefined],
    ["vnc", 443, undefined],
  ])("routes preset %s on %i with scheme %s", async (id, port, scheme) => {
    invoke.mockResolvedValue({ open: true });
    const [host] = await new NetworkScanner(true).scanNetwork({
      ...base,
      identifyServices: true,
      protocols: [id],
      portRanges: [],
      customPorts: { [id]: [port] },
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][1].identifyHttp).toBe(scheme);
    if (scheme) expect(host.services[0].protocol).toBe(scheme);
    expect(host.services[0].product).toBeUndefined();
  });

  it("scans overlapping presets once and passes structured HTTP evidence to the classifier", async () => {
    invoke.mockResolvedValue({
      open: true,
      http_status: 200,
      http_server: "nginx/1.24",
      http_title: "Portainer",
    });
    const [host] = await new NetworkScanner(true).scanNetwork({
      ...base,
      identifyServices: true,
      protocols: ["https", "portainer"],
      portRanges: [],
      customPorts: { https: [9443], portainer: [9443] },
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(host.services[0]).toMatchObject({
      protocol: "https",
      product: "Portainer",
      detection: "identified",
    });
  });
});

describe("native host discovery and status", () => {
  it.each([1, 2])(
    "does not count hosts cancelled before their first probe (%i host slots) as completed",
    async (maxConcurrent) => {
      let finishProbe: ((value: unknown) => void) | undefined;
      invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishProbe = resolve;
          }),
      );
      const statuses: DiscoveryScanStatus[] = [];
      const controller = new AbortController();
      const scanning = new NetworkScanner(true).scanNetwork(
        {
          ...base,
          ipRange: "192.0.2.0/30",
          maxConcurrent,
          maxPortConcurrent: 1,
        },
        undefined,
        controller.signal,
        (status) => statuses.push(status),
      );
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      controller.abort();
      finishProbe!({ open: false });
      expect(await scanning).toEqual([]);
      expect(statuses[statuses.length - 1]).toMatchObject({
        phase: "complete",
        totalHosts: 2,
        completedHosts: 1,
        activeProbes: 0,
        completedProbes: 1,
        totalProbes: 4,
      });
      expect(invoke).toHaveBeenCalledOnce();
    },
  );
  it("publishes actions before each invoke, counts skipped work, and reaches 100 percent monotonically", async () => {
    const statuses: DiscoveryScanStatus[] = [];
    const percentages: number[] = [];
    invoke.mockImplementation(async (command, { host, port }) => {
      const current = statuses[statuses.length - 1]!;
      expect(current.activeProbes).toBeGreaterThan(0);
      expect(current.currentHost).toBe(host);
      if (command === "probe_discovery_host") {
        expect(current.phase).toBe("discovering");
        return {
          reachable: host === "192.0.2.2",
          elapsed_ms: 3,
          error: host === "192.0.2.1" ? "Timed out" : undefined,
        };
      }
      expect(current.phase).toBe(port === 443 ? "identifying" : "scanning");
      expect(current.currentPort).toBe(port);
      return { open: false };
    });
    const results = await new NetworkScanner(true).scanNetwork(
      {
        ...base,
        ipRange: "192.0.2.0/30",
        pingMethod: "icmp",
        scanUnresponsiveHosts: false,
        identifyServices: true,
      },
      (progress) => percentages.push(progress),
      undefined,
      (status) => statuses.push(status),
    );
    expect(results).toMatchObject([
      {
        ip: "192.0.2.2",
        reachability: "responsive",
        openPorts: [],
        services: [],
      },
    ]);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(statuses[0]).toMatchObject({
      phase: "preparing",
      totalHosts: 2,
      totalProbes: 6,
      completedProbes: 0,
    });
    expect(statuses[statuses.length - 1]).toMatchObject({
      phase: "complete",
      totalHosts: 2,
      completedHosts: 2,
      totalProbes: 6,
      completedProbes: 6,
      skippedHosts: 1,
      activeProbes: 0,
    });
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b));
    expect(percentages[percentages.length - 1]).toBe(100);
    expect(
      statuses.every(
        (status) => status.activeProbes <= 2 && status.activeProbes >= 0,
      ),
    ).toBe(true);
  });

  it.each([undefined, true])(
    "scans an unresponsive host when scanUnresponsiveHosts=%s",
    async (scanUnresponsiveHosts) => {
      invoke.mockImplementation(async (command) =>
        command === "probe_discovery_host"
          ? { reachable: false, elapsed_ms: 1000, error: "Timed out" }
          : { open: true },
      );
      const [host] = await new NetworkScanner(true).scanNetwork({
        ...base,
        pingMethod: "tcp",
        pingPort: 8443,
        pingTimeout: 1500,
        scanUnresponsiveHosts,
      });
      expect(invoke.mock.calls[0]).toEqual([
        "probe_discovery_host",
        { host: "192.0.2.1", method: "tcp", port: 8443, timeoutMs: 1500 },
      ]);
      expect(host).toMatchObject({
        reachability: "unresponsive",
        openPorts: [22, 443],
      });
    },
  );

  it("none bypasses the host policy and always scans chosen ports", async () => {
    invoke.mockResolvedValue({ open: true });
    const [host] = await new NetworkScanner(true).scanNetwork({
      ...base,
      pingMethod: "none",
      scanUnresponsiveHosts: false,
    });
    expect(
      invoke.mock.calls.every(([command]) => command === "check_port"),
    ).toBe(true);
    expect(host.reachability).toBe("not-checked");
  });

  it("uses bare IPv6 literals for host discovery and bracketed IPv6 for check_port", async () => {
    invoke.mockResolvedValue({ reachable: true, elapsed_ms: 1, open: false });
    await new NetworkScanner(true).scanNetwork({
      ...base,
      ipRange: "2001:db8::1",
      pingMethod: "icmp",
      portRanges: ["22"],
    });
    expect(invoke.mock.calls.map(([, args]) => args.host)).toEqual([
      "2001:db8::1",
      "[2001:db8::1]",
    ]);
  });

  it.each([
    { pingTimeout: 0 },
    { pingTimeout: 99 },
    { pingTimeout: 30001 },
    { pingTimeout: NaN },
    { pingPort: 0 },
    { pingPort: 65536 },
    { pingPort: 443.5 },
    { pingMethod: "bad" },
    { portRanges: ["1-2000"] },
  ])("validates %j before any native call", async (overrides) => {
    await expect(
      new NetworkScanner(true).scanNetwork({
        ...base,
        pingMethod: "tcp",
        ...overrides,
      } as NetworkDiscoveryConfig),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cancels queued host probes and drains active calls before completing", async () => {
    const pending: Array<(value: unknown) => void> = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const controller = new AbortController();
    const statuses: DiscoveryScanStatus[] = [];
    let finished = false;
    const scanning = new NetworkScanner(true)
      .scanNetwork(
        {
          ...base,
          ipRange: "192.0.2.0/30",
          pingMethod: "icmp",
          maxPortConcurrent: 1,
        },
        undefined,
        controller.signal,
        (status) => statuses.push(status),
      )
      .then((result) => {
        finished = true;
        return result;
      });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(statuses[statuses.length - 1]?.activeProbes).toBe(1);
    pending[0]({ reachable: true, elapsed_ms: 1 });
    expect(await scanning).toEqual([]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(statuses[statuses.length - 1]).toMatchObject({
      phase: "complete",
      activeProbes: 0,
      completedProbes: 1,
    });
  });

  it("drains a sibling native identification call after API failure", async () => {
    const pending: Array<{
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }> = [];
    invoke.mockImplementation(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    );
    let finished = false;
    const scanning = new NetworkScanner(true).scanNetwork({
      ...base,
      identifyServices: true,
      portRanges: ["443", "8443", "9443"],
    });
    const checked = expect(scanning)
      .rejects.toThrow("Native unavailable")
      .then(() => {
        finished = true;
      });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0].reject(new Error("Native unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    pending[1].resolve({
      open: true,
      http_title: "Portainer",
      http_status: 200,
    });
    await checked;
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
