import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useDashboard } from "../../src/hooks/monitoring/useDashboard";

const mockInvoke = vi.mocked(invoke);

const makeState = (overrides: Record<string, unknown> = {}) => ({
  monitoring: true,
  lastRefresh: "2026-03-30T00:00:00Z",
  connectionCount: 10,
  healthyCount: 8,
  unhealthyCount: 2,
  alertCount: 1,
  ...overrides,
});

const makeHealthEntry = (overrides: Record<string, unknown> = {}) => ({
  connectionId: "conn-1",
  connectionName: "Server A",
  protocol: "ssh",
  status: "healthy",
  latencyMs: 25,
  lastCheck: "2026-03-30T00:00:00Z",
  uptimePercent: 99.9,
  ...overrides,
});

const makeAlert = (overrides: Record<string, unknown> = {}) => ({
  id: "alert-1",
  connectionId: "conn-1",
  connectionName: "Server A",
  severity: "warning",
  message: "High latency detected",
  createdAt: "2026-03-30T00:00:00Z",
  acknowledged: false,
  ...overrides,
});

const makeQuickStats = (overrides: Record<string, unknown> = {}) => ({
  totalConnections: 20,
  healthyCount: 18,
  unhealthyCount: 2,
  avgLatencyMs: 45,
  uptimePercent: 98.5,
  ...overrides,
});

