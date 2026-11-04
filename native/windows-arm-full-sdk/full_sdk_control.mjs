// Owned full-SDK build qualification controller. Native acceptance, readiness
// and publication require later independent evidence.
import * as fs from "node:fs/promises";
import * as expectedDefaults from "./expected-defaults.mjs";
import { fullSdkSourceRootName } from "./source-root.mjs";
import * as sdkRuntime from "./current-source-helpers/scripts/cef-runtime-ci.mjs";
import { inspectNativeSlice } from "./full-sdk-engine-worker.mjs";
import { constants } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as checkpoint from "./current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import * as custom from "./current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import {
  WORKFLOW_CLOCK_ENV,
  readWorkflowClock,
  intersectWorkflowClock,
} from "./workflow-clock.mjs";

const MAX_WHOLE_MS = 21600 * 1000;
const CLEANUP_MS = 30000;
const FINAL_RESERVE_MS = 120000;
const sourceSessions = new WeakMap(); // Sole writer: actual runSourcePhase creation path.
const leases = new WeakMap();
const controls = new WeakMap();
const sources = Object.freeze({
  "20261030.294.1": Object.freeze({
    id: "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    profile: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",
  }),
  "20261021.278.1": Object.freeze({
    id: "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
    profile: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",
  }),
});
function need(value, code) {
  if (!value) throw new Error("FULL_SDK_CONTROL_" + code);
}
function fail(state, reason) {
  if (!state.failed) {
    state.failed = true;
    state.primary = reason;
  }
  return state.primary;
}
function originalLease(wallStart, monoStart, wholeMs, signal) {
  const wall = Date.now(),
    mono = performance.now();
  need(
    Number.isFinite(wallStart) &&
      Number.isFinite(monoStart) &&
      wallStart <= wall &&
      monoStart <= mono &&
      monoStart >= 0 &&
      Number.isSafeInteger(wholeMs) &&
      wholeMs > CLEANUP_MS + FINAL_RESERVE_MS &&
      wholeMs <= MAX_WHOLE_MS,
    "LEASE",
  );
  const token = Object.freeze({ kind: "inactive-full-sdk-original-lease" });
  leases.set(token, {
    wallEnd: wallStart + wholeMs,
    monoEnd: monoStart + wholeMs,
    signal,
    closed: false,
    failed: false,
    primary: undefined,
    issued: false,
  });
  checkLease(token);
  return token;
}
function checkLease(token) {
  const lease = leases.get(token);
  need(lease, "LEASE_BRAND");
  if (lease.failed) throw lease.primary;
  try {
    need(!lease.closed, "RETIRED");
    if (lease.signal?.aborted) throw lease.signal.reason;
    const remaining = Math.min(
      lease.wallEnd - Date.now(),
      lease.monoEnd - performance.now(),
    );
    need(
      Number.isFinite(remaining) && remaining > CLEANUP_MS + FINAL_RESERVE_MS,
      "DEADLINE",
    );
    return remaining - CLEANUP_MS - FINAL_RESERVE_MS;
  } catch (error) {
    throw fail(lease, error);
  }
}
function sourceState(receipt, leaseToken) {
  const source = sourceSessions.get(receipt);
  need(
    source &&
      source.lease === leaseToken &&
      source.stage === "joined-success" &&
      source.pendingWriters === 0 &&
      source.creationJoined === true,
    "SOURCE_SESSION",
  );
  const tuple = sources[source.image];
  need(
    tuple &&
      source.target === "aarch64-pc-windows-msvc" &&
      source.sourceId === tuple.id &&
      source.profileSha256 === tuple.profile &&
      typeof source.root === "string" &&
      path.isAbsolute(source.root) &&
      path.resolve(source.root) === source.root,
    "SOURCE_SCOPE",
  );
  return source;
}
function directoryId(info) {
  need(info.isDirectory() && !info.isSymbolicLink(), "DIRECTORY");
  // Owned child creation legitimately changes directory times/size/link count.
  return [info.dev, info.ino, info.mode, info.uid, info.gid].join(":");
}
function fileId(info) {
  need(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, "MARKER");
  return [
    info.dev,
    info.ino,
    info.mode,
    info.uid,
    info.gid,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
}
function retained(token, state) {
  if (state.failed) throw state.primary;
  try {
    need(controls.get(token) === state && !state.closed, "RETIRED");
    checkLease(state.leaseToken);
    need(
      sourceState(state.sourceReceipt, state.leaseToken) === state.source,
      "SOURCE_CHANGED",
    );
    need(
      state.source.root === path.dirname(state.directory) &&
        state.source.rootIdentity === state.sourceRootIdentity,
      "SOURCE_CHANGED",
    );
  } catch (error) {
    throw fail(state, error);
  }
}
async function work(token, state, action, late) {
  retained(token, state);
  const milliseconds = checkLease(state.leaseToken);
  let timer,
    abort,
    settled = false,
    received = false,
    value;
  const signal = leases.get(state.leaseToken).signal;
  const pending = Promise.resolve().then(() => {
    retained(token, state);
    return action();
  });
  state.pending.add(pending);
  pending.then(
    (value) => {
      state.pending.delete(pending);
      if (settled && late)
        Promise.resolve()
          .then(() => late(value))
          .catch((error) => {
            state.cleanupConfirmed = false;
            fail(state, error);
          });
    },
    () => state.pending.delete(pending),
  );
  try {
    value = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("FULL_SDK_CONTROL_DEADLINE")),
          milliseconds,
        );
        abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    received = true;
    retained(token, state); // Checks the original ends even when timers are late.
    settled = true;
    return value;
  } catch (error) {
    settled = true;
    if (received && late)
      Promise.resolve()
        .then(() => late(value))
        .catch(() => {
          state.cleanupConfirmed = false;
        });
    throw fail(state, error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
async function physical(token, state, name) {
  need(name.length <= 4096, "PATH");
  let current = path.parse(name).root;
  const pieces = name.slice(current.length).split(path.sep).filter(Boolean);
  need(pieces.length <= 64, "PATH");
  for (const piece of pieces) {
    current = path.join(current, piece);
    directoryId(
      await work(token, state, () => fs.lstat(current, { bigint: true })),
    );
  }
  need(
    (await work(token, state, () => fs.realpath(name))) === name,
    "PATH_ALIAS",
  );
}
async function currentRoot(token, state) {
  try {
    retained(token, state);
    await physical(token, state, state.source.root);
    need(
      directoryId(
        await work(token, state, () =>
          fs.lstat(state.source.root, { bigint: true }),
        ),
      ) === state.source.rootIdentity,
      "SOURCE_ROOT_CHANGED",
    );
    if (!state.directoryIdentity) return;
    await physical(token, state, state.directory);
    need(
      directoryId(
        await work(token, state, () =>
          fs.lstat(state.directory, { bigint: true }),
        ),
      ) === state.directoryIdentity,
      "ROOT_CHANGED",
    );
    if (state.marker) {
      const held = await work(token, state, () =>
        state.marker.stat({ bigint: true }),
      );
      const named = await work(token, state, () =>
        fs.lstat(state.markerPath, { bigint: true }),
      );
      need(
        fileId(held) === state.markerIdentity &&
          fileId(named) === state.markerIdentity,
        "MARKER_CHANGED",
      );
    }
  } catch (error) {
    throw fail(state, error);
  }
}
// BEGIN CHECKED INPUT CLOSURE DATA
// Only actual completed held-input rechecks issue these private observations.
// Their copied records describe this finite checked closure, never all Chromium.
const checkedInputObservations = new WeakMap();
function checkedInputRow(records, relative, actual) {
  need(
    actual &&
      actual.pin &&
      Number.isSafeInteger(actual.pin.bytes) &&
      actual.pin.bytes >= 0 &&
      /^[a-f0-9]{64}$/.test(actual.pin.sha256),
    "INPUT_CLOSURE_PIN",
  );
  records.push(
    Object.freeze({
      relative,
      bytes: actual.pin.bytes,
      sha256: actual.pin.sha256,
    }),
  );
}
function issueCheckedInputObservation(
  sourceReceipt,
  leaseToken,
  state,
  records,
) {
  sourceState(sourceReceipt, leaseToken);
  operationState(state.operationToken, true);
  const unique = new Map();
  for (const row of records) {
    need(
      !unique.has(row.relative) ||
        canonical(unique.get(row.relative)) === canonical(row),
      "INPUT_CLOSURE_DUPLICATE",
    );
    unique.set(row.relative, row);
  }
  const context = unique.get("context.json");
  need(
    context &&
      state.metadataSnapshot &&
      /^[a-f0-9]{64}$/.test(state.metadataSnapshot.projectionSha256) &&
      unique.size <= 256,
    "INPUT_CLOSURE_SCOPE",
  );
  const inputs = state.plan.producerInputs
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const content = Object.freeze({
    schemaVersion: 1,
    kind: "windows-arm-checked-input-closure",
    sourceContextSha256: context.sha256,
    image: state.plan.image,
    sourceId: state.plan.sourceId,
    producerSha256: hashBytes(Buffer.from(canonical(inputs))),
    metadataProjectionSha256: state.metadataSnapshot.projectionSha256,
    records: Object.freeze(
      [...unique.values()].sort((a, b) =>
        a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,
      ),
    ),
  });
  const observation = Object.freeze({
    kind: "private-checked-input-observation",
  });
  checkedInputObservations.set(observation, {
    sourceReceipt,
    leaseToken,
    operation: state,
    content,
  });
  return observation;
}
function consumeCheckedInputObservation(token, state, observation, boundary) {
  retained(token, state);
  const actual = checkedInputObservations.get(observation);
  checkedInputObservations.delete(observation);
  need(
    actual &&
      actual.sourceReceipt === state.sourceReceipt &&
      actual.leaseToken === state.leaseToken &&
      operationState(state.source.operationToken, true) === actual.operation &&
      sourceState(state.sourceReceipt, state.leaseToken) === state.source &&
      ["before-probe-clang", "after-package-before-sdk-seal"].includes(
        boundary,
      ),
    "INPUT_CLOSURE_BRAND",
  );
  return Object.freeze({
    boundary,
    sha256: hashBytes(Buffer.from(canonical(actual.content))),
    content: actual.content,
  });
}
// END CHECKED INPUT CLOSURE DATA

async function createControl(sourceReceipt, leaseToken) {
  const source = sourceState(sourceReceipt, leaseToken);
  checkLease(leaseToken);
  const lease = leases.get(leaseToken);
  need(!lease.issued, "LEASE_REUSE");
  lease.issued = true;
  const token = Object.freeze({ kind: "inactive-full-sdk-control" });
  const state = {
    sourceReceipt,
    source,
    sourceRootIdentity: source.rootIdentity,
    leaseToken,
    closed: false,
    failed: false,
    primary: undefined,
    pending: new Set(),
    directory: path.join(source.root, "full-sdk-control"),
    marker: null,
    markerPath: path.join(source.root, "full-sdk-control", "owner.bin"),
    directoryIdentity: null,
    markerIdentity: null,
    created: false,
    helperEntries: [],
    helperStarted: false,
    helperValidated: false,
    rootPending: false,
    markerPending: false,
    gitToken: undefined,
    cleanupConfirmed: false,
  };
  controls.set(token, state);
  try {
    await currentRoot(token, state);
    state.rootPending = true;
    await work(token, state, () => fs.mkdir(state.directory, { mode: 0o700 }));
    state.created = true;
    state.rootPending = false;
    state.directoryIdentity = directoryId(
      await work(token, state, () =>
        fs.lstat(state.directory, { bigint: true }),
      ),
    );
    await physical(token, state, state.directory);
    state.markerPending = true;
    const marker = await work(
      token,
      state,
      () =>
        fs.open(
          state.markerPath,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        ),
      async (lateMarker) => {
        await lateMarker.close();
      },
    );
    state.marker = marker;
    state.markerPending = false;
    await work(token, state, () => marker.writeFile(randomBytes(32)));
    state.markerIdentity = fileId(
      await work(token, state, () => marker.stat({ bigint: true })),
    );
    await currentRoot(token, state);
    retained(token, state);
    return token;
  } catch (error) {
    fail(state, error);
    await retireControl(token);
    throw state.primary;
  }
}
async function prepareFreshPolicy(token) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  need(!state.helperStarted, "POLICY_REUSE");
  await currentRoot(token, state);
  if (state.source.operationToken)
    await work(token, state, () =>
      recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
    );
  retained(token, state);
  state.helperStarted = true;
  const directory = path.join(state.directory, "cef-source-git-policy");
  try {
    const gitToken = await work(token, state, () =>
      custom.prepareSourceGitIsolation(directory, { windowsLongPaths: true }),
    );
    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));
    // The genuine helper brand, not path names or JSON, proves successful creation.
    const entries = [
      "",
      "home",
      "xdg",
      "hooks",
      "runtime-profile",
      "global.gitconfig",
      "system.gitconfig",
    ];
    for (const relative of entries) {
      const file = path.join(directory, relative);
      const info = await work(token, state, () =>
        fs.lstat(file, { bigint: true }),
      );
      state.helperEntries.push({
        path: file,
        directory: info.isDirectory(),
        identity: info.isDirectory() ? directoryId(info) : fileId(info),
      });
    }
    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));
    await currentRoot(token, state);
    let beforeObservation;
    if (state.source.operationToken)
      beforeObservation = await work(token, state, () =>
        recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
      );
    retained(token, state);
    if (state.source.operationToken) {
      need(!state.checkedInputsBefore, "INPUT_CLOSURE_REUSE");
      state.checkedInputsBefore = consumeCheckedInputObservation(
        token,
        state,
        beforeObservation,
        "before-probe-clang",
      );
    }
    state.helperValidated = true;
    state.gitToken = gitToken; // Private; never returned/exported or serialized.
    return Object.freeze({
      kind: "inactive-full-sdk-policy-prepared",
      executionAdmitted: false,
    });
  } catch (error) {
    throw fail(state, error);
  }
}
async function cleanupStep(state, action) {
  const remaining = Math.min(
    state.cleanupEnd - performance.now(),
    state.cleanupWallEnd - Date.now(),
  );
  if (remaining <= 0) throw new Error("FULL_SDK_CONTROL_CLEANUP_DEADLINE");
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("FULL_SDK_CONTROL_CLEANUP_DEADLINE")),
          remaining,
        );
      }),
    ]);
    need(
      performance.now() < state.cleanupEnd && Date.now() < state.cleanupWallEnd,
      "CLEANUP_DEADLINE",
    );
    return value;
  } finally {
    clearTimeout(timer);
  }
}
function registeredCleanupSource(state) {
  need(
    sourceState(state.sourceReceipt, state.leaseToken) === state.source &&
      state.source.root === path.dirname(state.directory) &&
      state.source.rootIdentity === state.sourceRootIdentity,
    "SOURCE_CHANGED",
  );
}
async function cleanupParents(state, entry) {
  registeredCleanupSource(state);
  for (const [name, identity] of [
    [state.source.root, state.sourceRootIdentity],
    [state.directory, state.directoryIdentity],
  ]) {
    need(
      (await cleanupStep(state, () => fs.realpath(name))) === name,
      "PATH_ALIAS",
    );
    need(
      directoryId(
        await cleanupStep(state, () => fs.lstat(name, { bigint: true })),
      ) === identity,
      "ROOT_CHANGED",
    );
  }
  if (entry)
    for (const parent of state.helperEntries) {
      if (
        parent.directory &&
        !parent.removed &&
        entry.path.startsWith(parent.path + path.sep)
      ) {
        need(
          directoryId(
            await cleanupStep(state, () =>
              fs.lstat(parent.path, { bigint: true }),
            ),
          ) === parent.identity,
          "CLEANUP_CHANGED",
        );
      }
    }
  registeredCleanupSource(state);
  // These are acceptance checks, not an atomic source-inode deletion CAS.
}
async function retireControl(token) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  if (state.retirement) return state.retirement;
  state.closed = true;
  controls.delete(token); // Retire before the first awaited close/cleanup.
  state.gitToken = undefined;
  const lease = leases.get(state.leaseToken);
  lease.closed = true;
  state.cleanupEnd = Math.min(
    performance.now() + CLEANUP_MS,
    lease.monoEnd - FINAL_RESERVE_MS,
  );
  state.cleanupWallEnd = Math.min(
    Date.now() + CLEANUP_MS,
    lease.wallEnd - FINAL_RESERVE_MS,
  );
  state.retirement = (async () => {
    try {
      for (const fd of [...(state.assetFds ?? [])]) {
        await cleanupStep(state, () => fd.close());
        state.assetFds.delete(fd);
      }
      if (state.marker) {
        const marker = state.marker;
        state.marker = null;
        await cleanupStep(state, () => marker.close());
      }
      need(
        state.pending.size === 0 &&
          !state.rootPending &&
          !state.markerPending &&
          (!state.helperStarted || state.helperValidated),
        "CLEANUP_UNKNOWN",
      );
      if (state.created) {
        await cleanupParents(state);
        for (const entry of [...state.helperEntries].reverse()) {
          const info = await cleanupStep(state, () =>
            fs.lstat(entry.path, { bigint: true }),
          );
          need(
            (entry.directory ? directoryId(info) : fileId(info)) ===
              entry.identity,
            "CLEANUP_CHANGED",
          );
          await cleanupParents(state, entry);
          await cleanupStep(state, () => {
            registeredCleanupSource(state);
            return entry.directory
              ? fs.rmdir(entry.path)
              : fs.unlink(entry.path);
          });
          entry.removed = true;
        }
        if (state.markerIdentity) {
          need(
            fileId(
              await cleanupStep(state, () =>
                fs.lstat(state.markerPath, { bigint: true }),
              ),
            ) === state.markerIdentity,
            "MARKER_CHANGED",
          );
          await cleanupParents(state);
          await cleanupStep(state, () => {
            registeredCleanupSource(state);
            return fs.unlink(state.markerPath);
          });
        }
        await cleanupParents(state);
        await cleanupStep(state, () => {
          registeredCleanupSource(state);
          return fs.rmdir(state.directory);
        });
      }
      state.cleanupConfirmed = true;
    } catch (error) {
      fail(state, error);
      state.cleanupConfirmed = false;
    }
    if (state.failed) throw state.primary;
    return Object.freeze({
      kind: "inactive-full-sdk-control-retired",
      cleanupConfirmed: true,
      executionAdmitted: false,
    });
  })();
  return state.retirement;
}

// BEGIN CLOSED FULL SDK SOURCE CONTROLLER
const CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.
const SOURCE_QUALIFICATION_ALLOWED = true;
const FULL_SOURCE_PROFILE_SHA256 =
  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";
