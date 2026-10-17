import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  acquireCloudSyncDatabaseBarrier,
  type CloudSyncDependencyRepairIntent,
} from "../../src/utils/services/cloudSyncDatabaseBarrier";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import { assertArchiveDependencyRefresh } from "../../src/utils/connection/archiveDependencyRefresh";
import type { StorageData } from "../../src/utils/storage/storage";
import type { Connection } from "../../src/types/connection/connection";

let manager: DatabaseManager;
let id: string;
const row: Connection = {
  id: "host",
  name: "Original",
  hostname: "fixture.test",
  protocol: "ssh",
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sshQuickActions: {
    version: 1,
    items: [{ id: "app-script", kind: "script", scope: { kind: "app" } }],
  },
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  id = (await manager.createDatabase("Synthetic continuity fixture")).id;
  await manager.selectDatabase(id);
  const source = (await manager.loadDatabaseData(id))!;
  await manager.saveDatabaseData(id, {
    ...source,
    connections: [structuredClone(row)],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function mount() {
  const view = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    await view.result.current.loadData(id);
  });
  return view;
}
async function begin() {
  const intent: CloudSyncDependencyRepairIntent = { kind: "dependency-repair" };
  const release = await acquireCloudSyncDatabaseBarrier([id], false, intent);
  const before = (await manager.loadDatabaseData(id))!;
  const after = structuredClone(before);
  after.automationLibrary = emptyDatabaseAutomationLibrary();
  after.automationLibrary.terminalScripts.customScripts.push({
    id: "copied",
    name: "Copied",
    description: "Fixture",
    script: "hostname",
    language: "bash",
    category: "Test",
    osTags: ["linux"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  after.automationLibrary.revision++;
  after.connections[0].sshQuickActions!.items[0] = {
    id: "copied",
    kind: "script",
    scope: { kind: "database", databaseId: id },
  };
  assertArchiveDependencyRefresh(id, before, after);
  return { intent, release, before, after };
}

it("retains active sessions/access generation and ordinary drafts while adopting the owned CAS baseline", async () => {
  const view = await mount();
  const generation = view.result.current.databaseAvailability!.generation;
  act(() =>
    view.result.current.dispatch({
      type: "ADD_SESSION",
      payload: {
        id: "session",
        connectionId: "host",
        name: "Live",
        protocol: "ssh",
        status: "connected",
      } as never,
    }),
  );
  const sessions = view.result.current.state.sessions;
  let repair!: Awaited<ReturnType<typeof begin>>;
  await act(async () => {
    repair = await begin();
  });
  expect(view.result.current.databaseAvailability).toMatchObject({
    status: "ready",
    generation,
  });
  act(() =>
    view.result.current.dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...view.result.current.state.connections[0],
        name: "Concurrent draft",
      },
    }),
  );
  let settled = false;
  let flushing!: Promise<void>;
  act(() => {
    flushing = view.result.current.flushPendingSave().then(() => {
      settled = true;
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(settled).toBe(false);
  await act(async () => {
    await manager.commitArchiveDependencyRepair(
      id,
      repair.before,
      repair.after,
    );
    repair.intent.receipt = { before: repair.before, after: repair.after };
    await repair.release();
    await flushing;
  });
  expect(view.result.current.databaseAvailability).toMatchObject({
    status: "ready",
    generation,
  });
  expect(view.result.current.state.sessions).toBe(sessions);
  expect(view.result.current.state.connections[0]).toMatchObject({
    name: "Concurrent draft",
    sshQuickActions: {
      items: [{ id: "copied", scope: { kind: "database", databaseId: id } }],
    },
  });
  const persisted = (await manager.loadDatabaseData(id))!;
  expect(persisted.connections[0].name).toBe("Concurrent draft");
  expect(persisted.connections[0].sshQuickActions!.items[0].id).toBe("copied");
  expect(persisted.automationLibrary!.terminalScripts.customScripts[0].id).toBe(
    "copied",
  );
  view.unmount();
});

it("retains conflicting quickaction drafts and fences writes instead of resetting the editor", async () => {
  const view = await mount();
  let repair!: Awaited<ReturnType<typeof begin>>;
  await act(async () => {
    repair = await begin();
  });
  act(() =>
    view.result.current.dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...view.result.current.state.connections[0],
        sshQuickActions: {
          version: 1,
          items: [{ id: "new-choice", kind: "script" }],
        },
      },
    }),
  );
  await act(async () => {
    await manager.commitArchiveDependencyRepair(
      id,
      repair.before,
      repair.after,
    );
    repair.intent.receipt = { before: repair.before, after: repair.after };
    await expect(repair.release()).rejects.toThrow("refresh failed");
  });
  expect(
    view.result.current.state.connections[0].sshQuickActions!.items[0].id,
  ).toBe("new-choice");
  await act(async () => {
    await expect(view.result.current.flushPendingSave()).rejects.toThrow(
      "library write could not be verified",
    );
  });
  expect(
    (await manager.loadDatabaseData(id))!.connections[0].sshQuickActions!
      .items[0].id,
  ).toBe("copied");
  view.unmount();
});

it("does not adopt foreign edits made after the repair, so the next ordinary save still rejects them", async () => {
  const view = await mount();
  let repair!: Awaited<ReturnType<typeof begin>>;
  await act(async () => {
    repair = await begin();
    await manager.commitArchiveDependencyRepair(
      id,
      repair.before,
      repair.after,
    );
    repair.intent.receipt = { before: repair.before, after: repair.after };
  });
  const external = (await manager.loadDatabaseData(id))!;
  await manager.saveDatabaseData(id, {
    ...external,
    settings: { ...external.settings, external: "retained" },
  });
  await act(async () => {
    await repair.release();
  });
  act(() =>
    view.result.current.dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...view.result.current.state.connections[0], name: "Draft" },
    }),
  );
  await act(async () => {
    await expect(view.result.current.flushPendingSave()).rejects.toThrow();
  });
  expect((await manager.loadDatabaseData(id))!.settings.external).toBe(
    "retained",
  );
  view.unmount();
});

