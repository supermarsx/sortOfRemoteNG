import { CURRENT_SLOW_SNAPSHOT_PRODUCER } from "./helpers/cefSlowSnapshotReviewedHistory.mjs";
import { beforeCompositeFreshDataForHistory } from "./helpers/cefCompositeReviewedHistory.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { beforeCensusDataForHistory } from "./helpers/cefCensusRetirementReviewedHistory.mjs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  plan,
  assertHostedBuildIdentity,
} from "../../scripts/cef-runtime-ci.mjs";
import {
  identitySha256,
  validateSourceLock,
  customRuntimeBuildRecipe,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  checkpointProfile,
  checkpointCompileArguments,
  validateIdentity,
  codeTreeDigest,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  beforeLinuxFreshDataForHistory,
  beforeLinuxFreshRowsForHistory,
  inverseLinuxFreshFile,
  beforeLinuxFreshProfileForHistory,
} from "./helpers/cefLinuxFreshReviewedHistory.mjs";
const ROOT = process.cwd(),
  target = "aarch64-unknown-linux-gnu";
const next =
  "native/cef-build-inputs/20261114-r5-linuxarm-cross-sysroot-external-webview-char-20261111-370-1";
const previous =
  "native/cef-build-inputs/20261028-r5-linuxarm-cross-sysroot-external-webview-char-20261026-354-1";
const source =
  "5690461b26b848671a80fcbf68c6974e569f9789476baf106a181b10cd5eb20e";
const oldSource =
  "8c5af5d375371adef2e1a32d872f5c55f907d26786b698e5ab2aef0fdfb9f8eb";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));
const lock = validateSourceLock(json(next + "/source-lock.json")),
  old = validateSourceLock(json(previous + "/source-lock.json"));
const review = json(next + "/review-receipt.json"),
  map = json(next + `/cef-ci-runner-${target}.json`);
const data = json("tests/fixtures/cef/linux370_fresh_inverse.json");

test("Linux370 fresh namespace preserves every inherited source payload and binds only new host map and locks", () => {
  assert.equal(identitySha256(lock), source);
  assert.equal(identitySha256(old), oldSource);
  assert.deepEqual(lock.upstream, old.upstream);
  assert.deepEqual(lock.bridge, old.bridge);
  assert.deepEqual(lock.patches, old.patches);
  assert.equal(lock.patches.length, 25);
  assert.equal(review.retainedSourcePayloads.length, 28);
  for (const pin of review.retainedSourcePayloads) {
    const b = readFileSync(path.join(ROOT, next, pin.path));
    assert.equal(b.length, pin.bytes);
    assert.equal(sha(b), pin.sha256);
    assert.deepEqual(b, readFileSync(path.join(ROOT, previous, pin.path)));
  }
  for (const pin of review.changedInputs) {
    const b = readFileSync(path.join(ROOT, next, pin.path));
    assert.equal(b.length, pin.bytes);
    assert.equal(sha(b), pin.sha256);
  }
  assert.deepEqual(review.acceptedImageAliases, []);
  assert.equal(review.oldCheckpointReuseAllowed, false);
  assert.equal(review.old354370EquivalenceClaim, false);
  assert.equal(review.firstBuildRestoreRun, 0);
  assert.equal(review.sdk, false);
  assert.equal(review.runtimeReady, false);
});

