import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMacCensusProofClient,
  MAC_NATIVE_CENSUS_ADMITTED,
  nativeCensusRows,
  observedLineage,
  censusFailureCode,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  summarize,
  oracleAbsent,
  proofCompilerEnvironment,
  publishCompilerGate,
  captureOracleAbi,
  executeJoined,
} from "../fixtures/cef/mac_process_census_proof.mjs";

const rows = [
  { pid: 100, parent: 50, group: 100, start: "darwin-v1:1793550000:123456" },
  { pid: 101, parent: 100, group: 101, start: "darwin-v1:1793550000:123457" },
];
function worker({ respond, ignoreEnd = false } = {}) {
  const child = new EventEmitter();
  child.pid = 500;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const state = { kills: 0, closed: false, unrefs: 0 };
  const close = (code) => {
    if (state.closed) return;
    state.closed = true;
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, code === null ? "SIGKILL" : null);
  };
  child.stdin = new Writable({
    write(raw, encoding, done) {
      const request = JSON.parse(raw);
      setImmediate(() => respond?.(request, child));
      done();
    },
  });
  child.stdin.on("finish", () => {
    if (!ignoreEnd) setImmediate(() => close(0));
  });
  child.kill = (signal) => {
    assert.equal(signal, "SIGKILL");
    state.kills++;
    setImmediate(() => close(null));
    return true;
  };
  child.unref = () => state.unrefs++;
  const send = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  const ready = () =>
    send({
      kind: "mac-census-proof-ready",
      abi: { testOnly: true },
      oracleSha256: "a".repeat(64),
      productionAdmitted: false,
    });
  return { child, state, send, ready, close };
}

test("native rows keep canonical microsecond identity through every lineage clone and reparenting", () => {
  assert.equal(MAC_NATIVE_CENSUS_ADMITTED, true);
  nativeCensusRows({ request: 1, rows, collectMicros: 2 }, 1);
  const owned = observedLineage(rows, [{ pid: 100, start: rows[0].start }]);
  assert.deepEqual(owned, [
    { pid: 100, start: rows[0].start },
    { pid: 101, start: rows[1].start },
  ]);
  const reparented = observedLineage(
    [{ ...rows[0] }, { ...rows[1], parent: 1 }],
    owned,
  );
  assert.deepEqual(reparented, owned);
  assert.throws(
    () =>
      observedLineage(
        [{ ...rows[0], start: "darwin-v1:1793550000:123458" }],
        owned,
      ),
    /root PID identity changed/,
  );
  assert.throws(
    () =>
      nativeCensusRows(
        { request: 1, rows: [...rows, rows[0]], collectMicros: 1 },
        1,
      ),
    /CENSUS_ROWS_IDENTITY/,
  );
  for (const changed of [
    { start: "1793550000" },
    { start: "darwin-v1:1793550000:1000000" },
    { parent: -1 },
    { group: Infinity },
  ])
    assert.throws(
      () =>
        nativeCensusRows(
          { request: 1, rows: [{ ...rows[0], ...changed }], collectMicros: 1 },
          1,
        ),
      /CENSUS_ROWS_IDENTITY/,
    );
});

test("one held worker has one in-flight request and exact response IDs without exposing foreign rows", async () => {
  const f = worker({
    respond: (request, child) =>
      child.stdout.write(
        JSON.stringify({ request: request.request, rows, collectMicros: 3 }) +
          "\n",
      ),
  });
  const client = createMacCensusProofClient(f.child, {
    deadline: performance.now() + 5000,
  });
  f.ready();
  await client.ready;
  const first = client.snapshot();
  await assert.rejects(client.snapshot(), /CENSUS_REQUEST/);
  const result = await first;
  assert.deepEqual(result.rows, rows);
  assert.equal(result.collectMicros, 3);
  const receipt = await client.close();
  assert.equal(receipt.joined, true);
  assert.equal(receipt.requests, 1);
  assert.equal(receipt.failed, false);
  assert.equal(f.state.kills, 0);
});

