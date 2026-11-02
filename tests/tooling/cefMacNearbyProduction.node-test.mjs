import test from "node:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  MAC_SOURCE_POLICY,
  MAC_INTEL_SOURCE_POLICY,
  MAC_NEARBY_LITERAL_EVIDENCE,
  MAC_CLANG_LITERAL_EVIDENCE,
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
test("both canonical policies select v3 and pin the actual raw proof separately from its ZIP", () => {
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
  assert.deepEqual(MAC_CLANG_LITERAL_EVIDENCE, {
    runId: 41391838299,
    runAttempt: 1,
    artifactId: 13117472436,
    source: "1c34a3aea224f32060975f74e268dd09c00251f8",
    rawProofBytes: 3099,
    rawProofSha256:
      "334da737759e35e9f2319ea8ebf7bfd8f81617cd799182f2168d5cf5504974df",
    rawCarrierBytes: 708,
    rawCarrierSha256:
      "862d3aa8e1e108a4602834ef3486e705e9603b4df6eac8261451e1cb13d7b7e6",
    artifactZipBytes: 1725,
    artifactZipSha256:
      "1f03279fcf452893b397648e3e27180f09da2c6a21591800bb6e14b3665d0cc9",
    sourceWitnessSha256:
      "5df938947c4fd9d78dad0934338a213eadbf4f7d3175cb2d17aeac9a8f649506",
    qualifiedHelperBytes: 198811,
    qualifiedHelperSha256:
      "5af4cb39c9c15e6d115eeca3a6bf4d893bf45af43595a5e65a34c4d114973d79",
  });
  assert(Object.isFrozen(MAC_CLANG_LITERAL_EVIDENCE));
  for (const [policy] of rows) {
    assert.equal(policy.schemaVersion, 3);
    assert(policy.name.endsWith("-v3-nearby-clang-literals"));
    assert(policy.legacyPrivatePolicy.endsWith("-v1"));
    assert.equal(policy.nearbyEvidence, MAC_NEARBY_LITERAL_EVIDENCE);
    assert.equal(policy.compilerEvidence, MAC_CLANG_LITERAL_EVIDENCE);
  }
});

test("Python and JavaScript select the same v3 policy and native evidence without replacing Nearby evidence", () => {
  const child = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "-c",
      `import importlib.util,json
s=importlib.util.spec_from_file_location('codec','scripts/lib/cef-checkpoint-archive.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps([m.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED,m.MAC_ARM_CLANG_METADATA_POLICY,m.MAC_INTEL_CLANG_METADATA_POLICY,m.MAC_CLANG_LITERAL_PROOF]))`,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const e = MAC_CLANG_LITERAL_EVIDENCE;
  assert.deepEqual(JSON.parse(child.stdout), [
    true,
    MAC_SOURCE_POLICY.name,
    MAC_INTEL_SOURCE_POLICY.name,
    [
      e.runId,
      e.runAttempt,
      e.artifactId,
      e.source,
      e.rawProofBytes,
      e.rawProofSha256,
      e.rawCarrierBytes,
      e.rawCarrierSha256,
      e.artifactZipBytes,
      e.artifactZipSha256,
      e.sourceWitnessSha256,
      e.qualifiedHelperBytes,
      e.qualifiedHelperSha256,
    ],
  ]);
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
