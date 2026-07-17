import { describe, expect, it } from "vitest";

import {
  findDescriptor,
  groupByCategory,
  integrationRegistry,
  type ConnectionTypeCategory,
} from "../../src/types/integrations/registry";
import {
  INTEGRATION_PROTOCOL_OPTIONS,
  PROTOCOL_CATEGORY_LABEL_KEYS,
  PROTOCOL_OPTIONS,
  type ProtocolOption,
} from "../../src/hooks/connection/useConnectionEditor";

/**
 * t56-e9 — the durable anti-orphaning gate.
 *
 * t56 re-categorized 23 integration panels from the old six-bucket
 * `infra | web | database | app-service | mail | vault` scheme into the
 * 14-member `ConnectionTypeCategory` taxonomy. A prior session shipped ~2,260
 * backend commands DARK — implemented but wired to no UI. This test is the
 * guarantee that t56 did not silently re-orphan a panel: every panel must still
 * resolve to a real component, land in a category that actually renders, and be
 * reachable from the connection picker.
 *
 * It operates purely on the registry / descriptor / static-option layer — never
 * on translated locale strings (those are being rewritten by t56-e8). Every
 * assertion keys off category *slugs* and panel *keys*.
 */

// The 14-member ConnectionTypeCategory taxonomy (t56 §3 / C1). This mirrors the
// TS union at the value level so the type can be checked at runtime. It is
// cross-validated below against `PROTOCOL_CATEGORY_LABEL_KEYS`, an exhaustive
// `Record<ConnectionTypeCategory, string>` whose keys TypeScript forces to be
// exactly these 14 — so a change to the union that skipped this file would make
// that cross-check fail rather than pass silently.
const ALL_CATEGORIES: ConnectionTypeCategory[] = [
  "remote-desktop",
  "console",
  "lights-out",
  "virtualization",
  "networking",
  "web-server",
  "mail-server",
  "database",
  "file-storage",
  "cloud",
  "monitoring",
  "vault",
  "management",
  "business-app",
];

// The two categories that are deliberately empty in the interim state (t56 §9,
// user 2026-07-17). Their protocols (ilo/lenovo/supermicro for lights-out; the
// 8 cloud providers) are management-only — `sessionEntry: "none"`, excluded from
// the picker — so no selectable option maps to them yet. This is BY DESIGN and
// DOCUMENTED; t57 will make them openable and MUST update this test when it does.
const CATEGORIES_EMPTY_BY_DESIGN: ConnectionTypeCategory[] = [
  "cloud",
  "lights-out",
];

// The old six category slugs. `database` and `vault` are intentionally NOT here:
// they carry over into the new union unchanged (t56 §3). The four that were
// renamed or split are the stale-slug tripwire — none may survive on a descriptor.
const RETIRED_CATEGORY_SLUGS = ["infra", "web", "app-service", "mail"];

// The frozen anti-orphaning manifest: the 23 integration panels t56 re-tagged,
// each pinned to its §3 target category. The reachability loop is driven by THIS
// list, never by iterating the registry — so a dropped descriptor makes
// `findDescriptor` return undefined and fails loudly, instead of the loop
// silently iterating fewer panels and passing vacuously.
const EXPECTED_PANELS: { key: string; category: ConnectionTypeCategory }[] = [
  // src/components/integrations/descriptors.ts (14)
  { key: "lxd", category: "virtualization" },
  { key: "vmwareDesktop", category: "virtualization" },
  { key: "vmware", category: "virtualization" },
  { key: "pfsense", category: "networking" },
  { key: "nginx", category: "web-server" },
  { key: "haproxy", category: "web-server" },
  { key: "caddy", category: "web-server" },
  { key: "traefik", category: "web-server" },
  { key: "mssql", category: "database" },
  { key: "prometheus", category: "monitoring" },
  { key: "gdrive", category: "file-storage" },
  { key: "grafana", category: "monitoring" },
  { key: "budibase", category: "business-app" },
  { key: "keepass", category: "vault" },
  // src/components/integrations/<crate>/descriptor.ts (9)
  { key: "netbox", category: "networking" },
  { key: "cpanel", category: "management" },
  { key: "ansible", category: "management" },
  { key: "exchange", category: "mail-server" },
  { key: "mail", category: "mail-server" },
  { key: "mailcow", category: "mail-server" },
  { key: "jira", category: "business-app" },
  { key: "osticket", category: "business-app" },
  { key: "php", category: "web-server" },
];

const EXPECTED_PANEL_COUNT = 23;

