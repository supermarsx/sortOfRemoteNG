import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compareCargoTimingReports,
  formatCargoTimingSummary,
  main,
  summarizeCargoTimingHtml,
} from "../../scripts/ci/summarize-native-build-timings.mjs";

// Mirrors the Rust/Cargo 1.95 UNIT_DATA sections in the actual local report,
// including mode=todo on a timed unit. No result/completion is implied by it.
const unit = (changes = {}) => ({
  i: 20,
  name: "app",
  version: "26.45.0",
  mode: "todo",
  target: "",
  features: ["full", "default"],
  start: 173.65,
  duration: 99.86,
  unblocked_units: [21],
  unblocked_rmeta_units: [],
  sections: [
    ["frontend", { start: 0, end: 72.74 }],
    ["codegen", { start: 72.74, end: 99.86 }],
  ],
  ...changes,
});
const html = (units = [unit()], duration = "DURATION = 295;") =>
  `<html><script>\n${duration}\nconst UNIT_DATA = ${JSON.stringify(units, null, 2)};\nconst CONCURRENCY_DATA = [];\n</script></html>`;

test("actual modern sections distinguish frontend/codegen from plot extent and unknown linker time", () => {
  const report = summarizeCargoTimingHtml(html());
  assert.equal(report.graphDurationSeconds, 295);
  assert.equal(report.latestRecordedUnitEndSeconds, 273.51);
  assert.equal(report.units[0].frontendSeconds, 72.74);
  assert.equal(report.units[0].codegenSeconds, 27.12);
  assert.equal(report.linkerSeconds, null);
  assert.equal(report.outcome, "unverified");
  assert.equal(report.buildContext, "unverified");
  assert.match(
    formatCargoTimingSummary(report),
    /HTML can be stale or interrupted/,
  );
  assert.match(
    formatCargoTimingSummary(report),
    /not a critical-path or linker measurement/,
  );
});

test("missing/null timings stay unknown, while a reported zero remains zero without implying a no-op", () => {
  const report = summarizeCargoTimingHtml(
    html(
      [
        unit({ i: 1, start: 0, duration: 0, sections: null }),
        unit({ i: 2, start: null, duration: null, sections: null }),
        { i: 3, name: "unknown" },
      ],
      "",
    ),
  );
  assert.equal(report.graphDurationSeconds, null);
  assert.equal(report.units[0].durationSeconds, 0);
  assert.equal(report.units[0].frontendSeconds, null);
  assert.equal(report.units[1].durationSeconds, null);
  assert.equal(report.units[2].startSeconds, null);
  assert.equal(report.unknownDurationUnitCount, 2);
  assert.equal(report.zeroDurationUnitCount, 1);
  assert.equal(report.positiveDurationUnitCount, 0);
  assert.match(
    formatCargoTimingSummary(report),
    /Zero-duration records do not prove a no-op/,
  );
  assert.equal(
    summarizeCargoTimingHtml(html([], "const DURATION = null;"))
      .latestRecordedUnitEndSeconds,
    null,
  );
});

test("unknown future phase labels are retained without inventing frontend or codegen timing", () => {
  const report = summarizeCargoTimingHtml(
    html([unit({ sections: [["future", { start: 0, end: 2 }]] })]),
  );
  assert.equal(report.units[0].frontendSeconds, null);
  assert.equal(report.units[0].codegenSeconds, null);
  assert.equal(report.units[0].phases[0].name, "future");
  assert.equal(report.units[0].phases[0].durationSeconds, 2);
});

test("HTML and attached JavaScript are never executed; embedded JSON braces and escapes are handled as strings", () => {
  globalThis.__cargoTimingExecuted = false;
  const text =
    html([unit({ name: 'literal ]; { \\" value' })]) +
    "<script>globalThis.__cargoTimingExecuted = true; throw Error('must not run');</script>";
  assert.equal(
    summarizeCargoTimingHtml(text).units[0].name,
    'literal ]; { \\" value',
  );
  assert.equal(globalThis.__cargoTimingExecuted, false);
  delete globalThis.__cargoTimingExecuted;
  assert.throws(
    () => summarizeCargoTimingHtml("const UNIT_DATA = [] + execute();"),
    /must end/,
  );
  assert.throws(
    () => summarizeCargoTimingHtml("const UNIT_DATA = [{name: execute()}];"),
    /valid JSON/,
  );
  assert.throws(
    () => summarizeCargoTimingHtml(html([], "DURATION = execute();")),
    /JSON number/,
  );
});

