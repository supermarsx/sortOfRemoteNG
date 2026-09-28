import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import { useDiscoveryPresets } from "../../src/hooks/network/useDiscoveryPresets";
import {
  DISCOVERY_PRESET_CHANGED_EVENT,
  DISCOVERY_PRESET_STORAGE_KEY,
  readDiscoveryPresets,
  type SavedDiscoveryPreset,
} from "../../src/utils/discovery/savedDiscoveryPresets";

const config = (): NetworkDiscoveryConfig => ({
  enabled: true,
  ipRange: "10.0.0.0/24",
  protocols: ["ssh"],
  portRanges: [],
  customPorts: { ssh: [22] },
  probeStrategies: { default: ["websocket"] },
  timeout: 5000,
  maxConcurrent: 50,
  maxPortConcurrent: 100,
  cacheTTL: 300000,
  hostnameTtl: 300000,
  macTtl: 300000,
});
const external = (): SavedDiscoveryPreset => ({
  id: "external",
  name: "Another window",
  createdAt: 1,
  updatedAt: 2,
  config: config(),
});
function replaceStorage(presets: SavedDiscoveryPreset[]) {
  localStorage.setItem(
    DISCOVERY_PRESET_STORAGE_KEY,
    JSON.stringify({ version: 1, presets }),
  );
}
function storageEvent(key: string | null = DISCOVERY_PRESET_STORAGE_KEY) {
  window.dispatchEvent(new StorageEvent("storage", { key }));
}
beforeEach(() => localStorage.removeItem(DISCOVERY_PRESET_STORAGE_KEY));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("persists save, rename, update and delete across remounts with stable identity", () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(100);
  const first = renderHook(() => useDiscoveryPresets());
  let saved!: SavedDiscoveryPreset;
  act(() => {
    saved = first.result.current.savePreset("  Office  ", config());
  });
  expect(saved).toMatchObject({
    name: "Office",
    createdAt: 100,
    updatedAt: 100,
    config: config(),
  });
  expect(first.result.current.presets).toEqual([saved]);
  first.unmount();
  const second = renderHook(() => useDiscoveryPresets());
  expect(second.result.current.presets).toEqual([saved]);
  time.mockReturnValue(200);
  act(() => {
    saved = second.result.current.renamePreset(saved.id, " LAB ");
  });
  expect(saved).toMatchObject({ name: "LAB", createdAt: 100, updatedAt: 200 });
  time.mockReturnValue(300);
  const updatedConfig = {
    ...config(),
    ipRange: "2001:db8::/120",
    identifyServices: true,
  };
  act(() => {
    saved = second.result.current.updatePreset(saved.id, updatedConfig);
  });
  expect(saved).toMatchObject({
    createdAt: 100,
    updatedAt: 300,
    config: updatedConfig,
  });
  expect(readDiscoveryPresets()).toEqual([saved]);
  act(() => second.result.current.deletePreset(saved.id));
  expect(second.result.current.presets).toEqual([]);
  expect(second.result.current.error).toBeNull();
  second.unmount();
  expect(
    renderHook(() => useDiscoveryPresets()).result.current.presets,
  ).toEqual([]);
});

it("detaches input, returned values, rendered snapshots, and other hook instances", () => {
  const first = renderHook(() => useDiscoveryPresets());
  const second = renderHook(() => useDiscoveryPresets());
  const input = config();
  let saved!: SavedDiscoveryPreset;
  act(() => {
    saved = first.result.current.savePreset("Office", input);
  });
  input.customPorts.ssh.push(2222);
  saved.config.probeStrategies.default.push("http");
  first.result.current.presets[0].config.customPorts.ssh.push(3333);
  first.result.current.presets[0].name = "not persisted";
  expect(second.result.current.presets[0].config).toEqual(config());
  expect(readDiscoveryPresets()[0]).toMatchObject({
    name: "Office",
    config: config(),
  });
  act(() => {
    saved = second.result.current.renamePreset(saved.id, "Renamed");
  });
  saved.config.customPorts.ssh.push(4444);
  expect(first.result.current.presets[0]).toMatchObject({
    name: "Renamed",
    config: config(),
  });
  const replacement = { ...config(), ipRange: "192.0.2.1" };
  act(() => {
    saved = first.result.current.updatePreset(saved.id, replacement);
  });
  replacement.customPorts.ssh.push(5555);
  saved.config.customPorts.ssh.push(6666);
  expect(first.result.current.presets[0].config.customPorts.ssh).toEqual([22]);
  expect(second.result.current.presets[0].config.customPorts.ssh).toEqual([22]);
  expect(readDiscoveryPresets()[0].config.customPorts.ssh).toEqual([22]);
  act(() => second.result.current.deletePreset(saved.id));
  expect(first.result.current.presets).toEqual([]);
});

