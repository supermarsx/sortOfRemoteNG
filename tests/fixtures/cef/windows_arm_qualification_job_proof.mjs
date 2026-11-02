// Inactive, fixed benign proof. No production source/session capability escapes.
import fs from "node:fs/promises";
import * as syncFs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PROFILE = path.join(
  ROOT,
  "native/windows-arm-full-sdk/qualification-job-proof-profile.json",
);
const PROFILE_SHA =
  "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c";
const ROLES = Object.freeze([
  "qual-gn-desc-pa",
  "qual-gn-desc-cef",
  "qual-gn-args",
  "qual-generate-headers",
  "qual-clang-probe",
  "qual-link-probe",
]);
export const CASES = Object.freeze([
  "six-role-normal",
  "second-role-nonzero",
  "session-cancel-after-owned-output",
  "preaborted",
  "outer-cancel-after-assignment-before-resume",
  "deadline-with-pipe-descendant",
  "closed-pipe-orphan",
  "reparented-descendant",
  "bounded-output-failure",
]);
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const need = (condition, code) => {
  if (!condition) throw new Error(code);
};
const signature = (s) =>
  [
    s.dev,
    s.ino,
    s.size,
    s.mtimeNs,
    s.ctimeNs,
    s.birthtimeNs,
    s.mode,
    s.nlink,
  ].join(":");