test("protocol, EOF, output and lease failures reject instead of creating production admission", async () => {
  for (const mode of [
    "wrong-request",
    "extra",
    "partial-eof",
    "bound",
    "deadline",
  ]) {
    const f = worker({
      respond: (request, child) => {
        if (mode === "deadline") return;
        if (mode === "partial-eof") {
          child.stdout.write('{"request":');
          f.close(1);
          return;
        }
        if (mode === "bound") {
          child.stdout.write(Buffer.alloc(4 * 1024 ** 2 + 1, 65));
          return;
        }
        f.send({
          request: mode === "wrong-request" ? 99 : request.request,
          rows,
          collectMicros: 1,
          ...(mode === "extra" ? { private: "SECRET" } : {}),
        });
      },
    });
    const client = createMacCensusProofClient(f.child, {
      deadline: performance.now() + (mode === "deadline" ? 200 : 5000),
    });
    f.ready();
    await assert.rejects(client.snapshot());
    if (mode === "deadline")
      await assert.rejects(client.close(), /cleanup deadline/);
    else {
      const receipt = await client.close();
      assert.equal(receipt.joined, true);
      assert.equal(receipt.failed, true);
    }
    assert.equal(MAC_NATIVE_CENSUS_ADMITTED, true);
  }
});

test("worker rejection identity survives cleanup and a joined failed worker is not success", async () => {
  for (const channel of ["child", "stdin"]) {
    const marker = new Error("PRIVATE_SENTINEL");
    const f = worker({
      respond: () =>
        channel === "child"
          ? f.child.emit("error", marker)
          : f.child.stdin.destroy(marker),
    });
    const client = createMacCensusProofClient(f.child, {
      deadline: performance.now() + 5000,
    });
    f.ready();
    await assert.rejects(client.snapshot(), (error) => error === marker);
    const receipt = await client.close();
    assert.equal(receipt.joined, true);
    assert.equal(receipt.failed, true);
    assert.equal(f.state.kills, 1);
  }
});

test("native proof command is closed and Python decoder uses an oracle rather than guessed ABI offsets", async () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      String.raw`
import ctypes as C,importlib.util,json,struct,sys
file=sys.argv[1];spec=importlib.util.spec_from_file_location('census',file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.PRODUCTION_CENSUS_ADMITTED is True
# Artificial data-only ABI, never a tuple inferred or admitted for Darwin.
a=dict(recordBytes=128,pidOffset=0,pidBytes=4,parentOffset=4,parentBytes=4,groupOffset=8,groupBytes=4,secondsOffset=16,secondsBytes=8,microsOffset=24,microsBytes=4,pointerBytes=8,longBytes=8,mib=[1,14,0,0])
b=bytearray(128);struct.pack_into('<iii',b,0,10,9,10);struct.pack_into('<q',b,16,1793550000);struct.pack_into('<i',b,24,123456)
assert m.decode_rows(bytes(b),a)==[dict(pid=10,parent=9,group=10,start='darwin-v1:1793550000:123456')]
for patch in [dict(pidOffset=-1),dict(parentOffset=0),dict(recordBytes=1),dict(microsBytes=3),dict(extra='PRIVATE')]:
 try:m.validate_abi({**a,**patch});raise AssertionError('ABI admitted')
 except m.CensusError:pass
for raw in [bytes(b)+b'0',bytes(b)*2]:
 try:m.decode_rows(raw,a);raise AssertionError('rows admitted')
 except m.CensusError:pass
struct.pack_into('<i',b,24,1000000)
try:m.decode_rows(bytes(b),a);raise AssertionError('microsecond overflow')
except m.CensusError:pass
print('data-only decoder guards passed')
`,
      "scripts/lib/cef-mac-process-census.py",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 16384, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const source = await readFile(
    "scripts/lib/cef-mac-process-census.py",
    "utf8",
  );
  assert.match(
    source,
    /offsetof\(struct kinfo_proc,kp_proc.p_starttime.tv_usec\)/,
  );
  assert.match(source, /for attempt in range\(2\)/);
  assert.match(source, /if\(result!=0\) return errno==ESRCH \? 3 : 4;/);
  assert.match(source, /if\(n==0\) return 3;/);
  assert.match(
    source,
    /if\(n!=sizeof\(row\) \|\| row.kp_proc.p_pid!=pid\) return 4;/,
  );
  assert.doesNotMatch(source, /KERN_PROCARGS|proc_pidpath|shell=True/);
});

