import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { Connection } from "../../src/types/connection/connection";

const hook = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("../../src/utils/connection/clearDeletedConnectionBrowserData", () => ({
  clearDeletedConnectionBrowserData: hook.clear,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: vi.fn(async () => null),
}));
vi.mock("../../src/utils/storage/connectionNotesVault", () => ({
  activateConnectionNotes: vi.fn(),
  deleteConnectionNotesSecret: vi.fn(),
  deleteConnectionNotesSecrets: vi.fn(),
}));

const row = (
  id: string,
  protocol: string,
  parentId?: string,
  isGroup = false,
): Connection => ({
  id,
  name: id,
  parentId,
  isGroup,
  protocol: protocol as Connection["protocol"],
  hostname: "fixture.example.test",
  port: 443,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
});
const tree = () => [
  row("folder", "ssh", undefined, true),
  row("web", "https", "folder"),
  row("other", "http"),
];
function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

describe("deleting connections clears their browser data after the delete commits", () => {
  let manager: DatabaseManager;
  let id: string;
  beforeEach(async () => {
    await IndexedDbService.init();
    await (await openDB("mremote-keyval", 1)).clear("keyval");
    DatabaseManager.resetInstance();
    manager = DatabaseManager.getInstance();
    id = (await manager.createDatabase("Browser data fixture")).id;
    await manager.selectDatabase(id);
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function mount() {
    await manager.saveDatabaseData(id, {
      connections: tree(),
      settings: {},
      timestamp: Date.now(),
    });
    const mounted = renderHook(() => useConnections(), { wrapper });
    await act(async () => {
      expect(await mounted.result.current.loadData(id)).toBe(true);
    });
    return mounted;
  }

  it("calls the hook once per committed archive with the before/after rows, and not on restore", async () => {
    const { result } = await mount();
    const save = vi.spyOn(manager, "saveDatabaseData");
    hook.clear.mockImplementation(() => {
      // The delete has been persisted before cleanup starts.
      expect(save).toHaveBeenCalled();
    });
    await act(async () => {
      expect(
        await result.current.recycleBin!.archive(["folder"], {
          expectedScope: result.current.recycleBin!.snapshot!.scope,
        }),
      ).toMatchObject({ committed: true, archived: 2 });
    });
    expect(hook.clear).toHaveBeenCalledTimes(1);
    const [before, after] = hook.clear.mock.calls[0] as [
      Connection[],
      Connection[],
    ];
    expect(before.map((connection) => connection.id)).toEqual([
      "folder",
      "web",
      "other",
    ]);
    expect(after.map((connection) => connection.id)).toEqual(["other"]);

    const entries = result.current.recycleBin!.snapshot!.entries;
    await act(async () => {
      await result.current.recycleBin!.restore(
        entries.map((entry) => entry.id),
        result.current.recycleBin!.snapshot!.scope,
      );
    });
    expect(hook.clear).toHaveBeenCalledTimes(1);
  });

  it("does not clear browser data when the delete cannot be saved", async () => {
    const { result } = await mount();
    vi.spyOn(manager, "saveDatabaseData").mockRejectedValue(
      new Error("synthetic storage failure"),
    );
    await act(async () => {
      await expect(
        result.current.recycleBin!.archive(["other"], {
          expectedScope: result.current.recycleBin!.snapshot!.scope,
        }),
      ).rejects.toThrow();
    });
    expect(hook.clear).not.toHaveBeenCalled();
  });
});
