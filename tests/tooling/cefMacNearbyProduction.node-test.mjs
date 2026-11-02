import test from "node:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  MAC_SOURCE_POLICY,
  MAC_INTEL_SOURCE_POLICY,
  MAC_NEARBY_LITERAL_EVIDENCE,
  validateMacSourceWriteScope,
  validateMacIntelSourceWriteScope,
  assertMacSourceWriteAdmission,
  assertMacIntelSourceWriteAdmission,
  macSourceMetadataPlan,
  macIntelSourceMetadataPlan,
} from "../../scripts/lib/cef-mac-source-metadata.mjs";
const host = () => ({
  platform: "darwin",
  architecture: "x64",
  imageOS: "macos15",
  image: "20260824.0482.1",
  githubActions: "true",
  runnerEnvironment: "github-hosted",
  repositoryVisibility: "public",
});
const environment = () => ({
  ImageOS: "macos15",
  ImageVersion: "20260824.0482.1",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
});
const rows = [
  [
    MAC_SOURCE_POLICY,
    validateMacSourceWriteScope,
    assertMacSourceWriteAdmission,
    macSourceMetadataPlan,
    "arm64",
    "mac-arm",
  ],
  [
    MAC_INTEL_SOURCE_POLICY,
    validateMacIntelSourceWriteScope,
    assertMacIntelSourceWriteAdmission,
    macIntelSourceMetadataPlan,
    "x64",
    "mac-intel",
  ],
];
const identity = (policy) => ({
  target: policy.target,
  source: policy.source,
  image: policy.image,
  canonicalRoot:
    "/Users/runner/work/_temp/sorng-cef-engineering/" +
    policy.target +
    "/" +
    policy.source,
  ...Object.fromEntries(
    ["producer", "tools", "graph", "siso"].map((key) => [key, "c".repeat(64)]),
  ),
});
test("both canonical policies select v2 and pin the actual raw proof separately from its ZIP", () => {
  assert.deepEqual(MAC_NEARBY_LITERAL_EVIDENCE, {
    runId: 41359670492,
    artifactId: 13104029618,
    source: "0b12590921384faa4eef4a64a6c9c0cd5a699ead",
    rawProofBytes: 2052,
    rawProofSha256:
      "6edf2afc493e35c5089ffa64c6686701e234323fe6e502a29a24644bb808ce33",
    artifactZipBytes: 827,
    artifactZipSha256:
      "357439ca1b6cf013ed6e0f3aca0f773faa06bf5ffb6c90b33ee97c8fbc1e7c8d",
  });
  assert(Object.isFrozen(MAC_NEARBY_LITERAL_EVIDENCE));
  for (const [policy] of rows) {
    assert.equal(policy.schemaVersion, 2);
    assert(policy.name.endsWith("-v2-nearby-literals"));
    assert(policy.legacyPrivatePolicy.endsWith("-v1"));
    assert.equal(policy.nearbyEvidence, MAC_NEARBY_LITERAL_EVIDENCE);
  }
});
test("both pure scopes require all actual qualified host facts and exact source/image/root", () => {
  for (const [policy, validate] of rows) {
    validate(identity(policy), host());
    for (const key of Object.keys(host()))
      assert.throws(() =>
        validate(identity(policy), { ...host(), [key]: "foreign" }),
      );
    for (const key of ["target", "source", "image", "canonicalRoot"])
      assert.throws(() =>
        validate({ ...identity(policy), [key]: "foreign" }, host()),
      );
  }
});
test("actual assertion body fences actual process facts before identity getters and ignores supplied host pretence", () => {
  for (const [policy, validate, admission] of rows) {
    const processModel = {
      platform: "darwin",
      arch: "x64",
      env: environment(),
    };
    const dependencies = {
      assert,
      process: processModel,
      MAC_SOURCE_POLICY,
      MAC_INTEL_SOURCE_POLICY,
      validateMacSourceWriteScope: validateMacSourceWriteScope,
      validateMacIntelSourceWriteScope: validateMacIntelSourceWriteScope,
    };
    const run = new Function(
      ...Object.keys(dependencies),
      `return (${admission.toString()});`,
    )(...Object.values(dependencies));
    run(identity(policy), environment());
    for (const key of Object.keys(environment())) {
      processModel.env = { ...environment(), [key]: "foreign" };
      const forbidden = new Proxy(
        {},
        {
          get() {
            assert.fail("unqualified host must precede identity reads");
          },
        },
      );
      assert.throws(() => run(forbidden, environment()), /HOST_SCOPE/);
    }
    processModel.env = environment();
    assert.throws(
      () => run(undefined, { ...environment(), ImageVersion: "pretend-image" }),
      /ENV_SCOPE/,
    );
    assert.equal(typeof validate, "function");
  }
});
test("real public plan runs positively on its qualified native host and denies off-host", () => {
  const qualified =
    process.platform === "darwin" &&
    process.arch === "x64" &&
    Object.entries(environment()).every(
      ([key, value]) => process.env[key] === value,
    );
  for (const [policy, , , plan, cpu, platformPolicy] of rows) {
    const selected = identity(policy),
      out = selected.canonicalRoot + "/source/src/out/Release_GN_" + cpu;
    for (const mode of ["source-record", "source-apply", "source-verify"])
      if (qualified)
        assert.deepEqual(plan(selected, out, mode), {
          mode,
          source: selected.canonicalRoot + "/source",
          sidecar: out + "/.siso_sorng_source_metadata.json",
          platformPolicy,
        });
      else assert.throws(() => plan(selected, out, mode), /HOST_SCOPE/);
  }
});
test("Python public capability, canonical v1 denial and unchanged qualified core tests pass", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "tests/fixtures/cef/mac_nearby_production_metadata_test.py",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 12 tests/);
  assert.match(result.stderr, /\bOK\b/);
});

test("ordinary browser contracts execute both production and retained private proof tests", async () => {
  const workflow = YAML.parse(
    await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  const step = workflow.jobs["browser-transport-contracts"].steps.find(
    (row) => row.name === "Runtime package layout and whole-matrix contract",
  );
  assert.equal(step.if, undefined);
  assert.equal(step["continue-on-error"], undefined);
  for (const name of [
    "cefMacNearbyProduction.node-test.mjs",
    "cefMacNearbySourceProof.node-test.mjs",
  ])
    assert.equal(
      step.run.split(/\s+/).filter((arg) => arg === "tests/tooling/" + name)
        .length,
      1,
    );
});