test("only confirmed native absence can satisfy owned cleanup, not permission, size or identity failures", () => {
  assert.equal(oracleAbsent({ code: 3, killed: false, signal: null }), true);
  for (const error of [
    null,
    {},
    new Error("PRIVATE"),
    { code: 4 },
    { code: 13 },
    { code: 3, killed: true },
    { code: 3, signal: "SIGTERM" },
  ])
    assert.equal(oracleAbsent(error), false);
});

test("proof telemetry is bounded integers and never invents speedup from missing observations", () => {
  assert.deepEqual(summarize([40, 10, 30, 20]), {
    count: 4,
    p50Micros: 20,
    p95Micros: 30,
    maxMicros: 40,
  });
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([Infinity]));
});

test("compiler children are delegated to the existing supervisor and preparation cannot start a compiler", () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-S",
      "-c",
      String.raw`
import ast,pathlib,sys
t=ast.parse(pathlib.Path(sys.argv[1]).read_bytes())
functions={n.name:n for n in t.body if isinstance(n,ast.FunctionDef)}
def children(name):return [n for n in ast.walk(functions[name])if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and isinstance(n.func.value,ast.Name)and n.func.value.id=='subprocess']
assert children('prepare_source')==[]
assert children('read_oracle')==[]
calls=children('compile_oracle');assert len(calls)==1 and calls[0].func.attr=='run'
assert not any(k.arg=='timeout'for k in calls[0].keywords)
assert isinstance(calls[0].args[0],ast.List)and isinstance(calls[0].args[0].elts[0],ast.Name)and calls[0].args[0].elts[0].id=='CLANG'
assert not any(isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id in ('compile_oracle','prepare_source')for n in ast.walk(functions['worker']))
print('compiler supervision routing guards passed')
`,
      "scripts/lib/cef-mac-process-census.py",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("worker diagnostics retain only known fixed codes and never broad prefixes or raw stderr", () => {
  const value = {
    kind: "mac-census-proof-failure",
    code: "CENSUS_TOOL_PIN",
    productionAdmitted: false,
  };
  assert.equal(censusFailureCode(JSON.stringify(value)), "CENSUS_TOOL_PIN");
  for (const changed of [
    { code: "CENSUS_PRIVATE_SECRET" },
    { private: "SECRET" },
    { productionAdmitted: true },
    { kind: "unknown" },
  ])
    assert.equal(
      censusFailureCode(JSON.stringify({ ...value, ...changed })),
      "CENSUS_UNAVAILABLE",
    );
  assert.equal(censusFailureCode("SECRET"), "CENSUS_UNAVAILABLE");
});

test("actual supervised caller environment reaches only the closed compiler authority without credential exceptions", () => {
  const env = proofCompilerEnvironment({
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_TRACKING_ID: "owned-fixture",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_TOKEN: "PRIVATE",
    GH_TOKEN: "PRIVATE",
  });
  assert(!Object.keys(env).some((key) => /^(GH_|GITHUB_|ACTIONS_)/.test(key)));
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-S",
      "-c",
      String.raw`
import importlib.util,json,os,sys
from unittest.mock import patch
s=importlib.util.spec_from_file_location('proof',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Pin:
 name='python3.14'
 def is_absolute(self):return True
 def resolve(self,**kwargs):return 'exact-held-pin'
with patch.dict(os.environ,json.loads(sys.argv[2]),clear=True),patch.object(sys,'platform','darwin'),patch.object(m.platform,'machine',return_value='x86_64'),patch.object(m,'Path',return_value=Pin()),patch.object(m,'root_path',return_value='owned'),patch.object(m,'held_pin'),patch.object(m,'compile_oracle')as compiler:
 m.main(['--proof-compile','owned']);compiler.assert_called_once_with('owned')
 for args in (['--proof-prepare','owned'],['--proof-worker','owned'],['--proof-actor','owned','root']):
  try:m.main(args);raise AssertionError('public authority bypassed')
  except m.CensusError as e:assert str(e)=='CENSUS_RUNNER'
print('actual stripped environment reached only supervised compiler')
`,
      "scripts/lib/cef-mac-process-census.py",
      JSON.stringify(env),
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("cancellation during either gate IO cannot publish a late compiler start", async () => {
  for (const phase of ["root", "write", null]) {
    const controller = new AbortController();
    let writes = 0,
      renames = 0;
    const check = async () => {
      if (phase === "root") controller.abort();
    };
    const io = {
      writeFile: async () => {
        writes++;
        if (phase === "write") controller.abort();
      },
      rename: async () => {
        renames++;
      },
    };
    const run = publishCompilerGate(
      "/owned",
      check,
      controller.signal,
      () => false,
      io,
    );
    if (phase) await assert.rejects(run, /PROOF_COMPILE_GATE/);
    else await run;
    assert.equal(renames, phase ? 0 : 1);
    assert.equal(writes, phase === "root" ? 0 : 1);
  }
});

test("actual ABI capture caller owns the bounded leaf before publishing its hash-bound receipt", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "cef-census-abi-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeFile(path.join(output, "abi-oracle"), "fixture-only binary bytes");
  const controller = new AbortController();
  const abi = { fixtureOnly: true };
  const receipt = await captureOracleAbi(
    output,
    {
      env: {},
      end: performance.now() + 60000,
      signal: controller.signal,
      checkRoot: async () => {},
    },
    async (file, args, options) => {
      assert.equal(file, path.join(output, "abi-oracle"));
      assert.deepEqual(args, []);
      assert.equal(options.timeout, 2000);
      assert.equal(options.maxBuffer, 2048);
      assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.signal, controller.signal);
      assert(Number.isFinite(options.joinDeadline));
      await assert.rejects(readFile(path.join(output, "abi-oracle.json")), {
        code: "ENOENT",
      });
      return { stdout: JSON.stringify(abi), stderr: "" };
    },
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(output, "abi-oracle.json"), "utf8")),
    receipt,
  );
  assert.deepEqual(receipt.abi, abi);
  assert.match(receipt.oracleSha256, /^[a-f0-9]{64}$/);
  const source = await readFile(
    "tests/fixtures/cef/mac_process_census_proof.mjs",
    "utf8",
  );
  const caller = source.indexOf(
    "const captured = await captureOracleAbi(output",
  );
  assert(
    caller > 0 &&
      caller < source.indexOf('worker = spawnOwned("worker")', caller),
  );
});

