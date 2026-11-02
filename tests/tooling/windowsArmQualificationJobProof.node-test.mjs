import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import YAML from "yaml";
import os from "node:os";
import * as syncFs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { types as diagnosticTypes } from "node:util";
import ts from "typescript";
import {
  CASES,
  inspectAuthority,
  extractSubject,
  caseFileScope,
  validateControllerResult,
  validateControllerFailure,
  main,
} from "../fixtures/cef/windows_arm_qualification_job_proof.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = path.join(ROOT, "native/windows-arm-full-sdk");
const rawPolicy = await fs.readFile(
  path.join(DIR, "qualification-job-proof-profile.json"),
);
const policy = JSON.parse(rawPolicy);
const fixture = await fs.readFile(
  path.join(ROOT, "tests/fixtures/cef/windows_arm_qualification_job_proof.mjs"),
  "utf8",
);
const adapter = await fs.readFile(
  path.join(DIR, "qualification-job-proof.py"),
  "utf8",
);
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const nonce = "12345678-1234-4123-8123-123456789abc",
  head = "a".repeat(40);
const host = { platform: "win32", arch: "x64" };
const admitted = {
  ...policy,
  workflowActivation: true,
  proofExecutionAdmitted: true,
};
function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: policy.repository,
    GITHUB_REPOSITORY_ID: policy.repositoryId,
    GITHUB_REF: policy.ref,
    ImageVersion: policy.image,
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_WORKFLOW_REF: `${policy.repository}/${policy.workflow}@${policy.ref}`,
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "1",
  };
}
function synthetic() {
  const result = {
    schemaVersion: 1,
    kind: "windows-benign-job-controller-result",
    complete: true,
    nonce,
    head,
    cases: [],
    rawReceipts: [],
    scratchRemoved: true,
    productionAdmission: false,
    sourceGnQualified: false,
    compilerAdmission: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  for (const name of CASES) {
    const created = name !== "preaborted",
      resumed =
        created && name !== "outer-cancel-after-assignment-before-resume";
    const outcome = [
      "preaborted",
      "outer-cancel-after-assignment-before-resume",
    ].includes(name)
      ? "cancelled"
      : name === "deadline-with-pipe-descendant"
        ? "deadline"
        : ["closed-pipe-orphan", "reparented-descendant"].includes(name)
          ? "descendants-left"
          : "success";
    const kernel = {
      kind: "owned-job-proof",
      outcome,
      started: created,
      assignedBeforeResume: created,
      resumed,
      jobCreated: created,
      cleanupVerified: true,
      activeAtEnd: 0,
      logReadersStopped: true,
      success: outcome === "success",
      rootExit:
        outcome === "success" || outcome === "descendants-left" ? 0 : null,
      observedChildrenReaped: outcome === "descendants-left" ? 1 : 0,
      ...(created
        ? {
            assignedAtCreationVerified: true,
            observerStopped: true,
            handleListOnly: true,
            assignmentMode: "creation-attribute",
            rootReaped: true,
            policyReadback: {
              flags: 8712,
              activeProcessLimit: 64,
              jobMemoryBytes: "8589934592",
              cpuFlags: 5,
              cpuRate: 2500,
              inheritedHandles: 3,
              affinityChanged: false,
            },
            jobHandleInheritable: false,
            jobHandleInStdioAllowlist: false,
          }
        : {}),
    };
    const raw = Buffer.from(JSON.stringify(kernel) + "\n");
    const failure =
      {
        "second-role-nonzero": "PRIVATE_COMMAND_EXIT",
        "session-cancel-after-owned-output": "PRIVATE_CANCELLED",
        "bounded-output-failure": "PRIVATE_COMMAND_OUTPUT_BOUND",
      }[name] ?? null;
    const node = [
      "preaborted",
      "outer-cancel-after-assignment-before-resume",
      "deadline-with-pipe-descendant",
    ].includes(name)
      ? null
      : {
          schemaVersion: 1,
          kind: "windows-benign-node-provisional",
          case: name,
          complete: failure === null,
          failure,
          rolesStarted:
            name === "six-role-normal"
              ? 6
              : name === "second-role-nonzero"
                ? 2
                : 1,
          rolesJoined: name === "six-role-normal" ? 6 : failure ? 0 : 1,
          logFiles: name === "six-role-normal" ? 12 : 2,
          unconfirmedClose: false,
          fileChecks: name === "six-role-normal",
          closedEntryDenied: true,
          rootAndPipesJoined: true,
          cohortQuietProven: false,
          productionAdmission: false,
        };
    result.cases.push({
      case: name,
      expectedOutcome: outcome,
      kernelOutcome: outcome,
      workerStarted: created,
      assignedBeforeResume: created,
      resumed,
      activeAtEnd: 0,
      rootReaped: created ? true : null,
      readersJoined: true,
      closeCalls: created ? 4 : 2,
      checkedCloseCallsSucceeded: true,
      foreignControllerPreserved: true,
      assignmentObserverVerified: created,
      reparentedDescendantVerified: name === "reparented-descendant",
      node,
      kernelReceiptPin: { bytes: raw.length, sha256: hash(raw) },
    });
    result.rawReceipts.push(raw.toString("base64"));
  }
  return result;
}
function python(code) {
  return execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-c",
      code,
      path.join(DIR, "qualification-job-proof.py"),
      path.join(DIR, "job.py"),
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20000 },
  );
}

test("controller failure observation projects only fixed Python phase code and numeric native fields without getters", () => {
  const output = JSON.parse(
    python(String.raw`
import ast,json,sys
from pathlib import Path
namespace={'__name__':'review_only','__file__':sys.argv[1]}
exec(compile(Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),namespace)
namespace['_observe_controller']('case-parent',namespace['CASES'][0],0)
error=OSError(5,'PRIVATE_PATH_COMMAND_TOKEN')
error.stage='proof-controller-handle'
native=namespace['controller_failure'](error)
assert native['nativeStage']=='proof-controller-handle' and native['nativeErrno']==5
assert native['code']=='NATIVE_OS_ERROR' and native['phase']=='case-parent'
assert native['case']=='six-role-normal' and native['completedCases']==0
class Hostile(ValueError):
 def __getattribute__(self,name):raise AssertionError('getter must not run')
 def __str__(self):raise AssertionError('str must not run')
 @property
 def __dict__(self):raise AssertionError('dict getter must not run')
value=namespace['controller_failure'](Hostile('PRIVATE_PATH_COMMAND_TOKEN'))
assert value['code']=='UNKNOWN' and value['nativeStage'] is None and value['nativeErrno'] is None
assert namespace['controller_failure'](ValueError('PROOF_CONTEXT'))['code']=='PROOF_CONTEXT'
assert namespace['controller_failure'](ValueError('PROOF_NOT_REVIEWED_PRIVATE'))['code']=='UNKNOWN'
assert namespace['controller_failure'](ValueError('PRIVATE_PATH_COMMAND_TOKEN'*10000))['code']=='UNKNOWN'
error.stage='PRIVATE_PATH_COMMAND_TOKEN';error.errno=True
value=namespace['controller_failure'](error)
assert value['nativeStage'] is None and value['nativeErrno'] is None
for value in (None,False,0,'PRIVATE_PATH_COMMAND_TOKEN'):
 assert namespace['controller_failure'](value)['code']=='UNKNOWN'
native_labels=set()
for filename in (sys.argv[1],sys.argv[2]):
 for node in ast.walk(ast.parse(Path(filename).read_bytes())):
  if isinstance(node,ast.Call) and len(node.args)>1 and isinstance(node.args[1],ast.Constant) and isinstance(node.args[1].value,str):
   if isinstance(node.func,ast.Attribute) and node.func.attr=='checked' or isinstance(node.func,ast.Name) and node.func.id=='checked':native_labels.add(node.args[1].value)
assert native_labels <= namespace['_CONTROLLER_STAGES']
print(json.dumps({'native':native,'codes':sorted(namespace['_CONTROLLER_CODES']),'phases':sorted(namespace['_CONTROLLER_PHASES']),'stages':sorted(namespace['_CONTROLLER_STAGES'])}))
`),
  );
  assert(!JSON.stringify(output).includes("PRIVATE_PATH_COMMAND_TOKEN"));
  assert.equal(
    validateControllerFailure(Buffer.from(JSON.stringify(output.native))).code,
    "NATIVE_OS_ERROR",
  );
  const block = fixture.slice(
    fixture.indexOf("// BEGIN bounded controller failure validation"),
    fixture.indexOf("// END bounded controller failure validation"),
  );
  const enums = vm.runInNewContext(
    block.replace(
      "export function validateControllerFailure",
      "function validateControllerFailure",
    ) +
      ";({phases:[...CONTROLLER_FAILURE_PHASES],codes:[...CONTROLLER_FAILURE_CODES],stages:[...CONTROLLER_FAILURE_STAGES]});",
    { Buffer, CASES, exact: () => {} },
  );
  assert.deepEqual([...enums.phases].sort(), output.phases);
  assert.deepEqual([...enums.stages].sort(), output.stages);
  for (const code of output.codes) assert(enums.codes.includes(code));
});

function controllerFailureFixture() {
  return {
    schemaVersion: 1,
    kind: "windows-benign-job-controller-failure",
    complete: false,
    failure: "PROOF_DENIED",
    phase: "case-parent",
    case: CASES[0],
    completedCases: 0,
    code: "NATIVE_OS_ERROR",
    nativeStage: "proof-controller-handle",
    nativeErrno: 5,
    productionAdmission: false,
    runtimeReady: false,
  };
}

