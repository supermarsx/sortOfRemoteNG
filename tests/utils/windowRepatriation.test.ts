import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Monitor } from "@tauri-apps/api/window";

// Mock the Tauri window APIs
const mockCurrentWindow = {
  outerPosition: vi.fn(),
  outerSize: vi.fn(),
  scaleFactor: vi.fn(),
  setPosition: vi.fn().mockResolvedValue(undefined),
  center: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => mockCurrentWindow),
  availableMonitors: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: vi.fn((x: number, y: number) => ({ x, y })),
  LogicalSize: vi.fn((w: number, h: number) => ({ width: w, height: h })),
}));

import {
  isWindowVisibleOnAnyMonitor,
  findBestMonitor,
  calculateSafePosition,
  checkWindowNeedsRepatriation,
  repatriateWindow,
  validateSavedPosition,
  getMonitorInfo,
  type WindowBounds,
} from "../../src/utils/window/windowRepatriation";
import { availableMonitors } from "@tauri-apps/api/window";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper to create a Monitor-like object for testing.
 */
function makeMonitor(
  x: number, y: number, w: number, h: number,
  opts: { name?: string; scaleFactor?: number } = {},
): Monitor {
  return {
    name: opts.name ?? "Monitor",
    position: { x, y, toLogical: vi.fn(), toPhysical: vi.fn() },
    size: { width: w, height: h, toLogical: vi.fn(), toPhysical: vi.fn() },
    scaleFactor: opts.scaleFactor ?? 1,
    workArea: {
      position: { x, y, toLogical: vi.fn(), toPhysical: vi.fn() },
      size: { width: w, height: h, toLogical: vi.fn(), toPhysical: vi.fn() },
    },
  } as unknown as Monitor;
}

// ---------- isWindowVisibleOnAnyMonitor ----------
describe("isWindowVisibleOnAnyMonitor", () => {
  it("returns true when window is fully inside a monitor", () => {
    const monitors = [makeMonitor(0, 0, 1920, 1080)];
    const bounds: WindowBounds = { x: 100, y: 100, width: 800, height: 600 };
    expect(isWindowVisibleOnAnyMonitor(bounds, monitors)).toBe(true);
  });

  it("returns false when window is completely off-screen", () => {
    const monitors = [makeMonitor(0, 0, 1920, 1080)];
    const bounds: WindowBounds = { x: -5000, y: -5000, width: 800, height: 600 };
    expect(isWindowVisibleOnAnyMonitor(bounds, monitors)).toBe(false);
  });

  it("returns true when window is partially visible (enough area)", () => {
    const monitors = [makeMonitor(0, 0, 1920, 1080)];
    // Window overflows right edge but still has significant overlap
    const bounds: WindowBounds = { x: 1700, y: 100, width: 800, height: 600 };
    expect(isWindowVisibleOnAnyMonitor(bounds, monitors)).toBe(true);
  });

  it("returns false when window has zero overlap", () => {
    const monitors = [makeMonitor(0, 0, 1920, 1080)];
    const bounds: WindowBounds = { x: 2000, y: 0, width: 800, height: 600 };
    expect(isWindowVisibleOnAnyMonitor(bounds, monitors)).toBe(false);
  });

  it("checks across multiple monitors", () => {
    const monitors = [
      makeMonitor(0, 0, 1920, 1080),
      makeMonitor(1920, 0, 1920, 1080),
    ];
    // Window is on the second monitor
    const bounds: WindowBounds = { x: 2000, y: 100, width: 800, height: 600 };
    expect(isWindowVisibleOnAnyMonitor(bounds, monitors)).toBe(true);
  });
});

// ---------- findBestMonitor ----------
describe("findBestMonitor", () => {
  it("returns null when no monitors are available", () => {
    expect(findBestMonitor({ x: 0, y: 0 }, [])).toBeNull();
  });

  it("prefers the primary monitor at (0,0)", () => {
    const primary = makeMonitor(0, 0, 1920, 1080, { name: "Primary" });
    const secondary = makeMonitor(1920, 0, 1920, 1080, { name: "Secondary" });
    const result = findBestMonitor({ x: 2500, y: 500 }, [primary, secondary]);
    expect(result).toBe(primary);
  });

  it("finds closest monitor when no primary at (0,0)", () => {
    const m1 = makeMonitor(1000, 0, 1920, 1080, { name: "Left" });
    const m2 = makeMonitor(3000, 0, 1920, 1080, { name: "Right" });
    const result = findBestMonitor({ x: 3500, y: 500 }, [m1, m2]);
    expect(result).toBe(m2);
  });
});

