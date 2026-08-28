import type { SettingSearchEntry } from "./settingsSearchIndex/types";

/* ═══════════════════════════════════════════════════════════════
   Settings search matcher

   Pure, React-free and unit-tested (`tests/settings/settingsSearchMatch.test.ts`).

   Three properties the old `String.includes(query)` matcher lacked:

   1. **Tokenisation** — every whitespace-separated token must match somewhere in
      the entry (AND semantics), so `proxy port`, `dark theme`, `backup schedule`
      and `smart card` resolve even when the words live in different fields.
   2. **Squashing** — a second `[^a-z0-9]`-stripped form of both query and
      haystack, so `auto-save` ≡ `autosave`, `H.264` ≡ `h264`,
      `wake on lan` ≡ `wakeonlan`, `self signed` ≡ `self-signed`.
   3. **Full field coverage** — `values` (every option label *and* value),
      `synonyms` and `sectionLabel` join `label` / `description` / `tags` / `key`,
      plus the resolved translations of `labelKey` / `descriptionKey`.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Minimal shape of i18next's `t`, so this module stays React-free.
 *
 * Deliberately single-argument: i18next's `TFunction` overloads make a
 * `(key, fallback?)` signature structurally incompatible, and the matcher only
 * ever needs the resolved string.
 */
export type SettingsTranslate = (key: string) => string;

export interface SettingsMatchOptions {
  /** Resolves `labelKey` / `descriptionKey` so search works in the UI language. */
  t?: SettingsTranslate;
}

/* ── Normalisation ────────────────────────────────────────────── */

/** Lower-case, collapse whitespace, trim. */
export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Lower-case and strip everything that is not `[a-z0-9]`. */
export function squashSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Split a query into whitespace-separated tokens. */
export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

/* ── Field tiers ──────────────────────────────────────────────── */

/**
 * Ranking tiers, best first: exact label > label prefix > label substring >
 * value/option > synonym/tag > sectionLabel > description > key.
 *
 * A field scores `tier + WHOLE_QUERY_BONUS` when the entire query matches it
 * contiguously, and plain `tier` when the query's tokens are merely spread
 * across it — so a contiguous hit always outranks a scattered one of the same
 * kind, while any label hit still outranks any key hit.
 */
const TIER = {
  labelExact: 100,
  labelPrefix: 90,
  label: 80,
  values: 70,
  synonyms: 62,
  tags: 60,
  sectionLabel: 50,
  description: 40,
  key: 30,
} as const;

const WHOLE_QUERY_BONUS = 5;

/** A haystack field: the normalised and squashed forms of its strings. */
interface HaystackField {
  norm: string[];
  squash: string[];
}

function buildField(values: readonly (string | undefined)[]): HaystackField {
  const norm: string[] = [];
  const squash: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const n = normalizeSearchText(value);
    if (!n) continue;
    norm.push(n);
    const s = squashSearchText(value);
    if (s) squash.push(s);
  }
  return { norm, squash };
}

function fieldContains(field: HaystackField, needle: string): boolean {
  if (!needle) return false;
  for (const value of field.norm) if (value.includes(needle)) return true;
  const squashed = squashSearchText(needle);
  if (!squashed) return false;
  for (const value of field.squash) if (value.includes(squashed)) return true;
  return false;
}

function fieldStartsWith(field: HaystackField, needle: string): boolean {
  if (!needle) return false;
  for (const value of field.norm) if (value.startsWith(needle)) return true;
  const squashed = squashSearchText(needle);
  if (!squashed) return false;
  for (const value of field.squash) if (value.startsWith(squashed)) return true;
  return false;
}

function fieldEquals(field: HaystackField, needle: string): boolean {
  if (!needle) return false;
  for (const value of field.norm) if (value === needle) return true;
  const squashed = squashSearchText(needle);
  if (!squashed) return false;
  for (const value of field.squash) if (value === squashed) return true;
  return false;
}

/* ── Haystack ─────────────────────────────────────────────────── */

interface EntryHaystack {
  label: HaystackField;
  values: HaystackField;
  synonyms: HaystackField;
  tags: HaystackField;
  sectionLabel: HaystackField;
  description: HaystackField;
  key: HaystackField;
}

