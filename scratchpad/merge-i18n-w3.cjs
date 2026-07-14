// Wave-3 i18n fragment -> locale merge.
// Merges src/i18n/integrations/_fragments/{crate}*.json into en.json under
// integrations.<crate>, then propagates new key paths to the other 9 locales
// as English-value fallback (parity-preserving, never overwriting existing).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FRAG_DIR = path.join(ROOT, "src/i18n/integrations/_fragments");
const LOC_DIR = path.join(ROOT, "src/i18n/locales");
const CRATES = ["jira", "osticket", "mailcow", "grafana", "gdrive", "budibase"];
const LOCALES = [
  "de",
  "en",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "pt-PT",
  "ru",
  "zh-CN",
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (isObj(src[k])) {
      if (!isObj(target[k])) target[k] = {};
      deepMerge(target[k], src[k]);
    } else {
      target[k] = src[k];
    }
  }
  return target;
}

// Fill any leaf present in src but missing in target using src's value.
// Never overwrites an existing leaf (preserves real translations).
function fillMissing(target, src) {
  let added = 0;
  for (const k of Object.keys(src)) {
    if (isObj(src[k])) {
      if (!isObj(target[k])) target[k] = {};
      added += fillMissing(target[k], src[k]);
    } else if (!(k in target)) {
      target[k] = src[k];
      added++;
    }
  }
  return added;
}

function leaves(o, p = "") {
  if (!isObj(o)) return p ? [p] : [];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k));
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, o) =>
  fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n");

// ---- 1. Merge fragments into en.json ----
const en = readJson(path.join(LOC_DIR, "en.json"));
en.integrations = en.integrations || {};

const allFrags = fs.readdirSync(FRAG_DIR).filter((f) => f.endsWith(".json"));
const consumed = [];
const perCrate = {};

for (const crate of CRATES) {
  const re = new RegExp(`^${crate}(\\..*)?\\.json$`);
  const frags = allFrags.filter((f) => re.test(f)).sort();
  en.integrations[crate] = en.integrations[crate] || {};
  const before = leaves(en.integrations[crate]).length;
  for (const f of frags) {
    const obj = readJson(path.join(FRAG_DIR, f));
    // Normalize inconsistent fragment rooting:
    //   { integrations: { crate: {...} } }  -> obj.integrations[crate]
    //   { crate: {...} }                    -> obj[crate]   (e.g. osticket.shell)
    //   { <slice>: {...} } or bare content  -> obj          (e.g. mailcow.objects)
    const payload =
      (obj.integrations && obj.integrations[crate]) || obj[crate] || obj;
    deepMerge(en.integrations[crate], payload);
    consumed.push(f);
  }
  const after = leaves(en.integrations[crate]).length;
  perCrate[crate] = { frags, keys: after, added: after - before };
}

writeJson(path.join(LOC_DIR, "en.json"), en);

// ---- 2. Propagate to other 9 locales (English-value fallback) ----
const fillReport = {};
for (const loc of LOCALES) {
  if (loc === "en") continue;
  const data = readJson(path.join(LOC_DIR, `${loc}.json`));
  const added = fillMissing(data, en);
  writeJson(path.join(LOC_DIR, `${loc}.json`), data);
  fillReport[loc] = added;
}

// ---- 3. Validate: valid JSON + equal key structure (parity) ----
const baseLeaves = leaves(readJson(path.join(LOC_DIR, "en.json"))).sort();
const baseSet = new Set(baseLeaves);
let parityOk = true;
for (const loc of LOCALES) {
  const set = new Set(leaves(readJson(path.join(LOC_DIR, `${loc}.json`))));
  const missing = baseLeaves.filter((x) => !set.has(x));
  const extra = [...set].filter((x) => !baseSet.has(x));
  if (missing.length || extra.length) {
    parityOk = false;
    console.log(
      `PARITY FAIL ${loc}: missing=${missing.length} extra=${extra.length}`,
    );
    console.log("  missing:", missing.slice(0, 5));
    console.log("  extra:", extra.slice(0, 5));
  }
}

console.log("=== Wave-3 i18n merge ===");
for (const c of CRATES) {
  console.log(
    `${c.padEnd(9)} frags=[${perCrate[c].frags.join(", ")}] keys=${perCrate[c].keys} added=${perCrate[c].added}`,
  );
}
console.log(
  "fill (EN fallback keys added per locale):",
  JSON.stringify(fillReport),
);
console.log("en total leaves:", baseLeaves.length);
console.log(
  "PARITY:",
  parityOk ? "OK (10 locales equal key structure)" : "FAILED",
);
console.log("consumed fragments:", consumed.join(", "));
