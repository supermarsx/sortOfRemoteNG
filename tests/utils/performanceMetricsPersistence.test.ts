import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { PerformanceMetrics } from "../../src/types/settings/settings";

const metric = (timestamp: number): PerformanceMetrics => ({
  timestamp,
  source: "connection-timing",
  connectionTime: 100,
  latency: null,
  throughput: null,
  dataTransferred: null,
  cpuUsage: null,
  memoryUsage: null,
});

describe("performance metric persistence", () => {
  beforeEach(() => SettingsManager.resetInstance());
  afterEach(() => vi.restoreAllMocks());

  it("serializes slow writes and coalesces a clear into the next latest snapshot", async () => {
    const releases: Array<() => void> = [];
    const snapshots: PerformanceMetrics[][] = [];
    let active = 0;
    let maxActive = 0;
    vi.spyOn(IndexedDbService, "setItem").mockImplementation(
      async (key, value) => {
        if (key !== "mremote-performance-metrics") return;
        snapshots.push(value as PerformanceMetrics[]);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
      },
    );
    const manager = SettingsManager.getInstance();
    manager.getSettings().enablePerformanceTracking = true;
    manager.recordPerformanceMetric(metric(1));
    manager.recordPerformanceMetric(metric(2));
    manager.clearPerformanceMetrics();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual([metric(1)]);
    releases.shift()!();
    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toEqual([]);
    expect(maxActive).toBe(1);
    releases.shift()!();
    await vi.waitFor(() => expect(active).toBe(0));
    expect(manager.getPerformanceMetrics()).toEqual([]);
  });
});
