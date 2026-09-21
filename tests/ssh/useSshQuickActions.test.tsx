import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { ConnectionAction } from "../../src/contexts/ConnectionContextTypes";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
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
  availability: {
    status: "ready",
    databaseId: "db-a",
    generation: 1,
  } as DatabaseAvailability,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: fixture.connections },
    flushPendingSave: fixture.flush,
    dispatchAndFlush: fixture.save,
    automationLibrary: fixture.databaseLibrary,
    databaseAvailability: fixture.availability,
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
  return {
    ...renderHook(
      (props: typeof options | undefined) =>
        useSshQuickActions(props ?? options),
      { initialProps: options as typeof options | undefined },
    ),
    options,
    actor,
  };
};
beforeEach(() => {
  fixture.database = "db-a";
  fixture.accessible = true;
  fixture.settings = {};
  fixture.connections = [connection()];
  fixture.availability = {
    status: "ready",
    databaseId: "db-a",
    generation: 1,
  };
  fixture.databaseLibrary = {
    scope: { databaseId: "db-a", generation: 1 },
    changeRevision: 0,
    read: vi.fn(async () => emptyDatabaseAutomationLibrary()),
    readSsh: vi.fn(async () => emptyDatabaseAutomationLibrary()),
    compareAndSwap: vi.fn(),
  };
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
  it("fails closed when read-only refresh is unavailable instead of flushing through the legacy reader", async () => {
    delete fixture.databaseLibrary!.readSsh;
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toContain("backend-unavailable");
    expect(fixture.databaseLibrary!.read).not.toHaveBeenCalled();
    expect(fixture.flush).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(view.result.current.available).toEqual([]);
  });

  it("does not substitute legacy reads or app-wide favorites when the exact-owner refresh fails", async () => {
    vi.mocked(fixture.databaseLibrary!.readSsh!).mockRejectedValue(
      new Error("The owning database changed"),
    );
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toContain(
      "Owning database actions (conflict)",
    );
    expect(fixture.databaseLibrary!.read).not.toHaveBeenCalled();
    expect(fixture.flush).not.toHaveBeenCalled();
    expect(view.result.current.available).toEqual([]);
    await act(() => view.result.current.run({ kind: "script", id: script.id }));
    expect(view.options.runScript).not.toHaveBeenCalled();
  });

  it("loads the action library only when availability and API scope match the exact owner", async () => {
    const read = vi.mocked(fixture.databaseLibrary!.readSsh!);
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledWith(
      { databaseId: "db-a", generation: 1 },
      "connection-a",
    );
    expect(fixture.databaseLibrary!.read).not.toHaveBeenCalled();
    expect(view.result.current.unavailable).toBeNull();
    expect(view.result.current.error).toBeNull();
  });

  it("reports matching owner reloads as loading and resumes without a false conflict", async () => {
    const read = vi.mocked(fixture.databaseLibrary!.readSsh!);
    fixture.availability = {
      status: "loading",
      databaseId: "db-a",
      generation: 2,
    };
    fixture.databaseLibrary!.scope = null;
    const view = setup();
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.unavailable).toBeNull();
    expect(view.result.current.error).toBeNull();
    expect(read).not.toHaveBeenCalled();

    act(() => {
      fixture.availability = {
        status: "ready",
        databaseId: "db-a",
        generation: 3,
      };
      fixture.databaseLibrary!.scope = {
        databaseId: "db-a",
        generation: 2,
      };
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledWith(
      { databaseId: "db-a", generation: 2 },
      "connection-a",
    );
    expect(view.result.current.unavailable).toBeNull();
    expect(view.result.current.error).toBeNull();
  });

  it("fails closed when provider availability belongs to another database", async () => {
    const read = vi.mocked(fixture.databaseLibrary!.readSsh!);
    fixture.availability = {
      status: "ready",
      databaseId: "db-b",
      generation: 2,
    };
    fixture.databaseLibrary!.scope = { databaseId: "db-b", generation: 2 };
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.unavailable).toContain(
      "Owning database actions (conflict)",
    );
    expect(view.result.current.unavailable).toContain(
      "No app-wide substitute was used",
    );
    expect(read).not.toHaveBeenCalled();
    expect(view.result.current.available).toEqual([]);
  });

  it("fails closed while the matching owner is suspended and recovers after unlock", async () => {
    const read = vi.mocked(fixture.databaseLibrary!.readSsh!);
    fixture.availability = {
      status: "suspended",
      databaseId: "db-a",
      generation: 2,
    };
    fixture.databaseLibrary!.scope = null;
    const view = setup();
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.unavailable).toContain(
      "Owning database actions (locked)",
    );
    expect(read).not.toHaveBeenCalled();

    act(() => {
      fixture.availability = {
        status: "ready",
        databaseId: "db-a",
        generation: 3,
      };
      fixture.databaseLibrary!.scope = {
        databaseId: "db-a",
        generation: 2,
      };
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledOnce();
    expect(view.result.current.unavailable).toBeNull();
    expect(view.result.current.error).toBeNull();
  });

  it("retires a stale read across availability and session identity rerenders without retaining conflict", async () => {
    let finish!: (
      value: ReturnType<typeof emptyDatabaseAutomationLibrary>,
    ) => void;
    const first = new Promise<
      ReturnType<typeof emptyDatabaseAutomationLibrary>
    >((resolve) => {
      finish = resolve;
    });
    const read = vi
      .mocked(fixture.databaseLibrary!.readSsh!)
      .mockImplementationOnce(async () => first)
      .mockResolvedValue(emptyDatabaseAutomationLibrary());
    fixture.connections = [
      connection(),
      { ...connection(), id: "connection-b", name: "Redirected identity" },
    ];
    const view = setup();
    await waitFor(() => expect(read).toHaveBeenCalledOnce());

    act(() => {
      fixture.availability = {
        status: "ready",
        databaseId: "db-a",
        generation: 2,
      };
      view.rerender({
        ...view.options,
        session: {
          ...session,
          connectionId: "connection-b",
          name: "Redirected identity",
        },
      });
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.unavailable).toBeNull();

    await act(async () => {
      finish(emptyDatabaseAutomationLibrary());
      await first;
    });
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.unavailable).toBeNull();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("names a failed database library without telling the user to unlock app-wide encryption", async () => {
    fixture.databaseLibrary = {
      scope: { databaseId: "db-a", generation: 1 },
      changeRevision: 0,
      read: vi.fn().mockRejectedValue("Database key unavailable SECRET_PATH"),
      readSsh: vi
        .fn()
        .mockRejectedValue("Database key unavailable SECRET_PATH"),
      compareAndSwap: vi.fn(),
    };
    const view = setup();
    await waitFor(() =>
      expect(view.result.current.error).toContain("Owning database actions"),
    );
    expect(view.result.current.error).toContain("owning database");
    expect(view.result.current.error).not.toContain("Unlock app encryption");
    expect(view.result.current.error).not.toContain("SECRET_PATH");
    expect(view.options.runScript).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("retains the source failure during retry until all libraries are confirmed reloaded", async () => {
    fixture.scripts.mockRejectedValueOnce("Unknown command read_app_data");
    const view = setup();
    await waitFor(() =>
      expect(view.result.current.error).toContain(
        "App-wide scripts (backend-unavailable)",
      ),
    );
    const message = view.result.current.error;
    let finish!: (value: { value: (typeof script)[] }) => void;
    fixture.scripts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let retry!: Promise<void>;
    act(() => {
      retry = view.result.current.refresh();
    });
    expect(view.result.current.error).toBe(message);
    expect(view.result.current.loading).toBe(true);
    await act(async () => {
      finish({ value: [script] });
      await retry;
    });
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.favorites[0].missing).toBe(false);
  });

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
      readSsh: vi.fn(async () => structuredClone(db)),
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
    await waitFor(() => expect(finish).toBeTypeOf("function"));
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
