// Private diagnostic DATA only. No factory/session tokens, CEF, SDK or admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { runInNewContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "287b79a33c3299d5cf53b3623acee7e2f39e88aa";
const BRANCH = "codex/diagnose-mac-census-deadline-20261113";
const WORKFLOW = ".github/workflows/cef-mac-process-census-proof.yml";
const SELF = "tests/fixtures/cef/mac_census_deadline_diagnostic.mjs";
const SOURCE_PINS = [
  [
    "scripts/lib/cef-engineering-checkpoint.mjs",
    250406,
    "12f7ac17a1668387b63fa5dca687415032444420387295effb9ba9c19ba54f36",
  ],
  [
    "scripts/lib/cef-mac-process-census.py",
    24586,
    "ec206948e6efe38d0c854d655ef95454262e01b5d28d05f4169587d1b511ff52",
  ],
  [
    "scripts/lib/cef-mac-source-metadata.mjs",
    52286,
    "8b6fb0fc8f98eb6f5f7baf9cc66ec92ac86eb4bc3531865466fe628f65a76617",
  ],
];
const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const SOURCE =
  "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const git = (...args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4 * 1024 ** 2,
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--self-test"),
  "DIAG_ARGUMENTS",
);
const selfTest = args.length === 1;
let production,
  coreText,
  clientText,
  compileText,
  assertText,
  cleanupText,
  pinText,
  spawnText;
