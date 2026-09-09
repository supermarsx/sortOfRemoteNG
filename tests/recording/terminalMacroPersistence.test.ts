import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { TerminalMacro } from "../../src/types/recording/macroTypes";
import {
  loadMacros,
  saveMacro,
  deleteMacro,
} from "../../src/utils/recording/macroService";
import {
  TERMINAL_MACROS_STORE_KEY,
  validateTerminalMacros,
} from "../../src/utils/recording/terminalMacroPersistence";

const bridge = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (bridge.native ? bridge.invoke : null),
}));
const legacyKey = "mremote-terminal-macros";
const macro = (id: string): TerminalMacro => ({
  id,
  name: id,
  steps: [{ command: "printf fixture", delayMs: 2, sendNewline: true }],
  createdAt: "2026-09-09",
  updatedAt: "2026-09-09",
});

describe("protected terminal macro library", () => {
  let raw: string | null;
  beforeEach(async () => {
    bridge.native = true;
    raw = null;
    await IndexedDbService.init();
    await (await openDB("mremote-keyval", 1)).clear("keyval");
    localStorage.clear();
    bridge.invoke.mockReset();
    bridge.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        expect(args.key).toBe(TERMINAL_MACROS_STORE_KEY);
        if (command === "read_macro_library") return raw;
        if (command === "compare_and_swap_macro_library") {
          if (raw !== args.expected) return false;
          raw = args.replacement as string;
          return true;
        }
        throw new Error("Unexpected native boundary");
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("copies an existing IDB library once, verifies native bytes, then removes only the exact legacy key", async () => {
    await IndexedDbService.setItemStrict(legacyKey, [macro("old")]);
    await IndexedDbService.setItemStrict("mremote-unrelated", {
      retained: true,
    });
    expect(await loadMacros()).toEqual([macro("old")]);
    expect(JSON.parse(raw!)).toMatchObject({
      version: 1,
      macros: [macro("old")],
    });
    expect(await IndexedDbService.getItemStrict(legacyKey)).toBeNull();
    expect(await IndexedDbService.getItemStrict("mremote-unrelated")).toEqual({
      retained: true,
    });
    expect(
      await IndexedDbService.getItemStrict(TERMINAL_MACROS_STORE_KEY),
    ).toBeNull();
    expect(await loadMacros()).toEqual([macro("old")]);
  });

  it.each(["refusal", "readback", "source drift"])(
    "retains legacy data on %s",
    async (failure) => {
      const original = [macro("old")];
      await IndexedDbService.setItemStrict(legacyKey, original);
      const implementation = bridge.invoke.getMockImplementation()!;
      let committed = false;
      bridge.invoke.mockImplementation(
        async (command: string, args: Record<string, unknown>) => {
          if (
            failure === "refusal" &&
            command === "compare_and_swap_macro_library"
          )
            throw new Error("Locked fixture store");
          if (
            failure === "readback" &&
            committed &&
            command === "read_macro_library"
          )
            return "{}";
          const result = await implementation(command, args);
          if (command === "compare_and_swap_macro_library") {
            committed = true;
            if (failure === "source drift")
              await IndexedDbService.setItemStrict(legacyKey, [
                macro("changed"),
              ]);
          }
          return result;
        },
      );
      await expect(loadMacros()).rejects.toThrow();
      expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(
        failure === "source drift" ? [macro("changed")] : original,
      );
    },
  );

  it("fails actionably without native availability and never writes a new browser macro library", async () => {
    bridge.native = false;
    await IndexedDbService.setItemStrict(legacyKey, [macro("old")]);
    await expect(loadMacros()).rejects.toThrow(/desktop app.*unlocked/);
    await expect(saveMacro(macro("new"))).rejects.toThrow(/desktop app/);
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual([
      macro("old"),
    ]);
    expect(
      await IndexedDbService.getItemStrict(TERMINAL_MACROS_STORE_KEY),
    ).toBeNull();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("merges individual CRUD against a concurrent authoritative CAS winner", async () => {
    await saveMacro(macro("one"));
    const implementation = bridge.invoke.getMockImplementation()!;
    let conflict = true;
    bridge.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "compare_and_swap_macro_library" && conflict) {
          conflict = false;
          const library = JSON.parse(raw!);
          library.macros.push(macro("other-window"));
          raw = JSON.stringify(library);
          return false;
        }
        return implementation(command, args);
      },
    );
    await saveMacro(macro("two"));
    expect((await loadMacros()).map((item) => item.id)).toEqual([
      "one",
      "other-window",
      "two",
    ]);
    await deleteMacro("one");
    expect((await loadMacros()).map((item) => item.id)).toEqual([
      "other-window",
      "two",
    ]);
  });

  it("does not resurrect a removed macro from a legacy copy that reappears", async () => {
    await IndexedDbService.setItemStrict(legacyKey, [macro("old")]);
    await loadMacros();
    await deleteMacro("old");
    await IndexedDbService.setItemStrict(legacyKey, [macro("old")]);
    expect(await loadMacros()).toEqual([]);
    expect(await IndexedDbService.getItemStrict(legacyKey)).toBeNull();
  });

  it("rejects malformed steps without altering either legacy or protected bytes", async () => {
    const invalid = [
      {
        ...macro("bad"),
        steps: [{ command: "x", delayMs: -1, sendNewline: true }],
      },
    ];
    await IndexedDbService.setItemStrict(legacyKey, invalid);
    await expect(loadMacros()).rejects.toThrow(/step is invalid/);
    expect(raw).toBeNull();
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(invalid);
    expect(() =>
      validateTerminalMacros([{ ...macro("a"), id: "x".repeat(129) }]),
    ).toThrow();
  });

  it("bounds aggregate empty steps and UTF-8 metadata before writing or cleaning legacy data", async () => {
    const emptyStep = { command: "", delayMs: 0, sendNewline: false };
    const excessiveSteps = Array.from({ length: 11 }, (_, index) => ({
      ...macro(`steps-${index}`),
      steps: Array(10_000).fill(emptyStep),
    }));
    expect(() => validateTerminalMacros(excessiveSteps)).toThrow(
      /too many steps/,
    );
    const excessiveMetadata = Array.from({ length: 750 }, (_, index) => ({
      ...macro(`metadata-${index}`),
      description: "界".repeat(4096),
      steps: [],
    }));
    await IndexedDbService.setItemStrict(legacyKey, excessiveMetadata);
    await expect(loadMacros()).rejects.toThrow(/byte limit/);
    expect(raw).toBeNull();
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(
      excessiveMetadata,
    );
  });
});
