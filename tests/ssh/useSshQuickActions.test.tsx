import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { ConnectionAction } from "../../src/contexts/ConnectionContextTypes";
import type { DatabaseAutomationApi } from "../../src/types/recording/automationLibrary";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
const fixture = vi.hoisted(() => ({
  database: "db-a",
  accessible: true,
  settings: {} as Record<string, unknown>,
  connections: [] as Connection[],
  scripts: vi.fn(),
  macros: vi.fn(),
  flush: vi.fn(),
  save: vi.fn(),
  databaseLibrary: undefined as DatabaseAutomationApi | undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: fixture.connections },
    flushPendingSave: fixture.flush,
    dispatchAndFlush: fixture.save,
    automationLibrary: fixture.databaseLibrary,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: fixture.settings }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: fixture.database }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: fixture.database,
        assertAccessible: () => {
          if (!fixture.accessible) throw new Error("Fixture locked");
        },
      }),
      onCurrentDatabaseChange: () => () => {},
      onDatabaseAccessChange: () => () => {},
    }),
  },
}));
vi.mock("../../src/utils/recording/managedScriptPersistence", () => ({
  nativeManagedScriptsStore: { key: "scripts", load: fixture.scripts },
  resolveManagedScripts: (_defaults: unknown, value: unknown) => value,
}));
vi.mock("../../src/components/recording/scriptManager/shared", () => ({
  getDefaultScripts: () => [],
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadMacros: fixture.macros,
}));
const script = {
  id: "script-a",
  name: "Inspect",
  description: "Read only status",
  script: "not-executed-fixture",
};
const macro = {
  id: "macro-a",
  name: "Checklist",
  description: "Sequence",
  steps: [{ command: "not-executed-fixture" }],
};
const session: ConnectionSession = {
  id: "session-a",
  connectionId: "connection-a",
  protocol: "ssh",
  hostname: "fixture.example.test",
  name: "Fixture",
  startTime: new Date(0),
  status: "connected",
  ownerDatabaseId: "db-a",
};
const connection = (): Connection => ({
  id: "connection-a",
  protocol: "ssh",
  name: "Fixture",
  hostname: "fixture.example.test",
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sshQuickActions: { version: 1, items: [{ kind: "script", id: "script-a" }] },
});
const setup = (
  overrides: Partial<Parameters<typeof useSshQuickActions>[0]> = {},
) => {
  const actor = vi.fn();
  const options = {
    session,
    ready: true,
    captureSession: () => actor,
    runScript: vi.fn(),
    replayMacro: vi.fn(),
    ...overrides,
  };
  return { ...renderHook(() => useSshQuickActions(options)), options, actor };
};
beforeEach(() => {
  fixture.database = "db-a";
  fixture.accessible = true;
  fixture.settings = {};
  fixture.connections = [connection()];
  fixture.databaseLibrary = undefined;
  fixture.scripts.mockReset().mockResolvedValue({ value: [script] });
  fixture.macros.mockReset().mockResolvedValue([macro]);
  fixture.flush.mockReset().mockResolvedValue(undefined);
  fixture.save
    .mockReset()
    .mockImplementation(async (action: ConnectionAction) => {
      if (action.type === "UPDATE_CONNECTION")
        fixture.connections = [action.payload];
    });
});
describe("SSH connection favorites", () => {
  it("keeps identical app/database favorites separate, refreshes durable DB changes, and never falls back", async () => {
    const db = emptyDatabaseAutomationLibrary();
    db.terminalScripts.customScripts = [
      {
        ...script,
        name: "DB Inspect",
        script: "db-fixture",
        language: "sh",
        osTags: ["linux"],
        category: "System",
        createdAt: "2026-09-10",
        updatedAt: "2026-09-10",
      },
    ];
    fixture.databaseLibrary = {
      scope: { databaseId: "db-a", generation: 1 },
      changeRevision: 0,
      read: vi.fn(async () => structuredClone(db)),
      compareAndSwap: vi.fn(),
    };
    const ref = {
      kind: "script" as const,
      id: script.id,
      scope: { kind: "database" as const, databaseId: "db-a" },
    };
    const view = setup();
    await waitFor(() =>
      expect(
        view.result.current.available.some(
          (item) => item.name === "DB Inspect",
        ),
      ).toBe(true),
    );
    await act(() => view.result.current.add(ref));
    view.rerender();
    expect(fixture.connections[0].sshQuickActions!.items).toHaveLength(2);
    await act(() => view.result.current.run(ref));
    expect(view.options.runScript).toHaveBeenCalledWith(
      expect.objectContaining({ script: "db-fixture" }),
      expect.any(Function),
    );
    db.terminalScripts.customScripts[0].name = "DB Changed";
    fixture.databaseLibrary.changeRevision = 1;
    view.rerender();
    await waitFor(() =>
      expect(view.result.current.favorites[1].name).toBe("DB Changed"),
    );
    db.terminalScripts.customScripts = [];
    vi.mocked(view.options.runScript).mockClear();
    await act(() => view.result.current.run(ref));
    expect(view.options.runScript).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("No substitute");
  });
  it("revalidates a reviewed app item after confirmation and refuses edits or deletion", async () => {
    let checked = false;
    const runScript = vi.fn(async (_script, assertReviewed) => {
      fixture.scripts.mockResolvedValue({
        value: [{ ...script, script: "changed-after-review" }],
      });
      await assertReviewed();
      checked = true;
    });
    const view = setup({ runScript });
    await waitFor(() =>
      expect(view.result.current.favorites[0]?.missing).toBe(false),
    );
    await act(() => view.result.current.run({ kind: "script", id: script.id }));
    expect(checked).toBe(false);
    expect(view.result.current.error).toContain(
      "reviewed library entry changed",
    );
  });
  it("refuses a foreign database reference despite identical current DB/app IDs", async () => {
    fixture.connections[0].sshQuickActions!.items = [
      {
        kind: "script",
        id: script.id,
        scope: { kind: "database", databaseId: "other" },
      },
    ];
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.favorites[0].missing).toBe(true);
    await act(() =>
      view.result.current.run(fixture.connections[0].sshQuickActions!.items[0]),
    );
    expect(view.options.runScript).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("No app-wide substitute");
  });
  it("loads metadata only, searches libraries, and never runs on load or add", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.result.current.favorites[0]?.name).toBe("Inspect"),
    );
    expect(view.result.current.favorites[0]).not.toHaveProperty("script");
    act(() => view.result.current.setQuery("check"));
    expect(view.result.current.available.map((item) => item.id)).toEqual([
      "macro-a",
    ]);
    await act(() => view.result.current.add({ kind: "macro", id: "macro-a" }));
    expect(fixture.save).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          sshQuickActions: {
            version: 1,
            items: [
              { kind: "script", id: "script-a" },
              { kind: "macro", id: "macro-a" },
            ],
          },
        }),
      }),
    );
    expect(view.options.runScript).not.toHaveBeenCalled();
    expect(view.options.replayMacro).not.toHaveBeenCalled();
  });
  it("keeps a durable mutation busy until its save completes and supports reorder/remove without library deletion", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let complete!: () => void;
    fixture.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    let saving!: Promise<void>;
    act(() => {
      saving = view.result.current.add({ kind: "macro", id: "macro-a" });
    });
    await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
    expect(view.result.current.busy).toBe(true);
    await act(async () => {
      complete();
      await saving;
    });
    fixture.connections = [
      {
        ...connection(),
        sshQuickActions: {
          version: 1,
          items: [
            { kind: "script", id: "script-a" },
            { kind: "macro", id: "macro-a" },
          ],
        },
      },
    ];
    view.rerender();
    await act(() =>
      view.result.current.move({ kind: "macro", id: "macro-a" }, -1),
    );
    expect(fixture.connections[0].sshQuickActions?.items[0].id).toBe("macro-a");
    await act(() =>
      view.result.current.remove({ kind: "script", id: "script-a" }),
    );
    expect(fixture.connections[0].sshQuickActions?.items).toEqual([
      { kind: "macro", id: "macro-a" },
    ]);
  });
  it("loads a fresh library entry only on explicit run", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.result.current.favorites[0]?.missing).toBe(false),
    );
    fixture.scripts.mockResolvedValue({
      value: [{ ...script, script: "fresh-fixture" }],
    });
    await act(() =>
      view.result.current.run({ kind: "script", id: "script-a" }),
    );
    expect(view.options.runScript).toHaveBeenCalledWith(
      expect.objectContaining({ script: "fresh-fixture" }),
      expect.any(Function),
    );
    expect(view.actor).toHaveBeenCalledOnce();
  });
  it.each(["different database", "unknown owner", "locked"])(
    "refuses %s even if a same-ID connection exists",
    async (reason) => {
      if (reason === "different database") fixture.database = "db-b";
      if (reason === "locked") fixture.accessible = false;
      const view = setup({
        session:
          reason === "unknown owner"
            ? { ...session, ownerDatabaseId: undefined }
            : session,
      });
      await waitFor(() => expect(view.result.current.unavailable).toBeTruthy());
      await act(() =>
        view.result.current.run({ kind: "script", id: "script-a" }),
      );
      expect(view.options.runScript).not.toHaveBeenCalled();
      expect(fixture.save).not.toHaveBeenCalled();
    },
  );
  it("refuses a late library result after lock without executing", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.result.current.favorites[0]?.missing).toBe(false),
    );
    let finish!: (value: { value: (typeof script)[] }) => void;
    fixture.scripts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let running!: Promise<void>;
    act(() => {
      running = view.result.current.run({ kind: "script", id: "script-a" });
    });
    fixture.accessible = false;
    await act(async () => {
      finish({ value: [script] });
      await running;
    });
    expect(view.options.runScript).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("locked");
  });
  it("fails closed for malformed optional config and disabled global controls", async () => {
    fixture.connections[0].sshQuickActions = {
      version: 4,
      items: [],
    } as unknown as Connection["sshQuickActions"];
    const view = setup();
    await waitFor(() => expect(view.result.current.unavailable).toBeTruthy());
    view.unmount();
    fixture.settings = { sessionQuickActions: { sshEnabled: false } };
    const disabled = setup();
    expect(disabled.result.current.enabled).toBe(false);
    await act(() =>
      disabled.result.current.run({ kind: "script", id: "script-a" }),
    );
    expect(disabled.options.runScript).not.toHaveBeenCalled();
  });
});
