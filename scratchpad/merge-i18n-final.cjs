// Final i18n merge — Waves 4 (web), M (mail), 6 (folds).
// Merges src/i18n/integrations/_fragments/*.json into en.json under the correct
// integrations subtree, then propagates every new key path to the other 9 locales
// as parity-preserving English-value fallback (never overwriting existing).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FRAG_DIR = path.join(ROOT, "src/i18n/integrations/_fragments");
const LOC_DIR = path.join(ROOT, "src/i18n/locales");
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

// ---- Merge plan ----
// Each entry: { file, target, extract }
//   target  = subtree key under en.integrations to deepMerge into
//   extract = fn(obj) -> payload object to merge
const asIntegrationsCrate = (crate) => (obj) =>
  (obj.integrations && obj.integrations[crate]) || obj[crate] || obj;
const asIs = (obj) => obj; // fragment already rooted at the target subtree's children

const PLAN = [
  // Wave 4 web servers — wrapped { integrations: { crate: {...} } }
  {
    file: "caddy.json",
    target: "caddy",
    extract: asIntegrationsCrate("caddy"),
  },
  {
    file: "haproxy.json",
    target: "haproxy",
    extract: asIntegrationsCrate("haproxy"),
  },
  {
    file: "nginx.json",
    target: "nginx",
    extract: asIntegrationsCrate("nginx"),
  },
  {
    file: "traefik.json",
    target: "traefik",
    extract: asIntegrationsCrate("traefik"),
  },
  // PHP — bare shell + sliced runtime/config, all deep-merged under integrations.php
  { file: "php.shell.json", target: "php", extract: asIs }, // { title, connect, fields, tabs, ... }
  { file: "php.runtime.json", target: "php", extract: asIs }, // { runtime: {...} }
  { file: "php.config.json", target: "php", extract: asIs }, // { config: {...} }
  // Wave M — unified Mail panel; sub-tabs nest under integrations.mail.<crate>
  { file: "mail.shell.json", target: "mail", extract: asIs }, // { title, subtitle, noTabs, tabs }
  { file: "mail.postfix.json", target: "mail", extract: asIs }, // { postfix: {...} }
  { file: "mail.dovecot.json", target: "mail", extract: asIs },
  { file: "mail.clamav.json", target: "mail", extract: asIs },
  { file: "mail.amavis.json", target: "mail", extract: asIs },
  { file: "mail.cyrusSasl.json", target: "mail", extract: asIs },
  { file: "mail.opendkim.json", target: "mail", extract: asIs },
  { file: "mail.procmail.json", target: "mail", extract: asIs },
  { file: "mail.rspamd.json", target: "mail", extract: asIs },
  // Wave 6 folds — wrapped { integrations: { crate: {...} } }
  {
    file: "telegram.json",
    target: "telegram",
    extract: asIntegrationsCrate("telegram"),
  },
  { file: "llm.json", target: "llm", extract: asIntegrationsCrate("llm") },
];

// ---- 1. Merge fragments into en.json ----
const en = readJson(path.join(LOC_DIR, "en.json"));
en.integrations = en.integrations || {};

const consumed = [];
const perTarget = {};
for (const { file, target, extract } of PLAN) {
  const full = path.join(FRAG_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`WARN missing fragment: ${file}`);
    continue;
  }
  en.integrations[target] = en.integrations[target] || {};
  const before = leaves(en.integrations[target]).length;
  const payload = extract(readJson(full));
  deepMerge(en.integrations[target], payload);
  const after = leaves(en.integrations[target]).length;
  perTarget[target] = (perTarget[target] || 0) + (after - before);
  consumed.push(file);
}

writeJson(path.join(LOC_DIR, "en.json"), en);

// ---- 2. Propagate to other 9 locales (English-value fallback) ----
const fillReport = {};
for (const loc of LOCALES) {
  if (loc === "en") continue;
  const data = readJson(path.join(LOC_DIR, `${loc}.json`));
  fillReport[loc] = fillMissing(data, en);
  writeJson(path.join(LOC_DIR, `${loc}.json`), data);
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

console.log("=== Final i18n merge (Waves 4 / M / 6) ===");
for (const t of Object.keys(perTarget))
  console.log(`  integrations.${t}: +${perTarget[t]} keys`);
console.log(
  "fill (EN fallback keys added per locale):",
  JSON.stringify(fillReport),
);
console.log("en total leaves:", baseLeaves.length);
console.log(
  "PARITY:",
  parityOk ? "OK (10 locales equal key structure)" : "FAILED",
);
console.log("consumed fragments:", consumed.length, "/", PLAN.length);
