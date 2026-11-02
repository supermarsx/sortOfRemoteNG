// Actual normalizer + Windows filesystem + pinned Python sidecar interoperability.
// The private bootstrap boundary is explicitly modeled; no actor/Job/compiler runs.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DRIVER = path.join(
  ROOT,
  "native/windows-arm-full-sdk/full-sdk-source-driver.mjs",
);
const PRIMARY =
  '#!/usr/bin/env python3\n# Copyright 2017 The Chromium Authors\n# Use of this source code is governed by a BSD-style license that can be\n# found in the LICENSE file.\n"""Small utility script to enable/disable `depot_tools` automatic updating."""\n\nimport argparse\nimport datetime\nimport os\nimport sys\n\nDEPOT_TOOLS_ROOT = os.path.abspath(os.path.dirname(__file__))\nSENTINEL_PATH = os.path.join(DEPOT_TOOLS_ROOT, ".disable_auto_update")\n\n\ndef main():\n    parser = argparse.ArgumentParser()\n    group = parser.add_mutually_exclusive_group(required=True)\n    group.add_argument(\n        "--enable", action="store_true", help="Enable auto-updating."\n    )\n    group.add_argument(\n        "--disable", action="store_true", help="Disable auto-updating."\n    )\n    args = parser.parse_args()\n\n    if args.enable:\n        if os.path.exists(SENTINEL_PATH):\n            os.unlink(SENTINEL_PATH)\n    if args.disable:\n        if not os.path.exists(SENTINEL_PATH):\n            with open(SENTINEL_PATH, "w") as fd:\n                fd.write(\n                    "Disabled by %s at %s\\n"\n                    % (__file__, datetime.datetime.now())\n                )\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n';
const PRIMARY_SHA =
  "6797d3ed046e32efbd48e044347dce7703559b76b4adaca1c874f69ff83c1c23";
const PYTHON_SHA =
  "4d6f5f81a4bca11191c4c7c6b43632694d0a4ce74e068619d8fdc161d469859a";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const source = (await fs.readFile(DRIVER, "utf8")).replaceAll("\r\n", "\n");
