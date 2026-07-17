#!/usr/bin/env node
// scripts/i18n-residual.mjs
//
// Residual-English detector + translation-audit triage for the i18n locale files.
//
// For each of the 9 target locales (de-DE, es-ES, fr-FR, pt-PT, it-IT, ru-RU,
// zh-CN, ja-JP, ko-KR):
//   flatten both en-US.json and the locale file into a map of dotted key paths → string
//   leaves, then report every leaf where locale[key] === en[key] (case-sensitive, exact
//   match), plus (de-DE only) every leaf whose value is ASCII-mangled German.
//
// ---------------------------------------------------------------------------
// THIS IS A TRIAGE FILTER, NOT A VERDICT. Read this before "improving" it.
// ---------------------------------------------------------------------------
// A value that equals its English source is not necessarily untranslated:
// "Name *" IS German, "{{name}} ({{layers}})" is pure interpolation, "Error" IS
// Spanish. In proxyChainMenu.* — a namespace that is 100% hand-translated and
// known-good — the naive `locale[key] === en[key]` rule reports 9 hits and 8 of
// them are wrong. No predicate can decide these cases, because deciding them
// requires knowing the target language.
//
// So this script does NOT decide. It emits a CANDIDATE LIST for a human, with a
// `likelyLegit` HINT and the `reason` that produced it. The human translator
// decides every string. Corollaries, which the tuning depends on:
//
//   * A false positive costs a translator ten seconds. A false negative ships
//     rot. When tuning, ALWAYS err toward flagging.
//   * NEVER reduce this to `value !== en.value`. That is the trap this whole
//     design exists to avoid.
//   * `likelyLegit: true` does NOT remove an entry from the candidate list. It
//     only sorts it. Nothing here is ever silently dropped.
//
// The predicate (see isLegitimate) layers four rules, cheapest first:
//   1. interpolation-only — strip {{tokens}}/%s/%d; if no letters remain, there
//      is nothing to translate. ("{{name}} ({{layers}})")
//   2. glossary whole-value / token-wise — `terms` + `patterns` from
//      src/i18n/glossary.json. Locale-independent. ("SSH", "HTTPS")
//   3. cognate — glossary `cognates[locale]`, matched against the whole
//      normalised value. Locale-SPECIFIC. ("Name" in de-DE, "Error" in es-ES)
//   4. otherwise → reason "none", likelyLegit false: a real candidate.
//
// Validation that the filter is sound (do not regress these — they are the
// evidence it triages rather than suppresses):
//   * on proxyChainMenu.* (hand-translated, known-good) it must flag FEW.
//   * on integrations.* (never translated) it must still flag ~3,285/locale.
//     A big drop there means it is HIDING REAL ROT, which is the dangerous
//     failure — it would silently shrink the follow-up task's scope.
//
// Usage:
//   node scripts/i18n-residual.mjs                       # writes report + audit files
//   node scripts/i18n-residual.mjs --stdout              # ALSO pretty-print JSON to stdout
//   node scripts/i18n-residual.mjs --locale de-DE        # restrict to one locale
//   node scripts/i18n-residual.mjs --summary             # only print per-locale counts
//   node scripts/i18n-residual.mjs --namespace proxyChainMenu   # restrict to a key prefix
//
// Exits 0 always (this is a diagnostic tool). Non-existent locale → error.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const LOCALES_DIR = path.join(REPO_ROOT, "src", "i18n", "locales");
const GLOSSARY_PATH = path.join(REPO_ROOT, "src", "i18n", "glossary.json");
const ARTIFACT_PATH = path.join(
  REPO_ROOT,
  ".orchestration",
  "artifacts",
  "t2-i18n-residuals.json",
);
const AUDIT_DIR = path.join(REPO_ROOT, ".orchestration", "i18n-audit");

// Regioned BCP-47 codes (a1's rename, b5d59086). en-US is the source, never a target.
const EN_LOCALE = "en-US";
const TARGET_LOCALES = [
  "de-DE",
  "es-ES",
  "fr-FR",
  "pt-PT",
  "it-IT",
  "ru-RU",
  "zh-CN",
  "ja-JP",
  "ko-KR",
];

