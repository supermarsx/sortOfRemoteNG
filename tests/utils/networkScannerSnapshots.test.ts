import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../src/utils/network/networkScanner";
import type { DiscoveredHost } from "../../src/types/connection/connection";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const config: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  portRanges: ["1-4"],
  protocols: [],
  timeout: 1000,
  maxConcurrent: 1,
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

describe("coalesced native host snapshots", () => {
  it("flushes a hostname accepted just before a progress callback cancels the scan", async () => {
    const controller = new AbortController();
    let resolveDns!: (value: string) => void;
    invoke.mockImplementation((command) =>
      command === "discovery_reverse_dns"
        ? new Promise((resolve) => {
            resolveDns = resolve;
          })
        : Promise.resolve({ open: true }),
    );
    const hosts: DiscoveredHost[] = [];
    const run = new NetworkScanner(true).scanNetwork(
      { ...config, resolveHostnames: true },
      (progress) => {
        if (progress === 100) controller.abort();
      },
      controller.signal,
      undefined,
      (host) => hosts.push(host),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(hosts).toHaveLength(2);
    resolveDns("accepted.example");
    expect((await run)[0].hostname).toBe("accepted.example");
    expect(hosts[hosts.length - 1].hostname).toBe("accepted.example");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clones only initial and final snapshots for 1024 rapidly discovered ports", async () => {
    const clone = vi.spyOn(globalThis, "structuredClone");
    invoke.mockResolvedValue({ open: true });
    const hosts: DiscoveredHost[] = [];
    let status: DiscoveryScanStatus | undefined;
    const result = await new NetworkScanner(true).scanNetwork(
      { ...config, portRanges: ["1-1024"], maxPortConcurrent: 32 },
      undefined,
      undefined,
      (snapshot) => {
        status = snapshot;
      },
      (host) => hosts.push(host),
    );
    expect(hosts).toHaveLength(2);
    expect(clone).toHaveBeenCalledTimes(2);
    expect(hosts[0].openPorts).toHaveLength(1);
    expect(hosts[1].openPorts).toEqual(
      Array.from({ length: 1024 }, (_, index) => index + 1),
    );
    expect(result[0].openPorts).toHaveLength(1024);
    expect(status).toMatchObject({
      liveHosts: 1,
      livePorts: 1024,
      completedProbes: 1024,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps counters immediate, publishes at 100ms, and flushes pre-abort metadata", async () => {
    const pending: Array<(value: { open: boolean }) => void> = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const controller = new AbortController();
    const hosts: DiscoveredHost[] = [];
    let status: DiscoveryScanStatus | undefined;
    const run = new NetworkScanner(true).scanNetwork(
      config,
      undefined,
      controller.signal,
      (snapshot) => {
        status = snapshot;
      },
      (host) => hosts.push(host),
    );
    await flush();
    pending[0]({ open: true });
    await flush();
    expect(hosts.map((host) => host.openPorts)).toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(20);
    pending[1]({ open: true });
    await flush();
    expect(status?.livePorts).toBe(2);
    expect(hosts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(79);
    expect(hosts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hosts.map((host) => host.openPorts)).toEqual([[1], [1, 2]]);
    await vi.advanceTimersByTimeAsync(10);
    pending[2]({ open: true });
    await flush();
    expect(status?.livePorts).toBe(3);
    expect(hosts).toHaveLength(2);
    controller.abort();
    expect(hosts.map((host) => host.openPorts)).toEqual([
      [1],
      [1, 2],
      [1, 2, 3],
    ]);
    pending[3]({ open: true });
    expect((await run)[0].openPorts).toEqual([1, 2, 3]);
    expect(status).toMatchObject({
      liveHosts: 1,
      livePorts: 3,
      activeProbes: 0,
    });
    expect(hosts).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("flushes accepted metadata before rejecting a failed scan", async () => {
    const pending: Array<{
      resolve: (value: { open: boolean }) => void;
      reject: (error: Error) => void;
    }> = [];
    invoke.mockImplementation(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    );
    const hosts: DiscoveredHost[] = [];
    const run = new NetworkScanner(true).scanNetwork(
      config,
      undefined,
      undefined,
      undefined,
      (host) => hosts.push(host),
    );
    const rejected = expect(run).rejects.toThrow("IPC failed");
    await flush();
    pending[0].resolve({ open: true });
    await flush();
    pending[1].resolve({ open: true });
    await flush();
    expect(hosts).toHaveLength(1);
    pending[2].reject(new Error("IPC failed"));
    await rejected;
    expect(hosts.map((host) => host.openPorts)).toEqual([[1], [1, 2]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes final hostname state immediately and clears the pending snapshot timer", async () => {
    let resolveDns!: (value: string) => void;
    invoke.mockImplementation((command) =>
      command === "discovery_reverse_dns"
        ? new Promise((resolve) => {
            resolveDns = resolve;
          })
        : Promise.resolve({ open: true }),
    );
    const hosts: DiscoveredHost[] = [];
    const run = new NetworkScanner(true).scanNetwork(
      { ...config, resolveHostnames: true },
      undefined,
      undefined,
      undefined,
      (host) => hosts.push(host),
    );
    await flush();
    expect(hosts).toHaveLength(1);
    resolveDns("server.example");
    await run;
    expect(hosts).toHaveLength(2);
    expect(hosts[1]).toMatchObject({
      hostname: "server.example",
      openPorts: [1, 2, 3, 4],
    });
    expect(hosts[0].openPorts).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not clone internal hosts when no live callback is registered", async () => {
    const clone = vi.spyOn(globalThis, "structuredClone");
    invoke.mockResolvedValue({ open: true });
    const result = await new NetworkScanner(true).scanNetwork(config);
    expect(result[0].openPorts).toEqual([1, 2, 3, 4]);
    expect(clone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
