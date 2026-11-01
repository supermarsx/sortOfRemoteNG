// Owned native proof only. No production census, checkpoint or SDK admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMacCensusProofClient,
  compileSlice,
  censusFailureCode,
  MAC_NATIVE_CENSUS_ADMITTED,
  observedLineage,
  processRows,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const helper = fileURLToPath(
  new URL("../../../scripts/lib/cef-mac-process-census.py", import.meta.url),
);
const execute = promisify(execFile);
// execFile's AbortError can precede the child's close event. Never return to
// scratch cleanup until this exact creation-owned leaf has actually joined.
export async function executeJoined(file, args, options, launch = execFile) {
  const { joinDeadline, ...childOptions } = options;
  assert(
    Number.isFinite(joinDeadline) && performance.now() < joinDeadline,
    "PROOF_DEADLINE",
  );
  let child;
  const completion = new Promise((resolve, reject) => {
    child = launch(file, args, childOptions, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  let result, failure;
  try {
    result = await waitOwned(completion, joinDeadline);
  } catch (error) {
    failure = error;
  }
  try {
    await waitOwned(closed, joinDeadline);
  } catch (error) {
    // This exact creation handle is the only safe stop target. An expired
    // join lease remains failure, regardless of a later close notification.
    try {
      child.kill("SIGKILL");
    } catch {
      /* Preserve the original failure. */
    }
    try {
      child.unref();
    } catch {
      /* No confirmed join or cleanup claim. */
    }
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      try {
        stream?.destroy();
      } catch {
        /* Retire only this child's owned pipes. */
      }
      try {
        stream?.unref?.();
      } catch {
        /* Preserve the primary failure. */
      }
    }
    throw failure ?? error;
  }
  if (failure) throw failure;
  assert(performance.now() < joinDeadline, "PROOF_DEADLINE");
  return result;
}
export async function captureOracleAbi(
  output,
  { env, end, signal, checkRoot },
  runLeaf = executeJoined,
) {
  assert(!signal.aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
  await checkRoot();
  const binary = path.join(output, "abi-oracle");
  const oracleSha256 = createHash("sha256")
    .update(await held(binary, 2 * 1024 ** 2))
    .digest("hex");
  assert(!signal.aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
  const result = await runLeaf(binary, [], {
    cwd: output,
    env,
    signal,
    joinDeadline: end,
    timeout: Math.max(1, Math.min(2000, end - performance.now() - 30000)),
    killSignal: "SIGKILL",
    maxBuffer: 2048,
    windowsHide: true,
  });
  const abi = JSON.parse(result.stdout);
  assert(abi && typeof abi === "object" && !Array.isArray(abi), "PROOF_ORACLE");
  await checkRoot();
  assert(
    createHash("sha256")
      .update(await held(binary, 2 * 1024 ** 2))
      .digest("hex") === oracleSha256,
    "PROOF_ORACLE",
  );
  assert(!signal.aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
  const raw = JSON.stringify({ abi, oracleSha256 }) + "\n";
  assert(Buffer.byteLength(raw) <= 4096, "PROOF_ORACLE");
  await fs.writeFile(path.join(output, "abi-oracle.partial"), raw, {
    flag: "wx",
    mode: 0o600,
  });
  await checkRoot();
  assert(!signal.aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
  await fs.rename(
    path.join(output, "abi-oracle.partial"),
    path.join(output, "abi-oracle.json"),
  );
  return { abi, oracleSha256 };
}
const roles = [
  "root",
  "child",
  "grandchild",
  "launcher",
  "detached",
  "foreign",
  "busy0",
  "busy1",
  "busy2",
  "busy3",
];
const stamp = (s) =>
  [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.gid]
    .map(String)
    .join(":");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitOwned(promise, end) {
  let alarm;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        alarm = setTimeout(
          () => reject(Error("PROOF_CLEANUP_DEADLINE")),
          Math.max(0, end - performance.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(alarm);
  }
}
export function oracleAbsent(error) {
  return error?.code === 3 && !error.killed && !error.signal;
}
export function proofCompilerEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !/^(GH_|GITHUB_|ACTIONS_)/i.test(key),
    ),
  );
}
export async function publishCompilerGate(
  output,
  checkRoot,
  signal,
  isAborted,
  io = fs,
) {
  assert(!isAborted() && !signal.aborted, "PROOF_COMPILE_GATE");
  await checkRoot();
  assert(!isAborted() && !signal.aborted, "PROOF_COMPILE_GATE");
  await io.writeFile(path.join(output, "compiler-start.partial"), "start\n", {
    flag: "wx",
    mode: 0o600,
  });
  assert(!isAborted() && !signal.aborted, "PROOF_COMPILE_GATE");
  await io.rename(
    path.join(output, "compiler-start.partial"),
    path.join(output, "compiler-start"),
  );
}
export function summarize(samples) {
  assert(
    samples.length > 0 &&
      samples.every((x) => Number.isSafeInteger(x) && x >= 0),
    "PROOF_SAMPLES",
  );
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Micros: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95Micros: sorted[Math.floor((sorted.length - 1) * 0.95)],
    maxMicros: sorted.at(-1),
  };
}
export async function held(file, maximum) {
  const before = await fs.lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximum) &&
      (await fs.realpath(file)) === file,
    "PROOF_FILE",
  );
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert(
      stamp(await handle.stat({ bigint: true })) === stamp(before),
      "PROOF_FILE",
    );
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    for (;;) {
      const read = await handle.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!read.bytesRead) break;
      count += read.bytesRead;
      assert(count <= maximum, "PROOF_FILE");
    }
    assert(
      count === Number(before.size) &&
        stamp(await handle.stat({ bigint: true })) === stamp(before) &&
        stamp(await fs.lstat(file, { bigint: true })) === stamp(before),
      "PROOF_FILE",
    );
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}
function legacyStart(token) {
  const [, seconds] = /^darwin-v1:([0-9]+):[0-9]+$/.exec(token) ?? [];
  assert(seconds, "PROOF_START");
  const date = new Date(Number(seconds) * 1000),
    pad = (x) => String(x).padStart(2, "0");
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]} ${date.getUTCDate()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
}
export async function runProof(output) {
  assert(
    process.platform === "darwin" &&
      process.arch === "x64" &&
      process.env.ImageOS === "macos15" &&
      process.env.ImageVersion === "20260824.0482.1",
    "PROOF_HOST",
  );
  assert(MAC_NATIVE_CENSUS_ADMITTED === false, "PROOF_UNADMITTED");
  const pinnedPython = await held(PYTHON, 13592);
  assert(
    pinnedPython.length === 13592 &&
      createHash("sha256").update(pinnedPython).digest("hex") ===
        "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
    "PROOF_PYTHON_PIN",
  );
  const temp = process.env.RUNNER_TEMP;
  assert(
    path.posix.dirname(output) === temp &&
      (await fs.realpath(temp)) === temp &&
      /^cef-mac-census-proof-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        path.posix.basename(output),
      ),
    "PROOF_OUTPUT",
  );
  await fs.mkdir(output, { mode: 0o700 });
  const rootIdentity = await fs.lstat(output, { bigint: true });
  const rootKey = (s) =>
    [s.dev, s.ino, s.mode, s.uid, s.gid].map(String).join(":");
  const checkRoot = async () =>
    assert(
      rootKey(await fs.lstat(output, { bigint: true })) ===
        rootKey(rootIdentity) && (await fs.realpath(output)) === output,
      "PROOF_ROOT_CHANGED",
    );
  const env = {
    PATH: "/usr/bin:/bin",
    RUNNER_TEMP: temp,
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    PYTHONDONTWRITEBYTECODE: "1",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (process.env.RUNNER_TRACKING_ID)
    env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
  const end = performance.now() + 160000;
  const children = [],
    states = [];
  const compileAbort = new AbortController();
  let worker,
    client,
    oracleSha,
    owned = [],
    known = [],
    stage = "worker",
    firstError,
    failed = false,
    workerStopped = false,
    actorsStopped = false,
    aborted = false,
    compilerQuiescent = false;
  const cancel = () => {
    aborted = true;
    compileAbort.abort(new Error("PROOF_ABORT"));
    for (const state of states)
      if (state.role !== "worker" && !state.closed) state.child.kill("SIGTERM");
    client?.abort();
  };
  const workTimer = setTimeout(cancel, 130000);
  process.on("SIGTERM", cancel);
  process.on("SIGINT", cancel);
  const report = {
    schemaVersion: 1,
    kind: "sorng-mac-process-census-proof",
    complete: false,
    productionAdmitted: false,
    productionInputWrites: false,
    nativeAcceptance: false,
    runtimeReady: false,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    image: "20260824.0482.1",
    requestDeadlineMs: 2000,
    cadenceMs: 250,
    censusWorkerProcesses: 1,
    periodicNativeProbeSpawns: 0,
    oracleCompilerUsed: true,
  };
  const spawnOwned = (role) => {
    assert(!aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
    const child = spawn(
      PYTHON,
      [
        "-I",
        "-B",
        "-S",
        helper,
        role === "worker" ? "--proof-worker" : "--proof-actor",
        output,
        ...(role === "worker" ? [] : [role]),
      ],
      {
        cwd: output,
        env,
        detached: role !== "worker",
        stdio:
          role === "worker"
            ? ["pipe", "pipe", "pipe"]
            : ["ignore", "ignore", "ignore"],
      },
    );
    const state = { child, role, closed: false, error: false };
    state.done = new Promise((resolve) => {
      child.once("error", () => {
        state.error = true;
      });
      child.once("close", (code) => {
        state.closed = true;
        state.code = code;
        resolve();
      });
    });
    children.push(child);
    states.push(state);
    return child;
  };
  const snapshot = async () => {
    assert(!aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
    return client.snapshot();
  };
  const oracleIdentity = async (actor) => {
    try {
      await checkRoot();
      assert(
        createHash("sha256")
          .update(await held(path.join(output, "abi-oracle"), 2 * 1024 ** 2))
          .digest("hex") === oracleSha,
        "PROOF_ORACLE",
      );
      const result = await execute(
        path.join(output, "abi-oracle"),
        ["--identity", String(actor.pid)],
        {
          cwd: output,
          env,
          timeout: Math.max(1, Math.min(2000, end - performance.now())),
          maxBuffer: 2048,
          windowsHide: true,
        },
      );
      const row = JSON.parse(result.stdout);
      assert(
        row.pid === actor.pid && row.start === actor.start,
        "PROOF_CLEANUP_IDENTITY",
      );
      return row;
    } catch (error) {
      if (oracleAbsent(error)) return null;
      throw error;
    }
  };
  const actorReceipt = async (role) => {
    const stop = Math.min(end, performance.now() + 5000);
    while (performance.now() < stop) {
      try {
        const value = JSON.parse(
          (
            await held(path.join(output, `actor-${role}.json`), 4096)
          ).toString(),
        );
        assert(
          Object.keys(value).sort().join(",") === "group,parent,pid,session" &&
            Object.values(value).every((x) => Number.isSafeInteger(x) && x > 0),
          "PROOF_ACTOR",
        );
        return { role, ...value };
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
      }
      await sleep(25);
    }
    throw Error("PROOF_ACTOR");
  };
  try {
    stage = "prepare";
    const prepared = await execute(
      PYTHON,
      ["-I", "-B", "-S", helper, "--proof-prepare", output],
      {
        cwd: output,
        env,
        timeout: Math.max(1, Math.min(45000, end - performance.now() - 30000)),
        maxBuffer: 4096,
        windowsHide: true,
      },
    );
    const preparation = JSON.parse(prepared.stdout);
    assert(!aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
    assert(
      preparation.prepared === true &&
        preparation.productionAdmitted === false &&
        createHash("sha256")
          .update(await held(path.join(output, "abi-oracle.c"), 16384))
          .digest("hex") === preparation.sourceSha256,
      "PROOF_ORACLE_SOURCE",
    );
    stage = "compiler";
    // Preserve the original160s proof end. Reserve30s for this compiler's
    // existing cleanup, then100s for measurements/owned actors/final cleanup.
    const compileWork = Math.floor(
      Math.min(30000, end - performance.now() - 130000),
    );
    assert(compileWork >= 1000, "PROOF_COMPILE_BUDGET");
    const compilerEnv = proofCompilerEnvironment(env);
    const compiled = await compileSlice(
      PYTHON,
      ["-I", "-B", "-S", helper, "--proof-compile", output],
      {
        cwd: output,
        logs: output,
        env: compilerEnv,
        milliseconds: compileWork,
        stopSignal: compileAbort.signal,
        outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 },
        async observeRoot(identity, control) {
          assert(
            !aborted && !control.signal.aborted && identity.pid > 0,
            "PROOF_COMPILE_GATE",
          );
          await publishCompilerGate(
            output,
            checkRoot,
            control.signal,
            () => aborted,
          );
        },
      },
    );
    compilerQuiescent = compiled.quiescent === true;
    assert(!aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
    assert(
      compilerQuiescent &&
        compiled.outcome === "compiler-complete" &&
        compiled.exitCode === 0,
      "PROOF_ORACLE_COMPILE",
    );
    report.oracleCompilerQuiescent = true;
    report.oracleCompilerJoined = true;
    report.oracleCompilerNaturalExitZero = true;
    stage = "worker";
    const captured = await captureOracleAbi(output, {
      env,
      end,
      signal: compileAbort.signal,
      checkRoot,
    });
    worker = spawnOwned("worker");
    client = createMacCensusProofClient(worker, { deadline: end });
    const ready = await client.ready;
    oracleSha = ready.oracleSha256;
    assert(oracleSha === captured.oracleSha256, "PROOF_ORACLE");
    assert.deepEqual(ready.abi, captured.abi, "PROOF_ORACLE");
    report.abi = ready.abi;
    const binary = path.join(output, "abi-oracle");
    assert(
      createHash("sha256")
        .update(await held(binary, 2 * 1024 ** 2))
        .digest("hex") === ready.oracleSha256,
      "PROOF_ORACLE",
    );
    stage = "actors";
    spawnOwned("root");
    spawnOwned("foreign");
    for (let n = 0; n < 4; n++) spawnOwned(`busy${n}`);
    known = await Promise.all(roles.map(actorReceipt));
    for (const state of states.filter((x) => x.role !== "worker")) {
      const receipt = known.find((x) => x.role === state.role);
      assert(
        receipt.pid === state.child.pid && receipt.parent === process.pid,
        "PROOF_CREATION_IDENTITY",
      );
    }
    const first = await snapshot();
    for (const actor of known) {
      const row = first.rows.find((row) => row.pid === actor.pid);
      assert(
        row && row.parent === actor.parent && row.group === actor.group,
        "PROOF_OWNERSHIP",
      );
      // Independent C field access checks the Python opaque-row ABI decoder.
      actor.start = row.start;
      const oracle = await oracleIdentity(actor);
      assert(
        oracle.pid === row.pid &&
          oracle.parent === row.parent &&
          oracle.group === row.group &&
          oracle.start === row.start,
        "PROOF_ORACLE",
      );
    }
    report.abiConfirmed = true;
    report.canonicalStartTokens = true;
    const root = known.find((x) => x.role === "root"),
      child = known.find((x) => x.role === "child"),
      grand = known.find((x) => x.role === "grandchild"),
      launcher = known.find((x) => x.role === "launcher"),
      detached = known.find((x) => x.role === "detached"),
      foreign = known.find((x) => x.role === "foreign");
    assert(
      child.parent === root.pid &&
        grand.parent === child.pid &&
        launcher.parent === root.pid &&
        detached.parent === launcher.pid &&
        detached.session === detached.pid &&
        detached.group === detached.pid &&
        root.session === root.pid,
      "PROOF_OWNERSHIP",
    );
    owned = observedLineage(first.rows, [{ pid: root.pid, start: root.start }]);
    assert(
      owned.length === 5 && !owned.some((x) => x.pid === foreign.pid),
      "PROOF_OWNERSHIP",
    );
    report.ownedRelationsVerified = true;
    await fs.writeFile(path.join(output, "orphan-now"), "owned proof\n", {
      flag: "wx",
      mode: 0o600,
    });
    const orphanEnd = Math.min(end, performance.now() + 5000);
    for (;;) {
      const rows = (await snapshot()).rows;
      owned = observedLineage(rows, owned);
      const row = rows.find((x) => x.pid === detached.pid);
      if (row && row.parent !== launcher.pid) {
        assert(
          row.start === detached.start && owned.some((x) => x.pid === row.pid),
          "PROOF_REPARENT",
        );
        break;
      }
      assert(performance.now() < orphanEnd, "PROOF_REPARENT");
      await sleep(25);
    }
    report.reparentedChildRetained = true;
    stage = "samples";
    const psSamples = [],
      nativeSamples = [],
      collectSamples = [];
    for (const provider of ["ps", "native"]) {
      for (let index = 0; index < 64; index++) {
        assert(!aborted && performance.now() < end - 30000, "PROOF_DEADLINE");
        const began = performance.now();
        let rows;
        if (provider === "ps") {
          const result = await execute(
            "/bin/ps",
            ["-axo", "pid=,ppid=,lstart="],
            {
              env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
              timeout: 2000,
              killSignal: "SIGKILL",
              maxBuffer: 4 * 1024 ** 2,
              windowsHide: true,
            },
          );
          rows = processRows(result.stdout);
          psSamples.push(Math.floor((performance.now() - began) * 1000));
          for (const actor of known.filter((x) => x.role !== "launcher"))
            assert(
              rows.some(
                (x) =>
                  x.pid === actor.pid && x.start === legacyStart(actor.start),
              ),
              "PROOF_IDENTITY",
            );
        } else {
          const response = await snapshot();
          rows = response.rows;
          nativeSamples.push(response.roundtripMicros);
          collectSamples.push(response.collectMicros);
          owned = observedLineage(rows, owned);
          for (const actor of known.filter((x) => x.role !== "launcher"))
            assert(
              rows.some((x) => x.pid === actor.pid && x.start === actor.start),
              "PROOF_IDENTITY",
            );
        }
        assert(
          !states.some((x) => x.role !== "worker" && x.closed),
          "PROOF_ACTOR_EXIT",
        );
        await sleep(Math.max(0, 250 - (performance.now() - began)));
      }
    }
    report.samples = {
      ps: summarize(psSamples),
      native: {
        ...summarize(nativeSamples),
        collect: summarize(collectSamples),
      },
    };
    stage = "owned-stop";
    const current = (await snapshot()).rows;
    for (const record of [...owned].reverse()) {
      const match = current.find((x) => x.pid === record.pid);
      if (match) {
        assert(match.start === record.start, "PROOF_IDENTITY");
        process.kill(record.pid, "SIGTERM");
      }
    }
    const foreignNow = (await snapshot()).rows.find(
      (x) => x.pid === foreign.pid,
    );
    assert(foreignNow?.start === foreign.start, "PROOF_FOREIGN");
    report.foreignUntouched = true;
  } catch (error) {
    failed = true;
    firstError = error;
    report.failure = stage;
    report.workerFailure = censusFailureCode(error?.stderr);
  } finally {
    clearTimeout(workTimer);
    stage = "cleanup";
    const cleanupEnd = Math.min(end, performance.now() + 30000);
    try {
      // Only our own direct child handles are stopped without a new PID lookup.
      for (const state of states.filter((x) => x.role !== "worker"))
        if (!state.closed) state.child.kill("SIGTERM");
      if (known.length) {
        for (const actor of known) {
          if (!actor.start) continue;
          const row = await oracleIdentity(actor);
          if (row) process.kill(actor.pid, "SIGTERM");
        }
        for (;;) {
          let alive = false;
          for (const actor of known) {
            if (actor.start && (await oracleIdentity(actor))) alive = true;
          }
          if (!alive) break;
          assert(performance.now() < cleanupEnd, "PROOF_CLEANUP_DEADLINE");
          await sleep(50);
        }
      }
      await waitOwned(
        Promise.all(
          states.filter((x) => x.role !== "worker").map((x) => x.done),
        ),
        cleanupEnd,
      );
      actorsStopped =
        known.length === roles.length &&
        states.filter((x) => x.role !== "worker").every((x) => x.closed);
      if (client) {
        const result = await client.close();
        workerStopped = result.joined;
      } else if (worker) {
        worker.kill("SIGKILL");
        await states[0].done;
      }
      assert(
        compilerQuiescent && actorsStopped && workerStopped,
        "PROOF_CLEANUP",
      );
      await checkRoot();
      const allowed = new Set([
        "abi-oracle.c",
        "abi-oracle",
        "abi-oracle.json",
        "abi-oracle.partial",
        "orphan-now",
        "compiler-start",
        "compiler-start.partial",
        "checkpoint-compile.stdout.log",
        "checkpoint-compile.stderr.log",
        "checkpoint-compile.outcome.json",
        ...roles.map((x) => `actor-${x}.json`),
      ]);
      const names = await fs.readdir(output);
      assert(
        names.every((x) => allowed.has(x)),
        "PROOF_CLEANUP_FILES",
      );
      for (const name of names) {
        const file = path.join(output, name);
        const info = await fs.lstat(file, { bigint: true });
        assert(
          info.isFile() &&
            !info.isSymbolicLink() &&
            info.nlink === 1n &&
            info.uid === rootIdentity.uid,
          "PROOF_CLEANUP_FILES",
        );
        await checkRoot();
        await fs.unlink(file);
      }
      report.cleanupConfirmed = true;
      report.handlesClosed = true;
      report.ownedProcessesRemoved = true;
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
        report.failure = "cleanup";
      }
      report.cleanupConfirmed = false;
      report.handlesClosed = workerStopped;
      report.ownedProcessesRemoved = actorsStopped;
      for (const state of states)
        if (!state.closed) {
          state.child.kill("SIGKILL");
          state.child.unref();
        }
    }
    report.complete = !failed && report.cleanupConfirmed === true;
    if (failed && client) {
      const code = client.diagnostics().code;
      if (code !== "CENSUS_UNAVAILABLE") report.workerFailure = code;
    }
    await checkRoot();
    const raw = JSON.stringify(report, null, 2) + "\n";
    assert(Buffer.byteLength(raw) <= 128 * 1024, "PROOF_REPORT");
    await fs.writeFile(path.join(output, "proof.json"), raw, {
      flag: "wx",
      mode: 0o600,
    });
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
  if (failed) throw firstError;
  return report;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    assert(
      process.argv.length === 4 && process.argv[2] === "--output",
      "PROOF_ARGUMENTS",
    );
    await runProof(process.argv[3]);
    console.log("MAC_CENSUS_PROOF_COMPLETE");
  } catch {
    console.error("MAC_CENSUS_PROOF_FAILED");
    process.exitCode = 1;
  }
}
