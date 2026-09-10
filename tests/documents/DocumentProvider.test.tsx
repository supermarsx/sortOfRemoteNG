import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { fixture } from "./fixtures";
const mock = vi.hoisted(() => ({
  owner: "db-a",
  locked: false,
  desktop: true,
  saved: null as StorageData | null,
  save: vi.fn(),
  status: vi.fn(),
  manager: {} as Record<string, unknown>,
  access: null as
    null | ((event: { databaseId: string; status: string }) => void),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => mock.manager },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (mock.desktop ? vi.fn() : null),
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
beforeEach(() => {
  mock.owner = "db-a";
  mock.locked = false;
  mock.desktop = true;
  mock.saved = {
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
  };
  mock.save.mockReset().mockImplementation(async (data: StorageData) => {
    mock.saved = structuredClone(data);
  });
  mock.status.mockReset().mockResolvedValue({
    kind: "managed",
    unlocked: true,
    securityRevision: "revision",
  });
  mock.manager = {
    getCurrentDatabase: () =>
      mock.owner
        ? {
            id: mock.owner,
            protectionFormat: "sorng-db",
            securityRevision: "revision",
          }
        : null,
    getDatabaseAccessState: () => ({
      status: mock.locked ? "suspended" : "ready",
    }),
    getDatabaseProtectionStatus: mock.status,
    onCurrentDatabaseChange: () => () => {},
    onDatabaseAccessChange: (listener: typeof mock.access) => {
      mock.access = listener;
      return () => {
        mock.access = null;
      };
    },
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: (): DatabaseDataTarget => {
      const owner = mock.owner;
      let baseline: StorageData | null = null;
      return {
        databaseId: owner,
        assertAccessible: () => {
          if (mock.locked || mock.owner !== owner)
            throw Error("Access changed");
        },
        load: async () => {
          baseline = structuredClone(mock.saved);
          return structuredClone(mock.saved);
        },
        save: async (data) => {
          await mock.save(data);
          baseline = structuredClone(data);
        },
        verifyCurrent: async () => {
          if (JSON.stringify(baseline) !== JSON.stringify(mock.saved))
            throw Error("Database changed in another window");
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
describe("native managed database document persistence", () => {
  it("keeps documents private and publishes only after durable save while preserving normal autosave", async () => {
    const { result } = await mount();
    const api = result.current.documents!,
      scope = api.scope!;
    expect(await api.read(scope)).toEqual(emptyDatabaseDocuments());
    let finish!: () => void;
    mock.save.mockImplementationOnce(async (data: StorageData) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      mock.saved = structuredClone(data);
    });
    let completed = false;
    const next = { ...fixture(), revision: 1 };
    const write = api
      .compareAndSwap(scope, emptyDatabaseDocuments(), next)
      .then(() => {
        completed = true;
      });
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect(mock.saved?.documents).toBeUndefined();
    act(() =>
      result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...mock.saved!.connections[0], name: "while saving" },
      }),
    );
    await act(async () => {
      finish();
      await write;
      await result.current.flushPendingSave();
    });
    expect(mock.saved?.documents).toEqual(next);
    expect(mock.saved?.connections[0].name).toBe("while saving");
    expect(mock.saved?.settings).toEqual({ retained: true });
    expect(JSON.stringify(result.current.state)).not.toContain(
      "PRIVATE_FIXTURE",
    );
    expect(await result.current.documents!.read(scope)).toEqual(next);
  });
  it.each(["none", "legacy-password"])(
    "does not trust a renderer managed label when backend is %s",
    async (kind) => {
      mock.status.mockResolvedValue({
        kind,
        unlocked: true,
        securityRevision: "revision",
      });
      const { result } = await mount();
      const api = result.current.documents!;
      await expect(api.read(api.scope!)).rejects.toThrow(
        /Protect the current database/,
      );
      await expect(
        api.compareAndSwap(api.scope!, emptyDatabaseDocuments(), {
          ...fixture(),
          revision: 1,
        }),
      ).rejects.toThrow(/Protect the current database/);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it("refuses browser fallback and mismatched native security revisions", async () => {
    const { result } = await mount();
    const api = result.current.documents!,
      scope = api.scope!;
    mock.desktop = false;
    await expect(api.read(scope)).rejects.toThrow(/native desktop/);
    mock.desktop = true;
    mock.status.mockResolvedValue({
      kind: "managed",
      unlocked: true,
      securityRevision: "changed",
    });
    await expect(api.read(scope)).rejects.toThrow(/lease changed/);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("fences a native status response received after access revocation", async () => {
    const { result } = await mount();
    const api = result.current.documents!,
      scope = api.scope!;
    let finish!: (value: unknown) => void;
    mock.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const read = api.read(scope);
    const rejection = expect(read).rejects.toThrow(/owning|Access|changed/);
    await waitFor(() => expect(mock.status).toHaveBeenCalledOnce());
    await act(async () => {
      mock.locked = true;
      mock.access?.({ databaseId: "db-a", status: "suspended" });
      finish({ kind: "managed", unlocked: true, securityRevision: "revision" });
      await rejection;
    });
    expect(result.current.documents?.scope).toBeNull();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("does not publish a refused write or silently retry private content", async () => {
    const { result } = await mount();
    const api = result.current.documents!,
      scope = api.scope!;
    mock.save.mockRejectedValueOnce(Error("Synthetic refusal"));
    await expect(
      api.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toThrow("refusal");
    await expect(api.read(scope)).rejects.toThrow(/could not be verified/);
    expect(mock.saved?.documents).toBeUndefined();
    expect(mock.save).toHaveBeenCalledOnce();
    await act(async () => {
      await result.current.loadData("db-a");
    });
    expect(
      await result.current.documents!.read(result.current.documents!.scope!),
    ).toEqual(emptyDatabaseDocuments());
  });
  it("rejects stale document and foreign-owner reviews before writes", async () => {
    const { result } = await mount();
    const api = result.current.documents!,
      scope = api.scope!;
    await expect(
      api.compareAndSwap(scope, fixture(), { ...fixture(), revision: 1 }),
    ).rejects.toThrow(/changed since/);
    await expect(api.read({ ...scope, databaseId: "db-b" })).rejects.toThrow(
      /owning/,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });
});