const MODULE_URL = import.meta.url;
const CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));
const CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");
const bootstrapOwners = new WeakMap();
const sourceOperations = new WeakMap();
const SOURCE_MS = 10800000;
const ACQUISITION_MS = 7200000;
const SOURCE_LOG_CAP = 131072;
const DATA_ROLES = Object.freeze([
  "sdk-data",
  "llvm-data",
  "rust-archive",
  "gn-archive",
  "siso-archive",
  "materialize",
  "runtime-closure",
]);
const SOURCE_ROLES = Object.freeze([...DATA_ROLES, "full-sdk-source-gn"]);
const PATCHED_SOURCE_PINS = Object.freeze([
  Object.freeze({
    relative: "source-checkout/src/cef/BUILD.gn",
    bytes: 97568,
    sha256: "2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0",
  }),
  Object.freeze({
    relative:
      "source-checkout/src/base/allocator/partition_allocator/src/partition_alloc/BUILD.gn",
    bytes: 45891,
    sha256: "e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15",
  }),
]);
const hashBytes = (raw) => createHash("sha256").update(raw).digest("hex");
const canonical = (value) =>
  JSON.stringify(
    Array.isArray(value) ? value.map(canonicalValue) : canonicalValue(value),
  );
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
}
function beginFullSdkBootstrap() {
  // FIRST operation: no input/IO/setup is allowed before these original clocks.
  const wallStart = Date.now(),
    monoStart = performance.now();
  const cancel = new AbortController();
  const lease = originalLease(
    wallStart,
    monoStart,
    MAX_WHOLE_MS,
    cancel.signal,
  );
  const token = Object.freeze({ kind: "closed-full-sdk-bootstrap" });
  bootstrapOwners.set(token, {
    lease,
    cancel,
    wallStart,
    monoStart,
    pid: process.pid,
    closed: false,
    operation: null,
  });
  return token;
}
function bootstrapState(token) {
  const state = bootstrapOwners.get(token);
  need(state && !state.closed && state.pid === process.pid, "BOOTSTRAP_BRAND");
  checkLease(state.lease);
  return state;
}
function operationState(token, joinedAllowed = false) {
  const state = sourceOperations.get(token);
  need(state, "SOURCE_OPERATION_BRAND");
  if (state.failed) throw state.primary;
  try {
    need(
      !state.closed && (!state.issued || joinedAllowed),
      "SOURCE_OPERATION_RETIRED",
    );
    bootstrapState(state.bootstrap);
    if (!state.issued) {
      need(
        Math.min(
          state.sourceWallEnd - Date.now(),
          state.sourceMonoEnd - performance.now(),
        ) >
          CLEANUP_MS + FINAL_RESERVE_MS,
        "SOURCE_DEADLINE",
      );
    }
    return state;
  } catch (error) {
    throw fail(state, error);
  }
}
async function operationWork(token, action, late, joinedAllowed = false) {
  const state = operationState(token, joinedAllowed);
  const whole = checkLease(state.lease);
  const remaining = state.issued
    ? whole
    : Math.min(
        whole,
        state.sourceWallEnd - Date.now() - CLEANUP_MS - FINAL_RESERVE_MS,
        state.sourceMonoEnd - performance.now() - CLEANUP_MS - FINAL_RESERVE_MS,
      );
  need(remaining > 0, "SOURCE_DEADLINE");
  let timer,
    abort,
    settled = false,
    received = false,
    value;
  const pending = Promise.resolve().then(() => {
    operationState(token, joinedAllowed);
    return action();
  });
  state.pending.add(pending);
  pending.then(
    (result) => {
      state.pending.delete(pending);
      if (settled && late) {
        const closing = Promise.resolve().then(() => late(result));
        state.lateCleanups.add(closing);
        closing
          .catch((error) => {
            state.cleanupConfirmed = false;
            fail(state, error);
          })
          .finally(() => state.lateCleanups.delete(closing));
      }
    },
    () => state.pending.delete(pending),
  );
  const signal = leases.get(state.lease).signal;
  try {
    value = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("FULL_SDK_CONTROL_SOURCE_DEADLINE")),
          remaining,
        );
        abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    received = true;
    operationState(token, joinedAllowed);
    settled = true;
    return value;
  } catch (error) {
    settled = true;
    if (received && late) {
      const closing = Promise.resolve().then(() => late(value));
      state.lateCleanups.add(closing);
      closing
        .catch(() => {
          state.cleanupConfirmed = false;
        })
        .finally(() => state.lateCleanups.delete(closing));
    }
    throw fail(state, error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function operationDirectoryId(info) {
  return directoryId(info) + ":" + String(info.birthtimeNs);
}
async function operationFence(token, joinedAllowed = false) {
  const state = operationState(token, joinedAllowed);
  for (const entry of state.rootFence) {
    const info = await operationWork(
      token,
      () => fs.lstat(entry.path, { bigint: true }),
      undefined,
      joinedAllowed,
    );
    need(operationDirectoryId(info) === entry.identity, "SOURCE_ROOT_CHANGED");
  }
  need(
    (await operationWork(
      token,
      () => fs.realpath(state.root),
      undefined,
      joinedAllowed,
    )) === state.root,
    "SOURCE_ROOT_ALIAS",
  );
  if (state.owner) {
    const held = await operationWork(
      token,
      () => state.owner.stat({ bigint: true }),
      undefined,
      joinedAllowed,
    );
    const named = await operationWork(
      token,
      () => fs.lstat(state.ownerPath, { bigint: true }),
      undefined,
      joinedAllowed,
    );
    need(
      fileId(held) === state.ownerIdentity &&
        fileId(named) === state.ownerIdentity,
      "SOURCE_OWNER_CHANGED",
    );
  }
  operationState(token, joinedAllowed);
}
async function heldOperationFile(
  token,
  relative,
  maximum,
  expected,
  joinedAllowed = false,
) {
  const state = operationState(token, joinedAllowed);
  need(
    typeof relative === "string" &&
      !path.isAbsolute(relative) &&
      relative.split(/[\\/]/).every((x) => x && x !== "." && x !== ".."),
    "SOURCE_RECORD_PATH",
  );
  const name = path.join(state.root, relative);
  await operationFence(token, joinedAllowed);
  let current = path.dirname(name);
  while (current !== state.root) {
    directoryId(
      await operationWork(
        token,
        () => fs.lstat(current, { bigint: true }),
        undefined,
        joinedAllowed,
      ),
    );
    current = path.dirname(current);
  }
  const fd = await operationWork(
    token,
    () => fs.open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
    (late) => late.close(),
    joinedAllowed,
  );
  state.readFds.add(fd);
  let failed = false,
    primary,
    raw,
    identity;
  try {
    const before = await operationWork(
      token,
      () => fd.stat({ bigint: true }),
      undefined,
      joinedAllowed,
    );
    identity = fileId(before);
    need(
      before.size >= 0n && before.size <= BigInt(maximum),
      "SOURCE_RECORD_BOUND",
    );
    need(
      fileId(
        await operationWork(
          token,
          () => fs.lstat(name, { bigint: true }),
          undefined,
          joinedAllowed,
        ),
      ) === identity,
      "SOURCE_RECORD_CHANGED",
    );
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await operationWork(
        token,
        () => fd.read(buffer, size, buffer.length - size, size),
        undefined,
        joinedAllowed,
      );
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    raw = buffer.subarray(0, size);
    need(
      raw.length === Number(before.size) && raw.length <= maximum,
      "SOURCE_RECORD_BOUND",
    );
    need(
      fileId(
        await operationWork(
          token,
          () => fd.stat({ bigint: true }),
          undefined,
          joinedAllowed,
        ),
      ) === identity &&
        fileId(
          await operationWork(
            token,
            () => fs.lstat(name, { bigint: true }),
            undefined,
            joinedAllowed,
          ),
        ) === identity,
      "SOURCE_RECORD_CHANGED",
    );
    if (expected)
      need(
        raw.length === expected.bytes && hashBytes(raw) === expected.sha256,
        "SOURCE_RECORD_PIN",
      );
  } catch (error) {
    failed = true;
    primary = fail(state, error);
  } finally {
    try {
      await operationWork(token, () => fd.close(), undefined, joinedAllowed);
      state.readFds.delete(fd);
    } catch (error) {
      state.cleanupConfirmed = false;
      if (!failed) {
        failed = true;
        primary = fail(state, error);
      }
    }
  }
  if (failed) throw primary;
  await operationFence(token, joinedAllowed);
  return { raw, identity, pin: { bytes: raw.length, sha256: hashBytes(raw) } };
}
function parseRecord(record) {
  need(record.raw.length > 0, "SOURCE_RECORD_EMPTY");
  return JSON.parse(record.raw.toString("utf8"));
}
function inspectJob(record, large) {
  const value = parseRecord(record),
    p = value.policyReadback;
  need(
    value.kind === "owned-job-proof" &&
      value.outcome === "success" &&
      value.success === true &&
      value.started === true &&
      value.jobCreated === true &&
      value.assignedBeforeResume === true &&
      value.resumed === true &&
      value.assignedAtCreationVerified === true &&
      value.assignmentMode === "creation-attribute" &&
      value.handleListOnly === true &&
      value.jobHandleInheritable === false &&
      value.jobHandleInStdioAllowlist === false &&
      value.rootExit === 0 &&
      value.finalRootExit === 0 &&
      value.rootReaped === true &&
      value.activeAtEnd === 0 &&
      value.cleanupVerified === true &&
      value.logReadersStopped === true &&
      value.cleanupBudgetMs === 30000 &&
      (!Object.hasOwn(value, "observerStopped") ||
        value.observerStopped === true) &&
      Number.isSafeInteger(value.rootPid) &&
      value.rootPid > 0 &&
      /^[1-9][0-9]{0,19}$/.test(value.rootCreationFiletime) &&
      p &&
      p.flags === 8712 &&
      p.activeProcessLimit === (large ? 64 : 8) &&
      p.jobMemoryBytes === String(large ? 8589934592 : 536870912) &&
      p.cpuFlags === 5 &&
      p.cpuRate === 2500 &&
      p.inheritedHandles === 3 &&
      p.affinityChanged === false,
    "SOURCE_JOB_PROOF",
  );
  return value;
}
function inspectClose(record, pid, creation, parentCreation) {
  const value = parseRecord(record);
  need(
    value.success === true &&
      value.sdkBuilt === false &&
      value.parentHandleClosed === true &&
      value.ownHandleClosed === true &&
      Number.isSafeInteger(value.ownPid) &&
      value.ownPid > 0 &&
      value.ownPid === pid &&
      /^[1-9][0-9]{0,19}$/.test(value.ownCreationFiletime) &&
      value.ownCreationFiletime === creation &&
      value.parentCreationFiletime === parentCreation,
    "SOURCE_PARENT_CLOSE",
  );
  return value;
}

// BEGIN PRIVATE PARENT METADATA VERIFICATION
// BEGIN FIXED EXPECTED DEFAULTS BINDING
const EXPECTED_DEFAULTS_PATH =
  "native/windows-arm-full-sdk/expected-defaults.mjs";
const EXPECTED_DEFAULTS_PIN = Object.freeze({
  bytes: 36630,
  sha256: "5337a2b2559dd01dc6a07358e518fa22a94f1e14be540243508e274f3d37e058",
});
const EXPECTED_DEFAULTS_POLICY_SHA256 =
  "64f113c323b022feeb141f0a08b8cd3434cbdcd031524c50f2ccd2300260a6ae";
async function heldExpectedDefaultsLive(token, joinedAllowed = false) {
  const relative = EXPECTED_DEFAULTS_PATH,
    maximum = 65536,
    expected = EXPECTED_DEFAULTS_PIN;
  const state = operationState(token, joinedAllowed);
  need(
    typeof relative === "string" &&
      !path.isAbsolute(relative) &&
      relative.split(/[\\/]/).every((x) => x && x !== "." && x !== ".."),
    "SOURCE_RECORD_PATH",
  );
  const name = path.join(CONTROLLER_REPO, relative);
  await operationFence(token, joinedAllowed);
  let current = path.dirname(name);
  const ancestors = [];
  for (;;) {
    const info = await operationWork(
      token,
      () => fs.lstat(current, { bigint: true }),
      undefined,
      joinedAllowed,
    );
    operationState(token, joinedAllowed);
    ancestors.push({ path: current, identity: directoryId(info) });
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  const fd = await operationWork(
    token,
    () =>
      fs
        .open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        .then((fd) => {
          state.readFds.add(fd);
          return fd;
        }),
    async (late) => {
      try {
        await late.close();
      } finally {
        state.readFds.delete(late);
      }
    },
    joinedAllowed,
  );
  state.readFds.add(fd);
  let failed = false,
    primary,
    raw,
    identity;
  try {
    const before = await operationWork(
      token,
      () => fd.stat({ bigint: true }),
      undefined,
      joinedAllowed,
    );
    identity = fileId(before);
    need(
      before.size >= 0n && before.size <= BigInt(maximum),
      "SOURCE_RECORD_BOUND",
    );
    need(
      fileId(
        await operationWork(
          token,
          () => fs.lstat(name, { bigint: true }),
          undefined,
          joinedAllowed,
        ),
      ) === identity,
      "SOURCE_RECORD_CHANGED",
    );
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await operationWork(
        token,
        () => fd.read(buffer, size, buffer.length - size, size),
        undefined,
        joinedAllowed,
      );
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    raw = buffer.subarray(0, size);
    need(
      raw.length === Number(before.size) && raw.length <= maximum,
      "SOURCE_RECORD_BOUND",
    );
    need(
      fileId(
        await operationWork(
          token,
          () => fd.stat({ bigint: true }),
          undefined,
          joinedAllowed,
        ),
      ) === identity &&
        fileId(
          await operationWork(
            token,
            () => fs.lstat(name, { bigint: true }),
            undefined,
            joinedAllowed,
          ),
        ) === identity,
      "SOURCE_RECORD_CHANGED",
    );
    if (expected)
      need(
        raw.length === expected.bytes && hashBytes(raw) === expected.sha256,
        "SOURCE_RECORD_PIN",
      );
  } catch (error) {
    failed = true;
    primary = fail(state, error);
  } finally {
    try {
      await operationWork(token, () => fd.close(), undefined, joinedAllowed);
      state.readFds.delete(fd);
    } catch (error) {
      state.cleanupConfirmed = false;
      if (!failed) {
        failed = true;
        primary = fail(state, error);
      }
    }
  }
  if (failed) throw primary;
  await operationFence(token, joinedAllowed);
  for (const row of ancestors) {
    const info = await operationWork(
      token,
      () => fs.lstat(row.path, { bigint: true }),
      undefined,
      joinedAllowed,
    );
    operationState(token, joinedAllowed);
    need(
      directoryId(info) === row.identity,
      "SOURCE_DEFAULTS_ANCESTOR_CHANGED",
    );
  }
  await operationFence(token, joinedAllowed);
  return { raw, identity, pin: { bytes: raw.length, sha256: hashBytes(raw) } };
}

function expectedDefaultsPolicyBinding() {
  need(
    hashBytes(
      Buffer.from(
        parentMetadata_qualificationCanonical(
          expectedDefaults.ARM64_EXPECTED_DEFAULTS_POLICY,
        ),
      ),
    ) === EXPECTED_DEFAULTS_POLICY_SHA256,
    "SOURCE_DEFAULTS_POLICY_PIN",
  );
}
async function expectedDefaultsCodeBinding(token, joinedAllowed = false) {
  const state = operationState(token, joinedAllowed),
    rows = state.plan.producerInputs;
  need(
    Array.isArray(rows) &&
      rows.filter((row) => row.path === EXPECTED_DEFAULTS_PATH).length === 1,
    "SOURCE_DEFAULTS_INPUT",
  );
  const index = rows.findIndex((row) => row.path === EXPECTED_DEFAULTS_PATH),
    row = rows[index];
  need(
    row.bytes === EXPECTED_DEFAULTS_PIN.bytes &&
      row.sha256 === EXPECTED_DEFAULTS_PIN.sha256,
    "SOURCE_DEFAULTS_INPUT_PIN",
  );
  const relative = "source-inputs/" + index,
    saved = await heldOperationFile(
      token,
      relative,
      65536,
      EXPECTED_DEFAULTS_PIN,
      joinedAllowed,
    );
  operationState(token, joinedAllowed);
  const live = await heldExpectedDefaultsLive(token, joinedAllowed);
  operationState(token, joinedAllowed);
  need(saved.raw.equals(live.raw), "SOURCE_DEFAULTS_CODE_CHANGED");
  expectedDefaultsPolicyBinding();
  return Object.freeze({
    saved: Object.freeze({
      relative,
      pin: Object.freeze({ ...saved.pin }),
      identity: saved.identity,
    }),
    live: Object.freeze({
      pin: Object.freeze({ ...live.pin }),
      identity: live.identity,
    }),
    policySha256: EXPECTED_DEFAULTS_POLICY_SHA256,
  });
}
function expectedDefaultsFact(state, projected, binding) {
  operationState(state.operationToken);
  expectedDefaultsPolicyBinding();
  const comparison = expectedDefaults.inspectExpectedArm64Defaults({
    target: "aarch64-pc-windows-msvc",
    image: state.plan.image,
    sourceId: state.plan.sourceId,
    partitionAllocActionValues: Object.entries(
      projected.metadata.partitionAlloc.evaluatedMacroValues,
    ),
    partitionAllocHeaderValues: Object.entries(projected.partitionAllocMacros),
    cefHeaderValues: [
      ["CEF_V8_ENABLE_SANDBOX", Number(projected.cefHeader.v8SandboxDeclared)],
    ],
  });
  const context = state.plan.rootPins.find(
    (row) => row.relative === "context.json",
  );
  need(
    context && /^[a-f0-9]{64}$/.test(context.sha256),
    "SOURCE_DEFAULTS_CONTEXT_PIN",
  );
  return Object.freeze({
    comparison,
    contextSha256: context.sha256,
    image: state.plan.image,
    sourceId: state.plan.sourceId,
    binding,
    full61Qualified: false,
  });
}
// END FIXED EXPECTED DEFAULTS BINDING

// Strict DATA readers only. These cannot register a source, create a child or open admission.
const parentMetadata_PRIVATE_PROFILE_SHA256 =
  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";

const parentMetadata_PRIVATE_MODE = "private-compiler-input-qualification";

const parentMetadata_PRIVATE_REF =
  "refs/heads/codex/windows-arm-engine-qualification-20261101";

const parentMetadata_PRIVATE_WORKFLOW =
  ".github/workflows/windows-arm-compiler-input-qualification.yml";

const parentMetadata_PRIVATE_ROLES = Object.freeze([
  "qual-gn-desc-pa",
  "qual-gn-desc-cef",
  "qual-gn-args",
  "qual-generate-headers",
  "qual-clang-probe",
  "qual-link-probe",
]);

function parentMetadata_staticProjectionEqual(value, expected) {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      expected.every((item, index) =>
        parentMetadata_staticProjectionEqual(value[index], item),
      )
    );
  if (expected !== null && typeof expected === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([name, item]) =>
          Object.hasOwn(value, name) &&
          parentMetadata_staticProjectionEqual(value[name], item),
      )
    );
  return value === expected;
}

const parentMetadata_QUALIFICATION_PA_GUARD =
  "BASE_ALLOCATOR_PARTITION_ALLOCATOR_SRC_PARTITION_ALLOC_BUILDFLAGS_H_";

const parentMetadata_QUALIFICATION_ARM_TOOLCHAIN =
  "//build/toolchain/win:win_clang_arm64";

const parentMetadata_QUALIFICATION_DECLARED_ARGS = Object.freeze({
  is_clang: "true",
  use_lld: "true",
  use_remoteexec: "false",
  use_siso: "true",
  is_component_build: "false",
  is_debug: "false",
  enable_backup_ref_ptr_instance_tracer: "false",
  v8_enable_sandbox: "true",
});

const parentMetadata_QUALIFICATION_CPU_ARGS = Object.freeze({
  target_cpu: '"arm64"',
  host_cpu: '"x64"',
});

const parentMetadata_QUALIFICATION_PY_SPACE =
  "[\\x09-\\x0d\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";

const parentMetadata_QUALIFICATION_GN_LITERAL = new RegExp(
  /^\s*([a-z][a-z0-9_]*)\s*=\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\$\x00-\x1f]|\\["\\])*")\s*(?:#.*)?$/.source.replaceAll(
    "\\s",
    parentMetadata_QUALIFICATION_PY_SPACE,
  ),
  "u",
);

function parentMetadata_qualificationShape(value, fields, code) {
  need(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === fields.length &&
      fields.every((key) => Object.hasOwn(value, key)),
    code,
  );
}

function parentMetadata_qualificationStringBound(value, maximum) {
  if (typeof value !== "string") return false;
  let count = 0;
  for (let at = 0; at < value.length; at++) {
    if (++count > maximum) return false;
    if (value.codePointAt(at) > 0xffff) at++;
  }
  return true;
}

