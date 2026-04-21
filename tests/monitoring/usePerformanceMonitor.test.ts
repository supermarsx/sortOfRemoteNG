import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  getPerformanceMetrics: vi.fn(),
  recordPerformanceMetric: vi.fn(),
  clearPerformanceMetrics: vi.fn(),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: mocks.getSettings,
      loadSettings: mocks.loadSettings,
      saveSettings: mocks.saveSettings,
      getPerformanceMetrics: mocks.getPerformanceMetrics,
      recordPerformanceMetric: mocks.recordPerformanceMetric,
      clearPerformanceMetrics: mocks.clearPerformanceMetrics,
      logAction: vi.fn(),
    }),
  },
}));

import { usePerformanceMonitor } from "../../src/hooks/monitoring/usePerformanceMonitor";

const mockInvoke = vi.mocked(invoke);

// ── Helpers ────────────────────────────────────────────

const makeMetric = (overrides: Record<string, unknown> = {}) => ({
  connectionTime: 100,
  dataTransferred: 2048,
  latency: 25,
  throughput: 800,
  cpuUsage: 30,
  memoryUsage: 55,
  timestamp: Date.now(),
  ...overrides,
});

const defaultSettings = {
  performancePollIntervalMs: 20000,
  performanceLatencyTarget: "1.1.1.1",
};

// ── Tests ──────────────────────────────────────────────

