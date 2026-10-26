import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { EventEmitter } from "node:events";
const root = fileURLToPath(new URL("../../", import.meta.url));
const workflowPath = ".github/workflows/windows-x64-arm-toolchain.yml";
const wf = await readFile(path.join(root, workflowPath), "utf8");
// Dependency-free contracts: exact closed YAML fragments; actionlint validates syntax.
const jobHeader = wf.match(/jobs:\n  toolchain:\n([\s\S]*?)    steps:/)[1];
const checkoutEnvLines = wf
  .match(
    /uses: actions\/checkout@[^\n]+\n        env:\n([\s\S]*?)        with:/,
  )[1]
  .trim()
  .split("\n")
  .map((x) => x.trim());
const checkoutEnv = Object.fromEntries(
  checkoutEnvLines.map((line) => {
    const at = line.indexOf(":");
    const value = line.slice(at + 1).trim();
    return [
      line.slice(0, at),
      value.startsWith('"') ? JSON.parse(value) : value,
    ];
  }),
);
const profileRaw = await readFile(
  path.join(root, "native/windows-arm-runtime-closure/profile.json"),
);
const profile = JSON.parse(profileRaw);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const body = wf.match(
  /\/\/ BEGIN FIXED CARRIER AUTHORITY\n([\s\S]*?)\/\/ END FIXED CARRIER AUTHORITY/,
)[1];
const authority = new Function("assert", body + "\nreturn carrierAuthority;")(
  assert,
);
const ref = "refs/heads/codex/ci-windows-arm-runtime-closure-20261026";
function fixture() {
  const e = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: ref,
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF: `supermarsx/sortOfRemoteNG/${workflowPath}@${ref}`,
  };
  const event = {
    repository: {
      id: 1010282954,
      full_name: "supermarsx/sortOfRemoteNG",
      private: false,
      visibility: "public",
      default_branch: "main",
    },
    inputs: null,
  };
  return { e, event };
}
test("hosted manual carrier has fixed branch, image, permissions and cancel-older policy", () => {
  assert.match(
    wf,
    /^on:\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:/m,
  );
  assert.match(wf, /  cancel-in-progress: true\njobs:/);
  assert.match(wf, /group: windows-arm-runtime-closure-.*github\.ref/);
  assert.match(jobHeader, /runs-on: windows-2025-vs2026/);
  assert.match(jobHeader, /timeout-minutes: 10/);
  assert(jobHeader.includes(ref));
  assert.equal(profile.image, "20261021.278.1");
  assert.equal(profile.buildAdmission, false);
  assert.match(
    wf,
    /name: Owned passive runtime metadata without executing vendor files\n        timeout-minutes: 4\n        shell: bash/,
  );
  assert.match(wf, /workMs=120000/);
  assert.match(wf, /process\.env\.ImageVersion,p\.image/);
});
test("actual Node authority rejects Main, old carrier, foreign identity, input and workflow drift", () => {
  const { e, event } = fixture();
  authority(e, event);
  authority(e, { ...event, inputs: {} });
  for (const [key, value] of [
    ["GITHUB_REF", "refs/heads/main"],
    [
      "GITHUB_REF",
      "refs/heads/codex/ci-windows-arm-cross-sdk-carrier-20261026",
    ],
    ["CEF_DEFAULT_BRANCH", "other"],
    ["GITHUB_REPOSITORY_ID", "1"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_WORKFLOW_REF", "wrong"],
  ])
    assert.throws(() => authority({ ...e, [key]: value }, event));
  for (const inputs of [[], { mode: "observe" }, "", false])
    assert.throws(() => authority(e, { ...event, inputs }));
  assert.throws(() =>
    authority(e, {
      ...event,
      repository: { ...event.repository, private: true },
    }),
  );
});
test("canonical six source paths and both profile pins bind exact native bytes", async () => {
  assert.deepEqual(profile.sourcePaths, [
    workflowPath,
    "native/windows-arm-runtime-closure/profile.json",
    "native/windows-arm-runtime-closure/observe.py",
    "native/windows-arm-runtime-closure/job.py",
    "native/windows-arm-runtime-closure/test_observe.py",
    "tests/tooling/windowsArmRuntimeClosure.node-test.mjs",
  ]);
  for (const name of ["observe.py", "job.py"]) {
    const raw = await readFile(
      path.join(root, "native/windows-arm-runtime-closure", name),
      "utf8",
    );
    assert.match(raw, new RegExp(`PROFILE_SHA = "${sha(profileRaw)}"`));
  }
  assert.equal(
    profile.python.sha256,
    "4d6f5f81a4bca11191c4c7c6b43632694d0a4ce74e068619d8fdc161d469859a",
  );
  assert.equal(profile.python.bytes, 104952);
  assert.equal(profile.roles.length, 17);
  assert.equal(profile.roles.filter((r) => r.pathTemplate).length, 9);
  assert.equal(profile.limits.wallSeconds, 120);
  assert.equal(profile.limits.totalFileBytes, 128 * 1024 ** 2);
});
test("actual remaining expression preserves one admission under wall or monotonic exhaustion", () => {
  const declaration = wf.match(
    /const begin=Date\.now\(\), beginMono=performance\.now\(\), workMs=120000;\n\s*const remaining=\(\)=>[^;]+;/,
  )[0];
  let wall = 1000,
    mono = 2000;
  const remaining = new Function(
    "Date",
    "performance",
    declaration + "return remaining;",
  )({ now: () => wall }, { now: () => mono });
  assert.equal(remaining(), 120000);
  wall += 119999;
  mono += 119999;
  assert.equal(remaining(), 1);
  mono += 2;
  assert(remaining() < 0);
  assert.match(wf, /remaining\(\)\+30000/);
  assert.match(
    wf,
    /rejectClose\(new Error\('TOOLCHAIN_PARENT_CLEANUP_UNCONFIRMED'\)\)/,
  );
  assert.match(wf, /originalFailure\?\?='TOOLCHAIN_PARENT_DEADLINE'/);
  assert.match(wf, /if\(child&&!child\.kill\(\)\)stopFailure=true/);
});
test("carrier retains only closed metadata and original one-Job truth, no vendor files", () => {
  const upload = wf.match(
    /name: Retain fixed passive metadata and original Job receipts only\n([\s\S]*?)          retention-days:/,
  )[1];
  assert.match(upload, /if: always\(\)/);
  assert.match(wf, /include-hidden-files: true/);
  const leaves = upload
    .match(/          path: \|\n([\s\S]*)/)[1]
    .trim()
    .split("\n")
    .map((x) => x.trim());
  assert.deepEqual(leaves, [
    "toolchain-preflight-denied.json",
    ".artifacts/windows-arm-runtime-closure-*/summary.json",
    ".artifacts/windows-arm-runtime-closure-*/context.json",
    ".artifacts/windows-arm-runtime-closure-*/inventory.json",
    ".artifacts/windows-arm-runtime-closure-*/supervisor-result.json",
    ".artifacts/windows-arm-runtime-closure-*/jobs/observation/*.json",
    ".artifacts/windows-arm-runtime-closure-*/jobs/observation/stdout.log",
    ".artifacts/windows-arm-runtime-closure-*/jobs/observation/stderr.log",
    ".artifacts/windows-arm-runtime-closure-*/supervisor-stdout.log",
    ".artifacts/windows-arm-runtime-closure-*/supervisor-stderr.log",
  ]);
  assert.match(wf, /actual\.originalJob/);
  assert.match(wf, /inventory\.observationComplete===true/);
  assert.match(wf, /inventory\.vendorExecuted===false/);
  assert(
    !wf.includes("gh api") &&
      !wf.includes("curl ") &&
      !wf.includes("cef-hosted-provision"),
  );
});
test("real Git checkout-only fixed environment changes old CRLF to exact canonical LF", async () => {
  const canonicalTempParent = await realpath(os.tmpdir());
  const temp = await mkdtemp(
    path.join(canonicalTempParent, "runtime-closure-lf-"),
  );
  const source = path.join(temp, "source"),
    old = path.join(temp, "old"),
    fresh = path.join(temp, "fresh");
  const run = (args, env) =>
    execFileSync("git", args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    await mkdir(source);
    await mkdir(path.join(temp, "hooks"));
    run(["init", source]);
    run(["-C", source, "config", "core.autocrlf", "true"]);
    await writeFile(path.join(source, "profile.json"), profileRaw);
    run(["-C", source, "add", "profile.json"]);
    run([
      "-C",
      source,
      "-c",
      "user.name=Owned Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(temp, "hooks")}`,
      "commit",
      "-m",
      "fixture",
    ]);
    for (const dest of [old, fresh])
      run(["-c", "core.autocrlf=true", "clone", "--no-checkout", source, dest]);
    run(["-C", old, "-c", "core.autocrlf=true", "checkout", "--force", "HEAD"]);
    assert.notEqual(
      sha(await readFile(path.join(old, "profile.json"))),
      sha(profileRaw),
    );
    assert.deepEqual(checkoutEnvLines, [
      'GIT_CONFIG_COUNT: "1"',
      "GIT_CONFIG_KEY_0: core.autocrlf",
      'GIT_CONFIG_VALUE_0: "false"',
    ]);
    const env = checkoutEnv;
    assert.deepEqual(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "false",
    });
    run(["-C", fresh, "checkout", "--force", "HEAD"], env);
    assert.deepEqual(
      await readFile(path.join(fresh, "profile.json")),
      profileRaw,
    );
  } finally {
    const actualTemp = await realpath(temp);
    assert.equal(path.dirname(actualTemp), await realpath(os.tmpdir()));
    assert(path.basename(actualTemp).startsWith("runtime-closure-lf-"));
    assert.equal(actualTemp, temp);
    await rm(actualTemp, { recursive: true, force: true });
  }
});

