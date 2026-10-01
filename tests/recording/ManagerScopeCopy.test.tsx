import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptManager } from "../../src/components/recording/ScriptManager";
import { MacroManager } from "../../src/components/recording/MacroManager";
import { createAutomationLibraryApi } from "../../src/utils/recording/automationLibrary";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import { defaultScripts } from "../../src/data/defaultScripts";
import { bundledMacroCatalog } from "../../src/data/bundledMacroCatalog";
import type {
  AutomationEntry,
  AutomationLibraryApi,
  DatabaseAutomationApi,
  DatabaseAutomationLibrary,
} from "../../src/types/recording/automationLibrary";

const h = vi.hoisted(() => ({
  api: null as unknown as AutomationLibraryApi,
  invoke: vi.fn(),
  raw: new Map<string, string>(),
  databaseScope: { databaseId: "a", generation: 1 } as {
    databaseId: string;
    generation: number;
  } | null,
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    api: h.api,
    ready: true,
    settingsReady: true,
    accessEpoch: 1,
    databaseRevision: 0,
    databaseScope: h.databaseScope,
    diagnostic: null,
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadRecordings: vi.fn().mockResolvedValue([]),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [], sessions: [] },
    dispatch: vi.fn(),
  }),
}));
vi.mock(
  "../../src/components/recording/scriptManager/WebsiteUserScriptsPanel",
  () => ({
    default: () => null,
  }),
);
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: () => null,
}));

const script: AutomationEntry<"terminal-script"> = {
  family: "terminal-script",
  payload: {
    ...defaultScripts[0],
    id: "migrated-script",
    name: "Migrated script",
  },
  provenance: { sourceId: "original-library", platforms: ["linux"] },
};
const macro: AutomationEntry<"terminal-macro"> = {
  ...bundledMacroCatalog[0],
  payload: {
    ...bundledMacroCatalog[0].payload,
    id: "migrated-macro",
    name: "Migrated macro",
  },
};
let library: DatabaseAutomationLibrary;
let database: DatabaseAutomationApi;
beforeEach(async () => {
  vi.clearAllMocks();
  h.raw.clear();
  localStorage.clear();
  h.databaseScope = { databaseId: "a", generation: 1 };
  library = emptyDatabaseAutomationLibrary();
  library.terminalScripts.customScripts = [structuredClone(script.payload)];
  library.terminalMacros = [structuredClone(macro.payload)];
  library.provenance = {
    [`terminal-script:${script.payload.id}`]: script.provenance!,
    [`terminal-macro:${macro.payload.id}`]: macro.provenance!,
  };
  library.terminalLibraryMigration = {
    version: 1,
    id: "historical-receipt",
    databaseId: "a",
    scriptsDigest: "a".repeat(64),
    macrosDigest: "b".repeat(64),
  };
  database = {
    get scope() {
      return h.databaseScope;
    },
    read: vi.fn(async () => structuredClone(library)),
    compareAndSwap: vi.fn(async (_scope, expected, replacement) => {
      expect(expected).toEqual(library);
      library = structuredClone(replacement);
    }),
  };
  // Existing app entries deliberately share the migrated IDs. Copying must
  // append independently, preserving both these entries and the DB originals.
  h.raw.set(
    "recording.managed-scripts",
    JSON.stringify({
      customScripts: [{ ...script.payload, name: "Existing app script" }],
      modifiedDefaults: [],
      deletedDefaultIds: [],
      databaseMigration: library.terminalLibraryMigration,
    }),
  );
  h.raw.set(
    "recording.terminal-macros",
    JSON.stringify({
      version: 1,
      legacyDigest: null,
      macros: [{ ...macro.payload, name: "Existing app macro" }],
      databaseMigration: library.terminalLibraryMigration,
    }),
  );
  h.invoke.mockImplementation(
    async (
      command: string,
      args: { key: string; expected: string | null; replacement: string },
    ) => {
      if (command === "read_macro_library" || command === "read_app_data")
        return h.raw.get(args.key) ?? null;
      if (
        command === "compare_and_swap_macro_library" ||
        command === "compare_and_swap_app_data"
      ) {
        if ((h.raw.get(args.key) ?? null) !== args.expected) return false;
        h.raw.set(args.key, args.replacement);
        return true;
      }
      throw new Error(`Unexpected fixture command: ${command}`);
    },
  );
  h.api = createAutomationLibraryApi(() => database);
  // Seed the native stores' canonical serialization and record metadata before
  // measuring manager actions; storage metadata upgrades are independent of
  // cross-scope copying.
  await h.api.read({ kind: "app" }, "terminal-script");
  await h.api.read({ kind: "app" }, "terminal-macro");
  h.invoke.mockClear();
});

