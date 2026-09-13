import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";

const h = vi.hoisted(() => ({
  owner: "db-a",
  epoch: 1,
  accessible: true,
  connections: [] as Connection[],
  invoke: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: h.connections },
    flushPendingSave: vi.fn(),
    dispatchAndFlush: vi.fn(),
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/components/recording/scriptManager/shared", () => ({
  getDefaultScripts: () => [],
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: h.owner }),
      captureCurrentDatabaseDataTarget: () => {
        const epoch = h.epoch,
          databaseId = h.owner;
        return {
          databaseId,
          assertAccessible: () => {
            if (!h.accessible || epoch !== h.epoch || databaseId !== h.owner)
              throw new Error("Owner lease changed");
          },
        };
      },
      onCurrentDatabaseChange: () => () => {},
      onDatabaseAccessChange: (listener: () => void) => {
        h.listeners.add(listener);
        return () => {
          h.listeners.delete(listener);
        };
      },
    }),
  },
}));
import { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";

const busy =
  "Storage error: encryption storage transition in progress; retry after it completes";
const appBusy =
  "encryption storage transition in progress; retry after it completes";
const macro = {
  id: "macro-a",
  name: "Existing macro",
  steps: [{ command: "printf fixture", delayMs: 0, sendNewline: true }],
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
};
const script = {
  id: "script-a",
  name: "Existing script",
  description: "Fixture",
  script: "printf fixture",
  language: "sh",
  category: "Fixture",
};
const connection = {
  id: "saved",
  name: "Fixture",
  hostname: "fixture.invalid",
  protocol: "ssh",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
  sshQuickActions: { version: 1, items: [{ kind: "macro", id: "macro-a" }] },
} as Connection;
const session = {
  id: "ssh",
  connectionId: "saved",
  ownerDatabaseId: "db-a",
  protocol: "ssh",
  hostname: "fixture.invalid",
  name: "Fixture",
  status: "connected",
  startTime: new Date(0),
} as ConnectionSession;
let rawMacro: string | null;
const mount = () => {
  const options = {
    session,
    ready: true,
    active: true,
    captureSession: () => () => {},
    runScript: vi.fn(),
    replayMacro: vi.fn(),
  };
  return {
    ...renderHook(useSshQuickActions, {
      initialProps: options,
      reactStrictMode: true,
    }),
    options,
  };
};
const macroReads = () =>
  h.invoke.mock.calls.filter(([command]) => command === "read_macro_library");
const mutations = () =>
  h.invoke.mock.calls.filter(([command]) =>
    command.startsWith("compare_and_swap"),
  );
beforeEach(async () => {
  h.owner = "db-a";
  h.epoch = 1;
  h.accessible = true;
  h.connections = [connection];
  h.listeners.clear();
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  localStorage.clear();
  rawMacro = JSON.stringify({
    version: 1,
    macros: [macro],
    legacyDigest: null,
  });
  h.invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "read_app_data")
          return JSON.stringify({
            customScripts: [script],
            modifiedDefaults: [],
            deletedDefaultIds: [],
          });
        if (command === "read_macro_library") return rawMacro;
        if (command === "compare_and_swap_macro_library") {
          if (args.expected !== rawMacro) return false;
          rawMacro = args.replacement as string;
          return true;
        }
        throw new Error("Unexpected fixture command");
      },
    );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SSH actions with real protected stores", () => {
  it("aborts a sibling macro backoff when app scripts fail permanently", async () => {
    let rejectScripts!: (error: unknown) => void;
    h.invoke.mockImplementation(async (command) => {
      if (command === "read_app_data")
        return new Promise((_resolve, reject) => {
          rejectScripts = reject;
        });
      if (command === "read_macro_library") {
        rejectScripts("Unknown command read_app_data");
        throw busy;
      }
      throw new Error("Unexpected fixture command");
    });
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.error).toContain(
        "App-wide scripts (backend-unavailable)",
      ),
    );
    await act(async () => {
      await new Promise((done) => setTimeout(done, 130));
    });
    expect(macroReads()).toHaveLength(1);
    expect(mutations()).toEqual([]);
    expect(view.options.replayMacro).not.toHaveBeenCalled();
  });
  it.each([2, 4])(
    "recovers the macro pre-read at attempt %i under StrictMode without writes or execution",
    async (attempts) => {
      const original = h.invoke.getMockImplementation()!;
      let reads = 0;
      h.invoke.mockImplementation(async (command, args) => {
        if (command === "read_macro_library" && ++reads < attempts) throw busy;
        return original(command, args);
      });
      const view = mount();
      await waitFor(
        () =>
          expect(view.result.current.favorites[0]?.name).toBe("Existing macro"),
        { timeout: 2500 },
      );
      expect(macroReads()).toHaveLength(attempts);
      expect(view.result.current.error).toBeNull();
      expect(mutations()).toEqual([]);
      expect(view.options.runScript).not.toHaveBeenCalled();
      expect(view.options.replayMacro).not.toHaveBeenCalled();
    },
  );

  it("recovers the separate bare app-data pre-read refusal without retrying the other backend", async () => {
    const original = h.invoke.getMockImplementation()!;
    let reads = 0;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === "read_app_data" && ++reads === 1) throw appBusy;
      return original(command, args);
    });
    const view = mount();
    await waitFor(() =>
      expect(
        view.result.current.available.some(
          (item) => item.name === "Existing script",
        ),
      ).toBe(true),
    );
    expect(reads).toBe(2);
    expect(macroReads()).toHaveLength(1);
    expect(mutations()).toEqual([]);
  });

  it.each([
    [
      "read_macro_library",
      "Encryption required: app macros encryption key unavailable SECRET_PATH",
      "App-wide terminal macros (locked)",
    ],
    [
      "read_app_data",
      "Unknown command read_app_data SECRET_PATH",
      "App-wide scripts (backend-unavailable)",
    ],
    [
      "read_macro_library",
      "Storage error: invalid macro library SECRET_PATH",
      "App-wide terminal macros (invalid-library)",
    ],
  ])(
    "classifies %s string rejection safely without automatic retries",
    async (command, failure, expected) => {
      const original = h.invoke.getMockImplementation()!;
      h.invoke.mockImplementation(async (name, args) => {
        if (name === command) throw failure;
        return original(name, args);
      });
      const view = mount();
      await waitFor(() =>
        expect(view.result.current.error).toContain(expected),
      );
      expect(view.result.current.error).not.toContain("SECRET_PATH");
      expect(
        h.invoke.mock.calls.filter(([name]) => name === command),
      ).toHaveLength(1);
      expect(view.result.current.favorites[0].missing).toBe(true);
      expect(mutations()).toEqual([]);
      expect(view.options.replayMacro).not.toHaveBeenCalled();
    },
  );

  it.each(["unmount", "owner", "refresh"])(
    "cancels the exact pending macro read on %s",
    async (change) => {
      const original = h.invoke.getMockImplementation()!;
      h.invoke.mockImplementation(async (command, args) => {
        if (command === "read_macro_library") throw busy;
        return original(command, args);
      });
      const view = mount();
      await waitFor(() => expect(macroReads()).toHaveLength(1));
      const access = h.listeners;
      if (change === "unmount") view.unmount();
      else if (change === "owner")
        act(() => {
          h.accessible = false;
          h.epoch++;
          for (const listener of access) listener();
        });
      else {
        h.invoke.mockImplementation(original);
        await act(() => view.result.current.refresh());
        expect(view.result.current.favorites[0].name).toBe("Existing macro");
      }
      // Longer than the first backoff proves the canceled timer cannot dispatch.
      await act(async () => {
        await new Promise((done) => setTimeout(done, 130));
      });
      expect(macroReads()).toHaveLength(change === "refresh" ? 2 : 1);
      expect(mutations()).toEqual([]);
    },
  );

  it("migrates valid legacy macros automatically once and retains their exact commands", async () => {
    rawMacro = null;
    await IndexedDbService.setItemStrict("mremote-terminal-macros", [macro]);
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.favorites[0]?.name).toBe("Existing macro"),
    );
    expect(JSON.parse(rawMacro!).macros).toEqual([macro]);
    expect(
      await IndexedDbService.getItemStrict("mremote-terminal-macros"),
    ).toBeNull();
    expect(mutations()).toHaveLength(1);
    expect(view.options.replayMacro).not.toHaveBeenCalled();
  });

  it("does not retry a migration write failure and keeps legacy data", async () => {
    rawMacro = null;
    await IndexedDbService.setItemStrict("mremote-terminal-macros", [macro]);
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === "compare_and_swap_macro_library") throw busy;
      return original(command, args);
    });
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.error).toContain("App-wide terminal macros"),
    );
    expect(mutations()).toHaveLength(1);
    expect(rawMacro).toBeNull();
    expect(
      await IndexedDbService.getItemStrict("mremote-terminal-macros"),
    ).toEqual([macro]);
    expect(view.options.replayMacro).not.toHaveBeenCalled();
  });
});
