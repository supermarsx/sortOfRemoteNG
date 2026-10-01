import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeManagedScriptsStore } from "../../src/utils/recording/managedScriptPersistence";
import { terminalMacrosStore } from "../../src/utils/recording/terminalMacroPersistence";
import {
  emptyDatabaseAutomationLibrary,
  normalizeDatabaseAutomationLibrary,
} from "../../src/utils/recording/automationLibraryValidation";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));

const receipt = {
  version: 1 as const,
  id: "completed-migration",
  databaseId: "database-a",
  scriptsDigest: "a".repeat(64),
  macrosDigest: "b".repeat(64),
};
const script = {
  id: "script-a",
  name: "Shared script",
  description: "",
  script: "pwd",
  language: "bash",
  category: "custom",
  osTags: ["agnostic"],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const macro = {
  id: "macro-a",
  name: "Shared macro",
  steps: [{ command: "pwd", delayMs: 0, sendNewline: true }],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  bridge.invoke.mockReset();
  localStorage.clear();
});

describe("terminal library migration unwind compatibility", () => {
  it("does not mount automatic migration or its retry banner at startup", () => {
    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    expect(app).not.toContain("TerminalLibraryMigrationNotice");
    expect(app).not.toContain("useLegacyTerminalLibraryMigration");
    expect(app).not.toContain("migrateLegacyTerminalLibraries");
  });

  it("reads app-wide scripts with a historical receipt without moving or clearing them", async () => {
    const stored = {
      customScripts: [script],
      modifiedDefaults: [],
      deletedDefaultIds: ["removed-default"],
      databaseMigration: receipt,
    };
    let raw = JSON.stringify(stored);
    bridge.invoke.mockImplementation(async (command, args) => {
      expect(args.key).toBe(nativeManagedScriptsStore.key);
      if (command === "read_app_data") return raw;
      expect(command).toBe("compare_and_swap_app_data");
      expect(args.expected).toBe(raw);
      expect(JSON.parse(args.replacement)).toMatchObject(stored);
      raw = args.replacement;
      return true;
    });
    expect((await nativeManagedScriptsStore.load()).value).toMatchObject(
      stored,
    );
    bridge.invoke.mockClear();
    expect((await nativeManagedScriptsStore.load()).value).toMatchObject(
      stored,
    );
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith("read_app_data", {
      key: nativeManagedScriptsStore.key,
    });
  });

  it("reads app-wide macros with a historical receipt without moving or clearing them", async () => {
    const stored = {
      version: 1,
      macros: [macro],
      legacyDigest: null,
      databaseMigration: receipt,
    };
    let raw = JSON.stringify(stored);
    bridge.invoke.mockImplementation(async (command, args) => {
      expect(args.key).toBe(terminalMacrosStore.key);
      if (command === "read_macro_library") return raw;
      expect(command).toBe("compare_and_swap_macro_library");
      expect(args.expected).toBe(raw);
      expect(JSON.parse(args.replacement)).toMatchObject(stored);
      raw = args.replacement;
      return true;
    });
    expect((await terminalMacrosStore.load()).value).toMatchObject(stored);
    bridge.invoke.mockClear();
    expect((await terminalMacrosStore.load()).value).toMatchObject(stored);
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
      "read_macro_library",
      {
        key: terminalMacrosStore.key,
      },
    );
  });

  it("keeps already-migrated database entries and their receipt readable", () => {
    const stored = {
      ...emptyDatabaseAutomationLibrary(),
      terminalScripts: {
        customScripts: [script],
        modifiedDefaults: [],
        deletedDefaultIds: ["removed-default"],
      },
      terminalMacros: [macro],
      terminalLibraryMigration: receipt,
    };
    const original = JSON.stringify(stored);
    expect(normalizeDatabaseAutomationLibrary(stored)).toEqual(stored);
    expect(JSON.stringify(stored)).toBe(original);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