describe.each([
  {
    kind: "Script",
    Component: ScriptManager,
    entry: script,
    existing: "Existing app script",
  },
  {
    kind: "Macro",
    Component: MacroManager,
    entry: macro,
    existing: "Existing app macro",
  },
])("$kind Manager Copy to scope", ({ kind, Component, entry, existing }) => {
  async function openDatabase() {
    const view = render(<Component isOpen onClose={vi.fn()} />);
    await screen.findByText(existing);
    expect(
      screen.getByRole("combobox", { name: `${kind} library scope` }),
    ).toHaveTextContent(/^App-wide$/);
    fireEvent.click(
      screen.getByRole("combobox", { name: `${kind} library scope` }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Current database" }),
    );
    fireEvent.click(await screen.findByText(entry.payload.name));
    return view;
  }
  const writes = () =>
    h.invoke.mock.calls.filter(([command]) =>
      command.startsWith("compare_and_swap"),
    );

  it("copies migrated DB data to App-wide only after confirmation and keeps both originals", async () => {
    const before = structuredClone(library);
    const appBefore = await h.api.read({ kind: "app" }, entry.family);
    const view = await openDatabase();
    expect(writes()).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: App-wide" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "original and existing destination entries will be kept",
    );
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: `${kind} library scope` }),
      ).toBeEnabled(),
    );
    expect(database.compareAndSwap).not.toHaveBeenCalled();
    expect(library).toEqual(before);
    const copied = (await h.api.read({ kind: "app" }, entry.family)).entries;
    expect(copied).toHaveLength(2);
    expect(copied).toContainEqual(appBefore.entries[0]);
    const restored = copied.find(
      (item) => item.payload.id !== entry.payload.id,
    )!;
    expect(restored.payload.id).not.toBe(entry.payload.id);
    expect(restored).toEqual({
      ...entry,
      payload: {
        ...entry.payload,
        id: restored.payload.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    fireEvent.click(
      screen.getByRole("combobox", { name: `${kind} library scope` }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "App-wide" }));
    await screen.findByText(existing);
    expect(screen.getByText(entry.payload.name)).toBeInTheDocument();
    view.unmount();
    render(<Component isOpen onClose={vi.fn()} />);
    await screen.findByText(entry.payload.name);
    expect(writes()).toHaveLength(1);
  });

  it("rejects a changed source after review without writing either library", async () => {
    await openDatabase();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: App-wide" }),
    );
    if (entry.family === "terminal-script")
      library.terminalScripts.customScripts[0].script = "echo changed";
    else library.terminalMacros[0].steps[0].command = "echo changed";
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("alert");
    expect(writes()).toEqual([]);
    expect(database.compareAndSwap).not.toHaveBeenCalled();
  });

  it("keeps existing App-wide content when the destination changes during copy review", async () => {
    await openDatabase();
    const apply = h.api.apply.bind(h.api);
    vi.spyOn(h.api, "apply").mockImplementationOnce(
      async (reviewed, changes) => {
        const concurrent = await h.api.read(reviewed.scope, reviewed.family);
        const previous = concurrent.entries[0];
        const changed = structuredClone(previous);
        changed.payload.name = "Concurrent app edit";
        await apply(concurrent, [
          {
            operation: "put",
            expected: previous,
            entry: changed,
          },
        ]);
        return apply(reviewed, changes);
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: App-wide" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("alert");
    const app = await h.api.read({ kind: "app" }, entry.family);
    expect(app.entries).toHaveLength(1);
    expect(app.entries[0].payload.name).toBe("Concurrent app edit");
    expect(database.compareAndSwap).not.toHaveBeenCalled();
  });

  it("also permits an explicit App-wide copy to the current database without replacing its entries", async () => {
    render(<Component isOpen onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText(existing));
    const before = structuredClone(library);
    const appBefore = await h.api.read({ kind: "app" }, entry.family);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: Current database" }),
    );
    expect(database.compareAndSwap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(database.compareAndSwap).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: `${kind} library scope` }),
      ).toBeEnabled(),
    );
    const saved = await h.api.read(
      { kind: "database", databaseId: "a" },
      entry.family,
    );
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries).toContainEqual(entry);
    expect(
      saved.entries.find((item) => item.payload.name === existing)?.payload.id,
    ).not.toBe(entry.payload.id);
    expect(library.terminalLibraryMigration).toEqual(
      before.terminalLibraryMigration,
    );
    expect((await h.api.read({ kind: "app" }, entry.family)).entries).toEqual(
      appBefore.entries,
    );
    expect(writes()).toEqual([]);
  });

  it("rejects an App-wide copy confirmation when the target database generation changes", async () => {
    const view = render(<Component isOpen onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText(existing));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: Current database" }),
    );
    h.databaseScope = { databaseId: "a", generation: 2 };
    view.rerender(<Component isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {});
    expect(writes()).toEqual([]);
    expect(database.compareAndSwap).not.toHaveBeenCalled();
  });

  it("abandons a pending DB-to-app copy when its database locks", async () => {
    const view = await openDatabase();
    let resolve!: (value: DatabaseAutomationLibrary) => void;
    vi.mocked(database.read).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy to scope: App-wide" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(resolve).toBeDefined());
    h.databaseScope = null;
    view.rerender(<Component isOpen onClose={vi.fn()} />);
    await act(async () => resolve(structuredClone(library)));
    expect(writes()).toEqual([]);
    expect(database.compareAndSwap).not.toHaveBeenCalled();
  });
});
