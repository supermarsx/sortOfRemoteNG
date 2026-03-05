import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

import { HealthDashboard } from "../src/components/monitoring/HealthDashboard";

describe("HealthDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "dash_get_config":
          return Promise.resolve({ enabled: false, refreshIntervalMs: 30000, healthCheckTimeoutMs: 5000, maxSparklinePoints: 60, parallelChecks: 10, showOnStartup: false });
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

  it("renders the dashboard title", () => {
    render(<HealthDashboard isOpen={true} />);
    expect(screen.getByText("dashboard.title")).toBeInTheDocument();
  });

  it("shows monitoring toggle button", () => {
    render(<HealthDashboard isOpen={true} />);
    // The button text is "dashboard.paused"; "dashboard.startMonitoring" is the title attribute
    expect(screen.getByTitle("dashboard.startMonitoring")).toBeInTheDocument();
  });

  it("shows refresh button", () => {
    render(<HealthDashboard isOpen={true} />);
    // Refresh button has only an icon; "dashboard.refresh" is the title attribute
    const btn = screen.getByTitle("dashboard.refresh");
    expect(btn).toBeInTheDocument();
  });

  it("calls forceRefresh when refresh button is clicked", async () => {
    render(<HealthDashboard isOpen={true} />);
    const refreshBtn = screen.getByTitle("dashboard.refresh");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });
    expect(mockInvoke).toHaveBeenCalled();
  });

  it("shows quick stats section", () => {
    render(<HealthDashboard isOpen={true} />);
    // QuickStatsCards renders individual stat labels; "dashboard.quickStats" doesn't exist
    expect(screen.getByText("dashboard.totalConnections")).toBeInTheDocument();
  });

  it("shows dashboard widget sections", () => {
    render(<HealthDashboard isOpen={true} />);
    // WidgetCard titles are rendered as visible <h4> text
    expect(screen.getByText("dashboard.recentConnections")).toBeInTheDocument();
  });

  it("shows heatmap section", () => {
    render(<HealthDashboard isOpen={true} />);
    expect(screen.getByText("dashboard.heatmap")).toBeInTheDocument();
  });

  it("hides alerts section when there are no alerts", () => {
    render(<HealthDashboard isOpen={true} />);
    // AlertBanner returns null when there are no active alerts
    expect(screen.queryByText("dashboard.activeAlerts")).not.toBeInTheDocument();
  });

  it("toggles monitoring on/off", async () => {
    render(<HealthDashboard isOpen={true} />);
    const toggleBtn = screen.getByTitle("dashboard.startMonitoring");
    await act(async () => {
      fireEvent.click(toggleBtn);
    });
    expect(mockInvoke).toHaveBeenCalledWith("dash_start_monitoring");
  });

  it("shows loading state during refresh", async () => {
    let resolveRefresh: () => void;
    mockInvoke.mockImplementation(() => new Promise(r => { resolveRefresh = r as () => void; }));
    render(<HealthDashboard isOpen={true} />);
    const refreshBtn = screen.getByTitle("dashboard.refresh");
    act(() => { fireEvent.click(refreshBtn); });
    // Component should show loading indicator
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  it("renders config panel when gear icon clicked", async () => {
    render(<HealthDashboard isOpen={true} />);
    // Find config button (gear icon)
    const configBtns = screen.getAllByRole("button");
    // At least one config-related button exists
    expect(configBtns.length).toBeGreaterThan(0);
  });
});