function parentMetadata_qualificationCanonical(value) {
  if (Array.isArray(value))
    return (
      "[" + value.map(parentMetadata_qualificationCanonical).join(",") + "]"
    );
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            parentMetadata_qualificationCanonical(value[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

function parentMetadata_qualificationPolicy(rawPolicy, rawCandidatePolicy) {
  need(
    Buffer.isBuffer(rawPolicy) &&
      rawPolicy.length > 0 &&
      rawPolicy.length <= 65536 &&
      hashBytes(rawPolicy) === parentMetadata_PRIVATE_PROFILE_SHA256,
    "PRIVATE_POLICY_PIN",
  );
  const policy = JSON.parse(rawPolicy.toString("utf8"));
  need(
    policy.mode === parentMetadata_PRIVATE_MODE &&
      policy.ref === parentMetadata_PRIVATE_REF &&
      policy.workflow === parentMetadata_PRIVATE_WORKFLOW &&
      policy.repository === "supermarsx/sortOfRemoteNG" &&
      policy.repositoryId === "1010282954" &&
      parentMetadata_staticProjectionEqual(
        policy.qualificationRoles,
        parentMetadata_PRIVATE_ROLES,
      ),
    "PRIVATE_POLICY_SCOPE",
  );
  need(
    [
      "privateAuthorityAdmitted",
      "workflowActivation",
      "publicExecuteAdmitted",
      "engineCompilationAllowed",
      "sdkAllowed",
      "nativeAcceptance",
      "runtimeReady",
      "environmentContractApproved",
    ].every((key) => policy[key] === false) &&
      policy.sourceClosureStatus === "planned-files-incomplete",
    "PRIVATE_POLICY_CLOSED",
  );
  need(
    Buffer.isBuffer(rawCandidatePolicy) &&
      rawCandidatePolicy.length > 0 &&
      rawCandidatePolicy.length <= 65536 &&
      hashBytes(rawCandidatePolicy) === policy.baseCandidatePolicySha256,
    "PRIVATE_CANDIDATE_POLICY_PIN",
  );
  return { policy, candidate: JSON.parse(rawCandidatePolicy.toString("utf8")) };
}

function parentMetadata_qualificationBoundedJson(raw, maximum = 4 * 1024 ** 2) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= maximum &&
      !raw.includes(0),
    "PRIVATE_JSON_BOUND",
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      raw,
    );
  } catch {
    throw new Error("PRIVATE_JSON_SYNTAX");
  }
  let at = 0;
  const space = () => {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++;
  };
  const string = () => {
    need(text[at] === '"', "PRIVATE_JSON_SYNTAX");
    const start = at++;
    let escaped = false;
    while (at < text.length) {
      const char = text[at++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        try {
          return JSON.parse(text.slice(start, at));
        } catch {
          throw new Error("PRIVATE_JSON_SYNTAX");
        }
      }
    }
    throw new Error("PRIVATE_JSON_SYNTAX");
  };
  const value = (depth) => {
    space();
    if (text[at] === '"') return string();
    if (text[at] === "[" || text[at] === "{") {
      need(depth < 32, "PRIVATE_JSON_DEPTH");
      const array = text[at++] === "[",
        end = array ? "]" : "}";
      const result = array ? [] : {},
        seen = new Set();
      space();
      if (text[at] === end) {
        at++;
        return result;
      }
      for (;;) {
        let key;
        if (!array) {
          key = string();
          space();
          need(text[at++] === ":", "PRIVATE_JSON_SYNTAX");
        }
        const entry = value(depth + 1);
        if (array) result.push(entry);
        else {
          need(!seen.has(key), "PRIVATE_JSON_DUPLICATE");
          seen.add(key);
          Object.defineProperty(result, key, {
            value: entry,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        space();
        if (text[at] === end) {
          at++;
          return result;
        }
        need(text[at++] === ",", "PRIVATE_JSON_SYNTAX");
        space();
      }
    }
    for (const [word, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ])
      if (text.startsWith(word, at)) {
        at += word.length;
        return result;
      }
    need(
      !["NaN", "Infinity", "-Infinity"].some((word) =>
        text.startsWith(word, at),
      ),
      "PRIVATE_JSON_CONSTANT",
    );
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = at;
    const match = number.exec(text);
    need(match, "PRIVATE_JSON_SYNTAX");
    at = number.lastIndex;
    return Number(match[0]);
  };
  const result = value(0);
  space();
  need(at === text.length, "PRIVATE_JSON_SYNTAX");
  return result;
}

function parentMetadata_qualificationInspectEvaluatedArgs(raw) {
  const rows = parentMetadata_qualificationBoundedJson(raw);
  need(
    Array.isArray(rows) && rows.length >= 1 && rows.length <= 8192,
    "PRIVATE_GN_ARGS_ROWS",
  );
  const values = {};
  for (const row of rows) {
    parentMetadata_qualificationShape(
      row,
      Object.hasOwn(row ?? {}, "current")
        ? ["name", "default", "current"]
        : ["name", "default"],
      "PRIVATE_GN_ARG_FIELDS",
    );
    need(
      typeof row.name === "string" &&
        /^[a-z][a-z0-9_]{0,127}$/.test(row.name) &&
        !Object.hasOwn(values, row.name),
      "PRIVATE_GN_ARG_NAME",
    );
    for (const key of ["default", "current"])
      if (Object.hasOwn(row, key)) {
        parentMetadata_qualificationShape(
          row[key],
          ["value"],
          "PRIVATE_GN_ARG_VALUE_FIELDS",
        );
        need(
          typeof row[key].value === "string" &&
            parentMetadata_qualificationStringBound(row[key].value, 65536) &&
            !row[key].value.includes("\0"),
          "PRIVATE_GN_ARG_VALUE",
        );
      }
    values[row.name] =
      row[Object.hasOwn(row, "current") ? "current" : "default"].value;
  }
  for (const [name, expected] of Object.entries(
    parentMetadata_QUALIFICATION_DECLARED_ARGS,
  ))
    need(values[name] === expected, "PRIVATE_GN_ARG_CRITICAL");
  for (const [name, expected] of Object.entries(
    parentMetadata_QUALIFICATION_CPU_ARGS,
  ))
    need(values[name] === expected, "PRIVATE_GN_ARG_CPU");
  return {
    kind: "windows-arm-candidate-evaluated-args",
    sha256: hashBytes(raw),
    bytes: raw.length,
    values,
    criticalDeclaredValuesMatch: true,
    builtinCpuRowsRequired: true,
    processProvenanceVerified: false,
    executionAdmitted: false,
  };
}

function parentMetadata_qualificationInspectAction(
  raw,
  role,
  rawPolicy,
  rawCandidatePolicy,
) {
  const { candidate } = parentMetadata_qualificationPolicy(
    rawPolicy,
    rawCandidatePolicy,
  );
  need(["partitionAlloc", "cefConfig"].includes(role), "PRIVATE_GN_DESC_ROLE");
  const expected = candidate.generatedInputs.find((row) => row.role === role),
    label = expected.label;
  const top = parentMetadata_qualificationBoundedJson(raw, 1024 ** 2);
  parentMetadata_qualificationShape(top, [label], "PRIVATE_GN_DESC_LABEL");
  const action = top[label];
  parentMetadata_qualificationShape(
    action,
    [
      "type",
      "toolchain",
      "metadata",
      "visibility",
      "testonly",
      "check_includes_strict",
      "public",
      "script",
      "args",
      "outputs",
      "deps",
      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),
    ],
    "PRIVATE_GN_DESC_FIELDS",
  );
  need(
    action.type === "action" &&
      action.toolchain === parentMetadata_QUALIFICATION_ARM_TOOLCHAIN &&
      parentMetadata_staticProjectionEqual(action.metadata, {}) &&
      action.testonly === false &&
      typeof action.check_includes_strict === "boolean" &&
      action.public === "*",
    "PRIVATE_GN_DESC_ACTION",
  );
  need(
    Array.isArray(action.visibility) &&
      action.visibility.length >= 1 &&
      action.visibility.length <= 128 &&
      action.visibility.every(
        (item) =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= 1024 &&
          !/[^\x20-\x7e]/.test(item),
      ),
    "PRIVATE_GN_DESC_VISIBILITY",
  );
  const out = "//out/Release_GN_arm64/";
  need(
    parentMetadata_staticProjectionEqual(action.outputs, [
      out + expected.relativeOutput,
    ]),
    "PRIVATE_GN_DESC_OUTPUT",
  );
  let macros = null;
  if (role === "partitionAlloc") {
    const prefix = "//base/allocator/partition_allocator/src/partition_alloc";
    need(
      action.script === prefix + "/write_buildflag_header.py" &&
        parentMetadata_staticProjectionEqual(action.args, [
          "--output",
          "base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
          "--rulename",
          label,
          "--gen-dir",
          "gen",
          "--definitions",
          "{{response_file_name}}",
        ]) &&
        parentMetadata_staticProjectionEqual(action.deps, [
          prefix + ":buildflag_macro",
        ]),
      "PRIVATE_GN_DESC_COMMAND",
    );
    const flags = action.response_file_contents,
      names = candidate.partitionAllocMacros;
    need(
      Array.isArray(flags) &&
        flags.length === names.length + 1 &&
        flags[0] === "--flags",
      "PRIVATE_GN_DESC_FLAGS",
    );
    macros = {};
    for (const [index, name] of names.entries()) {
      const flag = flags[index + 1];
      need(
        typeof flag === "string" && flag.startsWith(name + "="),
        "PRIVATE_GN_DESC_FLAG_ORDER",
      );
      const text = flag.slice(name.length + 1);
      if (name === "USER_SPACE_ZERO_SEGMENT_SIZE_MB") {
        need(
          /^(?:0|[1-9][0-9]{0,9})$/.test(text) && Number(text) <= 2147483647,
          "PRIVATE_GN_DESC_FLAG_VALUE",
        );
        macros[name] = Number(text);
      } else {
        need(text === "true" || text === "false", "PRIVATE_GN_DESC_FLAG_VALUE");
        macros[name] = Number(text === "true");
      }
    }
  } else
    need(
      action.script === "//cef/tools/make_config_header.py" &&
        parentMetadata_staticProjectionEqual(action.args, [
          "gen/cef/include/cef_config.h",
          "args.gn",
        ]) &&
        parentMetadata_staticProjectionEqual(action.inputs, [
          out + "args.gn",
        ]) &&
        parentMetadata_staticProjectionEqual(action.deps, [
          "//cef:args_gn_source",
        ]),
      "PRIVATE_GN_DESC_COMMAND",
    );
  return {
    kind: "windows-arm-candidate-action-desc",
    role,
    label,
    bytes: raw.length,
    sha256: hashBytes(raw),
    toolchain: parentMetadata_QUALIFICATION_ARM_TOOLCHAIN,
    outputs: [...action.outputs],
    evaluatedMacroValues: macros,
    actionProjectionMatches: true,
    processProvenanceVerified: false,
    fullArm64DefaultsQualified: false,
    executionAdmitted: false,
  };
}

function parentMetadata_qualificationLines(text) {
  return text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
}

function parentMetadata_qualificationTrim(text) {
  return text.replace(
    new RegExp(
      `^${parentMetadata_QUALIFICATION_PY_SPACE}+|${parentMetadata_QUALIFICATION_PY_SPACE}+$`,
      "gu",
    ),
    "",
  );
}

function parentMetadata_qualificationParseLiteralArgs(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= 1024 ** 2 &&
      !raw.includes(0),
    "QUAL_ARGS_BOUND",
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      raw,
    );
  } catch {
    throw new Error("QUAL_ARGS_ENCODING");
  }
  const expected = {
    ...parentMetadata_QUALIFICATION_CPU_ARGS,
    ...parentMetadata_QUALIFICATION_DECLARED_ARGS,
  };
  delete expected.v8_enable_sandbox;
  const values = {},
    lines = parentMetadata_qualificationLines(text);
  for (const line of lines) {
    const stripped = parentMetadata_qualificationTrim(line);
    if (!stripped || stripped.startsWith("#")) continue;
    const match = parentMetadata_QUALIFICATION_GN_LITERAL.exec(line);
    need(match, "QUAL_ARGS_SYNTAX");
    const [, name, value] = match;
    need(
      !Object.hasOwn(values, name) &&
        ![
          "if",
          "else",
          "foreach",
          "true",
          "false",
          "import",
          "template",
        ].includes(name),
      "QUAL_ARGS_DUPLICATE_OR_KEYWORD",
    );
    values[name] = value;
    if (Object.hasOwn(expected, name))
      need(value === expected[name], "QUAL_ARGS_CRITICAL");
    if (name.includes("sandbox")) need(value === "true", "QUAL_ARGS_SANDBOX");
  }
  need(
    Object.keys(expected).every((name) => Object.hasOwn(values, name)),
    "QUAL_ARGS_CRITICAL",
  );
  return {
    values,
    lines,
    projection: {
      kind: "windows-arm-candidate-args",
      bytes: raw.length,
      sha256: hashBytes(raw),
      criticalLiteralDeclarationsVerified: true,
      evaluatedGnVerified: false,
      generatedSecurityHeadersVerified: false,
      executionAdmitted: false,
    },
  };
}

function parentMetadata_qualificationHeaderText(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= 65536 &&
      !raw.includes(0) &&
      !raw.includes(92),
    "QUAL_HEADER_BOUND",
  );
  need(
    raw.every((byte) => byte < 128),
    "QUAL_HEADER_ENCODING",
  );
  let text = raw.toString("ascii").replaceAll("\r\n", "\n");
  need(!text.includes("\r"), "QUAL_HEADER_ENCODING");
  text = text
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  need(!text.includes("/*") && !text.includes("*/"), "QUAL_HEADER_COMMENT");
  return parentMetadata_qualificationLines(text)
    .map(parentMetadata_qualificationTrim)
    .filter(Boolean);
}

function parentMetadata_qualificationInspectCefHeader(raw) {
  need(
    parentMetadata_staticProjectionEqual(
      parentMetadata_qualificationHeaderText(raw),
      [
        "#ifndef CEF_INCLUDE_CEF_CONFIG_H_",
        "#define CEF_INCLUDE_CEF_CONFIG_H_",
        "#define CEF_V8_ENABLE_SANDBOX 1",
        "#endif",
      ],
    ),
    "QUAL_CEF_CONFIG",
  );
  return {
    kind: "windows-arm-candidate-cef-config-header",
    bytes: raw.length,
    sha256: hashBytes(raw),
    v8SandboxDeclared: true,
    executionAdmitted: false,
  };
}

function parentMetadata_qualificationInspectPaHeader(
  raw,
  candidate,
  evaluatedMacros,
) {
  const lines = parentMetadata_qualificationHeaderText(raw);
  need(
    parentMetadata_staticProjectionEqual(lines.slice(0, 3), [
      "#ifndef " + parentMetadata_QUALIFICATION_PA_GUARD,
      "#define " + parentMetadata_QUALIFICATION_PA_GUARD,
      '#include "partition_alloc/buildflag.h"',
    ]) && parentMetadata_staticProjectionEqual(lines.slice(-1), ["#endif"]),
    "PRIVATE_PA_HEADER",
  );
  const macros = {};
  for (const line of lines.slice(3, -1)) {
    const match =
      /^#define PA_BUILDFLAG_INTERNAL_([A-Z][A-Z0-9_]*)\(\) \((0|[1-9][0-9]{0,9})\)$/.exec(
        line,
      );
    need(match && !Object.hasOwn(macros, match[1]), "PRIVATE_PA_MACRO");
    macros[match[1]] = Number(match[2]);
  }
  need(
    parentMetadata_staticProjectionEqual(
      Object.keys(macros),
      candidate.partitionAllocMacros,
    ) && parentMetadata_staticProjectionEqual(macros, evaluatedMacros),
    "PRIVATE_PA_DESC_HEADER_MISMATCH",
  );
  for (const [name, expected] of Object.entries({
    ...candidate.explicitArgumentInvariants,
    ...candidate.securityPolicyMinimums,
  }))
    need(macros[name] === expected, "PRIVATE_PA_SECURITY_MINIMUM");
  return macros;
}
function parentMetadataProjection(recipeRaw, candidateRaw, files, sourceId) {
  const pa = parentMetadata_qualificationInspectAction(
      files.pa,
      "partitionAlloc",
      recipeRaw,
      candidateRaw,
    ),
    cef = parentMetadata_qualificationInspectAction(
      files.cef,
      "cefConfig",
      recipeRaw,
      candidateRaw,
    ),
    evaluated = parentMetadata_qualificationInspectEvaluatedArgs(
      files.evaluated,
    ),
    literal = parentMetadata_qualificationParseLiteralArgs(files.args),
    { candidate } = parentMetadata_qualificationPolicy(recipeRaw, candidateRaw),
    macros = parentMetadata_qualificationInspectPaHeader(
      files.paHeader,
      candidate,
      pa.evaluatedMacroValues,
    ),
    cefHeader = parentMetadata_qualificationInspectCefHeader(files.cefHeader);
  need(
    literal.lines.includes('target_cpu="arm64"'),
    "SOURCE_METADATA_CPU_LINE",
  );
  for (const [name, value] of Object.entries(literal.values))
    if (Object.hasOwn(evaluated.values, name))
      need(value === evaluated.values[name], "SOURCE_METADATA_ARGS_MISMATCH");
  return {
    kind: "windows-arm-full-source-metadata",
    metadata: { partitionAlloc: pa, cefConfig: cef, arguments: evaluated },
    literalArguments: literal.projection,
    partitionAllocMacros: macros,
    cefHeader,
    policyMinimumsMet: true,
    completeMacroInventoryMatches: true,
    fullArm64DefaultsQualified: false,
    compilerExecuted: false,
    cohortQuietProven: false,
    executionAdmitted: false,
    sourceId,
    roleCount: 4,
  };
}
async function verifySourceMetadata(token) {
  const state = operationState(token);
  need(
    state.creationJoined &&
      !state.metadataSnapshot &&
      state.readFds.size === 0 &&
      state.logFds.size === 0 &&
      state.pendingWriters === 0,
    "SOURCE_METADATA_JOIN",
  );
  await operationFence(token);
  operationState(token);
  state.operationToken = token;
  const codeBinding = await expectedDefaultsCodeBinding(token);
  operationState(token);
  const records = [];
  const read = async (relative, maximum, pin) => {
    const record = await heldOperationFile(token, relative, maximum, pin);
    operationState(token);
    records.push(
      Object.freeze({
        relative,
        maximum,
        pin: Object.freeze({ ...record.pin }),
        identity: record.identity,
      }),
    );
    return record.raw;
  };
  const input = async (name) => {
    const rows = state.plan.producerInputs;
    need(
      Array.isArray(rows) &&
        rows.filter((row) => row.path === name).length === 1,
      "SOURCE_METADATA_INPUT",
    );
    const index = rows.findIndex((row) => row.path === name),
      row = rows[index];
    return read("source-inputs/" + index, 65536, row);
  };
  const recipeRaw = await input(
      "native/windows-arm-full-sdk/private-qualification-profile.json",
    ),
    candidateRaw = await input(
      "native/windows-arm-full-sdk/engine-qualification-profile.json",
    );
  const recipe = parentMetadata_qualificationPolicy(
    recipeRaw,
    candidateRaw,
  ).policy;
  const selected = recipe.images[state.plan.image];
  need(
    selected &&
      selected.sourceId === state.plan.sourceId &&
      selected.profileSha256 === state.plan.profileSha256,
    "SOURCE_METADATA_IMAGE",
  );
  const out = "source-checkout/src/out/Release_GN_arm64/",
    logs = "private-qualification-logs/";
  const pa = await read(logs + "qual-gn-desc-pa.stdout.log", 1048576),
    cef = await read(logs + "qual-gn-desc-cef.stdout.log", 1048576),
    evaluated = await read(logs + "qual-gn-args.stdout.log", 4194304),
    args = await read(out + "args.gn", 1048576),
    paHeader = await read(
      out + recipe.generatedInputs[0].relativeOutput,
      8 * 1024 ** 2,
    ),
    cefHeader = await read(
      out + recipe.generatedInputs[1].relativeOutput,
      8 * 1024 ** 2,
    );
  const originalArgs = state.graphSnapshot?.pins?.find(
    (pin) => pin.path === "args.gn",
  );
  need(
    originalArgs &&
      originalArgs.bytes === args.length &&
      originalArgs.sha256 === hashBytes(args),
    "SOURCE_METADATA_GRAPH_ARGS",
  );
  const projected = parentMetadataProjection(
      recipeRaw,
      candidateRaw,
      { pa, cef, evaluated, args, paHeader, cefHeader },
      state.plan.sourceId,
    ),
    report = parentMetadata_qualificationBoundedJson(
      await read("full-metadata-result.json", 131072),
      131072,
    );
  need(
    parentMetadata_staticProjectionEqual(report, projected),
    "SOURCE_METADATA_REPORT",
  );
  await operationFence(token);
  operationState(token);
  need(
    state.readFds.size === 0 &&
      state.logFds.size === 0 &&
      state.pendingWriters === 0,
    "SOURCE_METADATA_FD_JOIN",
  );
  const matchedExpectedDefaults = expectedDefaultsFact(
    state,
    projected,
    codeBinding,
  );
  operationState(token);
  state.metadataSnapshot = Object.freeze({
    matchedExpectedDefaults,
    records: Object.freeze(records),
    projectionSha256: hashBytes(
      Buffer.from(parentMetadata_qualificationCanonical(projected)),
    ),
    full61Qualified: false,
  });
}
async function recheckSourceMetadata(token, joinedAllowed) {
  const state = operationState(token, joinedAllowed),
    snapshot = state.metadataSnapshot;
  if (!snapshot) return; // Initial graph check precedes the sole metadata issuer.
  const fact = snapshot.matchedExpectedDefaults,
    context = state.plan.rootPins.find(
      (row) => row.relative === "context.json",
    );
  need(
    fact &&
      fact.contextSha256 === context?.sha256 &&
      fact.image === state.plan.image &&
      fact.sourceId === state.plan.sourceId &&
      fact.full61Qualified === false,
    "SOURCE_DEFAULTS_FACT_BINDING",
  );
  const binding = await expectedDefaultsCodeBinding(token, joinedAllowed);
  operationState(token, joinedAllowed);
  need(
    binding.saved.identity === fact.binding.saved.identity &&
      binding.live.identity === fact.binding.live.identity &&
      binding.policySha256 === fact.binding.policySha256,
    "SOURCE_DEFAULTS_BINDING_CHANGED",
  );
  const checked = [];
  for (const row of snapshot.records) {
    const actual = await heldOperationFile(
      token,
      row.relative,
      row.maximum,
      row.pin,
      joinedAllowed,
    );
    operationState(token, joinedAllowed);
    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");
    checkedInputRow(checked, row.relative, actual);
  }
  await operationFence(token, joinedAllowed);
  operationState(token, joinedAllowed);
  return checked;
}
// END PRIVATE PARENT METADATA VERIFICATION