it("reuses the detached library across unrelated renders and errors", () => {
  replaceStorage([external()]);
  const { result, rerender } = renderHook(() => useDiscoveryPresets());
  const snapshot = result.current.presets;
  rerender();
  expect(result.current.presets).toBe(snapshot);
  act(() => {
    expect(() => result.current.renamePreset("missing", "Name")).toThrow();
  });
  expect(result.current.presets).toBe(snapshot);
  act(() => {
    result.current.renamePreset("external", "New name");
  });
  expect(result.current.presets).not.toBe(snapshot);
  expect(snapshot[0].name).toBe("Another window");
});

it("rejects duplicate saved names, bad inputs, and missing IDs, then clears errors on success", () => {
  const { result } = renderHook(() => useDiscoveryPresets());
  let first!: SavedDiscoveryPreset;
  let second!: SavedDiscoveryPreset;
  act(() => {
    first = result.current.savePreset("Common", config());
    second = result.current.savePreset("Other", config());
  });
  for (const action of [
    () => result.current.savePreset(" COMMON ", config()),
    () => result.current.renamePreset(second.id, "common"),
    () => result.current.savePreset(" ", config()),
    () => result.current.savePreset("x".repeat(81), config()),
    () => result.current.updatePreset(first.id, { ...config(), timeout: NaN }),
    () => result.current.renamePreset("missing", "Hello"),
    () => result.current.updatePreset("missing", config()),
    () => result.current.deletePreset("missing"),
  ]) {
    act(() => {
      expect(action).toThrow();
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.presets).toEqual([first, second]);
    expect(readDiscoveryPresets()).toEqual([first, second]);
  }
  act(() => {
    first = result.current.renamePreset(first.id, "COMMON");
  });
  expect(result.current.error).toBeNull();
  expect(result.current.presets[0]).toEqual(first);
});

it("keeps all CRUD changes invisible on quota failures and never broadcasts them", () => {
  const first = renderHook(() => useDiscoveryPresets());
  const second = renderHook(() => useDiscoveryPresets());
  let saved!: SavedDiscoveryPreset;
  act(() => {
    saved = first.result.current.savePreset("Office", config());
  });
  const broadcast = vi.fn();
  window.addEventListener(DISCOVERY_PRESET_CHANGED_EVENT, broadcast);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
  for (const action of [
    () => first.result.current.savePreset("New", config()),
    () => first.result.current.renamePreset(saved.id, "Renamed"),
    () =>
      first.result.current.updatePreset(saved.id, {
        ...config(),
        timeout: 2000,
      }),
    () => first.result.current.deletePreset(saved.id),
  ]) {
    act(() => {
      expect(action).toThrow("quota exceeded");
    });
    expect(first.result.current.error).toBe("quota exceeded");
    expect(first.result.current.presets).toEqual([saved]);
    expect(second.result.current.presets).toEqual([saved]);
    expect(readDiscoveryPresets()).toEqual([saved]);
  }
  expect(broadcast).not.toHaveBeenCalled();
  window.removeEventListener(DISCOVERY_PRESET_CHANGED_EVENT, broadcast);
  write.mockRestore();
  act(() => first.result.current.deletePreset(saved.id));
  expect(first.result.current.error).toBeNull();
});

it.each(["{corrupted", '{"version":99,"presets":[]}'])(
  "shows unreadable store errors and preserves bytes through all mutations: %s",
  (raw) => {
    localStorage.setItem(DISCOVERY_PRESET_STORAGE_KEY, raw);
    const { result } = renderHook(() => useDiscoveryPresets());
    expect(result.current.error).toBeTruthy();
    expect(result.current.presets).toEqual([]);
    for (const action of [
      () => result.current.savePreset("Office", config()),
      () => result.current.renamePreset("old", "Office"),
      () => result.current.updatePreset("old", config()),
      () => result.current.deletePreset("old"),
    ]) {
      act(() => {
        expect(action).toThrow();
      });
      expect(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)).toBe(raw);
    }
    act(() => {
      replaceStorage([external()]);
      storageEvent();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.presets).toEqual([external()]);
  },
);

it("reports read/access failures, preserves the last persisted snapshot, and recovers", () => {
  replaceStorage([external()]);
  const { result } = renderHook(() => useDiscoveryPresets());
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("read denied");
  });
  act(() => storageEvent());
  expect(result.current.error).toBe("read denied");
  expect(result.current.presets).toEqual([external()]);
  act(() => {
    expect(() => result.current.savePreset("Office", config())).toThrow(
      "read denied",
    );
  });
  read.mockRestore();
  act(() => storageEvent());
  expect(result.current.error).toBeNull();
  const access = vi
    .spyOn(window, "localStorage", "get")
    .mockImplementation(() => {
      throw new Error("access denied");
    });
  const denied = renderHook(() => useDiscoveryPresets());
  expect(denied.result.current.error).toBe("access denied");
  act(() => {
    expect(() => denied.result.current.savePreset("Office", config())).toThrow(
      "access denied",
    );
  });
  access.mockRestore();
});

