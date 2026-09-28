import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryScans,
  deleteDiscoveryScan,
  listDiscoveryScans,
  saveDiscoveryScan,
  normalizeDiscoveryScan,
  renameDiscoveryScan,
  DISCOVERY_HISTORY_NAME_MAX_LENGTH,
  type SavedDiscoveryScan,
} from "../../src/utils/discovery/scanHistory";
import { useDiscoveryScanHistory } from "../../src/hooks/network/useDiscoveryScanHistory";
import * as historyStorage from "../../src/utils/discovery/scanHistory";

const snapshot = (id = "scan", startedAt = 1): SavedDiscoveryScan => ({
  id,
  startedAt,
  elapsedMs: 100,
  outcome: "complete",
  config: {
    enabled: true,
    ipRange: "192.168.1.0/24",
    portRanges: [],
    protocols: ["ssh"],
    timeout: 1000,
    maxConcurrent: 10,
    maxPortConcurrent: 10,
    customPorts: { ssh: [22] },
    probeStrategies: { ssh: ["websocket"] },
    cacheTTL: 0,
    hostnameTtl: 0,
    macTtl: 0,
  },
  hosts: [
    {
      ip: "192.168.1.1",
      responseTime: 2,
      openPorts: [22],
      services: [
        { port: 22, protocol: "ssh", service: "SSH", banner: "hello" },
      ],
    },
  ],
});

