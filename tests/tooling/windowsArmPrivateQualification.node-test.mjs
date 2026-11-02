import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import vm from "node:vm";
import * as syncFs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parse } from "acorn";
import {
  PRIVATE_DRIVER_ADMITTED,
  sourceJobProjection,
  qualificationPhaseClock,
  privateCommandProjections,
  staticLoadingProjection,
  loadSealedProfile as privateLoadSealedProfile,
  reviewedHostClosure as privateHostClosure,
  sourcePaths as privateSourcePaths,
  bootstrapProgram as privateBootstrapProgram,
} from "../../native/windows-arm-full-sdk/private-source-driver.mjs";
import {
  prepareSourceGitIsolation,
  sourceGitEnvironment,
} from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";

const base = "native/windows-arm-full-sdk/";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const policy = JSON.parse(
  await readFile(base + "private-qualification-profile.json", "utf8"),
);

test("private Windows qualification first slice runs only portable projection and denial tests", () => {
  const result = spawnSync(
    "python",
    ["-I", "-B", base + "test_private_qualification.py"],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 41 tests/);
  assert.match(result.stderr, /\bOK\b/);
});

test("new private policy leaves both image-qualified recipes and public engine execute closed", async () => {
  assert.equal(policy.privateAuthorityAdmitted, false);
  assert.equal(policy.workflowActivation, false);
  assert.equal(policy.publicExecuteAdmitted, false);
  assert.equal(policy.environmentContractApproved, false);
  assert.equal(policy.sourceClosureStatus, "planned-files-incomplete");
  assert.equal(policy.sourcePaths.length, 105);
  for (const [image, selected] of Object.entries(policy.images)) {
    const raw = await readFile(base + selected.profile);
    assert.equal(hash(raw), selected.profileSha256);
    const actual = JSON.parse(raw);
    assert.equal(actual.image, image);
    assert.equal(actual.sourceGn.sourceId, selected.sourceId);
    assert.deepEqual(actual.admission, {
      sourceAcquisitionAllowed: true,
      gnAllowed: true,
      engineCompilationAllowed: false,
      sdkAllowed: false,
      restoreAllowed: false,
      publicationAllowed: false,
    });
  }
  assert.equal(
    hash(await readFile(base + "engine-qualification-profile.json")),
    policy.baseCandidatePolicySha256,
  );
  assert.equal(
    hash(await readFile(base + "engine_qualification.py")),
    "f202c17fdd92f52da09708c10a755e8ef693075b88760e91b05c914b7c3203b3",
  );
  for (const name of [base + "producer.py", base + "checkpoint.py"])
    assert(!(await readFile(name, "utf8")).includes("private_qualification"));
});

const rawPolicy = await readFile(base + "private-qualification-profile.json");
const ROOT =
  "D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-arm-full-sdk-01234567-89ab-4cde-8123-456789abcdef";
const scope = () => ({
  mode: "private-compiler-input-qualification",
  ref: "refs/heads/codex/windows-arm-engine-qualification-20261101",
  workflow: ".github/workflows/windows-arm-compiler-input-qualification.yml",
  repository: "supermarsx/sortOfRemoteNG",
  repositoryId: "1010282954",
  visibility: "public",
  event: "workflow_dispatch",
  root: ROOT,
});

const staticLoadingFixture = (image = "20261030.294.1") => {
  const loading = policy.staticLoadingPolicy;
  const selected = policy.images[image];
  const context = {
    ...scope(),
    image,
    host: { platform: "win32", architecture: "x64", runner: policy.runner },
    source: {
      target: policy.target,
      sourceId: selected.sourceId,
      profileSha256: selected.profileSha256,
      chromium: policy.chromium,
      cef: policy.cef,
    },
  };
  const pins = Object.fromEntries(
    Object.entries(policy.tools).map(([role, row]) => [
      role,
      {
        path: row.path ?? ROOT + "/" + row.relativePath,
        bytes: row.bytes,
        sha256: row.sha256,
      },
    ]),
  );
  return {
    context,
    observations: {
      kind: "windows-arm-static-loading-candidate",
      toolPins: pins,
      llvmArchive: structuredClone(loading.llvmArchive),
      llvmTools: Object.fromEntries(
        Object.entries(loading.llvmStaticTools).map(([role, row]) => [
          role,
          { path: pins[role].path, ...structuredClone(row) },
        ]),
      ),
      compilerEnvironment: {
        kind: "closed-fixed-compiler-environment",
        cwd: ROOT + "/private-qualification",
        cwdEntriesBefore: [],
        values: {
          ...loading.commandEnvironment.requiredValues,
          TEMP: ROOT + "/private-qualification-tmp",
          TMP: ROOT + "/private-qualification-tmp",
        },
      },
    },
  };
};

test("named OS-TCB policy and mirrored static projections retain false dynamic evidence for both exact images", () => {
  const code =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_private_qualification as t;import private_qualification as p;rows=[]\nfor image in t.POLICY['images']:\n c,o=t.static_loading_fixture(image);rows.append({'context':c,'observations':o,'result':p.inspect_static_loading(c,t.RAW,o)})\nprint(json.dumps(rows))";
  const observed = spawnSync("python", ["-I", "-B", "-c", code], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 200000,
    windowsHide: true,
  });
  assert.equal(observed.status, 0, observed.stdout + observed.stderr);
  for (const row of JSON.parse(observed.stdout)) {
    const projected = staticLoadingProjection(
      row.context,
      rawPolicy,
      row.observations,
    );
    assert.deepEqual(projected, row.result);
    assert.equal(projected.actualLoaderClosureApproved, false);
    assert.equal(projected.system32ByteSetProven, false);
    assert.equal(projected.environmentAuthorityTransferred, false);
    assert.equal(projected.executionAdmitted, false);
  }
  assert.equal(policy.environmentContractApproved, false);
  assert.equal(policy.privateAuthorityAdmitted, false);
  assert.equal(policy.lldStaticCandidate.actualLoaderClosureApproved, false);
});

