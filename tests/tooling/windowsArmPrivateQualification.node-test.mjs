import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import vm from "node:vm";
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
  assert.match(result.stderr, /Ran 39 tests/);
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
  let priorDriver = driverText;
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