beforeEach(async () => {
  await clearDiscoveryScans();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discovery scan history", () => {
  it("renames legacy entries durably without altering scan results or retention order", async () => {
    const old = snapshot("old", 1);
    const latest = snapshot("latest", 2);
    await saveDiscoveryScan(old);
    await saveDiscoveryScan(latest);
    expect((await listDiscoveryScans())[1]).not.toHaveProperty("name");
    expect(await renameDiscoveryScan("old", "  Server subnet  ")).toEqual({
      ...old,
      name: "Server subnet",
    });
    expect(await listDiscoveryScans()).toEqual([
      latest,
      { ...old, name: "Server subnet" },
    ]);
  });

  it.each([
    "",
    "   ",
    "x".repeat(DISCOVERY_HISTORY_NAME_MAX_LENGTH + 1),
    "line\nbreak",
    "null\0byte",
  ])("rejects invalid name %j without touching history", async (name) => {
    await saveDiscoveryScan(snapshot());
    await expect(renameDiscoveryScan("scan", name)).rejects.toThrow(
      /scan name/,
    );
    expect(await listDiscoveryScans()).toEqual([snapshot()]);
  });

  it("does not resurrect deleted scans or overwrite a newer stored snapshot when renaming", async () => {
    await saveDiscoveryScan(snapshot());
    const updated = { ...snapshot(), outcome: "failed" as const, hosts: [] };
    await saveDiscoveryScan(updated);
    expect(await renameDiscoveryScan("scan", "Review later")).toEqual({
      ...updated,
      name: "Review later",
    });
    await deleteDiscoveryScan("scan");
    await expect(renameDiscoveryScan("scan", "Deleted")).rejects.toThrow(
      /no longer exists/,
    );
    expect(await listDiscoveryScans()).toEqual([]);
  });

  it("preserves a history rename when the original terminal snapshot is saved again", async () => {
    await saveDiscoveryScan(snapshot());
    await renameDiscoveryScan("scan", "Saved name");
    await saveDiscoveryScan(snapshot());
    expect(await listDiscoveryScans()).toEqual([
      { ...snapshot(), name: "Saved name" },
    ]);
  });

  it("hook keeps a failed rename or deletion available for retry and restores the name on remount", async () => {
    await saveDiscoveryScan(snapshot());
    const hook = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.spyOn(historyStorage, "renameDiscoveryScan").mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    await act(async () => {
      await expect(
        hook.result.current.renameScan("scan", "Lab"),
      ).rejects.toThrow("disk unavailable");
    });
    expect(hook.result.current.scans).toEqual([snapshot()]);
    expect(hook.result.current.error).toContain("disk unavailable");
    await act(async () => {
      await hook.result.current.renameScan("scan", "Lab");
    });
    expect(hook.result.current.error).toBeNull();
    vi.spyOn(historyStorage, "deleteDiscoveryScan").mockRejectedValueOnce(
      new Error("delete failed"),
    );
    await act(async () => {
      await expect(hook.result.current.deleteScan("scan")).rejects.toThrow(
        "delete failed",
      );
    });
    expect(hook.result.current.scans).toEqual([{ ...snapshot(), name: "Lab" }]);
    hook.unmount();
    const reopened = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(reopened.result.current.loading).toBe(false));
    expect(reopened.result.current.scans).toEqual([
      { ...snapshot(), name: "Lab" },
    ]);
    await act(async () => {
      await reopened.result.current.deleteScan("scan");
    });
    expect(reopened.result.current.scans).toEqual([]);
    expect(await listDiscoveryScans()).toEqual([]);
    reopened.unmount();
  });

  it("serializes rename and delete without recreating the deleted entry", async () => {
    await saveDiscoveryScan(snapshot());
    const hook = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await Promise.all([
        hook.result.current.renameScan("scan", "New name"),
        hook.result.current.deleteScan("scan"),
      ]);
      await expect(
        hook.result.current.renameScan("scan", "Absent"),
      ).rejects.toThrow(/no longer exists/);
    });
    expect(await listDiscoveryScans()).toEqual([]);
    expect(hook.result.current.scans).toEqual([]);
    hook.unmount();
  });

  it("finishes an explicit rename after its scanner tab unmounts", async () => {
    await saveDiscoveryScan(snapshot());
    const hook = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const before = hook.result.current;
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.renameScan("scan", "After closing tab");
      hook.unmount();
    });
    await pending;
    expect(hook.result.current).toBe(before);
    expect((await listDiscoveryScans())[0].name).toBe("After closing tab");
  });

  it("uses the current stored results when a stale history view renames a scan", async () => {
    await saveDiscoveryScan(snapshot());
    const hook = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const newer = { ...snapshot(), elapsedMs: 200, hosts: [] };
    await saveDiscoveryScan(newer);
    await act(async () => {
      await hook.result.current.renameScan("scan", "Renamed");
    });
    expect(hook.result.current.scans).toEqual([{ ...newer, name: "Renamed" }]);
    expect(await listDiscoveryScans()).toEqual(hook.result.current.scans);
    hook.unmount();
  });

  it("explicitly saves session-only history when a rename is retried after storage recovers", async () => {
    const hook = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.spyOn(historyStorage, "saveDiscoveryScan").mockRejectedValueOnce(
      new Error("quota"),
    );
    await act(async () => {
      await expect(hook.result.current.saveScan(snapshot())).rejects.toThrow(
        "quota",
      );
    });
    expect(hook.result.current.scans).toEqual([snapshot()]);
    await act(async () => {
      await hook.result.current.renameScan("scan", "Recovered");
    });
    expect(hook.result.current.error).toBeNull();
    expect(await listDiscoveryScans()).toEqual([
      { ...snapshot(), name: "Recovered" },
    ]);
    await act(async () => {
      await hook.result.current.saveScan(snapshot());
    });
    expect(hook.result.current.scans[0].name).toBe("Recovered");
    hook.unmount();
  });
  it.each([true, false, undefined])(
    "round trips optional scan toggles and pause policy: %s",
    async (value) => {
      const input = snapshot();
      const flags = {
        hostDiscoveryEnabled: value,
        serviceScanEnabled: value,
        pauseOnHighLoad: value,
      };
      Object.assign(input.config, flags);
      await saveDiscoveryScan(input);
      const saved = (await listDiscoveryScans())[0].config;
      for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
        if (value === undefined) expect(saved).not.toHaveProperty(key);
        else expect(saved[key]).toBe(value);
      }
    },
  );

  it.each(["hostDiscoveryEnabled", "serviceScanEnabled", "pauseOnHighLoad"])(
    "rejects malformed %s without replacing saved history",
    async (key) => {
      await saveDiscoveryScan(snapshot());
      for (const value of [0, 1, "false", null]) {
        const input = snapshot();
        Object.assign(input.config, { [key]: value });
        await expect(saveDiscoveryScan(input)).rejects.toThrow(
          "expected a boolean",
        );
      }
      expect(await listDiscoveryScans()).toEqual([snapshot()]);
    },
  );

  it("persists terminal snapshots, replaces IDs, sorts, deletes and clears", async () => {
    await saveDiscoveryScan(snapshot("a", 1));
    await saveDiscoveryScan({ ...snapshot("b", 2), outcome: "stopped" });
    await saveDiscoveryScan({ ...snapshot("a", 3), outcome: "failed" });
    expect(
      (await listDiscoveryScans()).map((scan) => [scan.id, scan.outcome]),
    ).toEqual([
      ["a", "failed"],
      ["b", "stopped"],
    ]);
    await deleteDiscoveryScan("a");
    expect((await listDiscoveryScans()).map((scan) => scan.id)).toEqual(["b"]);
    await clearDiscoveryScans();
    expect(await listDiscoveryScans()).toEqual([]);
  });

  it("atomically retains the newest 20 under concurrent saves", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        saveDiscoveryScan(snapshot(String(i), i)),
      ),
    );
    const scans = await listDiscoveryScans();
    expect(scans).toHaveLength(20);
    expect(scans[0].startedAt).toBe(24);
    expect(scans[19].startedAt).toBe(5);
    await expect(saveDiscoveryScan(snapshot("too-old", 0))).rejects.toThrow(
      "older",
    );
    expect(await listDiscoveryScans()).toEqual(scans);
  });

  it("allowlists metadata, removes extra credentials, and copies nested arrays", async () => {
    const input = snapshot();
    Object.assign(input.config, {
      adaptiveConcurrency: true,
      absoluteMaxProbes: 128,
      resolveHostnames: true,
      password: "secret",
      credentials: { token: "secret" },
    });
    Object.assign(input.hosts[0], { password: "secret" });
    await saveDiscoveryScan(input);
    input.hosts[0].openPorts.push(80);
    const result = await listDiscoveryScans();
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result[0].hosts[0].openPorts).toEqual([22]);
    expect(result[0].config).toMatchObject({
      adaptiveConcurrency: true,
      absoluteMaxProbes: 128,
      resolveHostnames: true,
    });
  });

  it("rejects active, malformed, excessive-host and excessive-byte snapshots without replacing history", async () => {
    await saveDiscoveryScan(snapshot());
    for (const bad of [
      null,
      { ...snapshot(), outcome: "running" },
      { ...snapshot(), elapsedMs: NaN },
      { ...snapshot(), hosts: Array(10001).fill(snapshot().hosts[0]) },
      {
        ...snapshot(),
        hosts: Array.from({ length: 350 }, () => ({
          ...snapshot().hosts[0],
          hostname: "x".repeat(65536),
        })),
      },
    ]) {
      await expect(
        saveDiscoveryScan(bad as SavedDiscoveryScan),
      ).rejects.toThrow("Invalid discovery history");
    }
    expect(await listDiscoveryScans()).toEqual([snapshot()]);
    expect(() =>
      normalizeDiscoveryScan({ ...snapshot(), hosts: [undefined] }),
    ).toThrow();
  });

  it("evicts whole oldest scans for the byte budget without truncation", async () => {
    const large = (id: string, time: number) => ({
      ...snapshot(id, time),
      hosts: Array.from({ length: 170 }, () => ({
        ...snapshot().hosts[0],
        hostname: "x".repeat(65536),
      })),
    });
    await saveDiscoveryScan(large("old", 1));
    await saveDiscoveryScan(large("new", 2));
    const scans = await listDiscoveryScans();
    expect(scans.map((scan) => scan.id)).toEqual(["new"]);
    expect(scans[0].hosts).toHaveLength(170);
    expect(scans[0].hosts[0].hostname).toHaveLength(65536);
  });

  it("reports corrupt/unknown stored versions and allows explicit clear recovery", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("sorng-discovery-history", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("scans", "readwrite");
        tx.objectStore("scans").put({ version: 999, scan: { id: "corrupt" } });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
    await expect(listDiscoveryScans()).rejects.toThrow(
      "unsupported stored schema",
    );
    await expect(saveDiscoveryScan(snapshot())).rejects.toThrow(
      "unsupported stored schema",
    );
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("unsupported stored schema");
    await act(async () => {
      await expect(result.current.saveScan(snapshot())).rejects.toThrow(
        "unsupported stored schema",
      );
    });
    expect(result.current.scans).toEqual([snapshot()]);
    expect(result.current.error).toContain("not persisted");
    await act(async () => {
      await result.current.clearScans();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.scans).toEqual([]);
    expect(await listDiscoveryScans()).toEqual([]);
    unmount();
  });

  it("hook retains usable session scans and reports failure when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("unavailable");
    await act(async () => {
      await expect(result.current.saveScan(snapshot())).rejects.toThrow(
        "unavailable",
      );
    });
    expect(result.current.scans).toEqual([snapshot()]);
    expect(result.current.error).toContain("not persisted");
    await act(async () => {
      await expect(result.current.deleteScan("scan")).rejects.toThrow();
    });
    expect(result.current.scans).toEqual([snapshot()]);
    unmount();
  });

  it("hook loads existing history and serializes save/delete/reload", async () => {
    await saveDiscoveryScan(snapshot("existing"));
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(result.current.scans).toHaveLength(1));
    await act(async () => {
      await Promise.all([
        result.current.saveScan(snapshot("new", 2)),
        result.current.deleteScan("existing"),
        result.current.reload(),
      ]);
    });
    expect(result.current.scans.map((scan) => scan.id)).toEqual(["new"]);
    expect(result.current.error).toBeNull();
    await act(async () => {
      await result.current.clearScans();
    });
    expect(result.current.scans).toEqual([]);
    unmount();
  });

  it("persists an explicitly queued save after unmount without publishing state", async () => {
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current;
    let pending: Promise<void>;
    act(() => {
      pending = result.current.saveScan(snapshot());
      unmount();
    });
    await pending!;
    expect(result.current).toBe(before);
    expect(await listDiscoveryScans()).toEqual([snapshot()]);
  });

  it("finishes ordered mutations behind an in-flight load after unmount, but cancels queued reloads", async () => {
    let resolveLoad!: (scans: SavedDiscoveryScan[]) => void;
    const load = vi
      .spyOn(historyStorage, "listDiscoveryScans")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      );
    const operations: string[] = [];
    const save = vi
      .spyOn(historyStorage, "saveDiscoveryScan")
      .mockImplementation(async (scan) => {
        operations.push(`save:${scan.id}`);
      });
    const remove = vi
      .spyOn(historyStorage, "deleteDiscoveryScan")
      .mockImplementation(async (id) => {
        operations.push(`delete:${id}`);
      });
    const clear = vi
      .spyOn(historyStorage, "clearDiscoveryScans")
      .mockImplementation(async () => {
        operations.push("clear");
      });
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const before = result.current;
    const pending = [
      result.current.saveScan(snapshot()),
      result.current.deleteScan("scan"),
      result.current.clearScans(),
      result.current.reload(),
    ];
    expect(save).not.toHaveBeenCalled();
    unmount();
    await act(async () => {
      resolveLoad([]);
      await Promise.all(pending);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(snapshot());
    expect(remove).toHaveBeenCalledExactlyOnceWith("scan");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["save:scan", "delete:scan", "clear"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(before);
  });

  it("rejects a failed post-unmount save without blocking later mutation intents", async () => {
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const save = vi
      .spyOn(historyStorage, "saveDiscoveryScan")
      .mockRejectedValueOnce(new Error("quota exceeded"));
    const clear = vi
      .spyOn(historyStorage, "clearDiscoveryScans")
      .mockResolvedValueOnce();
    const before = result.current;
    const pendingSave = result.current.saveScan(snapshot());
    const pendingClear = result.current.clearScans();
    unmount();
    await expect(pendingSave).rejects.toThrow("quota exceeded");
    await pendingClear;
    expect(save).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(before);
  });

  it("does not publish an in-flight load after unmount", async () => {
    let resolveLoad!: (scans: SavedDiscoveryScan[]) => void;
    const load = vi
      .spyOn(historyStorage, "listDiscoveryScans")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      );
    const { result, unmount } = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const before = result.current;
    unmount();
    await act(async () => {
      resolveLoad([snapshot()]);
    });
    expect(result.current).toBe(before);
    expect(result.current.scans).toEqual([]);
  });
});
