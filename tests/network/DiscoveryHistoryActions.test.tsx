import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import * as storage from "../../src/utils/discovery/scanHistory";
import * as csv from "../../src/utils/discovery/exportDiscoveryScan";
import type { DiscoveredHost } from "../../src/types/connection/connection";

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  configure: vi.fn(),
  close: vi.fn(),
}));
const host = (ip: string): DiscoveredHost => ({
  ip,
  openPorts: [22],
  responseTime: 1,
  services: [{ port: 22, protocol: "ssh", service: "SSH" }],
});
const saved: storage.SavedDiscoveryScan = {
  id: "saved-office",
  name: "Office snapshot",
  startedAt: 1700000000000,
  elapsedMs: 1000,
  outcome: "complete",
  hosts: [host("192.0.2.10"), host("192.0.2.11")],
  config: {
    enabled: true,
    ipRange: "192.0.2.0/24",
    portRanges: [],
    protocols: ["ssh"],
    timeout: 500,
    maxConcurrent: 2,
    maxPortConcurrent: 2,
    customPorts: {},
    probeStrategies: {},
    cacheTTL: 0,
    hostnameTtl: 0,
    macTtl: 0,
  },
};
const liveHosts = [host("198.51.100.9")];

vi.mock("../../src/hooks/network/useNetworkDiscovery", async () => {
  const { useDiscoveryScanHistory } =
    await import("../../src/hooks/network/useDiscoveryScanHistory");
  return {
    useNetworkDiscovery: () => ({
      t: (key: string) => key,
      scanHistory: useDiscoveryScanHistory(),
      config: { ...saved.config, ipRange: "198.51.100.9" },
      discoveredHosts: liveHosts,
      filteredHosts: liveHosts,
      filterText: "",
      selectedServices: new Set(),
      selectedHosts: new Set(),
      native: true,
      isScanning: true,
      isPaused: false,
      isStopping: false,
      saveStatus: "idle",
      canSaveToHistory: false,
      canDiscardResults: false,
      handleScan: actions.start,
      setConfig: actions.configure,
    }),
  };
});
vi.mock("../../src/components/network/DiscoveryConfigSidebar", () => ({
  DiscoveryConfigSidebar: () => null,
}));
vi.mock("../../src/components/network/DiscoveryScanProgress", () => ({
  DiscoveryScanProgress: () => null,
}));
vi.mock("../../src/components/network/DiscoveryHostsTable", () => ({
  DiscoveryHostsTable: ({
    mgr,
  }: {
    mgr: {
      filteredHosts: DiscoveredHost[];
      filterText: string;
      setFilterText?: (value: string) => void;
      handleExportCSV?: () => void;
    };
  }) => (
    <div>
      <input
        aria-label="Filter hosts"
        value={mgr.filterText}
        onChange={(event) => mgr.setFilterText?.(event.target.value)}
      />
      <button onClick={mgr.handleExportCSV}>Export visible CSV</button>
      {mgr.filteredHosts.map((item) => (
        <span key={item.ip}>{item.ip}</span>
      ))}
    </div>
  ),
}));

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const historyTab = () =>
  fireEvent.click(screen.getByRole("tab", { name: /^History/ }));
