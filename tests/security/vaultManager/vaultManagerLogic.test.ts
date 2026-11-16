import { describe, expect, it } from "vitest";
import enUS from "../../../src/i18n/locales/en-US.json";
import { VAULT_TEXT } from "../../../src/components/security/databaseCredentialVault/manager/vaultText";
import {
  compileVaultSearch,
  DEFAULT_VAULT_SEARCH,
  isDefaultSearch,
  type VaultSearchFields,
} from "../../../src/utils/security/vaultManager/vaultSearch";
import {
  countVaultGroups,
  quickFilterMatches,
  quickFiltersMatch,
} from "../../../src/utils/security/vaultManager/vaultQuickFilters";
import {
  EMPTY_SELECTION,
  moveSelection,
  pruneSelection,
  selectAll,
  selectRow,
} from "../../../src/utils/security/vaultManager/vaultSelection";
import {
  matchVaultShortcut,
  VAULT_SHORTCUTS,
} from "../../../src/utils/security/vaultManager/vaultShortcuts";
import { splitToolbarItems } from "../../../src/utils/security/vaultManager/toolbarOverflow";
import { passwordQuality } from "../../../src/utils/security/vaultManager/passwordQuality";
import {
  compareCredentialInventory,
  type CredentialInventoryViewMetadata,
} from "../../../src/utils/settings/credentialVaultView";
import { toggleQuickFilter } from "../../../src/components/security/databaseCredentialVault/manager/VaultQuickFilterChips";
import {
  generatePassword,
  DEFAULT_PASSWORD_OPTIONS,
} from "../../../src/utils/security/passwordGenerator";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const meta = (
  patch: Partial<CredentialInventoryViewMetadata> = {},
): CredentialInventoryViewMetadata => ({
  key: "vault:a",
  name: "Alpha",
  source: "vault",
  types: ["password"],
  tags: ["Finance"],
  protocols: [],
  applications: [],
  assignment: "unassigned",
  storage: ["vault"],
  updatedAt: "2026-11-14T00:00:00Z",
  ...patch,
});
const fields = (patch: Partial<VaultSearchFields> = {}): VaultSearchFields => ({
  name: "NAS operator",
  tags: ["Finance"],
  types: ["Username", "Password"],
  assignments: "Webmin (https)",
  ...patch,
});
const search = (patch: object) =>
  compileVaultSearch({ ...DEFAULT_VAULT_SEARCH, ...patch });

describe("vault search", () => {
  it("matches every scope case-insensitively by default", () => {
    expect(isDefaultSearch({ ...DEFAULT_VAULT_SEARCH })).toBe(true);
    expect(search({ query: "  nas " }).test(fields())).toBe(true);
    expect(search({ query: "finance" }).test(fields())).toBe(true);
    expect(search({ query: "webmin" }).test(fields())).toBe(true);
    expect(search({ query: "nothing" }).test(fields())).toBe(false);
    expect(search({ query: "" }).empty).toBe(true);
  });
  it("limits matching to the chosen scopes", () => {
    expect(search({ query: "finance", scopes: ["name"] }).test(fields())).toBe(
      false,
    );
    expect(search({ query: "finance", scopes: ["tags"] }).test(fields())).toBe(
      true,
    );
    expect(
      search({ query: "password", scopes: ["types"] }).test(fields()),
    ).toBe(true);
    expect(
      search({ query: "webmin", scopes: ["assignments"] }).test(fields()),
    ).toBe(true);
    expect(isDefaultSearch({ ...DEFAULT_VAULT_SEARCH, scopes: ["name"] })).toBe(
      false,
    );
  });
  it("supports case-sensitive and regular-expression matching", () => {
    expect(search({ query: "nas", caseSensitive: true }).test(fields())).toBe(
      false,
    );
    expect(search({ query: "NAS", caseSensitive: true }).test(fields())).toBe(
      true,
    );
    expect(search({ query: "^NAS\\s+op", regex: true }).test(fields())).toBe(
      true,
    );
    expect(
      search({ query: "^op", regex: true, scopes: ["name"] }).test(fields()),
    ).toBe(false);
  });
  it("reports an invalid pattern instead of throwing, and matches nothing", () => {
    const compiled = search({ query: "([", regex: true });
    expect(compiled.invalid).toBe(true);
    expect(compiled.test(fields())).toBe(false);
  });
});

