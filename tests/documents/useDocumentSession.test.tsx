import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/hooks/documents/useDocumentSession";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";

const h = vi.hoisted(() => ({
  availability: { status: "none", generation: 0 } as DatabaseAvailability,
  sessions: [] as ConnectionSession[],
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: h.sessions,
      connections: [{ id: "folder", isGroup: true }],
    },
    dispatch: h.dispatch,
    databaseAvailability: h.availability,
  }),
}));
beforeEach(() => {
  h.sessions = [];
  h.availability = { status: "none", generation: 0 };
  vi.clearAllMocks();
});
describe("Documents browser entry", () => {
  it("creates an independent main tab when the canonical tab is detached, without rewriting its request", () => {
    h.availability = { status: "ready", databaseId: "a", generation: 1 };
    const { result, rerender } = renderHook(() => useDocumentSession());
    act(() => result.current({ documentId: "private-draft" }));
    const detached = h.dispatch.mock.calls[0][0].payload as ConnectionSession;
    detached.layout = {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      zIndex: 1,
      isDetached: true,
      windowId: "detached",
    };
    h.sessions = [detached];
    rerender();
    h.dispatch.mockClear();
    act(() => result.current({ allowUnavailable: true }));
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({ ownerDatabaseId: "a" }),
    });
    expect(h.dispatch.mock.calls[0][0].payload.id).not.toBe(detached.id);
    expect(detached.documentsWorkspace?.documentId).toBe("private-draft");
  });
  it("opens a locked ownerless tab without selecting a database and reuses it during first loading", () => {
    const activate = vi.fn();
    const { result, rerender } = renderHook(() => useDocumentSession(activate));
    act(() => result.current({ allowUnavailable: true }));
    const session = h.dispatch.mock.calls[0][0].payload as ConnectionSession;
    expect(session).toMatchObject({
      protocol: "tool:documents",
      ownerDatabaseId: undefined,
      documentsWorkspace: undefined,
    });
    expect(activate).toHaveBeenCalledWith(session.id);
    h.sessions = [session];
    h.availability = { status: "loading", databaseId: "a", generation: 1 };
    rerender();
    h.dispatch.mockClear();
    act(() => result.current({ allowUnavailable: true }));
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(activate).toHaveBeenLastCalledWith(session.id);
  });
  it("plain reopen activates without resetting a current record/draft; explicit tree navigation updates the request", () => {
    h.availability = { status: "ready", databaseId: "a", generation: 1 };
    const activate = vi.fn();
    const { result, rerender } = renderHook(() => useDocumentSession(activate));
    act(() => result.current({ parentFolderId: "folder", create: true }));
    const session = h.dispatch.mock.calls[0][0].payload as ConnectionSession;
    expect(session).toMatchObject({
      ownerDatabaseId: "a",
      documentsWorkspace: {
        databaseId: "a",
        parentFolderId: "folder",
        create: true,
      },
    });
    h.sessions = [session];
    rerender();
    h.dispatch.mockClear();
    act(() => result.current({ allowUnavailable: true }));
    expect(h.dispatch).not.toHaveBeenCalled();
    act(() => result.current({ documentId: "doc" }));
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: {
        id: session.id,
        documentsWorkspace: expect.objectContaining({
          databaseId: "a",
          documentId: "doc",
        }),
      },
    });
  });
  it("never reuses A's bound tab for B or for an ownerless entry", () => {
    h.availability = { status: "ready", databaseId: "a", generation: 1 };
    const { result, rerender } = renderHook(() => useDocumentSession());
    act(() => result.current());
    const old = h.dispatch.mock.calls[0][0].payload as ConnectionSession;
    h.sessions = [old];
    h.availability = { status: "ready", databaseId: "b", generation: 2 };
    rerender();
    h.dispatch.mockClear();
    act(() => result.current({ allowUnavailable: true }));
    expect(h.dispatch.mock.calls[0][0].payload).toMatchObject({
      ownerDatabaseId: "b",
      documentsWorkspace: { databaseId: "b" },
    });
    expect(h.dispatch.mock.calls[0][0].payload.id).not.toBe(old.id);
    h.availability = { status: "none", generation: 3 };
    rerender();
    h.dispatch.mockClear();
    act(() => result.current());
    expect(h.dispatch).not.toHaveBeenCalled();
    act(() => result.current({ allowUnavailable: true }));
    expect(h.dispatch.mock.calls[0][0].payload.ownerDatabaseId).toBeUndefined();
  });
});
