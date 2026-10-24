// Engineering checkpoints never confer runtime or SDK admission.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";

export const LIMITS = Object.freeze({
  compressed: 32 * 1024 ** 3,
  chunk: 1024 ** 3,
  metadata: 128 * 1024 ** 2,
  seal: 1024 ** 2,
  archiveMs: 600_000,
  compileMs: 15 * 60_000,
  maxCompileMs: 180 * 60_000,
  hostMs: 300 * 60_000,
});
export const INPUTS =
  "native/cef-build-inputs/20261024-registration-retirement-lf-macintel-sdk26-2-capture-compat";
export const TARGET = "x86_64-apple-darwin";
export const SOURCE_ID =
  "c7bb8b0e4a4c8ba61fffe095c2d4466e45ddc6e762c9fcd3028f49909f9c1c8f";
// Closed exact account IDs observed in https://api.github.com/meta
// domains.actions on 2026-10-24. This is not an Azure host wildcard.
const GITHUB_BLOB_IDS = new Set([
  ...Array.from({ length: 20 }, (_, i) => i),
  ...Array.from({ length: 20 }, (_, i) => 30 + i),
  ...Array.from({ length: 100 }, (_, i) => 100 + i),
]);
export function downloadHost(host) {
  if (
    [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(host)
  )
    return true;
  const match =
    /^productionresultssa(0|[1-9][0-9]*)\.blob\.core\.windows\.net$/.exec(host);
  return Boolean(match && GITHUB_BLOB_IDS.has(Number(match[1])));
}
export const WORKFLOW = ".github/workflows/cef-engineering-checkpoint.yml";
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function shape(value, keys) {
  assert(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Invalid checkpoint object shape",
  );
}
export function authority(env) {
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "Public hosted manual checkpoint only",
  );
  assert(
    env.CEF_DEFAULT_BRANCH &&
      env.GITHUB_REF === `refs/heads/${env.CEF_DEFAULT_BRANCH}`,
    "Default branch checkpoint only",
  );
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? "") &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""),
    "Invalid repository or head",
  );
  assert(
    /^[1-9][0-9]*$/.test(env.GITHUB_REPOSITORY_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "Invalid producer identity",
  );
  assert(
    env.GITHUB_WORKFLOW_REF ===
      `${env.GITHUB_REPOSITORY}/${WORKFLOW}@refs/heads/${env.CEF_DEFAULT_BRANCH}`,
    "Exact checkpoint workflow required",
  );
  return {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    head: env.GITHUB_SHA,
    branch: env.CEF_DEFAULT_BRANCH,
    workflow: WORKFLOW,
  };
}
export function codeTreeDigest(entries) {
  assert(
    Array.isArray(entries) && entries.length <= 100000,
    "Producer tree bound",
  );
  const selected = entries
    .filter((row) => row.type !== "tree")
    .filter(
      (row) =>
        row.path.startsWith("scripts/") ||
        row.path === WORKFLOW ||
        row.path === "native/cef-hosted-recipe.json" ||
        row.path === ".node-version",
    )
    .map((row) => {
      assert(
        row.type === "blob" &&
          ["100644", "100755"].includes(row.mode) &&
          /^[a-f0-9]{40}$/.test(row.sha) &&
          !row.path.includes("..") &&
          !row.path.includes("\\"),
        "Producer source tree",
      );
      return { path: row.path, mode: row.mode, sha: row.sha };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assert(
    selected.length > 0 &&
      selected.length < 2048 &&
      selected.some((row) => row.path === WORKFLOW) &&
      selected.some(
        (row) => row.path === "scripts/lib/cef-checkpoint-archive.py",
      ),
    "Complete committed producer source required",
  );
  return sha(canonical(selected));
}
async function verifyProducerCode(api, producer, expected) {
  const commit = await api(`git/commits/${producer.head}`);
  assert(
    commit.sha === producer.head &&
      /^[a-f0-9]{40}$/.test(commit.tree?.sha ?? ""),
    "Producer commit tree",
  );
  const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
  assert(
    tree.sha === commit.tree.sha &&
      tree.truncated === false &&
      codeTreeDigest(tree.tree) === expected,
    "Producer code differs from sealed checkpoint",
  );
}
export const SLICES = Object.freeze([15, 30, 60, 120, 180]);
export function executionOptions(mode = "checkpoint", minutes = "15") {
  assert(
    ["checkpoint", "complete-sdk"].includes(mode) &&
      /^[0-9]+$/.test(String(minutes)) &&
      String(Number(minutes)) === String(minutes) &&
      SLICES.includes(Number(minutes)),
    "Closed engineering mode/slice required",
  );
  return {
    mode,
    minutes: Number(minutes),
    milliseconds: Number(minutes) * 60_000,
  };
}
export function hostRemaining(env, now = Date.now()) {
  const start = Number(env.CEF_ENGINEERING_JOB_STARTED_MS);
  assert(
    Number.isSafeInteger(start) &&
      start > 0 &&
      now >= start &&
      now - start < LIMITS.hostMs,
    "Engineering host clock required",
  );
  return LIMITS.hostMs - (now - start);
}
export function sliceBudget(options, remaining) {
  const reserve = options.mode === "complete-sdk" ? 60 * 60_000 : 40 * 60_000;
  assert(
    Number.isSafeInteger(remaining) &&
      remaining > 0 &&
      options.milliseconds + reserve <= remaining,
    "Requested slice leaves insufficient packaging/transfer reserve",
  );
  return options.milliseconds; // Never silently shorten/retry a selected slice.
}
export function validateIdentity(value) {
  shape(value, [
    "target",
    "source",
    "producer",
    "canonicalRoot",
    "image",
    "tools",
    "graph",
    "siso",
  ]);
  assert(
    value.target === TARGET &&
      value.source === SOURCE_ID &&
      hex(value.producer),
    "Unreviewed checkpoint source",
  );
  assert(
    typeof value.canonicalRoot === "string" &&
      path.isAbsolute(value.canonicalRoot) &&
      !/[\s\x00-\x1f]/.test(value.canonicalRoot),
    "Canonical checkpoint path required",
  );
  assert(
    typeof value.image === "string" &&
      /^[A-Za-z0-9_.-]{1,128}$/.test(value.image) &&
      hex(value.tools) &&
      hex(value.graph) &&
      hex(value.siso),
    "Exact tool/image/graph pins required",
  );
  return sha(canonical(value));
}
export async function noLinks(file) {
  const absolute = path.resolve(file);
  for (let current = absolute; ; current = path.dirname(current)) {
    const s = await lstat(current);
    assert(!s.isSymbolicLink(), "Checkpoint links are not admitted");
    if (current === path.dirname(current)) break;
  }
  assert((await realpath(absolute)) === absolute, "Checkpoint path alias");
  return absolute;
}
export async function workspace(temp, identity) {
  assert(hex(identity), "Invalid source identity");
  const base = await noLinks(temp);
  const root = path.join(base, "sorng-cef-engineering", TARGET, identity);
  assert(!root.includes(" "), "Space-free engineering root required");
  await mkdir(path.dirname(root), { recursive: true });
  await noLinks(path.dirname(root));
  await mkdir(root); // Never reuse a stale or foreign local workspace.
  return root;
}
export async function filePin(file, maximum) {
  await noLinks(file);
  const s = await stat(file);
  assert(
    s.isFile() && s.size > 0 && s.size <= maximum,
    "Checkpoint asset size",
  );
  const hash = createHash("sha256");
  for await (const block of createReadStream(file)) hash.update(block);
  const after = await stat(file);
  assert(
    s.size === after.size && s.mtimeMs === after.mtimeMs && s.ino === after.ino,
    "Checkpoint asset changed",
  );
  return {
    name: path.basename(file),
    bytes: s.size,
    sha256: hash.digest("hex"),
  };
}
function pin(value, maximum) {
  shape(value, ["name", "bytes", "sha256"]);
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(value.name) &&
      positive(value.bytes) &&
      value.bytes <= maximum &&
      hex(value.sha256),
    "Invalid checkpoint asset pin",
  );
}
export function validateCompile(value) {
  shape(value, [
    "outcome",
    "exitCode",
    "quiescent",
    "groupId",
    "quiescence",
    "observed",
  ]);
  assert(
    ["slice-ended", "compiler-failed", "compiler-complete"].includes(
      value.outcome,
    ) &&
      (value.exitCode === null || Number.isInteger(value.exitCode)) &&
      value.quiescent === true &&
      positive(value.groupId),
    "Compiler outcome/quiescence required",
  );
  assert(
    value.quiescence === "observed-lineage-and-root-group" &&
      Array.isArray(value.observed) &&
      value.observed.length > 0 &&
      value.observed.length <= 4096,
    "Bounded observed lineage required",
  );
  const pids = new Set();
  for (const row of value.observed) {
    shape(row, ["pid", "start"]);
    assert(
      positive(row.pid) &&
        !pids.has(row.pid) &&
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/.test(
          row.start,
        ),
      "Invalid observed process",
    );
    pids.add(row.pid);
  }
  assert(pids.has(value.groupId), "Observed root missing");
  return value;
}
export function validateManifest(value, expectedIdentity) {
  shape(value, [
    "schemaVersion",
    "kind",
    "identity",
    "identitySha256",
    "producer",
    "archive",
    "compile",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-engineering-checkpoint" &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "Checkpoint is not a runtime",
  );
  const identity = validateIdentity(value.identity);
  assert(
    identity === value.identitySha256 &&
      (!expectedIdentity || identity === expectedIdentity),
    "Checkpoint identity mismatch",
  );
  const a = value.archive;
  shape(a, [
    "complete",
    "chunks",
    "inventory",
    "rawBytes",
    "compressedBytes",
    "entries",
    "linksIncluded",
  ]);
  assert(
    a.complete === true &&
      a.linksIncluded === false &&
      Array.isArray(a.chunks) &&
      a.chunks.length > 0 &&
      a.chunks.length <= 32,
    "Incomplete checkpoint archive",
  );
  let bytes = 0;
  a.chunks.forEach((row, i) => {
    pin(row, LIMITS.chunk);
    assert(
      row.name === `checkpoint-${String(i).padStart(5, "0")}.bin`,
      "Unexpected chunk name",
    );
    bytes += row.bytes;
  });
  pin(a.inventory, LIMITS.metadata);
  assert(
    a.inventory.name === "inventory.json" &&
      bytes <= LIMITS.compressed &&
      a.compressedBytes === bytes &&
      positive(a.rawBytes) &&
      a.rawBytes <= 256 * 1024 ** 3 &&
      positive(a.entries) &&
      a.entries <= 300000,
    "Checkpoint bounds",
  );
  validateCompile(value.compile);
  shape(value.producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  assert(
    value.producer.workflow === WORKFLOW &&
      /^[a-f0-9]{40}$/.test(value.producer.head) &&
      positive(value.producer.repositoryId) &&
      positive(value.producer.runId) &&
      positive(value.producer.attempt),
    "Producer binding",
  );
  return value;
}
export async function archiveCommand(
  python,
  helper,
  args,
  { timeout = LIMITS.archiveMs } = {},
) {
  assert(
    path.isAbsolute(python) &&
      path.isAbsolute(helper) &&
      positive(timeout) &&
      timeout <= LIMITS.archiveMs,
    "Verified archive tool required",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", "-B", helper, ...args], {
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { PATH: path.dirname(python) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      overflow = false;
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.length > LIMITS.seal) {
        overflow = true;
        void stopGroup(child);
      }
    });
    child.stderr.resume();
    const timer = setTimeout(() => {
      void stopGroup(child).then(
        () => reject(new Error("Archive deadline; partial is not admitted")),
        reject,
      );
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || overflow)
        return reject(new Error("Checkpoint archive rejected"));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Malformed archive result"));
      }
    });
  });
}
export async function groupQuiet(
  pid,
  {
    kill = process.kill,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  for (let i = 0; i < 50; i++) {
    try {
      kill(-pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
    await wait(100);
  }
  return false;
}
async function stopGroup(child) {
  assert(
    process.platform !== "win32" && positive(child.pid),
    "Owned Unix process group required",
  );
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (signal === "SIGTERM") await new Promise((r) => setTimeout(r, 250));
  }
  assert(
    await groupQuiet(child.pid),
    "Compiler descendants remain; checkpoint denied",
  );
}
export function processRows(text) {
  assert(
    typeof text === "string" && text.length <= 4 * 1024 ** 2,
    "Ownership snapshot bound",
  );
  const rows = [],
    ids = new Set();
  for (const line of text.trim().split("\n")) {
    const match = /^\s*([0-9]+)\s+([0-9]+)\s+(.+?)\s*$/.exec(line);
    assert(match, "Malformed ownership snapshot");
    const row = {
      pid: Number(match[1]),
      parent: Number(match[2]),
      start: match[3].replace(/\s+/g, " "),
    };
    assert(
      positive(row.pid) &&
        Number.isSafeInteger(row.parent) &&
        row.parent >= 0 &&
        !ids.has(row.pid) &&
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/.test(
          row.start,
        ),
      "Ambiguous process ownership",
    );
    ids.add(row.pid);
    rows.push(row);
    assert(rows.length <= 32768, "Ownership process bound");
  }
  return rows;
}
async function processSnapshot() {
  return new Promise((resolve, reject) => {
    const ps = spawn("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
      shell: false,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let text = "",
      overflow = false;
    const timer = setTimeout(() => {
      ps.kill("SIGKILL");
      reject(new Error("Ownership snapshot deadline"));
    }, 2000);
    ps.stdout.on("data", (data) => {
      text += data;
      if (text.length > 4 * 1024 ** 2) {
        overflow = true;
        ps.kill("SIGKILL");
      }
    });
    ps.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    ps.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || overflow)
        return reject(new Error("Ownership snapshot failed"));
      try {
        resolve(processRows(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}
export function observedLineage(rows, owned) {
  assert(
    owned.length > 0 && owned.length <= 4096,
    "Bounded original root identity required",
  );
  const root = owned[0];
  const current = new Map(rows.map((row) => [row.pid, row]));
  const found = new Map(owned.map((row) => [row.pid, { ...row }]));
  const replaced = new Set();
  for (const record of owned) {
    const row = current.get(record.pid);
    if (row && row.start !== record.start) {
      assert(record.pid !== root.pid, "Owned root PID identity changed");
      // It is no longer our observed process. Do not adopt or signal the new
      // occupant, even if its current parent happens to be in our cohort.
      found.delete(record.pid);
      replaced.add(record.pid);
    }
  }
  // Discover before retiring absent ancestors: a non-atomic ps snapshot may
  // still report their children. Already observed detached children retain
  // their own exact identity even after reparenting. This is observed lineage,
  // never a universal fork/daemon tracking guarantee.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (
        !replaced.has(row.pid) &&
        !found.has(row.pid) &&
        found.has(row.parent)
      ) {
        found.set(row.pid, { pid: row.pid, start: row.start });
        changed = true;
      }
  }
  const active = [...found.values()].filter(
    (record) =>
      record.pid === root.pid ||
      current.get(record.pid)?.start === record.start,
  );
  assert(active.length <= 4096, "Observed active descendant bound");
  return active;
}
export function sameObservedCohort(left, right) {
  const key = (rows) =>
    canonical(
      rows
        .map(({ pid, start }) => ({ pid, start }))
        .sort((a, b) => a.pid - b.pid),
    );
  return key(left) === key(right);
}
export async function observedQuiet(records, group) {
  const rows = await processSnapshot();
  // A reused foreign PID is never signalled and is not our old process.
  if (
    records.some((record) =>
      rows.some((row) => row.pid === record.pid && row.start === record.start),
    )
  )
    return false;
  return groupQuiet(group);
}
async function stopObserved(child, initial) {
  let owned = initial,
    stable = false;
  const deadline = Date.now() + 10000;
  // Freeze the observed lineage before killing it, including children that
  // created separate process groups. No global executable-name selection.
  for (let round = 0; round < 8; round++) {
    assert(Date.now() < deadline, "Owned freeze deadline");
    const rows = await processSnapshot();
    const next = observedLineage(rows, owned);
    for (const record of next) {
      const current = rows.find((row) => row.pid === record.pid);
      if (!current) continue;
      assert(current.start === record.start, "Ambiguous owned process");
      try {
        process.kill(record.pid, "SIGSTOP");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (round > 0 && sameObservedCohort(next, owned)) {
      owned = next;
      stable = true;
      break;
    }
    owned = next;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(stable, "Observed lineage did not stabilize");
  const snapshot = await processSnapshot();
  for (const record of [...owned].reverse()) {
    const current = snapshot.find((row) => row.pid === record.pid);
    if (!current) continue;
    assert(current.start === record.start, "Owned PID replaced before reap");
    try {
      process.kill(record.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  // Never send a group kill after its leader exited: a reused group could
  // belong to someone else. Remaining group peers make the proof fail closed.
  for (let i = 0; i < 50; i++) {
    if (await observedQuiet(owned, child.pid)) return owned;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Observed descendants not reaped; checkpoint denied");
}
export async function compileSlice(
  executable,
  args,
  { cwd, env, logs, milliseconds = LIMITS.compileMs },
) {
  assert(
    process.platform !== "win32" &&
      positive(milliseconds) &&
      milliseconds <= LIMITS.maxCompileMs,
    "Bounded Unix engineering slice only",
  );
  for (const key of Object.keys(env))
    assert(
      !/^(GH_|GITHUB_|ACTIONS_)/i.test(key),
      "Compiler credential environment denied",
    );
  const stdout = createWriteStream(
      path.join(logs, "checkpoint-compile.stdout.log"),
      { flags: "wx" },
    ),
    stderr = createWriteStream(
      path.join(logs, "checkpoint-compile.stderr.log"),
      { flags: "wx" },
    );
  const child = spawn(executable, args, {
    cwd,
    env,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  closed.catch(() => {});
  let timedOut = false,
    timer,
    stopping,
    monitoring = true,
    monitorFailure = null,
    observed = [],
    monitor = Promise.resolve();
  const initial = processSnapshot().then((rows) => {
    const root = rows.find((row) => row.pid === child.pid);
    assert(
      root && root.parent === process.pid,
      "Exact live child ownership required",
    );
    observed = observedLineage(rows, [{ pid: root.pid, start: root.start }]);
  });
  initial.catch(() => {});
  const endObservation = async () => {
    monitoring = false;
    await monitor;
    assert(
      !monitorFailure,
      "Periodic ownership snapshot failed; checkpoint denied",
    );
  };
  timer = setTimeout(() => {
    timedOut = true;
    stopping = (async () => {
      await initial;
      await endObservation();
      return stopObserved(child, observed);
    })();
    stopping.catch(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
  }, milliseconds);
  try {
    await initial;
    // Bound to four snapshots/second for the explicitly selected slice. This records
    // observed lineage, not universal fork/daemon tracking; ambiguity denies.
    monitor = (async () => {
      for (
        let turn = 0;
        monitoring && child.exitCode === null && child.signalCode === null;
        turn++
      ) {
        assert(
          turn < Math.ceil(milliseconds / 250) + 8,
          "Ownership observation bound",
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!monitoring) break;
        const rows = await processSnapshot();
        observed = observedLineage(rows, observed);
      }
    })().catch((error) => {
      monitorFailure = error;
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const code = await closed;
    clearTimeout(timer);
    await endObservation();
    if (stopping) observed = await stopping;
    const quiet = await observedQuiet(observed, child.pid);
    if (!quiet) {
      // A natural root exit is not evidence that a later detached writer ended.
      // Reap the observed cohort, but never label its interrupted output safe.
      await stopObserved(child, observed);
      await writeFile(
        path.join(logs, "checkpoint-compile.outcome.json"),
        canonical({
          outcome: "unsafe-natural-exit-descendants",
          exitCode: code,
          ownTimerExpired: timedOut,
          checkpointAllowed: false,
        }) + "\n",
        { flag: "wx" },
      );
      throw new Error(
        "Observed descendants survived compiler exit; checkpoint denied",
      );
    }
    const outcome = timedOut
      ? "slice-ended"
      : code === 0
        ? "compiler-complete"
        : "compiler-failed";
    await writeFile(
      path.join(logs, "checkpoint-compile.outcome.json"),
      canonical({
        outcome,
        exitCode: code,
        ownTimerExpired: timedOut,
        observedProcesses: observed.length,
        quiescence: "observed-lineage-and-root-group",
      }) + "\n",
      { flag: "wx" },
    );
    return {
      outcome,
      exitCode: code,
      quiescent: true,
      groupId: child.pid,
      quiescence: "observed-lineage-and-root-group",
      observed,
    };
  } finally {
    clearTimeout(timer);
    monitoring = false;
    await monitor;
    if (child.exitCode === null && child.signalCode === null)
      await stopGroup(child);
    stdout.end();
    stderr.end();
    await Promise.all([finished(stdout), finished(stderr)]);
  }
}
export function apiClient(
  repository,
  token,
  request = fetch,
  { readOnly = false, milliseconds = 20 * 60_000, sdk = false } = {},
) {
  const deadline = Date.now() + milliseconds;
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
      typeof token === "string" &&
      token.length > 0,
    "Scoped GitHub credential required",
  );
  return async (
    route,
    { method = "GET", body, raw = false, upload = false, bodyBytes } = {},
  ) => {
    assert(
      !readOnly || (method === "GET" && !upload && !body),
      "Restore API is GET-only",
    );
    assert(Date.now() < deadline, "Checkpoint transport deadline");
    const readRoute =
      /^(?:|actions\/workflows\/cef-engineering-checkpoint\.yml|actions\/runs\/[1-9][0-9]*(?:\/artifacts\?per_page=100)?|releases\/[1-9][0-9]*(?:\/assets\?per_page=100)?|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/;
    const uploadRoute =
      /^releases\/[1-9][0-9]*\/assets\?name=(?:checkpoint-[0-9]{5}\.bin|inventory\.json|manifest\.json)$/;
    assert(
      (method === "GET" && !upload && readRoute.test(route)) ||
        (!readOnly &&
          method === "POST" &&
          ((route === "releases" && !upload) ||
            (upload &&
              (sdk
                ? /^releases\/[1-9][0-9]*\/assets\?name=/.test(route) &&
                  SDK_NAMES.some((name) =>
                    route.endsWith(`?name=${encodeURIComponent(name)}`),
                  )
                : uploadRoute.test(route))))),
      "Closed same-repository checkpoint endpoint required",
    );
    if (upload)
      assert(
        positive(bodyBytes) &&
          bodyBytes <= (sdk ? SDK_ASSET_MAX : LIMITS.chunk),
        "Bounded upload content length required",
      );
    const prefix = upload
      ? "https://uploads.github.com/"
      : "https://api.github.com/";
    const repositoryUrl = `${prefix}repos/${repository}`;
    const url = route ? `${repositoryUrl}/${route}` : repositoryUrl;
    assert(
      url === repositoryUrl || url.startsWith(`${repositoryUrl}/`),
      "Foreign API route denied",
    );
    const response = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body
          ? {
              "Content-Type": upload
                ? "application/octet-stream"
                : "application/json",
              ...(upload ? { "Content-Length": String(bodyBytes) } : {}),
            }
          : {}),
      },
      body: upload ? body : body ? JSON.stringify(body) : undefined,
      ...(upload ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(
        Math.min(upload ? 600000 : 30000, deadline - Date.now()),
      ),
      redirect: "error",
    });
    assert(response.ok, "Checkpoint GitHub operation failed");
    return raw
      ? response
      : JSON.parse(
          (await boundedResponse(response, 16 * 1024 ** 2)).toString("utf8"),
        );
  };
}
export async function verifyProducer(api, producer) {
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api(`actions/workflows/${path.basename(WORKFLOW)}`),
    api(`actions/runs/${producer.runId}`),
  ]);
  assert(
    repo.id === producer.repositoryId &&
      repo.full_name === producer.repository &&
      repo.private === false &&
      repo.default_branch === producer.branch,
    "Foreign checkpoint repository",
  );
  assert(
    workflow.path === WORKFLOW &&
      run.workflow_id === workflow.id &&
      run.event === "workflow_dispatch" &&
      run.head_sha === producer.head &&
      run.head_branch === producer.branch &&
      run.head_repository?.id === repo.id &&
      run.run_attempt === producer.attempt,
    "Untrusted producer run",
  );
  return run;
}
export async function uploadCheckpoint(api, { bundle, manifest, producer }) {
  validateManifest(manifest);
  assert(
    canonical(manifest.producer) === canonical(producer),
    "Current producer mismatch",
  );
  await verifyProducer(api, producer);
  await verifyProducerCode(api, producer, manifest.identity.producer);
  assert(
    await observedQuiet(manifest.compile.observed, manifest.compile.groupId),
    "Compiler group no longer quiescent",
  );
  const pins = [...manifest.archive.chunks, manifest.archive.inventory];
  for (const p of pins)
    assert(
      canonical(
        await filePin(
          path.join(bundle, p.name),
          p.name === "inventory.json" ? LIMITS.metadata : LIMITS.chunk,
        ),
      ) === canonical(p),
      "Changed upload asset",
    );
  const manifestBytes = Buffer.from(`${canonical(manifest)}\n`);
  assert(manifestBytes.length < LIMITS.seal, "Manifest bound");
  const manifestPin = {
    name: "manifest.json",
    bytes: manifestBytes.length,
    sha256: sha(manifestBytes),
  };
  await writeFile(path.join(bundle, "manifest.json"), manifestBytes, {
    flag: "wx",
  });
  const tag = `cef-checkpoint-${TARGET}-${manifest.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`;
  const release = await api("releases", {
    method: "POST",
    body: {
      tag_name: tag,
      target_commitish: producer.head,
      name: tag,
      draft: true,
      prerelease: true,
      make_latest: "false",
      body: "Engineering checkpoint only. Not a runtime, SDK, acceptance or application release.",
    },
  });
  assert(
    positive(release.id) &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === tag,
    "Unexpected checkpoint draft",
  );
  const assets = [];
  for (const p of [...pins, manifestPin]) {
    const uploaded = await api(
      `releases/${release.id}/assets?name=${encodeURIComponent(p.name)}`,
      {
        method: "POST",
        upload: true,
        bodyBytes: p.bytes,
        body: createReadStream(path.join(bundle, p.name)),
      },
    );
    assert(
      uploaded.name === p.name &&
        uploaded.size === p.bytes &&
        uploaded.state === "uploaded" &&
        uploaded.digest === `sha256:${p.sha256}` &&
        positive(uploaded.id),
      "Uploaded checkpoint asset mismatch",
    );
    assets.push({ id: uploaded.id, ...p });
  }
  return {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-seal",
    producer,
    identitySha256: manifest.identitySha256,
    release: { id: release.id, tag },
    manifest: manifestPin,
    assets,
  };
}
export function validateSeal(seal, expected) {
  shape(seal, [
    "schemaVersion",
    "kind",
    "producer",
    "identitySha256",
    "release",
    "manifest",
    "assets",
  ]);
  assert(
    seal.schemaVersion === 1 &&
      seal.kind === "sorng-cef-engineering-seal" &&
      hex(seal.identitySha256) &&
      canonical(seal.producer) === canonical(expected),
    "Seal producer mismatch",
  );
  shape(seal.release, ["id", "tag"]);
  assert(
    positive(seal.release.id) &&
      seal.release.tag ===
        `cef-checkpoint-${TARGET}-${seal.identitySha256.slice(0, 16)}-${expected.runId}-${expected.attempt}`,
    "Seal release mismatch",
  );
  pin(seal.manifest, LIMITS.seal);
  assert(
    seal.manifest.name === "manifest.json" &&
      Array.isArray(seal.assets) &&
      seal.assets.length >= 3 &&
      seal.assets.length <= 34,
    "Seal asset bounds",
  );
  const names = new Set(),
    ids = new Set();
  for (const row of seal.assets) {
    shape(row, ["id", "name", "bytes", "sha256"]);
    pin(
      { name: row.name, bytes: row.bytes, sha256: row.sha256 },
      row.name === "inventory.json" ? LIMITS.metadata : LIMITS.chunk,
    );
    assert(
      positive(row.id) && !names.has(row.name) && !ids.has(row.id),
      "Duplicate seal asset",
    );
    names.add(row.name);
    ids.add(row.id);
  }
  return seal;
}
// Fixed phases and error labels never include untrusted errors or SDK paths.
const AFTER_GN_PHASES = new Set([
  "siso-pin",
  "sdk-roots",
  "sdk-links",
  "recipe-write",
  "graph-inventory",
  "identity",
  "restore",
]);
const AFTER_GN_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ELOOP",
  "ENOTDIR",
  "EEXIST",
  "ETIMEDOUT",
  "GRAPH_BOUND",
]);
export async function afterGnPhase(phase, operation, log = console.log) {
  assert(AFTER_GN_PHASES.has(phase), "Closed after-GN phase required");
  log(`[cef-engineering-checkpoint] after-gn phase=${phase}`);
  try {
    return await operation();
  } catch (error) {
    const code = AFTER_GN_CODES.has(error?.code) ? error.code : "CHECK_FAILED";
    log(
      `[cef-engineering-checkpoint] after-gn failed phase=${phase} code=${code}`,
    );
    const counts = error?.graphCounts;
    if (
      phase === "graph-inventory" &&
      code === "GRAPH_BOUND" &&
      counts &&
      Object.keys(counts).sort().join() === "bytes,files,visited" &&
      ["files", "bytes", "visited"].every(
        (key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0,
      ) &&
      counts.files <= GRAPH_LIMITS.files + 1 &&
      counts.bytes <= GRAPH_LIMITS.bytes + GRAPH_LIMITS.fileBytes &&
      counts.visited <= GRAPH_LIMITS.visited + 1
    )
      log(
        `[cef-engineering-checkpoint] graph files=${counts.files} bytes=${counts.bytes} visited=${counts.visited}`,
      );
    throw error; // The CLI's outer catch remains fixed and never prints raw errors.
  }
}

export async function normalizeSdkLinks(
  out,
  { developerDir, sdkRoot, expectedTargets },
) {
  assert(
    path.isAbsolute(developerDir) && path.isAbsolute(sdkRoot),
    "Verified absolute SDK roots required",
  );
  const developer = await realpath(developerDir),
    sdk = await realpath(sdkRoot);
  assert(
    sdk.startsWith(
      path.join(
        developer,
        "Platforms",
        "MacOSX.platform",
        "Developer",
        "SDKs",
      ) + path.sep,
    ),
    "SDK outside verified Developer path",
  );
  const specs = [
    {
      raw: sdkRoot,
      target: sdk,
      names: new Set([path.basename(sdkRoot), path.basename(sdk)]),
    },
    {
      raw: path.join(developerDir, "Platforms", "MacOSX.platform"),
      names: new Set(["MacOSX.platform"]),
    },
    {
      raw: path.join(developerDir, "Toolchains", "XcodeDefault.xctoolchain"),
      names: new Set(["XcodeDefault.xctoolchain"]),
    },
  ];
  assert(
    [...specs[0].names].every((name) =>
      /^MacOSX(?:[0-9]+(?:\.[0-9]+)*)?\.sdk$/.test(name),
    ),
    "Closed SDK alias names required",
  );
  assert(
    Array.isArray(expectedTargets) &&
      expectedTargets.length === 3 &&
      new Set(expectedTargets).size === 3,
    "Three verified physical SDK targets required",
  );
  for (const [index, spec] of specs.entries()) {
    spec.target ??= await realpath(spec.raw);
    assert(
      spec.target === expectedTargets[index],
      "SDK physical target changed since tool verification",
    );
    await noLinks(spec.target);
    assert(
      (await stat(spec.target)).isDirectory(),
      "Physical SDK directory required",
    );
  }
  const directory = path.join(out, "sdk", "xcode_links");
  await noLinks(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  assert(entries.length === 3, "Exactly three generated SDK links required");
  const found = new Set(),
    validated = [];
  for (const entry of entries) {
    const matches = specs.filter((spec) => spec.names.has(entry.name));
    assert(
      entry.isSymbolicLink() && matches.length === 1 && !found.has(matches[0]),
      "Unknown or duplicate generated SDK link",
    );
    const spec = matches[0],
      file = path.join(directory, entry.name),
      raw = await readlink(file);
    assert(
      path.isAbsolute(raw) &&
        (raw === spec.raw || raw === spec.target) &&
        (await realpath(file)) === spec.target,
      "Generated SDK link differs from exact verified physical target",
    );
    found.add(spec);
    validated.push({
      file,
      raw,
      target: spec.target,
      name: `sdk/xcode_links/${entry.name}`,
    });
  }
  // Validate every entry before changing ONLY our generated out/ links. Preserve
  // GN's raw link names; canonicalize target text so Python's strict physical
  // recipe remains unchanged. The source and installed SDK are never modified.
  for (const row of validated)
    if (row.raw !== row.target) {
      assert(
        (await lstat(row.file)).isSymbolicLink() &&
          (await readlink(row.file)) === row.raw &&
          (await realpath(row.file)) === row.target,
        "Generated SDK link changed before normalization",
      );
      await unlink(row.file);
      await symlink(
        row.target,
        row.file,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  for (const row of validated)
    assert(
      (await readlink(row.file)) === row.target &&
        (await realpath(row.file)) === row.target,
      "Normalized SDK link differs",
    );
  return Object.fromEntries(
    validated
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((row) => [row.name, row.target]),
  );
}

// Pinned GN150a9d6's target writer can emit one .ninja per eligible target;
// actual Mac GN reported34799 targets. Keep a finite margin plus byte/time caps.
export const GRAPH_LIMITS = Object.freeze({
  files: 50000,
  bytes: 2 * 1024 ** 3,
  visited: 300000,
  milliseconds: 60000,
  fileBytes: 256 * 1024 ** 2,
});
export function assertGraphBudget({ files, bytes, visited, elapsed }) {
  assert(
    [files, bytes, visited].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
      Number.isFinite(elapsed) &&
      elapsed >= 0,
    "Invalid graph inventory counters",
  );
  if (!(
    files <= GRAPH_LIMITS.files &&
    bytes <= GRAPH_LIMITS.bytes &&
    visited <= GRAPH_LIMITS.visited &&
    elapsed < GRAPH_LIMITS.milliseconds
  ))
    throw Object.assign(new Error("Graph inventory bound"), {
      code: "GRAPH_BOUND",
      graphCounts: { files, bytes, visited },
    });
}
export async function graphInventory(root) {
  const began = performance.now();
  let visited = 0,
    totalBytes = 0;
  const pins = [],
    pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      visited++;
      assertGraphBudget({
        files: pins.length,
        bytes: totalBytes,
        visited,
        elapsed: performance.now() - began,
      });
      // Links are not used as graph authority and will fail closed at pack time.
      if (item.isSymbolicLink()) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) pending.push(file);
      else if (item.name.endsWith(".ninja") || item.name === "args.gn") {
        pins.push({
          path: path.relative(root, file),
          ...(await filePin(file, GRAPH_LIMITS.fileBytes)),
        });
        totalBytes += pins[pins.length - 1].bytes;
        assertGraphBudget({
          files: pins.length,
          bytes: totalBytes,
          visited,
          elapsed: performance.now() - began,
        });
      }
    }
  }
  assert(
    pins.some((p) => p.path === "build.ninja") &&
      pins.some((p) => p.path === "args.gn"),
    "Fresh complete GN graph required",
  );
  return {
    files: pins.length,
    bytes: totalBytes,
    visited,
    sha256: sha(
      canonical(
        pins.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    ),
  };
}
export async function graphDigest(root) {
  return (await graphInventory(root)).sha256;
}

export async function verifyGraph(root, expected) {
  assert(
    hex(expected) && (await graphDigest(root)) === expected,
    "Checkpoint graph differs from verified fresh GN",
  );
}
export async function withVerifiedGraph(root, expected, operation) {
  await verifyGraph(root, expected);
  const result = await operation();
  await verifyGraph(root, expected);
  return result;
}
export async function restoreVerifiedGraph({
  fresh,
  restored,
  expectedGraph,
  revalidateGn,
  verifyGenerated,
}) {
  assert(
    typeof revalidateGn === "function" && typeof verifyGenerated === "function",
    "Genuine GN and SDK revalidation required",
  );
  await verifyGraph(restored, expectedGraph);
  await installRestoredDirectory(fresh, restored);
  // Cached gen/ files never supersede the CURRENT source/tool evaluation.
  await revalidateGn();
  await verifyGraph(fresh, expectedGraph);
  await verifyGenerated();
}
export async function installRestoredDirectory(fresh, verified) {
  await noLinks(fresh);
  await noLinks(verified);
  assert(
    path.dirname(fresh) === path.dirname(verified) &&
      path.basename(verified) === "checkpoint-restored",
    "Adjacent verified restore required",
  );
  const saved = `${fresh}.fresh-gn`;
  await rename(fresh, saved); // Retain original fresh GN output; never recursive deletion.
  try {
    await rename(verified, fresh);
  } catch (error) {
    await rename(saved, fresh);
    throw error;
  }
}

export async function boundedResponse(response, maximum) {
  assert(response.ok, "Download failed");
  const declared = response.headers.get("content-length");
  if (declared !== null)
    assert(
      /^[0-9]+$/.test(declared) && Number(declared) <= maximum,
      "Download length bound",
    );
  const parts = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    assert(bytes <= maximum, "Download byte bound");
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
// Only this function follows API download redirects; credentials never follow.
export async function downloadAsset(
  repository,
  token,
  route,
  output,
  expected,
  {
    request = fetch,
    maximum = LIMITS.chunk,
    deadline = Date.now() + 20 * 60_000,
  } = {},
) {
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
      Date.now() < deadline,
    "Download repository/deadline",
  );
  assert(
    /^\/(actions\/artifacts\/[1-9][0-9]*\/zip|releases\/assets\/[1-9][0-9]*)$/.test(
      route,
    ),
    "Closed same-repository download route required",
  );
  assert(
    positive(expected.bytes) &&
      expected.bytes <= maximum &&
      hex(expected.sha256),
    "Expected immutable download digest required",
  );
  const first = await request(
    `https://api.github.com/repos/${repository}${route}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(30000, deadline - Date.now())),
    },
  );
  let response = first;
  if (first.status === 302) {
    await first.body?.cancel();
    const location = first.headers.get("location");
    let url;
    try {
      url = new URL(location);
    } catch {
      throw new Error("Invalid asset redirect");
    }
    assert(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        downloadHost(url.hostname),
      "Unreviewed asset download domain",
    );
    // No auth/header inheritance, no signed URL logging, no second redirect.
    response = await request(url, {
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(600000, deadline - Date.now())),
    });
  }
  assert(response.ok, "Asset download failed");
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = createWriteStream(output, { flags: "wx" });
  try {
    for await (const part of response.body) {
      assert(Date.now() < deadline, "Asset deadline");
      bytes += part.length;
      assert(
        bytes <= expected.bytes && bytes <= maximum,
        "Downloaded asset bound",
      );
      hash.update(part);
      if (!stream.write(part))
        await new Promise((resolve, reject) => {
          stream.once("drain", resolve);
          stream.once("error", reject);
        });
    }
    stream.end();
    await finished(stream);
    assert(
      bytes === expected.bytes && hash.digest("hex") === expected.sha256,
      "Downloaded asset digest mismatch",
    );
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
export async function restoreDownload(
  api,
  { repository, token, runId, destination, python, helper, request = fetch },
) {
  assert(positive(runId), "Explicit producer run required");
  const downloadDeadline = Date.now() + 20 * 60_000;
  const run = await api(`actions/runs/${runId}`),
    repo = await api("");
  const producer = {
    repository,
    repositoryId: repo.id,
    runId,
    attempt: run.run_attempt,
    head: run.head_sha,
    branch: repo.default_branch,
    workflow: WORKFLOW,
  };
  await verifyProducer(api, producer);
  assert(
    run.status === "completed" &&
      ["success", "failure"].includes(run.conclusion),
    "Completed trusted producer required",
  );
  const listing = await api(`actions/runs/${runId}/artifacts?per_page=100`);
  assert(listing.total_count <= 100, "Artifact listing bound");
  const matches = listing.artifacts.filter(
    (a) => a.name === `cef-engineering-seal-${runId}-${producer.attempt}`,
  );
  assert(
    matches.length === 1,
    "Exactly one independent seal artifact required",
  );
  const artifact = matches[0];
  assert(
    !artifact.expired &&
      positive(artifact.id) &&
      positive(artifact.size_in_bytes) &&
      artifact.size_in_bytes < LIMITS.seal &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") &&
      artifact.workflow_run?.head_sha === producer.head,
    "Independent artifact digest/producer required",
  );
  await mkdir(destination);
  await noLinks(destination);
  const zip = path.join(destination, "seal.zip");
  await downloadAsset(
    repository,
    token,
    `/actions/artifacts/${artifact.id}/zip`,
    zip,
    { bytes: artifact.size_in_bytes, sha256: artifact.digest.slice(7) },
    { request, maximum: LIMITS.seal, deadline: downloadDeadline },
  );
  const seal = await archiveCommand(
    python,
    helper,
    ["seal", "--input", zip, "--output", destination],
    { timeout: 15000 },
  );
  validateSeal(seal, producer);
  const release = await api(`releases/${seal.release.id}`);
  assert(
    release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.target_commitish === producer.head,
    "Draft checkpoint identity changed",
  );
  const names = new Set(seal.assets.map((a) => a.name));
  const releaseAssets = await api(
    `releases/${seal.release.id}/assets?per_page=100`,
  );
  assert(
    Array.isArray(releaseAssets) && releaseAssets.length === names.size,
    "Draft asset set changed",
  );
  const ordered = [...seal.assets].sort((a, b) =>
    a.name === "manifest.json" ? -1 : b.name === "manifest.json" ? 1 : 0,
  );
  let manifest;
  for (const row of ordered) {
    const observed = releaseAssets.find((a) => a.id === row.id);
    assert(
      observed &&
        observed.name === row.name &&
        observed.size === row.bytes &&
        observed.digest === `sha256:${row.sha256}` &&
        observed.state === "uploaded",
      "Mutable draft no longer matches independent seal",
    );
    await downloadAsset(
      repository,
      token,
      `/releases/assets/${row.id}`,
      path.join(destination, row.name),
      row,
      {
        request,
        deadline: downloadDeadline,
        maximum:
          row.name === "inventory.json"
            ? LIMITS.metadata
            : row.name === "manifest.json"
              ? LIMITS.seal
              : LIMITS.chunk,
      },
    );
    if (row.name === "manifest.json") {
      const bytes = await readFile(path.join(destination, row.name));
      assert(
        bytes.length === seal.manifest.bytes &&
          sha(bytes) === seal.manifest.sha256,
        "Manifest differs from independent seal",
      );
      manifest = validateManifest(JSON.parse(bytes));
      assert(
        canonical(manifest.producer) === canonical(producer) &&
          manifest.identitySha256 === seal.identitySha256,
        "Manifest producer differs from seal",
      );
      await verifyProducerCode(api, producer, manifest.identity.producer);
    }
  }
  const manifestBytes = await readFile(path.join(destination, "manifest.json"));
  assert(
    manifestBytes.length === seal.manifest.bytes &&
      sha(manifestBytes) === seal.manifest.sha256,
    "Manifest differs from independent seal",
  );
  assert(manifest, "Sealed manifest missing");
  assert(
    canonical(manifest.producer) === canonical(producer) &&
      manifest.identitySha256 === seal.identitySha256,
    "Manifest producer differs from seal",
  );
  assert(
    canonical(
      [...manifest.archive.chunks, manifest.archive.inventory, seal.manifest]
        .map((a) => a.name)
        .sort(),
    ) === canonical([...names].sort()),
    "Sealed unexpected asset",
  );
  return {
    manifest,
    producer,
    sealArtifact: { id: artifact.id, sha256: artifact.digest.slice(7) },
    nativeAcceptance: false,
    runtimeReady: false,
  };
}

// A completed SDK is a distinct authority from a resumable out/ checkpoint.
export const SDK_ASSET_MAX = 2 * 1024 ** 3 - 1;
export const SDK_ARCHIVE = `sorng-cef-custom-${SOURCE_ID}-${TARGET}.tar.bz2`;
export const SDK_NAMES = Object.freeze([
  "source-lock.json",
  "manifest.json",
  "receipt.json",
  SDK_ARCHIVE,
  "runtime.json",
]);
export function sdkSealName(producer) {
  return `cef-engineering-sdk-seal-${SOURCE_ID}-${TARGET}-${producer.runId}-${producer.attempt}`;
}
export function sdkPin(value) {
  shape(value, ["name", "bytes", "sha256"]);
  assert(
    SDK_NAMES.includes(value.name) &&
      positive(value.bytes) &&
      value.bytes <=
        (value.name === SDK_ARCHIVE ? SDK_ASSET_MAX : 16 * 1024 ** 2) &&
      hex(value.sha256),
    "Invalid SDK asset pin",
  );
}
export function completionSha(value) {
  return sha(canonical(value) + "\n");
}
export function validateSdkCompletion(value) {
  shape(value, [
    "schemaVersion",
    "kind",
    "producer",
    "identity",
    "identitySha256",
    "target",
    "sourceLockSha256",
    "compile",
    "distributionExitCode",
    "bundleVerified",
    "bundleAssets",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-engineering-sdk-completion" &&
      value.target === TARGET &&
      value.sourceLockSha256 === SOURCE_ID &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "Closed completed SDK proof required",
  );
  assert(
    validateIdentity(value.identity) === value.identitySha256 &&
      value.producer.workflow === WORKFLOW,
    "SDK source/producer identity",
  );
  shape(value.producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  assert(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.producer.repository) &&
      positive(value.producer.repositoryId) &&
      positive(value.producer.runId) &&
      positive(value.producer.attempt) &&
      /^[a-f0-9]{40}$/.test(value.producer.head) &&
      typeof value.producer.branch === "string" &&
      value.producer.branch.length > 0 &&
      value.producer.branch.length <= 256,
    "Invalid SDK producer identity",
  );
  validateCompile(value.compile);
  assert(
    value.compile.outcome === "compiler-complete" &&
      value.compile.exitCode === 0 &&
      value.compile.quiescent === true &&
      value.distributionExitCode === 0 &&
      value.bundleVerified === true,
    "Partial/failed compiler or packaging is not SDK authority",
  );
  assert(
    Array.isArray(value.bundleAssets) && value.bundleAssets.length === 5,
    "Complete five-file SDK bundle required",
  );
  for (const row of value.bundleAssets) sdkPin(row);
  assert(
    new Set(value.bundleAssets.map((row) => row.name)).size === 5 &&
      SDK_NAMES.every((name) =>
        value.bundleAssets.some((row) => row.name === name),
      ),
    "SDK bundle names differ",
  );
  return value;
}
export function createSdkCompletion({
  producer,
  identity,
  compile,
  distributionExitCode,
  checked,
}) {
  assert(
    checked.descriptor.target === TARGET &&
      checked.identity.sourceLockSha256 === SOURCE_ID,
    "Verified SDK differs from reviewed source",
  );
  const value = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-sdk-completion",
    producer,
    identity,
    identitySha256: validateIdentity(identity),
    target: TARGET,
    sourceLockSha256: SOURCE_ID,
    compile,
    distributionExitCode,
    bundleVerified: true,
    bundleAssets: checked.assets
      .map((row) => ({ name: row.name, bytes: row.size, sha256: row.sha256 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    nativeAcceptance: false,
    runtimeReady: false,
  };
  return validateSdkCompletion(value);
}
export function validateSdkSeal(seal, producer) {
  shape(seal, [
    "schemaVersion",
    "kind",
    "producer",
    "release",
    "completion",
    "completionSha256",
    "assets",
  ]);
  assert(
    seal.schemaVersion === 1 &&
      seal.kind === "sorng-cef-engineering-sdk-seal" &&
      canonical(seal.producer) === canonical(producer),
    "SDK seal producer mismatch",
  );
  validateSdkCompletion(seal.completion);
  assert(
    canonical(seal.completion.producer) === canonical(producer) &&
      completionSha(seal.completion) === seal.completionSha256,
    "SDK completion digest mismatch",
  );
  shape(seal.release, ["id", "tag"]);
  assert(
    positive(seal.release.id) &&
      seal.release.tag ===
        `cef-sdk-checkpoint-${TARGET}-${seal.completion.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`,
    "SDK draft mismatch",
  );
  assert(
    Array.isArray(seal.assets) && seal.assets.length === 5,
    "SDK sealed asset set",
  );
  const ids = new Set();
  for (const row of seal.assets) {
    shape(row, ["id", "name", "bytes", "sha256"]);
    sdkPin({ name: row.name, bytes: row.bytes, sha256: row.sha256 });
    assert(positive(row.id) && !ids.has(row.id), "SDK asset id");
    ids.add(row.id);
  }
  assert(
    canonical(
      seal.assets
        .map(({ id, ...row }) => row)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    ) === canonical(seal.completion.bundleAssets),
    "SDK assets differ from completion",
  );
  return seal;
}
export async function uploadSdkBundle(api, { bundle, completion, producer }) {
  validateSdkCompletion(completion);
  assert(
    canonical(completion.producer) === canonical(producer),
    "Current SDK producer mismatch",
  );
  await verifyProducer(api, producer);
  await verifyProducerCode(api, producer, completion.identity.producer);
  assert(
    await observedQuiet(
      completion.compile.observed,
      completion.compile.groupId,
    ),
    "SDK compiler no longer quiescent",
  );
  for (const pin of completion.bundleAssets)
    assert(
      canonical(
        await filePin(
          path.join(bundle, pin.name),
          pin.name === SDK_ARCHIVE ? SDK_ASSET_MAX : 16 * 1024 ** 2,
        ),
      ) === canonical(pin),
      "SDK upload bytes changed",
    );
  const tag = `cef-sdk-checkpoint-${TARGET}-${completion.identitySha256.slice(0, 16)}-${producer.runId}-${producer.attempt}`;
  const release = await api("releases", {
    method: "POST",
    body: {
      tag_name: tag,
      target_commitish: producer.head,
      name: tag,
      draft: true,
      prerelease: true,
      make_latest: "false",
      body: "Completed SDK transport only; native acceptance and runtime publication remain separate.",
    },
  });
  assert(
    positive(release.id) &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === tag,
    "Unexpected SDK transport draft",
  );
  const assets = [];
  for (const pin of completion.bundleAssets) {
    const uploaded = await api(
      `releases/${release.id}/assets?name=${encodeURIComponent(pin.name)}`,
      {
        method: "POST",
        upload: true,
        bodyBytes: pin.bytes,
        body: createReadStream(path.join(bundle, pin.name)),
      },
    );
    assert(
      uploaded.name === pin.name &&
        uploaded.size === pin.bytes &&
        uploaded.digest === `sha256:${pin.sha256}` &&
        uploaded.state === "uploaded" &&
        positive(uploaded.id),
      "SDK uploaded asset mismatch",
    );
    assets.push({ id: uploaded.id, ...pin });
  }
  return validateSdkSeal(
    {
      schemaVersion: 1,
      kind: "sorng-cef-engineering-sdk-seal",
      producer,
      release: { id: release.id, tag },
      completion,
      completionSha256: completionSha(completion),
      assets,
    },
    producer,
  );
}
export async function downloadSdkBundle(
  api,
  {
    selection,
    repository,
    token,
    destination,
    python,
    helper,
    request = fetch,
  },
) {
  assert(
    selection.producer === "engineering-sdk" &&
      selection.target === TARGET &&
      positive(selection.runAttempt),
    "Explicit completed engineering SDK selection required",
  );
  const [run, repo] = await Promise.all([
    api(`actions/runs/${selection.runId}`),
    api(""),
  ]);
  const producer = {
    repository,
    repositoryId: repo.id,
    runId: selection.runId,
    attempt: selection.runAttempt,
    head: selection.headSha,
    branch: repo.default_branch,
    workflow: WORKFLOW,
  };
  await verifyProducer(api, producer);
  assert(
    run.id === selection.runId &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.run_attempt === selection.runAttempt,
    "Only a successful completed SDK run is eligible",
  );
  const listing = await api(
    `actions/runs/${selection.runId}/artifacts?per_page=100`,
  );
  assert(listing.total_count <= 100, "SDK artifact listing bound");
  const artifact = listing.artifacts.find(
    (row) => row.id === selection.artifactId,
  );
  assert(
    artifact &&
      artifact.name === sdkSealName(producer) &&
      artifact.expired === false &&
      artifact.workflow_run?.id === producer.runId &&
      artifact.workflow_run?.head_sha === producer.head &&
      artifact.digest === `sha256:${selection.artifactSha256}` &&
      positive(artifact.size_in_bytes) &&
      artifact.size_in_bytes < LIMITS.seal,
    "SDK independent completion seal mismatch",
  );
  await mkdir(destination);
  await noLinks(destination);
  const zip = path.join(destination, "sdk-seal.zip"),
    deadline = Date.now() + 20 * 60_000;
  await downloadAsset(
    repository,
    token,
    `/actions/artifacts/${artifact.id}/zip`,
    zip,
    { bytes: artifact.size_in_bytes, sha256: selection.artifactSha256 },
    { request, maximum: LIMITS.seal, deadline },
  );
  const seal = validateSdkSeal(
    await archiveCommand(
      python,
      helper,
      ["seal", "--input", zip, "--output", destination],
      { timeout: 15000 },
    ),
    producer,
  );
  assert(
    seal.completionSha256 === selection.completionSha256 &&
      seal.completion.bundleAssets.find((row) => row.name === "runtime.json")
        .sha256 === selection.descriptorSha256,
    "SDK independently reviewed completion/descriptor mismatch",
  );
  await verifyProducerCode(api, producer, seal.completion.identity.producer);
  const [release, assets] = await Promise.all([
    api(`releases/${seal.release.id}`),
    api(`releases/${seal.release.id}/assets?per_page=100`),
  ]);
  assert(
    release.draft === true &&
      release.prerelease === true &&
      release.tag_name === seal.release.tag &&
      release.target_commitish === producer.head &&
      Array.isArray(assets) &&
      assets.length === 5 &&
      new Set(assets.map((row) => row.id)).size === 5,
    "SDK draft changed after sealing",
  );
  for (const pin of seal.assets) {
    const actual = assets.find((row) => row.id === pin.id);
    assert(
      actual &&
        actual.name === pin.name &&
        actual.size === pin.bytes &&
        actual.state === "uploaded" &&
        actual.digest === `sha256:${pin.sha256}`,
      "SDK mutable draft differs from trusted seal",
    );
    await downloadAsset(
      repository,
      token,
      `/releases/assets/${pin.id}`,
      path.join(destination, pin.name),
      pin,
      {
        request,
        maximum: pin.name === SDK_ARCHIVE ? SDK_ASSET_MAX : 16 * 1024 ** 2,
        deadline,
      },
    );
  }
  await writeFile(
    path.join(destination, "sdk-completion-proof.json"),
    canonical(seal.completion) + "\n",
    { flag: "wx" },
  );
  return { sdkComplete: true, nativeAcceptance: false, runtimeReady: false };
}
