// Private native primitive study. No source, SDK, checkpoint or runtime grant.
import assert from "node:assert/strict";
import {
  readFile,
  mkdir,
  writeFile,
  lstat,
  realpath,
  open,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const REF = "refs/heads/codex/mac-delayed-reap-lease-probe-20261104";
const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
const CENSUS = "scripts/lib/cef-mac-process-census.py";
const HELPERS = "tests/fixtures/cef/mac_process_census_proof.mjs";
const HOLDER = "tests/fixtures/cef/mac_delayed_reap_holder.py";
const PY_SHA =
  "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d";
const BEFORE = "Math.min(100, Math.max(1, deadline - performance.now()))";
const AFTER =
  "Math.max(1, Math.ceil((deadline - performance.now()) / (50 - i)))";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
let phase = "authority",
  end,
  client,
  worker,
  holder,
  reportTarget,
  tempIdentity,
  hasFailure = false,
  firstError;
const report = {
  schemaVersion: 1,
  kind: "mac-delayed-reap-lease-native-study",
  complete: false,
  productionAdmitted: false,
  nativeAcceptance: false,
  runtimeReady: false,
  sourceQualified: false,
  cases: [],
};
function check() {
  assert(performance.now() < end, "PROBE_DEADLINE");
}
function known(error) {
  try {
    const value = Object.getOwnPropertyDescriptor(error, "message")?.value;
    return (
      new Map([
        [
          "Observed descendants not reaped; checkpoint denied",
          "OWN_NOT_REAPED",
        ],
        ["Owned reap deadline", "OWN_REAP_DEADLINE"],
        ["WAITID_UNSUPPORTED", "WAITID_UNSUPPORTED"],
        ["ZOMBIE_NOT_CENSUSED", "ZOMBIE_NOT_CENSUSED"],
        ["PROBE_DEADLINE", "PROBE_DEADLINE"],
      ]).get(value) ?? "CONTRACT"
    );
  } catch {
    return "CONTRACT";
  }
}
async function within(promise, deadline = end) {
  const ms = Math.floor(deadline - performance.now());
  assert(ms > 0, "PROBE_DEADLINE");
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("PROBE_DEADLINE")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function pin(file, maximum, expected) {
  const stable = (s) =>
    Object.fromEntries(
      [
        "dev",
        "ino",
        "mode",
        "nlink",
        "uid",
        "gid",
        "size",
        "mtimeNs",
        "ctimeNs",
      ].map((key) => [key, s[key]]),
    );
  const before = await lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximum),
  );
  assert.equal(await realpath(file), file);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw;
  try {
    assert.deepEqual(stable(await fd.stat({ bigint: true })), stable(before));
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await fd.read(
        buffer,
        used,
        buffer.length - used,
        used,
      );
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    assert.equal(BigInt(used), before.size);
    raw = buffer.subarray(0, used);
    assert.deepEqual(stable(await fd.stat({ bigint: true })), stable(before));
    assert.deepEqual(
      stable(await lstat(file, { bigint: true })),
      stable(before),
    );
  } finally {
    await fd.close();
  }
  const value = { bytes: raw.length, sha256: sha(raw) };
  if (expected) assert.deepEqual(value, expected);
  return { raw, pin: value };
}
function section(text, start, finish) {
  assert.equal(text.split(start).length, 2);
  const a = text.indexOf(start),
    b = text.indexOf(finish, a);
  assert(b > a);
  return text
    .slice(a, b)
    .trim()
    .replace(/^export /, "");
}
function startHolder(source, cwd, env) {
  const child = spawn(PYTHON, ["-I", "-B", "-S", "-c", source, "delay"], {
    cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let readyResolve,
    readyReject,
    reapResolve,
    reapReject,
    closeResolve,
    buffer = "",
    bytes = 0,
    stderrBytes = 0,
    readyValue,
    reaped = false,
    closed = false,
    protocolFailure;
  const ready = new Promise((r, j) => {
      readyResolve = r;
      readyReject = j;
    }),
    reap = new Promise((r, j) => {
      reapResolve = r;
      reapReject = j;
    }),
    joined = new Promise((r) => {
      closeResolve = r;
    });
  ready.catch(() => {});
  reap.catch(() => {});
  const deny = (e) => {
    if (!protocolFailure) protocolFailure = e;
    readyReject(protocolFailure);
    reapReject(protocolFailure);
  };
  child.on("error", deny);
  child.stdin.on("error", (e) => {
    if (!closed) deny(e);
  });
  child.stdout.on("error", deny);
  child.stderr.on("error", deny);
  child.stderr.on("data", (x) => {
    stderrBytes += x.length;
    if (stderrBytes > 4096) deny(Error("HOLDER_BOUND"));
  });
  child.stdout.on("data", (x) => {
    bytes += x.length;
    if (bytes > 4096) {
      deny(Error("HOLDER_BOUND"));
      return;
    }
    if (protocolFailure) return;
    buffer += x.toString("utf8");
    for (;;) {
      const at = buffer.indexOf("\n");
      if (at < 0) break;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line);
        if (
          (value.kind === "ready" || value.kind === "unsupported") &&
          !readyValue
        ) {
          readyValue = value;
          readyResolve(value);
        } else if (value.kind === "reaped" && readyValue && !reaped) {
          reaped = true;
          reapResolve(value);
        } else throw Error("HOLDER_PROTOCOL");
      } catch (e) {
        deny(e);
        return;
      }
    }
  });
  child.once("close", (code, signal) => {
    closed = true;
    if (buffer.length) deny(Error("HOLDER_PROTOCOL"));
    closeResolve({
      code,
      signal,
      stderrBytes,
      protocolFailed: Boolean(protocolFailure),
    });
    if (!readyValue) deny(Error("HOLDER_CLOSED"));
    if (!reaped) deny(Error("HOLDER_CLOSED"));
  });
  return {
    child,
    ready,
    reap,
    joined,
    get reaped() {
      return reaped;
    },
    get closed() {
      return closed;
    },
    begin() {
      return new Promise((r, j) =>
        child.stdin.write("begin\n", (e) => (e ? j(e) : r())),
      );
    },
    release() {
      if (!closed && !reaped) child.stdin.end("reap-now\n");
      else if (!closed) child.stdin.end();
    },
  };
}
async function main() {
  const env = process.env;
  assert(process.platform === "darwin" && process.arch === "x64");
  assert.equal(env.GITHUB_REF, REF);
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REPOSITORY, "supermarsx/sortOfRemoteNG");
  assert.equal(env.GITHUB_REPOSITORY_ID, "1010282954");
  assert.equal(env.GITHUB_REPOSITORY_VISIBILITY, "public");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(env.ImageOS, "macos15");
  assert.equal(env.ImageVersion, "20260824.0482.1");
  const started = Number(env.CEF_MAC_DELAYED_REAP_STARTED_MS);
  assert(
    Number.isSafeInteger(started) &&
      started <= Date.now() &&
      Date.now() - started < 360000,
  );
  end = performance.now() + Math.min(240000, 360000 - (Date.now() - started));
  assert(end - performance.now() > 180000);
  const ROOT = path.resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    ),
    temp = env.RUNNER_TEMP;
  assert.equal(temp, "/Users/runner/work/_temp");
  assert.equal(await realpath(temp), temp);
  tempIdentity = await lstat(temp, { bigint: true });
  assert(
    tempIdentity.isDirectory() &&
      !tempIdentity.isSymbolicLink() &&
      tempIdentity.uid === BigInt(process.getuid()),
  );
  reportTarget = path.join(temp, "cef-mac-delayed-reap-report.json");
  assert.equal(
    (await pin(path.join(ROOT, ".git/HEAD"), 41)).raw.toString(),
    env.GITHUB_SHA + "\n",
  );
  const subjects = {};
  for (const [name, maximum, expected] of [
    [
      CORE,
      300000,
      {
        bytes: 246069,
        sha256:
          "9db705733c7bceb64cd1bf3ff7f109024cb1dec7395bafdcbbe86b729f6d39cc",
      },
    ],
    [
      CENSUS,
      65536,
      {
        bytes: 24586,
        sha256:
          "ec206948e6efe38d0c854d655ef95454262e01b5d28d05f4169587d1b511ff52",
      },
    ],
    [
      HELPERS,
      65536,
      {
        bytes: 25640,
        sha256:
          "3cceac619a07d2c4386f519782addd6c46f15d70cc91a8f453e32b961f7b4929",
      },
    ],
    [HOLDER, 16384, null],
  ])
    subjects[name] = await pin(path.join(ROOT, name), maximum, expected);
  await pin(PYTHON, 16384, { bytes: 13592, sha256: PY_SHA });
  const core = await import(pathToFileURL(path.join(ROOT, CORE))),
    helpers = await import(pathToFileURL(path.join(ROOT, HELPERS)));
  const raw = subjects[CORE].raw.toString(),
    old = section(
      raw,
      "async function stopObserved(",
      "// Only a result produced by this live process",
    );
  const quiet = section(
    raw,
    "export async function observedQuiet(",
    "async function stopObserved(",
  );
  assert.equal(old.split(BEFORE).length, 2);
  const next = old.replace(BEFORE, AFTER);
  assert.equal(next.replace(AFTER, BEFORE), old);
  const root = path.join(temp, "cef-mac-census-proof-" + randomUUID());
  await mkdir(root, { mode: 0o700 });
  const rootIdentity = await lstat(root, { bigint: true });
  const rootCheck = async () => {
    check();
    assert.equal(await realpath(root), root);
    const s = await lstat(root, { bigint: true });
    for (const key of ["dev", "ino", "mode", "uid"])
      assert.equal(s[key], rootIdentity[key]);
  };
  const childEnv = {
    PATH: "/usr/bin:/bin",
    RUNNER_TEMP: temp,
    ImageOS: env.ImageOS,
    ImageVersion: env.ImageVersion,
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (env.RUNNER_TRACKING_ID)
    childEnv.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID;
  phase = "prepare-oracle";
  await helpers.executeJoined(
    PYTHON,
    ["-I", "-B", "-S", path.join(ROOT, CENSUS), "--proof-prepare", root],
    {
      cwd: root,
      env: childEnv,
      timeout: 45000,
      maxBuffer: 4096,
      joinDeadline: end,
    },
  );
  phase = "compile-oracle";
  const compiled = await core.compileSlice(
    PYTHON,
    ["-I", "-B", "-S", path.join(ROOT, CENSUS), "--proof-compile", root],
    {
      cwd: root,
      logs: root,
      env: helpers.proofCompilerEnvironment(childEnv),
      milliseconds: 30000,
      outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 },
      observeRoot: async (_identity, control) =>
        helpers.publishCompilerGate(
          root,
          rootCheck,
          control.signal,
          () => false,
        ),
    },
  );
  assert(
    compiled.quiescent &&
      compiled.outcome === "compiler-complete" &&
      compiled.exitCode === 0,
  );
  phase = "capture-oracle";
  await helpers.captureOracleAbi(root, {
    env: childEnv,
    end,
    signal: new AbortController().signal,
    checkRoot: rootCheck,
  });
  phase = "census";
  worker = spawn(
    PYTHON,
    ["-I", "-B", "-S", path.join(ROOT, CENSUS), "--proof-worker", root],
    { cwd: root, env: childEnv, shell: false, stdio: ["pipe", "pipe", "pipe"] },
  );
  client = core.createMacCensusProofClient(worker, { deadline: end });
  await within(client.ready);
  const session = Object.freeze({ proofOnly: true });
  const snapshot = async (options) => {
    assert(options.censusSession === session);
    assert(performance.now() < options.deadline, "Owned reap deadline");
    const value = await client.snapshot();
    assert(performance.now() < options.deadline, "Owned reap deadline");
    return value.rows;
  };
  for (const [label, body] of [
    ["old", old],
    ["candidate", next],
  ]) {
    phase = label;
    check();
    assert(performance.now() < end - 45000);
    holder = startHolder(subjects[HOLDER].raw.toString("utf8"), root, childEnv);
    const ready = await within(holder.ready);
    if (ready.kind === "unsupported") {
      report.waitidSupported = false;
      throw Error("WAITID_UNSUPPORTED");
    }
    assert(
      ready.waitidSupported &&
        ready.exitedWithoutReaping &&
        ready.exitStatus === 0 &&
        ready.parent === holder.child.pid &&
        ready.group === ready.target &&
        ready.peer === null,
    );
    report.waitidSupported = true;
    const first = await client.snapshot(),
      identity = first.rows.find((x) => x.pid === ready.target);
    assert(
      identity &&
        identity.parent === ready.parent &&
        identity.group === ready.target,
      "ZOMBIE_NOT_CENSUSED",
    );
    let checks = 0;
    const signals = [];
    const context = {
      assert,
      performance,
      setTimeout,
      COMPILE_CLEANUP_MS: 30000,
      process: {
        kill: (pid, signal) => {
          assert.equal(pid, ready.target);
          assert(["SIGSTOP", "SIGKILL"].includes(signal));
          signals.push({ pid, signal });
          return process.kill(pid, signal);
        },
      },
      processSnapshot: snapshot,
      observedLineage: core.observedLineage,
      sameObservedCohort: core.sameObservedCohort,
      groupQuiet: core.groupQuiet,
    };
    vm.createContext(context);
    vm.runInContext(quiet, context);
    const actualQuiet = vm.runInContext("observedQuiet", context);
    context.observedQuiet = async (...args) => {
      checks++;
      return actualQuiet(...args);
    };
    const reap = vm.runInContext("(" + body + ")", context);
    await holder.begin();
    const begin = performance.now(),
      deadline = begin + 30000;
    let passed = false,
      errorCode = null;
    try {
      await reap(
        { pid: ready.target },
        [{ pid: ready.target, start: identity.start }],
        { deadline, censusSession: session },
      );
      passed = true;
    } catch (e) {
      errorCode = known(e);
    }
    const elapsedMs = Math.floor(performance.now() - begin),
      remainingMs = Math.floor(deadline - performance.now());
    assert(checks <= 50);
    const atReturn = (await client.snapshot()).rows,
      stillPresent = atReturn.some(
        (x) => x.pid === identity.pid && x.start === identity.start,
      );
    if (label === "old") {
      assert(
        !passed &&
          errorCode === "OWN_NOT_REAPED" &&
          remainingMs > 10000 &&
          stillPresent,
      );
    } else
      assert(passed && elapsedMs >= 7900 && elapsedMs < 30000 && !stillPresent);
    const waited = await within(holder.reap);
    assert.equal(waited.target, ready.target);
    assert.equal(waited.status, 0);
    assert(waited.elapsedMs >= 7900);
    const after = (await client.snapshot()).rows;
    assert(
      !after.some((x) => x.pid === identity.pid && x.start === identity.start),
    );
    assert(
      await core.groupQuiet(ready.target, {
        deadline: Math.min(end, performance.now() + 2000),
      }),
    );
    const closed = await within(holder.joined);
    assert(
      closed.code === 0 &&
        closed.signal === null &&
        closed.stderrBytes === 0 &&
        !closed.protocolFailed,
    );
    holder = null;
    report.cases.push({
      label,
      passed,
      errorCode,
      elapsedMs,
      remainingMs,
      quietChecks: checks,
      waitidExitObservedWithoutReaping: true,
      identity,
      stillPresentAtReturn: stillPresent,
      waitpidElapsedMs: waited.elapsedMs,
      pidAndGroupAbsentAfterWaitpid: true,
      holderJoined: true,
      signalCount: signals.length,
    });
  }
  report.subject = {
    bytes: subjects[CORE].pin.bytes,
    sha256: subjects[CORE].pin.sha256,
    stopObservedSha256: sha(old),
    oneExpressionInverseExact: true,
    before: BEFORE,
    after: AFTER,
    unchangedQuietPredicate: true,
    unchanged50CallCap: true,
    originalDeadlineMilliseconds: 30000,
  };
  report.pins = Object.fromEntries(
    Object.entries(subjects).map(([name, v]) => [name, v.pin]),
  );
  report.head = env.GITHUB_SHA;
  report.runId = env.GITHUB_RUN_ID;
  report.attempt = env.GITHUB_RUN_ATTEMPT;
  report.image = env.ImageVersion;
  for (const [name, v] of Object.entries(subjects))
    await pin(path.join(ROOT, name), 300000, v.pin);
  await rootCheck();
  check();
  report.complete = true;
}
try {
  await main();
} catch (e) {
  hasFailure = true;
  firstError = e;
  report.failure = { phase, code: known(e) };
} finally {
  if (holder) {
    try {
      holder.release();
      await within(holder.joined);
    } catch (e) {
      if (!hasFailure) {
        hasFailure = true;
        firstError = e;
        report.failure = { phase: "holder-close", code: known(e) };
      }
    }
  }
  if (client) {
    try {
      const closed = await client.close({ deadline: end });
      assert(closed.joined && closed.code === 0 && !closed.failed);
      report.censusJoined = true;
    } catch (e) {
      if (!hasFailure) {
        hasFailure = true;
        firstError = e;
        report.failure = { phase: "census-close", code: known(e) };
      }
    }
  }
}
report.complete = report.complete && !hasFailure;
if (reportTarget) {
  const output = path.dirname(reportTarget);
  assert.equal(await realpath(output), output);
  const current = await lstat(output, { bigint: true });
  for (const key of ["dev", "ino", "mode", "uid"])
    assert.equal(current[key], tempIdentity[key]);
  const raw = JSON.stringify(report) + "\n";
  assert(Buffer.byteLength(raw) <= 32768);
  await writeFile(reportTarget, raw, { flag: "wx", mode: 0o600 });
}
console.log(
  JSON.stringify({
    kind: report.kind,
    complete: report.complete,
    failure: report.failure ?? null,
    cases: report.cases.length,
    runtimeReady: false,
    productionAdmitted: false,
  }),
);
if (hasFailure) {
  void firstError;
  process.exitCode = 1;
}
