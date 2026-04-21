#!/usr/bin/env node
// scripts/i18n-residual.mjs
//
// Residual-English detector for the i18n locale files.
//
// For each of the 9 target locales (de, es, fr, pt-PT, it, ru, zh-CN, ja, ko):
//   flatten both en.json and the locale file into a map of dotted key paths → string leaves,
//   then report every leaf where locale[key] === en[key] (case-sensitive, exact match).
//
// Each hit is emitted as:
//   { locale, keyPath, enValue, localeValue, isAcronymMatch }
//
// isAcronymMatch is true when the English value is fully accounted for by
// src/i18n/glossary.json — i.e. the value is inside `terms`, OR it matches one
// of the `patterns` regexes, OR every whitespace-separated token in the value
// is itself either in `terms` or matches a pattern. Those hits are legitimate
// non-translations, not real translation misses.
//
// Usage:
//   node scripts/i18n-residual.mjs                       # writes report to .orchestration/artifacts/...
//   node scripts/i18n-residual.mjs --stdout              # ALSO pretty-print JSON to stdout
//   node scripts/i18n-residual.mjs --locale de           # restrict to one locale
//   node scripts/i18n-residual.mjs --summary             # only print per-locale counts
//
// Exits 0 always (this is a diagnostic tool). Non-existent locale → error.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const LOCALES_DIR = path.join(REPO_ROOT, 'src', 'i18n', 'locales');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src', 'i18n', 'glossary.json');
const ARTIFACT_PATH = path.join(
  REPO_ROOT,
  '.orchestration',
  'artifacts',
  't2-i18n-residuals.json',
);

const TARGET_LOCALES = ['de', 'es', 'fr', 'pt-PT', 'it', 'ru', 'zh-CN', 'ja', 'ko'];

// -------- args --------
const args = process.argv.slice(2);
const ARG_STDOUT = args.includes('--stdout');
const ARG_SUMMARY = args.includes('--summary');
const localeFlagIdx = args.indexOf('--locale');
const ARG_LOCALE = localeFlagIdx >= 0 ? args[localeFlagIdx + 1] : null;

if (ARG_LOCALE && !TARGET_LOCALES.includes(ARG_LOCALE)) {
  console.error(`unknown locale: ${ARG_LOCALE}. valid: ${TARGET_LOCALES.join(', ')}`);
  process.exit(2);
}

// -------- helpers --------

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Flatten a nested translation object into { "a.b.c": "leaf" } entries.
 * Arrays are indexed with bracket notation: "key[0]".
 * Only string leaves are emitted — numbers/booleans/null are skipped.
 */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    // skip comment keys (e.g. "_comment") — convention only, i18n libs ignore _-prefixed keys
    if (k.startsWith('_')) continue;
    const keyPath = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      out[keyPath] = v;
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const itemKey = `${keyPath}[${i}]`;
        if (typeof item === 'string') {
          out[itemKey] = item;
        } else if (item && typeof item === 'object') {
          flatten(item, itemKey, out);
        }
      });
    } else if (typeof v === 'object') {
      flatten(v, keyPath, out);
    }
  }
  return out;
}

/**
 * Build the acronym-match predicate from the glossary file.
 * Returns a function (str) → boolean.
 */
function buildAcronymPredicate(glossary) {
  const termSet = new Set((glossary.terms || []).map((t) => t));
  const patterns = (glossary.patterns || []).map((p) => {
    try {
      return new RegExp(p, 'u');
    } catch {
      return new RegExp(p);
    }
  });

  const isWhole = (s) => {
    if (termSet.has(s)) return true;
    for (const re of patterns) if (re.test(s)) return true;
    return false;
  };

  return (value) => {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed === '') return true;
    if (isWhole(trimmed)) return true;

    // Token-level: every whitespace-separated token must be covered,
    // OR the token is pure punctuation/digits.
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return false;
    const puncDigitRe = /^[\p{P}\p{S}\d]+$/u;
    for (const tok of tokens) {
      if (tok === '') continue;
      // strip trailing punctuation for matching purposes ("SSH," → "SSH")
      const bare = tok.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
      if (bare === '') continue;
      if (puncDigitRe.test(bare)) continue;
      if (isWhole(bare)) continue;
      return false;
    }
    return true;
  };
}

// -------- main --------

function main() {
  if (!fs.existsSync(GLOSSARY_PATH)) {
    console.error(`glossary not found at ${GLOSSARY_PATH}`);
    process.exit(2);
  }
  const glossary = readJson(GLOSSARY_PATH);
  const isAcronym = buildAcronymPredicate(glossary);

  const enPath = path.join(LOCALES_DIR, 'en.json');
  if (!fs.existsSync(enPath)) {
    console.error(`en.json not found at ${enPath}`);
    process.exit(2);
  }
  const enFlat = flatten(readJson(enPath));
  const enKeyCount = Object.keys(enFlat).length;

  const localesToScan = ARG_LOCALE ? [ARG_LOCALE] : TARGET_LOCALES;

  /** @type {Array<{locale:string,keyPath:string,enValue:string,localeValue:string,isAcronymMatch:boolean}>} */
  const hits = [];
  /** @type {Record<string, {total:number, residual:number, acronymMatches:number, realMisses:number, missingKeys:number}>} */
  const perLocale = {};

  for (const locale of localesToScan) {
    const locPath = path.join(LOCALES_DIR, `${locale}.json`);
    if (!fs.existsSync(locPath)) {
      console.error(`[warn] locale file missing: ${locPath} — skipped`);
      continue;
    }
    const locFlat = flatten(readJson(locPath));

    let residual = 0;
    let acronymMatches = 0;
    let realMisses = 0;
    let missingKeys = 0;

    for (const [keyPath, enValue] of Object.entries(enFlat)) {
      const localeValue = locFlat[keyPath];
      if (localeValue === undefined) {
        missingKeys += 1;
        continue;
      }
      if (localeValue === enValue) {
        residual += 1;
        const acronymMatch = isAcronym(enValue);
        if (acronymMatch) acronymMatches += 1;
        else realMisses += 1;
        hits.push({
          locale,
          keyPath,
          enValue,
          localeValue,
          isAcronymMatch: acronymMatch,
        });
      }
    }

    perLocale[locale] = {
      total: enKeyCount,
      residual,
      acronymMatches,
      realMisses,
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

  // write artifact
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

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
      const pct = ((stats.residual / stats.total) * 100).toFixed(1);
      process.stderr.write(
        `${locale.padEnd(6)} residual=${String(stats.residual).padStart(4)} ` +
          `(real=${String(stats.realMisses).padStart(4)}, ` +
          `acronym=${String(stats.acronymMatches).padStart(4)}) ` +
          `missing=${String(stats.missingKeys).padStart(3)} ${pct}%\n`,
      );
    }
    process.stdout.write(`${ARTIFACT_PATH}\n`);
  }
}

main();
