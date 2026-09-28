import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../src/utils/network/networkScanner";
import { AdaptiveDiscoveryScheduler } from "../../src/utils/discovery/adaptiveDiscoveryScheduler";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import type { DiscoveredHost } from "../../src/types/connection/connection";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const base: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  portRanges: ["22", "443"],
  protocols: [],
  timeout: 1000,
  maxConcurrent: 2,
  maxPortConcurrent: 1,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native adaptive scan integration", () => {
  it("keeps scanning at reduced concurrency while system CPU stays above target", async () => {
    invoke.mockImplementation(async (command) =>
      command === "get_discovery_capacity"
        ? {
            logicalCpus: 80,
            systemLogicalCpus: 80,
            physicalCores: 40,
            cpuPercent: 99,
            cpuSampleAgeMs: 0,
            cpuSampleIntervalMs: 1000,
            interfaces: [],
          }
        : { open: true, time_ms: 1 },
    );
    const statuses: DiscoveryScanStatus[] = [];
    const run = new NetworkScanner(true).scanNetwork(
      { ...base, adaptiveConcurrency: true, maxCpuPercent: 50 },
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    await flush();
    const hosts = await run;
    expect(hosts[0].openPorts).toEqual([22, 443]);
    expect(
      statuses.some(
        (status) =>
          status.cpuPercent === 99 && !status.paused && status.probeLimit === 1,
      ),
    ).toBe(true);
    expect(statuses.some((status) => status.paused)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("finishes after pause on the final live result even with reduced probe capacity", async () => {
    const scanner = new NetworkScanner(true);
    invoke.mockImplementation(async (command) =>
      command === "get_discovery_capacity"
        ? { logicalCpus: 8, cpuPercent: 10, interfaces: [] }
        : { open: true, time_ms: 1000 },
    );
    let finished = false;
    const run = scanner
      .scanNetwork(
        {
          ...base,
          adaptiveConcurrency: true,
          maxConcurrent: 1,
          maxPortConcurrent: 4,
          portRanges: ["20-24"],
        },
        undefined,
        undefined,
        undefined,
        (host) => {
          if (host.openPorts.length === 5) scanner.pause();
        },
      )
      .then((hosts) => {
        finished = true;
        return hosts;
      });
    await flush();
    expect(finished).toBe(true);
    expect((await run)[0].openPorts).toEqual([20, 21, 22, 23, 24]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("finishes the exhausted queue while the last in-flight probe drains under high CPU", async () => {
    let cpu = 10;
    invoke.mockImplementation((command) =>
      command === "get_discovery_capacity"
        ? Promise.resolve({ logicalCpus: 8, cpuPercent: cpu, interfaces: [] })
        : new Promise((resolve) =>
            setTimeout(() => resolve({ open: false, time_ms: 1000 }), 1000),
          ),
    );
    const statuses: DiscoveryScanStatus[] = [];
    let finished = false;
    const run = new NetworkScanner(true)
      .scanNetwork(
        {
          ...base,
          adaptiveConcurrency: true,
          maxConcurrent: 1,
          maxPortConcurrent: 4,
          portRanges: ["20-24"],
          pauseOnHighLoad: true,
        },
        undefined,
        undefined,
        (status) => statuses.push(status),
      )
      .then(() => {
        finished = true;
      });
    await vi.advanceTimersByTimeAsync(1000);
    cpu = 90;
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      statuses.some((status) => status.paused && status.cpuPercent === 90),
    ).toBe(true);
    expect(finished).toBe(true);
    await run;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("finishes without pacing empty workers once the final target is claimed", async () => {
    invoke.mockResolvedValue({ open: false });
    let finished = false;
    const run = new NetworkScanner(true)
      .scanNetwork({ ...base, maxConcurrent: 1, workerLaunchIntervalMs: 5000 })
      .then(() => {
        finished = true;
      });
    await flush();
    expect(finished).toBe(true);
    await run;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds scheduling for 10,000 hosts x 1024 ports and drains cancellation", async () => {
    const acquire = vi.spyOn(AdaptiveDiscoveryScheduler.prototype, "acquire");
    const pending: Array<(value: { open: boolean }) => void> = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const statuses: DiscoveryScanStatus[] = [];
    const controller = new AbortController();
    const run = new NetworkScanner(true).scanNetwork(
      {
        ...base,
        ipRange:
          "2001:db8::/115;2001:db8::2000/118;2001:db8::2400/119;2001:db8::2600/120;2001:db8::2700/124",
        portRanges: ["1-1024"],
        maxConcurrent: 4,
        maxPortConcurrent: 1024,
        absoluteMaxProbes: 3,
      },
      undefined,
      controller.signal,
      (status) => statuses.push(status),
    );
    await flush();
    expect(pending).toHaveLength(3);
    expect(acquire).toHaveBeenCalledTimes(8); // Four workers, one port lane each.
    expect(Math.max(...statuses.map((s) => s.activeWorkers ?? 0))).toBe(4);
    expect(statuses[0].totalHosts).toBe(10000);
    controller.abort();
    pending.forEach((resolve) => resolve({ open: false }));
    expect(await run).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(statuses[statuses.length - 1]).toMatchObject({
      phase: "complete",
      activeWorkers: 0,
      activeProbes: 0,
      etaMs: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses and resumes the same queue, including reverse DNS, with unique live counters", async () => {
    const scanner = new NetworkScanner(true);
    const hosts: DiscoveredHost[] = [];
    const statuses: DiscoveryScanStatus[] = [];
    invoke.mockImplementation(async (command) =>
      command === "discovery_reverse_dns"
        ? "server.example"
        : { open: true, time_ms: 10 },
    );
    const run = scanner.scanNetwork(
      { ...base, resolveHostnames: true },
      undefined,
      undefined,
      (status) => statuses.push(status),
      (host) => {
        hosts.push(host);
        if (!host.hostname) scanner.pause();
      },
    );
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toMatchObject({
      paused: true,
      liveHosts: 1,
      livePorts: 1,
      etaMs: null,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);
    scanner.resume();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(statuses[statuses.length - 1]).toMatchObject({
      paused: true,
      liveHosts: 1,
      livePorts: 2,
    });
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain(
      "discovery_reverse_dns",
    );
    scanner.resume();
    const result = await run;
    expect(invoke).toHaveBeenLastCalledWith("discovery_reverse_dns", {
      host: "192.0.2.1",
      timeoutMs: 1000,
    });
    expect(hosts[hosts.length - 1]).toMatchObject({
      hostname: "server.example",
      openPorts: [22, 443],
    });
    expect(result).toHaveLength(1);
    expect(hosts[0].openPorts).toEqual([22]); // Published snapshots never mutate.
    expect(statuses[statuses.length - 1]).toMatchObject({
      phase: "complete",
      paused: false,
      liveHosts: 1,
      livePorts: 2,
      completedProbes: 3,
      totalProbes: 3,
      etaMs: null,
    });
  });
  it("does not start workers while paused and can cancel without any native work", async () => {
    const scanner = new NetworkScanner(true);
    const controller = new AbortController();
    let paused = false;
    const run = scanner.scanNetwork(base, undefined, controller.signal, () => {
      if (!paused) {
        paused = true;
        scanner.pause();
      }
    });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    controller.abort();
    expect(await run).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts paused queues but drains the already active native probe", async () => {
    const scanner = new NetworkScanner(true);
    const controller = new AbortController();
    let finish!: (value: { open: boolean }) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let settled = false;
    const run = scanner
      .scanNetwork(
        { ...base, ipRange: "192.0.2.0/24", resolveHostnames: true },
        undefined,
        controller.signal,
      )
      .then((hosts) => {
        settled = true;
        return hosts;
      });
    await flush();
    scanner.pause();
    controller.abort();
    await flush();
    expect(settled).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ open: true });
    expect(await run).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drains bounded reverse DNS on abort without publishing late names", async () => {
    const scanner = new NetworkScanner(true);
    const controller = new AbortController();
    const hosts: DiscoveredHost[] = [];
    let resolveDns!: (value: string) => void;
    invoke.mockImplementation((command) =>
      command === "discovery_reverse_dns"
        ? new Promise<string>((resolve) => {
            resolveDns = resolve;
          })
        : Promise.resolve({ open: true }),
    );
    const run = scanner.scanNetwork(
      { ...base, ipRange: "2001:db8::1", resolveHostnames: true },
      undefined,
      controller.signal,
      undefined,
      (host) => hosts.push(host),
    );
    await flush();
    expect(invoke).toHaveBeenLastCalledWith("discovery_reverse_dns", {
      host: "2001:db8::1",
      timeoutMs: 1000,
    });
    scanner.pause();
    controller.abort();
    resolveDns("late.example");
    const result = await run;
    expect(hosts.every((host) => host.hostname === undefined)).toBe(true);
    expect(result.every((host) => host.hostname === undefined)).toBe(true);
  });
  it("pauses on measured CPU, resumes on a later sample, and stops sampling", async () => {
    const statuses: DiscoveryScanStatus[] = [];
    let cpu = 90;
    invoke.mockImplementation(async (command) =>
      command === "get_discovery_capacity"
        ? {
            logicalCpus: 8,
            cpuPercent: cpu,
            interfaces: [
              {
                name: "eth",
                linkSpeedMbps: 100,
                receiveBytesPerSecond: 0,
                transmitBytesPerSecond: 0,
              },
            ],
          }
        : { open: false },
    );
    const run = new NetworkScanner(true).scanNetwork(
      {
        ...base,
        adaptiveConcurrency: true,
        maxCpuPercent: 50,
        pauseOnHighLoad: true,
      },
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    await flush();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "get_discovery_capacity",
    ]);
    expect(statuses[statuses.length - 1]).toMatchObject({
      paused: true,
      cpuPercent: 90,
      etaMs: null,
    });
    cpu = 20;
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    const count = invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(invoke).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("derives finite ETA from completed work and hides it on pause and completion", async () => {
    const statuses: DiscoveryScanStatus[] = [];
    const scanner = new NetworkScanner(true);
    invoke.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ open: false }), 600),
        ),
    );
    const run = scanner.scanNetwork(
      { ...base, portRanges: ["20-23"] },
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    await vi.advanceTimersByTimeAsync(1200);
    expect(
      statuses.some(
        (status) => typeof status.etaMs === "number" && status.etaMs > 0,
      ),
    ).toBe(true);
    scanner.pause();
    expect(statuses[statuses.length - 1]?.etaMs).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    scanner.resume();
    await vi.runAllTimersAsync();
    await run;
    expect(statuses[statuses.length - 1]?.etaMs).toBeNull();
    expect(
      statuses.every(
        (status) => status.etaMs === null || Number.isFinite(status.etaMs),
      ),
    ).toBe(true);
  });
  it("deduplicates mixed targets and DNS updates independently of callback mutations", async () => {
    invoke.mockImplementation(async (command) =>
      command === "discovery_reverse_dns" ? "host.example" : { open: true },
    );
    const results = await new NetworkScanner(true).scanNetwork(
      {
        ...base,
        ipRange: "192.0.2.1;192.0.2.1/32",
        portRanges: ["22", "22"],
        resolveHostnames: true,
      },
      undefined,
      undefined,
      (status) => {
        status.completedHosts = 999;
      },
      (host) => {
        host.openPorts.push(9999);
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].openPorts).toEqual([22]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
