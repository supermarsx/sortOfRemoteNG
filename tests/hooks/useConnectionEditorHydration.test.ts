import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionEditor } from "../../src/hooks/connection/useConnectionEditor";
import type { Connection } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  close: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  settings: { autoSaveEnabled: false },
  state: { connections: [] },
  instances: [],
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: mocks.state, dispatchAndFlush: mocks.flush }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("../../src/hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => ({
    instances: mocks.instances,
    createInstance: mocks.createInstance,
    updateInstance: mocks.updateInstance,
  }),
}));

const connectionA: Connection = {
  id: "connection-a",
  name: "A",
  protocol: "rdp",
  hostname: "initial.example",
  port: 3389,
  isGroup: false,
  tags: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const connectionB: Connection = {
  ...connectionA,
  id: "connection-b",
  name: "B",
  hostname: "other.example",
};
type Props = { connection: Connection | undefined; open: boolean };
function editor(connection: Connection | undefined = connectionA) {
  const initialProps: Props = { connection, open: true };
  return renderHook(
    ({ connection, open }: Props) =>
      useConnectionEditor(connection, open, mocks.close),
    {
      initialProps,
    },
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Editor = ReturnType<typeof useConnectionEditor>;
function edit(result: { current: Editor }, hostname: string) {
  act(() => result.current.setFormData((draft) => ({ ...draft, hostname })));
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.settings.autoSaveEnabled = false;
  mocks.flush.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("connection editor draft ownership", () => {
  it("preserves a newer edit during a slow save and an optimistic same-ID echo", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    edit(result, "first.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, "newer.example");
    rerender({ connection: mocks.flush.mock.calls[0][0].payload, open: true });
    expect(result.current.formData.hostname).toBe("newer.example");
    let oldOutcome: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      oldOutcome = await first;
    });
    expect(oldOutcome).toBeNull();
    expect(result.current.formData.hostname).toBe("newer.example");
    let latest: Connection | null = null;
    await act(async () => {
      latest = await result.current.saveNow();
    });
    expect(latest).toMatchObject({
      id: connectionA.id,
      hostname: "newer.example",
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["first.example", "newer.example"]);
  });

  it("suppresses connection A's completion after switching to B", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    edit(result, "a-pending.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    rerender({ connection: connectionB, open: true });
    expect(result.current.formData).toMatchObject({
      id: connectionB.id,
      hostname: connectionB.hostname,
    });
    let outcome: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      outcome = await first;
    });
    expect(outcome).toBeNull();
    expect(result.current.formData.id).toBe(connectionB.id);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    edit(result, "b-current.example");
    await act(async () => {
      await result.current.saveNow();
    });
    expect(mocks.flush.mock.calls[1][0].payload).toMatchObject({
      id: connectionB.id,
      hostname: "b-current.example",
    });
  });

  it("rehydrates the latest same-ID prop only when the editor is reopened", () => {
    const { result, rerender } = editor();
    edit(result, "local-draft.example");
    const latest = { ...connectionA, hostname: "latest-stored.example" };
    rerender({ connection: latest, open: true });
    expect(result.current.formData.hostname).toBe("local-draft.example");
    rerender({ connection: latest, open: false });
    rerender({ connection: latest, open: true });
    expect(result.current.formData.hostname).toBe("latest-stored.example");
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("distinguishes a new form from a saved connection whose literal ID is new", () => {
    const { result, rerender } = editor({ ...connectionA, id: "new" });
    expect(result.current.formData.id).toBe("new");
    rerender({ connection: undefined, open: true });
    expect(result.current.formData.id).toBeUndefined();
    expect(result.current.formData.hostname).toBe("");
  });

  it("does not enqueue redundant same-revision autosaves after a live prop echo", async () => {
    mocks.settings.autoSaveEnabled = true;
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result, rerender } = editor();
    await advance(20);
    edit(result, "autosaved.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    rerender({ connection: mocks.flush.mock.calls[0][0].payload, open: true });
    await advance(1000);
    await act(async () => {
      flush.resolve();
    });
    await advance(4000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, "next-revision.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(mocks.flush.mock.calls[1][0].payload.hostname).toBe(
      "next-revision.example",
    );
  });

  it("autosaves reverting to the original value after another value was durably saved", async () => {
    mocks.settings.autoSaveEnabled = true;
    const { result } = editor();
    await advance(20);
    edit(result, "saved-intermediate.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, connectionA.hostname);
    await advance(1000);
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["saved-intermediate.example", connectionA.hostname]);
  });

  it("queues a revert while the intermediate autosave is still pending", async () => {
    mocks.settings.autoSaveEnabled = true;
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result } = editor();
    await advance(20);
    edit(result, "pending-intermediate.example");
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    edit(result, connectionA.hostname);
    await advance(1000);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    await act(async () => {
      flush.resolve();
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["pending-intermediate.example", connectionA.hostname]);
    expect(result.current.formData.hostname).toBe(connectionA.hostname);
  });

  it("does not return an apparently clean revert before an older manual save finishes", async () => {
    const flush = deferred();
    mocks.flush.mockImplementationOnce(() => flush.promise);
    const { result } = editor();
    edit(result, "pending-manual.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    edit(result, connectionA.hostname);
    let settled = false;
    let latest!: Promise<Connection | null>;
    await act(async () => {
      latest = result.current.saveNow().then((value) => {
        settled = true;
        return value;
      });
    });
    expect(settled).toBe(false);
    let outcomes!: Array<Connection | null>;
    await act(async () => {
      flush.resolve();
      outcomes = await Promise.all([first, latest]);
    });
    expect(outcomes[0]).toBeNull();
    expect(outcomes[1]).toMatchObject({
      id: connectionA.id,
      hostname: connectionA.hostname,
    });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual(["pending-manual.example", connectionA.hostname]);
  });

  it("keeps a failed reverted write retryable even when the form matches the initial baseline", async () => {
    const flush = deferred();
    mocks.flush
      .mockImplementationOnce(() => flush.promise)
      .mockRejectedValueOnce(new Error("Revert was not persisted"));
    const { result } = editor();
    edit(result, "intermediate-on-disk.example");
    let first!: Promise<Connection | null>;
    await act(async () => {
      first = result.current.saveNow();
    });
    edit(result, connectionA.hostname);
    let revert!: Promise<Connection | null>;
    await act(async () => {
      revert = result.current.saveNow();
    });
    let failed: Connection | null | undefined;
    await act(async () => {
      flush.resolve();
      await first;
      failed = await revert;
    });
    expect(failed).toBeNull();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Revert was not persisted"),
    );
    expect(result.current.formData.hostname).toBe(connectionA.hostname);
    let retry: Connection | null = null;
    await act(async () => {
      retry = await result.current.saveNow();
    });
    expect(retry).toMatchObject({ hostname: connectionA.hostname });
    expect(
      mocks.flush.mock.calls.map(([action]) => action.payload.hostname),
    ).toEqual([
      "intermediate-on-disk.example",
      connectionA.hostname,
      connectionA.hostname,
    ]);
  });
});