describe("useDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- initial state ---

  it("has correct initial state", () => {
    const { result } = renderHook(() => useDashboard());
    expect(result.current.state).toBeNull();
    expect(result.current.healthEntries).toEqual([]);
    expect(result.current.sparklines).toEqual({});
    expect(result.current.heatmap).toEqual([]);
    expect(result.current.quickStats).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("has default config", () => {
    const { result } = renderHook(() => useDashboard());
    expect(result.current.config).toEqual({
      enabled: true,
      refreshIntervalMs: 30000,
      healthCheckTimeoutMs: 5000,
      maxSparklinePoints: 60,
      parallelChecks: 10,
      showOnStartup: false,
    });
  });

  it("has default layout with 6 widgets", () => {
    const { result } = renderHook(() => useDashboard());
    expect(result.current.layout.widgets).toHaveLength(6);
    expect(result.current.layout.columns).toBe(12);
    expect(result.current.layout.rowHeight).toBe(80);
    expect(result.current.layout.widgets.map((w: { id: string }) => w.id)).toEqual([
      "summary", "alerts", "stats", "heatmap", "recent", "sparklines",
    ]);
  });

  // --- fetchState ---

  it("fetchState sets state on success", async () => {
    const state = makeState();
    mockInvoke.mockResolvedValueOnce(state as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchState(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_state");
    expect(result.current.state).toEqual(state);
  });

  it("fetchState sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("State error");

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchState(); });

    expect(result.current.error).toBe("State error");
  });

  // --- fetchHealthSummary ---

  it("fetchHealthSummary returns summary", async () => {
    const summary = { healthy: 8, unhealthy: 2, unknown: 0, total: 10 };
    mockInvoke.mockResolvedValueOnce(summary as never);

    const { result } = renderHook(() => useDashboard());
    let res: unknown = null;
    await act(async () => { res = await result.current.fetchHealthSummary(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_health_summary");
    expect(res).toEqual(summary);
  });

  it("fetchHealthSummary returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Summary error");

    const { result } = renderHook(() => useDashboard());
    let res: unknown = "not-null";
    await act(async () => { res = await result.current.fetchHealthSummary(); });

    expect(res).toBeNull();
    expect(result.current.error).toBe("Summary error");
  });

  // --- fetchQuickStats ---

  it("fetchQuickStats sets quickStats state", async () => {
    const stats = makeQuickStats();
    mockInvoke.mockResolvedValueOnce(stats as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchQuickStats(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_quick_stats");
    expect(result.current.quickStats).toEqual(stats);
  });

  // --- fetchAlerts ---

  it("fetchAlerts returns alerts array", async () => {
    const alerts = [makeAlert(), makeAlert({ id: "alert-2", severity: "critical" })];
    mockInvoke.mockResolvedValueOnce(alerts as never);

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = [];
    await act(async () => { res = await result.current.fetchAlerts(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_alerts");
    expect(res).toHaveLength(2);
  });

  it("fetchAlerts returns empty array on error", async () => {
    mockInvoke.mockRejectedValueOnce("Alerts error");

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = ["not-empty"];
    await act(async () => { res = await result.current.fetchAlerts(); });

    expect(res).toEqual([]);
    expect(result.current.error).toBe("Alerts error");
  });

  // --- acknowledgeAlert ---

  it("acknowledgeAlert invokes backend and refreshes state", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_get_state") return Promise.resolve(makeState());
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.acknowledgeAlert("alert-1"); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_acknowledge_alert", { alertId: "alert-1" });
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_state");
  });

  // --- fetchAllHealth ---

  it("fetchAllHealth sets healthEntries state", async () => {
    const entries = [makeHealthEntry(), makeHealthEntry({ connectionId: "conn-2", connectionName: "Server B" })];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchAllHealth(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_all_health");
    expect(result.current.healthEntries).toHaveLength(2);
  });

  it("fetchAllHealth returns empty array on error", async () => {
    mockInvoke.mockRejectedValueOnce("Health error");

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = ["not-empty"];
    await act(async () => { res = await result.current.fetchAllHealth(); });

    expect(res).toEqual([]);
    expect(result.current.error).toBe("Health error");
  });

  // --- fetchConnectionHealth ---

  it("fetchConnectionHealth returns single entry", async () => {
    const entry = makeHealthEntry();
    mockInvoke.mockResolvedValueOnce(entry as never);

    const { result } = renderHook(() => useDashboard());
    let res: unknown = null;
    await act(async () => { res = await result.current.fetchConnectionHealth("conn-1"); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_connection_health", { connectionId: "conn-1" });
    expect(res).toEqual(entry);
  });

  // --- fetchHeatmap ---

  it("fetchHeatmap sets heatmap state", async () => {
    const cells = [
      { connectionId: "conn-1", hour: 0, value: 25 },
      { connectionId: "conn-1", hour: 1, value: 30 },
    ];
    mockInvoke.mockResolvedValueOnce(cells as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchHeatmap(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_heatmap");
    expect(result.current.heatmap).toHaveLength(2);
  });

  it("fetchHeatmap returns empty array on error", async () => {
    mockInvoke.mockRejectedValueOnce("Heatmap error");

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = ["not-empty"];
    await act(async () => { res = await result.current.fetchHeatmap(); });

    expect(res).toEqual([]);
  });

  // --- fetchSparkline ---

  it("fetchSparkline updates sparklines map", async () => {
    const sparkline = { connectionId: "conn-1", points: [10, 20, 15, 25] };
    mockInvoke.mockResolvedValueOnce(sparkline as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchSparkline("conn-1"); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_sparkline", { connectionId: "conn-1" });
    expect(result.current.sparklines["conn-1"]).toEqual(sparkline);
  });

  it("fetchSparkline accumulates entries for different connections", async () => {
    const sp1 = { connectionId: "conn-1", points: [10, 20] };
    const sp2 = { connectionId: "conn-2", points: [30, 40] };

    const { result } = renderHook(() => useDashboard());

    mockInvoke.mockResolvedValueOnce(sp1 as never);
    await act(async () => { await result.current.fetchSparkline("conn-1"); });

    mockInvoke.mockResolvedValueOnce(sp2 as never);
    await act(async () => { await result.current.fetchSparkline("conn-2"); });

    expect(result.current.sparklines["conn-1"]).toEqual(sp1);
    expect(result.current.sparklines["conn-2"]).toEqual(sp2);
  });

  // --- fetchRecent ---

  it("fetchRecent uses default limit of 10", async () => {
    const recent = [{ connectionId: "conn-1", connectionName: "Server A", protocol: "ssh", timestamp: "2026-03-30T00:00:00Z" }];
    mockInvoke.mockResolvedValueOnce(recent as never);

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = [];
    await act(async () => { res = await result.current.fetchRecent(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_recent", { limit: 10 });
    expect(res).toHaveLength(1);
  });

  it("fetchRecent with custom limit", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchRecent(5); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_recent", { limit: 5 });
  });

  // --- fetchTopLatency ---

  it("fetchTopLatency uses default limit of 10", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.fetchTopLatency(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_top_latency", { limit: 10 });
  });

  // --- startMonitoring / stopMonitoring ---

  it("startMonitoring invokes backend and refreshes state", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_get_state") return Promise.resolve(makeState({ monitoring: true }));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.startMonitoring(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_start_monitoring");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_state");
  });

  it("stopMonitoring invokes backend and refreshes state", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_get_state") return Promise.resolve(makeState({ monitoring: false }));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.stopMonitoring(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_stop_monitoring");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_state");
  });

  it("startMonitoring sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Cannot start");

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.startMonitoring(); });

    expect(result.current.error).toBe("Cannot start");
  });

  // --- forceRefresh ---

  it("forceRefresh sets loading and fetches all data", async () => {
    const state = makeState();
    const entries = [makeHealthEntry()];
    const cells = [{ connectionId: "conn-1", hour: 0, value: 25 }];
    const stats = makeQuickStats();

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_get_state") return Promise.resolve(state);
      if (cmd === "dash_get_all_health") return Promise.resolve(entries);
      if (cmd === "dash_get_heatmap") return Promise.resolve(cells);
      if (cmd === "dash_get_quick_stats") return Promise.resolve(stats);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.forceRefresh(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_force_refresh");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_state");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_all_health");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_heatmap");
    expect(mockInvoke).toHaveBeenCalledWith("dash_get_quick_stats");
    expect(result.current.state).toEqual(state);
    expect(result.current.healthEntries).toEqual(entries);
    expect(result.current.heatmap).toEqual(cells);
    expect(result.current.quickStats).toEqual(stats);
    expect(result.current.loading).toBe(false);
  });

  it("forceRefresh resets loading to false when done", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_get_state") return Promise.resolve(makeState());
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.forceRefresh(); });

    expect(result.current.loading).toBe(false);
  });

  it("forceRefresh sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Refresh error");

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.forceRefresh(); });

    expect(result.current.error).toBe("Refresh error");
    expect(result.current.loading).toBe(false);
  });

  // --- loadConfig / updateConfig ---

  it("loadConfig overwrites default config", async () => {
    const cfg = { enabled: false, refreshIntervalMs: 60000, healthCheckTimeoutMs: 10000, maxSparklinePoints: 120, parallelChecks: 5, showOnStartup: true };
    mockInvoke.mockResolvedValueOnce(cfg as never);

    const { result } = renderHook(() => useDashboard());
    await act(async () => { await result.current.loadConfig(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_config");
    expect(result.current.config).toEqual(cfg);
  });

  it("updateConfig merges with existing config", async () => {
    const { result } = renderHook(() => useDashboard());

    await act(async () => { await result.current.updateConfig({ refreshIntervalMs: 60000 }); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_update_config", {
      config: expect.objectContaining({ refreshIntervalMs: 60000, enabled: true }),
    });
    expect(result.current.config.refreshIntervalMs).toBe(60000);
  });

  // --- fetchUnhealthy ---

  it("fetchUnhealthy returns unhealthy entries", async () => {
    const entries = [makeHealthEntry({ status: "unhealthy" })];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useDashboard());
    let res: unknown[] = [];
    await act(async () => { res = await result.current.fetchUnhealthy(); });

    expect(mockInvoke).toHaveBeenCalledWith("dash_get_unhealthy");
    expect(res).toHaveLength(1);
  });
});
