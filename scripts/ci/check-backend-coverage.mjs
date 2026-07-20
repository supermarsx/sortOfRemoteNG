#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path/posix";

// f629 / run 29742258784 measured 139668/540817 physical workspace lines
// (25.83%) after canonical union, so 25.5% is the non-regression floor. Its
// app + VPN + RDP critical scope measured 18504/32418 (57.08%); keeping the
// original 40% gate there preserves a meaningful runtime bar.
export const DEFAULT_WORKSPACE_THRESHOLD = 25.5;
export const DEFAULT_CRITICAL_THRESHOLD = 40;

const CRITICAL_RUNTIME_PREFIXES = [
  "src-tauri/src/",
  "src-tauri/crates/sorng-vpn/src/",
  "src-tauri/crates/sorng-rdp/src/",
];

const usage = `Usage: node scripts/ci/check-backend-coverage.mjs <coverage.lcov> [options]

Options:
  --workspace-threshold <percent>  Whole-workspace physical-line floor (default: 25.5)
  --critical-threshold <percent>   Critical-runtime physical-line floor (default: 40)
  --summary-limit <count>          Files shown when a ratchet fails (default: 10)
  --help                           Show this help`;

/**
 * Canonicalize LCOV source paths without consulting the host filesystem.
 *
 * cargo-llvm-cov can emit the same physical Rust source through both its real
 * path and a `#[path = "../../..."]` command-aggregator path. Normalizing the
 * lexical path and anchoring workspace sources at `src-tauri/` gives those
 * records one stable identity on Linux and Windows.
 */
