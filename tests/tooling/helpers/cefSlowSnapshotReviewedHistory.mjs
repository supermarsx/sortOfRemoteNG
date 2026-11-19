import { beforeAvfCompatDataForHistory } from "./cefAvfCompatibilityReviewedHistory.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  beforeCensusRestartDataForHistory,
  beforeCensusRestartFileForHistory,
  isCensusRestartProducer,
  rewindCensusRestartRows,
} from "./cefCensusRestartReviewedHistory.mjs";

// Closed test DATA only: no source, process, graph, SDK or native authority.
// This outermost layer rewinds the one reviewed change to the compile
// supervisor core (one retry of a transient ownership-snapshot deadline) to the
// complete composite producer reviewed before it. It never grants a runtime
// exception and every unreviewed byte, mode, path or row is refused.
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
const DATA = Object.freeze({
  after: {
    bytes: 277140,
    sha256: "0ec87c9956ce5d9a6367ba8935386472e216a78caef40f07501c29503818087b",
    blob: "d4053a931f55e0ba5884963f4ec6dcc95654169f",
  },
  before: {
    bytes: 276188,
    sha256: "0fb1d64ea28c19141a602df025b77f32df7a6c198bb0f18af2e8a1b08f2f007b",
    blob: "c75b9ed2b4ff07994cc3d35092bc29203912792a",
  },
  pairs: [
    {
      previous: "export function observedLineage(rows, owned) {",
      current:
        '// One over-deadline ownership snapshot on a loaded runner is a measurement\n// hiccup, not proof of a leaked process: retry it once. A second consecutive\n// slow snapshot, an abort, or any other failure still denies, and a snapshot\n// that never completed contributes no rows to the ownership proof.\nexport const SLOW_SNAPSHOT_TOTAL_BOUND = 8;\nexport function createSlowSnapshotTolerance({\n  total = SLOW_SNAPSHOT_TOTAL_BOUND,\n} = {}) {\n  let tolerated = 0;\n  return async function take(snapshot, { signal } = {}) {\n    try {\n      return await snapshot();\n    } catch (error) {\n      if (\n        signal?.aborted ||\n        compileMonitorDetails(error).code !== "PS_DEADLINE" ||\n        tolerated >= total\n      )\n        throw error;\n      tolerated++;\n    }\n    return snapshot();\n  };\n}\n\nexport function observedLineage(rows, owned) {',
    },
    {
      previous:
        '  initial.catch((error) => fail(error, "initial-snapshot"));\n',
      current:
        '  initial.catch((error) => fail(error, "initial-snapshot"));\n  const slowTolerance = createSlowSnapshotTolerance();\n',
    },
    {
      previous:
        "      const rows = await processSnapshot({\n        deadline: workDeadline + COMPILE_CLEANUP_MS,\n        signal: observer.signal,\n        probeJoins,\n        censusSession,\n      });\n",
      current:
        "      const rows = await slowTolerance(\n        () =>\n          processSnapshot({\n            deadline: workDeadline + COMPILE_CLEANUP_MS,\n            signal: observer.signal,\n            probeJoins,\n            censusSession,\n          }),\n        { signal: observer.signal },\n      );\n",
    },
  ],
  currentProducer:
    "37507e5317fedd21bbd7eeec936d0c824c6645c0cf4dc151162d836b43d6868f",
  beforeProducer:
    "58aeb848f678dc90e3b9e82c3e4c8992de0d1ebff8a583c8e87eac0d01c973ea",
});
export const CURRENT_SLOW_SNAPSHOT_PRODUCER = DATA.currentProducer;
export const BEFORE_SLOW_SNAPSHOT_PRODUCER = DATA.beforeProducer;
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const digest = (rows) =>
  codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
function pin(raw, expected) {
  assert(Buffer.isBuffer(raw));
  assert.equal(raw.length, expected.bytes);
  assert.equal(sha(raw), expected.sha256);
  assert.equal(blob(raw), expected.blob);
}
export function inverseSlowSnapshotFile(raw, file) {
  assert.equal(file, CORE, "Unreviewed slow-snapshot historical file");
  pin(raw, DATA.after);
  let text = raw.toString("utf8");
  for (const pair of [...DATA.pairs].reverse()) {
    assert.equal(text.split(pair.current).length, 2);
    text = text.replace(pair.current, () => pair.previous);
  }
  const previous = Buffer.from(text);
  pin(previous, DATA.before);
  return previous;
}
export function beforeSlowSnapshotFileForHistory(raw, file) {
  // The newer census-restart layer rewinds first; other bytes pass unchanged.
  raw = beforeCensusRestartFileForHistory(raw, file);
  return file === CORE &&
    raw.length === DATA.after.bytes &&
    sha(raw) === DATA.after.sha256
    ? inverseSlowSnapshotFile(raw, file)
    : raw;
}
function isOwnSlowSnapshotProducer(rows) {
  return (
    Array.isArray(rows) &&
    rows.length === 132 &&
    digest(rows) === CURRENT_SLOW_SNAPSHOT_PRODUCER
  );
}
export function isSlowSnapshotProducer(rows) {
  return isOwnSlowSnapshotProducer(rows) || isCensusRestartProducer(rows);
}
export function rewindSlowSnapshotRows(rows) {
  if (isCensusRestartProducer(rows)) rows = rewindCensusRestartRows(rows);
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.equal(digest(rows), CURRENT_SLOW_SNAPSHOT_PRODUCER);
  const result = rows.map((row) => {
    if (row.path !== CORE) return row;
    assert.equal(row.mode, "100644");
    assert.equal(row.sha, DATA.after.blob);
    return { ...row, sha: DATA.before.blob };
  });
  assert.equal(digest(result), BEFORE_SLOW_SNAPSHOT_PRODUCER);
  return result;
}
// Rows and complete file bytes together; any other producer passes unchanged.
export function beforeSlowSnapshotDataForHistory(rows, files) {
  ({ rows, files } = beforeAvfCompatDataForHistory(rows, files));
  ({ rows, files } = beforeCensusRestartDataForHistory(rows, files));
  if (!isOwnSlowSnapshotProducer(rows)) return { rows, files };
  assert(files instanceof Map && files.size === rows.length);
  for (const row of rows)
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  const previous = new Map(files);
  previous.set(CORE, inverseSlowSnapshotFile(files.get(CORE), CORE));
  const previousRows = rewindSlowSnapshotRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previous.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previous };
}
