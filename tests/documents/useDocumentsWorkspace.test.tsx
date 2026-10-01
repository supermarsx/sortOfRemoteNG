import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DatabaseDocumentStore,
  DatabaseDocuments,
} from "../../src/types/documents/document";
import { useDocumentsWorkspace } from "../../src/hooks/documents/useDocumentsWorkspace";
import { fixture } from "./fixtures";

const context = vi.hoisted(() => ({
  store: undefined as DatabaseDocumentStore | undefined,
  appStore: undefined as DatabaseDocumentStore | undefined,
  ready: true,
}));
vi.mock("../../src/hooks/documents/useAppDocumentsStore", () => ({
  useAppDocumentsStore: () => context.appStore,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    documents: context.store,
    databaseAvailability: {
      status: context.ready ? "ready" : "suspended",
      databaseId: "db-a",
      generation: 1,
    },
  }),
}));
let saved: DatabaseDocuments;
beforeEach(() => {
  saved = fixture();
  context.ready = true;
  context.appStore = undefined;
  context.store = {
    scope: { databaseId: "db-a", generation: 1 },
    changeRevision: 0,
    read: vi.fn(async () => structuredClone(saved)),
    compareAndSwap: vi.fn(async (_scope, expected, replacement) => {
      expect(expected).toEqual(saved);
      saved = structuredClone(replacement);
    }),
  };
});
afterEach(cleanup);
describe("protected workspace draft lifecycle", () => {
  it("uses app storage without a ready database, retains drafts across database changes, and clears on app lock", async () => {
    const databaseStore = context.store!;
    context.ready = false;
    context.appStore = {
      ...databaseStore,
      scope: { kind: "app", databaseId: "app-wide-documents", generation: 7 },
      read: vi.fn(async () => structuredClone(saved)),
      compareAndSwap: vi.fn(async (_scope, _expected, replacement) => {
        saved = structuredClone(replacement);
      }),
    };
    const { result, rerender } = renderHook(() =>
      useDocumentsWorkspace("app-wide-documents", false, "app"),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(databaseStore.read).not.toHaveBeenCalled();
    act(() =>
      result.current.update((data) => ({
        ...data,
        documents: data.documents.map((doc) => ({ ...doc, name: "App draft" })),
      })),
    );
    context.ready = true;
    context.store = {
      ...databaseStore,
      scope: { databaseId: "other", generation: 4 },
    };
    rerender();
    expect(result.current.data?.documents[0].name).toBe("App draft");
    expect(result.current.dirty).toBe(true);
    expect(context.appStore.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(context.appStore.compareAndSwap).toHaveBeenCalledOnce();
    expect(databaseStore.compareAndSwap).not.toHaveBeenCalled();
    context.appStore = undefined;
    rerender();
    expect(result.current.data).toBeNull();
  });
  it("never treats an app store as the default database store even when owner IDs collide", async () => {
    context.store = {
      ...context.store!,
      scope: { databaseId: "db-a", kind: "app", generation: 1 },
    };
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    await act(async () => {});
    expect(result.current.data).toBeNull();
    expect(context.store.read).not.toHaveBeenCalled();
  });
  it("publishes saved revision only after durable compare-and-swap and readback", async () => {
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    act(() =>
      result.current.update((data) => ({
        ...data,
        documents: data.documents.map((doc) => ({ ...doc, name: "Changed" })),
      })),
    );
    expect(result.current.dirty).toBe(true);
    expect(saved.documents[0].name).toBe("Inventory");
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(saved.documents[0].name).toBe("Changed");
    expect(saved.revision).toBe(1);
    expect(result.current.dirty).toBe(false);
  });
  it("retains private drafts on an uncertain save and requires a fresh review", async () => {
    vi.mocked(context.store!.compareAndSwap).mockRejectedValue(
      Error("Disk write failed"),
    );
    const { result } = renderHook(() => useDocumentsWorkspace("db-a"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    act(() =>
      result.current.update((data) => ({
        ...data,
        documents: data.documents.map((doc) => ({
          ...doc,
          name: "Retained draft",
        })),
      })),
    );
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.data?.documents[0].name).toBe("Retained draft");
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toMatch(/draft is retained/);
    expect(saved.documents[0].name).toBe("Inventory");
  });
  it("clears contents on lock and never exposes a delayed old-owner read", async () => {
    let finish!: (data: DatabaseDocuments) => void;
    vi.mocked(context.store!.read).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(() =>
      useDocumentsWorkspace("db-a"),
    );
    context.ready = false;
    context.store = { ...context.store!, scope: null };
    rerender();
    await act(async () => finish(fixture()));
    expect(result.current.data).toBeNull();
    expect(result.current.dirty).toBe(false);
  });
  it("does not overwrite an unsaved draft when the provider publishes a newer revision", async () => {
    const { result, rerender } = renderHook(() =>
      useDocumentsWorkspace("db-a"),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    act(() =>
      result.current.update((data) => ({
        ...data,
        documents: data.documents.map((doc) => ({ ...doc, name: "Mine" })),
      })),
    );
    context.store = { ...context.store!, changeRevision: 2 };
    rerender();
    expect(result.current.stale).toBe(true);
    expect(result.current.data?.documents[0].name).toBe("Mine");
  });
});