test("actual held source body preserves first read error through secondary close failure", async () => {
  const body = wf.match(
    /\/\/ BEGIN HELD SOURCE\n([\s\S]*?)\/\/ END HELD SOURCE/,
  )[1];
  const readError = new Error("owned read sentinel"),
    closeError = new Error("owned close sentinel");
  const info = {
    isFile: () => true,
    nlink: 1n,
    size: 0n,
    dev: 1n,
    ino: 2n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    birthtimeNs: 5n,
    mode: 6n,
  };
  let closes = 0;
  const run = (failRead) => {
    const file = {
      stat: async () => info,
      read: async () => {
        if (failRead) throw readError;
        return { bytesRead: 0 };
      },
      close: async () => {
        closes++;
        throw closeError;
      },
    };
    return new Function(
      "physical",
      "fs",
      "assert",
      "remaining",
      `let sourceCloseFailure=null;${body};return {held,secondary:()=>sourceCloseFailure};`,
    )(
      async () => {},
      { lstat: async () => info, open: async () => file },
      assert,
      () => 1,
    );
  };
  const primary = run(true);
  await assert.rejects(primary.held("fixed"), (e) => e === readError);
  assert.equal(primary.secondary(), "TOOLCHAIN_SOURCE_CLOSE");
  const closeOnly = run(false);
  await assert.rejects(closeOnly.held("fixed"), (e) => e === closeError);
  assert.equal(closes, 2);
});