test("static policy rejects source, image, tool, archive, import, adjacent DLL, cwd and environment substitutions", () => {
  const cases = [
    ({ context }) => {
      context.image = "20261102.000.1";
    },
    ({ context }) => {
      context.host.architecture = "arm64";
    },
    ({ context }) => {
      context.source.sourceId = "b".repeat(64);
    },
    ({ context }) => {
      context.source.profileSha256 =
        policy.images["20261021.278.1"].profileSha256;
    },
    ({ observations }) => {
      observations.toolPins.gn.sha256 = "b".repeat(64);
    },
    ({ observations }) => {
      observations.toolPins.python.path += "/alias";
    },
    ({ observations }) => {
      observations.llvmArchive.url += "&fallback=1";
    },
    ({ observations }) => {
      observations.llvmTools.clang.machine = 0xaa64;
    },
    ({ observations }) => {
      observations.llvmTools.lld.imports.push("unexpected.dll");
    },
    ({ observations }) => {
      observations.llvmTools.clang.delayImports = [];
    },
    ({ observations }) => {
      observations.llvmTools.lld.adjacentBinDlls = ["version.dll"];
    },
    ({ observations }) => {
      observations.actualLoaderClosureApproved = true;
    },
    ({ observations }) => {
      observations.compilerEnvironment.cwd = ROOT;
    },
    ({ observations }) => {
      observations.compilerEnvironment.cwdEntriesBefore = ["version.dll"];
    },
    ({ observations }) => {
      observations.compilerEnvironment.values.PATH += ";C:/untrusted";
    },
    ({ observations }) => {
      observations.compilerEnvironment.values.TEMP =
        ROOT + "/private-qualification";
    },
  ];
  for (const name of [
    "CL",
    "_CL_",
    "LINK",
    "_LINK_",
    "INCLUDE",
    "LIB",
    "LIBPATH",
    "GITHUB_TOKEN",
    "path",
  ])
    cases.push(({ observations }) => {
      observations.compilerEnvironment.values[name] = "untrusted";
    });
  for (const value of ["", "line\n", "x".repeat(129)])
    cases.push(({ observations }) => {
      observations.compilerEnvironment.values.RUNNER_TRACKING_ID = value;
    });
  for (const mutate of cases) {
    const candidate = staticLoadingFixture();
    mutate(candidate);
    assert.throws(
      () =>
        staticLoadingProjection(
          candidate.context,
          rawPolicy,
          candidate.observations,
        ),
      /PRIVATE_/,
    );
  }
  const candidate = staticLoadingFixture();
  candidate.observations.compilerEnvironment.values.RUNNER_TRACKING_ID =
    "owned-fixture-tracking_1";
  assert.equal(
    staticLoadingProjection(
      candidate.context,
      rawPolicy,
      candidate.observations,
    ).executionAdmitted,
    false,
  );
});

test("dedicated private source Job projection retains no environment or live token authority", () => {
  const plan = sourceJobProjection(scope(), rawPolicy, "a".repeat(64));
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
  assert.equal(plan.role, "private-source-gn");
  assert.deepEqual(plan.argv, [
    policy.driverNode.path,
    "--disable-proto=throw",
    "--no-addons",
    ROOT.split("/.artifacts/")[0] + "/" + policy.handoffContract.sourceWorker,
    "--private-source-gn",
    ROOT,
    "a".repeat(64),
    "--execute",
  ]);
  assert.equal(plan.aggregateWorkMs, 900000);
  assert.equal(plan.cleanupMs, 30000);
  assert.equal(plan.finalReserveMs, 120000);
  assert.equal(plan.environmentAuthorityTransferred, false);
  assert.equal(plan.liveJobCapability, false);
  assert.equal(plan.executionAdmitted, false);
  assert.equal("env" in plan, false);
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.argv));
  assert.deepEqual(plan.qualificationRoles, policy.qualificationRoles);
});

test("old source modes, wrong ref/policy and supplied grants cannot authorize private handoff", () => {
  for (const change of [
    { mode: "source-gn" },
    { mode: "image-qualified-source-gn" },
    { ref: "refs/heads/main" },
    { workflow: ".github/workflows/windows-arm-source-preflight.yml" },
    { repositoryId: "1" },
    { visibility: "private" },
  ])
    assert.throws(
      () =>
        sourceJobProjection(
          { ...scope(), ...change },
          Buffer.from("{}"),
          "a".repeat(64),
        ),
      /PRIVATE_MODE_SCOPE/,
    );
  assert.throws(
    () =>
      sourceJobProjection(
        scope(),
        Buffer.concat([rawPolicy, Buffer.from(" ")]),
        "a".repeat(64),
      ),
    /PRIVATE_POLICY_PIN/,
  );
  for (const change of [{ root: ROOT + "/.." }, { root: "C:/arbitrary" }])
    assert.throws(
      () =>
        sourceJobProjection(
          { ...scope(), ...change },
          rawPolicy,
          "a".repeat(64),
        ),
      /PRIVATE_ROOT/,
    );
  const supplied = sourceJobProjection(
    {
      ...scope(),
      job: { assigned: true },
      allow: true,
      env: { PATH: "C:/hostile" },
    },
    rawPolicy,
    "a".repeat(64),
  );
  assert.equal(supplied.executionAdmitted, false);
  assert.equal(supplied.environmentAuthorityTransferred, false);
});

test("actual private entry fails before input IO or optional source helper import", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--disable-proto=throw",
      "--no-addons",
      base + "private-source-driver.mjs",
      "--private-source-gn",
      ROOT,
      "a".repeat(64),
      "--execute",
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    success: false,
    firstFailure: "PRIVATE_EXECUTION_CLOSED",
    executionAdmitted: false,
  });
});

test("actual private entry never accepts legacy marker or additional command text", () => {
  for (const argv of [
    ["--source-gn", ROOT, "a".repeat(64), "--execute"],
    ["--private-source-gn", ROOT, "a".repeat(64), "--execute", "clang-cl.exe"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [base + "private-source-driver.mjs", ...argv],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 4096,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), {
      success: false,
      firstFailure: "PRIVATE_DRIVER_ARGV",
      executionAdmitted: false,
    });
  }
});

const clockFixture = (remaining = 1600000) => {
  let at = 0;
  return {
    advance: (milliseconds) => {
      at += milliseconds;
    },
    phase: qualificationPhaseClock(
      { remaining: () => remaining - at },
      () => at,
    ),
  };
};

test("one aggregate clock admits six ordered model commands within same 900 seconds", () => {
  const value = clockFixture();
  for (const role of policy.qualificationRoles) {
    value.phase.before(role);
    value.advance(149000);
    value.phase.after(role);
  }
  assert.equal(value.phase.maximumWorkMs, 900000);
  assert.deepEqual(value.phase.finish(), {
    commandsCompleted: 6,
    executionAdmitted: false,
  });
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_ORDER/,
  );
});

test("later command cannot receive a fresh 900 second budget and failure poisons phase", () => {
  const value = clockFixture();
  value.phase.before(policy.qualificationRoles[0]);
  value.advance(899999);
  value.phase.after(policy.qualificationRoles[0]);
  value.advance(2);
  let first;
  try {
    value.phase.before(policy.qualificationRoles[1]);
  } catch (error) {
    first = error;
  }
  assert.match(first.message, /PRIVATE_PHASE_DEADLINE/);
  assert.throws(
    () => value.phase.after(policy.qualificationRoles[1]),
    (error) => error === first,
  );
  assert.throws(
    () => value.phase.finish(),
    (error) => error === first,
  );
});

