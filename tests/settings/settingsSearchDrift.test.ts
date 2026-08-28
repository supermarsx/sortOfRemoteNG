import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import type { SettingSearchEntry } from "../../src/components/SettingsDialog/settingsSearchIndex/types";
import { SETTINGS_TABS } from "../../src/components/SettingsDialog/settingsConstants";

/* ═══════════════════════════════════════════════════════════════
   Settings search drift guard

   The search index is hand-written beside 122 evolving section components, and
   it rotted badly: 134 rendered settings were unfindable, 82 index entries
   navigated nowhere, and no option value was searchable at all.

   The join key already exists — `settingKey` / `data-setting-key`, which
   `useSettingHighlight` uses to scroll a result into view. This guard parses
   every section component with the TypeScript compiler API (the same technique
   `settingsCoverageMatrix.test.ts` uses) and asserts the index and the rendered
   controls agree in **both** directions, so drift cannot survive CI.

   ── Ratchet ──────────────────────────────────────────────────────
   The pre-existing violations are recorded per tab in
   `searchDriftBaseline/<tab>.json`. The guard fails on any violation *not* in
   the baseline, and on any baseline line that is no longer a violation (so a
   fixed tab must shrink its baseline rather than accumulate dead entries).
   Each t75 Phase-1 executor empties its own tab's file; t75-e8 then asserts
   every file is empty, deletes the directory, and the guard becomes hard.

   A baseline is NOT a place to park a new violation. Fix the index instead.
   ═══════════════════════════════════════════════════════════════ */

const ROOT = process.cwd();
const SECTIONS_DIR = path.join(ROOT, "src/components/SettingsDialog/sections");
const BASELINE_DIR = path.join(__dirname, "searchDriftBaseline");

const TAB_IDS = SETTINGS_TABS.map((t) => t.id);

/* ── File → tab map ───────────────────────────────────────────── */

/**
 * Top-level section files that are not `<Tab>Settings.tsx`, or whose name does
 * not match its tab id.
 */
const FILE_TAB_OVERRIDES: Record<string, string> = {
  "AboutSettings.tsx": "about",
  "AdvancedSettings.tsx": "advanced",
  "AiSettings.tsx": "ai",
  "ApiSettings.tsx": "api",
  "BackendSettings.tsx": "backend",
  "BackupSettings.tsx": "backup",
  "BehaviorSettings.tsx": "behavior",
  "CloudSyncSettings.tsx": "cloudSync",
  "DiagnosticsSettings.tsx": "diagnostics",
  "GeneralSettings.tsx": "general",
  "LanguageSettings.tsx": "language",
  "LayoutSettings.tsx": "layout",
  "MacroSettings.tsx": "macros",
  "McpSettings.tsx": "mcpServer",
  // Rendered by AdvancedSettings.tsx:351.
  "MemoryWatchdogStats.tsx": "advanced",
  "PerformanceSettings.tsx": "performance",
  "ProxySettings.tsx": "proxy",
  "RdpDefaultSettings.tsx": "rdpDefaults",
  "RecordingSettings.tsx": "recording",
  "RecoverySettings.tsx": "recovery",
  "SecuritySettings.tsx": "security",
  "SSHTerminalSettings.tsx": "sshTerminal",
  "StartupSettings.tsx": "startup",
  "ThemeSettings.tsx": "theme",
  "TrustVerificationSettings.tsx": "trust",
  "UpdaterSettings.tsx": "updater",
  "VpnSettings.tsx": "vpn",
  "WebBrowserSettings.tsx": "webBrowser",
};

/** Sub-directories of `sections/` and the tab they belong to. */
const DIR_TAB_MAP: Record<string, string> = {
  apiSettings: "api",
  backup: "backup",
  behavior: "behavior",
  cloudSync: "cloudSync",
  proxy: "proxy",
  rdpDefaults: "rdpDefaults",
  security: "security",
  sshTerminal: "sshTerminal",
  theme: "theme",
};

/** Relative POSIX path of every non-test source file under `sections/`. */
function sectionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(dirent.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(dirent.name)) continue;
      out.push(path.relative(SECTIONS_DIR, full).split(path.sep).join("/"));
    }
  };
  walk(SECTIONS_DIR);
  return out.sort();
}

