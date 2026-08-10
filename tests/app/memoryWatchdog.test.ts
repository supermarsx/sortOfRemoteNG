import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import {
  getMemoryWatchdog,
  normalizeMemoryWatchdogConfig,
  startMemoryWatchdog,
  stopMemoryWatchdog,
  type MemoryWatchdogStatus,
} from "../../src/utils/debug/memoryWatchdog";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const heap = {
  usedJSHeapSize: 32 * MB,
  totalJSHeapSize: 64 * MB,
  jsHeapSizeLimit: 2048 * MB,
};

let visibility: DocumentVisibilityState = "visible";
let visibilitySpy: ReturnType<typeof vi.spyOn>;

function systemMemory(usedPct: number) {
  return {
    total_bytes: 100 * GB,
    used_bytes: usedPct * GB,
    available_bytes: (100 - usedPct) * GB,
  };
}

async function flushImmediateWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    await Promise.resolve();
  }
}

describe("MemoryWatchdog lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:00:00.000Z"));
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(systemMemory(40));
    heap.usedJSHeapSize = 32 * MB;
    heap.totalJSHeapSize = 64 * MB;
    heap.jsHeapSizeLimit = 2048 * MB;
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: heap,
    });
    visibility = "visible";
    visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility);
  });

  afterEach(() => {
    stopMemoryWatchdog();
    vi.clearAllTimers();
    visibilitySpy.mockRestore();
    vi.useRealTimers();
  });

  it("normalizes non-finite, out-of-range, and misordered settings safely", () => {
    expect(
      normalizeMemoryWatchdogConfig({
        intervalMs: Number.NaN,
        warningMb: Number.POSITIVE_INFINITY,
        criticalMb: 100,
        killMb: 50,
        systemWarningPct: 101,
        systemKillPct: 20,
        systemProbeTimeoutMs: Number.NEGATIVE_INFINITY,
      }),
    ).toMatchObject({
      intervalMs: 5000,
      warningMb: 512,
      criticalMb: 1024,
      killMb: 1800,
      systemWarningPct: 85,
      systemKillPct: 95,
      systemProbeTimeoutMs: 4000,
    });

    expect(
      normalizeMemoryWatchdogConfig({
        intervalMs: 1,
        warningMb: 64,
        criticalMb: 128,
        killMb: 256,
        systemWarningPct: 80,
        systemKillPct: 90,
        systemProbeTimeoutMs: 99_000,
      }),
    ).toMatchObject({
      intervalMs: 1000,
      warningMb: 64,
      criticalMb: 128,
      killMb: 256,
      systemWarningPct: 80,
      systemKillPct: 90,
      systemProbeTimeoutMs: 30_000,
    });
  });

  it("enables, applies ordered settings live, and disables cleanly", async () => {
    const statuses: MemoryWatchdogStatus[] = [];
    const first = startMemoryWatchdog({
      intervalMs: 5000,
      warningMb: 512,
      criticalMb: 1024,
      killMb: 1800,
      onStatusChange: (status) => statuses.push(status),
    });
    await flushImmediateWork();
    expect(statuses).toEqual([]);

    heap.usedJSHeapSize = 300 * MB;
    const second = startMemoryWatchdog({
      intervalMs: 2500,
      warningMb: 64,
      criticalMb: 128,
      killMb: 256,
      onStatusChange: (status) => statuses.push(status),
    });
    expect(second).toBe(first);
    await flushImmediateWork();
    expect(statuses[statuses.length - 1]).toMatchObject({
      severity: "pressure",
      source: "heap",
    });

    const callsAtDisable = tauri.invoke.mock.calls.length;
    stopMemoryWatchdog(first);
    expect(getMemoryWatchdog()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tauri.invoke).toHaveBeenCalledTimes(callsAtDisable);
  });

  it("does not let a duplicate owner reconfigure or stop the active monitor", async () => {
    heap.usedJSHeapSize = 300 * MB;
    const firstOwner = Symbol("first-owner");
    const duplicateOwner = Symbol("duplicate-owner");
    const firstStatuses: MemoryWatchdogStatus[] = [];
    const duplicateStatuses: MemoryWatchdogStatus[] = [];
    const first = startMemoryWatchdog(
      {
        warningMb: 512,
        criticalMb: 1024,
        killMb: 1800,
        onStatusChange: (status) => firstStatuses.push(status),
      },
      firstOwner,
    );
    const duplicate = startMemoryWatchdog(
      {
        warningMb: 64,
        criticalMb: 128,
        killMb: 256,
        onStatusChange: (status) => duplicateStatuses.push(status),
      },
      duplicateOwner,
    );

    expect(duplicate).toBe(first);
    await flushImmediateWork();
    expect(firstStatuses).toEqual([]);
    expect(duplicateStatuses).toEqual([]);

    stopMemoryWatchdog(duplicate, duplicateOwner);
    expect(getMemoryWatchdog()).toBe(first);
    stopMemoryWatchdog(first, firstOwner);
    expect(getMemoryWatchdog()).toBeNull();
  });

  it("samples heap during a hung native probe and restart never adopts it", async () => {
    let resolveHungProbe!: (value: ReturnType<typeof systemMemory>) => void;
    const hungProbe = new Promise<ReturnType<typeof systemMemory>>(
      (resolve) => {
        resolveHungProbe = resolve;
      },
    );
    tauri.invoke.mockImplementationOnce(() => hungProbe);
    heap.usedJSHeapSize = 300 * MB;
    const firstStatuses: MemoryWatchdogStatus[] = [];

    startMemoryWatchdog({
      intervalMs: 1000,
      warningMb: 64,
      criticalMb: 128,
      killMb: 256,
      systemProbeTimeoutMs: 100,
      onStatusChange: (status) => firstStatuses.push(status),
    });
    await flushImmediateWork();
    expect(firstStatuses[0]).toMatchObject({ severity: "pressure" });
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    stopMemoryWatchdog();

    const restartedStatuses: MemoryWatchdogStatus[] = [];
    startMemoryWatchdog({
      intervalMs: 1000,
      warningMb: 64,
      criticalMb: 128,
      killMb: 256,
      systemProbeTimeoutMs: 100,
      onStatusChange: (status) => restartedStatuses.push(status),
    });
    await flushImmediateWork();
    expect(restartedStatuses[0]).toMatchObject({ severity: "pressure" });
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    resolveHungProbe(systemMemory(40));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await flushImmediateWork();
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
  });

  it("suppresses heap and system probes while hidden, then resumes", async () => {
    visibility = "hidden";
    startMemoryWatchdog({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tauri.invoke).not.toHaveBeenCalled();

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushImmediateWork();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushImmediateWork();
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
  });

  it("fences an in-flight result after cleanup and performs no later writes", async () => {
    let resolveProbe!: (value: ReturnType<typeof systemMemory>) => void;
    tauri.invoke.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof systemMemory>>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const onStatusChange = vi.fn();
    startMemoryWatchdog({
      intervalMs: 1000,
      systemProbeTimeoutMs: 500,
      onStatusChange,
    });
    await flushImmediateWork();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    stopMemoryWatchdog();
    resolveProbe(systemMemory(99));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(getMemoryWatchdog()).toBeNull();
  });

  it("signals system pressure and recovery without replacing application DOM", async () => {
    tauri.invoke
      .mockResolvedValueOnce(systemMemory(96))
      .mockResolvedValueOnce(systemMemory(40));
    const statuses: MemoryWatchdogStatus[] = [];
    const onKill = vi.fn();
    const appRoot = document.createElement("div");
    appRoot.id = "application-root";
    appRoot.textContent = "active session";
    document.body.appendChild(appRoot);

    const watchdog = startMemoryWatchdog({
      intervalMs: 1000,
      systemWarningPct: 85,
      systemKillPct: 95,
      onKill,
      onStatusChange: (status) => statuses.push(status),
    });
    await flushImmediateWork();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect((await watchdog.getStats())?.system?.usedPct).toBe(96);
    await vi.advanceTimersByTimeAsync(0);
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(statuses[0]?.severity).toBe("pressure");
    expect(document.getElementById("application-root")).toBe(appRoot);

    await vi.advanceTimersByTimeAsync(1000);
    await flushImmediateWork();
    expect((await watchdog.getStats())?.system?.usedPct).toBe(40);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses[statuses.length - 1]?.severity).toBe("recovered");
    expect(document.getElementById("application-root")).toBe(appRoot);
    expect(appRoot.textContent).toBe("active session");
    appRoot.remove();
  });
});
