import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import { NetworkScanner } from "../../src/utils/network/networkScanner";
import type { DiscoverySpreadsheetRequest } from "../../src/components/network/DiscoverySpreadsheetDialog";
import { createDiscoverySpreadsheet } from "../../src/utils/discovery/discoverySpreadsheet";
import { spreadsheetScan, deferred } from "./discoverySpreadsheetFixtures";
import type { DiscoveredHost } from "../../src/types/connection/connection";
import type { SavedDiscoveryScan } from "../../src/utils/discovery/scanHistory";

const mock = vi.hoisted(() => ({
  request: null as DiscoverySpreadsheetRequest | null,
  scans: [] as SavedDiscoveryScan[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch: vi.fn(), state: { connections: [] } }),
}));
vi.mock("../../src/hooks/network/useDiscoveryScanHistory", () => ({
  useDiscoveryScanHistory: () => ({
    scans: mock.scans,
    loading: false,
    error: null,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../src/components/network/DiscoverySpreadsheetDialog", () => ({
  DiscoverySpreadsheetDialog: ({
    request,
  }: {
    request: DiscoverySpreadsheetRequest;
  }) => {
    mock.request = request;
    return (
      <div role="dialog" aria-label="Export request">
        {request.filteredHosts?.length} filtered hosts captured
      </div>
    );
  },
}));

beforeEach(() => {
  mock.request = null;
  mock.scans = [];
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("discovery spreadsheet snapshot workflow", () => {
  it("exports the named history snapshot, then supports filtering its saved-results view", () => {
    const scan = spreadsheetScan();
    mock.scans = [scan];
    const { unmount } = render(
      <NetworkDiscovery isOpen embedded onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "History (1)" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Export to Documents: Office scan" }),
    );
    expect(mock.request?.scan).toEqual(scan);
    expect(mock.request?.scan).not.toBe(scan);
    expect(mock.request?.filteredHosts).toBeUndefined();
    unmount();
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "History (1)" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open scan: Office scan" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Filter discovered hosts and services",
      }),
      { target: { value: "router" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export to Documents" }),
    );
    expect(mock.request?.scan).toEqual(scan);
    expect(mock.request?.filteredHosts).toEqual([scan.hosts[1]]);
    expect(mock.request?.filterText).toBe("router");
  });
  it("exports the executed configuration after the user edits the next scan's form, and returns a private copy", async () => {
    const scan = spreadsheetScan();
    const pending = deferred<DiscoveredHost[]>();
    vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockImplementation(
      () => pending.promise,
    );
    const { result } = renderHook(() =>
      useNetworkDiscovery({ onClose: vi.fn() }),
    );
    act(() => result.current.setConfig(scan.config));
    let scanning!: Promise<void>;
    act(() => {
      scanning = result.current.handleScan();
    });
    expect(result.current.getDocumentExportScan()).toBeNull();
    await act(async () => {
      pending.resolve(scan.hosts);
      await scanning;
    });
    act(() =>
      result.current.setConfig({
        ...scan.config,
        ipRange: "203.0.113.0/24",
        timeout: 9999,
      }),
    );
    const snapshot = result.current.getDocumentExportScan()!;
    expect(snapshot.config).toEqual(scan.config);
    expect(snapshot.outcome).toBe("complete");
    const doc = createDiscoverySpreadsheet({
      scan: snapshot,
      name: "Executed scan",
    });
    const block = doc.blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    const values = Object.values(block.workbook.sheets[0].cells).map(
      (cell) => cell.value,
    );
    expect(values).toContain("192.0.2.0/24");
    expect(values).not.toContain("203.0.113.0/24");
    snapshot.config.ipRange = "changed exported copy";
    snapshot.hosts[0].services[0].service = "changed copy";
    expect(result.current.getDocumentExportScan()!.config).toEqual(scan.config);
    expect(
      result.current.getDocumentExportScan()!.hosts[0].services[0].service,
    ).toBe("SSH");
    act(() => result.current.handleDiscardResults());
    expect(result.current.getDocumentExportScan()).toBeNull();
  });
  it("captures all matching hosts across pagination with their full services, independently of selection", async () => {
    const seed = spreadsheetScan().hosts[0];
    const hosts = Array.from({ length: 120 }, (_, index) => ({
      ...seed,
      ip: `192.0.2.${index + 1}`,
      hostname: index < 105 ? `server-${index}` : `router-${index}`,
    }));
    vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue(hosts);
    render(<NetworkDiscovery isOpen embedded onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "networkDiscovery.ipRange" }),
      { target: { value: "192.0.2.0/24" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "networkDiscovery.startScan" }),
    );
    await screen.findByRole("table", { name: "Discovered hosts and services" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export to Documents" }),
      ).toBeEnabled(),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Filter discovered hosts and services",
      }),
      { target: { value: "server" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Next hosts" }));
    fireEvent.click(screen.getByRole("button", { name: "Next hosts" }));
    expect(screen.getByText("Page 3 of 3 · 105 hosts")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Export to Documents" }),
    );
    expect(mock.request?.scan.hosts).toHaveLength(120);
    expect(mock.request?.filteredHosts).toHaveLength(105);
    expect(mock.request?.filterText).toBe("server");
    const request = mock.request!;
    const document = createDiscoverySpreadsheet({
      scan: request.scan,
      hosts: request.filteredHosts,
      filtered: true,
      filterText: request.filterText,
      name: "All matching servers",
    });
    const block = document.blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    expect(block.workbook.sheets[1].rows).toBe(106);
    expect(block.workbook.sheets[1].cells.A2.value).toBe("192.0.2.1");
    expect(block.workbook.sheets[1].cells.A106.value).toBe("192.0.2.105");
    expect(block.workbook.sheets[2].rows).toBe(106);
    // Changing the result filter does not mutate the already reviewed snapshot.
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Filter discovered hosts and services",
      }),
      { target: { value: "router" } },
    );
    expect(request.filteredHosts).toHaveLength(105);
  });
});
