#!/usr/bin/env node
// Read Cargo's embedded JSON as data. Never evaluate or render timing HTML.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_UNITS = 50_000;
const NOTES = [
  "Build outcome and cold/incremental/no-op context are unverified. Confirm the command, exit status, source, target directory and cache state separately; HTML can be stale or interrupted.",
  "DURATION is Cargo's plotting extent, not measured command wall time. Unit end times and overlapping unit/phase durations are not a critical-path or linker measurement.",
  "Missing timing values remain null. Zero-duration records do not prove a no-op or a completed build.",
];

function embeddedUnits(html) {
  const matches = [...html.matchAll(/^\s*const\s+UNIT_DATA\s*=\s*/gm)];
  if (matches.length !== 1)
    throw new Error("Expected exactly one Cargo UNIT_DATA declaration.");
  const start = matches[0].index + matches[0][0].length;
  if (html[start] !== "[")
    throw new Error("Cargo UNIT_DATA must be a JSON array.");
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      if (++depth > 64)
        throw new Error("Cargo timing JSON is too deeply nested.");
    } else if (char === "]" || char === "}") {
      if (--depth === 0) {
        if (!/^\s*;/.test(html.slice(index + 1)))
          throw new Error("Cargo UNIT_DATA must end after its JSON array.");
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          throw new Error("Cargo UNIT_DATA is not valid JSON.");
        }
      }
    }
  }
  throw new Error("Cargo UNIT_DATA JSON is incomplete.");
}

function seconds(value, name) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 365 * 24 * 3600
  )
    throw new Error(`Invalid nonnegative Cargo timing: ${name}.`);
  return value;
}
function label(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "string" || value.length > 512 || /\p{Cc}/u.test(value))
    throw new Error(`Invalid Cargo unit label: ${name}.`);
  return value;
}
const round = (value) => Math.round(value * 1e6) / 1e6;
const delta = (before, after) =>
  before === null || after === null ? null : round(after - before);

function readUnit(unit, index) {
  if (!unit || typeof unit !== "object" || Array.isArray(unit))
    throw new Error("Invalid Cargo unit object.");
  const id = unit.i ?? index;
  if (!Number.isSafeInteger(id) || id < 0)
    throw new Error("Invalid Cargo unit index.");
  const start = seconds(unit.start, "start");
  const duration = seconds(unit.duration, "duration");
  if (
    unit.features != null &&
    (!Array.isArray(unit.features) || unit.features.length > 4096)
  )
    throw new Error("Invalid Cargo feature array.");
  const features =
    unit.features?.map((value) => label(value, "feature")) ?? null;
  const sections = unit.sections;
  if (sections != null && (!Array.isArray(sections) || sections.length > 64))
    throw new Error("Invalid Cargo sections.");
  const phases = [];
  const names = new Set();
  for (const section of sections ?? []) {
    if (
      !Array.isArray(section) ||
      section.length !== 2 ||
      !section[1] ||
      typeof section[1] !== "object" ||
      Array.isArray(section[1])
    )
      throw new Error("Invalid Cargo section entry.");
    const name = label(section[0], "section");
    if (names.has(name)) throw new Error("Duplicate Cargo timing section.");
    names.add(name);
    const from = seconds(section[1].start, "section start");
    const to = seconds(section[1].end, "section end");
    if (
      (from !== null && to !== null && to < from) ||
      (duration !== null && to !== null && to > duration + 0.05)
    )
      throw new Error("Cargo section exceeds its recorded unit interval.");
    phases.push({
      name,
      startSeconds: from,
      endSeconds: to,
      durationSeconds: delta(from, to),
    });
  }
  return {
    id,
    name: label(unit.name, "name"),
    version: label(unit.version, "version", true),
    mode: label(unit.mode, "mode", true),
    target: label(unit.target, "target", true),
    features,
    startSeconds: start,
    durationSeconds: duration,
    endSeconds:
      start === null || duration === null ? null : round(start + duration),
    frontendSeconds:
      phases.find((phase) => phase.name === "frontend")?.durationSeconds ??
      null,
    codegenSeconds:
      phases.find((phase) => phase.name === "codegen")?.durationSeconds ?? null,
    phases: sections == null ? null : phases,
  };
}

export function summarizeCargoTimingHtml(html) {
  if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > MAX_BYTES)
    throw new Error("Cargo timing HTML exceeds 32 MiB.");
  const raw = embeddedUnits(html);
  if (!Array.isArray(raw) || raw.length > MAX_UNITS)
    throw new Error("Cargo timing unit array exceeds its supported bound.");
  const units = raw.map(readUnit);
  if (new Set(units.map((unit) => unit.id)).size !== units.length)
    throw new Error("Duplicate Cargo unit index.");
  const durations = [
    ...html.matchAll(/^\s*(?:const\s+)?DURATION\s*=\s*([^;\r\n]+)\s*;/gm),
  ];
  if (durations.length > 1)
    throw new Error("Duplicate Cargo DURATION assignment.");
  let graphDurationSeconds = null;
  if (durations.length) {
    let value;
    try {
      value = JSON.parse(durations[0][1]);
    } catch {
      throw new Error("Cargo DURATION must be a JSON number or null.");
    }
    graphDurationSeconds = seconds(value, "DURATION");
  }
  const ends = units
    .map((unit) => unit.endSeconds)
    .filter((value) => value !== null);
  return {
    schemaVersion: 1,
    outcome: "unverified",
    buildContext: "unverified",
    graphDurationSeconds,
    latestRecordedUnitEndSeconds: ends.length ? Math.max(...ends) : null,
    unitCount: units.length,
    positiveDurationUnitCount: units.filter((unit) => unit.durationSeconds > 0)
      .length,
    zeroDurationUnitCount: units.filter((unit) => unit.durationSeconds === 0)
      .length,
    unknownDurationUnitCount: units.filter(
      (unit) => unit.durationSeconds === null,
    ).length,
    linkerSeconds: null,
    notes: [...NOTES],
    units,
  };
}

