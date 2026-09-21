import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import type { BrowserScript } from "../../src/types/recording/webAutomation";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { StorageData } from "../../src/utils/storage/storage";

const h = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  request: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (h.desktop ? h.invoke : null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../src/hooks/protocol/useWebsiteDarkMode", () => ({
  useWebsiteDarkMode: () => null,
}));
vi.mock("../../src/utils/recording/webAutomationBridge", () => ({
  WebAutomationBridge: class {
    request = h.request;
    cancel = vi.fn();
    handleMessage = vi.fn();
  },
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: {
    // Same ID in app storage must never substitute for the database action.
    load: async () => ({
      value: { version: 1, scripts: [script], macros: [] },
    }),
  },
}));
const script: BrowserScript = {
  kind: "script",
  id: "shared-id",
  name: "Reviewed website action",
  description: "",
  code: "document.title",
  createdAt: "2026-09-21T00:00:00Z",
  updatedAt: "2026-09-21T00:00:00Z",
};
let manager: DatabaseManager;
let owner: string;
let original: StorageData;
const key = () => `mremote-database-${owner}`;
const scope = () => ({ kind: "database" as const, databaseId: owner });
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
beforeEach(async () => {
  h.desktop = false;
  h.request.mockReset().mockResolvedValue({});
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
  const db = await manager.createDatabase("Website reload owner");
  owner = db.id;
  await manager.selectDatabase(owner);
  original = {
    connections: [
      {
        id: "website",
        name: "Website",
        protocol: "https",
        hostname: "fixture.invalid",
        port: 443,
        isGroup: false,
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
        httpAutomation: {
          version: 1,
          scriptInjectionEnabled: true,
          interactionMacrosEnabled: false,
          forceDark: false,
          items: [{ kind: "script", id: script.id, scope: scope() }],
        },
      },
    ],
    settings: { retained: "original" },
    timestamp: 1,
    automationLibrary: {
      ...emptyDatabaseAutomationLibrary(),
      website: { version: 1, scripts: [script], macros: [] },
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
  const view = renderHook(
    () => {
      const context = useConnections();
      const automation = useWebAutomation({
        connection: context.state.connections[0],
        ownerDatabaseId: owner,
        settings: {
          sessionQuickActions: {
            httpEnabled: true,
            allowWebScriptInjection: true,
            confirmBeforeScriptRun: true,
          },
        } as GlobalSettings,
        settingsReady: true,
        scopeKey: "website-owner",
        blocked: false,
        navigationKey: "page",
        iframe: { current: null },
        getDocument: () => ({
          generation: 1,
          sessionId: "website-session",
          token: "a".repeat(32),
          sequence: 1,
          navigationToken: null,
          url: "http://protected.localhost/page",
        }),
        updateConnection: async (connection) =>
          context.dispatchAndFlush({
            type: "UPDATE_CONNECTION",
            payload: connection,
          }),
      });
      return { context, automation };
    },
    { wrapper },
  );
  await act(async () => {
    await view.result.current.context.loadData(owner);
    h.desktop = true;
  });
  await act(() => view.result.current.automation.reload());
  await waitFor(() =>
    expect(view.result.current.automation.availableDatabaseScope).toEqual(
      scope(),
    ),
  );
  return view;
}

describe("website exact-owner library refresh", () => {
  it("reloads external edits for a new review while preserving unrelated data and both writer baselines", async () => {
    const view = await mount();
    const api = view.result.current.context.automationLibrary!;
    const old = { ...script, scope: scope() };
    await act(() => view.result.current.automation.requestRun(old));
    expect(view.result.current.automation.pendingRun).toEqual(old);
    const changed = {
      ...original,
      settings: { retained: "external edit" },
      connections: [{ ...original.connections[0], name: "Externally renamed" }],
      automationLibrary: {
        ...original.automationLibrary!,
        revision: 1,
        website: {
          version: 1 as const,
          macros: [],
          scripts: [{ ...script, code: "document.URL" }],
        },
      },
    };
    await IndexedDbService.setItemStrict(key(), changed);
    await expect(api.read(api.scope!)).rejects.toThrow("another window");
    await act(() => view.result.current.automation.reload());
    expect(view.result.current.automation.pendingRun).toBeNull();
    expect(view.result.current.automation.error).toBeNull();
    const fresh = view.result.current.automation.allItems.find(
      (item) => item.scope?.kind === "database",
    )!;
    expect(fresh).toMatchObject({ code: "document.URL", scope: scope() });
    expect(h.request).not.toHaveBeenCalled();
    await act(() => view.result.current.automation.execute(old));
    expect(view.result.current.automation.error).toMatch(
      /changed or was deleted/,
    );
    expect(h.request).not.toHaveBeenCalled();
    await act(() => view.result.current.automation.requestRun(fresh));
    expect(view.result.current.automation.pendingRun).toEqual(fresh);
    await act(() => view.result.current.automation.execute(fresh));
    expect(h.request).toHaveBeenCalledWith(
      "script",
      expect.objectContaining({ code: "document.URL" }),
    );
    expect(await IndexedDbService.getItem(key())).toEqual(changed);
    await expect(api.read(api.scope!)).rejects.toThrow("another window");
    // The real DatabaseManager's global and captured writer CAS must stay stale.
    h.desktop = false;
    await expect(manager.saveDatabaseData(owner, original)).rejects.toThrow(
      "contents changed",
    );
    await act(async () => {
      await expect(
        view.result.current.context.dispatchAndFlush({
          type: "UPDATE_CONNECTION",
          payload: {
            ...view.result.current.context.state.connections[0],
            name: "local draft",
          },
        }),
      ).rejects.toThrow("contents changed");
    });
    expect(await IndexedDbService.getItem(key())).toEqual(changed);
  });

  it("never substitutes the app-wide duplicate when the database action is deleted", async () => {
    const view = await mount();
    await IndexedDbService.setItemStrict(key(), {
      ...original,
      automationLibrary: emptyDatabaseAutomationLibrary(),
    });
    await act(() => view.result.current.automation.reload());
    expect(view.result.current.automation.favorites).toEqual([]);
    await act(() =>
      view.result.current.automation.execute({ ...script, scope: scope() }),
    );
    expect(view.result.current.automation.error).toMatch(
      /changed or was deleted/,
    );
    expect(h.request).not.toHaveBeenCalled();
  });

  it("does not retain website consent revoked in another window", async () => {
    const view = await mount();
    await IndexedDbService.setItemStrict(key(), {
      ...original,
      connections: [
        {
          ...original.connections[0],
          httpAutomation: {
            ...original.connections[0].httpAutomation!,
            scriptInjectionEnabled: false,
          },
        },
      ],
    });
    await act(() => view.result.current.automation.reload());
    expect(view.result.current.automation.availableDatabaseScope).toBeNull();
    expect(view.result.current.automation.error).toMatch(
      /connection settings changed/,
    );
    await act(() =>
      view.result.current.automation.execute({ ...script, scope: scope() }),
    );
    expect(h.request).not.toHaveBeenCalled();
  });

  it("discards a late refresh after the owning database unloads", async () => {
    const view = await mount();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const originalInvoke = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementationOnce(async (...args) => {
      const result = await originalInvoke(...args);
      await gate;
      return result;
    });
    let reload!: Promise<void>;
    const count = h.invoke.mock.calls.length;
    act(() => {
      reload = view.result.current.automation.reload();
    });
    await waitFor(() =>
      expect(h.invoke.mock.calls.length).toBeGreaterThan(count),
    );
    act(() => manager.closeCurrentDatabase());
    expect(view.result.current.context.state.connections).toEqual([]);
    expect(view.result.current.automation.availableDatabaseScope).toBeNull();
    await act(async () => {
      resume();
      await reload;
    });
    expect(view.result.current.automation.availableDatabaseScope).toBeNull();
    expect(
      view.result.current.automation.allItems.some(
        (item) => item.scope?.kind === "database",
      ),
    ).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
  });
});