test("Linux370 exact canonical host admits370 and rejects historical images and scope drift", () => {
  const profile = checkpointProfile(target);
  assert.equal(profile.inputs, next);
  assert.equal(profile.source, source);
  assert.deepEqual([...profile.acceptedImages], ["20261111.370.1"]);
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ImageOS: "ubuntu24",
    ImageVersion: "20261111.370.1",
  };
  assert.equal(
    assertHostedBuildIdentity(
      map,
      target,
      env,
      "linux",
      "x64",
      profile.acceptedImages,
    ).imageVersion,
    env.ImageVersion,
  );
  for (const image of [
    "20261026.354.1",
    "20261101.360.1",
    "20261111.370.2",
    "",
    undefined,
  ])
    assert.throws(
      () =>
        assertHostedBuildIdentity(
          map,
          target,
          { ...env, ImageVersion: image },
          "linux",
          "x64",
          profile.acceptedImages,
        ),
      /reviewed image identity changed/,
    );
  for (const [e, p, a] of [
    [{ ...env, ImageOS: "ubuntu22" }, "linux", "x64"],
    [env, "linux", "arm64"],
    [env, "darwin", "x64"],
    [{ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, "linux", "x64"],
  ])
    assert.throws(() =>
      assertHostedBuildIdentity(map, target, e, p, a, profile.acceptedImages),
    );
  assert.deepEqual(beforeLinuxFreshProfileForHistory(profile).acceptedImages, [
    "20261026.354.1",
    "20261101.360.1",
  ]);
});

test("Linux370 observations bind the authenticated raw370 tool files and retain changed host package provenance", () => {
  const obs = json(next + "/evidence/host-observation.json"),
    tools = json(next + `/tools/${target}.json`),
    provision = json(next + "/evidence/host-provision.json");
  assert.deepEqual(obs.image, { os: "ubuntu24", version: "20261111.370.1" });
  assert.deepEqual(obs.files, tools.files.slice(0, 4));
  assert.deepEqual(obs.blockers, []);
  assert.equal(provision.completed, true);
  for (const pin of review.hostObservation.rawMembers) {
    const b = readFileSync(path.join(ROOT, next, pin.path));
    assert.equal(b.length, pin.bytes);
    assert.equal(sha(b), pin.sha256);
  }
  assert.equal(review.hostObservation.artifact.id, 13975089108);
  assert.equal(
    review.hostObservation.artifact.sha256,
    "4ff31c9207c79e4f3e108e88446958ee9f5a5ede4a213f8f61c0189a3092cf86",
  );
  assert.equal(review.newHostProvenance.systemPackageChanges, 39);
  assert.notEqual(
    review.newHostProvenance.gitPackage.before,
    review.newHostProvenance.gitPackage.after,
  );
  assert.equal(review.newHostProvenance.hermeticToolchainAttestation, false);
});

test("Linux370 actual hosted plan and minimal recipe preserve compiler and packaging controls", async () => {
  const result = await plan({
    inputs: next,
    target,
    checkout: ROOT,
    runnerMode: "hosted",
  });
  assert.equal(identitySha256(result.sourceLock), source);
  assert.equal(result.matrix.include[0].runners, "ubuntu-24.04");
  assert.equal(
    result.matrix.include[0].provisionTarget,
    "x86_64-unknown-linux-gnu",
  );
  const checkouts = {
    chromium: path.join(ROOT, "fixture/src"),
    cef: path.join(ROOT, "fixture/src/cef"),
    depotTools: path.join(ROOT, "fixture/depot_tools"),
  };
  const recipe = await customRuntimeBuildRecipe({
    sourceLock: lock,
    target,
    inputsRoot: path.join(ROOT, next),
    checkouts,
  });
  const prior = await customRuntimeBuildRecipe({
    sourceLock: old,
    target,
    inputsRoot: path.join(ROOT, previous),
    checkouts,
  });
  assert.deepEqual(recipe.commands, prior.commands);
  assert.deepEqual(recipe.environment, prior.environment);
  assert.equal(recipe.executed, false);
  assert.equal(recipe.productionReady, false);
  assert.deepEqual(recipe.commands[1].args.slice(-2), [
    "libcef",
    "chrome_sandbox",
  ]);
  assert(recipe.commands[2].args.includes("--minimal"));
  const args = [
    checkouts.depotTools + "/autoninja.py",
    "-j",
    "4",
    "-C",
    "out/Release_GN_arm64",
    "libcef",
    "chrome_sandbox",
  ];
  assert.equal(checkpointCompileArguments(target, args), args);
  const aggregate = [...args];
  aggregate[5] = "cef";
  assert.throws(
    () => checkpointCompileArguments(target, aggregate),
    /compile recipe/,
  );
});