// Candidates under this prefix are deferred to the follow-on task (t52); phase-3
// executors skip them. Emitted with deferred:true so the skip is a field, not a
// comment — see the audit-file contract.
const DEFERRED_PREFIX = "integrations.";

// -------- args --------
const args = process.argv.slice(2);
const ARG_STDOUT = args.includes("--stdout");
const ARG_SUMMARY = args.includes("--summary");
const localeFlagIdx = args.indexOf("--locale");
const ARG_LOCALE = localeFlagIdx >= 0 ? args[localeFlagIdx + 1] : null;
const nsFlagIdx = args.indexOf("--namespace");
const ARG_NAMESPACE = nsFlagIdx >= 0 ? args[nsFlagIdx + 1] : null;

if (ARG_LOCALE && !TARGET_LOCALES.includes(ARG_LOCALE)) {
  console.error(
    `unknown locale: ${ARG_LOCALE}. valid: ${TARGET_LOCALES.join(", ")}`,
  );
  process.exit(2);
}

// -------- helpers --------

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * Flatten a nested translation object into { "a.b.c": "leaf" } entries.
 * Arrays are indexed with bracket notation: "key[0]".
 * Only string leaves are emitted — numbers/booleans/null are skipped.
 */
function flatten(obj, prefix = "", out = {}) {
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    // skip comment keys (e.g. "_comment") — convention only, i18n libs ignore _-prefixed keys
    if (k.startsWith("_")) continue;
    const keyPath = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      out[keyPath] = v;
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const itemKey = `${keyPath}[${i}]`;
        if (typeof item === "string") {
          out[itemKey] = item;
        } else if (item && typeof item === "object") {
          flatten(item, itemKey, out);
        }
      });
    } else if (typeof v === "object") {
      flatten(v, keyPath, out);
    }
  }
  return out;
}

// i18next interpolation ({{x}}), printf placeholders (%s/%d) and nesting ($t(...)).
const INTERPOLATION_RE = /\{\{[^}]*\}\}|\$t\([^)]*\)|%[sd]/gu;
// A bare file extension, with or without wrapping parens: ".ovpn", "(.conf)".
const FILE_EXT_RE = /^\(?\.[A-Za-z0-9]{1,8}\)?$/u;
const PUNCT_DIGIT_RE = /^[\p{P}\p{S}\d]+$/u;
const HAS_LETTER_RE = /\p{L}/u;

const stripInterpolation = (s) => s.replace(INTERPOLATION_RE, " ");
const stripOuterPunct = (s) =>
  s.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");

/**
 * Build the strengthened triage predicate from the glossary file.
 *
 * Returns (value, locale) → { legit: boolean, reason: string }, where reason is
 * one of "interpolation-only" | "glossary" | "cognate" | "none".
 *
 * `legit: true` means "probably fine, look at it last" — NOT "verified correct".
 * See the header. Nothing this returns is authoritative.
 */
