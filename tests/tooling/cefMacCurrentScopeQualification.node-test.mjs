import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as mac from "../../scripts/lib/cef-mac-source-metadata.mjs";
import {
  MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION,
  MAC_CENSUS_SUPERVISOR_QUALIFICATION,
  shape,
  LIMITS,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
const q = mac.MAC_SOURCE_SCOPE_QUALIFICATION;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const python = process.platform === "win32" ? "python" : "python3";
const policy = mac.MAC_SOURCE_POLICY;
const host = {
  platform: "darwin",
  architecture: "x64",
  imageOS: "macos15",
  image: q.image,
  githubActions: "true",
  runnerEnvironment: "github-hosted",
  repositoryVisibility: "public",
};
const identity = (p) => ({
  target: p.target,
  source: p.source,
  image: p.image,
  canonicalRoot: `/Users/runner/work/_temp/sorng-cef-engineering/${p.target}/${p.source}`,
});

test("current-source qualification binds raw native artifacts and explicit limited target coverage", () => {
  assert(Object.isFrozen(q) && Object.isFrozen(q.sources));
  assert.equal(MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION, q);
  const raw = readFileSync(q.evidencePath);
  assert.equal(sha(raw), q.evidenceSha256);
  const packet = JSON.parse(raw);
  assert.equal(packet.runId, q.runId);
  assert.equal(packet.proofHead, q.head);
  assert.equal(packet.sourceWitnessSha256, q.sourceWitnessSha256);
  assert.deepEqual(packet.sources, q.sources);
  assert.deepEqual(packet.positiveSupervisorCases["aarch64-apple-darwin"], [
    "foreign",
  ]);
  assert.equal(packet.positiveSupervisorCases["x86_64-apple-darwin"].length, 5);
  assert.equal(packet.nativeARMRuntimeAcceptance, false);
  for (const p of packet.evidence) {
    assert(!p.path.includes("/") && !p.path.includes("\\"));
    const b = readFileSync(path.join(path.dirname(q.evidencePath), p.path));
    assert.equal(b.length, p.bytes);
    assert.equal(sha(b), p.sha256);
  }
  // Verify the immutable Git bodies too: ignored or untracked local evidence
  // must not make a proof package appear complete before a clean checkout.
  const input = packet.evidence
    .map((p) => `HEAD:${path.posix.dirname(q.evidencePath)}/${p.path}\n`)
    .join("");
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    input,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  let offset = 0;
  for (const p of packet.evidence) {
    const end = batch.indexOf(10, offset);
    assert(end >= offset);
    const header = /^[a-f0-9]{40} blob ([0-9]+)$/.exec(
      batch.subarray(offset, end).toString(),
    );
    assert(header, "Committed qualification evidence is missing");
    offset = end + 1;
    assert.equal(Number(header[1]), p.bytes);
    assert.equal(sha(batch.subarray(offset, offset + p.bytes)), p.sha256);
    offset += p.bytes;
    assert.equal(batch[offset++], 10);
  }
  assert.equal(offset, batch.length);
  assert.notEqual(
    q.supervisorScopeSha256,
    MAC_CENSUS_SUPERVISOR_QUALIFICATION.sha256,
  );
  assert.equal(
    q.supervisorScopeSha256,
    "9b69d10cd60653a9442f4baa919389598534476e450954806beeb2221160efbe",
  );
});
test("current-source qualification refuses data clones missing proof and scope literal drift", () => {
  for (const p of [mac.MAC_SOURCE_POLICY, mac.MAC_INTEL_SOURCE_POLICY]) {
    assert.equal(mac.macSourceScopeQualified(p), true);
    const good = identity(p);
    (p === policy
      ? mac.validateMacSourceWriteScope
      : mac.validateMacIntelSourceWriteScope)(good, host);
    for (const change of [
      { sourceScopeQualification: undefined },
      { sourceScopeQualification: { ...q } },
      { source: "0".repeat(64) },
      { image: "latest" },
    ])
      assert.equal(mac.macSourceScopeQualified({ ...p, ...change }), false);
  }
});
test("current-source qualification actual JS source gate rejects the old unsupported scalar admission", () => {
  const raw = readFileSync("scripts/lib/cef-mac-source-metadata.mjs", "utf8"),
    from = raw.indexOf("export function validateMacSourceWriteScope("),
    to = raw.indexOf("export function assertMacSourceWriteAdmission(", from);
  const code = raw.slice(from, to).replace("export function ", "function ");
  const bad = { ...policy, sourceScopeQualification: undefined };
  const bind = (body) =>
    vm.runInNewContext("(" + body + ")", {
      assert,
      MAC_SOURCE_POLICY: bad,
      macSourceScopeQualified: mac.macSourceScopeQualified,
    });
  assert.throws(() => bind(code)(identity(policy), host), /HOST_SCOPE/);
  const old = code.replace(
    /\s*macSourceScopeQualified\(MAC_SOURCE_POLICY\) &&/,
    "",
  );
  assert.notEqual(old, code);
  assert.doesNotThrow(() => bind(old)(identity(policy), host));
});
test("current-source qualification actual census source gate rejects detached fresh-proof data", () => {
  const raw = readFileSync(
      "scripts/lib/cef-engineering-checkpoint.mjs",
      "utf8",
    ),
    from = raw.indexOf("function censusScope("),
    to = raw.indexOf("async function censusOwnedRoot(", from),
    body = raw.slice(from, to);
  const value = {
    target: policy.target,
    source: policy.source,
    canonicalRoot: identity(policy).canonicalRoot,
    scratch:
      "/Users/runner/work/_temp/cef-mac-census-production-11111111-1111-4111-8111-111111111111",
    python:
      "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
    deadline: 1000,
  };
  const context = (qualification) => ({
    assert,
    shape,
    macSourceScopeQualified: mac.macSourceScopeQualified,
    MAC_CENSUS_SOURCES: q.sources,
    MAC_CENSUS_SOURCE_SCOPE_QUALIFICATION: qualification,
    MAC_CENSUS_PYTHON: value.python,
    LIMITS,
    path: path.posix,
    performance: { now: () => 0 },
    process: {
      platform: "darwin",
      arch: "x64",
      env: {
        ImageOS: "macos15",
        ImageVersion: q.image,
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_TEMP: "/Users/runner/work/_temp",
      },
    },
  });
  vm.runInNewContext("(" + body + ")", context(q))(value, false);
  assert.throws(
    () => vm.runInNewContext("(" + body + ")", context({ ...q }))(value, false),
    /CENSUS_ROOT/,
  );
});
test("current-source qualification Python data matches JS and actual closed admission controls pass", () => {
  const args = [
    "-I",
    "-B",
    "-S",
    "tests/fixtures/cef/mac_scope_qualification_test.py",
  ];
  const encoded = spawnSync(python, [...args, "--record"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 16384,
  });
  assert.equal(encoded.status, 0, encoded.stderr);
  const actual = JSON.parse(encoded.stdout),
    expected = Object.entries(q).map(([key, value]) =>
      key === "sources" ? Object.entries(value) : value,
    );
  assert.deepEqual(actual, expected);
  const result = spawnSync(python, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 32768,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 8 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
