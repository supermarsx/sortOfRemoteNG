import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import type { ManagedScript } from "../../src/components/recording/scriptManager/shared";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";

const h = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  runScript: vi.fn(),
  replayMacro: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (h.desktop ? h.invoke : null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
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
      key: "scripts",
      load: async () => ({
        value: {
          customScripts: [{ ...script, name: "App duplicate" }],
          modifiedDefaults: [],
          deletedDefaultIds: [],
        },
      }),
    },
  }),
);
vi.mock("../../src/utils/recording/macroService", () => ({
  loadMacros: async () => [],
}));
const script: ManagedScript = {
  id: "shared-id",
  name: "Database action",
  description: "Fixture",
  script: "printf original",
  language: "sh",
  category: "System",
  osTags: ["linux"],
  createdAt: "2026-09-21T00:00:00Z",
  updatedAt: "2026-09-21T00:00:00Z",
};
let manager: DatabaseManager;
let owner: string;
let original: StorageData;
const key = () => `mremote-database-${owner}`;
const reference = () => ({
  kind: "script" as const,
  id: script.id,
  scope: { kind: "database" as const, databaseId: owner },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
beforeEach(async () => {
  h.desktop = false;
  h.runScript.mockReset();
  h.replayMacro.mockReset();
  h.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "trust_set_active_database") return;
    if (command === "databases_list")
      return {
        source: "current",
        value: (await IndexedDbService.getItem("mremote-databases")) ?? [],
      };
    if (command === "load_database_data")
      return {
        source: "current",
        value: await IndexedDbService.getItem(
          `mremote-database-${args.databaseId}`,
        ),
      };
    throw new Error(`Unexpected write or backend: ${command}`);
  });
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(() => {});
  const db = await manager.createDatabase("SSH reload owner");
  owner = db.id;
  await manager.selectDatabase(owner);
  original = {
    connections: [
      {
        id: "saved-ssh",
        name: "SSH",
        protocol: "ssh",
        hostname: "fixture.invalid",
        port: 22,
        isGroup: false,
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
        sshQuickActions: {
          version: 1,
          items: [reference(), { kind: "script", id: script.id }],
        },
      },
    ],
    settings: { retained: "original" },
    timestamp: 1,
    automationLibrary: {
      ...emptyDatabaseAutomationLibrary(),
      terminalScripts: {
        customScripts: [script],
        modifiedDefaults: [],
        deletedDefaultIds: [],
      },
    },
  };
  await manager.saveDatabaseData(owner, original);
});
afterEach(() => {
  act(() => manager.closeCurrentDatabase());
  cleanup();
  h.desktop = false;
  vi.restoreAllMocks();
  DatabaseManager.resetInstance();
});
async function mount() {
  const session: ConnectionSession = {
    id: "ssh-session",
    connectionId: "saved-ssh",
    ownerDatabaseId: owner,
    protocol: "ssh",
    hostname: "fixture.invalid",
    name: "SSH",
    status: "connected",
    startTime: new Date(0),
  };
  const view = renderHook(
    () => {
      const context = useConnections();
      const actions = useSshQuickActions({
        session,
        ready: true,
        captureSession: () => () => {},
        runScript: h.runScript,
        replayMacro: h.replayMacro,
      });
      return { context, actions };
    },
    { wrapper },
  );
  await act(async () => {
    await view.result.current.context.loadData(owner);
    h.desktop = true;
  });
  await act(() => view.result.current.actions.refresh());
  await waitFor(() =>
    expect(view.result.current.actions.favorites[0]?.name).toBe(script.name),
  );
  return view;
}
const externalEdit = (): StorageData => ({
  ...original,
  settings: { retained: "external edit" },
  connections: [{ ...original.connections[0], name: "Externally renamed" }],
  automationLibrary: {
    ...original.automationLibrary!,
    revision: 1,
    terminalScripts: {
      ...original.automationLibrary!.terminalScripts,
      customScripts: [
        { ...script, name: "Updated action", script: "printf updated" },
      ],
    },
  },
});

