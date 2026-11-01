import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import * as mac from "../../scripts/lib/cef-mac-source-metadata.mjs";
const source = await readFile(
  "scripts/lib/cef-mac-source-metadata.mjs",
  "utf8",
);
const policy = mac.MAC_INTEL_SOURCE_POLICY;
const host = {
  platform: "darwin",
  architecture: "x64",
  imageOS: "macos15",
  image: "20260824.0482.1",
  githubActions: "true",
  runnerEnvironment: "github-hosted",
  repositoryVisibility: "public",
};
const identity = {
  target: policy.target,
  source: policy.source,
  image: policy.image,
  canonicalRoot:
    "/Users/runner/work/_temp/sorng-cef-engineering/x86_64-apple-darwin/" +
    policy.source,
};
const env = {
  ImageOS: host.imageOS,
  ImageVersion: host.image,
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
};
const runner = {
  target: policy.target,
  hosted: {
    platform: "darwin",
    architecture: "x64",
    imageOS: host.imageOS,
    imageVersion: host.image,
    runner: "macos-15-intel",
  },
};
function binder(
  process = { platform: "darwin", arch: "x64", env: { ...env } },
) {
  const code = source.slice(
    source.indexOf("export function assertMacIntelSourceWriteAdmission("),
    source.indexOf("export function macIntelSourceMetadataPlan("),
  );
  return vm.runInNewContext(
    "(" + code.replace("export function ", "function ") + ")",
    {
      assert,
      process,
      MAC_INTEL_SOURCE_POLICY: policy,
      validateMacIntelSourceWriteScope: mac.validateMacIntelSourceWriteScope,
    },
  );
}
test("Intel scope binds immutable raw proof and ZIP hashes with distinct labels", () => {
  assert(Object.isFrozen(policy) && Object.isFrozen(policy.evidence));
  assert.equal(policy.darwinWriteAdmitted, true);
  assert.equal(
    policy.source,
    "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
  );
  assert.deepEqual(policy.evidence, {
    runId: 41348226366,
    artifactId: 13099539006,
    source: "499ade0595d3e3d90fa15aea1ffb8499e297bf3f",
    rawProofBytes: 16278,
    rawProofSha256:
      "2e56488f480ed75dc479569d5214914b4b2ed0e73732e2a1723156d85a0ca249",
    artifactZipSha256:
      "c34dde53d28645ddb78c0ac7b97b40df48d6acce10ff260462bb7178c6f9aab5",
  });
  assert.throws(() => (policy.evidence.rawProofSha256 = "forged"), TypeError);
});
test("Intel admission requires exact actual host and source scope rather than caller environment claims", () => {
  mac.validateMacIntelSourceWriteScope(identity, host);
  for (const change of [
    { platform: "linux" },
    { architecture: "arm64" },
    { imageOS: "macos14" },
    { image: "latest" },
    { githubActions: "false" },
    { runnerEnvironment: "self-hosted" },
    { repositoryVisibility: "private" },
  ])
    assert.throws(
      () =>
        mac.validateMacIntelSourceWriteScope(identity, { ...host, ...change }),
      /HOST_SCOPE/,
    );
  for (const change of [
    { target: "aarch64-apple-darwin" },
    { source: "0".repeat(64) },
    { image: "latest" },
    { canonicalRoot: identity.canonicalRoot + "/child" },
  ])
    assert.throws(
      () =>
        mac.validateMacIntelSourceWriteScope({ ...identity, ...change }, host),
      /IDENTITY_SCOPE/,
    );
  binder()(identity, env, runner);
  assert.throws(
    () => binder()(identity, { ...env, ImageVersion: "caller-spoof" }, runner),
    /ENV_SCOPE/,
  );
  assert.throws(
    () =>
      binder({
        platform: "darwin",
        arch: "x64",
        env: { ...env, GITHUB_REPOSITORY_VISIBILITY: "private" },
      })(identity, env, runner),
    /HOST_SCOPE/,
  );
  assert.throws(
    () =>
      binder()(identity, env, {
        ...runner,
        hosted: { ...runner.hosted, runner: "macos-15" },
      }),
    /RUNNER_SCOPE/,
  );
});
test("Intel metadata plan accepts only the scoped output and closed modes", () => {
  const code = source.slice(
    source.indexOf("export function macIntelSourceMetadataPlan("),
    source.indexOf("const sdkRelations"),
  );
  const plan = vm.runInNewContext(
    "(" + code.replace("export function ", "function ") + ")",
    {
      assert,
      MAC_INTEL_SOURCE_POLICY: policy,
      assertMacIntelSourceWriteAdmission: binder(),
      plainAbsolute: (file) => {
        assert(
          path.posix.isAbsolute(file) && path.posix.normalize(file) === file,
        );
        return file;
      },
    },
  );
  const out = identity.canonicalRoot + "/source/src/out/Release_GN_x64";
  for (const mode of ["source-record", "source-apply", "source-verify"]) {
    const value = plan(identity, out, mode);
    assert.equal(value.platformPolicy, "mac-intel");
    assert.equal(value.source, identity.canonicalRoot + "/source");
    assert.equal(value.sidecar, out + "/.siso_sorng_source_metadata.json");
  }
  for (const [changed, output, mode] of [
    [{ ...identity, image: "latest" }, out, "source-record"],
    [{ ...identity, source: "0".repeat(64) }, out, "source-record"],
    [identity, out + "/other", "source-apply"],
    [identity, out, "pack"],
  ])
    assert.throws(() => plan(changed, output, mode));
});
test("Intel authoritative hook validates full scope before entering the unchanged fixed-five body", async () => {
  const code = source.slice(
    source.indexOf("export async function prepareAuthoritativeMacIntelGn("),
    source.indexOf("async function prepareAuthoritativeMacGnFor("),
  );
  const envelope = { target: policy.target };
  let calls = 0;
  const run = vm.runInNewContext(
    "(" + code.replace("export async function ", "async function ") + ")",
    {
      assert,
      MAC_INTEL_SOURCE_POLICY: policy,
      assertMacIntelSourceWriteAdmission: binder(),
      INTEL_EXTERNAL: envelope,
      prepareAuthoritativeMacGnFor: (actual, context, check) => {
        assert.equal(actual, envelope);
        assert.equal(context.sourceLockIdentity, policy.source);
        calls++;
        check();
        return "collected";
      },
    },
  );
  const context = {
    runner,
    sourceLockIdentity: policy.source,
    work: identity.canonicalRoot,
    env,
  };
  let checked = 0;
  assert.equal(await run(context, () => checked++), "collected");
  assert.equal(calls, 1);
  assert.equal(checked, 1);
  await assert.rejects(
    run({ ...context, sourceLockIdentity: "0".repeat(64) }, () =>
      assert.fail("invalid scope cannot reach clock or IO"),
    ),
    /IDENTITY_SCOPE/,
  );
  assert.equal(calls, 1);
});
test("runtime early environment assertion passes the actual inherited facts and reviewed runner", async () => {
  const runtime = await readFile("scripts/cef-runtime-ci.mjs", "utf8");
  assert.match(
    runtime,
    /if\s*\(sourceMetadata === "mac-intel"\)\s*assertMacIntelSourceWriteAdmission\(\s*undefined,\s*inherited,\s*map\s*\)/,
  );
});
