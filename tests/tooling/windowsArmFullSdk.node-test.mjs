import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import {
  identitySha256,
  validateSourceLock,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { validateRunnerMap } from "../../scripts/cef-runtime-ci.mjs";
import { cefHookArguments } from "../../scripts/cef-runtime-ci.mjs";
import {
  reviewedHostTools,
  sourceCommands,
  sourcePaths,
  sourceBudget,
  sourceEnvironment,
  validateGeneratedArguments,
  python3Adapter,
  preparePython3Adapter,
  hookProjectionArguments,
  validateHookProjection,
  boundGnArguments,
  dependencyHookArguments,
  retainHookOrigins,
} from "../../native/windows-arm-full-sdk/source-driver.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (name) => fs.readFile(path.join(root, name), "utf8");
const prefix = "native/windows-arm-full-sdk/";
const workflowPath = ".github/workflows/windows-x64-arm-toolchain.yml";
const rawWorkflow = await read(workflowPath);
const workflow = rawWorkflow.replaceAll("\r\n", "\n");
const profileRaw = await fs.readFile(path.join(root, prefix, "profile.json"));
const profile = JSON.parse(profileRaw);
const sha = (b) => createHash("sha256").update(b).digest("hex");

function syntheticSourcePins() {
  const p = structuredClone(profile);
  p.sourceGn.hostTools = Object.fromEntries(
    ["node", "git"].map((role) => [
      role,
      {
        path: `C:/owned/${role}.exe`,
        bytes: 123,
        sha256: "a".repeat(64),
        nlink: 1,
      },
    ]),
  );
  return p;
}

async function benignPython(t) {
  const candidates =
    process.platform === "win32"
      ? [
          profile.python.path,
          "C:/Users/Mariana/AppData/Local/Programs/Python/Python312/python.exe",
        ]
      : ["/usr/bin/python3"];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* Explicit test-only candidates. */
    }
  }
  t.skip(
    "Fixed benign fixture Python is unavailable; no interpreter discovery or installation",
  );
}