test("phase reserves original parent cleanup and final metadata time and rejects early finish", () => {
  const value = clockFixture(151000);
  assert.equal(value.phase.maximumWorkMs, 1000);
  value.phase.before(policy.qualificationRoles[0]);
  value.advance(1000);
  assert.throws(
    () => value.phase.after(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_DEADLINE/,
  );
  for (const left of [150000, 7200001, Infinity, NaN])
    assert.throws(
      () => qualificationPhaseClock({ remaining: () => left }, () => 0),
      /PRIVATE_PHASE_BUDGET/,
    );
  assert.throws(() => clockFixture().phase.finish(), /PRIVATE_PHASE_ORDER/);
});

test("reordered commands and source budget failure cannot be retried or reported finished", () => {
  const value = clockFixture();
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[1]),
    /PRIVATE_PHASE_ORDER/,
  );
  assert.throws(
    () => value.phase.before(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_ORDER/,
  );
  let left = 1600000;
  const phase = qualificationPhaseClock({ remaining: () => left }, () => 0);
  phase.before(policy.qualificationRoles[0]);
  left = Infinity;
  assert.throws(
    () => phase.after(policy.qualificationRoles[0]),
    /PRIVATE_PHASE_DEADLINE/,
  );
  left = 1600000;
  assert.throws(() => phase.finish(), /PRIVATE_PHASE_DEADLINE/);
});

test("falsy source-budget exceptions permanently poison the phase and preserve the original value", () => {
  const expectOriginalThrow = (action, original) => {
    let threw = false;
    try {
      action();
    } catch (error) {
      threw = true;
      assert.equal(error, original);
    }
    assert.equal(threw, true);
  };
  for (const original of [0, false, null, undefined, ""]) {
    let throwNow = false;
    const phase = qualificationPhaseClock(
      {
        remaining: () => {
          if (throwNow) throw original;
          return 1600000;
        },
      },
      () => 0,
    );
    throwNow = true;
    expectOriginalThrow(
      () => phase.before(policy.qualificationRoles[0]),
      original,
    );
    throwNow = false;
    for (const retry of [
      () => phase.observe(),
      () => phase.before(policy.qualificationRoles[0]),
      () => phase.after(policy.qualificationRoles[0]),
      () => phase.finish(),
    ])
      expectOriginalThrow(retry, original);
  }
});

const driverText = await readFile(base + "private-source-driver.mjs", "utf8");
const joinedStart = driverText.indexOf(
  "// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES\n",
);
const joinedEndMarker = "// END INACTIVE JOINED OBSERVATION PRIMITIVES";
const joinedEnd =
  driverText.indexOf(joinedEndMarker, joinedStart) + joinedEndMarker.length;
assert(joinedStart > 0 && joinedEnd > joinedStart);
const joinedPrimitiveBlock = driverText.slice(joinedStart, joinedEnd);
const driverAst = parse(driverText, {
  sourceType: "module",
  ecmaVersion: "latest",
});
const functionNode = (ast, name) =>
  ast.body.find((node) => (node.declaration ?? node).id?.name === name);
const functionText = (name) => {
  const node = functionNode(driverAst, name);
  assert(node, name);
  return driverText.slice(node.start, node.end);
};

// This VM holds separate source/session/observation maps. It cannot mint a
// production receipt, invoke a workload tool, or bypass the module's gate.
function primitiveModel(overrides = {}) {
  const heldImport =
    'import { fstatSync as qualificationFdStat } from "node:fs";\n';
  assert.equal(joinedPrimitiveBlock.split(heldImport).length, 2);
  const joinedVmBlock = joinedPrimitiveBlock.replace(heldImport, "");
  const signatureNode = driverAst.body.find(
    (node) =>
      node.type === "VariableDeclaration" &&
      node.declarations.some((item) => item.id.name === "signature"),
  );
  const signatureText = driverText.slice(
    signatureNode.start,
    signatureNode.end,
  );
  return vm.runInNewContext(
    signatureText +
      "\n" +
      functionText("physical") +
      "\n" +
      joinedVmBlock +
      `
      ({ createQualificationSession, issueActualObservation, qualificationHeld,
         qualificationStaticPe, qualificationNoAdjacentDlls, runFixedJoined,
         qualificationSourceRuns, qualificationSessions, qualificationObservations })`,
    {
      fs,
      constants: syncFs.constants,
      path,
      Buffer,
      createHash,
      performance,
      setTimeout,
      clearTimeout,
      REPO: process.cwd(),
      PRIVATE_PROFILE_SHA256: hash(rawPolicy),
      PRIVATE_ROLES: policy.qualificationRoles,
      qualificationPhaseClock,
      privateCommandProjections,
      staticProjectionEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      sha: hash,
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      spawn: () => {
        throw new Error("NO_REAL_PROCESS");
      },
      openSync: syncFs.openSync,
      writeSync: syncFs.writeSync,
      closeSync: syncFs.closeSync,
      qualificationFdStat: syncFs.fstatSync,
      ...overrides,
    },
  );
}

async function primitiveFixture(t, overrides = {}, sourceOverrides = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sorng-private-joined-")),
  );
  const logs = path.join(root, "private-qualification-logs");
  await fs.mkdir(logs);
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  let notifySpawn;
  const spawned = new Promise((resolve) => {
    notifySpawn = resolve;
  });
  const requestedSpawn = overrides.spawn;
  const model = primitiveModel({
    ...overrides,
    ...(requestedSpawn
      ? {
          spawn: (...args) => {
            const child = requestedSpawn(...args);
            notifySpawn(child);
            return child;
          },
        }
      : {}),
  });
  const signal = new AbortController();
  const sourceToken = Object.freeze({ modelOnly: true });
  const stamp = (s) =>
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
  const source = {
    root,
    budget: { remaining: () => 600000 },
    signal: signal.signal,
    context: scope(),
    contextSha: "a".repeat(64),
    privatePolicyRaw: Buffer.from(rawPolicy),
    logsIdentity: stamp(await fs.lstat(logs, { bigint: true })),
    coordinatorVerified: true,
    output: { bytes: 0 },
    environment: { TEST_ONLY: "closed" },
    custom: { sourceGitEnvironment: async (_policy, env) => ({ ...env }) },
    gitPolicy: Object.freeze({ modelOnly: true }),
    validateBefore: async () => {},
    validateAfter: async () => {},
    ...sourceOverrides,
  };
  model.qualificationSourceRuns.set(sourceToken, source);
  const session = model.createQualificationSession(sourceToken);
  const state = model.qualificationSessions.get(session);
  const receipt = Object.freeze({ modelOnly: true });
  model.qualificationObservations.set(receipt, {
    session,
    state,
    role: policy.qualificationRoles[0],
    epoch: state.epoch,
  });
  return { root, model, source, state, session, receipt, signal, spawned };
}

function modelChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kills = [];
  child.unrefs = 0;
  child.kill = (signal) => {
    child.kills.push(signal);
    return true;
  };
  child.unref = () => {
    child.unrefs++;
  };
  child.complete = (code = 0) => {
    child.emit("exit", code, null);
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    setImmediate(() => child.emit("close", code, null));
  };
  return child;
}