// ---------- calculateSafePosition ----------
describe("calculateSafePosition", () => {
  it("centers window on the monitor", () => {
    const monitor = makeMonitor(0, 0, 1920, 1080);
    const { x, y } = calculateSafePosition({ width: 800, height: 600 }, monitor);

    // Centered: (1920 - 800) / 2 = 560, (1080 - 600) / 2 = 240
    expect(x).toBe(560);
    expect(y).toBe(240);
  });

  it("clamps window when it exceeds monitor dimensions", () => {
    const monitor = makeMonitor(0, 0, 800, 600);
    const { x, y } = calculateSafePosition(
      { width: 2000, height: 1500 },
      monitor,
      20,
    );
    // effectiveWidth = min(2000, 800 - 40) = 760  → centered at (800-760)/2 = 20
    expect(x).toBe(20);
  });

  it("respects monitor offset", () => {
    const monitor = makeMonitor(1920, 0, 1920, 1080);
    const { x } = calculateSafePosition({ width: 800, height: 600 }, monitor);
    expect(x).toBe(1920 + 560); // 2480
  });
});

// ---------- checkWindowNeedsRepatriation ----------
describe("checkWindowNeedsRepatriation", () => {
  it("returns false when window is visible", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      makeMonitor(0, 0, 1920, 1080),
    ]);
    mockCurrentWindow.outerPosition.mockResolvedValue({
      toLogical: () => ({ x: 100, y: 100 }),
    });
    mockCurrentWindow.outerSize.mockResolvedValue({
      toLogical: () => ({ width: 800, height: 600 }),
    });
    mockCurrentWindow.scaleFactor.mockResolvedValue(1);

    const needs = await checkWindowNeedsRepatriation();
    expect(needs).toBe(false);
  });

  it("returns true when window is off-screen", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      makeMonitor(0, 0, 1920, 1080),
    ]);
    mockCurrentWindow.outerPosition.mockResolvedValue({
      toLogical: () => ({ x: -9999, y: -9999 }),
    });
    mockCurrentWindow.outerSize.mockResolvedValue({
      toLogical: () => ({ width: 800, height: 600 }),
    });
    mockCurrentWindow.scaleFactor.mockResolvedValue(1);

    const needs = await checkWindowNeedsRepatriation();
    expect(needs).toBe(true);
  });

  it("returns false when no monitors available", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([]);
    mockCurrentWindow.outerPosition.mockResolvedValue({
      toLogical: () => ({ x: 0, y: 0 }),
    });
    mockCurrentWindow.outerSize.mockResolvedValue({
      toLogical: () => ({ width: 800, height: 600 }),
    });
    mockCurrentWindow.scaleFactor.mockResolvedValue(1);

    const needs = await checkWindowNeedsRepatriation();
    expect(needs).toBe(false);
  });
});

// ---------- validateSavedPosition ----------
describe("validateSavedPosition", () => {
  it("returns unadjusted when position is on-screen", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      makeMonitor(0, 0, 1920, 1080),
    ]);

    const result = await validateSavedPosition(
      { x: 100, y: 100 },
      { width: 800, height: 600 },
    );

    expect(result).not.toBeNull();
    expect(result!.adjusted).toBe(false);
    expect(result!.position).toEqual({ x: 100, y: 100 });
  });

  it("returns adjusted position when saved position is off-screen", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      makeMonitor(0, 0, 1920, 1080),
    ]);

    const result = await validateSavedPosition(
      { x: -5000, y: -5000 },
      { width: 800, height: 600 },
    );

    expect(result).not.toBeNull();
    expect(result!.adjusted).toBe(true);
    // Position should now be within monitor bounds
    expect(result!.position.x).toBeGreaterThanOrEqual(0);
    expect(result!.position.y).toBeGreaterThanOrEqual(0);
  });

  it("returns null when no monitors are available", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([]);
    const result = await validateSavedPosition(
      { x: 100, y: 100 },
      { width: 800, height: 600 },
    );
    expect(result).toBeNull();
  });
});

// ---------- getMonitorInfo ----------
describe("getMonitorInfo", () => {
  it("returns formatted monitor information", async () => {
    vi.mocked(availableMonitors).mockResolvedValue([
      makeMonitor(0, 0, 1920, 1080, { name: "Primary", scaleFactor: 1.25 }),
    ]);

    const info = await getMonitorInfo();
    expect(info).toHaveLength(1);
    expect(info[0]).toEqual(
      expect.objectContaining({
        name: "Primary",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1.25,
      }),
    );
  });
});