async function mount(embedded = true) {
  render(
    <NetworkDiscovery isOpen embedded={embedded} onClose={actions.close} />,
  );
  await screen.findByRole("tab", { name: "History (1)" });
  historyTab();
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  await storage.clearDiscoveryScans();
  await storage.saveDiscoveryScan(saved);
  vi.clearAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:history");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("History scan actions", () => {
  it("exports a valid header CSV for a zero-host snapshot", async () => {
    await storage.clearDiscoveryScans();
    await storage.saveDiscoveryScan({ ...saved, hosts: [] });
    await mount();
    expect(
      screen.getByRole("button", { name: "Export CSV: Office snapshot" }),
    ).toBeEnabled();
    click("Export CSV: Office snapshot");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export CSV: Office snapshot" }),
      ).toBeEnabled(),
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.size).toBeGreaterThan(0);
    expect(actions.start).not.toHaveBeenCalled();
  });
  it("exports the full saved snapshot directly and opens it without changing the active scan", async () => {
    const exportCsv = vi.spyOn(csv, "exportDiscoveryScanCsv");
    await mount();
    const row = screen.getByRole("group", {
      name: "Saved scan: Office snapshot",
    });
    expect(
      within(row).getByText(new Date(saved.startedAt).toLocaleString()),
    ).toBeInTheDocument();
    for (const name of [
      "Open scan",
      "Export CSV",
      "Rename scan",
      "Delete scan",
    ])
      expect(
        within(row).getByRole("button", { name: `${name}: Office snapshot` }),
      ).toBeEnabled();
    click("Export CSV: Office snapshot");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open scan: Office snapshot" }),
      ).toBeEnabled(),
    );
    expect(exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ id: saved.id, hosts: saved.hosts }),
    );
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toContain("192.0.2.10");
    expect(text).toContain("192.0.2.11");
    expect(text).not.toContain("198.51.100.9");
    click("Open scan: Office snapshot");
    expect(screen.getByRole("tab", { name: "Saved scan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Office snapshot" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter hosts" }), {
      target: { value: "192.0.2.11" },
    });
    click("Export visible CSV");
    expect(exportCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: saved.id }),
      [saved.hosts[1]],
    );
    fireEvent.click(
      screen.getByRole("tab", { name: "Current scan · running" }),
    );
    expect(screen.getByText("198.51.100.9")).toBeInTheDocument();
    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.configure).not.toHaveBeenCalled();
  });

  it("focuses and selects the existing name, waits for persistence, and updates the already opened saved view", async () => {
    await mount();
    click("Open scan: Office snapshot");
    historyTab();
    click("Rename scan: Office snapshot");
    const input = screen.getByRole("textbox", {
      name: "Scan name: Office snapshot",
    }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(saved.name!.length);
    expect(input).toHaveAttribute("maxlength", "200");
    fireEvent.change(input, { target: { value: "Renamed office" } });
    const gate = deferred();
    const persist = storage.renameDiscoveryScan;
    const rename = vi
      .spyOn(storage, "renameDiscoveryScan")
      .mockImplementation(async (...args) => {
        await gate.promise;
        return persist(...args);
      });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1));
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reload history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("group", { name: "Saved scan: Office snapshot" }),
    ).toBeInTheDocument();
    await act(async () => gate.resolve());
    await screen.findByRole("button", { name: "Rename scan: Renamed office" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect((await storage.listDiscoveryScans())[0].name).toBe("Renamed office");
    fireEvent.click(screen.getByRole("tab", { name: "Saved scan" }));
    expect(
      screen.getByRole("heading", { name: "Renamed office" }),
    ).toBeInTheDocument();
    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.configure).not.toHaveBeenCalled();
  });

  it("retains a failed rename draft and error, then allows a successful retry", async () => {
    vi.spyOn(storage, "renameDiscoveryScan").mockRejectedValueOnce(
      new Error("Disk full"),
    );
    await mount();
    click("Rename scan: Office snapshot");
    const input = screen.getByRole("textbox", {
      name: "Scan name: Office snapshot",
    });
    fireEvent.change(input, { target: { value: "Retry name" } });
    click("Save name");
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((item) => item.textContent?.includes("Disk full")),
      ).toBe(true),
    );
    expect(input).toHaveValue("Retry name");
    expect(input).toBeEnabled();
    expect((await storage.listDiscoveryScans())[0].name).toBe(
      "Office snapshot",
    );
    expect(
      screen.getByRole("group", { name: "Saved scan: Office snapshot" }),
    ).toBeInTheDocument();
    click("Save name");
    await screen.findByRole("button", { name: "Rename scan: Retry name" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("uses the date fallback and cancels with Escape or Cancel without persisting or closing the modal", async () => {
    await storage.clearDiscoveryScans();
    await storage.saveDiscoveryScan({ ...saved, name: undefined });
    const rename = vi.spyOn(storage, "renameDiscoveryScan");
    await mount(false);
    const label = new Date(saved.startedAt).toLocaleString();
    click(`Rename scan: ${label}`);
    let input = screen.getByRole("textbox", { name: `Scan name: ${label}` });
    expect(input).toHaveValue(label);
    fireEvent.change(input, { target: { value: "Cancelled" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(actions.close).not.toHaveBeenCalled();
    click(`Rename scan: ${label}`);
    input = screen.getByRole("textbox", { name: `Scan name: ${label}` });
    expect(input).toHaveValue(label);
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    click("Cancel rename");
    expect(rename).not.toHaveBeenCalled();
  });

  it("confirms deletion, waits before closing the selected scan, and guards duplicate deletion", async () => {
    await mount();
    click("Open scan: Office snapshot");
    historyTab();
    const gate = deferred();
    const persist = storage.deleteDiscoveryScan;
    const remove = vi
      .spyOn(storage, "deleteDiscoveryScan")
      .mockImplementation(async (id) => {
        await gate.promise;
        return persist(id);
      });
    click("Delete scan: Office snapshot");
    expect(remove).not.toHaveBeenCalled();
    click("Cancel delete");
    expect(
      screen.queryByRole("button", { name: /^Confirm delete/ }),
    ).not.toBeInTheDocument();
    click("Delete scan: Office snapshot");
    click("Confirm delete scan: Office snapshot");
    click("Confirm delete scan: Office snapshot");
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("tab", { name: "Saved scan" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Confirm delete scan: Office snapshot",
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Saved scan" }));
    await act(async () => gate.resolve());
    await screen.findByText("No saved scans yet.");
    expect(screen.getByRole("tab", { name: "History (0)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("tab", { name: "Saved scan" }),
    ).not.toBeInTheDocument();
    expect(await storage.listDiscoveryScans()).toEqual([]);
    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.configure).not.toHaveBeenCalled();
  });

  it("keeps the selected scan and confirmation available after deletion fails", async () => {
    vi.spyOn(storage, "deleteDiscoveryScan").mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    await mount();
    click("Open scan: Office snapshot");
    historyTab();
    click("Delete scan: Office snapshot");
    click("Confirm delete scan: Office snapshot");
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((item) => item.textContent?.includes("Storage unavailable")),
      ).toBe(true),
    );
    expect(screen.getByRole("tab", { name: "Saved scan" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Confirm delete scan: Office snapshot",
      }),
    ).toBeEnabled();
    expect(await storage.listDiscoveryScans()).toHaveLength(1);
    click("Confirm delete scan: Office snapshot");
    await screen.findByText("No saved scans yet.");
    expect(
      screen.queryByRole("tab", { name: "Saved scan" }),
    ).not.toBeInTheDocument();
  });

  it("retains reload and confirmed clear, removing the selected saved view after clear", async () => {
    await mount();
    click("Open scan: Office snapshot");
    historyTab();
    click("Reload history");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Clear scan history" }),
      ).toBeEnabled(),
    );
    click("Clear scan history");
    click("Cancel");
    expect(await storage.listDiscoveryScans()).toHaveLength(1);
    click("Clear scan history");
    click("Confirm clear all scan history");
    await screen.findByText("No saved scans yet.");
    expect(
      screen.queryByRole("tab", { name: "Saved scan" }),
    ).not.toBeInTheDocument();
  });
});
