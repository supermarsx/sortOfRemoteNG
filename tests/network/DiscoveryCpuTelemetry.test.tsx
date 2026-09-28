import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryConfigSidebar } from "../../src/components/network/DiscoveryConfigSidebar";
import { DiscoveryScanProgress } from "../../src/components/network/DiscoveryScanProgress";
import type { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import type { DiscoveryScanStatus } from "../../src/utils/network/networkScanner";

vi.mock("../../src/components/network/DiscoveryTargetInput", () => ({
  DiscoveryTargetInput: () => null,
}));
vi.mock("../../src/components/network/DiscoveryPresetPanel", () => ({
  DiscoveryPresetPanel: () => null,
}));
vi.mock("../../src/components/network/DiscoveryPingSettings", () => ({
  DiscoveryPingSettings: () => null,
}));

type Manager = ReturnType<typeof useNetworkDiscovery>;
const config: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  protocols: [],
  portRanges: [],
  customPorts: {},
  timeout: 1000,
  maxConcurrent: 8,
  maxPortConcurrent: 16,
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};

function manager(
  telemetry: Partial<DiscoveryScanStatus> = {},
  overrides: Partial<Manager> = {},
): Manager {
  const scanStatus: DiscoveryScanStatus = {
    phase: "scanning",
    totalHosts: 1,
    completedHosts: 0,
    totalProbes: 1,
    completedProbes: 0,
    skippedHosts: 0,
    activeProbes: 1,
    ...telemetry,
  };
  return {
    hasScanned: true,
    native: true,
    isScanning: true,
    isStopping: false,
    isPaused: false,
    scanProgress: 0,
    elapsedMs: 1000,
    discoveredHosts: [],
    config,
    scanStatus,
    setConfig: vi.fn(),
    t: (_key: string, fallback: string) => fallback,
    ...overrides,
  } as Manager;
}

afterEach(cleanup);

