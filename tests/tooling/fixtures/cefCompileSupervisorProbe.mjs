// Diagnostic branch only. Synthetic processes never confer CEF/SDK authority.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const PROBE_BRANCH =
  "refs/heads/codex/ci-macos-supervisor-probe-20261025";
export const PROBE_LIMITS = Object.freeze({
  workMs: 120000,
  cleanupMs: 30000,
  rootMs: 90000,
  children: 4,
  launches: 32,
  childMs: 3000,
  allocationBytes: 16 * 1024 ** 2,
  oldSpaceMiB: 64,
  fileBytes: 1024 ** 2,
  artifactBytes: 3 * 1024 ** 2,
});
export const PROBE_FILES = Object.freeze([
  "probe-plan.json",
  "probe-result.json",
  "compile-supervision.log",
  "checkpoint-compile.stdout.log",
  "checkpoint-compile.stderr.log",
  "checkpoint-compile.outcome.json",
]);
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HELPER = path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs");
const encode = (value) => JSON.stringify(value) + "\n";
const safeString = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !/[\x00-\x1f\x7f]/.test(value);

export function probeAuthority(value) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      "repository",
      "repositoryId",
      "event",
      "visibility",
      "ref",
      "diagnostic",
      "head",
    ].sort(),
  );
  assert.equal(value.repository, "supermarsx/sortOfRemoteNG");
  assert.equal(value.repositoryId, "1010282954");
  assert.equal(value.event, "workflow_dispatch");
  assert.equal(value.visibility, "public");
  assert.equal(value.ref, PROBE_BRANCH);
  assert.equal(value.diagnostic, "synthetic-process-only");
  assert(/^[a-f0-9]{40}$/.test(value.head));
  return value.head;
}

export function probeEnvironment(executable, temp) {
  assert(safeString(executable) && path.isAbsolute(executable));
  assert(safeString(temp) && path.isAbsolute(temp));
  return {
    PATH: [path.dirname(executable), "/usr/bin", "/bin"].join(path.delimiter),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    TMPDIR: temp,
  };
}

export function workerArguments(script, ordinal) {
  assert(safeString(script) && path.isAbsolute(script));
  assert(
    Number.isSafeInteger(ordinal) &&
      ordinal >= 0 &&
      ordinal < PROBE_LIMITS.launches,
  );
  return ["--max-old-space-size=64", script, "--worker", String(ordinal)];
}

export function probeMode(args) {
  assert(Array.isArray(args));
  if (args.length === 0) return "driver";
  if (args.length === 1 && args[0] === "--root") return "root";
  if (
    args.length === 2 &&
    args[0] === "--worker" &&
    /^(0|[1-9][0-9]*)$/.test(args[1]) &&
    Number(args[1]) < PROBE_LIMITS.launches
  )
    return "worker";
  throw new Error("SYNTHETIC_PROBE_ARGUMENTS_DENIED");
}

export async function runSyntheticRoot({
  spawnChild = spawn,
  now = () => performance.now(),
  wait = delay,
  temp = process.env.TMPDIR,
} = {}) {
  const end = now() + PROBE_LIMITS.rootMs;
  const live = new Set();
  let launched = 0,
    closed = 0,
    peak = 0,
    failed = false;
  while (now() < end || live.size > 0) {
    while (
      !failed &&
      now() < end &&
      live.size < PROBE_LIMITS.children &&
      launched < PROBE_LIMITS.launches
    ) {
      const child = spawnChild(
        process.execPath,
        workerArguments(SCRIPT, launched),
        {
          shell: false,
          detached: false,
          env: probeEnvironment(process.execPath, temp),
          stdio: "ignore",
        },
      );
      launched++;
      live.add(child);
      peak = Math.max(peak, live.size);
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (code) => {
        live.delete(child);
        closed++;
        if (code !== 0) failed = true;
      });
    }
    if (failed && live.size === 0) break;
    await wait(25);
  }
  assert(
    !failed &&
      launched === PROBE_LIMITS.launches &&
      closed === launched &&
      live.size === 0,
  );
  return { launched, closed, peakLive: peak, allChildrenClosed: true };
}

async function runWorker() {
  const bytes = new Uint8Array(PROBE_LIMITS.allocationBytes);
  const end = performance.now() + PROBE_LIMITS.childMs;
  let sum = 0;
  while (performance.now() < end) {
    const turn = Math.min(end, performance.now() + 25);
    while (performance.now() < turn) {
      sum = (sum + 1) >>> 0;
      bytes[sum % bytes.length] ^= sum & 255;
    }
    await delay(25);
  }
  assert.equal(bytes.length, PROBE_LIMITS.allocationBytes);
}

