import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMacroManager } from "../../src/hooks/recording/useMacroManager";
const state = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  ready: true,
  settingsReady: true,
  accessEpoch: 1,
  databaseScope: { databaseId: "a", generation: 1 } as {
    databaseId: string;
    generation: number;
  } | null,
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    ...state,
    api: { read: state.read, apply: state.apply },
    diagnostic: null,
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadRecordings: vi.fn().mockResolvedValue([]),
}));
const entry = {
  family: "terminal-macro" as const,
  payload: {
    id: "kept",
    name: "Kept",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    steps: [{ command: "pwd", delayMs: 12, sendNewline: false }],
  },
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  state.ready = true;
  state.settingsReady = true;
  state.accessEpoch = 1;
  state.databaseScope = { databaseId: "a", generation: 1 };
  state.read.mockImplementation(async (scope, family) => ({
    scope,
    family,
    receipt: "review",
    entries: [structuredClone(entry)],
  }));
  state.apply.mockImplementation(async (snapshot) => snapshot);
});
async function open() {
  const view = renderHook(() => useMacroManager(true));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}
describe("macro scope and durable-write fences", () => {
  it("retains a failed-save draft and never claims success before durable apply", async () => {
    const view = await open();
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    state.apply.mockRejectedValueOnce(new Error("Locked fixture"));
    await act(async () => {
      expect(
        await view.result.current.saveEntry(view.result.current.draft!),
      ).toBe(false);
    });
    expect(view.result.current.draft?.payload.id).toBe("kept");
    expect(view.result.current.error).toContain("draft was retained");
    const gate = deferred<any>();
    state.apply.mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.saveEntry(view.result.current.draft!);
    });
    await waitFor(() => expect(view.result.current.busy).toBe(true));
    expect(view.result.current.draft).not.toBeNull();
    await act(async () => {
      gate.resolve({
        scope: { kind: "app" },
        family: "terminal-macro",
        receipt: "saved",
        entries: [entry],
      });
      expect(await pending).toBe(true);
    });
    expect(view.result.current.draft).toBeNull();
  });
  it("rejects a stale edited base after sync instead of overwriting it", async () => {
    const view = await open();
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    state.read.mockResolvedValueOnce({
      scope: { kind: "app" },
      family: "terminal-macro",
      receipt: "new",
      entries: [
        { ...entry, payload: { ...entry.payload, name: "Changed elsewhere" } },
      ],
    });
    await act(async () =>
      view.result.current.saveEntry(view.result.current.draft!),
    );
    expect(state.apply).not.toHaveBeenCalled();
    expect(view.result.current.draft).not.toBeNull();
  });
  it("synchronously masks private state on owning database lock and invalidates retained confirmation", async () => {
    const view = await open();
    act(() =>
      view.result.current.changeScope({ kind: "database", databaseId: "a" }),
    );
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    act(() => view.result.current.deleteEntry(view.result.current.entries[0]));
    const oldConfirm = view.result.current.confirmReview;
    state.databaseScope = null;
    view.rerender();
    expect(view.result.current.entries).toEqual([]);
    expect(view.result.current.draft).toBeNull();
    expect(view.result.current.review).toBeNull();
    state.databaseScope = { databaseId: "a", generation: 2 };
    view.rerender();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    act(() => oldConfirm());
    expect(state.apply).not.toHaveBeenCalled();
    expect(view.result.current.draft).toBeNull();
  });
  it("invalidates app drafts on global lock epoch, not on unrelated database switching", async () => {
    const view = await open();
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    state.databaseScope = { databaseId: "b", generation: 9 };
    view.rerender();
    expect(view.result.current.draft).not.toBeNull();
    state.accessEpoch++;
    view.rerender();
    expect(view.result.current.draft).toBeNull();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
  });
  it("blocks a save if the owner changes during the fresh snapshot read", async () => {
    const view = await open();
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    const gate = deferred<any>();
    state.read.mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.saveEntry(view.result.current.draft!);
    });
    state.accessEpoch++;
    view.rerender();
    await act(async () => {
      gate.resolve({
        scope: { kind: "app" },
        family: "terminal-macro",
        receipt: "old",
        entries: [entry],
      });
      expect(await pending).toBe(false);
    });
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("rejects rapid double save before a render", async () => {
    const view = await open();
    act(() => view.result.current.selectEntry(view.result.current.entries[0]));
    const draft = view.result.current.draft!;
    await act(async () => {
      const first = view.result.current.saveEntry(draft);
      expect(await view.result.current.saveEntry(draft)).toBe(false);
      await first;
    });
    expect(state.apply).toHaveBeenCalledTimes(1);
  });
});