test("actual owned CLI body returns finite first timeout when close never arrives", async () => {
  const body = wf.match(
    /\/\/ BEGIN OWNED CLI\n([\s\S]*?)\/\/ END OWNED CLI/,
  )[1];
  const make = (killThrows, natural) => {
    let kills = 0,
      destroyed = 0,
      cleared = 0;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    for (const stream of [child.stdout, child.stderr])
      stream.destroy = () => {
        destroyed++;
      };
    child.kill = () => {
      kills++;
      if (killThrows) throw new Error("owned kill sentinel");
      return true;
    };
    const run = new Function(
      "spawn",
      "setTimeout",
      "clearTimeout",
      "assert",
      "fs",
      "path",
      `return (async()=>{let child,originalFailure,outcome=null,phase;const p={python:{path:'fixedPython'}},root='fixedRoot',args=['fixed'],env={},remaining=()=>10;try{${body};return {ok:true,killsKnown:true}}catch(error){return {ok:false,first:originalFailure,error:error.message}}})();`,
    );
    const promise = run(
      () => {
        if (natural) queueMicrotask(() => child.emit("close", 0, null));
        return child;
      },
      (fn) => {
        if (!natural) queueMicrotask(fn);
        return 1;
      },
      () => {
        cleared++;
      },
      assert,
      { writeFile: async () => {} },
      path,
    );
    return { promise, proof: () => ({ kills, destroyed, cleared }) };
  };
  for (const throws of [false, true]) {
    const case_ = make(throws, false);
    const result = await case_.promise;
    assert.equal(result.ok, false);
    assert.equal(result.first, "TOOLCHAIN_PARENT_DEADLINE");
    assert.equal(result.error, "TOOLCHAIN_PARENT_CLEANUP_UNCONFIRMED");
    assert.deepEqual(case_.proof(), { kills: 2, destroyed: 2, cleared: 2 });
  }
  const natural = make(false, true);
  assert.equal((await natural.promise).ok, true);
  assert.deepEqual(natural.proof(), { kills: 0, destroyed: 0, cleared: 2 });
});
