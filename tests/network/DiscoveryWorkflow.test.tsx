import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import {
  NetworkScanner,
  type DiscoveryScanStatus,
} from "../../src/utils/network/networkScanner";
import {
  DISCOVERY_HISTORY_RETENTION_NOTICE,
  type SavedDiscoveryScan,
} from "../../src/utils/discovery/scanHistory";
import { NETWORK_TARGET_HISTORY_KEY } from "../../src/utils/discovery/networkTargets";
import type { DiscoveredHost } from "../../src/types/connection/connection";

const { invoke, probeCapabilities, history } = vi.hoisted(() => ({
  invoke: vi.fn(),
  probeCapabilities: vi.fn(),
  history: {
    scans: [] as SavedDiscoveryScan[],
    loading: false,
    error: null as string | null,
    saveScan: vi.fn(),
    renameScan: vi.fn(),
    deleteScan: vi.fn(),
    clearScans: vi.fn(),
    reload: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: [string, ...unknown[]]) => {
    // Capability metadata must not consume interface retries or scan mocks.
    if (args[0] === "get_discovery_probe_capabilities")
      return probeCapabilities();
    return invoke(...args);
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch: vi.fn(), state: { connections: [] } }),
}));
vi.mock("../../src/hooks/network/useDiscoveryScanHistory", () => ({
  useDiscoveryScanHistory: () => history,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const host: DiscoveredHost = {
  ip: "192.0.2.25",
  hostname: "test-server",
  openPorts: [22],
  responseTime: 4,
  services: [
    {
      port: 22,
      protocol: "ssh",
      service: "SSH",
      product: "OpenSSH",
      detection: "identified",
    },
  ],
};
const saved: SavedDiscoveryScan = {
  id: "previous",
  startedAt: 1700000000000,
  elapsedMs: 4500,
  outcome: "stopped",
  hosts: [host],
  config: {
    enabled: true,
    ipRange: "192.0.2.25, 2001:db8::1",
    portRanges: [],
    protocols: ["ssh"],
    timeout: 750,
    maxConcurrent: 3,
    maxPortConcurrent: 4,
    customPorts: { ssh: [2222] },
    probeStrategies: { default: ["websocket"] },
    cacheTTL: 0,
    hostnameTtl: 0,
    macTtl: 0,
  },
};
let scan: MockInstance<NetworkScanner["scanNetwork"]>;
const mount = () =>
  render(<NetworkDiscovery isOpen embedded onClose={() => {}} />);
const input = () =>
  screen.getByRole("combobox", { name: "networkDiscovery.ipRange" });
function typeTarget(value: string) {
  fireEvent.change(input(), {
    target: { value, selectionStart: value.length },
  });
}

beforeEach(() => {
  localStorage.removeItem(NETWORK_TARGET_HISTORY_KEY);
  invoke.mockReset().mockResolvedValue([]);
  probeCapabilities.mockReset().mockResolvedValue({
    platform: "windows",
    methods: [],
  });
  history.scans = [];
  history.error = null;
  history.loading = false;
  for (const action of [
    history.saveScan,
    history.renameScan,
    history.deleteScan,
    history.clearScans,
    history.reload,
  ])
    action.mockReset().mockResolvedValue(undefined);
  scan = vi
    .spyOn(NetworkScanner.prototype, "scanNetwork")
    .mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("discovery target UI", () => {
  it("disables Start when both scan stages are off and enables either stage independently", async () => {
    mount();
    await screen.findByText("Probe capabilities: windows");
    typeTarget("192.0.2.25");
    const start = screen.getByRole("button", {
      name: "networkDiscovery.startScan",
    });
    const discoverHosts = screen.getByRole("checkbox", {
      name: "Discover hosts with ping / ARP",
    });
    const scanServices = screen.getByRole("checkbox", {
      name: "Scan services / ports",
    });
    expect(discoverHosts).not.toBeChecked();
    expect(scanServices).toBeChecked();
    expect(start).toBeEnabled();
    fireEvent.click(scanServices);
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(scan).not.toHaveBeenCalled();
    fireEvent.click(discoverHosts);
    expect(start).toBeEnabled();
    expect(scanServices).not.toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Ping method" }),
    ).toHaveTextContent("Adaptive — stop on response");
    fireEvent.click(discoverHosts);
    expect(start).toBeDisabled();
    fireEvent.click(scanServices);
    expect(start).toBeEnabled();
    expect(discoverHosts).not.toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Ping method" }),
    ).toHaveTextContent("Adaptive — stop on response");
    expect(scan).not.toHaveBeenCalled();
  });

  it("filters while typing and selects suggestions by mouse without scanning", async () => {
    localStorage.setItem(
      NETWORK_TARGET_HISTORY_KEY,
      JSON.stringify(["192.0.2.0/24", "2001:db8::/120"]),
    );
    mount();
    await screen.findByText("Probe capabilities: windows");
    expect(probeCapabilities).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
    typeTarget("192");
    expect(screen.getByRole("option", { name: /192.0.2.0\/24/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /2001:db8/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", { name: /192.0.2.0\/24/ }));
    fireEvent.click(screen.getByRole("option", { name: /192.0.2.0\/24/ }));
    expect(input()).toHaveValue("192.0.2.0/24");
    expect(scan).not.toHaveBeenCalled();
    expect(history.saveScan).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("detect_interface_subnets"),
    );
    expect(
      invoke.mock.calls.every(
        ([command]) => command === "detect_interface_subnets",
      ),
    ).toBe(true);
  });

  it("keyboard selection replaces just the active target and Escape never scans", async () => {
    localStorage.setItem(
      NETWORK_TARGET_HISTORY_KEY,
      JSON.stringify(["2001:db8::/120"]),
    );
    mount();
    typeTarget("192.0.2.5, 2001");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /2001:db8::\/120/ }).id,
    );
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input()).toHaveValue("192.0.2.5, 2001:db8::/120");
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(scan).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("shows interface errors and refresh retries without scanning", async () => {
    invoke.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([
      {
        interfaceName: "Ethernet",
        address: "10.23.45.67",
        cidr: "10.23.0.0/16",
      },
    ]);
    mount();
    fireEvent.focus(input());
    expect(
      await screen.findByText(/Could not detect interfaces/),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh interface subnets" }),
    );
    const option = await screen.findByRole("option", {
      name: /10.23.32.0\/19/,
    });
    expect(option).toHaveTextContent("slice of 10.23.0.0/16");
    fireEvent.click(option);
    expect(input()).toHaveValue("10.23.32.0/19");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("running scan workflow", () => {
  it("pauses/resumes the scanner and shows incremental hosts and statistics before completion", async () => {
    vi.useFakeTimers();
    const pause = vi
      .spyOn(NetworkScanner.prototype, "pause")
      .mockImplementation(() => {});
    const resume = vi
      .spyOn(NetworkScanner.prototype, "resume")
      .mockImplementation(() => {});
    let complete!: (hosts: DiscoveredHost[]) => void;
    let reportHost!: (host: DiscoveredHost) => void;
    let reportStatus!: (status: DiscoveryScanStatus) => void;
    scan.mockImplementation((_config, _progress, _signal, status, found) => {
      reportStatus = status!;
      reportHost = found!;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    mount();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    typeTarget("192.0.2.25");
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    expect(scan).toHaveBeenCalledTimes(1);
    expect(history.saveScan).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pause scan" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("tab", { name: /Current scan.*paused/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Resume scan" }));
    expect(resume).toHaveBeenCalledTimes(1);
    await act(async () => {
      reportHost(host);
      reportStatus({
        phase: "scanning",
        totalHosts: 4,
        completedHosts: 1,
        totalProbes: 8,
        completedProbes: 2,
        activeProbes: 2,
        skippedHosts: 0,
        liveHosts: 1,
        livePorts: 1,
        activeWorkers: 2,
        workerLimit: 3,
        probeLimit: 4,
        etaMs: 9000,
      });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("test-server")).toBeVisible();
    const progress = within(
      screen.getByRole("region", { name: "Scan progress" }),
    );
    expect(
      progress.getByText("Live hosts found").parentElement,
    ).toHaveTextContent("1Live hosts found");
    expect(
      progress.getByText("Open ports found").parentElement,
    ).toHaveTextContent("1Open ports found");
    expect(progress.getByText("1 / 4 addresses")).toBeVisible();
    expect(progress.getByText("2 / 8 checks processed")).toBeVisible();
    expect(progress.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(history.saveScan).not.toHaveBeenCalled();
    await act(async () => {
      complete([host]);
    });
    expect(history.saveScan).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    });
    expect(history.saveScan).toHaveBeenCalledTimes(1);
    expect(history.saveScan).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "complete", hosts: [host] }),
    );
  });
});

describe("explicit scan result controls", () => {
  async function finishScan(hosts = [structuredClone(host)]) {
    scan.mockResolvedValueOnce(hosts);
    mount();
    typeTarget("192.0.2.25");
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save to history" }),
      ).toBeEnabled(),
    );
    expect(history.saveScan).not.toHaveBeenCalled();
  }

  it("preserves and explicitly saves observed hosts when a scan fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    scan.mockImplementation(
      async (_config, _progress, _signal, _status, found) => {
        found!(host);
        throw new Error("service probe failed");
      },
    );
    mount();
    typeTarget("192.0.2.25");
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "service probe failed",
    );
    expect(screen.getByText("test-server")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeEnabled();
    expect(history.saveScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    await screen.findByText("Saved to history.");
    expect(history.saveScan).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", hosts: [host] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard results" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("test-server")).toBeNull();
  });

  it("saves an immutable terminal snapshot once, with retry after a persistence failure", async () => {
    const returnedHosts = [structuredClone(host)];
    await finishScan(returnedHosts);
    returnedHosts[0].services[0].product = "changed after completion";
    typeTarget("198.51.100.1");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Filter discovered hosts and services",
      }),
      {
        target: { value: "no matches" },
      },
    );
    history.saveScan.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not persist this scan to history: disk full",
    );
    expect(screen.queryByText("Saved to history.")).toBeNull();
    const snapshot = history.saveScan.mock.calls[0][0];
    expect(snapshot).toMatchObject({
      config: { ipRange: "192.0.2.25" },
      hosts: [host],
      outcome: "complete",
    });
    let persist!: () => void;
    history.saveScan.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(history.saveScan).toHaveBeenCalledTimes(2);
    expect(history.saveScan.mock.calls[1][0]).toEqual(snapshot);
    await act(async () => {
      persist();
    });
    expect(screen.getByText("Saved to history.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    expect(history.saveScan).toHaveBeenCalledTimes(2);
  });

  it("discards current results and selection while keeping saved history reopenable", async () => {
    history.scans = [saved];
    await finishScan();
    history.saveScan.mockImplementationOnce(
      async (snapshot: SavedDiscoveryScan) => {
        history.scans = [snapshot, saved];
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    await screen.findByText("Saved to history.");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all services on 192.0.2.25",
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "networkDiscovery.createConnections",
      }),
    ).toBeVisible();
    expect(screen.getByText(/saved history is kept/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard results" }));
    expect(screen.queryByText("test-server")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "networkDiscovery.createConnections",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    expect(screen.queryByText("Saved to history.")).toBeNull();
    expect(input()).toHaveValue("192.0.2.25");
    expect(history.deleteScan).not.toHaveBeenCalled();
    expect(history.clearScans).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "History (2)" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Open scan: ${new Date(history.scans.find((entry) => entry.outcome === "complete")!.startedAt).toLocaleString()}`,
      }),
    );
    expect(
      screen.getByRole("region", { name: "Saved scan results" }),
    ).toHaveTextContent("test-server");
  });

  it("waits for stopping to drain, then saves partial results; late callbacks cannot undo discard", async () => {
    let complete!: (hosts: DiscoveredHost[]) => void;
    let reportHost!: (host: DiscoveredHost) => void;
    let reportStatus!: (status: DiscoveryScanStatus) => void;
    scan.mockImplementation((_config, _progress, _signal, status, found) => {
      reportHost = found!;
      reportStatus = status!;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    mount();
    typeTarget("192.0.2.25");
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    act(() => {
      reportHost(host);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.stop" }),
    );
    expect(
      screen.getByRole("button", { name: "Save to history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard results" }),
    ).toBeDisabled();
    await act(async () => {
      complete([]);
    });
    expect(screen.getByText("test-server")).toBeVisible();
    expect(history.saveScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    await screen.findByText("Saved to history.");
    expect(history.saveScan).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "stopped", hosts: [host] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard results" }));
    await act(async () => {
      reportHost(host);
      reportStatus({ phase: "complete" } as DiscoveryScanStatus);
    });
    expect(screen.queryByText("test-server")).toBeNull();
    expect(screen.queryByRole("region", { name: "Scan progress" })).toBeNull();
    expect(history.saveScan).toHaveBeenCalledTimes(1);
  });

  it("allows saving an empty completed scan and discarding an unsaved scan", async () => {
    await finishScan([]);
    fireEvent.click(screen.getByRole("button", { name: "Discard results" }));
    expect(history.saveScan).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save to history" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save to history" }));
    await screen.findByText("Saved to history.");
    expect(history.saveScan).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "complete", hosts: [] }),
    );
  });
});

describe("saved scan subtabs", () => {
  it("opens old results and uses a cloned configuration without starting a scan", () => {
    history.scans = [saved];
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(screen.getByText(DISCOVERY_HISTORY_RETENTION_NOTICE)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Open scan:/ }));
    expect(screen.getByRole("tab", { name: "Saved scan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Saved scan results" }),
    ).toHaveTextContent("test-server");
    expect(
      within(
        screen.getByRole("region", { name: "Saved scan results" }),
      ).queryByRole("checkbox"),
    ).toBeNull();
    expect(
      screen.getByText(/Saved snapshot, not a current reachability check/),
    ).toBeVisible();
    expect(scan).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use scan configuration" }),
    );
    expect(screen.getByRole("tab", { name: "Current scan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(input()).toHaveValue(saved.config.ipRange);
    typeTarget("198.51.100.1");
    expect(saved.config.ipRange).toBe("192.0.2.25, 2001:db8::1");
    expect(scan).not.toHaveBeenCalled();
    expect(history.saveScan).not.toHaveBeenCalled();
  });

  it("keeps a storage error visible and supports history reload, delete and keyboard tabs", async () => {
    history.scans = [saved];
    history.error = "History is not persisted; scans exist only in memory.";
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("not persisted");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Current scan" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "History (1)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload history" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /^Delete scan:/ }));
    expect(history.deleteScan).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm delete/ }));
    });
    expect(history.reload).toHaveBeenCalledTimes(1);
    expect(history.deleteScan).toHaveBeenCalledWith("previous");
    expect(scan).not.toHaveBeenCalled();
  });
});