const stable = (s) => [s.dev, s.ino, s.mode, s.nlink].join(":");
const canonical = (s) => path.resolve(s).replaceAll("\\", "/").toLowerCase();
function exact(value, fields) {
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("\0") === [...fields].sort().join("\0"),
    "PROOF_SCHEMA",
  );
}
async function physical(file) {
  need(
    path.isAbsolute(file) &&
      canonical(await fs.realpath(file)) === canonical(file),
    "PROOF_PATH",
  );
  for (let at = file; ; at = path.dirname(at)) {
    need(!(await fs.lstat(at)).isSymbolicLink(), "PROOF_LINK");
    if (path.dirname(at) === at) break;
  }
}
async function within(operation, end) {
  const pending = Promise.resolve(operation);
  pending.catch(() => {});
  checkEnd(end);
  if (end === Infinity) return pending;
  let timer;
  try {
    const value = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PROOF_DEADLINE")),
          Math.max(1, end - performance.now()),
        );
      }),
    ]);
    checkEnd(end);
    return value;
  } finally {
    clearTimeout(timer);
  }
}
async function held(file, maximum, expected, retain = true, end = Infinity) {
  await within(physical(file), end);
  const before = await within(fs.lstat(file, { bigint: true }), end);
  need(
    before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
    "PROOF_FILE",
  );
  let handle,
    expired = false;
  const opening = fs
    .open(file, syncFs.constants.O_RDONLY | (syncFs.constants.O_NOFOLLOW ?? 0))
    .then((value) => {
      handle = value;
      if (expired) value.close().catch(() => {});
      return value;
    });
  let failed = false,
    primary;
  try {
    await within(opening, end);
    need(
      signature(await within(handle.stat({ bigint: true }), end)) ===
        signature(before),
      "PROOF_FILE_IDENTITY",
    );
    const digest = createHash("sha256"),
      chunks = [];
    for (let at = 0; at < Number(before.size);) {
      const buffer = Buffer.alloc(Math.min(65536, Number(before.size) - at));
      const { bytesRead } = await within(
        handle.read(buffer, 0, buffer.length, at),
        end,
      );
      need(bytesRead > 0 && bytesRead <= buffer.length, "PROOF_SHORT_READ");
      const raw = buffer.subarray(0, bytesRead);
      digest.update(raw);
      if (retain) chunks.push(raw);
      at += bytesRead;
    }
    const pin = { bytes: Number(before.size), sha256: digest.digest("hex") };
    need(
      !expected ||
        (expected.bytes === pin.bytes && expected.sha256 === pin.sha256),
      "PROOF_PIN",
    );
    need(
      signature(await within(handle.stat({ bigint: true }), end)) ===
        signature(before) &&
        signature(await within(fs.lstat(file, { bigint: true }), end)) ===
          signature(before),
      "PROOF_FILE_CHANGED",
    );
    await within(physical(file), end);
    return { raw: retain ? Buffer.concat(chunks) : undefined, pin };
  } catch (error) {
    failed = true;
    expired = true;
    primary = error;
    throw error;
  } finally {
    try {
      if (handle) await within(handle.close(), end);
    } catch (error) {
      if (!failed) throw error;
      else void primary;
    }
  }
}
async function policy(end = Infinity) {
  const { raw } = await held(PROFILE, 65536, undefined, true, end);
  need(hash(raw) === PROFILE_SHA, "PROOF_PROFILE");
  const p = JSON.parse(raw);
  need(
    JSON.stringify(p.cases) === JSON.stringify(CASES) &&
      p.suiteSeconds === 300 &&
      p.workSeconds === 150 &&
      p.finalReserveSeconds === 150,
    "PROOF_POLICY",
  );
  return p;
}
export function inspectAuthority(p, env, host) {
  need(
    p.workflowActivation === true && p.proofExecutionAdmitted === true,
    "PROOF_INACTIVE",
  );
  need(host.platform === "win32" && host.arch === "x64", "PROOF_HOST");
  const fixed = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: p.repository,
    GITHUB_REPOSITORY_ID: p.repositoryId,
    GITHUB_REF: p.ref,
    ImageVersion: p.image,
  };
  need(
    Object.entries(fixed).every(([k, v]) => env[k] === v),
    "PROOF_AUTHORITY",
  );
  need(
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF === `${p.repository}/${p.workflow}@${p.ref}`,
    "PROOF_AUTHORITY",
  );
  need(
    /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "PROOF_AUTHORITY",
  );
}
export function extractSubject(raw, p) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length === p.subject.bytes &&
      hash(raw) === p.subject.sha256,
    "PROOF_SUBJECT",
  );
  const text = raw.toString("utf8");
  const span = (a, b, include = false) => {
    need(
      text.split(a).length === 2 && text.split(b).length === 2,
      "PROOF_SUBJECT_SPAN",
    );
    return text.slice(
      text.indexOf(a),
      text.indexOf(b) + (include ? b.length : 0),
    );
  };
  const result = {
    joined: span(
      "// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES\n",
      "// END INACTIVE JOINED OBSERVATION PRIMITIVES",
      true,
    ),
    signature: span("const signature = (s) =>", "const shared ="),
    physical: span("async function physical(file) {", "async function held("),
  };
  for (const key of ["joined", "signature", "physical"])
    need(hash(result[key]) === p.subject[key + "Sha256"], "PROOF_SUBJECT_SPAN");
  const imported =
    'import { fstatSync as qualificationFdStat } from "node:fs";\n';
  need(result.joined.split(imported).length === 2, "PROOF_SUBJECT_IMPORT");
  return Object.freeze({
    ...result,
    joined: result.joined.replace(imported, ""),
  });
}
export function caseFileScope(file, name) {
  need(
    CASES.includes(name) && typeof file === "string" && path.isAbsolute(file),
    "PROOF_CASE_PATH",
  );
  const relative = path.relative(ROOT, file).replaceAll("\\", "/");
  const match =
    /^\.artifacts\/windows-arm-job-proof-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/([^/]+)\/case\.json$/.exec(
      relative,
    );
  need(match && match[2] === name, "PROOF_CASE_PATH");
  return match[1];
}
async function sourceWitness(p, head, end) {
  const sources = {};
  let total = 0;
  for (const relative of p.sourcePaths) {
    need(
      performance.now() < end &&
        typeof relative === "string" &&
        !relative.split("/").some((x) => !x || x === "." || x === ".."),
      "PROOF_SOURCE_PATH",
    );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(15000, end - performance.now())),
    );
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/${p.repository}/${head}/${relative}`,
        { redirect: "error", signal: controller.signal },
      );
      need(response.status === 200 && response.body, "PROOF_SOURCE_WITNESS");
      const reader = response.body.getReader(),
        chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          total += value.length;
          need(
            bytes <= 4 * 1024 ** 2 &&
              total <= 16 * 1024 ** 2 &&
              performance.now() < end,
            "PROOF_SOURCE_BOUND",
          );
          chunks.push(Buffer.from(value));
        }
      } finally {
        await within(
          reader.cancel().catch(() => {}),
          end,
        );
        reader.releaseLock();
      }
      const raw = Buffer.concat(chunks),
        file = await held(
          path.join(ROOT, relative),
          4 * 1024 ** 2,
          undefined,
          true,
          end,
        );
      need(raw.equals(file.raw), "PROOF_SOURCE_CHANGED");
      sources[relative] = file.pin;
    } finally {
      clearTimeout(timer);
    }
  }
  return sources;
}
function checkEnd(end) {
  need(performance.now() < end, "PROOF_DEADLINE");
}
async function writeExclusive(file, raw, end) {
  checkEnd(end);
  need(Buffer.isBuffer(raw) && raw.length <= 131072, "PROOF_WRITE_BOUND");
  const directory = path.dirname(file);
  await within(physical(directory), end);
  const before = stable(
    await within(fs.lstat(directory, { bigint: true }), end),
  );
  let handle,
    failed = false,
    primary,
    expired = false;
  const opening = fs
    .open(
      file,
      syncFs.constants.O_WRONLY |
        syncFs.constants.O_CREAT |
        syncFs.constants.O_EXCL |
        (syncFs.constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    .then((value) => {
      handle = value;
      if (expired) value.close().catch(() => {});
      return value;
    });
  try {
    await within(opening, end);
    const created = await within(handle.stat({ bigint: true }), end);
    need(
      created.isFile() && created.nlink === 1n && created.size === 0n,
      "PROOF_WRITE_FILE",
    );
    await within(handle.writeFile(raw), end);
    await within(handle.sync(), end);
  } catch (error) {
    failed = true;
    expired = true;
    primary = error;
    throw error;
  } finally {
    try {
      if (handle) await within(handle.close(), end);
    } catch (error) {
      if (!failed) throw error;
      else void primary;
    }
  }
  checkEnd(end);
  await within(physical(directory), end);
  need(
    stable(await within(fs.lstat(directory, { bigint: true }), end)) === before,
    "PROOF_WRITE_DIRECTORY",
  );
  need(
    (await held(file, 131072, undefined, true, end)).raw.equals(raw),
    "PROOF_WRITE",
  );
}
async function runController(p, root, pin, end, env) {
  checkEnd(end);
  const childEnv = {
    SystemRoot: "C:/Windows",
    WINDIR: "C:/Windows",
    PATH: "C:/Windows/System32",
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    USERPROFILE: path.join(root, "home"),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  for (const key of [
    "GITHUB_ACTIONS",
    "GITHUB_EVENT_NAME",
    "RUNNER_ENVIRONMENT",
    "GITHUB_REPOSITORY_VISIBILITY",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "ImageVersion",
    "RUNNER_TRACKING_ID",
  ])
    if (typeof env[key] === "string") childEnv[key] = env[key];
  const child = spawn(
    p.python.path,
    [
      "-I",
      "-B",
      "-S",
      path.join(ROOT, "native/windows-arm-full-sdk/qualification-job-proof.py"),
      "--suite",
      root,
      pin,
    ],
    {
      cwd: ROOT,
      env: childEnv,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let failed = false,
    primary,
    closed = false,
    rootExited = false,
    bytes = 0,
    code = null,
    signal = null;
  const chunks = [];
  const deny = (error) => {
    if (!failed) {
      failed = true;
      primary = error;
    }
    if (!closed && !rootExited) child.kill("SIGKILL");
  };
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  child.once("error", deny);
  child.once("exit", () => {
    rootExited = true;
  });
  child.once("close", (value, exitSignal) => {
    rootExited = true;
    closed = true;
    code = value;
    signal = exitSignal;
    finish();
  });
  for (const [index, stream] of [child.stdout, child.stderr].entries()) {
    stream.on("error", deny);
    stream.on("data", (raw) => {
      bytes += raw.length;
      if (bytes > 262144) deny(new Error("PROOF_CONTROLLER_OUTPUT"));
      else if (index === 0) chunks.push(raw);
    });
  }
  const timer = setTimeout(
    () => deny(new Error("PROOF_CONTROLLER_DEADLINE")),
    Math.max(1, end - performance.now() - 1000),
  );
  let joinTimer;
  try {
    await Promise.race([
      done,
      new Promise((_, reject) => {
        joinTimer = setTimeout(
          () => reject(new Error("PROOF_CONTROLLER_JOIN")),
          Math.max(1, end - performance.now()),
        );
      }),
    ]);
    if (failed) throw primary;
    checkEnd(end);
    need(code === 0 && signal === null, "PROOF_CONTROLLER_EXIT");
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw failed ? primary : error;
  } finally {
    clearTimeout(timer);
    clearTimeout(joinTimer);
    if (!closed) {
      if (!rootExited) child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
  }
}
export function validateControllerResult(value, p, nonce, head) {
  exact(value, [
    "schemaVersion",
    "kind",
    "complete",
    "nonce",
    "head",
    "cases",
    "rawReceipts",
    "scratchRemoved",
    "productionAdmission",
    "sourceGnQualified",
    "compilerAdmission",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  need(
    value.schemaVersion === 1 &&
      value.kind === "windows-benign-job-controller-result" &&
      value.complete === true &&
      value.nonce === nonce &&
      value.head === head &&
      value.scratchRemoved === true,
    "PROOF_RESULT",
  );
  for (const key of [
    "productionAdmission",
    "sourceGnQualified",
    "compilerAdmission",
    "nativeAcceptance",
    "runtimeReady",
  ])
    need(value[key] === false, "PROOF_GRANT");
  need(
    Array.isArray(value.cases) &&
      value.cases.length === 9 &&
      Array.isArray(value.rawReceipts) &&
      value.rawReceipts.length === 9,
    "PROOF_CASES",
  );
  const receipts = [];
  const cases = value.cases.map((row, index) => {
    exact(row, [
      "case",
      "expectedOutcome",
      "kernelOutcome",
      "workerStarted",
      "assignedBeforeResume",
      "resumed",
      "activeAtEnd",
      "rootReaped",
      "readersJoined",
      "closeCalls",
      "checkedCloseCallsSucceeded",
      "foreignControllerPreserved",
      "assignmentObserverVerified",
      "reparentedDescendantVerified",
      "node",
      "kernelReceiptPin",
    ]);
    need(
      row.case === CASES[index] &&
        row.kernelOutcome === row.expectedOutcome &&
        row.activeAtEnd === 0 &&
        row.readersJoined === true &&
        row.checkedCloseCallsSucceeded === true &&
        row.foreignControllerPreserved === true &&
        Number.isSafeInteger(row.closeCalls) &&
        row.closeCalls >= 1 &&
        row.closeCalls <= p.maxCloseCalls,
      "PROOF_CASE_RESULT",
    );
    const encoded = value.rawReceipts[index];
    need(
      typeof encoded === "string" &&
        encoded.length <= 90000 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
      "PROOF_RECEIPT",
    );
    const raw = Buffer.from(encoded, "base64");
    need(
      raw.toString("base64") === encoded &&
        raw.length > 0 &&
        raw.length <= 65536 &&
        row.kernelReceiptPin.bytes === raw.length &&
        row.kernelReceiptPin.sha256 === hash(raw),
      "PROOF_RECEIPT",
    );
    const receipt = JSON.parse(raw);
    exact(row.kernelReceiptPin, ["bytes", "sha256"]);
    const created = row.case !== "preaborted";
    const wanted = [
      "preaborted",
      "outer-cancel-after-assignment-before-resume",
    ].includes(row.case)
      ? "cancelled"
      : row.case === "deadline-with-pipe-descendant"
        ? "deadline"
        : ["closed-pipe-orphan", "reparented-descendant"].includes(row.case)
          ? "descendants-left"
          : "success";
    need(
      row.expectedOutcome === wanted &&
        receipt.outcome === wanted &&
        receipt.cleanupVerified === true &&
        receipt.activeAtEnd === 0 &&
        receipt.logReadersStopped === true &&
        receipt.success === (wanted === "success") &&
        receipt.started === created &&
        row.workerStarted === created,
      "PROOF_RECEIPT_FACTS",
    );
    need(
      receipt.assignedBeforeResume === created &&
        row.assignedBeforeResume === created &&
        row.resumed === receipt.resumed,
      "PROOF_RECEIPT_FACTS",
    );
    if (created) {
      need(
        receipt.assignedAtCreationVerified === true &&
          receipt.observerStopped === true &&
          receipt.handleListOnly === true &&
          receipt.assignmentMode === "creation-attribute" &&
          receipt.rootReaped === true &&
          row.rootReaped === true &&
          row.assignmentObserverVerified === true,
        "PROOF_RECEIPT_FACTS",
      );
      need(
        JSON.stringify(receipt.policyReadback) ===
          JSON.stringify({
            flags: 8712,
            activeProcessLimit: 64,
            jobMemoryBytes: "8589934592",
            cpuFlags: 5,
            cpuRate: 2500,
            inheritedHandles: 3,
            affinityChanged: false,
          }) &&
          receipt.jobHandleInheritable === false &&
          receipt.jobHandleInStdioAllowlist === false,
        "PROOF_RECEIPT_POLICY",
      );
    } else
      need(
        row.rootReaped === null &&
          receipt.resumed === false &&
          receipt.jobCreated === false &&
          row.assignmentObserverVerified === false,
        "PROOF_PREABORT",
      );
    need(
      row.reparentedDescendantVerified ===
        (row.case === "reparented-descendant"),
      "PROOF_REPARENT",
    );
    need(
      receipt.resumed ===
        (created && row.case !== "outer-cancel-after-assignment-before-resume"),
      "PROOF_RESUME",
    );
    if (wanted === "success" || wanted === "descendants-left")
      need(receipt.rootExit === 0, "PROOF_ROOT_EXIT");
    if (wanted === "descendants-left")
      need(
        Number.isSafeInteger(receipt.observedChildrenReaped) &&
          receipt.observedChildrenReaped >= 1,
        "PROOF_ORPHAN",
      );
    if (
      [
        "preaborted",
        "outer-cancel-after-assignment-before-resume",
        "deadline-with-pipe-descendant",
      ].includes(row.case)
    )
      need(row.node === null, "PROOF_NODE_UNCREATED");
    else {
      const node = row.node;
      exact(node, [
        "schemaVersion",
        "kind",
        "case",
        "complete",
        "failure",
        "rolesStarted",
        "rolesJoined",
        "logFiles",
        "unconfirmedClose",
        "fileChecks",
        "closedEntryDenied",
        "rootAndPipesJoined",
        "cohortQuietProven",
        "productionAdmission",
      ]);
      const failure =
        {
          "second-role-nonzero": "PRIVATE_COMMAND_EXIT",
          "session-cancel-after-owned-output": "PRIVATE_CANCELLED",
          "bounded-output-failure": "PRIVATE_COMMAND_OUTPUT_BOUND",
        }[row.case] ?? null;
      need(
        node.schemaVersion === 1 &&
          node.kind === "windows-benign-node-provisional" &&
          node.case === row.case &&
          node.failure === failure &&
          node.complete === (failure === null) &&
          node.unconfirmedClose === false &&
          node.rootAndPipesJoined === true &&
          node.cohortQuietProven === false &&
          node.productionAdmission === false,
        "PROOF_NODE_RESULT",
      );
      need(
        node.rolesStarted ===
          (row.case === "six-role-normal"
            ? 6
            : row.case === "second-role-nonzero"
              ? 2
              : 1),
        "PROOF_NODE_ROLES",
      );
      need(
        Number.isSafeInteger(node.rolesJoined) &&
          node.rolesJoined >= 0 &&
          node.rolesJoined <= 6 &&
          Number.isSafeInteger(node.logFiles) &&
          node.logFiles >= 0 &&
          node.logFiles <= 12 &&
          node.closedEntryDenied === true &&
          node.fileChecks === (row.case === "six-role-normal"),
        "PROOF_NODE_FACTS",
      );
      if (row.case === "six-role-normal")
        need(
          node.rolesJoined === 6 &&
            node.logFiles === 12 &&
            node.fileChecks === true &&
            node.closedEntryDenied === true,
          "PROOF_NODE_NORMAL",
        );
    }
    receipts.push(raw);
    return {
      ...row,
      kernelReceiptPin: { ...row.kernelReceiptPin },
      node: row.node ? { ...row.node } : null,
    };
  });
  return {
    proof: {
      schemaVersion: 1,
      kind: "windows-private-benign-job-proof",
      complete: true,
      nonce,
      head,
      subjectSha256: p.subject.sha256,
      kernelSha256: p.kernel.sha256,
      cases,
      scratchRemoved: true,
      productionAdmission: false,
      sourceGnQualified: false,
      compilerAdmission: false,
      nativeAcceptance: false,
      runtimeReady: false,
    },
    receipts,
  };
}
function tinyPe() {
  const raw = Buffer.alloc(1024);
  raw.write("MZ");
  raw.writeUInt32LE(128, 60);
  raw.writeUInt32LE(0x4550, 128);
  raw.writeUInt16LE(0x8664, 132);
  raw.writeUInt16LE(1, 134);
  raw.writeUInt16LE(240, 148);
  raw.writeUInt16LE(0x20b, 152);
  raw.writeUInt32LE(512, 212);
  return raw;
}
function realm(parts, phaseFactory, vectors, proofSpawn) {
  const text =
    parts.signature +
    "\n" +
    parts.physical +
    "\n" +
    parts.joined +
    "\n({createQualificationSession,qualificationSourceRuns,qualificationSessions,qualificationObservations,qualificationCoordinatorSources,qualificationHeld,qualificationStaticPe,runFixedJoined})";
  return vm.runInNewContext(text, {
    fs,
    constants: syncFs.constants,
    path,
    Buffer,
    createHash,
    performance,
    setTimeout,
    clearTimeout,
    REPO: ROOT,
    PRIVATE_PROFILE_SHA256: "0".repeat(64),
    PRIVATE_ROLES: ROLES,
    qualificationPhaseClock: phaseFactory,
    qualificationCoordinatorSources: new WeakSet(),
    privateCommandProjections: () => vectors,
    staticProjectionEqual: () => false,
    sha: hash,
    need,
    spawn: proofSpawn,
    openSync: syncFs.openSync,
    writeSync: syncFs.writeSync,
    closeSync: syncFs.closeSync,
    qualificationFdStat: syncFs.fstatSync,
  });
}
async function worker(p, name, file, pin) {
  need(
    process.platform === "win32" &&
      process.arch === "x64" &&
      canonical(process.execPath) === canonical(p.node.path),
    "PROOF_WORKER_HOST",
  );
  const nonce = caseFileScope(file, name);
  need(/^[a-f0-9]{64}$/.test(pin), "PROOF_CASE_PIN");
  const context = JSON.parse(
    (
      await held(file, 65536, {
        bytes: (await fs.stat(file)).size,
        sha256: pin,
      })
    ).raw,
  );
  exact(context, [
    "kind",
    "case",
    "root",
    "nonce",
    "head",
    "sourceHead",
    "workEndMs",
    "subjectSha256",
  ]);
  need(
    context.kind === "windows-benign-job-case" &&
      context.case === name &&
      context.nonce === nonce &&
      context.subjectSha256 === p.subject.sha256 &&
      path.dirname(file) === context.root &&
      Number.isSafeInteger(context.workEndMs) &&
      context.workEndMs > Date.now() &&
      context.workEndMs - Date.now() <= 20000,
    "PROOF_CASE_CONTEXT",
  );
  await held(p.node.path, p.node.bytes, p.node, false);
  const root = context.root;
  await physical(root);
  const end = performance.now() + Math.max(0, context.workEndMs - Date.now());
  checkEnd(end);
  const source = await held(
      path.join(ROOT, p.subject.path),
      p.subject.bytes,
      p.subject,
    ),
    parts = extractSubject(source.raw, p);
  const subject = await import(
    pathToFileURL(path.join(ROOT, p.subject.path)).href
  );
  need(subject.PRIVATE_DRIVER_ADMITTED === false, "PROOF_SUBJECT_GATE");
  let closedEntryDenied = false;
  try {
    await subject.main([
      "--private-source-gn",
      path
        .join(ROOT, ".artifacts", `windows-arm-full-sdk-${context.nonce}`)
        .replaceAll("\\", "/"),
      "a".repeat(64),
      "--execute",
    ]);
  } catch (error) {
    closedEntryDenied = error.message === "PRIVATE_EXECUTION_CLOSED";
  }
  need(closedEntryDenied, "PROOF_SUBJECT_GATE");
  const controller = new AbortController();
  let rolesStarted = 0;
  const actorKind = (index) =>
    name === "second-role-nonzero" && index === 1
      ? "nonzero"
      : name === "session-cancel-after-owned-output"
        ? "ready-hold"
        : name === "bounded-output-failure"
          ? "flood"
          : name === "deadline-with-pipe-descendant"
            ? "pipe-descendant"
            : name === "closed-pipe-orphan"
              ? "orphan"
              : name === "reparented-descendant"
                ? "reparent"
                : "normal";
  const vectors = ROLES.map((role, index) => ({
    role,
    argv: [
      p.node.path,
      "--disable-proto=throw",
      "--no-addons",
      SELF,
      "--actor",
      actorKind(index),
      file,
      pin,
    ],
    cwd: root,
  }));
  const model = realm(
    parts,
    subject.qualificationPhaseClock,
    vectors,
    (...args) => {
      const child = spawn(...args);
      if (name === "session-cancel-after-owned-output") {
        let marker = "";
        child.stdout.on("data", (chunk) => {
          marker = (marker + chunk.toString("ascii")).slice(-64);
          if (marker.includes("PROOF_READY\n")) controller.abort();
        });
      }
      return child;
    },
  );
  const token = Object.freeze({ proofOnly: true });
  const sourceState = {
    root,
    budget: { remaining: () => Math.max(0, end - performance.now()) + 150000 },
    signal: controller.signal,
    context: {},
    contextSha: "a".repeat(64),
    privatePolicyRaw: Buffer.from("{}"),
    logsIdentity: signature(
      await fs.lstat(path.join(root, "private-qualification-logs"), {
        bigint: true,
      }),
    ),
    output: { bytes: 0 },
    environment: process.env,
    compilerEnvironment: process.env,
    custom: { sourceGitEnvironment: async (_token, env) => ({ ...env }) },
    gitPolicy: { proofOnly: true },
    validateBefore: async () => {
      checkEnd(end);
    },
    validateAfter: async () => {
      checkEnd(end);
    },
  };
  sourceState.phase = subject.qualificationPhaseClock(sourceState.budget);
  sourceState.end = Math.min(
    end,
    performance.now() + sourceState.phase.maximumWorkMs,
  );
  model.qualificationSourceRuns.set(token, sourceState);
  // This set belongs only to this isolated VM, never the production module.
  model.qualificationCoordinatorSources.add(token);
  const session = model.createQualificationSession(token),
    state = model.qualificationSessions.get(session);
  let fileChecks = false;
  if (name === "six-role-normal") {
    const pe = path.join(root, "tiny-pe.bin"),
      raw = tinyPe();
    await fs.writeFile(pe, raw, { flag: "wx" });
    const observed = await model.qualificationHeld(
      pe,
      { bytes: raw.length, sha256: hash(raw) },
      state,
      model.qualificationStaticPe,
    );
    need(
      observed.projection.machine === 0x8664 &&
        observed.projection.imports.length === 0,
      "PROOF_FILE_CHECK",
    );
    const negative = async (file, pin, inspect) => {
      const isolatedSession = model.createQualificationSession(token),
        isolated = model.qualificationSessions.get(isolatedSession);
      let denied = false;
      try {
        await model.qualificationHeld(file, pin, isolated, inspect);
      } catch (error) {
        denied = /^(?:PRIVATE|FULL)_/.test(error.message);
      }
      need(denied, "PROOF_FILE_NEGATIVE");
    };
    await negative(pe, { bytes: raw.length, sha256: "0".repeat(64) }, null);
    const malformed = path.join(root, "malformed-pe.bin"),
      bad = Buffer.from(raw);
    bad[0] = 0;
    await fs.writeFile(malformed, bad, { flag: "wx" });
    await negative(
      malformed,
      { bytes: bad.length, sha256: hash(bad) },
      model.qualificationStaticPe,
    );
    const linked = path.join(root, "hardlink.bin");
    await fs.link(pe, linked);
    try {
      await negative(linked, { bytes: raw.length, sha256: hash(raw) }, null);
    } finally {
      await fs.unlink(linked);
    }
    const alias = path.join(root, "junction");
    await fs.symlink(root, alias, "junction");
    try {
      await negative(
        path.join(alias, "tiny-pe.bin"),
        { bytes: raw.length, sha256: hash(raw) },
        null,
      );
    } finally {
      await fs.unlink(alias);
    }
    await negative(pe, { bytes: raw.length, sha256: hash(raw) }, async () => {
      await fs.writeFile(pe, bad);
      return null;
    });
    fileChecks = true;
  }
  let failure = null;
  try {
    for (const [index, role] of ROLES.entries()) {
      if (
        index > 0 &&
        name !== "six-role-normal" &&
        name !== "second-role-nonzero"
      )
        break;
      const observation = Object.freeze({ proofOnly: true });
      model.qualificationObservations.set(observation, {
        session,
        state,
        role,
        epoch: state.epoch,
      });
      rolesStarted++;
      state.locallyJoined = false;
      await model.runFixedJoined(session, role, observation);
    }
  } catch (error) {
    failure = [
      "PRIVATE_COMMAND_EXIT",
      "PRIVATE_CANCELLED",
      "PRIVATE_COMMAND_OUTPUT_BOUND",
    ].includes(error.message)
      ? error.message
      : "PROOF_NODE_DENIED";
  }
  checkEnd(end);
  const result = {
    schemaVersion: 1,
    kind: "windows-benign-node-provisional",
    case: name,
    complete: failure === null,
    failure,
    rolesStarted,
    rolesJoined: state.next,
    logFiles: state.logFiles.size,
    unconfirmedClose: state.unconfirmedClose === true,
    fileChecks,
    closedEntryDenied,
    rootAndPipesJoined: state.locallyJoined === true,
    cohortQuietProven: false,
    productionAdmission: false,
  };
  await writeExclusive(
    path.join(root, "node-result.json"),
    Buffer.from(JSON.stringify(result) + "\n"),
    end,
  );
}
async function actor(kind, file, pin, p) {
  need(
    process.platform === "win32" && process.arch === "x64",
    "PROOF_ACTOR_HOST",
  );
  need(
    [
      "normal",
      "nonzero",
      "flood",
      "ready-hold",
      "hold",
      "orphan",
      "pipe-descendant",
      "reparent",
      "middle",
    ].includes(kind) && /^[a-f0-9]{64}$/.test(pin),
    "PROOF_ACTOR",
  );
  const name = path.basename(path.dirname(file)),
    nonce = caseFileScope(file, name);
  const context = JSON.parse(
    (
      await held(file, 65536, {
        bytes: (await fs.stat(file)).size,
        sha256: pin,
      })
    ).raw,
  );
  need(
    context.case === name &&
      context.nonce === nonce &&
      Date.now() < context.workEndMs &&
      path.dirname(file) === context.root,
    "PROOF_ACTOR_CONTEXT",
  );
  if (kind === "normal") {
    process.stdout.write("PROOF_NORMAL\n");
    process.stderr.write("PROOF_STDERR\n");
    return;
  }
  if (kind === "nonzero") {
    process.exitCode = 23;
    return;
  }
  if (kind === "flood") {
    process.stdout.write(Buffer.alloc(1048577, 120));
    return;
  }
  if (kind === "ready-hold" || kind === "hold") {
    if (kind === "ready-hold") process.stdout.write("PROOF_READY\n");
    const timer = setInterval(() => {}, 1000);
    setTimeout(() => clearInterval(timer), 20000);
    return;
  }
  if (kind === "reparent") {
    const middle = spawn(
      p.node.path,
      [
        "--disable-proto=throw",
        "--no-addons",
        SELF,
        "--actor",
        "middle",
        file,
        pin,
      ],
      {
        cwd: context.root,
        env: process.env,
        shell: false,
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let text = "";
    middle.stdout.on("data", (raw) => {
      text += raw.toString("ascii");
      need(text.length <= 128, "PROOF_REPARENT_OUTPUT");
    });
    await new Promise((resolve, reject) => {
      middle.once("error", reject);
      middle.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("PROOF_MIDDLE_EXIT")),
      );
    });
    const matched = /^PROOF_CHILD:([1-9][0-9]{0,9})\n$/.exec(text);
    need(matched, "PROOF_REPARENT_OUTPUT");
    await fs.writeFile(
      path.join(context.root, "reparent.json"),
      JSON.stringify({
        middlePid: middle.pid,
        childPid: Number(matched[1]),
        middleClosed: true,
      }) + "\n",
      { flag: "wx" },
    );
    return;
  }
  if (kind === "orphan" || kind === "pipe-descendant" || kind === "middle") {
    const child = spawn(
      p.node.path,
      [
        "--disable-proto=throw",
        "--no-addons",
        SELF,
        "--actor",
        "hold",
        file,
        pin,
      ],
      {
        cwd: context.root,
        env: process.env,
        shell: false,
        windowsHide: true,
        detached: false,
        stdio:
          kind === "pipe-descendant"
            ? ["ignore", "inherit", "inherit"]
            : "ignore",
      },
    );
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    if (kind === "middle") process.stdout.write(`PROOF_CHILD:${child.pid}\n`);
    return;
  }
  need(false, "PROOF_ACTOR");
}
export async function main(argv = process.argv.slice(2)) {
  const startedMs = Date.now(),
    end = performance.now() + 300000;
  const p = await policy(end);
  need(
    p.workflowActivation === true && p.proofExecutionAdmitted === true,
    "PROOF_INACTIVE",
  );
  if (argv.length === 4 && argv[0] === "--worker")
    return worker(p, argv[1], argv[2], argv[3]);
  if (argv.length === 4 && argv[0] === "--actor")
    return actor(argv[1], argv[2], argv[3], p);
  need(argv.length === 0, "PROOF_ARGV");
  inspectAuthority(p, process.env, process);
  const nonce = randomUUID(),
    head = process.env.GITHUB_SHA;
  const gitHead = (
    await held(path.join(ROOT, ".git/HEAD"), 41, undefined, true, end)
  ).raw.toString("ascii");
  need(gitHead === head + "\n", "PROOF_HEAD");
  const sources = await sourceWitness(p, head, end);
  for (const tool of [p.python, p.node])
    await held(tool.path, tool.bytes, tool, false, end);
  checkEnd(end);
  const artifacts = path.join(ROOT, ".artifacts");
  await within(
    fs.mkdir(artifacts).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    }),
    end,
  );
  await within(physical(artifacts), end);
  const root = path.join(ROOT, ".artifacts", "windows-arm-job-proof-" + nonce),
    reportRoot = path.join(
      ROOT,
      ".artifacts",
      "windows-arm-job-report-" + nonce,
    );
  await fs.mkdir(root);
  await fs.mkdir(reportRoot);
  for (const name of ["tmp", "home"]) await fs.mkdir(path.join(root, name));
  const rootIdentity = stable(await fs.lstat(root, { bigint: true })),
    reportIdentity = stable(await fs.lstat(reportRoot, { bigint: true }));
  const preparation = Buffer.from(
    JSON.stringify({
      kind: "windows-benign-job-preparation",
      nonce,
      head,
      startedMs,
      sources,
    }) + "\n",
  );
  await writeExclusive(path.join(root, "preparation.json"), preparation, end);
  need(performance.now() < end - 150000, "PROOF_RESERVE");
  need(
    stable(await within(fs.lstat(root, { bigint: true }), end)) ===
      rootIdentity,
    "PROOF_ROOT_CHANGED",
  );
  const raw = await runController(p, root, hash(preparation), end, process.env);
  checkEnd(end);
  const result = validateControllerResult(raw, p, nonce, head);
  for (const [relative, pin] of Object.entries(sources))
    await held(path.join(ROOT, relative), 4 * 1024 ** 2, pin, true, end);
  need(
    (
      await held(path.join(ROOT, ".git/HEAD"), 41, undefined, true, end)
    ).raw.toString("ascii") ===
      head + "\n",
    "PROOF_HEAD",
  );
  await fs.lstat(root).then(
    () => need(false, "PROOF_SCRATCH_LEFT"),
    (error) => need(error.code === "ENOENT", "PROOF_SCRATCH_LEFT"),
  );
  need(
    stable(await within(fs.lstat(reportRoot, { bigint: true }), end)) ===
      reportIdentity,
    "PROOF_REPORT_ROOT",
  );
  for (const [index, receipt] of result.receipts.entries()) {
    need(
      stable(await within(fs.lstat(reportRoot, { bigint: true }), end)) ===
        reportIdentity,
      "PROOF_REPORT_ROOT",
    );
    await writeExclusive(
      path.join(reportRoot, `receipt-${index}.json`),
      receipt,
      end,
    );
  }
  need(
    stable(await within(fs.lstat(reportRoot, { bigint: true }), end)) ===
      reportIdentity,
    "PROOF_REPORT_ROOT",
  );
  await writeExclusive(
    path.join(reportRoot, "proof.json"),
    Buffer.from(JSON.stringify(result.proof) + "\n"),
    end,
  );
  checkEnd(end);
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF)
  main().catch(() => {
    console.error("PROOF_DENIED");
    process.exitCode = 1;
  });