test("Linux370 source and image identities cannot relabel the historical checkpoint identity", () => {
  const identity = {
    target,
    source,
    producer: data.currentProducer,
    canonicalRoot: path.resolve(ROOT, "fixture-fresh-owner"),
    image: "20261111.370.1",
    tools: "a".repeat(64),
    graph: "b".repeat(64),
    siso: "c".repeat(64),
  };
  const key = validateIdentity(identity);
  assert.throws(
    () => validateIdentity({ ...identity, source: oldSource }),
    /checkpoint source/,
  );
  assert.notEqual(
    key,
    validateIdentity({ ...identity, image: "20261026.354.1" }),
  );
  const oldMap = json(previous + `/cef-ci-runner-${target}.json`);
  assert.equal(oldMap.hosted.imageVersion, "20261026.354.1");
  assert.notEqual(
    sha(readFileSync(path.join(ROOT, next, `tools/${target}.json`))),
    sha(readFileSync(path.join(ROOT, previous, `tools/${target}.json`))),
  );
});

test("historical Linux370 closed history rewinds both complete source files and refuses body mode row and nonselected drift", () => {
  const git = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: ROOT,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16 << 20,
      ...options,
    });
  const currentRows = git([
    "ls-tree",
    "-r",
    "HEAD",
    "--",
    "scripts",
    "native/cef-hosted-recipe.json",
    ".node-version",
    ".github/workflows/cef-engineering-checkpoint.yml",
  ])
    .toString()
    .trim()
    .split("\n")
    .map((l) => {
      const [left, path] = l.split("\t"),
        [mode, type, sha] = left.split(" ");
      return { mode, type, sha, path };
    });
  assert.equal(codeTreeDigest(currentRows), CURRENT_SLOW_SNAPSHOT_PRODUCER);
  const batch = git(["cat-file", "--batch"], {
    input: currentRows.map((r) => `HEAD:${r.path}\n`).join(""),
  });
  let at = 0;
  const currentFiles = new Map();
  for (const row of currentRows) {
    const end = batch.indexOf(10, at),
      match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(
        batch.subarray(at, end).toString(),
      );
    assert(match);
    assert.equal(match[1], row.sha);
    at = end + 1;
    const n = Number(match[2]);
    currentFiles.set(row.path, Buffer.from(batch.subarray(at, at + n)));
    at += n;
    assert.equal(batch[at++], 10);
  }
  assert.equal(at, batch.length);
  const { rows, files } = beforeCompositeFreshDataForHistory(
    currentRows,
    currentFiles,
  );
  assert.equal(codeTreeDigest(rows), data.currentProducer);
  const before = beforeLinuxFreshDataForHistory(rows, files);
  assert.equal(codeTreeDigest(before.rows), data.beforeProducer);
  assert.deepEqual(beforeLinuxFreshRowsForHistory(rows, ROOT), before.rows);
  for (const spec of data.files) {
    const raw = before.files.get(spec.path);
    assert.equal(sha(raw), spec.before.sha256);
    const damaged = Buffer.from(files.get(spec.path));
    damaged[Math.floor(damaged.length / 2)] ^= 1;
    assert.throws(() => inverseLinuxFreshFile(damaged, spec.path));
    const wrong = new Map(files);
    wrong.set(spec.path, damaged);
    assert.throws(() => beforeLinuxFreshDataForHistory(rows, wrong));
    const mode = rows.map((r) =>
      r.path === spec.path ? { ...r, mode: "100755" } : r,
    );
    assert.throws(() => beforeCensusDataForHistory(mode, files));
  }
  const wrong = new Map(files),
    p = "scripts/lib/browser-custom-runtime.mjs";
  wrong.set(p, Buffer.concat([wrong.get(p), Buffer.from("\n")]));
  assert.throws(() => beforeLinuxFreshDataForHistory(rows, wrong));
});
