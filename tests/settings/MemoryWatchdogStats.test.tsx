import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchdogModule = vi.hoisted(() => ({
  getMemoryWatchdog: vi.fn(),
}));

vi.mock("../../src/utils/debug/memoryWatchdog", () => ({
  getMemoryWatchdog: watchdogModule.getMemoryWatchdog,
}));

import { MemoryWatchdogStats } from "../../src/components/SettingsDialog/sections/MemoryWatchdogStats";
import type { MemoryWatchdogSnapshot } from "../../src/utils/debug/memoryWatchdog";

function snapshot(
  overrides: Partial<MemoryWatchdogSnapshot> = {},
): MemoryWatchdogSnapshot {
  return {
    running: true,
    heapAvailable: true,
    severity: "normal",
    source: "heap",
    stats: {
      usedMb: 412.3,
      totalMb: 500,
      limitMb: 2048,
      heapPct: 20,
      timestamp: 1_700_000_000_000,
      trend: "stable",
      growthRateMbPerSec: 0.12,
      system: { totalGb: 31.9, usedGb: 18.4, usedPct: 58 },
      ...(overrides.stats ?? {}),
    },
    thresholds: {
      intervalMs: 5000,
      warningMb: 512,
      criticalMb: 1024,
      killMb: 1800,
      systemWarningPct: 85,
      systemKillPct: 95,
      windowLabel: "main",
      ...(overrides.thresholds ?? {}),
    },
    ...overrides,
  } as MemoryWatchdogSnapshot;
}

/** Minimal stand-in for the watchdog: only the readout API is consumed. */
function mockWatchdog(value: MemoryWatchdogSnapshot) {
  const getSnapshot = vi.fn(() => value);
  watchdogModule.getMemoryWatchdog.mockReturnValue({ getSnapshot });
  return getSnapshot;
}

