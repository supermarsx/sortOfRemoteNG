import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { plan, validateRunnerMap } from "../scripts/cef-runtime-ci.mjs";
import {
  checkpointHost,
  selectedSdkEnvironment,
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
export function queryEnvironment(selected, variant, root) {
  assert(
    ["A", "B"].includes(variant) &&
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
  return {
    ...selectedSdkEnvironment(selected),
    ...(variant === "B"
      ? { HOME: root + "/home", TMPDIR: root + "/tmp/" }
      : {}),
  };
}
// The containing, reviewed compileSlice owns this worker AND all xcrun descendants.
// This function records exact execFile events; it never guesses at descendant PIDs.
export function query(
  variant,
  env,
  remaining,
  { execute = execFile, now = () => performance.now() } = {},
) {
  assert(["A", "B"].includes(variant), "SDK_WAIT_VARIANT");
  const timeout = Math.floor(Math.min(30000, remaining()));
  assert(timeout > 0, "SDK_WAIT_QUERY_DEADLINE");
  return new Promise((resolve) => {
    const begin = now();
    let child,
      first,
      hasFailure = false,
      callback = false,
      closed = false,
      exited = false;
    const events = [],
      counts = { stdout: 0, stderr: 0 },
      buffers = { stdout: [], stderr: [] };
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
    const finish = () => {
      if (!callback || !closed) return;
      resolve({
        variant,
        command: "selected-sdk-path",
        timeoutMs: timeout,
        elapsedMs: Math.max(0, Math.floor(now() - begin)),
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
        sampler: {
          attempted: false,
          reason: "NO_REVIEWED_BOUND_TARGET_AND_REPORT_LIFECYCLE",
        },
      });
    };
    try {
      child = execute(
        "/usr/bin/xcrun",
        ["-sdk", "macosx", "--show-sdk-path"],
        {
          env,
          timeout,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
          windowsHide: true,
        },
        (e) => {
          callback = true;
          if (e !== null && e !== undefined) fail(e);
          event("callback");
          finish();
        },
      );
    } catch (e) {
      fail(e);
      callback = true;
      closed = true;
      event("spawn-throw");
      finish();
      return;
    }
    child.on("spawn", () => event("spawn"));
    child.on("error", fail);
    child.on("exit", () => {
      exited = true;
      event("exit");
    });
    child.on("close", () => {
      closed = true;
      event("close");
      finish();
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
  const raw = await held(root + "/context.json", 16384, () => 5000);
  assert(hash(raw) === pin, "SDK_WAIT_CONTEXT");
  const c = JSON.parse(raw);
  assert(c.root === root && c.kind === "sdk-wait-context");
  const remaining = () => {
    const n = Math.floor(
      Math.min(
        c.stageWallEnd - Date.now(),
        Number(BigInt(c.stageMonoEnd) - process.hrtime.bigint()) / 1e6,
      ),
    );
    assert(n > 0 && Number.isSafeInteger(n), "SDK_WAIT_STAGE_DEADLINE");
    return n;
  };
  const env = queryEnvironment(c.selected, variant, root);
  const result = await query(variant, env, remaining);
  await save(root + "/" + variant + "/query.json", result, remaining);
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
    for (const name of ["home", "tmp", "A", "B"]) {
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
    await save(
      root + "/selection.json",
      {
        head: e.GITHUB_SHA,
        sourceLockIdentity: SOURCE,
        filesVerified: 9,
        selected,
        samplerAvailable: false,
      },
      budget.remaining,
    );
    if (e.GITHUB_OUTPUT)
      await bounded(
        () => fs.appendFile(e.GITHUB_OUTPUT, "diagnostic_root=" + root + "\n"),
        budget.remaining,
      );
    const stageMs = Math.min(120000, budget.remaining()),
      stageWallEnd = Date.now() + stageMs,
      stageMonoEnd = String(
        process.hrtime.bigint() + BigInt(stageMs) * 1000000n,
      );
    const c = {
      kind: "sdk-wait-context",
      root,
      selected,
      stageWallEnd,
      stageMonoEnd,
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
    for (const variant of ["A", "B"]) {
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
      const slice = await compileSlice(
        process.execPath,
        [SELF, "--worker", root, hash(context), variant],
        {
          cwd: process.cwd(),
          env: queryEnvironment(selected, variant, root),
          logs: root + "/" + variant,
          milliseconds: Math.min(35000, remaining - 30000),
        },
      );
      actorsQuiet = slice.quiescent === true;
      results.push({
        variant,
        supervision: {
          outcome: slice.outcome,
          exitCode: slice.exitCode,
          quiescent: slice.quiescent,
          groupId: slice.groupId,
          quiescence: slice.quiescence,
          observedCount: slice.observed.length,
          observedPrefix: slice.observed.slice(0, 32),
          observedTruncated: slice.observed.length > 32,
        },
      });
      assert(slice.quiescent && slice.exitCode === 0, "SDK_WAIT_WORKER_FAILED");
      const row = JSON.parse(
        await held(
          root + "/" + variant + "/query.json",
          262144,
          budget.remaining,
        ),
      );
      assert(row.variant === variant);
      results.at(-1).query = row;
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
            kind: "sdk-wait-diagnostic",
            complete: false,
            observationComplete:
              !hasFailure &&
              actorsQuiet &&
              pendingIO.size === 0 &&
              !watchdog.fired,
            terminalCompletionRequired: true,
            failure: hasFailure ? "SDK_WAIT_FAILED" : null,
            primaryWasNull: hasFailure && first === null,
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
      kind: "sdk-wait-terminal",
      phase,
      complete: !hasFailure,
      rootCreated: !!root,
      sourceWriteAdmitted: false,
      samplerAttempted: false,
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