test("inactive joined block is private, non-authorizing and restores exact 7ee driver bytes", () => {
  assert.equal(
    hash(joinedPrimitiveBlock),
    "1d7aae9e52636742a0c7af0d722a3c09c8ed61b63629f13e7e2018069ffc5902",
  );
  assert.equal(
    hash(driverText.replace(joinedPrimitiveBlock + "\n\n", "")),
    "e74804c90200aaf58429f629459f63c78d4de4f8bd77a704e8c51eaa2fb772f6",
  );
  assert.equal(
    (driverText.match(/qualificationSourceRuns\.set\(/g) ?? []).length,
    0,
  );
  assert.equal(PRIVATE_DRIVER_ADMITTED, false);
  for (const name of [
    "createQualificationSession",
    "runFixedJoined",
    "issueActualObservation",
  ])
    assert(
      !driverAst.body.some(
        (node) =>
          node.type.startsWith("Export") && node.declaration?.id?.name === name,
      ),
    );
  assert.throws(
    () => primitiveModel().createQualificationSession({}),
    /PRIVATE_SOURCE_RUN/,
  );
});

test("actual held reads stream the complete byte pin, inspect same FD and reject mutation or aliases", async (t) => {
  const f = await primitiveFixture(t);
  const raw = Buffer.alloc(200000, 7),
    file = path.join(f.root, "owned.bin");
  await fs.writeFile(file, raw, { flag: "wx" });
  const pin = { bytes: raw.length, sha256: hash(raw) };
  const observed = await f.model.qualificationHeld(
    file,
    pin,
    f.state,
    async (read) => {
      assert.deepEqual(await read(100, 5), raw.subarray(100, 105));
      return { sameFdRange: true };
    },
  );
  assert.equal(observed.sha256, pin.sha256);
  assert.equal(observed.projection.sameFdRange, true);
  await assert.rejects(
    f.model.qualificationHeld(file, pin, f.state, async () => {
      await fs.writeFile(file, raw); // Same bytes, changed timestamps still deny.
    }),
    /PRIVATE_READ_CHANGED/,
  );
  assert.equal(f.state.failed, true);
  const other = await primitiveFixture(t);
  const alias = path.join(other.root, "alias.bin");
  await fs.link(file, alias);
  await assert.rejects(
    other.model.qualificationHeld(alias, pin, other.state),
    /PRIVATE_READ_FILE/,
  );
});

test("held read closes actual owned FD on short read and preserves falsy close failures", async (t) => {
  let closes = 0;
  const realOpen = fs.open.bind(fs);
  const mockFs = {
    ...fs,
    open: async (...args) => {
      const fd = await realOpen(...args);
      return {
        stat: fd.stat.bind(fd),
        read: async () => ({ bytesRead: 0 }),
        close: async () => {
          closes++;
          await fd.close();
        },
      };
    },
  };
  const f = await primitiveFixture(t, { fs: mockFs });
  const file = path.join(f.root, "short.bin"),
    raw = Buffer.from("private fixture");
  await fs.writeFile(file, raw);
  await assert.rejects(
    f.model.qualificationHeld(
      file,
      { bytes: raw.length, sha256: hash(raw) },
      f.state,
    ),
    /PRIVATE_READ_SHORT/,
  );
  assert.equal(closes, 1);
  for (const reason of [0, false, null, undefined, ""]) {
    const g = await primitiveFixture(t, {
      fs: {
        ...fs,
        open: async (...args) => {
          const fd = await realOpen(...args);
          return {
            stat: fd.stat.bind(fd),
            read: fd.read.bind(fd),
            close: async () => {
              await fd.close();
              throw reason;
            },
          };
        },
      },
    });
    const owned = path.join(g.root, "close.bin");
    await fs.writeFile(owned, raw);
    let rejected = false;
    try {
      await g.model.qualificationHeld(
        owned,
        { bytes: raw.length, sha256: hash(raw) },
        g.state,
      );
    } catch (error) {
      rejected = true;
      assert.equal(error, reason);
    }
    assert(rejected);
    assert.equal(g.state.unconfirmedClose, true);
  }
});

test("held-FD PE range reader matches native Python projection and rejects malformed descriptors", async (t) => {
  const python = spawnSync(
    "python",
    [
      "-I",
      "-B",
      "-c",
      `import sys,json,base64;sys.path.insert(0,${JSON.stringify(path.resolve(base))});import test_private_qualification as t,extract;r=t.static_import_fixture();p=extract.pe_metadata(r);print(json.dumps({'raw':base64.b64encode(r).decode(),'projection':{k:p[k] for k in ('machine','imports','delayImports')}}))`,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(python.status, 0, python.stderr);
  const fixture = JSON.parse(python.stdout),
    raw = Buffer.from(fixture.raw, "base64");
  const f = await primitiveFixture(t),
    file = path.join(f.root, "static.exe");
  await fs.writeFile(file, raw);
  const actual = await f.model.qualificationHeld(
    file,
    { bytes: raw.length, sha256: hash(raw) },
    f.state,
    f.model.qualificationStaticPe,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual.projection)),
    fixture.projection,
  );
  const edits = [
    ["DOS", (r) => r.fill(0, 0, 2)],
    [
      "section overlap",
      (r) => {
        r.writeUInt16LE(2, 134);
        r.copy(r, 432, 392, 432);
      },
    ],
    ["delay format", (r) => r.writeUInt32LE(0, 576)],
    ["import bound", (r) => r.writeUInt32LE(65537, 276)],
    ["name RVA", (r) => r.writeUInt32LE(0xffffffff, 524)],
    ["unterminated name", (r) => r.fill(65, 768, 898)],
    ["descriptor terminator", (r) => r.writeUInt32LE(20, 276)],
  ];
  for (const [name, edit] of edits) {
    const candidate = Buffer.from(raw);
    edit(candidate);
    const read = async (at, size) => {
      assert(at >= 0 && size <= 65536 && at + size <= candidate.length);
      return candidate.subarray(at, at + size);
    };
    await assert.rejects(
      f.model.qualificationStaticPe(read, candidate.length),
      /PRIVATE_PE_/,
      name,
    );
  }
});

test("adjacent DLL observer reads only the exact bounded LLVM directory and rejects private DLLs", async (t) => {
  const f = await primitiveFixture(t),
    bin = path.join(f.root, "llvm/bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(
    path.join(bin, "clang-cl.exe"),
    "synthetic metadata fixture",
  );
  await f.model.qualificationNoAdjacentDlls(f.state);
  await fs.writeFile(path.join(bin, "private.DLL"), "not loaded");
  await assert.rejects(
    f.model.qualificationNoAdjacentDlls(f.state),
    /PRIVATE_ADJACENT_DLL/,
  );
  assert.equal(f.state.failed, true);
});

test("cancel during pending open retires its eventual exact FD and cannot produce an observation", async (t) => {
  let entered,
    release,
    confirmClose,
    closed = 0;
  const eventuallyClosed = new Promise((resolve) => {
    confirmClose = resolve;
  });
  const opening = new Promise((resolve) => {
    entered = resolve;
  });
  const deferred = new Promise((resolve) => {
    release = resolve;
  });
  const f = await primitiveFixture(t, {
    fs: {
      ...fs,
      open: async (...args) => {
        const fd = await fs.open(...args);
        entered();
        await deferred;
        return {
          stat: fd.stat.bind(fd),
          read: fd.read.bind(fd),
          close: async () => {
            closed++;
            await fd.close();
            confirmClose();
          },
        };
      },
    },
  });
  const file = path.join(f.root, "pending.bin"),
    raw = Buffer.from("exact owned open");
  await fs.writeFile(file, raw);
  const action = f.model.qualificationHeld(
    file,
    { bytes: raw.length, sha256: hash(raw) },
    f.state,
  );
  await opening;
  f.signal.abort();
  await assert.rejects(action, /PRIVATE_CANCELLED/);
  assert.equal(f.state.unconfirmedClose, true);
  release();
  // Wait for the exact pending handle close, without any actor-name cleanup.
  await eventuallyClosed;
  assert.equal(closed, 1);
  assert.equal(f.state.failed, true);
  await assert.rejects(
    f.model.issueActualObservation(f.session, policy.qualificationRoles[0]),
    /PRIVATE_CANCELLED/,
  );
});

test("actual observation issuer rejects altered policy and serialized session before reading or minting", async (t) => {
  const f = await primitiveFixture(t);
  await assert.rejects(
    f.model.issueActualObservation({}, policy.qualificationRoles[0]),
    /PRIVATE_SESSION/,
  );
  f.source.privatePolicyRaw = Buffer.from(
    rawPolicy.toString().replace('"schemaVersion": 1', '"schemaVersion": 2'),
  );
  await assert.rejects(
    f.model.issueActualObservation(f.session, policy.qualificationRoles[0]),
    /PRIVATE_POLICY_PIN/,
  );
  assert.equal(f.state.failed, true);
});

test("joined fixed-vector model waits for root and each pipe, shares output ledger and never claims cohort quiet", async (t) => {
  const child = modelChild();
  let vector,
    options,
    done = false;
  const f = await primitiveFixture(t, {
    spawn: (exe, args, opts) => {
      vector = [exe, ...args];
      options = opts;
      return child;
    },
  });
  const action = f.model
    .runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt)
    .then((result) => {
      done = true;
      return result;
    });
  await f.spawned;
  child.stdout.write("actual model stdout");
  child.stderr.write("actual model stderr");
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await new Promise(setImmediate);
  assert.equal(done, false);
  child.stdout.destroy();
  await new Promise(setImmediate);
  assert.equal(done, false);
  child.stderr.destroy();
  const result = await action;
  assert.deepEqual(vector, [
    ...privateCommandProjections(scope(), rawPolicy, "a".repeat(64))[0].argv,
  ]);
  assert.equal(options.shell, false);
  assert.equal(options.detached, false);
  assert.equal(options.windowsHide, true);
  assert.equal(result.rootAndPipesJoined, true);
  assert.equal(result.cohortQuietProven, false);
  assert.equal(result.executionAdmitted, false);
  assert.equal(f.state.next, 1);
  assert.equal(
    f.source.output.bytes,
    Buffer.byteLength("actual model stdoutactual model stderr"),
  );
  assert.equal(child.kills.length, 0);
  assert.equal(
    await fs.readFile(
      path.join(
        f.root,
        "private-qualification-logs/" +
          policy.qualificationRoles[0] +
          ".stdout.log",
      ),
      "utf8",
    ),
    "actual model stdout",
  );
});