describe("quick filters and groups", () => {
  it("evaluates metadata-only chips", () => {
    expect(quickFilterMatches(meta(), "recent", NOW)).toBe(true);
    expect(quickFilterMatches(meta(), "stale", NOW)).toBe(false);
    expect(
      quickFilterMatches(
        meta({ updatedAt: "2025-01-01T00:00:00Z" }),
        "stale",
        NOW,
      ),
    ).toBe(true);
    expect(quickFilterMatches(meta({ updatedAt: null }), "stale", NOW)).toBe(
      false,
    );
    expect(quickFilterMatches(meta(), "unassigned", NOW)).toBe(true);
    expect(quickFilterMatches(meta(), "hasTotp", NOW)).toBe(false);
    expect(
      quickFilterMatches(
        meta({ types: ["totp", "privateKey"] }),
        "hasTotp",
        NOW,
      ),
    ).toBe(true);
    expect(
      quickFilterMatches(meta({ types: ["privateKey"] }), "hasPrivateKey", NOW),
    ).toBe(true);
  });
  it("combines active chips with AND and keeps contradictory chips exclusive", () => {
    const row = meta({ types: ["password", "totp"] });
    expect(
      quickFiltersMatch(row, new Set(["hasPassword", "hasTotp"]), NOW),
    ).toBe(true);
    expect(
      quickFiltersMatch(row, new Set(["hasPassword", "assigned"]), NOW),
    ).toBe(false);
    const toggled = toggleQuickFilter(new Set(["assigned"]), "unassigned");
    expect([...toggled]).toEqual(["unassigned"]);
    expect([...toggleQuickFilter(toggled, "unassigned")]).toEqual([]);
  });
  it("counts groups for the sidebar", () => {
    const counts = countVaultGroups([
      meta(),
      meta({
        key: "vault:b",
        tags: ["Finance", "Ops"],
        assignment: "assigned",
      }),
      meta({ key: "connection:c", source: "connection", tags: [] }),
    ]);
    expect(counts).toMatchObject({ all: 3, vault: 2, connections: 1 });
    expect(counts.unassigned).toBe(2);
    expect(counts.tags).toEqual([
      { tag: "Finance", count: 2 },
      { tag: "Ops", count: 1 },
    ]);
  });
});

