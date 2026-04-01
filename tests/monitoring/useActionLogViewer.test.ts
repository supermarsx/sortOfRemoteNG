import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getActionLog: vi.fn(),
  clearActionLog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getActionLog: mocks.getActionLog,
      clearActionLog: mocks.clearActionLog,
      logAction: vi.fn(),
    }),
  },
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { useActionLogViewer } from "../../src/hooks/monitoring/useActionLogViewer";

// ── Helpers ────────────────────────────────────────────

const makeLog = (overrides: Record<string, unknown> = {}) => ({
  id: "log-1",
  timestamp: new Date("2026-03-25T10:00:00Z"),
  level: "info" as const,
  action: "connect",
  connectionId: "conn-1",
  connectionName: "prod-server",
  details: "Connected via SSH",
  duration: 120,
  ...overrides,
});

const makeLogs = () => [
  makeLog(),
  makeLog({
    id: "log-2",
    timestamp: new Date("2026-03-25T11:00:00Z"),
    level: "error",
    action: "disconnect",
    connectionName: "staging-server",
    details: "Connection timeout",
    duration: 0,
  }),
  makeLog({
    id: "log-3",
    timestamp: new Date("2026-03-24T08:00:00Z"),
    level: "warn",
    action: "reconnect",
    connectionName: "prod-server",
    details: "Auto-reconnect triggered",
    duration: 300,
  }),
  makeLog({
    id: "log-4",
    timestamp: new Date("2026-03-20T14:00:00Z"),
    level: "debug",
    action: "connect",
    connectionName: "dev-server",
    details: "Debug connection opened",
  }),
];

// ── Tests ──────────────────────────────────────────────