test("controller failure observation strict Node selector rejects raw output private additions invalid fields and success claims", () => {
  const raw = Buffer.from(JSON.stringify(controllerFailureFixture()));
  assert.equal(validateControllerFailure(raw).nativeErrno, 5);
  for (const [key, value] of [
    ["phase", "PRIVATE_SECRET"],
    ["case", "PRIVATE_SECRET"],
    ["completedCases", -1],
    ["completedCases", 10],
    ["completedCases", true],
    ["code", "PROOF_NOT_REVIEWED_PRIVATE"],
    ["nativeStage", "PRIVATE_SECRET"],
    ["nativeErrno", -1],
    ["nativeErrno", true],
    ["nativeErrno", 4294967296],
    ["runtimeReady", true],
    ["productionAdmission", true],
    ["complete", true],
  ])
    assert.equal(
      validateControllerFailure(
        Buffer.from(
          JSON.stringify({ ...controllerFailureFixture(), [key]: value }),
        ),
      ),
      null,
    );
  assert.equal(
    validateControllerFailure(
      Buffer.from(
        JSON.stringify({
          ...controllerFailureFixture(),
          private: "PRIVATE_SECRET",
        }),
      ),
    ),
    null,
  );
  assert.equal(
    validateControllerFailure(Buffer.from("PRIVATE_SECRET\n" + raw)),
    null,
  );
  assert.equal(validateControllerFailure(Buffer.alloc(2049)), null);
  assert.equal(validateControllerFailure("PRIVATE_SECRET"), null);
  assert.equal(
    validateControllerFailure(
      Buffer.from('{"complete":false,"failure":"PROOF_DENIED"}'),
    ),
    null,
  );
});