test("duplicates, truncated JSON and unsupported numbers/shapes fail rather than creating measurements", () => {
  for (const text of [
    "const UNIT_DATA = [",
    "const UNIT_DATA = {};",
    `${html()}\nconst UNIT_DATA = [];`,
    html([unit(), unit()]),
    html([unit({ duration: -1 })]),
    html([unit({ duration: "99" })]),
    html([unit({ duration: 1e99 })]),
    html([unit({ sections: {} })]),
    html([unit({ sections: [["frontend", { start: 5, end: 4 }]] })]),
    html([unit({ sections: [["frontend", { start: 0, end: 200 }]] })]),
    html([
      unit({
        sections: [
          ["frontend", {}],
          ["frontend", {}],
        ],
      }),
    ]),
    html([], "DURATION = 2;\nDURATION = 3;"),
    html([], 'DURATION = "3";'),
    html([unit({ name: "terminal\u001b[0m" })]),
  ])
    assert.throws(() => summarizeCargoTimingHtml(text));
  assert.throws(
    () =>
      summarizeCargoTimingHtml(
        `const UNIT_DATA = ${"[".repeat(65)}${"]".repeat(65)};`,
      ),
    /deeply nested/,
  );
  assert.throws(
    () => summarizeCargoTimingHtml("x".repeat(32 * 1024 * 1024 + 1)),
    /32 MiB/,
  );
});

test("comparisons use unique unit identities, not unstable IDs or invented unknown-phase zeroes", () => {
  const before = summarizeCargoTimingHtml(
    html([unit(), unit({ i: 21, name: "new-before", sections: null })]),
  );
  const after = summarizeCargoTimingHtml(
    html(
      [
        unit({
          i: 999,
          features: ["default", "full"],
          duration: 90,
          sections: null,
        }),
      ],
      "DURATION = 285;",
    ),
  );
  const compared = compareCargoTimingReports(before, after);
  assert.equal(compared.graphDurationDeltaSeconds, -10);
  assert.equal(compared.matchedUnits.length, 1);
  assert.equal(compared.matchedUnits[0].durationDeltaSeconds, -9.86);
  assert.equal(compared.matchedUnits[0].frontendDeltaSeconds, null);
  assert.equal(compared.matchedUnits[0].codegenDeltaSeconds, null);
  assert.match(compared.note, /not a speedup claim/);
  const ambiguous = summarizeCargoTimingHtml(html([unit(), unit({ i: 21 })]));
  assert.equal(
    compareCargoTimingReports(ambiguous, after).matchedUnits.length,
    0,
  );
  assert.equal(
    compareCargoTimingReports(ambiguous, after).ambiguousIdentityCount,
    1,
  );
});

test("CLI reads one or two real files, emits machine JSON/human text, and cannot execute HTML", () => {
  const fixture = new URL(
    "../fixtures/native-build-timings.html",
    import.meta.url,
  );
  const cli = new URL(
    "../../scripts/ci/summarize-native-build-timings.mjs",
    import.meta.url,
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(cli),
      "--json",
      fileURLToPath(fixture),
      fileURLToPath(fixture),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports.length, 2);
  assert.equal(parsed.reports[0].input, "native-build-timings.html");
  assert.match(parsed.reports[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(parsed.comparison.graphDurationDeltaSeconds, 0);
  let summary = "";
  main([fileURLToPath(fixture)], (text) => {
    summary += text;
  });
  assert.match(summary, /Plot extent: 295s/);
  assert.match(summary, /frontend=72.74s, codegen=27.12s/);
  assert.throws(() => main([]), /Usage/);
  assert.throws(() => main(["--unsafe-option"]), /Usage/);
  assert.ok(readFileSync(fixture, "utf8").includes("must never execute"));
});