test("cancelled joined command waits for actual close, preserves first error and forbids subsequent creation", async (t) => {
  const child = modelChild();
  let spawns = 0;
  const f = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
      return child;
    },
  });
  let settled = false;
  const action = f.model
    .runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt)
    .catch((error) => {
      settled = true;
      throw error;
    });
  await f.spawned;
  f.signal.abort();
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(child.kills[0], "SIGKILL");
  child.complete(-1);
  await assert.rejects(action, /PRIVATE_CANCELLED/);
  assert.equal(f.state.locallyJoined, true);
  await assert.rejects(
    f.model.runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt),
    /PRIVATE_CANCELLED/,
  );
  assert.equal(spawns, 1);
});

test("six sequential fixed roles retain one creation-owned log ledger despite legitimate directory writes", async (t) => {
  const vectors = [],
    children = [];
  const f = await primitiveFixture(
    t,
    {
      spawn: (exe, args) => {
        const child = modelChild();
        children.push(child);
        vectors.push([exe, ...args]);
        setImmediate(() => {
          child.stdout.write("role " + children.length);
          child.complete();
        });
        return child;
      },
    },
    {
      compilerEnvironment: {
        SystemRoot: "C:/Windows",
        WINDIR: "C:/Windows",
        PATH: "C:/Windows/System32",
        TEMP: ROOT + "/private-qualification-tmp",
        TMP: ROOT + "/private-qualification-tmp",
      },
    },
  );
  const phaseEnd = f.state.end;
  for (const [index, role] of policy.qualificationRoles.entries()) {
    const receipt = Object.freeze({ modelOnly: true });
    f.model.qualificationObservations.set(receipt, {
      session: f.session,
      state: f.state,
      role,
      epoch: f.state.epoch,
    });
    const result = await f.model.runFixedJoined(f.session, role, receipt);
    assert.equal(result.rootAndPipesJoined, true);
    assert.equal(result.cohortQuietProven, false);
    assert.equal(f.state.logFiles.size, (index + 1) * 2);
    assert.equal(f.state.end, phaseEnd);
  }
  assert.equal(f.state.phase.finish().commandsCompleted, 6);
  assert.deepEqual(
    vectors,
    privateCommandProjections(scope(), rawPolicy, "a".repeat(64)).map((row) => [
      ...row.argv,
    ]),
  );
  assert(children.every((child) => child.kills.length === 0));
  assert.equal(
    (await fs.readdir(path.join(f.root, "private-qualification-logs"))).length,
    12,
  );
});

test("owned log namespace denies unknown entries, changed files, links and replaced directory before next creation", async (t) => {
  for (const change of ["unknown", "file", "link", "directory"]) {
    let spawns = 0;
    const f = await primitiveFixture(t, {
      spawn: () => {
        spawns++;
        const child = modelChild();
        setImmediate(() => child.complete());
        return child;
      },
    });
    await f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    const directory = path.join(f.root, "private-qualification-logs");
    const first = path.join(
      directory,
      policy.qualificationRoles[0] + ".stdout.log",
    );
    if (change === "unknown")
      await fs.writeFile(path.join(directory, "unowned.log"), "unknown");
    if (change === "file") {
      await fs.unlink(first);
      await fs.writeFile(first, "replacement");
    }
    if (change === "link") {
      // Directory junctions need no symlink privilege on the Windows test host.
      await fs.unlink(first);
      await fs.symlink(f.root, first, "junction");
    }
    if (change === "directory") {
      await fs.rename(directory, path.join(f.root, "retired-owned-logs"));
      await fs.mkdir(directory);
    }
    const role = policy.qualificationRoles[1],
      receipt = Object.freeze({ modelOnly: true });
    f.model.qualificationObservations.set(receipt, {
      session: f.session,
      state: f.state,
      role,
      epoch: f.state.epoch,
    });
    await assert.rejects(
      f.model.runFixedJoined(f.session, role, receipt),
      /PRIVATE_LOG_(?:UNKNOWN|CHANGED|DIRECTORY)/,
      change,
    );
    assert.equal(spawns, 1, change);
    assert.equal(f.state.failed, true);
  }
});