test("controller failure observation logs only validated closed data after actual child close and keeps original failure", async () => {
  const from = fixture.indexOf("async function runController("),
    until = fixture.indexOf("export function validateControllerResult(");
  const body = fixture.slice(from, until);
  for (const mode of ["known", "private", "logger-fault", "first-falsy"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false,
      kills = 0;
    const logged = [];
    child.kill = () => {
      kills++;
      return true;
    };
    child.unref = () => {};
    const run = vm.runInNewContext(body + ";runController", {
      path,
      Buffer,
      performance,
      setTimeout,
      clearTimeout,
      ROOT,
      validateControllerFailure,
      checkEnd: (end) => {
        if (performance.now() >= end) throw new Error("PROOF_DEADLINE");
      },
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      console: {
        error(raw) {
          assert(closed);
          if (mode === "logger-fault") throw "PRIVATE_LOGGER";
          logged.push(raw);
        },
      },
      spawn: () => {
        queueMicrotask(async () => {
          child.stdout.write(
            mode === "private"
              ? "PRIVATE_STDOUT"
              : JSON.stringify(controllerFailureFixture()),
          );
          child.stderr.write("PRIVATE_STDERR");
          if (mode === "first-falsy") child.stdout.emit("error", false);
          child.emit("exit", 1, null);
          await Promise.resolve();
          assert.equal(logged.length, 0, "root exit alone is not child close");
          closed = true;
          child.emit("close", 1, null);
        });
        return child;
      },
    });
    let rejected = false;
    try {
      await run(
        policy,
        "owned-model-only",
        "a".repeat(64),
        performance.now() + 1000,
        environment(),
      );
    } catch (error) {
      rejected = true;
      if (mode === "first-falsy") assert.equal(error, false);
      else assert.equal(error.message, "PROOF_CONTROLLER_EXIT");
    }
    assert(rejected);
    assert.equal(kills, mode === "first-falsy" ? 1 : 0);
    assert.equal(logged.length, mode === "known" ? 1 : 0);
    assert(!logged.join().includes("PRIVATE"));
    if (logged.length)
      assert.equal(
        JSON.parse(logged[0]).nativeStage,
        "proof-controller-handle",
      );
  }
});

test("controller failure observation inverse restores complete e46 Python and Node with kernel profile subject unchanged", async () => {
  for (const [body, pythonBody, bytes, digest] of [
    [
      adapter,
      true,
      32305,
      "c0d5b2db0392f00a7314557b44719635303ab411e8d80e30af80f9b48be21bd1",
    ],
    [
      fixture,
      false,
      38078,
      "cca6f37e2452c16902b57492d6c0e4d007fb557fe8687a9945d27ae29b968ead",
    ],
  ]) {
    const original = previousControllerFailureObservation(body, pythonBody);
    assert.equal(Buffer.byteLength(original), bytes);
    assert.equal(hash(original), digest);
  }
  assert.equal(
    hash(restorePriorControllerFlavor(rawPolicy.toString())),
    "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c",
  );
  assert.equal(
    hash(await fs.readFile(path.join(DIR, "job.py"))),
    policy.kernel.sha256,
  );
  assert.equal(
    hash(await fs.readFile(path.join(ROOT, policy.subject.path))),
    policy.subject.sha256,
  );
});

test("only the benign proof profile is active across exactly seven paths, without production activation", async () => {
  assert.equal(policy.workflowActivation, true);
  assert.equal(policy.proofExecutionAdmitted, true);
  for (const key of [
    "sourceMigrationAdmitted",
    "compilerAdmission",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(policy[key], false);
  assert.deepEqual(policy.cases, CASES);
  assert.equal(CASES.length, 9);
  assert.equal(policy.suiteSeconds, 300);
  assert.equal(policy.finalReserveSeconds, 150);
  assert.equal(policy.kernelCleanupSeconds, 30);
  assert.equal(policy.image, "20261030.294.1");
  assert.equal(
    policy.kernel.sha256,
    "70f10cc78c6b75519d3b33cb02788b49f058bdfdf0780b27aeb7becde0b5e716",
  );
  assert.equal(
    policy.subject.sha256,
    "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",
  );
  assert.equal(
    hash(rawPolicy),
    /const PROFILE_SHA\s*=\s*"([a-f0-9]{64})"/.exec(fixture)[1],
  );
  assert.equal(
    hash(rawPolicy),
    /PROFILE_SHA = "([a-f0-9]{64})"/.exec(adapter)[1],
  );
  assert((await fs.stat(path.join(ROOT, policy.workflow))).isFile());
});

function restoreCurrentImageSelection(text) {
  text = restorePriorControllerFlavor(text);
  for (const [selected, previous] of [
    [
      "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102",
      "refs/heads/codex/windows-arm-benign-job-proof-20261102",
    ],
    ["20261021.278.1", "20261030.294.1"],
  ]) {
    assert.equal(text.split(selected).length, 2);
    text = text.replace(selected, previous);
  }
  return text;
}
function restorePriorControllerFlavor(text) {
  const nextRef =
    "refs/heads/codex/windows-arm-benign-current-controller-20261102";
  const previousRef =
    "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102";
  const nextPin =
    "51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e";
  const previousPin =
    "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c";
  if (text.includes(nextRef)) {
    assert.equal(text.split(nextRef).length, 2);
    assert.equal(text.split("20261030.294.1").length, 2);
    text = text
      .replace(nextRef, previousRef)
      .replace("20261030.294.1", "20261021.278.1");
  } else if (text.includes(nextPin)) {
    assert.equal(text.split(nextPin).length, 2);
    text = text.replace(nextPin, previousPin);
  }
  return text;
}
function previousControllerFailureObservation(text, pythonBody = false) {
  text = restorePriorControllerFlavor(text);
  if (pythonBody) {
    const block =
      /\n# BEGIN bounded controller failure observation\n[\s\S]*?# END bounded controller failure observation\n\n\n/;
    assert.equal([...text.matchAll(new RegExp(block.source, "g"))].length, 1);
    text = text.replace(block, "");
    const caught =
      "    except BaseException as error:  # controller-observation\n";
    assert.equal(text.split(caught).length, 2);
    text = text.replace(caught, "    except BaseException:\n");
    const printed =
      '        print(json.dumps(controller_failure(error), separators=(",", ":")), flush=True)  # controller-observation\n';
    assert.equal(text.split(printed).length, 2);
    text = text.replace(
      printed,
      '        print(\'{"complete":false,"failure":"PROOF_DENIED"}\', flush=True)\n',
    );
    return text.replace(
      /^ *_observe_controller\([^\n]*# controller-observation\n/gm,
      "",
    );
  }
  for (const pattern of [
    /\/\/ BEGIN bounded controller failure validation\n[\s\S]*?\/\/ END bounded controller failure validation\n{1,3}/,
    /^    \/\/ BEGIN bounded controller failure logging\n[\s\S]*?^    \/\/ END bounded controller failure logging\n/m,
  ]) {
    assert.equal(
      [...text.matchAll(new RegExp(pattern.source, pattern.flags + "g"))]
        .length,
      1,
    );
    text = text.replace(pattern, "");
  }
  return text;
}

test("the two proof flags and two exact pin literals invert through the entire current-image baseline to reviewed inactive bytes", () => {
  const old =
      "f923354c8141f946a464d7ff1dbb68dc9cc917fc693ee75c4d8041e1ee7eee49",
    current = hash(restorePriorControllerFlavor(rawPolicy.toString())),
    reviewedCurrent =
      "0e5bf412b6575a4e1f576d257bc4e047f02082d75566dee982f6cf68fcbfc24b";
  let inverse = restoreCurrentImageSelection(rawPolicy.toString());
  assert.equal(hash(inverse), reviewedCurrent);
  assert.equal(Buffer.byteLength(inverse), 2897);
  for (const key of ["workflowActivation", "proofExecutionAdmitted"]) {
    const token = `"${key}": true`;
    assert.equal(inverse.split(token).length, 2);
    inverse = inverse.replace(token, `"${key}": false`);
  }
  assert.equal(hash(inverse), old);
  assert.equal(Buffer.byteLength(inverse), 2899);
  for (const [body, bytes, currentDigest, digest] of [
    [
      adapter,
      32305,
      "e066b97a9205d63598c8bbc198e94b8560c0336f196ce5ee5cd4d530830a5601",
      "c5f3bbe050f3ab3c85121ff9022fe9994db9fbc9b35d135a969d7e880947a662",
    ],
    [
      fixture,
      38078,
      "2778c7e1c4e7d51a1d241a8f2efcdde22b5c5bc3c4fd20c04cb810b4e47fab62",
      "ecaedcbe0ef4adee1a89b2262136c3437c3430611f76373a5c55dc0f21f3ea38",
    ],
  ]) {
    const beforeDiagnostics = previousControllerFailureObservation(
      body,
      body === adapter,
    );
    assert.equal(beforeDiagnostics.split(current).length, 2);
    const currentBody = beforeDiagnostics.replace(current, reviewedCurrent);
    assert.equal(hash(currentBody), currentDigest);
    const previous = currentBody.replace(reviewedCurrent, old);
    assert.equal(Buffer.byteLength(previous), bytes);
    assert.equal(hash(previous), digest);
  }
});

test("actual admitted Node entry still denies a foreign scope before any worker or controller", async () => {
  const before = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    await assert.rejects(main([]), /PROOF_HOST|PROOF_AUTHORITY/);
  } finally {
    if (before === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = before;
  }
});
test("fixed actual authority has no alternate image branch workflow repository or mixed head", () => {
  assert.doesNotThrow(() => inspectAuthority(admitted, environment(), host));
  for (const [key, bad] of Object.entries({
    ImageVersion: "20261021.278.1",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY_VISIBILITY: "private",
    GITHUB_REPOSITORY: "foreign/repo",
    GITHUB_REPOSITORY_ID: "2",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "foreign/workflow",
    GITHUB_RUN_ID: "0",
    GITHUB_RUN_ATTEMPT: "01",
  }))
    assert.throws(
      () => inspectAuthority(admitted, { ...environment(), [key]: bad }, host),
      /PROOF_AUTHORITY/,
    );
  for (const bad of [
    { platform: "linux", arch: "x64" },
    { platform: "win32", arch: "arm64" },
  ])
    assert.throws(
      () => inspectAuthority(admitted, environment(), bad),
      /PROOF_HOST/,
    );
  assert.throws(
    () =>
      inspectAuthority(
        { ...policy, workflowActivation: false, proofExecutionAdmitted: false },
        new Proxy(
          {},
          {
            get() {
              assert.fail("inactive inspected env");
            },
          },
        ),
        host,
      ),
    /PROOF_INACTIVE/,
  );
});
test("unchanged Node inactive gate in isolated legacy model denies before caller-selected arguments or paths", async () => {
  const inactiveMain = vm.runInNewContext("(" + main.toString() + ")", {
    Date,
    performance,
    policy: async () => ({
      ...policy,
      workflowActivation: false,
      proofExecutionAdmitted: false,
    }),
    need: (condition, code) => {
      if (!condition) throw Error(code);
    },
  });
  let reads = 0;
  await assert.rejects(
    inactiveMain(
      new Proxy([], {
        get() {
          reads++;
          throw new Error("untrusted argv");
        },
      }),
    ),
    /PROOF_INACTIVE/,
  );
  assert.equal(reads, 0);
});
test("unchanged Python inactive gate in legacy data model denies before selected root and native kernel import", () => {
  const output = python(
    "import importlib.util,sys\ns=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)\noriginal=p.profile()\np.profile=lambda:{**original,'workflowActivation':False,'proofExecutionAdmitted':False}\ntry:p.main(['--suite','C:/unowned','a'*64]);raise AssertionError('admitted')\nexcept ValueError as e:assert str(e)=='PROOF_INACTIVE'\nassert '_sorng_benign_job_proof_kernel' not in sys.modules\nprint('inactive-before-native')",
  );
  assert.match(output, /inactive-before-native/);
});

test("actual admitted Python entry denies a foreign scope before root reads or native imports", () => {
  const output = python(
    "import importlib.util,sys,os\ns=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)\nos.environ['GITHUB_REF']='refs/heads/closed-negative'\ntry:p.main(['--suite','C:/unowned','a'*64]);raise AssertionError('admitted')\nexcept ValueError as e:assert str(e) in ('PROOF_HOST','PROOF_AUTHORITY')\nassert '_sorng_benign_job_proof_kernel' not in sys.modules\nprint('foreign-before-native')",
  );
  assert.match(output, /foreign-before-native/);
});
test("only exact owned UUID case file paths can reach worker reads", () => {
  const good = path.join(
    ROOT,
    ".artifacts",
    "windows-arm-job-proof-" + nonce,
    CASES[0],
    "case.json",
  );
  assert.equal(caseFileScope(good, CASES[0]), nonce);
  for (const [file, name] of [
    [path.join(ROOT, "arbitrary.json"), CASES[0]],
    [good, CASES[1]],
    [good + ".extra", CASES[0]],
    [good.replace(nonce, "not-a-uuid"), CASES[0]],
    ["relative/case.json", CASES[0]],
  ])
    assert.throws(() => caseFileScope(file, name), /PROOF_CASE_PATH/);
});
test("held subject and exact extracted blocks preserve the root-carried source and closed entry", async () => {
  const raw = await fs.readFile(path.join(ROOT, policy.subject.path));
  const parts = extractSubject(raw, policy);
  assert.match(parts.joined, /qualificationSourceRuns = new WeakMap/);
  assert.doesNotMatch(parts.joined, /^export /m);
  assert.equal(parts.joined.includes("import { fstatSync"), false);
  for (const bad of [
    Buffer.concat([raw, Buffer.from("\n")]),
    Buffer.from(raw).fill(32, 0, 1),
  ])
    assert.throws(() => extractSubject(bad, policy), /PROOF_SUBJECT/);
  const changed = structuredClone(policy);
  changed.subject.joinedSha256 = "0".repeat(64);
  assert.throws(() => extractSubject(raw, changed), /PROOF_SUBJECT_SPAN/);
  const source = raw.toString("utf8");
  assert.match(source, /export const PRIVATE_DRIVER_ADMITTED = false;/);
  assert.match(source, /PRIVATE_ROLES\.slice\(0, 4\)/);
  assert.match(
    source,
    /await qualificationMetadataObservation\(owner, session\);\s+qualificationOwnerCheck\(owner\);[\s\S]{0,200}throw new Error\("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED"\);/,
  );
});
test("native CloseHandle forwarding ledger calls once and preserves returns errors and last-error state", () => {
  const output = python(`import importlib.util,sys
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
for result in [0,1,False,True]:
 calls=[];last=[123];seen=[]
 def native(*args):calls.append(args);return result
 ledger=p.CloseLedger(native,get_error=lambda:last[0],set_error=lambda value:seen.append(value))
 assert ledger('exact',7) is result and calls==[('exact',7)] and seen==[123]
 assert ledger.snapshot(True)['checkedCloseCallsSucceeded'] is bool(result)
original=RuntimeError('original native exception')
def throwing(*args):raise original
try:p.CloseLedger(throwing)('owned');raise AssertionError('lost')
except RuntimeError as e:assert e is original
calls=[];ledger=p.CloseLedger(lambda *args:(calls.append(args),1)[1],maximum=1)
ledger(1);ledger(2);assert calls==[(1,),(2,)] and ledger.snapshot(True)['checkedCloseCallsSucceeded'] is False
assert p.CloseLedger(lambda _:1).snapshot(True)['checkedCloseCallsSucceeded'] is False
def broken(*args):raise RuntimeError('observer-only fault')
for options in [dict(get_error=broken),dict(get_error=lambda:0,set_error=broken)]:
 calls=[];ledger=p.CloseLedger(lambda *args:(calls.append(args),1)[1],**options)
 assert ledger('owned')==1 and calls==[('owned',)] and ledger.snapshot(True)['checkedCloseCallsSucceeded'] is False
print('ledger-forwarded-once')`);
  assert.match(output, /ledger-forwarded-once/);
});
test("one original suite work end and final reserve cannot reset across cases", () => {
  const output = python(`import importlib.util,sys
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
wall=[1000.0];mono=[20.0];c=p.SuiteClock(1000000,lambda:wall[0],lambda:mono[0]);assert c.case_seconds(p.CASES[0])==20
wall[0]+=146;mono[0]+=146;assert c.case_seconds(p.CASES[0])==4
try:c.case_seconds('deadline-with-pipe-descendant');raise AssertionError('fresh lease')
except ValueError as e:assert str(e)=='PROOF_RESERVE'
wall[0]+=5;mono[0]+=5
try:c.case_seconds(p.CASES[1]);raise AssertionError('late')
except ValueError:pass
assert c.left()==129
wall[0]+=4
try:c.left();raise AssertionError('clock drift')
except ValueError as e:assert str(e)=='PROOF_CLOCK_DRIFT'
print('single-original-clock')`);
  assert.match(output, /single-original-clock/);
});
test("actual kernel body and supported assignment observer remain byte and AST exact", () => {
  const output = python(`import ast,hashlib,pathlib,sys
raw=pathlib.Path(sys.argv[2]).read_bytes();assert hashlib.sha256(raw).hexdigest()=='70f10cc78c6b75519d3b33cb02788b49f058bdfdf0780b27aeb7becde0b5e716'
tree=ast.parse(raw);f=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run_job')
assert hashlib.sha256(ast.dump(f,include_attributes=False).encode()).hexdigest()=='f27430844c58da35e566d19f2a1da15a8fc15ea62cad62b61cbe4d4a5c58977f'
assert [x.arg for x in f.args.kwonlyargs]==['cancel','_test_fault','cap','_test_cleanup_seconds','_test_observe']
text=raw.decode();a=text.index("result['assignedAtCreationVerified']=True");b=text.index('_test_observe(job,pi.process,pi.pid',a);c=text.index('if cancel is not None and cancel.is_set():',b);d=text.index('checked(resume(pi.thread)',c);assert a<b<c<d
adapter=ast.parse(pathlib.Path(sys.argv[1]).read_bytes());calls=[n for n in ast.walk(adapter) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='run_job'];assert len(calls)==1
assert [k.arg for k in calls[0].keywords]==['cancel','cap','_test_observe']
print('unchanged-real-observer-order')`);
  assert.match(output, /unchanged-real-observer-order/);
});
test("strict report accepts a synthetic complete envelope but grants no production authority", () => {
  const { proof, receipts } = validateControllerResult(
    synthetic(),
    policy,
    nonce,
    head,
  );
  assert.equal(proof.complete, true);
  assert.equal(receipts.length, 9);
  for (const key of [
    "productionAdmission",
    "sourceGnQualified",
    "compilerAdmission",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(proof[key], false);
});
test("strict report rejects missing cases changed outcomes close ambiguity stale freshness and copied raw receipts", () => {
  const changes = [
    (v) => {
      v.complete = false;
    },
    (v) => {
      v.nonce = "foreign";
    },
    (v) => {
      v.head = "b".repeat(40);
    },
    (v) => {
      v.productionAdmission = true;
    },
    (v) => {
      v.scratchRemoved = false;
    },
    (v) => {
      v.extra = true;
    },
    (v) => {
      v.cases.pop();
    },
    (v) => {
      v.cases[1] = v.cases[0];
    },
    (v) => {
      v.rawReceipts.reverse();
    },
    (v) => {
      v.cases[0].checkedCloseCallsSucceeded = false;
    },
    (v) => {
      v.cases[0].foreignControllerPreserved = false;
    },
    (v) => {
      v.cases[0].activeAtEnd = false;
    },
    (v) => {
      v.cases[0].closeCalls = 0;
    },
    (v) => {
      v.cases[0].readersJoined = false;
    },
    (v) => {
      v.cases[0].node.cohortQuietProven = true;
    },
    (v) => {
      v.cases[0].node.rolesStarted = 7;
    },
    (v) => {
      v.cases[0].node.unconfirmedClose = true;
    },
    (v) => {
      v.cases[0].node.rootAndPipesJoined = false;
    },
    (v) => {
      const row = JSON.parse(Buffer.from(v.rawReceipts[0], "base64"));
      row.observerStopped = false;
      const raw = Buffer.from(JSON.stringify(row) + "\n");
      v.rawReceipts[0] = raw.toString("base64");
      v.cases[0].kernelReceiptPin = { bytes: raw.length, sha256: hash(raw) };
    },
    (v) => {
      v.cases[0].node.rolesJoined = "6";
    },
    (v) => {
      v.cases[0].node.closedEntryDenied = false;
    },
    (v) => {
      v.cases[3].workerStarted = true;
    },
    (v) => {
      v.cases[4].resumed = true;
    },
    (v) => {
      v.cases[4].assignmentObserverVerified = false;
    },
    (v) => {
      v.cases[5].node = v.cases[0].node;
    },
    (v) => {
      v.cases[7].reparentedDescendantVerified = false;
    },
    (v) => {
      v.cases[1].node.failure = null;
    },
    (v) => {
      v.cases[0].kernelReceiptPin.sha256 = "0".repeat(64);
    },
    (v) => {
      v.rawReceipts[0] += "\n";
    },
  ];
  for (const change of changes) {
    const value = synthetic();
    change(value);
    assert.throws(
      () => validateControllerResult(value, policy, nonce, head),
      /PROOF_/,
    );
  }
});
test("portable six-role model uses the actual subject block and real log FDs without starting an actor", async (t) => {
  const subject =
    await import("../../native/windows-arm-full-sdk/private-source-driver.mjs");
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "windows-job-proof-model-")),
  );
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  const logs = path.join(root, "private-qualification-logs");
  await fs.mkdir(logs);
  const begin = "function realm(",
    end = "async function worker(";
  assert.equal(fixture.split(begin).length, 2);
  assert.equal(fixture.split(end).length, 2);
  const body = fixture.slice(fixture.indexOf(begin), fixture.indexOf(end));
  const roles = [
    "qual-gn-desc-pa",
    "qual-gn-desc-cef",
    "qual-gn-args",
    "qual-generate-headers",
    "qual-clang-probe",
    "qual-link-probe",
  ];
  const make = vm.runInNewContext(body + ";realm", {
    vm,
    fs,
    syncFs,
    path,
    Buffer,
    createHash,
    performance,
    setTimeout,
    clearTimeout,
    ROOT,
    ROLES: roles,
    hash,
    need: (ok, code) => {
      if (!ok) throw new Error(code);
    },
  });
  const vectors = roles.map((role) => ({
    role,
    argv: [policy.node.path, "fixed-model-only"],
    cwd: root,
  }));
  let starts = 0;
  const modeledSpawn = () => {
    starts++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => assert.fail("normal model killed");
    setImmediate(() => {
      child.stdout.write("fixed stdout");
      child.stderr.write("fixed stderr");
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdout.destroy();
      child.stderr.destroy();
      child.emit("close", 0, null);
    });
    return child;
  };
  const raw = await fs.readFile(path.join(ROOT, policy.subject.path));
  const model = make(
    extractSubject(raw, policy),
    subject.qualificationPhaseClock,
    vectors,
    modeledSpawn,
  );
  const token = Object.freeze({ onlyIsolatedModel: true }),
    signal = new AbortController();
  const stamp = (info) =>
    [
      info.dev,
      info.ino,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
      info.birthtimeNs,
      info.mode,
      info.nlink,
    ].join(":");
  const stateSource = {
    root,
    budget: { remaining: () => 155000 },
    signal: signal.signal,
    context: {},
    privatePolicyRaw: Buffer.from("{}"),
    contextSha: "a".repeat(64),
    logsIdentity: stamp(await fs.lstat(logs, { bigint: true })),
    output: { bytes: 0 },
    environment: { FIXED_MODEL: "1" },
    compilerEnvironment: { FIXED_MODEL: "1" },
    custom: { sourceGitEnvironment: async (_policy, env) => ({ ...env }) },
    gitPolicy: { onlyIsolatedModel: true },
    validateBefore: async () => {},
    validateAfter: async () => {},
  };
  stateSource.phase = subject.qualificationPhaseClock(stateSource.budget);
  stateSource.end = performance.now() + 5000;
  model.qualificationSourceRuns.set(token, stateSource);
  model.qualificationCoordinatorSources.add(token);
  const session = model.createQualificationSession(token),
    state = model.qualificationSessions.get(session);
  for (const role of roles) {
    const observation = Object.freeze({ onlyIsolatedModel: true });
    model.qualificationObservations.set(observation, {
      session,
      state,
      role,
      epoch: state.epoch,
    });
    const result = await model.runFixedJoined(session, role, observation);
    assert.equal(result.rootAndPipesJoined, true);
    assert.equal(result.cohortQuietProven, false);
  }
  assert.equal(starts, 6);
  assert.equal(state.next, 6);
  assert.equal(state.logFiles.size, 12);
  assert.equal(subject.PRIVATE_DRIVER_ADMITTED, false);
  assert.equal(subject.qualificationSourceRuns, undefined);
});
test("proof adapter and subject harness contain only fixed vectors and never a production issuer writer", () => {
  assert.doesNotMatch(
    adapter,
    /subprocess\.(?:run|Popen)|_test_fault\s*=|_test_cleanup_seconds\s*=/,
  );
  assert.match(adapter, /kernel\.close = ledger/);
  assert.match(adapter, /event\.set\(\)/);
  assert.match(adapter, /kernel\.ParentCancel\(event\)/);
  assert.match(fixture, /qualificationSourceRuns\.set\(token, sourceState\)/);
  assert.match(fixture, /vm\.runInNewContext/);
  assert.doesNotMatch(fixture, /subject\.qualificationSourceRuns/);
  assert.match(fixture, /cohortQuietProven: false/);
});

test("actual controller body rejects nonzero or late fulfillment and retires only its own unjoined streams", async () => {
  const from = "async function runController(",
    until = "export function validateControllerResult(";
  assert.equal(fixture.split(from).length, 2);
  assert.equal(fixture.split(until).length, 2);
  const body = fixture.slice(fixture.indexOf(from), fixture.indexOf(until));
  for (const mode of ["exit7", "late-close", "cap-then-unjoined"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let kills = 0,
      unrefs = 0,
      options;
    child.kill = () => {
      kills++;
      return true;
    };
    child.unref = () => {
      unrefs++;
    };
    const run = vm.runInNewContext(body + ";runController", {
      path,
      Buffer,
      performance,
      setTimeout,
      clearTimeout,
      ROOT,
      checkEnd: (end) => {
        if (performance.now() >= end) throw new Error("PROOF_DEADLINE");
      },
      need: (value, code) => {
        if (!value) throw new Error(code);
      },
      spawn: (_exe, _args, passed) => {
        options = passed;
        queueMicrotask(() => {
          if (mode === "cap-then-unjoined") {
            child.stdout.write(Buffer.alloc(262145));
            return;
          }
          if (mode === "late-close") {
            const stop = performance.now() + 35;
            while (performance.now() < stop) {
              /* Deliberately defer timers beyond original end. */
            }
          }
          child.stdout.write('{"complete":true}');
          child.emit("exit", mode === "exit7" ? 7 : 0, null);
          child.emit("close", mode === "exit7" ? 7 : 0, null);
        });
        return child;
      },
    });
    const end = performance.now() + (mode === "exit7" ? 100 : 20);
    await assert.rejects(
      run(policy, "fixed-owned-model-root", "a".repeat(64), end, {
        ...environment(),
        GH_TOKEN: "fixture-only-secret",
      }),
      new RegExp(
        mode === "exit7"
          ? "PROOF_CONTROLLER_EXIT"
          : mode === "late-close"
            ? "PROOF_DEADLINE"
            : "PROOF_CONTROLLER_OUTPUT",
      ),
    );
    assert.equal(options.env.GH_TOKEN, undefined);
    assert.equal(options.env.GITHUB_SHA, head);
    assert.deepEqual([...options.stdio], ["ignore", "pipe", "pipe"]);
    if (mode === "cap-then-unjoined") {
      assert(kills >= 1);
      assert.equal(unrefs, 1);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
    } else
      assert.equal(kills, 0, "never signal a root after its observed exit");
  }
});

test("actual tiny cleanup is causal: legacy deletes foreign replacement, repaired guards preserve root leaf and final-root replacements", () => {
  const output =
    python(String.raw`import importlib.util,sys,pathlib,tempfile,types,hashlib,json,os
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
old='''def remove_owned_tree(root, original, clock):
    # No unknown roots/links/recursion: deny rather than following a junction.
    need(identity(root.lstat()) == original, "PROOF_ROOT_CHANGED")
    rows = []
    for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
        clock.left()
        path = Path(base)
        need(len(path.relative_to(root).parts) <= 8, "PROOF_CLEANUP_DEPTH")
        for name in dirs + files:
            item = physical(path / name)
            need(item.is_dir() or (item.is_file() and item.stat().st_nlink == 1), "PROOF_CLEANUP_TYPE")
            rows.append(item)
            need(len(rows) <= 4096, "PROOF_CLEANUP_BOUND")
    for item in reversed(rows):
        clock.left()
        item.rmdir() if item.is_dir() else item.unlink()
    need(identity(root.lstat()) == original, "PROOF_ROOT_CHANGED")
    root.rmdir()
'''
assert hashlib.sha256(old.encode()).hexdigest()=='caa227f90db496f1cdb2a4f253d196102d15dbea3f86da04e43d40e197f9e5ff'
scope=dict(p.__dict__);exec(old,scope);legacy=scope['remove_owned_tree']
native_unlink=pathlib.Path.unlink
clock=types.SimpleNamespace(left=lambda:10)

def run(mode,guarded):
 base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-causal-')).resolve();root=base/'owned';saved=base/'saved';displaced=base/'displaced.bin';root.mkdir()
 names=('a.bin',)if mode=='final-root'else('a.bin','b.bin')
 for name in names:(root/name).write_bytes(b'OWNED')
 original=p.identity(root.lstat());changed=[False];foreign=[None];error=[None];deleted=[False]
 reader=p.WindowsCleanupRead if os.name=='nt'else p.CleanupRead;native_close=reader.close
 try:
  def replace():
   changed[0]=True
   if mode in ('root','final-root'):
    remaining=next(root.iterdir()).name if mode=='root'else'FOREIGN.bin';root.rename(saved);root.mkdir();foreign[0]=root/remaining
   elif mode=='leaf':
    remaining=next(root.iterdir());remaining.rename(displaced);foreign[0]=root/remaining.name
   else:foreign[0]=root/'FOREIGN.bin'
   foreign[0].write_bytes(b'FOREIGN SENTINEL')
  def intercept(item,*args,**kwargs):
   result=native_unlink(item,*args,**kwargs)
   if not changed[0] and item.parent==root:
    deleted[0]=True
    if not guarded:replace()
   return result
  def after_owned_close(self):
   result=native_close(self)
   if guarded and deleted[0] and not changed[0]:replace()
   return result
  pathlib.Path.unlink=intercept
  reader.close=after_owned_close
  try:
   if guarded:p.remove_owned_tree(root,original,clock,frozenset(names))
   else:legacy(root,original,clock)
  except BaseException as caught:error[0]=caught
  assert changed[0],('replacement boundary not reached',mode,error[0])
  if guarded:
   assert isinstance(error[0],ValueError),(mode,error[0])
   assert foreign[0].read_bytes()==b'FOREIGN SENTINEL',(mode,error[0])
  return foreign[0] is not None and not foreign[0].exists()
 finally:
  pathlib.Path.unlink=native_unlink
  reader.close=native_close
  for folder in(root,saved):
   if folder.exists():
    assert folder.resolve()==folder and folder.parent==base
    for name in('a.bin','b.bin','FOREIGN.bin'):
     item=folder/name
     if item.exists():native_unlink(item)
    folder.rmdir()
  if displaced.exists():native_unlink(displaced)
  base.rmdir()

assert run('root',False)is True
for mode in('root','leaf','unknown','final-root'):assert run(mode,True)is False
base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-positive-')).resolve();root=base/'owned';root.mkdir();(root/'nested').mkdir();(root/'nested/a.bin').write_bytes(b'x');(root/'empty.log').write_bytes(b'')
result=p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('nested','nested/a.bin','empty.log')))
assert result['readHandlesClosed']is True and result['sourceInodeCas']is False and result['closeCalls']>=4 and not root.exists();base.rmdir()
print(json.dumps({'legacyForeignDeleted':True,'repairedForeignPreserved':True,'finalRootPreserved':True,'ordinaryNestedCleanup':True,'nativeJobExecuted':False}))`);
  const result = JSON.parse(output);
  assert.equal(result.legacyForeignDeleted, true);
  assert.equal(result.repairedForeignPreserved, true);
  assert.equal(result.finalRootPreserved, true);
  assert.equal(result.ordinaryNestedCleanup, true);
  assert.equal(result.nativeJobExecuted, false);
});

test("cleanup known-name ledger and actual close failure deny without deleting unknown content", () => {
  const output =
    python(String.raw`import importlib.util,sys,pathlib,tempfile,types,os
s=importlib.util.spec_from_file_location('p',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
base=pathlib.Path(tempfile.mkdtemp(prefix='owned-job-cleanup-close-')).resolve();root=base/'owned';root.mkdir();leaf=root/'known.bin';leaf.write_bytes(b'OWNED');unknown=root/'FOREIGN.bin';unknown.write_bytes(b'FOREIGN');clock=types.SimpleNamespace(left=lambda:10)
try:
 try:p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('known.bin',)));raise AssertionError('unknown deleted')
 except ValueError as e:assert str(e)=='PROOF_CLEANUP_UNKNOWN'
 assert unknown.read_bytes()==b'FOREIGN';unknown.unlink()
 name='WindowsCleanupRead'if os.name=='nt'else'CleanupRead';original=getattr(p,name)
 class FailedClose(original):
  def __init__(self,*args):
   super().__init__(*args)
   if os.name=='nt':
    native=self.native_close
    self.native_close=lambda handle:(native(handle),False)[1]
  def close(self):
   live=self.handle is not None if os.name=='nt'else self.fd is not None
   super().close()
   if live and os.name!='nt':raise ValueError('PROOF_CLEANUP_CLOSE')
 setattr(p,name,FailedClose)
 try:
  try:p.remove_owned_tree(root,p.identity(root.lstat()),clock,frozenset(('known.bin',)));raise AssertionError('close claim accepted')
  except ValueError as e:assert str(e)=='PROOF_CLEANUP_CLOSE'
 finally:setattr(p,name,original)
 assert leaf.read_bytes()==b'OWNED'
 assert root.resolve()==root and root.parent==base
finally:
 for item in(leaf,unknown):
  if item.exists():item.unlink()
 root.rmdir();base.rmdir()
print('known-names-and-close-fail-closed')`);
  assert.match(output, /known-names-and-close-fail-closed/);
});

const workflowText = await fs.readFile(
  path.join(ROOT, policy.workflow),
  "utf8",
);
const workflow = YAML.parse(workflowText),
  proofJob = workflow.jobs.proof;
const proofStep = proofJob.steps.find((step) => step.id === "proof");
const programMatch = /@'\n([\s\S]+)\n'@ \| node --input-type=module/.exec(
  proofStep.run,
);
assert(programMatch, "fixed PowerShell Node program");
const carrierProgram = programMatch[1];

function withoutCarrierFailureDiagnostics(text) {
  text = restorePriorControllerFlavor(text);
  for (const name of ["import", "projection"]) {
    const begin = `          // BEGIN fixed carrier failure diagnostic ${name}\n`,
      end = `          // END fixed carrier failure diagnostic ${name}\n`;
    assert.equal(text.split(begin).length, 2);
    assert.equal(text.split(end).length, 2);
    text = text.replace(
      text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
      "",
    );
  }
  for (const phase of [
    "import",
    "policy",
    "authority",
    "main",
    "reportscan",
    "reportread",
    "validate",
    "output",
  ]) {
    const line = `          phase = '${phase}';\n`;
    assert.equal(text.split(line).length, 2);
    text = text.replace(line, "");
  }
  const begin = "          // BEGIN fixed carrier failure diagnostic catch\n",
    end = "          // END fixed carrier failure diagnostic catch\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  return text.replace(
    text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
    "          } catch { console.error('PROOF_CARRIER_DENIED'); process.exitCode = 1; }\n",
  );
}
function failureProjection(overrides = {}) {
  const begin = carrierProgram.indexOf(
      "// BEGIN fixed carrier failure diagnostic projection",
    ),
    end = carrierProgram.indexOf(
      "// END fixed carrier failure diagnostic projection",
    );
  assert(begin > 0 && end > begin);
  return vm.runInNewContext(
    carrierProgram.slice(begin, end) +
      "\n({FAILURE_PHASES,FAILURE_CODES,carrierFailureCode,carrierFailure})",
    { diagnosticTypes, Buffer, ...overrides },
  );
}

test("carrier failure whitelist is exactly the actual main reachable and outer assertion labels", () => {
  const ast = ts.createSourceFile(
    "proof.mjs",
    fixture,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const functions = new Map(
    ast.statements
      .filter(ts.isFunctionDeclaration)
      .filter((node) => node.name)
      .map((node) => [node.name.text, node]),
  );
  const visited = new Set(),
    expected = new Set();
  const inspect = (name) => {
    if (
      visited.has(name) ||
      ["worker", "actor"].includes(name) ||
      !functions.has(name)
    )
      return;
    visited.add(name);
    const walk = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (
          node.expression.text === "need" &&
          node.arguments[1] &&
          ts.isStringLiteral(node.arguments[1])
        )
          expected.add(node.arguments[1].text);
        inspect(node.expression.text);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Error" &&
        node.arguments?.[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        expected.add(node.arguments[0].text);
      ts.forEachChild(node, walk);
    };
    walk(functions.get(name));
  };
  inspect("main");
  const previous = YAML.parse(withoutCarrierFailureDiagnostics(workflowText));
  const program = /@'\n([\s\S]+)\n'@ \| node --input-type=module/.exec(
    previous.jobs.proof.steps.find((step) => step.id === "proof").run,
  )[1];
  const outer = ts.createSourceFile(
    "carrier.mjs",
    program,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const walk = (node) => {
    if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression)
        ? node.expression.text === "assert"
        : ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "assert")
    ) {
      const value = node.arguments.at(-1);
      if (value && ts.isStringLiteral(value)) expected.add(value.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(outer);
  const api = failureProjection();
  assert.equal(expected.size, 60);
  assert.deepEqual([...api.FAILURE_CODES].sort(), [...expected].sort());
  assert.equal(new Set(api.FAILURE_CODES).size, 60);
  assert.deepEqual(
    [...api.FAILURE_PHASES],
    [
      "before",
      "import",
      "policy",
      "authority",
      "main",
      "reportscan",
      "reportread",
      "validate",
      "output",
    ],
  );
  for (const code of api.FAILURE_CODES)
    for (const phase of api.FAILURE_PHASES) {
      const raw = api.carrierFailure(phase, Error(code)),
        row = JSON.parse(raw);
      assert.equal(api.carrierFailureCode(Error(code)), code);
      assert.deepEqual(row, {
        kind: "windows-benign-job-carrier-failure",
        complete: false,
        phase,
        code,
        runtimeReady: false,
      });
      assert(Buffer.byteLength(raw, "utf8") <= 256);
    }
});

test("carrier failure inspection rejects getters proxies inherited messages and unknown or falsy throws without disclosure", () => {
  const api = failureProjection();
  let invoked = 0;
  const getter = Object.defineProperty({}, "message", {
    get() {
      invoked++;
      throw Error("PRIVATE getter");
    },
  });
  const forged = new Proxy(Error("PROOF_PIN"), {
    getOwnPropertyDescriptor() {
      invoked++;
      return { value: "PROOF_PIN", configurable: true };
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const error of [
    false,
    0,
    1n,
    Symbol("PRIVATE"),
    null,
    undefined,
    "PROOF_PIN",
    Error("PROOF_PIN PRIVATE"),
    Error("PRIVATE".repeat(10000)),
    { code: "ENOENT" },
    Object.create({ message: "PROOF_PIN" }),
    getter,
    forged,
    revoked.proxy,
    new Proxy(
      {},
      {
        get() {
          invoked++;
          throw Error("PRIVATE proxy");
        },
      },
    ),
  ]) {
    assert.equal(api.carrierFailureCode(error), "UNKNOWN");
    const raw = api.carrierFailure("main", error);
    assert.equal(JSON.parse(raw).code, "UNKNOWN");
    assert(!raw.includes("PRIVATE"));
    assert(Buffer.byteLength(raw, "utf8") <= 256);
  }
  assert.equal(invoked, 0);
  assert.equal(api.carrierFailure("PRIVATE", Error("PROOF_PIN")), null);
  assert.equal(
    failureProjection({
      JSON: {
        stringify() {
          throw Error("PRIVATE projection");
        },
      },
    }).carrierFailure("main", Error("PROOF_PIN")),
    null,
  );
  assert.equal(
    failureProjection({ Buffer: { byteLength: () => 257 } }).carrierFailure(
      "main",
      Error("PROOF_PIN"),
    ),
    null,
  );
});

async function modelCarrier(options = {}) {
  const {
    failPhase,
    actualMain = false,
    loggingFails = false,
    projectionFails = false,
  } = options;
  const error = Object.hasOwn(options, "error")
    ? options.error
    : Error("PROOF_PIN");
  // Actual fixed workflow program; only module loading, FS/host, and native
  // suite fulfillment are modeled. No Job, actor, Python, or source fetch runs.
  const loading =
    "await import('./tests/fixtures/cef/windows_arm_qualification_job_proof.mjs')";
  assert.equal(carrierProgram.split(loading).length, 2);
  const body = carrierProgram
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(loading, "await modelImport()");
  const checked = validateControllerResult(synthetic(), admitted, nonce, head),
    root = "C:\\owned",
    artifacts = path.win32.join(root, ".artifacts"),
    reportDirectory = path.win32.join(
      artifacts,
      "windows-arm-job-report-" + nonce,
    ),
    names = [
      "proof.json",
      ...Array.from({ length: 9 }, (_, i) => `receipt-${i}.json`),
    ];
  const content = new Map([
    [
      path.win32.join(reportDirectory, "proof.json"),
      Buffer.from(JSON.stringify(checked.proof)),
    ],
    ...checked.receipts.map((raw, index) => [
      path.win32.join(reportDirectory, `receipt-${index}.json`),
      raw,
    ]),
  ]);
  const state = {
    errors: [],
    logs: [],
    appended: [],
    reportScans: 0,
    reportReads: 0,
    mainCalls: 0,
    process: {
      cwd: () => root,
      env: {
        CEF_WINDOWS_BENIGN_JOB_STARTED_MS: "1793606908000",
        GITHUB_SHA: head,
        GITHUB_RUN_ID: "100",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_OUTPUT: "C:\\PRIVATE-output",
      },
    },
  };
  let realmArray;
  const info = (name, bigint) => {
    const number = (value) => (bigint ? BigInt(value) : value);
    return {
      dev: number(1),
      ino: number(2),
      size: number(content.get(name)?.length ?? 0),
      mode: number(0o100600),
      nlink: number(1),
      birthtimeNs: number(1),
      mtimeNs: number(1),
      ctimeNs: number(1),
      isFile: () => content.has(name),
      isSymbolicLink: () => false,
    };
  };
  const api = {
    realpath: async (name) => {
      if (failPhase === "before") throw error;
      return name;
    },
    lstat: async (name, options) => info(name, options?.bigint),
    readdir: async (name) => {
      if (name === artifacts) {
        if (!state.mainCalls) return [];
        state.reportScans++;
        if (failPhase === "reportscan") throw error;
        return [path.win32.basename(reportDirectory)];
      }
      return realmArray.from(names);
    },
    readFile: async () => {
      if (failPhase === "policy") throw error;
      return JSON.stringify(admitted);
    },
    open: async (name) => {
      state.reportReads++;
      if (failPhase === "reportread") throw error;
      const raw = content.get(name);
      assert(raw);
      return {
        stat: async () => info(name, true),
        read: async (buffer, offset, length, position) => {
          const bytesRead = Math.min(
            length,
            Math.max(0, raw.length - position),
          );
          raw.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        close: async () => {},
      };
    },
    appendFile: async (...args) => {
      if (failPhase === "output") throw error;
      state.appended.push(args);
    },
  };
  const modelModule = {
    inspectAuthority: () => {
      if (failPhase === "authority") throw error;
    },
    main: async (args) => {
      assert.deepEqual([...args], []);
      state.mainCalls++;
      if (actualMain) await main([]);
      if (failPhase === "main") throw error;
    },
    validateControllerResult: (...args) => {
      if (failPhase === "validate") throw error;
      return validateControllerResult(...args);
    },
  };
  const scope = vm.createContext({
    assert,
    fs: api,
    path: path.win32,
    createHash,
    diagnosticTypes,
    Buffer,
    JSON,
    process: state.process,
    Date: { now: () => 1793606908000 },
    performance: { now: () => 0 },
    modelImport: async () => {
      if (failPhase === "import") throw error;
      return modelModule;
    },
    console: {
      error: (value) => {
        assert.equal(state.process.exitCode, 1);
        if (loggingFails) throw Error("PRIVATE logging");
        state.errors.push(value);
      },
      log: (value) => state.logs.push(value),
    },
    ...(projectionFails
      ? {
          JSON: {
            parse: JSON.parse,
            stringify() {
              throw Error("PRIVATE projection");
            },
          },
        }
      : {}),
  });
  realmArray = vm.runInContext("Array", scope);
  await vm.runInContext("(async()=>{\n" + body + "\n})()", scope);
  return state;
}

test("actual fixed carrier reports each phase while preserving nonzero failure and the fulfillment-only report gate", async () => {
  for (const phase of failureProjection().FAILURE_PHASES) {
    const state = await modelCarrier({ failPhase: phase });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.errors[0], "PROOF_CARRIER_DENIED");
    const diagnostic = JSON.parse(state.errors[1]);
    assert.equal(diagnostic.phase, phase);
    assert.equal(diagnostic.code, "PROOF_PIN");
    assert.equal(diagnostic.complete, false);
    assert.equal(diagnostic.runtimeReady, false);
    assert.equal(state.appended.length, 0);
    assert.equal(state.logs.length, 0);
    if (["before", "import", "policy", "authority", "main"].includes(phase)) {
      assert.equal(state.reportScans, 0);
      assert.equal(state.reportReads, 0);
    }
  }
  const success = await modelCarrier();
  assert.equal(success.process.exitCode, undefined);
  assert.equal(success.errors.length, 0);
  assert.equal(success.appended.length, 1);
  assert.equal(success.reportReads, 10);
  assert.equal(JSON.parse(success.logs[0]).complete, true);
  for (const error of [false, 0, null, undefined]) {
    const state = await modelCarrier({ failPhase: "main", error });
    assert.equal(state.process.exitCode, 1);
    assert.equal(JSON.parse(state.errors[1]).code, "UNKNOWN");
    assert.equal(state.appended.length, 0);
  }
  for (const options of [{ loggingFails: true }, { projectionFails: true }]) {
    const state = await modelCarrier({ failPhase: "import", ...options });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.appended.length, 0);
    assert(!JSON.stringify(state.errors).includes("PRIVATE"));
  }
});

test("genuine existing main authority rejection cannot select or publish valid-looking modeled reports", async () => {
  const original = process.env.GITHUB_REF;
  try {
    process.env.GITHUB_REF = "refs/heads/closed-negative";
    const state = await modelCarrier({ actualMain: true });
    assert.equal(state.process.exitCode, 1);
    assert.equal(state.mainCalls, 1);
    assert.equal(state.reportScans, 0);
    assert.equal(state.reportReads, 0);
    assert.equal(state.appended.length, 0);
    const diagnostic = JSON.parse(state.errors[1]);
    assert.equal(diagnostic.phase, "main");
    assert(["PROOF_HOST", "PROOF_AUTHORITY"].includes(diagnostic.code));
  } finally {
    if (original === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = original;
  }
});

test("carrier diagnostics exact inverse restores the complete detached old-image workflow", () => {
  const previous = withoutCarrierFailureDiagnostics(workflowText);
  assert.equal(Buffer.byteLength(previous), 9136);
  assert.equal(
    hash(previous),
    "22a349c7bafd67feff54a6f164ae8df1e32635ffd88b0cfd16eb5a5e83417a73",
  );
});

test("new workflow is no-input private-branch image-bound and uploads only validated ten report leaves", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: null });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(proofJob["runs-on"], "windows-2025-vs2026");
  assert.equal(proofJob["timeout-minutes"], 10);
  for (const condition of [
    "github.event_name == 'workflow_dispatch'",
    "github.event.repository.visibility == 'public'",
    "github.repository == 'supermarsx/sortOfRemoteNG'",
    "github.repository_id == '1010282954'",
    "github.event.repository.default_branch == 'main'",
    `github.ref == '${policy.ref}'`,
  ])
    assert(proofJob.if.includes(condition));
  const first = proofJob.steps[0];
  assert.equal(first.id, "original");
  assert(
    first.run.indexOf("CEF_WINDOWS_BENIGN_JOB_STARTED_MS") <
      first.run.indexOf("ImageVersion"),
  );
  assert(first.run.includes("20261030.294.1"));
  const checkout = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(
    checkout.uses,
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  );
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.env.GIT_CONFIG_VALUE_0, "false");
  const setup = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  assert.equal(
    setup.uses,
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  );
  assert.equal(setup.with["node-version-file"], ".node-version");
  const pythonStep = proofJob.steps.find((step) =>
    step.uses?.startsWith("actions/setup-python@"),
  );
  assert.equal(
    pythonStep.uses,
    "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1",
  );
  assert.equal(
    pythonStep.if,
    "steps.original.outputs.python_required == 'true'",
  );
  assert.equal(pythonStep.with["python-version"], "3.12.10");
  assert.equal(pythonStep.with["update-environment"], false);
  const upload = proofJob.steps.at(-1);
  assert.equal(
    upload.uses,
    "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  );
  assert.equal(upload.with.path, "${{ steps.proof.outputs.paths }}");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["include-hidden-files"], true);
  assert.equal(upload.if, undefined);
  assert.equal(upload["continue-on-error"], undefined);
  assert(!workflowText.includes("GH_TOKEN"));
  assert(!workflowText.includes("github.token"));
  assert(!workflowText.includes("always()"));
  assert(
    carrierProgram.indexOf("await main([])") <
      carrierProgram.indexOf("const candidates"),
  );
  assert(
    carrierProgram.indexOf("validateControllerResult(") <
      carrierProgram.indexOf("fs.appendFile(process.env.GITHUB_OUTPUT"),
  );
  assert(carrierProgram.includes("Array.from({length:9}"));
  assert(carrierProgram.includes("'proof.json'"));
  assert(!carrierProgram.includes("Promise.race"));
  assert(!carrierProgram.includes("**"));
  const canonicalLine = carrierProgram
    .split("\n")
    .find((line) => line.includes("const canonical ="));
  const canonicalPath = vm.runInNewContext(canonicalLine + "\ncanonical", {
    path: path.win32,
  });
  assert.equal(canonicalPath("C:\\OWNED\\report.json"), "c:/owned/report.json");
  assert(carrierProgram.includes("PROOF_CARRIER_DENIED"));
});

test("actual workflow clock consumes checkout/setup and leaves inner300 and kernel deadlines unchanged", () => {
  const start = carrierProgram.indexOf("// BEGIN BENIGN ORIGINAL JOB CLOCK"),
    end = carrierProgram.indexOf("// END BENIGN ORIGINAL JOB CLOCK");
  assert(start >= 0 && end > start);
  let wall = 1793664000000,
    mono = 100;
  const api = vm.runInNewContext(
    carrierProgram.slice(start, end) +
      "\n({originalJobDeadline,checkOriginalJob})",
    { assert, Date: { now: () => wall }, performance: { now: () => mono } },
  );
  const clock = api.originalJobDeadline(String(wall - 200000), wall, mono);
  assert.equal(clock.wallEnd, wall + 370000);
  assert.equal(clock.monotonicEnd, 370100);
  api.checkOriginalJob(clock);
  wall += 300000;
  mono += 300000;
  api.checkOriginalJob(clock);
  assert.equal(clock.monotonicEnd, 370100);
  mono = clock.monotonicEnd;
  assert.throws(() => api.checkOriginalJob(clock), /DEADLINE/);
  mono = 100;
  wall = clock.wallEnd;
  assert.throws(() => api.checkOriginalJob(clock), /DEADLINE/);
  for (const value of [
    String(wall + 1),
    String(wall - 270001),
    "0",
    "foreign",
    undefined,
  ])
    assert.throws(() => api.originalJobDeadline(value, wall, 100));
  assert(
    carrierProgram.includes(
      "Math.min(clock.wallEnd-Date.now(),clock.monotonicEnd-performance.now()) >= 300000",
    ),
  );
});

test("existing CI explicit proof contract and exact Node inventory entries are registered once", async () => {
  const ci = YAML.parse(
    await fs.readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
  );
  const step = ci.jobs["browser-transport-contracts"].steps.find(
    (step) => step.name === "Runtime package layout and whole-matrix contract",
  );
  assert.equal(
    step.run
      .split(/\s+/)
      .filter(
        (name) =>
          name ===
          "tests/tooling/windowsArmQualificationJobProof.node-test.mjs",
      ).length,
    1,
  );
  assert.equal(step["continue-on-error"], undefined);
  const inventory = await fs.readFile(
    path.join(ROOT, "tests/tooling/nodeToolchain.node-test.mjs"),
    "utf8",
  );
  assert.equal(
    inventory.split('"windows-arm-qualification-job-proof.yml": 1,').length,
    2,
  );
  assert.equal(
    inventory.split('"windows-arm-source-preflight.yml": 1,').length,
    2,
  );
});

test("fixed old-image proof reuses exact reviewed old source and executable pins without admitting another image", async () => {
  // Retained historical old-image proof; actual current flavor is checked below.
  const policy = JSON.parse(restorePriorControllerFlavor(rawPolicy.toString()));
  assert.equal(
    policy.ref,
    "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102",
  );
  assert.equal(policy.image, "20261021.278.1");
  const oldRaw = await fs.readFile(
    path.join(DIR, "image-qualified-20261021-profile.json"),
  );
  assert.equal(oldRaw.length, 35867);
  assert.equal(
    hash(oldRaw),
    "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
  );
  const old = JSON.parse(oldRaw);
  const privateRaw = await fs.readFile(
    path.join(DIR, "private-qualification-profile.json"),
  );
  assert.equal(
    hash(privateRaw),
    "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",
  );
  const privatePolicy = JSON.parse(privateRaw);
  assert.equal(privatePolicy.images[policy.image].profileSha256, hash(oldRaw));
  assert.equal(old.image, policy.image);
  assert.equal(
    old.sourceGn.sourceId,
    "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
  );
  const namespace = old.sourceGn.namespace;
  const lock = JSON.parse(
    await fs.readFile(path.join(ROOT, namespace, "source-lock.json")),
  );
  const tableRaw = await fs.readFile(
    path.join(ROOT, namespace, "tools/aarch64-pc-windows-msvc.json"),
  );
  assert.equal(
    hash(tableRaw),
    "3fcbd983ae525c55b575f06b64f4c7663351535deabdce74a8df3b2a73c77113",
  );
  assert.equal(lock.builds[0].toolchainLock.sha256, hash(tableRaw));
  const { releaseIdentity } = await import("../../scripts/cef-runtime-ci.mjs");
  assert.equal(
    releaseIdentity(lock, "aarch64-pc-windows-msvc").sourceLockSha256,
    old.sourceGn.sourceId,
  );
  const rows = JSON.parse(tableRaw).files;
  for (const role of ["python", "node"]) {
    const observed = rows.find(
      (row) => row.path === policy[role].path.slice(3),
    );
    assert(observed);
    assert.equal(observed.size, policy[role].bytes);
    assert.equal(observed.sha256, policy[role].sha256);
  }
  assert.deepEqual(privatePolicy.tools.python, policy.python);
  assert.deepEqual(privatePolicy.driverNode, policy.node);
  assert.deepEqual(old.sourceGn.hostTools.node, policy.node);
  assert(privatePolicy.staticLoadingPolicy.images.includes(policy.image));
  assert.equal(privatePolicy.staticLoadingPolicy.systemImageIsTrustedTcb, true);
  assert.equal(
    privatePolicy.staticLoadingPolicy.actualLoaderClosureApproved,
    false,
  );
  assert.equal(privatePolicy.staticLoadingPolicy.system32ByteSetProven, false);
  assert.equal(policy.sourcePaths.length, 8);
  for (const image of [
    "20261030.294.1",
    "20261021.278.2",
    "20261021.278.1 ",
    "unknown",
  ])
    assert.throws(
      () =>
        inspectAuthority(
          policy,
          { ...environment(), ImageVersion: image },
          host,
        ),
      /PROOF_AUTHORITY/,
    );
  const originalRef = "refs/heads/codex/windows-arm-benign-job-proof-20261102";
  assert.throws(
    () =>
      inspectAuthority(
        policy,
        {
          ...environment(),
          GITHUB_REF: originalRef,
          GITHUB_WORKFLOW_REF: `${policy.repository}/${policy.workflow}@${originalRef}`,
        },
        host,
      ),
    /PROOF_AUTHORITY/,
  );
});

test("current-controller flavor restores complete3ae old controller diagnostics before all prior history inverses", () => {
  for (const [text, bytes, digest] of [
    [
      rawPolicy.toString(),
      2906,
      "8d1f62df467376c9ccd45dd08e271d1a857a0db730efeaac28de6f01c17e627c",
    ],
    [
      adapter,
      39951,
      "0f2fccfbf4ce8074fd5815cfaa5d7e8c65cd78d9dd40a2528a514e1bef20cd9c",
    ],
    [
      fixture,
      43128,
      "2c4fc66bfcc383ebf7e94883f28e8cea855e4983dbeb511330938dfc611d7c20",
    ],
    [
      workflowText,
      12491,
      "0fa77c91624fb8beefc8e9023921d79cbb194dcee0c0f58441c86d78a587f98c",
    ],
  ]) {
    const original = restorePriorControllerFlavor(text);
    assert.notEqual(original, text);
    assert.equal(Buffer.byteLength(original), bytes);
    assert.equal(hash(original), digest);
  }
});

test("current-controller flavor requires exact reviewed294 source tools TCB and rejects old image or branches", async () => {
  assert.equal(
    policy.ref,
    "refs/heads/codex/windows-arm-benign-current-controller-20261102",
  );
  assert.equal(policy.image, "20261030.294.1");
  assert.equal(
    hash(rawPolicy),
    "51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e",
  );
  const selectedRaw = await fs.readFile(
    path.join(DIR, "image-qualified-current-profile.json"),
  );
  assert.equal(selectedRaw.length, 34813);
  assert.equal(
    hash(selectedRaw),
    "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",
  );
  const selected = JSON.parse(selectedRaw);
  assert.equal(selected.image, policy.image);
  assert.equal(
    selected.sourceGn.sourceId,
    "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
  );
  const tableRaw = await fs.readFile(
    path.join(
      ROOT,
      selected.sourceGn.namespace,
      "tools/aarch64-pc-windows-msvc.json",
    ),
  );
  assert.equal(
    hash(tableRaw),
    "93dd8f76c361132134c1499320596bfbe06201cf8f3634c0f3bff7f48d3fc16f",
  );
  const lock = JSON.parse(
    await fs.readFile(
      path.join(ROOT, selected.sourceGn.namespace, "source-lock.json"),
    ),
  );
  assert.equal(lock.builds[0].toolchainLock.sha256, hash(tableRaw));
  const { releaseIdentity } = await import("../../scripts/cef-runtime-ci.mjs");
  assert.equal(
    releaseIdentity(lock, "aarch64-pc-windows-msvc").sourceLockSha256,
    selected.sourceGn.sourceId,
  );
  const privateRaw = await fs.readFile(
    path.join(DIR, "private-qualification-profile.json"),
  );
  assert.equal(
    hash(privateRaw),
    "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",
  );
  const privatePolicy = JSON.parse(privateRaw);
  assert.equal(
    privatePolicy.images[policy.image].profileSha256,
    hash(selectedRaw),
  );
  assert(privatePolicy.staticLoadingPolicy.images.includes(policy.image));
  assert.equal(privatePolicy.staticLoadingPolicy.systemImageIsTrustedTcb, true);
  assert.equal(
    privatePolicy.staticLoadingPolicy.actualLoaderClosureApproved,
    false,
  );
  assert.equal(privatePolicy.staticLoadingPolicy.system32ByteSetProven, false);
  assert.deepEqual(privatePolicy.tools.python, policy.python);
  assert.deepEqual(privatePolicy.driverNode, policy.node);
  assert.deepEqual(selected.sourceGn.hostTools.node, policy.node);
  for (const role of ["python", "node"]) {
    const row = JSON.parse(tableRaw).files.find(
      (value) => value.path === policy[role].path.slice(3),
    );
    assert(row);
    assert.equal(row.size, policy[role].bytes);
    assert.equal(row.sha256, policy[role].sha256);
  }
  assert.equal(policy.sourcePaths.length, 8);
  assert.doesNotThrow(() => inspectAuthority(policy, environment(), host));
  for (const image of [
    "20261021.278.1",
    "20261030.294.2",
    "20261030.294.1 ",
    "unknown",
  ])
    assert.throws(
      () =>
        inspectAuthority(
          policy,
          { ...environment(), ImageVersion: image },
          host,
        ),
      /PROOF_AUTHORITY/,
    );
  for (const ref of [
    "refs/heads/codex/windows-arm-benign-job-proof-20261021-20261102",
    "refs/heads/codex/windows-arm-benign-job-proof-20261102",
    "refs/heads/main",
  ])
    assert.throws(
      () =>
        inspectAuthority(
          policy,
          {
            ...environment(),
            GITHUB_REF: ref,
            GITHUB_WORKFLOW_REF: `${policy.repository}/${policy.workflow}@${ref}`,
          },
          host,
        ),
      /PROOF_AUTHORITY/,
    );
  for (const key of [
    "sourceMigrationAdmitted",
    "compilerAdmission",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(policy[key], false);
  assert(!proofJob.if.includes("||"));
  assert(!workflowText.includes("20261021.278.1"));
});

test("old-image workflow has only exact ref and image delta from immutable88258 current proof", () => {
  const detachedRef = "          ref: ${{ github.sha }}\n";
  assert.equal(workflowText.split(detachedRef).length, 2);
  const oldSelected = withoutCarrierFailureDiagnostics(workflowText).replace(
    detachedRef,
    "",
  );
  assert.equal(Buffer.byteLength(oldSelected), 9103);
  assert.equal(
    hash(oldSelected),
    "a0c3543b255803fb0779b1aaf830043a3a22fb6f5d9b5d7f1df72f90dfe765d0",
  );
  const previous = restoreCurrentImageSelection(oldSelected);
  assert.equal(Buffer.byteLength(previous), 9094);
  assert.equal(
    hash(previous),
    "a299e9bc4fba7248584091d34334eb9ca912452246ca5e20a8f912d769339350",
  );
  assert.equal(
    policy.workflow,
    ".github/workflows/windows-arm-qualification-job-proof.yml",
  );
  assert(!proofJob.if.includes("||"));
  assert(!workflowText.includes("20261021.278.1"));
});

test(
  "actual forty-one-byte HEAD guard rejects a symbolic branch and accepts exact detached checkout",
  { timeout: 20000 },
  async (t) => {
    const source = fixture.replaceAll("\r\n", "\n");
    const span = (begin, end) => {
      const first = "\n" + begin,
        last = "\n" + end;
      assert.equal(source.split(first).length, 2, begin);
      assert.equal(source.split(last).length, 2, end);
      const a = source.indexOf(first) + 1,
        b = source.indexOf(last, a) + 1;
      assert(b > a);
      return source.slice(a, b);
    };
    const guard = span(
      "  const gitHead = (\n",
      "  const sources = await sourceWitness(p, head, end);\n",
    );
    assert.match(guard, /path\.join\(ROOT, "\.git\/HEAD"\), 41/);
    assert.match(guard, /gitHead === head \+ "\\n"/);
    const io =
      span(
        "const need = (condition, code) => {",
        "function exact(value, fields) {",
      ) +
      span(
        "async function physical(file) {",
        "async function policy(end = Infinity) {",
      ) +
      span(
        "function checkEnd(end) {",
        "async function writeExclusive(file, raw, end) {",
      );
    const temp = await fs.realpath(os.tmpdir());
    const owned = await fs.realpath(
      await fs.mkdtemp(path.join(temp, "benign-proof-head-")),
    );
    t.after(async () => {
      assert.equal(path.dirname(owned), temp);
      assert.match(path.basename(owned), /^benign-proof-head-/);
      assert.equal(await fs.realpath(owned), owned);
      await fs.rm(owned, { recursive: true });
    });
    const hooks = path.join(owned, "empty-hooks"),
      config = path.join(owned, "empty-config");
    await fs.mkdir(hooks);
    await fs.writeFile(config, "", { flag: "wx" });
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=" + hooks,
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Portable fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-C",
          owned,
          ...args,
        ],
        {
          env,
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 128 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
        .toString()
        .trim();
    git("init", "--initial-branch=proof");
    git("commit", "--allow-empty", "--no-gpg-sign", "-m", "owned fixture");
    const actualHead = git("rev-parse", "HEAD");
    const end = performance.now() + 10000;
    const actualCheck = vm.runInNewContext(
      io + "\nasync function actualCheck(){" + guard + "}\nactualCheck",
      {
        fs,
        syncFs,
        path,
        createHash,
        Buffer,
        performance,
        setTimeout,
        clearTimeout,
        ROOT: owned,
        head: actualHead,
        end,
      },
    );
    const symbolic = await fs.readFile(path.join(owned, ".git/HEAD"), "ascii");
    assert.equal(symbolic, "ref: refs/heads/proof\n");
    await assert.rejects(actualCheck(), /PROOF_HEAD/);
    git("checkout", "--detach", actualHead);
    const detached = await fs.readFile(path.join(owned, ".git/HEAD"));
    assert.equal(detached.length, 41);
    assert.equal(detached.toString("ascii"), actualHead + "\n");
    await actualCheck();
    assert.equal(checkoutRef(), "${{ github.sha }}");
    function checkoutRef() {
      return proofJob.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      ).with.ref;
    }
  },
);
