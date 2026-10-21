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
  buildManagedScriptsSnapshot,
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
  it("offers twelve editable AI CLI scripts with explicit modes and interactive terminal requirements", async () => {
    const launchers = optionalScriptTemplates.filter(
      (entry) => entry.category === "Development / AI",
    );
    expect(launchers).toHaveLength(12);
    for (const entry of launchers) {
      expect(entry.description).toContain("interactive terminal");
      expect(entry.description).not.toContain("Read-only diagnostic");
      expect(entry.script).toContain(
        "Run this launcher in an interactive SSH terminal.",
      );
      expect(entry.script).not.toContain("--full-auto");
      expect(entry.script).not.toMatch(/npm install|curl|https?:\/\//);
      expect(entry.language).toBe(
        entry.osTags.includes("windows") ? "powershell" : "sh",
      );
    }
    const find = (id: string) =>
      launchers.find((entry) => entry.id === `catalog-ai-${id}`)!;
    expect(find("claude-posix").script).toMatch(/\nclaude$/);
    expect(find("codex-posix").script).toMatch(/\ncodex$/);
    expect(find("claude-bypass-posix").script).toContain(
      "claude --dangerously-skip-permissions",
    );
    expect(find("claude-sandbox-posix").script).toContain(
      "IS_SANDBOX=1 claude --dangerously-skip-permissions",
    );
    expect(find("claude-sandbox-windows").script).toContain("finally");
    expect(find("claude-sandbox-windows").script).toContain(
      "$env:IS_SANDBOX = $claudeSandboxPrevious",
    );
    expect(find("codex-workspace-auto-posix").script).toContain(
      "codex --sandbox workspace-write --ask-for-approval never",
    );
    expect(find("codex-bypass-posix").script).toContain(
      "codex --dangerously-bypass-approvals-and-sandbox",
    );
    const result = await applyDefaultScriptSelection(
      [find("claude-posix").id],
      null,
      false,
    );
    expect(result.value.customScripts).toHaveLength(1);
    expect(result.value.customScripts[0].id).not.toBe(find("claude-posix").id);
    expect(result.value.customScripts[0].script).toBe(
      find("claude-posix").script,
    );
  });
  it("starts empty and explicitly imported originals survive save/reload without materializing siblings", async () => {
    expect(resolveManagedScripts(defaultScripts, null)).toEqual([]);
    expect(
      resolveManagedScripts(defaultScripts, {
        customScripts: [],
        modifiedDefaults: [],
        deletedDefaultIds: [],
      }),
    ).toEqual([]);
    const result = await applyDefaultScriptSelection(
      ["default-1"],
      null,
      false,
    );
    const saved = buildManagedScriptsSnapshot(
      resolveManagedScripts(defaultScripts, result.value),
      defaultScripts,
    );
    expect(
      resolveManagedScripts(defaultScripts, JSON.parse(JSON.stringify(saved))),
    ).toEqual([defaultScripts[0]]);
  });
  it("ships 44 stable credential-free templates without force-installing the 36 additions", () => {
    expect(defaultScripts).toHaveLength(8);
    expect(optionalScriptTemplates).toHaveLength(36);
    expect(defaultScriptCatalog).toHaveLength(44);
    expect(defaultScripts.map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `default-${i + 1}`),
    );
    expect(new Set(defaultScriptCatalog.map((item) => item.id)).size).toBe(44);
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
    expect(result.value.modifiedDefaults).toEqual([
      defaultScripts[0],
      defaultScripts[1],
    ]);
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
