import assert from "node:assert/strict";
import test from "node:test";
import { codeTreeDigest } from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import { actualFeatureSource } from "./helpers/cefLinuxWindowFeatureFixture.mjs";
import {
  BEFORE_SLOW_SNAPSHOT_PRODUCER,
  CURRENT_SLOW_SNAPSHOT_PRODUCER,
  beforeSlowSnapshotDataForHistory,
  beforeSlowSnapshotFileForHistory,
  inverseSlowSnapshotFile,
  isSlowSnapshotProducer,
  rewindSlowSnapshotRows,
} from "./helpers/cefSlowSnapshotReviewedHistory.mjs";
import { CURRENT_COMPOSITE_PRODUCER } from "./helpers/cefCompositeReviewedHistory.mjs";
import { beforeCensusRestartDataForHistory } from "./helpers/cefCensusRestartReviewedHistory.mjs";

// HEAD is the census-restart producer; this layer starts from the producer
// reviewed immediately before it.
function slowSnapshotSource() {
  const head = actualFeatureSource(process.cwd());
  const previous = beforeCensusRestartDataForHistory(head.rows, head.files);
  return { ...head, ...previous, producer: codeTreeDigest(previous.rows) };
}

const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";

test("slow snapshot layer rewinds the actual current producer to the complete composite producer", () => {
  const actual = slowSnapshotSource();
  assert.equal(actual.producer, CURRENT_SLOW_SNAPSHOT_PRODUCER);
  assert.equal(BEFORE_SLOW_SNAPSHOT_PRODUCER, CURRENT_COMPOSITE_PRODUCER);
  assert(isSlowSnapshotProducer(actual.rows));
  const before = beforeSlowSnapshotDataForHistory(actual.rows, actual.files);
  assert.equal(codeTreeDigest(before.rows), CURRENT_COMPOSITE_PRODUCER);
  assert.equal(before.rows.length, 132);
  assert.deepEqual(
    before.rows.filter((row, index) => row.sha !== actual.rows[index].sha),
    before.rows.filter((row) => row.path === CORE),
  );
  assert.notDeepEqual(before.files.get(CORE), actual.files.get(CORE));
  assert.deepEqual(rewindSlowSnapshotRows(actual.rows), before.rows);
  // The previous producer is not itself a slow-snapshot producer.
  assert.equal(isSlowSnapshotProducer(before.rows), false);
  assert.deepEqual(
    beforeSlowSnapshotDataForHistory(before.rows, before.files),
    before,
  );
});

test("slow snapshot layer refuses every unreviewed byte, mode, row and file", () => {
  const actual = slowSnapshotSource();
  const core = actual.files.get(CORE);
  assert.deepEqual(
    beforeSlowSnapshotFileForHistory(Buffer.from("other"), CORE),
    Buffer.from("other"),
  );
  assert.throws(() =>
    inverseSlowSnapshotFile(Buffer.concat([core, Buffer.from("\n")]), CORE),
  );
  assert.throws(() => inverseSlowSnapshotFile(core, "scripts/other.mjs"));
  const damaged = Buffer.from(core);
  damaged[Math.floor(damaged.length / 2)] ^= 1;
  assert.throws(() => inverseSlowSnapshotFile(damaged, CORE));
  const wrongBody = new Map(actual.files);
  wrongBody.set(CORE, damaged);
  assert.throws(() => beforeSlowSnapshotDataForHistory(actual.rows, wrongBody));
  assert.throws(() =>
    beforeSlowSnapshotDataForHistory(
      actual.rows,
      new Map([...actual.files, ["extra", Buffer.from("unreviewed")]]),
    ),
  );
  assert.throws(() =>
    beforeSlowSnapshotDataForHistory(
      actual.rows,
      new Map([...actual.files].slice(1)),
    ),
  );
  assert.throws(() =>
    rewindSlowSnapshotRows(
      actual.rows.map((row) =>
        row.path === CORE ? { ...row, mode: "100755" } : row,
      ),
    ),
  );
  assert.throws(() => rewindSlowSnapshotRows(actual.rows.slice(1)));
});
