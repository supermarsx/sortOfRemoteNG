import React from "react";
import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import {
  createToolSession,
  findExistingToolSession,
} from "../../src/components/app/toolSession";
import { TOOL_DESCRIPTORS } from "../../src/components/app/toolDescriptors";
import { AppToolbar } from "../../src/components/app/AppToolbar";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { LayoutSettings } from "../../src/components/SettingsDialog/sections/LayoutSettings";
import {
  DEFAULT_VALUES,
  TAB_DEFAULTS,
} from "../../src/components/SettingsDialog/settingsConstants";
import { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import { DISCOVERY_SERVICE_PRESETS } from "../../src/utils/discovery/discoveryPresets";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  probeCapabilities: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    if (command === "probe_discovery_batch") {
      const batch = args as {
        host: string;
        timeoutSecs: number;
        probes: Array<{
          port: number;
          identifyHttp?: string;
          identifyProtocol?: string;
        }>;
      };
      return Promise.allSettled(
        batch.probes.map(async (probe) => ({
          ...(await mocks.invoke("check_port", {
            host: batch.host,
            port: probe.port,
            timeoutSecs: batch.timeoutSecs,
            ...(probe.identifyHttp ? { identifyHttp: probe.identifyHttp } : {}),
            ...(probe.identifyProtocol
              ? { identifyProtocol: probe.identifyProtocol }
              : {}),
          })),
          port: probe.port,
        })),
      ).then((results) => {
        const failure = results.find((item) => item.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        return results.map((item) =>
          item.status === "fulfilled" ? item.value : undefined,
        );
      });
    }
    // These tests assert probe traffic; local metadata and bounded PTR lookups
    // have dedicated workflow tests and must not consume pending probe mocks.
    if (command === "get_discovery_probe_capabilities")
      return mocks.probeCapabilities();
    if (command === "detect_interface_subnets") return Promise.resolve([]);
    if (command === "get_discovery_capacity")
      return Promise.resolve({
        logicalCpus: 8,
        systemLogicalCpus: 80,
        physicalCores: 40,
        cpuPercent: 15,
        cpuSampleIntervalMs: 1000,
        cpuSampleAgeMs: 0,
        interfaces: [],
      });
    if (command === "discovery_reverse_dns") return Promise.resolve(null);
    return mocks.invoke(command, args);
  },
  isTauri: () => false,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: [], connections: [] },
    dispatch: mocks.dispatch,
    databaseAvailability: { status: "none", generation: 1 },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.probeCapabilities.mockReset().mockResolvedValue({
    platform: "windows",
    methods: [],
  });
  mocks.dispatch.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function expandServiceGroups() {
  for (const group of new Set(
    DISCOVERY_SERVICE_PRESETS.map((preset) => preset.group),
  )) {
    const summary = screen.getByText(group);
    if (!summary.closest("details")!.open) fireEvent.click(summary);
  }
}

