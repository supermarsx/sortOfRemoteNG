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
  protocols: [],
  customPorts: {},
  portRanges: ["1-1024"],
  probeStrategies: {},
  timeout: 1000,
  maxConcurrent: 8,
  maxPortConcurrent: 64,
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
  nativeBatchProbes: true,
};
type Batch = {
  probes: { port: number; identifyHttp?: string; identifyProtocol?: string }[];
  parallelism: number;
  host: string;
};
const result = (batch: Batch, open = false) =>
  batch.probes.map(({ port }) => ({ port, open, time_ms: 1000 }));
beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => vi.useRealTimers());
describe("native Rust probe batches", () => {
  it("uses 32 native calls for 1024 ports and preserves all ports and the global cap", async () => {
    let active = 0,
      maximum = 0;
    const observed: number[] = [];
    invoke.mockImplementation(async (command, batch: Batch) => {
      expect(command).toBe("probe_discovery_batch");
      expect(batch.probes.length).toBeLessThanOrEqual(32);
      expect(batch.parallelism).toBe(batch.probes.length);
      active += batch.parallelism;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= batch.parallelism;
      observed.push(...batch.probes.map(({ port }) => port));
      return result(batch, true);
    });
    const statuses: DiscoveryScanStatus[] = [];
    const hosts = await new NetworkScanner(true).scanNetwork(
      base,
      undefined,
      undefined,
      (status) => statuses.push(status),
    );
    expect(invoke).toHaveBeenCalledTimes(32);
    expect(maximum).toBe(64);
    expect(new Set(observed).size).toBe(1024);
    expect(hosts[0].openPorts).toHaveLength(1024);
    expect(statuses[statuses.length - 1]).toMatchObject({
      activeProbes: 0,
      completedProbes: 1024,
      livePorts: 1024,
    });
  });

  it("pauses new batches and resumes the same queue without repeating probes", async () => {
    const pending: Array<() => void> = [];
    invoke.mockImplementation(
      (_command, batch: Batch) =>
        new Promise((resolve) => pending.push(() => resolve(result(batch)))),
    );
    const scanner = new NetworkScanner(true);
    const run = scanner.scanNetwork({
      ...base,
      portRanges: ["1-6"],
      maxPortConcurrent: 2,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    scanner.pause();
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).toHaveBeenCalledTimes(1);
    scanner.resume();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()!();
    await run;
    expect(
      invoke.mock.calls.flatMap(([, batch]) =>
        (batch as Batch).probes.map(({ port }) => port),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels queued batches while draining in-flight native calls", async () => {
    let finish!: () => void;
    invoke.mockImplementation(
      (_command, batch: Batch) =>
        new Promise((resolve) => {
          finish = () => resolve(result(batch, true));
        }),
    );
    const controller = new AbortController();
    const run = new NetworkScanner(true).scanNetwork(
      { ...base, maxPortConcurrent: 2 },
      undefined,
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    finish();
    expect(await run).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps per-probe pacing and caps even when batches are enabled", async () => {
    const times: number[] = [];
    invoke.mockImplementation(async (_command, batch: Batch) => {
      times.push(Date.now());
      expect(batch.parallelism).toBe(1);
      return result(batch);
    });
    const run = new NetworkScanner(true).scanNetwork({
      ...base,
      portRanges: ["1-4"],
      probeLaunchIntervalMs: 50,
    });
    await vi.advanceTimersByTimeAsync(200);
    await run;
    expect(times.map((time) => time - times[0])).toEqual([0, 50, 100, 150]);
  });

  it("passes bounded protocol identification plans and uses actual responses", async () => {
    invoke.mockImplementation(async (_command, batch: Batch) =>
      batch.probes.map((probe) => ({
        port: probe.port,
        open: true,
        ...(probe.identifyProtocol
          ? {
              protocol_confirmed: probe.identifyProtocol,
              protocol_evidence: "Validated negotiation",
            }
          : {
              http_status: 200,
              http_title: "Apache Tomcat/10.1.50",
              http_final_origin: "https://192.0.2.1",
              http_redirects: 1,
            }),
      })),
    );
    const [host] = await new NetworkScanner(true).scanNetwork({
      ...base,
      portRanges: [],
      identifyServices: true,
      protocols: ["smb", "rdp", "postgresql", "tomcat"],
      customPorts: {
        smb: [445],
        rdp: [3389],
        postgresql: [5432],
        tomcat: [8080],
      },
    });
    expect(invoke.mock.calls[0][1].probes).toEqual([
      { port: 445, identifyProtocol: "smb" },
      { port: 3389, identifyProtocol: "rdp" },
      { port: 5432, identifyProtocol: "postgresql" },
      { port: 8080, identifyHttp: "http" },
    ]);
    expect(
      host.services.map(({ protocol, detection }) => [protocol, detection]),
    ).toEqual([
      ["smb", "identified"],
      ["rdp", "identified"],
      ["postgresql", "identified"],
      ["http", "identified"],
    ]);
    expect(host.services[3]).toMatchObject({
      port: 8080,
      product: "Apache Tomcat",
      version: "10.1.50",
    });
    expect(host.services[3].evidence).toContain(
      "Followed 1 redirect to https://192.0.2.1",
    );
  });

  it("rejects malformed batches without a direct-network fallback", async () => {
    invoke.mockResolvedValue([{ port: 99, open: true }]);
    await expect(
      new NetworkScanner(true).scanNetwork({ ...base, portRanges: ["22"] }),
    ).rejects.toThrow("malformed results");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
