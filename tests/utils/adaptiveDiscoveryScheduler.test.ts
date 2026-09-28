import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdaptiveDiscoveryScheduler,
  type DiscoveryCapacity,
} from "../../src/utils/discovery/adaptiveDiscoveryScheduler";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const base: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  portRanges: ["22"],
  protocols: [],
  timeout: 1000,
  maxConcurrent: 512,
  maxPortConcurrent: 1024,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};
const capacity = (cpuPercent = 10, utilization = 10): DiscoveryCapacity => ({
  logicalCpus: 16,
  systemLogicalCpus: 80,
  physicalCores: 40,
  cpuSampleIntervalMs: 1000,
  cpuSampleAgeMs: 0,
  cpuPercent,
  interfaces: [
    {
      name: "ethernet",
      linkSpeedMbps: 100,
      receiveBytesPerSecond: utilization * 125000,
      transmitBytesPerSecond: 0,
    },
  ],
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("adaptive discovery admission", () => {
  it.each([
    [true, undefined, 95, 10],
    [true, false, 10, 95],
    [false, undefined, 95, 10],
    [false, false, 10, 95],
  ] as const)(
    "keeps admitting under sustained pressure (adaptive=%s, pause=%s, CPU=%s, network=%s)",
    async (adaptiveConcurrency, pauseOnHighLoad, cpu, network) => {
      const scheduler = new AdaptiveDiscoveryScheduler(
        {
          ...base,
          adaptiveConcurrency,
          pauseOnHighLoad,
          maxCpuPercent: 80,
          maxConcurrent: 6,
          maxPortConcurrent: 20,
          absoluteMaxProbes: 10,
        },
        new AbortController().signal,
        vi.fn(),
      );
      for (let i = 0; i < 10; i++)
        scheduler.updateCapacity(capacity(cpu, network));
      expect(scheduler.snapshot()).toMatchObject({
        paused: false,
        workerLimit: 1,
        probeLimit: 1,
      });
      expect(scheduler.snapshot().throttleReason).toContain(
        "scanning continues",
      );
      expect(await scheduler.acquire("worker")).toBe(true);
      expect(await scheduler.acquireProbes(32)).toBe(1);
      let admitted = false;
      const queued = scheduler.acquire("probe").then((ok) => {
        admitted = ok;
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(admitted).toBe(false);
      scheduler.release("probe");
      await queued;
      expect(admitted).toBe(true);
      scheduler.release("probe");
      scheduler.release("worker");
      // Threshold hysteresis retains the backed-off state below the entry point.
      scheduler.updateCapacity(
        capacity(cpu > 80 ? 75 : 10, network > 80 ? 75 : 10),
      );
      expect(scheduler.snapshot()).toMatchObject({
        workerLimit: 1,
        probeLimit: 1,
      });
      scheduler.updateCapacity(capacity());
      expect(scheduler.snapshot().workerLimit).toBe(1);
      scheduler.updateCapacity(capacity());
      expect(scheduler.snapshot()).toMatchObject({
        workerLimit: 2,
        probeLimit: 2,
      });
      for (let i = 0; i < 30; i++) scheduler.updateCapacity(capacity());
      expect(scheduler.snapshot()).toMatchObject({
        paused: false,
        workerLimit: 6,
        probeLimit: 10,
      });
      expect(await scheduler.acquireProbes(32)).toBe(10);
      scheduler.stop();
    },
  );

  it("preserves a user pause through soft pressure and recovery", async () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.pause();
    let admitted = false;
    const queued = scheduler.acquire("worker").then((ok) => {
      admitted = ok;
    });
    scheduler.updateCapacity(capacity(95));
    for (let i = 0; i < 10; i++) scheduler.updateCapacity(capacity());
    await vi.advanceTimersByTimeAsync(100);
    expect(admitted).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({ paused: true });
    expect(scheduler.snapshot().throttleReason).toContain("Paused by user");
    scheduler.resume();
    await queued;
    expect(admitted).toBe(true);
    scheduler.stop();
  });

  it("does not reset a pressure backoff upward on repeated unknown samples", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    for (let i = 0; i < 10; i++) scheduler.updateCapacity(capacity(95));
    for (let i = 0; i < 10; i++) scheduler.updateCapacity(null);
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 1,
      probeLimit: 1,
      paused: false,
      cpuPercent: null,
      networkUtilizationPercent: null,
      logicalCpus: null,
      systemLogicalCpus: null,
      physicalCores: null,
      cpuSampleAgeMs: null,
      cpuSampleIntervalMs: null,
    });
    expect(scheduler.snapshot().throttleReason).toContain("Conservative");
    scheduler.updateCapacity(capacity());
    expect(scheduler.snapshot().workerLimit).toBe(1);
    scheduler.updateCapacity(capacity());
    expect(scheduler.snapshot().workerLimit).toBe(2);
    scheduler.stop();
  });

  it("reports machine CPU unchanged and sizes concurrency using available logical CPUs", () => {
    const publish = vi.fn();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      publish,
    );
    const sample = {
      ...capacity(25),
      logicalCpus: 2,
      systemLogicalCpus: 80,
      physicalCores: 40,
      cpuSampleAgeMs: 5000,
      cpuSampleIntervalMs: 500,
    };
    for (let i = 0; i < 50; i++) scheduler.updateCapacity(sample);
    expect(scheduler.snapshot()).toMatchObject({
      cpuPercent: 25,
      logicalCpus: 2,
      systemLogicalCpus: 80,
      physicalCores: 40,
      cpuSampleAgeMs: 5000,
      cpuSampleIntervalMs: 500,
      workerLimit: 8,
      probeLimit: 32,
    });
    expect(publish).toHaveBeenLastCalledWith(scheduler.snapshot());
    scheduler.updateCapacity({ ...sample, cpuPercent: 95 });
    expect(scheduler.snapshot()).toMatchObject({
      cpuPercent: 95,
      workerLimit: 4,
      probeLimit: 16,
      paused: false,
    });
    scheduler.stop();
  });

  it("drains active probes before admitting more after a soft limit reduction", async () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      {
        ...base,
        adaptiveConcurrency: true,
        maxConcurrent: 4,
        absoluteMaxProbes: 8,
      },
      new AbortController().signal,
      vi.fn(),
    );
    expect(await scheduler.acquireProbes(32)).toBe(8);
    let admitted = 0;
    const queued = scheduler.acquireProbes(32).then((count) => {
      admitted = count;
    });
    scheduler.updateCapacity(capacity(95));
    expect(scheduler.snapshot().probeLimit).toBe(4);
    scheduler.release("probe", 4);
    await vi.advanceTimersByTimeAsync(100);
    expect(admitted).toBe(0);
    scheduler.release("probe");
    await queued;
    expect(admitted).toBe(1);
    scheduler.stop();
  });

  it.each([0, 100])(
    "keeps valid machine CPU utilization at its %s percent boundary",
    (cpuPercent) => {
      const scheduler = new AdaptiveDiscoveryScheduler(
        { ...base, adaptiveConcurrency: true },
        new AbortController().signal,
        vi.fn(),
      );
      scheduler.updateCapacity(capacity(cpuPercent));
      expect(scheduler.snapshot().cpuPercent).toBe(cpuPercent);
      expect(scheduler.snapshot().paused).toBe(false);
      scheduler.stop();
    },
  );

  it.each([
    NaN,
    Infinity,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    undefined,
  ])("rejects invalid available CPU counts: %s", (logicalCpus) => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    for (let i = 0; i < 20; i++)
      scheduler.updateCapacity({ ...capacity(25), logicalCpus });
    expect(scheduler.snapshot()).toMatchObject({
      cpuPercent: 25,
      logicalCpus: null,
      workerLimit: 4,
      probeLimit: 8,
    });
    expect(scheduler.snapshot().throttleReason).toContain(
      "CPU topology unavailable or invalid",
    );
    scheduler.stop();
  });

  it.each([NaN, Infinity, 0, -1, 1.5, 8, null])(
    "rejects invalid or contradictory system counts: %s",
    (systemLogicalCpus) => {
      const scheduler = new AdaptiveDiscoveryScheduler(
        { ...base, adaptiveConcurrency: true },
        new AbortController().signal,
        vi.fn(),
      );
      for (let i = 0; i < 20; i++)
        scheduler.updateCapacity({ ...capacity(), systemLogicalCpus });
      expect(scheduler.snapshot()).toMatchObject({
        workerLimit: 4,
        probeLimit: 8,
      });
      expect(scheduler.snapshot().throttleReason).toContain(
        "CPU topology unavailable or invalid",
      );
      scheduler.stop();
    },
  );

  it("treats physical cores as display-only metadata", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    for (let i = 0; i < 50; i++)
      scheduler.updateCapacity({ ...capacity(25), physicalCores: 1.5 });
    expect(scheduler.snapshot()).toMatchObject({
      physicalCores: null,
      cpuPercent: 25,
      workerLimit: 64,
      probeLimit: 256,
    });
    scheduler.stop();
  });

  it.each([
    { cpuSampleAgeMs: 5001 },
    { cpuSampleAgeMs: NaN },
    { cpuSampleAgeMs: Infinity },
    { cpuSampleAgeMs: -1 },
    { cpuSampleAgeMs: null },
    { cpuSampleIntervalMs: 0 },
    { cpuSampleIntervalMs: NaN },
    { cpuSampleIntervalMs: null },
    { cpuPercent: NaN },
    { cpuPercent: Infinity },
    { cpuPercent: -1 },
    { cpuPercent: 101 },
  ])(
    "uses conservative unknown CPU status for invalid telemetry: %j",
    (metadata) => {
      const scheduler = new AdaptiveDiscoveryScheduler(
        { ...base, adaptiveConcurrency: true },
        new AbortController().signal,
        vi.fn(),
      );
      for (let i = 0; i < 20; i++)
        scheduler.updateCapacity({ ...capacity(), ...metadata });
      expect(scheduler.snapshot()).toMatchObject({
        cpuPercent: null,
        workerLimit: 4,
        probeLimit: 8,
        paused: false,
      });
      expect(scheduler.snapshot().throttleReason).toContain(
        "CPU cap not enforceable",
      );
      if (metadata.cpuSampleAgeMs === 5001)
        expect(scheduler.snapshot().throttleReason).toContain("stale");
      scheduler.stop();
    },
  );

  it("backs off for a busy network even when CPU telemetry is stale", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.updateCapacity({ ...capacity(0, 95), cpuSampleAgeMs: 5001 });
    expect(scheduler.snapshot()).toMatchObject({
      cpuPercent: null,
      networkUtilizationPercent: 95,
      workerLimit: 2,
      probeLimit: 4,
      paused: false,
    });
    scheduler.stop();
  });

  it("honors manual concurrency with missing NIC metrics while still pausing for measured CPU pressure", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      {
        ...base,
        adaptiveConcurrency: false,
        maxConcurrent: 100,
        maxPortConcurrent: 256,
        absoluteMaxProbes: 128,
        maxCpuPercent: 80,
        pauseOnHighLoad: true,
      },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.updateCapacity({
      logicalCpus: 16,
      cpuPercent: 10,
      interfaces: [],
    });
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 100,
      probeLimit: 128,
      paused: false,
    });
    expect(scheduler.snapshot().throttleReason).toContain(
      "Network metrics unavailable",
    );
    scheduler.updateCapacity({
      logicalCpus: 16,
      cpuPercent: 90,
      interfaces: [],
    });
    expect(scheduler.snapshot().paused).toBe(true);
    scheduler.updateCapacity({
      logicalCpus: 16,
      cpuPercent: 40,
      interfaces: [],
    });
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 100,
      probeLimit: 128,
      paused: false,
    });
    scheduler.stop();
  });
  it("reserves batch slots atomically and releases them without hold-and-wait deadlocks", async () => {
    const controller = new AbortController();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, maxPortConcurrent: 7 },
      controller.signal,
      vi.fn(),
    );
    expect(await scheduler.acquireProbes(32)).toBe(7);
    const queued = scheduler.acquireProbes(32);
    scheduler.release("probe", 3);
    expect(await queued).toBe(3);
    scheduler.release("probe", 7);
    expect(await scheduler.acquireProbes(2)).toBe(2);
    scheduler.release("probe", 2);
    scheduler.pause();
    const cancelled = scheduler.acquireProbes(10);
    controller.abort();
    expect(await cancelled).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  const unknownInterface = {
    name: "loopback",
    linkSpeedMbps: null,
    receiveBytesPerSecond: 0,
    transmitBytesPerSecond: 0,
  };
  it("pauses on a busy measured NIC even when another interface has unknown speed", async () => {
    const controller = new AbortController();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true, pauseOnHighLoad: true },
      controller.signal,
      vi.fn(),
    );
    const measured = capacity(10, 90);
    scheduler.updateCapacity({
      ...measured,
      interfaces: [...measured.interfaces, unknownInterface],
    });
    expect(scheduler.snapshot()).toMatchObject({
      paused: true,
      networkUtilizationPercent: 90,
    });
    expect(scheduler.snapshot().throttleReason).toContain(
      "Network threshold reached",
    );
    expect(scheduler.snapshot().throttleReason).toContain(
      "Partial network coverage",
    );
    const waiting = scheduler.acquire("probe");
    controller.abort();
    expect(await waiting).toBe(false);
  });
  it("retains healthy measurements and grows conservatively with partial coverage", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    const measured = capacity(10, 20);
    const partial = {
      ...measured,
      interfaces: [...measured.interfaces, unknownInterface],
    };
    scheduler.updateCapacity(partial);
    expect(scheduler.snapshot()).toMatchObject({
      networkUtilizationPercent: 20,
      workerLimit: 4,
      probeLimit: 8,
    });
    for (let i = 0; i < 300; i++) scheduler.updateCapacity(partial);
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 32,
      probeLimit: 64,
      paused: false,
    });
    expect(scheduler.snapshot().throttleReason).toContain(
      "global network utilization cap not enforceable",
    );
    scheduler.stop();
  });
  it("uses CPU pressure and conservative growth when every network link is unknown", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true, pauseOnHighLoad: true },
      new AbortController().signal,
      vi.fn(),
    );
    const unknownNetwork = { ...capacity(), interfaces: [unknownInterface] };
    scheduler.updateCapacity(unknownNetwork);
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 4,
      probeLimit: 8,
      networkUtilizationPercent: null,
    });
    scheduler.updateCapacity(unknownNetwork);
    scheduler.updateCapacity(unknownNetwork);
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 6,
      probeLimit: 12,
    });
    scheduler.updateCapacity({ ...unknownNetwork, cpuPercent: 90 });
    expect(scheduler.snapshot()).toMatchObject({
      paused: true,
      cpuPercent: 90,
      networkUtilizationPercent: null,
    });
    expect(scheduler.snapshot().throttleReason).toContain(
      "CPU threshold reached",
    );
    scheduler.stop();
  });
  it("enforces independent worker and global/absolute probe ceilings", async () => {
    const controller = new AbortController();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, maxConcurrent: 2, maxPortConcurrent: 8, absoluteMaxProbes: 3 },
      controller.signal,
      vi.fn(),
    );
    expect(await scheduler.acquire("worker")).toBe(true);
    expect(await scheduler.acquire("worker")).toBe(true);
    let worker = false;
    const waitingWorker = scheduler.acquire("worker").then((ok) => {
      worker = ok;
    });
    expect(
      await Promise.all(
        Array.from({ length: 3 }, () => scheduler.acquire("probe")),
      ),
    ).toEqual([true, true, true]);
    let probe = false;
    const waitingProbe = scheduler.acquire("probe").then((ok) => {
      probe = ok;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(worker).toBe(false);
    expect(probe).toBe(false);
    scheduler.release("probe");
    await waitingProbe;
    expect(probe).toBe(true);
    expect(worker).toBe(false);
    scheduler.release("worker");
    await waitingWorker;
    expect(worker).toBe(true);
    scheduler.stop();
  });
  it("paces host and probe launches globally", async () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, workerLaunchIntervalMs: 100, probeLaunchIntervalMs: 40 },
      new AbortController().signal,
      vi.fn(),
    );
    await scheduler.acquire("worker");
    await scheduler.acquire("probe");
    const launched: string[] = [];
    const worker = scheduler
      .acquire("worker")
      .then(() => launched.push("worker"));
    const probe = scheduler.acquire("probe").then(() => launched.push("probe"));
    await vi.advanceTimersByTimeAsync(39);
    expect(launched).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(launched).toEqual(["probe"]);
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([worker, probe]);
    expect(launched).toEqual(["probe", "worker"]);
    scheduler.stop();
  });
  it("pauses admission at CPU/network thresholds and resumes with hysteresis", async () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      {
        ...base,
        adaptiveConcurrency: true,
        maxCpuPercent: 50,
        pauseOnHighLoad: true,
      },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.updateCapacity(capacity(60));
    let launched = false;
    const pending = scheduler.acquire("probe").then(() => {
      launched = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(launched).toBe(false);
    scheduler.updateCapacity(capacity(49));
    await Promise.resolve();
    expect(launched).toBe(false);
    scheduler.updateCapacity(capacity(30));
    await pending;
    expect(launched).toBe(true);
    scheduler.updateCapacity(capacity(10, 90));
    expect(scheduler.snapshot()).toMatchObject({
      paused: true,
      networkUtilizationPercent: 90,
    });
    scheduler.stop();
  });
  it("keeps manual pause independent of fresh capacity and drains on abort", async () => {
    const controller = new AbortController();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      controller.signal,
      vi.fn(),
    );
    await scheduler.acquire("probe");
    scheduler.pause();
    scheduler.updateCapacity(capacity());
    const worker = scheduler.acquire("worker");
    const probe = scheduler.acquire("probe");
    scheduler.release("probe");
    expect(scheduler.snapshot().paused).toBe(true);
    controller.abort();
    expect(await Promise.all([worker, probe])).toEqual([false, false]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("grows only after healthy samples, backs off, and never exceeds caps", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      {
        ...base,
        adaptiveConcurrency: true,
        maxConcurrent: 6,
        absoluteMaxProbes: 10,
      },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.updateCapacity(capacity());
    expect(scheduler.snapshot().workerLimit).toBe(4);
    scheduler.updateCapacity(capacity());
    expect(scheduler.snapshot().workerLimit).toBe(6);
    for (let i = 0; i < 50; i++) scheduler.updateCapacity(capacity());
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 6,
      probeLimit: 10,
    });
    scheduler.backoff();
    expect(scheduler.snapshot()).toMatchObject({
      workerLimit: 3,
      probeLimit: 5,
    });
    scheduler.stop();
  });
  it("reports unavailable metrics explicitly without inventing utilization", () => {
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      vi.fn(),
    );
    scheduler.updateCapacity({
      logicalCpus: 16,
      cpuPercent: null,
      interfaces: [],
    });
    expect(scheduler.snapshot()).toMatchObject({
      cpuPercent: null,
      networkUtilizationPercent: null,
      workerLimit: 4,
      probeLimit: 8,
      paused: false,
    });
    expect(scheduler.snapshot().throttleReason).toContain("not enforceable");
    scheduler.updateCapacity({
      ...capacity(),
      interfaces: [
        {
          name: "unknown",
          linkSpeedMbps: null,
          receiveBytesPerSecond: 0,
          transmitBytesPerSecond: 0,
        },
      ],
    });
    expect(scheduler.snapshot().networkUtilizationPercent).toBeNull();
    scheduler.stop();
  });
  it("samples at about one second, stops polling, and ignores late samples", async () => {
    const publish = vi.fn();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      new AbortController().signal,
      publish,
    );
    const read = vi.fn().mockResolvedValue(capacity());
    await scheduler.startSampling(read);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    scheduler.stop();
    const calls = publish.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses a bounded initial wait and never overlaps stalled capacity IPC", async () => {
    const controller = new AbortController();
    const publish = vi.fn();
    const scheduler = new AdaptiveDiscoveryScheduler(
      { ...base, adaptiveConcurrency: true },
      controller.signal,
      publish,
    );
    let finish!: (value: DiscoveryCapacity) => void;
    const read = vi.fn(
      () =>
        new Promise<DiscoveryCapacity>((resolve) => {
          finish = resolve;
        }),
    );
    const started = scheduler.startSampling(read);
    await vi.advanceTimersByTimeAsync(1500);
    await started;
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(1);
    controller.abort();
    const calls = publish.mock.calls.length;
    finish(capacity());
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