const tree = parse(source, { sourceType: "module", ecmaVersion: "latest" });
const functionSource = (name) => {
  const matches = tree.body
    .map((row) => row.declaration ?? row)
    .filter(
      (row) => row.type === "FunctionDeclaration" && row.id.name === name,
    );
  assert.equal(matches.length, 1, name);
  return source.slice(matches[0].start, matches[0].end);
};
const declarationSource = (name) => {
  const matches = tree.body.filter(
    (row) =>
      row.type === "VariableDeclaration" &&
      row.declarations.some((value) => value.id.name === name),
  );
  assert.equal(matches.length, 1, name);
  return source.slice(matches[0].start, matches[0].end);
};
let PYTHON;
if (process.platform === "win32") {
  for (const candidate of [
    "C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe",
    ...(process.env.LOCALAPPDATA
      ? [
          path.join(
            process.env.LOCALAPPDATA,
            "Programs/Python/Python312/python.exe",
          ),
        ]
      : []),
  ]) {
    if (
      existsSync(candidate) &&
      sha(await fs.readFile(candidate)) === PYTHON_SHA
    ) {
      PYTHON = candidate;
      break;
    }
  }
}
const windows = {
  skip: PYTHON
    ? false
    : "Requires actual Windows filesystem and exact official CPython3.12.10/4d6 interpreter",
};
const PYTHON_DATA = String.raw`
import ast,base64,datetime,hashlib,json,os,pathlib,sys,tempfile,types
from unittest.mock import patch
P=json.load(sys.stdin)
sys.path.insert(0,P['moduleParent'])
import checkpoint_inputs as inputs
primary=base64.b64decode(P['primary'])
assert len(primary)==1205 and hashlib.sha256(primary).hexdigest()=='6797d3ed046e32efbd48e044347dce7703559b76b4adaca1c874f69ff83c1c23'
if P['action']=='init':
 repo=pathlib.Path(tempfile.mkdtemp(prefix='windows-sdk-sentinel-')).resolve()
 identity=dict(image='20261030.294.1',sourceId=inputs.SOURCES['20261030.294.1'],producerSha256='a'*64,sourceDateEpoch=dict(present=False,value=None))
 root=repo/'.artifacts'/inputs.root_name(identity['image'],identity['sourceId']);root.mkdir(parents=True)
 for name in inputs.NAMESPACES:(root/name).mkdir()
 script=root/'source-checkout/src/third_party/depot_tools/update_depot_tools_toggle.py';script.parent.mkdir(parents=True);script.write_bytes(primary)
 print(json.dumps(dict(repo=str(repo),root=str(root),script=str(script),sentinel=str(script.with_name('.disable_auto_update')),identity=identity)))
 sys.exit(0)
repo=pathlib.Path(P['repo']);root=pathlib.Path(P['root']);identity=P['identity']
assert repo.is_absolute() and repo.parent==pathlib.Path(tempfile.gettempdir()).resolve() and repo.name.startswith('windows-sdk-sentinel-')
assert root==repo/'.artifacts'/inputs.root_name(identity['image'],identity['sourceId'])
inputs.REPO=repo
script=root/'source-checkout/src/third_party/depot_tools/update_depot_tools_toggle.py';sentinel=script.with_name('.disable_auto_update')
clock=types.SimpleNamespace(remaining=lambda:600)
if P['action']=='construct':
 if P.get('replace') and sentinel.exists():sentinel.unlink()
 # Execute ONLY the exact pinned constructor AST, never main/argparse/vendor commands.
 main=next(n for n in ast.parse(primary).body if isinstance(n,ast.FunctionDef) and n.name=='main')
 branch=next(n for n in main.body if isinstance(n,ast.If) and isinstance(n.test,ast.Attribute) and n.test.attr=='disable')
 fixed=datetime.datetime.fromisoformat(P['timestamp'])
 scope=dict(args=types.SimpleNamespace(disable=True),os=os,SENTINEL_PATH=str(sentinel),__file__=str(script),datetime=types.SimpleNamespace(datetime=types.SimpleNamespace(now=lambda:fixed)))
 exec(compile(ast.Module(body=[branch],type_ignores=[]),str(script),'exec'),scope)
 raw=sentinel.read_bytes();assert raw.endswith(b'\r\n')
 print(json.dumps(dict(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),base64=base64.b64encode(raw).decode(),nativeScriptPath=str(script),constructorAstExecuted=True,vendorMainExecuted=False)))
elif P['action']=='record':
 result=inputs.record_inputs(root,identity,clock,lambda:None)
 print(json.dumps(result))
elif P['action']=='apply':
 mutations=[];original=inputs._set_mtime
 def tracked(*args):mutations.append(1);return original(*args)
 try:
  with patch.object(inputs,'_set_mtime',side_effect=tracked):result=inputs.apply_inputs(root,identity,P['pin'],clock,lambda:None)
 except ValueError as error:
  print(json.dumps(dict(ok=False,code=str(error),mtimeWrites=len(mutations))))
 else:print(json.dumps(dict(ok=True,result=result,mtimeWrites=len(mutations))))
else:raise AssertionError('closed test-data action')
`;
function python(packet) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PYTHON,
      ["-I", "-B", "-c", PYTHON_DATA],
      { timeout: 15000, maxBuffer: 1024 ** 2, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error("Official inert Python data harness failed: " + stderr),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(
      JSON.stringify({
        ...packet,
        moduleParent: path.join(ROOT, "native/windows-arm-full-sdk"),
        primary: Buffer.from(PRIMARY).toString("base64"),
      }),
    );
  });
}
async function fixture(t) {
  const value = await python({ action: "init" });
  t.after(async () => {
    assert.equal(path.dirname(value.repo), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(value.repo), /^windows-sdk-sentinel-/);
    await fs.rm(value.repo, { recursive: true, force: true });
  });
  return value;
}
const stamp = (f, timestamp, replace = true) =>
  python({ ...f, action: "construct", timestamp, replace });
