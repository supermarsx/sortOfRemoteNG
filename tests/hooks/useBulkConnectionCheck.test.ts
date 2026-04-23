import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import type { CheckProgressEvent, CheckCompleteEvent } from "../../src/types/probes";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  transformCallback: vi.fn(),
  Channel: vi.fn(),
}));

// Capture listener callbacks so tests can drive them synchronously.
type Handler = (evt: { payload: unknown }) => void;
const listeners: Record<string, Handler[]> = {};
const unlistenSpies: Array<ReturnType<typeof vi.fn>> = [];

const listenMock = vi.fn(async (event: string, cb: Handler) => {
  (listeners[event] ??= []).push(cb);
  const unlisten = vi.fn(() => {
    listeners[event] = (listeners[event] ?? []).filter((h) => h !== cb);
  });
  unlistenSpies.push(unlisten);
  return unlisten;
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Handler) => listenMock(event, cb),
  emit: vi.fn(),
}));

import { useBulkConnectionCheck } from "../../src/hooks/connection/useBulkConnectionCheck";

const connections: Connection[] = [
  {
    id: "c1",
    name: "Alpha",
    protocol: "ssh",
    hostname: "alpha.local",
    port: 22,
    username: "root",
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "c2",
    name: "Beta",
    protocol: "rdp",
    hostname: "beta.local",
    port: 3389,
    username: "administrator",
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function fireProgress(payload: CheckProgressEvent) {
  for (const h of listeners["connection-check-progress"] ?? []) {
    h({ payload });
  }
}

function fireComplete(payload: CheckCompleteEvent) {
  for (const h of listeners["connection-check-complete"] ?? []) {
    h({ payload });
  }
}

describe("useBulkConnectionCheck", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockClear();
    unlistenSpies.length = 0;
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it("open() opens the modal, seeds pending rows, and calls check_all_connections", async () => {
    invokeMock.mockResolvedValueOnce("run-xyz");

    const { result } = renderHook(() => useBulkConnectionCheck());

    await act(async () => {
      await result.current.open(connections);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.total).toBe(2);
    expect(result.current.rows.map((r) => r.state)).toEqual(["pending", "pending"]);

    expect(invokeMock).toHaveBeenCalledWith("check_all_connections", {
      connectionIds: [
        { connection_id: "c1", host: "alpha.local", port: 22, protocol: "ssh" },
        { connection_id: "c2", host: "beta.local", port: 3389, protocol: "rdp" },
      ],
      concurrency: 8,
      timeoutMs: 5000,
    });

    await waitFor(() => expect(result.current.runId).toBe("run-xyz"));
  });

  it("connection-check-progress updates the matching row to done", async () => {
    invokeMock.mockResolvedValueOnce("run-1");
    const { result } = renderHook(() => useBulkConnectionCheck());
    await act(async () => {
      await result.current.open(connections);
    });
    await waitFor(() => expect(result.current.runId).toBe("run-1"));

    act(() => {
      fireProgress({
        run_id: "run-1",
        connection_id: "c1",
        index: 0,
        total: 2,
        elapsed_ms: 42,
        result: { kind: "tcp", status: { status: "reachable" }, elapsed_ms: 42 },
      });
    });

    const c1Row = result.current.rows.find((r) => r.connectionId === "c1")!;
    expect(c1Row.state).toBe("done");
    expect(c1Row.elapsedMs).toBe(42);
    expect(result.current.completed).toBe(1);

    // Mismatched run_id is ignored.
    act(() => {
      fireProgress({
        run_id: "other",
        connection_id: "c2",
        index: 1,
        total: 2,
        elapsed_ms: 1,
        result: { kind: "tcp", status: { status: "reachable" }, elapsed_ms: 1 },
      });
    });
    const c2Row = result.current.rows.find((r) => r.connectionId === "c2")!;
    expect(c2Row.state).toBe("pending");
    expect(result.current.completed).toBe(1);
  });

  it("connection-check-complete with cancelled=true sets the cancelled flag", async () => {
    invokeMock.mockResolvedValueOnce("run-2");
    const { result } = renderHook(() => useBulkConnectionCheck());
    await act(async () => {
      await result.current.open(connections);
    });
    await waitFor(() => expect(result.current.runId).toBe("run-2"));

    act(() => {
      fireComplete({ run_id: "run-2", total: 2, completed: 0, cancelled: true });
    });

    expect(result.current.cancelled).toBe(true);
  });

  it("cancel() invokes cancel_check_run with the current runId", async () => {
    invokeMock.mockResolvedValueOnce("run-3"); // for open → check_all_connections
    invokeMock.mockResolvedValueOnce(undefined); // for cancel → cancel_check_run

    const { result } = renderHook(() => useBulkConnectionCheck());
    await act(async () => {
      await result.current.open(connections);
    });
    await waitFor(() => expect(result.current.runId).toBe("run-3"));

    await act(async () => {
      await result.current.cancel();
    });

    expect(invokeMock).toHaveBeenCalledWith("cancel_check_run", { runId: "run-3" });
    expect(result.current.cancelled).toBe(true);
  });

  it("close() clears state and tears down listeners (unlisten called)", async () => {
    invokeMock.mockResolvedValueOnce("run-4");
    const { result } = renderHook(() => useBulkConnectionCheck());
    await act(async () => {
      await result.current.open(connections);
    });
    await waitFor(() => expect(result.current.runId).toBe("run-4"));

    expect(unlistenSpies.length).toBeGreaterThanOrEqual(2);

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.runId).toBeNull();
    expect(result.current.total).toBe(0);
    expect(result.current.completed).toBe(0);

    for (const un of unlistenSpies) {
      expect(un).toHaveBeenCalled();
    }
  });
});