/** `null` when the file is not mapped — asserted against, never skipped. */
function tabForFile(relative: string): string | null {
  const segments = relative.split("/");
  if (segments.length > 1) return DIR_TAB_MAP[segments[0]] ?? null;
  return FILE_TAB_OVERRIDES[segments[0]] ?? null;
}

/* ── AST extraction ───────────────────────────────────────────── */

interface DeclaredControl {
  key: string;
  tab: string;
  file: string;
  /** Option `value`/`label` strings from a *literal* `options` array. */
  optionStrings: string[];
}

function parse(relative: string): ts.SourceFile {
  const full = path.join(SECTIONS_DIR, relative);
  return ts.createSourceFile(
    full,
    fs.readFileSync(full, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Unwrap `"x"`, `{"x"}` and `{`x`}` (no substitutions) to their text. */
function literalText(
  initializer: ts.JsxAttributeValue | undefined,
): string | null {
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expr = initializer.expression;
    if (ts.isStringLiteral(expr)) return expr.text;
    if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  }
  return null;
}

/**
 * Extract the `value` / `label` strings of a literal `options={[…]}` array.
 *
 * Returns `null` when the array is not a literal (an imported constant, a
 * `.map()`, a computed table). Those are deliberately exempt from the
 * "option values must be indexed" rule — see `.orchestration/plans/t75.md`
 * risk 3 — because the guard cannot see their contents.
 */
function literalOptionStrings(
  initializer: ts.JsxAttributeValue | undefined,
): string[] | null {
  if (!initializer || !ts.isJsxExpression(initializer)) return null;
  const expr = initializer.expression;
  if (!expr || !ts.isArrayLiteralExpression(expr)) return null;

  const strings: string[] = [];
  for (const element of expr.elements) {
    if (ts.isStringLiteral(element)) {
      strings.push(element.text);
      continue;
    }
    if (!ts.isObjectLiteralExpression(element)) return null;
    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;
      if (name !== "value" && name !== "label") continue;
      if (ts.isStringLiteral(prop.initializer)) {
        strings.push(prop.initializer.text);
      } else if (ts.isNumericLiteral(prop.initializer)) {
        strings.push(prop.initializer.text);
      }
    }
  }
  return strings;
}

function extractControls(relative: string, tab: string): DeclaredControl[] {
  const sf = parse(relative);
  const controls: DeclaredControl[] = [];

  const visitAttributes = (attributes: ts.JsxAttributes) => {
    let key: string | null = null;
    let optionStrings: string[] | null = null;

    for (const attribute of attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = ts.isIdentifier(attribute.name)
        ? attribute.name.text
        : attribute.name.getText(sf);
      if (name === "settingKey" || name === "data-setting-key") {
        key = literalText(attribute.initializer) ?? key;
      } else if (name === "options") {
        optionStrings = literalOptionStrings(attribute.initializer);
      }
    }

    if (key) {
      controls.push({
        key,
        tab,
        file: relative,
        optionStrings: optionStrings ?? [],
      });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      visitAttributes(node.attributes);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return controls;
}

/* ── Baseline ─────────────────────────────────────────────────── */

interface TabBaseline {
  tab: string;
  /** Keys rendered by this tab that have no index entry at all. */
  missingFromIndex: string[];
  /** Index keys in this tab that no control renders (dead results). */
  orphanEntries: string[];
  /** `"<key> declared in <tab>"` — entry filed under the wrong tab. */
  wrongSection: string[];
  /** `"<key>: <option string>"` — literal option not present in `values`. */
  missingOptionValues: string[];
  /** `true` while the tab has no index entries at all. */
  tabHasNoEntries: boolean;
}

function emptyBaseline(tab: string): TabBaseline {
  return {
    tab,
    missingFromIndex: [],
    orphanEntries: [],
    wrongSection: [],
    missingOptionValues: [],
    tabHasNoEntries: false,
  };
}

function readBaseline(tab: string): TabBaseline {
  const file = path.join(BASELINE_DIR, `${tab}.json`);
  if (!fs.existsSync(file)) return emptyBaseline(tab);
  const parsed = JSON.parse(
    fs.readFileSync(file, "utf8"),
  ) as Partial<TabBaseline>;
  return { ...emptyBaseline(tab), ...parsed, tab };
}

/** `true` once the ratchet has been removed (t75-e8). */
const RATCHET_ACTIVE = fs.existsSync(BASELINE_DIR);

/* ── Actual violations ────────────────────────────────────────── */

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface Analysis {
  files: string[];
  unmappedFiles: string[];
  violations: Map<string, TabBaseline>;
}

function analyse(): Analysis {
  const files = sectionFiles();
  const unmappedFiles: string[] = [];
  const controls: DeclaredControl[] = [];

  for (const file of files) {
    const tab = tabForFile(file);
    if (!tab) {
      unmappedFiles.push(file);
      continue;
    }
    controls.push(...extractControls(file, tab));
  }

  /** key → tabs that declare it. */
  const declaringTabs = new Map<string, Set<string>>();
  /** key → union of literal option strings across every control declaring it. */
  const optionsByKey = new Map<string, Set<string>>();
  for (const control of controls) {
    if (!declaringTabs.has(control.key))
      declaringTabs.set(control.key, new Set());
    declaringTabs.get(control.key)!.add(control.tab);
    if (control.optionStrings.length === 0) continue;
    if (!optionsByKey.has(control.key))
      optionsByKey.set(control.key, new Set());
    const bucket = optionsByKey.get(control.key)!;
    for (const option of control.optionStrings) bucket.add(option);
  }

  /** key → index entries (an entry may legitimately be one per key). */
  const entriesByKey = new Map<string, SettingSearchEntry[]>();
  for (const entry of SETTINGS_SEARCH_INDEX) {
    const bucket = entriesByKey.get(entry.key) ?? [];
    bucket.push(entry);
    entriesByKey.set(entry.key, bucket);
  }

  const violations = new Map<string, TabBaseline>();
  for (const tab of TAB_IDS) violations.set(tab, emptyBaseline(tab));

  // Rule 1 — no unindexed setting. Rule 5 — option values indexed.
  for (const [key, tabs] of declaringTabs) {
    const entries = entriesByKey.get(key) ?? [];
    for (const tab of tabs) {
      const bucket = violations.get(tab);
      if (!bucket) continue;
      if (entries.length === 0) {
        bucket.missingFromIndex.push(key);
        continue;
      }
      const indexed = new Set<string>();
      for (const entry of entries) {
        for (const value of entry.values ?? []) indexed.add(squash(value));
      }
      for (const option of optionsByKey.get(key) ?? []) {
        const needle = squash(option);
        if (needle && !indexed.has(needle)) {
          bucket.missingOptionValues.push(`${key}: ${option}`);
        }
      }
    }
  }

  // Rules 2 + 6 — no orphan entry; every entry is anchored to a real control.
  // Rule 3 — the entry is filed under the tab that renders it.
  for (const entry of SETTINGS_SEARCH_INDEX) {
    const bucket = violations.get(entry.section);
    if (!bucket) continue;
    const tabs = declaringTabs.get(entry.key);
    if (!tabs || tabs.size === 0) {
      bucket.orphanEntries.push(entry.key);
    } else if (!tabs.has(entry.section)) {
      bucket.wrongSection.push(
        `${entry.key} declared in ${[...tabs].sort().join(", ")}`,
      );
    }
  }

  // Rule 4 — every tab is represented.
  const tabsWithEntries = new Set(SETTINGS_SEARCH_INDEX.map((e) => e.section));
  for (const tab of TAB_IDS) {
    if (!tabsWithEntries.has(tab)) violations.get(tab)!.tabHasNoEntries = true;
  }

  for (const bucket of violations.values()) {
    bucket.missingFromIndex = [...new Set(bucket.missingFromIndex)].sort();
    bucket.orphanEntries = [...new Set(bucket.orphanEntries)].sort();
    bucket.wrongSection = [...new Set(bucket.wrongSection)].sort();
    bucket.missingOptionValues = [
      ...new Set(bucket.missingOptionValues),
    ].sort();
  }

  return { files, unmappedFiles, violations };
}

const analysis = analyse();

/**
 * Regenerate the ratchet baselines from the current tree:
 *
 * ```
 * T75_WRITE_SEARCH_DRIFT_BASELINE=1 npx vitest run tests/settings/settingsSearchDrift.test.ts
 * ```
 *
 * Only useful while the ratchet exists. **Never run this to make a failure go
 * away** — a violation belongs in the index, not in the baseline. t75-e8 deletes
 * this block together with `searchDriftBaseline/`.
 */
if (process.env.T75_WRITE_SEARCH_DRIFT_BASELINE === "1" && RATCHET_ACTIVE) {
  for (const tab of TAB_IDS) {
    fs.writeFileSync(
      path.join(BASELINE_DIR, `${tab}.json`),
      `${JSON.stringify(analysis.violations.get(tab), null, 2)}\n`,
      "utf8",
    );
  }
}

/** Everything in `actual` that the baseline does not already excuse. */
function unexcused(actual: string[], baseline: string[]): string[] {
  const known = new Set(baseline);
  return actual.filter((value) => !known.has(value));
}

/** Baseline lines that are no longer violations — must be deleted. */
function stale(actual: string[], baseline: string[]): string[] {
  const current = new Set(actual);
  return baseline.filter((value) => !current.has(value));
}

/* ── Tests ────────────────────────────────────────────────────── */

describe("settings search drift guard", () => {
  it("maps every section source file to a settings tab", () => {
    // A new section file must be claimed by the map, so it fails loudly here
    // rather than being silently excluded from every rule below.
    expect(analysis.unmappedFiles).toEqual([]);
    expect(analysis.files.length).toBeGreaterThan(100);
  });

  it("declares a tab id the sidebar actually renders", () => {
    const known = new Set(TAB_IDS);
    const unknown = [
      ...new Set(
        SETTINGS_SEARCH_INDEX.filter((e) => !known.has(e.section)).map(
          (e) => `${e.key} -> ${e.section}`,
        ),
      ),
    ].sort();
    expect(unknown).toEqual([]);
  });

  it("gives every entry the fields the schema requires", () => {
    const broken = SETTINGS_SEARCH_INDEX.filter(
      (e) =>
        !e.key ||
        !e.label ||
        typeof e.description !== "string" ||
        !Array.isArray(e.tags) ||
        !e.sectionLabel,
    ).map((e) => e.key || "<no key>");
    expect(broken).toEqual([]);
  });

  describe.each(TAB_IDS.map((tab) => ({ tab })))("$tab", ({ tab }) => {
    const actual = analysis.violations.get(tab)!;
    const baseline = readBaseline(tab);

    it("indexes every setting the tab renders", () => {
      expect(
        unexcused(actual.missingFromIndex, baseline.missingFromIndex),
      ).toEqual([]);
    });

    it("has no index entry that navigates nowhere", () => {
      expect(unexcused(actual.orphanEntries, baseline.orphanEntries)).toEqual(
        [],
      );
    });

    it("files every entry under the tab that renders it", () => {
      expect(unexcused(actual.wrongSection, baseline.wrongSection)).toEqual([]);
    });

    it("indexes every literal option value", () => {
      expect(
        unexcused(actual.missingOptionValues, baseline.missingOptionValues),
      ).toEqual([]);
    });

    it("is represented in the index", () => {
      if (baseline.tabHasNoEntries) return;
      expect(actual.tabHasNoEntries).toBe(false);
    });

    it.runIf(RATCHET_ACTIVE)("has no stale baseline entries", () => {
      expect({
        missingFromIndex: stale(
          actual.missingFromIndex,
          baseline.missingFromIndex,
        ),
        orphanEntries: stale(actual.orphanEntries, baseline.orphanEntries),
        wrongSection: stale(actual.wrongSection, baseline.wrongSection),
        missingOptionValues: stale(
          actual.missingOptionValues,
          baseline.missingOptionValues,
        ),
        tabHasNoEntries: baseline.tabHasNoEntries && !actual.tabHasNoEntries,
      }).toEqual({
        missingFromIndex: [],
        orphanEntries: [],
        wrongSection: [],
        missingOptionValues: [],
        tabHasNoEntries: false,
      });
    });
  });
});