export function normalizeSourcePath(sourcePath) {
  const original = sourcePath.trim();
  if (!original) {
    throw new Error("LCOV SF record has an empty source path");
  }

  const isWindowsPath =
    /^[A-Za-z]:[\\/]/u.test(original) || original.includes("\\");
  let normalized = path.normalize(original.replaceAll("\\", "/"));
  const lower = normalized.toLowerCase();
  const workspaceMarker = "/src-tauri/";
  const markerIndex = lower.lastIndexOf(workspaceMarker);

  if (markerIndex >= 0) {
    normalized = normalized.slice(markerIndex + 1);
  } else if (lower.startsWith("src-tauri/")) {
    normalized = normalized.replace(/^\.\//u, "");
  } else if (isWindowsPath) {
    normalized = normalized.toLowerCase();
  }

  return isWindowsPath ? normalized.toLowerCase() : normalized;
}

class LcovAccumulator {
  constructor() {
    this.files = new Map();
    this.currentSource = null;
    this.records = 0;
    this.daEntries = 0;
    this.duplicateDaEntries = 0;
  }

  consume(line, inputLineNumber) {
    if (line.startsWith("SF:")) {
      this.currentSource = normalizeSourcePath(line.slice(3));
      this.records += 1;
      if (!this.files.has(this.currentSource)) {
        this.files.set(this.currentSource, new Map());
      }
      return;
    }

    if (line.startsWith("DA:")) {
      if (!this.currentSource) {
        throw new Error(
          `LCOV DA record before SF at input line ${inputLineNumber}`,
        );
      }
      const match = /^DA:(\d+),(-?\d+)(?:,.*)?$/u.exec(line);
      if (!match) {
        throw new Error(
          `Malformed LCOV DA record at input line ${inputLineNumber}: ${line}`,
        );
      }

      const sourceLine = Number.parseInt(match[1], 10);
      const hit = Number.parseInt(match[2], 10) > 0;
      const lines = this.files.get(this.currentSource);
      this.daEntries += 1;
      if (lines.has(sourceLine)) {
        this.duplicateDaEntries += 1;
        lines.set(sourceLine, lines.get(sourceLine) || hit);
      } else {
        lines.set(sourceLine, hit);
      }
      return;
    }

    if (line === "end_of_record") {
      this.currentSource = null;
    }
  }

  finish() {
    return {
      files: this.files,
      records: this.records,
      daEntries: this.daEntries,
      duplicateDaEntries: this.duplicateDaEntries,
    };
  }
}

export function parseLcov(text) {
  const accumulator = new LcovAccumulator();
  text
    .split(/\r?\n/u)
    .forEach((line, index) => accumulator.consume(line, index + 1));
  return accumulator.finish();
}

export async function parseLcovFile(inputPath) {
  const accumulator = new LcovAccumulator();
  const input = createReadStream(inputPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let inputLineNumber = 0;

  for await (const line of lines) {
    inputLineNumber += 1;
    accumulator.consume(line, inputLineNumber);
  }

  return accumulator.finish();
}

export function isCriticalRuntimeSource(sourcePath) {
  const lower = sourcePath.toLowerCase();
  return CRITICAL_RUNTIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function measureCoverage(report, predicate = () => true) {
  const files = [];
  let found = 0;
  let hit = 0;

  for (const [sourcePath, lines] of report.files) {
    if (!predicate(sourcePath)) {
      continue;
    }

    let fileHit = 0;
    for (const wasHit of lines.values()) {
      if (wasHit) {
        fileHit += 1;
      }
    }
    const fileFound = lines.size;
    found += fileFound;
    hit += fileHit;
    files.push({
      path: sourcePath,
      found: fileFound,
      hit: fileHit,
      missed: fileFound - fileHit,
    });
  }

  return {
    files,
    found,
    hit,
    missed: found - hit,
    percent: found === 0 ? 0 : (hit / found) * 100,
  };
}

export function passesThreshold(measurement, threshold) {
  return (
    measurement.found > 0 &&
    measurement.hit * 100 >= threshold * measurement.found
  );
}

function parseThreshold(raw, optionName) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${optionName} must be a number from 0 through 100`);
  }
  return value;
}

function parsePositiveInteger(raw, optionName) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    inputPath: null,
    workspaceThreshold: DEFAULT_WORKSPACE_THRESHOLD,
    criticalThreshold: DEFAULT_CRITICAL_THRESHOLD,
    summaryLimit: 10,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--workspace-threshold") {
      options.workspaceThreshold = parseThreshold(argv[++index], argument);
      continue;
    }
    if (argument === "--critical-threshold") {
      options.criticalThreshold = parseThreshold(argv[++index], argument);
      continue;
    }
    if (argument === "--summary-limit") {
      options.summaryLimit = parsePositiveInteger(argv[++index], argument);
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (options.inputPath) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
    options.inputPath = argument;
  }

  if (!options.help && !options.inputPath) {
    throw new Error("An LCOV input path is required");
  }
  return options;
}

function formatMeasurement(label, measurement, threshold) {
  return `${label}: ${measurement.percent.toFixed(2)}% (${measurement.hit}/${measurement.found} lines; ${measurement.missed} missed), floor ${threshold.toFixed(2)}%`;
}

function printLowCoverageSummary(label, measurement, limit) {
  const lowest = measurement.files
    .filter((file) => file.missed > 0)
    .sort(
      (left, right) =>
        right.missed - left.missed ||
        left.hit / left.found - right.hit / right.found ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit);

  console.error(
    `Low-coverage summary for ${label} (largest missed-line counts):`,
  );
  if (lowest.length === 0) {
    console.error("  no uncovered physical lines");
    return;
  }
  for (const file of lowest) {
    const percent = file.found === 0 ? 0 : (file.hit / file.found) * 100;
    console.error(
      `  ${percent.toFixed(2)}% (${file.hit}/${file.found}; ${file.missed} missed) ${file.path}`,
    );
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`::error::${error.message}`);
    console.error(usage);
    return 2;
  }

  if (options.help) {
    console.log(usage);
    return 0;
  }

  let report;
  try {
    report = await parseLcovFile(options.inputPath);
  } catch (error) {
    console.error(
      `::error::Unable to read LCOV input ${options.inputPath}: ${error.message}`,
    );
    return 2;
  }

  const workspace = measureCoverage(report);
  const critical = measureCoverage(report, isCriticalRuntimeSource);
  const physicalLines = workspace.found;
  console.log("Backend LCOV physical-line coverage");
  console.log(
    `  ${formatMeasurement("Workspace", workspace, options.workspaceThreshold)}`,
  );
  console.log(
    `  ${formatMeasurement("Critical runtime", critical, options.criticalThreshold)}`,
  );
  console.log(
    `  Parsed ${report.records} records and ${report.daEntries} DA entries into ${report.files.size} physical files / ${physicalLines} physical lines (${report.duplicateDaEntries} duplicate DA entries unioned)`,
  );

  const failures = [];
  if (!passesThreshold(workspace, options.workspaceThreshold)) {
    failures.push({ label: "workspace", measurement: workspace });
  }
  if (!passesThreshold(critical, options.criticalThreshold)) {
    failures.push({ label: "critical runtime", measurement: critical });
  }

  for (const failure of failures) {
    const threshold =
      failure.label === "workspace"
        ? options.workspaceThreshold
        : options.criticalThreshold;
    console.error(
      `::error::${formatMeasurement(failure.label, failure.measurement, threshold)} is below the required ratchet`,
    );
    printLowCoverageSummary(
      failure.label,
      failure.measurement,
      options.summaryLimit,
    );
  }

  if (failures.length > 0) {
    return 1;
  }

  console.log("Coverage ratchets passed.");
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
