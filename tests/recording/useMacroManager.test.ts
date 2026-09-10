import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useMacroManager,
  type MacroEntry,
} from "../../src/hooks/recording/useMacroManager";
import type {
  AutomationLibraryChange,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
const state = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  recordings: vi.fn(),
  saveRecording: vi.fn(),
  deleteRecording: vi.fn(),
  ready: true,
  settingsReady: true,
  accessEpoch: 1,
  databaseScope: { databaseId: "db-a", generation: 1 } as {
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
  loadRecordings: state.recordings,
  saveRecording: state.saveRecording,
  deleteRecording: state.deleteRecording,
  exportRecording: vi.fn().mockResolvedValue("recording"),
}));
const stamp = "2026-09-01T00:00:00.000Z";
const macro: MacroEntry = {
  family: "terminal-macro",
  payload: {
    id: "m1",
    name: "Identity",
    category: "Diagnostics",
    description: "Read identity",
    tags: ["identity"],
    steps: [{ command: "whoami", delayMs: 432, sendNewline: false }],
    createdAt: stamp,
    updatedAt: stamp,
  },
  provenance: { platforms: ["linux"] },
};
const website: MacroEntry = {
  family: "website-macro",
  payload: {
    id: "w1",
    kind: "macro",
    name: "Filter page",
    description: "Public filter",
    steps: [
      { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
      {
        kind: "check",
        selector: "html > body > input:nth-of-type(2)",
        checked: true,
      },
    ],
    createdAt: stamp,
    updatedAt: stamp,
  },
};
let libraries: Record<string, MacroEntry[]>;
const address = (scope: AutomationScope, family: string) =>
  `${scope.kind === "app" ? "app" : scope.databaseId}:${family}`;
beforeEach(() => {
  vi.clearAllMocks();
  state.ready = true;
  state.settingsReady = true;
  state.accessEpoch = 1;
  state.databaseScope = { databaseId: "db-a", generation: 1 };
  libraries = {
    "app:terminal-macro": [structuredClone(macro)],
    "app:website-macro": [structuredClone(website)],
    "db-a:terminal-macro": [],
    "db-a:website-macro": [],
  };
  state.read.mockImplementation(
    async (scope: AutomationScope, family: string) => ({
      scope,
      family,
      receipt: crypto.randomUUID(),
      entries: structuredClone(libraries[address(scope, family)] ?? []),
    }),
  );
  state.apply.mockImplementation(
    async (
      snapshot: AutomationLibrarySnapshot,
      changes: AutomationLibraryChange[],
    ) => {
      const next = new Map(
        snapshot.entries.map((entry) => [entry.payload.id, entry]),
      );
      for (const change of changes) {
        if (change.operation === "put")
          next.set(change.entry.payload.id, change.entry);
        else next.delete(change.expected.payload.id);
      }
      libraries[address(snapshot.scope, snapshot.family)] = [
        ...next.values(),
      ] as MacroEntry[];
      return {
        ...snapshot,
        receipt: crypto.randomUUID(),
        entries: [...next.values()],
      };
    },
  );
  state.recordings.mockResolvedValue([
    {
      id: "r1",
      name: "Session",
      savedAt: stamp,
      recording: {
        metadata: { host: "server.example", duration_ms: 10, entry_count: 1 },
        entries: [],
      },
    },
  ]);
  state.saveRecording.mockResolvedValue(undefined);
  state.deleteRecording.mockResolvedValue(undefined);
});
async function open() {
  const view = renderHook(() => useMacroManager(true));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

describe("scoped Macro Manager", () => {
  it("loads app-wide terminal macros and recordings independently", async () => {
    const { result } = await open();
    expect(result.current.entries).toEqual([macro]);
    expect(result.current.recordings).toHaveLength(1);
    expect(state.read).toHaveBeenCalledWith({ kind: "app" }, "terminal-macro");
  });
  it("does not read a closed manager or an unavailable access bridge", async () => {
    const view = renderHook(({ open }) => useMacroManager(open), {
      initialProps: { open: false },
    });
    expect(state.read).not.toHaveBeenCalled();
    state.ready = false;
    view.rerender({ open: true });
    expect(state.read).not.toHaveBeenCalled();
    await act(async () => {});
  });
  it("filters names, categories, platform metadata and tags with bounded pages", async () => {
    libraries["app:terminal-macro"] = Array.from({ length: 61 }, (_, i) => ({
      ...structuredClone(macro),
      payload: {
        ...macro.payload,
        id: `m${i}`,
        name: `Identity ${String(i).padStart(2, "0")}`,
      },
    }));
    const { result } = await open();
    expect(result.current.pagedEntries).toHaveLength(50);
    act(() => result.current.setPage(1));
    expect(result.current.pagedEntries).toHaveLength(11);
    act(() => result.current.setSearchQuery("linux"));
    expect(result.current.filteredEntries).toHaveLength(61);
    expect(result.current.page).toBe(0);
    act(() => result.current.setCategory("other"));
    expect(result.current.filteredEntries).toHaveLength(0);
    act(() => {
      result.current.setCategory("");
      result.current.setPlatform("windows");
    });
    expect(result.current.filteredEntries).toHaveLength(0);
  });
  it("preserves ordered commands, delay and sendNewline through durable save", async () => {
    const { result } = await open();
    act(() => result.current.selectEntry(result.current.entries[0]));
    act(() =>
      result.current.editEntry({
        ...macro,
        payload: { ...macro.payload, name: "Renamed" },
      }),
    );
    await act(async () => {
      expect(await result.current.saveEntry(result.current.draft!)).toBe(true);
    });
    expect(state.apply).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "app" } }),
      [
        expect.objectContaining({
          operation: "put",
          expected: macro,
          entry: expect.objectContaining({
            payload: expect.objectContaining({
              name: "Renamed",
              steps: macro.payload.steps,
            }),
            provenance: macro.provenance,
          }),
        }),
      ],
    );
    expect(result.current.draft).toBeNull();
  });
  it("creates and duplicates drafts without silently saving", async () => {
    const { result } = await open();
    act(() => result.current.handleNewMacro());
    expect(result.current.draft?.payload.name).toBe("New Macro");
    expect(state.apply).not.toHaveBeenCalled();
    act(() => result.current.closeDraft());
    act(() => result.current.confirmReview());
    act(() => result.current.duplicateEntry(result.current.entries[0]));
    expect(result.current.draft?.payload.id).not.toBe("m1");
    expect(result.current.draft?.payload.name).toContain("Copy");
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("requires a current explicit deletion review and refuses a canceled callback", async () => {
    const { result } = await open();
    act(() => result.current.deleteEntry(result.current.entries[0]));
    const stale = result.current.confirmReview;
    act(() => result.current.cancelReview());
    act(() => stale());
    expect(state.apply).not.toHaveBeenCalled();
    act(() => result.current.deleteEntry(result.current.entries[0]));
    await act(async () => result.current.confirmReview());
    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(state.apply).toHaveBeenCalledWith(expect.anything(), [
      { operation: "delete", expected: macro },
    ]);
  });
  it("refuses deleting a replacement imported during confirmation", async () => {
    const { result } = await open();
    act(() => result.current.deleteEntry(result.current.entries[0]));
    libraries["app:terminal-macro"][0].payload.name = "Replacement";
    await act(async () => result.current.confirmReview());
    await waitFor(() => expect(result.current.error).toMatch(/changed/));
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("requires discard before switching an unsaved draft to another family or scope", async () => {
    const { result } = await open();
    act(() => result.current.handleNewMacro());
    act(() => result.current.setActiveTab("website"));
    expect(result.current.activeTab).toBe("macros");
    act(() => result.current.cancelReview());
    expect(result.current.draft).not.toBeNull();
    act(() =>
      result.current.changeScope({ kind: "database", databaseId: "db-a" }),
    );
    expect(result.current.scope).toEqual({ kind: "app" });
    act(() => result.current.confirmReview());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scope).toEqual({
      kind: "database",
      databaseId: "db-a",
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.draft).toBeNull();
  });
  it("manages website macros as exact value-free interactions", async () => {
    const { result } = await open();
    act(() => result.current.setActiveTab("website"));
    await waitFor(() => expect(result.current.entries).toEqual([website]));
    act(() => result.current.selectEntry(result.current.entries[0]));
    await act(async () => {
      expect(await result.current.saveEntry(result.current.draft!)).toBe(true);
    });
    expect(state.apply.mock.calls[0][1][0].entry.payload.steps).toEqual(
      website.payload.steps,
    );
    expect(JSON.stringify(state.apply.mock.calls)).not.toContain('"value"');
  });
  it("does not let failed recordings loading block macros", async () => {
    state.recordings.mockRejectedValue(new Error("Recording backend failure"));
    const { result } = await open();
    expect(result.current.ready).toBe(true);
    expect(result.current.entries).toHaveLength(1);
    await waitFor(() =>
      expect(result.current.recordingError).toContain("separate"),
    );
  });
  it("preserves recording export/rename/delete and requires delete confirmation", async () => {
    const { result } = await open();
    await act(async () => {
      expect(
        await result.current.handleRenameRecording(
          result.current.recordings[0],
          "Renamed",
        ),
      ).toBe(true);
    });
    expect(state.saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed" }),
    );
    act(() => result.current.handleDeleteRecording("r1"));
    expect(state.deleteRecording).not.toHaveBeenCalled();
    await act(async () => result.current.confirmReview());
    expect(state.deleteRecording).toHaveBeenCalledWith("r1");
  });
});