function normalizer(f, options = {}) {
  const profile = {},
    pin = "b".repeat(64),
    profiles = new WeakMap(),
    owners = new WeakSet();
  let expired = false,
    fired = false,
    writes = 0,
    closes = 0;
  const binding = {
    root: f.root,
    contextPin: pin,
    context: { wallWholeEnd: (Date.now() + 600000) / 1000 },
    budget: {
      remaining() {
        if (expired) throw false;
        return 120000;
      },
    },
  };
  profiles.set(profile, binding);
  const actualFs = {
    ...fs,
    async open(file, ...args) {
      const fd = await fs.open(file, ...args);
      if (file !== f.sentinel) return fd;
      return new Proxy(fd, {
        get(target, key) {
          if (key === "read")
            return async (...argv) => {
              const result = await target.read(...argv);
              if (!fired && result.bytesRead > 0) {
                fired = true;
                if (options.expireAfterRead) expired = true;
                if (options.replaceAfterRead) {
                  await fs.rename(f.sentinel, f.sentinel + ".retained");
                  await fs.writeFile(f.sentinel, options.replacement);
                }
              }
              return result;
            };
          if (key === "write" || key === "truncate")
            return async (...argv) => {
              writes++;
              return target[key](...argv);
            };
          if (key === "close")
            return async () => {
              closes++;
              return target.close();
            };
          const result = Reflect.get(target, key, target);
          return typeof result === "function" ? result.bind(target) : result;
        },
      });
    },
  };
  const context = vm.createContext({
    fs: actualFs,
    constants,
    path,
    Buffer,
    Date,
    performance,
    setTimeout,
    clearTimeout,
    createHash,
    fullSourceProfiles: profiles,
    fullSourceSentinelOwners: owners,
    fullBootstrapAuthority(root, p, contextPin) {
      assert.equal(root, f.root);
      assert.equal(p, profile);
      assert.equal(contextPin, pin);
      assert.equal(
        profiles.get(p),
        binding,
        "modeled private bootstrap owner remains live",
      );
      binding.budget.remaining();
      return binding;
    },
  });
  const program = [
    declarationSource("need"),
    declarationSource("sha"),
    declarationSource("signature"),
    declarationSource("shared"),
    "let sourceCloseFailure = false;",
    functionSource("physical"),
    functionSource("held"),
    functionSource("normalizeFullSourceDepotToolsSentinel"),
    "normalizeFullSourceDepotToolsSentinel",
  ].join("\n");
  const run = vm.runInContext(program, context);
  return {
    run: () => run(f.root, profile, pin),
    writes: () => writes,
    closes: () => closes,
    retired: () => !profiles.has(profile),
  };
}

test("exact pinned constructor and actual normalizer body are independently selected", () => {
  assert.equal(Buffer.byteLength(PRIMARY), 1205);
  assert.equal(sha(PRIMARY), PRIMARY_SHA);
  assert(
    functionSource("normalizeFullSourceDepotToolsSentinel").includes(
      PRIMARY_SHA,
    ),
  );
});

