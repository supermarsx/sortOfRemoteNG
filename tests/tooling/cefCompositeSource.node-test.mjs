import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { actualFeatureSource } from "./helpers/cefLinuxWindowFeatureFixture.mjs";
import {
  codeTreeDigest,
  checkpointProfile,
  checkpointCompileArguments,
  MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import { beforeSlowSnapshotDataForHistory } from "./helpers/cefSlowSnapshotReviewedHistory.mjs";
import { CURRENT_CENSUS_RESTART_PRODUCER } from "./helpers/cefCensusRestartReviewedHistory.mjs";
import {
  CURRENT_COMPOSITE_PRODUCER,
  inverseCompositeMacData,
  inverseCompositeLinuxData,
  inverseCompositeFreshData,
} from "./helpers/cefCompositeReviewedHistory.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const data = JSON.parse(
  readFileSync(
    new URL("../fixtures/cef/composite_source_inverse.json", import.meta.url),
  ),
);

test("combined current producer restores each complete reviewed historical subject without cross-labeling", () => {
  const head = actualFeatureSource(process.cwd());
  assert.equal(head.producer, CURRENT_CENSUS_RESTART_PRODUCER);
  // The outermost reviewed layer rewinds the supervisor core; the composite
  // subjects below are checked from the complete composite producer.
  const actual = {
    ...head,
    ...beforeSlowSnapshotDataForHistory(head.rows, head.files),
    producer: CURRENT_COMPOSITE_PRODUCER,
  };
  assert.equal(codeTreeDigest(actual.rows), CURRENT_COMPOSITE_PRODUCER);
  assert.equal(data.authority, false);
  assert.equal(data.compositeMacNativeSDKQualified, false);
  assert.equal(
    data.launchScope,
    "Linux370 only; reviewed immutable Mac jobs use their own source",
  );
  assert.notEqual(
    MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION.candidateProducerAtProof,
    CURRENT_COMPOSITE_PRODUCER,
  );
  for (const [name, inverse] of [
    ["mac", inverseCompositeMacData],
    ["linux", inverseCompositeLinuxData],
    ["fresh", inverseCompositeFreshData],
  ]) {
    const subject = data.endpoints[name],
      before = inverse(actual.rows, actual.files);
    assert.equal(codeTreeDigest(before.rows), subject.producer);
    assert.equal(before.rows.length, 132);
    for (const spec of subject.files) {
      assert.equal(sha(actual.files.get(spec.path)), spec.after.sha256);
      assert.equal(sha(before.files.get(spec.path)), spec.before.sha256);
      assert.equal(before.files.get(spec.path).length, spec.before.bytes);
      for (const body of [
        Buffer.concat([actual.files.get(spec.path), Buffer.from("\n")]),
        ...spec.pairs.map((pair) =>
          Buffer.from(
            actual.files
              .get(spec.path)
              .toString("utf8")
              .replace(pair.current, () => pair.previous),
          ),
        ),
      ]) {
        const changed = new Map(actual.files);
        changed.set(spec.path, body);
        assert.throws(() => inverse(actual.rows, changed));
      }
    }
    for (const rows of [
      actual.rows.slice(1),
      actual.rows.concat(actual.rows[0]),
      ...subject.files.flatMap((spec) => [
        actual.rows.map((row) =>
          row.path === spec.path ? { ...row, mode: "100755" } : row,
        ),
        actual.rows.map((row) =>
          row.path === spec.path ? { ...row, sha: "0".repeat(40) } : row,
        ),
      ]),
    ])
      assert.throws(() => inverse(rows, actual.files));
    const unrelated = "scripts/cef-runtime-ci.mjs",
      changed = new Map(actual.files);
    changed.set(
      unrelated,
      Buffer.concat([changed.get(unrelated), Buffer.from("\n")]),
    );
    assert.throws(() => inverse(actual.rows, changed));
    assert.throws(() =>
      inverse(
        actual.rows,
        new Map([...actual.files, ["extra", Buffer.from("unreviewed")]]),
      ),
    );
  }
});

test("combined recipes preserve both Mac packaging roots and Linux370 minimal library under distinct qualification scopes", () => {
  for (const target of [
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]) {
    const p = checkpointProfile(target),
      linux = p.platform === "linux";
    const args = [
      "/pinned/autoninja.py",
      "-j",
      "4",
      "-C",
      `out/${p.outConfig}`,
      linux ? "libcef" : "cefclient",
      linux ? "chrome_sandbox" : "cef_sandbox",
    ];
    assert.equal(checkpointCompileArguments(target, args), args);
    assert.throws(
      () =>
        checkpointCompileArguments(
          target,
          args.map((x) => (x === (linux ? "libcef" : "cefclient") ? "cef" : x)),
        ),
      /compile recipe/,
    );
    if (linux) {
      assert.equal(
        p.source,
        "5690461b26b848671a80fcbf68c6974e569f9789476baf106a181b10cd5eb20e",
      );
      assert.deepEqual(p.acceptedImages, ["20261111.370.1"]);
    } else
      assert.equal(
        p.source,
        MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION.sources[target],
      );
  }
});