async function noLinks(file) {
  assert(safeString(file) && path.isAbsolute(file));
  let current = path.parse(file).root;
  for (const segment of file
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    assert(segment !== "." && segment !== "..");
    current = path.join(current, segment);
    assert(!(await lstat(current)).isSymbolicLink());
  }
  assert.equal(await realpath(file), file);
  return file;
}

async function filePin(file, maximum) {
  await noLinks(file);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    assert(
      before.isFile() && before.nlink >= 1n && before.size <= BigInt(maximum),
    );
    const hash = createHash("sha256"),
      chunk = Buffer.alloc(1024 ** 2);
    let count = 0;
    for (;;) {
      const read = await fd.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
      assert(count <= maximum);
      hash.update(chunk.subarray(0, read.bytesRead));
    }
    const after = await fd.stat({ bigint: true }),
      current = await lstat(file, { bigint: true });
    const identity = (row) =>
      [
        row.dev,
        row.ino,
        row.mode,
        row.uid,
        row.gid,
        row.nlink,
        row.size,
        row.mtimeNs,
        row.ctimeNs,
      ].map(String);
    assert.deepEqual(identity(before), identity(after));
    assert.deepEqual(identity(before), identity(current));
    assert.equal(BigInt(count), before.size);
    return {
      size: count,
      sha256: hash.digest("hex"),
      identity: identity(before),
    };
  } finally {
    await fd.close();
  }
}

async function writeOwn(root, name, value) {
  assert(PROBE_FILES.includes(name));
  const raw = typeof value === "string" ? value : encode(value);
  assert(Buffer.byteLength(raw) <= PROBE_LIMITS.fileBytes);
  await writeFile(path.join(root, name), raw, { flag: "wx", mode: 0o600 });
}

async function artifactPins(root) {
  let total = 0;
  const rows = [];
  for (const name of PROBE_FILES) {
    const file = path.join(root, name);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
    const pin = await filePin(file, PROBE_LIMITS.fileBytes);
    total += pin.size;
    assert(total <= PROBE_LIMITS.artifactBytes);
    rows.push({ name, size: pin.size, sha256: pin.sha256 });
  }
  return rows;
}

