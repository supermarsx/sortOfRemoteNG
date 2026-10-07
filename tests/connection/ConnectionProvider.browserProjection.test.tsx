import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
const bridge = vi.hoisted(() => ({
  capture: undefined as undefined | ((id?: string) => unknown),
}));
vi.mock("../../src/hooks/connection/useBrowserSessionProjection", () => ({
  useBrowserSessionProjection: (
    _ready: unknown,
    capture: (id?: string) => unknown,
  ) => {
    bridge.capture = capture;
  },
}));
import type { BrowserSessionProjectionOwner } from "../../src/hooks/connection/useBrowserSessionProjection";
import type { BrowserSessionProjection } from "../../src/utils/connection/browserSessionProjection";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { StorageData } from "../../src/utils/storage/storage";
import type { Connection } from "../../src/types/connection/connection";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { acquireCloudSyncDatabaseBarrier } from "../../src/utils/services/cloudSyncDatabaseBarrier";
import { subscribeBrowserSessionProjectionChanges } from "../../src/utils/services/browserSessionProjectionEvents";

const connection: Connection = {
  id: "connection",
  name: "Original",
  hostname: "fixture.test",
  protocol: "ssh",
  port: 22,
  isGroup: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const descriptor = {
  version: 1 as const,
  records: [{ connectionId: "connection", revision: "a".repeat(64) }],
};
let manager: DatabaseManager;
let databaseId: string;
let base: StorageData;
let live: boolean;
let save: ReturnType<typeof vi.fn<(data: StorageData) => Promise<void>>>;
let refresh: ReturnType<typeof vi.fn<() => Promise<BrowserSessionProjection>>>;
let projection: BrowserSessionProjection;
const owner = () =>
  bridge.capture!(databaseId) as BrowserSessionProjectionOwner;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  const database = await manager.createDatabase("Projection fixture");
  databaseId = database.id;
  await manager.selectDatabase(databaseId);
  base = (await manager.loadDatabaseData(databaseId))!;
  projection = {
    browserSessions: descriptor,
    recordMetadata: await reconcileRecordLedger(
      { ...base, browserSessions: descriptor },
      base.recordMetadata,
    ),
  };
  live = true;
  save = vi.fn(async () => {});
  refresh = vi.fn(async () => projection);
  const capture = manager.captureCurrentDatabaseDataTarget.bind(manager);
  vi.spyOn(manager, "captureCurrentDatabaseDataTarget").mockImplementation(
    () => {
      const target = capture();
      return target
        ? { ...target, save, refreshBrowserSessionProjection: refresh }
        : null;
    },
  );
  vi.spyOn(manager, "captureOriginBrowserOwnerProof").mockImplementation(
    (id) => ({
      ownerDatabaseId: id,
      sourceSessionId: "private-token",
      expectedSecurityRevision: "security-revision",
      assertCurrent: () => {
        if (!live) throw new Error("Owner revoked");
      },
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function mount() {
  const view = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    await view.result.current.loadData(databaseId);
  });
  return view;
}
function edit(view: Awaited<ReturnType<typeof mount>>, name = "Unsaved edit") {
  act(() =>
    view.result.current.dispatch({
      type: "SET_CONNECTIONS",
      payload: [{ ...connection, name }],
    }),
  );
}

it("patches only projection fields and preserves edits arriving while refresh is deferred", async () => {
  const view = await mount();
  edit(view);
  const reply = deferred<BrowserSessionProjection>();
  refresh.mockReturnValue(reply.promise);
  let pending!: Promise<{ changed: boolean }>;
  act(() => {
    pending = owner().refresh();
  });
  edit(view, "Newer unsaved edit");
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    reply.resolve(projection);
    expect(await pending).toEqual({ changed: true });
  });
  expect(view.result.current.state.connections[0].name).toBe(
    "Newer unsaved edit",
  );
  expect(view.result.current.persistence.dirty).toBe(true);
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({
    connections: [{ name: "Newer unsaved edit" }],
    browserSessions: descriptor,
    recordMetadata: projection.recordMetadata,
  });
  view.unmount();
});

it("does not mutate a snapshot owned by an in-flight save", async () => {
  const view = await mount();
  const write = deferred<void>();
  save.mockReturnValueOnce(write.promise);
  edit(view, "First edit");
  let saving!: Promise<void>;
  act(() => {
    saving = view.result.current.flushPendingSave();
  });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const sent = save.mock.calls[0][0];
  let updating!: Promise<{ changed: boolean }>;
  act(() => {
    updating = owner().refresh();
  });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    write.resolve();
    await saving;
    await updating;
  });
  expect(sent.browserSessions).toBeUndefined();
  edit(view, "Later edit");
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(save.mock.calls[save.mock.calls.length - 1][0]).toMatchObject({
    connections: [{ name: "Later edit" }],
    browserSessions: descriptor,
  });
  view.unmount();
});

it("patches a retained failed-save snapshot without losing its user changes", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const view = await mount();
  edit(view, "Retained edit");
  save.mockRejectedValueOnce(new Error("Temporary write failure"));
  await act(async () => {
    await expect(view.result.current.flushPendingSave()).rejects.toThrow(
      "Temporary write failure",
    );
  });
  await act(async () => {
    await owner().refresh();
  });
  expect(view.result.current.persistence.dirty).toBe(true);
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(save.mock.calls[save.mock.calls.length - 1][0]).toMatchObject({
    connections: [{ name: "Retained edit" }],
    browserSessions: descriptor,
  });
  log.mockRestore();
  view.unmount();
});

it("rejects a late refresh after owner revocation without applying its projection", async () => {
  const view = await mount();
  const reply = deferred<BrowserSessionProjection>();
  refresh.mockReturnValue(reply.promise);
  const captured = owner();
  let pending!: Promise<{ changed: boolean }>;
  act(() => {
    pending = captured.refresh();
  });
  live = false;
  await act(async () => {
    reply.resolve(projection);
    await expect(pending).rejects.toThrow("Owner revoked");
  });
  expect(captured.currentDescriptor()).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
  view.unmount();
});

it("rebases on cloud capture release without replacing rows or scheduling ledger-only churn", async () => {
  const notices = vi.fn();
  const off = subscribeBrowserSessionProjectionChanges(notices);
  const view = await mount();
  edit(view, "Saved before capture");
  let release!: () => Promise<void>;
  await act(async () => {
    release = await acquireCloudSyncDatabaseBarrier([databaseId]);
  });
  const ledgerOnly = { recordMetadata: projection.recordMetadata };
  refresh.mockResolvedValueOnce(ledgerOnly);
  await act(async () => {
    await release();
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(notices).not.toHaveBeenCalled();
  expect(view.result.current.state.connections[0].name).toBe(
    "Saved before capture",
  );
  edit(view, "After capture");
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(save.mock.calls[save.mock.calls.length - 1][0]).toMatchObject({
    connections: [{ name: "After capture" }],
    recordMetadata: projection.recordMetadata,
  });
  off();
  view.unmount();
});

it("does not overwrite edits or invent a successful refresh after target CAS rejection", async () => {
  const view = await mount();
  edit(view);
  refresh.mockRejectedValueOnce(new Error("External public edit"));
  await act(async () => {
    await expect(owner().refresh()).rejects.toThrow("External public edit");
  });
  expect(view.result.current.state.connections[0].name).toBe("Unsaved edit");
  expect(view.result.current.persistence.dirty).toBe(true);
  expect(owner().currentDescriptor()).toBeUndefined();
  view.unmount();
});
