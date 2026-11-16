import { describe, expect, it } from "vitest";
import {
  applyQuickActionOrder,
  moveQuickActionReference,
  shiftQuickActionReference,
  normalizeHttpAutomation,
  normalizeQuickActionReferences,
  normalizeSessionQuickActions,
  normalizeSshQuickActions,
  resolveHttpAutomationPermissions,
  quickActionReferenceKey,
} from "../../src/utils/connection/sessionQuickActions";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { DEFAULT_SESSION_QUICK_ACTIONS } from "../../src/types/connection/sessionQuickActions";

describe("session quick-action references and consent", () => {
  it("qualifies IDs by exact scope while legacy and explicit app are identical", () => {
    const refs = normalizeQuickActionReferences([
      { kind: "script", id: "same" },
      { kind: "script", id: "same", scope: { kind: "app" } },
      {
        kind: "script",
        id: "same",
        scope: { kind: "database", databaseId: "a" },
      },
      {
        kind: "script",
        id: "same",
        scope: { kind: "database", databaseId: "b" },
      },
      {
        kind: "macro",
        id: "same",
        scope: { kind: "database", databaseId: "a" },
      },
    ]);
    expect(refs).toHaveLength(4);
    expect(new Set(refs.map(quickActionReferenceKey)).size).toBe(4);
    expect(refs[0]).toEqual({ kind: "script", id: "same" });
    expect(
      normalizeQuickActionReferences(JSON.parse(JSON.stringify(refs))),
    ).toEqual(refs);
  });
  it.each([
    null,
    {},
    { kind: "database" },
    { kind: "database", databaseId: "" },
    { kind: "database", databaseId: "x", unexpected: true },
    { kind: "app", databaseId: "x" },
  ])("refuses malformed explicit scope %j", (scope) => {
    expect(() =>
      normalizeQuickActionReferences([{ kind: "script", id: "a", scope }]),
    ).toThrow();
  });
  it("does not grant any website capability from global defaults alone", () => {
    expect(resolveHttpAutomationPermissions(undefined, undefined)).toEqual({
      showActionBar: true,
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: false,
      forceDark: false,
      confirmBeforeScriptRun: true,
    });
    expect(normalizeSshQuickActions(undefined)).toEqual({
      version: 1,
      items: [],
    });
  });
  it("deduplicates ordered references without resolving or executing them", () => {
    const items = [
      { kind: "macro", id: "a" },
      { kind: "script", id: "a" },
      { kind: "macro", id: "a" },
      { kind: "script", id: "missing-library-id" },
    ];
    expect(normalizeQuickActionReferences(items)).toEqual([
      items[0],
      items[1],
      items[3],
    ]);
  });
  it.each([
    null,
    {},
    [{ kind: "script", id: "" }],
    [{ kind: "script", id: "a", script: "alert(1)" }],
    [{ kind: "shell", id: "a" }],
    [{ kind: "macro", id: "x".repeat(129) }],
    Array.from({ length: 65 }, (_, i) => ({ kind: "script", id: String(i) })),
  ])("refuses malformed or oversized references %j", (value) => {
    expect(() => normalizeQuickActionReferences(value)).toThrow();
  });
  it("honors independent global kill switches and explicit per-connection consent", () => {
    const web = {
      version: 1,
      items: [],
      interactionMacrosEnabled: true,
      scriptInjectionEnabled: true,
      forceDark: true,
    };
    expect(
      resolveHttpAutomationPermissions(
        {
          ...DEFAULT_SESSION_QUICK_ACTIONS,
          allowWebMacros: false,
          allowWebScriptInjection: false,
          allowWebForceDark: false,
        },
        web,
      ),
    ).toMatchObject({
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: false,
      forceDark: false,
    });
    expect(
      normalizeSessionQuickActions({
        allowWebMacros: "true",
        confirmBeforeScriptRun: "false",
      }),
    ).toMatchObject({ allowWebMacros: false, confirmBeforeScriptRun: true });
    expect(() =>
      normalizeHttpAutomation({ ...web, scriptInjectionEnabled: "true" }),
    ).toThrow();
  });
  it("roundtrips through the actual connection normalizer without turning favorites into lifecycle scripts", () => {
    const input = {
      protocol: "https",
      httpAutomation: {
        ...normalizeHttpAutomation(undefined),
        items: [{ kind: "script" as const, id: "library-a" }],
      },
      sshQuickActions: {
        version: 1 as const,
        items: [{ kind: "macro" as const, id: "terminal-a" }],
      },
    };
    const restored = normalizeAdvancedProtocolConnection(
      JSON.parse(JSON.stringify(input)),
    );
    expect(restored.httpAutomation).toEqual(input.httpAutomation);
    expect(restored.sshQuickActions).toEqual(input.sshQuickActions);
    expect(restored.scripts).toBeUndefined();
    const malformed = normalizeAdvancedProtocolConnection({
      ...input,
      httpAutomation: { ...input.httpAutomation, version: 9 } as never,
    });
    expect(malformed.httpAutomation).toEqual({
      ...input.httpAutomation,
      version: 9,
    });
    expect(malformed.protocol).toBe("https");
    expect(() =>
      resolveHttpAutomationPermissions(undefined, malformed.httpAutomation),
    ).toThrow();
  });
});

describe("favorites ordering helpers", () => {
  const a = { kind: "script" as const, id: "a" };
  const b = { kind: "script" as const, id: "b" };
  const c = { kind: "macro" as const, id: "c" };
  const k = quickActionReferenceKey;
  const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

  it("moves before/after a target and is identity-preserving for no-ops", () => {
    const list = [a, b, c];
    expect(ids(moveQuickActionReference(list, k(c), k(a), "before"))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(moveQuickActionReference(list, k(a), k(c), "after"))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveQuickActionReference(list, k(a), k(b), "before")).toBe(list);
    expect(moveQuickActionReference(list, k(a), k(a))).toBe(list);
    expect(moveQuickActionReference(list, "nope", k(a))).toBe(list);
  });

  it("shifts by one and clamps at the ends", () => {
    const list = [a, b, c];
    expect(ids(shiftQuickActionReference(list, k(b), 1))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(shiftQuickActionReference(list, k(a), -1)).toBe(list);
    expect(shiftQuickActionReference(list, k(c), 1)).toBe(list);
    expect(shiftQuickActionReference(list, "nope", 1)).toBe(list);
  });

  it("applies an order, pruning unknown ids and keeping unmentioned entries last", () => {
    const list = [a, b, c];
    expect(
      ids(applyQuickActionOrder(list, [k(c), "deleted", k(c), k(a)])),
    ).toEqual(["c", "a", "b"]);
    expect(applyQuickActionOrder(list, [k(a), k(b), k(c)])).toBe(list);
    expect(ids(applyQuickActionOrder(list, []))).toEqual(["a", "b", "c"]);
  });
});
