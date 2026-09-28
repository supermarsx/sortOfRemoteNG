import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNetworkDiscovery } from "../../src/hooks/network/useNetworkDiscovery";
import { useDiscoveryScanHistory } from "../../src/hooks/network/useDiscoveryScanHistory";
import { NetworkScanner } from "../../src/utils/network/networkScanner";
import * as storage from "../../src/utils/discovery/scanHistory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ dispatch: vi.fn(), state: { connections: [] } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(async () => {
  await storage.clearDiscoveryScans();
  vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue([
    {
      ip: "192.0.2.25",
      openPorts: [22],
      services: [{ port: 22, protocol: "ssh", service: "SSH" }],
      responseTime: 1,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("explicit discovery history persistence", () => {
  it("allows saving current results again after their history copy is deleted", async () => {
    const { result } = renderHook(() =>
      useNetworkDiscovery({ onClose: () => {} }),
    );
    await waitFor(() => expect(result.current.scanHistory.loading).toBe(false));
    await act(async () => {
      await result.current.handleScan();
    });
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    expect(result.current.saveStatus).toBe("saved");
    const saved = result.current.scanHistory.scans[0];
    const results = result.current.discoveredHosts;
    await act(async () => {
      await result.current.scanHistory.deleteScan(saved.id);
    });
    expect(result.current.discoveredHosts).toBe(results);
    expect(result.current.saveStatus).toBe("unsaved");
    expect(result.current.canSaveToHistory).toBe(true);
    expect(await storage.listDiscoveryScans()).toEqual([]);
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    expect(await storage.listDiscoveryScans()).toEqual([saved]);
  });
  it("retries the same snapshot, clears persistence errors, and reopens saved history after discard and remount", async () => {
    const { result, unmount } = renderHook(() =>
      useNetworkDiscovery({ onClose: () => {} }),
    );
    await waitFor(() => expect(result.current.scanHistory.loading).toBe(false));
    await act(async () => {
      await result.current.handleScan();
    });
    expect(await storage.listDiscoveryScans()).toEqual([]);
    const persist = vi
      .spyOn(storage, "saveDiscoveryScan")
      .mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.scanHistory.error).toContain("not persisted");
    expect(result.current.scanHistory.scans).toHaveLength(1);
    expect(await storage.listDiscoveryScans()).toEqual([]);
    await act(async () => {
      // The ref guard must also prevent duplicate calls before React renders.
      await Promise.all([
        result.current.handleSaveToHistory(),
        result.current.handleSaveToHistory(),
      ]);
    });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0]).toEqual(persist.mock.calls[0][0]);
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.saveError).toBeNull();
    expect(result.current.scanHistory.error).toBeNull();
    const saved = await storage.listDiscoveryScans();
    expect(saved).toHaveLength(1);
    act(() => {
      result.current.toggleHostSelection("192.0.2.25");
      result.current.setFilterText("SSH");
    });
    act(() => {
      result.current.handleDiscardResults();
    });
    expect(result.current.discoveredHosts).toEqual([]);
    expect(result.current.selectedServices.size).toBe(0);
    expect(result.current.filterText).toBe("");
    expect(result.current.scanStatus).toBeNull();
    expect(result.current.hasScanned).toBe(false);
    expect(result.current.scanHistory.scans).toEqual(saved);
    expect(await storage.listDiscoveryScans()).toEqual(saved);
    unmount();
    const reopened = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(reopened.result.current.loading).toBe(false));
    expect(reopened.result.current.scans).toEqual(saved);
    expect(reopened.result.current.error).toBeNull();
  });

  it("does not hide another scan's persistence failure when retrying the current scan", async () => {
    const { result } = renderHook(() =>
      useNetworkDiscovery({ onClose: () => {} }),
    );
    await waitFor(() => expect(result.current.scanHistory.loading).toBe(false));
    await act(async () => {
      await result.current.handleScan();
    });
    const persist = vi
      .spyOn(storage, "saveDiscoveryScan")
      .mockRejectedValueOnce(new Error("first failure"));
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    const firstScan = result.current.scanHistory.scans[0];
    await act(async () => {
      await result.current.handleScan();
    });
    persist.mockRejectedValueOnce(new Error("second failure"));
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    await act(async () => {
      await result.current.handleSaveToHistory();
    });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.scanHistory.error).toContain("not persisted");
    expect(await storage.listDiscoveryScans()).toHaveLength(1);
    await act(async () => {
      await result.current.scanHistory.saveScan(firstScan);
    });
    expect(result.current.scanHistory.error).toBeNull();
    expect(await storage.listDiscoveryScans()).toHaveLength(2);
  });
});
