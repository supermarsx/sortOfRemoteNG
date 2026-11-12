import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import { beforeCensusDataForHistory } from "./cefCensusRetirementReviewedHistory.mjs";
import { withoutWindowsImageOrigin } from "./cefWindowsImageProducerRows.mjs";
import {
  withoutMacGcsPreparationRows,
  withoutMacGcsPreparationRuntime,
} from "./cefMacGcsReviewedHistory.mjs";
import {
  withoutSourceVerifyGuard,
  withoutSourceVerifyGuardRows,
} from "../cefUploadRecoveryInverse.mjs";

const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
// Test-only historical candidate reconstruction from reachable COMPLETE blobs.
// It never supplies an exception to the production migration reader or capsule.
export function reconstructLinuxMigrationFixtureSource(
  reachableRows,
  rawFiles,
  root,
) {
  ({ rows: reachableRows, files: rawFiles } = beforeCensusDataForHistory(
    reachableRows,
    rawFiles,
  ));
  const sourceRows = withoutSourceVerifyGuardRows(
    withoutMacGcsPreparationRows(reachableRows, root),
    root,
  );
  assert.equal(sourceRows.length, 131);
  assert.equal(
    codeTreeDigest(sourceRows),
    "20cbf29701533f37db20563e72c894b509ca0c368f03abe2f11322e2d0a2f35b",
  );
  assert(rawFiles instanceof Map);
  assert.equal(rawFiles.size, reachableRows.length);
  for (const row of reachableRows) {
    const raw = rawFiles.get(row.path);
    assert(Buffer.isBuffer(raw), row.path);
    assert.equal(blob(raw), row.sha, row.path);
  }
  const sourceFiles = new Map(rawFiles);
  for (const [file, inverse] of [
    ["scripts/lib/cef-windows-arm-sdk-origin.mjs", withoutWindowsImageOrigin],
    ["scripts/cef-runtime-ci.mjs", withoutMacGcsPreparationRuntime],
    ["scripts/lib/cef-checkpoint-archive.py", withoutSourceVerifyGuard],
  ])
    sourceFiles.set(
      file,
      Buffer.from(inverse(sourceFiles.get(file).toString("utf8"))),
    );
  assert(sourceFiles.delete("scripts/lib/cef-mac-gcs-normalize.py"));
  assert.equal(sourceFiles.size, sourceRows.length);
  for (const row of sourceRows) {
    assert.equal(row.mode, "100644");
    assert.equal(blob(sourceFiles.get(row.path)), row.sha, row.path);
  }
  return { sourceRows, sourceFiles };
}