async function runDriver() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v24.19.0");
  const head = probeAuthority({
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    event: process.env.GITHUB_EVENT_NAME,
    visibility: process.env.PROBE_VISIBILITY,
    ref: process.env.GITHUB_REF,
    diagnostic: process.env.PROBE_DIAGNOSTIC,
    head: process.env.GITHUB_SHA,
  });
  for (const name of ["PROBE_EXPECTED_SCRIPT_SHA", "PROBE_EXPECTED_HELPER_SHA"])
    assert(/^[a-f0-9]{64}$/.test(process.env[name] ?? ""));
  process.umask(0o077);
  const parent = await realpath(process.env.RUNNER_TEMP);
  await noLinks(parent);
  const root = await mkdtemp(path.join(parent, "sorng-supervisor-probe-"));
  await noLinks(root);
  const rootInfo = await lstat(root);
  assert(
    rootInfo.isDirectory() &&
      rootInfo.uid === process.getuid() &&
      (rootInfo.mode & 0o777) === 0o700,
  );
  await appendFile(process.env.GITHUB_OUTPUT, `artifact_root=${root}\n`);
  let primary,
    failed = false,
    retentionFailed = false,
    result = null,
    inputs = null,
    counts = null;
  const beganWall = Date.now(),
    beganMono = performance.now(),
    diagnostics = [];
  const originalLogger = console.error;
  try {
    const script = await filePin(SCRIPT, 256 * 1024),
      helper = await filePin(HELPER, 256 * 1024),
      executable = await filePin(
        await realpath(process.execPath),
        256 * 1024 ** 2,
      );
    assert.equal(script.sha256, process.env.PROBE_EXPECTED_SCRIPT_SHA);
    assert.equal(helper.sha256, process.env.PROBE_EXPECTED_HELPER_SHA);
    const git = await promisify(execFile)(
      "/usr/bin/git",
      [
        "--no-pager",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-C",
        ROOT,
        "rev-parse",
        "HEAD",
      ],
      {
        env: {
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_LAZY_FETCH: "1",
        },
        timeout: 5000,
        maxBuffer: 4096,
      },
    );
    assert.equal(git.stdout.trim(), head);
    inputs = {
      head,
      script,
      helper,
      executable,
      executablePinQualification:
        "Observed selected setup-node executable, not a pre-pinned CEF toolchain",
    };
    const temp = path.join(root, "tmp"),
      out = path.join(root, "out");
    await mkdir(temp, { mode: 0o700 });
    await mkdir(out, { mode: 0o700 });
    await writeOwn(root, "probe-plan.json", {
      syntheticProcessOnly: true,
      inputs,
      limits: PROBE_LIMITS,
      qualification:
        "V8 old-space and synthetic allocation bounds are not an OS RSS cap; no CEF/SDK proof",
    });
    // Import only after exact workflow-reviewed helper/script hashes and Git head.
    const { compileSlice } = await import(pathToFileURL(HELPER));
    console.error = (line) => {
      if (
        typeof line !== "string" ||
        !line.startsWith("[cef-engineering-checkpoint] compile-supervision=") ||
        Buffer.byteLength(line) > 8192 ||
        diagnostics.length >= 4
      ) {
        retentionFailed = true;
        return;
      }
      diagnostics.push(line);
    };
    result = await compileSlice(
      process.execPath,
      ["--max-old-space-size=64", SCRIPT, "--root"],
      {
        cwd: root,
        env: probeEnvironment(process.execPath, temp),
        logs: root,
        out,
        milliseconds: PROBE_LIMITS.workMs,
      },
    );
    assert.equal(result.outcome, "compiler-complete");
    assert.equal(result.exitCode, 0);
    assert.equal(result.quiescent, true);
    const output = await readFile(
      path.join(root, "checkpoint-compile.stdout.log"),
      "utf8",
    );
    assert(Buffer.byteLength(output) <= PROBE_LIMITS.fileBytes);
    counts = JSON.parse(output.trim());
    assert.deepEqual(
      Object.keys(counts).sort(),
      ["allChildrenClosed", "closed", "kind", "launched", "peakLive"].sort(),
    );
    assert.equal(counts.kind, "synthetic-root-result");
    assert.equal(counts.launched, PROBE_LIMITS.launches);
    assert.equal(counts.closed, counts.launched);
    assert.equal(counts.allChildrenClosed, true);
    assert(
      Number.isSafeInteger(counts.peakLive) &&
        counts.peakLive > 0 &&
        counts.peakLive <= PROBE_LIMITS.children,
    );
    assert.deepEqual(await filePin(SCRIPT, 256 * 1024), script);
    assert.deepEqual(await filePin(HELPER, 256 * 1024), helper);
    assert.deepEqual(
      await filePin(await realpath(process.execPath), 256 * 1024 ** 2),
      executable,
    );
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    console.error = originalLogger;
    try {
      await writeOwn(
        root,
        "compile-supervision.log",
        diagnostics.join("\n") + "\n",
      );
    } catch {
      retentionFailed = true;
    }
    const facts = {
      syntheticProcessOnly: true,
      sourceAccepted: false,
      sdkProduced: false,
      head,
      inputs,
      counts,
      supervisorSucceeded: !failed && !retentionFailed,
      artifactCollectionComplete: false,
      originalFailurePresent: failed,
      originalFailureWasNull: failed && primary === null,
      failure: failed ? "SYNTHETIC_SUPERVISOR_FAILED" : "NONE",
      retentionFailed,
      outcome:
        result?.outcome === "compiler-complete"
          ? "synthetic-process-complete"
          : "unconfirmed",
      observedProcesses: result?.observed?.length ?? null,
      quiescent: result?.quiescent === true,
      beganWallMs: beganWall,
      endWallMs: Date.now(),
      beganMonotonicMs: beganMono,
      endMonotonicMs: performance.now(),
      workMs: PROBE_LIMITS.workMs,
      cleanupMs: PROBE_LIMITS.cleanupMs,
    };
    try {
      await writeOwn(root, "probe-result.json", facts);
      const artifacts = await artifactPins(root);
      assert(artifacts.some((row) => row.name === "probe-result.json"));
      if (!failed)
        assert.deepEqual(
          artifacts.map((row) => row.name),
          [...PROBE_FILES],
        );
      await appendFile(process.env.GITHUB_OUTPUT, "artifact_ready=true\n");
    } catch {
      retentionFailed = true;
    }
  }
  if (failed) throw primary;
  if (retentionFailed) throw new Error("SYNTHETIC_SUPERVISOR_FAILED");
}

const main = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT;
if (main) {
  Promise.resolve()
    .then(() => {
      const mode = probeMode(process.argv.slice(2));
      const task =
        mode === "driver"
          ? runDriver
          : mode === "root"
            ? async () => {
                console.log(
                  encode({
                    kind: "synthetic-root-result",
                    ...(await runSyntheticRoot()),
                  }).trim(),
                );
              }
            : runWorker;
      return task();
    })
    .catch(() => {
      console.error("SYNTHETIC_SUPERVISOR_FAILED");
      process.exitCode = 1;
    });
}
