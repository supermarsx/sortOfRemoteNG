import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { PerformanceMonitor } from "../src/components/monitoring/PerformanceMonitor";
import { invoke } from "@tauri-apps/api/core";

const mocks = vi.hoisted(() => ({
  getPerformanceMetrics: vi.fn(),
  getSettings: vi.fn(),
  loadSettings: vi.fn(),
  recordPerformanceMetric: vi.fn(),
  saveSettings: vi.fn(),
  clearPerformanceMetrics: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getPerformanceMetrics: mocks.getPerformanceMetrics,
      getSettings: mocks.getSettings,
      loadSettings: mocks.loadSettings,
      recordPerformanceMetric: mocks.recordPerformanceMetric,
      saveSettings: mocks.saveSettings,
      clearPerformanceMetrics: mocks.clearPerformanceMetrics,
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe("PerformanceMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getSettings.mockReturnValue({
      performancePollIntervalMs: 20000,
      performanceLatencyTarget: "1.1.1.1",
    });
    mocks.loadSettings.mockResolvedValue({
      performancePollIntervalMs: 20000,
      performanceLatencyTarget: "1.1.1.1",
    });
    mocks.getPerformanceMetrics.mockReturnValue([
      {
        connectionTime: 0,
        dataTransferred: 0,
        latency: 22,
        throughput: 850,
        cpuUsage: 35,
        memoryUsage: 45,
        timestamp: Date.now(),
      },
    ]);
    mocks.saveSettings.mockResolvedValue(undefined);

    vi.mocked(invoke).mockResolvedValue({
      connectionTime: 0,
      dataTransferred: 0,
      latency: 18,
      throughput: 910,
      cpuUsage: 28,
      memoryUsage: 40,
      timestamp: Date.now(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with current and summary sections", async () => {
    const { container } = render(
      <PerformanceMonitor isOpen onClose={() => {}} />,
    );

    expect(await screen.findByText("performance.title")).toBeInTheDocument();
    expect(screen.getByText("Current Performance")).toBeInTheDocument();
    expect(screen.getByText("Summary Statistics")).toBeInTheDocument();

    await waitFor(() => {
      expect(container.querySelectorAll(".sor-metric-card").length).toBe(4);
      expect(
        container.querySelectorAll(".sor-metric-summary-card").length,
      ).toBe(4);
      expect(container.querySelector(".sor-metric-table-shell")).toBeTruthy();
    });
  });

  it("records refreshed metrics from backend", async () => {
    render(<PerformanceMonitor isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_system_metrics");
      expect(mocks.recordPerformanceMetric).toHaveBeenCalled();
    });
  });

  it("does not render when closed", () => {
    render(<PerformanceMonitor isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText("performance.title")).not.toBeInTheDocument();
  });
});