/**
 * i18next returns the key itself when a translation is missing; only fold a
 * resolved string into the haystack when it actually differs from the key.
 */
function translated(
  key: string | undefined,
  t: SettingsTranslate | undefined,
): string | undefined {
  if (!key || !t) return undefined;
  let value: string;
  try {
    value = t(key);
  } catch {
    return undefined;
  }
  if (!value || value === key) return undefined;
  return value;
}

function buildHaystack(
  entry: SettingSearchEntry,
  t: SettingsTranslate | undefined,
): EntryHaystack {
  return {
    label: buildField([entry.label, translated(entry.labelKey, t)]),
    values: buildField(entry.values ?? []),
    synonyms: buildField(entry.synonyms ?? []),
    // Tags are lower-cased here rather than trusted to be lower-case already —
    // the old matcher compared raw tags and would have silently dropped any
    // entry whose tag carried a capital letter.
    tags: buildField(entry.tags ?? []),
    sectionLabel: buildField([entry.sectionLabel]),
    description: buildField([
      entry.description,
      translated(entry.descriptionKey, t),
    ]),
    key: buildField([entry.key]),
  };
}

/* ── Scoring ──────────────────────────────────────────────────── */

function scoreField(
  field: HaystackField,
  queryNorm: string,
  tokens: readonly string[],
  tier: number,
): number {
  if (fieldContains(field, queryNorm)) return tier + WHOLE_QUERY_BONUS;
  if (
    tokens.length > 1 &&
    tokens.every((token) => fieldContains(field, token))
  ) {
    return tier;
  }
  return 0;
}

/**
 * Score one entry against a query.
 *
 * Returns `0` when the entry does not match at all. Matching requires **every**
 * query token to be found somewhere in the entry; the score is then the best
 * tier any single field achieves.
 */
export function scoreSettingsEntry(
  entry: SettingSearchEntry,
  query: string,
  options: SettingsMatchOptions = {},
): number {
  const queryNorm = normalizeSearchText(query);
  if (!queryNorm) return 0;
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return 0;

  const hay = buildHaystack(entry, options.t);
  const fields = [
    hay.label,
    hay.values,
    hay.synonyms,
    hay.tags,
    hay.sectionLabel,
    hay.description,
    hay.key,
  ];

  // AND semantics: a token unmatched by every field disqualifies the entry.
  for (const token of tokens) {
    if (!fields.some((field) => fieldContains(field, token))) return 0;
  }

  let best = 0;
  if (fieldEquals(hay.label, queryNorm)) best = TIER.labelExact;
  else if (fieldStartsWith(hay.label, queryNorm)) best = TIER.labelPrefix;

  const scored: Array<[HaystackField, number]> = [
    [hay.label, TIER.label],
    [hay.values, TIER.values],
    [hay.synonyms, TIER.synonyms],
    [hay.tags, TIER.tags],
    [hay.sectionLabel, TIER.sectionLabel],
    [hay.description, TIER.description],
    [hay.key, TIER.key],
  ];
  for (const [field, tier] of scored) {
    const score = scoreField(field, queryNorm, tokens, tier);
    if (score > best) best = score;
  }

  // Every token matched, but no single field carried the whole query and no
  // field carried all the tokens: the match is spread across fields. Still a
  // hit — rank it below the weakest single-field tier.
  return best > 0 ? best : 1;
}

/* ── Public matcher ───────────────────────────────────────────── */

/**
 * Filter and rank `entries` against `query`, best first.
 *
 * Ties are broken by the entry's position in the source array. The barrel
 * (`settingsSearchIndex/index.ts`) concatenates the per-tab modules in
 * `SETTINGS_TABS` order, so that tie-break is tab order.
 */
export function matchSettingsEntries(
  entries: readonly SettingSearchEntry[],
  query: string,
  options: SettingsMatchOptions = {},
): SettingSearchEntry[] {
  if (!normalizeSearchText(query)) return [];

  const scored: Array<{
    entry: SettingSearchEntry;
    score: number;
    order: number;
  }> = [];
  entries.forEach((entry, order) => {
    const score = scoreSettingsEntry(entry, query, options);
    if (score > 0) scored.push({ entry, score, order });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.entry);
}