describe("SSH exact-owner read-only library refresh", () => {
  it("recovers an external-write conflict without flushing drafts or advancing either writer baseline", async () => {
    const view = await mount();
    const api = view.result.current.context.automationLibrary!;
    const capturedWriter = manager.captureCurrentDatabaseDataTarget()!;
    const changed = externalEdit();
    await IndexedDbService.setItemStrict(key(), changed);
    await expect(api.read(api.scope!)).rejects.toThrow("another window");

    // Keep a real unsaved provider edit pending while reloading the library.
    act(() =>
      view.result.current.context.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...original.connections[0], name: "Local unsaved draft" },
      }),
    );
    const save = vi.spyOn(manager, "saveDatabaseData");
    await act(() => view.result.current.actions.refresh());
    expect(view.result.current.actions.error).toBeNull();
    expect(view.result.current.actions.favorites[0]).toMatchObject({
      name: "Updated action",
      missing: false,
      scope: reference().scope,
    });
    expect(save).not.toHaveBeenCalled();
    expect(
      h.invoke.mock.calls.some(([command]) => command === "save_database_data"),
    ).toBe(false);
    expect(view.result.current.context.state.connections[0].name).toBe(
      "Local unsaved draft",
    );
    expect(h.runScript).not.toHaveBeenCalled();
    expect(h.replayMacro).not.toHaveBeenCalled();

    h.runScript.mockImplementation(async (_payload, assertReviewed) => {
      await assertReviewed();
    });
    await act(() => view.result.current.actions.run(reference()));
    expect(view.result.current.actions.error).toBeNull();
    expect(h.runScript).toHaveBeenCalledWith(
      expect.objectContaining({ script: "printf updated" }),
      expect.any(Function),
    );
    expect(save).not.toHaveBeenCalled();
    expect(await IndexedDbService.getItem(key())).toEqual(changed);

    // Exercise the real manager CAS and the provider's captured writer CAS.
    h.desktop = false;
    await expect(manager.saveDatabaseData(owner, original)).rejects.toThrow(
      "contents changed",
    );
    await expect(capturedWriter.save(original)).rejects.toThrow(
      "contents changed",
    );
    await act(async () => {
      await expect(
        view.result.current.context.flushPendingSave(),
      ).rejects.toThrow("contents changed");
    });
    expect(await IndexedDbService.getItem(key())).toEqual(changed);
  });

  it("never substitutes the app-wide duplicate after a database action is deleted", async () => {
    const view = await mount();
    await IndexedDbService.setItemStrict(key(), {
      ...original,
      automationLibrary: emptyDatabaseAutomationLibrary(),
    });
    await act(() => view.result.current.actions.refresh());
    expect(view.result.current.actions.error).toBeNull();
    expect(view.result.current.actions.favorites[0].missing).toBe(true);
    expect(view.result.current.actions.favorites[1].name).toBe("App duplicate");
    await act(() => view.result.current.actions.run(reference()));
    expect(view.result.current.actions.error).toContain("No substitute");
    expect(h.runScript).not.toHaveBeenCalled();
  });

  it.each(["favorites", "deleted", "protocol", "group"])(
    "refuses refresh and execution when the saved connection's %s changes externally",
    async (change) => {
      const view = await mount();
      const saved = { ...original.connections[0] };
      if (change === "favorites")
        saved.sshQuickActions = { version: 1, items: [] };
      if (change === "protocol") saved.protocol = "telnet";
      if (change === "group") saved.isGroup = true;
      await IndexedDbService.setItemStrict(key(), {
        ...original,
        connections: change === "deleted" ? [] : [saved],
      });
      await act(() => view.result.current.actions.refresh());
      expect(view.result.current.actions.error).toContain(
        "Owning database actions (conflict)",
      );
      expect(view.result.current.actions.available).toEqual([]);
      expect(
        view.result.current.actions.favorites.every((item) => item.missing),
      ).toBe(true);
      for (const ref of original.connections[0].sshQuickActions!.items) {
        await act(() => view.result.current.actions.run(ref));
        expect(view.result.current.actions.error).toContain(
          "SSH connection settings changed",
        );
      }
      expect(h.runScript).not.toHaveBeenCalled();
    },
  );

  it.each(["payload", "policy"])(
    "rechecks an external %s change after confirmation before executing",
    async (change) => {
      const view = await mount();
      const executed = vi.fn();
      h.runScript.mockImplementation(async (_payload, assertReviewed) => {
        const changed = externalEdit();
        if (change === "policy")
          changed.connections[0].sshQuickActions = { version: 1, items: [] };
        await IndexedDbService.setItemStrict(key(), changed);
        await assertReviewed();
        executed();
      });
      await act(() => view.result.current.actions.run(reference()));
      expect(h.runScript).toHaveBeenCalledOnce();
      expect(executed).not.toHaveBeenCalled();
      expect(view.result.current.actions.error).toContain(
        change === "policy"
          ? "SSH connection settings changed"
          : "reviewed library entry changed",
      );
    },
  );

  it("discards a refresh that completes after the exact owning database closes", async () => {
    const view = await mount();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const invoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementationOnce(async (...args) => {
      const result = await invoke(...args);
      await gate;
      return result;
    });
    const count = h.invoke.mock.calls.length;
    let reload!: Promise<void>;
    act(() => {
      reload = view.result.current.actions.refresh();
    });
    await waitFor(() =>
      expect(h.invoke.mock.calls.length).toBeGreaterThan(count),
    );
    act(() => manager.closeCurrentDatabase());
    await act(async () => {
      resume();
      await reload;
    });
    expect(view.result.current.actions.available).toEqual([]);
    expect(view.result.current.actions.favorites).toEqual([]);
    expect(view.result.current.actions.unavailable).toContain(
      "owning database",
    );
    expect(h.runScript).not.toHaveBeenCalled();
  });
});
