import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  available: true,
  raw: null as string | null,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (native.available ? native.invoke : null),
}));
import {
  deleteWebAutomationItem,
  normalizeWebAutomationItem,
  normalizeWebAutomationLibrary,
  normalizeWebInteractionStep,
  saveWebAutomationItem,
  webAutomationStore,
  WEB_AUTOMATION_STORE_KEY,
} from "../../src/utils/recording/webAutomationLibrary";
import type { BrowserScript } from "../../src/types/recording/webAutomation";
const script: BrowserScript = {
  kind: "script",
  id: "demo-script",
  name: "Demo",
  description: "",
  code: "document.title = 'Demo';",
  createdAt: "2026-09-09T12:00:00Z",
  updatedAt: "2026-09-09T12:00:00Z",
};
const selector = "html > body > input:nth-of-type(1)";
beforeEach(() => {
  native.raw = null;
  native.available = true;
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command, args) => {
    expect(args.key).toBe(WEB_AUTOMATION_STORE_KEY);
    if (command === "read_macro_library") return native.raw;
    if (command === "compare_and_swap_macro_library") {
      if (native.raw !== args.expected) return false;
      native.raw = args.replacement;
      return true;
    }
    throw new Error(`Unexpected IPC ${command}`);
  });
});
describe("strict protected website automation library", () => {
  it.each(["value", "password", "url", "text", "requestBody"])(
    "rejects recorded %s instead of dropping a secret into storage",
    (key) => {
      expect(() =>
        normalizeWebInteractionStep({
          kind: "fill",
          selector,
          [key]: "not-storable",
        }),
      ).toThrow();
    },
  );
  it("accepts value-free interactions but rejects attribute selectors, excessive bounds and mixed item kinds", () => {
    expect(normalizeWebInteractionStep({ kind: "fill", selector })).toEqual({
      kind: "fill",
      selector,
    });
    expect(() =>
      normalizeWebInteractionStep({ kind: "click", selector: "#account" }),
    ).toThrow();
    expect(() =>
      normalizeWebAutomationItem({ ...script, code: "x".repeat(65537) }),
    ).toThrow();
    expect(() =>
      normalizeWebAutomationItem({
        ...script,
        code: undefined,
        kind: "macro",
        steps: Array(201).fill({ kind: "fill", selector }),
      }),
    ).toThrow();
    expect(() =>
      normalizeWebAutomationLibrary({
        version: 1,
        scripts: [script],
        macros: [script],
      }),
    ).toThrow();
  });
  it("uses only the dedicated native Macros backend and verifies durable readback", async () => {
    const result = await saveWebAutomationItem(script);
    expect(result.scripts).toEqual([script]);
    expect(JSON.parse(native.raw!).scripts).toEqual([script]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_macro_library",
      "compare_and_swap_macro_library",
      "read_macro_library",
    ]);
    expect(await webAutomationStore.load()).toMatchObject({ value: result });
  });
  it("never reads an unreviewed localStorage script or writes a browser fallback", async () => {
    localStorage.setItem(
      WEB_AUTOMATION_STORE_KEY,
      JSON.stringify({ version: 1, scripts: [script], macros: [] }),
    );
    expect((await webAutomationStore.load()).value).toBeNull();
    native.available = false;
    await expect(saveWebAutomationItem(script)).rejects.toThrow(/desktop app/);
    localStorage.removeItem(WEB_AUTOMATION_STORE_KEY);
  });
  it("merges another item but rejects replacing or deleting a changed reviewed item", async () => {
    await saveWebAutomationItem(script);
    const other = { ...script, id: "other" };
    await saveWebAutomationItem(other);
    const changed = { ...script, name: "Changed elsewhere" };
    await saveWebAutomationItem(changed, script);
    await expect(
      saveWebAutomationItem({ ...script, name: "Stale draft" }, script),
    ).rejects.toThrow(/changed/);
    await expect(deleteWebAutomationItem(script)).rejects.toThrow(/changed/);
    expect(JSON.parse(native.raw!).scripts).toHaveLength(2);
  });
  it("does not claim success after a refused write or mismatched durable readback", async () => {
    native.invoke.mockImplementation(async (command) =>
      command === "read_macro_library" ? null : true,
    );
    await expect(saveWebAutomationItem(script)).rejects.toThrow(
      /readback|durable|verif|confirmed/i,
    );
  });
});
