import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
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

  it("stops after an in-flight migration CAS when the caller lease is revoked, retaining committed bytes and both originals", async () => {
    const original = [macro("old")];
    await IndexedDbService.setItemStrict(legacyKey, original);
    localStorage.setItem(legacyKey, JSON.stringify(original));
    const implementation = bridge.invoke.getMockImplementation()!;
    let release!: (value: boolean) => void;
    bridge.invoke.mockImplementation(async (command, args) => {
      const value = await implementation(command, args);
      if (command === "compare_and_swap_macro_library")
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      return value;
    });
    const changed = vi.fn();
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    const controller = new AbortController();
    const result = loadMacros({
      signal: controller.signal,
      assertCurrent: () => {},
    }).catch((error: unknown) => error);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    controller.abort();
    release(true);
    expect(await result).toMatchObject({
      message: expect.stringContaining("access changed"),
    });
    expect(JSON.parse(raw!).macros).toEqual(original);
    expect(bridge.invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_macro_library",
      "read_macro_library",
      "compare_and_swap_macro_library",
    ]);
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(original);
    expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(original));
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
  });

  it("does not retry a post-write migration readback busy error or remove legacy data", async () => {
    const original = [macro("old")];
    await IndexedDbService.setItemStrict(legacyKey, original);
    const implementation = bridge.invoke.getMockImplementation()!;
    const busy =
      "Storage error: encryption storage transition in progress; retry after it completes";
    let reads = 0;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "read_macro_library" && ++reads === 4) throw busy;
      return implementation(command, args);
    });
    await expect(
      loadMacros({
        signal: new AbortController().signal,
        assertCurrent: () => {},
      }),
    ).rejects.toBe(busy);
    expect(reads).toBe(4);
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "compare_and_swap_macro_library",
      ),
    ).toHaveLength(1);
    expect(JSON.parse(raw!).macros).toEqual(original);
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(original);
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