test(
  "raw timestamp states deny before anymtime; both actual normalizations restore at same canonical Windows root",
  windows,
  async (t) => {
    const f = await fixture(t);
    const first = await stamp(f, "2026-11-01 12:34:56.123456");
    const unchanged = await stamp(f, "2026-11-02 12:34:56.654321", false);
    assert.equal(
      unchanged.sha256,
      first.sha256,
      "actual constructor writes only if absent",
    );
    assert.match(first.nativeScriptPath, /\\/);
    const rawPin = (await python({ ...f, action: "record" })).sidecar;
    const second = await stamp(f, "2026-11-02 12:34:56.654321");
    assert.notEqual(first.sha256, second.sha256);
    assert.equal(first.bytes, second.bytes);
    const red = await python({ ...f, action: "apply", pin: rawPin });
    assert.deepEqual(red, {
      ok: false,
      code: "CHECKPOINT_INPUTS_BYTES",
      mtimeWrites: 0,
    });
    await fs.unlink(path.join(f.root, "full-sdk-checkpoint-inputs.jsonl"));
    await stamp(f, "2026-11-01 12:34:56.123456");
    const a = normalizer(f),
      firstResult = await a.run(),
      firstBytes = await fs.readFile(f.sentinel);
    assert.equal(firstResult.dataOnly, true);
    const pin = (await python({ ...f, action: "record" })).sidecar;
    await stamp(f, "2026-11-02 12:34:56.654321");
    const b = normalizer(f),
      secondResult = await b.run();
    assert.deepEqual(await fs.readFile(f.sentinel), firstBytes);
    assert.equal(secondResult.sha256, firstResult.sha256);
    assert.match(firstBytes.toString(), / at 1970-01-01 00:00:00\r\n$/);
    const green = await python({ ...f, action: "apply", pin });
    assert.equal(green.ok, true);
    assert.equal(green.result.dataOnly, true);
    assert.equal(green.result.executionAdmitted, false);
    assert(green.mtimeWrites >= 2);
    assert.equal(a.closes(), 1);
    assert.equal(b.closes(), 1);
  },
);

test(
  "prefix LF malformed date missing and script-pin faults deny without stamp writes",
  windows,
  async (t) => {
    for (const fault of ["prefix", "lf", "date", "missing", "script-pin"]) {
      await t.test(fault, async (t) => {
        const f = await fixture(t);
        await stamp(f, "2026-11-01 12:34:56.123456");
        let raw = await fs.readFile(f.sentinel);
        if (fault === "prefix")
          raw = Buffer.from(
            raw.toString().replace("Disabled by ", "Foreign by "),
          );
        if (fault === "lf")
          raw = Buffer.from(raw.toString().replace("\r\n", "\n"));
        if (fault === "date")
          raw = Buffer.from(raw.toString().replace("2026-11-01", "2026-02-31"));
        await fs.writeFile(f.sentinel, raw);
        if (fault === "missing") await fs.unlink(f.sentinel);
        if (fault === "script-pin")
          await fs.writeFile(
            f.script,
            Buffer.from(PRIMARY.replace("Copyright", "Copyrighx")),
          );
        const n = normalizer(f);
        await assert.rejects(n.run());
        assert.equal(n.writes(), 0);
        assert.equal(n.retired(), true);
        if (fault !== "missing")
          assert.deepEqual(await fs.readFile(f.sentinel), raw);
        else assert.equal(existsSync(f.sentinel), false);
      });
    }
  },
);

test(
  "actual file replacement and original false expiry after read deny before first write and join close",
  windows,
  async (t) => {
    for (const fault of ["race", "false-expiry"])
      await t.test(fault, async (t) => {
        const f = await fixture(t);
        await stamp(f, "2026-11-01 12:34:56.123456");
        const original = await fs.readFile(f.sentinel),
          replacement = Buffer.from(original);
        const n = normalizer(
          f,
          fault === "race"
            ? { replaceAfterRead: true, replacement }
            : { expireAfterRead: true },
        );
        await assert.rejects(n.run(), (error) =>
          fault === "false-expiry"
            ? error === false
            : /FULL_SENTINEL_CHANGED/.test(error.message),
        );
        assert.equal(n.writes(), 0);
        assert.equal(n.closes(), 1);
        assert.equal(n.retired(), true);
        assert.deepEqual(await fs.readFile(f.sentinel), original);
      });
  },
);
