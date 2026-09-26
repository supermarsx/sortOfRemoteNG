import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
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

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), dispatch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
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
  mocks.invoke.mockReset();
  mocks.dispatch.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("Network Scanner tool", () => {
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
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    const scan = screen.getByRole("button", {
      name: "networkDiscovery.startScan",
    });
    expect(scan).toBeDisabled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "192.0.2.1" } },
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(scan);
    await screen.findByText("192.0.2.1");
    expect(mocks.invoke).toHaveBeenCalledWith("check_port", {
      host: "192.0.2.1",
      port: 22,
      timeoutSecs: 5,
    });
    expect(
      mocks.invoke.mock.calls.every(([command]) => command === "check_port"),
    ).toBe(true);
    expect(screen.getByText("SSH")).toBeInTheDocument();
    expect(screen.getAllByText("SSH-2.0-OpenSSH_9.6").length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByText("192.0.2.1"));
    expect(
      screen.queryByRole("button", {
        name: "networkDiscovery.createConnections",
      }),
    ).toBeNull();
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByText("192.0.2.1")).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_CONNECTION" }),
    );
  });

  it("reports invalid targets before making any native request", async () => {
    render(
      <ToolTabViewer
        session={createToolSession("networkScanner")}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("network-scanner-tab");
    fireEvent.change(
      screen.getByRole("textbox", { name: "networkDiscovery.ipRange" }),
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
      screen.getByRole("textbox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "192.0.2.0/24" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await waitFor(() => expect(pending).toHaveLength(50));
    view.unmount();
    await act(async () => {
      pending.forEach((resolve) => resolve({ open: true }));
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(50);
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