// Category → sorted panel keys, derived from the manifest. This is the shape
// `groupByCategory()` must reproduce over the registry (10 integration-populated
// categories). Built by reduction so it can never drift from EXPECTED_PANELS.
const EXPECTED_DISTRIBUTION: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const { key, category } of EXPECTED_PANELS) {
    (map[category] ??= []).push(key);
  }
  for (const keys of Object.values(map)) {
    keys.sort();
  }
  return map;
})();

// The 12 categories that ARE populated once built-in protocols are considered:
// the 10 with integration panels plus `remote-desktop` and `console`, which are
// filled entirely by built-in `PROTOCOL_OPTIONS`. = all 14 minus the 2 empty.
const EXPECTED_POPULATED_CATEGORIES = ALL_CATEGORIES.filter(
  (c) => !CATEGORIES_EMPTY_BY_DESIGN.includes(c),
);

const ALL_PICKER_OPTIONS: ProtocolOption[] = [
  ...PROTOCOL_OPTIONS,
  ...INTEGRATION_PROTOCOL_OPTIONS,
];

describe("the 14-category taxonomy is intact (t57 depends on it)", () => {
  it("exposes exactly the 14 ConnectionTypeCategory slugs at runtime", () => {
    // PROTOCOL_CATEGORY_LABEL_KEYS is typed Record<ConnectionTypeCategory, …>,
    // so its keys are the compiler's witness to the full union. If they match
    // our frozen list, the type is exactly the 14 we expect — no additions, no
    // removals, no typos.
    expect(Object.keys(PROTOCOL_CATEGORY_LABEL_KEYS).sort()).toEqual(
      [...ALL_CATEGORIES].sort(),
    );
  });

  it("keeps lights-out and cloud in the type so t57 can populate them", () => {
    for (const category of CATEGORIES_EMPTY_BY_DESIGN) {
      expect(ALL_CATEGORIES).toContain(category);
      expect(PROTOCOL_CATEGORY_LABEL_KEYS[category]).toBeTruthy();
    }
  });
});

