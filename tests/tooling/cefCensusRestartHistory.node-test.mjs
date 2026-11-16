import assert from "node:assert/strict";
import test from "node:test";
import { codeTreeDigest } from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import { actualFeatureSource } from "./helpers/cefLinuxWindowFeatureFixture.mjs";
import {
  BEFORE_CENSUS_RESTART_PRODUCER,
  CURRENT_CENSUS_RESTART_PRODUCER,
  beforeCensusRestartDataForHistory,
  beforeCensusRestartFileForHistory,
  inverseCensusRestartFile,
  isCensusRestartProducer,
  rewindCensusRestartRows,
} from "./helpers/cefCensusRestartReviewedHistory.mjs";
import { CURRENT_SLOW_SNAPSHOT_PRODUCER } from "./helpers/cefSlowSnapshotReviewedHistory.mjs";

const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";

test("census restart layer rewinds the actual current producer to the slow-snapshot producer", () => {
  const actual = actualFeatureSource(process.cwd());
  assert.equal(actual.producer, CURRENT_CENSUS_RESTART_PRODUCER);
  assert.equal(BEFORE_CENSUS_RESTART_PRODUCER, CURRENT_SLOW_SNAPSHOT_PRODUCER);
  assert(isCensusRestartProducer(actual.rows));
  const before = beforeCensusRestartDataForHistory(actual.rows, actual.files);
  assert.equal(codeTreeDigest(before.rows), CURRENT_SLOW_SNAPSHOT_PRODUCER);
  assert.deepEqual(
    before.rows.filter((row, index) => row.sha !== actual.rows[index].sha),
    before.rows.filter((row) => row.path === CORE),
  );
  assert.deepEqual(rewindCensusRestartRows(actual.rows), before.rows);
  assert.equal(isCensusRestartProducer(before.rows), false);
  assert.deepEqual(
    beforeCensusRestartDataForHistory(before.rows, before.files),
    before,
  );
});

test("census restart layer refuses every unreviewed byte, mode, row and file", () => {
  const actual = actualFeatureSource(process.cwd());
  const core = actual.files.get(CORE);
  assert.deepEqual(
    beforeCensusRestartFileForHistory(Buffer.from("other"), CORE),
    Buffer.from("other"),
  );
  assert.throws(() =>
    inverseCensusRestartFile(Buffer.concat([core, Buffer.from("\n")]), CORE),
  );
  assert.throws(() => inverseCensusRestartFile(core, "scripts/other.mjs"));
  const damaged = Buffer.from(core);
  damaged[Math.floor(damaged.length / 2)] ^= 1;
  assert.throws(() => inverseCensusRestartFile(damaged, CORE));
  const wrongBody = new Map(actual.files);
  wrongBody.set(CORE, damaged);
  assert.throws(() =>
    beforeCensusRestartDataForHistory(actual.rows, wrongBody),
  );
  assert.throws(() =>
    beforeCensusRestartDataForHistory(
      actual.rows,
      new Map([...actual.files, ["extra", Buffer.from("unreviewed")]]),
    ),
  );
  assert.throws(() =>
    rewindCensusRestartRows(
      actual.rows.map((row) =>
        row.path === CORE ? { ...row, mode: "100755" } : row,
      ),
    ),
  );
  assert.throws(() => rewindCensusRestartRows(actual.rows.slice(1)));
});
