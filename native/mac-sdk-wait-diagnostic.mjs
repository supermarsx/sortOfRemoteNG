import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFile, spawn as spawnProcess } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { macMetalEnvironment } from "../scripts/cef-hosted-provision.mjs";
import { plan, validateRunnerMap } from "../scripts/cef-runtime-ci.mjs";
import {
  checkpointHost,
  compileSlice,
} from "../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  verifyToolchainFiles,
  identitySha256,
} from "../scripts/lib/browser-custom-runtime.mjs";
const SELF = fileURLToPath(import.meta.url);
const BRANCH = "codex/ci-mac-sdk-wait-diagnostic-20261027";
const INPUTS =
  "native/cef-build-inputs/20261025-r5-owned-http3-macarm-sdk26-2-capture-compat";
const SOURCE =
  "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54";
const SDK =
  "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk";
const DEVELOPER = "/Applications/Xcode_26.3.app/Contents/Developer";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const code = (e) =>
  [
    "ENOENT",
    "EACCES",
    "EPERM",
    "ETIMEDOUT",
    "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  ].includes(e?.code)
    ? e.code
    : "QUERY_FAILED";
export function primaryReason(error) {
  if (error === null) return "SDK_WAIT_NULL_PRIMARY";
  try {
    if (error?.message === "Runner map target/schema mismatch")
      return "SDK_WAIT_RUNNER_MAP_TARGET_SCHEMA";
    const known = new Set([
      "SDK_WAIT_AUTHORITY",
      "SDK_WAIT_EVENT",
      "SDK_WAIT_INPUTS",
      "SDK_WAIT_SOURCE",
      "SDK_WAIT_IMAGE",
      "SDK_WAIT_SELECTED",
      "SDK_WAIT_ROOT",
      "SDK_WAIT_STAGE_ADMISSION",
      "SDK_WAIT_WORKER_FAILED",
      "SDK_WAIT_PENDING_IO_UNCONFIRMED",
      "SDK_WAIT_CLEANUP_UNCONFIRMED",
      "SDK_WAIT_HARD_DEADLINE_UNCONFIRMED",
      "SDK_WAIT_CONTEXT",
      "SDK_WAIT_FILE",
      "SDK_WAIT_PATH",
      "SDK_WAIT_LINK",
      "SDK_WAIT_DEADLINE",
      "SDK_WAIT_REPORT_BOUND",
      "METAL_SAMPLE_INTERFACE_UNAVAILABLE",
      "METAL_SAMPLE_JOIN_UNCONFIRMED",
    ]);
    return known.has(error?.message)
      ? error.message
      : "SDK_WAIT_UNKNOWN_PRIMARY";
  } catch {
    return "SDK_WAIT_UNKNOWN_PRIMARY";
  }
}
export function authority(
  e,
  event,
  platform = process.platform,
  arch = process.arch,
) {
  assert(
    platform === "darwin" &&
      arch === "x64" &&
      e.SDK_WAIT_DIAGNOSTIC === "true" &&
      e.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      e.GITHUB_ACTIONS === "true" &&
      e.RUNNER_ENVIRONMENT === "github-hosted" &&
      e.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      e.GITHUB_REPOSITORY_ID === "1010282954" &&
      e.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      e.CEF_DEFAULT_BRANCH === "main" &&
      e.GITHUB_REF === "refs/heads/" + BRANCH &&
      e.GITHUB_WORKFLOW_SHA === e.GITHUB_SHA &&
      /^[a-f0-9]{40}$/.test(e.GITHUB_SHA) &&
      e.GITHUB_WORKFLOW_REF ===
        "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/" +
          BRANCH,
    "SDK_WAIT_AUTHORITY",
  );
  assert(
    event?.repository?.id === 1010282954 &&
      event.repository.full_name === "supermarsx/sortOfRemoteNG" &&
      event.repository.private === false &&
      event.repository.visibility === "public" &&
      event.repository.default_branch === "main",
    "SDK_WAIT_EVENT",
  );
  assert(
    event.inputs &&
      Object.keys(event.inputs).every((k) =>
        ["sdk_wait_diagnostic", "metal_tools"].includes(k),
      ) &&
      [true, "true"].includes(event.inputs.sdk_wait_diagnostic) &&
      [undefined, false, "false"].includes(event.inputs.metal_tools),
    "SDK_WAIT_INPUTS",
  );
}
export function clock(
  milliseconds = 600000,
  { wall = Date.now, mono = () => process.hrtime.bigint() } = {},
) {
  const wallEnd = wall() + milliseconds,
    monoEnd = mono() + BigInt(milliseconds) * 1000000n;
  const remaining = () => {
    const n = Math.floor(
      Math.min(wallEnd - wall(), Number(monoEnd - mono()) / 1e6),
    );
    assert(Number.isSafeInteger(n) && n > 0, "SDK_WAIT_DEADLINE");
    return n;
  };
  const cleanup = () => {
    const n = Math.floor(
      Math.min(
        wallEnd + 30000 - wall(),
        Number(monoEnd + 30000000000n - mono()) / 1e6,
      ),
    );
    assert(Number.isSafeInteger(n) && n > 0, "SDK_WAIT_CLEANUP_UNCONFIRMED");
    return n;
  };
  return { remaining, cleanup, wallEnd, monoEnd: String(monoEnd) };
}
export function hardWatchdog(
  budget,
  {
    wall = Date.now,
    mono = () => process.hrtime.bigint(),
    schedule = setTimeout,
    cancel = clearTimeout,
    terminate = () => process.exit(1),
    observe = () => ({}),
  } = {},
) {
  const wallEnd = budget.wallEnd + 30000,
    monoEnd = BigInt(budget.monoEnd) + 30000000000n;
  let timer,
    fired = false,
    released = false;
  const left = () =>
    Math.floor(Math.min(wallEnd - wall(), Number(monoEnd - mono()) / 1e6));
  const fire = () => {
    if (released || fired) return;
    fired = true;
    terminate({ reason: "SDK_WAIT_HARD_DEADLINE_UNCONFIRMED", ...observe() });
  };
  const tick = () => {
    if (released || fired) return;
    const remaining = left();
    if (remaining <= 0) {
      fire();
      return;
    }
    timer = schedule(tick, Math.min(250, remaining));
  };
  tick();
  return {
    get fired() {
      return fired;
    },
    assertActive() {
      if (left() <= 0) fire();
      assert(!fired, "SDK_WAIT_HARD_DEADLINE_UNCONFIRMED");
    },
    release(actorsQuiet, pendingIoCount) {
      if (left() <= 0) fire();
      if (fired || actorsQuiet !== true || pendingIoCount !== 0) return false;
      released = true;
      cancel(timer);
      return true;
    },
  };
}

const pendingIO = new Set();
export async function bounded(action, remaining) {
  const ms = remaining();
  let timer;
  const running = Promise.resolve().then(action);
  pendingIO.add(running);
  running.then(
    () => pendingIO.delete(running),
    () => pendingIO.delete(running),
  );
  try {
    return await Promise.race([
      running,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("SDK_WAIT_PENDING_IO_UNCONFIRMED")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const SAMPLE_BYTES = 4096;
const QUERY_BYTES = 192 * 1024;
const SAMPLE_RAW_BYTES = 128 * 1024;
const PS_ARGS = ["-o", "pid=,ppid=,pgid=,lstart="];
const interfaceFailures = new WeakMap();
const queryFailures = new WeakMap();
const PUBLIC_MODULES = new Set([
  "xcrun",
  "dyld",
  "libxcrun.dylib",
  "libsystem_kernel.dylib",
  "libsystem_pthread.dylib",
  "libsystem_c.dylib",
  "libdispatch.dylib",
  "libdyld.dylib",
  "libobjc.A.dylib",
  "CoreFoundation",
  "Foundation",
  "DVTFoundation",
  "DVTToolchain",
  "XcodeSystemSupport",
]);
export function sampleProjection(raw) {
  assert(Buffer.isBuffer(raw) && raw.length <= SAMPLE_RAW_BYTES);
  const result = { rows: [], dropped: 0, unclassified: 0, invalidUtf8: false };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    result.invalidUtf8 = true;
    return result;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const row =
      /^\s*[+!:| ]*([0-9]{1,9})\s+([A-Za-z_$][A-Za-z0-9_$:.<>-]{0,127})\s+\(in ([A-Za-z0-9_.-]{1,64})\)(?:\s+\+\s+[0-9]+)?(?:\s+\[0x[0-9a-fA-F]+\])?\s*$/.exec(
        line,
      );
    if (!row || !PUBLIC_MODULES.has(row[3])) {
      result.unclassified++;
      continue;
    }
    if (result.rows.length >= 256) {
      result.dropped++;
      continue;
    }
    result.rows.push({ count: Number(row[1]), symbol: row[2], module: row[3] });
  }
  return result;
}
export function fitSampleEvidence(queryRecord, observations) {
  assert(
    Array.isArray(observations) && observations.length <= 2,
    "METAL_SAMPLE_COUNT",
  );
  const record = {
    ...queryRecord,
    sampler: {
      attempted: observations.some((row) => row.started === true),
      attribution: "NON_ATOMIC_PRE_POST_OWNED_PID_TUPLE",
      numericPidRaceResidual: true,
      waitCauseProved: false,
      observations: [],
    },
  };
  // Query output/outcome is never discarded to make diagnostics fit.
  assert(
    Buffer.byteLength(JSON.stringify(record)) < QUERY_BYTES - 1024,
    "METAL_QUERY_RECORD_BOUND",
  );
  for (const original of observations) {
    const item = { ...original, rows: [...(original.rows ?? [])] };
    const available = Math.min(
      SAMPLE_BYTES,
      QUERY_BYTES - Buffer.byteLength(JSON.stringify(record)) - 2,
    );
    while (
      Buffer.byteLength(JSON.stringify(item)) > available &&
      item.rows.length
    ) {
      item.rows.pop();
      item.dropped = (item.dropped ?? 0) + 1;
      item.projectionTruncated = true;
      item.complete = false;
    }
    if (Buffer.byteLength(JSON.stringify(item)) > available) {
      record.sampler.observations.push({
        offsetMs: original.offsetMs,
        omitted: true,
        reason: "QUERY_RECORD_BUDGET",
        dropped: (original.rows?.length ?? 0) + (original.dropped ?? 0),
        joined: original.joined === true,
      });
    } else record.sampler.observations.push(item);
  }
  assert(
    Buffer.byteLength(JSON.stringify(record)) <= QUERY_BYTES,
    "METAL_QUERY_RECORD_BOUND",
  );
  return record;
}
export function parseOwnedPidTuple(raw, pid, parent) {
  assert(
    typeof raw === "string" &&
      Buffer.byteLength(raw) <= 4096 &&
      !/[^\x09\x0a\x0d\x20-\x7e]/.test(raw),
    "METAL_PID_TUPLE",
  );
  const match =
    /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s+([1-9][0-9]*)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+[0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4})\s*$/.exec(
      raw,
    );
  assert(match && [pid, parent].every(Number.isSafeInteger), "METAL_PID_TUPLE");
  const result = {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    pgid: Number(match[3]),
    start: match[4],
  };
  assert(
    [result.pid, result.ppid, result.pgid].every(Number.isSafeInteger) &&
      result.pid === pid &&
      result.ppid === parent &&
      result.pgid === parent,
    "METAL_PID_TUPLE",
  );
  return result;
}
// Every started process is a direct child object; observed PIDs are never signalled.
// Timeout, stop, readers and close all consume the SAME caller deadline.
function observedCommand(file, args, env, left, ceiling, cap, live, deps) {
  assert(file === "/bin/ps" || file === "/usr/bin/sample");
  const ms = Math.floor(Math.min(ceiling, left()));
  assert(
    ms > 0 && ms <= 3000 && Number.isSafeInteger(ms),
    "METAL_OBSERVATION_DEADLINE",
  );
  const startWall = deps.wall(),
    startMono = deps.now();
  return new Promise((resolve) => {
    let child,
      timer,
      closed = false,
      exited = false,
      failed = false,
      ended = false,
      stopped = false;
    const chunks = { stdout: [], stderr: [] },
      counts = { stdout: 0, stderr: 0 };
    let captured = 0,
      truncated = false;
    const streams = { stdout: false, stderr: false };
    const stop = () => {
      if (stopped || closed || exited) return;
      stopped = true;
      try {
        child?.kill("SIGKILL");
      } catch {
        failed = true;
      }
    };
    const finish = (expired = false) => {
      if (ended || (!expired && !(closed && streams.stdout && streams.stderr)))
        return;
      ended = true;
      deps.cancel(timer);
      resolve({
        closed,
        exitSeen: exited,
        readersJoined: streams.stdout && streams.stderr,
        joined:
          closed && streams.stdout && streams.stderr && (exited || !child?.pid),
        failed: failed || expired,
        stopped,
        truncated,
        exitCode: Number.isInteger(child?.exitCode) ? child.exitCode : null,
        signal: child?.signalCode === "SIGKILL" ? "SIGKILL" : null,
        stdout: Buffer.concat(chunks.stdout),
        stderr: Buffer.concat(chunks.stderr),
        stdoutObserved: counts.stdout,
        stderrObserved: counts.stderr,
        capturedBytes: captured,
      });
    };
    const tick = () => {
      let remain = 0;
      try {
        remain = Math.floor(
          Math.min(
            ms - (deps.wall() - startWall),
            ms - (deps.now() - startMono),
            left(),
          ),
        );
      } catch {
        failed = true;
      }
      if (!live()) {
        failed = true;
        stop();
      }
      if (remain <= 0) {
        failed = true;
        stop();
        finish(true);
        return;
      }
      timer = deps.schedule(tick, Math.min(20, remain));
    };
    try {
      child = deps.spawn(file, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      child.on("error", () => {
        failed = true;
        stop();
      });
      child.on("exit", () => {
        exited = true;
      });
      child.on("close", () => {
        closed = true;
        finish();
      });
      for (const kind of ["stdout", "stderr"]) {
        const stream = child[kind];
        if (!stream) {
          streams[kind] = true;
          failed = true;
          continue;
        }
        stream.on("data", (value) => {
          if (ended) return;
          const b = Buffer.from(value);
          counts[kind] += b.length;
          const keep = Math.max(0, cap - captured);
          if (keep) {
            const prefix = b.subarray(0, keep);
            chunks[kind].push(prefix);
            captured += prefix.length;
          }
          if (b.length > keep) {
            truncated = true;
            failed = true;
            stop();
            stream.pause?.();
          }
        });
        stream.on("error", () => {
          failed = true;
          stop();
        });
        const done = () => {
          streams[kind] = true;
          finish();
        };
        stream.on("end", done);
        stream.on("close", done);
      }
      tick();
    } catch {
      failed = true;
      stop();
      finish(true);
    }
  });
}
function compactCommand(value) {
  return {
    closed: value.closed,
    exitSeen: value.exitSeen,
    readersJoined: value.readersJoined,
    joined: value.joined,
    failed: value.failed,
    stopped: value.stopped,
    truncated: value.truncated,
    exitCode: value.exitCode,
    signal: value.signal,
    stdoutObserved: value.stdoutObserved,
    stderrObserved: value.stderrObserved,
    capturedBytes: value.capturedBytes,
    capturedSha256: hash(Buffer.concat([value.stdout, value.stderr])),
    captureOrder: "stdout-then-stderr",
    captureComplete: value.joined && !value.truncated && !value.stopped,
  };
}
async function sampleOwnedQuery(
  child,
  live,
  queryLeft,
  offsetMs,
  deps,
  creation,
) {
  const row = {
    offsetMs,
    started: false,
    joined: true,
    attributed: false,
    rows: [],
    dropped: 0,
  };
  if (!live()) {
    row.notRun = "QUERY_NOT_LIVE";
    return row;
  }
  const initial = Math.floor(Math.min(3000, queryLeft()));
  if (initial < 2000) {
    row.notRun = "INSUFFICIENT_ORIGINAL_QUERY_BUDGET";
    return row;
  }
  const startWall = deps.wall(),
    startMono = deps.now();
  const left = () =>
    Math.floor(
      Math.min(
        initial - (deps.wall() - startWall),
        initial - (deps.now() - startMono),
        queryLeft(),
      ),
    );
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
  };
  const ps = async (role) => {
    assert(live() && left() > 0, "METAL_PID_UNAVAILABLE");
    const result = await observedCommand(
      "/bin/ps",
      ["-p", String(child.pid), ...PS_ARGS],
      env,
      left,
      500,
      4096,
      live,
      deps,
    );
    row[role + "Process"] = compactCommand(result);
    row.joined &&= result.joined;
    assert(
      result.joined &&
        !result.failed &&
        result.exitCode === 0 &&
        !result.truncated &&
        result.stderr.length === 0,
      "METAL_PID_UNAVAILABLE",
    );
    return parseOwnedPidTuple(
      new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
      child.pid,
      process.pid,
    );
  };
  try {
    const before = await ps("pre");
    row.before = before;
    if (JSON.stringify(before) !== JSON.stringify(creation)) {
      row.identityMismatch = true;
      row.reason = "TARGET_IDENTITY_CHANGED";
      return row;
    }
    if (!live() || left() < 1500) {
      row.notRun = "TARGET_OR_BUDGET_CHANGED";
      return row;
    }
    row.started = true;
    const result = await observedCommand(
      "/usr/bin/sample",
      [String(child.pid), "1", "10", "-mayDie", "-file", "/dev/stdout"],
      env,
      left,
      left(),
      SAMPLE_RAW_BYTES,
      live,
      deps,
    );
    row.sample = compactCommand(result);
    row.joined &&= result.joined;
    const after = await ps("post");
    row.after = after;
    row.identityMismatch = JSON.stringify(before) !== JSON.stringify(after);
    row.attributed =
      live() &&
      !row.identityMismatch &&
      result.joined &&
      !result.failed &&
      result.exitCode === 0 &&
      !result.truncated;
    if (row.attributed) Object.assign(row, sampleProjection(result.stdout));
    else row.reason = "ATTRIBUTION_OR_SAMPLE_INCOMPLETE";
    row.complete =
      row.attributed &&
      !row.invalidUtf8 &&
      row.unclassified === 0 &&
      row.dropped === 0;
  } catch {
    row.reason = "OWNED_PID_OR_OBSERVATION_UNAVAILABLE";
  }
  row.actualElapsedMs = Math.max(0, Math.floor(deps.now() - startMono));
  return row;
}
export async function observeSamplerInterface(
  remaining,
  { read = held, stat = fs.lstat } = {},
) {
  const result = {
    supported: false,
    observedOnly: true,
    expectedPinsApproved: false,
    tools: [],
    manual: null,
    reason: "MANUAL_UNAVAILABLE",
  };
  try {
    for (const file of ["/usr/bin/sample", "/bin/ps"]) {
      remaining();
      const before = await stat(file, { bigint: true });
      assert(
        before.isFile() &&
          before.size > 0n &&
          before.size <= 8n * 1024n ** 2n &&
          before.uid === 0n &&
          before.nlink === 1n &&
          (before.mode & 0o022n) === 0n,
        "METAL_OS_TOOL",
      );
      const raw = await read(file, 8 * 1024 ** 2, remaining);
      const after = await stat(file, { bigint: true });
      assert(
        before.dev === after.dev &&
          before.ino === after.ino &&
          before.mode === after.mode &&
          before.mtimeNs === after.mtimeNs &&
          before.ctimeNs === after.ctimeNs &&
          BigInt(raw.length) === before.size,
        "METAL_OS_TOOL",
      );
      result.tools.push({
        path: file,
        bytes: raw.length,
        sha256: hash(raw),
        mode: String(before.mode),
        uid: String(before.uid),
        nlink: String(before.nlink),
      });
    }
    for (const file of [
      "/usr/share/man/man1/sample.1",
      "/usr/share/man/man1/sample.1.gz",
    ]) {
      let raw;
      try {
        raw = await read(file, 65536, remaining);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const body = file.endsWith(".gz")
        ? gunzipSync(raw, { maxOutputLength: 65536 })
        : raw;
      assert(body.length <= 65536);
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(body)
        .replaceAll("\\-", "-");
      const flags =
        /(?:-file\b|\.Fl[ \t]+file\b)/.test(text) &&
        /(?:-mayDie\b|\.Fl[ \t]+mayDie\b)/.test(text);
      const args = /duration/i.test(text) && /interval/i.test(text);
      result.manual = {
        path: file,
        bytes: raw.length,
        sha256: hash(raw),
        decodedBytes: body.length,
        decodedSha256: hash(body),
        bodyBase64: body.toString("base64"),
        optionsObserved: flags && args,
      };
      result.supported = flags && args;
      result.reason = result.supported ? null : "MANUAL_UNSUPPORTED";
      break;
    }
  } catch (error) {
    result.reason = "SAMPLER_INTERFACE_UNAVAILABLE";
    interfaceFailures.set(result, error);
  }
  return result;
}

export function queryEnvironment(selected, variant, root, inherited = {}) {
  assert(
    variant === "A" &&
      selected.DEVELOPER_DIR === DEVELOPER &&
      selected.SDKROOT === SDK &&
      selected.MACOSX_DEPLOYMENT_TARGET === "14.0",
    "SDK_WAIT_SELECTED",
  );
  assert(
    /^\/Users\/runner\/work\/_temp\/cef-mac-sdk-wait-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      root,
    ),
    "SDK_WAIT_ROOT",
  );
  return macMetalEnvironment(selected, inherited);
}
export function query(
  variant,
  env,
  remaining,
  {
    execute = execFile,
    now = () => performance.now(),
    wall = Date.now,
    spawn = spawnProcess,
    schedule = setTimeout,
    cancel = clearTimeout,
    sampling = false,
    offsets = [1000, 10000],
  } = {},
) {
  assert(variant === "A", "METAL_SINGLE_QUERY_ONLY");
  assert(
    JSON.stringify(offsets) === JSON.stringify([1000, 10000]),
    "METAL_FIXED_OFFSETS",
  );
  const timeout = Math.floor(Math.min(30000, remaining()));
  assert(timeout > 0, "SDK_WAIT_QUERY_DEADLINE");
  return new Promise((resolve) => {
    const begin = now(),
      beginWall = wall();
    let child,
      first,
      hasFailure = false,
      callback = false,
      closed = false,
      exited = false,
      settling = false;
    let closedElapsed = null,
      spawnBegin = null,
      creation = null,
      creationJoined = true,
      creationProcess = null,
      observationsQuiet = true,
      targetBound = true;
    const events = [],
      counts = { stdout: 0, stderr: 0 },
      buffers = { stdout: [], stderr: [] },
      tasks = [],
      scheduled = [];
    const deps = { spawn, now, wall, schedule, cancel };
    const event = (kind) => {
      if (events.length < 32)
        events.push({
          kind,
          elapsedMs: Math.max(0, Math.floor(now() - begin)),
        });
    };
    const fail = (e) => {
      if (!hasFailure) {
        hasFailure = true;
        first = e;
      }
      event("failure");
    };
    const live = () =>
      !closed && !exited && Number.isSafeInteger(child?.pid) && child.pid > 0;
    const queryLeft = () => {
      try {
        return Math.floor(
          Math.max(
            0,
            Math.min(
              timeout - (now() - begin),
              timeout - (wall() - beginWall),
              remaining(),
            ),
          ),
        );
      } catch {
        return 0;
      }
    };
    const cancelPending = () => {
      for (const item of scheduled)
        if (!item.started) {
          item.started = true;
          cancel(item.timer);
          item.resolve({
            offsetMs: item.offset,
            started: false,
            joined: true,
            notRun: "QUERY_NOT_LIVE",
            rows: [],
          });
        }
    };
    const finish = async () => {
      if (settling || !callback || !closed) return;
      settling = true;
      cancelPending();
      const observed = await Promise.all(tasks);
      const record = {
        variant,
        kind: "owned-metal-query-sampling",
        command: "selected-metal-lookup",
        queryAttempted: true,
        timeoutMs: timeout,
        elapsedMs: closedElapsed ?? Math.max(0, Math.floor(now() - begin)),
        observationJoinElapsedMs: Math.max(0, Math.floor(now() - begin)),
        querySpawnElapsedMs:
          spawnBegin === null
            ? null
            : Math.max(0, Math.floor(spawnBegin - begin)),
        failed: hasFailure,
        primaryWasNull: hasFailure && first === null,
        failure: hasFailure ? code(first) : null,
        exitSeen: exited,
        closeSeen: closed,
        callbackSeen: callback,
        exitCode: child?.exitCode ?? null,
        signal: child?.signalCode ?? null,
        pid: child?.pid ?? null,
        stdinEnded: child?.stdin?.writableEnded ?? null,
        events,
        stdout: {
          observed: counts.stdout,
          retained: Math.min(counts.stdout, 65536),
          sha256: hash(Buffer.concat(buffers.stdout)),
          base64: Buffer.concat(buffers.stdout).toString("base64"),
        },
        stderr: {
          observed: counts.stderr,
          retained: Math.min(counts.stderr, 65536),
          sha256: hash(Buffer.concat(buffers.stderr)),
          base64: Buffer.concat(buffers.stderr).toString("base64"),
        },
        queryCreation: creation,
        creationObservationJoined: creationJoined,
        creationProcess,
      };
      const result = fitSampleEvidence(
        record,
        observed.filter((row) => row.offsetMs !== 0),
      );
      result.sampler.enabled = sampling;
      result.sampler.joined =
        creationJoined && observed.every((row) => row.joined === true);
      assert(
        Buffer.byteLength(JSON.stringify(result)) <= QUERY_BYTES,
        "METAL_QUERY_RECORD_BOUND",
      );
      if (hasFailure) queryFailures.set(result, first);
      resolve(result);
    };
    try {
      child = execute(
        "/usr/bin/xcrun",
        ["--sdk", "macosx", "--find", "metal"],
        {
          env,
          timeout,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
          windowsHide: true,
        },
        (error) => {
          callback = true;
          if (error !== null && error !== undefined) fail(error);
          event("callback");
          void finish();
        },
      );
    } catch (error) {
      fail(error);
      callback = true;
      closed = true;
      event("spawn-throw");
      void finish();
      return;
    }
    child.once("spawn", () => {
      spawnBegin = now();
      event("spawn");
      if (!sampling || !live()) return;
      const created = (async () => {
        try {
          const result = await observedCommand(
            "/bin/ps",
            ["-p", String(child.pid), ...PS_ARGS],
            {
              PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
              LC_ALL: "C",
              LANG: "C",
              TZ: "UTC",
            },
            queryLeft,
            500,
            4096,
            live,
            deps,
          );
          creationJoined = result.joined;
          creationProcess = compactCommand(result);
          if (
            !live() ||
            !result.joined ||
            result.failed ||
            result.truncated ||
            result.exitCode !== 0 ||
            result.stderr.length
          )
            return null;
          try {
            creation = parseOwnedPidTuple(
              new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
              child.pid,
              process.pid,
            );
            return creation;
          } catch {
            return null;
          }
        } catch {
          creationJoined = false;
          return null;
        }
      })();
      tasks.push(
        created.then(() => ({
          offsetMs: 0,
          started: false,
          joined: creationJoined,
          notRun: creation ? "CREATION_BOUND" : "CREATION_UNAVAILABLE",
          rows: [],
        })),
      );
      for (const offset of offsets) {
        let resolveTask;
        const task = new Promise((resolve) => {
          resolveTask = resolve;
        });
        tasks.push(task);
        const item = {
          offset,
          started: false,
          resolve: resolveTask,
          timer: null,
        };
        scheduled.push(item);
        item.timer = schedule(async () => {
          if (item.started) return;
          item.started = true;
          const initial = await created;
          if (
            !initial ||
            !live() ||
            !creationJoined ||
            !observationsQuiet ||
            !targetBound
          ) {
            resolveTask({
              offsetMs: offset,
              started: false,
              joined: creationJoined,
              notRun: "OWNED_CREATION_UNAVAILABLE",
              rows: [],
            });
            return;
          }
          try {
            const actualOffsetMs = Math.max(
              0,
              Math.floor(now() - (spawnBegin ?? begin)),
            );
            const row = await sampleOwnedQuery(
              child,
              live,
              queryLeft,
              offset,
              deps,
              initial,
            );
            row.actualOffsetMs = actualOffsetMs;
            observationsQuiet &&= row.joined;
            targetBound &&= !row.identityMismatch;
            resolveTask(row);
          } catch {
            resolveTask({
              offsetMs: offset,
              started: false,
              joined: false,
              reason: "OBSERVATION_UNCONFIRMED",
              rows: [],
            });
          }
        }, offset);
      }
    });
    child.on("error", fail);
    child.on("exit", () => {
      exited = true;
      event("exit");
      cancelPending();
    });
    child.on("close", () => {
      closed = true;
      closedElapsed = Math.max(0, Math.floor(now() - begin));
      event("close");
      cancelPending();
      void finish();
    });
    for (const [kind, stream] of [
      ["stdin", child.stdin],
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ]) {
      stream?.on("error", fail);
      stream?.on("close", () => event(kind + "-close"));
      stream?.on("end", () => event(kind + "-end"));
      if (kind !== "stdin")
        stream?.on("data", (value) => {
          const b = Buffer.from(value),
            left = Math.max(0, 65536 - counts[kind]);
          counts[kind] += b.length;
          if (left) buffers[kind].push(b.subarray(0, left));
        });
    }
  });
}

async function physical(p) {
  assert(path.isAbsolute(p));
  assert((await fs.realpath(p)) === p, "SDK_WAIT_PATH");
  for (let at = p; ; at = path.dirname(at)) {
    assert(!(await fs.lstat(at)).isSymbolicLink(), "SDK_WAIT_LINK");
    if (path.dirname(at) === at) break;
  }
  return p;
}
async function held(file, cap, remaining) {
  return bounded(async () => {
    await physical(file);
    const a = await fs.lstat(file, { bigint: true });
    assert(
      a.isFile() && a.nlink === 1n && a.size <= BigInt(cap),
      "SDK_WAIT_FILE",
    );
    const fd = await fs.open(file, "r");
    let failed = false;
    try {
      const b = await fd.stat({ bigint: true });
      assert(a.dev === b.dev && a.ino === b.ino && a.size === b.size);
      const buffer = Buffer.alloc(cap + 1);
      let count = 0;
      while (count <= cap) {
        remaining();
        const n = (await fd.read(buffer, count, cap + 1 - count, null))
          .bytesRead;
        if (!n) break;
        count += n;
      }
      assert(count <= cap);
      const c = await fd.stat({ bigint: true }),
        d = await fs.lstat(file, { bigint: true });
      for (const k of [
        "dev",
        "ino",
        "size",
        "mode",
        "nlink",
        "mtimeNs",
        "ctimeNs",
        "birthtimeNs",
      ]) {
        assert(a[k] === d[k] && b[k] === c[k]);
      }
      assert(BigInt(count) === a.size);
      return buffer.subarray(0, count);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await fd.close();
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }, remaining);
}
async function save(file, value, remaining) {
  const raw = Buffer.from(JSON.stringify(value) + "\n");
  assert(raw.length <= 1024 ** 2, "SDK_WAIT_REPORT_BOUND");
  await bounded(
    () => fs.writeFile(file, raw, { flag: "wx", mode: 0o600 }),
    remaining,
  );
}
export async function cleanupOwned(
  owned,
  actorsQuiet,
  remaining,
  { io = fs, verify = physical } = {},
) {
  const rows = [];
  let first,
    failed = false;
  for (const own of owned) {
    const role = path.basename(own.location);
    if (!actorsQuiet || !own.stamp) {
      rows.push({
        role,
        removed: false,
        reason: !actorsQuiet ? "ACTORS_UNCONFIRMED" : "IDENTITY_UNCONFIRMED",
      });
      if (!failed) {
        failed = true;
        first = new Error("SDK_WAIT_CLEANUP_UNCONFIRMED");
      }
      continue;
    }
    try {
      await bounded(async () => {
        remaining();
        await verify(own.location);
        remaining();
        const now = await io.lstat(own.location, { bigint: true });
        remaining();
        assert(now.isDirectory() && !now.isSymbolicLink());
        for (const k of ["dev", "ino", "mode", "birthtimeNs", "uid", "gid"])
          assert(now[k] === own.stamp[k], "SDK_WAIT_OWNED_REPLACED");
        remaining();
        await io.rm(own.location, { recursive: true, force: false });
        remaining();
      }, remaining);
      rows.push({ role, removed: true });
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
      rows.push({ role, removed: false, reason: "CLEANUP_UNCONFIRMED" });
    }
  }
  return { rows, failed, first };
}
async function worker(root, pin, variant) {
  assert(
    process.platform === "darwin" &&
      process.arch === "x64" &&
      /^[a-f0-9]{64}$/.test(pin),
  );
  queryEnvironment(
    {
      DEVELOPER_DIR: DEVELOPER,
      SDKROOT: SDK,
      MACOSX_DEPLOYMENT_TARGET: "14.0",
    },
    variant,
    root,
  );
  assert(variant === "A", "METAL_SINGLE_QUERY_ONLY");
  const raw = await held(root + "/context.json", 16384, () => 5000);
  assert(hash(raw) === pin, "SDK_WAIT_CONTEXT");
  const c = JSON.parse(raw);
  assert(
    c.root === root &&
      c.kind === "owned-metal-query-context" &&
      c.samplerInterface?.supported === true &&
      /^[a-f0-9]{64}$/.test(c.samplerInterface.manualSha256),
    "SDK_WAIT_CONTEXT",
  );
  const remaining = () => {
    const n = Math.floor(
      Math.min(
        c.stageWallEnd - Date.now(),
        Number(BigInt(c.stageMonoEnd) - process.hrtime.bigint()) / 1e6,
        c.workerWallEnd - Date.now(),
        Number(BigInt(c.workerMonoEnd) - process.hrtime.bigint()) / 1e6,
      ),
    );
    assert(n > 0 && Number.isSafeInteger(n), "SDK_WAIT_STAGE_DEADLINE");
    return n;
  };
  assert(remaining() >= 31000, "SDK_WAIT_STAGE_ADMISSION");
  const env = queryEnvironment(c.selected, variant, root, process.env);
  const result = await query(variant, env, remaining, { sampling: true });
  // This closed summary precedes fallible persistence; never print sample text,
  // environment values or raw errors. The full bounded query remains in its file.
  console.log(
    JSON.stringify({
      kind: "owned-metal-query-observed",
      variant,
      failed: result.failed,
      primaryWasNull: result.primaryWasNull,
      failure: result.failure,
      timeoutMs: result.timeoutMs,
      elapsedMs: result.elapsedMs,
      exitCode: result.exitCode,
      signal: result.signal,
      callbackSeen: result.callbackSeen,
      closeSeen: result.closeSeen,
      stdoutObserved: result.stdout.observed,
      stdoutSha256: result.stdout.sha256,
      stderrObserved: result.stderr.observed,
      stderrSha256: result.stderr.sha256,
      sampleActorsJoined: result.sampler.joined,
    }),
  );
  try {
    await save(root + "/" + variant + "/query.json", result, remaining);
  } catch (error) {
    if (queryFailures.has(result)) throw queryFailures.get(result);
    throw error;
  }
  if (result.sampler.joined !== true) {
    if (queryFailures.has(result)) throw queryFailures.get(result);
    throw new Error("METAL_SAMPLE_JOIN_UNCONFIRMED");
  }
  console.log(
    JSON.stringify({
      variant,
      queryRecordWritten: true,
      queryFailed: result.failed,
    }),
  );
}
export async function main(e = process.env) {
  const budget = clock();
  let root,
    first,
    hasFailure = false,
    actorsQuiet = true,
    phase = "authority";
  const results = [],
    owned = [];
  const cleanup = [];
  const fail = (x) => {
    if (!hasFailure) {
      hasFailure = true;
      first = x;
    }
  };
  const watchdog = hardWatchdog(budget, {
    observe: () => ({
      actorsQuiet,
      pendingIoCount: pendingIO.size,
      primaryWasNull: hasFailure && first === null,
      hasFailure,
    }),
  });
  try {
    const event = JSON.parse(
      await held(e.GITHUB_EVENT_PATH, 131072, budget.remaining),
    );
    authority(e, event);
    phase = "input-admission";
    const profile = checkpointHost(
      "aarch64-apple-darwin",
      process.platform,
      process.arch,
    );
    assert(profile.inputs === INPUTS);
    const input = await bounded(
      () =>
        plan({
          inputs: INPUTS,
          target: profile.target,
          checkout: process.cwd(),
          runnerMode: "hosted",
        }),
      budget.remaining,
    );
    assert(identitySha256(input.sourceLock) === SOURCE, "SDK_WAIT_SOURCE");
    const map = validateRunnerMap(
      JSON.parse(
        await held(
          path.join(
            input.inputsRoot,
            "cef-ci-runner-aarch64-apple-darwin.json",
          ),
          16384,
          budget.remaining,
        ),
      ),
      profile.target,
    );
    assert(
      map.hosted.imageOS === e.ImageOS &&
        map.hosted.imageVersion === e.ImageVersion,
      "SDK_WAIT_IMAGE",
    );
    const selected = {
      DEVELOPER_DIR: DEVELOPER,
      SDKROOT: SDK,
      MACOSX_DEPLOYMENT_TARGET: "14.0",
    };
    assert(
      map.environment.DEVELOPER_DIR === "@TOOLS@" + DEVELOPER &&
        map.environment.SDKROOT === "@TOOLS@" + SDK &&
        map.environment.MACOSX_DEPLOYMENT_TARGET === "14.0",
    );
    phase = "tool-pins";
    const verified = await bounded(
      () =>
        verifyToolchainFiles({
          sourceLock: input.sourceLock,
          target: profile.target,
          inputsRoot: input.inputsRoot,
          toolsRoot: "/",
          python: "/" + map.python,
          runnerMapFromInputs: true,
        }),
      budget.remaining,
    );
    assert(verified.filesVerified === 9);
    phase = "owned-output";
    const temp = await bounded(() => physical(e.RUNNER_TEMP), budget.remaining);
    assert(temp === "/Users/runner/work/_temp");
    root = temp + "/cef-mac-sdk-wait-" + randomUUID();
    await bounded(() => fs.mkdir(root, { mode: 0o700 }), budget.remaining);
    const identity = await fs.lstat(root, { bigint: true });
    for (const name of ["A"]) {
      const location = root + "/" + name;
      const own =
        name === "home" || name === "tmp" ? { location, stamp: null } : null;
      if (own) owned.push(own);
      await bounded(
        () => fs.mkdir(location, { mode: 0o700 }),
        budget.remaining,
      );
      if (own)
        own.stamp = await bounded(
          () => fs.lstat(location, { bigint: true }),
          budget.remaining,
        );
    }
    if (e.GITHUB_OUTPUT)
      await bounded(
        () => fs.appendFile(e.GITHUB_OUTPUT, "diagnostic_root=" + root + "\n"),
        budget.remaining,
      );
    phase = "sampler-interface";
    const samplerInterface = await observeSamplerInterface(budget.remaining);
    if (interfaceFailures.has(samplerInterface))
      fail(interfaceFailures.get(samplerInterface));
    else if (!samplerInterface.supported)
      fail(new Error("METAL_SAMPLE_INTERFACE_UNAVAILABLE"));
    await save(
      root + "/selection.json",
      {
        head: e.GITHUB_SHA,
        sourceLockIdentity: SOURCE,
        filesVerified: 9,
        selected,
        samplerAvailable: samplerInterface.supported,
        parentCohortStageMs: 120000,
        queryTimeoutMs: 30000,
        workerAbsoluteMs: 35000,
        samplerInterface,
        environmentKeys: Object.keys(
          queryEnvironment(selected, "A", root, e),
        ).sort(),
      },
      budget.remaining,
    );
    if (interfaceFailures.has(samplerInterface))
      throw interfaceFailures.get(samplerInterface);
    assert(samplerInterface.supported, "METAL_SAMPLE_INTERFACE_UNAVAILABLE");
    const stageMs = Math.min(120000, budget.remaining()),
      stageWallEnd = Date.now() + stageMs,
      stageMonoEnd = String(
        process.hrtime.bigint() + BigInt(stageMs) * 1000000n,
      );
    const c = {
      kind: "owned-metal-query-context",
      root,
      selected,
      stageWallEnd,
      stageMonoEnd,
      workerWallEnd: Date.now() + 35000,
      workerMonoEnd: String(process.hrtime.bigint() + 35000000000n),
      samplerInterface: {
        supported: true,
        manualSha256: samplerInterface.manual.decodedSha256,
      },
    };
    const context = Buffer.from(JSON.stringify(c) + "\n");
    await bounded(
      () =>
        fs.writeFile(root + "/context.json", context, {
          flag: "wx",
          mode: 0o600,
        }),
      budget.remaining,
    );
    for (const variant of ["A"]) {
      const remaining = Math.floor(
        Math.min(
          budget.remaining(),
          stageWallEnd - Date.now(),
          Number(BigInt(stageMonoEnd) - process.hrtime.bigint()) / 1e6,
        ),
      );
      if (remaining < 65000) {
        results.push({
          variant,
          notRun: true,
          reason: "INSUFFICIENT_ORIGINAL_STAGE_BUDGET",
        });
        throw new Error("SDK_WAIT_STAGE_ADMISSION");
      }
      watchdog.assertActive();
      actorsQuiet = false;
      phase = "query-" + variant;
      const result = { variant, queryRetention: "NOT_READ" };
      results.push(result);
      let slice,
        sliceFailed = false,
        sliceError;
      try {
        slice = await compileSlice(
          process.execPath,
          [SELF, "--worker", root, hash(context), variant],
          {
            cwd: process.cwd(),
            env: queryEnvironment(selected, variant, root, e),
            logs: root + "/" + variant,
            milliseconds: Math.min(35000, remaining - 30000),
          },
        );
        actorsQuiet = slice.quiescent === true;
        result.supervision = {
          outcome: slice.outcome,
          exitCode: slice.exitCode,
          quiescent: slice.quiescent,
          groupId: slice.groupId,
          quiescence: slice.quiescence,
          observedCount: slice.observed.length,
          observedPrefix: slice.observed.slice(0, 32),
          observedTruncated: slice.observed.length > 32,
        };
      } catch (error) {
        sliceFailed = true;
        sliceError = error;
        fail(error);
        result.supervisionUnavailable = true;
      }
      // A rejected supervisor cannot erase an already-retained query, or make
      // its metadata prove actor quiescence. Retention uses the original clock.
      let row;
      try {
        row = JSON.parse(
          await held(
            root + "/" + variant + "/query.json",
            262144,
            sliceFailed ? budget.cleanup : budget.remaining,
          ),
        );
        assert(
          row.variant === variant &&
            row.kind === "owned-metal-query-sampling" &&
            row.queryAttempted === true &&
            typeof row.sampler?.attempted === "boolean",
          "SDK_WAIT_RETAINED_QUERY_INVALID",
        );
        result.query = row;
        result.queryRetention = "RETAINED";
      } catch (error) {
        row = undefined;
        result.queryRetention = "RETAINED_QUERY_UNAVAILABLE";
        if (!sliceFailed && slice.quiescent && slice.exitCode === 0)
          throw error;
      }
      if (sliceFailed) throw sliceError;
      assert(slice.quiescent && slice.exitCode === 0, "SDK_WAIT_WORKER_FAILED");
      assert(row, "SDK_WAIT_WORKER_FAILED");
    }
    const after = await fs.lstat(root, { bigint: true });
    assert(
      after.dev === identity.dev &&
        after.ino === identity.ino &&
        after.isDirectory(),
    );
  } catch (error) {
    fail(error);
  } finally {
    const cleaned = await cleanupOwned(
      owned,
      actorsQuiet && pendingIO.size === 0 && !watchdog.fired,
      budget.cleanup,
    );
    cleanup.push(...cleaned.rows);
    if (cleaned.failed) fail(cleaned.first);
    if (root) {
      try {
        await save(
          root + "/outcome.json",
          {
            kind: "owned-metal-query-sampling",
            complete: false,
            observationComplete:
              !hasFailure &&
              actorsQuiet &&
              pendingIO.size === 0 &&
              !watchdog.fired,
            terminalCompletionRequired: true,
            failure: hasFailure ? "SDK_WAIT_FAILED" : null,
            primaryWasNull: hasFailure && first === null,
            primaryReason: hasFailure ? primaryReason(first) : null,
            phase,
            actorsQuiet,
            pendingIoCount: pendingIO.size,
            ownedHomeTempCleanup: cleanup,
            variants: results,
            environmentCausalityProved: false,
            sourceWriteAdmitted: false,
            checkpointReady: false,
            runtimeReady: false,
            nativeAcceptance: false,
            publication: false,
          },
          budget.cleanup,
        );
      } catch (error) {
        if (!hasFailure) fail(error);
        console.error("SDK_WAIT_PERSISTENCE_UNCONFIRMED");
      }
    }
  }
  if (!watchdog.release(actorsQuiet, pendingIO.size))
    fail(new Error("SDK_WAIT_CLEANUP_UNCONFIRMED"));
  console.log(
    JSON.stringify({
      kind: "owned-metal-query-terminal",
      phase,
      complete: !hasFailure,
      rootCreated: !!root,
      primaryReason: hasFailure ? primaryReason(first) : null,
      sourceWriteAdmitted: false,
      samplerAttempted: results.some(
        (row) => row.query?.sampler?.attempted === true,
      ),
    }),
  );
  if (hasFailure) throw first;
  return { root, variants: results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 4 && args[0] === "--worker")
      await worker(args[1], args[2], args[3]);
    else {
      assert(args.length === 1 && args[0] === "--execute");
      await main();
    }
  } catch {
    console.error("SDK_WAIT_DIAGNOSTIC_FAILED");
    process.exitCode = 1;
  }
}