describe("the 23 integration panels are fully enumerated", () => {
  it("registers exactly 23 descriptors", () => {
    expect(integrationRegistry).toHaveLength(EXPECTED_PANEL_COUNT);
  });

  it("registers exactly the frozen set of 23 panel keys", () => {
    const actual = integrationRegistry.map((d) => d.key).sort();
    const expected = EXPECTED_PANELS.map((p) => p.key).sort();
    expect(actual).toEqual(expected);
  });

  it("has no duplicate descriptor keys", () => {
    const keys = integrationRegistry.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("every panel resolves to a real component (anti-dark-surface)", () => {
  // Driven by the frozen 23-entry manifest, so this suite always runs 23 cases
  // and can never pass by iterating an empty registry. Each case is both the
  // reachability contract (importPanel resolves to a truthy default) AND the
  // categorization contract (the descriptor lands in its §3 category).
  it.each(EXPECTED_PANELS)(
    "$key is registered, categorized $category, and lazy-loads a panel",
    async ({ key, category }) => {
      const descriptor = findDescriptor(key);
      expect(
        descriptor,
        `panel "${key}" is missing from the registry`,
      ).toBeDefined();
      expect(
        descriptor!.category,
        `panel "${key}" is filed under the wrong category`,
      ).toBe(category);

      const mod = await descriptor!.importPanel();
      expect(
        mod,
        `panel "${key}" importPanel() resolved to nothing`,
      ).toBeTruthy();
      expect(
        mod.default,
        `panel "${key}" module has no default export — it would render dark`,
      ).toBeTruthy();
    },
  );
});

describe("every descriptor uses the new taxonomy — no stale slugs", () => {
  it("files every descriptor under one of the 14 valid categories", () => {
    expect(integrationRegistry).toHaveLength(EXPECTED_PANEL_COUNT);
    for (const descriptor of integrationRegistry) {
      expect(
        ALL_CATEGORIES,
        `${descriptor.key} has an invalid category "${descriptor.category}"`,
      ).toContain(descriptor.category);
    }
  });

  it("leaves no descriptor on a retired six-bucket slug", () => {
    expect(integrationRegistry).toHaveLength(EXPECTED_PANEL_COUNT);
    for (const descriptor of integrationRegistry) {
      expect(
        RETIRED_CATEGORY_SLUGS,
        `${descriptor.key} still carries retired slug "${descriptor.category}"`,
      ).not.toContain(descriptor.category);
    }
  });
});

describe("groupByCategory renders every panel — items sum to 23", () => {
  it("distributes exactly 23 panels, matching the frozen §3 mapping", () => {
    const groups = groupByCategory();

    // Anti-vacuity: prove the grouping actually contains the panels before
    // trusting any count. This whole-shape comparison would catch a panel
    // stranded in a category the `order` array omits (silently `.filter()`ed
    // out) — its keys would go missing from `actual`.
    const actual: Record<string, string[]> = {};
    for (const group of groups) {
      actual[group.category] = group.items.map((i) => i.key).sort();
    }
    expect(actual).toEqual(EXPECTED_DISTRIBUTION);

    // The headline sum — the direct guard against a silent drop.
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(EXPECTED_PANEL_COUNT);
  });

  it("omits empty categories rather than emitting zero-item groups", () => {
    const groups = groupByCategory();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("yields exactly the 10 integration-populated categories", () => {
    // groupByCategory operates on the registry alone, so it surfaces only the
    // categories that have integration descriptors — 10 of the 12 picker
    // categories. remote-desktop and console are populated by built-in
    // protocols (see the picker suite), not by integrations, so they are
    // correctly absent here.
    const emitted = groupByCategory()
      .map((g) => g.category)
      .sort();
    expect(emitted).toEqual(Object.keys(EXPECTED_DISTRIBUTION).sort());
    expect(emitted).not.toContain("remote-desktop");
    expect(emitted).not.toContain("console");
    for (const empty of CATEGORIES_EMPTY_BY_DESIGN) {
      expect(emitted).not.toContain(empty);
    }
  });
});

describe("the connection picker surfaces all 23 panels", () => {
  it("exposes exactly 23 integration options", () => {
    expect(INTEGRATION_PROTOCOL_OPTIONS).toHaveLength(EXPECTED_PANEL_COUNT);
  });

  it("offers an integration:<key> option for every frozen panel key", () => {
    const values = new Set(INTEGRATION_PROTOCOL_OPTIONS.map((o) => o.value));
    for (const { key } of EXPECTED_PANELS) {
      expect(values, `picker is missing option "integration:${key}"`).toContain(
        `integration:${key}`,
      );
    }
  });

  it('drops the last "Integration - " prefix from every option', () => {
    expect(INTEGRATION_PROTOCOL_OPTIONS.length).toBeGreaterThan(0);
    for (const option of INTEGRATION_PROTOCOL_OPTIONS) {
      expect(option.desc).not.toContain("Integration - ");
    }
  });
});

describe("12 categories are populated; lights-out and cloud are empty by design", () => {
  // The picker is the union of built-in and integration options. This is where
  // the 12-vs-14 split is observable: remote-desktop + console come from
  // built-ins, the 10 integration categories from descriptors.
  const populated = new Set(ALL_PICKER_OPTIONS.map((o) => o.category));

  it("covers exactly 12 of the 14 categories", () => {
    expect(ALL_PICKER_OPTIONS.length).toBeGreaterThan(0);
    expect([...populated].sort()).toEqual(
      [...EXPECTED_POPULATED_CATEGORIES].sort(),
    );
    expect(populated.size).toBe(12);
  });

  it("populates the two built-in-only categories (remote-desktop, console)", () => {
    // Anti-vacuity: prove the selector matches for the categories that
    // distinguish 12 from 10 BEFORE asserting the other two are empty.
    expect(populated.has("remote-desktop")).toBe(true);
    expect(populated.has("console")).toBe(true);
    // And a representative integration-only category, to prove that side too.
    expect(populated.has("mail-server")).toBe(true);
  });

  it("pins lights-out and cloud as the ONLY empty categories (flips in t57)", () => {
    const empty = ALL_CATEGORIES.filter((c) => !populated.has(c));
    expect(empty.sort()).toEqual([...CATEGORIES_EMPTY_BY_DESIGN].sort());
  });
});

describe("the old binary protocol/integration group scheme is gone", () => {
  // Note: this asserts on the landed descriptor/option layer, NOT on
  // ConnectionEditor.tsx's ALL_PROTOCOL_OPTIONS. That file's binary `group`
  // field is t56-e7's to remove (blocked on t54) and g1's to gate; asserting on
  // it here would make this test red for work outside e9's deliverable.
  it("gives every ProtocolOption a valid category, never a group field", () => {
    expect(ALL_PICKER_OPTIONS.length).toBeGreaterThan(0);
    for (const option of ALL_PICKER_OPTIONS) {
      expect(option).not.toHaveProperty("group");
      expect(option.category).not.toBe("protocol");
      expect(option.category).not.toBe("integration");
      expect(ALL_CATEGORIES).toContain(option.category);
    }
  });

  it("gives every descriptor a real category and no group field", () => {
    expect(integrationRegistry).toHaveLength(EXPECTED_PANEL_COUNT);
    for (const descriptor of integrationRegistry) {
      expect(descriptor).not.toHaveProperty("group");
      expect(ALL_CATEGORIES).toContain(descriptor.category);
    }
  });
});
