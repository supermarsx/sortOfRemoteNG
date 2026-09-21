import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";

const state = vi.hoisted(() => ({
  currentId: "db-a",
  locked: false,
  desktop: true,
  saved: null as StorageData | null,
  save: vi.fn(),
  change: null as
    | null
    | ((value: { reason: string; database: null; databaseId: string }) => void),
  access: null as null | ((value: { databaseId: string }) => void),
  transition: null as null | (() => Promise<void>),
  manager: {} as Record<string, unknown>,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => state.manager },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (state.desktop ? vi.fn() : null),
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock(
  "../../src/utils/recording/managedScriptPersistence",
  async (original) => ({
    ...(await original<
      typeof import("../../src/utils/recording/managedScriptPersistence")
    >()),
    nativeManagedScriptsStore: {
      key: "fixture-scripts",
      load: async () => ({ value: null }),
    },
  }),
);
vi.mock("../../src/utils/recording/macroService", () => ({
  loadMacros: async () => [],
}));
const initial = (): StorageData => ({
  connections: [
    {
      id: "host",
      name: "before",
      protocol: "ssh",
      hostname: "fixture.invalid",
      port: 22,
      isGroup: false,
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
    },
  ],
  settings: { retained: true },
  timestamp: 1,
});
const proposed = () => ({
  ...emptyDatabaseAutomationLibrary(),
  revision: 1,
  terminalMacros: [
    {
      id: "fixture",
      name: "Private macro",
      steps: [
        { command: "printf private-fixture", delayMs: 0, sendNewline: true },
      ],
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
    },
  ],
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  state.currentId = "db-a";
  state.locked = false;
  state.desktop = true;
  state.saved = initial();
  state.save.mockReset().mockImplementation(async (data: StorageData) => {
    state.saved = structuredClone(data);
  });
  state.manager = {
    getCurrentDatabase: () =>
      state.currentId ? { id: state.currentId } : null,
    getDatabaseAccessState: () => ({
      status: state.locked ? "suspended" : "ready",
    }),
    onCurrentDatabaseChange: (listener: typeof state.change) => {
      state.change = listener;
      return () => {
        state.change = null;
      };
    },
    onDatabaseAccessChange: (listener: typeof state.access) => {
      state.access = listener;
      return () => {
        state.access = null;
      };
    },
    registerBeforeDatabaseTransition: (listener: typeof state.transition) => {
      state.transition = listener;
      return () => {
        state.transition = null;
      };
    },
    captureCurrentDatabaseDataTarget: (): DatabaseDataTarget => {
      const id = state.currentId;
      let baseline: StorageData | null = null;
      return {
        databaseId: id,
        assertAccessible: () => {
          if (state.locked || state.currentId !== id)
            throw new Error("Access changed");
        },
        load: async () => {
          baseline = structuredClone(state.saved);
          return structuredClone(state.saved);
        },
        readCurrent: async () => structuredClone(state.saved),
        save: async (data) => {
          await state.save(data);
          baseline = structuredClone(data);
        },
        verifyCurrent: async () => {
          if (JSON.stringify(state.saved) !== JSON.stringify(baseline))
            throw new Error(
              "Database contents changed in another window. Reload and review the library.",
            );
        },
      };
    },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount() {
  const hook = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    await hook.result.current.loadData("db-a");
  });
  return hook;
}

describe("owning database automation persistence", () => {
  it("round-trips the Synology redirect opt-out through the real Provider without saving runtime provenance", async () => {
    state.saved!.connections[0] = {
      ...state.saved!.connections[0],
      protocol: "https",
      hostname: "nas.fr3.quickconnect.to",
      port: 443,
      synologySettings: {
        version: 1,
        useHttps: true,
        useDefaultRedirectDestinations: false,
      },
    };
    Object.assign(state.saved!.connections[0], {
      synologyQuickConnectDefaults: {
        version: 1,
        originalOrigin: "https://nas.fr3.quickconnect.to",
      },
    });
    const first = await mount();
    await act(async () => {
      await first.result.current.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: {
          ...first.result.current.state.connections[0],
          name: "saved NAS",
        },
      });
    });
    expect(
      state.saved!.connections[0].synologySettings
        ?.useDefaultRedirectDestinations,
    ).toBe(false);
    expect(JSON.stringify(state.saved)).not.toContain(
      "synologyQuickConnectDefaults",
    );
    first.unmount();
    const second = await mount();
    expect(second.result.current.state.connections[0]).toMatchObject({
      name: "saved NAS",
      synologySettings: { useDefaultRedirectDestinations: false },
    });
    second.unmount();
  });
  it("real Provider durable edits refresh scoped SSH favorites and external deletion cannot execute the cached macro", async () => {
    const ref = {
      kind: "macro" as const,
      id: "fixture",
      scope: { kind: "database" as const, databaseId: "db-a" },
    };
    state.saved!.connections[0].sshQuickActions = { version: 1, items: [ref] };
    const replay = vi.fn(async (_macro, check) => {
      await check();
    });
    const hook = renderHook(
      () => {
        const context = useConnections();
        const actions = useSshQuickActions({
          session: {
            id: "session",
            connectionId: "host",
            ownerDatabaseId: "db-a",
            protocol: "ssh",
            hostname: "fixture.invalid",
            name: "Fixture",
            status: "connected",
            startTime: new Date(0),
          },
          ready: true,
          captureSession: () => () => {},
          runScript: vi.fn(),
          replayMacro: replay,
        });
        return { context, actions };
      },
      { wrapper },
    );
    await act(() => hook.result.current.context.loadData("db-a"));
    await waitFor(() =>
      expect(hook.result.current.actions.loading).toBe(false),
    );
    expect(hook.result.current.actions.favorites[0].missing).toBe(true);
    const api = hook.result.current.context.automationLibrary!;
    await act(async () => {
      await api.compareAndSwap(
        api.scope!,
        await api.read(api.scope!),
        proposed(),
      );
    });
    await waitFor(() =>
      expect(hook.result.current.actions.favorites[0].name).toBe(
        "Private macro",
      ),
    );
    await act(() => hook.result.current.actions.run(ref));
    expect(replay).toHaveBeenCalledOnce();
    state.saved = {
      ...state.saved!,
      automationLibrary: { ...emptyDatabaseAutomationLibrary(), revision: 2 },
    };
    await act(() => hook.result.current.actions.run(ref));
    expect(replay).toHaveBeenCalledOnce();
    expect(hook.result.current.actions.error).toContain(
      "No substitute was used",
    );
    expect(state.save).toHaveBeenCalledOnce();
    hook.unmount();
  });
  it("reads legacy absence as empty and returns only after complete durable save", async () => {
    const { result } = await mount(),
      api = result.current.automationLibrary!,
      scope = api.scope!;
    const prior = await api.read(scope);
    expect(prior).toEqual(emptyDatabaseAutomationLibrary());
    const gate = deferred();
    state.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      state.saved = structuredClone(data);
    });
    let settled = false;
    const write = api.compareAndSwap(scope, prior, proposed()).then(() => {
      settled = true;
    });
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(state.saved?.automationLibrary).toBeUndefined();
    let transitioned = false;
    const barrier = state.transition!().then(() => {
      transitioned = true;
    });
    await Promise.resolve();
    expect(transitioned).toBe(false);
    await act(async () => {
      gate.resolve();
      await write;
      await barrier;
    });
    expect(await api.read(scope)).toEqual(proposed());
    expect(state.saved?.settings).toEqual({ retained: true });
    expect(JSON.stringify(result.current.state)).not.toContain(
      "private-fixture",
    );
  });
  it("does not publish or silently retry refused private data; explicit reload recovers", async () => {
    const { result } = await mount(),
      api = result.current.automationLibrary!,
      scope = api.scope!;
    const prior = await api.read(scope);
    state.save.mockRejectedValueOnce(new Error("Synthetic disk refusal"));
    await expect(api.compareAndSwap(scope, prior, proposed())).rejects.toThrow(
      "refusal",
    );
    await expect(api.read(scope)).rejects.toThrow("could not be verified");
    await act(async () => {
      await result.current.flushPendingSave();
    });
    expect(state.save).toHaveBeenCalledOnce();
    expect(state.saved?.automationLibrary).toBeUndefined();
    await act(async () => {
      await result.current.loadData("db-a");
    });
    const current = result.current.automationLibrary!;
    expect(await current.read(current.scope!)).toEqual(
      emptyDatabaseAutomationLibrary(),
    );
  });
  it("preserves overlapping connection edits and library data in ordered saves", async () => {
    const { result } = await mount(),
      api = result.current.automationLibrary!,
      scope = api.scope!;
    const gate = deferred();
    state.save.mockImplementationOnce(async (data: StorageData) => {
      await gate.promise;
      state.saved = structuredClone(data);
    });
    const write = api.compareAndSwap(scope, await api.read(scope), proposed());
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    act(() =>
      result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...result.current.state.connections[0],
          name: "edited while saving",
        },
      }),
    );
    await act(async () => {
      gate.resolve();
      await write;
    });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.saved?.connections[0].name).toBe("edited while saving");
    expect(state.saved?.automationLibrary).toEqual(proposed());
  });
  it("masks locked ownership and rejects pre-lock reviews even after reopening", async () => {
    const { result } = await mount(),
      api = result.current.automationLibrary!,
      scope = api.scope!;
    const prior = await api.read(scope);
    act(() => {
      state.locked = true;
      state.access!({ databaseId: "db-a" });
    });
    expect(result.current.automationLibrary?.scope).toBeNull();
    await expect(
      api.compareAndSwap(scope, prior, proposed()),
    ).rejects.toThrow();
    act(() => {
      state.locked = false;
      state.access!({ databaseId: "db-a" });
    });
    await expect(
      result.current.automationLibrary!.compareAndSwap(
        scope,
        prior,
        proposed(),
      ),
    ).rejects.toThrow("changed");
    expect(state.save).not.toHaveBeenCalled();
  });
  it("never installs a late save into another owner after forced lock/close", async () => {
    const { result } = await mount(),
      api = result.current.automationLibrary!,
      scope = api.scope!;
    const gate = deferred();
    state.save.mockImplementationOnce(async () => {
      await gate.promise;
    });
    const write = api.compareAndSwap(scope, await api.read(scope), proposed());
    const refused = expect(write).rejects.toThrow();
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    act(() => {
      state.currentId = "";
      state.change!({ reason: "lock", database: null, databaseId: "db-a" });
    });
    await act(async () => {
      gate.resolve();
      await refused;
    });
    expect(result.current.automationLibrary?.scope).toBeNull();
    expect(result.current.state.connections).toEqual([]);
  });
  it("preserves malformed field verbatim during unrelated connection saves and refuses library reads", async () => {
    const malformed = { version: 99, original: "retained" };
    state.saved = {
      ...initial(),
      automationLibrary:
        malformed as unknown as StorageData["automationLibrary"],
    };
    const { result } = await mount(),
      api = result.current.automationLibrary!;
    await expect(api.read(api.scope!)).rejects.toThrow("Invalid");
    await act(async () => {
      await result.current.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: { ...result.current.state.connections[0], name: "changed" },
      });
    });
    expect(state.saved?.automationLibrary).toEqual(malformed);
  });
  it("refuses browser mode without creating a database side store", async () => {
    const { result } = await mount();
    state.desktop = false;
    const api = result.current.automationLibrary!;
    await expect(api.read(api.scope!)).rejects.toThrow("desktop");
    expect(state.save).not.toHaveBeenCalled();
  });
});
