import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseDocumentStore,
  DatabaseDocuments,
} from "../../src/types/documents/document";
import {
  clearDocumentsCache,
  documentsCacheSizeForTests,
  preloadDocuments,
} from "../../src/hooks/documents/documentsCache";
import { useDocumentsWorkspace } from "../../src/hooks/documents/useDocumentsWorkspace";
import { fixture } from "../documents/fixtures";

const context = vi.hoisted(() => ({
  store: undefined as DatabaseDocumentStore | undefined,
}));
vi.mock("../../src/hooks/documents/useAppDocumentsStore", () => ({
  useAppDocumentsStore: () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    documents: context.store,
    databaseAvailability: {
      status: "ready",
      databaseId: "db-a",
      generation: 1,
    },
  }),
}));
let saved: DatabaseDocuments;
const makeStore = (): DatabaseDocumentStore => ({
  scope: { databaseId: "db-a", generation: 1 },
  changeRevision: 0,
  read: vi.fn(async () => structuredClone(saved)),
  compareAndSwap: vi.fn(async () => undefined),
});
beforeEach(() => {
  saved = fixture();
  clearDocumentsCache();
  context.store = makeStore();
});
afterEach(cleanup);

describe("documents preload and SWR", () => {
  it("dedupes concurrent preloads", async () => {
    const store = context.store!;
    await Promise.all([preloadDocuments(store), preloadDocuments(store)]);
    expect(store.read).toHaveBeenCalledTimes(1);
    await preloadDocuments(store);
    expect(store.read).toHaveBeenCalledTimes(1);
  });

  it("a cache hit shows data on the first render before any read resolves", async () => {
    await preloadDocuments(context.store!);
    let release!: () => void;
    (context.store!.read as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(structuredClone(saved));
        }),
    );
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    expect(result.current.data?.documents[0].name).toBe("Inventory");
    expect(result.current.busy).toBe(false);
    await waitFor(() => expect(result.current.revalidating).toBe(true));
    // Editing waits for the revalidated review instead of being lost.
    act(() => result.current.update((data) => ({ ...data })));
    expect(result.current.dirty).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(result.current.revalidating).toBe(false));
  });

  it("revalidation updates in place when the library changed", async () => {
    await preloadDocuments(context.store!);
    saved = { ...saved, revision: 5, documents: [] };
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    expect(result.current.data?.documents).toHaveLength(1);
    await waitFor(() => expect(result.current.data?.documents).toHaveLength(0));
  });

  it("keeps the same object when the revision is unchanged", async () => {
    await preloadDocuments(context.store!);
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    const first = result.current.data;
    await waitFor(() => expect(result.current.revalidating).toBe(false));
    expect(result.current.data).toBe(first);
  });

  it("is bounded and a preload of a locked store reads nothing", async () => {
    for (let generation = 1; generation <= 6; generation++)
      await preloadDocuments({
        ...makeStore(),
        scope: { databaseId: "db-a", generation },
      });
    expect(documentsCacheSizeForTests()).toBeLessThanOrEqual(3);
    clearDocumentsCache();
    const locked = { ...makeStore(), scope: null };
    await preloadDocuments(locked);
    expect(locked.read).not.toHaveBeenCalled();
    expect(documentsCacheSizeForTests()).toBe(0);
  });
});
