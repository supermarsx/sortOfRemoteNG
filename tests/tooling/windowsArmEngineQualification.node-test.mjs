import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const base = "native/windows-arm-full-sdk/";
const policy = JSON.parse(
  await readFile(base + "engine-qualification-profile.json", "utf8"),
);
const hash = (raw) => createHash("sha256").update(raw).digest("hex");

test("inert Windows ARM qualification executes only its portable candidate/denial tests", () => {
  const result = spawnSync(
    "python",
    ["-I", "-B", base + "test_engine_qualification.py"],
    {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 65536,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 19 tests/);
  assert.match(result.stderr, /\bOK\b/);
});

test("new planning metadata cannot change the two actual source/GN recipe admissions or source locks", async () => {
  assert.equal(policy.executionAdmitted, false);
  assert.equal(policy.nativeAcceptance, false);
  assert.equal(policy.sdkBuilt, false);
  for (const [image, selected] of Object.entries(policy.images)) {
    const bytes = await readFile(base + selected.profile);
    assert.equal(hash(bytes), selected.profileSha256);
    const original = JSON.parse(bytes);
    assert.equal(original.image, image);
    assert.equal(original.sourceGn.sourceId, selected.sourceId);
    assert.deepEqual(original.admission, {
      sourceAcquisitionAllowed: true,
      gnAllowed: true,
      engineCompilationAllowed: false,
      sdkAllowed: false,
      restoreAllowed: false,
      publicationAllowed: false,
    });
    const lock = JSON.parse(
      await readFile(selected.namespace + "source-lock.json", "utf8"),
    );
    assert.equal(lock.upstream.chromium.commit, policy.chromium);
    assert.equal(lock.upstream.cef.commit, policy.cef);
    assert.equal(lock.patches.length, 23);
  }
  for (const name of [
    base + "producer.py",
    base + "job.py",
    ".github/workflows/windows-arm-source-preflight.yml",
  ])
    assert(!(await readFile(name, "utf8")).includes("engine_qualification"));
});