async function verifyNativeSourceRecords(token) {
  const state = operationState(token);
  const records = [];
  const read = async (relative, maximum = 65536) => {
    const record = await heldOperationFile(token, relative, maximum);
    records.push({ relative, ...record });
    return record;
  };
  const launcher = parseRecord(await read("full-source-launcher-result.json"));
  const launcherClose = parseRecord(
    await read("full-source-closed-launcher.json"),
  );
  need(
    launcher.success === true &&
      launcher.sdkBuilt === false &&
      launcher.ownPid === state.creationPid &&
      launcher.ownCreationFiletime === launcherClose.ownCreationFiletime,
    "SOURCE_LAUNCHER_RECORD",
  );
  inspectClose(
    records[1],
    state.creationPid,
    launcher.ownCreationFiletime,
    state.plan.parentCreationFiletime,
  );
  const outer = inspectJob(
    await read("jobs/full-source-operation/receipt.json"),
    true,
  );
  need(
    canonical(launcher.originalOperationJob) === canonical(outer),
    "SOURCE_OUTER_RECEIPT",
  );
  const operationClose = await read(
    "full-source-closed-full-source-operation.json",
  );
  inspectClose(
    operationClose,
    outer.rootPid,
    outer.rootCreationFiletime,
    launcher.ownCreationFiletime,
  );
  const operation = parseRecord(
    await read("full-source-operation-result.json", 131072),
  );
  need(
    operation.kind === "windows-arm-full-source-operation" &&
      operation.success === true &&
      operation.sourceGnVerified === true &&
      operation.sdkBuilt === false &&
      operation.buildAdmission === false &&
      Array.isArray(operation.jobs) &&
      operation.jobs.length === SOURCE_ROLES.length,
    "SOURCE_OPERATION_RESULT",
  );
  const identities = new Set([
    `${outer.rootPid}:${outer.rootCreationFiletime}`,
  ]);
  let sourceJob;
  for (const [index, role] of SOURCE_ROLES.entries()) {
    const job = inspectJob(
      await read(`jobs/${role}/receipt.json`),
      role === "full-sdk-source-gn",
    );
    need(
      operation.jobs[index].role === role &&
        canonical(operation.jobs[index].originalJob) === canonical(job),
      "SOURCE_JOB_BINDING",
    );
    const identity = `${job.rootPid}:${job.rootCreationFiletime}`;
    need(!identities.has(identity), "SOURCE_JOB_IDENTITY_REUSE");
    identities.add(identity);
    if (role === "full-sdk-source-gn") sourceJob = job;
    else
      inspectClose(
        await read(`full-source-closed-${role}.json`),
        job.rootPid,
        job.rootCreationFiletime,
        outer.rootCreationFiletime,
      );
  }
  const setup = parseRecord(await read("full-source-closed-verify-setup.json"));
  inspectClose(
    records.at(-1),
    setup.ownPid,
    setup.ownCreationFiletime,
    sourceJob.rootCreationFiletime,
  );
  const source = parseRecord(await read("full-source-gn-result.json", 131072));
  need(
    source.kind === "windows-arm-source-gn" &&
      source.success === true &&
      source.target === "aarch64-pc-windows-msvc" &&
      source.sourceId === state.plan.sourceId &&
      source.sourceCloseFailure === false &&
      source.sdkBuilt === false &&
      source.nativeAcceptance === false &&
      source.engineCompilationRequested === false &&
      source.outerJobCleanupNotInferred === true,
    "SOURCE_GN_RESULT",
  );
  state.originalRecords = records.map(({ relative, pin, identity }) => ({
    relative,
    pin,
    identity,
  }));
  state.sourceResult = source;
}
async function verifySourceSnapshot(token, joinedAllowed = false) {
  const state = operationState(token, joinedAllowed);
  const checked = [];
  for (const row of state.plan.rootPins) {
    const actual = await heldOperationFile(
      token,
      row.relative,
      row.maximum ?? 2 * 1024 ** 2,
      row,
      joinedAllowed,
    );
    checkedInputRow(checked, row.relative, actual);
  }
  for (const row of state.originalRecords ?? []) {
    const actual = await heldOperationFile(
      token,
      row.relative,
      Math.max(row.pin.bytes, 1),
      row.pin,
      joinedAllowed,
    );
    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");
    checkedInputRow(checked, row.relative, actual);
  }
  const graphRecord = await heldOperationFile(
    token,
    "source-gn-logs/fresh-graph-pins.json",
    16 * 1024 ** 2,
    undefined,
    joinedAllowed,
  );
  checkedInputRow(checked, "source-gn-logs/fresh-graph-pins.json", graphRecord);
  const expected = parseRecord(graphRecord);
  let snapshot,
    callbackFailed = false,
    callbackError,
    calls = 0;
  const summary = await operationWork(
    token,
    () =>
      checkpoint.graphInventory(
        path.join(state.root, "source-checkout/src/out/Release_GN_arm64"),
        {
          timeoutMs: Math.max(
            1,
            Math.floor(Math.min(900000, checkLease(state.lease))),
          ),
          observePins(value) {
            try {
              operationState(token, joinedAllowed);
              need(++calls === 1, "SOURCE_GRAPH_CALLBACK");
              snapshot = JSON.parse(checkpoint.graphPinSnapshot(value));
            } catch (error) {
              callbackFailed = true;
              callbackError = error;
              throw error;
            }
          },
        },
      ),
    undefined,
    joinedAllowed,
  );
  if (callbackFailed) throw callbackError;
  need(
    calls === 1 &&
      snapshot &&
      canonical(snapshot) === canonical(expected) &&
      summary.sha256 === expected.sha256 &&
      state.sourceResult.graph.sha256 === expected.sha256,
    "SOURCE_GRAPH_CHANGED",
  );
  const metadata = await recheckSourceMetadata(token, joinedAllowed);
  if (metadata) checked.push(...metadata);
  await operationFence(token, joinedAllowed);
  state.graphSnapshot = snapshot;
  return checked;
}
// BEGIN PRIVATE INSTALLED TOOL PROOF
const TOOL_PROOF_ROOTS = Object.freeze([
  "include",
  "atlmfc/include",
  "lib/x64",
  "lib/arm64",
  "atlmfc/lib/x64",
  "atlmfc/lib/arm64",
  "bin/Hostx64/x64",
  "bin/Hostx64/arm64",
]);
function inspectInstalledToolProof(raw, baseRaw) {
  const proof = parentMetadata_qualificationBoundedJson(raw, 16 * 1024 ** 2),
    base = JSON.parse(baseRaw);
  parentMetadata_qualificationShape(
    proof,
    [
      "kind",
      "roots",
      "files",
      "bytes",
      "visited",
      "sha256",
      "executed",
      "previous14AreCompleteClosure",
    ],
    "TOOL_PROOF_FIELDS",
  );
  need(
    proof.kind === "windows-arm-full-installed-source-inventory" &&
      canonical(proof.roots) === canonical(TOOL_PROOF_ROOTS) &&
      proof.executed === false &&
      proof.previous14AreCompleteClosure === false &&
      Array.isArray(proof.files) &&
      proof.files.length > 0 &&
      proof.files.length <= base.limits.installedFiles &&
      Number.isSafeInteger(proof.visited) &&
      proof.visited >= proof.files.length &&
      proof.visited <= base.limits.installedFiles &&
      Number.isSafeInteger(proof.bytes) &&
      proof.bytes > 0 &&
      proof.bytes <= base.limits.installedBytes,
    "TOOL_PROOF_SCOPE",
  );
  let previous = "",
    total = 0;
  const folded = new Set(),
    rows = new Map();
  for (const row of proof.files) {
    parentMetadata_qualificationShape(
      row,
      ["path", "bytes", "sha256"],
      "TOOL_PROOF_ROW",
    );
    need(
      typeof row.path === "string" &&
        row.path.length > 0 &&
        row.path.length <= 4096 &&
        !/[\x00-\x1f\x7f:\\]/.test(row.path) &&
        row.path
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        TOOL_PROOF_ROOTS.some((root) => row.path.startsWith(root + "/")) &&
        row.path > previous &&
        !folded.has(row.path.toLowerCase()) &&
        Number.isSafeInteger(row.bytes) &&
        row.bytes >= 0 &&
        row.bytes <= base.limits.installedFileBytes &&
        /^[a-f0-9]{64}$/.test(row.sha256),
      "TOOL_PROOF_ROW_SCOPE",
    );
    previous = row.path;
    folded.add(row.path.toLowerCase());
    rows.set(row.path, row);
    total += row.bytes;
    need(total <= base.limits.installedBytes, "TOOL_PROOF_BYTES");
  }
  // Match Python's fixed json.dumps(...,sort_keys=True,separators=(',',':')).
  const encoded = canonical(proof.files).replace(
    /[\x7f-\uffff]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  need(
    total === proof.bytes && hashBytes(Buffer.from(encoded)) === proof.sha256,
    "TOOL_PROOF_DIGEST",
  );
  const installed14 = Object.freeze({
    "host-cl.exe": "bin/Hostx64/arm64/cl.exe",
    "host-link.exe": "bin/Hostx64/arm64/link.exe",
    "host-lib.exe": "bin/Hostx64/arm64/lib.exe",
    "crt-libcmt.lib": "lib/arm64/libcmt.lib",
    "crt-libcpmt.lib": "lib/arm64/libcpmt.lib",
    "crt-libvcruntime.lib": "lib/arm64/libvcruntime.lib",
    "crt-oldnames.lib": "lib/arm64/oldnames.lib",
    "atl-atls.lib": "atlmfc/lib/arm64/atls.lib",
    "atl-uafxcw.lib": "atlmfc/lib/arm64/uafxcw.lib",
    "header-vcruntime.h": "include/vcruntime.h",
    "header-vector": "include/vector",
    "header-string": "include/string",
    "header-atlbase.h": "atlmfc/include/atlbase.h",
    "header-afxwin.h": "atlmfc/include/afxwin.h",
  });
  need(
    Array.isArray(base.installedMsvc14) &&
      base.installedMsvc14.length === 14 &&
      new Set(base.installedMsvc14.map((row) => row.role)).size === 14,
    "TOOL_PROOF_BASE",
  );
  for (const pin of base.installedMsvc14) {
    const actual = rows.get(installed14[pin.role]);
    need(
      actual && actual.bytes === pin.bytes && actual.sha256 === pin.sha256,
      "TOOL_PROOF_INSTALLED14",
    );
  }
  return Object.freeze({
    files: proof.files.length,
    bytes: total,
    sha256: proof.sha256,
  });
}
async function verifySourceToolProof(token) {
  const state = operationState(token);
  need(state.creationJoined && !state.toolProofSnapshot, "TOOL_PROOF_JOIN");
  const input = state.plan.producerInputs.findIndex(
    (row) => row.path === "native/windows-arm-full-sdk/profile.json",
  );
  need(
    input >= 0 &&
      state.plan.producerInputs[input].sha256 ===
        "ccadcf1fc6f86fe11b922d93c11dc6192ccf571f03c485c610e89938c60b546a",
    "TOOL_PROOF_BASE_PIN",
  );
  const baseRelative = "source-inputs/" + input,
    base = await heldOperationFile(
      token,
      baseRelative,
      65536,
      state.plan.producerInputs[input],
    );
  const relative = "installed-source-inventory.json",
    held = await heldOperationFile(token, relative, 16 * 1024 ** 2);
  operationState(token);
  const projection = inspectInstalledToolProof(held.raw, base.raw);
  await operationFence(token);
  operationState(token);
  state.toolProofSnapshot = Object.freeze({
    projection,
    record: Object.freeze({
      relative,
      maximum: 16 * 1024 ** 2,
      pin: Object.freeze({ ...held.pin }),
      identity: held.identity,
    }),
    base: Object.freeze({
      relative: baseRelative,
      maximum: 65536,
      pin: Object.freeze({ ...base.pin }),
      identity: base.identity,
    }),
  });
}
async function recheckSourceToolProof(token) {
  const state = operationState(token, true),
    snapshot = state.toolProofSnapshot;
  need(
    snapshot &&
      state.sourceReceipt &&
      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,
    "TOOL_PROOF_BINDING",
  );
  const checked = [];
  for (const row of [snapshot.record, snapshot.base]) {
    const actual = await heldOperationFile(
      token,
      row.relative,
      row.maximum,
      row.pin,
      true,
    );
    operationState(token, true);
    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");
    checkedInputRow(checked, row.relative, actual);
  }
  return checked;
}
// END PRIVATE INSTALLED TOOL PROOF

async function recheckSourceReceipt(receipt, leaseToken) {
  const source = sourceState(receipt, leaseToken);
  const state = operationState(source.operationToken, true);
  need(
    state.sourceReceipt === receipt &&
      source.metadataSnapshot === state.metadataSnapshot &&
      state.metadataSnapshot &&
      state.creationJoined &&
      state.logFds.size === 0 &&
      state.readFds.size === 0 &&
      state.pendingWriters === 0,
    "SOURCE_JOIN_CHANGED",
  );
  const checked = await verifySourceSnapshot(source.operationToken, true);
  const tools = await recheckSourceToolProof(source.operationToken);
  operationState(source.operationToken, true);
  return issueCheckedInputObservation(receipt, leaseToken, state, [
    ...checked,
    ...tools,
  ]);
}
function startSourceChild(token) {
  const state = operationState(token);
  need(!state.child, "SOURCE_LAUNCH_REUSE");
  const child = spawn(state.plan.executable, state.plan.argv, {
    cwd: state.root,
    env: state.plan.environment,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  need(child instanceof ChildProcess, "SOURCE_ACTUAL_CHILD");
  state.child = child;
  state.childEvents = {
    spawn: false,
    exit: false,
    close: false,
    stdout: false,
    stderr: false,
    code: undefined,
    signal: undefined,
  };
  state.childJoined = new Promise((resolve) => {
    state.resolveChildJoined = resolve;
  });
  state.ownedListeners = [];
  const listen = (emitter, event, handler, once = false) => {
    const owned = (...args) => {
      if (!state.observationDetached) handler(...args);
    };
    state.ownedListeners.push({ emitter, event, owned });
    if (once) emitter.once(event, owned);
    else emitter.on(event, owned);
  };
  const maybeJoined = () => {
    const e = state.childEvents;
    if (!state.observationDetached && e.close && e.stdout && e.stderr)
      state.resolveChildJoined();
  };
  listen(
    child,
    "spawn",
    () => {
      state.childEvents.spawn = true;
      state.creationPid = child.pid;
    },
    true,
  );
  const stop = (error) => {
    fail(state, error);
    if (!state.childEvents.exit && !state.childEvents.close) {
      try {
        child.kill();
      } catch {
        state.cleanupConfirmed = false;
      }
    }
  };
  listen(child, "error", stop, true);
  listen(
    child,
    "exit",
    (code, signal) => {
      state.childEvents.exit = true;
      state.childEvents.code = code;
      state.childEvents.signal = signal;
    },
    true,
  );
  listen(
    child,
    "close",
    (code, signal) => {
      state.childEvents.close = true;
      state.childEvents.closeCode = code;
      state.childEvents.closeSignal = signal;
      maybeJoined();
    },
    true,
  );
  for (const [name, stream, fd] of [
    ["stdout", child.stdout, state.stdoutFd],
    ["stderr", child.stderr, state.stderrFd],
  ]) {
    need(stream && fd, "SOURCE_PIPES");
    listen(stream, "data", (chunk) => {
      if (state.closed || state.failed) return;
      state.outputBytes += chunk.length;
      if (state.outputBytes > SOURCE_LOG_CAP) {
        stop(new Error("FULL_SDK_CONTROL_SOURCE_OUTPUT_CAP"));
        return;
      }
      state.pendingWriters++;
      state.writeQueue = state.writeQueue
        .then(async () => {
          if (state.closed || state.failed) return;
          await fd.writeFile(chunk);
        })
        .catch((error) => {
          stop(error);
        })
        .finally(() => state.pendingWriters--);
    });
    listen(stream, "error", stop, true);
    listen(
      stream,
      "close",
      () => {
        state.childEvents[name] = true;
        maybeJoined();
      },
      true,
    );
  }
  return child;
}
function releaseSourceObservation(state) {
  state.observationDetached = true;
  for (const { emitter, event, owned } of state.ownedListeners ?? [])
    emitter.removeListener(event, owned);
  state.ownedListeners = [];
  const child = state.child;
  if (child instanceof ChildProcess) {
    for (const stream of [child.stdout, child.stderr])
      if (stream) {
        stream.on("error", ignoreOwnedLateError);
        if (!state.childEvents?.close)
          try {
            stream.destroy();
          } catch (error) {
            state.cleanupConfirmed = false;
            fail(state, error);
          }
      }
    child.on("error", ignoreOwnedLateError);
    if (!state.childEvents?.close)
      try {
        child.unref();
      } catch (error) {
        state.cleanupConfirmed = false;
        fail(state, error);
      }
  }
  state.child = null;
  state.childJoined = null;
  state.resolveChildJoined = null;
  state.stdoutFd = null;
  state.stderrFd = null;
}
async function closeSourceLogs(state) {
  await state.writeQueue;
  let failed = false,
    primary;
  for (const fd of [...state.logFds]) {
    try {
      await fd.close();
      state.logFds.delete(fd);
    } catch (error) {
      state.cleanupConfirmed = false;
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
  need(state.pendingWriters === 0, "SOURCE_LOG_WRITERS");
}
async function runSourcePhase(token) {
  const state = operationState(token);
  need(!state.issued && !state.child, "SOURCE_PHASE_REUSE");
  try {
    await operationFence(token);
    for (const [property, name] of [
      ["stdoutFd", "source-launcher.stdout.log"],
      ["stderrFd", "source-launcher.stderr.log"],
    ]) {
      await operationFence(token);
      const fd = await operationWork(
        token,
        () =>
          fs.open(
            path.join(state.root, name),
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              (constants.O_NOFOLLOW ?? 0),
            0o600,
          ),
        (late) => late.close(),
      );
      state[property] = fd;
      state.logFds.add(fd);
    }
    await operationFence(token);
    operationState(token);
    startSourceChild(token);
    await operationWork(token, () => state.childJoined);
    const e = state.childEvents;
    need(
      e.spawn &&
        e.exit &&
        e.close &&
        e.stdout &&
        e.stderr &&
        e.code === 0 &&
        e.signal === null &&
        e.closeCode === 0 &&
        e.closeSignal === null &&
        Number.isSafeInteger(state.creationPid) &&
        state.creationPid > 0,
      "SOURCE_CHILD_JOIN",
    );
    await operationWork(token, () => closeSourceLogs(state));
    need(
      state.readFds.size === 0 &&
        state.logFds.size === 0 &&
        state.pendingWriters === 0,
      "SOURCE_FD_JOIN",
    );
    state.creationJoined = true;
    await verifyNativeSourceRecords(token);
    await verifySourceSnapshot(token);
    await verifySourceMetadata(token);
    await verifySourceToolProof(token);
    await recheckSourceMetadata(token, false);
    operationState(token);
    const receipt = Object.freeze({
      kind: "closed-full-sdk-created-source-session",
    });
    const source = {
      lease: state.lease,
      stage: "joined-success",
      pendingWriters: 0,
      creationJoined: true,
      image: state.plan.image,
      target: "aarch64-pc-windows-msvc",
      sourceId: state.plan.sourceId,
      profileSha256: state.plan.profileSha256,
      root: state.root,
      rootIdentity: state.rootIdentity,
      operationToken: token,
      metadataSnapshot: state.metadataSnapshot,
      toolProofSnapshot: state.toolProofSnapshot,
    };
    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.
    sourceSessions.set(receipt, source);
    state.sourceReceipt = receipt;
    state.issued = true;
    return receipt;
  } catch (error) {
    // BEGIN SAFE SOURCE CHILD FAILURE CAPTURE
    captureSourceChildFailure(error, state);
    // END SAFE SOURCE CHILD FAILURE CAPTURE
    fail(state, error);
    await retireSourceOperation(token);
    throw state.primary;
  }
}
async function retireSourceOperation(token) {
  const state = sourceOperations.get(token);
  if (!state) return;
  if (state.retirement) return state.retirement;
  state.closed = true;
  sourceOperations.delete(token);
  if (state.sourceReceipt) sourceSessions.delete(state.sourceReceipt);
  const lease = leases.get(state.lease);
  state.cleanupEnd = Math.min(
    performance.now() + CLEANUP_MS,
    lease.monoEnd - FINAL_RESERVE_MS,
  );
  state.cleanupWallEnd = Math.min(
    Date.now() + CLEANUP_MS,
    lease.wallEnd - FINAL_RESERVE_MS,
  );
  state.retirement = (async () => {
    let unknown = false;
    const attempt = async (action) => {
      try {
        await cleanupStep(state, action);
        return true;
      } catch (error) {
        unknown = true;
        fail(state, error);
        return false;
      }
    };
    // Start release of every owned FD before a missing child close can consume
    // the original cleanup allowance. Late completion never upgrades its result.
    const closing = [];
    const startClose = (action) => {
      const pending = Promise.resolve().then(action);
      pending.catch((error) => fail(state, error));
      closing.push(pending);
    };
    startClose(() => closeSourceLogs(state));
    for (const fd of [...state.readFds])
      startClose(async () => {
        await fd.close();
        state.readFds.delete(fd);
      });
    if (state.owner) {
      const owner = state.owner;
      state.owner = null;
      startClose(() => owner.close());
    }
    try {
      if (
        state.child &&
        !state.childEvents?.exit &&
        !state.childEvents?.close
      ) {
        try {
          state.child.kill();
        } catch (error) {
          unknown = true;
          fail(state, error);
        }
      }
      if (state.childJoined) await attempt(() => state.childJoined);
      for (const pending of closing) await attempt(() => pending);
      await attempt(async () =>
        need(
          state.pending.size === 0 &&
            state.lateCleanups.size === 0 &&
            state.pendingWriters === 0 &&
            state.logFds.size === 0 &&
            state.readFds.size === 0,
          "SOURCE_CLEANUP_UNKNOWN",
        ),
      );
      state.cleanupConfirmed = !unknown;
    } finally {
      releaseSourceObservation(state);
    }
  })();
  await state.retirement;
}
const ignoreOwnedLateError = () => {};
const CLOCK_PROGRAM = `import ctypes as C,json,os,time
from ctypes import wintypes as W
k=C.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.restype=W.HANDLE;k.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD]
k.GetProcessTimes.argtypes=[W.HANDLE,*([C.POINTER(W.FILETIME)]*4)];k.GetProcessTimes.restype=W.BOOL
k.CloseHandle.argtypes=[W.HANDLE];k.CloseHandle.restype=W.BOOL
h=k.OpenProcess(0x100000|0x1000,False,os.getppid())
if not h:raise RuntimeError('CLOCK_PARENT_HANDLE')
f=[W.FILETIME()for _ in range(4)]
try:
 if not k.GetProcessTimes(h,*[C.byref(x)for x in f]):raise RuntimeError('CLOCK_PARENT_IDENTITY')
 value=dict(monotonic=time.monotonic(),parentPid=os.getppid(),parentCreationFiletime=str((f[0].dwHighDateTime<<32)|f[0].dwLowDateTime))
finally:
 if not k.CloseHandle(h):raise RuntimeError('CLOCK_PARENT_CLOSE')
print(json.dumps(value,separators=(',',':')))
`;
async function samplePythonClock(bootstrap, python, environment) {
  const owner = bootstrapState(bootstrap),
    lease = leases.get(owner.lease);
  need(!owner.clockProbe, "CLOCK_REUSE");
  const probe = {
    failed: false,
    primary: undefined,
    rootExited: false,
    rootClosed: false,
    stdoutClosed: false,
    stderrClosed: false,
    joined: false,
    cleanupConfirmed: false,
    retired: false,
    dataAccepted: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    killAttempted: false,
  };
  owner.clockProbe = probe;
  const workWallEnd = Math.min(
    Date.now() + 10000,
    lease.wallEnd - CLEANUP_MS - FINAL_RESERVE_MS,
  );
  const workMonoEnd = Math.min(
    performance.now() + 10000,
    lease.monoEnd - CLEANUP_MS - FINAL_RESERVE_MS,
  );
  let child, workTimer, joinTimer, cleanupWallEnd, cleanupMonoEnd;
  let stdout = [],
    stderr = [],
    resolveJoined,
    resolveStopped;
  const joined = new Promise((resolve) => {
    resolveJoined = resolve;
  });
  const stopped = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const listeners = [];
  const listen = (emitter, event, handler, once = false) => {
    listeners.push({ emitter, event, handler });
    if (event === "abort") emitter.addEventListener(event, handler, { once });
    else if (once) emitter.once(event, handler);
    else emitter.on(event, handler);
  };
  const remaining = (wallEnd, monoEnd) =>
    Math.min(wallEnd - Date.now(), monoEnd - performance.now());
  const maybeJoined = () => {
    if (
      !probe.retired &&
      probe.rootClosed &&
      probe.stdoutClosed &&
      probe.stderrClosed
    ) {
      probe.joined = true;
      resolveJoined();
    }
  };
  const stop = (error) => {
    if (probe.retired) return;
    if (!probe.failed) {
      probe.failed = true;
      probe.primary = error;
      clearTimeout(workTimer);
      cleanupWallEnd = Math.min(
        Date.now() + CLEANUP_MS,
        workWallEnd + CLEANUP_MS,
        lease.wallEnd - FINAL_RESERVE_MS,
      );
      cleanupMonoEnd = Math.min(
        performance.now() + CLEANUP_MS,
        workMonoEnd + CLEANUP_MS,
        lease.monoEnd - FINAL_RESERVE_MS,
      );
      resolveStopped();
    }
    if (
      child &&
      !probe.rootExited &&
      !probe.rootClosed &&
      !probe.killAttempted
    ) {
      probe.killAttempted = true;
      try {
        child.kill();
      } catch {
        /* Original failure and unknown closure remain. */
      }
    }
  };
  const capture = (name, parts, chunk) => {
    if (probe.failed || probe.retired) return;
    const available = 2048 - probe[name];
    if (available > 0) {
      const retained = chunk.subarray(0, available);
      parts.push(retained);
      probe[name] += retained.length;
    }
    if (chunk.length > available)
      stop(new Error("FULL_SDK_CONTROL_CLOCK_BOUND"));
  };
  try {
    child = spawn(python, ["-I", "-B", "-c", CLOCK_PROGRAM], {
      env: environment,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    need(child instanceof ChildProcess, "CLOCK_ACTUAL_CHILD");
    probe.child = child;
    need(child.stdout && child.stderr, "CLOCK_PIPES");
    listen(child.stdout, "data", (chunk) =>
      capture("stdoutBytes", stdout, chunk),
    );
    listen(child.stderr, "data", (chunk) =>
      capture("stderrBytes", stderr, chunk),
    );
    listen(child.stdout, "error", stop);
    listen(child.stderr, "error", stop);
    listen(
      child.stdout,
      "close",
      () => {
        if (!probe.retired) {
          probe.stdoutClosed = true;
          maybeJoined();
        }
      },
      true,
    );
    listen(
      child.stderr,
      "close",
      () => {
        if (!probe.retired) {
          probe.stderrClosed = true;
          maybeJoined();
        }
      },
      true,
    );
    listen(child, "error", stop);
    listen(
      child,
      "exit",
      (code, signal) => {
        if (!probe.retired) {
          probe.rootExited = true;
          probe.exitCode = code;
          probe.exitSignal = signal;
        }
      },
      true,
    );
    listen(
      child,
      "close",
      (code, signal) => {
        if (!probe.retired) {
          probe.rootClosed = true;
          probe.closeCode = code;
          probe.closeSignal = signal;
          maybeJoined();
        }
      },
      true,
    );
    workTimer = setTimeout(
      () => stop(new Error("FULL_SDK_CONTROL_CLOCK_DEADLINE")),
      Math.max(0, remaining(workWallEnd, workMonoEnd)),
    );
    const signal = lease.signal;
    const abort = () => stop(signal.reason);
    if (signal) {
      listen(signal, "abort", abort, true);
      if (signal.aborted) abort();
    }
    await Promise.race([joined, stopped]);
    if (probe.failed) throw probe.primary;
    bootstrapState(bootstrap);
    need(
      probe.joined &&
        probe.rootExited &&
        probe.exitCode === 0 &&
        probe.exitSignal === null &&
        probe.closeCode === 0 &&
        probe.closeSignal === null &&
        probe.stderrBytes === 0,
      "CLOCK_JOIN",
    );
    const value = JSON.parse(Buffer.concat(stdout).toString("utf8"));
    need(
      Number.isFinite(value.monotonic) &&
        value.monotonic > 0 &&
        value.parentPid === process.pid &&
        /^[1-9][0-9]{0,19}$/.test(value.parentCreationFiletime),
      "CLOCK_SAMPLE",
    );
    probe.cleanupConfirmed = true;
    probe.dataAccepted = true;
    return value;
  } catch (error) {
    stop(error);
    if (!probe.joined && child) {
      try {
        const allowance = remaining(cleanupWallEnd, cleanupMonoEnd);
        need(Number.isFinite(allowance) && allowance > 0, "CLOCK_JOIN_UNKNOWN");
        await Promise.race([
          joined,
          new Promise((_, reject) => {
            joinTimer = setTimeout(
              () => reject(new Error("FULL_SDK_CONTROL_CLOCK_JOIN_UNKNOWN")),
              allowance,
            );
          }),
        ]);
        need(
          probe.joined && remaining(cleanupWallEnd, cleanupMonoEnd) >= 0,
          "CLOCK_JOIN_UNKNOWN",
        );
        probe.cleanupConfirmed = true;
      } catch {
        probe.cleanupConfirmed = false;
      }
    } else probe.cleanupConfirmed = probe.joined;
    throw probe.primary;
  } finally {
    probe.retired = true;
    clearTimeout(workTimer);
    clearTimeout(joinTimer);
    for (const { emitter, event, handler } of listeners) {
      if (event === "abort") emitter.removeEventListener(event, handler);
      else emitter.removeListener(event, handler);
    }
    if (child instanceof ChildProcess) {
      // Only this creation's pipes/ref are released. A missing root close stays
      // unknown; detaching never synthesizes a join or a successful clock sample.
      for (const stream of [child.stdout, child.stderr])
        if (stream) {
          stream.on("error", ignoreOwnedLateError);
          if (!probe.joined) stream.destroy();
        }
      child.on("error", ignoreOwnedLateError);
      if (!probe.joined) child.unref();
    }
    probe.child = null;
    stdout = [];
    stderr = [];
  }
}
// BEGIN BOUNDED BOOTSTRAP FILE READER
// Read-only, creation-owned FDs. These bytes never issue a source capability.
async function bootstrapHeldFile(bootstrap, file, maximum, expected) {
  const owner = bootstrapState(bootstrap),
    lease = leases.get(owner.lease);
  need(
    typeof file === "string" &&
      path.isAbsolute(file) &&
      Number.isSafeInteger(maximum) &&
      maximum > 0 &&
      maximum <= 268435456,
    "BOOTSTRAP_FILE_SCOPE",
  );
  file = path.resolve(file);
  const wallEnd = Math.min(
      lease.wallEnd - CLEANUP_MS - FINAL_RESERVE_MS,
      owner.wallStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,
    ),
    monoEnd = Math.min(
      lease.monoEnd - CLEANUP_MS - FINAL_RESERVE_MS,
      owner.monoStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,
    );
  owner.bootstrapFds ??= new Set();
  owner.bootstrapPending ??= new Set();
  let failed = false,
    primary,
    fd,
    raw,
    identity;
  const remember = (error) => {
    if (!failed) {
      failed = true;
      primary = error;
    }
  };
  const remaining = () => {
    bootstrapState(bootstrap);
    const left = Math.min(
      wallEnd - Date.now(),
      monoEnd - performance.now(),
      checkLease(owner.lease),
    );
    need(left > 0, "BOOTSTRAP_READ_DEADLINE");
    return left;
  };
  const wait = async (action, late) => {
    const ms = remaining();
    let timer,
      abort,
      settled = false,
      received = false,
      value;
    const pending = Promise.resolve().then(() => {
      remaining();
      return action();
    });
    owner.bootstrapPending.add(pending);
    pending.then(
      (value) => {
        owner.bootstrapPending.delete(pending);
        if (settled && late)
          Promise.resolve()
            .then(() => late(value))
            .catch(remember);
      },
      () => owner.bootstrapPending.delete(pending),
    );
    try {
      value = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("FULL_SDK_CONTROL_BOOTSTRAP_READ_DEADLINE")),
            ms,
          );
          abort = () => reject(lease.signal.reason);
          lease.signal?.addEventListener("abort", abort, { once: true });
          if (lease.signal?.aborted) abort();
        }),
      ]);
      received = true;
      remaining();
      settled = true;
      return value;
    } catch (error) {
      settled = true;
      if (received && late)
        Promise.resolve()
          .then(() => late(value))
          .catch(remember);
      throw error;
    } finally {
      clearTimeout(timer);
      lease.signal?.removeEventListener("abort", abort);
    }
  };
  const ancestors = [];
  const fence = async () => {
    for (const entry of ancestors)
      need(
        operationDirectoryId(
          await wait(() => fs.lstat(entry.path, { bigint: true })),
        ) === entry.identity,
        "BOOTSTRAP_ANCESTOR_CHANGED",
      );
    need(
      (await wait(() => fs.realpath(file))) === file,
      "BOOTSTRAP_FILE_ALIAS",
    );
  };
  try {
    for (let current = path.dirname(file); ; current = path.dirname(current)) {
      ancestors.push({
        path: current,
        identity: operationDirectoryId(
          await wait(() => fs.lstat(current, { bigint: true })),
        ),
      });
      if (current === path.dirname(current)) break;
    }
    await fence();
    const named = await wait(() => fs.lstat(file, { bigint: true }));
    identity = fileId(named);
    need(
      named.size >= 0n && named.size <= BigInt(maximum),
      "BOOTSTRAP_FILE_BOUND",
    );
    const closeLate = async (value) => {
      await value.close();
      owner.bootstrapFds.delete(value);
    };
    fd = await wait(
      () =>
        fs
          .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          .then((value) => {
            owner.bootstrapFds.add(value);
            return value;
          }),
      closeLate,
    );
    const held = await wait(() => fd.stat({ bigint: true }));
    need(
      held.size >= 0n && held.size <= BigInt(maximum),
      "BOOTSTRAP_FILE_BOUND",
    );
    need(
      fileId(held) === identity &&
        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,
      "BOOTSTRAP_FILE_CHANGED",
    );
    // The bound is checked on the held FD BEFORE allocating. One sentinel byte
    // detects growth; no request or allocation can exceed the original max+1.
    const buffer = Buffer.alloc(Number(held.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const value = await wait(() =>
        fd.read(buffer, count, buffer.length - count, count),
      );
      if (!value.bytesRead) break;
      count += value.bytesRead;
    }
    need(
      count === Number(held.size) && count <= maximum,
      "BOOTSTRAP_FILE_GROWTH",
    );
    need(
      fileId(await wait(() => fd.stat({ bigint: true }))) === identity &&
        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,
      "BOOTSTRAP_FILE_CHANGED",
    );
    raw = buffer.subarray(0, count);
    if (expected)
      need(
        raw.length === expected.bytes && hashBytes(raw) === expected.sha256,
        "BOOTSTRAP_FILE_PIN",
      );
    await fence();
    remaining();
  } catch (error) {
    remember(error);
  } finally {
    if (fd) {
      const cleanup = owner.bootstrapFailureCleanup ?? {
        cleanupEnd: Math.min(
          performance.now() + CLEANUP_MS,
          lease.monoEnd - FINAL_RESERVE_MS,
        ),
        cleanupWallEnd: Math.min(
          Date.now() + CLEANUP_MS,
          lease.wallEnd - FINAL_RESERVE_MS,
        ),
      };
      if (failed) owner.bootstrapFailureCleanup ??= cleanup;
      try {
        await cleanupStep(cleanup, async () => {
          await fd.close();
          owner.bootstrapFds.delete(fd);
        });
      } catch (error) {
        owner.bootstrapFailureCleanup ??= cleanup;
        remember(error);
      }
    }
  }
  if (failed) throw primary;
  await fence();
  remaining();
  need(owner.bootstrapFds.size === 0, "BOOTSTRAP_FD_JOIN");
  return { raw, identity, pin: { bytes: raw.length, sha256: hashBytes(raw) } };
}
// END BOUNDED BOOTSTRAP FILE READER

// BEGIN FIXED RESTORE HANDOFF
function producerInputDigest(rows) {
  need(
    Array.isArray(rows) &&
      rows.length > 0 &&
      rows.length <= 128 &&
      new Set(rows.map((row) => row.path.toLowerCase())).size === rows.length,
    "PRODUCER_INPUTS",
  );
  return hashBytes(
    Buffer.from(
      canonical(
        [...rows]
          .map((row) => ({
            path: row.path,
            bytes: row.bytes,
            sha256: row.sha256,
          }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    ),
  );
}
async function readRestoreHandoff(bootstrap, rows, image, sourceId) {
  bootstrapState(bootstrap);
  const requested = process.env.CEF_FULLSDK_RESTORE_RUN;
  if (requested === "0") return null;
  need(/^[1-9][0-9]{0,19}$/.test(requested ?? ""), "RESTORE_RUN");
  const temp = path.resolve(CONTROLLER_REPO, "../../_temp");
  need(path.resolve(process.env.RUNNER_TEMP ?? "") === temp, "RESTORE_TEMP");
  const directory = path.join(
    temp,
    `sorng-windows-arm-checkpoint-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
  );
  need((await fs.realpath(directory)) === directory, "RESTORE_ALIAS");
  bootstrapState(bootstrap);
  for (let current = directory; ; current = path.dirname(current)) {
    directoryId(await fs.lstat(current, { bigint: true }));
    bootstrapState(bootstrap);
    if (current === path.dirname(current)) break;
  }
  const file = path.join(directory, "ready.json"),
    before = await fs.lstat(file, { bigint: true });
  bootstrapState(bootstrap);
  const identity = fileId(before);
  need(
    before.size > 0n && before.size <= 2n * 1024n ** 2n,
    "RESTORE_READY_BOUND",
  );
  const heldReady = await bootstrapHeldFile(bootstrap, file, 2 * 1024 ** 2);
  need(heldReady.identity === identity, "RESTORE_READY_CHANGED");
  const raw = heldReady.raw;
  bootstrapState(bootstrap);
  need(
    raw.length === Number(before.size) &&
      fileId(await fs.lstat(file, { bigint: true })) === identity,
    "RESTORE_READY_CHANGED",
  );
  bootstrapState(bootstrap);
  const ready = JSON.parse(raw);
  parentMetadata_qualificationShape(
    ready,
    [
      "kind",
      "schemaVersion",
      "record",
      "priorRunId",
      "priorAttempt",
      "currentRunId",
      "currentAttempt",
      "head",
      "identity",
      "sealArtifact",
    ],
    "RESTORE_READY_FIELDS",
  );
  need(
    ready.kind === "windows-arm-full-sdk-checkpoint-download" &&
      ready.schemaVersion === 1 &&
      ready.priorRunId === requested &&
      /^[1-9][0-9]{0,8}$/.test(ready.priorAttempt) &&
      ready.currentRunId === process.env.GITHUB_RUN_ID &&
      ready.currentAttempt === process.env.GITHUB_RUN_ATTEMPT &&
      /^[a-f0-9]{40}$/.test(ready.head),
    "RESTORE_READY_SCOPE",
  );
  parentMetadata_qualificationShape(
    ready.sealArtifact,
    ["id", "bytes", "sha256"],
    "RESTORE_ARTIFACT_FIELDS",
  );
  need(
    Number.isSafeInteger(ready.sealArtifact.id) &&
      ready.sealArtifact.id > 0 &&
      Number.isSafeInteger(ready.sealArtifact.bytes) &&
      ready.sealArtifact.bytes > 0 &&
      ready.sealArtifact.bytes <= 3 * 1024 ** 2 &&
      /^[a-f0-9]{64}$/.test(ready.sealArtifact.sha256),
    "RESTORE_ARTIFACT_PIN",
  );
  const source = ready.identity;
  parentMetadata_qualificationShape(
    source,
    [
      "image",
      "sourceId",
      "producerSha256",
      "sourceDateEpoch",
      "canonicalRoot",
      "toolProofPin",
      "graphPin",
    ],
    "RESTORE_IDENTITY_FIELDS",
  );
  need(
    source.image === image &&
      source.sourceId === sourceId &&
      source.producerSha256 === producerInputDigest(rows) &&
      source.canonicalRoot === fullSdkSourceRootName(image, sourceId) &&
      canonical(source.sourceDateEpoch) ===
        canonical({ present: false, value: null }),
    "RESTORE_SOURCE_IDENTITY",
  );
  for (const [pin, max] of [
    [ready.record, 2 * 1024 ** 2],
    [source.toolProofPin, 16 * 1024 ** 2],
    [source.graphPin, 16 * 1024 ** 2],
  ]) {
    parentMetadata_qualificationShape(
      pin,
      ["bytes", "sha256"],
      "RESTORE_PIN_FIELDS",
    );
    need(
      Number.isSafeInteger(pin.bytes) &&
        pin.bytes > 0 &&
        pin.bytes <= max &&
        /^[a-f0-9]{64}$/.test(pin.sha256),
      "RESTORE_PIN",
    );
  }
  bootstrapState(bootstrap);
  return Object.freeze({
    runId: ready.priorRunId,
    attempt: ready.priorAttempt,
    readyPin: Object.freeze({ bytes: raw.length, sha256: hashBytes(raw) }),
  });
}
// END FIXED RESTORE HANDOFF

function sourceContextRecord(token, profile, policy, policyRaw, sample) {
  const state = operationState(token),
    owner = bootstrapState(state.bootstrap),
    selected = sources[process.env.ImageVersion];
  need(selected, "SOURCE_IMAGE");
  const wholeRemaining =
    Math.min(
      leases.get(owner.lease).wallEnd - Date.now(),
      leases.get(owner.lease).monoEnd - performance.now(),
    ) / 1000;
  const sourceRemaining =
    Math.min(
      state.sourceWallEnd - Date.now(),
      state.sourceMonoEnd - performance.now(),
    ) / 1000;
  const acquisitionRemaining =
    Math.min(
      ACQUISITION_MS - (Date.now() - owner.wallStart),
      ACQUISITION_MS - (performance.now() - owner.monoStart),
      sourceRemaining * 1000,
    ) / 1000;
  const c = {
    kind: "windows-arm-full-sdk-context",
    mode: "full-sdk-source-gn",
    workflow: profile.workflow,
    policy: profile.policy,
    ref: "refs/heads/main",
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    event: "workflow_dispatch",
    visibility: "public",
    defaultBranch: "main",
    inputs: { restore_run: process.env.CEF_FULLSDK_RESTORE_RUN },
    checkpointRestore: owner.checkpointRestore ?? null,
    image: process.env.ImageVersion,
    target: "aarch64-pc-windows-msvc",
    sourceId: selected.id,
    sourceProfileSha256: selected.profile,
    head: process.env.GITHUB_SHA,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sources: policy.producerInputs,
    originPolicySha256: hashBytes(policyRaw),
    wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,
    monotonicWholeEnd: sample.monotonic + wholeRemaining,
    wallWorkEnd: state.sourceWallEnd / 1000,
    monotonicWorkEnd: sample.monotonic + sourceRemaining,
    wallAcquisitionEnd:
      Math.min(state.sourceWallEnd, owner.wallStart + ACQUISITION_MS) / 1000,
    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,
  };
  need(
    sourceRemaining > 150 && acquisitionRemaining > 150,
    "SOURCE_ORIGINAL_BUDGET",
  );
  operationState(token);
  return c; // Accounting/identity DATA only; no source/session is issued.
}

// BEGIN BOUNDED STARTUP OBSERVABILITY
// Diagnostic DATA only. No path/message/env/stack or capability is serialized.
const startupErrorContexts = new WeakMap();
// BEGIN SAFE SOURCE CHILD FAILURE DATA
const sourceChildFailures = new WeakMap();
function captureSourceChildFailure(error, state) {
  // Copied observations only. Never read caller error fields, logs or paths,
  // and never let diagnostic preparation change the original failure.
  try {
    if (
      utilTypes.isProxy(error) ||
      !utilTypes.isNativeError(error) ||
      sourceChildFailures.has(error) ||
      !(state.child instanceof ChildProcess) ||
      !state.childEvents
    )
      return;
    const e = state.childEvents;
    const exitCode = (value) =>
      Number.isSafeInteger(value) && value >= -2147483648 && value <= 4294967295
        ? value
        : null;
    const signal = (value) =>
      ["SIGTERM", "SIGKILL", "SIGABRT", "SIGINT"].includes(value)
        ? value
        : null;
    const observed = {
      phase: "source-launch",
      spawned: e.spawn === true,
      exited: e.exit === true,
      closed: e.close === true,
      stdoutClosed: e.stdout === true,
      stderrClosed: e.stderr === true,
      exitCode: exitCode(e.code),
      closeCode: exitCode(e.closeCode),
      exitSignal: signal(e.signal),
      closeSignal: signal(e.closeSignal),
      capturedBytes:
        Number.isSafeInteger(state.outputBytes) && state.outputBytes >= 0
          ? Math.min(state.outputBytes, SOURCE_LOG_CAP)
          : null,
    };
    sourceChildFailures.set(error, Object.freeze(observed));
  } catch {
    /* Diagnostic failure cannot replace a primary, including false. */
  }
}
// END SAFE SOURCE CHILD FAILURE DATA
const STARTUP_FILE_KINDS = Object.freeze({
  initial: "none",
  profile: "profile",
  policy: "policy",
  workflow: "workflow",
  scope: "none",
  node: "node",
  python: "python",
  "workflow-clock": "clock",
  "parent-clock": "clock",
  "root-module": "root-module",
  "source-root": "source-root",
  "source-input": "producer-input",
  "source-context": "context",
  "source-launch": "launcher",
});
// BEGIN FIXED WORKFLOW CLOCK FAILURE CODES
const STARTUP_CLOCK_ERRORS = new Set([
  "FULL_SDK_WORKFLOW_CLOCK_RAW",
  "FULL_SDK_WORKFLOW_CLOCK_FIELDS",
  "FULL_SDK_WORKFLOW_CLOCK_KIND",
  "FULL_SDK_WORKFLOW_CLOCK_INTEGER",
  "FULL_SDK_WORKFLOW_CLOCK_WALL_DEADLINE",
  "FULL_SDK_WORKFLOW_CLOCK_SCOPE",
  "FULL_SDK_WORKFLOW_CLOCK_EXECUTION",
  "FULL_SDK_WORKFLOW_CLOCK_HOST",
  "FULL_SDK_WORKFLOW_CLOCK_TICK_DEADLINE",
  "FULL_SDK_WORKFLOW_CLOCK_PROJECTION",
  "FULL_SDK_WORKFLOW_CLOCK_EXPIRED",
]);
// END FIXED WORKFLOW CLOCK FAILURE CODES
const STARTUP_ERROR_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENFILE",
  "EBADF",
  "EIO",
  "EINVAL",
  "ENOSPC",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
  "ERR_ACCESS_DENIED",
]);
const STARTUP_SYSCALLS = new Set([
  "open",
  "lstat",
  "stat",
  "realpath",
  "read",
  "write",
  "close",
  "spawn",
  "mkdir",
]);
function observeStartupPhase(bootstrap, phase) {
  const owner = bootstrapOwners.get(bootstrap);
  need(owner && !owner.closed && owner.pid === process.pid, "BOOTSTRAP_BRAND");
  need(Object.hasOwn(STARTUP_FILE_KINDS, phase), "BOOTSTRAP_PHASE");
  owner.startupPhase = phase;
}
function captureStartupFailure(bootstrap, error) {
  const owner = bootstrapOwners.get(bootstrap);
  if (
    !owner ||
    owner.closed ||
    owner.pid !== process.pid ||
    utilTypes.isProxy(error) ||
    !utilTypes.isNativeError(error) ||
    startupErrorContexts.has(error)
  )
    return;
  const phase = Object.hasOwn(STARTUP_FILE_KINDS, owner.startupPhase)
    ? owner.startupPhase
    : "initial";
  startupErrorContexts.set(
    error,
    Object.freeze({ phase, fileKind: STARTUP_FILE_KINDS[phase] }),
  );
}
function startupFailureReport(error) {
  const native = !utilTypes.isProxy(error) && utilTypes.isNativeError(error);
  const own = (key) =>
    native ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;
  const message = own("message");
  const code =
    typeof message === "string" &&
    (/^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message) ||
      STARTUP_CLOCK_ERRORS.has(message))
      ? message
      : "FULL_SDK_CONTROL_FAILED";
  let name = native ? "NativeError" : "ThrownValue";
  if (native) {
    const prototype = Object.getPrototypeOf(error);
    for (const type of [
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      EvalError,
      URIError,
      AggregateError,
    ])
      if (prototype === type.prototype) name = type.name;
  }
  const diagnostic = {
    ...((native ? startupErrorContexts.get(error) : undefined) ?? {
      phase: "unknown",
      fileKind: "none",
    }),
    name,
  };
  if (STARTUP_ERROR_CODES.has(own("code"))) diagnostic.code = own("code");
  if (STARTUP_SYSCALLS.has(own("syscall"))) diagnostic.syscall = own("syscall");
  // BEGIN SAFE SOURCE CHILD FAILURE PROJECTION
  const sourceChild = native ? sourceChildFailures.get(error) : undefined;
  if (sourceChild) diagnostic.sourceChild = sourceChild;
  // END SAFE SOURCE CHILD FAILURE PROJECTION
  return {
    kind: "windows-arm-full-sdk-failure",
    error: code,
    diagnostic,
    sdkBuilt: false,
    nativeAcceptance: false,
  };
}
// END BOUNDED STARTUP OBSERVABILITY

// BEGIN CHECKED SOURCE ARTIFACTS PARENT
async function recheckSourceCreationParents(token, parents) {
  const state = operationState(token);
  need(
    path.dirname(state.root) === path.join(CONTROLLER_REPO, ".artifacts"),
    "SOURCE_PARENT_SCOPE",
  );
  for (const row of parents) {
    const info = await operationWork(token, () =>
      fs.lstat(row.path, { bigint: true }),
    );
    need(operationDirectoryId(info) === row.identity, "SOURCE_PARENT_CHANGED");
    need(
      (await operationWork(token, () => fs.realpath(row.path))) === row.path,
      "SOURCE_PARENT_ALIAS",
    );
  }
  operationState(token);
}
async function prepareSourceArtifactsParent(token) {
  const state = operationState(token),
    parent = path.dirname(state.root);
  need(
    parent === path.join(CONTROLLER_REPO, ".artifacts"),
    "SOURCE_PARENT_SCOPE",
  );
  const parents = [];
  for (let current = CONTROLLER_REPO; ; current = path.dirname(current)) {
    const info = await operationWork(token, () =>
      fs.lstat(current, { bigint: true }),
    );
    parents.push(
      Object.freeze({ path: current, identity: operationDirectoryId(info) }),
    );
    if (current === path.dirname(current)) break;
  }
  await recheckSourceCreationParents(token, parents);
  const before = await operationWork(token, async () => {
    try {
      return await fs.lstat(parent, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  });
  if (before)
    parents.push(
      Object.freeze({ path: parent, identity: operationDirectoryId(before) }),
    );
  await recheckSourceCreationParents(token, parents);
  operationState(token);
  await operationWork(token, async () => {
    try {
      await fs.mkdir(parent, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST" || !before) throw error;
    }
  });
  if (!before) {
    const info = await operationWork(token, () =>
      fs.lstat(parent, { bigint: true }),
    );
    parents.push(
      Object.freeze({ path: parent, identity: operationDirectoryId(info) }),
    );
  }
  await recheckSourceCreationParents(token, parents);
  return Object.freeze(parents);
}
// END CHECKED SOURCE ARTIFACTS PARENT

async function createSourceOperation(bootstrap) {
  const owner = bootstrapState(bootstrap);
  // Native/public activation is separate. No boolean/report can open this code gate.
  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");
  need(!owner.operation, "BOOTSTRAP_REUSE");
  observeStartupPhase(bootstrap, "profile");
  const profileRaw = (
    await bootstrapHeldFile(
      bootstrap,
      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),
      65536,
    )
  ).raw;
  bootstrapState(bootstrap);
  need(
    profileRaw.length > 0 &&
      profileRaw.length <= 65536 &&
      hashBytes(profileRaw) === FULL_SOURCE_PROFILE_SHA256,
    "SOURCE_PROFILE_PIN",
  );
  const profile = JSON.parse(profileRaw);
  need(
    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&
      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",
    "SOURCE_FIXED_ENTRY",
  );
  observeStartupPhase(bootstrap, "policy");
  const policyRaw = (
    await bootstrapHeldFile(
      bootstrap,
      path.join(CONTROLLER_REPO, profile.policy),
      1048576,
    )
  ).raw;
  bootstrapState(bootstrap);
  const policy = JSON.parse(policyRaw);
  parentMetadata_qualificationShape(
    policy,
    [
      "schemaVersion",
      "kind",
      "origin",
      "target",
      "workflow",
      "workflowPin",
      "sources",
      "bridge",
      "producerInputs",
      "recordSchemaVersion",
      "jobPolicy",
    ],
    "SOURCE_POLICY_FIELDS",
  );
  need(
    policy.schemaVersion === 1 &&
      policy.recordSchemaVersion === 1 &&
      policy.kind === "sorng-windows-arm64-sdk-origin-policy",
    "SOURCE_POLICY_KIND",
  );
  observeStartupPhase(bootstrap, "workflow");
  const workflow = (
    await bootstrapHeldFile(
      bootstrap,
      path.join(CONTROLLER_REPO, profile.workflow),
      2097152,
      policy.workflowPin,
    )
  ).raw;
  bootstrapState(bootstrap);
  observeStartupPhase(bootstrap, "scope");
  need(
    workflow.length === policy.workflowPin.bytes &&
      hashBytes(workflow) === policy.workflowPin.sha256 &&
      policy.workflow === profile.workflow &&
      policy.origin === "owned-windows-arm64-full-sdk" &&
      policy.target === "aarch64-pc-windows-msvc" &&
      process.env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      process.env.GITHUB_REPOSITORY_ID === "1010282954" &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&
      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),
    "SOURCE_WORKFLOW_SCOPE",
  );
  need(
    profile.sourceQualificationAllowed === true &&
      profile.fullModeBodyImplemented === true &&
      profile.sourceSessionIssuerImplemented === true &&
      profile.controllerCreationPathImplemented === true &&
      profile.parentExpectedDefaultsImplemented === true &&
      profile.firstWorkflowClockImplemented === true &&
      profile.nativeSourceEntryQualified === false &&
      profile.sourceProgramCarryforwardQualified === false,
    "SOURCE_ATTEMPT_POLICY",
  );
  const selected = sources[process.env.ImageVersion];
  need(selected, "SOURCE_IMAGE");
  need(
    /^(?:0|[1-9][0-9]{0,19})$/.test(process.env.CEF_FULLSDK_RESTORE_RUN ?? ""),
    "SOURCE_RESTORE_RUN",
  );
  // Resume authentication and fixed ready-file binding are completed before
  // any source actor; a nonzero request cannot silently become a fresh build.
  owner.checkpointRestore = await readRestoreHandoff(
    bootstrap,
    policy.producerInputs,
    process.env.ImageVersion,
    selected.id,
  );
  bootstrapState(bootstrap);
  need(
    process.env.CEF_FULLSDK_RESTORE_RUN === "0" || owner.checkpointRestore,
    "SOURCE_RESTORE_AUTHENTICATION",
  );
  const environment = Object.freeze({
    SystemRoot: "C:/Windows",
    WINDIR: "C:/Windows",
    PATH: "C:/Windows/System32",
    PYTHONDONTWRITEBYTECODE: "1",
  });
  observeStartupPhase(bootstrap, "node");
  const actualNode = await fs.realpath(process.execPath);
  bootstrapState(bootstrap);
  need(
    actualNode.replaceAll("\\", "/").toLowerCase() ===
      profile.node.path.toLowerCase(),
    "SOURCE_PARENT_NODE",
  );
  const nodeInfo = await fs.lstat(actualNode, { bigint: true });
  bootstrapState(bootstrap);
  need(
    nodeInfo.isFile() &&
      !nodeInfo.isSymbolicLink() &&
      nodeInfo.nlink === 1n &&
      nodeInfo.size === BigInt(profile.node.bytes),
    "SOURCE_NODE_FILE",
  );
  const nodeRaw = (
    await bootstrapHeldFile(
      bootstrap,
      actualNode,
      profile.node.bytes,
      profile.node,
    )
  ).raw;
  bootstrapState(bootstrap);
  need(
    nodeRaw.length === profile.node.bytes &&
      hashBytes(nodeRaw) === profile.node.sha256 &&
      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),
    "SOURCE_NODE_PIN",
  );
  bootstrapState(bootstrap);
  observeStartupPhase(bootstrap, "python");
  const pythonRaw = (
    await bootstrapHeldFile(
      bootstrap,
      profile.python.path,
      profile.python.bytes,
      profile.python,
    )
  ).raw;
  bootstrapState(bootstrap);
  need(
    pythonRaw.length === profile.python.bytes &&
      hashBytes(pythonRaw) === profile.python.sha256,
    "SOURCE_PYTHON_PIN",
  );
  observeStartupPhase(bootstrap, "workflow-clock");
  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION
  // The checked workflow is the origin of this accounting record. It cannot
  // open either code gate or replace source/native qualification authority.
  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");
  const workflowClock = readWorkflowClock(
    process.env[WORKFLOW_CLOCK_ENV],
    process.env,
    Date.now(),
  );
  const wholeLease = leases.get(owner.lease);
  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);
  bootstrapState(bootstrap);
  const clockProbeMonoStart = performance.now();
  // END FIRST WORKFLOW CLOCK INTERSECTION
  observeStartupPhase(bootstrap, "parent-clock");
  const sample = await samplePythonClock(
    bootstrap,
    profile.python.path,
    environment,
  );
  // BEGIN FIRST WORKFLOW CLOCK NATIVE PROJECTION
  const inheritedEnds = intersectWorkflowClock(
    workflowClock,
    sample.monotonic,
    clockProbeMonoStart,
    wholeLease,
    Date.now(),
    performance.now(),
  );
  wholeLease.wallEnd = inheritedEnds.wallEnd;
  wholeLease.monoEnd = inheritedEnds.monoEnd;
  owner.workflowClock = workflowClock;
  bootstrapState(bootstrap);
  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION
  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.
  observeStartupPhase(bootstrap, "root-module");
  const rootCode = (
    await bootstrapHeldFile(
      bootstrap,
      path.join(CONTROLLER_HERE, "source-root.mjs"),
      1895,
      {
        bytes: 1895,
        sha256:
          "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",
      },
    )
  ).raw;
  bootstrapState(bootstrap);
  need(
    rootCode.length === 1895 &&
      hashBytes(rootCode) ===
        "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",
    "SOURCE_ROOT_MODULE_PIN",
  );
  need(
    policy.producerInputs.filter(
      (row) =>
        row.path === "native/windows-arm-full-sdk/source-root.mjs" &&
        row.bytes === rootCode.length &&
        row.sha256 === hashBytes(rootCode),
    ).length === 1,
    "SOURCE_ROOT_CODE_CLOSURE",
  );
  observeStartupPhase(bootstrap, "source-root");
  const root = path.join(
    CONTROLLER_REPO,
    ".artifacts",
    fullSdkSourceRootName(process.env.ImageVersion, selected.id),
  );
  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });
  const state = {
    bootstrap,
    lease: owner.lease,
    root,
    rootFence: [],
    owner: null,
    ownerPath: path.join(root, "full-sdk-source-owner.bin"),
    ownerIdentity: null,
    rootIdentity: null,
    closed: false,
    failed: false,
    primary: undefined,
    issued: false,
    pending: new Set(),
    lateCleanups: new Set(),
    readFds: new Set(),
    logFds: new Set(),
    pendingWriters: 0,
    writeQueue: Promise.resolve(),
    outputBytes: 0,
    child: null,
    creationJoined: false,
    cleanupConfirmed: false,
    sourceWallEnd: Math.min(
      leases.get(owner.lease).wallEnd,
      owner.wallStart + SOURCE_MS,
    ),
    sourceMonoEnd: Math.min(
      leases.get(owner.lease).monoEnd,
      owner.monoStart + SOURCE_MS,
    ),
  };
  sourceOperations.set(token, state);
  owner.operation = token;
  try {
    // BEGIN SOURCE ROOT PARENT CREATION
    const creationParents = await prepareSourceArtifactsParent(token);
    await recheckSourceCreationParents(token, creationParents);
    operationState(token);
    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));
    await recheckSourceCreationParents(token, creationParents);
    // END SOURCE ROOT PARENT CREATION
    for (let current = root; ; current = path.dirname(current)) {
      const info = await operationWork(token, () =>
        fs.lstat(current, { bigint: true }),
      );
      // BEGIN SOURCE CREATION PARENT LEDGER CHECK
      const expectedParent = creationParents.find(
        (row) => row.path === current,
      );
      if (expectedParent)
        need(
          operationDirectoryId(info) === expectedParent.identity,
          "SOURCE_PARENT_CHANGED",
        );
      // END SOURCE CREATION PARENT LEDGER CHECK
      state.rootFence.unshift({
        path: current,
        identity: operationDirectoryId(info),
      });
      if (current === path.dirname(current)) break;
    }
    state.rootIdentity = directoryId(
      await operationWork(token, () => fs.lstat(root, { bigint: true })),
    );
    // BEGIN SOURCE OWNER OPEN FENCE
    await operationFence(token);
    operationState(token);
    // END SOURCE OWNER OPEN FENCE
    state.owner = await operationWork(
      token,
      () =>
        fs.open(
          state.ownerPath,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        ),
      (late) => late.close(),
    );
    await operationWork(token, () => state.owner.writeFile(randomBytes(32)));
    state.ownerIdentity = fileId(
      await operationWork(token, () => state.owner.stat({ bigint: true })),
    );
    for (const name of ["source-inputs", "tmp", "home"]) {
      await operationFence(token);
      await operationWork(token, () =>
        fs.mkdir(path.join(root, name), { mode: 0o700 }),
      );
    }
    need(
      Array.isArray(policy.producerInputs) &&
        policy.producerInputs.length > 0 &&
        policy.producerInputs.length <= 128,
      "SOURCE_INPUTS",
    );
    for (const [index, row] of policy.producerInputs.entries()) {
      need(
        typeof row.path === "string" &&
          !path.isAbsolute(row.path) &&
          row.path.split(/[\\/]/).every((x) => x && x !== "." && x !== ".."),
        "SOURCE_INPUT_PATH",
      );
      observeStartupPhase(bootstrap, "source-input");
      const raw = (
        await operationWork(token, () =>
          bootstrapHeldFile(
            bootstrap,
            path.join(CONTROLLER_REPO, row.path),
            2097152,
            row,
          ),
        )
      ).raw;
      need(
        raw.length === row.bytes &&
          raw.length <= 2 * 1024 ** 2 &&
          hashBytes(raw) === row.sha256,
        "SOURCE_INPUT_PIN",
      );
      await operationFence(token);
      await operationWork(token, () =>
        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {
          flag: "wx",
        }),
      );
    }
    observeStartupPhase(bootstrap, "source-context");
    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);
    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\n");
    await operationFence(token);
    await operationWork(token, () =>
      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),
    );
    const env = Object.freeze({
      ...environment,
      TEMP: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      USERPROFILE: path.join(root, "home"),
    });
    state.plan = Object.freeze({
      executable: profile.python.path,
      argv: Object.freeze([
        "-I",
        "-B",
        path.join(CONTROLLER_HERE, "full_sdk_source.py"),
        "--full-sdk-source-launcher",
        root,
        hashBytes(contextRaw),
        "--execute",
      ]),
      environment: env,
      image: c.image,
      sourceId: selected.id,
      profileSha256: selected.profile,
      parentCreationFiletime: sample.parentCreationFiletime,
      producerInputs: Object.freeze(
        policy.producerInputs.map((row) => Object.freeze({ ...row })),
      ),
      rootPins: Object.freeze([
        {
          relative: "context.json",
          bytes: contextRaw.length,
          sha256: hashBytes(contextRaw),
        },
        ...policy.producerInputs.map((row, index) => ({
          relative: `source-inputs/${index}`,
          bytes: row.bytes,
          sha256: row.sha256,
        })),
        ...PATCHED_SOURCE_PINS,
      ]),
    });
    await operationFence(token);
    return token;
  } catch (error) {
    fail(state, error);
    await retireSourceOperation(token);
    throw state.primary;
  }
}
// BEGIN ACTUAL PARENT ENGINE CREATION
// Packet files carry data. Only this retained control and its actual child may
// advance the private phase list, after kernel, pipes and owned FD joins.
const ENGINE_ROLES = Object.freeze([
  "probe-clang",
  "probe-link",
  "cef-engine",
  "package",
]);
const ENGINE_CAPS_MS = Object.freeze([900000, 900000, 10800000, 2400000]);
function engineState(token, phase) {
  const state = controls.get(token);
  need(state && state.enginePhase === phase && !phase.retired, "ENGINE_BRAND");
  retained(token, state);
  need(
    Math.min(phase.wallEnd - Date.now(), phase.monoEnd - performance.now()) > 0,
    "ENGINE_DEADLINE",
  );
  return state;
}
async function engineWork(token, phase, action, late) {
  const state = engineState(token, phase);
  let timer,
    abort,
    settled = false,
    received = false,
    value;
  const signal = leases.get(state.leaseToken).signal;
  const pending = Promise.resolve().then(() => {
    engineState(token, phase);
    return action();
  });
  phase.pending.add(pending);
  pending.then(
    (value) => {
      phase.pending.delete(pending);
      if (settled && late)
        Promise.resolve()
          .then(() => late(value))
          .catch((error) => {
            phase.cleanupConfirmed = false;
            fail(state, error);
          });
    },
    () => phase.pending.delete(pending),
  );
  try {
    value = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("FULL_SDK_CONTROL_ENGINE_DEADLINE")),
          Math.min(
            checkLease(state.leaseToken),
            phase.wallEnd - Date.now(),
            phase.monoEnd - performance.now(),
          ),
        );
        abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    received = true;
    engineState(token, phase);
    settled = true;
    return value;
  } catch (error) {
    settled = true;
    if (received && late)
      Promise.resolve()
        .then(() => late(value))
        .catch(() => {
          phase.cleanupConfirmed = false;
        });
    throw fail(state, error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
async function engineBoundary(token, phase) {
  const state = engineState(token, phase);
  need(state.helperValidated && state.gitToken, "ENGINE_FRESH_GIT");
  await engineWork(token, phase, () => currentRoot(token, state));
  await engineWork(token, phase, () =>
    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
  );
  const environment = await engineWork(token, phase, () =>
    custom.sourceGitEnvironment(state.gitToken, {}),
  );
  for (const entry of state.helperEntries) {
    const info = await engineWork(token, phase, () =>
      fs.lstat(entry.path, { bigint: true }),
    );
    need(
      (entry.directory ? directoryId(info) : fileId(info)) === entry.identity,
      "ENGINE_GIT_CHANGED",
    );
  }
  engineState(token, phase);
  return environment;
}
async function engineRead(token, phase, relative, maximum, expected) {
  const state = engineState(token, phase);
  const result = await engineWork(token, phase, () =>
    heldOperationFile(
      state.source.operationToken,
      relative,
      maximum,
      expected,
      true,
    ),
  );
  engineState(token, phase);
  return result;
}
async function engineSave(token, phase, relative, raw) {
  const state = engineState(token, phase);
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 131072,
    "ENGINE_PACKET_BOUND",
  );
  await engineWork(token, phase, () => currentRoot(token, state));
  engineState(token, phase); // Synchronous fence immediately before mutation.
  await engineWork(token, phase, () =>
    fs.writeFile(path.join(state.source.root, relative), raw, { flag: "wx" }),
  );
  await engineWork(token, phase, () => currentRoot(token, state));
  engineState(token, phase);
}
function startEngineChild(token, phase, plan) {
  const state = engineState(token, phase);
  need(!phase.child, "ENGINE_CREATION_REUSE");
  const child = spawn(plan.executable, plan.argv, {
    cwd: state.source.root,
    env: plan.environment,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  need(child instanceof ChildProcess, "ENGINE_ACTUAL_CHILD");
  phase.child = child;
  phase.childEvents = {
    spawn: false,
    exit: false,
    close: false,
    stdout: false,
    stderr: false,
  };
  phase.childJoined = new Promise((resolve) => {
    phase.resolveChildJoined = resolve;
  });
  phase.ownedListeners = [];
  const listen = (emitter, event, handler, once = false) => {
    const owned = (...args) => {
      if (!phase.observationDetached) handler(...args);
    };
    phase.ownedListeners.push({ emitter, event, owned });
    if (once) emitter.once(event, owned);
    else emitter.on(event, owned);
  };
  const joined = () => {
    const e = phase.childEvents;
    if (e.close && e.stdout && e.stderr && !phase.observationDetached)
      phase.resolveChildJoined();
  };
  const stop = (error) => {
    fail(state, error);
    if (!phase.childEvents.exit && !phase.childEvents.close) {
      try {
        child.kill();
      } catch {
        phase.cleanupConfirmed = false;
      }
    }
  };
  listen(
    child,
    "spawn",
    () => {
      phase.childEvents.spawn = true;
      phase.creationPid = child.pid;
    },
    true,
  );
  listen(child, "error", stop, true);
  listen(
    child,
    "exit",
    (code, signal) =>
      Object.assign(phase.childEvents, { exit: true, code, signal }),
    true,
  );
  listen(
    child,
    "close",
    (closeCode, closeSignal) => {
      Object.assign(phase.childEvents, { close: true, closeCode, closeSignal });
      joined();
    },
    true,
  );
  for (const [name, stream, fd] of [
    ["stdout", child.stdout, phase.stdoutFd],
    ["stderr", child.stderr, phase.stderrFd],
  ]) {
    need(stream && fd, "ENGINE_PIPES");
    listen(stream, "data", (chunk) => {
      if (phase.retired || state.failed) return;
      phase.outputBytes += chunk.length;
      if (phase.outputBytes > SOURCE_LOG_CAP)
        return stop(new Error("FULL_SDK_CONTROL_ENGINE_OUTPUT_CAP"));
      phase.pendingWriters++;
      phase.writeQueue = phase.writeQueue
        .then(async () => {
          if (phase.retired || state.failed) return;
          engineState(token, phase);
          await fd.writeFile(chunk);
        })
        .catch(stop)
        .finally(() => phase.pendingWriters--);
    });
    listen(stream, "error", stop, true);
    listen(
      stream,
      "close",
      () => {
        phase.childEvents[name] = true;
        joined();
      },
      true,
    );
  }
  return child;
}
function engineProbe(raw, role) {
  if (role === "probe-clang") {
    need(
      raw.length >= 20 &&
        raw.readUInt16LE(0) === 0xaa64 &&
        raw.readUInt16LE(2) >= 1 &&
        raw.readUInt16LE(2) <= 96 &&
        raw.readUInt16LE(16) === 0 &&
        20 + raw.readUInt16LE(2) * 40 <= raw.length,
      "ENGINE_COFF",
    );
    return;
  }
  need(raw.length >= 64 && raw.toString("ascii", 0, 2) === "MZ", "ENGINE_PE");
  const at = raw.readUInt32LE(60);
  need(
    at >= 64 &&
      at + 264 <= raw.length &&
      raw.readUInt32LE(at) === 0x4550 &&
      raw.readUInt16LE(at + 4) === 0xaa64 &&
      raw.readUInt16LE(at + 20) === 240 &&
      raw.readUInt16LE(at + 24) === 0x20b,
    "ENGINE_PE",
  );
  for (const dir of [1, 12, 13, 14])
    need(
      raw.readUInt32LE(at + 24 + 112 + dir * 8) === 0 &&
        raw.readUInt32LE(at + 24 + 116 + dir * 8) === 0,
      "ENGINE_PE_IMPORT",
    );
}
async function verifyEnginePhase(token, phase, packetPin, packet) {
  const state = engineState(token, phase),
    role = phase.role,
    records = [];
  const read = async (relative, maximum = 131072, expected) => {
    const value = await engineRead(token, phase, relative, maximum, expected);
    records.push(
      Object.freeze({
        relative,
        maximum,
        pin: Object.freeze({ ...value.pin }),
        identity: value.identity,
      }),
    );
    return value;
  };
  const launch = parseRecord(await read(`full-sdk-engine-${role}-launch.json`));
  need(
    launch.kind === "windows-arm-full-sdk-engine-launch" &&
      launch.role === role &&
      launch.ownPid === phase.creationPid &&
      /^[1-9][0-9]{0,19}$/.test(launch.ownCreationFiletime) &&
      launch.parentPid === process.pid &&
      launch.parentCreationFiletime === packet.parentCreationFiletime &&
      launch.contextSha256 === packetPin.sha256,
    "ENGINE_LAUNCH_BINDING",
  );
  const jobRecord = await read(`jobs/${role}/receipt.json`),
    job = parseRecord(jobRecord);
  need(
    job.rootPid !== launch.ownPid &&
      job.rootCreationFiletime !== launch.ownCreationFiletime,
    "ENGINE_JOB_IDENTITY",
  );
  const closed = parseRecord(await read(`full-sdk-engine-closed-${role}.json`));
  need(
    closed.kind === "windows-arm-full-sdk-engine-launcher-close" &&
      closed.role === role &&
      closed.success === true &&
      closed.parentHandleClosed === true &&
      closed.ownHandleClosed === true &&
      closed.ownPid === launch.ownPid &&
      closed.ownCreationFiletime === launch.ownCreationFiletime &&
      closed.parentPid === process.pid &&
      closed.parentCreationFiletime === packet.parentCreationFiletime &&
      closed.sourceContextSha256 === packet.sourceContextSha256 &&
      closed.sdkBuilt === false &&
      closed.nativeAcceptance === false,
    "ENGINE_CLOSE_BINDING",
  );
  need(
    Number.isSafeInteger(closed.jobSeconds) &&
      closed.jobSeconds > 0 &&
      closed.jobSeconds <=
        (role === "checkpoint-seal"
          ? 3600
          : ENGINE_CAPS_MS[ENGINE_ROLES.indexOf(role)] / 1000) &&
      Number.isSafeInteger(job.elapsedMs) &&
      job.elapsedMs >= 0 &&
      job.elapsedMs <= closed.jobSeconds * 1000 + CLEANUP_MS,
    "ENGINE_ASSIGNED_SECONDS",
  );
  if (role === "cef-engine" && job.success === false) {
    inspectNativeSlice(job, closed.jobSeconds);
    need(
      closed.completion === "native-slice-ended" &&
        closed.receiptPin?.bytes === jobRecord.pin.bytes &&
        closed.receiptPin?.sha256 === jobRecord.pin.sha256 &&
        phase.nativeWallEnd <= leases.get(state.leaseToken).wallEnd - 3600000 &&
        phase.nativeMonoEnd <= leases.get(state.leaseToken).monoEnd - 3600000,
      "ENGINE_SLICE_CLOSE",
    );
    await engineBoundary(token, phase);
    engineState(token, phase);
    const fact = Object.freeze({
      role,
      nativeSliceEnded: true,
      result: null,
      context: Object.freeze({ ...packetPin }),
      receipt: Object.freeze({ ...jobRecord.pin }),
      closure: Object.freeze({ ...records[2].pin }),
      launch: Object.freeze({ ...records[0].pin }),
      records: Object.freeze(records),
      nativeAcceptance: false,
    });
    state.nativeSliceFact = fact; // Only this actual creator/readback path writes it.
    return fact;
  }
  inspectJob(jobRecord, true);
  if (role === "cef-engine")
    need(closed.completion === "success", "ENGINE_CEF_COMPLETION");
  const resultRecord = await read(`full-sdk-engine-${role}-result.json`),
    result = parseRecord(resultRecord);
  need(
    result.kind === "windows-arm-full-sdk-engine-worker-result" &&
      result.role === role &&
      result.sourceContextSha256 === packet.sourceContextSha256 &&
      result.image === packet.image &&
      result.sourceId === packet.sourceId &&
      result.success === true &&
      result.engineComplete === (role === "cef-engine") &&
      result.sdkBuilt === (role === "package") &&
      result.nativeAcceptance === false &&
      result.runtimeReady === false,
    "ENGINE_RESULT_BINDING",
  );
  if (role === "probe-clang" || role === "probe-link") {
    const output = await read(
      `full-sdk-engine-probe/probe.${role === "probe-clang" ? "obj" : "exe"}`,
      8388608,
      result.output,
    );
    engineProbe(output.raw, role);
  }
  await engineBoundary(token, phase);
  engineState(token, phase);
  return Object.freeze({
    role,
    result: Object.freeze({ ...resultRecord.pin }),
    receipt: Object.freeze({ ...jobRecord.pin }),
    records: Object.freeze(records),
    output: result.output,
    nativeAcceptance: false,
  });
}
async function retireEnginePhase(token, phase) {
  const state = controls.get(token);
  if (phase.retired) return;
  phase.retired = true; // Revoke before any awaited cleanup or late callback.
  const lease = leases.get(state.leaseToken);
  phase.cleanupEnd = Math.min(performance.now() + CLEANUP_MS, lease.monoEnd);
  phase.cleanupWallEnd = Math.min(Date.now() + CLEANUP_MS, lease.wallEnd);
  let confirmed = true;
  const attempt = async (action) => {
    try {
      await cleanupStep(phase, action);
    } catch (error) {
      confirmed = false;
      fail(state, error);
    }
  };
  if (phase.child && !phase.childEvents?.exit && !phase.childEvents?.close) {
    try {
      phase.child.kill();
    } catch (error) {
      confirmed = false;
      fail(state, error);
    }
  }
  // Start closing every owned log FD before an unknown child join can consume
  // the cleanup window. Revocation prevents queued/late data from starting IO.
  const closing = [...phase.logFds].map((fd) =>
    Promise.resolve()
      .then(() => fd.close())
      .then(
        () => {
          phase.logFds.delete(fd);
        },
        (error) => {
          confirmed = false;
          fail(state, error);
        },
      ),
  );
  const joined = phase.childJoined ? phase.childJoined : Promise.resolve();
  await attempt(() =>
    Promise.all([
      joined,
      phase.writeQueue,
      ...closing,
      ...[...phase.pending].map((value) => value.catch(() => undefined)),
    ]),
  );
  phase.cleanupConfirmed =
    confirmed &&
    phase.childEvents?.close === true &&
    phase.logFds.size === 0 &&
    phase.pendingWriters === 0;
  if (phase.logFds.size) {
    state.retiredEnginePhases ??= new Set();
    state.retiredEnginePhases.add(phase);
    Promise.allSettled(closing).then(() => {
      if (phase.logFds.size === 0) state.retiredEnginePhases.delete(phase);
    });
  }
  releaseSourceObservation(phase); // Releases only this actual creation's pipes/listeners/ref.
  state.enginePhase = null;
}
async function runEnginePhase(token, role) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  state.engineResults ??= [];
  const index = state.engineResults.length;
  const checkpoint =
    role === "checkpoint-seal" &&
    index === 3 &&
    state.nativeSliceFact === state.engineResults[2] &&
    state.nativeSliceFact?.nativeSliceEnded === true;
  need(
    index < ENGINE_ROLES.length &&
      (checkpoint || role === ENGINE_ROLES[index]) &&
      !state.enginePhase &&
      (index !== 3 || checkpoint || !state.nativeSliceFact),
    "ENGINE_SEQUENCE",
  );
  const lease = leases.get(state.leaseToken),
    nowWall = Date.now(),
    nowMono = performance.now();
  if (index === 0)
    state.probeEnds = Object.freeze({
      wallEnd: Math.min(lease.wallEnd - 150000, nowWall + 900000),
      monoEnd: Math.min(lease.monoEnd - 150000, nowMono + 900000),
    });
  const reserve = role === "cef-engine" ? 3600000 : 150000,
    cap = checkpoint ? 3600000 : ENGINE_CAPS_MS[index];
  const nativeWallEnd =
      index <= 1
        ? state.probeEnds.wallEnd
        : Math.min(lease.wallEnd - reserve, nowWall + cap),
    nativeMonoEnd =
      index <= 1
        ? state.probeEnds.monoEnd
        : Math.min(lease.monoEnd - reserve, nowMono + cap);
  const phase = {
    role,
    nativeWallEnd,
    nativeMonoEnd,
    wallEnd: Math.min(
      lease.wallEnd - 150000,
      nativeWallEnd + (role === "cef-engine" ? 90000 : 0),
    ),
    monoEnd: Math.min(
      lease.monoEnd - 150000,
      nativeMonoEnd + (role === "cef-engine" ? 90000 : 0),
    ),
    retired: false,
    pending: new Set(),
    logFds: new Set(),
    pendingWriters: 0,
    writeQueue: Promise.resolve(),
    outputBytes: 0,
    child: null,
    cleanupConfirmed: false,
  };
  state.enginePhase = phase;
  try {
    await engineBoundary(token, phase);
    if (index >= 2) compilerAdmission(token, phase);
    const operation = operationState(state.source.operationToken, true),
      root = state.source.root,
      contextPin = operation.plan.rootPins.find(
        (row) => row.relative === "context.json",
      ),
      sourceContext = parseRecord(
        await engineRead(token, phase, "context.json", 131072, contextPin),
      );
    for (const previous of state.engineResults)
      for (const row of previous.records) {
        const value = await engineRead(
          token,
          phase,
          row.relative,
          row.maximum,
          row.pin,
        );
        need(value.identity === row.identity, "ENGINE_PREDECESSOR_CHANGED");
      }
    const gitPolicyFiles = [];
    for (const name of ["global", "system"]) {
      const relative = `full-sdk-control/cef-source-git-policy/${name}.gitconfig`,
        value = await engineRead(token, phase, relative, 65536);
      need(
        name === "system"
          ? value.pin.bytes === 0 &&
              value.pin.sha256 === hashBytes(Buffer.alloc(0))
          : value.pin.bytes > 0,
        "ENGINE_GIT_PIN",
      );
      gitPolicyFiles.push({ relative, ...value.pin });
    }
    // Consume the original already-captured Python/Node endpoint projection.
    // No second clock child and no now+whole lease are introduced here.
    engineState(token, phase);
    need(
      phase.nativeMonoEnd <= lease.monoEnd - 150000,
      "ENGINE_ORIGINAL_BUDGET",
    );
    const previous = state.engineResults.at(-1),
      packet = {
        schemaVersion: 1,
        kind: "windows-arm-full-sdk-engine-context",
        mode: "full-sdk-engine",
        role,
        sourceContextSha256: contextPin.sha256,
        image: state.source.image,
        sourceId: state.source.sourceId,
        target: state.source.target,
        wallWholeEnd: sourceContext.wallWholeEnd,
        monotonicWholeEnd: sourceContext.monotonicWholeEnd,
        wallPhaseEnd: phase.nativeWallEnd / 1000,
        monotonicPhaseEnd: Math.min(
          sourceContext.monotonicWholeEnd - 150,
          sourceContext.monotonicWholeEnd -
            (lease.monoEnd - phase.nativeMonoEnd) / 1000,
        ),
        parentPid: process.pid,
        parentCreationFiletime: operation.plan.parentCreationFiletime,
        metadataFiles: state.source.metadataSnapshot.records.map((row) => ({
          relative: row.relative,
          ...row.pin,
        })),
        gitPolicyFiles,
        prior: checkpoint
          ? {
              result: null,
              receipt: previous.receipt,
              closure: previous.closure,
              launch: previous.launch,
            }
          : previous
            ? { result: previous.result, receipt: previous.receipt }
            : null,
      };
    const raw = Buffer.from(JSON.stringify(packet, null, 2) + "\n"),
      packetPin = { bytes: raw.length, sha256: hashBytes(raw) };
    await engineSave(token, phase, `full-sdk-engine-${role}-context.json`, raw);
    for (const name of ["stdout", "stderr"]) {
      await engineWork(token, phase, () => currentRoot(token, state));
      engineState(token, phase);
      const fd = await engineWork(
        token,
        phase,
        () =>
          fs.open(
            path.join(root, `full-sdk-engine-${role}.${name}.log`),
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              (constants.O_NOFOLLOW ?? 0),
            0o600,
          ),
        (late) => late.close(),
      );
      phase[name + "Fd"] = fd;
      phase.logFds.add(fd);
    }
    await engineBoundary(token, phase);
    engineState(token, phase);
    startEngineChild(token, phase, {
      executable: operation.plan.executable,
      argv: [
        "-I",
        "-B",
        path.join(CONTROLLER_HERE, "full_sdk_engine.py"),
        "--full-sdk-engine-launcher",
        role,
        root,
        packetPin.sha256,
        "--execute",
      ],
      environment: operation.plan.environment,
    });
    await engineWork(token, phase, () => phase.childJoined);
    const e = phase.childEvents;
    need(
      e.spawn &&
        e.exit &&
        e.close &&
        e.stdout &&
        e.stderr &&
        e.code === 0 &&
        e.signal === null &&
        e.closeCode === 0 &&
        e.closeSignal === null &&
        Number.isSafeInteger(phase.creationPid) &&
        phase.creationPid > 0,
      "ENGINE_CHILD_JOIN",
    );
    await engineWork(token, phase, () => closeSourceLogs(phase));
    need(
      phase.logFds.size === 0 && phase.pendingWriters === 0,
      "ENGINE_FD_JOIN",
    );
    const fact = await verifyEnginePhase(token, phase, packetPin, packet);
    engineState(token, phase);
    state.engineResults.push(fact); // Sole phase advancement, after actual creation/joins/readbacks.
    return fact;
  } catch (error) {
    throw fail(state, error);
  } finally {
    await retireEnginePhase(token, phase);
    if (state.failed) throw state.primary;
  }
}
// END ACTUAL PARENT ENGINE CREATION

// BEGIN PRIVATE COMPILER ADMISSION
function compilerAdmission(token, phase) {
  const state = engineState(token, phase),
    source = sourceState(state.sourceReceipt, state.leaseToken);
  if (!state.compilerAdmission) {
    need(
      phase.role === "cef-engine" &&
        state.engineResults.length === 2 &&
        state.engineResults[0].role === "probe-clang" &&
        state.engineResults[1].role === "probe-link",
      "COMPILER_CREATED_PROBES",
    );
    const matched = source.metadataSnapshot?.matchedExpectedDefaults;
    need(
      matched?.comparison.expectedMacroCount === 61 &&
        matched.comparison.partitionAllocActionValuesMatch === true &&
        matched.comparison.partitionAllocHeaderValuesMatch === true &&
        matched.comparison.cefV8SandboxValue === 1 &&
        source.toolProofSnapshot,
      "COMPILER_SOURCE_FACTS",
    );
    state.compilerAdmission = Object.freeze({
      sourceReceipt: state.sourceReceipt,
      source,
      metadataSnapshot: source.metadataSnapshot,
      toolProofSnapshot: source.toolProofSnapshot,
      expectedDefaults: matched,
      clang: state.engineResults[0],
      link: state.engineResults[1],
      full61Qualified: true,
      nativeAcceptance: false,
    });
  }
  const fact = state.compilerAdmission;
  need(
    fact.sourceReceipt === state.sourceReceipt &&
      fact.source === source &&
      fact.metadataSnapshot === source.metadataSnapshot &&
      fact.toolProofSnapshot === source.toolProofSnapshot &&
      fact.expectedDefaults ===
        source.metadataSnapshot.matchedExpectedDefaults &&
      fact.clang === state.engineResults[0] &&
      fact.link === state.engineResults[1] &&
      fact.full61Qualified === true,
    "COMPILER_RETAINED_FACT",
  );
  return fact;
}
// END PRIVATE COMPILER ADMISSION

// BEGIN PRIVATE FINAL SDK VERIFICATION
async function sealSdkAsset(token, name, expected, kind = "sdk") {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  need(
    typeof name === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name) &&
      Number.isSafeInteger(expected?.size) &&
      expected.size > 0 &&
      expected.size <= 2 * 1024 ** 3 &&
      /^[a-f0-9]{64}$/.test(expected.sha256),
    "SDK_ASSET_SCOPE",
  );
  need(kind === "sdk" || kind === "checkpoint", "OUTPUT_KIND");
  const file = path.join(
    state.source.root,
    kind === "sdk" ? "full-sdk-package/bundle" : "full-sdk-checkpoint-output",
    name,
  );
  await currentRoot(token, state);
  await physical(token, state, path.dirname(file));
  state.assetFds ??= new Set();
  const fd = await work(
    token,
    state,
    () =>
      fs
        .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        .then((value) => {
          state.assetFds.add(value);
          return value;
        }),
    async (late) => {
      await late.close();
      state.assetFds.delete(late);
    },
  );
  let failed = false,
    primary,
    value;
  try {
    const info = await work(token, state, () => fd.stat({ bigint: true })),
      identity = fileId(info);
    need(info.size === BigInt(expected.size), "SDK_ASSET_SIZE");
    need(
      fileId(
        await work(token, state, () => fs.lstat(file, { bigint: true })),
      ) === identity,
      "SDK_ASSET_CHANGED",
    );
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(1048576);
    let total = 0;
    while (total <= expected.size) {
      const { bytesRead } = await work(token, state, () =>
        fd.read(
          buffer,
          0,
          Math.min(buffer.length, expected.size + 1 - total),
          total,
        ),
      );
      if (!bytesRead) break;
      total += bytesRead;
      digest.update(buffer.subarray(0, bytesRead));
    }
    need(
      total === expected.size && digest.digest("hex") === expected.sha256,
      "SDK_ASSET_PIN",
    );
    need(
      fileId(await work(token, state, () => fd.stat({ bigint: true }))) ===
        identity &&
        fileId(
          await work(token, state, () => fs.lstat(file, { bigint: true })),
        ) === identity,
      "SDK_ASSET_CHANGED",
    );
    value = Object.freeze({
      name,
      size: total,
      sha256: expected.sha256,
      identity,
    });
  } catch (error) {
    failed = true;
    primary = fail(state, error);
  } finally {
    try {
      await work(token, state, () => fd.close());
      state.assetFds.delete(fd);
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = fail(state, error);
      }
    }
  }
  if (failed) throw primary;
  await currentRoot(token, state);
  retained(token, state);
  return value;
}
async function verifyProducedSdk(token) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  need(
    state.engineResults?.length === ENGINE_ROLES.length &&
      !state.enginePhase &&
      state.engineResults.every(
        (row, index) => row.role === ENGINE_ROLES[index],
      ),
    "SDK_PHASES",
  );
  await work(token, state, () =>
    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
  );
  for (const phase of state.engineResults)
    for (const row of phase.records) {
      const actual = await work(token, state, () =>
        heldOperationFile(
          state.source.operationToken,
          row.relative,
          row.maximum,
          row.pin,
          true,
        ),
      );
      need(actual.identity === row.identity, "SDK_PHASE_RECORD_CHANGED");
    }
  const result = parseRecord(
    await work(token, state, () =>
      heldOperationFile(
        state.source.operationToken,
        "full-sdk-engine-package-result.json",
        131072,
        state.engineResults[3].result,
        true,
      ),
    ),
  );
  need(
    result.sdkBuilt === true &&
      result.role === "package" &&
      result.output?.bundle === "full-sdk-package/bundle" &&
      Array.isArray(result.output.assets) &&
      result.output.assets.length === 5 &&
      new Set(result.output.assets.map((row) => row.name)).size === 5,
    "SDK_PACKAGE_RESULT",
  );
  const operation = operationState(state.source.operationToken, true),
    lockRecord = await work(token, state, () =>
      heldOperationFile(
        state.source.operationToken,
        "full-sdk-package/bundle/source-lock.json",
        2 * 1024 ** 2,
        undefined,
        true,
      ),
    ),
    lock = JSON.parse(lockRecord.raw);
  need(
    custom.identitySha256(lock) === state.source.sourceId,
    "SDK_SOURCE_IDENTITY",
  );
  const identity = sdkRuntime.releaseIdentity(lock, state.source.target),
    names = [
      "runtime.json",
      "source-lock.json",
      "manifest.json",
      "receipt.json",
      identity.archive,
    ];
  need(
    result.output.assets.every((row) => names.includes(row.name)),
    "SDK_ASSET_SET",
  );
  const assets = [];
  for (const name of names)
    assets.push(
      await sealSdkAsset(
        token,
        name,
        result.output.assets.find((row) => row.name === name),
      ),
    );
  const verified = await work(token, state, () =>
    sdkRuntime.verifyBundle(
      path.join(state.source.root, "full-sdk-package/bundle"),
      "supermarsx/sortOfRemoteNG",
    ),
  );
  retained(token, state);
  need(
    verified.descriptor.target === state.source.target &&
      verified.identity.sourceLockSha256 === state.source.sourceId &&
      verified.assets.length === 5 &&
      verified.assets.every((row) =>
        assets.some(
          (asset) =>
            asset.name === row.name &&
            asset.size === row.size &&
            asset.sha256 === row.sha256,
        ),
      ),
    "SDK_BUNDLE_BINDING",
  );
  for (const asset of assets) {
    const current = await sealSdkAsset(token, asset.name, asset);
    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");
  }
  const afterObservation = await work(token, state, () =>
    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
  );
  await currentRoot(token, state);
  retained(token, state);
  need(
    state.assetFds.size === 0 &&
      operation.readFds.size === 0 &&
      operation.logFds.size === 0,
    "SDK_FD_JOIN",
  );
  const after = consumeCheckedInputObservation(
    token,
    state,
    afterObservation,
    "after-package-before-sdk-seal",
  );
  need(
    state.checkedInputsBefore &&
      state.checkedInputsBefore.sha256 === after.sha256 &&
      canonical(state.checkedInputsBefore.content) === canonical(after.content),
    "INPUT_CLOSURE_CHANGED",
  );
  const checkedInputs = Object.freeze({
    schemaVersion: 1,
    kind: "windows-arm-checked-input-closure-pair",
    before: state.checkedInputsBefore,
    after,
  });
  const seal = Object.freeze({
    kind: "windows-arm-full-sdk-produced",
    sourceId: state.source.sourceId,
    image: state.source.image,
    target: state.source.target,
    sdkBuilt: true,
    nativeAcceptance: false,
    runtimeReady: false,
    publicationAllowed: false,
    bundle: "full-sdk-package/bundle",
    checkedInputs,
    assets: Object.freeze(assets),
  });
  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.
  return seal;
}
async function verifyProducedCheckpoint(token) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  need(
    state.engineResults?.length === 4 &&
      state.engineResults[2] === state.nativeSliceFact &&
      state.nativeSliceFact?.nativeSliceEnded === true &&
      state.engineResults[3].role === "checkpoint-seal" &&
      !state.enginePhase &&
      state.compilerAdmission?.full61Qualified === true,
    "CHECKPOINT_PRIVATE_PHASES",
  );
  await work(token, state, () =>
    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
  );
  for (const phase of state.engineResults)
    for (const row of phase.records) {
      const value = await work(token, state, () =>
        heldOperationFile(
          state.source.operationToken,
          row.relative,
          row.maximum,
          row.pin,
          true,
        ),
      );
      need(value.identity === row.identity, "CHECKPOINT_PHASE_CHANGED");
    }
  const actor = state.engineResults[3],
    output = actor.output;
  need(
    output?.dataOnly === true &&
      output.sealed === true &&
      output.outcome === "quiet-deadline" &&
      output.bundle === "full-sdk-checkpoint-output" &&
      output.sourceContextSha256 ===
        state.source.metadataSnapshot.matchedExpectedDefaults.contextSha256,
    "CHECKPOINT_SEAL_RESULT",
  );
  const operation = operationState(state.source.operationToken, true),
    read = (relative, maximum, pin) =>
      work(token, state, () =>
        heldOperationFile(
          state.source.operationToken,
          relative,
          maximum,
          pin,
          true,
        ),
      );
  const result = parseRecord(
    await read("full-sdk-checkpoint-seal-result.json", 131072, output.result),
  );
  need(
    canonical(result) ===
      canonical(
        Object.fromEntries(
          Object.entries(output).filter(([key]) => key !== "result"),
        ),
      ),
    "CHECKPOINT_ACTOR_RESULT",
  );
  const checkpoint = await read(
      "full-sdk-checkpoint-output/checkpoint.json",
      2 * 1024 ** 2,
      output.checkpoint,
    ),
    record = parentMetadata_qualificationBoundedJson(
      checkpoint.raw,
      2 * 1024 ** 2,
    );
  parentMetadata_qualificationShape(
    record,
    [
      "schemaVersion",
      "kind",
      "identity",
      "workflow",
      "producerInputs",
      "outArchive",
      "inputSidecar",
      "rawChain",
      "nativeEvidence",
      "codec",
      "sourceQualified",
      "sdkBuilt",
      "nativeAcceptance",
      "executionAdmitted",
    ],
    "CHECKPOINT_RECORD_FIELDS",
  );
  const graph = await read(
      "source-gn-logs/fresh-graph-pins.json",
      16 * 1024 ** 2,
    ),
    sourceContext = parseRecord(
      await read(
        "context.json",
        131072,
        operation.plan.rootPins.find((row) => row.relative === "context.json"),
      ),
    );
  need(
    record.schemaVersion === 1 &&
      record.kind === "windows-arm-full-sdk-compiled-checkpoint" &&
      record.sourceQualified === false &&
      record.sdkBuilt === false &&
      record.nativeAcceptance === false &&
      record.executionAdmitted === false &&
      canonical(record.codec) ===
        canonical({
          bytes: 154847,
          sha256:
            "043659e63e1cfc50b5af8209a1e30fd924ed379e7355069fa654b657bc789113",
        }) &&
      canonical(record.producerInputs) ===
        canonical(operation.plan.producerInputs),
    "CHECKPOINT_RECORD_SCOPE",
  );
  const expectedIdentity = {
    image: state.source.image,
    sourceId: state.source.sourceId,
    producerSha256: producerInputDigest(operation.plan.producerInputs),
    sourceDateEpoch: { present: false, value: null },
    canonicalRoot: path.basename(state.source.root),
    toolProofPin: state.source.toolProofSnapshot.record.pin,
    graphPin: graph.pin,
  };
  need(
    canonical(record.identity) === canonical(expectedIdentity) &&
      canonical(record.workflow) ===
        canonical({
          repository: "supermarsx/sortOfRemoteNG",
          repositoryId: 1010282954,
          path: ".github/workflows/windows-arm-full-sdk.yml",
          ref: "refs/heads/main",
          head: sourceContext.head,
          runId: sourceContext.runId,
          attempt: sourceContext.attempt,
        }),
    "CHECKPOINT_IDENTITY",
  );
  const mapping = {
    sourceContext: "context.json",
    engineContext: "full-sdk-engine-cef-engine-context.json",
    launch: "full-sdk-engine-cef-engine-launch.json",
    job: "jobs/cef-engine/receipt.json",
    close: "full-sdk-engine-closed-cef-engine.json",
    sourceJob: "jobs/full-source-operation/receipt.json",
    sourceLauncher: "full-source-launcher-result.json",
    sourceClose: "full-source-closed-launcher.json",
  };
  parentMetadata_qualificationShape(
    record.rawChain,
    ["outcome", ...Object.keys(mapping)],
    "CHECKPOINT_CHAIN_FIELDS",
  );
  need(
    record.rawChain.outcome === "quiet-deadline",
    "CHECKPOINT_NATIVE_OUTCOME",
  );
  for (const [key, relative] of Object.entries(mapping))
    await read(relative, 1048576, record.rawChain[key]);
  need(
    canonical(record.rawChain.engineContext) ===
      canonical(state.nativeSliceFact.context) &&
      canonical(record.rawChain.launch) ===
        canonical(state.nativeSliceFact.launch) &&
      canonical(record.rawChain.job) ===
        canonical(state.nativeSliceFact.receipt) &&
      canonical(record.rawChain.close) ===
        canonical(state.nativeSliceFact.closure),
    "CHECKPOINT_PRIVATE_CHAIN",
  );
  const archive = record.outArchive;
  parentMetadata_qualificationShape(
    archive,
    [
      "complete",
      "chunks",
      "inventory",
      "rawBytes",
      "compressedBytes",
      "entries",
      "linksIncluded",
    ],
    "CHECKPOINT_ARCHIVE_FIELDS",
  );
  need(
    archive.complete === true &&
      archive.linksIncluded === false &&
      Number.isSafeInteger(archive.rawBytes) &&
      archive.rawBytes >= 0 &&
      archive.rawBytes <= 256 * 1024 ** 3 &&
      Number.isSafeInteger(archive.entries) &&
      archive.entries > 0 &&
      archive.entries <= 300000 &&
      Array.isArray(archive.chunks) &&
      archive.chunks.length > 0 &&
      archive.chunks.length <= 32 &&
      archive.inventory?.name === "inventory.json",
    "CHECKPOINT_ARCHIVE",
  );
  const rows = [
    { name: "checkpoint.json", ...checkpoint.pin, maximum: 2 * 1024 ** 2 },
    { name: "inputs.jsonl", ...record.inputSidecar, maximum: 1536 * 1024 ** 2 },
    { name: "graph.json", ...graph.pin, maximum: 16 * 1024 ** 2 },
    {
      name: "tools.json",
      ...state.source.toolProofSnapshot.record.pin,
      maximum: 16 * 1024 ** 2,
    },
    {
      name: "native-chain.json",
      ...record.nativeEvidence,
      maximum: 2 * 1024 ** 2,
    },
    { ...archive.inventory, maximum: 128 * 1024 ** 2 },
  ];
  let compressed = 0;
  for (const [index, row] of archive.chunks.entries()) {
    parentMetadata_qualificationShape(
      row,
      ["name", "bytes", "sha256"],
      "CHECKPOINT_CHUNK_FIELDS",
    );
    need(
      row.name === `checkpoint-${String(index).padStart(5, "0")}.bin`,
      "CHECKPOINT_CHUNK_NAME",
    );
    compressed += row.bytes;
    rows.push({ ...row, maximum: 1024 ** 3 });
  }
  need(
    Number.isSafeInteger(compressed) &&
      compressed === archive.compressedBytes &&
      compressed <= 32 * 1024 ** 3,
    "CHECKPOINT_COMPRESSED_BOUND",
  );
  const assets = [];
  for (const row of rows) {
    need(
      Number.isSafeInteger(row.bytes) &&
        row.bytes > 0 &&
        row.bytes <= row.maximum &&
        /^[a-f0-9]{64}$/.test(row.sha256),
      "CHECKPOINT_ASSET_BOUND",
    );
    assets.push(
      await sealSdkAsset(
        token,
        row.name,
        { size: row.bytes, sha256: row.sha256 },
        "checkpoint",
      ),
    );
  }
  for (const row of assets) {
    const value = await sealSdkAsset(token, row.name, row, "checkpoint");
    need(value.identity === row.identity, "CHECKPOINT_ASSET_CHANGED");
  }
  await work(token, state, () =>
    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),
  );
  await currentRoot(token, state);
  retained(token, state);
  need(state.assetFds.size === 0, "CHECKPOINT_FD_JOIN");
  const seal = Object.freeze({
    kind: "windows-arm-full-sdk-checkpoint-produced",
    image: state.source.image,
    sourceId: state.source.sourceId,
    target: state.source.target,
    checkpointSealed: true,
    sdkBuilt: false,
    nativeAcceptance: false,
    runtimeReady: false,
    publicationAllowed: false,
    bundle: "full-sdk-checkpoint-output",
    checkpoint: Object.freeze({ ...checkpoint.pin }),
    assets: Object.freeze(assets),
  });
  state.checkpointSeal = seal;
  return seal;
}

async function publishControllerOutcome(token, seal) {
  const state = controls.get(token);
  need(state, "CONTROL_BRAND");
  retained(token, state);
  need(
    (state.sdkSeal === seal && seal.sdkBuilt === true) ||
      (state.checkpointSeal === seal && seal.checkpointSealed === true),
    "RESULT_PRIVATE_FACT",
  );
  const operation = operationState(state.source.operationToken, true),
    context = operation.plan.rootPins.find(
      (row) => row.relative === "context.json",
    );
  await currentRoot(token, state);
  retained(token, state);
  const raw = Buffer.from(JSON.stringify(seal, null, 2) + "\n");
  need(raw.length <= 131072, "RESULT_BOUND");
  await work(token, state, () =>
    fs.writeFile(
      path.join(state.source.root, "full-sdk-controller-result.json"),
      raw,
      { flag: "wx" },
    ),
  );
  await currentRoot(token, state);
  retained(token, state);
  const file = process.env.GITHUB_OUTPUT;
  need(
    typeof file === "string" &&
      path.isAbsolute(file) &&
      path.dirname(file) ===
        path.join(
          path.resolve(CONTROLLER_REPO, "../../_temp"),
          "_runner_file_commands",
        ) &&
      /^set_output_[a-f0-9-]{36}$/.test(path.basename(file)),
    "RESULT_OUTPUT_PATH",
  );
  await physical(token, state, path.dirname(file));
  const record = Buffer.from(
    `root=${state.source.root.replaceAll("\\", "/")}\ncontext_sha256=${context.sha256}\noutcome=${seal.sdkBuilt ? "sdk" : "checkpoint"}\n`,
  );
  need(record.length <= 1024, "RESULT_OUTPUT_BOUND");
  state.assetFds ??= new Set();
  const fd = await work(
    token,
    state,
    () =>
      fs
        .open(
          file,
          constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
        )
        .then((value) => {
          state.assetFds.add(value);
          return value;
        }),
    async (late) => {
      await late.close();
      state.assetFds.delete(late);
    },
  );
  try {
    const before = await work(token, state, () => fd.stat({ bigint: true }));
    need(
      fileId(before) ===
        fileId(
          await work(token, state, () => fs.lstat(file, { bigint: true })),
        ),
      "RESULT_OUTPUT_CHANGED",
    );
    retained(token, state);
    await work(token, state, () => fd.writeFile(record));
    const after = await work(token, state, () => fd.stat({ bigint: true }));
    need(
      after.dev === before.dev &&
        after.ino === before.ino &&
        after.size === before.size + BigInt(record.length) &&
        fileId(after) ===
          fileId(
            await work(token, state, () => fs.lstat(file, { bigint: true })),
          ),
      "RESULT_OUTPUT_CHANGED",
    );
    await work(token, state, () => fd.close());
    state.assetFds.delete(fd);
  } catch (error) {
    throw fail(state, error);
  }
  await currentRoot(token, state);
  retained(token, state);
}
// END PRIVATE FINAL SDK VERIFICATION

async function runFullSdkTransaction(bootstrap) {
  const owner = bootstrapOwners.get(bootstrap);
  need(owner && owner.pid === process.pid, "BOOTSTRAP_BRAND");
  let operation,
    control,
    result,
    failed = false,
    primary;
  const remember = (error) => {
    if (!failed) {
      failed = true;
      primary = error;
    }
  };
  try {
    bootstrapState(bootstrap);
    operation = await createSourceOperation(bootstrap);
    observeStartupPhase(bootstrap, "source-launch");
    const source = await runSourcePhase(operation);
    control = await createControl(source, owner.lease);
    await prepareFreshPolicy(control);
    await runEnginePhase(control, "probe-clang");
    await runEnginePhase(control, "probe-link");
    const engine = await runEnginePhase(control, "cef-engine");
    if (engine === controls.get(control).nativeSliceFact) {
      await runEnginePhase(control, "checkpoint-seal");
      result = await verifyProducedCheckpoint(control);
    } else {
      await runEnginePhase(control, "package");
      result = await verifyProducedSdk(control);
    }
    await publishControllerOutcome(control, result);
  } catch (error) {
    captureStartupFailure(bootstrap, error);
    remember(error);
  } finally {
    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);
    const controlState = control ? controls.get(control) : undefined;
    try {
      if (control) await retireControl(control);
    } catch (error) {
      remember(error);
    }
    if (controlState && controlState.cleanupConfirmed !== true)
      remember(
        controlState.failed
          ? controlState.primary
          : new Error("FULL_SDK_CONTROL_CLEANUP_UNCONFIRMED"),
      );
    const sourceToken = operation ?? owner.operation,
      source = sourceToken ? sourceOperations.get(sourceToken) : undefined;
    try {
      if (sourceToken) await retireSourceOperation(sourceToken);
    } catch (error) {
      remember(error);
    }
    if (source && source.cleanupConfirmed !== true)
      remember(
        source.failed
          ? source.primary
          : new Error("FULL_SDK_CONTROL_SOURCE_CLEANUP_UNCONFIRMED"),
      );
    const leaseBeforeClose = leases.get(owner.lease),
      bootstrapCleanup = owner.bootstrapFailureCleanup ?? {
        cleanupEnd: Math.min(
          performance.now() + CLEANUP_MS,
          leaseBeforeClose.monoEnd - FINAL_RESERVE_MS,
        ),
        cleanupWallEnd: Math.min(
          Date.now() + CLEANUP_MS,
          leaseBeforeClose.wallEnd - FINAL_RESERVE_MS,
        ),
      };
    const closing = [...(owner.bootstrapFds ?? [])].map((fd) =>
      Promise.resolve()
        .then(() => fd.close())
        .then(() => owner.bootstrapFds.delete(fd)),
    );
    try {
      if (closing.length || owner.bootstrapPending?.size)
        await cleanupStep(bootstrapCleanup, () =>
          Promise.all([
            ...closing,
            ...[...(owner.bootstrapPending ?? [])].map((value) =>
              value.catch(() => undefined),
            ),
          ]),
        );
    } catch (error) {
      remember(error);
    }
    if (owner.bootstrapFds?.size || owner.bootstrapPending?.size)
      remember(new Error("FULL_SDK_CONTROL_BOOTSTRAP_CLEANUP_UNCONFIRMED"));
    // No awaited cleanup or falsy primary can skip these final revocations.
    owner.closed = true;
    bootstrapOwners.delete(bootstrap);
    const lease = leases.get(owner.lease);
    if (lease) lease.closed = true;
  }
  if (failed) throw primary;
  return result;
}
// END CLOSED FULL SDK SOURCE CONTROLLER

export function main(argv = process.argv.slice(2)) {
  const bootstrap = beginFullSdkBootstrap();
  try {
    need(
      !utilTypes.isProxy(argv) &&
        Array.isArray(argv) &&
        Object.getPrototypeOf(argv) === Array.prototype &&
        Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===
          "0,length" &&
        Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>
          Object.hasOwn(row, "value"),
        ) &&
        argv.length === 1 &&
        argv[0] === "--execute",
      "ENTRY_ARGV",
    );
    return runFullSdkTransaction(bootstrap);
  } catch (error) {
    captureStartupFailure(bootstrap, error);
    const owner = bootstrapOwners.get(bootstrap);
    owner.closed = true;
    leases.get(owner.lease).closed = true;
    bootstrapOwners.delete(bootstrap);
    throw error;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)
) {
  Promise.resolve()
    .then(() => main())
    .catch((error) => {
      console.error(JSON.stringify(startupFailureReport(error)));
      process.exitCode = 1;
    });
}
