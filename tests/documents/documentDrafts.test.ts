import { afterEach, describe, expect, it } from "vitest";
import {
  getDocumentDraft,
  hasPendingDocumentDraft,
  registerDocumentDraft,
  type DocumentDraftState,
} from "../../src/utils/documents/documentDrafts";

const disposers: Array<() => void> = [];
function register(sessionId: string, read: () => DocumentDraftState) {
  const dispose = registerDocumentDraft(sessionId, read);
  disposers.push(dispose);
  return dispose;
}
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});
const clean = (databaseId = "db-a"): DocumentDraftState => ({
  databaseId,
  dirty: false,
  busy: false,
  revision: 0,
});

describe("document draft metadata lifecycle", () => {
  it("returns no metadata for unmounted sessions and does not mark a clean editor pending", () => {
    expect(getDocumentDraft("absent")).toBeUndefined();
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
    register("editor", () => clean());
    expect(getDocumentDraft("editor")).toEqual(clean());
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
    expect(Object.keys(getDocumentDraft("editor")!).sort()).toEqual([
      "busy",
      "databaseId",
      "dirty",
      "revision",
    ]);
  });

  it("reads current dirty, saving and revision state rather than retaining a mount-time snapshot", () => {
    let state = clean();
    register("editor", () => state);
    state = { ...state, dirty: true, revision: 3 };
    expect(getDocumentDraft("editor")).toEqual(state);
    expect(hasPendingDocumentDraft("db-a")).toBe(true);
    state = { ...state, dirty: false, busy: true };
    expect(hasPendingDocumentDraft("db-a")).toBe(true);
    state = { ...state, busy: false, revision: 4 };
    expect(getDocumentDraft("editor")?.revision).toBe(4);
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
  });

  it("tracks multiple editor sessions without blocking unrelated database owners", () => {
    register("clean-a", () => clean());
    const dispose = register("dirty-a", () => ({ ...clean(), dirty: true }));
    register("busy-b", () => ({ ...clean("db-b"), busy: true }));
    expect(hasPendingDocumentDraft("db-a")).toBe(true);
    expect(hasPendingDocumentDraft("db-b")).toBe(true);
    expect(hasPendingDocumentDraft("db-c")).toBe(false);
    dispose();
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
    expect(hasPendingDocumentDraft("db-b")).toBe(true);
  });

  it("unregisters metadata on editor cleanup and makes repeated cleanup harmless", () => {
    const dispose = register("editor", () => ({ ...clean(), dirty: true }));
    dispose();
    dispose();
    expect(getDocumentDraft("editor")).toBeUndefined();
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
  });

  it("does not let stale cleanup remove a newer same-session registration", () => {
    const oldDispose = register("editor", () => ({ ...clean(), dirty: true }));
    const latest = { ...clean("db-b"), busy: true, revision: 5 };
    const newDispose = register("editor", () => latest);
    oldDispose();
    expect(getDocumentDraft("editor")).toEqual(latest);
    expect(hasPendingDocumentDraft("db-a")).toBe(false);
    expect(hasPendingDocumentDraft("db-b")).toBe(true);
    newDispose();
    expect(getDocumentDraft("editor")).toBeUndefined();
    expect(hasPendingDocumentDraft("db-b")).toBe(false);
  });
});
