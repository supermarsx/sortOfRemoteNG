import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseDocuments,
  DatabaseDocumentStore,
  DocumentScope,
} from "../../src/types/documents/document";
import type { useConnections } from "../../src/contexts/useConnections";
import { useTreeDocuments } from "../../src/components/connection/connectionTree/useTreeDocuments";
import type { TreeDocumentMetadata } from "../../src/components/connection/connectionTree/documentTreeModel";
import { createEmptyDocument } from "../../src/utils/documents/documentService";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";

const mocks = vi.hoisted(() => ({
  context: {} as ReturnType<typeof useConnections>,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.context,
}));
const metadata: TreeDocumentMetadata = {
  id: "doc",
  name: "Runbook",
  icon: "file-text",
  parentFolderId: null,
  blockTypes: ["note", "secret"],
};
type Store = DatabaseDocumentStore & {
  readMetadata: ReturnType<
    typeof vi.fn<(scope: DocumentScope) => Promise<TreeDocumentMetadata[]>>
  >;
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function installStore(generation = 1): Store {
  const store: Store = {
    scope: { databaseId: "db-a", generation },
    changeRevision: 0,
    readMetadata: vi.fn(async () => [{ ...metadata }]),
    read: vi.fn(async () => ({
      ...emptyDatabaseDocuments(),
      documents: [
        {
          ...createEmptyDocument("Runbook"),
          id: "doc",
          blocks: [
            { id: "note", type: "note" as const, text: "ordinary content" },
            {
              id: "secret",
              type: "secret" as const,
              label: "Vault",
              value: "secret-needle",
            },
          ],
        },
      ],
    })),
    compareAndSwap: vi.fn(),
  };
  mocks.context = {
    databaseAvailability: { status: "ready", databaseId: "db-a", generation },
    documents: store,
  } as unknown as ReturnType<typeof useConnections>;
  return store;
}
beforeEach(() => installStore());
afterEach(cleanup);

describe("useTreeDocuments", () => {
  it("does no reads while disabled, and retains only projected metadata when enabled", async () => {
    const store = mocks.context.documents as Store;
    const supplied = {
      ...metadata,
      extraPrivateField: "must not persist in tree",
    };
    Object.defineProperty(supplied, "blocks", {
      get() {
        throw Error("Body accessed");
      },
    });
    store.readMetadata.mockResolvedValue([supplied]);
    const { result, rerender } = renderHook(
      ({ enabled }) => useTreeDocuments(enabled, "", false),
      { initialProps: { enabled: false } },
    );
    expect(store.readMetadata).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries).toEqual([metadata]));
    expect(store.readMetadata).toHaveBeenCalledWith({
      databaseId: "db-a",
      generation: 1,
    });
    expect(result.current.entries[0]).not.toHaveProperty("extraPrivateField");
    expect(store.read).not.toHaveBeenCalled();
    rerender({ enabled: false });
    expect(result.current.entries).toEqual([]);
    expect(result.current.scope).toBeNull();
  });
  it("does not fall back to reading bodies when the metadata API is unavailable", async () => {
    const store = mocks.context.documents as Store;
    delete (store as Partial<Store>).readMetadata;
    const { result } = renderHook(() =>
      useTreeDocuments(true, "needle", false),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("could not be loaded"),
    );
    expect(store.read).not.toHaveBeenCalled();
  });
  it("ignores app-wide, mismatched and suspended owners", () => {
    const store = mocks.context.documents as Store;
    store.scope = { kind: "app", databaseId: "db-a", generation: 1 };
    const { result, rerender } = renderHook(() =>
      useTreeDocuments(true, "", false),
    );
    expect(result.current.scope).toBeNull();
    store.scope = { databaseId: "db-other", generation: 1 };
    rerender();
    expect(result.current.scope).toBeNull();
    store.scope = { databaseId: "db-a", generation: 1 };
    mocks.context.databaseAvailability = {
      status: "suspended",
      databaseId: "db-a",
      generation: 1,
    };
    rerender();
    expect(result.current.entries).toEqual([]);
    expect(store.readMetadata).not.toHaveBeenCalled();
  });
  it.each(["generation", "revision"])(
    "discards old responses after a %s change",
    async (change) => {
      const store = mocks.context.documents as Store;
      const old = deferred<TreeDocumentMetadata[]>();
      store.readMetadata.mockReturnValueOnce(old.promise);
      const { result, rerender } = renderHook(() =>
        useTreeDocuments(true, "", false),
      );
      if (change === "generation") installStore(2);
      else {
        store.changeRevision += 1;
        store.readMetadata.mockResolvedValue([
          { ...metadata, name: "New runbook" },
        ]);
      }
      rerender();
      await waitFor(() => expect(result.current.loading).toBe(false));
      const latest = result.current.entries;
      await act(async () => {
        old.resolve([{ ...metadata, name: "Old private title" }]);
      });
      expect(result.current.entries).toEqual(latest);
      expect(result.current.entries[0].name).not.toBe("Old private title");
    },
  );
  it("ignores a pending read on disable and does not resurrect it on re-enable", async () => {
    const store = mocks.context.documents as Store;
    const old = deferred<TreeDocumentMetadata[]>();
    store.readMetadata.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) => useTreeDocuments(enabled, "", false),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    await act(async () => {
      old.resolve([{ ...metadata, name: "Stale name" }]);
    });
    expect(result.current.entries).toEqual([]);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries).toEqual([metadata]));
  });
  it.each(["generation", "revision"])(
    "rejects a live %s revocation even before React rerenders",
    async (change) => {
      const store = mocks.context.documents as Store;
      const pending = deferred<TreeDocumentMetadata[]>();
      store.readMetadata.mockReturnValue(pending.promise);
      const { result } = renderHook(() => useTreeDocuments(true, "", false));
      if (change === "generation")
        store.scope = { databaseId: "db-a", generation: 2 };
      else store.changeRevision += 1;
      await act(async () => pending.resolve([metadata]));
      expect(result.current.entries).toEqual([]);
    },
  );
  it("loads bodies only for opted-in nonempty queries and drops matches immediately on opt-out", async () => {
    const store = mocks.context.documents as Store;
    const { result, rerender } = renderHook(
      ({ query, fullText }) => useTreeDocuments(true, query, fullText),
      { initialProps: { query: "ordinary content", fullText: false } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(store.read).not.toHaveBeenCalled();
    rerender({ query: "ordinary content", fullText: true });
    await waitFor(() =>
      expect(result.current.contentMatches?.has("doc")).toBe(true),
    );
    expect(result.current).not.toHaveProperty("documents");
    expect(result.current.entries[0]).not.toHaveProperty("blocks");
    rerender({ query: "ordinary content", fullText: false });
    expect(result.current.contentMatches).toBeUndefined();
    rerender({ query: "secret-needle", fullText: true });
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.contentMatches?.size).toBe(0);
    rerender({ query: "", fullText: true });
    expect(result.current.contentMatches).toBeUndefined();
    expect(store.read).toHaveBeenCalledTimes(2);
    expect(store.readMetadata).toHaveBeenCalledTimes(1);
  });
  it("rejects late full-text completions when the setting is disabled", async () => {
    const store = mocks.context.documents as Store;
    const body = deferred<DatabaseDocuments>();
    vi.mocked(store.read).mockReturnValue(body.promise);
    const { result, rerender } = renderHook(
      ({ fullText }) => useTreeDocuments(true, "needle", fullText),
      { initialProps: { fullText: true } },
    );
    await waitFor(() => expect(store.read).toHaveBeenCalledOnce());
    rerender({ fullText: false });
    await act(async () =>
      body.resolve({
        ...emptyDatabaseDocuments(),
        documents: [{ ...createEmptyDocument("needle"), id: "doc" }],
      }),
    );
    expect(result.current.contentMatches).toBeUndefined();
    expect(result.current.entries).toEqual([metadata]);
  });
});
