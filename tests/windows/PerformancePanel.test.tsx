import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PerformancePanel from "../../src/components/windows/panels/PerformancePanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { SystemPerformanceSnapshot } from "../../src/types/windows/winmgmt";

const makeSnapshot = (overrides: Partial<SystemPerformanceSnapshot> = {}): SystemPerformanceSnapshot => ({
  timestamp: "2026-03-30T12:00:00.000Z",
  cpu: {
    totalUsagePercent: 42.5,
    perCoreUsage: [35, 50],
    privilegedTimePercent: 10,
    userTimePercent: 30,
    interruptTimePercent: 1,
    dpcTimePercent: 0.5,
    idleTimePercent: 57.5,
    processorQueueLength: 0,
    contextSwitchesPerSec: 1200,
    systemCallsPerSec: 5000,
  },
  memory: {
    totalPhysicalBytes: 17179869184,
    availableBytes: 8589934592,
    usedPercent: 50.0,
    committedBytes: 10737418240,
    commitLimit: 21474836480,
    pagesPerSec: 100,
    pageFaultsPerSec: 200,
    cacheBytes: 4294967296,
    poolPagedBytes: 536870912,
    poolNonpagedBytes: 268435456,
  },
  disks: [],
  network: [],
  system: {
    processes: 120,
    threads: 1500,
    systemUpTime: 90000,
    fileDataOperationsPerSec: 50,
    fileReadOperationsPerSec: 30,
    fileWriteOperationsPerSec: 20,
    handleCount: 45000,
  },
  ...overrides,
});

describe("PerformancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders performance metrics display", async () => {
    const snapshot = makeSnapshot();
    const cmd = vi.fn(async () => snapshot);
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<PerformancePanel ctx={ctx} />);

    expect(cmd).toHaveBeenCalledWith("winmgmt_perf_snapshot");

    await waitFor(() => {
      expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    });

    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Processes")).toBeInTheDocument();
  });

  it("shows loading state while fetching metrics", async () => {
    let resolveSnap: (val: SystemPerformanceSnapshot) => void;
    const cmd = vi.fn(
      () => new Promise<SystemPerformanceSnapshot>((r) => { resolveSnap = r; }),
    );
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    const { container } = render(<PerformancePanel ctx={ctx} />);

    // Should show the loading spinner (Loader2 renders an svg with animate-spin)
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    resolveSnap!(makeSnapshot());

    await waitFor(() => {
      expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    });
  });

  it("displays CPU and memory values when data loaded", async () => {
    const snapshot = makeSnapshot({
      cpu: {
        ...makeSnapshot().cpu,
        totalUsagePercent: 73.2,
      },
      memory: {
        ...makeSnapshot().memory,
        usedPercent: 61.4,
        availableBytes: 6442450944,
      },
    });
    const cmd = vi.fn(async () => snapshot);
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<PerformancePanel ctx={ctx} />);

    expect(await screen.findByText("73.2%")).toBeInTheDocument();
    expect(screen.getByText("61.4%")).toBeInTheDocument();
    expect(screen.getByText(/6\.0.* GB available/i)).toBeInTheDocument();
  });

  it("has accessible table/display structure", async () => {
    const snapshot = makeSnapshot();
    const cmd = vi.fn(async () => snapshot);
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<PerformancePanel ctx={ctx} />);

    await waitFor(() => {
      expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    });

    // Refresh and auto-refresh buttons should be present
    expect(screen.getByTitle("Refresh now")).toBeInTheDocument();
    expect(screen.getByText(/Live|Paused/i)).toBeInTheDocument();

    // Metric cards display correct labels
    expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Processes")).toBeInTheDocument();
    expect(screen.getByText("Handles")).toBeInTheDocument();
  });
});