test("pre-abort and forged/serialized receipts launch no process; no coordinator is implicitly authorized", async (t) => {
  let spawns = 0;
  const f = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
      throw Error("unreachable");
    },
  });
  f.signal.abort();
  await assert.rejects(
    f.model.runFixedJoined(f.session, policy.qualificationRoles[0], f.receipt),
    /PRIVATE_CANCELLED/,
  );
  const g = await primitiveFixture(t, {
    spawn: () => {
      spawns++;
    },
  });
  await assert.rejects(
    g.model.runFixedJoined(
      g.session,
      policy.qualificationRoles[0],
      JSON.parse(JSON.stringify(g.receipt)),
    ),
    /PRIVATE_OBSERVATION/,
  );
  const h = await primitiveFixture(
    t,
    {
      spawn: () => {
        spawns++;
      },
    },
    { coordinatorVerified: false },
  );
  await assert.rejects(
    h.model.runFixedJoined(h.session, policy.qualificationRoles[0], h.receipt),
    /PRIVATE_COORDINATOR_CLOSED/,
  );
  assert.equal(spawns, 0);
});

test("pending pre-spawn live-token or input verification is abortable with no process creation", async (t) => {
  for (const gate of ["environment", "inputs"]) {
    let entered,
      spawns = 0;
    const reached = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = () => {
      entered();
      return new Promise(() => {});
    };
    const f = await primitiveFixture(
      t,
      {
        spawn: () => {
          spawns++;
        },
      },
      gate === "environment"
        ? { custom: { sourceGitEnvironment: pending } }
        : { validateBefore: pending },
    );
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await reached;
    f.signal.abort();
    await assert.rejects(action, /PRIVATE_CANCELLED/);
    assert.equal(spawns, 0);
  }
});