const closedCode = new Set([
  "CENSUS_DEADLINE",
  "CENSUS_READY_DEADLINE",
  "CENSUS_EOF",
  "CENSUS_ABORT",
  "CENSUS_REQUEST",
  "CENSUS_REQUEST_BOUND",
  "CENSUS_OUTPUT_BOUND",
  "CENSUS_STDERR_BOUND",
  "CENSUS_ROWS_BOUND",
  "CENSUS_ROWS_IDENTITY",
  "CENSUS_SYSCTL",
  "CENSUS_JOIN",
  "Invalid checkpoint object shape",
]);
function errorCode(error) {
  try {
    if (error === false || error === null || error === undefined)
      return "FALSY_PRIMARY";
    const d = Object.getOwnPropertyDescriptor(error, "message");
    return typeof d?.value === "string" && closedCode.has(d.value)
      ? d.value
      : "OTHER_CLOSED_FAILURE";
  } catch {
    return "HOSTILE_FAILURE";
  }
}
function extract(text, name) {
  const matches = [
    ...text.matchAll(
      new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "gm"),
    ),
  ];
  assert.equal(matches.length, 1, "FUNCTION_BOUNDARY");
  const start = matches[0].index,
    end = text.indexOf("\n}\n", start);
  assert(end > start);
  return text.slice(start, end + 2).replace(/^export /, "");
}
async function loadSource() {
  for (const [file, bytes, hash] of SOURCE_PINS) {
    const b = git("show", BASE + ":" + file);
    assert.equal(b.length, bytes);
    assert.equal(sha(b), hash);
    assert(
      (await fs.readFile(path.join(ROOT, file))).equals(b),
      "PHYSICAL_SOURCE_PIN",
    );
  }
  coreText = (await fs.readFile(path.join(ROOT, SOURCE_PINS[0][0]))).toString();
  production = await import(pathToFileURL(path.join(ROOT, SOURCE_PINS[0][0])));
  for (const name of [
    "shape",
    "canonical",
    "nativeCensusRows",
    "censusFailureCode",
  ])
    assert.equal(
      production[name].toString(),
      extract(coreText, name),
      "ACTUAL_VALIDATOR_BODY",
    );
  clientText = extract(coreText, "macCensusClient");
  assert.equal(Buffer.byteLength(clientText), 6413);
  assert.equal(
    sha(clientText),
    "665a55f93bcee4f0b275f8e98796f42c3978961412bc2b507a2d9597626661bb",
  );
  compileText = extract(coreText, "compileWithin");
  pinText = extract(coreText, "censusPythonPin");
  const a = coreText.indexOf("const assert = (ok, message) => {");
  assert(a >= 0);
  assertText = coreText.slice(a, coreText.indexOf("\n};", a) + 3);
  assert(assertText.endsWith("\n};"));
  const cleanup = [
    ...coreText.matchAll(/^const COMPILE_CLEANUP_MS = 30000;$/gm),
  ];
  assert.equal(cleanup.length, 1);
  cleanupText = cleanup[0][0];
  const sessionStart = coreText.indexOf("async function openCensusSession("),
    spawnStart = coreText.indexOf(
      '    const env = {\n      PATH: "/usr/bin:/bin",',
      sessionStart,
    ),
    spawnEnd = coreText.indexOf(
      "    const client = macCensusClient(child, {",
      spawnStart,
    );
  assert(spawnStart > sessionStart && spawnEnd > spawnStart);
  spawnText = coreText.slice(spawnStart, spawnEnd).trim();
  assert.equal(
    spawnText.split("import.meta.url").length,
    2,
    "SPAWN_MODULE_BOUNDARY",
  );
  return {
    base: BASE,
    sourcePins: SOURCE_PINS.map(([path, bytes, sha256]) => ({
      path,
      bytes,
      sha256,
    })),
    client: { bytes: 6413, sha256: sha(clientText) },
    actualSpawnSnippet: {
      bytes: Buffer.byteLength(spawnText),
      sha256: sha(spawnText),
      moduleUrlBindingOnly: true,
    },
    dependencies: Object.fromEntries(
      [
        "shape",
        "canonical",
        "nativeCensusRows",
        "censusFailureCode",
        "compileWithin",
        "censusPythonPin",
      ].map((n) => [n, sha(extract(coreText, n))]),
    ),
  };
}
// Metadata-only insertions; the original assertions, deadlines, parser, limits,
// first-error state and cleanup operations remain literally present.
const edits = [
  [
    "  const deny = (error) => {",
    '  const deny = (error) => {\n    diagNote("deny", performance.now(), error);',
  ],
  [
    "  const frame = (line) => {\n    try {",
    '  const frame = (line) => {\n    diagNote("frame-start", performance.now(), line.length);\n    try {',
  ],
  [
    "      const rows = nativeCensusRows(value, pending.id);",
    '      const rows = nativeCensusRows(value, pending.id);\n      diagNote("rows-valid", performance.now(), pending.id, value.collectMicros, pending.end);',
  ],
  [
    "    } catch (error) {\n      deny(error);\n    }\n  };",
    '    } catch (error) {\n      diagNote("frame-error", performance.now(), error);\n      deny(error);\n    }\n  };',
  ],
  [
    '  child.stdout.on("data", (chunk) => {\n    if (failed) return;',
    '  child.stdout.on("data", (chunk) => {\n    diagNote("chunk", performance.now(), chunk.length, buffer.length, failed ? 1 : 0);\n    if (failed) { diagLate(chunk, performance.now()); return; }',
  ],
  [
    '  child.stdin.on("error", (error) => deny(error));',
    '  child.stdin.on("error", (error) => { diagNote("write-error", performance.now()); deny(error); });',
  ],
  [
    "    if (stderrBytes <= 4096) stderrChunks.push(chunk);",
    '    if (stderrBytes <= 4096) stderrChunks.push(chunk);\n    diagNote("helper-code", performance.now(), censusFailureCode(Buffer.concat(stderrChunks).toString("utf8")));',
  ],
  [
    '  child.once("close", (code, signal) => {',
    '  child.once("close", (code, signal) => {\n    diagNote("child-close", performance.now(), code);',
  ],
  [
    "        const id = ++request;",
    '        const id = ++request;\n        diagNote("request", begin, id, end);',
  ],
  [
    '            () => deny(new Error("CENSUS_DEADLINE")),',
    '            () => { diagNote("timer", performance.now()); return deny(new Error("CENSUS_DEADLINE")); },',
  ],
  [
    '          child.stdin.write(JSON.stringify({ request: id }) + "\\n", (error) => {',
    '          child.stdin.write(JSON.stringify({ request: id }) + "\\n", (error) => {\n            diagNote("write-callback", performance.now(), id, error ? 1 : 0);',
  ],
  [
    "        clearTimeout(timer);",
    '        diagNote("close-finally", performance.now(), joined ? 1 : 0);\n        clearTimeout(timer);',
  ],
];
function instrument(text) {
  let result = text;
  for (const [a, b] of edits) {
    assert.equal(result.split(a).length, 2, "DIAG_ANCHOR");
    result = result.replace(a, b);
  }
  let inverse = result;
  for (const [a, b] of [...edits].reverse()) {
    assert.equal(inverse.split(b).length, 2);
    inverse = inverse.replace(b, a);
  }
  assert.equal(inverse, text);
  return result;
}
function witness(injectFault = false) {
  const state = {
    first: null,
    currentOrigin: "none",
    request: 0,
    requestAt: 0,
    end: 0,
    writeCallbackAt: null,
    lastFrame: null,
    rowsValid: false,
    helperCode: "CENSUS_UNAVAILABLE",
    lateFrames: 0,
    lateBytes: 0,
    lateTruncated: false,
    lateLast: null,
    observerFaults: 0,
    events: [],
  };
  let late = Buffer.alloc(0);
  const number = (n) =>
    Number.isFinite(n)
      ? Math.max(-1, Math.min(1e12, Math.floor(n * 1000) / 1000))
      : -1;
  const event = (kind, now, ...values) => {
    state.events.push({ kind, atMs: number(now), values: values.map(number) });
    if (state.events.length > 32) state.events.shift();
  };
  const note = (kind, now, a, b, c) => {
    try {
      if (injectFault) throw Error("EXPECTED_OBSERVER_FAULT");
      if (kind === "request") {
        state.request = a;
        state.requestAt = now;
        state.end = b;
        state.rowsValid = false;
        state.currentOrigin = "write";
        state.writeCallbackAt = null;
      }
      if (kind === "write-callback") {
        state.writeCallbackAt = now;
        if (b) state.currentOrigin = "write-error";
      }
      if (kind === "write-error") state.currentOrigin = "write-error";
      if (kind === "frame-start") {
        state.rowsValid = false;
        state.currentOrigin = "frame-parse";
        state.lastFrame = { bytes: a, atMs: number(now) };
      }
      if (kind === "rows-valid") {
        state.rowsValid = true;
        state.lastFrame = {
          ...state.lastFrame,
          request: a,
          collectMicros: b,
          endMs: number(c),
        };
        state.currentOrigin = "frame-validated";
      }
      if (kind === "frame-error")
        state.currentOrigin =
          state.rowsValid && errorCode(a) === "CENSUS_DEADLINE"
            ? "frame-deadline"
            : "frame-validation";
      if (kind === "helper-code")
        state.helperCode =
          typeof a === "string" && /^CENSUS_[A-Z_]+$/.test(a)
            ? a
            : "CENSUS_UNAVAILABLE";
      if (kind === "child-close")
        state.currentOrigin =
          state.helperCode !== "CENSUS_UNAVAILABLE"
            ? "helper-failure"
            : "child-close";
      if (kind === "timer") state.currentOrigin = "timer";
      if (kind === "deny" && !state.first)
        state.first = {
          origin: state.currentOrigin,
          code: errorCode(a),
          request: state.request,
          atMs: number(now),
          requestAtMs: number(state.requestAt),
          endMs: number(state.end),
          timerDriftMs:
            state.currentOrigin === "timer" ? number(now - state.end) : null,
          writeCallbackAtMs:
            state.writeCallbackAt === null
              ? null
              : number(state.writeCallbackAt),
          lastFrame: state.lastFrame,
        };
      event(
        kind,
        now,
        typeof a === "number" ? a : 0,
        typeof b === "number" ? b : 0,
        typeof c === "number" ? c : 0,
      );
    } catch {
      state.observerFaults++;
    }
  };
  const observeLate = (chunk, now) => {
    try {
      state.lateBytes += chunk.length;
      if (state.lateTruncated) return;
      if (late.length + chunk.length > 65536) {
        state.lateTruncated = true;
        late = Buffer.alloc(0);
        return;
      }
      late = Buffer.concat([late, chunk]);
      for (;;) {
        const n = late.indexOf(10);
        if (n < 0) break;
        const line = late.subarray(0, n);
        late = late.subarray(n + 1);
        try {
          const v = JSON.parse(line.toString());
          if (
            Number.isSafeInteger(v.request) &&
            v.request > 0 &&
            Number.isSafeInteger(v.collectMicros) &&
            v.collectMicros >= 0 &&
            v.collectMicros < 30000000 &&
            Array.isArray(v.rows) &&
            v.rows.length <= 32768
          ) {
            state.lateFrames++;
            state.lateLast = {
              request: v.request,
              collectMicros: v.collectMicros,
              rowCount: v.rows.length,
              atMs: number(now),
            };
          }
        } catch {}
      }
    } catch {
      state.observerFaults++;
    }
  };
  return { note, late: observeLate, result: () => structuredClone(state) };
}
function environment(clock, w) {
  return {
    Buffer,
    JSON,
    Object,
    Array,
    Number,
    Set,
    Map,
    Promise,
    Error,
    performance: clock.performance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    shape: production.shape,
    canonical: production.canonical,
    nativeCensusRows: production.nativeCensusRows,
    censusFailureCode: production.censusFailureCode,
    MAC_CENSUS_ABI: production.MAC_CENSUS_ABI,
    diagNote: w.note,
    diagLate: w.late,
    noLinks: production.noLinks,
    lstat: fs.lstat,
    open: fs.open,
    fsConstants,
    sha: production.sha,
  };
}
function makeClient(child, options, comparison, clock, w) {
  const src =
    assertText +
    "\n" +
    cleanupText +
    "\n" +
    compileText +
    "\n(" +
    (comparison ? instrument(clientText) : clientText) +
    ")";
  const fn = runInNewContext(src, environment(clock, w), {
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  return fn(child, options);
}
function fakeClock() {
  let now = 0,
    id = 0;
  const timers = new Map();
  return {
    performance: { now: () => now },
    setTimeout: (fn, ms) => {
      const key = ++id;
      timers.set(key, { fn, at: now + ms });
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
    advance: (to, fire = true) => {
      now = to;
      if (fire)
        for (const [k, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at <= to && timers.delete(k)) t.fn();
        }
    },
    count: () => timers.size,
  };
}
function fakeChild() {
  const c = new EventEmitter();
  c.pid = 123;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = new EventEmitter();
  c.kills = 0;
  c.unrefs = 0;
  c.stdin.write = (_b, cb) => cb?.();
  c.stdin.end = () => c.emit("close", 0, null);
  c.kill = () => {
    c.kills++;
    c.emit("close", null, "SIGKILL");
  };
  c.unref = () => c.unrefs++;
  for (const s of [c.stdout, c.stderr, c.stdin])
    s.destroy = () => {
      s.destroyed = true;
    };
  return c;
}
const contextSha = "a".repeat(64),
  sample = {
    request: 1,
    rows: [{ pid: 42, parent: 1, group: 42, start: "darwin-v1:1:0" }],
    collectMicros: 10,
  };
const emit = (child, value) =>
  child.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
function nativeSpawn(
  sessionRoot,
  spawnFunction = spawn,
  parentEnvironment = process.env,
) {
  const bound = spawnText.replace("import.meta.url", "productionModuleUrl");
  assert.equal(
    bound.replace("productionModuleUrl", "import.meta.url"),
    spawnText,
  );
  return runInNewContext(
    "(function(){" + bound + "\nreturn child;})()",
    {
      spawn: spawnFunction,
      binding: { python: PYTHON },
      sessionRoot,
      process: { env: parentEnvironment },
      fileURLToPath,
      URL,
      productionModuleUrl: pathToFileURL(path.join(ROOT, SOURCE_PINS[0][0]))
        .href,
    },
    { timeout: 1000 },
  );
}
function spawnContract() {
  let captured;
  const marker = {};
  const session = "/fixed-owned-model-session";
  const runner = "/fixed-owned-model-temp";
  const result = nativeSpawn(
    session,
    (bin, argv, options) => {
      captured = { bin, argv, options };
      return marker;
    },
    {
      RUNNER_TEMP: runner,
      RUNNER_TRACKING_ID: "fixed-model-tracking",
      GH_TOKEN: "must-not-inherit",
      GITHUB_TOKEN: "must-not-inherit",
    },
  );
  assert.equal(result, marker);
  assert.equal(captured.bin, PYTHON);
  assert.deepEqual(Array.from(captured.argv), [
    "-I",
    "-B",
    "-S",
    path.join(ROOT, SOURCE_PINS[1][0]),
    "--census-worker",
    session,
  ]);
  const env = Object.fromEntries(Object.entries(captured.options.env));
  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin",
    HOME: session,
    TMPDIR: session,
    RUNNER_TEMP: runner,
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    RUNNER_ENVIRONMENT: "github-hosted",
    LC_ALL: "C",
    TZ: "UTC",
    RUNNER_TRACKING_ID: "fixed-model-tracking",
  });
  assert.equal(captured.options.cwd, session);
  assert.equal(captured.options.shell, false);
  assert.deepEqual(Array.from(captured.options.stdio), [
    "pipe",
    "pipe",
    "pipe",
  ]);
  return {
    actualProductionSnippetSha256: sha(spawnText),
    argvFlagsAndClosedEnvironmentPassed: true,
    noInheritedCredentials: true,
    modelOnlyNotNativeQualification: true,
  };
}
async function controls() {
  const results = [];
  for (const comparison of [false, true])
    for (const name of [
      "positive",
      "timer-late",
      "frame-deadline",
      "helper-failure",
      "output-bound",
      "stderr-bound",
      "falsy-observer",
    ]) {
      const clock = fakeClock(),
        child = fakeChild(),
        w = witness(name === "falsy-observer");
      const client = makeClient(
        child,
        {
          deadline: 60000,
          requestBudget: 32,
          readyMilliseconds: 2000,
          contextSha256: contextSha,
          productionAdmitted: false,
        },
        comparison,
        clock,
        w,
      );
      emit(child, {
        kind: "mac-census-native-ready",
        abi: production.MAC_CENSUS_ABI,
        contextSha256: contextSha,
        productionAdmitted: false,
      });
      await client.ready;
      const pending = client.snapshot();
      pending.catch(() => {});
      await tick();
      let first;
      if (name === "positive") emit(child, sample);
      if (name === "timer-late") {
        clock.advance(2000);
        await tick();
        emit(child, sample);
      }
      if (name === "frame-deadline") {
        clock.advance(2001, false);
        emit(child, sample);
      }
      if (name === "helper-failure") {
        child.stderr.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              kind: "mac-census-native-failure",
              code: "CENSUS_SYSCTL",
              mode: "integration-proof",
              productionAdmitted: false,
            }),
          ),
        );
        child.emit("close", 1, null);
      }
      if (name === "output-bound")
        child.stdout.emit("data", Buffer.alloc(4 * 1024 ** 2 + 1));
      if (name === "stderr-bound")
        child.stderr.emit("data", Buffer.alloc(4097));
      if (name === "falsy-observer") client.abort(false);
      if (name === "positive") {
        const result = await pending;
        assert.equal(result.rows.length, 1);
      } else {
        try {
          await pending;
          assert.fail("EXPECTED_DENIAL");
        } catch (e) {
          first = e;
        }
        let again;
        try {
          await client.snapshot();
        } catch (e) {
          again = e;
        }
        assert.equal(again, first, "STICKY_PRIMARY");
        if (name === "falsy-observer") assert.equal(first, false);
      }
      const closed = await client.close({ deadline: 30000 });
      assert.equal(closed.joined, true);
      const observed = w.result();
      if (comparison && name === "timer-late") {
        assert.equal(observed.first.origin, "timer");
        assert.equal(observed.lateFrames, 1);
      }
      if (comparison && name === "frame-deadline")
        assert.equal(observed.first.origin, "frame-deadline");
      if (comparison && name === "helper-failure") {
        assert.equal(observed.first.origin, "helper-failure");
        assert.equal(observed.helperCode, "CENSUS_SYSCTL");
      }
      if (comparison && name === "falsy-observer")
        assert(observed.observerFaults > 0);
      if (name === "output-bound")
        assert.equal(errorCode(first), "CENSUS_OUTPUT_BOUND");
      if (name === "stderr-bound")
        assert.equal(errorCode(first), "CENSUS_STDERR_BOUND");
      results.push({
        comparison,
        name,
        passed: true,
        firstCode: first === undefined ? null : errorCode(first),
        witness: comparison ? observed : undefined,
      });
    }
  return results;
}
const realClock = { performance, setTimeout, clearTimeout };
async function owned(dir) {
  const s = await fs.lstat(dir, { bigint: true });
  assert(
    s.isDirectory() &&
      !s.isSymbolicLink() &&
      s.uid === BigInt(process.getuid()) &&
      (s.mode & 0o777n) === 0o700n,
    "DIAG_OWNED_ROOT",
  );
  return [s.dev, s.ino, s.uid, s.mode].join(":");
}
async function removeOwned(dir, stamp) {
  assert.equal(await owned(dir), stamp);
  const names = await fs.readdir(dir);
  assert.deepEqual(names, ["context.json"]);
  await fs.unlink(path.join(dir, "context.json"));
  await fs.rmdir(dir);
}
async function nativePhase(config, overall) {
  const workEnd = Math.min(overall - 30000, performance.now() + config.workMs);
  assert(workEnd > performance.now() + 2000, "DIAG_ORIGINAL_BOUND");
  const workMs = Math.floor(workEnd - performance.now());
  const deadline = Math.min(overall, workEnd + 30000),
    budget = production.macCensusRequestBudget(workMs, "compile");
  const outer = path.join(
    process.env.RUNNER_TEMP,
    "cef-mac-census-integration-" + randomUUID(),
  );
  await fs.mkdir(outer, { mode: 0o700 });
  const outerStamp = await owned(outer);
  const session = path.join(outer, "cef-mac-census-session-" + randomUUID());
  await fs.mkdir(session, { mode: 0o700 });
  const sessionStamp = await owned(session);
  const lease = Math.floor(deadline - performance.now());
  const context = {
    kind: "mac-census-session",
    mode: "integration-proof",
    target: "aarch64-apple-darwin",
    source: SOURCE,
    canonicalRoot:
      "/Users/runner/work/_temp/sorng-cef-engineering/aarch64-apple-darwin/" +
      SOURCE,
    image: "20260824.0482.1",
    phase: "compile",
    workMilliseconds: workMs,
    leaseMilliseconds: lease,
    wallEndMilliseconds: Math.floor(Date.now() + lease),
    requestBudget: budget,
    evidence: production.MAC_CENSUS_EVIDENCE.sha256,
    supervisorEvidence: production.MAC_CENSUS_SUPERVISOR_QUALIFICATION.sha256,
  };
  const contextRaw = Buffer.from(JSON.stringify(context));
  await fs.writeFile(path.join(session, "context.json"), contextRaw, {
    flag: "wx",
    mode: 0o600,
  });
  const child = nativeSpawn(session);
  const w = witness(),
    client = makeClient(
      child,
      {
        deadline,
        requestBudget: budget,
        readyMilliseconds: 2000,
        contextSha256: sha(contextRaw),
        productionAdmitted: false,
      },
      config.comparison,
      realClock,
      w,
    );
  let first,
    hasFirst = false,
    requests = 0,
    last = null,
    min = Infinity,
    max = 0,
    sum = 0,
    joined = false,
    closeResult,
    cleanupEnd,
    cleanupFailure = null;
  const fail = (e) => {
    if (!hasFirst) {
      hasFirst = true;
      first = e;
    }
  };
  try {
    const ready = await client.ready;
    assert.equal(ready.productionAdmitted, false);
    while (
      performance.now() + 2000 < workEnd &&
      requests < Math.min(config.requests ?? budget - 8, budget - 8)
    ) {
      const result = await client.snapshot();
      requests++;
      assert(result.rows.length > 0);
      last = {
        collectMicros: result.collectMicros,
        roundtripMicros: result.roundtripMicros,
        rowCount: result.rows.length,
      };
      min = Math.min(min, last.roundtripMicros);
      max = Math.max(max, last.roundtripMicros);
      sum += last.roundtripMicros;
      if (config.paced)
        await pause(
          Math.min(250, Math.max(0, workEnd - performance.now() - 2000)),
        );
    }
    if (config.requests)
      assert.equal(requests, config.requests, "DIAG_PHASE_INCOMPLETE");
  } catch (e) {
    fail(e);
    cleanupEnd = Math.min(deadline, overall, performance.now() + 30000);
    if (config.comparison && performance.now() + 500 < cleanupEnd)
      await pause(500);
  } finally {
    cleanupEnd ??= Math.min(deadline, overall, performance.now() + 30000);
    try {
      closeResult = await client.close({ deadline: cleanupEnd });
      joined = closeResult.joined;
    } catch (e) {
      cleanupFailure = { stage: "client-close", code: errorCode(e) };
      fail(e);
      joined = client.diagnostics().joined;
    }
    if (joined)
      try {
        await removeOwned(session, sessionStamp);
        assert.equal(await owned(outer), outerStamp);
        await fs.rmdir(outer);
      } catch (e) {
        cleanupFailure ??= { stage: "owned-scratch", code: errorCode(e) };
        fail(e);
      }
  }

  const result = {
    label: config.label,
    comparison: config.comparison,
    accelerated: !config.paced,
    requestedCadenceAfterResponseMs: config.paced ? 250 : 0,
    loadThreads: 0,
    workBudgetMs: workMs,
    requestBudget: budget,
    requests,
    last,
    roundtrip: {
      minMicros: Number.isFinite(min) ? min : null,
      maxMicros: max,
      meanMicros: requests ? Math.floor(sum / requests) : null,
    },
    firstFailure: hasFirst ? errorCode(first) : null,
    failureOrigin: hasFirst
      ? config.comparison
        ? (w.result().first?.origin ?? "client-call-outside-deny-hook")
        : "unmodified-client-origin-unobserved"
      : null,
    joined,
    cleanupFailure,
    clientDiagnostics: client.diagnostics(),
    witness: config.comparison ? w.result() : undefined,
    productionAdmitted: false,
  };
  return result;
}
async function nativeRun(sourceProof, testResults) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "x64");
  assert.equal(process.env.ImageOS, "macos15");
  assert.equal(process.env.ImageVersion, "20260824.0482.1");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(process.env.GITHUB_REPOSITORY, "supermarsx/sortOfRemoteNG");
  assert.equal(process.env.GITHUB_REPOSITORY_ID, "1010282954");
  assert.equal(process.env.GITHUB_EVENT_NAME, "push");
  assert.equal(process.env.GITHUB_REF, "refs/heads/" + BRANCH);
  assert(
    process.env.GITHUB_WORKFLOW_REF?.endsWith(
      "/" + WORKFLOW + "@refs/heads/" + BRANCH,
    ),
  );
  assert(!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN);
  assert.equal(
    git("rev-parse", "HEAD").toString().trim(),
    process.env.GITHUB_SHA,
  );
  git("merge-base", "--is-ancestor", BASE, "HEAD");
  assert.deepEqual(
    git("diff", "--name-only", BASE, "HEAD")
      .toString()
      .trim()
      .split("\n")
      .sort(),
    [WORKFLOW, SELF].sort(),
  );
  const started = Number(process.env.MAC_CENSUS_DIAG_STARTED_MS);
  assert(
    Number.isSafeInteger(started) &&
      Date.now() >= started &&
      Date.now() - started < 34 * 60000,
    "DIAG_JOB_CLOCK",
  );
  const overall =
    performance.now() +
    Math.min(29 * 60000, 35 * 60000 - (Date.now() - started) - 60000);
  assert(overall > performance.now() + 25 * 60000, "DIAG_JOB_REMAINING");
  const reportRoot = path.join(
    process.env.RUNNER_TEMP,
    "cef-mac-census-deadline-diagnostic-" + randomUUID(),
  );
  await fs.mkdir(reportRoot, { mode: 0o700 });
  await owned(reportRoot);
  const report = {
    kind: "private-native-Mac-census-deadline-comparison",
    sourceProof,
    controls: testResults,
    host: {
      platform: process.platform,
      architecture: process.arch,
      imageOS: process.env.ImageOS,
      imageVersion: process.env.ImageVersion,
      node: process.version,
    },
    phases: [],
    firstNativeFailure: null,
    productionHelperUnmodified: true,
    originalClientBaselineUnmodified: true,
    originalClientAndWorkerRequestCapsMs: 2000,
    originalClientBufferCap: 4 * 1024 ** 2,
    originalStderrCap: 4096,
    originalCleanupMs: 30000,
    noFactoryOrSessionAuthorityTokens: true,
    SDKOrNativeAdmission: false,
    limits:
      "No CEF source acquisition/build or SDK. Client-only probe: no factory/session/compileSlice outer snapshot checks. Accelerated and250ms-paced queries with no CEF/CPU load do not reproduce the77-minute SDK process/memory/elapsed-time conditions. Success means not reproduced, never a stall fix.",
  };
  let activePhase = "python-pin";
  const w = witness();
  const pin = runInNewContext(
    assertText + "\n(" + pinText + ")",
    environment(realClock, w),
    { timeout: 1000 },
  );
  try {
    await pin(PYTHON);
    report.pinnedPythonObserved = true;
    for (const config of [
      {
        label: "qualification-original",
        comparison: false,
        workMs: 30000,
        requests: 100,
      },
      {
        label: "accelerated-original",
        comparison: false,
        workMs: 180000,
        requests: 800,
      },
      {
        label: "accelerated-comparison",
        comparison: true,
        workMs: 180000,
        requests: 800,
      },
      {
        label: "paced-original",
        comparison: false,
        workMs: 600000,
        paced: true,
      },
      {
        label: "paced-comparison",
        comparison: true,
        workMs: 600000,
        paced: true,
      },
    ]) {
      activePhase = config.label;
      const phase = await nativePhase(config, overall);
      report.phases.push(phase);
      if (phase.firstFailure && !report.firstNativeFailure)
        report.firstNativeFailure = {
          phase: phase.label,
          code: phase.firstFailure,
        };
      if (!phase.joined || phase.cleanupFailure) {
        report.firstNativeFailure ??= {
          phase: phase.label,
          code: "DIAG_CLEANUP_UNCONFIRMED",
        };
        report.stoppedAfterUnconfirmedCleanup = true;
        break;
      }
    }
  } catch (e) {
    report.firstNativeFailure ??= {
      phase: activePhase,
      code: errorCode(e),
      phaseResultUnavailable: true,
    };
  } finally {
    report.outcome = report.firstNativeFailure
      ? "diagnostic failure retained"
      : "not reproduced; no repair proven";
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
    assert(bytes.length <= 512 * 1024, "DIAG_REPORT_BOUND");
    await fs.writeFile(path.join(reportRoot, "report.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        outcome: report.outcome,
        phases: report.phases.length,
        firstNativeFailure: report.firstNativeFailure,
        reportBytes: bytes.length,
        SDK: false,
      }),
    );
  }
  if (report.firstNativeFailure) process.exitCode = 1;
}
const sourceProof = await loadSource();
const changed = instrument(clientText);
sourceProof.instrumentedClient = {
  bytes: Buffer.byteLength(changed),
  sha256: sha(changed),
  closedEdits: edits.length,
  exactBaselineInverse: true,
};
sourceProof.spawnContract = spawnContract();
const testResults = await controls();
if (selfTest)
  console.log(
    JSON.stringify({
      kind: "deterministic-client-witness-controls",
      sourceProof,
      tests: testResults.length,
      pass: testResults.length,
      results: testResults,
      nativeDarwinQualification: false,
      SDK: false,
    }),
  );
else await nativeRun(sourceProof, testResults);