test("exclusive actual Python3 adapter preserves Windows owned argv and rejects replacement", async (t) => {
  if (process.platform !== "win32")
    return t.skip("Actual Windows cmd adapter invocation");
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-python-adapter-"),
  );
  const budget = { remaining: () => 10000 };
  try {
    const adapter = await preparePython3Adapter(
      path.join(directory, "commands"),
      python,
      budget,
    );
    assert.equal(adapter.pin.sha256, sha(python3Adapter(python)));
    assert.deepEqual(await fs.readFile(adapter.file), python3Adapter(python));
    // Match pinned subprocess2's real Windows list argv + shell=True boundary.
    const invocation = [
        "-I",
        "-B",
        "-c",
        "import subprocess\nsubprocess.run(['python3','-c','import sys,json;print(json.dumps(sys.argv[1:]))','two words','a+b@c',''],shell=True,check=True)",
      ],
      env = {
        SystemRoot: "C:/Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: path.dirname(adapter.file),
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        TEMP: directory,
        TMP: directory,
      };
    const raw = execFileSync(python, invocation, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      cwd: directory,
      env,
    });
    assert.deepEqual(JSON.parse(raw), ["two words", "a+b@c", ""]);
    assert.throws(
      () =>
        execFileSync(python, invocation, {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
          cwd: directory,
          env: { ...env, ComSpec: "C:/Windows/System32/cmd.exe" },
          stdio: "pipe",
        }),
      (error) =>
        error.status !== 0 &&
        error.stderr.includes("syntax of the command is incorrect"),
    );
    // Windows searches cwd before PATH. The actual production hook wrapper
    // must use the absolute adapter, rather than merely prepend its directory.
    await fs.writeFile(
      path.join(directory, "python3.bat"),
      "@echo CWD_SHADOW\r\n",
    );
    assert.match(
      execFileSync(python, invocation, {
        encoding: "utf8",
        timeout: 10000,
        cwd: directory,
        env,
      }),
      /CWD_SHADOW/,
    );
    const depot = path.join(directory, "depot");
    await fs.mkdir(depot);
    await fs.writeFile(
      path.join(depot, "gclient.py"),
      `import subprocess
class Hook:
 def __init__(self): self._action=('python3','-c','import sys,json;print(json.dumps(sys.argv[1:]))','two words','a+b@c','')
 def run(self): subprocess.run(self._action,shell=True,check=True)
def main(args):
 assert args==['runhooks','--jobs','2']
 Hook().run()
 return 0
`,
    );
    const guarded = execFileSync(
      python,
      dependencyHookArguments(depot, adapter.file, adapter.pin),
      { encoding: "utf8", timeout: 10000, cwd: directory, env },
    );
    assert.deepEqual(JSON.parse(guarded), ["two words", "a+b@c", ""]);
    await assert.rejects(
      preparePython3Adapter(path.join(directory, "commands"), python, budget),
      /EEXIST/,
    );
    for (const value of [
      "C:/bad%PATH%/python.exe",
      "C:/bad&echo/python.exe",
      "C:/owned/../python.exe",
      "python.exe",
    ])
      assert.throws(() => python3Adapter(value), /FULL_PYTHON_ADAPTER_PATH/);
    assert.deepEqual(await fs.readFile(adapter.file), python3Adapter(python));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual gclient hook wrapper binds absolute adapter and preserves original condition dispatch", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-hook-dispatch-"),
  );
  try {
    const adapter = path.join(directory, "python3.bat"),
      raw = Buffer.from("BENIGN ADAPTER DATA");
    await fs.writeFile(adapter, raw);
    const fixture = `import os
class Hook:
 def __init__(self): self._action=('python3','src/test.py','two words'); self.condition='checkout_win'
 def run(self):
  assert self.condition=='checkout_win'
  assert self._action==(os.path.join(os.path.dirname(__file__),'python3.bat'),'src/test.py','two words')
  print('FIXED_ADAPTER_DISPATCH')
def main(args):
 assert args==['runhooks','--jobs','2']
 hook=Hook(); hook.run()
 assert hook._action==('python3','src/test.py','two words')
 return 0
`;
    await fs.writeFile(path.join(directory, "gclient.py"), fixture);
    const args = dependencyHookArguments(directory, adapter, {
      sha256: sha(raw),
    });
    const run = () =>
      execFileSync(python, args, {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        stdio: "pipe",
      });
    assert.match(run(), /FIXED_ADAPTER_DISPATCH/);
    await fs.writeFile(adapter, "changed");
    assert.throws(
      run,
      (error) =>
        error.stderr.includes("FULL_PYTHON_ADAPTER_PIN") &&
        !error.stdout.includes("FIXED_ADAPTER_DISPATCH"),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual pinned-gclient API projection retains nested conditions and origins with bounded failure", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-hook-projection-"),
  );
  try {
    const fixture = `import types
class OptionParser:
 def parse_args(self,args):
  assert args==['--jobs','2']
  return types.SimpleNamespace(),[]
class Client:
 def __init__(self,options): self.options=options
 def RunOnDeps(self,command,args,progress):
  assert command=='flatten' and args==[] and progress is False
  assert self.options.nohooks and self.options.noprehooks and self.options.process_all_deps
  return 0
class GClient:
 @staticmethod
 def LoadCurrentConfig(options): return Client(options)
class Flattener:
 def __init__(self,client,pin_all_deps):
  assert pin_all_deps
  self._hooks=[(None,types.SimpleNamespace(name='nested',condition='checkout_win',pattern='.',effective_cwd='src/nested',action=['python3','src/nested/tool.py']))]
  self._pre_deps_hooks=[(None,types.SimpleNamespace(name='pre',condition='False',pattern=None,effective_cwd='.',action=['vpython3','src/pre.py']))]
  self.deps_files=[('https://example.invalid/repo@'+'a'*40,'DEPS',(('src','https://example.invalid/repo@'+'a'*40),))]
`;
    await fs.writeFile(path.join(directory, "gclient.py"), fixture);
    const args = hookProjectionArguments(directory);
    const raw = execFileSync(python, args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
    const projection = validateHookProjection(raw);
    assert.deepEqual(
      projection.hooks.map((row) => [row.name, row.condition, row.kind]),
      [
        ["nested", "checkout_win", "hooks"],
        ["pre", "False", "pre_deps_hooks"],
      ],
    );
    assert.equal(projection.origins[0].hierarchy[0][0], "src");
    const packet = (value) =>
      "FULL_HOOK_PROJECTION:" + JSON.stringify(value) + "\n";
    for (const mutate of [
      (value) => (value.hooks[0].cwd = "../foreign"),
      (value) => (value.hooks[0].action = ["python3", "%PATH%"]),
      (value) => (value.hooks[0].action = ["python3", "x&echo y"]),
      (value) => (value.hooks[0].extra = true),
      (value) => (value.origins[0].deps_file = ".git/config"),
      (value) => (value.origins[0].hierarchy[0][0] = "/foreign"),
      (value) => (value.origins[0].url = "https://example.invalid/repo@main"),
      (value) => value.origins.push(value.origins[0]),
      (value) => (value.hooks = Array(513).fill(value.hooks[0])),
    ]) {
      const changed = structuredClone(projection);
      mutate(changed);
      assert.throws(() => validateHookProjection(packet(changed)), /FULL_/);
    }
    assert.throws(
      () => validateHookProjection(raw + raw),
      /FULL_HOOK_PROJECTION_PACKET/,
    );
    assert.throws(
      () => validateHookProjection(raw + "trailing"),
      /FULL_HOOK_PROJECTION_PACKET/,
    );
    assert.throws(
      () => validateHookProjection("x".repeat(4 * 1024 ** 2 + 1)),
      /FULL_HOOK_PROJECTION_BOUND/,
    );
    await fs.writeFile(
      path.join(directory, "gclient.py"),
      fixture
        .replace("self._hooks=[", "self._hooks=[")
        .replace(
          "self._pre_deps_hooks=[",
          "self._hooks*=513\n  self._pre_deps_hooks=[",
        ),
    );
    assert.throws(
      () =>
        execFileSync(python, args, {
          cwd: directory,
          encoding: "utf8",
          timeout: 10000,
          stdio: "pipe",
        }),
      (error) => error.status !== 0 && error.stderr.includes("FULL_HOOK_COUNT"),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual origin retention shares the existing cap and preserves deadline identity without an unbounded append", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-hook-retain-"),
  );
  try {
    const file = path.join(directory, "hook-projection.stdout.log");
    await fs.writeFile(file, "projection\n");
    const original = await fs.readFile(file),
      projection = { origins: [] },
      limits = { bytes: original.length, cap: 4096 };
    await retainHookOrigins(
      file,
      projection,
      { remaining: () => 1000 },
      limits,
    );
    assert.match(await fs.readFile(file, "utf8"), /FULL_HOOK_ORIGIN_PINS:/);
    assert.equal(limits.bytes, (await fs.stat(file)).size);
    const retained = await fs.readFile(file);
    await assert.rejects(
      retainHookOrigins(
        file,
        projection,
        { remaining: () => 1000 },
        { bytes: 0, cap: 1 },
      ),
      /FULL_HOOK_PROJECTION_BOUND/,
    );
    assert.deepEqual(await fs.readFile(file), retained);
    const sentinel = new Error("owned deadline");
    await assert.rejects(
      retainHookOrigins(
        file,
        projection,
        {
          remaining: () => {
            throw sentinel;
          },
        },
        limits,
      ),
      (error) => error === sentinel,
    );
    assert.deepEqual(await fs.readFile(file), retained);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual GN wrapper uses real selector then denies alternate, alias and byte mismatch before a benign main", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-gn-selector-"),
  );
  try {
    const expected = path.join(directory, "gn.exe"),
      alternate = path.join(directory, "alternate.exe"),
      body = Buffer.from("BENIGN DATA, NEVER EXECUTED"),
      pin = { bytes: body.length, sha256: sha(body) };
    await fs.writeFile(expected, body);
    await fs.writeFile(alternate, body);
    await fs.writeFile(
      path.join(directory, "gclient_util.py"),
      "import subprocess\ndef RunAction(directory,command):\n subprocess.run(command,cwd=directory,check=True)\n",
    );
    await fs.writeFile(
      path.join(directory, "hook.py"),
      "from gclient_util import RunAction\nRunAction('.', ['gn','gen','out/owned'])\n",
    );
    const hooks = [
      "-B",
      "-c",
      "unused",
      path.join(directory, "hook.py"),
      path.join(directory, "gn.py"),
    ];
    const args = boundGnArguments(hooks, expected, pin);
    const run = () =>
      execFileSync(python, args, {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        stdio: "pipe",
      });
    const module = (candidate) =>
      `import sys\ndef FindGnTool(): return ${JSON.stringify(candidate)}\ndef main(args):\n selected=FindGnTool()\n assert args[1:]==['gen','out/owned']\n print('BENIGN_SELECTOR_OK')\n return 0\nif __name__=='__main__': sys.exit(main(sys.argv))\n`;
    await fs.writeFile(path.join(directory, "gn.py"), module(expected));
    assert.match(run(), /BENIGN_SELECTOR_OK/);
    await fs.writeFile(path.join(directory, "gn.py"), module(alternate));
    // The old selector contract reaches benign main with the alternate path.
    assert.match(
      execFileSync(
        python,
        ["-B", path.join(directory, "gn.py"), "gen", "out/owned"],
        { cwd: directory, encoding: "utf8", timeout: 10000 },
      ),
      /BENIGN_SELECTOR_OK/,
    );
    assert.throws(
      run,
      (error) =>
        error.stderr.includes("FULL_GN_SELECTOR") &&
        !error.stdout.includes("BENIGN_SELECTOR_OK"),
    );
    await fs.writeFile(path.join(directory, "gn.py"), module(expected));
    await fs.writeFile(expected, Buffer.from("WRONG DATA, NEVER EXECUTED"));
    assert.throws(
      run,
      (error) =>
        error.stderr.includes("FULL_GN_SELECTOR_") &&
        !error.stdout.includes("BENIGN_SELECTOR_OK"),
    );
    await fs.writeFile(expected, body);
    const hardlink = path.join(directory, "gn-hardlink.exe");
    await fs.link(expected, hardlink);
    assert.throws(
      run,
      (error) =>
        error.stderr.includes("FULL_GN_SELECTOR_FILE") &&
        !error.stdout.includes("BENIGN_SELECTOR_OK"),
    );
    await fs.unlink(hardlink);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual GN runner denies shared nlink, birth and availability mismatches before reading and keeps the primary through close", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-gn-crossview-"),
  );
  try {
    const expected = path.join(directory, "gn.exe"),
      raw = Buffer.from("INERT DATA NEVER EXECUTED");
    await fs.writeFile(expected, raw);
    await fs.writeFile(
      path.join(directory, "gclient_util.py"),
      "import subprocess\ndef RunAction(directory,command): subprocess.run(command,cwd=directory,check=True)\n",
    );
    await fs.writeFile(
      path.join(directory, "hook.py"),
      "from gclient_util import RunAction\nRunAction('.', ['gn','gen','out/owned'])\n",
    );
    const args = boundGnArguments(
      [
        "-B",
        "-c",
        "unused",
        path.join(directory, "hook.py"),
        path.join(directory, "gn.py"),
      ],
      expected,
      { bytes: raw.length, sha256: sha(raw) },
    );
    for (const fault of [
      "nlink",
      "birth",
      "availability",
      "missing-windows-birth",
    ]) {
      const fixture = `import os,types,builtins
fault=${JSON.stringify(fault)}
original_stat,original_fstat,original_open=os.stat,os.fstat,builtins.open
def view(s,fd):
 names=('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink')
 values={name:getattr(s,name) for name in names}
 values['st_birthtime_ns']=getattr(s,'st_birthtime_ns',123456789)
 if fd and fault=='nlink': values['st_nlink']+=1
 if fd and fault=='birth': values['st_birthtime_ns']+=1
 if fault=='missing-windows-birth' or (fd and fault=='availability'): del values['st_birthtime_ns']
 return types.SimpleNamespace(**values)
os.stat=lambda *args,**kwargs:view(original_stat(*args,**kwargs),False)
os.fstat=lambda fd:view(original_fstat(fd),True)
if fault=='missing-windows-birth': os.name='nt'
class Held:
 def __init__(self,file): self.file=file
 def __getattr__(self,name): return getattr(self.file,name)
 def read(self,*args): raise RuntimeError('READ_BEFORE_SHARED_IDENTITY')
 def close(self):
  self.file.close()
  raise RuntimeError('SECONDARY_CLOSE_MUST_NOT_REPLACE_PRIMARY')
builtins.open=lambda *args,**kwargs:Held(original_open(*args,**kwargs))
def FindGnTool(): return ${JSON.stringify(expected)}
def main(args):
 FindGnTool()
 print('BENIGN_MAIN_MUST_NOT_BE_REACHED')
 return 0
`;
      await fs.writeFile(path.join(directory, "gn.py"), fixture);
      assert.throws(
        () =>
          execFileSync(python, args, {
            cwd: directory,
            encoding: "utf8",
            timeout: 10000,
            stdio: "pipe",
          }),
        (error) =>
          error.status !== 0 &&
          error.stderr.includes(
            fault === "missing-windows-birth"
              ? "FULL_GN_SELECTOR_BIRTH"
              : "FULL_GN_SELECTOR_CHANGED",
          ) &&
          !error.stderr.includes("READ_BEFORE_SHARED_IDENTITY") &&
          !error.stderr.includes("SECONDARY_CLOSE_MUST_NOT_REPLACE_PRIMARY") &&
          !error.stdout.includes("BENIGN_MAIN_MUST_NOT_BE_REACHED"),
        fault,
      );
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("source GN remains denied until reviewed host byte and execution closure while historical input stays distinct", async () => {
  assert.throws(() => reviewedHostTools(profile), /FULL_HOST_TOOL_PIN_MISSING/);
  assert.deepEqual(profile.sourceGn.executionPolicy, {
    hostLoaderClosureApproved: false,
    gitConfigurationApproved: true,
    sourceHookCommandClosureApproved: false,
  });
  assert.equal(
    profile.sourceGn.sourceId,
    "b04bd747863065cb2cd5a52088ac36d24427b1e505b269c234d4ee5f444077be",
  );
  assert.notEqual(profile.sourceId, profile.sourceGn.sourceId);
  assert.equal(profile.sourceData.length, 29);
  assert.equal(profile.sourceGn.sourceData.length, 30);
  for (const row of [
    ...profile.sourceGn.sourceData,
    ...profile.sourceGn.helpers,
  ]) {
    const bytes = await fs.readFile(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes);
    assert.equal(sha(bytes), row.sha256);
  }
  const lock = JSON.parse(
    await read(profile.sourceGn.namespace + "source-lock.json"),
  );
  validateSourceLock(lock);
  assert.equal(identitySha256(lock), profile.sourceGn.sourceId);
  const gn = await read(
    profile.sourceGn.namespace + lock.builds[0].gnArgs.path,
  );
  assert(gn.includes('v8_symbol_level=0\nhost_cpu="x64"'));
  assert(!gn.includes("0host_cpu"));
});

test("actual source driver command plan has only fixed sync, hooks, three setup verifications and GN", () => {
  const p = syntheticSourcePins(),
    operation = path.join(
      root,
      ".artifacts",
      "windows-arm-full-sdk-" + "a".repeat(36),
    );
  const files = sourcePaths(operation, p),
    hooks = cefHookArguments(files.cef, files.depot);
  const commands = sourceCommands(operation, p, hooks, "b".repeat(64));
  assert.deepEqual(
    commands.map((row) => row.role),
    [
      "sync",
      "hook-projection",
      "dependency-hooks",
      "setup-x86",
      "setup-x64",
      "setup-arm64",
      "verify-setup",
      "cef-gn",
    ],
  );
  assert(Object.isFrozen(commands));
  assert(
    commands.every((row) => Object.isFrozen(row) && Object.isFrozen(row.args)),
  );
  assert(commands.every((row) => row.executable === profile.python.path));
  assert(commands[0].args.includes("--noprehooks"));
  assert.deepEqual(commands[1].args, hookProjectionArguments(files.depot));
  assert(
    commands.findIndex((row) => row.role === "hook-projection") <
      commands.findIndex((row) => row.role === "dependency-hooks"),
  );
  assert.deepEqual(commands.at(-1).args, hooks);
  assert(
    !commands.some((row) =>
      /autoninja|make_distrib|--compile|--restore/.test(row.args.join(" ")),
    ),
  );
  for (const changed of [
    ["-c", "arbitrary"],
    [...hooks, "--extra"],
  ])
    assert.throws(
      () => sourceCommands(operation, p, changed, "b".repeat(64)),
      /FULL_HOOK_COMMAND/,
    );
  assert.throws(
    () => sourceCommands(operation, p, hooks, "not-a-context"),
    /FULL_CONTEXT_PIN/,
  );
});

test("actual source driver budget is bounded by the original wall interval and its own monotonic admission", () => {
  let wall = 1000,
    mono = 20;
  const budget = sourceBudget(
    { wallWorkEnd: 3 },
    profile,
    () => wall,
    () => mono,
  );
  assert.equal(budget.remaining(), 2000);
  wall = 0;
  mono += 1999;
  assert.equal(budget.remaining(), 1);
  mono++;
  assert.throws(() => budget.remaining(), /FULL_DRIVER_DEADLINE/);
  assert.throws(
    () =>
      sourceBudget(
        { wallWorkEnd: 0 },
        profile,
        () => 1,
        () => 1,
      ),
    /FULL_DRIVER_CLOCK/,
  );
  assert.equal(profile.sourceGn.limits.wholeSeconds, 7200);
  assert.equal(profile.sourceGn.limits.cleanupSeconds, 30);
  assert.equal(profile.sourceGn.limits.finalReserveSeconds, 120);
  assert.equal(profile.limits.wholeSeconds, 3600);
  assert.equal(profile.sourceGn.limits.memoryBytes, 8 * 1024 ** 3);
  assert.equal(profile.sourceGn.limits.processes, 64);
});

test("source child environment is constructed without inherited credentials, proxy, remote execution or PATH fallback", () => {
  const p = syntheticSourcePins(),
    operation = path.join(
      root,
      ".artifacts",
      "windows-arm-full-sdk-" + "a".repeat(36),
    );
  const recipe = {
    requiredHost: "win32",
    target: "aarch64-pc-windows-msvc",
    commands: [{ args: ["cef/tools/gclient_hook.py"] }, {}, {}],
    environment: { DEPOT_TOOLS_UPDATE: "0", DEPOT_TOOLS_WIN_TOOLCHAIN: "0" },
  };
  const env = sourceEnvironment(operation, p, recipe);
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.ComSpec, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(env.PATH.split(";")[0], path.join(operation, "source-commands"));
  assert.equal(env.CEF_ENABLE_ARM64, "1");
  assert.equal(env.CEF_VCVARS, "none");
  for (const key of [
    "GITHUB_TOKEN",
    "HTTPS_PROXY",
    "RBE_instance",
    "SSH_AUTH_SOCK",
    "NODE_OPTIONS",
  ])
    assert.equal(env[key], undefined);
  assert(env.PATH.includes(path.dirname(p.sourceGn.hostTools.git.path)));
  assert(!env.PATH.includes(process.env.PATH));
  assert.equal(env.SDK_VERSION, "10.0.28000.0");
  assert.equal(env.SDK_ROOT, path.join(operation, "Windows Kits/10"));
});

test("generated GN critical arguments bind ARM target, x64 host, local tools, sandbox and tracer without compiler admission", () => {
  const lines = [
    'target_cpu="arm64"',
    'host_cpu="x64"',
    "is_clang=true",
    "use_lld=true",
    "use_remoteexec=false",
    "use_siso=true",
    "is_component_build=false",
    "is_debug=false",
    "enable_backup_ref_ptr_instance_tracer=false",
  ];
  const raw = Buffer.from(lines.join("\n"));
  const result = validateGeneratedArguments(raw);
  assert.equal(result.criticalArgumentsVerified, true);
  assert.equal(result.compilerAdmission, false);
  assert.equal(result.generatedSecurityHeadersVerified, false);
  for (const bad of [
    lines.slice(1).join("\n"),
    lines.join("\n") + '\nhost_cpu="x64"',
    lines.join("\n") + "\nenable_sandbox=false",
    lines.join("\n") + "\nenable_sandbox=!false",
    lines.join("\n").replace("use_remoteexec=false", "use_remoteexec=true"),
    lines.join("\n").replace("instance_tracer=false", "instance_tracer=true"),
    lines.join("\n").replace('target_cpu="arm64"', 'target_cpu="x64"'),
  ])
    assert.throws(
      () => validateGeneratedArguments(Buffer.from(bad)),
      /FULL_GN_/,
    );
  assert.throws(
    () => validateGeneratedArguments(Buffer.from([255])),
    /encoded data|encoding/i,
  );
  assert.throws(
    () => validateGeneratedArguments(Buffer.alloc(0)),
    /FULL_GN_ARGS_BOUND/,
  );
});

async function actualCommandModel(overrides = {}) {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("async function executeCommand("),
    end = text.indexOf("export async function main(", begin);
  assert(begin >= 0 && end > begin);
  const closed = [],
    opened = [],
    child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let spawnCount = 0;
  const scope = {
    path,
    Buffer,
    sourceCloseFailure: false,
    need: (ok, code) => assert(ok, code),
    clearTimeout: () => {},
    setTimeout: () => ({}),
    openSync: (file) => {
      opened.push(file);
      return opened.length + 6;
    },
    closeSync: (fd) => closed.push(fd),
    writeSync: (_fd, chunk) => chunk.length,
    spawn: () => {
      spawnCount++;
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
    ...overrides,
  };
  const context = vm.createContext(scope),
    actual = vm.runInContext("(" + text.slice(begin, end) + ")", context);
  const command = {
    role: "owned",
    executable: "never-executed",
    args: [],
    cwd: "owned",
  };
  let failed = false,
    error;
  try {
    await actual(
      command,
      [command],
      {},
      { logs: "owned" },
      { remaining: () => 500000 },
      { bytes: 0, cap: 1024 },
      false,
    );
  } catch (value) {
    failed = true;
    error = value;
  }
  return { scope, closed, opened, spawnCount, failed, error };
}

test("actual command body closes partial startup resources and preserves exact primary through close faults", async () => {
  for (const sentinel of [new Error("owned open failure"), null, false]) {
    let calls = 0;
    const closed = [];
    const result = await actualCommandModel({
      openSync: () => {
        if (++calls === 2) throw sentinel;
        return 7;
      },
      closeSync: (fd) => {
        closed.push(fd);
        throw new Error("owned close failure");
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.error, sentinel);
    assert.deepEqual(closed, [7]);
    assert.equal(result.spawnCount, 0);
    assert.equal(result.scope.sourceCloseFailure, true);
  }
});

test("actual command body denies close-only errors after closing both logs and keeps ordinary success", async () => {
  const closeError = new Error("owned close-only failure"),
    closed = [];
  const denied = await actualCommandModel({
    closeSync: (fd) => {
      closed.push(fd);
      if (fd === 7) throw closeError;
    },
  });
  assert.equal(denied.error, closeError);
  assert.equal(denied.failed, true);
  assert.deepEqual(closed, [7, 8]);
  assert.equal(denied.scope.sourceCloseFailure, true);
  const good = await actualCommandModel();
  assert.equal(good.failed, false);
  assert.deepEqual(good.closed, [7, 8]);
  assert.equal(good.spawnCount, 1);
});

test("actual stage supervisor clamps the declared phase to original remaining work and clears its timer", async () => {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("async function sourceStage("),
    end = text.indexOf("async function executeCommand(", begin);
  assert(begin >= 0 && end > begin);
  let now = 0,
    delay,
    callback,
    cleared = 0;
  const records = [];
  const exit = new Error("owned exit sentinel");
  const actual = vm.runInNewContext("(" + text.slice(begin, end) + ")", {
    need: (ok, code) => {
      if (!ok) throw new Error(code);
    },
    path,
    performance: { now: () => now },
    setTimeout: (fn, ms) => {
      callback = fn;
      delay = ms;
      return 1;
    },
    clearTimeout: () => {
      cleared++;
    },
    writeFileSync: (_file, raw) => records.push(JSON.parse(raw)),
    process: {
      exit: (code) => {
        assert.equal(code, 124);
        throw exit;
      },
    },
  });
  assert.equal(
    await actual(
      "owned",
      { remaining: () => 500000 },
      "source-acquisition",
      4500,
      async () => "ok",
    ),
    "ok",
  );
  assert.equal(delay, 380000);
  assert.equal(cleared, 1);
  await assert.rejects(
    actual(
      "owned",
      { remaining: () => 120000 },
      "source-acquisition",
      4500,
      async () => assert.fail("No reserve"),
    ),
    /FULL_SOURCE_RESERVE/,
  );
  await assert.rejects(
    actual(
      "owned",
      { remaining: () => 500000 },
      "source-acquisition",
      4500,
      async () => {
        now += 380000;
      },
    ),
    /FULL_SOURCE_STAGE_DEADLINE/,
  );
  let caught;
  try {
    await actual(
      "owned",
      { remaining: () => 500000 },
      "source-hooks-gn",
      1800,
      async () => {
        callback();
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, exit);
  assert.equal(records.at(-1).firstFailure, "FULL_SOURCE_STAGE_DEADLINE");
  assert.equal(records.at(-1).cleanupNotInferred, true);
});

test("actual stage supervisor preserves thrown null and performs no compiler or unowned process signaling", async () => {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("async function sourceStage("),
    end = text.indexOf("async function executeCommand(", begin);
  let closed = 0,
    failed = false,
    value;
  const actual = vm.runInNewContext("(" + text.slice(begin, end) + ")", {
    need: (ok, code) => assert(ok, code),
    path,
    performance: { now: () => 0 },
    setTimeout: () => 1,
    clearTimeout: () => closed++,
    writeFileSync: () => assert.fail("No deadline"),
    process: { exit: () => assert.fail("No exit") },
  });
  try {
    await actual(
      "owned",
      { remaining: () => 500000 },
      "source-hooks-gn",
      1800,
      async () => {
        throw null;
      },
    );
  } catch (error) {
    failed = true;
    value = error;
  }
  assert.equal(failed, true);
  assert.equal(value, null);
  assert.equal(closed, 1);
});

const PURE_GATE = String.raw`      - name: Validate pure full SDK input contracts before any data Job
        shell: pwsh
        env:
          SystemRoot: C:\Windows
          WINDIR: C:\Windows
          PYTHONDONTWRITEBYTECODE: "1"
          PYTHONPYCACHEPREFIX: ""
        run: |
          & 'C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe' -I -B native/windows-arm-full-sdk/test_producer.py
          exit $LASTEXITCODE
`;
function pureGateContract(source) {
  assert(Buffer.byteLength(source) <= 65536);
  const marker = PURE_GATE.split("\n")[0] + "\n";
  const parts = source.split(marker);
  assert.equal(parts.length, 2);
  const next = parts[1].indexOf("      - ");
  assert(next >= 0);
  assert.equal(marker + parts[1].slice(0, next), PURE_GATE);
  const node =
    "        run: node --test tests/tooling/windowsArmFullSdk.node-test.mjs\n";
  assert(parts[0].endsWith(node));
  const data =
    "      - name: Owned bootstrap data acquisition without executing acquired tools\n";
  assert.equal(source.split(data).length, 2);
  assert(source.indexOf(data) > source.indexOf(marker));
}

test("hosted pure Python gate uses only fixed profile interpreter before the first data Job", () => {
  pureGateContract(workflow);
  assert.equal(
    profile.python.path,
    "C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe",
  );
  for (const wrong of [
    workflow.replace(
      "3.12.10/x64/python.exe' -I -B",
      "3.13.0/x64/python.exe' -I -B",
    ),
    workflow.replace(PURE_GATE, "") + PURE_GATE,
    workflow.replace(
      PURE_GATE,
      PURE_GATE.replace("        shell:", "        if: false\n        shell:"),
    ),
    workflow.replace(
      PURE_GATE,
      PURE_GATE.replace(
        "        shell:",
        "        continue-on-error: true\n        shell:",
      ),
    ),
  ])
    assert.throws(() => pureGateContract(wrong));
});

test("source modes own exactly eleven files with historical input scope and no selected Unix producer edits", () => {
  assert.deepEqual(profile.sourcePaths, [
    workflowPath,
    ...[
      "profile.json",
      "acquire.py",
      "extract.py",
      "environment.py",
      "producer.py",
      "checkpoint.py",
      "job.py",
      "test_producer.py",
      "source-driver.mjs",
    ].map((n) => prefix + n),
    "tests/tooling/windowsArmFullSdk.node-test.mjs",
  ]);
  assert.equal(new Set(profile.sourcePaths).size, 11);
  assert(profile.sourcePaths.every((p) => !p.startsWith("scripts/")));
  assert.deepEqual(profile.modes, [
    "input-closure",
    "command-inventory",
    "source-gn",
  ]);
  assert.equal(profile.buildAdmission, false);
  for (const value of Object.values(profile.claims)) assert.equal(value, false);
});

test("distinct cross-host namespace preserves all24 raw payloads and truthful source-only identity", async () => {
  const namespace =
    "native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64";
  const old =
    "native/cef-build-inputs/20261025-r5-capsule22-windows-arm64-native";
  const load = async (n) => JSON.parse(await read(namespace + "/" + n));
  const lock = await load("source-lock.json"),
    review = await load("review-receipt.json");
  validateSourceLock(lock);
  assert.equal(identitySha256(lock), profile.sourceId);
  assert.equal(review.sourceLockIdentity, profile.sourceId);
  assert.notEqual(
    profile.sourceId,
    "839fdbee4973c236e111445af98f5de8c3c165563f1f64b1be781d69f1074b34",
  );
  const payloads = [
    ...lock.patches.map((p) => p.path),
    lock.bridge.header.path,
    "upstream-sha256.json",
  ];
  assert.equal(payloads.length, 24);
  for (const leaf of payloads) {
    const a = await fs.readFile(path.join(root, namespace, leaf)),
      b = await fs.readFile(path.join(root, old, leaf));
    assert.deepEqual(a, b);
  }
  assert.equal(profile.sourceData.length, 29);
  assert.equal(new Set(profile.sourceData.map((r) => r.path)).size, 29);
  for (const row of profile.sourceData) {
    const raw = await fs.readFile(path.join(root, row.path));
    assert.equal(raw.length, row.bytes);
    assert.equal(sha(raw), row.sha256);
  }
  const runner = await load("cef-ci-runner-aarch64-pc-windows-msvc.json");
  assert.equal(runner.hosted.architecture, "x64");
  assert.equal(runner.hosted.acceptanceRunner, "windows-11-arm");
  assert(!Object.hasOwn(runner, "git"));
  assert.throws(() => validateRunnerMap(runner, "aarch64-pc-windows-msvc"));
  for (const build of lock.builds)
    for (const role of ["gnArgs", "toolchainLock"])
      assert.equal(
        sha(await fs.readFile(path.join(root, namespace, build[role].path))),
        build[role].sha256,
      );
  assert.equal(review.hostSelection.runner, "windows-2025-vs2026");
  assert.equal(review.buildAdmissionGranted, false);
  assert.equal(review.publicationAllowed, false);
});

test("full phase map keeps all executable and compiled checkpoint authority unavailable", () => {
  assert.deepEqual(profile.phaseAdmission, {
    "input-closure": true,
    "source-gn": false,
    "engine-pilot": false,
    "compiled-checkpoint": false,
    "compiled-restore": false,
    "sdk-package": false,
    "command-inventory": true,
  });
  assert.equal(profile.programs.length, 7);
  assert.equal(profile.runtime17.rows.length, 17);
  assert.equal(
    profile.runtime17.rows.reduce((sum, row) => sum + row.bytes, 0),
    21356560,
  );
  assert.equal(profile.sdk.version, "10.0.28000.2270");
  assert(
    profile.runtime17.rows
      .filter((r) => r.role.startsWith("debugger-"))
      .every((r) => r.fileVersion === "10.0.26100.9457"),
  );
  assert(
    profile.runtime17.rows.every((r) =>
      r.destination.startsWith(
        r.machine === 34404 ? "runtime/x64/" : "runtime/arm64/",
      ),
    ),
  );
  assert(
    profile.missingClosures.some((x) => x.includes("Windows source metadata")),
  );
});

test("workflow is manual public fixed branch with truthful default Main, read permission and cancels older diagnostic", () => {
  assert.match(
    workflow,
    /on:\n  workflow_dispatch:\n    inputs:\n      mode:\n        type: choice\n/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  for (const required of [
    "github.event_name == 'workflow_dispatch'",
    "github.event.repository.visibility == 'public'",
    "github.repository_id == '1010282954'",
    "github.event.repository.default_branch == 'main'",
    "github.ref == 'refs/heads/codex/windows-arm-source-gn-20261026'",
  ])
    assert(workflow.includes(required));
  assert.match(workflow, /runs-on: windows-2025-vs2026/);
  assert(
    !/contents: write|pull_request_target|secrets\.|workflow_call|schedule:/.test(
      workflow,
    ),
  );
});

test("Node 24 uses maintained pinned setup, exact workflow and Python source witnesses", async () => {
  assert.match(
    workflow,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
  );
  assert.match(workflow, /node-version-file: "\.node-version"/);
  assert.match(workflow, /e\.GITHUB_WORKFLOW_SHA===e\.GITHUB_SHA/);
  assert.match(
    workflow,
    /\['cat-file','blob',process\.env\.GITHUB_SHA\+':\'\+file\]/,
  );
  assert(
    workflow.includes(
      "file==='.github/workflows/windows-x64-arm-toolchain.yml'||file==='tests/tooling/windowsArmFullSdk.node-test.mjs'",
    ),
  );
  assert(workflow.includes("text.replaceAll('\\n','\\r\\n')"));
  assert.equal(
    profile.python.sha256,
    "4d6f5f81a4bca11191c4c7c6b43632694d0a4ce74e068619d8fdc161d469859a",
  );
  for (const name of ["producer.py", "job.py"])
    assert((await read(prefix + name)).includes(sha(profileRaw)));
});

test("actual Node carrier authority denies Main, foreign branches and forged default/source/input identity", () => {
  const begin = workflow.indexOf("// BEGIN FIXED CARRIER AUTHORITY");
  const end = workflow.indexOf("// END FIXED CARRIER AUTHORITY", begin);
  assert(begin >= 0 && end > begin);
  const authority = vm.runInNewContext(
    workflow.slice(begin, end) + "\ncarrierAuthority;",
    { assert, Object },
  );
  const ref = "refs/heads/codex/windows-arm-source-gn-20261026";
  const env = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: ref,
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/windows-x64-arm-toolchain.yml@" +
      ref,
  };
  const event = {
    repository: {
      id: 1010282954,
      full_name: "supermarsx/sortOfRemoteNG",
      private: false,
      visibility: "public",
      default_branch: "main",
    },
    inputs: { mode: "command-inventory" },
  };
  assert.equal(authority(env, event), "command-inventory");
  assert.equal(
    authority(env, { ...event, inputs: { mode: "source-gn" } }),
    "source-gn",
  );
  for (const [key, value] of [
    ["GITHUB_REF", "refs/heads/main"],
    ["GITHUB_REF", ref + "-other"],
    ["CEF_DEFAULT_BRANCH", ref.slice("refs/heads/".length)],
    ["GITHUB_REPOSITORY", "foreign/repo"],
    ["GITHUB_REPOSITORY_ID", "1"],
    ["GITHUB_REPOSITORY_VISIBILITY", "private"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_SHA", "x".repeat(40)],
    [
      "GITHUB_WORKFLOW_REF",
      env.GITHUB_WORKFLOW_REF.replace(
        "windows-x64-arm-toolchain.yml",
        "cef-windows-arm-full-sdk.yml",
      ),
    ],
  ])
    assert.throws(
      () => authority({ ...env, [key]: value }, event),
      /BOOT_CARRIER_AUTHORITY/,
    );
  for (const change of [
    { inputs: null },
    { inputs: {} },
    { inputs: { mode: "compile" } },
    { inputs: [] },
    { repository: { ...event.repository, private: true } },
    {
      repository: {
        ...event.repository,
        default_branch: ref.slice("refs/heads/".length),
      },
    },
  ])
    assert.throws(
      () => authority(env, { ...event, ...change }),
      /BOOT_CARRIER_AUTHORITY/,
    );
});

test("checkout-only fixed Git environment preserves raw native LF pins despite autocrlf=true", async (t) => {
  const checkout = workflow.slice(
    workflow.indexOf("      - uses: actions/checkout@"),
    workflow.indexOf("      - uses: actions/setup-node@"),
  );
  const expected = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.autocrlf",
    GIT_CONFIG_VALUE_0: "false",
  };
  const actual = Object.fromEntries(
    [
      ...checkout.matchAll(
        /^          (GIT_CONFIG_(?:COUNT|KEY_0|VALUE_0)): "?([^"\n]+)"?$/gm,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(actual, expected);
  for (const key of Object.keys(expected))
    assert.equal(workflow.split(key + ":").length, 2);
  const parent = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "bootstrap-checkout-"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/i.test(key),
    ),
  );
  const empty = path.join(parent, "empty-config"),
    hooks = path.join(parent, "empty-hooks");
  await fs.writeFile(empty, "");
  await fs.mkdir(hooks);
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = (cwd, args, extra = {}) =>
    execFileSync("git", ["-c", "core.hooksPath=" + hooks, ...args], {
      cwd,
      env: { ...env, ...extra },
      encoding: "buffer",
      timeout: 10000,
      maxBuffer: 2097152,
    });
  try {
    const source = path.join(parent, "source");
    await fs.mkdir(source);
    git(source, ["init", "--quiet"]);
    git(source, ["config", "user.name", "Owned synthetic fixture"]);
    git(source, ["config", "user.email", "owned-fixture@example.invalid"]);
    git(source, ["config", "core.autocrlf", "true"]);
    const relative = "native/windows-arm-full-sdk/profile.json",
      file = path.join(source, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, profileRaw);
    assert(!profileRaw.includes(13));
    git(source, ["add", "--", relative], expected);
    git(
      source,
      [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Synthetic LF fixture",
      ],
      expected,
    );
    assert.deepEqual(
      git(source, ["cat-file", "blob", "HEAD:" + relative]),
      profileRaw,
    );
    const observations = [];
    for (const [name, override] of [
      ["old", {}],
      ["fixed", actual],
    ]) {
      const dest = path.join(parent, name);
      git(parent, [
        "clone",
        "--quiet",
        "--no-checkout",
        "--no-hardlinks",
        source,
        dest,
      ]);
      git(dest, ["config", "core.autocrlf", "true"]);
      git(dest, ["checkout", "--force", "HEAD"], override);
      const observed = await fs.readFile(path.join(dest, relative));
      observations.push({
        checkout: name,
        rawHashMatched: sha(observed) === sha(profileRaw),
        bytes: observed.length,
        sha256: sha(observed),
      });
      if (name === "old") {
        assert(observed.includes(Buffer.from("\r\n")));
        assert.notEqual(sha(observed), sha(profileRaw));
      } else {
        assert.deepEqual(observed, profileRaw);
        assert.equal(sha(observed), sha(profileRaw));
      }
      assert.equal(
        git(dest, ["config", "--local", "--get", "core.autocrlf"])
          .toString()
          .trim(),
        "true",
      );
    }
    t.diagnostic(
      JSON.stringify({
        kind: "actual-owned-Git-checkout-causal",
        observations,
        localConfigRemainsTrue: true,
      }),
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("fixed Node wrapper is syntactically valid and retains original wall/monotonic budget", () => {
  const marker = "          node --input-type=module <<'NODE'\n";
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("          NODE\n", start);
  assert(start >= 0 && end > start);
  const source = workflow
    .slice(start + marker.length, end)
    .split("\n")
    .map((l) => (l.startsWith("          ") ? l.slice(10) : l))
    .join("\n");
  const body = source.replace(/^import .*;\n/gm, "");
  new vm.Script("(async()=>{\n" + body + "\n})");
  assert(
    source.includes(
      "Math.min(begin+workMs-Date.now(), workMs-(performance.now()-beginMono))",
    ),
  );
  assert(source.includes("remaining()+30000"));
  assert(
    source.includes(
      "['-I','-B',path.join(dir,'producer.py'),'--supervise',root,hash(contextRaw),'--execute']",
    ),
  );
  assert(!/gn\.exe|rustc\.exe|clang-cl\.exe|lld-link\.exe/.test(source));
});

test("only metadata and bounded original Job receipts are retained; hidden flag mandatory", () => {
  const retention = workflow.slice(
    workflow.indexOf("      - name: Retain bootstrap"),
  );
  assert.match(retention, /include-hidden-files: true/);
  assert.match(
    retention,
    /\.artifacts\/windows-arm-full-sdk-\*\/jobs\/\*\/\*\.json/,
  );
  for (const forbidden of [
    "/archives/",
    "/llvm/",
    "/SDK/",
    "**",
    ".tar.xz",
    ".zip",
    ".exe",
    ".nupkg",
  ])
    assert(!retention.includes(forbidden));
  assert.match(retention, /if: always\(\)/);
});

test("fixed acquisitions preserve official SDK28000 and separate Rust/CIPD caps", async () => {
  assert.equal(profile.sdkVersion, "10.0.28000.0");
  assert.equal(profile.sdk.packages.length, 4);
  assert.equal(
    profile.sdk.packages.reduce((s, p) => s + p.bytes, 0),
    370561596,
  );
  assert.equal(profile.rust.bytes, 414479372);
  assert.equal(profile.rust.maximumBytes, 536870912);
  assert.equal(
    profile.llvm.sha256,
    "4c4a15912845f39189784360a03ae62c65dba29b884ef60ec9c6b4d43754dca0",
  );
  assert.deepEqual(
    profile.cipd.map((p) => p.package),
    ["gn/gn/windows-amd64", "build/siso/windows-amd64"],
  );
  assert(
    profile.cipd.every(
      (p) =>
        p.instance.hashAlgo === "SHA256" &&
        p.instance.hexDigest === p.archiveSha256 &&
        p.maximumBytes === 134217728,
    ),
  );
  const producer = await read(prefix + "producer.py");
  assert(producer.includes("sys.addaudithook(no_execution)"));
  assert(
    producer.includes(
      '"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"',
    ),
  );
  assert(!producer.includes("subprocess.Popen("));
});