test("falsy first failures and partial/failed log writes permanently poison a joined session", async (t) => {
  for (const reason of [0, false, null, undefined, ""]) {
    const child = modelChild();
    const f = await primitiveFixture(t, {
      spawn: () => child,
      writeSync: () => {
        throw reason;
      },
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    child.stdout.write("private fixture");
    child.complete(0);
    let rejected = false;
    try {
      await action;
    } catch (error) {
      rejected = true;
      assert.equal(error, reason);
    }
    assert(rejected);
    assert.equal(f.state.failed, true);
    assert.equal(f.state.next, 0);
  }
  const child = modelChild();
  let writes = 0;
  const f = await primitiveFixture(t, {
    spawn: () => child,
    writeSync: (fd, raw, at, length) => {
      writes++;
      return syncFs.writeSync(fd, raw, at, Math.min(2, length));
    },
  });
  const action = f.model.runFixedJoined(
    f.session,
    policy.qualificationRoles[0],
    f.receipt,
  );
  await f.spawned;
  child.stdout.write("1234567");
  child.complete();
  await action;
  assert.equal(writes, 4);
});

test("output, stream and log-close failures deny even after root exit without late root signals", async (t) => {
  for (const failure of ["output", "pipe", "close"]) {
    const child = modelChild();
    let closes = 0;
    const f = await primitiveFixture(t, {
      spawn: () => child,
      ...(failure === "close"
        ? {
            closeSync: (fd) => {
              syncFs.closeSync(fd);
              if (++closes === 1) throw Error("fixture log close");
            },
          }
        : {}),
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    child.emit("exit", 0, null);
    if (failure === "output") child.stdout.write(Buffer.alloc(1048577));
    if (failure === "pipe") child.stderr.emit("error", Error("fixture pipe"));
    child.complete();
    await assert.rejects(
      action,
      failure === "output"
        ? /PRIVATE_COMMAND_OUTPUT_BOUND/
        : failure === "pipe"
          ? /fixture pipe/
          : /fixture log close/,
    );
    assert.equal(child.kills.length, 0);
    assert.equal(f.state.failed, true);
  }
});

test("deadline or late root close denies and retires only creation-owned streams without claiming joined", async (t) => {
  for (const lateClose of [false, true]) {
    const child = modelChild();
    const f = await primitiveFixture(t, {
      spawn: () => {
        f.state.end = performance.now() + 40;
        return child;
      },
    });
    const action = f.model.runFixedJoined(
      f.session,
      policy.qualificationRoles[0],
      f.receipt,
    );
    await f.spawned;
    if (lateClose) {
      const end = performance.now() + 60;
      while (performance.now() < end) {
        /* Reproduce event-loop-delayed timers. */
      }
      child.complete();
    }
    await assert.rejects(action, /PRIVATE_PHASE_DEADLINE/);
    assert.equal(f.state.locallyJoined, false);
    assert.equal(child.unrefs, 1);
    assert(
      child.stdout.destroyed && child.stderr.destroyed && child.stdin.destroyed,
    );
    assert.equal(f.state.next, 0);
  }
});

test("named static policy delta normalizes exactly to prior driver, policy and pure/probe module bytes", async () => {
  for (const [name, expected] of Object.entries({
    privateQualificationHandoff:
      "aae468a24322ee38d3c5b8242f693ab7bb9a5e4d61682cde48f6dab5bf691126",
    staticProjectionEqual:
      "494cbf0d7405b81d5e185290c4d58272c2a18388a4466bbbb769d92cbb00d049",
    staticLoadingProjection:
      "4ad301c1b5bb1376c0601223ee971ff87ad7b7a848a4b81ad445953419331fb8",
  }))
    assert.equal(hash(functionText(name)), expected, name);
  const handoff = functionNode(driverAst, "privateQualificationHandoff");
  const block = handoff.body.body.find(
    (node) => node.type === "TryStatement",
  ).block;
  const replacement = block.body.find(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.callee?.name === "staticLoadingProjection",
  );
  assert(replacement);
  const oldGate =
    'const loader = p.privatePolicy.lldStaticCandidate;\n    need(\n      loader.staticProjectionReviewed === true &&\n        loader.actualLoaderClosureApproved === true &&\n        loader.system32ByteSetProven === true,\n      "PRIVATE_LOADER_UNAVAILABLE",\n    );';
  let oldHandoff = driverText.slice(handoff.start, handoff.end);
  oldHandoff =
    oldHandoff.slice(0, replacement.start - handoff.start) +
    oldGate +
    oldHandoff.slice(replacement.end - handoff.start);
  assert.equal(oldHandoff.split("  staticToolObservations,\n").length, 2);
  oldHandoff = oldHandoff.replace("  staticToolObservations,\n", "");
  const edits = [
    { start: handoff.start, end: handoff.end, value: oldHandoff },
    ...["staticProjectionEqual", "staticLoadingProjection"].map((name) => {
      const node = functionNode(driverAst, name);
      assert(node);
      assert.equal(driverText.slice(node.end, node.end + 2), "\n\n");
      return { start: node.start, end: node.end + 2, value: "" };
    }),
  ];
  // First remove only the newly appended, independently tested inactive block.
  // All historical source/function/policy checks below remain unchanged.
  let priorDriver = driverText.replace(joinedPrimitiveBlock + "\n\n", "");
  for (const edit of edits.sort((a, b) => b.start - a.start))
    priorDriver =
      priorDriver.slice(0, edit.start) +
      edit.value +
      priorDriver.slice(edit.end);
  const nextPin = hash(rawPolicy);
  assert.equal(priorDriver.split(nextPin).length, 2);
  priorDriver = priorDriver.replace(
    nextPin,
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  assert.equal(
    hash(priorDriver),
    "c626ba27e80b4777eb559b61fa0812bff655df1f5f5e641ce41be8e984facd7b",
  );
  const profile = rawPolicy.toString("utf8");
  const start = profile.indexOf('  "staticLoadingPolicy": {');
  const end = profile.indexOf('  "missingBeforePrivateActivation": [', start);
  assert(start > 0 && end > start);
  const oldPolicy = (profile.slice(0, start) + profile.slice(end)).replace(
    "matching-reviewed-system-image-and-static-tool-projections",
    "actual-loader-resolution-and-system32-byte-contract",
  );
  assert.equal(
    hash(oldPolicy),
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  const python = await readFile(base + "private_qualification.py", "utf8");
  assert.equal(python.split("def static_projection_equal").length, 2);
  const oldPython = (
    python.split("def static_projection_equal")[0].trimEnd() + "\n"
  ).replace(
    nextPin,
    "f1f9614d617851761d577f11cafebe1e1aba3e57438801c17f84805ed34d759b",
  );
  assert.equal(
    hash(oldPython),
    "8142966125763a5e04e684188481c78f3481d608a5d0b8b94e0ab147e222d2bc",
  );
});

test("private derivative restores exact historical source body after five explicit reviewed function replacements", async () => {
  const original = await readFile(
    base + "image-qualified-current-driver.mjs",
    "utf8",
  );
  assert.equal(
    hash(Buffer.from(original)),
    "7c02861f5a153e7945556dbdb99267ab8386cd98682ba7ef932aa40c7c096833",
  );
  assert.equal(
    hash(await readFile(base + "image-qualified-20261021-driver.mjs")),
    "e98e2a38f282090fcde7fe900751d22b977d3e9d3fa1ce662b9527711bf0e06d",
  );
  const begin = "// BEGIN REVIEWED SOURCE DERIVATIVE\n";
  const end = "// END REVIEWED SOURCE DERIVATIVE";
  assert.equal(driverText.split(begin).length, 2);
  assert.equal(driverText.split(end).length, 2);
  let body = driverText.split(begin)[1].split(end)[0];
  const originalAst = parse(original, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  const bodyAst = parse(body, { sourceType: "module", ecmaVersion: "latest" });
  const reviewed = {
    reviewedHostClosure:
      "4338a2da8c01a67bb3b95498250e1191f17fb959a556befb0ff030dad62400fc",
    sourcePaths:
      "02a11455e36ddf932a285f2e05b94485c087ca7d04239e987afea71f13b12373",
    bootstrapProgram:
      "6dadfc55c531ffc53d2831053c5a45b92617e9610c6d3819dce48b3bf4753410",
    loadSealedProfile:
      "85d232cccbb9c93de2aa8cf964bea4b7376e2047dd690e28bf77628a75214c8f",
    privateSourceBody:
      "a6578d57a617cebb8c1544f1fda5e34c58cffa91a59455df012d9402741e817c",
  };
  const edits = Object.entries(reviewed).map(([name, expected]) => {
    const next = functionNode(bodyAst, name);
    const previous = functionNode(
      originalAst,
      name === "privateSourceBody" ? "main" : name,
    );
    assert(next && previous, name);
    assert.equal(
      hash(Buffer.from(body.slice(next.start, next.end))),
      expected,
      name,
    );
    return {
      start: next.start,
      end: next.end,
      raw: original.slice(previous.start, previous.end),
    };
  });
  for (const edit of edits.sort((a, b) => b.start - a.start))
    body = body.slice(0, edit.start) + edit.raw + body.slice(edit.end);
  const trailer = original.slice(
    original.lastIndexOf("\nif (\n  process.argv[1]"),
  );
  const normalized = body.trimEnd() + "\n" + trailer;
  assert.equal(normalized, original);
});

test("both private source projections retain complete corresponding old images and compiler-false source policies", async () => {
  const basePolicy = JSON.parse(await readFile(base + "profile.json", "utf8"));
  for (const [image, selected] of Object.entries(policy.images)) {
    const original = JSON.parse(
      await readFile(base + selected.profile, "utf8"),
    );
    const p = {
      ...basePolicy,
      image,
      sourceGn: original.sourceGn,
      privatePolicy: policy,
      privateSelectedSha256: selected.profileSha256,
      phaseAdmission: {
        ...basePolicy.phaseAdmission,
        "image-qualified-source-gn": true,
      },
    };
    const projectionRoot =
      process.platform === "win32"
        ? ROOT
        : "/tmp/sorng-private-source-projection";
    const files = privateSourcePaths(projectionRoot, p);
    assert.equal(
      files.inputs
        .replaceAll("\\", "/")
        .replace(/\/$/, "")
        .endsWith(selected.namespace.replace(/\/$/, "")),
      true,
    );
    assert.equal(privateHostClosure(p, image).rows.length, 18);
    assert.equal(p.sourceGn.compilerAllowed, false);
    assert.equal(p.sourceGn.sdkAllowed, false);
    const text = privateBootstrapProgram(
      projectionRoot,
      p,
      "a".repeat(64),
    ).toString("utf8");
    const encoded = text
      .split("\n")
      .find((line) => line.startsWith("P=json.loads("));
    assert(encoded);
    const serialized = JSON.parse(
      JSON.parse(encoded.slice("P=json.loads(".length, -1)),
    );
    assert.equal(serialized.enabled, false);
    assert.equal(serialized.image, image);
    assert(
      text.includes("value['mode']=='private-compiler-input-qualification'"),
    );
    assert(
      text.includes("value['image'] in ('20261030.294.1','20261021.278.1')"),
    );
    assert(
      text.includes(
        "value['ref']=='refs/heads/codex/windows-arm-engine-qualification-20261101'",
      ),
    );
  }
});

test("actual private loader and public entry deny before input getters, FS and optional imports", async () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("input getter touched");
      },
    },
  );
  await assert.rejects(
    privateLoadSealedProfile(hostile, hostile, hostile),
    /PRIVATE_EXECUTION_CLOSED/,
  );
  const source = functionText("privateSourceBody");
  assert.match(
    source,
    /^async function privateSourceBody\(argv\) \{\s*need\(PRIVATE_DRIVER_ADMITTED, "PRIVATE_EXECUTION_CLOSED"\);/,
  );
  assert(
    source.indexOf("requirePrivateScope(c)") < source.indexOf("await import("),
  );
  assert(
    source.indexOf("await loadSealedProfile(") <
      source.indexOf("await import("),
  );
});

test("private fixed six vectors match the actual independent Python projection without executing any tool", () => {
  const code =
    "import sys,json;from pathlib import Path;sys.path.insert(0,str(Path('native/windows-arm-full-sdk').resolve()));import test_private_qualification as t;import private_qualification as p;print(json.dumps([{'role':r,**{k:p.command_projection(r,t.context(),t.RAW,wall_now=200,monotonic_now=200)[k] for k in ('argv','cwd')}} for r in p.ROLES]))";
  const result = spawnSync("python", ["-I", "-B", "-c", code], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 32768,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const projected = privateCommandProjections(
    scope(),
    rawPolicy,
    "a".repeat(64),
  );
  assert.deepEqual(
    projected.map(({ role, argv, cwd }) => ({ role, argv, cwd })),
    JSON.parse(result.stdout),
  );
  assert(projected.every((command) => command.executionAdmitted === false));
});

test("live-token handoff rejects forged policy token, unknown environment and missing static observations without dynamic-loader claims", async (t) => {
  // Trusted unit seam only: no real Job receipt, process permission or mutable
  // source authority is minted. Actual module gate remains false throughout.
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sorng-private-handoff-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory);
    await fs.rm(directory, { recursive: true });
  });
  const token = await prepareSourceGitIsolation(
    path.join(directory, "cef-source-git-policy"),
  );
  let records = [],
    cleared = 0,
    metadataAt = 0;
  const runner = vm.runInNewContext(
    "(" + functionText("privateQualificationHandoff") + ")",
    {
      PRIVATE_DRIVER_ADMITTED: true,
      TARGET: "aarch64-pc-windows-msvc",
      PRIVATE_ROLES: policy.qualificationRoles,
      need: (condition, code) => {
        if (!condition) throw new Error(code);
      },
      qualificationPhaseClock: (budget) =>
        qualificationPhaseClock(budget, () => metadataAt),
      privateCommandProjections,
      // The VM creates foreign-realm object literals. Materialize only that
      // pure JSON projection in this realm; production stays plain-object-only.
      staticLoadingProjection: (context, ...args) =>
        staticLoadingProjection(JSON.parse(JSON.stringify(context)), ...args),
      path,
      Buffer,
      sha: (raw) => hash(raw),
      setTimeout: () => 1,
      clearTimeout: () => {
        cleared++;
      },
      fs: {
        writeFile: async (file, data, options) => {
          assert.equal(
            file,
            path.join(ROOT, "private-qualification-result.json"),
          );
          assert.equal(options.flag, "wx");
          records.push(JSON.parse(data));
        },
      },
      writeFileSync: () => {
        throw new Error("deadline callback not expected");
      },
      process: {
        platform: "win32",
        arch: "x64",
        exit: () => {
          throw new Error("no owned process exists in unit seam");
        },
      },
      sourceReportingFailure: false,
    },
    { timeout: 1000 },
  );
  const invoke = (
    gitPolicy,
    candidate,
    liveEnvironment = sourceGitEnvironment,
    staticToolObservations,
  ) =>
    runner({
      root: ROOT,
      c: scope(),
      p: {
        image: "20261030.294.1",
        privateSelectedSha256: policy.images["20261030.294.1"].profileSha256,
        sourceGn: { sourceId: policy.images["20261030.294.1"].sourceId },
        privatePolicy: candidate,
      },
      budget: { remaining: () => 1600000 },
      graph: {},
      generatedArguments: {},
      custom: { sourceGitEnvironment: liveEnvironment },
      gitPolicy,
      env: { PATH: "C:/Windows/System32" },
      privatePolicyRaw: rawPolicy,
      staticToolObservations,
    });
  await assert.rejects(invoke({}, policy), /SOURCE_GIT_POLICY_CAPABILITY/);
  await assert.rejects(
    invoke(token, policy),
    /PRIVATE_ENVIRONMENT_UNAVAILABLE/,
  );
  const knownEnvironment = { ...policy, environmentContractApproved: true };
  await assert.rejects(
    invoke(token, knownEnvironment),
    /PRIVATE_STATIC_LOADING_FIELDS/,
  );
  await assert.rejects(
    invoke(
      token,
      knownEnvironment,
      sourceGitEnvironment,
      staticLoadingFixture().observations,
    ),
    /PRIVATE_QUALIFICATION_EXECUTOR_CLOSED/,
  );
  await assert.rejects(
    invoke(token, policy, async (...args) => {
      const value = await sourceGitEnvironment(...args);
      metadataAt = 900001;
      return value;
    }),
    /PRIVATE_PHASE_DEADLINE/,
  );
  assert.equal(cleared, 5);
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.map((record) => record.firstFailure),
    [
      "SOURCE_GIT_POLICY_CAPABILITY",
      "PRIVATE_ENVIRONMENT_UNAVAILABLE",
      "PRIVATE_STATIC_LOADING_FIELDS",
      "PRIVATE_QUALIFICATION_EXECUTOR_CLOSED",
    ],
  );
  assert(
    records.every(
      (record) =>
        record.sourceGnCompleted &&
        !record.compilerExecuted &&
        !record.success &&
        record.outerJobCleanupNotInferred,
    ),
  );
});

test("post-GN failure keeps original source result truthful and qualification separate", () => {
  const body =
    functionNode(driverAst, "privateSourceBody").declaration ??
    functionNode(driverAst, "privateSourceBody");
  const source = functionText("privateSourceBody");
  assert(
    source.indexOf("success = true;") <
      source.indexOf("await privateQualificationHandoff("),
  );
  assert.match(source, /stage: success \? "complete" : stage/);
  assert.match(source, /firstFailure: success \? null : code/);
  const sourceRecord = body.body.body
    .find((node) => node.type === "TryStatement")
    .finalizer.body.find(
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.some(
          (declaration) => declaration.id.name === "report",
        ),
    );
  assert(sourceRecord);
  const properties = sourceRecord.declarations[0].init.properties.filter(
    (property) =>
      ["success", "stage", "firstFailure"].includes(property.key.name),
  );
  const projection =
    "({" +
    properties
      .map((property) => driverText.slice(property.start, property.end))
      .join(",") +
    "})";
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(projection, {
          success: true,
          stage: "private-qualification",
          code: "PRIVATE_LOADER_UNAVAILABLE",
        }),
      ),
    ),
    { success: true, stage: "complete", firstFailure: null },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(projection, {
          success: false,
          stage: "cef-gn",
          code: "FULL_SOURCE_CHILD_FAILED",
        }),
      ),
    ),
    {
      success: false,
      stage: "cef-gn",
      firstFailure: "FULL_SOURCE_CHILD_FAILED",
    },
  );
});