describe("usePerformanceMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue(defaultSettings);
    mocks.loadSettings.mockResolvedValue(defaultSettings);
    mocks.getPerformanceMetrics.mockReturnValue([]);
    mocks.saveSettings.mockResolvedValue(undefined);

    // Backend metrics succeed by default so the hook doesn't call fetch
    mockInvoke.mockResolvedValue(makeMetric() as never);

    // Stub fetch too in case fallback is triggered
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Initial state (isOpen=false, no side effects) ────

  it("returns correct initial state when closed", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    expect(result.current.metrics).toEqual([]);
    expect(result.current.currentMetrics).toBeNull();
    expect(result.current.pollIntervalMs).toBe(20000);
    expect(result.current.metricFilter).toBe("all");
    expect(result.current.timeRangeFilter).toBe("all");
    expect(result.current.showClearConfirm).toBe(false);
  });

  it("reads poll interval from settings on init", () => {
    mocks.getSettings.mockReturnValue({
      performancePollIntervalMs: 5000,
      performanceLatencyTarget: "8.8.8.8",
    });

    const { result } = renderHook(() => usePerformanceMonitor(false));
    expect(result.current.pollIntervalMs).toBe(5000);
  });

  it("returns 0 averages when no metrics exist", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    expect(result.current.avgLatency).toBe(0);
    expect(result.current.avgThroughput).toBe(0);
    expect(result.current.avgCpuUsage).toBe(0);
    expect(result.current.avgMemoryUsage).toBe(0);
  });

  it("formatBytes formats byte values correctly", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    expect(result.current.formatBytes(0)).toBe("0 B");
    expect(result.current.formatBytes(1024)).toBe("1 KB");
    expect(result.current.formatBytes(1048576)).toBe("1 MB");
    expect(result.current.formatBytes(1073741824)).toBe("1 GB");
    expect(result.current.formatBytes(512)).toBe("512 B");
  });

  it("formatDuration formats milliseconds correctly", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    expect(result.current.formatDuration(500)).toBe("500ms");
    expect(result.current.formatDuration(1500)).toBe("1.5s");
    expect(result.current.formatDuration(0)).toBe("0ms");
    expect(result.current.formatDuration(999)).toBe("999ms");
    expect(result.current.formatDuration(60000)).toBe("60.0s");
  });

  it("setMetricFilter updates metric filter", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.setMetricFilter("latency");
    });

    expect(result.current.metricFilter).toBe("latency");
  });

  it("setTimeRangeFilter updates time range filter", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.setTimeRangeFilter("1h");
    });

    expect(result.current.timeRangeFilter).toBe("1h");
  });

  it("handlePollIntervalChange updates poll interval and saves to settings", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.handlePollIntervalChange(10);
    });

    expect(result.current.pollIntervalMs).toBe(10000);
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      { performancePollIntervalMs: 10000 },
      { silent: true },
    );
  });

  it("handlePollIntervalChange enforces minimum 1 second", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.handlePollIntervalChange(0);
    });

    expect(result.current.pollIntervalMs).toBe(1000);
  });

  it("clearMetrics clears stored metrics and resets state", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.clearMetrics();
    });

    expect(mocks.clearPerformanceMetrics).toHaveBeenCalled();
    expect(result.current.metrics).toEqual([]);
    expect(result.current.showClearConfirm).toBe(false);
  });

  it("setShowClearConfirm toggles the confirmation state", () => {
    const { result } = renderHook(() => usePerformanceMonitor(false));

    act(() => {
      result.current.setShowClearConfirm(true);
    });
    expect(result.current.showClearConfirm).toBe(true);

    act(() => {
      result.current.setShowClearConfirm(false);
    });
    expect(result.current.showClearConfirm).toBe(false);
  });

  // ── Data loading (isOpen=true) ───────────────────────

  it("loads stored metrics when opened", async () => {
    const storedMetrics = [makeMetric(), makeMetric({ timestamp: Date.now() - 1000 })];
    mocks.getPerformanceMetrics.mockReturnValue(storedMetrics);

    renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(mocks.getPerformanceMetrics).toHaveBeenCalled();
    });
  });

  it("fetches backend metrics via invoke when available", async () => {
    const backendMetric = makeMetric({ cpuUsage: 45, memoryUsage: 70 });
    mockInvoke.mockResolvedValueOnce(backendMetric as never);

    renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_system_metrics");
    });
  });

  it("records metrics after successful invoke call", async () => {
    const backendMetric = makeMetric({ cpuUsage: 45 });
    mockInvoke.mockResolvedValue(backendMetric as never);

    renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(mocks.recordPerformanceMetric).toHaveBeenCalled();
    });
  });

  it("falls back to browser sampling when invoke fails", async () => {
    mockInvoke.mockRejectedValue(new Error("no backend") as never);

    renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(mocks.recordPerformanceMetric).toHaveBeenCalled();
    });
  });

  it("loads settings on open", async () => {
    mocks.loadSettings.mockResolvedValue({
      performancePollIntervalMs: 10000,
      performanceLatencyTarget: "8.8.8.8",
    });

    renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(mocks.loadSettings).toHaveBeenCalled();
    });
  });

  // ── Filtered/derived state ───────────────────────────

  it("filteredMetrics filters by time range", async () => {
    const now = Date.now();
    const recentMetric = makeMetric({ timestamp: now - 1000 });
    const oldMetric = makeMetric({ timestamp: now - 8 * 24 * 60 * 60 * 1000 });
    mocks.getPerformanceMetrics.mockReturnValue([recentMetric, oldMetric]);

    const { result } = renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(result.current.metrics.length).toBeGreaterThanOrEqual(2);
    });

    expect(result.current.filteredMetrics.length).toBeGreaterThanOrEqual(2);

    act(() => {
      result.current.setTimeRangeFilter("1h");
    });

    expect(result.current.filteredMetrics.length).toBe(1);
  });

  it("recentMetrics returns at most 10 items", async () => {
    const manyMetrics = Array.from({ length: 15 }, (_, i) =>
      makeMetric({ timestamp: Date.now() - i * 1000 }),
    );
    mocks.getPerformanceMetrics.mockReturnValue(manyMetrics);

    const { result } = renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(result.current.metrics.length).toBe(15);
    });

    expect(result.current.recentMetrics.length).toBeLessThanOrEqual(10);
  });

  it("computes average latency from metrics", async () => {
    const metrics = [
      makeMetric({ latency: 10, timestamp: Date.now() }),
      makeMetric({ latency: 30, timestamp: Date.now() - 500 }),
    ];
    mocks.getPerformanceMetrics.mockReturnValue(metrics);

    const { result } = renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(result.current.metrics.length).toBe(2);
    });

    expect(result.current.avgLatency).toBe(20);
  });

  it("does not poll when closed", async () => {
    renderHook(() => usePerformanceMonitor(false));

    await new Promise((r) => setTimeout(r, 50));

    expect(mocks.recordPerformanceMetric).not.toHaveBeenCalled();
  });

  it("exportMetrics does not throw", async () => {
    const metrics = [makeMetric({ timestamp: 1700000000000 })];
    mocks.getPerformanceMetrics.mockReturnValue(metrics);

    const { result } = renderHook(() => usePerformanceMonitor(true));

    await waitFor(() => {
      expect(result.current.metrics.length).toBeGreaterThanOrEqual(1);
    });

    // Mock DOM APIs after renderHook so they don't break React's container creation
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        return { click: vi.fn(), href: "", download: "" } as any;
      }
      return origCreateElement(tag);
    });
    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    const removeSpy = vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:url"),
      revokeObjectURL: vi.fn(),
    });

    act(() => {
      result.current.exportMetrics();
    });

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
