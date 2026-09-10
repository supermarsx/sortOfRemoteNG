import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { createAutomationLibraryApi } from "../../src/utils/recording/automationLibrary";
import {
  emptyDatabaseAutomationLibrary,
  normalizeDatabaseAutomationLibrary,
  normalizeAutomationEntry,
  normalizeAutomationProvenance,
} from "../../src/utils/recording/automationLibraryValidation";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type {
  AutomationEntry,
  DatabaseAutomationApi,
  DatabaseAutomationLibrary,
} from "../../src/types/recording/automationLibrary";
import {
  deleteWebAutomationItem,
  saveWebAutomationItem,
  WEB_AUTOMATION_STORE_KEY,
} from "../../src/utils/recording/webAutomationLibrary";
import { deleteMacro, saveMacro } from "../../src/utils/recording/macroService";
import { TERMINAL_MACROS_STORE_KEY } from "../../src/utils/recording/terminalMacroPersistence";
import { defaultScripts } from "../../src/data/defaultScripts";

const bridge = vi.hoisted(() => ({
  available: true,
  invoke: vi.fn(),
  raw: new Map<string, string>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (bridge.available ? bridge.invoke : null),
}));
const script: AutomationEntry<"website-script"> = {
  family: "website-script",
  payload: {
    kind: "script",
    id: "same-id",
    name: "Safe fixture",
    description: "",
    code: "document.title = 'fixture';",
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
  },
  provenance: {
    sourceUrl: "https://example.test/catalog.json",
    sourceSha256: "a".repeat(64),
  },
};
const macro: AutomationEntry<"terminal-macro"> = {
  family: "terminal-macro",
  payload: {
    id: "same-id",
    name: "Macro fixture",
    steps: [{ command: "printf fixture", delayMs: 0, sendNewline: true }],
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
  },
  provenance: { platforms: ["linux"] },
};
function databaseFixture() {
  let library = emptyDatabaseAutomationLibrary();
  const database: DatabaseAutomationApi = {
    scope: { databaseId: "db-a", generation: 1 },
    read: vi.fn(async () => structuredClone(library)),
    compareAndSwap: vi.fn(async (scope, expected, replacement) => {
      expect(scope).toEqual(database.scope);
      if (JSON.stringify(expected) !== JSON.stringify(library))
        throw new Error("Conflict");
      library = structuredClone(replacement);
    }),
  };
  return {
    database,
    get: () => library,
    set: (next: DatabaseAutomationLibrary) => {
      library = next;
    },
  };
}
beforeEach(async () => {
  bridge.available = true;
  bridge.raw.clear();
  bridge.invoke.mockReset();
  localStorage.clear();
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  bridge.invoke.mockImplementation(
    async (
      command: string,
      args: { key: string; expected: string | null; replacement: string },
    ) => {
      if (command === "read_macro_library" || command === "read_app_data")
        return bridge.raw.get(args.key) ?? null;
      if (
        command === "compare_and_swap_macro_library" ||
        command === "compare_and_swap_app_data"
      ) {
        if ((bridge.raw.get(args.key) ?? null) !== args.expected) return false;
        bridge.raw.set(args.key, args.replacement);
        return true;
      }
      throw new Error("Unexpected test transport");
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe("scoped reviewed automation libraries", () => {
  it("bounds aggregate review memory independently of the receipt count cap", async () => {
    const fixture = databaseFixture();
    const large = emptyDatabaseAutomationLibrary();
    large.terminalMacros = [
      {
        ...macro.payload,
        steps: Array.from({ length: 64 }, () => ({
          command: "p".repeat(65536),
          delayMs: 0,
          sendNewline: true,
        })),
      },
    ];
    fixture.set(large);
    const api = createAutomationLibraryApi(() => fixture.database);
    const first = await api.read(
      { kind: "database", databaseId: "db-a" },
      "terminal-macro",
    );
    for (let index = 0; index < 3; index++)
      await api.read(
        { kind: "database", databaseId: "db-a" },
        "terminal-macro",
      );
    await expect(api.apply(first, [])).rejects.toThrow("review");
    expect(fixture.database.compareAndSwap).not.toHaveBeenCalled();
  });
  it("keeps identical app/DB IDs independent and absent database scripts empty", async () => {
    const fixture = databaseFixture(),
      api = createAutomationLibraryApi(() => fixture.database);
    const dbScope = { kind: "database" as const, databaseId: "db-a" };
    expect((await api.read(dbScope, "terminal-script")).entries).toEqual([]);
    const app = await api.read({ kind: "app" }, "website-script");
    await api.apply(app, [{ operation: "put", entry: script }]);
    const db = await api.read(dbScope, "website-script");
    expect(db.entries).toEqual([]);
    const dbScript = {
      ...script,
      payload: { ...script.payload, name: "DB copy" },
    };
    await api.apply(db, [{ operation: "put", entry: dbScript }]);
    expect(
      (await api.read({ kind: "app" }, "website-script")).entries[0].payload
        .name,
    ).toBe("Safe fixture");
    expect(
      (await api.read(dbScope, "website-script")).entries[0].payload.name,
    ).toBe("DB copy");
    expect(fixture.get().revision).toBe(1);
  });
  it("starts app scripts empty and only explicit imports install bundled or other templates", async () => {
    const api = createAutomationLibraryApi();
    const initial = await api.read({ kind: "app" }, "terminal-script");
    expect(initial.entries).toEqual([]);
    const entry: AutomationEntry<"terminal-script"> = {
      family: "terminal-script",
      payload: { ...defaultScripts[0], id: "default-remote-fixture" },
    };
    const result = await api.apply(initial, [{ operation: "put", entry }]);
    expect(
      result.entries.some((item) => item.payload.id === entry.payload.id),
    ).toBe(true);
    expect(
      JSON.parse(bridge.raw.get("recording.managed-scripts")!).customScripts[0]
        .id,
    ).toBe(entry.payload.id);
    const explicit = await api.apply(result, [
      {
        operation: "put",
        entry: { family: "terminal-script", payload: defaultScripts[0] },
      },
    ]);
    expect(explicit.entries.map((item) => item.payload.id)).toEqual(
      expect.arrayContaining([entry.payload.id, defaultScripts[0].id]),
    );
    expect(
      (
        await createAutomationLibraryApi().read(
          { kind: "app" },
          "terminal-script",
        )
      ).entries,
    ).toEqual(explicit.entries);
  });
  it("refuses missing/wrong/revoked DB ownership without reading app storage", async () => {
    const fixture = databaseFixture(),
      api = createAutomationLibraryApi(() => fixture.database);
    await expect(
      api.read({ kind: "database", databaseId: "other" }, "website-script"),
    ).rejects.toThrow("exact owning");
    const snapshot = await api.read(
      { kind: "database", databaseId: "db-a" },
      "website-script",
    );
    fixture.database.scope = { databaseId: "db-a", generation: 2 };
    await expect(
      api.apply(snapshot, [{ operation: "put", entry: script }]),
    ).rejects.toThrow("exact owning");
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(fixture.database.compareAndSwap).not.toHaveBeenCalled();
  });
  it("honors generic access/listener guard on explicit database reads and writes", async () => {
    const fixture = databaseFixture();
    let accessible = true;
    const api = createAutomationLibraryApi(
      () => fixture.database,
      () => {
        if (!accessible) throw new Error("Listener unavailable");
      },
    );
    const snapshot = await api.read(
      { kind: "database", databaseId: "db-a" },
      "website-script",
    );
    accessible = false;
    await expect(
      api.apply(snapshot, [{ operation: "put", entry: script }]),
    ).rejects.toThrow("Listener unavailable");
    await expect(
      api.read({ kind: "database", databaseId: "db-a" }, "website-script"),
    ).rejects.toThrow("Listener unavailable");
    expect(fixture.database.read).toHaveBeenCalledTimes(1);
    expect(fixture.database.compareAndSwap).not.toHaveBeenCalled();
  });
  it("rejects stale/forged receipts and invalidates all reviews without replay", async () => {
    const api = createAutomationLibraryApi();
    const snapshot = await api.read({ kind: "app" }, "website-script");
    await expect(
      api.apply({ ...snapshot, entries: [script] }, []),
    ).rejects.toThrow("review");
    api.invalidateReviews();
    await expect(
      api.apply(snapshot, [{ operation: "put", entry: script }]),
    ).rejects.toThrow("review");
    expect(bridge.raw.size).toBe(0);
  });
  it("permits normal long editing but expires at 30 minutes and evicts bounded receipt count", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const api = createAutomationLibraryApi();
    const initial = await api.read({ kind: "app" }, "website-script");
    now = 3 * 60_000;
    await expect(
      api.apply(initial, [{ operation: "put", entry: script }]),
    ).resolves.toMatchObject({ entries: [script] });
    const old = await api.read({ kind: "app" }, "website-script");
    now += 31 * 60_000;
    await expect(api.apply(old, [])).rejects.toThrow("expired");
    const evicted = await api.read({ kind: "app" }, "website-script");
    for (let i = 0; i < 8; i++)
      await api.read({ kind: "app" }, "website-script");
    await expect(api.apply(evicted, [])).rejects.toThrow("review");
  });
  it("refuses concurrent app edits atomically and preserves unrelated website macros", async () => {
    const api = createAutomationLibraryApi(),
      snapshot = await api.read({ kind: "app" }, "website-script");
    await saveWebAutomationItem(script.payload);
    await expect(
      api.apply(snapshot, [
        {
          operation: "put",
          entry: { ...script, payload: { ...script.payload, id: "different" } },
        },
      ]),
    ).rejects.toThrow("changed");
    expect(
      JSON.parse(bridge.raw.get(WEB_AUTOMATION_STORE_KEY)!).scripts,
    ).toHaveLength(1);
  });
  it("existing website CRUD preserves unrelated provenance and removes only deleted metadata", async () => {
    const api = createAutomationLibraryApi();
    await api.apply(await api.read({ kind: "app" }, "website-script"), [
      { operation: "put", entry: script },
      {
        operation: "put",
        entry: { ...script, payload: { ...script.payload, id: "second" } },
      },
    ]);
    await saveWebAutomationItem(
      { ...script.payload, name: "Edited" },
      script.payload,
    );
    await deleteWebAutomationItem({ ...script.payload, name: "Edited" });
    const stored = JSON.parse(bridge.raw.get(WEB_AUTOMATION_STORE_KEY)!);
    expect(
      stored.provenance[`website-script:${script.payload.id}`],
    ).toBeUndefined();
    expect(stored.provenance["website-script:second"]).toEqual(
      script.provenance,
    );
  });
  it("existing terminal macro CRUD preserves sidecars and cleans deleted IDs", async () => {
    const api = createAutomationLibraryApi();
    await api.apply(await api.read({ kind: "app" }, "terminal-macro"), [
      { operation: "put", entry: macro },
    ]);
    await saveMacro({ ...macro.payload, name: "Updated" });
    expect(
      JSON.parse(bridge.raw.get(TERMINAL_MACROS_STORE_KEY)!).provenance[
        "terminal-macro:same-id"
      ],
    ).toEqual(macro.provenance);
    await deleteMacro(macro.payload.id);
    expect(
      JSON.parse(bridge.raw.get(TERMINAL_MACROS_STORE_KEY)!).provenance,
    ).toEqual({});
  });
  it("never creates a browser fallback for a missing native bridge", async () => {
    bridge.available = false;
    await expect(
      createAutomationLibraryApi().read({ kind: "app" }, "terminal-script"),
    ).rejects.toThrow("desktop");
    expect(
      await IndexedDbService.getItemStrict("recording.managed-scripts"),
    ).toBeNull();
  });
  it.each([
    null,
    [],
    { version: 2 },
    { ...emptyDatabaseAutomationLibrary(), unexpected: true },
  ])("does not reset malformed present database library %#", (value) => {
    expect(() => normalizeDatabaseAutomationLibrary(value)).toThrow();
    expect(normalizeDatabaseAutomationLibrary(undefined)).toEqual(
      emptyDatabaseAutomationLibrary(),
    );
  });
  it.each([
    "https://user:pass@example.test/a",
    "https://example.test/a?token=fixture",
    "https://example.test/a#private",
    "file:///private",
    "http://example.test/a",
  ])("rejects unsafe persisted source URL %s", (sourceUrl) =>
    expect(() => normalizeAutomationProvenance({ sourceUrl })).toThrow(),
  );
  it("rejects executable/unknown metadata, invalid hash and mixed payload kinds", () => {
    expect(() =>
      normalizeAutomationEntry({ ...script, payload: macro.payload }),
    ).toThrow();
    expect(() =>
      normalizeAutomationProvenance({ sourceSha256: "NOT_A_HASH" }),
    ).toThrow();
    expect(() => normalizeAutomationProvenance({ trusted: true })).toThrow();
  });
});