describe("Network Scanner tool", () => {
  it("starts service categories and Advanced collapsed, without hiding the primary controls", () => {
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    const sections = screen
      .getByRole("complementary")
      .querySelectorAll("details");
    expect(sections).toHaveLength(5);
    for (const section of sections) expect(section).not.toHaveAttribute("open");
    expect(screen.getByLabelText("networkDiscovery.ipRange")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Select all services" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    ).toBeVisible();
    const advanced = screen.getByText("Advanced");
    fireEvent.click(advanced);
    expect(screen.getByLabelText("Concurrent probes")).toBeVisible();
    fireEvent.click(advanced);
    expect(advanced.closest("details")).not.toHaveAttribute("open");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps all configuration and Advanced in a right sidebar, without a redundant tab close button", async () => {
    const view = render(
      <NetworkDiscovery
        isOpen
        embedded
        onClose={vi.fn()}
        allowCreateConnections={false}
      />,
    );
    const sidebar = screen.getByRole("complementary", {
      name: "Discovery configuration",
    });
    const results = screen.getByRole("main", { name: "Discovery results" });
    expect(sidebar).toHaveClass("lg:border-l");
    expect(results.nextElementSibling).toBe(sidebar);
    expect(within(sidebar).getByText("Advanced")).toBeInTheDocument();
    for (const name of [
      "Connection timeout (ms)",
      "Concurrent hosts",
      "Concurrent probes",
      "Additional TCP ports / ranges",
      "Ping method",
      "Filter service presets",
    ])
      expect(within(sidebar).getByLabelText(name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    view.unmount();
    render(<NetworkDiscovery isOpen onClose={vi.fn()} />);
    expect(
      screen.getAllByRole("button", { name: "Close" }).length,
    ).toBeGreaterThan(0);
  });

  it("selects all services even when filtered, preserving custom ports without starting a scan", () => {
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Remote access"));
    fireEvent.change(screen.getByLabelText("SSH / SFTP / SCP ports"), {
      target: { value: "22, 2222" },
    });
    const filter = screen.getByLabelText("Filter service presets");
    fireEvent.change(filter, { target: { value: "cpanel" } });
    const selectAll = screen.getByRole("button", {
      name: "Select all services",
    });
    fireEvent.click(selectAll);
    fireEvent.click(selectAll);
    expect(
      screen.getByText(`${DISCOVERY_SERVICE_PRESETS.length} selected`),
    ).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "" } });
    expandServiceGroups();
    for (const preset of DISCOVERY_SERVICE_PRESETS) {
      const label = screen.getByText(preset.label).closest("label")!;
      expect(within(label).getByRole("checkbox")).toBeChecked();
    }
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue(
      "22, 2222",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear services" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    fireEvent.click(selectAll);
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue(
      "22, 2222",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reserves input space for the search icon and gives service labels decorative icons", () => {
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    expandServiceGroups();
    const filter = screen.getByLabelText("Filter service presets");
    expect(filter).toHaveClass("sor-form-input", "sor-form-input-icon-left");
    const iconSpacing = readFileSync("src/styles/forms.css", "utf8").match(
      /\.sor-form-input\.sor-form-input-icon-left\s*\{[^}]+\}/,
    )?.[0];
    expect(iconSpacing).toContain("padding-left: 2.25rem !important");
    expect(filter.previousElementSibling).toHaveClass(
      "top-1/2",
      "-translate-y-1/2",
      "pointer-events-none",
    );
    expect(filter.previousElementSibling).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    for (const preset of DISCOVERY_SERVICE_PRESETS) {
      const label = screen.getByText(preset.label).closest("label")!;
      expect(label.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(within(label).getByRole("checkbox")).toHaveAccessibleName(
        `${preset.label} TCP ${preset.ports.join(", ")}`,
      );
    }
  });

  it("selects or clears a whole category while preserving other services and custom ports", () => {
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Remote access"));
    fireEvent.change(screen.getByLabelText("SSH / SFTP / SCP ports"), {
      target: { value: "2222" },
    });
    const filter = screen.getByLabelText("Filter service presets");
    fireEvent.change(filter, { target: { value: "SSH" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Select all Remote access services" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select all Remote access services" }),
    );
    fireEvent.change(filter, { target: { value: "" } });
    expandServiceGroups();
    for (const preset of DISCOVERY_SERVICE_PRESETS.filter(
      (item) => item.group === "Remote access",
    )) {
      expect(
        within(screen.getByText(preset.label).closest("label")!).getByRole(
          "checkbox",
        ),
      ).toBeChecked();
    }
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue("2222");
    expect(
      screen.getByRole("checkbox", { name: /HTTPS websites/ }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Select no Remote access services" }),
    );
    expect(
      screen.getByRole("checkbox", { name: /SSH \/ SFTP \/ SCP/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /HTTPS websites/ }),
    ).toBeChecked();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("applies a subnet preset without scanning or changing targets and workload limits", () => {
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
      target: { value: "192.0.2.0/24, 198.51.100.1" },
    });
    fireEvent.click(screen.getByText("Remote access"));
    fireEvent.change(screen.getByLabelText("SSH / SFTP / SCP ports"), {
      target: { value: "2222" },
    });
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Concurrent probes"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Additional TCP ports / ranges"), {
      target: { value: "9000-9003" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Scan preset" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "iLO / management" }),
    );
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue("2222");
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue("22");
    expect(screen.getByLabelText("Concurrent probes")).toHaveValue(12);
    expect(screen.getByLabelText("Additional TCP ports / ranges")).toHaveValue(
      "",
    );
    expect(screen.getByLabelText("networkDiscovery.ipRange")).toHaveValue(
      "192.0.2.0/24, 198.51.100.1",
    );
    expect(screen.getByText(/Applied iLO \/ management/)).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("uses selected presets and edited ports, and identifies the product from the HTTP response", async () => {
    mocks.invoke.mockResolvedValue({
      open: true,
      time_ms: 2,
      http_title: "cPanel Login",
      http_server: "nginx/1.26.0",
      http_status: 200,
    });
    render(
      <NetworkDiscovery
        isOpen
        embedded
        onClose={vi.fn()}
        allowCreateConnections={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
      target: { value: "192.0.2.10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear services" }));
    expect(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Filter service presets"), {
      target: { value: "cpanel" },
    });
    fireEvent.click(screen.getByText("Web services"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^cPanel \/ WHM \(HTTPS\)/ }),
    );
    fireEvent.change(screen.getByLabelText("cPanel / WHM (HTTPS) ports"), {
      target: { value: "2083" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    expect(await screen.findByText("cPanel")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("check_port", {
      host: "192.0.2.10",
      port: 2083,
      timeoutSecs: 5,
      identifyHttp: "https",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Show services for 192.0.2.10" }),
    );
    expect(screen.getByText("Identified from response")).toBeInTheDocument();
    expect(screen.getByText("Scan complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("runs only service ports after toggling host discovery off, retaining the method and service selections", async () => {
    mocks.invoke.mockResolvedValue({ open: false, time_ms: 2 });
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    await screen.findByText("Probe capabilities: windows");
    fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
      target: { value: "192.0.2.10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear services" }));
    fireEvent.click(screen.getByText("Remote access"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^SSH \/ SFTP \/ SCP/ }),
    );
    fireEvent.change(screen.getByLabelText("SSH / SFTP / SCP ports"), {
      target: { value: "2222" },
    });
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Additional TCP ports / ranges"), {
      target: { value: "9000" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "ICMP echo" }));
    const hostToggle = screen.getByRole("checkbox", {
      name: "Discover hosts with ping / ARP",
    });
    expect(hostToggle).toBeChecked();
    fireEvent.click(hostToggle);
    const serviceToggle = screen.getByRole("checkbox", {
      name: "Scan services / ports",
    });
    fireEvent.click(serviceToggle);
    expect(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    ).toBeDisabled();
    fireEvent.click(serviceToggle);
    expect(hostToggle).not.toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Ping method" }),
    ).toHaveTextContent("ICMP echo");
    expect(screen.getByLabelText("SSH / SFTP / SCP ports")).toHaveValue("2222");
    expect(screen.getByLabelText("Additional TCP ports / ranges")).toHaveValue(
      "9000",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await screen.findByText("Scan complete");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    for (const port of [2222, 9000]) {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "check_port",
        expect.objectContaining({ host: "192.0.2.10", port, timeoutSecs: 5 }),
      );
    }
    expect(
      mocks.invoke.mock.calls.every(([command]) => command === "check_port"),
    ).toBe(true);
  });

  it("starts an ARP-only sweep retaining service selections without probing their ports", async () => {
    mocks.invoke.mockResolvedValue({
      reachable: true,
      status: "responsive",
      elapsed_ms: 2,
      mac_address: "00:11:22:33:44:55",
      attempts: [
        {
          method: "arp",
          status: "responsive",
          elapsed_ms: 2,
          error: "Windows may use cached neighbor information",
        },
      ],
    });
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    await screen.findByText("Probe capabilities: windows");
    fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
      target: { value: "192.0.2.10" },
    });
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Additional TCP ports / ranges"), {
      target: { value: "9000" },
    });
    const selectedServices = screen.getByText(/^\d+ selected$/).textContent!;
    const selectedPorts = screen.getByText(
      /unique TCP ports selected/,
    ).textContent!;
    fireEvent.click(screen.getByRole("button", { name: "ARP sweep only" }));
    expect(screen.getByText(selectedServices)).toBeVisible();
    expect(screen.getByText(/unique TCP ports selected/)).toHaveTextContent(
      selectedPorts,
    );
    expect(
      screen.getByRole("checkbox", { name: "Discover hosts with ping / ARP" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Scan services / ports" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Additional TCP ports / ranges")).toHaveValue(
      "9000",
    );
    const start = screen.getByRole("button", {
      name: "networkDiscovery.startScan",
    });
    expect(start).toBeEnabled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(start);
    await screen.findByText("Scan complete");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "probe_discovery_host",
      {
        host: "192.0.2.10",
        method: "arp",
        timeoutMs: 1000,
        port: 443,
      },
    );
    const row = screen
      .getByRole("heading", { name: "192.0.2.10" })
      .closest("tr")!;
    expect(within(row).getByText("0 open ports")).toBeVisible();
    expect(within(row).getByText("No service found")).toBeVisible();
    expect(within(row).getByText("Reachability evidence found")).toBeVisible();
    expect(within(row).getByText("00:11:22:33:44:55")).toBeVisible();
    fireEvent.click(within(row).getByLabelText("Probe details for 192.0.2.10"));
    expect(
      within(row).getByText("Windows may use cached neighbor information"),
    ).toBeVisible();
  });

  it.each([false, true])(
    "honors the scan-unresponsive setting (%s) with ICMP host discovery",
    async (scanUnresponsive) => {
      mocks.invoke.mockImplementation(async (command) =>
        command === "probe_discovery_host"
          ? { reachable: false, elapsed_ms: 1000 }
          : { open: true, banner: "SSH-2.0-OpenSSH_9.6" },
      );
      render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
      fireEvent.click(screen.getByText("Remote access"));
      fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
        target: { value: "192.0.2.10" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Clear services" }));
      fireEvent.click(
        screen.getByRole("checkbox", { name: /^SSH \/ SFTP \/ SCP/ }),
      );
      fireEvent.click(screen.getByRole("combobox", { name: "Ping method" }));
      fireEvent.mouseDown(screen.getByRole("option", { name: "ICMP echo" }));
      if (!scanUnresponsive)
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: "Scan hosts that do not reply to ping",
          }),
        );
      fireEvent.click(
        screen.getByRole("button", { name: "networkDiscovery.startScan" }),
      );
      await screen.findByText("Scan complete");
      expect(mocks.invoke).toHaveBeenCalledWith("probe_discovery_host", {
        host: "192.0.2.10",
        method: "icmp",
        timeoutMs: 1000,
        port: 443,
      });
      expect(
        mocks.invoke.mock.calls.filter(([command]) => command === "check_port"),
      ).toHaveLength(scanUnresponsive ? 1 : 0);
      if (scanUnresponsive)
        expect(
          screen.getByText("No ping reply · TCP scanned"),
        ).toBeInTheDocument();
      else expect(screen.getByText("1 skipped hosts")).toBeInTheDocument();
    },
  );

  it("shows the current action, elapsed time, and draining state while controls stay disabled", async () => {
    vi.useFakeTimers();
    let finish!: (value: { open: boolean }) => void;
    mocks.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Remote access"));
    fireEvent.change(screen.getByLabelText("networkDiscovery.ipRange"), {
      target: { value: "192.0.2.10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear services" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^SSH \/ SFTP \/ SCP/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Checking TCP ports")).toBeInTheDocument();
    expect(screen.getByText("Elapsed 0:01")).toBeInTheDocument();
    expect(screen.getByText("System CPU busy time 15%")).toBeVisible();
    expect(
      screen.getByText("Logical CPUs: 8 available to process / 80 total"),
    ).toBeVisible();
    expect(screen.getByText("Physical cores: 40")).toBeVisible();
    expect(screen.getByText("CPU sample: 1000 ms · age 0 ms")).toBeVisible();
    expect(
      screen.getByText("Current: 192.0.2.10 · TCP 22"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("networkDiscovery.ipRange")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Select all services" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Clear services" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.stop" }),
    );
    expect(
      screen.getByText("Stopping — waiting for active probes"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    await act(async () => {
      finish({ open: false });
    });
    expect(screen.getByText("Scan stopped")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
    expect(screen.getByLabelText("networkDiscovery.ipRange")).toBeEnabled();
  });

  it("keeps retry blocked after one probe fails until the other native probe drains", async () => {
    let rejectFirst!: (error: Error) => void;
    let finishSecond!: (result: { open: boolean }) => void;
    mocks.invoke
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          }),
      );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useNetworkDiscovery({ onClose: vi.fn(), native: true }),
    );
    act(() =>
      result.current.setConfig({
        ...result.current.config,
        ipRange: "192.0.2.0/30",
        portRanges: ["22", "443"],
        protocols: [],
        maxConcurrent: 2,
        maxPortConcurrent: 2,
      }),
    );
    let run!: Promise<void>;
    act(() => {
      run = result.current.handleScan();
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      rejectFirst(new Error("Probe failed"));
    });
    expect(result.current.isScanning).toBe(true);
    await act(async () => {
      await result.current.handleScan();
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishSecond({ open: true });
      await run;
    });
    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanError).toBe("Probe failed");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    mocks.invoke.mockResolvedValue({ open: false });
    await act(async () => {
      await result.current.handleScan();
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
    expect(result.current.scanError).toBeNull();
  });
  it("mounts without a database or modal, waits for an explicit target and scan, and shows native TCP results", async () => {
    mocks.invoke.mockResolvedValue({
      open: true,
      time_ms: 2,
      banner: "SSH-2.0-OpenSSH_9.6",
    });
    const session = createToolSession("networkScanner");
    expect(session).toMatchObject({
      protocol: "tool:networkScanner",
      name: "Network Scanner",
    });
    expect(findExistingToolSession([session], "networkScanner")).toBe(session);
    expect(TOOL_DESCRIPTORS.networkScanner.access).toBe("app");
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    await screen.findByTestId("network-scanner-tab");
    await screen.findByText("Probe capabilities: windows");
    expect(mocks.probeCapabilities).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    const scan = screen.getByRole("button", {
      name: "networkDiscovery.startScan",
    });
    expect(scan).toBeDisabled();
    fireEvent.change(
      screen.getByRole("combobox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "192.0.2.1" } },
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(scan);
    await screen.findByRole("heading", { name: "192.0.2.1" });
    expect(mocks.invoke).toHaveBeenCalledWith("check_port", {
      host: "192.0.2.1",
      port: 22,
      timeoutSecs: 5,
    });
    expect(
      mocks.invoke.mock.calls.every(([command]) => command === "check_port"),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Show services for 192.0.2.1" }),
    );
    expect(screen.getAllByText("SSH").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenSSH").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SSH-2.0-OpenSSH_9.6").length).toBeGreaterThan(
      0,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hide services for 192.0.2.1" }),
    );
    expect(
      screen.queryByRole("button", {
        name: "networkDiscovery.createConnections",
      }),
    ).toBeNull();
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "192.0.2.1" }),
    ).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_CONNECTION" }),
    );
  });

  it("reports invalid targets before making any native scan request", async () => {
    render(
      <ToolTabViewer
        session={createToolSession("networkScanner")}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("network-scanner-tab");
    fireEvent.change(
      screen.getByRole("combobox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "invalid" } },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/IPv4|CIDR/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("stops queued probes on tab close and ignores late native results", async () => {
    const pending: Array<(value: { open: boolean }) => void> = [];
    mocks.invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const view = render(
      <ToolTabViewer
        session={createToolSession("networkScanner")}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("network-scanner-tab");
    fireEvent.change(
      screen.getByRole("combobox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "192.0.2.0/24" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    // Initial adaptive admission is conservative while interface metrics warm up.
    await waitFor(() => expect(pending).toHaveLength(8));
    view.unmount();
    await act(async () => {
      pending.forEach((resolve) => resolve({ open: true }));
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(8);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("opens from the toolbar with its descriptor icon and honors visibility", () => {
    const setShowNetworkScanner = vi.fn();
    const props = {
      appSettings: defaultSettings,
      databaseManager: { getCurrentDatabase: () => undefined },
      connections: [],
      setShowNetworkScanner,
    } as unknown as React.ComponentProps<typeof AppToolbar>;
    const view = render(<AppToolbar {...props} />);
    const button = screen.getByRole("button", { name: "Network Scanner" });
    expect(button).toBeEnabled();
    expect(
      button.querySelector('[data-tool-icon="networkScanner"]'),
    ).not.toBeNull();
    fireEvent.click(button);
    expect(setShowNetworkScanner).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    view.rerender(
      <AppToolbar
        {...props}
        appSettings={{ ...defaultSettings, showNetworkScannerIcon: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Network Scanner" }),
    ).toBeNull();
  });

  it("includes the toolbar toggle in Layout defaults and reset", () => {
    const updateSettings = vi.fn();
    render(
      <LayoutSettings
        settings={defaultSettings}
        updateSettings={updateSettings}
      />,
    );
    const toggle = screen.getByRole("checkbox", { name: /^Network Scanner/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({
      showNetworkScannerIcon: false,
    });
    expect(DEFAULT_VALUES.showNetworkScannerIcon).toBe(true);
    expect(TAB_DEFAULTS.layout).toContain("showNetworkScannerIcon");
  });
});
