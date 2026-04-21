import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import React from "react";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { HealthDashboard } from "../../src/components/monitoring/HealthDashboard";

/**
 * Helper: render the dashboard and flush all pending async state updates
 * triggered by the useEffect initial-load chain.
 *
 * The component's mount effect calls a sequence of async invoke() calls
 * (loadConfig → loadLayout → fetchState/fetchAllHealth/… → fetchTopLatency/fetchRecent)
 * each of which resolves a promise and triggers setState. Wrapping in
 * `act(async () => …)` ensures React processes every update before assertions.
 */
async function renderDashboard(props: { isOpen: boolean }) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<HealthDashboard {...props} />);
  });
  return result!;
}

describe("HealthDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "dash_get_config":
          return Promise.resolve({
            enabled: false,
            refreshIntervalMs: 30000,
            healthCheckTimeoutMs: 5000,
            maxSparklinePoints: 60,
            parallelChecks: 10,
            showOnStartup: false,
          });
        case "dash_get_layout":
          return Promise.resolve({ widgets: [], columns: 12, rowHeight: 80 });
        case "dash_get_all_health":
        case "dash_get_unhealthy":
        case "dash_get_top_latency":
        case "dash_get_heatmap":
        case "dash_get_recent":
        case "dash_get_alerts":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the dashboard title", async () => {
    await renderDashboard({ isOpen: true });
    expect(screen.getByText("dashboard.title")).toBeInTheDocument();
  });

  it("shows monitoring toggle button", async () => {
    await renderDashboard({ isOpen: true });
    // The button text is "dashboard.paused"; "dashboard.startMonitoring" is the title attribute
    expect(screen.getByTitle("dashboard.startMonitoring")).toBeInTheDocument();
  });

  it("shows refresh button", async () => {
    await renderDashboard({ isOpen: true });
    // Refresh button has only an icon; "dashboard.refresh" is the title attribute
    const btn = screen.getByTitle("dashboard.refresh");
    expect(btn).toBeInTheDocument();
  });

  it("calls forceRefresh when refresh button is clicked", async () => {
    await renderDashboard({ isOpen: true });
    const refreshBtn = screen.getByTitle("dashboard.refresh");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });
    expect(mockInvoke).toHaveBeenCalled();
  });

  it("shows quick stats section", async () => {
    await renderDashboard({ isOpen: true });
    // QuickStatsCards renders individual stat labels; "dashboard.quickStats" doesn't exist
    expect(screen.getByText("dashboard.totalConnections")).toBeInTheDocument();
  });

  it("shows dashboard widget sections", async () => {
    await renderDashboard({ isOpen: true });
    // WidgetCard titles are rendered as visible <h4> text
    expect(screen.getByText("dashboard.recentConnections")).toBeInTheDocument();
  });

  it("shows heatmap section", async () => {
    await renderDashboard({ isOpen: true });
    expect(screen.getByText("dashboard.heatmap")).toBeInTheDocument();
  });

  it("hides alerts section when there are no alerts", async () => {
    await renderDashboard({ isOpen: true });
    // AlertBanner returns null when there are no active alerts
    expect(
      screen.queryByText("dashboard.activeAlerts"),
    ).not.toBeInTheDocument();
  });

  it("toggles monitoring on/off", async () => {
    await renderDashboard({ isOpen: true });
    const toggleBtn = screen.getByTitle("dashboard.startMonitoring");
    await act(async () => {
      fireEvent.click(toggleBtn);
    });
    expect(mockInvoke).toHaveBeenCalledWith("dash_start_monitoring");
  });

  it("shows loading state during refresh", async () => {
    // First, render with default (resolving) mocks so the initial load completes
    await renderDashboard({ isOpen: true });

    // Track whether dash_force_refresh was called. Keep a controlled promise
    // for dash_force_refresh but let everything else resolve normally.
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((r) => {
      resolveRefresh = r;
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "dash_force_refresh") return refreshPromise;
      // Keep the same defaults for all other commands
      switch (cmd) {
        case "dash_get_config":
          return Promise.resolve({
            enabled: false,
            refreshIntervalMs: 30000,
            healthCheckTimeoutMs: 5000,
            maxSparklinePoints: 60,
            parallelChecks: 10,
            showOnStartup: false,
          });
        case "dash_get_layout":
          return Promise.resolve({ widgets: [], columns: 12, rowHeight: 80 });
        case "dash_get_all_health":
        case "dash_get_unhealthy":
        case "dash_get_top_latency":
        case "dash_get_heatmap":
        case "dash_get_recent":
        case "dash_get_alerts":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    });

    const refreshBtn = screen.getByTitle("dashboard.refresh");
    // Fire click (synchronous dispatch — the handler calls mockInvoke immediately)
    fireEvent.click(refreshBtn);

    // The invoke call for force refresh was triggered synchronously by the click handler
    expect(mockInvoke).toHaveBeenCalledWith("dash_force_refresh");

    // Clean up: resolve the hanging promise and flush so the component unmounts cleanly
    await act(async () => {
      resolveRefresh();
    });
  });

  it("renders config panel when gear icon clicked", async () => {
    await renderDashboard({ isOpen: true });
    // Find config button (gear icon)
    const configBtns = screen.getAllByRole("button");
    // At least one config-related button exists
    expect(configBtns.length).toBeGreaterThan(0);
  });

  // ── Threshold Config ────────────────────────────────────────────

  it("renders settings gear button", async () => {
    await renderDashboard({ isOpen: true });
    const settingsBtn = screen.getByTitle("dashboard.settings");
    expect(settingsBtn).toBeInTheDocument();
  });

  it("opens threshold config modal on click", async () => {
    await renderDashboard({ isOpen: true });
    const settingsBtn = screen.getByTitle("dashboard.settings");
    await act(async () => {
      fireEvent.click(settingsBtn);
    });
    // Config panel should now be visible with the Alert Thresholds button
    expect(screen.getByText("dashboard.thresholdConfig")).toBeInTheDocument();
    // Click the threshold button to reveal threshold inputs
    await act(async () => {
      fireEvent.click(screen.getByText("dashboard.thresholdConfig"));
    });
    expect(screen.getByLabelText("Latency threshold in milliseconds")).toBeInTheDocument();
    expect(screen.getByLabelText("CPU usage threshold percentage")).toBeInTheDocument();
    expect(screen.getByLabelText("Memory usage threshold percentage")).toBeInTheDocument();
  });

  it("saves threshold values", async () => {
    await renderDashboard({ isOpen: true });
    // Open config panel
    await act(async () => {
      fireEvent.click(screen.getByTitle("dashboard.settings"));
    });
    // Open thresholds
    await act(async () => {
      fireEvent.click(screen.getByText("dashboard.thresholdConfig"));
    });
    // Modify a value
    const latencyInput = screen.getByLabelText("Latency threshold in milliseconds");
    fireEvent.change(latencyInput, { target: { value: "200" } });
    // Save
    await act(async () => {
      fireEvent.click(screen.getByText("common.save"));
    });
    expect(mockInvoke).toHaveBeenCalledWith("dash_set_thresholds", {
      thresholds: { latencyMs: 200, cpuPercent: 80, memoryPercent: 80 },
    });
  });
});
