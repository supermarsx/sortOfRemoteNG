import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import {
  authority,
  originalEnd,
  kernelBlocks,
  validateReport,
  runProof,
  lastObservation,
  failureCode,
} from "../fixtures/cef/linux_gn_supervision_proof.mjs";

// Portable tests only. No native child, Git, ps or proof main is executed here.
const ref = "refs/heads/codex/linux-gn-supervision-proof-20261102";
const facts = () => ({
  ImageOS: "ubuntu24",
  ImageVersion: "20261026.354.1",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: ref,
  GITHUB_WORKFLOW_REF: `supermarsx/sortOfRemoteNG/.github/workflows/cef-linux-gn-supervision-proof.yml@${ref}`,
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
});
const runtime = (
  await fs.readFile(
    new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const fixture = (
  await fs.readFile(
    new URL("../fixtures/cef/linux_gn_supervision_proof.mjs", import.meta.url),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const names = [
  "natural-zero",
  "nonzero",
  "timeout",
  "cancel",
  "detached-writer",
  "pipe-holder",
  "output-bound",
  "reserve",
  "setup-clock",
  "late-postcheck",
  "delayed-close",
];
const falseFlags = {
  vendorGnExecuted: false,
  sourceAcquisition: false,
  sourceRestarted: false,
  sourceInputsRevalidated: false,
  productionReadinessIssued: false,
  sourceMigrationAdmitted: false,
  compilerExecuted: false,
  sdkProduced: false,
  nativeAcceptance: false,
  runtimeReady: false,
  exactImageAdmission: false,
};
function syntheticReport() {
  // Pure validation input, explicitly NOT an executed native proof.
  return {
    kind: "linux-gn-benign-native-proof",
    complete: true,
    cleanupConfirmed: true,
    attemptId: "12345678-1234-4123-8123-123456789abc",
    head: "a".repeat(40),
    runId: "123",
    runAttempt: "1",
    sourceWitnessSha256: "b".repeat(64),
    observedHost: authority(facts(), "linux", "x64"),
    foreignPreserved: true,
    ...falseFlags,
    cases: names.map((id) => {
      const idle = ["reserve", "setup-clock"].includes(id),
        positive = id === "natural-zero";
      return {
        id,
        complete: true,
        fulfilled: positive,
        rejected: !positive,
        observerAssisted: !idle,
        faultScheduling: [
          "setup-clock",
          "late-postcheck",
          "delayed-close",
        ].includes(id),
        supervisorJoined: idle ? null : true,
        spawned: idle ? 0 : positive ? 2 : 1,
        closeAttempts: id === "reserve" ? 0 : positive ? 2 : 1,
        reparentWitness: id === "detached-writer",
        noLateWriter: id === "detached-writer",
        productionReceiptRejected: positive,
        heldFdJoined: true,
      };
    }),
  };
}

test("pure authority checks exact private workflow/head/host, with image observed rather than asserted354", () => {
  for (const image of ["20261026.353.1", "20261026.354.1"]) {
    const value = authority(
      { ...facts(), ImageVersion: image },
      "linux",
      "x64",
    );
    assert.equal(value.imageVersion, image);
    assert.equal(value.source, "process-and-runner-environment");
    assert(Object.isFrozen(value));
  }
  for (const [platform, arch] of [
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
  ])
    assert.throws(() => authority(facts(), platform, arch));
  for (const key of Object.keys(facts()))
    for (const value of [undefined, "foreign"])
      assert.throws(
        () => authority({ ...facts(), [key]: value }, "linux", "x64"),
        key,
      );
  assert.throws(() =>
    authority({ ...facts(), GITHUB_REF: "refs/heads/main" }, "linux", "x64"),
  );
});

test("one original monotonic end includes checkout age and fixed30s cleanup, never refreshed", () => {
  const now = 1793664000000;
  assert.equal(originalEnd(String(now), now, 100), 160100);
  assert.equal(originalEnd(String(now - 200000), now, 100), 70100);
  assert.equal(originalEnd(String(now - 200000), now + 10000, 10100), 70100);
  for (const started of [
    String(now + 1),
    String(now - 240000),
    "0",
    "invalid",
    undefined,
  ])
    assert.throws(() => originalEnd(started, now, 100));
});

test("full canonical runtime and both original marked bodies are exact before evaluation", () => {
  const blocks = kernelBlocks(runtime);
  assert.equal(blocks.length, 2);
  assert(blocks[0].includes("await compileSlice(capture.python, capture.args"));
  assert(blocks[1].includes("state.active = false;"));
  for (const changed of [
    runtime + "\n",
    runtime.replace("state.active = false;", "state.active = true;"),
    runtime.replace("30000", "30001"),
  ])
    assert.throws(() => kernelBlocks(changed));
});

test("strict pure report validator rejects missing/native-invented claims, incomplete cases and extra data", () => {
  const value = syntheticReport();
  assert.equal(validateReport(value), value);
  for (const key of Object.keys(value)) {
    const changed = structuredClone(value);
    delete changed[key];
    assert.throws(() => validateReport(changed), key);
  }
  for (const key of Object.keys(falseFlags)) {
    const changed = structuredClone(value);
    changed[key] = true;
    assert.throws(() => validateReport(changed), key);
  }
  for (const mutate of [
    (v) => {
      v.foreignPreserved = false;
    },
    (v) => {
      v.rawError = "PRIVATE";
    },
    (v) => {
      v.observedHost.expectedImage = "20261026.354.1";
    },
    (v) => {
      v.observedHost.platform = "darwin";
    },
    (v) => {
      v.cases.reverse();
    },
    (v) => {
      v.cases.pop();
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => validateReport(changed));
  }
});

test("all case facts enforce real joins, both roots, exact64MiB path and labeled injected faults", () => {
  for (let index = 0; index < names.length; index++) {
    const value = syntheticReport();
    for (const key of Object.keys(value.cases[index])) {
      const changed = structuredClone(value);
      delete changed.cases[index][key];
      assert.throws(() => validateReport(changed), names[index] + key);
    }
    for (const key of [
      "complete",
      "fulfilled",
      "rejected",
      "observerAssisted",
      "faultScheduling",
      "reparentWitness",
      "noLateWriter",
      "productionReceiptRejected",
      "heldFdJoined",
    ]) {
      const changed = structuredClone(value);
      changed.cases[index][key] = !changed.cases[index][key];
      assert.throws(() => validateReport(changed), names[index] + key);
    }
    for (const key of ["spawned", "closeAttempts"]) {
      const changed = structuredClone(value);
      changed.cases[index][key]++;
      assert.throws(() => validateReport(changed));
    }
    const changed = structuredClone(value);
    changed.cases[index].supervisorJoined = "root-only";
    assert.throws(() => validateReport(changed));
  }
});

test("actual public proof entry rejects extraargs before native/unsafe IO and clears last observation", async () => {
  await assert.rejects(runProof("not allowed"), /PROOF_ENTRY/);
  assert.equal(lastObservation(), null);
  assert.throws(() => lastObservation("extra"), /PROOF_ENTRY/);
  const old = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    await assert.rejects(runProof(), /PROOF_HOST|PROOF_SCOPE/);
    const observation = lastObservation();
    assert.equal(observation.complete, false);
    assert.equal(observation.code, "PROOF_FAILED");
    assert(Object.isFrozen(observation));
    await assert.rejects(
      runProof({ report: syntheticReport() }),
      /PROOF_ENTRY/,
    );
    assert.equal(lastObservation(), null);
  } finally {
    if (old === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = old;
  }
});

test("closed failure projection labels unobserved reparenting without invoking thrown getters", () => {
  assert.equal(
    failureCode(Error("PROOF_REPARENT_UNOBSERVED")),
    "REPARENT_WITNESS_UNOBSERVED",
  );
  for (const value of [
    undefined,
    null,
    false,
    0,
    "PRIVATE",
    Error("PRIVATE"),
    Object.defineProperty({}, "message", {
      get() {
        assert.fail("getter");
      },
    }),
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error("PRIVATE trap");
        },
      },
    ),
  ])
    assert.equal(failureCode(value), "PROOF_FAILED");
});

test("actual private root creator in isolated FS model records creation and retires normal operations before cleanup", async () => {
  const a = fixture.indexOf("async function ownedRoot(end) {"),
    b = fixture.indexOf("\nasync function actorMain(", a);
  assert(a > 0 && b > a);
  const dirs = new Map([
    [
      "/temp",
      { dev: 1n, ino: 1n, mode: 0o40700n, uid: 0n, isDirectory: () => true },
    ],
  ]);
  let ordinal = 1n,
    creates = 0;
  const scope = vm.createContext({
    assert,
    path: path.posix,
    Map,
    BigInt,
    constants: { O_RDONLY: 0, O_DIRECTORY: 1, O_NOFOLLOW: 2 },
    process: { env: { RUNNER_TEMP: "/temp" }, getuid: () => 0 },
    randomUUID: () => "12345678-1234-4123-8123-123456789abc",
    physical: (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":"),
    check: () => {},
    fs: {
      realpath: async (p) => p,
      lstat: async (p) => {
        assert(dirs.has(p));
        return dirs.get(p);
      },
      mkdir: async (p) => {
        assert(!dirs.has(p));
        creates++;
        dirs.set(p, {
          dev: 1n,
          ino: ++ordinal,
          mode: 0o40700n,
          uid: 0n,
          isDirectory: () => true,
        });
      },
      open: async (p) => {
        const original = dirs.get(p);
        return { stat: async () => original, close: async () => {} };
      },
    },
  });
  const create = vm.runInContext("(" + fixture.slice(a, b) + ")", scope);
  const owned = await create(1000);
  await owned.current();
  await owned.mkdir(owned.root + "/logs");
  assert.equal(creates, 2);
  await assert.rejects(owned.mkdir(owned.root + "/unknown/child"));
  assert.equal(creates, 2);
  const original = dirs.get(owned.root + "/logs");
  dirs.set(owned.root + "/logs", { ...original, ino: 999n });
  await assert.rejects(
    owned.mkdir(owned.root + "/logs/child"),
    /DIRECTORY_CHANGED/,
  );
  assert.equal(creates, 2);
  owned.retire();
  assert.throws(() => owned.assertActive(), /RETIRED/);
  await assert.rejects(owned.current(), /RETIRED/);
  await owned.cleanupCurrent(); // Separate private physical check cannot mint work.
  dirs.set(owned.root, { ...dirs.get(owned.root), ino: 1000n });
  await assert.rejects(owned.cleanupCurrent(), /CHANGED/);
});

test("actual private launcher claims two disjoint actor attempts for unchanged initial/revalidation argv", async () => {
  const a = fixture.indexOf("async function claimActorDirectory(directory) {"),
    b = fixture.indexOf("\nasync function launch(", a);
  assert(a > 0 && b > a);
  const files = new Set(),
    flags = [],
    closed = [];
  let primary;
  const scope = vm.createContext({
    assert,
    path: path.posix,
    constants: { O_WRONLY: 1, O_CREAT: 2, O_EXCL: 4, O_NOFOLLOW: 8 },
    process: { getuid: () => 0, pid: 1234 },
    fs: {
      realpath: async (p) => p,
      lstat: async () => ({ isDirectory: () => true, uid: 0, mode: 0o40700 }),
      open: async (file, mode) => {
        flags.push(mode);
        if (primary) throw primary;
        if (files.has(file))
          throw Object.assign(Error("exists"), { code: "EEXIST" });
        files.add(file);
        return {
          writeFile: async (value) => assert.equal(value, "1234"),
          close: async () => {
            closed.push(file);
          },
        };
      },
    },
  });
  const claim = vm.runInContext("(" + fixture.slice(a, b) + ")", scope);
  assert.equal(await claim("/owned/case"), "/owned/case/attempt-initial");
  assert.equal(await claim("/owned/case"), "/owned/case/attempt-revalidation");
  await assert.rejects(claim("/owned/case"), /INVOCATIONS/);
  assert.equal(files.size, 2);
  assert.equal(closed.length, 2);
  assert(flags.every((mode) => mode === 15));
  primary = Object.assign(Error("denied"), { code: "EACCES" });
  await claim("/owned/other-case").then(
    () => assert.fail("failure adopted"),
    (error) => assert.equal(error, primary),
  );
  assert.equal(files.size, 2);
});

test("actor and oracle source keeps commands/env/namespace fixed with no vendor or input-selected module", () => {
  assert.match(
    fixture,
    /fixedChild\(\s*"\/bin\/ps",\s*\["-axo", "pid=,ppid=,lstart="\]/,
  );
  assert.match(
    fixture,
    /fixedChild\(\s*"\/usr\/bin\/git",\s*\["cat-file", "--batch"\]/,
  );
  assert(fixture.includes("sourceWitness(end)"));
  assert(
    fixture.includes("await import(pathToFileURL(path.join(ROOT, CORE)))"),
  );
  assert(fixture.includes("outputLedger: { ...options.outputLedger }"));
  assert(fixture.includes("64 * 1024 ** 2 + 1"));
  assert(!fixture.includes('exec("'));
  assert(!fixture.includes("shell: true"));
  assert(!fixture.includes("censusFactory:"));
  assert(!fixture.includes("out:"));
});

function model(supervisor) {
  const [wrapper, owner] = kernelBlocks(runtime);
  let remaining = 60000;
  const dirs = new Map([["/proof/logs", 1n]]);
  let ino = 1n,
    opened = 0,
    closed = 0;
  const info = (name) => ({
    dev: 1n,
    ino: dirs.get(name),
    mode: name === "/proof/logs" ? 0o40755n : 0o40700n,
    uid: 0n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  });
  const scope = vm.createContext({
    path: path.posix,
    constants: { O_RDONLY: 0, O_NOFOLLOW: 1, O_DIRECTORY: 2 },
    process: { getuid: () => 0 },
    realpath: async (p) => p,
    lstat: async (p) => info(p),
    mkdir: async (p) => {
      assert(!dirs.has(p));
      dirs.set(p, ++ino);
    },
    open: async (p) => {
      opened++;
      return {
        stat: async () => info(p),
        close: async () => {
          closed++;
        },
      };
    },
    hostRemaining: () => remaining,
    fail: (message) => {
      throw Error(message);
    },
    setTimeout,
    clearTimeout,
    AbortController,
    compileSlice: (...args) => supervisor(...args),
  });
  const api = vm.runInContext(
    wrapper +
      owner.replace(/^export /gm, "") +
      "\n({superviseLinuxSourceGn,withLinuxSourceOwner,revalidateLinuxSourceOwner,assertLinuxSourceOwnerReceipt})",
    scope,
  );
  const capture = {
    python: "/fixed/node",
    args: Object.freeze([
      "/fixed/fixture",
      "--launch",
      "natural-zero",
      "/proof/case-natural-zero",
    ]),
    cwd: "/fixed",
    env: Object.freeze({ PATH: "/usr/bin:/bin", TZ: "UTC" }),
    logs: "/proof/logs",
    remaining: () => remaining,
    hostClock: {},
    binding: {},
  };
  return {
    scope,
    api,
    capture,
    expire: () => {
      remaining = 0;
    },
    closeCount: () => closed,
    openCount: () => opened,
  };
}
const quiet = () => ({
  outcome: "compiler-complete",
  exitCode: 0,
  quiescent: true,
  quiescence: "observed-lineage-and-root-group",
});

test("portable exact-wrapper model passes both roles but no raw capability reaches isolated receipt", async () => {
  const called = [];
  const m = model(async (exe, args, options) => {
    called.push({ exe, args, options });
    return quiet();
  });
  await m.api.superviseLinuxSourceGn(m.capture, "initial");
  const context = {};
  let issued;
  await m.api.withLinuxSourceOwner(context, m.capture, async (value) => {
    issued = await m.api.revalidateLinuxSourceOwner(value);
    const observed = m.api.assertLinuxSourceOwnerReceipt(value, issued);
    assert.equal(observed.cohortQuietProven, true);
    assert.equal(observed.productionReadinessIssued, false);
    assert.equal(observed.runtimeReady, false);
    assert(!("observed" in observed));
  });
  assert.equal(called.length, 2);
  assert.equal(m.closeCount(), 2);
  assert.throws(
    () => m.api.assertLinuxSourceOwnerReceipt(context, issued),
    /RECEIPT/,
  );
  for (const call of called) {
    assert.equal(call.exe, m.capture.python);
    assert.equal(call.args, m.capture.args);
    assert.equal(call.options.milliseconds, 30000);
    assert.equal(call.options.outputLedger.cap, 64 * 1024 ** 2);
    assert.equal(call.options.out, undefined);
    assert.equal(call.options.censusFactory, undefined);
  }
});

test("portable exact-wrapper model preserves falsy rejection and refuses post-await expired clocks", async () => {
  for (const marker of [undefined, null, false, 0, ""]) {
    const m = model(async () => {
      throw marker;
    });
    await m.api.superviseLinuxSourceGn(m.capture, "initial").then(
      () => assert.fail("failure lost"),
      (error) => assert.equal(error, marker),
    );
    assert.equal(m.closeCount(), 1);
  }
  let m;
  m = model(async () => {
    m.expire();
    return quiet();
  });
  await assert.rejects(
    m.api.superviseLinuxSourceGn(m.capture, "initial"),
    /DEADLINE/,
  );
  assert.equal(m.closeCount(), 1);
});

test("portable root0 alone, timeout, nonzero and missing lineage are not supervisor qualification", async () => {
  for (const change of [
    { outcome: "slice-ended" },
    { exitCode: 7 },
    { quiescent: false },
    { quiescence: "root-only" },
  ]) {
    const m = model(async () => ({ ...quiet(), ...change }));
    await assert.rejects(
      m.api.superviseLinuxSourceGn(m.capture, "initial"),
      /UNCONFIRMED/,
    );
    assert.equal(m.closeCount(), 1);
  }
});

const cleanup887 =
  'async function cleanup(owned, end) {\n  await owned.cleanupCurrent();\n  async function remove(dir) {\n    await owned.directoryCurrent(dir);\n    const info = await fs.lstat(dir, { bigint: true });\n    assert(\n      info.isDirectory() &&\n        info.uid === BigInt(process.getuid()) &&\n        (info.mode & 0o777n) === 0o700n,\n      "PROOF_CLEANUP_DIR",\n    );\n    const stamp = owned.directories.get(dir);\n    assert(\n      stamp !== undefined && physical(info) === stamp,\n      "PROOF_CLEANUP_CREATION",\n    );\n    const entries = await fs.readdir(dir, { withFileTypes: true });\n    for (const entry of entries) {\n      await owned.cleanupCurrent();\n      await owned.directoryCurrent(dir);\n      assert(\n        physical(await fs.lstat(dir, { bigint: true })) === stamp,\n        "PROOF_CLEANUP_CHANGED",\n      );\n      const file = path.join(dir, entry.name);\n      assert(\n        /^(case-(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|reserve|setup-clock|late-postcheck|delayed-close|foreign-control)|logs|source-gn-(?:initial|revalidation)|checkpoint-compile\\.(?:stdout\\.log|stderr\\.log|outcome\\.json)|actor-environment\\.json|(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|child-natural|child-writer|child-pipe|child-hold|foreign)\\.json|counter|reparented|release-root|release-child|attempt-initial|attempt-revalidation|claimed)$/.test(\n          entry.name,\n        ),\n        "PROOF_UNKNOWN_LEAF",\n      );\n      if (entry.isDirectory()) await remove(file);\n      else {\n        const before = await fs.lstat(file, { bigint: true });\n        assert(ordinary(before), "PROOF_CLEANUP_FILE");\n        assert(\n          full(await fs.lstat(file, { bigint: true })) === full(before),\n          "PROOF_CLEANUP_CHANGED",\n        );\n        await owned.cleanupCurrent();\n        await owned.directoryCurrent(dir);\n        assert(\n          physical(await fs.lstat(dir, { bigint: true })) === stamp,\n          "PROOF_CLEANUP_CHANGED",\n        );\n        await fs.unlink(file);\n      }\n    }\n    assert(\n      physical(await fs.lstat(dir, { bigint: true })) === stamp,\n      "PROOF_CLEANUP_CHANGED",\n    );\n    await owned.directoryCurrent(dir);\n    if (dir !== owned.root) await fs.rmdir(dir);\n  }\n  await remove(owned.root);\n  await owned.cleanupCurrent();\n  await within(() => owned.fd.close(), end);\n  assert(\n    physical(await fs.lstat(owned.root, { bigint: true })) === owned.identity,\n    "PROOF_CLEANUP_CHANGED",\n  );\n  await fs.rmdir(owned.root);\n}\n';

// Real file/rename/read/unlink and real leaf FD IO; only UID/directory modes
// and the root-directory FD are modeled for this portable Windows regression.
test(
  "actual cleanup denies last-await file/content/directory swaps and preserves foreign replacements",
  { timeout: 10000 },
  async () => {
    assert.equal(
      createHash("sha256").update(cleanup887).digest("hex"),
      "06482c6793257db4fe1493f43df1bcdcf0dc3629904c371a90899e1ffd7c424e",
    );
    const a = fixture.indexOf("async function cleanup(owned, end) {"),
      b = fixture.indexOf("\nexport function validateReport(", a);
    assert(a > 0 && b > a);
    const actual = fixture.slice(a, b);
    const facts = (s) => {
      const copy = Object.assign(Object.create(Object.getPrototypeOf(s)), s);
      copy.uid = 0n;
      if (copy.isDirectory()) copy.mode = (copy.mode & ~0o777n) | 0o700n;
      return copy;
    };
    const physical = (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":");
    const full = (s) =>
      physical(s) + ":" + [s.size, s.nlink, s.mtimeNs, s.ctimeNs].join(":");
    for (const variant of ["unchanged", "leaf", "content", "directory", "root"])
      for (const [label, body] of [
        ["old887", cleanup887],
        ["current", actual],
      ]) {
        const base = await fs.realpath(
          await fs.mkdtemp(
            path.join(os.tmpdir(), "codex-gn-cleanup-regression-"),
          ),
        );
        const root = path.join(base, "owned"),
          leaf = path.join(root, "actor-environment.json"),
          saved = path.join(base, "saved-owned"),
          sub = path.join(root, "logs");
        await fs.mkdir(root, { mode: 0o700 });
        if (variant === "directory") await fs.mkdir(sub, { mode: 0o700 });
        else if (variant !== "root")
          await fs.writeFile(leaf, "OWNED", { flag: "wx" });
        const stat = async (p) => facts(await fs.lstat(p, { bigint: true }));
        const identity = physical(await stat(root));
        const directories = new Map([[root, identity]]);
        if (variant === "directory")
          directories.set(sub, physical(await stat(sub)));
        let leafStats = 0,
          subChecks = 0,
          replaced = false,
          completed = false,
          failure,
          leafCloses = 0;
        const rootCurrent = async () =>
          assert.equal(physical(await stat(root)), identity);
        const owned = {
          root,
          identity,
          directories,
          fd: {
            close: async () => {
              if (variant === "root") {
                await fs.rename(root, saved);
                await fs.mkdir(root, { mode: 0o700 });
                replaced = true;
              }
            },
          },
          cleanupCurrent: async () => {
            if (
              ["leaf", "content"].includes(variant) &&
              leafStats >= 2 &&
              !replaced
            ) {
              if (variant === "leaf") {
                await fs.rename(leaf, saved);
                await fs.writeFile(leaf, "ALIEN", { flag: "wx" });
              } else await fs.writeFile(leaf, "ALIEN");
              replaced = true;
            }
            await rootCurrent();
          },
          directoryCurrent: async (dir) => {
            await rootCurrent();
            if (variant === "directory" && dir === sub && ++subChecks === 2) {
              await fs.rename(sub, saved);
              await fs.mkdir(sub, { mode: 0o700 });
              replaced = true;
            }
          },
        };
        const io = {
          ...fs,
          lstat: async (p) => {
            if (p === leaf) leafStats++;
            return stat(p);
          },
          open: async (...args) => {
            const fd = await fs.open(...args);
            return {
              stat: async (options) => facts(await fd.stat(options)),
              read: (...values) => fd.read(...values),
              close: async () => {
                leafCloses++;
                await fd.close();
              },
            };
          },
        };
        const end = performance.now() + 5000;
        const cleanup = vm.runInNewContext("(" + body + ")", {
          assert,
          path,
          physical,
          full,
          ordinary: (s) => s.isFile() && s.nlink === 1n && s.uid === 0n,
          process: { getuid: () => 0 },
          within: async (work) => {
            assert(performance.now() < end);
            const value = await work();
            assert(performance.now() < end);
            return value;
          },
          fs: io,
        });
        try {
          try {
            await cleanup(owned, end);
            completed = true;
          } catch (error) {
            failure = error;
          }
          if (variant === "unchanged") {
            assert.equal(completed, true, label);
            assert.equal(
              await fs.lstat(root).then(
                () => true,
                () => false,
              ),
              false,
            );
          } else {
            assert.equal(replaced, true, variant + label);
            const target = ["leaf", "content"].includes(variant)
              ? leaf
              : variant === "directory"
                ? sub
                : root;
            if (label === "old887" && variant !== "root") {
              assert.equal(completed, true, variant);
              assert.equal(
                await fs.lstat(target).then(
                  () => true,
                  () => false,
                ),
                false,
                "RED: foreign replacement was deleted",
              );
            } else {
              assert.equal(completed, false, variant);
              assert.match(failure.message, /PROOF_CLEANUP_CHANGED/);
              assert.equal(
                await fs.lstat(target).then(
                  () => true,
                  () => false,
                ),
                true,
                "GREEN: foreign replacement preserved",
              );
              if (["leaf", "content"].includes(variant))
                assert.equal(await fs.readFile(target, "utf8"), "ALIEN");
            }
          }
          if (label === "current" && !["directory", "root"].includes(variant))
            assert.equal(leafCloses, 1, "one actual leaf FD close");
        } finally {
          // Only these freshly created known test paths; no recursive cleanup.
          for (const p of [leaf, sub, saved, root]) {
            assert(p.startsWith(base + path.sep));
            const info = await fs.lstat(p).catch((error) => {
              if (error.code !== "ENOENT") throw error;
              return null;
            });
            if (!info) continue;
            assert(!info.isSymbolicLink());
            if (info.isDirectory()) await fs.rmdir(p);
            else await fs.unlink(p);
          }
          await fs.rmdir(base);
        }
      }
  },
);
