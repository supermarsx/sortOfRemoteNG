import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  state: {
    connections: [] as Connection[],
    sessions: [],
  },
  dispatch: vi.fn(),
  dispatchAndFlush: vi.fn(),
  flushPendingSave: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  invoke: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: mocks.state,
    dispatch: mocks.dispatch,
    dispatchAndFlush: mocks.dispatchAndFlush,
    flushPendingSave: mocks.flushPendingSave,
  }),
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import { useBulkConnectionEditor } from "../../src/hooks/connection/useBulkConnectionEditor";

const connections: Connection[] = [
  {
    id: "connection-one",
    name: "One",
    protocol: "ssh",
    hostname: "one.example",
    port: 22,
    isGroup: false,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  } as Connection,
  {
    id: "connection-two",
    name: "Two",
    protocol: "ssh",
    hostname: "two.example",
    port: 22,
    isGroup: false,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  } as Connection,
];

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = () => done();
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("useBulkConnectionEditor durable operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.connections = connections;
    mocks.dispatchAndFlush.mockResolvedValue(undefined);
    mocks.flushPendingSave.mockResolvedValue(undefined);
  });

  it("does not report clone success before its durable dispatch resolves", async () => {
    const flush = deferred();
    const clone = { ...connections[0], id: "connection-clone" };
    mocks.invoke.mockResolvedValue(clone);
    mocks.dispatchAndFlush.mockImplementationOnce(() => flush.promise);
    const { result } = renderHook(() => useBulkConnectionEditor(true, vi.fn()));

    let cloning!: Promise<Connection | undefined>;
    act(() => {
      cloning = result.current.duplicateConnection(connections[0]);
    });
    await waitFor(() => {
      expect(mocks.dispatchAndFlush).toHaveBeenCalledWith({
        type: "ADD_CONNECTION",
        payload: clone,
      });
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();

    await act(async () => {
      flush.resolve();
      await cloning;
    });
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed single deletion without reporting success", async () => {
    mocks.dispatchAndFlush.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useBulkConnectionEditor(true, vi.fn()));

    let persisted = true;
    await act(async () => {
      persisted = await result.current.deleteConnection("connection-one");
    });

    expect(persisted).toBe(false);
    expect(mocks.dispatchAndFlush).toHaveBeenCalledWith({
      type: "DELETE_CONNECTION",
      payload: "connection-one",
    });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("keeps bulk retry state open until the optimistic deletion is durable", async () => {
    const flush = deferred();
    mocks.flushPendingSave.mockImplementationOnce(() => flush.promise);
    const { result } = renderHook(() => useBulkConnectionEditor(true, vi.fn()));
    act(() => {
      result.current.toggleSelect("connection-one");
      result.current.toggleSelect("connection-two");
      result.current.setShowDeleteConfirm(true);
    });

    let deleting!: Promise<boolean>;
    act(() => {
      deleting = result.current.deleteSelected();
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(result.current.selectedIds.size).toBe(2);
    expect(result.current.showDeleteConfirm).toBe(true);

    await act(async () => {
      flush.resolve();
      await deleting;
    });
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.showDeleteConfirm).toBe(false);
  });

  it("retains bulk selection and confirmation when persistence fails", async () => {
    mocks.flushPendingSave.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useBulkConnectionEditor(true, vi.fn()));
    act(() => {
      result.current.toggleSelect("connection-one");
      result.current.setShowDeleteConfirm(true);
    });

    let persisted = true;
    await act(async () => {
      persisted = await result.current.deleteSelected();
    });

    expect(persisted).toBe(false);
    expect(result.current.selectedIds).toEqual(new Set(["connection-one"]));
    expect(result.current.showDeleteConfirm).toBe(true);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