describe("sorting", () => {
  it("sorts by name, source and updated in both directions", () => {
    const a = meta({
      key: "vault:a",
      name: "Alpha",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const b = meta({
      key: "vault:b",
      name: "Bravo",
      updatedAt: "2026-06-01T00:00:00Z",
    });
    const c = meta({
      key: "connection:c",
      name: "Charlie",
      source: "connection",
      updatedAt: null,
    });
    const order = (sort: "name" | "source" | "updated", dir: "asc" | "desc") =>
      [a, b, c]
        .sort((x, y) => compareCredentialInventory(x, y, sort, dir))
        .map((row) => row.name);
    expect(order("name", "asc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(order("name", "desc")).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(order("updated", "desc")).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(order("source", "asc")[2]).toBe("Bravo");
  });
});

describe("selection", () => {
  const keys = ["a", "b", "c", "d", "e"];
  it("supports click, ctrl-toggle and shift-range gestures", () => {
    let state = selectRow(EMPTY_SELECTION, "b", {}, keys);
    expect([...state.keys]).toEqual(["b"]);
    state = selectRow(state, "d", { ctrl: true }, keys);
    expect([...state.keys].sort()).toEqual(["b", "d"]);
    state = selectRow(state, "b", { ctrl: true }, keys);
    expect([...state.keys]).toEqual(["d"]);
    state = selectRow(
      selectRow(EMPTY_SELECTION, "a", {}, keys),
      "c",
      { shift: true },
      keys,
    );
    expect([...state.keys]).toEqual(["a", "b", "c"]);
    state = selectRow(state, "e", { shift: true, ctrl: true }, keys);
    expect([...state.keys]).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("selects all, prunes vanished rows and moves with arrows", () => {
    expect(selectAll(keys).keys.size).toBe(5);
    const pruned = pruneSelection(selectAll(keys), ["a", "b"]);
    expect([...pruned.keys]).toEqual(["a", "b"]);
    expect(pruneSelection(pruned, ["a", "b"])).toBe(pruned);
    let state = moveSelection(EMPTY_SELECTION, keys, 1, false);
    expect([...state.keys]).toEqual(["a"]);
    state = moveSelection(state, keys, 1, false);
    state = moveSelection(state, keys, 1, true);
    expect([...state.keys]).toEqual(["b", "c"]);
    expect([
      ...moveSelection(
        selectRow(EMPTY_SELECTION, "e", {}, keys),
        keys,
        1,
        false,
      ).keys,
    ]).toEqual(["e"]);
  });
});

describe("shortcuts", () => {
  const press = (key: string, patch: object = {}) =>
    matchVaultShortcut({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      inEditable: false,
      hasTextSelection: false,
      ...patch,
    });
  it("maps the KeePass-style keys", () => {
    expect(press("f", { ctrlKey: true })).toBe("search");
    expect(press("b", { ctrlKey: true })).toBe("copyUsername");
    expect(press("c", { ctrlKey: true })).toBe("copyPassword");
    expect(press("u", { ctrlKey: true })).toBe("openConnection");
    expect(press("Insert")).toBe("create");
    expect(press("Delete")).toBe("delete");
    expect(press("Enter")).toBe("edit");
    expect(press("F1")).toBe("help");
    expect(press("a", { ctrlKey: true })).toBe("selectAll");
  });
  it("never steals editing keys or a text selection", () => {
    expect(press("Delete", { inEditable: true })).toBeNull();
    expect(press("a", { ctrlKey: true, inEditable: true })).toBeNull();
    expect(press("c", { ctrlKey: true, inEditable: true })).toBeNull();
    expect(press("c", { ctrlKey: true, hasTextSelection: true })).toBeNull();
    expect(press("f", { ctrlKey: true, inEditable: true })).toBe("search");
    expect(press("c", { ctrlKey: true, altKey: true })).toBeNull();
  });
  it("documents only shortcuts that have a binding", () => {
    expect(new Set(VAULT_SHORTCUTS.map((s) => s.action)).size).toBe(
      VAULT_SHORTCUTS.length,
    );
  });
});

describe("toolbar overflow split", () => {
  const items = [
    { id: "new", priority: 0, width: 32 },
    { id: "edit", priority: 1, width: 32 },
    { id: "import", priority: 6, width: 32 },
    { id: "help", priority: 8, width: 32 },
  ];
  it("keeps everything when it fits", () => {
    expect(splitToolbarItems(items, 128).overflow).toEqual([]);
    expect(splitToolbarItems(items, Infinity).overflow).toEqual([]);
  });
  it("moves the lowest-priority items into the overflow menu, in order", () => {
    const split = splitToolbarItems(items, 100);
    expect(split.visible).toEqual(["new", "edit"]);
    expect(split.overflow).toEqual(["import", "help"]);
    expect(splitToolbarItems(items, 70).visible).toEqual(["new"]);
    expect(splitToolbarItems(items, 10).visible).toEqual([]);
  });
});

describe("password quality and generator", () => {
  it("rates by estimated entropy", () => {
    expect(passwordQuality("").level).toBe("veryWeak");
    expect(passwordQuality("aaaaaaaa").level).toBe("veryWeak");
    expect(passwordQuality("Tr0ub4dor&3xK9!").bits).toBeGreaterThan(60);
    expect(
      passwordQuality(
        generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 }),
      ).level,
    ).toBe("strong");
  });
  it("respects charset and look-alike options", () => {
    const digits = generatePassword({
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 64,
      lowercase: false,
      uppercase: false,
      symbols: false,
    });
    expect(digits).toMatch(/^[2-9]{64}$/);
    const text = generatePassword({
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 128,
      digits: false,
      symbols: false,
    });
    expect(text).not.toMatch(/[Il1O0o|]/);
    expect(text).toHaveLength(128);
  });
});

describe("vaultManager i18n catalog", () => {
  it("keeps en-US in step with the in-code English source", () => {
    expect(
      (enUS as { vaultManager: Record<string, string> }).vaultManager,
    ).toEqual(VAULT_TEXT);
  });
});