describe("MemoryWatchdogStats", () => {
  beforeEach(() => {
    watchdogModule.getMemoryWatchdog.mockReset();
    watchdogModule.getMemoryWatchdog.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders live heap and system values against their thresholds", () => {
    mockWatchdog(snapshot());

    render(<MemoryWatchdogStats />);

    expect(screen.getByTestId("memory-watchdog-stats")).toBeTruthy();
    expect(screen.getByTestId("memory-watchdog-severity").textContent).toBe(
      "Normal",
    );
    const heap = screen.getByTestId("memory-watchdog-heap");
    expect(heap.textContent).toBe("412.3 MB / 2048.0 MB limit (20%)");
    expect(heap.parentElement?.textContent).toContain(
      "Warning 512 MB · Critical 1024 MB · Pressure 1800 MB",
    );
    const system = screen.getByTestId("memory-watchdog-system");
    expect(system.textContent).toBe("58% (18.4 GB / 31.9 GB)");
    expect(system.parentElement?.textContent).toContain(
      "Warning 85% · Pressure 95%",
    );
    expect(screen.getByTestId("memory-watchdog-trend").textContent).toBe(
      "stable (+0.12 MB/s)",
    );
    expect(screen.getByTestId("memory-watchdog-window").textContent).toBe(
      "main",
    );
    expect(screen.queryByTestId("memory-watchdog-stats-idle")).toBeNull();
  });

  it("reports the configured severity when a threshold is exceeded", () => {
    mockWatchdog(
      snapshot({
        severity: "critical",
        source: "both",
        stats: {
          usedMb: 1500,
          totalMb: 1600,
          limitMb: 2048,
          heapPct: 73,
          timestamp: 1_700_000_000_000,
          trend: "rising",
          growthRateMbPerSec: 4.5,
          system: { totalGb: 31.9, usedGb: 28.4, usedPct: 89 },
        },
      }),
    );

    render(<MemoryWatchdogStats />);

    expect(screen.getByTestId("memory-watchdog-severity").textContent).toBe(
      "Critical",
    );
    expect(screen.getByTestId("memory-watchdog-heap").textContent).toBe(
      "1500.0 MB / 2048.0 MB limit (73%)",
    );
    expect(screen.getByTestId("memory-watchdog-trend").textContent).toBe(
      "rising (+4.50 MB/s)",
    );
    expect(
      screen.getByTestId("memory-watchdog-trend").parentElement?.textContent,
    ).toContain("Pressure source: both");
  });

  it("says the watchdog is not running instead of showing zeros", () => {
    watchdogModule.getMemoryWatchdog.mockReturnValue(null);

    render(<MemoryWatchdogStats />);

    const idle = screen.getByTestId("memory-watchdog-stats-idle");
    expect(idle.textContent).toContain("not running");
    expect(screen.queryByTestId("memory-watchdog-stats")).toBeNull();
    expect(screen.queryByTestId("memory-watchdog-severity")).toBeNull();
    expect(screen.queryByText(/0\.0 MB/)).toBeNull();
  });

  it("treats an existing but stopped watchdog as not running", () => {
    mockWatchdog(snapshot({ running: false }));

    render(<MemoryWatchdogStats />);

    expect(screen.getByTestId("memory-watchdog-stats-idle")).toBeTruthy();
    expect(screen.queryByTestId("memory-watchdog-stats")).toBeNull();
  });

  it("reports heap metrics as unavailable rather than as zero", () => {
    mockWatchdog(
      snapshot({
        heapAvailable: false,
        stats: {
          usedMb: 0,
          totalMb: 0,
          limitMb: 0,
          heapPct: 0,
          timestamp: 1_700_000_000_000,
          trend: "stable",
          growthRateMbPerSec: 0,
          system: { totalGb: 31.9, usedGb: 18.4, usedPct: 58 },
        },
      }),
    );

    render(<MemoryWatchdogStats />);

    const heap = screen.getByTestId("memory-watchdog-heap");
    expect(heap.textContent).toBe("unavailable in this runtime");
    expect(heap.parentElement?.textContent).toContain(
      "performance.memory is not exposed here",
    );
    expect(screen.getByTestId("memory-watchdog-trend").textContent).toBe(
      "unavailable in this runtime",
    );
    // The system probe is independent of performance.memory.
    expect(screen.getByTestId("memory-watchdog-system").textContent).toBe(
      "58% (18.4 GB / 31.9 GB)",
    );
  });

  it("reports an undelivered system sample as unavailable", () => {
    mockWatchdog(
      snapshot({
        stats: {
          usedMb: 412.3,
          totalMb: 500,
          limitMb: 2048,
          heapPct: 20,
          timestamp: 1_700_000_000_000,
          trend: "stable",
          growthRateMbPerSec: 0.12,
          system: null,
        },
      }),
    );

    render(<MemoryWatchdogStats />);

    const system = screen.getByTestId("memory-watchdog-system");
    expect(system.textContent).toBe("unavailable");
    expect(system.parentElement?.textContent).toContain(
      "No system sample delivered yet",
    );
  });

  it("polls no faster than once per second and refreshes changed values", () => {
    vi.useFakeTimers();
    let current = snapshot();
    const getSnapshot = vi.fn(() => current);
    watchdogModule.getMemoryWatchdog.mockReturnValue({ getSnapshot });

    render(<MemoryWatchdogStats />);
    const initialCalls = getSnapshot.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(getSnapshot.mock.calls.length).toBe(initialCalls);

    current = snapshot({
      stats: {
        usedMb: 900.5,
        totalMb: 1000,
        limitMb: 2048,
        heapPct: 44,
        timestamp: 1_700_000_001_000,
        trend: "rising",
        growthRateMbPerSec: 2,
        system: { totalGb: 31.9, usedGb: 18.4, usedPct: 58 },
      },
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getSnapshot.mock.calls.length).toBe(initialCalls + 1);
    expect(screen.getByTestId("memory-watchdog-heap").textContent).toBe(
      "900.5 MB / 2048.0 MB limit (44%)",
    );
  });

  it("skips sampling while the document is hidden", () => {
    vi.useFakeTimers();
    const getSnapshot = mockWatchdog(snapshot());
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    render(<MemoryWatchdogStats />);
    const initialCalls = getSnapshot.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getSnapshot.mock.calls.length).toBe(initialCalls);

    visibility.mockReturnValue("visible");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getSnapshot.mock.calls.length).toBe(initialCalls + 1);

    visibility.mockRestore();
  });

  it("re-reads on demand when the refresh button is pressed", () => {
    let current = snapshot();
    const getSnapshot = vi.fn(() => current);
    watchdogModule.getMemoryWatchdog.mockReturnValue({ getSnapshot });

    render(<MemoryWatchdogStats />);

    current = snapshot({ severity: "warning" });
    fireEvent.click(screen.getByTestId("memory-watchdog-refresh"));

    expect(screen.getByTestId("memory-watchdog-severity").textContent).toBe(
      "Warning",
    );
  });

  it("clears its polling timer on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const getSnapshot = mockWatchdog(snapshot());

    const { unmount } = render(<MemoryWatchdogStats />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const callsWhileMounted = getSnapshot.mock.calls.length;

    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getSnapshot.mock.calls.length).toBe(callsWhileMounted);

    clearSpy.mockRestore();
  });
});