function buildTriagePredicate(glossary) {
  const termSet = new Set(glossary.terms || []);
  const patterns = (glossary.patterns || []).map((p) => {
    try {
      return new RegExp(p, "u");
    } catch {
      return new RegExp(p);
    }
  });
  // Per-locale cognate sets. Absent locale → empty set → nothing is excused,
  // which is the safe direction.
  const cognateSets = new Map(
    Object.entries(glossary.cognates || {}).map(([loc, words]) => [
      loc,
      new Set(words || []),
    ]),
  );

  const isWhole = (s) => {
    if (termSet.has(s)) return true;
    for (const re of patterns) if (re.test(s)) return true;
    return false;
  };

  /** Every letter-bearing token is covered by the glossary. */
  const isGlossaryCovered = (text) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    for (const tok of tokens) {
      if (FILE_EXT_RE.test(tok)) continue;
      const bare = tok.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
      if (bare === "") continue;
      if (PUNCT_DIGIT_RE.test(bare)) continue;
      if (isWhole(bare)) continue;
      return false;
    }
    return true;
  };

  return (value, locale) => {
    if (!value || typeof value !== "string")
      return { legit: false, reason: "none" };
    const trimmed = value.trim();
    if (trimmed === "") return { legit: true, reason: "interpolation-only" };

    // 1. Whole value is a glossary term/pattern ("SSH", "1.2.3", "https://…").
    if (isWhole(trimmed)) return { legit: true, reason: "glossary" };

    // 2. Interpolation-only: nothing left to translate once tokens are removed.
    //    "{{name}} ({{layers}})" → "  ( )" → no letters → legit.
    const stripped = stripInterpolation(trimmed);
    if (!HAS_LETTER_RE.test(stripped)) {
      return { legit: true, reason: "interpolation-only" };
    }

    // 3. Token-wise glossary, over the interpolation-stripped text. This is what
    //    rescues "localhost:{{localPort}} → {{remoteHost}}:{{remotePort}}" and
    //    "OpenVPN (.ovpn)".
    if (isGlossaryCovered(stripped)) return { legit: true, reason: "glossary" };

    // 4. Per-locale cognate, matched against the WHOLE normalised value rather
    //    than token-wise. Deliberate: "Status" alone is correct German, but
    //    "Status Filter" is "Statusfilter" — a token-wise cognate rule would
    //    excuse the phrase too and hide a real miss.
    const cognates = cognateSets.get(locale);
    if (cognates && cognates.size > 0) {
      const normalised = stripOuterPunct(stripped.trim());
      if (cognates.has(normalised)) return { legit: true, reason: "cognate" };
    }

    return { legit: false, reason: "none" };
  };
}

/**
 * Build the de-DE ASCII-mangling detector (glossary.mangledDe.stems).
 *
 * These values do NOT equal their English source, so the residual scan cannot
 * see them: "Delete" → "Loeschen" is "translated", just mangled. This is a
 * second, independent pass. Returns (value) → matched stem | null.
 */
function buildMangleDetector(glossary) {
  const stems = (glossary.mangledDe && glossary.mangledDe.stems) || [];
  if (stems.length === 0) return () => null;
  const byStem = stems.map((s) => ({ stem: s, re: new RegExp(s, "iu") }));
  return (value) => {
    if (!value || typeof value !== "string") return null;
    for (const { stem, re } of byStem) if (re.test(value)) return stem;
    return null;
  };
}

// -------- main --------