it.each(["hostname", "credentialVault", "recycleBin", "settings"])(
  "refuses non-copy %s changes before adopting any writer baseline",
  async (field) => {
    const view = await mount();
    let repair!: Awaited<ReturnType<typeof begin>>;
    await act(async () => {
      repair = await begin();
    });
    const invalid = structuredClone(repair.after);
    if (field === "hostname") invalid.connections[0].hostname = "changed.test";
    else
      (invalid as unknown as Record<string, unknown>)[field] = {
        unexpected: true,
      };
    expect(() =>
      assertArchiveDependencyRefresh(id, repair.before, invalid),
    ).toThrow("changed other database data");
    repair.intent.receipt = { before: repair.before, after: invalid };
    await act(async () => {
      await expect(repair.release()).rejects.toThrow("refresh failed");
    });
    expect(view.result.current.state.connections[0].hostname).toBe(
      "fixture.test",
    );
    view.unmount();
  },
);

it.each(["before", "after"] as const)(
  "rejects a mutated %s receipt even if the new reference names a valid library entry",
  async (field) => {
    const view = await mount();
    let repair!: Awaited<ReturnType<typeof begin>>;
    await act(async () => {
      repair = await begin();
    });
    const payload =
      repair.after.automationLibrary!.terminalScripts.customScripts[0];
    repair.after.automationLibrary!.terminalScripts.customScripts.push({
      ...payload,
      id: "another-valid-script",
    });
    await manager.commitArchiveDependencyRepair(
      id,
      repair.before,
      repair.after,
    );
    repair[field].connections[0].sshQuickActions!.items[0].id =
      "another-valid-script";
    // A shape-only check cannot prove which reference was actually committed.
    expect(() =>
      assertArchiveDependencyRefresh(id, repair.before, repair.after),
    ).not.toThrow();
    repair.intent.receipt = { before: repair.before, after: repair.after };
    await act(async () => {
      await expect(repair.release()).rejects.toThrow("refresh failed");
    });
    expect(
      view.result.current.state.connections[0].sshQuickActions!.items[0].id,
    ).toBe("app-script");
    expect(
      (await manager.loadDatabaseData(id))!.connections[0].sshQuickActions!
        .items[0].id,
    ).toBe("copied");
    view.unmount();
  },
);

it("releases an unavailable-source no-op without replacing rows or changing access generation", async () => {
  const view = await mount();
  const availability = view.result.current.databaseAvailability;
  const rows = view.result.current.state.connections;
  await act(async () => {
    const release = await acquireCloudSyncDatabaseBarrier([id], false, {
      kind: "dependency-repair",
    });
    await release();
  });
  expect(view.result.current.databaseAvailability).toBe(availability);
  expect(view.result.current.state.connections).toBe(rows);
  expect(view.result.current.persistence.error).toBeNull();
  view.unmount();
});