describe("discovery CPU telemetry", () => {
  it.each([0, 100, 42.4])(
    "shows system-wide CPU %s on a 0–100 scale",
    (cpuPercent) => {
      render(<DiscoveryScanProgress mgr={manager({ cpuPercent })} />);
      expect(
        screen.getByText(`System CPU busy time ${Math.round(cpuPercent)}%`),
      ).toHaveAttribute(
        "title",
        "System CPU busy time: 0–100% across all logical processors. Task Manager may show frequency-weighted utility instead.",
      );
    },
  );

  it.each([undefined, null, NaN, Infinity, -1, 101])(
    "keeps unavailable or invalid CPU %s unknown",
    (cpuPercent) => {
      render(<DiscoveryScanProgress mgr={manager({ cpuPercent })} />);
      expect(
        screen.getByText("System CPU busy time unavailable"),
      ).toBeVisible();
      expect(screen.queryByText("System CPU busy time 0%")).toBeNull();
    },
  );

  it("keeps CPU unknown before scan status arrives", () => {
    render(<DiscoveryScanProgress mgr={manager({}, { scanStatus: null })} />);
    expect(screen.getByText("System CPU busy time unavailable")).toBeVisible();
  });

  it.each([{ native: false }, { isScanning: false }])(
    "does not present live native telemetry when %j",
    (overrides) => {
      render(
        <DiscoveryScanProgress mgr={manager({ cpuPercent: 25 }, overrides)} />,
      );
      expect(screen.queryByText(/^System CPU/)).toBeNull();
    },
  );

  it("separates process availability, system logical processors and physical cores", () => {
    render(
      <DiscoveryScanProgress
        mgr={manager({
          cpuPercent: 25,
          logicalCpus: 64,
          systemLogicalCpus: 80,
          physicalCores: 40,
          cpuSampleIntervalMs: 500,
          cpuSampleAgeMs: 20,
        })}
      />,
    );
    expect(screen.getByText("System CPU busy time 25%")).toBeVisible();
    expect(
      screen.getByText("Logical CPUs: 64 available to process / 80 total"),
    ).toBeVisible();
    expect(screen.getByText("Physical cores: 40")).toBeVisible();
    expect(screen.getByText("CPU sample: 500 ms · age 20 ms")).toBeVisible();
  });

  it.each([undefined, null, 0, -1, 1.5, NaN, Infinity])(
    "does not infer topology from unavailable or invalid counts (%s)",
    (count) => {
      render(
        <DiscoveryScanProgress
          mgr={manager({
            logicalCpus: count,
            systemLogicalCpus: count,
            physicalCores: count,
          })}
        />,
      );
      expect(
        screen.getByText(
          "Logical CPUs: unknown available to process / unknown total",
        ),
      ).toBeVisible();
      expect(screen.queryByText(/^Physical cores:/)).toBeNull();
    },
  );

  it("does not substitute available processors for unknown system topology", () => {
    render(<DiscoveryScanProgress mgr={manager({ logicalCpus: 8 })} />);
    expect(
      screen.getByText("Logical CPUs: 8 available to process / unknown total"),
    ).toBeVisible();
    expect(screen.queryByText(/^Physical cores:/)).toBeNull();
    expect(screen.queryByText(/^CPU sample:/)).toBeNull();
  });

  it("labels the CPU target in system-wide units and preserves its setting", () => {
    const mgr = manager({}, { isScanning: false });
    render(<DiscoveryConfigSidebar mgr={mgr} />);
    fireEvent.click(screen.getByText("Advanced"));
    const threshold = screen.getByRole("spinbutton", {
      name: "System CPU target (%)",
    });
    expect(threshold).toHaveValue(80);
    expect(threshold).toHaveAttribute("min", "1");
    expect(threshold).toHaveAttribute("max", "100");
    expect(
      screen.getByText(
        /System CPU busy time uses a 0–100% scale across all logical processors/,
      ),
    ).toBeVisible();
    fireEvent.change(threshold, { target: { value: "65" } });
    const update = vi.mocked(mgr.setConfig).mock.calls[0][0] as (
      current: NetworkDiscoveryConfig,
    ) => NetworkDiscoveryConfig;
    expect(update(config)).toEqual({ ...config, maxCpuPercent: 65 });
  });

  it("defaults to continuing scans and allows explicit threshold pausing", () => {
    const mgr = manager({}, { isScanning: false });
    render(<DiscoveryConfigSidebar mgr={mgr} />);
    fireEvent.click(screen.getByText("Advanced"));
    const pause = screen.getByRole("checkbox", {
      name: "Pause new probes at utilization thresholds",
    });
    expect(pause).not.toBeChecked();
    expect(screen.getByText(/they do not cap system load/)).toBeVisible();
    fireEvent.click(pause);
    const update = vi.mocked(mgr.setConfig).mock.calls[0][0] as (
      current: NetworkDiscoveryConfig,
    ) => NetworkDiscoveryConfig;
    expect(update(config)).toEqual({ ...config, pauseOnHighLoad: true });
  });

  it.each([undefined, false])(
    "toggles service scanning from %s without changing selections",
    (serviceScanEnabled) => {
      const saved = {
        ...config,
        protocols: ["ssh"],
        portRanges: ["8000-8010"],
        serviceScanEnabled,
      };
      const mgr = manager({}, { isScanning: false, config: saved });
      render(<DiscoveryConfigSidebar mgr={mgr} />);
      const toggle = screen.getByRole("checkbox", {
        name: "Scan services / ports",
      });
      if (serviceScanEnabled === false) expect(toggle).not.toBeChecked();
      else expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      const update = vi.mocked(mgr.setConfig).mock.calls[0][0] as (
        current: NetworkDiscoveryConfig,
      ) => NetworkDiscoveryConfig;
      expect(update(saved)).toEqual({
        ...saved,
        serviceScanEnabled: serviceScanEnabled === false,
      });
    },
  );

  it.each([
    { native: false, isScanning: false },
    { native: true, isScanning: true },
  ])("disables service and threshold-pause toggles when %j", (overrides) => {
    const mgr = manager({}, overrides);
    render(<DiscoveryConfigSidebar mgr={mgr} />);
    fireEvent.click(screen.getByText("Advanced"));
    for (const name of [
      "Scan services / ports",
      "Pause new probes at utilization thresholds",
    ]) {
      const toggle = screen.getByRole("checkbox", { name });
      expect(toggle).toBeDisabled();
      fireEvent.click(toggle);
    }
    expect(mgr.setConfig).not.toHaveBeenCalled();
  });

  it("uses the reachability budget when stopping a host-only sweep", () => {
    render(
      <DiscoveryScanProgress
        mgr={manager(
          {},
          {
            isStopping: true,
            config: {
              ...config,
              hostDiscoveryEnabled: true,
              serviceScanEnabled: false,
              pingMethod: "arp",
              pingTimeout: 2000,
            },
          },
        )}
      />,
    );
    expect(
      screen.getByText(/Active reachability probes have a requested 2s budget/),
    ).toHaveTextContent("OS level");
    expect(
      screen.queryByText(/including banner and service identification limits/),
    ).toBeNull();
  });
});