function main() {
  if (!fs.existsSync(GLOSSARY_PATH)) {
    console.error(`glossary not found at ${GLOSSARY_PATH}`);
    process.exit(2);
  }
  const glossary = readJson(GLOSSARY_PATH);
  const triage = buildTriagePredicate(glossary);
  const detectMangle = buildMangleDetector(glossary);

  const enPath = path.join(LOCALES_DIR, `${EN_LOCALE}.json`);
  if (!fs.existsSync(enPath)) {
    console.error(`${EN_LOCALE}.json not found at ${enPath}`);
    process.exit(2);
  }
  const enFlat = flatten(readJson(enPath));
  const enKeyCount = Object.keys(enFlat).length;

  const localesToScan = ARG_LOCALE ? [ARG_LOCALE] : TARGET_LOCALES;
  const nsFilter = (keyPath) =>
    !ARG_NAMESPACE || keyPath.startsWith(ARG_NAMESPACE);

  /** @type {Array<object>} legacy flat hit list, kept for the report artifact. */
  const hits = [];
  /** @type {Record<string, object>} */
  const perLocale = {};
  /** @type {Record<string, Array<object>>} per-locale audit candidate lists. */
  const auditByLocale = {};

  for (const locale of localesToScan) {
    const locPath = path.join(LOCALES_DIR, `${locale}.json`);
    if (!fs.existsSync(locPath)) {
      console.error(`[warn] locale file missing: ${locPath} — skipped`);
      continue;
    }
    const locFlat = flatten(readJson(locPath));
    const candidates = [];

    let residual = 0;
    let legitCount = 0;
    let realMisses = 0;
    let missingKeys = 0;
    let mangled = 0;
    let realMissesNonInteg = 0;
    let realMissesInteg = 0;

    for (const [keyPath, enValue] of Object.entries(enFlat)) {
      if (!nsFilter(keyPath)) continue;
      const localeValue = locFlat[keyPath];
      if (localeValue === undefined) {
        missingKeys += 1;
        continue;
      }
      const deferred = keyPath.startsWith(DEFERRED_PREFIX);

      if (localeValue === enValue) {
        // Residual: value never diverged from English. Triage decides the hint.
        residual += 1;
        const { legit, reason } = triage(enValue, locale);
        if (legit) legitCount += 1;
        else {
          realMisses += 1;
          if (deferred) realMissesInteg += 1;
          else realMissesNonInteg += 1;
        }
        hits.push({
          locale,
          keyPath,
          enValue,
          localeValue,
          isAcronymMatch: legit,
        });
        candidates.push({
          keyPath,
          enValue,
          localeValue,
          likelyLegit: legit,
          reason,
          deferred,
        });
      } else if (locale === "de-DE") {
        // Diverged, so the residual scan can't see it — but de-DE carries a class
        // of ASCII-mangled German ("Loeschen" for "Löschen") that is real rot.
        const stem = detectMangle(localeValue);
        if (stem) {
          mangled += 1;
          if (deferred) realMissesInteg += 1;
          else realMissesNonInteg += 1;
          candidates.push({
            keyPath,
            enValue,
            localeValue,
            likelyLegit: false,
            reason: "mangled",
            mangledStem: stem,
            deferred,
          });
        }
      }
    }

    // Real work first (not legit, not deferred), then the rest, keyPath-stable
    // within each band. Executors can also just filter on the fields.
    const rank = (c) => (c.deferred ? 2 : 0) + (c.likelyLegit ? 1 : 0);
    candidates.sort(
      (a, b) => rank(a) - rank(b) || a.keyPath.localeCompare(b.keyPath),
    );

    auditByLocale[locale] = candidates;
    perLocale[locale] = {
      total: enKeyCount,
      residual,
      legit: legitCount,
      realMisses,
      realMissesNonInteg,
      realMissesInteg,
      mangled,
      missingKeys,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    enLeafCount: enKeyCount,
    glossaryTermCount: (glossary.terms || []).length,
    glossaryPatternCount: (glossary.patterns || []).length,
    perLocale,
    hits,
  };

  // write residual artifact
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(
    ARTIFACT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  // write per-locale audit files (skip when a --namespace filter is active, so a
  // partial scan can never overwrite a full audit file with a subset)
  if (!ARG_NAMESPACE) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    for (const [locale, candidates] of Object.entries(auditByLocale)) {
      const stats = perLocale[locale];
      const auditDoc = {
        locale,
        generatedAt: report.generatedAt,
        sourceLocale: EN_LOCALE,
        deferredPrefix: DEFERRED_PREFIX,
        summary: {
          candidates: candidates.length,
          actionable: candidates.filter((c) => !c.likelyLegit && !c.deferred)
            .length,
          likelyLegit: candidates.filter((c) => c.likelyLegit).length,
          deferred: candidates.filter((c) => c.deferred).length,
          mangled: stats.mangled,
        },
        candidates,
      };
      fs.writeFileSync(
        path.join(AUDIT_DIR, `${locale}.json`),
        `${JSON.stringify(auditDoc, null, 2)}\n`,
        "utf8",
      );
    }
  }

  // stdout
  if (ARG_SUMMARY) {
    process.stdout.write(
      `${JSON.stringify({ generatedAt: report.generatedAt, enLeafCount: enKeyCount, perLocale }, null, 2)}\n`,
    );
  } else if (ARG_STDOUT) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    // default: brief summary to stderr, JSON file path to stdout
    for (const [locale, stats] of Object.entries(perLocale)) {
      process.stderr.write(
        `${locale.padEnd(6)} residual=${String(stats.residual).padStart(4)} ` +
          `(real=${String(stats.realMisses).padStart(4)}, ` +
          `legit=${String(stats.legit).padStart(4)}) ` +
          `nonInteg=${String(stats.realMissesNonInteg).padStart(4)} ` +
          `integ=${String(stats.realMissesInteg).padStart(4)} ` +
          `mangled=${String(stats.mangled).padStart(3)}\n`,
      );
    }
    process.stdout.write(`${ARTIFACT_PATH}\n`);
  }
}

main();