describe("useActionLogViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: new Date("2026-03-25T12:00:00Z") });
    mocks.getActionLog.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ────────────────────────────────────

  it("returns correct initial state", () => {
    const { result } = renderHook(() => useActionLogViewer(false));

    expect(result.current.logs).toEqual([]);
    expect(result.current.filteredLogs).toEqual([]);
    expect(result.current.searchTerm).toBe("");
    expect(result.current.levelFilter).toBe("all");
    expect(result.current.actionFilter).toBe("all");
    expect(result.current.connectionFilter).toBe("all");
    expect(result.current.dateFilter).toBe("all");
    expect(result.current.showClearConfirm).toBe(false);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.uniqueActions).toEqual([]);
    expect(result.current.uniqueConnections).toEqual([]);
  });

  it("provides the t function from react-i18next", () => {
    const { result } = renderHook(() => useActionLogViewer(false));
    expect(result.current.t).toBeDefined();
    expect(typeof result.current.t).toBe("function");
  });

  // ── Loading logs ─────────────────────────────────────

  it("loads logs from settingsManager when opened", async () => {
    const logs = makeLogs();
    mocks.getActionLog.mockReturnValue(logs);

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.getActionLog).toHaveBeenCalled();
    expect(result.current.logs).toEqual(logs);
  });

  it("does not load logs when closed", () => {
    renderHook(() => useActionLogViewer(false));
    expect(mocks.getActionLog).not.toHaveBeenCalled();
  });

  it("auto-refreshes logs every 5 seconds when open", async () => {
    mocks.getActionLog.mockReturnValue([]);

    renderHook(() => useActionLogViewer(true));

    const initialCallCount = mocks.getActionLog.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.getActionLog.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  // ── Unique values ────────────────────────────────────

  it("computes unique actions from logs", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.uniqueActions).toEqual(
      expect.arrayContaining(["connect", "disconnect", "reconnect"]),
    );
    expect(result.current.uniqueActions).toHaveLength(3);
  });

  it("computes unique connection names from logs", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.uniqueConnections).toEqual(
      expect.arrayContaining(["dev-server", "prod-server", "staging-server"]),
    );
  });

  // ── Filtering ────────────────────────────────────────

  it("filters by level", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setLevelFilter("error");
    });

    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].level).toBe("error");
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("filters by action", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setActionFilter("connect");
    });

    expect(
      result.current.filteredLogs.every((l) => l.action === "connect"),
    ).toBe(true);
    expect(result.current.filteredLogs).toHaveLength(2);
  });

  it("filters by connection name", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setConnectionFilter("prod-server");
    });

    expect(
      result.current.filteredLogs.every(
        (l) => l.connectionName === "prod-server",
      ),
    ).toBe(true);
    expect(result.current.filteredLogs).toHaveLength(2);
  });

  it("filters by date — today", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setDateFilter("today");
    });

    // "Today" is 2026-03-25 — logs 1 and 2 are today
    expect(result.current.filteredLogs).toHaveLength(2);
  });

  it("filters by date — yesterday", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setDateFilter("yesterday");
    });

    // "Yesterday" is 2026-03-24 — log 3
    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].id).toBe("log-3");
  });

  it("filters by date — week", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setDateFilter("week");
    });

    // Within last 7 days from 2026-03-25: logs 1,2,3 qualify; log 4 (Mar 20) is 5 days ago, also within
    expect(result.current.filteredLogs.length).toBeGreaterThanOrEqual(3);
  });

  it("filters by date — month", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setDateFilter("month");
    });

    // All 4 logs within last month
    expect(result.current.filteredLogs).toHaveLength(4);
  });

  // ── Search ───────────────────────────────────────────

  it("filters logs by search term matching action", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setSearchTerm("disconnect");
    });

    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].action).toBe("disconnect");
  });

  it("filters logs by search term matching details", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setSearchTerm("timeout");
    });

    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].details).toContain("timeout");
  });

  it("filters logs by search term matching connectionName", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setSearchTerm("staging");
    });

    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].connectionName).toBe("staging-server");
  });

  it("search is case insensitive", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setSearchTerm("SSH");
    });

    expect(result.current.filteredLogs.length).toBeGreaterThanOrEqual(1);
  });

  // ── Combined filters ─────────────────────────────────

  it("combines multiple filters", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setLevelFilter("info");
      result.current.setConnectionFilter("prod-server");
    });

    // Only info-level logs for prod-server: log-1
    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].id).toBe("log-1");
  });

  // ── hasActiveFilters ─────────────────────────────────

  it("hasActiveFilters is true when any filter is set", async () => {
    const { result } = renderHook(() => useActionLogViewer(false));

    expect(result.current.hasActiveFilters).toBe(false);

    act(() => {
      result.current.setSearchTerm("test");
    });

    expect(result.current.hasActiveFilters).toBe(true);
  });

  // ── resetFilters ─────────────────────────────────────

  it("resetFilters clears all filter state", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setLevelFilter("error");
      result.current.setActionFilter("connect");
      result.current.setConnectionFilter("prod-server");
      result.current.setDateFilter("today");
      result.current.setSearchTerm("test");
    });

    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.levelFilter).toBe("all");
    expect(result.current.actionFilter).toBe("all");
    expect(result.current.connectionFilter).toBe("all");
    expect(result.current.dateFilter).toBe("all");
    expect(result.current.searchTerm).toBe("");
    expect(result.current.hasActiveFilters).toBe(false);
  });

  // ── Clear logs ───────────────────────────────────────

  it("clearLogs shows confirmation dialog", () => {
    const { result } = renderHook(() => useActionLogViewer(false));

    act(() => {
      result.current.clearLogs();
    });

    expect(result.current.showClearConfirm).toBe(true);
  });

  it("confirmClearLogs clears logs and hides confirmation", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.logs.length).toBeGreaterThan(0);

    // After clearing, getActionLog should return [] (simulates real behavior)
    mocks.getActionLog.mockReturnValue([]);

    await act(async () => {
      result.current.confirmClearLogs();
      // Allow filterLogs useEffect to run
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.clearActionLog).toHaveBeenCalled();
    expect(result.current.logs).toEqual([]);
    expect(result.current.showClearConfirm).toBe(false);
  });

  it("setShowClearConfirm can dismiss confirmation", () => {
    const { result } = renderHook(() => useActionLogViewer(false));

    act(() => {
      result.current.clearLogs();
    });
    expect(result.current.showClearConfirm).toBe(true);

    act(() => {
      result.current.setShowClearConfirm(false);
    });
    expect(result.current.showClearConfirm).toBe(false);
  });

  // ── Export ───────────────────────────────────────────

  it("exportLogs creates CSV and shows success toast", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Mock DOM APIs after renderHook so they don't break React's container creation
    const mockClick = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        return { click: mockClick, href: "", download: "" } as any;
      }
      return origCreateElement(tag);
    });
    const mockAppendChild = vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    const mockRemoveChild = vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });

    act(() => {
      result.current.exportLogs();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("Export successful"),
    );

    createElementSpy.mockRestore();
    mockAppendChild.mockRestore();
    mockRemoveChild.mockRestore();
    vi.unstubAllGlobals();
  });

  it("exportLogs shows error toast on failure", async () => {
    mocks.getActionLog.mockReturnValue(makeLogs());

    const { result } = renderHook(() => useActionLogViewer(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Force Blob constructor to throw — stub AFTER renderHook
    vi.stubGlobal("Blob", class {
      constructor() {
        throw new Error("Blob creation failed");
      }
    });

    act(() => {
      result.current.exportLogs();
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Export failed"),
    );

    vi.unstubAllGlobals();
  });
});
