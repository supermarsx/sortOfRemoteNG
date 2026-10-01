import { describe, expect, it, vi } from "vitest";
import type { DatabaseDocumentStore } from "../../src/types/documents/document";
import { createDocumentService } from "../../src/utils/documents/documentService";
import { fixture } from "./fixtures";
describe("reviewed document service", () => {
  const setup = () => {
    const scope = { databaseId: "db-a", generation: 1 };
    const store: DatabaseDocumentStore = {
      scope,
      changeRevision: 0,
      read: vi.fn(async () => fixture()),
      compareAndSwap: vi.fn(async () => undefined),
    };
    return { scope, store, service: createDocumentService(() => store) };
  };
  it("applies exact reviewed data once without changing the stored baseline in memory", async () => {
    const { scope, store, service } = setup();
    const review = await service.read(scope);
    const next = { ...fixture(), revision: 1 };
    await service.apply(review, next);
    expect(store.compareAndSwap).toHaveBeenCalledWith(scope, fixture(), next);
    await expect(service.apply(review, next)).rejects.toThrow(/expired/);
  });
  it("refuses forged/stale reviews and ownership changes", async () => {
    const { scope, store, service } = setup();
    const review = await service.read(scope);
    review.data.documents[0].name = "tampered";
    await expect(
      service.apply(review, { ...fixture(), revision: 1 }),
    ).rejects.toThrow(/expired/);
    const fresh = await service.read(scope);
    store.scope = { databaseId: "db-b", generation: 2 };
    await expect(
      service.apply(fresh, { ...fixture(), revision: 1 }),
    ).rejects.toThrow(/owning/);
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });
  it("clears private reviews on explicit lifecycle cleanup", async () => {
    const { scope, service } = setup();
    const review = await service.read(scope);
    service.clear();
    await expect(
      service.apply(review, { ...fixture(), revision: 1 }),
    ).rejects.toThrow(/expired/);
  });
  it("discards an in-flight read after cleanup even if the owner stays unchanged", async () => {
    const { scope, store, service } = setup();
    let finish!: (value: ReturnType<typeof fixture>) => void;
    store.read = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = service.read(scope);
    service.clear();
    finish(fixture());
    await expect(pending).rejects.toThrow(/expired/);
  });
  it.each([undefined, "database"] as const)(
    "treats %s scopes as database-owned and isolates an app with the same ID and generation",
    async (kind) => {
      const { scope, store, service } = setup();
      store.scope = { ...scope, kind };
      const review = await service.read({ ...scope, kind: "database" });
      store.scope = { ...scope, kind: "app" };
      await expect(service.read(scope)).rejects.toThrow(/owning/);
      await expect(
        service.apply(review, { ...fixture(), revision: 1 }),
      ).rejects.toThrow(/owning/);
      expect(store.compareAndSwap).not.toHaveBeenCalled();
      const appReview = await service.read({ ...scope, kind: "app" });
      store.scope = scope;
      await expect(
        service.apply(appReview, { ...fixture(), revision: 1 }),
      ).rejects.toThrow(/owning/);
    },
  );
  it("refuses a review whose caller-mutated kind would otherwise rewrite the private receipt", async () => {
    const { scope, store, service } = setup();
    const review = await service.read(scope);
    review.scope.kind = "app";
    store.scope = { ...scope, kind: "app" };
    await expect(
      service.apply(review, { ...fixture(), revision: 1 }),
    ).rejects.toThrow(/expired/);
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });
  it("discards an in-flight read if only the owner kind changes", async () => {
    const { scope, store, service } = setup();
    let finish!: (value: ReturnType<typeof fixture>) => void;
    store.read = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = service.read(scope);
    store.scope = { ...scope, kind: "app" };
    finish(fixture());
    await expect(pending).rejects.toThrow(/owning/);
  });
  it("keeps legacy and explicit database scopes interoperable", async () => {
    const { scope, store, service } = setup();
    const review = await service.read({ ...scope, kind: "database" });
    await service.apply(review, { ...fixture(), revision: 1 });
    expect(store.compareAndSwap).toHaveBeenCalledOnce();
  });
});
