import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  archiveConnections,
  emptyRecycleBin,
} from "../../src/utils/connection/recycleBin";
import type { Connection } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseAccessState } from "../../src/types/encryption/databaseProtection";
import * as notes from "../../src/utils/storage/connectionNotesVault";

vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: vi.fn(async () => null),
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
  deleteConnectionNotesSecret: vi.fn(),
  deleteConnectionNotesSecrets: vi.fn(),
}));

const day = 86_400_000;
const row = (id: string, parentId?: string, isGroup = false): Connection => ({
  id,
  name: id,
  parentId,
  isGroup,
  protocol: "ssh",
  hostname: "fixture.example.test",
  port: 22,
  username: "synthetic-user",
  password: "synthetic-password",
  description: "private-note",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
});
const tree = () => [
  row("folder", undefined, true),
  row("child", "folder"),
  row("other"),
];
function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("current-database Recycle Bin durable provider", () => {
  let manager: DatabaseManager;
  let id: string;
  beforeEach(async () => {
    await IndexedDbService.init();
    await (await openDB("mremote-keyval", 1)).clear("keyval");
    DatabaseManager.resetInstance();
    manager = DatabaseManager.getInstance();
    id = (await manager.createDatabase("Recycle fixture")).id;
    await manager.selectDatabase(id);
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function mount(data?: Partial<StorageData>) {
    await manager.saveDatabaseData(id, {
      connections: tree(),
      settings: { fixture: "retained" },
      timestamp: Date.now(),
      colorTags: { fixture: { name: "Fixture", color: "#123456" } },
      ...data,
    });
    const hook = renderHook(() => useConnections(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.loadData(id)).toBe(true);
    });
    return hook;
  }

  it("archives one folder batch durably, prunes selection, keeps secrets private and never deletes vault notes", async () => {
    const { result } = await mount();
    act(() => {
      result.current.dispatch({
        type: "SELECT_CONNECTION",
        payload: result.current.state.connections[0],
      });
      result.current.dispatch({
        type: "TOGGLE_SELECT_CONNECTION",
        payload: { id: "child", ctrl: true, shift: false },
      });
      result.current.dispatch({
        type: "TOGGLE_SELECT_CONNECTION",
        payload: { id: "other", ctrl: true, shift: false },
      });
    });
    const save = vi.spyOn(manager, "saveDatabaseData");
    await act(async () => {
      expect(
        await result.current.recycleBin!.archive(["folder"], {
          expectedScope: result.current.recycleBin!.snapshot!.scope,
        }),
      ).toMatchObject({ committed: true, archived: 2 });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      result.current.state.connections.map((connection) => connection.id),
    ).toEqual(["other"]);
    expect([...result.current.state.selectedConnectionIds]).toEqual(["other"]);
    expect(result.current.state.selectedConnection?.id).not.toMatch(
      /folder|child/,
    );
    const stored = (await manager.loadDatabaseData(id))!;
    expect(stored.settings).toEqual({ fixture: "retained" });
    expect(stored.colorTags).toEqual({
      fixture: { name: "Fixture", color: "#123456" },
    });
    expect(stored.recycleBin?.entries).toHaveLength(2);
    expect(
      new Set(stored.recycleBin?.entries.map((entry) => entry.batchId)).size,
    ).toBe(1);
    expect(stored.recycleBin?.entries[1].connection.password).toBe(
      "synthetic-password",
    );
    const publicRows = JSON.stringify(result.current.recycleBin!.snapshot);
    for (const secret of [
      "synthetic-password",
      "synthetic-user",
      "private-note",
      "fixture.example.test",
    ])
      expect(publicRows).not.toContain(secret);
    expect(notes.deleteConnectionNotesSecret).not.toHaveBeenCalled();
    expect(notes.deleteConnectionNotesSecrets).not.toHaveBeenCalled();
  });

  it("keeps children and refreshes a selected child's parent reference in the same saved transaction", async () => {
    const { result } = await mount();
    act(() =>
      result.current.dispatch({
        type: "SELECT_CONNECTION",
        payload: result.current.state.connections[1],
      }),
    );
    const save = vi.spyOn(manager, "saveDatabaseData");
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"], {
        keepChildren: true,
      });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state.selectedConnection?.id).toBe("child");
    expect(result.current.state.selectedConnection?.parentId).toBeUndefined();
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries,
    ).toHaveLength(1);
  });

  it.each(["folder", "child"])(
    "clears a selected archived %s instead of leaving a stale record",
    async (selectedId) => {
      const { result } = await mount();
      act(() =>
        result.current.dispatch({
          type: "SELECT_CONNECTION",
          payload: result.current.state.connections.find(
            (connection) => connection.id === selectedId,
          )!,
        }),
      );
      await act(async () => {
        await result.current.recycleBin!.archive(["folder"]);
      });
      expect(result.current.state.selectedConnection).toBeNull();
      expect([...result.current.state.selectedConnectionIds]).toEqual([]);
    },
  );

  it("does not report success before the actual database save completes", async () => {
    const { result } = await mount();
    const gate = deferred();
    const entered = deferred();
    const save = manager.saveDatabaseData.bind(manager);
    vi.spyOn(manager, "saveDatabaseData").mockImplementation(
      async (...args) => {
        entered.resolve();
        await gate.promise;
        return save(...args);
      },
    );
    let finished = false;
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = result.current
        .recycleBin!.archive(["folder"])
        .then((value) => {
          finished = true;
          return value;
        });
      await entered.promise;
    });
    expect(finished).toBe(false);
    expect(result.current.recycleBin!.busy).toBe(true);
    expect((await manager.loadDatabaseData(id))?.connections).toHaveLength(3);
    await act(async () => {
      gate.resolve();
      await operation;
    });
    expect(finished).toBe(true);
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries,
    ).toHaveLength(2);
  });

  it("retains a recoverable dirty snapshot after a refused save and can retry without losing archived notes", async () => {
    const { result } = await mount();
    vi.spyOn(manager, "saveDatabaseData").mockRejectedValueOnce(
      new Error("synthetic write refusal"),
    );
    await act(async () => {
      await expect(
        result.current.recycleBin!.archive(["folder"]),
      ).rejects.toThrow("synthetic write refusal");
    });
    expect(result.current.persistence.dirty).toBe(true);
    expect(result.current.persistence.error).toContain(
      "synthetic write refusal",
    );
    expect((await manager.loadDatabaseData(id))?.connections).toHaveLength(3);
    expect(result.current.recycleBin!.snapshot?.entries).toHaveLength(2);
    await act(async () => {
      await result.current.flushPendingSave();
    });
    expect(result.current.persistence.dirty).toBe(false);
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries[0].connection
        .description,
    ).toBe("private-note");
    expect(notes.deleteConnectionNotesSecrets).not.toHaveBeenCalled();
  });

  it("reloads a JSON-persisted archive and restores normalized runtime records in parent-first order", async () => {
    const initial = await mount();
    await act(async () => {
      await initial.result.current.recycleBin!.archive(["folder"]);
    });
    const stored = JSON.parse(
      JSON.stringify(await manager.loadDatabaseData(id)),
    ) as StorageData;
    stored.recycleBin!.entries[1].connection.protocol =
      "SSH" as Connection["protocol"];
    initial.unmount();
    const { result } = await mount(stored);
    const snapshot = result.current.recycleBin!.snapshot!;
    await act(async () => {
      expect(
        await result.current.recycleBin!.restore(
          [snapshot.entries[0].id],
          snapshot.scope,
        ),
      ).toMatchObject({ restored: 2 });
    });
    expect(
      result.current.state.connections.map((connection) => connection.id),
    ).toEqual(["other", "folder", "child"]);
    const restored = result.current.state.connections[2];
    expect(restored.protocol).toBe("ssh");
    expect(restored.createdAt).toBeInstanceOf(Date);
    expect(restored.updatedAt).toBeInstanceOf(Date);
    expect(restored.password).toBe("synthetic-password");
    expect((await manager.loadDatabaseData(id))?.recycleBin?.entries).toEqual(
      [],
    );
  });

  it("treats SET_CONNECTIONS as filtered hydration, not user deletion or vault cleanup", async () => {
    const { result } = await mount();
    await act(async () => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [row("other")],
      });
      await result.current.flushPendingSave();
    });
    expect(result.current.recycleBin!.snapshot?.entries).toEqual([]);
    expect(notes.deleteConnectionNotesSecrets).not.toHaveBeenCalled();
  });

  it("masks a deferred or failed same-owner reload and publishes a usable new scope only after retry succeeds", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"]);
    });
    const originalScope = result.current.recycleBin!.snapshot!.scope;
    const gate = deferred();
    const entered = deferred();
    const load = vi
      .spyOn(manager, "loadDatabaseData")
      .mockImplementationOnce(async () => {
        entered.resolve();
        await gate.promise;
        throw new Error("synthetic reload refusal");
      });
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.loadData(id).catch((error: unknown) => error);
      await entered.promise;
    });
    expect(result.current.recycleBin!.snapshot).toBeNull();
    await expect(async () =>
      result.current.recycleBin!.archive(["other"]),
    ).rejects.toThrow();
    await act(async () => {
      gate.resolve();
      expect(await pending).toBeInstanceOf(Error);
    });
    expect(result.current.recycleBin!.snapshot).toBeNull();
    expect(result.current.state.recycleBinData?.entries).toHaveLength(2);
    load.mockRestore();
    await act(async () => {
      expect(await result.current.loadData(id)).toBe(true);
    });
    const currentScope = result.current.recycleBin!.snapshot!.scope;
    expect(currentScope.generation).toBeGreaterThan(originalScope.generation);
    await act(async () => {
      expect(
        await result.current.recycleBin!.archive(["other"], {
          expectedScope: currentScope,
        }),
      ).toMatchObject({ archived: 1 });
    });
  });

  it("rejects a stale dialog's scope after a DB switch even when both databases contain the same IDs", async () => {
    const { result } = await mount();
    const originalScope = result.current.recycleBin!.snapshot!.scope;
    const second = await manager.createDatabase("Other fixture");
    await manager.saveDatabaseData(second.id, {
      connections: tree(),
      settings: {},
      timestamp: Date.now(),
    });
    await act(async () => {
      await manager.selectDatabase(second.id);
    });
    expect(result.current.recycleBin!.snapshot).toBeNull();
    expect(result.current.state.recycleBinData?.entries).toEqual([]);
    await act(async () => {
      await result.current.loadData(second.id);
    });
    await expect(async () =>
      result.current.recycleBin!.archive(["folder"], {
        expectedScope: originalScope,
      }),
    ).rejects.toThrow(/changed/);
    expect(
      (await manager.loadDatabaseData(second.id))?.connections,
    ).toHaveLength(3);
    expect((await manager.loadDatabaseData(id))?.connections).toHaveLength(3);
  });

  it("masks suspended managed access, invalidates reviews and old unlock-generation confirmations without staging expiry", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let access: DatabaseAccessState | null = null;
    let notify!: (state: DatabaseAccessState) => void;
    vi.spyOn(manager, "getDatabaseAccessState").mockImplementation(
      () => access,
    );
    vi.spyOn(manager, "onDatabaseAccessChange").mockImplementation(
      (listener) => {
        notify = listener;
        return () => {};
      },
    );
    const { result } = await mount();
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"]);
    });
    const originalScope = result.current.recycleBin!.snapshot!.scope;
    const review = await result.current.recycleBin!.reviewPurge(
      null,
      originalScope,
    );
    const save = vi.spyOn(manager, "saveDatabaseData");
    act(() => {
      access = {
        databaseId: id,
        status: "suspended",
        reason: "expired",
      } as DatabaseAccessState;
      notify(access);
    });
    expect(result.current.recycleBin!.snapshot).toBeNull();
    expect(result.current.state.recycleBinData?.entries).toHaveLength(2);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * day);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_001);
    });
    expect(result.current.state.recycleBinData?.entries).toHaveLength(2);
    await expect(async () =>
      result.current.recycleBin!.archive(["other"]),
    ).rejects.toThrow(/suspended/);
    await expect(
      result.current.recycleBin!.commitReview(review.token),
    ).rejects.toThrow(/review/i);
    expect(save).not.toHaveBeenCalled();
    act(() => {
      access = { databaseId: id, status: "ready" } as DatabaseAccessState;
      notify(access);
    });
    expect(result.current.recycleBin!.snapshot).not.toBeNull();
    await expect(async () =>
      result.current.recycleBin!.archive(["other"], {
        expectedScope: originalScope,
      }),
    ).rejects.toThrow(/changed/);
    expect(save).not.toHaveBeenCalled();
  });

  it("automatically expires only the opened database and leaves an inactive expired archive untouched", async () => {
    const expiredBin = archiveConnections(
      [row("old")],
      emptyRecycleBin(),
      ["old"],
      Date.now() - 16 * day,
      "old-batch",
    ).bin;
    const inactive = await manager.createDatabase("Inactive fixture");
    await manager.saveDatabaseData(inactive.id, {
      connections: [],
      settings: {},
      timestamp: Date.now(),
      recycleBin: expiredBin,
    });
    const { result } = await mount({ recycleBin: expiredBin });
    await waitFor(() => {
      expect(result.current.recycleBin!.snapshot?.entries).toEqual([]);
      expect(result.current.persistence.dirty).toBe(false);
    });
    expect((await manager.loadDatabaseData(id))?.recycleBin?.entries).toEqual(
      [],
    );
    expect((await manager.loadDatabaseData(inactive.id))?.recycleBin).toEqual(
      expiredBin,
    );
  });

  it("does not restore expired or colliding entries and preserves the live record and archived conflicts", async () => {
    const bin = archiveConnections(
      [row("other"), row("expiring")],
      emptyRecycleBin(),
      ["other", "expiring"],
      Date.now(),
      "batch",
    ).bin;
    const { result } = await mount({ recycleBin: bin });
    let snapshot = result.current.recycleBin!.snapshot!;
    await act(async () => {
      expect(
        await result.current.recycleBin!.restore(
          [snapshot.entries[0].id],
          snapshot.scope,
        ),
      ).toMatchObject({ restored: 0, skipped: 1 });
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * day);
    snapshot = result.current.recycleBin!.snapshot!;
    await act(async () => {
      expect(
        await result.current.recycleBin!.restore(
          [snapshot.entries[1].id],
          snapshot.scope,
        ),
      ).toMatchObject({ restored: 0, skipped: 1 });
    });
    expect(result.current.state.connections).toHaveLength(3);
    expect(
      result.current.state.connections.find(
        (connection) => connection.id === "expiring",
      ),
    ).toBeUndefined();
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries,
    ).toHaveLength(2);
  });

  it("keeps existing entries indefinitely only after a reviewed policy change and invalidates older reviews", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"]);
    });
    const snapshot = result.current.recycleBin!.snapshot!;
    const obsolete = await result.current.recycleBin!.reviewPurge(
      null,
      snapshot.scope,
    );
    const keep = await result.current.recycleBin!.reviewRetention(
      { mode: "forever" },
      snapshot.scope,
    );
    expect(keep.entryCount).toBe(0);
    await act(async () => {
      await result.current.recycleBin!.commitReview(keep.token);
    });
    await expect(
      result.current.recycleBin!.commitReview(obsolete.token),
    ).rejects.toThrow(/review/i);
    const stored = (await manager.loadDatabaseData(id))!.recycleBin!;
    expect(stored.policy).toEqual({ mode: "forever" });
    expect(stored.entries).toHaveLength(2);
    expect(
      result.current.recycleBin!.snapshot!.entries.every(
        (entry) => entry.expiresAt === null,
      ),
    ).toBe(true);
  });

  it("rejects revoked global epochs before close and clears the bin on lock", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"]);
    });
    act(() => manager.invalidatePendingDatabaseOperations());
    await expect(async () =>
      result.current.recycleBin!.archive(["other"]),
    ).rejects.toThrow();
    act(() => manager.closeCurrentDatabase("lock"));
    expect(result.current.recycleBin!.snapshot).toBeNull();
    expect(result.current.state.recycleBinData?.entries).toEqual([]);
    expect(result.current.state.connections).toEqual([]);
  });

  it("binds retention preview to the existing deletion dates and purges only after confirmed durable commit", async () => {
    const now = Date.now();
    const bin = archiveConnections(
      [row("old")],
      emptyRecycleBin(),
      ["old"],
      now - 3 * day,
      "old-batch",
    ).bin;
    const { result } = await mount({ recycleBin: bin });
    const review = await result.current.recycleBin!.reviewRetention(
      { mode: "days", days: 2 },
      result.current.recycleBin!.snapshot!.scope,
    );
    expect(review.entryCount).toBe(1);
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries,
    ).toHaveLength(1);
    await act(async () => {
      const outcome = await result.current.recycleBin!.commitReview(
        review.token,
      );
      expect(outcome).toMatchObject({ committed: true, purged: 1 });
      expect(outcome.warnings.join(" ")).toMatch(/shared OS-vault/);
    });
    expect((await manager.loadDatabaseData(id))?.recycleBin).toMatchObject({
      policy: { mode: "days", days: 2 },
      entries: [],
    });
    await expect(
      result.current.recycleBin!.commitReview(review.token),
    ).rejects.toThrow(/review/i);
    expect(notes.deleteConnectionNotesSecret).not.toHaveBeenCalled();
  });

  it("cancels and monotonically expires review tokens without changing stored records", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.recycleBin!.archive(["folder"]);
    });
    const scope = result.current.recycleBin!.snapshot!.scope;
    const cancelled = await result.current.recycleBin!.reviewPurge(null, scope);
    result.current.recycleBin!.cancelReview(cancelled.token);
    await expect(
      result.current.recycleBin!.commitReview(cancelled.token),
    ).rejects.toThrow(/review/i);
    const expired = await result.current.recycleBin!.reviewPurge(null, scope);
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 120_001);
    await expect(
      result.current.recycleBin!.commitReview(expired.token),
    ).rejects.toThrow(/expired/i);
    expect(
      (await manager.loadDatabaseData(id))?.recycleBin?.entries,
    ).toHaveLength(2);
  });
});
