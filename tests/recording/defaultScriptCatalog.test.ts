import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedManagedScripts } from "../../src/utils/recording/managedScriptPersistence";
const h = vi.hoisted(() => ({
  current: null as PersistedManagedScripts | null,
  update: vi.fn(),
}));
vi.mock("../../src/utils/recording/managedScriptPersistence", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/utils/recording/managedScriptPersistence")
  >("../../src/utils/recording/managedScriptPersistence");
  return { ...actual, managedScriptsStore: { update: h.update } };
});
import { applyDefaultScriptSelection } from "../../src/utils/recording/defaultScriptCatalog";
import { defaultScripts } from "../../src/data/defaultScripts";
import {
  defaultScriptCatalog,
  optionalScriptTemplates,
  SCRIPT_CATEGORY_SUGGESTIONS,
} from "../../src/data/defaultScriptCatalog";
import {
  assertManagedScriptsAreSecretFree,
  resolveManagedScripts,
} from "../../src/utils/recording/managedScriptPersistence";

beforeEach(() => {
  h.current = null;
  h.update.mockReset();
  h.update.mockImplementation(async (transform) => {
    const next = transform(h.current);
    h.current = next;
    return { value: next, sanitized: false };
  });
});
describe("reviewed default script catalog", () => {
  it("ships 32 stable credential-free templates without force-installing the 24 additions", () => {
    expect(defaultScripts).toHaveLength(8);
    expect(optionalScriptTemplates).toHaveLength(24);
    expect(defaultScriptCatalog).toHaveLength(32);
    expect(defaultScripts.map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `default-${i + 1}`),
    );
    expect(new Set(defaultScriptCatalog.map((item) => item.id)).size).toBe(32);
    assertManagedScriptsAreSecretFree(defaultScriptCatalog);
    expect(SCRIPT_CATEGORY_SUGGESTIONS).toContain("Packages / Development");
    for (const item of defaultScriptCatalog) {
      expect(item.createdAt).toMatch(/^2026-/);
      expect(item.script.trim()).not.toBe("");
    }
  });
  it("imports optional templates under custom UUIDs that survive resolve and keep existing favorites", async () => {
    const custom = {
      ...defaultScripts[0],
      id: "favorite-existing",
      name: "Existing custom",
    };
    h.current = {
      customScripts: [custom],
      modifiedDefaults: [],
      deletedDefaultIds: ["default-2"],
    };
    const before = structuredClone(h.current);
    const result = await applyDefaultScriptSelection(
      [optionalScriptTemplates[0].id],
      before,
      false,
    );
    expect(result.value.customScripts[0]).toEqual(custom);
    expect(result.value.customScripts[1].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      resolveManagedScripts(defaultScripts, result.value).some(
        (item) => item.id === result.value.customScripts[1].id,
      ),
    ).toBe(true);
    expect(result.value.deletedDefaultIds).toEqual(["default-2"]);
    expect(before.customScripts).toHaveLength(1);
  });
  it("requires explicit replacement review and restores only selected original IDs", async () => {
    const modified = { ...defaultScripts[0], script: "echo modified" };
    h.current = {
      customScripts: [],
      modifiedDefaults: [modified],
      deletedDefaultIds: ["default-2", "default-3"],
    };
    const before = structuredClone(h.current);
    await expect(
      applyDefaultScriptSelection(["default-1", "default-2"], before, false),
    ).rejects.toThrow(/Review replacement/);
    expect(h.current).toEqual(before);
    const result = await applyDefaultScriptSelection(
      ["default-1", "default-2"],
      before,
      true,
    );
    expect(result.value.deletedDefaultIds).toEqual(["default-3"]);
    expect(result.value.modifiedDefaults).toEqual([]);
    expect(
      resolveManagedScripts(defaultScripts, result.value).find(
        (item) => item.id === "default-1",
      ),
    ).toEqual(defaultScripts[0]);
  });
  it("rejects a stale review without overwriting newer scripts or tombstones", async () => {
    const reviewed = {
      customScripts: [],
      modifiedDefaults: [],
      deletedDefaultIds: [],
    };
    h.current = { ...reviewed, deletedDefaultIds: ["default-7"] };
    await expect(
      applyDefaultScriptSelection(
        [optionalScriptTemplates[0].id],
        reviewed,
        false,
      ),
    ).rejects.toThrow(/changed/);
    expect(h.current.deletedDefaultIds).toEqual(["default-7"]);
    expect(h.current.customScripts).toEqual([]);
  });
  it("does not publish imports on storage failure and rejects unknown selections", async () => {
    h.update.mockRejectedValueOnce(new Error("locked"));
    await expect(
      applyDefaultScriptSelection([optionalScriptTemplates[0].id], null, false),
    ).rejects.toThrow("locked");
    expect(h.current).toBeNull();
    await expect(
      applyDefaultScriptSelection(["unknown"], null, false),
    ).rejects.toThrow(/valid/);
  });
});