it("rereads newer storage before mutation and synchronizes cross-window changes and clears", () => {
  const { result, unmount } = renderHook(() => useDiscoveryPresets());
  replaceStorage([external()]); // Before a delayed browser storage event arrives.
  act(() => {
    result.current.savePreset("Local", config());
  });
  expect(result.current.presets.map(({ name }) => name)).toEqual([
    "Another window",
    "Local",
  ]);
  expect(readDiscoveryPresets()).toHaveLength(2);
  act(() => {
    replaceStorage([{ ...external(), name: "Remote rename" }]);
    storageEvent();
  });
  expect(result.current.presets[0].name).toBe("Remote rename");
  expect(result.current.presets).toHaveLength(1);
  act(() => {
    localStorage.removeItem(DISCOVERY_PRESET_STORAGE_KEY);
    storageEvent(null);
  });
  expect(result.current.presets).toEqual([]);
  const removeListener = vi.spyOn(window, "removeEventListener");
  unmount();
  expect(removeListener).toHaveBeenCalledWith("storage", expect.any(Function));
  expect(removeListener).toHaveBeenCalledWith(
    DISCOVERY_PRESET_CHANGED_EVENT,
    expect.any(Function),
  );
});

it("ignores unrelated/session storage events and exposes corrupt external updates", () => {
  replaceStorage([external()]);
  const { result } = renderHook(() => useDiscoveryPresets());
  localStorage.setItem(DISCOVERY_PRESET_STORAGE_KEY, "{bad");
  act(() => {
    storageEvent("unrelated");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DISCOVERY_PRESET_STORAGE_KEY,
        storageArea: window.sessionStorage,
      }),
    );
  });
  expect(result.current.error).toBeNull();
  act(() => storageEvent());
  expect(result.current.error).toMatch(/unreadable/);
  expect(result.current.presets).toEqual([external()]);
});

it("enforces the saved preset limit without changing persisted state", () => {
  replaceStorage(
    Array.from({ length: 50 }, (_, i) => ({
      ...external(),
      id: `id-${i}`,
      name: `Preset ${i}`,
    })),
  );
  const { result } = renderHook(() => useDiscoveryPresets());
  act(() => {
    expect(() => result.current.savePreset("Extra", config())).toThrow(/50/);
  });
  expect(result.current.presets).toHaveLength(50);
  expect(readDiscoveryPresets()).toHaveLength(50);
  expect(result.current.error).toMatch(/50/);
});
