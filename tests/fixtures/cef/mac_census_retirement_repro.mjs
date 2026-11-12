// Proof-only process/clock model. No native Mac qualification or CEF admission.
// Executes the exact production client/compile bodies; only OS ownership and
// elapsed time are controlled. A real creation-owned Node census stand-in keeps
// real stdio handles open so process liveness is observed outside this process.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable, Transform } from "node:stream";
import { finished } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { types as utilTypes } from "node:util";
import path from "node:path";
import ts from "typescript";
import {
  BEFORE_CENSUS_CORE,
  CURRENT_CENSUS_CORE,
  withCensusRetirementCore,
  withoutCensusRetirementCore,
} from "../../tooling/helpers/cefCensusRetirementReviewedHistory.mjs";
import {
  canonical,
  sisoLoggerIdentity,
  compileMonitorDetails,
  compileMonitorRecord,
  nativeCensusRows,
  censusFailureCode,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

const root = new URL("../../../", import.meta.url);
const actualCore = (
  await readFile(
    new URL("scripts/lib/cef-engineering-checkpoint.mjs", root),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const actualHash = createHash("sha256").update(actualCore).digest("hex");
assert(
  [BEFORE_CENSUS_CORE.sha256, CURRENT_CENSUS_CORE.sha256].includes(actualHash),
);
const oldCore =
  actualHash === BEFORE_CENSUS_CORE.sha256
    ? actualCore
    : withoutCensusRetirementCore(actualCore);
const newCore = withCensusRetirementCore(oldCore);
const mode = process.argv[2] ?? "old";
assert(["old", "new", "controls"].includes(mode));
const core = mode === "old" ? oldCore : newCore;
const testUrl = new URL(
  "tests/tooling/cefEngineeringCheckpoint.node-test.mjs",
  root,
);
const tests = (await readFile(testUrl, "utf8")).replaceAll("\r\n", "\n");
const declaration = (text, name) => {
  const ast = ts.createSourceFile(
    "proof.mjs",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  assert(node, name);
  return node.getText(ast).replace(/^export /, "");
};
let now = 0;
const timers = new Set();
const clock = {
  now: () => now,
  setTimeout(callback, milliseconds, ...args) {
    if (milliseconds === 250) return { real: setTimeout(callback, 1, ...args) };
    const timer = {
      due: now + milliseconds,
      callback: () => callback(...args),
    };
    timers.add(timer);
    return timer;
  },
  clearTimeout(timer) {
    if (timer?.real) clearTimeout(timer.real);
    else timers.delete(timer);
  },
  advance(milliseconds) {
    now += milliseconds;
    for (const timer of [...timers])
      if (timer.due <= now) {
        timers.delete(timer);
        timer.callback();
      }
  },
};
if (mode === "controls") {
  const ast = ts.createSourceFile(
    "core.mjs",
    core,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const open = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "openCensusSession",
  );
  let closeBody;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "session")
      closeBody = node.initializer.properties
        .find((p) => p.name?.getText(ast) === "close")
        .getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(open);
  assert(closeBody);
  const wrapper = (client) => {
    const identity = { dev: 1, ino: 2, mode: 3, uid: 4 };
    const binding = {
      active: true,
      worker: {},
      joinedSessions: 0,
      rootIdentity: identity,
      scratch: "/owned",
    };
    const removed = [];
    const dependencies = {
      assert,
      client,
      binding,
      deadline: 100000,
      performance: clock,
      censusOwnedRoot: async () => identity,
      sessionRoot: "/owned/session",
      sessionIdentity: identity,
      path,
      unlink: async (p) => removed.push(p),
      rmdir: async (p) => removed.push(p),
      deny: (e) => e,
    };
    const close = new Function(
      ...Object.keys(dependencies),
      `let closed=false,closingPromise; return ({${closeBody}}).close;`,
    )(...Object.values(dependencies));
    return { close, binding, removed };
  };
  let calls = 0,
    finish;
  const deadlines = [];
  const memo = wrapper({
    close: ({ deadline }) => {
      calls++;
      deadlines.push(deadline);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const p1 = memo.close(30000),
    p2 = memo.close(90000);
  assert.strictEqual(p1, p2);
  finish({ joined: true, failed: false });
  await p1;
  assert.strictEqual(memo.close(99999), p1);
  assert.equal(calls, 1);
  assert.deepEqual(deadlines, [30000]);
  assert.equal(memo.binding.joinedSessions, 1);
  assert.equal(memo.binding.active, false);
  assert.equal(memo.binding.worker, null);
  assert.equal(memo.removed.length, 2);

  let model = declaration(tests, "compileSupervisorModel");
  const modelAst = ts.createSourceFile(
    "model.mjs",
    model,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const statement = modelAst.statements[0].body.statements[0].getText(modelAst);
  model = model
    .replace(statement, "const source=proofCoreSource;")
    .replaceAll("import.meta.url", "modelSourceURL");
  const scope = {
    assert,
    readFile,
    ts,
    EventEmitter,
    PassThrough,
    Writable,
    Transform,
    finished,
    createWriteStream,
    utilTypes,
    path,
    sisoLoggerIdentity,
    compileMonitorDetails,
    compileMonitorRecord,
    canonical,
    modelSourceURL: testUrl.href,
    proofCoreSource: core,
  };
  const run = new Function(...Object.keys(scope), "return (" + model + ")")(
    ...Object.values(scope),
  );
  const outcomes = [];
  for (const primary of [new Error("fixed startup failure"), false]) {
    let count = 0;
    const owned = wrapper({
      close: async () => {
        count++;
        return { joined: true, failed: false };
      },
    });
    const state = await run({
      modelClock: clock,
      spawnFailure: true,
      error: primary,
      censusSession: {
        close: owned.close,
        diagnostics: () => ({ joined: true }),
      },
    });
    assert.strictEqual(state.error, primary);
    assert.equal(state.proofs, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(count, 1);
    assert.equal(owned.binding.active, false);
    outcomes.push({
      startupPrimary: primary === false ? "false" : "Error",
      actualClientCloseCalls: count,
      noProof: true,
    });
  }
  let cleanCloses = 0;
  const clean = wrapper({
    close: async () => {
      cleanCloses++;
      return { joined: true, failed: false };
    },
  });
  const cleanState = await run({
    modelClock: clock,
    cleanExit: true,
    censusSession: {
      close: clean.close,
      diagnostics: () => ({ joined: true }),
    },
  });
  assert.equal(cleanState.failed, undefined);
  assert.equal(cleanState.result.outcome, "compiler-complete");
  assert.equal(
    cleanCloses,
    1,
    "probe close and final close share the real wrapper promise",
  );
  assert.equal(clean.binding.joinedSessions, 1);
  assert.equal(clean.binding.active, false);
  // Strict current inverse must reject deleting the entire fix to exact9b,
  // unlike the separately named historical9b input adapter.
  assert.throws(() => withoutCensusRetirementCore(oldCore));
  for (const changed of [
    newCore + "\n",
    newCore.replace(
      "await censusSession.close(cleanupDeadline);",
      "await censusSession.close(performance.now()+30000);",
    ),
    newCore.replace(
      'fail(error, "census-close");',
      'fail(false, "census-close");',
    ),
  ])
    assert.throws(() => withoutCensusRetirementCore(changed));
  console.log(
    JSON.stringify({
      stage: "WRAPPER_CONTROLS",
      memoizedUnderlyingCloseCalls: calls,
      memoizedOriginalDeadline: deadlines[0],
      cleanUnderlyingCloseCalls: cleanCloses,
      startup: outcomes,
      strictEntireFixDeletionDenied: true,
      nativeMacQualification: false,
    }),
  );
  process.exit(0);
}
const workerProgram = `
const readline = require('node:readline');
const input = readline.createInterface({input:process.stdin});
process.stdout.write(JSON.stringify({kind:'mac-census-proof-ready',abi:{},oracleSha256:'a'.repeat(64),productionAdmitted:false})+'\\n');
input.on('line',line=>{const request=JSON.parse(line).request;
 if(request===1)process.stdout.write(JSON.stringify({request,rows:[{pid:100,parent:200,group:100,start:'darwin-v1:1794500000:1'}],collectMicros:1})+'\\n');
 else process.send({ignoredRequest:request});
});
input.on('close',()=>process.exit(0));
`;
const worker = spawn(process.execPath, ["-e", workerProgram], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe", "ipc"],
});
const shape = (value, fields) =>
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
const dependencies = {
  assert,
  Buffer,
  performance: clock,
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
  COMPILE_CLEANUP_MS: 30000,
  nativeCensusRows,
  censusFailureCode,
  canonical,
  positive: (n) => Number.isSafeInteger(n) && n > 0,
  shape,
  MAC_CENSUS_ABI: {},
};
const within = new Function(
  ...Object.keys(dependencies),
  "return (" + declaration(core, "compileWithin") + ")",
)(...Object.values(dependencies));
const client = new Function(
  ...Object.keys(dependencies),
  "compileWithin",
  "return (" + declaration(core, "macCensusClient") + ")",
)(...Object.values(dependencies), within)(worker, {
  deadline: 150001,
  readyMilliseconds: 45000,
});
worker.once("message", ({ ignoredRequest }) => {
  assert.equal(ignoredRequest, 2);
  worker.disconnect(); // Extra fixture-control channel must not hold Node alive.
  clock.advance(2000); // Actual fixed client request timer expires, not work timer.
});
await client.ready;
let closeCalls = 0,
  primary;
const closeDeadlines = [];
const session = {
  diagnostics: () => Object.freeze(client.diagnostics()),
  close: (deadline) => {
    closeCalls++;
    closeDeadlines.push(deadline);
    return client.close({ deadline });
  },
};
let model = declaration(tests, "compileSupervisorModel");
// This is an explicitly selected, whole-pinned historical/current model body;
// it never redirects an actual worker or changes the production read function.
const modelAst = ts.createSourceFile(
  "model.mjs",
  model,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const sourceStatement =
  modelAst.statements[0].body.statements[0].getText(modelAst);
assert(sourceStatement.startsWith("const source = await readFile("));
assert.equal(model.split(sourceStatement).length, 2);
model = model.replace(sourceStatement, "const source = proofCoreSource;");
const replacements = [
  ["COMPILE_CLEANUP_MS: 80,", "COMPILE_CLEANUP_MS: 30000,"],
  [
    "LIMITS: { compileMs: 20, maxCompileMs: 1000 },",
    "LIMITS: { compileMs: 20, maxCompileMs: 120000 },",
  ],
  ["deadline: clock.now() + 200", "deadline: clock.now() + 150001"],
  ["    milliseconds: 20,", "    milliseconds: 120000,"],
  [
    "      state.snapshots++;",
    "      state.snapshots++;\n      if (options.snapshot) return options.snapshot();",
  ],
];
for (const [before, after] of replacements) {
  assert.equal(model.split(before).length, 2, before);
  model = model.replace(before, () => after);
}
model = model.replaceAll("import.meta.url", "modelSourceURL");
const scope = {
  assert,
  readFile,
  ts,
  EventEmitter,
  PassThrough,
  Writable,
  Transform,
  finished,
  createWriteStream,
  utilTypes,
  path,
  sisoLoggerIdentity,
  compileMonitorDetails,
  compileMonitorRecord,
  canonical,
  modelSourceURL: testUrl.href,
  proofCoreSource: core,
};
const run = new Function(...Object.keys(scope), "return (" + model + ")")(
  ...Object.values(scope),
);
const state = await run({
  modelClock: clock,
  holdPipes: true,
  stopError: true,
  error: new Error("secondary reap failure must not replace census deadline"),
  censusSession: session,
  async snapshot() {
    try {
      return (await client.snapshot()).rows;
    } catch (error) {
      primary = error;
      compileMonitorRecord(error, "CENSUS_DEADLINE");
      // The root-exit pipe wait consumes the ORIGINAL full30s cleanup lease.
      setImmediate(() => clock.advance(30001));
      throw error;
    }
  },
});
const diagnostic = JSON.parse(
  state.diagnostic.split("compile-supervision=")[1],
);
assert.equal(state.error, primary);
assert.equal(primary.message, "CENSUS_DEADLINE");
assert.equal(closeCalls, mode === "old" ? 0 : 1);
assert.equal(state.proofs, 0);
assert.equal(state.writes.length, 0);
assert.equal(diagnostic.firstFailure.errorCode, "CENSUS_DEADLINE");
assert.equal(diagnostic.ownTimerExpired, false);
assert.equal(diagnostic.probesJoined, false);
assert.equal(diagnostic.cohortQuiet, false);
assert.equal(diagnostic.pipeClosed, false);
assert.equal(diagnostic.cleanupElapsedMs, 30001);
if (mode === "old") {
  assert.equal(worker.exitCode, null);
  assert.equal(worker.signalCode, null);
  assert(
    !worker.stdin.destroyed &&
      !worker.stdout.destroyed &&
      !worker.stderr.destroyed,
  );
} else {
  assert.deepEqual(closeDeadlines, [32000]);
  assert(now > closeDeadlines[0]);
  assert(worker.killed);
  assert(
    worker.stdin.destroyed &&
      worker.stdout.destroyed &&
      worker.stderr.destroyed,
  );
}
console.log(
  JSON.stringify({
    stage: "MODEL_DONE",
    mode,
    originalCorePinned: true,
    productionAdmitted: false,
    cleanupMs: 30000,
    virtualNow: now,
    closeCalls,
    closeDeadlines,
    workerRetirementRequested: worker.killed,
    stdioOpen:
      !worker.stdin.destroyed ||
      !worker.stdout.destroyed ||
      !worker.stderr.destroyed,
    diagnostic,
  }),
);
// This creation-owned TEST teardown is deliberately late and unref'ed. It does
// not keep Node alive; the leaked worker/stdio does. The outer observer measures
// that interval and this fixed teardown prevents leaving a proof process behind.
setTimeout(() => {
  console.log(JSON.stringify({ stage: "TEST_TEARDOWN", closeCalls }));
  worker.kill("SIGKILL");
  worker.stdin.destroy();
  worker.stdout.destroy();
  worker.stderr.destroy();
  worker.unref();
}, 1500).unref();