test("aborting pending ABI capture joins the creation-owned leaf and publishes no receipt", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "cef-census-abi-abort-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeFile(path.join(output, "abi-oracle"), "fixture-only binary bytes");
  const marker = path.join(output, "started.json");
  const controller = new AbortController();
  const running = captureOracleAbi(
    output,
    {
      env: {},
      end: performance.now() + 60000,
      signal: controller.signal,
      checkRoot: async () => {},
    },
    (file, args, options) =>
      executeJoined(
        process.execPath,
        [
          "-e",
          'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)',
          marker,
        ],
        { ...options, env: process.env },
      ),
  );
  // Install the rejection handler before cancellation, while the child is live.
  const rejected = assert.rejects(
    running,
    (error) => error.code === "ABORT_ERR",
  );
  let pid;
  const end = performance.now() + 5000;
  while (!pid) {
    try {
      pid = JSON.parse(await readFile(marker, "utf8")).pid;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert(performance.now() < end, "fixture child startup deadline");
    if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await rejected;
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(readFile(path.join(output, "abi-oracle.json")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(path.join(output, "abi-oracle.partial")), {
    code: "ENOENT",
  });
});

test("Python ABI receipt reader only validates held bytes and rejects stale binary bindings", () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-S",
      "-c",
      String.raw`
import importlib.util,json,hashlib,pathlib,sys
from unittest.mock import patch
s=importlib.util.spec_from_file_location('proof',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
binary=b'fixture-only binary';sha=hashlib.sha256(binary).hexdigest()
def read(name,maximum):
 return m.ORACLE.encode() if name.name=='abi-oracle.c' else binary if name.name=='abi-oracle' else json.dumps(receipt).encode()
for receipt,valid in (({'abi':{'fixtureOnly':True},'oracleSha256':sha},True),({'abi':{},'oracleSha256':'0'*64},False),({'abi':{},'oracleSha256':sha,'private':'unexpected'},False)):
 with patch.object(m,'held_bytes',side_effect=read),patch.object(m,'validate_abi',side_effect=lambda x:x),patch.object(m.subprocess,'run',side_effect=AssertionError('worker spawned a child')):
  try:
   value=m.read_oracle(pathlib.Path('owned'));assert valid and value==({'fixtureOnly':True},sha)
  except m.CensusError as e:assert not valid and str(e)=='CENSUS_OWNED_FILE'
print('held ABI receipt accepts only exact binary binding; no worker children')
`,
      "scripts/lib/cef-mac-process-census.py",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("ABI leaf with unconfirmed close denies at the original join lease and preserves its first error", async () => {
  const child = new EventEmitter();
  const streams = ["stdin", "stdout", "stderr"].map((name) => {
    const state = { destroys: 0, unrefs: 0 };
    child[name] = {
      destroy() {
        state.destroys++;
      },
      unref() {
        state.unrefs++;
      },
    };
    return state;
  });
  let kills = 0,
    unrefs = 0;
  child.kill = (signal) => {
    assert.equal(signal, "SIGKILL");
    kills++;
  };
  child.unref = () => {
    unrefs++;
  };
  const primary = Object.assign(new Error("fixture abort"), {
    code: "ABORT_ERR",
  });
  const began = performance.now();
  const joinDeadline = began + 30;
  const result = executeJoined(
    "owned-fixture",
    [],
    { joinDeadline, timeout: 2 },
    (file, args, options, done) => {
      assert.equal(file, "owned-fixture");
      assert.deepEqual(args, []);
      assert.equal(options.timeout, 2);
      assert.equal(Object.hasOwn(options, "joinDeadline"), false);
      setImmediate(() => done(primary));
      return child; // Deliberately never emits close.
    },
  );
  await assert.rejects(result, (error) => error === primary);
  assert(performance.now() - began < 1000, "original join lease was extended");
  assert.equal(kills, 1);
  assert.equal(unrefs, 1);
  for (const stream of streams)
    assert.deepEqual(stream, { destroys: 1, unrefs: 1 });
  const late = new EventEmitter();
  const lateDeadline = performance.now() + 20;
  await assert.rejects(
    executeJoined(
      "owned-fixture",
      [],
      { joinDeadline: lateDeadline },
      (file, args, options, done) => {
        queueMicrotask(() => {
          done(null, "{}", "");
          late.emit("close", 0);
          while (performance.now() < lateDeadline + 5) {
            /* Simulate a stalled event loop. */
          }
        });
        return late;
      },
    ),
    /PROOF_DEADLINE/,
  );
});