export function readCargoTimingReport(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw new Error("Expected a Cargo timing HTML file of at most 32 MiB.");
  const html = readFileSync(path, "utf8");
  return {
    input: basename(path),
    sha256: createHash("sha256").update(html).digest("hex"),
    ...summarizeCargoTimingHtml(html),
  };
}

function unitKey(unit) {
  return JSON.stringify([
    unit.name,
    unit.version,
    unit.mode,
    unit.target,
    unit.features === null ? null : [...unit.features].sort(),
  ]);
}
function indexUnits(units) {
  const result = new Map();
  for (const unit of units) {
    const key = unitKey(unit);
    const group = result.get(key);
    if (group) group.push(unit);
    else result.set(key, [unit]);
  }
  return result;
}
export function compareCargoTimingReports(before, after) {
  const left = indexUnits(before.units);
  const right = indexUnits(after.units);
  const matchedUnits = [];
  let ambiguousIdentityCount = 0;
  for (const [key, first] of left) {
    const second = right.get(key);
    if (!second) continue;
    if (first.length !== 1 || second.length !== 1) {
      ambiguousIdentityCount++;
      continue;
    }
    matchedUnits.push({
      name: first[0].name,
      version: first[0].version,
      target: first[0].target,
      mode: first[0].mode,
      beforeSeconds: first[0].durationSeconds,
      afterSeconds: second[0].durationSeconds,
      durationDeltaSeconds: delta(
        first[0].durationSeconds,
        second[0].durationSeconds,
      ),
      frontendDeltaSeconds: delta(
        first[0].frontendSeconds,
        second[0].frontendSeconds,
      ),
      codegenDeltaSeconds: delta(
        first[0].codegenSeconds,
        second[0].codegenSeconds,
      ),
    });
  }
  return {
    graphDurationDeltaSeconds: delta(
      before.graphDurationSeconds,
      after.graphDurationSeconds,
    ),
    latestRecordedUnitEndDeltaSeconds: delta(
      before.latestRecordedUnitEndSeconds,
      after.latestRecordedUnitEndSeconds,
    ),
    ambiguousIdentityCount,
    matchedUnits,
    note: "Differences are observations, not a speedup claim. Compare equivalent commands/features/targets, successful outcomes and cold or warm cache conditions; unit identities may omit target-triple distinctions.",
  };
}

const printable = (value) => (value === null ? "unknown" : `${round(value)}s`);
export function formatCargoTimingSummary(report) {
  const top = [...report.units]
    .sort((a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1))
    .slice(0, 10);
  return [
    `Cargo timing report: ${report.input ?? "provided HTML"}`,
    `Plot extent: ${printable(report.graphDurationSeconds)}; latest recorded unit end: ${printable(report.latestRecordedUnitEndSeconds)}.`,
    `Units: ${report.unitCount}; positive duration: ${report.positiveDurationUnitCount}; zero: ${report.zeroDurationUnitCount}; unknown: ${report.unknownDurationUnitCount}.`,
    ...report.notes,
    "Longest recorded units (overlap; do not sum as wall time):",
    ...top.map(
      (unit) =>
        `  ${unit.name} ${unit.version ?? ""}${unit.target ?? ""}: total=${printable(unit.durationSeconds)}, frontend=${printable(unit.frontendSeconds)}, codegen=${printable(unit.codegenSeconds)}`,
    ),
  ].join("\n");
}

export function main(
  argv = process.argv.slice(2),
  write = (text) => process.stdout.write(text),
) {
  const files = argv.filter((arg) => arg !== "--json");
  if (
    files.length < 1 ||
    files.length > 2 ||
    files.some((arg) => arg.startsWith("--"))
  )
    throw new Error(
      "Usage: summarize-native-build-timings.mjs [--json] BEFORE.html [AFTER.html]",
    );
  const reports = files.map(readCargoTimingReport);
  const comparison =
    reports.length === 2 ? compareCargoTimingReports(...reports) : null;
  if (argv.includes("--json"))
    write(`${JSON.stringify({ reports, comparison }, null, 2)}\n`);
  else
    write(
      `${reports.map(formatCargoTimingSummary).join("\n\n")}${comparison ? `\n\nComparison: plotting extent delta ${printable(comparison.graphDurationDeltaSeconds)}; recorded unit end delta ${printable(comparison.latestRecordedUnitEndDeltaSeconds)}.\n${comparison.note}` : ""}\n`,
    );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(`[native-timings] ${error.message}`);
    process.exitCode = 1;
  }
}
