import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { execFileSync, spawn, ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { constants as fsConstants } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import * as controlCheckpoint from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";
import * as controlCustom from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import * as publicControl from "../../native/windows-arm-full-sdk/full_sdk_control.mjs";
import {
  identitySha256,
  validateSourceLock,
  prepareSourceGitIsolation,
  sourceGitEnvironment,
} from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs";
import { validateRunnerMap } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs";
import { cefHookArguments } from "../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs";
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
  reviewedHostClosure,
  verifyHostClosure,
  bootstrapProgram,
  prepareBootstrap,
  verifyBootstrap,
  bootstrapShim,
  deriveBootstrapSetup,
  bindBootstrapVector,
  gitPolicyMetadata,
  observeGitHome,
  gitHomeCandidateMetadata,
  gitPolicyDiagnostic,
  appendGitPolicyDiagnostic,
  gitPolicyVerifier,
} from "../../native/windows-arm-full-sdk/source-driver.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (name) => fs.readFile(path.join(root, name), "utf8");
const prefix = "native/windows-arm-full-sdk/";
const workflowPath = ".github/workflows/windows-x64-arm-toolchain.yml";
const rawWorkflow = await read(
  "tests/fixtures/cef/windows-arm-full-sdk-historical/windows-x64-arm-toolchain.yml",
);
const workflow = rawWorkflow.replaceAll("\r\n", "\n");
const profileRaw = await fs.readFile(path.join(root, prefix, "profile.json"));
const profile = JSON.parse(profileRaw);
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Exact c101 Hook.run source, not a rewritten condition model.
const PINNED_HOOK_RUN = {
  gitBlob: "c9bf69dac6b34a3c1e7e6ff49817832905c0bede",
  sha256: "7260c4e825dcd1a3a457625f25b04e7e20aa0b25c2685ce42766a4a5a38493c5",
  source:
    'def run(self):\n        """Executes the hook\'s command (provided the condition is met)."""\n        if self._condition and not gclient_eval.EvaluateCondition(\n            self._condition, self._variables\n        ):\n            return\n\n        cmd = list(self._action)\n\n        if cmd[0] == "vpython3" and _detect_host_os() == "win":\n            cmd[0] += ".bat"\n\n        exit_code = 2\n        try:\n            start_time = time.time()\n            gclient_utils.CheckCallAndFilter(\n                cmd,\n                cwd=self.effective_cwd,\n                print_stdout=True,\n                show_header=True,\n                always_show_header=self._verbose,\n            )\n            exit_code = 0\n        except (gclient_utils.Error, subprocess2.CalledProcessError) as e:\n            # Use a discrete exit status code of 2 to indicate that a hook\n            # action failed.  Users of this script may wish to treat hook action\n            # failures differently from VC failures.\n            print("Error: %s" % str(e), file=sys.stderr)\n            sys.exit(exit_code)\n        finally:\n            elapsed_time = time.time() - start_time\n            metrics.collector.add_repeated(\n                "hooks",\n                {\n                    "action": gclient_utils.CommandToStr(cmd),\n                    "name": self._name,\n                    "cwd": os.path.relpath(\n                        os.path.normpath(self.effective_cwd), self._cwd_base\n                    ),\n                    "condition": self._condition,\n                    "execution_time": elapsed_time,\n                    "exit_code": exit_code,\n                },\n            )\n            if elapsed_time > 10:\n                print(\n                    "Hook \'%s\' took %.2f secs"\n                    % (gclient_utils.CommandToStr(cmd), elapsed_time)\n                )',
};

const PINNED_CIPD_SETUP = {
  gitBlob: "8afa682631ea9200d178bb982e4acd59b4e3d6e0",
  sha256: "3607a1f703b59f213f7fff874cb8d6065b5af17144c66458a0a35e18137069fa",
  source:
    '@echo off\n:: Copyright 2017 The Chromium Authors\n:: Use of this source code is governed by a BSD-style license that can be\n:: found in the LICENSE file.\n\nsetlocal\n\nset "ROOT=%~dp0\\.cipd_bin"\nset "ENSURE=%~dp0\\cipd_manifest.txt"\nset "CACHED_ENSURE=%ROOT%\\.cipd_manifest.txt"\nset "CACHED_VERSIONS=%ROOT%\\.cipd_manifest.versions"\nset "CACHED_CLIENT=%ROOT%\\.cipd_client_version"\n\n:: CIPD ensure is slow (hundreds of milliseconds). We cache the result by\n:: storing copies of the input files and comparing them on subsequent runs.\n:: We use `fc` (content-based) instead of `mtime` comparison to avoid\n:: false-positive cache misses on CI bots where git checkouts reset mtimes.\nif not exist "%CACHED_ENSURE%" goto :RUN_CIPD\nfc /b "%ENSURE%" "%CACHED_ENSURE%" >nul 2>&1\nif errorlevel 1 goto :RUN_CIPD\nfc /b "%~dp0\\cipd_manifest.versions" "%CACHED_VERSIONS%" >nul 2>&1\nif errorlevel 1 goto :RUN_CIPD\nfc /b "%~dp0\\cipd_client_version" "%CACHED_CLIENT%" >nul 2>&1\nif errorlevel 1 goto :RUN_CIPD\n\ngoto :SKIP_CIPD\n\n:RUN_CIPD\ndel /f /q "%CACHED_ENSURE%" >nul 2>&1\ncall "%~dp0\\cipd.bat" ensure -log-level warning -ensure-file "%ENSURE%" -root "%ROOT%"\nif errorlevel 1 exit /b %ERRORLEVEL%\n\ncopy /y "%ENSURE%" "%CACHED_ENSURE%" >nul 2>&1\ncopy /y "%~dp0\\cipd_manifest.versions" "%CACHED_VERSIONS%" >nul 2>&1\ncopy /y "%~dp0\\cipd_client_version" "%CACHED_CLIENT%" >nul 2>&1\n\n:SKIP_CIPD\nendlocal\nexit /b 0\n',
};

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
      path.join(path.dirname(adapter.file), "source_bootstrap.py"),
      "def bind(*args): pass\n",
    );
    await fs.writeFile(
      path.join(depot, "gclient.py"),
      `import subprocess,types
gclient_utils=types.SimpleNamespace(CheckCallAndFilter=lambda command,*args,**kwargs:subprocess.run(command,shell=True,check=True))
class Hook:
 def __init__(self): self._action=('python3','-c','import sys,json;print(json.dumps(sys.argv[1:]))','two words','a+b@c','')
 def run(self): gclient_utils.CheckCallAndFilter(list(self._action))
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
    await fs.writeFile(
      path.join(directory, "source_bootstrap.py"),
      "def bind(*args): pass\n",
    );
    const fixture = `import os,types
def dispatched(command,*args,**kwargs):
 assert command==[os.path.join(os.path.dirname(__file__),'python3.bat'),'src/test.py','two words']
 print('FIXED_ADAPTER_DISPATCH')
gclient_utils=types.SimpleNamespace(CheckCallAndFilter=dispatched)
class Hook:
 def __init__(self): self._action=('python3','src/test.py','two words'); self.condition='checkout_win'
 def run(self):
  assert self.condition=='checkout_win'
  assert self._action==('python3','src/test.py','two words')
  gclient_utils.CheckCallAndFilter(list(self._action))
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

test("genuine pinned Hook.run controls false, true, thread, nested and first-error dispatch without condition pre-evaluation", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  assert.equal(
    sha(Buffer.from(PINNED_HOOK_RUN.source)),
    PINNED_HOOK_RUN.sha256,
  );
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-real-hook-run-"),
  );
  try {
    const adapter = path.join(directory, "python3.bat"),
      raw = Buffer.from("INERT HASH-BOUND ADAPTER DATA");
    await fs.writeFile(adapter, raw);
    await fs.writeFile(
      path.join(directory, "source_bootstrap.py"),
      "def bind(*args): pass\n",
    );
    const fixture = `import sys,os,time,types,threading,textwrap,hashlib,json
pinned=${JSON.stringify(PINNED_HOOK_RUN.source)}
assert hashlib.sha256(pinned.encode()).hexdigest()==${JSON.stringify(PINNED_HOOK_RUN.sha256)}
events=[];evaluations=[];reports=[];entered=threading.Event();released=threading.Event();primary=RuntimeError('OWNED_PRIMARY')
class GclientError(Exception): pass
class CalledProcessError(Exception): pass
def evaluated(condition,variables):
 evaluations.append((condition,variables))
 if 'fail' in variables: raise variables['fail']
 return variables['allow']
def dispatched(command,*args,**kwargs):
 events.append((threading.current_thread().name,command,kwargs))
 if 'throw-primary' in command: raise primary
 if 'nested' in command:
  Hook(['unsupported','%PATH%'],'false-inner',False).run()
  try: gclient_utils.CheckCallAndFilter(['unsupported-in-outer'])
  except RuntimeError as error: assert str(error)=='FULL_HOOK_ENTRY'
  else: raise AssertionError('outer scope lost after nested false hook')
 if 'wait-in-thread' in command:
  entered.set()
  assert released.wait(2),'controlled release timeout'
 return 'original-dispatch-result'
gclient_utils=types.SimpleNamespace(CheckCallAndFilter=dispatched,Error=GclientError,CommandToStr=lambda command:' '.join(command))
gclient_eval=types.SimpleNamespace(EvaluateCondition=evaluated)
subprocess2=types.SimpleNamespace(CalledProcessError=CalledProcessError)
metrics=types.SimpleNamespace(collector=types.SimpleNamespace(add_repeated=lambda kind,value:reports.append(value)))
_detect_host_os=lambda:'win'
exec('class Hook:\\n'+textwrap.indent(pinned,' '),globals())
def initialize(self,action,condition=None,allow=True):
 self._action=tuple(action);self._condition=condition;self._variables={'allow':allow};self._name='fixture';self._verbose=False;self._cwd_base=os.getcwd()
Hook.__init__=initialize
Hook.effective_cwd=property(lambda self:self._cwd_base)
def main(args):
 assert args==['runhooks','--jobs','2']
 outside=['outside-plumbing']
 assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 assert events[-1][1] is outside
 start=len(events);before=len(evaluations);adapter=os.path.join(os.path.dirname(__file__),'python3.bat')
 os.rename(adapter,adapter+'.hidden')
 try:
  for action in (['unsupported','%PATH%'],['python3','bad&argument']):
   assert Hook(action,'false-condition',False).run() is None
 finally: os.rename(adapter+'.hidden',adapter)
 assert len(events)==start and len(evaluations)==before+2
 for action,code in ((['unsupported','safe'],'FULL_HOOK_ENTRY'),(['python3','bad&argument'],'FULL_HOOK_SHELL_ARGUMENT')):
  before=len(evaluations)
  try: Hook(action,'true-condition',True).run()
  except RuntimeError as error: assert str(error)==code
  else: raise AssertionError('executing action admitted')
  assert len(evaluations)==before+1
 assert len(events)==start
 condition_primary=RuntimeError('OWNED_CONDITION_PRIMARY')
 hook=Hook(['unsupported'],'condition-error');hook._variables['fail']=condition_primary
 before=len(evaluations);before_reports=len(reports)
 try: hook.run()
 except RuntimeError as error: assert error is condition_primary
 else: raise AssertionError('condition primary lost')
 assert len(evaluations)==before+1 and evaluations[-1][1] is hook._variables and len(reports)==before_reports
 assert len(events)==start
 assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 before=len(evaluations);hook=Hook(['python3','owned.py','two words'])
 assert hook.run() is None and len(evaluations)==before
 assert hook._action==('python3','owned.py','two words')
 assert events[-1][1]==[adapter,'owned.py','two words']
 assert events[-1][2]==dict(cwd=os.getcwd(),print_stdout=True,show_header=True,always_show_header=False)
 hook=Hook(['vpython3','owned.py']);hook.run()
 assert events[-1][1]==[os.path.join(os.path.dirname(__file__),'vpython3.bat'),'owned.py']
 assert hook._action==('vpython3','owned.py')
 try: Hook(['python3','throw-primary']).run()
 except RuntimeError as error: assert error is primary
 else: raise AssertionError('primary lost')
 assert reports[-1]['exit_code']==2
 assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 Hook(['python3','nested']).run()
 assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 errors=[]
 def worker():
  try: Hook(['python3','wait-in-thread']).run()
  except BaseException as error: errors.append(error)
 thread=threading.Thread(target=worker,name='owned-hook-thread');thread.start()
 try:
  assert entered.wait(2),'controlled entry timeout'
  assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 finally: released.set();thread.join(2)
 assert not thread.is_alive() and not errors
 assert gclient_utils.CheckCallAndFilter(outside)=='original-dispatch-result'
 print(json.dumps(dict(pinnedBodyHash=${JSON.stringify(PINNED_HOOK_RUN.sha256)},falseHooksDispatched=0,trueUnknownDenied=True,threadLocal=True,nestedFinally=True,primaryIdentityPreserved=True,unconditionalNotEvaluated=True)))
 return 0
`;
    await fs.writeFile(path.join(directory, "gclient.py"), fixture);
    const result = JSON.parse(
      execFileSync(
        python,
        dependencyHookArguments(directory, adapter, { sha256: sha(raw) }),
        { cwd: directory, encoding: "utf8", timeout: 10000, stdio: "pipe" },
      ),
    );
    assert.equal(result.falseHooksDispatched, 0);
    assert(
      result.trueUnknownDenied &&
        result.threadLocal &&
        result.nestedFinally &&
        result.primaryIdentityPreserved &&
        result.unconditionalNotEvaluated,
    );
    t.diagnostic(JSON.stringify(result));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const PINNED_POPEN = {
  classBody: {
    source:
      'class Popen(subprocess.Popen):\n    popen_lock = threading.Lock()\n    def __init__(self, args, **kwargs):\n        env = get_english_env(kwargs.get("env"))\n        if env:\n            kwargs["env"] = env\n        if kwargs.get("env") is not None:\n            # Subprocess expects environment variables to be strings in Python\n            # 3.\n            def ensure_str(value):\n                if isinstance(value, bytes):\n                    return value.decode()\n                return value\n\n            kwargs["env"] = {\n                ensure_str(k): ensure_str(v) for k, v in kwargs["env"].items()\n            }\n        if kwargs.get("shell") is None:\n            # *Sigh*:  Windows needs shell=True, or else it won\'t search %PATH%\n            # for the executable, but shell=True makes subprocess on Linux fail\n            # when it\'s called with a list because it only tries to execute the\n            # first item in the list.\n            kwargs["shell"] = bool(sys.platform == "win32")\n\n        if isinstance(args, (str, bytes)):\n            tmp_str = args\n        elif isinstance(args, (list, tuple)):\n            tmp_str = " ".join(args)\n        else:\n            raise CalledProcessError(None, args, kwargs.get("cwd"), None, None)\n        if kwargs.get("cwd", None):\n            tmp_str += ";  cwd=%s" % kwargs["cwd"]\n        logging.debug(tmp_str)\n\n        try:\n            with self.popen_lock:\n                super(Popen, self).__init__(args, **kwargs)\n        except OSError as e:\n            if e.errno == errno.EAGAIN and sys.platform == "cygwin":\n                # Convert fork() emulation failure into a CygwinRebaseError().\n                raise CygwinRebaseError(\n                    e.errno,\n                    args,\n                    kwargs.get("cwd"),\n                    None,\n                    "Visit "\n                    "http://code.google.com/p/chromium/wiki/"\n                    "CygwinDllRemappingFailure "\n                    "to learn how to fix this error; you need to rebase your "\n                    "cygwin dlls",\n                )\n            # Popen() can throw OSError when cwd or args[0] doesn\'t exist.\n            raise OSError(\n                "Execution failed with error: %s.\\n"\n                "Check that %s or %s exist and have execution permission."\n                % (str(e), kwargs.get("cwd"), args[0])\n            )\n',
    sha256: "cbf64f84ebd0f44cf1f48de4f9b6fcabeb443de1459c7abc268fed943998b0c6",
  },
  init: {
    source:
      '    def __init__(self, args, **kwargs):\n        env = get_english_env(kwargs.get("env"))\n        if env:\n            kwargs["env"] = env\n        if kwargs.get("env") is not None:\n            # Subprocess expects environment variables to be strings in Python\n            # 3.\n            def ensure_str(value):\n                if isinstance(value, bytes):\n                    return value.decode()\n                return value\n\n            kwargs["env"] = {\n                ensure_str(k): ensure_str(v) for k, v in kwargs["env"].items()\n            }\n        if kwargs.get("shell") is None:\n            # *Sigh*:  Windows needs shell=True, or else it won\'t search %PATH%\n            # for the executable, but shell=True makes subprocess on Linux fail\n            # when it\'s called with a list because it only tries to execute the\n            # first item in the list.\n            kwargs["shell"] = bool(sys.platform == "win32")\n\n        if isinstance(args, (str, bytes)):\n            tmp_str = args\n        elif isinstance(args, (list, tuple)):\n            tmp_str = " ".join(args)\n        else:\n            raise CalledProcessError(None, args, kwargs.get("cwd"), None, None)\n        if kwargs.get("cwd", None):\n            tmp_str += ";  cwd=%s" % kwargs["cwd"]\n        logging.debug(tmp_str)\n\n        try:\n            with self.popen_lock:\n                super(Popen, self).__init__(args, **kwargs)\n        except OSError as e:\n            if e.errno == errno.EAGAIN and sys.platform == "cygwin":\n                # Convert fork() emulation failure into a CygwinRebaseError().\n                raise CygwinRebaseError(\n                    e.errno,\n                    args,\n                    kwargs.get("cwd"),\n                    None,\n                    "Visit "\n                    "http://code.google.com/p/chromium/wiki/"\n                    "CygwinDllRemappingFailure "\n                    "to learn how to fix this error; you need to rebase your "\n                    "cygwin dlls",\n                )\n            # Popen() can throw OSError when cwd or args[0] doesn\'t exist.\n            raise OSError(\n                "Execution failed with error: %s.\\n"\n                "Check that %s or %s exist and have execution permission."\n                % (str(e), kwargs.get("cwd"), args[0])\n            )\n',
    bytes: 2311,
    sha256: "a8710349d17841bf7de94eed115d94f12ba90f8439661842126cacaf28de4335",
    startLine: 116,
    endLine: 170,
  },
  english: {
    source:
      'def get_english_env(env):\n    """Forces LANG and/or LANGUAGE to be English.\n\n    Forces encoding to utf-8 for subprocesses.\n\n    Returns None if it is unnecessary.\n    """\n    if sys.platform == "win32":\n        return None\n    env = env or os.environ\n\n    # Test if it is necessary at all.\n    is_english = lambda name: env.get(name, "en").startswith("en")  # noqa: E731\n\n    if is_english("LANG") and is_english("LANGUAGE"):\n        return None\n\n    # Requires modifications.\n    env = env.copy()\n\n    def fix_lang(name):\n        if not is_english(name):\n            env[name] = "en_US.UTF-8"\n\n    fix_lang("LANG")\n    fix_lang("LANGUAGE")\n    return env\n',
    sha256: "281ec45f2f3e1ad217d8672f4703425be07a86e530c077d0304901bf352752a0",
  },
  oldBind: {
    source:
      "def bind(expected,guard_sha):\n value,_=verify(expected,guard_sha);sys.path.insert(0,str(DEPOT));import subprocess2\n if getattr(subprocess2,'_sorng_cipd_bound',False):return\n original=subprocess2.Popen;approved=dict(os.environ)\n def admitted(argv,*args,**kwargs):\n  if isinstance(argv,(list,tuple))and argv and argv[0]in ('cipd','cipd.bat',str(DEPOT/'cipd.bat')):\n   values=list(argv[1:]);arguments('cipd',values);inherited_environment(approved,kwargs.get('env'));current,_=verify(expected,guard_sha);kwargs['shell']=False\n   return original([current['client']['path'],*values],*args,**kwargs)\n  return original(argv,*args,**kwargs)\n subprocess2.Popen=admitted;subprocess2._sorng_cipd_bound=True",
    sha256: "d7552d6f3708aed62ec50f0954698e2284efe779ada0c412a9d040f9dc549f99",
  },
};

const PINNED_GCLIENT_ENV = {
  envConstruction: {
    source:
      'if "env" not in kwargs:\n    kwargs["env"] = os.environ.copy()\nif "COLUMNS" not in kwargs["env"] or "LINES" not in kwargs["env"]:\n    size = shutil.get_terminal_size()\n    if size.columns and size.lines:\n        kwargs["env"]["COLUMNS"] = str(size.columns)\n        kwargs["env"]["LINES"] = str(size.lines)\n\nkid = subprocess2.Popen(\n    args,\n    bufsize=0,\n    stdout=pipe_writer,\n    stderr=subprocess2.STDOUT,\n    **kwargs,\n)\n',
    bytes: 427,
    sha256: "945140cc22facfc3805535ada072899600b163c0430a363d2f0f2fc27bdf08fb",
  },
  mainMetadata: {
    source:
      'os.environ["GIT_PAGER"] = "cat"\nos.environ["GIT_EDITOR"] = "false"\nif not sys.stdout.isatty():\n    os.environ["GIT_TERMINAL_PROMPT"] = "0"\n\n',
    bytes: 140,
    sha256: "f04023562d8384c46a447080c7b6f542b60956500a75cdd4cb9dea25aa96b51c",
  },
  syncMetadata: {
    source:
      'existing_sync_commits = json.loads(\n    os.environ.get(PREVIOUS_SYNC_COMMITS, "{}")\n)\nexisting_sync_commits[self.name] = latest_commit\nos.environ[PREVIOUS_SYNC_COMMITS] = json.dumps(\n    existing_sync_commits\n)\n',
    bytes: 211,
    sha256: "efd3d388bda3e8164b658da67d40029dd6b91eb6ac509ab517d0ca9279bb8e0c",
  },
  oldBind: {
    source:
      "def bind(expected,guard_sha):\n value,_=verify(expected,guard_sha);sys.path.insert(0,str(DEPOT));import subprocess2\n if getattr(subprocess2,'_sorng_cipd_bound',False):return\n original=subprocess2.Popen\n def admitted(argv,*args,**kwargs):\n  if isinstance(argv,(list,tuple))and argv and argv[0]in ('cipd','cipd.bat',str(DEPOT/'cipd.bat')):\n   values=list(argv[1:]);arguments('cipd',values);data.need(kwargs.get('env')is None,'FULL_BOOTSTRAP_ENV_OVERRIDE');current,_=verify(expected,guard_sha);kwargs['shell']=False\n   return original([current['client']['path'],*values],*args,**kwargs)\n  return original(argv,*args,**kwargs)\n subprocess2.Popen=admitted;subprocess2._sorng_cipd_bound=True",
    bytes: 684,
    sha256: "4d0a43c696aca3d1b2ad4f270adf660f28632bf5a5da93cecc4c3766efe130c1",
  },
};

test("bootstrap source templates keep original setup bytes except its client callee and deny an explicitly disabled source policy", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-bootstrap-disabled-"),
  );
  try {
    await fs.mkdir(path.join(root, "source-commands"));
    const source = Buffer.from(PINNED_CIPD_SETUP.source);
    assert.equal(sha(source), PINNED_CIPD_SETUP.sha256);
    const derived = deriveBootstrapSetup(source);
    assert.deepEqual(
      derived,
      Buffer.from(
        PINNED_CIPD_SETUP.source.replace(
          'call "%~dp0\\cipd.bat" ensure',
          '"%~dp0\\.cipd_client.exe" ensure',
        ),
      ),
    );
    assert.throws(
      () => deriveBootstrapSetup(Buffer.concat([source, source])),
      /FULL_BOOTSTRAP_SETUP_SOURCE/,
    );
    assert.equal(profile.phaseAdmission["source-gn"], true);
    const disabled = structuredClone(profile);
    disabled.phaseAdmission["source-gn"] = false;
    const program = await prepareBootstrap(root, disabled, "b".repeat(64), {
      remaining: () => 10000,
    });
    assert.equal(
      program.pin.sha256,
      sha(bootstrapProgram(root, disabled, "b".repeat(64))),
    );
    assert.throws(
      () =>
        execFileSync(
          python,
          [
            "-I",
            "-B",
            program.file,
            "--prepare-sync",
            "--guard-sha",
            program.pin.sha256,
          ],
          { encoding: "utf8", timeout: 10000, stdio: "pipe" },
        ),
      (error) => error.stderr.includes("FULL_BOOTSTRAP_DISABLED"),
    );
    await assert.rejects(
      prepareBootstrap(root, disabled, "b".repeat(64), {
        remaining: () => 10000,
      }),
      /EEXIST/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("actual bootstrap body denies stale state and drift, checks setup, binds CIPD and preserves first failure without executing vendor files", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "cef-bootstrap-body-"),
  );
  try {
    const p = structuredClone(profile);
    p.phaseAdmission["source-gn"] = true;
    for (const key of Object.keys(p.sourceGn.executionPolicy))
      p.sourceGn.executionPolicy[key] = true;
    const sample = JSON.parse(
      execFileSync(
        python,
        [
          "-I",
          "-B",
          "-c",
          "import json,time;print(json.dumps(dict(wall=time.time()+600,mono=time.monotonic()+600)))",
        ],
        { encoding: "utf8", timeout: 10000 },
      ),
    );
    const context = {
        mode: "source-gn",
        image: p.image,
        repositoryId: "1010282954",
        visibility: "public",
        event: "workflow_dispatch",
        ref: "refs/heads/codex/windows-arm-source-gn-20261026",
        wallWorkEnd: sample.wall,
        monotonicWorkEnd: sample.mono,
      },
      contextRaw = Buffer.from(JSON.stringify(context));
    await fs.writeFile(path.join(directory, "context.json"), contextRaw);
    const files = sourcePaths(directory, p);
    await fs.mkdir(files.commands);
    await fs.mkdir(files.depot, { recursive: true });
    await fs.mkdir(path.join(directory, "tmp"));
    await fs.mkdir(path.join(directory, "source-caches"));
    for (const name of ["local", "roaming", "xdg", "cipd", "vpython"])
      await fs.mkdir(path.join(directory, "source-caches", name));
    await fs.writeFile(path.join(directory, "source-caches/cipd.cfg"), "");
    const program = await prepareBootstrap(directory, p, sha(contextRaw), {
      remaining: () => 10000,
    });
    const harness = `import sys,os,json,hashlib,importlib.util,contextlib,io,types,shutil
from pathlib import Path
spec=importlib.util.spec_from_file_location('owned_bootstrap',${JSON.stringify(program.file)});b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
sys.path.insert(0,b.P['native']);from test_producer import pe
payload=pe(version=False);digest=hashlib.sha256(payload).hexdigest();b.P['clientSha']=digest
for key,name in (('CIPD_CACHE_DIR','cipd'),('VPYTHON_VIRTUALENV_ROOT','vpython'),('LOCALAPPDATA','local'),('APPDATA','roaming'),('XDG_CACHE_HOME','xdg')):os.environ[key]=str(b.ROOT/'source-caches'/name)
os.environ['CIPD_CONFIG_FILE']=str(b.ROOT/'source-caches/cipd.cfg')
for key in ('CIPD_BACKEND','CIPD_SERVICE_URL','CIPD_PLATFORM','VPYTHON_BYPASS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'):os.environ.pop(key,None)
for row in b.P['sources']:
 raw=(${JSON.stringify(PINNED_CIPD_SETUP.source)}.encode() if row['path']=='cipd_bin_setup.bat'else ('OWNED SYNTHETIC '+row['path']).encode())
 (b.DEPOT/row['path']).write_bytes(raw);row.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
guard_sha=${JSON.stringify(program.pin.sha256)}
calls=[];scenario='valid'
def runner(command,clock):
 calls.append(command);assert clock.wall_end==${sample.wall} and clock.mono_end==${sample.mono}
 if len(calls)==1:
  assert command[0]==r'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  if scenario=='bootstrap-nonzero':return 7
  (b.DEPOT/'.cipd_client.exe').write_bytes(payload if scenario!='client-hash'else b'wrong')
 else:
  assert len(calls)==2 and command==[r'C:\\Windows\\System32\\cmd.exe','/d','/c',str(b.SETUP)]
  assert b.SETUP.read_bytes()==b.derived_setup(${JSON.stringify(PINNED_CIPD_SETUP.source)}.encode())
  if scenario=='setup-nonzero':return 9
  (b.DEPOT/'.cipd_bin').mkdir()
  (b.DEPOT/'.cipd_bin/vpython3.exe').write_bytes(pe(0xaa64,version=False)if scenario=='machine'else payload)
  for target,source in (('.cipd_manifest.txt','cipd_manifest.txt'),('.cipd_manifest.versions','cipd_manifest.versions'),('.cipd_client_version','cipd_client_version')):
   (b.DEPOT/'.cipd_bin'/target).write_bytes((b.DEPOT/source).read_bytes())
  if scenario=='marker':(b.DEPOT/'.cipd_bin/.cipd_manifest.txt').write_bytes(b'forged')
  if scenario=='hardlink':os.link(b.DEPOT/'.cipd_bin/vpython3.exe',b.DEPOT/'.cipd_bin/alias')
  if scenario=='override-after':(b.DEPOT/'.cipd_client_platform').write_text('windows-arm64')
  if scenario=='client-drift':(b.DEPOT/'.cipd_client.exe').write_bytes(payload+b'changed')
 return 0
def reset():
 global calls
 calls=[]
 for path in (b.DEPOT/'.cipd_client_platform',b.DEPOT/'.cipd_client.exe',b.DEPOT/'.versions',b.DEPOT/'.cipd_bin',b.SETUP,b.WITNESS,b.COMMANDS/'cipd.bat',b.COMMANDS/'vpython3.bat',b.ROOT/'source-caches/cipd/stale'):
  if path.is_symlink()or path.is_file():path.unlink()
  elif path.exists():shutil.rmtree(path)
results=[]
for scenario in ('preexisting-client','preexisting-versions','preexisting-bin','override','cache','bootstrap-nonzero','client-hash','setup-nonzero','machine','marker','hardlink','override-after','client-drift'):
 reset()
 if scenario=='preexisting-client':(b.DEPOT/'.cipd_client.exe').write_bytes(payload)
 if scenario=='preexisting-versions':(b.DEPOT/'.versions').mkdir()
 if scenario=='preexisting-bin':(b.DEPOT/'.cipd_bin').mkdir()
 if scenario=='override':(b.DEPOT/'.cipd_client_platform').write_text('windows-arm64')
 if scenario=='cache':(b.ROOT/'source-caches/cipd/stale').write_bytes(b'never followed')
 try:b.provision(guard_sha,runner)
 except b.data.Denied as error:code=str(error)
 else:raise AssertionError('bad bootstrap accepted '+scenario)
 assert not b.WITNESS.exists()
 if scenario.startswith('preexisting')or scenario in ('override','cache'):assert not calls
 if scenario in ('bootstrap-nonzero','client-hash'):assert len(calls)==1
 results.append(dict(case=scenario,denied=code,provisionerCalls=len(calls)))
reset();scenario='valid';value=b.provision(guard_sha,runner);assert len(calls)==2
original=b.WITNESS.read_bytes();witness_sha=hashlib.sha256(original).hexdigest()
assert value['packageInstance']==b.P['instance'] and value['setupExit']==0 and value['fresh']is True
assert b.verify(witness_sha,guard_sha)[0]==value
executions=[]
b.execute('vpython',['--version'],witness_sha,guard_sha,lambda command,clock:executions.append(command)or 0)
assert executions==[[value['vpython']['path'],'--version']]
for args in (['selfupdate'],['ensure','-service-url','https://example.invalid'],['ensure','--service-url=https://example.invalid']):
 try:b.execute('cipd',args,witness_sha,guard_sha,lambda *args:(_ for _ in ()).throw(AssertionError('must not execute')))
 except b.data.Denied:pass
 else:raise AssertionError('CIPD override admitted')
popen_calls=[];popen_error=[None]
class BasePopen:
 def __init__(self,args,**kwargs):
  popen_calls.append((args,kwargs));self.original_args=args
  if popen_error[0]is not None:raise popen_error[0]

def make_backend():
 module=types.ModuleType('subprocess2');module.__dict__.update(dict(subprocess=types.SimpleNamespace(Popen=BasePopen),threading=__import__('threading'),logging=types.SimpleNamespace(debug=lambda _message:None),sys=types.SimpleNamespace(platform='win32'),os=os,errno=__import__('errno'),CalledProcessError=RuntimeError,CygwinRebaseError=RuntimeError))
 exec(compile(${JSON.stringify(PINNED_POPEN.english.source)},'pinned-c101-get-english-env','exec'),module.__dict__)
 exec(compile(${JSON.stringify(PINNED_POPEN.classBody.source)},'pinned-c101-Popen-init','exec'),module.__dict__);module.STDOUT=-2
 return module
sys.modules['subprocess2']=make_backend()
primary_env=${JSON.stringify(PINNED_GCLIENT_ENV.envConstruction.source)}
primary_main=${JSON.stringify(PINNED_GCLIENT_ENV.mainMetadata.source)}
primary_sync=${JSON.stringify(PINNED_GCLIENT_ENV.syncMetadata.source)}
old_bind=${JSON.stringify(PINNED_GCLIENT_ENV.oldBind.source)}
for key in ('COLUMNS','LINES'):os.environ.pop(key,None)
# Execute the exact pinned kwargs/env construction with an inert Popen boundary.
def primary_dispatch(command,kwargs=None,columns=80,lines=24):
 scope=dict(os=os,shutil=types.SimpleNamespace(get_terminal_size=lambda:types.SimpleNamespace(columns=columns,lines=lines)),subprocess2=sys.modules['subprocess2'],args=command,kwargs={}if kwargs is None else kwargs,pipe_writer=123)
 exec(compile(primary_env,'pinned-c101-env-construction','exec'),scope)
 return scope['kid']
new_bind=b.bind;exec(compile(old_bind,'original-20a-bind','exec'),b.__dict__)
b.bind(witness_sha,guard_sha)
try:primary_dispatch(['cipd','expand-package-name','infra/test'])
except b.data.Denied as error:assert str(error)=='FULL_BOOTSTRAP_ENV_OVERRIDE'
else:raise AssertionError('old rejection did not reproduce')
assert not popen_calls
b.bind=new_bind;sys.modules['subprocess2']=make_backend()
# Exact former function-replacement body breaks genuine upstream super(Popen,self).
method_bind=b.bind;exec(compile(${JSON.stringify(PINNED_POPEN.oldBind.source)},'original-6b8-function-bind','exec'),b.__dict__)
b.bind(witness_sha,guard_sha)
try:sys.modules['subprocess2'].Popen(['git','--version'])
except TypeError as error:assert 'super() argument 1 must be a type, not function'in str(error)
else:raise AssertionError('actual old class failure absent')
assert not popen_calls
b.bind=method_bind;sys.modules['subprocess2']=make_backend();backend=sys.modules['subprocess2'];aliases={}
exec('from subprocess2 import Popen as captured_before_installation',aliases);alias=aliases['captured_before_installation']
b.bind(witness_sha,guard_sha)
assert backend.Popen is alias and isinstance(alias,type)
assert isinstance(backend.Popen(['cipd','expand-package-name','infra/'+chr(36)+'{platform}'],shell=True),alias)
assert popen_calls[-1][0][0]==value['client']['path']and popen_calls[-1][1]['shell']is False
before_dispatches=len(popen_calls)
mutated=dict(value);mutated['vpython']=dict(value['vpython']);changed=payload+b'coherently changed'
(b.DEPOT/'.cipd_bin/vpython3.exe').write_bytes(changed);mutated['vpython'].update(bytes=len(changed),sha256=hashlib.sha256(changed).hexdigest())
changed_witness=(json.dumps(mutated,sort_keys=True,separators=(',',':'))+'\\n').encode();changed_sha=hashlib.sha256(changed_witness).hexdigest();b.WITNESS.write_bytes(changed_witness)
for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):(b.COMMANDS/name).write_bytes(b.shim(role,guard_sha,changed_sha))
try:backend.Popen(['cipd','expand-package-name','infra/test'])
except b.data.Denied as error:assert str(error)=='FULL_BOOTSTRAP_WITNESS_PIN'
else:raise AssertionError('dispatch re-adopted coherent witness/payload/shims')
assert len(popen_calls)==before_dispatches
b.WITNESS.write_bytes(original);(b.DEPOT/'.cipd_bin/vpython3.exe').write_bytes(payload)
for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):(b.COMMANDS/name).write_bytes(b.shim(role,guard_sha,witness_sha))
dispatch_denials=[]
for target in (b.WITNESS,b.SCRIPT,b.DEPOT/'.cipd_client.exe',b.DEPOT/'.cipd_bin/vpython3.exe',b.COMMANDS/'cipd.bat',b.COMMANDS/'vpython3.bat'):
 prior=target.read_bytes();target.write_bytes(prior+b'changed after attestation');before=len(popen_calls)
 try:backend.Popen(['cipd','expand-package-name','infra/test'])
 except b.data.Denied as error:dispatch_denials.append(str(error))
 else:raise AssertionError('mutated attested dispatch admitted')
 finally:target.write_bytes(prior)
 assert len(popen_calls)==before
assert len(dispatch_denials)==6

for role,name in (('cipd','cipd.bat'),('vpython','vpython3.bat')):(b.COMMANDS/name).write_bytes(b.shim(role,guard_sha,witness_sha))
ordinary=['git','--version'];ordinary_result=alias(args=ordinary,shell=True);assert isinstance(ordinary_result,alias)and ordinary_result.original_args is ordinary and popen_calls[-1][0]is ordinary and popen_calls[-1][1]['shell']is True
try:backend.Popen(['cipd','expand-package-name','infra/test'],env={})
except b.data.Denied:pass
else:raise AssertionError('env override admitted')
initial_env=dict(os.environ);environment_denials=[]
# Actual pinned gclient writes, not a model of accepted arbitrary mutations.
exec(compile(primary_main,'pinned-c101-main-metadata','exec'),dict(os=os,sys=types.SimpleNamespace(stdout=types.SimpleNamespace(isatty=lambda:False))))
exec(compile(primary_sync,'pinned-c101-sync-metadata','exec'),dict(os=os,json=json,PREVIOUS_SYNC_COMMITS='GCLIENT_PREVIOUS_SYNC_COMMITS',self=types.SimpleNamespace(name='src'),latest_commit='a'*40))
ensure=b.ROOT/'tmp/owned.ensure';ensure.write_text('infra/test instance')
resolved=b.ROOT/'tmp/owned.resolved';resolved.write_text('{}')
commands=[['cipd','expand-package-name','infra/'+chr(36)+'{platform}'],['cipd','ensure','-log-level','info','-root',b.P['workspace'],'-ensure-file',str(ensure)],['cipd','ensure-file-resolve','-log-level','error','-ensure-file',str(ensure),'-json-output',str(resolved)]]
for command in commands:
 assert isinstance(primary_dispatch(command),alias)
 assert popen_calls[-1][0][0]==value['client']['path']and popen_calls[-1][1]['shell']is False
 assert popen_calls[-1][1]['env']==dict(os.environ,COLUMNS='80',LINES='24')
 assert isinstance(primary_dispatch(command,dict(env=os.environ.copy())),alias)
assert isinstance(backend.Popen(commands[0]),alias)
approved_current=dict(os.environ)
for key in ('PATH','PYTHONPATH','PYTHONHOME','CIPD_BACKEND','CIPD_SERVICE_URL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','CIPD_CACHE_DIR','VPYTHON_VIRTUALENV_ROOT','GIT_ASKPASS','USERPROFILE','UNKNOWN_ENV'):
 changed=dict(approved_current);changed[key]='unapproved';before=len(popen_calls)
 try:primary_dispatch(commands[0],dict(env=changed))
 except b.data.Denied as error:environment_denials.append(str(error))
 else:raise AssertionError('changed child environment admitted')
 assert len(popen_calls)==before
removed=dict(approved_current);del removed['CIPD_CACHE_DIR']
try:primary_dispatch(commands[0],dict(env=removed))
except b.data.Denied:pass
else:raise AssertionError('removed cache admitted')
for changed in (dict(COLUMNS='80'),dict(COLUMNS='0',LINES='24'),dict(COLUMNS='080',LINES='24'),dict(COLUMNS='10001',LINES='24'),dict(COLUMNS='80',LINES='2.4'),dict(COLUMNS='80',LINES='24',UNKNOWN_ENV='no')):
 bad=dict(approved_current,**changed);before=len(popen_calls)
 try:backend.Popen(commands[0],env=bad)
 except b.data.Denied:pass
 else:raise AssertionError('terminal environment widened')
 assert len(popen_calls)==before
for key,changed in (('PATH','unapproved'),('GIT_EDITOR','not-false'),('GIT_PAGER','not-cat'),('GIT_TERMINAL_PROMPT','1'),('GCLIENT_UNKNOWN_METADATA','data')):
 before=len(popen_calls);os.environ[key]=changed
 try:
  for kwargs in ({},dict(env=os.environ.copy())):
   try:backend.Popen(commands[0],**kwargs)
   except b.data.Denied:pass
   else:raise AssertionError('changed inherited environment admitted')
 finally:os.environ.clear();os.environ.update(approved_current)
 assert len(popen_calls)==before
before=len(popen_calls);del os.environ['CIPD_CACHE_DIR']
try:
 try:backend.Popen(commands[0])
 except b.data.Denied as error:assert str(error)=='FULL_BOOTSTRAP_INHERITED_ENV'
 else:raise AssertionError('removed inherited critical key admitted')
finally:os.environ.clear();os.environ.update(approved_current)
assert len(popen_calls)==before
# Windows rejects physical environment values above32767 before our guard;
# inject only this numeric cap boundary into the actual inherited-env reader.
original_os=b.os;b.os=types.SimpleNamespace(environ=dict(approved_current,GCLIENT_PREVIOUS_SYNC_COMMITS='x'*(1024**2+1)))
before=len(popen_calls)
try:
 try:backend.Popen(commands[0])
 except b.data.Denied as error:assert str(error)=='FULL_BOOTSTRAP_INHERITED_ENV'
 else:raise AssertionError('metadata cap admitted')
finally:b.os=original_os
assert len(popen_calls)==before
popen_primary=RuntimeError('OWNED_POPEN_PRIMARY');popen_error[0]=popen_primary
try:primary_dispatch(commands[0])
except RuntimeError as error:assert error is popen_primary
else:raise AssertionError('Popen primary lost')
finally:popen_error[0]=None
os.environ.clear();os.environ.update(initial_env)
for key,bad in (('fresh',False),('packageInstance','wrong'),('setupExit',False)):
 changed=dict(value);changed[key]=bad;raw=json.dumps(changed).encode();b.WITNESS.write_bytes(raw)
 try:b.verify(hashlib.sha256(raw).hexdigest(),guard_sha)
 except b.data.Denied:pass
 else:raise AssertionError('forged witness admitted')
 b.WITNESS.write_bytes(original)
b.WITNESS.write_bytes(original+b' ')
try:b.verify(witness_sha,guard_sha)
except b.data.Denied as error:assert str(error)=='FULL_BOOTSTRAP_WITNESS_PIN'
else:raise AssertionError('witness digest drift admitted')
b.WITNESS.write_bytes(original)
primary=RuntimeError('OWNED_PRIMARY');secondary=io.StringIO()
def failed(command,clock):(b.DEPOT/'.cipd_client.exe').write_bytes(b'changed');raise primary
with contextlib.redirect_stderr(secondary):
 try:b.execute('vpython',['--version'],witness_sha,guard_sha,failed)
 except RuntimeError as error:assert error is primary
 else:raise AssertionError('first error lost')
assert 'FULL_BOOTSTRAP_POST_FAILURE'in secondary.getvalue()
(b.DEPOT/'.cipd_client.exe').write_bytes(payload)
observed=[];original_run=b.subprocess.run
b.subprocess.run=lambda command,**kwargs:observed.append(kwargs['timeout'])or types.SimpleNamespace(returncode=0)
try:
 assert b.run_checked(['owned-benign'],types.SimpleNamespace(remaining=lambda:125))==0 and observed==[5]
 try:b.run_checked(['owned-benign'],types.SimpleNamespace(remaining=lambda:119))
 except b.data.Denied:pass
 else:raise AssertionError('reserve reset')
 assert observed==[5]
finally:b.subprocess.run=original_run
print(json.dumps(dict(cases=results,fixturePolicyOnly=True,vendorExecutableExecuted=False,validProvisionerCalls=2,firstErrorPreserved=True,originalReservePreserved=True,immutableDispatchDenials=dispatch_denials,environmentDenials=environment_denials,actualPinnedEnvironmentOldRedNewGreen=True,actualPinnedClassOldRedNewGreen=True,classAndAliasIdentityPreserved=True,witnessSha256=witness_sha,fixtureSourcePins=b.P['sources'],fixtureClientSha=digest)))
`;
    const harnessFile = path.join(directory, "harness.py");
    await fs.writeFile(harnessFile, harness);
    const result = JSON.parse(
      execFileSync(python, ["-I", "-B", harnessFile], {
        encoding: "utf8",
        timeout: 20000,
        stdio: "pipe",
      }),
    );
    assert.equal(result.cases.length, 13);
    assert(result.firstErrorPreserved && result.originalReservePreserved);
    assert.equal(result.immutableDispatchDenials.length, 6);
    assert.equal(result.environmentDenials.length, 13);
    assert.equal(result.actualPinnedEnvironmentOldRedNewGreen, true);
    assert(
      result.actualPinnedClassOldRedNewGreen &&
        result.classAndAliasIdentityPreserved,
    );
    assert.equal(result.vendorExecutableExecuted, false);
    const witness = JSON.parse(await fs.readFile(program.witness, "utf8"));
    for (const [role, name] of [
      ["cipd", "cipd.bat"],
      ["vpython", "vpython3.bat"],
    ])
      assert.deepEqual(
        await fs.readFile(path.join(files.commands, name)),
        bootstrapShim(
          p.python.path,
          program.file,
          program.pin.sha256,
          result.witnessSha256,
          role,
        ),
      );
    await assert.rejects(
      verifyBootstrap(
        directory,
        p,
        program,
        { remaining: () => 10000 },
        sha(contextRaw),
      ),
      /FULL_BOOTSTRAP_NOT_ATTESTED/,
    );
    program.witnessPin = {
      bytes: (await fs.readFile(program.witness)).length,
      sha256: result.witnessSha256,
      nlink: 1,
    };
    await assert.rejects(
      verifyBootstrap(
        directory,
        p,
        program,
        { remaining: () => 10000 },
        sha(contextRaw),
      ),
      /FULL_BOOTSTRAP_PIN/,
    );
    program.witnessPin = null;
    assert.equal(
      witness.packageInstance,
      "5_RRshFOtDVoKVpdtehepLtVyYsUdifAy9IHenpJmHoC",
    );
    const command = sourceCommands(
      directory,
      p,
      cefHookArguments(files.cef, files.depot),
      sha(contextRaw),
    )[2];
    const binding = {
      pin: { sha256: program.pin.sha256 },
      witnessPin: { sha256: result.witnessSha256 },
    };
    const bound = bindBootstrapVector(command, binding);
    assert.deepEqual(bound.slice(-2), [
      result.witnessSha256,
      program.pin.sha256,
    ]);
    assert(command.args.includes("__SORNG_BOOTSTRAP_WITNESS__"));
    assert.throws(
      () =>
        bindBootstrapVector(command, { pin: program.pin, witnessPin: null }),
      /FULL_BOOTSTRAP_VECTOR_PIN/,
    );
    // Execute the actual Node verifier/held/observer declarations with only
    // package authority constants replaced by explicitly synthetic fixture pins.
    // The ordinary production verifier above rejects these fixture expectations.
    const body = await read(prefix + "source-driver.mjs"),
      keysBody = body.slice(
        body.indexOf("const keys ="),
        body.indexOf("\n\nexport function sourceBudget"),
      ),
      readerBody = body.slice(
        body.indexOf("const signature ="),
        body.indexOf("export function sourcePaths"),
      ),
      verifyBody = body
        .slice(
          body.indexOf("export async function verifyBootstrap"),
          body.indexOf("export function bootstrapObserver"),
        )
        .replace("export ", ""),
      observerBody = body
        .slice(
          body.indexOf("export function bootstrapObserver"),
          body.indexOf("export function bindBootstrapVector"),
        )
        .replace("export ", "");
    const scope = vm.createContext({
      fs,
      constants: fsConstants,
      Buffer,
      path,
      TextDecoder,
      sha,
      sourceCloseFailure: false,
      need: (ok, code) => {
        if (!ok) throw new Error(code);
      },
      sourcePaths,
      bootstrapShim,
      deriveBootstrapSetup,
      BOOTSTRAP_SOURCES: result.fixtureSourcePins,
      CIPD_CLIENT_SHA: result.fixtureClientSha,
      VPYTHON_INSTANCE: "5_RRshFOtDVoKVpdtehepLtVyYsUdifAy9IHenpJmHoC",
    });
    const actual = vm.runInContext(
      `${keysBody}\n${readerBody}\n${verifyBody}\n${observerBody}\n({verifyBootstrap,bootstrapObserver,held})`,
      scope,
    );
    const marker = Buffer.from(
        "FULL_BOOTSTRAP_WITNESS:" + JSON.stringify(witness) + "\r\n",
      ),
      observer = actual.bootstrapObserver(program, sha(contextRaw));
    observer.push(Buffer.concat([Buffer.alloc(70000, 120), Buffer.from("\n")]));
    for (let index = 0; index < marker.length; index += 3)
      observer.push(marker.subarray(index, index + 3));
    observer.finish();
    assert.equal(program.witnessPin.sha256, result.witnessSha256);
    assert.equal(
      (
        await actual.verifyBootstrap(
          directory,
          p,
          program,
          { remaining: () => 10000 },
          sha(contextRaw),
        )
      ).packageInstance,
      witness.packageInstance,
    );
    assert.throws(
      () => observer.push(marker),
      /FULL_BOOTSTRAP_ATTESTATION_DUPLICATE/,
    );
    assert.throws(
      () =>
        actual
          .bootstrapObserver(
            { pin: program.pin, witnessPin: null },
            sha(contextRaw),
          )
          .finish(),
      /FULL_BOOTSTRAP_ATTESTATION_MISSING/,
    );
    const wrong = Buffer.from(
      "FULL_BOOTSTRAP_WITNESS:" +
        JSON.stringify({ ...witness, contextSha: "a".repeat(64) }) +
        "\n",
    );
    assert.throws(
      () =>
        actual
          .bootstrapObserver(
            { pin: program.pin, witnessPin: null },
            sha(contextRaw),
          )
          .push(wrong),
      /FULL_BOOTSTRAP_ATTESTATION/,
    );
    assert.throws(
      () =>
        actual
          .bootstrapObserver(
            { pin: program.pin, witnessPin: null },
            sha(contextRaw),
          )
          .push(
            Buffer.from("FULL_BOOTSTRAP_WITNESS:" + "x".repeat(65537) + "\n"),
          ),
      /FULL_BOOTSTRAP_ATTESTATION_BOUND/,
    );
    const witnessRaw = await fs.readFile(program.witness);
    await fs.appendFile(program.witness, " ");
    await assert.rejects(
      actual.verifyBootstrap(
        directory,
        p,
        program,
        { remaining: () => 10000 },
        sha(contextRaw),
      ),
      /FULL_DRIVER_PIN/,
    );
    await fs.writeFile(program.witness, witnessRaw);
    const cap =
        program.pin.bytes +
        witnessRaw.length +
        witness.client.bytes +
        witness.vpython.bytes -
        1,
      opened = [];
    const scaled = vm.runInContext(
      verifyBody.replace(/512\s*\*\s*1024\s*\*\*\s*2/g, String(cap)) +
        "\nverifyBootstrap",
      scope,
    );
    scope.held = async (...args) => {
      opened.push(args[0]);
      return actual.held(...args);
    };
    await assert.rejects(
      scaled(
        directory,
        p,
        program,
        { remaining: () => 10000 },
        sha(contextRaw),
      ),
      /FULL_BOOTSTRAP_BYTES/,
    );
    assert(opened.includes(witness.client.path));
    assert(!opened.includes(witness.vpython.path));
    t.diagnostic(JSON.stringify(result));
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
    await fs.writeFile(
      path.join(directory, "source_bootstrap.py"),
      "def bind(*args): pass\n",
    );
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
    const inactive = structuredClone(projection);
    inactive.hooks[0].condition = "False";
    inactive.hooks[0].action = [
      "unsupported-platform-tool",
      "%PATH%",
      "x&echo y",
    ];
    assert.deepEqual(
      validateHookProjection(packet(inactive)).hooks[0].action,
      inactive.hooks[0].action,
    );
    for (const mutate of [
      (value) => (value.hooks[0].cwd = "../foreign"),
      (value) => (value.hooks[0].action = ["python3", "bad\0argument"]),
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

test("reviewed same-image host bytes bind closed source GN without claiming runtime loader proof", async () => {
  assert.deepEqual(reviewedHostTools(profile), profile.sourceGn.hostTools);
  const missing = structuredClone(profile);
  missing.sourceGn.hostTools.node = null;
  assert.throws(() => reviewedHostTools(missing), /FULL_HOST_TOOL_PIN_MISSING/);
  const closure = reviewedHostClosure(profile, profile.image);
  assert.equal(closure.rows.length, 18);
  assert.equal(closure.peBytes, 113853492);
  assert.equal(closure.edgeCount, 242);
  assert.equal(
    closure.edgeSha256,
    "78537ac08d4dddabd50a5c83cdbd676114fdf03cf9abe670359c4ffd20ba5d9a",
  );
  assert.equal(profile.phaseAdmission["source-gn"], true);
  assert.deepEqual(profile.sourceGn.executionPolicy, {
    hostLoaderClosureApproved: true,
    gitConfigurationApproved: true,
    sourceHookCommandClosureApproved: true,
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

test("actual fixed host handoff reader stops on first hash, deadline, image or aggregate failure without opening a later file", async () => {
  const p = structuredClone(profile),
    body = Buffer.from("SYNTHETIC HELD FIXTURE BYTES");
  for (const row of p.sourceGn.hostClosure.rows)
    Object.assign(row, { bytes: body.length, sha256: sha(body), nlink: 1 });
  p.sourceGn.hostClosure.peBytes = 18 * body.length;
  for (const [role, path] of [
    ["node", profile.sourceGn.hostTools.node.path],
    ["git", profile.sourceGn.hostTools.git.path],
  ]) {
    const row = p.sourceGn.hostClosure.rows.find((row) => row.path === path);
    p.sourceGn.hostTools[role] = {
      path: row.path,
      bytes: row.bytes,
      sha256: row.sha256,
      nlink: row.nlink,
    };
  }
  const opened = [],
    budget = { remaining: () => 1000 };
  const reader = async (file, cap, current, pin) => {
    opened.push(file);
    assert.equal(cap, body.length);
    assert.equal(current, budget);
    assert.equal(pin.sha256, sha(body));
    return body;
  };
  assert.equal(
    (await verifyHostClosure(p, budget, p.image, reader)).bytes,
    18 * body.length,
  );
  assert.deepEqual(
    opened,
    p.sourceGn.hostClosure.rows.map((row) => row.path),
  );
  opened.length = 0;
  await assert.rejects(
    verifyHostClosure(p, budget, p.image, async (file) => {
      opened.push(file);
      return Buffer.from("bad");
    }),
    /FULL_HOST_CLOSURE_PIN/,
  );
  assert.equal(opened.length, 1);
  opened.length = 0;
  await assert.rejects(
    verifyHostClosure(p, budget, "WRONG_IMAGE", reader),
    /FULL_HOST_IMAGE/,
  );
  assert.equal(opened.length, 0);
  const sentinel = new Error("fixture deadline");
  await assert.rejects(
    verifyHostClosure(
      p,
      {
        remaining: () => {
          throw sentinel;
        },
      },
      p.image,
      reader,
    ),
    (error) => error === sentinel,
  );
  assert.equal(opened.length, 0);
  for (const mutate of [
    (value) =>
      (value.sourceGn.hostClosure.rows[0].path = "C:/foreign/node.exe"),
    (value) =>
      (value.sourceGn.hostClosure.rows.at(-1).path =
        "C:/Program Files/Git/ucrt64/bin/CON.dll"),
    (value) =>
      value.sourceGn.hostClosure.rows.push(value.sourceGn.hostClosure.rows[0]),
    (value) =>
      (value.sourceGn.hostClosure.rows[1].path =
        value.sourceGn.hostClosure.rows[0].path),
    (value) => (value.sourceGn.hostClosure.rows[0].machine = 0xaa64),
    (value) => (value.sourceGn.hostClosure.rows[0].nlink = 9),
    (value) => (value.sourceGn.hostClosure.rows[0].observedAsExpected = true),
    (value) => (value.sourceGn.hostClosure.peBytes = 512 * 1024 ** 2 + 1),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    await assert.rejects(
      verifyHostClosure(changed, budget, p.image, reader),
      /FULL_/,
    );
    assert.equal(opened.length, 0);
  }
});

test("closed source driver checkpoint helper calls remain graph-only on the inherited helper basis", async () => {
  const body = await read(prefix + "source-driver.mjs");
  assert.deepEqual(
    [
      ...new Set(
        [
          ...body.matchAll(/(?<![A-Za-z0-9_-])checkpoint\.([A-Za-z0-9_]+)/g),
        ].map((match) => match[1]),
      ),
    ].sort(),
    ["graphInventory", "graphPinSnapshot"],
  );
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
  assert.deepEqual(
    commands[1].args,
    hookProjectionArguments(files.depot, files.commands),
  );
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

async function actualCommandModel(overrides = {}, options = {}) {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("async function executeCommand("),
    end = text.indexOf("export async function main(", begin);
  assert(begin >= 0 && end > begin);
  const sequence = [];
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
    sourceReportingFailure: false,
    syncCloseReportingFaults: new WeakMap(),
    Number,
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
      sequence.push("spawn");
      queueMicrotask(() => {
        if (Object.hasOwn(options, "primary"))
          child.stderr.emit("error", options.primary);
        const close = () => {
          sequence.push("child-close");
          return child.emit(
            "close",
            options.code === undefined ? 0 : options.code,
            options.signal === undefined ? null : options.signal,
          );
        };
        if (options.delayedClose) setImmediate(close);
        else close();
      });
      return child;
    },
    ...overrides,
  };
  const context = vm.createContext(scope),
    actual = vm.runInContext("(" + text.slice(begin, end) + ")", context);
  const command = {
    role: options.role ?? "owned",
    executable: "never-executed",
    args: [],
    cwd: "owned",
  };
  const limits = { bytes: 0, cap: options.cap ?? 1024 };
  let failed = false,
    error,
    value,
    nextStage = false,
    verification = 0;
  Object.assign(scope, {
    limits,
    homeObservation: null,
    observeGitHome: async () => {
      sequence.push("watch-start");
      if (Object.hasOwn(options, "watchStartFault"))
        throw options.watchStartFault;
      if (options.observation) return options.observation;
      return {
        snapshot: () => ({ rows: [], watcherClosed: !options.watchCloseFault }),
        finish: async () => {
          sequence.push("watch-close-join");
          if (Object.hasOwn(options, "watchCloseFault"))
            throw options.watchCloseFault;
        },
      };
    },
    withGitHomeEvents: (report) => report,
    appendGitPolicyDiagnostic: async () => {
      if (Object.hasOwn(options, "watchReportFault"))
        throw options.watchReportFault;
    },
    verifyHostClosure: async () => {},
    p: {},
    budget: {},
    c: { image: "fixture" },
    held: async () => {},
    bootstrap: { file: "fixture", pin: {}, witnessPin: null },
    verifyBootstrap: async () => {},
    root: "fixture",
    argv: [],
    adapter: { file: "fixture", pin: {} },
    HOOK_PRIMARY: [],
    files: { logs: "owned" },
    verifyGitPolicy: async () => {
      sequence.push(verification === 0 ? "policy-before" : "policy-after");
      if (++verification === 2 && Object.hasOwn(options, "policyFault"))
        throw options.policyFault;
    },
    console: { error() {} },
  });
  const checkedStart = text.indexOf("  const checked = async (action,"),
    checkedEnd = text.indexOf("\n  try {\n    await sourceStage", checkedStart),
    checked = vm.runInContext(
      `(async()=>{${text.slice(checkedStart, checkedEnd)};return checked})()`,
      context,
    );
  try {
    const action = () =>
      actual(
        command,
        [command],
        {},
        { logs: "owned" },
        { remaining: options.remaining ?? (() => 500000) },
        limits,
        false,
      );
    value = options.checked
      ? await (
          await checked
        )(action, options.observeHome ?? false)
      : await action();
    nextStage = true;
  } catch (value) {
    failed = true;
    error = value;
  }
  if (options.delayedClose)
    await new Promise((resolve) => setImmediate(resolve));
  return {
    scope,
    closed,
    opened,
    spawnCount,
    failed,
    error,
    limits,
    value,
    nextStage,
    verification,
    sequence,
  };
}

test("actual sync close retains only observed bounded status and preserves non-sync behavior", async () => {
  for (const [code, signal] of [
    [0, null],
    [128, null],
    [null, "SIGTERM"],
    [null, "private signal"],
  ]) {
    const writes = [];
    const result = await actualCommandModel(
      {
        writeSync: (fd, raw) => {
          writes.push({ fd, raw: Buffer.from(raw) });
          return raw.length;
        },
      },
      { role: "sync", code, signal },
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].fd, 7);
    assert(writes[0].raw.length <= 512);
    const text = writes[0].raw.toString("utf8");
    assert(text.startsWith("FULL_SYNC_CLOSE:"));
    assert.deepEqual(JSON.parse(text.slice("FULL_SYNC_CLOSE:".length)), {
      code,
      signal: signal === "private signal" ? "UNCLASSIFIED" : signal,
    });
    assert.equal(result.limits.bytes, writes[0].raw.length);
    assert.equal(result.failed, !(code === 0 && signal === null));
    if (result.failed)
      assert.equal(result.error.message, "FULL_SOURCE_CHILD_FAILED");
    assert.deepEqual(result.closed, [7, 8]);
  }
  let writes = 0;
  const ordinary = await actualCommandModel({
    writeSync: () => {
      writes++;
      throw new Error("unexpected");
    },
  });
  assert.equal(ordinary.failed, false);
  assert.equal(writes, 0);
});

test("actual sync close reporting cannot replace a primary and precharges its shared ledger", async () => {
  const reportError = new Error("owned reporting fault");
  for (const primary of [new Error("owned stream error"), null, false, 0]) {
    const result = await actualCommandModel(
      {
        writeSync: () => {
          throw reportError;
        },
      },
      { role: "sync", primary },
    );
    assert.equal(result.failed, true);
    assert.equal(result.error, primary);
    assert.equal(result.scope.sourceReportingFailure, true);
    assert(result.limits.bytes > 0);
    assert.deepEqual(result.closed, [7, 8]);
  }
  const childFailure = await actualCommandModel(
    {
      writeSync: () => {
        throw reportError;
      },
    },
    { role: "sync", code: 128 },
  );
  assert.equal(childFailure.error.message, "FULL_SOURCE_CHILD_FAILED");
  const reportOnly = await actualCommandModel(
    {
      writeSync: () => {
        throw reportError;
      },
    },
    { role: "sync" },
  );
  assert.equal(reportOnly.failed, false);
  assert.equal(
    reportOnly.scope.syncCloseReportingFaults.get(reportOnly.value),
    reportError,
  );
  assert.equal(reportOnly.scope.sourceReportingFailure, true);
  let writes = 0;
  const bound = await actualCommandModel(
    {
      writeSync: () => {
        writes++;
        return 0;
      },
    },
    { role: "sync", cap: 1 },
  );
  assert.equal(writes, 0);
  assert.match(
    bound.scope.syncCloseReportingFaults.get(bound.value).message,
    /FULL_SOURCE_OUTPUT_BOUND/,
  );
  assert.equal(bound.limits.bytes, 0);
  const short = await actualCommandModel(
    { writeSync: () => 0 },
    { role: "sync" },
  );
  assert.match(
    short.scope.syncCloseReportingFaults.get(short.value).message,
    /FULL_SOURCE_LOG_WRITE/,
  );
  assert(short.limits.bytes > 0);
  let checks = 0;
  const deadline = new Error("owned deadline");
  const expired = await actualCommandModel(
    {
      writeSync: () => {
        throw new Error("must not write");
      },
    },
    {
      role: "sync",
      remaining: () => {
        if (++checks >= 3) throw deadline;
        return 500000;
      },
    },
  );
  assert.equal(expired.error, deadline);
  assert.equal(expired.limits.bytes, 0);
  assert.equal(expired.scope.sourceReportingFailure, true);
  let lateWrites = 0;
  const early = new Error("owned early failure");
  const late = await actualCommandModel(
    {
      writeSync: () => {
        lateWrites++;
        return 0;
      },
    },
    {
      role: "sync",
      primary: early,
      delayedClose: true,
    },
  );
  assert.equal(late.error, early);
  assert.equal(lateWrites, 0);
  assert.equal(late.scope.sourceReportingFailure, true);
  assert.deepEqual(late.closed, [7, 8]);
});

test("actual checked boundary prioritizes strict postcheck over optional sync reporting and blocks next stage", async () => {
  const report = new Error("owned report fault"),
    policy = new Error("owned policy fault");
  for (const policyFault of [policy, null, 0, undefined]) {
    const result = await actualCommandModel(
      {
        writeSync: () => {
          throw report;
        },
      },
      {
        role: "sync",
        checked: true,
        policyFault,
      },
    );
    assert.equal(result.failed, true);
    assert.equal(result.error, policyFault);
    assert.equal(result.verification, 2);
    assert.equal(result.nextStage, false);
    assert.equal(result.scope.sourceReportingFailure, true);
  }
  const postPass = await actualCommandModel(
    {
      writeSync: () => {
        throw report;
      },
    },
    { role: "sync", checked: true },
  );
  assert.equal(postPass.failed, true);
  assert.equal(postPass.error, report);
  assert.equal(postPass.verification, 2);
  assert.equal(postPass.nextStage, false);
  for (const primary of [
    new Error("owned child fault"),
    null,
    false,
    0,
    undefined,
  ]) {
    const result = await actualCommandModel(
      {
        writeSync: () => {
          throw report;
        },
      },
      {
        role: "sync",
        checked: true,
        primary,
        policyFault: policy,
      },
    );
    assert.equal(result.error, primary);
    assert.equal(result.failed, true);
    assert.equal(result.verification, 2);
    assert.equal(result.nextStage, false);
  }
  const child = await actualCommandModel(
    {
      writeSync: () => {
        throw report;
      },
    },
    {
      role: "sync",
      checked: true,
      code: 128,
      policyFault: policy,
    },
  );
  assert.equal(child.error.message, "FULL_SOURCE_CHILD_FAILED");
  assert.equal(child.nextStage, false);
  const good = await actualCommandModel({}, { role: "sync", checked: true });
  assert.equal(good.failed, false);
  assert.equal(good.nextStage, true);
  assert.equal(good.verification, 2);
});

test("actual checked HOME lifecycle faults never skip strict postcheck or replace original/policy errors", async () => {
  const observer = new Error("owned observer fault"),
    report = new Error("owned append fault"),
    policy = new Error("owned policy fault");
  for (const primary of [
    new Error("owned child fault"),
    null,
    false,
    0,
    undefined,
  ]) {
    const result = await actualCommandModel(
      {},
      {
        role: "sync",
        checked: true,
        observeHome: true,
        primary,
        watchCloseFault: observer,
        watchReportFault: report,
        policyFault: policy,
      },
    );
    assert.equal(result.failed, true);
    assert.equal(result.error, primary);
    assert.equal(result.verification, 2);
    assert.equal(result.nextStage, false);
  }
  for (const policyFault of [policy, null, 0, undefined]) {
    const result = await actualCommandModel(
      {},
      {
        role: "sync",
        checked: true,
        observeHome: true,
        watchCloseFault: observer,
        policyFault,
      },
    );
    assert.equal(result.error, policyFault);
    assert.equal(result.failed, true);
    assert.equal(result.verification, 2);
    assert.equal(result.nextStage, false);
  }
  const unknown = await actualCommandModel(
    {},
    {
      role: "sync",
      checked: true,
      observeHome: true,
      watchCloseFault: observer,
      watchReportFault: report,
    },
  );
  assert.equal(unknown.error, observer);
  assert.equal(unknown.nextStage, false);
  const reportOnly = await actualCommandModel(
    {},
    {
      role: "sync",
      checked: true,
      observeHome: true,
      watchReportFault: report,
    },
  );
  assert.equal(reportOnly.error, report);
  assert.equal(reportOnly.nextStage, false);
  const start = await actualCommandModel(
    {},
    { role: "sync", checked: true, observeHome: true, watchStartFault: null },
  );
  assert.equal(start.failed, true);
  assert.equal(start.error, null);
  assert.equal(start.spawnCount, 0);
  assert.equal(start.verification, 2);
  const startAndPolicy = await actualCommandModel(
    {},
    {
      role: "sync",
      checked: true,
      observeHome: true,
      watchStartFault: null,
      policyFault: policy,
    },
  );
  assert.equal(startAndPolicy.error, policy);
  assert.equal(startAndPolicy.spawnCount, 0);
  assert.equal(startAndPolicy.verification, 2);
  assert.equal(startAndPolicy.nextStage, false);
  const both = await actualCommandModel(
    {
      writeSync: () => {
        throw report;
      },
    },
    {
      role: "sync",
      checked: true,
      observeHome: true,
      watchCloseFault: observer,
      policyFault: policy,
    },
  );
  assert.equal(both.error, policy);
  assert.equal(both.nextStage, false);
  const reportFirst = await actualCommandModel(
    {
      writeSync: () => {
        throw report;
      },
    },
    {
      role: "sync",
      checked: true,
      observeHome: true,
      watchCloseFault: observer,
    },
  );
  assert.equal(reportFirst.error, report);
  assert.equal(reportFirst.nextStage, false);
  const good = await actualCommandModel(
    {},
    { role: "sync", checked: true, observeHome: true },
  );
  assert.equal(good.failed, false);
  assert.equal(good.nextStage, true);
  assert.deepEqual(good.sequence, [
    "policy-before",
    "watch-start",
    "spawn",
    "child-close",
    "watch-close-join",
    "policy-after",
  ]);
});

async function actualHomeWatchModel(options = {}) {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("export async function observeGitHome("),
    end = text.indexOf("function withGitHomeEvents(", begin);
  assert(begin >= 0 && end > begin);
  let callback,
    reads = 0,
    watches = 0,
    closes = 0;
  const watcher = new EventEmitter();
  watcher.close = () => {
    closes++;
    if (!options.stallClose) queueMicrotask(() => watcher.emit("close"));
    if (Object.hasOwn(options, "closeFault")) throw options.closeFault;
  };
  const stat = (name) => {
    reads++;
    const value = {
      dev: 1n,
      ino: name.endsWith("home") ? 2n : 1n,
      birthtimeNs: 1n,
      mode: 16877n,
      nlink: 1n,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    if (options.stat) options.stat(value, reads);
    return value;
  };
  const actual = vm.runInNewContext(
    "(" + text.slice(begin, end).replace("export ", "") + ")",
    {
      path,
      Buffer,
      Promise,
      setTimeout: options.setTimeout ?? setTimeout,
      clearTimeout: options.clearTimeout ?? clearTimeout,
      need: (ok, code) => assert(ok, code),
      sha: (raw) => createHash("sha256").update(raw).digest("hex"),
      gitDiagnosticIdentity: (stat) => {
        const fields = ["dev", "ino", "birthtimeNs", "mode", "nlink"];
        return fields.every((key) => typeof stat[key] === "bigint") &&
          stat.nlink > 0n &&
          stat.birthtimeNs >= 0n
          ? fields.map((key) => stat[key].toString()).join(":")
          : null;
      },
      fs: { lstat: async (name) => stat(name) },
      physical: async () => {
        if (Object.hasOwn(options, "physicalFault"))
          throw options.physicalFault;
      },
      watch: (_home, watchOptions, receive) => {
        watches++;
        callback = receive;
        assert.deepEqual(JSON.parse(JSON.stringify(watchOptions)), {
          recursive: false,
          persistent: false,
          encoding: "buffer",
        });
        receive("rename", Buffer.from("unarmed-private-name"));
        return watcher;
      },
    },
  );
  let observation,
    error,
    failed = false;
  try {
    observation = await actual(
      path.join(
        path.parse(process.cwd()).root,
        "owned",
        "cef-source-git-policy",
      ),
      {
        remaining: options.remaining ?? (() => 500000),
      },
    );
  } catch (value) {
    failed = true;
    error = value;
  }
  return {
    observation,
    error,
    failed,
    watcher,
    event: (...args) => callback(...args),
    reads: () => reads,
    watches: () => watches,
    closes: () => closes,
  };
}

test("actual HOME watch bounds hashes and performs no per-event filesystem queries", async () => {
  const zero = await actualHomeWatchModel();
  const empty = await zero.observation.finish();
  assert.equal(empty.notifications, 0);
  assert.equal(empty.observationComplete, false);
  assert.equal(empty.watcherClosed, true);
  const model = await actualHomeWatchModel();
  assert.equal(model.failed, false);
  assert.equal(model.reads(), 4);
  assert.equal(model.observation.snapshot().rows.length, 0);
  const events = [
    ["rename", Buffer.from(".config")],
    ["change", Buffer.from("private-unknown-name")],
    ["arbitrary-private-kind", undefined],
    ["rename", Buffer.alloc(1025, 97)],
  ];
  for (const args of events) model.event(...args);
  for (let i = 0; i < 30; i++)
    model.event("change", Buffer.from("private-unknown-name"));
  assert.equal(model.reads(), 4);
  const snapshot = model.observation.snapshot();
  assert.equal(snapshot.rows.length, 16);
  assert.equal(snapshot.notifications, 17);
  assert.equal(snapshot.overflow, true);
  assert.equal(snapshot.observationComplete, false);
  assert.equal(snapshot.rows[0].role, "config");
  assert.equal(
    snapshot.rows[1].nameSha256,
    createHash("sha256").update("private-unknown-name").digest("hex"),
  );
  assert.equal(snapshot.rows[2].kind, "unknown");
  assert.equal(snapshot.rows[2].nameSha256, null);
  assert.equal(snapshot.rows[3].nameBytes, null);
  assert.equal(snapshot.rows[3].nameOversized, true);
  assert.equal(snapshot.rows[3].nameSha256, null);
  assert(!JSON.stringify(snapshot).includes("private-unknown"));
  const done = await model.observation.finish();
  assert.equal(done.watcherClosed, true);
  model.event("rename", Buffer.from("late-private-name"));
  assert.equal(model.observation.snapshot().rows.length, 16);
  await model.observation.finish();
  assert.equal(model.closes(), 1);
});

test("actual HOME watch rejects start aliases/replacement and joins or denies original-budget close", async () => {
  const alias = await actualHomeWatchModel({ physicalFault: null });
  assert.equal(alias.failed, true);
  assert.equal(alias.error, null);
  assert.equal(alias.watches(), 0);
  for (const field of ["ino", "birthtimeNs", "nlink", "mode"]) {
    const model = await actualHomeWatchModel({
      stat: (stat, count) => {
        if (count === 4) stat[field]++;
      },
    });
    assert.equal(model.failed, true);
    assert.match(model.error.message, /FULL_HOME_WATCH_CHANGED/);
    assert.equal(model.closes(), 1);
  }
  const unknown = await actualHomeWatchModel({
    stat: (stat) => {
      stat.birthtimeNs = undefined;
    },
  });
  assert.equal(unknown.failed, true);
  assert.equal(unknown.watches(), 0);
  const linked = await actualHomeWatchModel({
    stat: (stat) => {
      stat.isSymbolicLink = () => true;
    },
  });
  assert.equal(linked.failed, true);
  assert.equal(linked.watches(), 0);
  const delayed = await actualHomeWatchModel({ stallClose: true });
  let settled = false;
  const pending = delayed.observation.finish().then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(delayed.observation.snapshot().watcherClosed, false);
  delayed.watcher.emit("close");
  assert.equal((await pending).watcherClosed, true);
  const model = await actualHomeWatchModel({
    stallClose: true,
    remaining: () => 120005,
  });
  await assert.rejects(
    model.observation.finish(),
    /FULL_HOME_WATCH_CLOSE_UNKNOWN/,
  );
  assert.equal(model.observation.snapshot().watcherClosed, false);
  assert.equal(model.closes(), 1);
  model.watcher.emit("close");
  const first = await actualHomeWatchModel({
    stallClose: true,
    remaining: () => 120005,
  });
  first.watcher.emit("error", new Error("private raw message"));
  await assert.rejects(first.observation.finish(), /FULL_HOME_WATCH_ERROR/);
  assert.equal(first.observation.snapshot().watcherClosed, false);
  first.watcher.emit("close");
  const closeOnly = await actualHomeWatchModel({ closeFault: null });
  let caught = false;
  try {
    await closeOnly.observation.finish();
  } catch (error) {
    caught = true;
    assert.equal(error, null);
  }
  assert.equal(caught, true);
  assert.equal(closeOnly.observation.snapshot().watcherClosed, true);
});

test("actual HOME close join is capped at five seconds, clipped to original reserve, and clears early-close timers", async () => {
  for (const [remaining, expected] of [
    [9000000, 5000],
    [120004.9, 4],
  ]) {
    let callback, delay, cleared;
    const marker = {};
    const model = await actualHomeWatchModel({
      stallClose: true,
      remaining: () => remaining,
      setTimeout: (fn, ms) => {
        callback = fn;
        delay = ms;
        return marker;
      },
      clearTimeout: (timer) => {
        cleared = timer;
      },
    });
    const pending = model.observation.finish();
    assert.equal(delay, expected);
    assert.equal(model.closes(), 1);
    assert.equal(model.observation.snapshot().watcherClosed, false);
    callback();
    await assert.rejects(pending, /FULL_HOME_WATCH_CLOSE_UNKNOWN/);
    assert.equal(cleared, marker);
    assert.equal(model.observation.snapshot().watcherClosed, false);
    await assert.rejects(
      model.observation.finish(),
      /FULL_HOME_WATCH_CLOSE_UNKNOWN/,
    );
    assert.equal(model.closes(), 1);
    model.watcher.emit("close");
  }
  const unjoined = await actualHomeWatchModel({
    stallClose: true,
    remaining: () => 120005,
  });
  const denied = await actualCommandModel(
    {},
    {
      role: "sync",
      checked: true,
      observeHome: true,
      observation: unjoined.observation,
    },
  );
  assert.equal(denied.failed, true);
  assert.match(denied.error.message, /FULL_HOME_WATCH_CLOSE_UNKNOWN/);
  assert.equal(denied.nextStage, false);
  assert.equal(denied.verification, 2);
  const policyWins = await actualCommandModel(
    {},
    {
      role: "sync",
      checked: true,
      observeHome: true,
      observation: unjoined.observation,
      policyFault: null,
    },
  );
  assert.equal(policyWins.failed, true);
  assert.equal(policyWins.error, null);
  assert.equal(policyWins.nextStage, false);
  assert.equal(policyWins.verification, 2);
  unjoined.watcher.emit("close");
  const cleared = [],
    marker = {};
  let delay;
  const early = await actualHomeWatchModel({
    setTimeout: (_fn, ms) => {
      delay = ms;
      return marker;
    },
    clearTimeout: (timer) => cleared.push(timer),
  });
  assert.equal((await early.observation.finish()).watcherClosed, true);
  assert.equal(delay, 5000);
  assert.deepEqual(cleared, [marker]);
  let reads = 0,
    timers = 0;
  const expired = await actualHomeWatchModel({
    remaining: () => (++reads <= 4 ? 500000 : 119999),
    setTimeout: () => {
      timers++;
      return {};
    },
    clearTimeout() {},
  });
  await assert.rejects(
    expired.observation.finish(),
    /FULL_HOME_WATCH_CLOSE_UNKNOWN/,
  );
  assert.equal(expired.closes(), 1);
  assert.equal(timers, 0);
  assert.equal(expired.observation.snapshot().watcherClosed, true);
});

function waitForOwnedHomeNotification(observation, timers = globalThis) {
  return new Promise((resolve, reject) => {
    let settled = false,
      timer,
      immediate;
    const finish = (failed, error) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      timers.clearImmediate(immediate);
      if (failed) reject(error);
      else resolve();
    };
    const check = () => {
      immediate = undefined;
      if (settled) return;
      try {
        if (observation.snapshot().notifications > 0) finish(false);
        else immediate = timers.setImmediate(check);
      } catch (error) {
        finish(true, error);
      }
    };
    timer = timers.setTimeout(
      () => finish(true, new Error("owned watch notification unavailable")),
      2000,
    );
    check();
  });
}

test("owned HOME fixture notification wait cancels pending polling on success, timeout and exact rejection", async () => {
  for (const mode of ["success", "timeout", "rejection"]) {
    let timeout,
      poll,
      reads = 0,
      id = 0;
    const pending = new Map(),
      cleared = [],
      timers = {
        setTimeout(fn, ms) {
          assert.equal(ms, 2000);
          timeout = fn;
          return "timeout";
        },
        clearTimeout(timer) {
          cleared.push(timer);
        },
        setImmediate(fn) {
          poll = fn;
          pending.set(++id, fn);
          return id;
        },
        clearImmediate(handle) {
          pending.delete(handle);
        },
      };
    let notifications = 0,
      rejectRead = false;
    const observation = {
      snapshot() {
        reads++;
        if (rejectRead) throw null;
        return { notifications };
      },
    };
    const result = waitForOwnedHomeNotification(observation, timers);
    assert.equal(pending.size, 1);
    const latePoll = poll;
    if (mode === "timeout") {
      timeout();
      await assert.rejects(result, /notification unavailable/);
    } else {
      pending.clear();
      if (mode === "success") notifications = 1;
      else rejectRead = true;
      poll();
      if (mode === "success") await result;
      else {
        let caught = false;
        try {
          await result;
        } catch (error) {
          caught = true;
          assert.equal(error, null);
        }
        assert.equal(caught, true);
      }
    }
    assert.equal(pending.size, 0);
    assert.deepEqual(cleared, ["timeout"]);
    const count = reads;
    latePoll();
    timeout();
    assert.equal(reads, count);
    assert.equal(pending.size, 0);
  }
});

test("actual HOME report trimming preserves all endpoint facts and the original append bound", async () => {
  const text = await read(prefix + "source-driver.mjs"),
    begin = text.indexOf("function withGitHomeEvents("),
    end = text.indexOf("export function gitPolicyVerifier(", begin);
  const actual = vm.runInNewContext("(" + text.slice(begin, end) + ")", {
    Buffer,
    JSON,
  });
  const base = { kind: "fixture", endpointFacts: "x".repeat(7000) },
    events = {
      rows: Array.from({ length: 16 }, () => ({
        nameSha256: "a".repeat(64),
        kind: "change",
      })),
      omittedForReport: 0,
      watcherClosed: true,
      observationComplete: false,
    };
  const result = actual(base, events);
  assert.equal(result.endpointFacts, base.endpointFacts);
  assert(
    Buffer.byteLength(
      "SOURCE_GIT_DIAGNOSTIC:" + JSON.stringify(result) + "\n",
    ) <= 8192,
  );
  assert(result.homeEvents.rows.length < 16);
  assert(result.homeEvents.omittedForReport > 0);
  assert.equal(events.rows.length, 16);
  assert.equal(actual(base, null), base);
  const oversized = actual({ endpointFacts: "x".repeat(8192) }, events);
  assert.equal(oversized.endpointFacts.length, 8192);
  assert.equal(oversized.homeEvents.rows.length, 0);
  assert(
    Buffer.byteLength(
      "SOURCE_GIT_DIAGNOSTIC:" + JSON.stringify(oversized) + "\n",
    ) > 8192,
  );
  let calls = 0;
  const expired = await actualHomeWatchModel({
    remaining: () => {
      if (++calls >= 5) throw null;
      return 500000;
    },
  });
  let caught = false;
  try {
    await expired.observation.finish();
  } catch (error) {
    caught = true;
    assert.equal(error, null);
  }
  assert.equal(caught, true);
  assert.equal(expired.closes(), 1);
});

test("actual owned HOME create-delete emits hash-only notifications while strict policy still denies", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "home-event-proof-"),
  );
  let observation;
  try {
    const root = path.join(directory, "cef-source-git-policy"),
      policy = await prepareSourceGitIsolation(root),
      budget = { remaining: () => 500000 },
      file = path.join(root, "home", "owned-transient-public-probe");
    const log = path.join(directory, "sync.stderr.log"),
      limits = { bytes: 0, cap: 64 * 1024 ** 2 };
    await fs.writeFile(log, "");
    const verify = gitPolicyVerifier(
      root,
      log,
      budget,
      limits,
      () => sourceGitEnvironment(policy, {}),
      () => observation?.snapshot(),
    );
    await verify();
    observation = await observeGitHome(root, budget);
    await assert.rejects(fs.lstat(file), { code: "ENOENT" });
    await fs.writeFile(file, "owned benign fixture");
    await fs.unlink(file);
    await assert.rejects(fs.lstat(file), { code: "ENOENT" });
    await waitForOwnedHomeNotification(observation);
    const facts = await observation.finish();
    assert.equal(facts.watcherClosed, true);
    assert.equal(facts.observationComplete, false);
    assert(
      facts.rows.some(
        (row) =>
          row.nameSha256 ===
          createHash("sha256")
            .update("owned-transient-public-probe")
            .digest("hex"),
      ),
    );
    assert(!JSON.stringify(facts).includes("owned-transient-public-probe"));
    await assert.rejects(verify(), /SOURCE_GIT_POLICY_DIRECTORY/);
    const retained = await fs.readFile(log, "utf8");
    assert(Buffer.byteLength(retained) <= 8192);
    const report = JSON.parse(retained.slice("SOURCE_GIT_DIAGNOSTIC:".length));
    assert.equal(report.rows.length, 6);
    assert.equal(report.homeCandidates.length, 6);
    assert.equal(report.homeEvents.watcherClosed, true);
    assert.equal(report.homeEvents.observationComplete, false);
    assert(report.homeEvents.rows.length > 0);
    console.info(
      "OWNED_HOME_EVENT_PROOF:" +
        JSON.stringify({
          platform: process.platform,
          endpointAbsentBeforeAfter: true,
          watcherClosed: facts.watcherClosed,
          notifications: facts.notifications,
          observationComplete: false,
          strictPolicyDenied: true,
        }),
    );
  } finally {
    if (observation)
      try {
        await observation.finish();
      } catch {
        /* retained primary */
      }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

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

test("full phase map admits source GN while engine and compiled checkpoint authority remain unavailable", () => {
  assert.deepEqual(profile.phaseAdmission, {
    "input-closure": true,
    "source-gn": true,
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
    "github.ref == 'refs/heads/codex/windows-arm-current-inventory-20261101'",
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
  assert(!workflow.includes("execute('git'"));
  assert(
    workflow.includes("canonicalSource(process.env.GITHUB_SHA,file,remaining)"),
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
  assert(
    workflow.includes(`assert.equal(hash(rawProfile),'${sha(profileRaw)}')`),
  );
  assert(workflow.includes("phase='python';await pinnedPython();"));
  assert(
    workflow.includes("await pinnedPython();\n            const monoRaw="),
  );
  assert(
    workflow.includes(
      "phase='owned-operation';await pinnedPython();child=spawn(p.python.path",
    ),
  );
});

test("actual Node carrier authority denies Main, foreign branches and forged default/source/input identity", () => {
  const begin = workflow.indexOf("// BEGIN FIXED CARRIER AUTHORITY");
  const end = workflow.indexOf("// END FIXED CARRIER AUTHORITY", begin);
  assert(begin >= 0 && end > begin);
  const authority = vm.runInNewContext(
    workflow.slice(begin, end) + "\ncarrierAuthority;",
    { assert, Object },
  );
  const ref = "refs/heads/codex/windows-arm-current-inventory-20261101";
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
  assert.throws(
    () => authority(env, { ...event, inputs: { mode: "source-gn" } }),
    /BOOT_CARRIER_AUTHORITY/,
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

test("new runner image is admitted only to passive inventory, keeping source tool pins closed", () => {
  const begin = workflow.indexOf("// BEGIN FIXED CARRIER AUTHORITY");
  const end = workflow.indexOf("// END FIXED CARRIER AUTHORITY", begin);
  const image = vm.runInNewContext(
    workflow.slice(begin, end) + "\ncarrierImage;",
    { assert, Object },
  );
  assert.equal(image("command-inventory", profile), "20261030.294.1");
  for (const mode of ["source-gn", "input-closure", "compile", "complete-sdk"])
    assert.throws(() => image(mode, profile), /BOOT_INVENTORY_MODE/);
  assert.throws(
    () => image("command-inventory", { ...profile, image: "20261030.294.1" }),
    /BOOT_INVENTORY_PROFILE/,
  );
  assert.equal(profile.image, "20261021.278.1");
  assert.equal(profile.sourceGn.hostClosure.image, profile.image);
  for (const flag of [
    "compilerAllowed",
    "checkpointAllowed",
    "restoreAllowed",
    "sdkAllowed",
  ])
    assert.equal(profile.sourceGn[flag], false);
  assert.equal(profile.commandInventory.candidateExecutionAllowed, false);
  assert.equal(profile.commandInventory.expectedPinsCreated, false);
});

function sourceWitnessFunctions(overrides = {}) {
  const begin = workflow.indexOf("// BEGIN FIXED INVENTORY SOURCE WITNESS");
  const end = workflow.indexOf("// END FIXED INVENTORY SOURCE WITNESS", begin);
  assert(begin >= 0 && end > begin);
  return vm.runInNewContext(
    workflow.slice(begin, end) + "\n({canonicalSource,sourceEncoding});",
    {
      assert,
      Buffer,
      Uint8Array,
      TextDecoder,
      AbortController,
      setTimeout,
      clearTimeout,
      ...overrides,
    },
  );
}
function sourceResponse(
  url,
  chunks = [Buffer.from("committed source\n")],
  extra = {},
) {
  let index = 0;
  const reader = {
    read: async () =>
      index < chunks.length
        ? { done: false, value: chunks[index++] }
        : { done: true },
    cancel: async () => {},
  };
  return {
    status: 200,
    redirected: false,
    url,
    headers: { get: () => null },
    body: { getReader: () => reader, cancel: async () => {} },
    ...extra,
  };
}
test("inventory source witnesses use only the exact public commit and closed paths without candidate Git", async () => {
  const { canonicalSource } = sourceWitnessFunctions();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return sourceResponse(url);
  };
  const head = "a".repeat(40),
    file = "native/windows-arm-full-sdk/producer.py";
  assert.equal(
    (await canonicalSource(head, file, () => 120000, fetcher)).toString(),
    "committed source\n",
  );
  assert.equal(
    calls[0].url,
    `https://raw.githubusercontent.com/supermarsx/sortOfRemoteNG/${head}/${file}`,
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.deepEqual(Object.keys(calls[0].options.headers), ["Accept"]);
  assert(calls[0].options.signal.aborted);
  for (const [sha, candidatePath] of [
    ["main", file],
    [head, "../outside"],
    [head, "scripts/cef-hosted-bootstrap.mjs"],
    ["b".repeat(39), file],
  ])
    await assert.rejects(
      canonicalSource(sha, candidatePath, () => 120000, fetcher),
      /SOURCE_WITNESS_SOURCE/,
    );
  assert.equal(calls.length, 1);
  assert(!/execute\(['"]git['"]|spawn\(['"]git['"]/.test(workflow));
});
test("inventory source witnesses deny redirects, wrong repository responses and oversized streams", async () => {
  const { canonicalSource } = sourceWitnessFunctions(),
    head = "a".repeat(40),
    file = "native/windows-arm-full-sdk/producer.py";
  for (const extra of [
    { status: 302 },
    { redirected: true },
    { url: "https://raw.githubusercontent.com/foreign/repo/main/file" },
  ])
    await assert.rejects(
      canonicalSource(
        head,
        file,
        () => 120000,
        async (url) => sourceResponse(url, [], extra),
      ),
      /SOURCE_WITNESS_RESPONSE/,
    );
  await assert.rejects(
    canonicalSource(
      head,
      file,
      () => 120000,
      async (url) =>
        sourceResponse(url, [], { headers: { get: () => "2097153" } }),
    ),
    /SOURCE_WITNESS_BOUND/,
  );
  await assert.rejects(
    canonicalSource(
      head,
      file,
      () => 120000,
      async (url) => sourceResponse(url, [new Uint8Array(2097153)]),
    ),
    /SOURCE_WITNESS_BOUND/,
  );
});
test("inventory source witnesses enforce request and whole deadlines, canceling late bodies", async () => {
  let deadline,
    resolve,
    signal,
    cancelled = 0;
  const { canonicalSource } = sourceWitnessFunctions({
    setTimeout(fn) {
      deadline = fn;
      return 1;
    },
    clearTimeout() {},
  });
  const pending = canonicalSource(
    "a".repeat(40),
    "native/windows-arm-full-sdk/producer.py",
    () => 120000,
    (url, options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = () =>
          done(
            sourceResponse(url, [], {
              body: {
                cancel: async () => {
                  cancelled++;
                },
                getReader() {
                  throw new Error("late body must not be read");
                },
              },
            }),
          );
      });
    },
  );
  deadline();
  await assert.rejects(pending, /SOURCE_WITNESS_DEADLINE/);
  assert(signal.aborted);
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.equal(cancelled, 1);
  const ordinary = sourceWitnessFunctions().canonicalSource;
  let checks = 0;
  await assert.rejects(
    ordinary(
      "a".repeat(40),
      "native/windows-arm-full-sdk/producer.py",
      () => (++checks === 1 ? 10000 : 2999),
      async (url) => sourceResponse(url),
    ),
    /SOURCE_WITNESS_DEADLINE/,
  );
});
test("source byte comparison rejects mutation and allows CRLF only for the two existing checkout exceptions", () => {
  const { sourceEncoding } = sourceWitnessFunctions();
  const canonical = Buffer.from("first\nsecond\n"),
    crlf = Buffer.from("first\r\nsecond\r\n");
  assert.equal(
    sourceEncoding(
      "native/windows-arm-full-sdk/producer.py",
      canonical,
      canonical,
    ),
    "exact",
  );
  assert.equal(
    sourceEncoding(
      ".github/workflows/windows-x64-arm-toolchain.yml",
      canonical,
      crlf,
    ),
    "git-crlf",
  );
  assert.throws(
    () =>
      sourceEncoding(
        "native/windows-arm-full-sdk/producer.py",
        canonical,
        crlf,
      ),
    /SOURCE_WITNESS_MISMATCH/,
  );
  assert.throws(
    () =>
      sourceEncoding(
        ".github/workflows/windows-x64-arm-toolchain.yml",
        canonical,
        Buffer.from("changed\n"),
      ),
    /SOURCE_WITNESS_MISMATCH/,
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

test("GitPolicy actual verifier records fixed roles after success and preserves only its first actual failure", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "source-git-diagnostic-"),
  );
  try {
    const policyRoot = path.join(directory, "cef-source-git-policy"),
      file = path.join(directory, "sync.stderr.log"),
      budget = { remaining: () => 10000 },
      limits = { bytes: 0, cap: 64 * 1024 ** 2 };
    await fs.writeFile(file, "existing child stderr\n");
    const policy = await prepareSourceGitIsolation(policyRoot);
    const verify = gitPolicyVerifier(policyRoot, file, budget, limits, () =>
      sourceGitEnvironment(policy, {}),
    );
    await verify();
    await fs.writeFile(path.join(policyRoot, "home", "owned-causal-data"), "x");
    let first;
    await assert.rejects(verify(), (error) => {
      first = error;
      return error.message === "SOURCE_GIT_POLICY_DIRECTORY";
    });
    const raw = await fs.readFile(file, "utf8"),
      lines = raw
        .split("\n")
        .filter((line) => line.startsWith("SOURCE_GIT_DIAGNOSTIC:"));
    assert.equal(lines.length, 1);
    const report = JSON.parse(lines[0].slice("SOURCE_GIT_DIAGNOSTIC:".length));
    assert.equal(report.success, false);
    assert.equal(report.code, first.message);
    assert.deepEqual(
      report.rows.map((row) => row.role),
      ["root", "home", "xdg", "hooks", "global", "system"],
    );
    assert.ok(
      report.rows
        .find((row) => row.role === "home")
        .changed.includes("mtimeNs"),
    );
    assert.equal(raw.includes(directory), false);
    assert.equal(raw.includes("owned-causal-data"), false);
    assert.ok(Buffer.byteLength(lines[0] + "\n") <= 8192);
    await assert.rejects(verify(), /SOURCE_GIT_POLICY_DIRECTORY/);
    assert.equal(await fs.readFile(file, "utf8"), raw);
    assert.equal(limits.bytes, Buffer.byteLength(lines[0] + "\n"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("GitPolicy diagnostic lstat facts retain directory/file replacement, birth and link deltas without following aliases", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "source-git-facts-"),
  );
  const original = fs.lstat;
  try {
    const policyRoot = path.join(directory, "cef-source-git-policy");
    await prepareSourceGitIsolation(policyRoot);
    const budget = { remaining: () => 10000 },
      before = await gitPolicyMetadata(policyRoot, budget);
    let calls = 0;
    fs.lstat = async (file, options) => {
      calls++;
      const stat = await original(file, options);
      if (path.basename(file) === "global.gitconfig")
        return new Proxy(stat, {
          get(target, key) {
            if (key === "ino" || key === "birthtimeNs" || key === "nlink")
              return target[key] + 1n;
            if (key === "isSymbolicLink") return () => true;
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      return stat;
    };
    const after = await gitPolicyMetadata(policyRoot, budget);
    assert.equal(calls, 6); // Direct fixed roles only; no realpath/open/readdir.
    const report = gitPolicyDiagnostic(
        new Error("private arbitrary error/path"),
        before,
        after,
      ),
      global = report.rows.find((row) => row.role === "global");
    assert.equal(report.code, "UNCLASSIFIED");
    let messageReads = 0;
    const changingMessage = {
      get message() {
        return ++messageReads === 1
          ? "SOURCE_GIT_POLICY_CHANGED"
          : "private second getter";
      },
    };
    assert.equal(
      gitPolicyDiagnostic(changingMessage, before, after).code,
      "SOURCE_GIT_POLICY_CHANGED",
    );
    assert.equal(messageReads, 1);
    assert.equal(global.afterType, "link");
    assert.equal(global.typeChanged, true);
    assert.deepEqual(global.changed, ["ino", "birthtimeNs", "nlink"]);
    assert.equal(JSON.stringify(report).includes("private"), false);
    fs.lstat = async () => {
      throw new Error("private path unavailable");
    };
    const absent = gitPolicyDiagnostic(
      null,
      before,
      await gitPolicyMetadata(policyRoot, budget),
    );
    assert.ok(
      absent.rows.every(
        (row) =>
          row.afterType === "unavailable" &&
          row.after === null &&
          row.changed === null,
      ),
    );
  } finally {
    fs.lstat = original;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual diagnostic append rejects alias, replacement, birth/nlink mismatches and charges before any I/O", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "source-git-append-"),
  );
  const open = fs.open,
    lstat = fs.lstat,
    realpath = fs.realpath;
  try {
    const file = path.join(directory, "sync.stderr.log"),
      budget = { remaining: () => 10000 },
      cap = 64 * 1024 ** 2;
    await fs.writeFile(file, "original\n");
    const report = gitPolicyDiagnostic(null, null, []);
    await appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap });
    const originalBytes = await fs.readFile(file);
    let opens = 0;
    fs.open = async (...args) => {
      opens++;
      return open(...args);
    };
    await assert.rejects(
      appendGitPolicyDiagnostic(file, report, budget, { bytes: cap, cap }),
      /FULL_SOURCE_OUTPUT_BOUND/,
    );
    await assert.rejects(
      appendGitPolicyDiagnostic(
        file,
        report,
        {
          remaining() {
            throw new Error("deadline");
          },
        },
        { bytes: 0, cap },
      ),
      /deadline/,
    );
    assert.equal(opens, 0);
    fs.realpath = async () => path.join(directory, "alternate");
    await assert.rejects(
      appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap }),
      /FULL_DRIVER_ALIAS/,
    );
    fs.realpath = realpath;
    for (const field of ["ino", "birthtimeNs", "nlink"]) {
      let writes = 0,
        closes = 0;
      fs.open = async (name, flags) => {
        assert.equal(Boolean(flags & fsConstants.O_CREAT), false);
        assert.ok(flags & fsConstants.O_APPEND);
        const fd = await open(name, flags);
        return {
          async stat(options) {
            const stat = await fd.stat(options);
            return { ...stat, [field]: stat[field] + 1n, isFile: () => true };
          },
          async write(...args) {
            writes++;
            return fd.write(...args);
          },
          async close() {
            closes++;
            await fd.close();
          },
        };
      };
      await assert.rejects(
        appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap }),
        /FULL_GIT_DIAGNOSTIC_IDENTITY/,
      );
      assert.equal(writes, 0);
      assert.equal(closes, 1);
    }
    fs.open = async (name, flags) => {
      const fd = await open(name, flags);
      return {
        stat: (...args) => fd.stat(...args),
        write: (...args) => fd.write(...args),
        async close() {
          await fd.close();
          throw closeOnly;
        },
      };
    };
    const closeOnly = new Error("closed secondary sentinel");
    await assert.rejects(
      appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap }),
      (error) => error === closeOnly,
    );
    fs.open = async (name, flags) => {
      const fd = await open(name, flags);
      return {
        stat: (...args) => fd.stat(...args),
        async write() {
          throw null;
        },
        async close() {
          await fd.close();
          throw closeOnly;
        },
      };
    };
    let appendCaught = false;
    try {
      await appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap });
    } catch (error) {
      appendCaught = true;
      assert.equal(error, null);
    }
    assert.equal(appendCaught, true);
    fs.open = open;
    const hardlink = path.join(directory, "held-alias");
    await fs.link(file, hardlink);
    await assert.rejects(
      appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap }),
      /FULL_GIT_DIAGNOSTIC_FILE/,
    );
    await fs.unlink(hardlink);
    let reads = 0;
    fs.lstat = async (name, options) => {
      const stat = await lstat(name, options);
      if (name === file && options?.bigint && ++reads === 2)
        return new Proxy(stat, {
          get(target, key) {
            if (key === "ino") return target.ino + 1n;
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      return stat;
    };
    await assert.rejects(
      appendGitPolicyDiagnostic(file, report, budget, { bytes: 0, cap }),
      /FULL_GIT_DIAGNOSTIC_CHANGED/,
    );
    fs.lstat = lstat;
    assert.ok((await fs.readFile(file)).length > originalBytes.length); // A post-write fault is reported as failure, never refunded.
    await assert.rejects(
      appendGitPolicyDiagnostic(
        path.join(directory, "missing"),
        report,
        budget,
        { bytes: 0, cap },
      ),
    );
    assert.equal(
      await fs.stat(path.join(directory, "missing")).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    fs.open = open;
    fs.lstat = lstat;
    fs.realpath = realpath;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("GitPolicy first errors including falsy values survive append/close/deadline faults and postcheck-only errors remain primary", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "source-git-first-"),
  );
  const open = fs.open;
  try {
    const policyRoot = path.join(directory, "cef-source-git-policy"),
      file = path.join(directory, "sync.stderr.log"),
      cap = 64 * 1024 ** 2;
    await prepareSourceGitIsolation(policyRoot);
    await fs.writeFile(file, "");
    for (const primary of [
      null,
      0,
      undefined,
      new Error("SOURCE_GIT_POLICY_CHANGED"),
    ]) {
      for (const mode of ["write", "close", "ledger", "deadline"]) {
        let fail = false,
          closes = 0,
          writes = 0;
        const budget = {
          remaining() {
            if (fail && mode === "deadline")
              throw new Error("secondary deadline");
            return 10000;
          },
        };
        fs.open = async (name, flags) => {
          const fd = await open(name, flags);
          return {
            stat: (...args) => fd.stat(...args),
            async write(...args) {
              writes++;
              if (mode === "write") throw new Error("secondary append");
              return fd.write(...args);
            },
            async close() {
              closes++;
              await fd.close();
              if (mode === "close") throw new Error("secondary close");
            },
          };
        };
        const limits = { bytes: 0, cap },
          verify = gitPolicyVerifier(
            policyRoot,
            file,
            budget,
            limits,
            async () => {
              if (fail) throw primary;
              return 7;
            },
          );
        assert.equal(await verify(), 7);
        fail = true;
        if (mode === "ledger") limits.bytes = cap;
        let caught = false;
        try {
          await verify();
        } catch (error) {
          caught = true;
          assert.equal(error, primary);
        }
        assert.equal(caught, true);
        const count = writes;
        try {
          await verify();
        } catch (error) {
          assert.equal(error, primary);
        }
        assert.equal(writes, count);
        assert.equal(closes, mode === "write" || mode === "close" ? 1 : 0);
      }
    }
    fs.open = open;
    const body = await read(prefix + "source-driver.mjs"),
      start = body.indexOf("  const checked = async (action,"),
      end = body.indexOf("\n  try {\n    await sourceStage", start);
    const checked = vm.runInNewContext(
      `(async()=>{${body.slice(start, end)};return checked})()`,
      {
        syncCloseReportingFaults: new WeakMap(),
        homeObservation: null,
        verifyHostClosure: async () => {},
        p: {},
        budget: {},
        c: { image: "fixture" },
        held: async () => {},
        bootstrap: { file: "fixture", pin: {}, witnessPin: null },
        verifyBootstrap: async () => {},
        root: "fixture",
        argv: [],
        adapter: { file: "fixture", pin: {} },
        HOOK_PRIMARY: [],
        files: {},
        path,
        verifyGitPolicy: async () => {
          if (++verification === 2) throw postFailure;
        },
        console: { error() {} },
      },
    );
    let verification = 0,
      postFailure = null;
    const actual = await checked;
    let caught = false;
    try {
      await actual(async () => 7);
    } catch (error) {
      caught = true;
      assert.equal(error, postFailure);
    }
    assert.equal(caught, true);
    verification = 0;
    postFailure = new Error("secondary");
    for (const primary of [null, 0, undefined]) {
      verification = 0;
      caught = false;
      try {
        await actual(async () => {
          throw primary;
        });
      } catch (error) {
        caught = true;
        assert.equal(error, primary);
      }
      assert.equal(caught, true);
    }
  } finally {
    fs.open = open;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("HOME candidates record only fixed metadata from an actual auth-shaped mutation", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "home-candidate-facts-"),
  );
  try {
    const root = path.join(directory, "cef-source-git-policy"),
      file = path.join(directory, "sync.stderr.log"),
      budget = { remaining: () => 10000 },
      limits = { bytes: 0, cap: 64 * 1024 ** 2 };
    const policy = await prepareSourceGitIsolation(root);
    await fs.writeFile(file, "");
    const verify = gitPolicyVerifier(root, file, budget, limits, () =>
      sourceGitEnvironment(policy, {}),
    );
    await verify();
    const auth = path.join(root, "home/.config/chrome_infra/auth");
    await fs.mkdir(auth, { recursive: true });
    const secret = "NEVER-READ-THIS-CONTENT-private-token";
    await fs.writeFile(path.join(auth, "tokens.json"), secret);
    await fs.writeFile(path.join(auth, "creds.json"), secret);
    await assert.rejects(verify(), /SOURCE_GIT_POLICY_DIRECTORY/);
    const raw = await fs.readFile(file, "utf8"),
      report = JSON.parse(raw.slice("SOURCE_GIT_DIAGNOSTIC:".length));
    assert.deepEqual(
      report.homeCandidates.map((row) => row.role),
      [
        "config",
        "auth-parent",
        "auth",
        "auth-tokens",
        "auth-credentials",
        "cache",
      ],
    );
    assert.deepEqual(
      report.homeCandidates.map((row) => row.afterType),
      ["directory", "directory", "directory", "file", "file", "absent"],
    );
    assert(
      report.homeCandidates.every(
        (row) => row.beforeType === "absent" || row.beforeType === "blocked",
      ),
    );
    assert.equal(raw.includes(secret), false);
    assert.equal(raw.includes(directory), false);
    assert.equal(raw.includes("tokens.json"), false);
    assert(Buffer.byteLength(raw) <= 8192);
    assert.equal(limits.bytes, Buffer.byteLength(raw));
    await assert.rejects(verify(), /SOURCE_GIT_POLICY_DIRECTORY/);
    assert.equal(await fs.readFile(file, "utf8"), raw);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("HOME candidates never query descendants of linked, unknown or replaced ancestors", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "home-candidate-ancestors-"),
  );
  const lstat = fs.lstat,
    open = fs.open,
    readdir = fs.readdir,
    realpath = fs.realpath;
  try {
    const root = path.join(directory, "cef-source-git-policy"),
      home = path.join(root, "home"),
      config = path.join(home, ".config"),
      budget = { remaining: () => 10000 };
    await prepareSourceGitIsolation(root);
    await fs.mkdir(path.join(config, "chrome_infra/auth"), { recursive: true });
    const baseline = await gitHomeCandidateMetadata(root, budget);
    let forbiddenIO = 0;
    fs.open =
      fs.readdir =
      fs.realpath =
        async () => {
          forbiddenIO++;
          throw new Error("forbidden diagnostic IO");
        };
    for (const ancestor of [directory, root, home, config]) {
      for (const mutation of [
        "link",
        "unknown",
        "dev",
        "ino",
        "birthtimeNs",
        "mode",
        "nlink",
        "unavailable",
      ]) {
        const queries = [];
        fs.lstat = async (file, options) => {
          queries.push(file);

          if (file === ancestor && mutation === "unavailable")
            throw Object.assign(new Error("private"), { code: "EACCES" });
          const stat = await lstat(file, options);
          if (file !== ancestor) return stat;
          return new Proxy(stat, {
            get(target, key) {
              if (mutation === "link" && key === "isSymbolicLink")
                return () => true;
              if (mutation === "unknown" && key === "birthtimeNs")
                return undefined;
              if (key === mutation) return target[key] + 1n;
              const value = target[key];
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        };
        const current = await gitHomeCandidateMetadata(root, budget, baseline);
        assert(queries.includes(ancestor));
        assert(
          !queries.some((file) => file.startsWith(ancestor + path.sep)),
          `queried a descendant after ${mutation}`,
        );
        for (const row of current.rows) {
          if (ancestor === config && row.role === "cache") continue;
          const type =
            ancestor === config && row.role === "config" && mutation === "link"
              ? "link"
              : ancestor === config &&
                  row.role === "config" &&
                  mutation === "unavailable"
                ? "unavailable"
                : "blocked";
          assert.equal(row.type, type, `${mutation}/${row.role}`);
        }
      }
    }
    fs.lstat = async () => {
      throw new Error("no baseline must not query");
    };
    assert(
      (await gitHomeCandidateMetadata(root, budget, null)).rows.every(
        (row) => row.type === "blocked",
      ),
    );
    assert(
      (
        await gitHomeCandidateMetadata(root, budget, {
          anchors: new Map(),
          trustedHome: false,
        })
      ).rows.every((row) => row.type === "blocked"),
    );
    assert.equal(forbiddenIO, 0);
    Object.assign(fs, { lstat, open, readdir, realpath });
    const saved = path.join(home, "saved-config");
    await fs.rename(config, saved);
    await fs.symlink(
      saved,
      config,
      process.platform === "win32" ? "junction" : "dir",
    );
    const queries = [];
    fs.lstat = async (...args) => {
      queries.push(args[0]);
      return lstat(...args);
    };
    const linked = await gitHomeCandidateMetadata(root, budget, baseline);
    assert.equal(linked.rows[0].type, "blocked"); // Replacing an existing directory changes its identity.
    assert(!queries.some((file) => file.startsWith(config + path.sep)));
    assert(linked.rows.slice(1, 5).every((row) => row.type === "blocked"));
  } finally {
    Object.assign(fs, { lstat, open, readdir, realpath });
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("HOME candidates discard in-flight facts when an ancestor changes and retain original deadlines", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "home-candidate-race-"),
  );
  const lstat = fs.lstat;
  try {
    const root = path.join(directory, "cef-source-git-policy"),
      config = path.join(root, "home/.config"),
      auth = path.join(config, "chrome_infra/auth"),
      token = path.join(auth, "tokens.json"),
      budget = { remaining: () => 10000 };
    await prepareSourceGitIsolation(root);
    await fs.mkdir(auth, { recursive: true });
    await fs.writeFile(token, "inert data");
    const baseline = await gitHomeCandidateMetadata(root, budget);
    let replaced = false,
      tokenQueries = 0;
    fs.lstat = async (file, options) => {
      const stat = await lstat(file, options);
      if (file === token) {
        tokenQueries++;
        replaced = true;
      }
      if (file === config && replaced)
        return new Proxy(stat, {
          get(target, key) {
            if (key === "ino") return target.ino + 1n;
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      if (replaced) assert(file !== path.join(auth, "creds.json"));
      return stat;
    };
    const current = await gitHomeCandidateMetadata(root, budget, baseline);
    assert.equal(tokenQueries, 1);
    assert.equal(
      current.rows.find((row) => row.role === "auth-tokens").type,
      "blocked",
    );
    assert.equal(
      current.rows.find((row) => row.role === "auth-credentials").type,
      "blocked",
    );
    fs.lstat = lstat;
    let queries = 0;
    fs.lstat = async (...args) => {
      queries++;
      return lstat(...args);
    };
    const deadline = new Error("exact original deadline");
    await assert.rejects(
      gitHomeCandidateMetadata(
        root,
        {
          remaining() {
            throw deadline;
          },
        },
        baseline,
      ),
      (error) => error === deadline,
    );
    assert.equal(queries, 0);
  } finally {
    fs.lstat = lstat;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("source GN actual owned-policy caller fixes Windows longpaths without accepting caller policy", async () => {
  const text = await read(prefix + "source-driver.mjs"),
    marker = "  const gitPolicy = await custom.prepareSourceGitIsolation(",
    start = text.indexOf(marker),
    end = text.indexOf("  const adapter =", start);
  assert(start > 0 && end > start);
  assert.equal(text.split("custom.prepareSourceGitIsolation(").length - 1, 1);
  const call = text.slice(start, end),
    AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "source-longpath-adoption-"),
  );
  try {
    let calls = 0;
    const custom = {
      async prepareSourceGitIsolation(policyRoot, options) {
        calls++;
        assert.equal(policyRoot, path.join(directory, "cef-source-git-policy"));
        assert.deepEqual(options, { windowsLongPaths: true });
        assert.equal(Object.getPrototypeOf(options), Object.prototype);
        return prepareSourceGitIsolation(policyRoot, options);
      },
    };
    const invoke = new AsyncFunction(
      "root",
      "custom",
      "path",
      call + "return gitPolicy;",
    );
    if (process.platform === "win32") {
      const token = await invoke(directory, custom, path);
      const env = await sourceGitEnvironment(token, {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.longpaths",
        GIT_CONFIG_VALUE_0: "false",
      });
      const config = await fs.readFile(env.GIT_CONFIG_GLOBAL, "utf8");
      assert(config.includes("\tlongpaths = true\n"));
      assert.equal(env.GIT_CONFIG_COUNT, undefined);
    } else {
      await assert.rejects(
        invoke(directory, custom, path),
        /SOURCE_GIT_WINDOWS_LONGPATHS_OPTION/,
      );
      await assert.rejects(
        fs.lstat(path.join(directory, "cef-source-git-policy")),
        { code: "ENOENT" },
      );
    }
    assert.equal(calls, 1);
    for (const replacement of [
      "",
      "    { windowsLongPaths: false },\n",
      "    { windowsLongPaths: true, extra: true },\n",
    ]) {
      const mutated = call.replace(
        "    { windowsLongPaths: true },\n",
        replacement,
      );
      assert.notEqual(mutated, call);
      await assert.rejects(
        new AsyncFunction(
          "root",
          "custom",
          "path",
          mutated + "return gitPolicy;",
        )(directory, custom, path),
        assert.AssertionError,
      );
    }
    assert.equal(calls, 4);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("longpaths adoption changes only its reviewed helper row in the strict profile", async () => {
  const helper = profile.sourceGn.helpers.find(
    (row) => row.path === "scripts/lib/browser-custom-runtime.mjs",
  );
  assert.deepEqual(helper, {
    path: "scripts/lib/browser-custom-runtime.mjs",
    bytes: 68713,
    sha256: "c55c1e013564cdc0f106decbb96dd22ae9a2e690749ecb709c2714246b79a13d",
  });
  const original = profileRaw
    .toString("utf8")
    .replace(
      helper.sha256,
      "dd788379941028ef9a5b2c9318605d26ea9abe2663253b5b59d57504c4aa60af",
    )
    .replace('"bytes": 68713', '"bytes": 68266');
  assert.equal(
    sha(Buffer.from(original)),
    "e5cb5cd3285faf2f9590a5d867918f3a710423e97c2478ac2e0be8c2e8e4ab0f",
  );
  assert.equal(
    sha(profileRaw),
    "ccadcf1fc6f86fe11b922d93c11dc6192ccf571f03c485c610e89938c60b546a",
  );
});

// This evaluates the exact inactive module body in a separate lexical module.
// BEGIN EXACT CLOCK FAILURE ENUM INVERSE
const CLOCK_FAILURE_INVERSE = {
  block:
    '// BEGIN FIXED WORKFLOW CLOCK FAILURE CODES\nconst STARTUP_CLOCK_ERRORS = new Set([\n  "FULL_SDK_WORKFLOW_CLOCK_RAW",\n  "FULL_SDK_WORKFLOW_CLOCK_FIELDS",\n  "FULL_SDK_WORKFLOW_CLOCK_KIND",\n  "FULL_SDK_WORKFLOW_CLOCK_INTEGER",\n  "FULL_SDK_WORKFLOW_CLOCK_WALL_DEADLINE",\n  "FULL_SDK_WORKFLOW_CLOCK_SCOPE",\n  "FULL_SDK_WORKFLOW_CLOCK_EXECUTION",\n  "FULL_SDK_WORKFLOW_CLOCK_HOST",\n  "FULL_SDK_WORKFLOW_CLOCK_TICK_DEADLINE",\n  "FULL_SDK_WORKFLOW_CLOCK_PROJECTION",\n  "FULL_SDK_WORKFLOW_CLOCK_EXPIRED",\n]);\n// END FIXED WORKFLOW CLOCK FAILURE CODES\n',
  blockSha256:
    "a1da21bcb09f13c39300d1781fcc6bb09945f335d0e4842e3683b80a72ba5902",
  newPredicate:
    "    (/^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message) ||\n      STARTUP_CLOCK_ERRORS.has(message))\n",
  oldPredicate: "    /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message)\n",
  bytes: 165012,
  sha256: "5a36ad235d7bbf55a1a9680d557c2ce907709d227c5b591630f4f77c5b6dcc58",
};
const PRODUCER_METRIC_INVERSE = {
  bytes: 165597,
  sha256: "2cc73bfe26fa61b66d4820e2f1522501954b6bb198bfcfa69d15c07bfe32292f",
  rows: [
    {
      oldRaw:
        "    throw fail(state, error);\n  }\n}\nasync function createControl(sourceReceipt, leaseToken) {\n  const source = sourceState(sourceReceipt, leaseToken);\n  checkLease(leaseToken);\n",
      newRaw:
        '    throw fail(state, error);\n  }\n}\n// BEGIN CHECKED INPUT CLOSURE DATA\n// Only actual completed held-input rechecks issue these private observations.\n// Their copied records describe this finite checked closure, never all Chromium.\nconst checkedInputObservations = new WeakMap();\nfunction checkedInputRow(records, relative, actual) {\n  need(\n    actual &&\n      actual.pin &&\n      Number.isSafeInteger(actual.pin.bytes) &&\n      actual.pin.bytes >= 0 &&\n      /^[a-f0-9]{64}$/.test(actual.pin.sha256),\n    "INPUT_CLOSURE_PIN",\n  );\n  records.push(\n    Object.freeze({\n      relative,\n      bytes: actual.pin.bytes,\n      sha256: actual.pin.sha256,\n    }),\n  );\n}\nfunction issueCheckedInputObservation(\n  sourceReceipt,\n  leaseToken,\n  state,\n  records,\n) {\n  sourceState(sourceReceipt, leaseToken);\n  operationState(state.operationToken, true);\n  const unique = new Map();\n  for (const row of records) {\n    need(\n      !unique.has(row.relative) ||\n        canonical(unique.get(row.relative)) === canonical(row),\n      "INPUT_CLOSURE_DUPLICATE",\n    );\n    unique.set(row.relative, row);\n  }\n  const context = unique.get("context.json");\n  need(\n    context &&\n      state.metadataSnapshot &&\n      /^[a-f0-9]{64}$/.test(state.metadataSnapshot.projectionSha256) &&\n      unique.size <= 256,\n    "INPUT_CLOSURE_SCOPE",\n  );\n  const inputs = state.plan.producerInputs\n    .map((row) => ({ ...row }))\n    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));\n  const content = Object.freeze({\n    schemaVersion: 1,\n    kind: "windows-arm-checked-input-closure",\n    sourceContextSha256: context.sha256,\n    image: state.plan.image,\n    sourceId: state.plan.sourceId,\n    producerSha256: hashBytes(Buffer.from(canonical(inputs))),\n    metadataProjectionSha256: state.metadataSnapshot.projectionSha256,\n    records: Object.freeze(\n      [...unique.values()].sort((a, b) =>\n        a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,\n      ),\n    ),\n  });\n  const observation = Object.freeze({\n    kind: "private-checked-input-observation",\n  });\n  checkedInputObservations.set(observation, {\n    sourceReceipt,\n    leaseToken,\n    operation: state,\n    content,\n  });\n  return observation;\n}\nfunction consumeCheckedInputObservation(token, state, observation, boundary) {\n  retained(token, state);\n  const actual = checkedInputObservations.get(observation);\n  checkedInputObservations.delete(observation);\n  need(\n    actual &&\n      actual.sourceReceipt === state.sourceReceipt &&\n      actual.leaseToken === state.leaseToken &&\n      operationState(state.source.operationToken, true) === actual.operation &&\n      sourceState(state.sourceReceipt, state.leaseToken) === state.source &&\n      ["before-probe-clang", "after-package-before-sdk-seal"].includes(\n        boundary,\n      ),\n    "INPUT_CLOSURE_BRAND",\n  );\n  return Object.freeze({\n    boundary,\n    sha256: hashBytes(Buffer.from(canonical(actual.content))),\n    content: actual.content,\n  });\n}\n// END CHECKED INPUT CLOSURE DATA\n\nasync function createControl(sourceReceipt, leaseToken) {\n  const source = sourceState(sourceReceipt, leaseToken);\n  checkLease(leaseToken);\n',
      oldSha256:
        "dfed1167795b491ba7ddba9ebf2e9312021c46d267123cb2f96016cd054a9c21",
      newSha256:
        "6cfd98911baae0e7dabeab6732e02f97daae95bccf4dd3a6f5121c146880b395",
    },
    {
      oldRaw:
        "    }\n    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));\n    await currentRoot(token, state);\n    if (state.source.operationToken)\n      await work(token, state, () =>\n        recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n      );\n    retained(token, state);\n    state.helperValidated = true;\n    state.gitToken = gitToken; // Private; never returned/exported or serialized.\n    return Object.freeze({\n",
      newRaw:
        '    }\n    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));\n    await currentRoot(token, state);\n    let beforeObservation;\n    if (state.source.operationToken)\n      beforeObservation = await work(token, state, () =>\n        recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n      );\n    retained(token, state);\n    if (state.source.operationToken) {\n      need(!state.checkedInputsBefore, "INPUT_CLOSURE_REUSE");\n      state.checkedInputsBefore = consumeCheckedInputObservation(\n        token,\n        state,\n        beforeObservation,\n        "before-probe-clang",\n      );\n    }\n    state.helperValidated = true;\n    state.gitToken = gitToken; // Private; never returned/exported or serialized.\n    return Object.freeze({\n',
      oldSha256:
        "3c80d9c33a6bdfe08c6cddc51889fcde48182d878930f1b3018c2265dd7d22ee",
      newSha256:
        "3e608ecd2b337ec26998984beb073ce7fdcff552a11664a3c677a3661b429f0a",
    },
    {
      oldRaw:
        '      binding.policySha256 === fact.binding.policySha256,\n    "SOURCE_DEFAULTS_BINDING_CHANGED",\n  );\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n',
      newRaw:
        '      binding.policySha256 === fact.binding.policySha256,\n    "SOURCE_DEFAULTS_BINDING_CHANGED",\n  );\n  const checked = [];\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n',
      oldSha256:
        "be1c6baa59be3618000c323bafbbd307a323a3db9570091072471a2455da8a9f",
      newSha256:
        "053c8e39c51892e645f404e498c571a80e78e69f848f2b679697e23626285378",
    },
    {
      oldRaw:
        '    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n  }\n  await operationFence(token, joinedAllowed);\n}\n// END PRIVATE PARENT METADATA VERIFICATION\n\n',
      newRaw:
        '    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  await operationFence(token, joinedAllowed);\n  operationState(token, joinedAllowed);\n  return checked;\n}\n// END PRIVATE PARENT METADATA VERIFICATION\n\n',
      oldSha256:
        "e17e5e5a53bfd4c68b49268f2ccabd2b1a47198400254bd6ef2feace5fb3ff91",
      newSha256:
        "28dbfdd260e5528219005b71978f42da0fd1a8b8bc0bccab9a39f96f1bd6caa9",
    },
    {
      oldRaw:
        "}\nasync function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  for (const row of state.plan.rootPins)\n    await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n",
      newRaw:
        "}\nasync function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  const checked = [];\n  for (const row of state.plan.rootPins) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n    checkedInputRow(checked, row.relative, actual);\n  }\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n",
      oldSha256:
        "6d047b7fffa2824d3ab9b256964fef8c50a157b6d764bb4734724e2ad598ebf5",
      newSha256:
        "5d84587a924d09240fdb4756278a03d98b58f2795128dfebb270cf45e6c2acba",
    },
    {
      oldRaw:
        '      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n',
      newRaw:
        '      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n',
      oldSha256:
        "cdc5a1dd2d7705bf5162899423497b32259bfb7f9213c8bc9f3d5741e63e34c8",
      newSha256:
        "0acd86dd98b16f21d20ce082acd0252f43f2059f358dadfa47f147c7071b9adb",
    },
    {
      oldRaw:
        "    undefined,\n    joinedAllowed,\n  );\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n",
      newRaw:
        '    undefined,\n    joinedAllowed,\n  );\n  checkedInputRow(checked, "source-gn-logs/fresh-graph-pins.json", graphRecord);\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n',
      oldSha256:
        "8aac06ace07b454359fb4740d5d4733b4e1b9e62c2b4622dd125a76e2806bdcd",
      newSha256:
        "6a780c59a670ae18de14fbfac7fc7755b8087da6cc59a8c14a58bd8f146a9f93",
    },
    {
      oldRaw:
        '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n',
      newRaw:
        '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  const metadata = await recheckSourceMetadata(token, joinedAllowed);\n  if (metadata) checked.push(...metadata);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n  return checked;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n',
      oldSha256:
        "ce3ff08b2090ed3fd53bf4e7bbb9565ec18daf6b87a24276ca572b21ee36253f",
      newSha256:
        "21b91253b1213d99b78ba496e1063fe3eff3bd388af9c3c36478bc43ac03b502",
    },
    {
      oldRaw:
        '      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n',
      newRaw:
        '      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  const checked = [];\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n',
      oldSha256:
        "d0ed157f1f5e9d3adf1da28766fe45b9e8bef1db7ef61431ba02e628c94b461a",
      newSha256:
        "fc152f6cf85009ba868e0fc58e187b6166c3712b7690afb4a6da52454c631b12",
    },
    {
      oldRaw:
        '    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n  }\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\n',
      newRaw:
        '    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  return checked;\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\n',
      oldSha256:
        "d2a7cfc1103c1298140f323eb34ee48de043e5dcf4c55fe9bbc65a618b700055",
      newSha256:
        "87085e883bf0638aa02ae39677b8e66efe5685dc6f8a1b4b2bdcee1f9f4162e4",
    },
    {
      oldRaw:
        '      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n  await recheckSourceToolProof(source.operationToken);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n',
      newRaw:
        '      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  const checked = await verifySourceSnapshot(source.operationToken, true);\n  const tools = await recheckSourceToolProof(source.operationToken);\n  operationState(source.operationToken, true);\n  return issueCheckedInputObservation(receipt, leaseToken, state, [\n    ...checked,\n    ...tools,\n  ]);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n',
      oldSha256:
        "9a93bd6e025308046985a8ee47e73d774631e4d5be196f99c1c32dfe67546b1a",
      newSha256:
        "b8af41b68194b741c3f6f21b73ed89f3c20d8e07060df96335340c3b45ba4c56",
    },
    {
      oldRaw:
        '      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n',
      newRaw:
        '      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  need(\n    Number.isSafeInteger(closed.jobSeconds) &&\n      closed.jobSeconds > 0 &&\n      closed.jobSeconds <=\n        (role === "checkpoint-seal"\n          ? 3600\n          : ENGINE_CAPS_MS[ENGINE_ROLES.indexOf(role)] / 1000) &&\n      Number.isSafeInteger(job.elapsedMs) &&\n      job.elapsedMs >= 0 &&\n      job.elapsedMs <= closed.jobSeconds * 1000 + CLEANUP_MS,\n    "ENGINE_ASSIGNED_SECONDS",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n',
      oldSha256:
        "160d03c046fab040d67ed9b79e42eba07f994be6e2b47f02599ca7e9b53bbc89",
      newSha256:
        "a18125fc0ead8656ee4b0d28e48feaeaea659d3346147c93791fc249471f5574",
    },
    {
      oldRaw:
        '    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n',
      newRaw:
        '    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  const afterObservation = await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n',
      oldSha256:
        "c39b274ad1ccb4097bf39fd67a632653688cb0dd2f461e89ecf4771c8f524d0d",
      newSha256:
        "2b98e85bd66ea893d7bb78ce4ef9879966a34a4e1837842616bc92154df42e09",
    },
    {
      oldRaw:
        '      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n',
      newRaw:
        '      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const after = consumeCheckedInputObservation(\n    token,\n    state,\n    afterObservation,\n    "after-package-before-sdk-seal",\n  );\n  need(\n    state.checkedInputsBefore &&\n      state.checkedInputsBefore.sha256 === after.sha256 &&\n      canonical(state.checkedInputsBefore.content) === canonical(after.content),\n    "INPUT_CLOSURE_CHANGED",\n  );\n  const checkedInputs = Object.freeze({\n    schemaVersion: 1,\n    kind: "windows-arm-checked-input-closure-pair",\n    before: state.checkedInputsBefore,\n    after,\n  });\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n',
      oldSha256:
        "27eca937f5b5ba683ec03565a4423b9c982ed959c1169972be4e323d4ca9574b",
      newSha256:
        "ab9859b770b8f138b088b5182453bebae08bb20b5f82378652cfc766a13faf84",
    },
    {
      oldRaw:
        '    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n',
      newRaw:
        '    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    checkedInputs,\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n',
      oldSha256:
        "42b8b35d57c9d5b9c23f25aa03af45066b5173ea17cb8caa8296394a8178a5c2",
      newSha256:
        "d882638238de7e34860e2deee7894d5e41b635918e73c0b79cf8bebeaffb784d",
    },
  ],
};
// BEGIN EXACT SOURCE PARENT INVERSE
const SOURCE_PARENT_INVERSE = {
  bytes: 170568,
  sha256: "4dd1213e005bd2c873e48854fc4a158efbf123837b977f214fcc818797717da4",
  rows: [
    {
      newRaw:
        '// BEGIN CHECKED SOURCE ARTIFACTS PARENT\nasync function recheckSourceCreationParents(token, parents) {\n  const state = operationState(token);\n  need(\n    path.dirname(state.root) === path.join(CONTROLLER_REPO, ".artifacts"),\n    "SOURCE_PARENT_SCOPE",\n  );\n  for (const row of parents) {\n    const info = await operationWork(token, () =>\n      fs.lstat(row.path, { bigint: true }),\n    );\n    need(operationDirectoryId(info) === row.identity, "SOURCE_PARENT_CHANGED");\n    need(\n      (await operationWork(token, () => fs.realpath(row.path))) === row.path,\n      "SOURCE_PARENT_ALIAS",\n    );\n  }\n  operationState(token);\n}\nasync function prepareSourceArtifactsParent(token) {\n  const state = operationState(token),\n    parent = path.dirname(state.root);\n  need(\n    parent === path.join(CONTROLLER_REPO, ".artifacts"),\n    "SOURCE_PARENT_SCOPE",\n  );\n  const parents = [];\n  for (let current = CONTROLLER_REPO; ; current = path.dirname(current)) {\n    const info = await operationWork(token, () =>\n      fs.lstat(current, { bigint: true }),\n    );\n    parents.push(\n      Object.freeze({ path: current, identity: operationDirectoryId(info) }),\n    );\n    if (current === path.dirname(current)) break;\n  }\n  await recheckSourceCreationParents(token, parents);\n  const before = await operationWork(token, async () => {\n    try {\n      return await fs.lstat(parent, { bigint: true });\n    } catch (error) {\n      if (error?.code === "ENOENT") return null;\n      throw error;\n    }\n  });\n  if (before)\n    parents.push(\n      Object.freeze({ path: parent, identity: operationDirectoryId(before) }),\n    );\n  await recheckSourceCreationParents(token, parents);\n  operationState(token);\n  await operationWork(token, async () => {\n    try {\n      await fs.mkdir(parent, { mode: 0o700 });\n    } catch (error) {\n      if (error?.code !== "EEXIST" || !before) throw error;\n    }\n  });\n  if (!before) {\n    const info = await operationWork(token, () =>\n      fs.lstat(parent, { bigint: true }),\n    );\n    parents.push(\n      Object.freeze({ path: parent, identity: operationDirectoryId(info) }),\n    );\n  }\n  await recheckSourceCreationParents(token, parents);\n  return Object.freeze(parents);\n}\n// END CHECKED SOURCE ARTIFACTS PARENT\n\n',
      oldRaw: "",
      newSha256:
        "21214d320a7d895f031cb22b15103944e8c208a3206cecd227f379bbff567768",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "    // BEGIN SOURCE ROOT PARENT CREATION\n    const creationParents = await prepareSourceArtifactsParent(token);\n    await recheckSourceCreationParents(token, creationParents);\n    operationState(token);\n    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n    await recheckSourceCreationParents(token, creationParents);\n    // END SOURCE ROOT PARENT CREATION\n",
      oldRaw:
        "    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n",
      newSha256:
        "fa0c503739efca2e087c4c8254dfb8672c8885c035d96b5e57e66d80dacdab93",
      oldSha256:
        "f6bf507f714bbf2779ed1930bf55ba7739b75a4044a061376c5ca98feb75daae",
    },
    {
      newRaw:
        '      // BEGIN SOURCE CREATION PARENT LEDGER CHECK\n      const expectedParent = creationParents.find(\n        (row) => row.path === current,\n      );\n      if (expectedParent)\n        need(\n          operationDirectoryId(info) === expectedParent.identity,\n          "SOURCE_PARENT_CHANGED",\n        );\n      // END SOURCE CREATION PARENT LEDGER CHECK\n',
      oldRaw: "",
      newSha256:
        "7da9f392a576026aea8f8b3a521e7bb556b538a6c360d77bb4f0ca88de9b958d",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "    // BEGIN SOURCE OWNER OPEN FENCE\n    await operationFence(token);\n    operationState(token);\n    // END SOURCE OWNER OPEN FENCE\n",
      oldRaw: "",
      newSha256:
        "b0b1a3ab1fd698c1afcd3deaa48cd63cf4a59c2e7353a1c890ec902f5ff24bc4",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw: '  "spawn",\n  "mkdir",\n]);\n',
      oldRaw: '  "spawn",\n]);\n',
      newSha256:
        "5a609af6fb2139b7872a242ac6e4ce06baed14a17e1c59b12f3d008d0ff828ea",
      oldSha256:
        "23153886e10735d0405d87d4b8b5e1773cb342e47cb3ec91d4f6afacca6d1a10",
    },
  ],
};
// BEGIN EXACT SOURCE FAILURE DATA INVERSE
const SOURCE_FAILURE_INVERSE = {
  rows: [
    {
      newRaw:
        "    // BEGIN SAFE SOURCE CHILD FAILURE CAPTURE\n    captureSourceChildFailure(error, state);\n    // END SAFE SOURCE CHILD FAILURE CAPTURE\n",
      oldRaw: "",
      newSha256:
        "6dc18d387df80488ff800f5f4c083dbc6668eaa057365a3bc2329550f6375103",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        '// BEGIN SAFE SOURCE CHILD FAILURE DATA\nconst sourceChildFailures = new WeakMap();\nfunction captureSourceChildFailure(error, state) {\n  // Copied observations only. Never read caller error fields, logs or paths,\n  // and never let diagnostic preparation change the original failure.\n  try {\n    if (\n      utilTypes.isProxy(error) ||\n      !utilTypes.isNativeError(error) ||\n      sourceChildFailures.has(error) ||\n      !(state.child instanceof ChildProcess) ||\n      !state.childEvents\n    )\n      return;\n    const e = state.childEvents;\n    const exitCode = (value) =>\n      Number.isSafeInteger(value) && value >= -2147483648 && value <= 4294967295\n        ? value\n        : null;\n    const signal = (value) =>\n      ["SIGTERM", "SIGKILL", "SIGABRT", "SIGINT"].includes(value)\n        ? value\n        : null;\n    const observed = {\n      phase: "source-launch",\n      spawned: e.spawn === true,\n      exited: e.exit === true,\n      closed: e.close === true,\n      stdoutClosed: e.stdout === true,\n      stderrClosed: e.stderr === true,\n      exitCode: exitCode(e.code),\n      closeCode: exitCode(e.closeCode),\n      exitSignal: signal(e.signal),\n      closeSignal: signal(e.closeSignal),\n      capturedBytes:\n        Number.isSafeInteger(state.outputBytes) && state.outputBytes >= 0\n          ? Math.min(state.outputBytes, SOURCE_LOG_CAP)\n          : null,\n    };\n    sourceChildFailures.set(error, Object.freeze(observed));\n  } catch {\n    /* Diagnostic failure cannot replace a primary, including false. */\n  }\n}\n// END SAFE SOURCE CHILD FAILURE DATA\n',
      oldRaw: "",
      newSha256:
        "4282bbee73e81be418d4f4712892869856bb9cd125e8078d4365886fb0044273",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "  // BEGIN SAFE SOURCE CHILD FAILURE PROJECTION\n  const sourceChild = native ? sourceChildFailures.get(error) : undefined;\n  if (sourceChild) diagnostic.sourceChild = sourceChild;\n  // END SAFE SOURCE CHILD FAILURE PROJECTION\n",
      oldRaw: "",
      newSha256:
        "dd8b135bc6b6cae12bbf2458b94e13f3017fedd7946bce0dfcf4c0403e87476d",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
  ],
  bytes: 173595,
  sha256: "45df5ab874c3d1a7d9191ea3be9f8cbf1c9d43110092f592abb0d7eb9cbc3cc5",
};

// BEGIN EXACT FULL SOURCE ACQUISITION INVERSE
const SOURCE_ACQUISITION_HISTORY = {
  driver: {
    path: "native/windows-arm-full-sdk/full-sdk-source-driver.mjs",
    bytes: 270629,
    sha256: "895d7164ff85f47a61ea7769af5df35687d57f21c6f9ed649f3c257c5f0c404c",
    newBytes: 286208,
    newSha256:
      "3227c6e0863271864024d456125e28ca40dc5257306a35f866fbbbcb0a5097a8",
    rows: [
      {
        oldRaw:
          '  return privateSourceBody(argv);\n}\n\n// BEGIN CLOSED FULL SDK SOURCE BODY\nasync function fullSourceStage(root, budget, stage, maximumSeconds, action) {\n  need(\n    (stage === "source-acquisition" && maximumSeconds === 4500) ||\n      (stage === "source-hooks-gn" && maximumSeconds === 2700),\n    "FULL_SOURCE_STAGE",\n  );\n  const allowed = Math.min(maximumSeconds * 1000, budget.remaining() - 120000);\n  need(allowed > 0, "FULL_SOURCE_RESERVE");\n  const began = performance.now();\n  const timer = setTimeout(\n    () => {\n      const report = {\n        kind: "windows-arm-source-stage-deadline",\n        success: false,\n        stage,\n        firstFailure: "FULL_SOURCE_STAGE_DEADLINE",\n        compilerExecuted: null,\n        engineCompilationRequested: false,\n        sdkBuilt: false,\n        cleanupNotInferred: true,\n      };\n      try {\n        writeFileSync(\n          path.join(root, "source-deadline-result.json"),\n          JSON.stringify(report) + "\\n",\n          { flag: "wx" },\n        );\n      } catch {\n        sourceReportingFailure = true;\n        try {\n          writeSync(\n            2,\n            Buffer.from(\n              JSON.stringify({\n                ...report,\n                reportingFailure: "FULL_SOURCE_REPORT",\n              }) + "\\n",\n            ),\n          );\n        } catch {\n          /* Preserve the deadline. */\n        }\n      }\n      process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.\n    },\n    Math.max(1, allowed),\n  );\n  try {\n    const result = await action();\n    budget.remaining();\n    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\n',
        newRaw:
          '  return privateSourceBody(argv);\n}\n\n// BEGIN CLOSED FULL SDK SOURCE BODY\n// FULL-only diagnostic timing. The legacy2h/512 SourceProgress body above is unchanged.\nclass FullSourceProgress {\n  constructor(root, contextSha, now = performance.now.bind(performance)) {\n    this.root = root;\n    this.contextSha = contextSha;\n    this.now = now;\n    this.begin = 0;\n    this.phaseStartedElapsedMs = 0;\n    this.lastOutput = 0;\n    this.label = "source-admission";\n    this.sequence = 0;\n    this.stdout = 0;\n    this.stderr = 0;\n    this.completed = 0;\n    this.total = 0;\n    this.tail = "";\n    this.writes = 0;\n    this.failed = false;\n    try {\n      this.begin = now();\n      this.lastOutput = this.begin;\n      this.flush();\n      this.timer = setInterval(() => this.flush(), 15000);\n      this.timer.unref();\n    } catch {\n      this.failed = true;\n    }\n  }\n  phase(label) {\n    if (!SOURCE_PHASES.has(label)) {\n      this.failed = true;\n      return;\n    }\n    if (label === this.label) return;\n    if (this.sequence >= 32) {\n      this.failed = true;\n      return;\n    }\n    let elapsed;\n    try {\n      elapsed = Math.floor(this.now() - this.begin);\n      if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 10800000)\n        throw new Error("FULL_PROGRESS_CLOCK");\n    } catch {\n      this.failed = true;\n      return;\n    }\n    this.phaseStartedElapsedMs = elapsed;\n    this.label = label;\n    this.sequence++;\n    this.flush();\n  }\n  observe(role, stdout, chunk) {\n    try {\n      if (stdout) this.stdout += chunk.length;\n      else this.stderr += chunk.length;\n      this.lastOutput = this.now();\n      if (role === "sync" && stdout) {\n        this.tail = (this.tail + chunk.toString("utf8")).slice(-512);\n        const match = /Syncing projects:\\s*\\d+%\\s*\\((\\d+)\\/(\\d+)\\)/.exec(\n          this.tail,\n        );\n        if (\n          match &&\n          Number(match[1]) <= Number(match[2]) &&\n          Number(match[2]) <= 10000\n        ) {\n          this.completed = Number(match[1]);\n          this.total = Number(match[2]);\n        }\n      }\n    } catch {\n      this.failed = true;\n    }\n  }\n  flush() {\n    if (this.failed || this.writes >= 768) return;\n    try {\n      const now = this.now(),\n        elapsed = Math.floor(now - this.begin),\n        age = Math.floor(now - this.lastOutput);\n      need(\n        elapsed >= 0 &&\n          elapsed <= 10800000 &&\n          elapsed >= this.phaseStartedElapsedMs &&\n          age >= 0 &&\n          this.stdout + this.stderr <= 67108864,\n        "FULL_PROGRESS_BOUND",\n      );\n      const real = realpathSync(this.root);\n      need(\n        real.replaceAll("\\\\", "/").toLowerCase() ===\n          this.root.replaceAll("\\\\", "/").toLowerCase(),\n        "FULL_PROGRESS_ROOT",\n      );\n      const value = {\n        kind: "windows-arm-source-phase",\n        contextSha256: this.contextSha,\n        phase: this.label,\n        sequence: this.sequence,\n        elapsedMs: elapsed,\n        phaseStartedElapsedMs: this.phaseStartedElapsedMs,\n        phaseElapsedMs: elapsed - this.phaseStartedElapsedMs,\n        stdoutBytes: this.stdout,\n        stderrBytes: this.stderr,\n        lastOutputAgeMs: age,\n        syncCompleted: this.completed,\n        syncTotal: this.total,\n      };\n      const raw = Buffer.from(JSON.stringify(value) + "\\n");\n      need(raw.length <= 2048, "FULL_PROGRESS_BOUND");\n      const temporary = path.join(this.root, "source-phase-pending.json");\n      writeFileSync(temporary, raw, { flag: "wx" });\n      renameSync(temporary, path.join(this.root, "source-phase-result.json"));\n      this.writes++;\n    } catch {\n      this.failed = true;\n    }\n  }\n  close() {\n    clearInterval(this.timer);\n    this.flush();\n    try {\n      writeFileSync(\n        path.join(this.root, "source-progress-metadata-result.json"),\n        JSON.stringify({\n          kind: "windows-arm-source-progress-metadata",\n          metadataFailure: this.failed,\n          samplesWritten: this.writes,\n          sourceOutcomeNotInferred: true,\n        }) + "\\n",\n        { flag: "wx" },\n      );\n    } catch {}\n  }\n}\nasync function fullSourceStage(root, budget, stage, maximumSeconds, action) {\n  need(\n    (stage === "source-acquisition" && maximumSeconds === 7200) ||\n      (stage === "source-hooks-gn" && maximumSeconds === 2700),\n    "FULL_SOURCE_STAGE",\n  );\n  const allowed = Math.min(\n    maximumSeconds * 1000,\n    budget.remaining() - 120000,\n    stage === "source-acquisition" ? budget.acquisitionRemaining() : Infinity,\n  );\n  need(allowed > 0, "FULL_SOURCE_RESERVE");\n  const began = performance.now();\n  let active = true;\n  const expire = () => {\n    if (!active) return;\n    active = false;\n    const report = {\n      kind: "windows-arm-source-stage-deadline",\n      success: false,\n      stage,\n      firstFailure: "FULL_SOURCE_STAGE_DEADLINE",\n      compilerExecuted: null,\n      engineCompilationRequested: false,\n      sdkBuilt: false,\n      cleanupNotInferred: true,\n    };\n    try {\n      writeFileSync(\n        path.join(root, "source-deadline-result.json"),\n        JSON.stringify(report) + "\\n",\n        { flag: "wx" },\n      );\n    } catch {\n      sourceReportingFailure = true;\n      try {\n        writeSync(\n          2,\n          Buffer.from(\n            JSON.stringify({\n              ...report,\n              reportingFailure: "FULL_SOURCE_REPORT",\n            }) + "\\n",\n          ),\n        );\n      } catch {\n        /* Preserve the deadline. */\n      }\n    }\n    process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.\n  };\n  const timer = setTimeout(expire, Math.max(1, allowed));\n  // A cached monotonic timer cannot observe a forward wall jump. This fixed\n  // watchdog consumes the same original live endpoints during vendor awaits.\n  const watchdog = setInterval(\n    () => {\n      if (!active) return;\n      try {\n        budget.remaining();\n        if (stage === "source-acquisition") budget.acquisitionRemaining();\n        need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n      } catch {\n        expire();\n      }\n    },\n    Math.max(1, Math.min(1000, allowed)),\n  );\n  try {\n    const result = await action();\n    budget.remaining();\n    if (stage === "source-acquisition") budget.acquisitionRemaining();\n    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    active = false;\n    clearTimeout(timer);\n    clearInterval(watchdog);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\n',
        oldSha256:
          "8aae82635a26ddf7e6eb0128b4c76ac451e46b04c30833ca94aeca22b634f8d8",
        newSha256:
          "38db9ac29dc0b4339674dcfdcd9b46926a469a879dbbfd337a9719cd68f2e73f",
      },
      {
        oldRaw:
          '      sha(profile.metadataRecipeRaw) === PRIVATE_PROFILE_SHA256,\n    "FULL_METADATA_RECIPE_PIN",\n  );\n  const recipe = JSON.parse(profile.metadataRecipeRaw);\n  const owner = beginQualificationSource({\n    ...input,\n    privatePolicyRaw: profile.metadataRecipeRaw,\n  });\n  fullMetadataOwners.set(owner, { profile, context: input.c, recipe });\n  fullMetadataOwner(owner);\n',
        newRaw:
          '      sha(profile.metadataRecipeRaw) === PRIVATE_PROFILE_SHA256,\n    "FULL_METADATA_RECIPE_PIN",\n  );\n  const recipe = JSON.parse(profile.metadataRecipeRaw);\n  // Project once for the unchanged private15m phase helper. Every read still\n  // consumes the genuine original FULL source/context/whole budget.\n  const metadataBegan = performance.now(),\n    metadataOriginal = Math.min(profile.budget.remaining(), 7200000);\n  const metadataBudget = Object.freeze({\n    remaining() {\n      fullBootstrapAuthority(profile.root, input.p, profile.contextPin);\n      const elapsed = performance.now() - metadataBegan;\n      need(elapsed >= 0, "FULL_METADATA_CLOCK");\n      const left = Math.min(\n        profile.budget.remaining(),\n        metadataOriginal - elapsed,\n      );\n      need(left > 0, "FULL_METADATA_DEADLINE");\n      return left;\n    },\n  });\n  const owner = beginQualificationSource({\n    ...input,\n    budget: metadataBudget,\n    privatePolicyRaw: profile.metadataRecipeRaw,\n  });\n  fullMetadataOwners.set(owner, { profile, context: input.c, recipe });\n  fullMetadataOwner(owner);\n',
        oldSha256:
          "6df080ac00cd4c1b9808491b552bcad6860ffeaee1fdb6359ed10293ec000a31",
        newSha256:
          "e44d2d725d8ed3da20403cd32e3f14c85621f64ee1e69a83831cb693a7ca590e",
      },
      {
        oldRaw:
          '  const remaining = Math.min(\n    context.wallWorkEnd - wallNow,\n    context.monotonicWorkEnd - monotonicNow,\n  );\n  need(remaining > 150 && remaining <= 7200, "PRIVATE_DEADLINE");\n  return { policy, candidate };\n}\n\nfunction fullMetadataInspect(\n',
        newRaw:
          '  const remaining = Math.min(\n    context.wallWorkEnd - wallNow,\n    context.monotonicWorkEnd - monotonicNow,\n  );\n  need(remaining > 150 && remaining <= 10800, "PRIVATE_DEADLINE");\n  return { policy, candidate };\n}\n\nfunction fullMetadataInspect(\n',
        oldSha256:
          "1ce6afe8ce42e2026db40cd024ebfd5e3010b96ddd8dde42c6152a7e8450ff1d",
        newSha256:
          "6375343a28a948f5950ad67c9f5130dc3b1591bd5415d04d95ab6c038e829186",
      },
      {
        oldRaw:
          '      /^(?:0|[1-9][0-9]{0,19})$/.test(c.inputs.restore_run),\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        newRaw:
          '      /^(?:0|[1-9][0-9]{0,19})$/.test(c.inputs.restore_run),\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\n// Fixed DATA-only clock child inherits the actual source Node Job. It cannot\n// issue a source/session and never changes any original context endpoint.\nconst FULL_SOURCE_CLOCK_PROGRAM =\n  \'import json,time;print(json.dumps({"kind":"windows-arm-full-source-clock-data","wall":time.time(),"monotonic":time.monotonic()},separators=(",",":")))\';\nasync function sampleFullSourceClock(context, python) {\n  const nodeMonoBefore = performance.now(),\n    nodeWallBefore = Date.now();\n  const original = Math.min(\n    10800000,\n    context.wallWorkEnd * 1000 - nodeWallBefore,\n    context.wallWholeEnd * 1000 - nodeWallBefore,\n  );\n  need(\n    Number.isFinite(original) && original > 150000,\n    "FULL_SOURCE_CLOCK_DEADLINE",\n  );\n  const workEnd = nodeMonoBefore + Math.min(5000, original - 150000),\n    closeEnd = Math.min(workEnd + 30000, nodeMonoBefore + original - 120000);\n  const remaining = () => {\n    const left = Math.min(\n      workEnd - performance.now(),\n      context.wallWorkEnd * 1000 - Date.now() - 150000,\n      context.wallWholeEnd * 1000 - Date.now() - 150000,\n    );\n    need(left > 0, "FULL_SOURCE_CLOCK_DEADLINE");\n    return left;\n  };\n  const cleanupRemaining = () =>\n    Math.min(\n      closeEnd - performance.now(),\n      context.wallWorkEnd * 1000 - Date.now() - 120000,\n      context.wallWholeEnd * 1000 - Date.now() - 120000,\n    );\n  let child,\n    failed = false,\n    primary,\n    spawned = false,\n    exited = false,\n    closed = false,\n    stdoutClosed = false,\n    stderrClosed = false,\n    exitCode,\n    exitSignal,\n    closeCode,\n    closeSignal,\n    stdoutBytes = 0,\n    stderrBytes = 0,\n    workTimer,\n    cleanupTimer,\n    pinRead,\n    pinJoined = false,\n    result;\n  const chunks = [],\n    listeners = [];\n  let rejectFailure, resolveJoined;\n  const failure = new Promise((_, reject) => {\n    rejectFailure = reject;\n  });\n  // The rejection is consumed by the work race even after a synchronous spawn\n  // failure, so a late owned event cannot create an unhandled rejection.\n  failure.catch(() => {});\n  const joined = new Promise((resolve) => {\n    resolveJoined = resolve;\n  });\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n      rejectFailure(error);\n    }\n  };\n  const observe = (emitter, event, callback) => {\n    emitter.on(event, callback);\n    listeners.push([emitter, event, callback]);\n  };\n  const checkJoined = () => {\n    if (closed && stdoutClosed && stderrClosed) resolveJoined();\n  };\n  try {\n    remaining();\n    workTimer = setTimeout(\n      () => remember(new Error("FULL_SOURCE_CLOCK_DEADLINE")),\n      Math.max(1, remaining()),\n    );\n    pinRead = held(python.path, python.bytes, { remaining }, python).finally(\n      () => {\n        pinJoined = true;\n      },\n    );\n    pinRead.catch(() => {});\n    await Promise.race([pinRead, failure]);\n    remaining();\n    child = spawn(python.path, ["-I", "-B", "-c", FULL_SOURCE_CLOCK_PROGRAM], {\n      windowsHide: true,\n      shell: false,\n      stdio: ["ignore", "pipe", "pipe"],\n      env: { SystemRoot: "C:/Windows", WINDIR: "C:/Windows" },\n    });\n    need(child && child.stdout && child.stderr, "FULL_SOURCE_CLOCK_CHILD");\n    observe(child, "spawn", () => {\n      spawned = true;\n    });\n    observe(child, "error", remember);\n    observe(child, "exit", (code, signal) => {\n      exited = true;\n      exitCode = code;\n      exitSignal = signal;\n    });\n    observe(child, "close", (code, signal) => {\n      closed = true;\n      closeCode = code;\n      closeSignal = signal;\n      checkJoined();\n    });\n    observe(child.stdout, "error", remember);\n    observe(child.stderr, "error", remember);\n    observe(child.stdout, "close", () => {\n      stdoutClosed = true;\n      checkJoined();\n    });\n    observe(child.stderr, "close", () => {\n      stderrClosed = true;\n      checkJoined();\n    });\n    observe(child.stdout, "data", (chunk) => {\n      if (failed) return;\n      try {\n        remaining();\n        stdoutBytes += chunk.length;\n        need(stdoutBytes <= 512, "FULL_SOURCE_CLOCK_BOUND");\n        chunks.push(Buffer.from(chunk));\n      } catch (error) {\n        remember(error);\n      }\n    });\n    observe(child.stderr, "data", (chunk) => {\n      stderrBytes += chunk.length;\n      remember(new Error("FULL_SOURCE_CLOCK_STDERR"));\n    });\n    await Promise.race([joined, failure]);\n    remaining();\n    need(\n      spawned &&\n        exited &&\n        closed &&\n        stdoutClosed &&\n        stderrClosed &&\n        exitCode === 0 &&\n        closeCode === 0 &&\n        exitSignal === null &&\n        closeSignal === null &&\n        stdoutBytes > 0 &&\n        stdoutBytes <= 512 &&\n        stderrBytes === 0,\n      "FULL_SOURCE_CLOCK_JOIN",\n    );\n    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));\n    need(\n      value &&\n        Object.getPrototypeOf(value) === Object.prototype &&\n        Object.keys(value).sort().join(",") === "kind,monotonic,wall" &&\n        value.kind === "windows-arm-full-source-clock-data" &&\n        Number.isFinite(value.wall) &&\n        Number.isFinite(value.monotonic) &&\n        value.monotonic >= 0,\n      "FULL_SOURCE_CLOCK_DATA",\n    );\n    remaining();\n    result = Object.freeze({ ...value, nodeMonoBefore, nodeWallBefore });\n  } catch (error) {\n    remember(error);\n    if (child && !exited && !closed) {\n      try {\n        child.kill();\n      } catch {\n        /* Retain the first actual failure. */\n      }\n    }\n    if (!pinJoined || (child && !(closed && stdoutClosed && stderrClosed))) {\n      const left = cleanupRemaining();\n      if (left > 0) {\n        try {\n          await Promise.race([\n            Promise.all([pinRead, child ? joined : Promise.resolve()]),\n            new Promise((_, reject) => {\n              cleanupTimer = setTimeout(\n                () => reject(new Error("FULL_SOURCE_CLOCK_CLOSE_DEADLINE")),\n                Math.max(1, left),\n              );\n            }),\n          ]);\n        } catch {\n          /* No join is inferred from cleanup expiration. */\n        }\n      }\n    }\n  } finally {\n    clearTimeout(workTimer);\n    clearTimeout(cleanupTimer);\n    for (const [emitter, event, callback] of listeners) {\n      try {\n        emitter.removeListener(event, callback);\n      } catch (error) {\n        remember(error);\n      }\n    }\n    if (child) {\n      for (const action of [\n        () => {\n          if (!stdoutClosed) child.stdout?.destroy();\n        },\n        () => {\n          if (!stderrClosed) child.stderr?.destroy();\n        },\n        () => {\n          if (!closed) child.unref();\n        },\n      ]) {\n        try {\n          action();\n        } catch (error) {\n          remember(error);\n        }\n      }\n    }\n    chunks.length = 0;\n  }\n  if (failed) throw primary;\n  return result;\n}\n\n// FULL-only accounting consumes the original source/acquisition ends. It does\n// not change the selected legacy recipe or issue any source/native authority.\nfunction fullSourceBudget(\n  context,\n  limits,\n  sample,\n  now = Date.now,\n  mono = performance.now.bind(performance),\n) {\n  need(\n    limits.wholeSeconds === 21600 &&\n      limits.sourceSeconds === 10800 &&\n      limits.acquisitionSeconds === 7200 &&\n      limits.hooksSeconds === 2700 &&\n      limits.cleanupSeconds === 30 &&\n      limits.finalReserveSeconds === 120,\n    "FULL_SDK_SOURCE_LIMITS",\n  );\n  const keys = [\n    "wallWholeEnd",\n    "monotonicWholeEnd",\n    "wallWorkEnd",\n    "monotonicWorkEnd",\n    "wallAcquisitionEnd",\n    "monotonicAcquisitionEnd",\n  ];\n  need(\n    keys.every((key) => Number.isFinite(context[key])) &&\n      context.wallWorkEnd <= context.wallWholeEnd &&\n      context.monotonicWorkEnd <= context.monotonicWholeEnd &&\n      context.wallAcquisitionEnd <= context.wallWorkEnd &&\n      context.monotonicAcquisitionEnd <= context.monotonicWorkEnd,\n    "FULL_SDK_SOURCE_ORIGINAL_ENDS",\n  );\n  need(\n    sample &&\n      Number.isFinite(sample.nodeMonoBefore) &&\n      Number.isFinite(sample.nodeWallBefore) &&\n      Number.isFinite(sample.monotonic) &&\n      sample.monotonic >= 0 &&\n      sample.nodeMonoBefore <= mono(),\n    "FULL_SDK_SOURCE_CLOCK_SAMPLE",\n  );\n  const began = sample.nodeMonoBefore,\n    wall = sample.nodeWallBefore,\n    original = Math.min(\n      10800000,\n      context.wallWorkEnd * 1000 - wall,\n      context.wallWholeEnd * 1000 - wall,\n      (context.monotonicWorkEnd - sample.monotonic) * 1000,\n      (context.monotonicWholeEnd - sample.monotonic) * 1000,\n    ),\n    acquisition = Math.min(\n      7200000,\n      context.wallAcquisitionEnd * 1000 - wall,\n      (context.monotonicAcquisitionEnd - sample.monotonic) * 1000,\n      original,\n    );\n  need(\n    Number.isFinite(began) && original > 0 && acquisition > 0,\n    "FULL_SDK_SOURCE_ORIGINAL_BUDGET",\n  );\n  const remaining = () => {\n    const elapsed = mono() - began;\n    need(Number.isFinite(elapsed) && elapsed >= 0, "FULL_SDK_SOURCE_CLOCK");\n    const left = Math.min(\n      original - elapsed,\n      context.wallWorkEnd * 1000 - now(),\n      context.wallWholeEnd * 1000 - now(),\n    );\n    need(Number.isFinite(left) && left > 0, "FULL_SDK_SOURCE_DEADLINE");\n    return left;\n  };\n  return Object.freeze({\n    remaining,\n    acquisitionRemaining() {\n      const source = remaining(),\n        elapsed = mono() - began;\n      need(Number.isFinite(elapsed) && elapsed >= 0, "FULL_SDK_SOURCE_CLOCK");\n      const left = Math.min(\n        source,\n        acquisition - elapsed,\n        context.wallAcquisitionEnd * 1000 - now(),\n      );\n      need(Number.isFinite(left) && left > 0, "FULL_SDK_ACQUISITION_DEADLINE");\n      return left;\n    },\n  });\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        oldSha256:
          "e891c4fc2176738e8575a98d818c484075c25733febfbbaa241c973c3abc9255",
        newSha256:
          "f48f912b2d080a3483d4dc27ee1322436a11f48dd1405a4ef83182b1d2fd7c67",
      },
      {
        oldRaw:
          "    image: c.image,\n    sourceGn: selected.sourceGn,\n    sourcePaths: c.sources.map((row) => row.path),\n  };\n  const initial = sourceBudget(c, p);\n  const started = performance.now();\n  const original = initial.remaining();\n  need(\n    Number.isFinite(c.wallWholeEnd) &&\n",
        newRaw:
          "    image: c.image,\n    sourceGn: selected.sourceGn,\n    sourcePaths: c.sources.map((row) => row.path),\n  };\n  const clockSample = await sampleFullSourceClock(c, p.python);\n  const initial = fullSourceBudget(c, full.limits, clockSample);\n  const started = performance.now();\n  const original = initial.remaining();\n  need(\n    Number.isFinite(c.wallWholeEnd) &&\n",
        oldSha256:
          "2fa8969407aa3acf1f4d8dd7646f2e85ce0f00552300703e5a4e874b5dfeb709",
        newSha256:
          "3631792918bacc5c365e562bd01bb1fa6631b8a6780c8ff86255141deee90de1",
      },
      {
        oldRaw:
          '      c.wallWholeEnd * 1000 - Date.now() <= 21600000,\n    "FULL_SDK_SOURCE_ORIGINAL_ENDS",\n  );\n  const budget = {\n    remaining() {\n      const remaining = Math.min(\n        initial.remaining(),\n        original - (performance.now() - started),\n',
        newRaw:
          '      c.wallWholeEnd * 1000 - Date.now() <= 21600000,\n    "FULL_SDK_SOURCE_ORIGINAL_ENDS",\n  );\n  const budget = {\n    acquisitionRemaining: () => initial.acquisitionRemaining(),\n    remaining() {\n      const remaining = Math.min(\n        initial.remaining(),\n        original - (performance.now() - started),\n',
        oldSha256:
          "5bdbd259f9c131387d1088fa1ab3f995e73623f3779f286d201a4acb53225b73",
        newSha256:
          "6ad352f0c63d3203e3f5bf686c2fb704cc1525a03ec7f67248dea380b03bc4f7",
      },
      {
        oldRaw:
          '    if (observerFailed) throw observerError;\n    if (reportFailed) throw reportError;\n    return value;\n  };\n  let qualificationOwner;\n  currentProgress = new SourceProgress(root, argv[2]);\n  try {\n    await sourceStage(root, budget, "source-acquisition", 4500, async () => {\n      currentProgress.phase("repository-fetch");\n      budget.remaining();\n      await patched.acquireSources(\n        files.workspace,\n        TARGET,\n        tools.git.path,\n        gitPolicy,\n      );\n      await verifyHostClosure(p, budget, c.image);\n      budget.remaining();\n      await runtime.prepareWindowsGitLauncher({\n        depot: files.depot,\n        gitExecutable: tools.git.path,\n        logs: files.logs,\n      });\n      stage = commands[0].role;\n      await checked(\n        () =>\n          executeCommand(\n            commands[0],\n            commands,\n            env,\n            files,\n            budget,\n            limits,\n            false,\n            { value: bootstrap, contextSha: argv[2] },\n          ),\n        true,\n      );\n    });\n    await fullSourceStage(root, budget, "source-hooks-gn", 2700, async () => {\n      stage = executionCommands[1].role;\n      const projection = validateHookProjection(\n        await checked(() =>\n',
        newRaw:
          '    if (observerFailed) throw observerError;\n    if (reportFailed) throw reportError;\n    return value;\n  };\n  const acquisitionBudget = Object.freeze({\n    remaining() {\n      return Math.min(budget.remaining(), budget.acquisitionRemaining());\n    },\n  });\n  let qualificationOwner;\n  currentProgress = new FullSourceProgress(root, argv[2]);\n  try {\n    await fullSourceStage(\n      root,\n      budget,\n      "source-acquisition",\n      7200,\n      async () => {\n        currentProgress.phase("repository-fetch");\n        acquisitionBudget.remaining();\n        await patched.acquireSources(\n          files.workspace,\n          TARGET,\n          tools.git.path,\n          gitPolicy,\n        );\n        acquisitionBudget.remaining();\n        await verifyHostClosure(p, acquisitionBudget, c.image);\n        acquisitionBudget.remaining();\n        await runtime.prepareWindowsGitLauncher({\n          depot: files.depot,\n          gitExecutable: tools.git.path,\n          logs: files.logs,\n        });\n        acquisitionBudget.remaining();\n        stage = commands[0].role;\n        await checked(\n          () =>\n            executeCommand(\n              commands[0],\n              commands,\n              env,\n              files,\n              acquisitionBudget,\n              limits,\n              false,\n              { value: bootstrap, contextSha: argv[2] },\n            ),\n          true,\n        );\n      },\n    );\n    await fullSourceStage(root, budget, "source-hooks-gn", 2700, async () => {\n      stage = executionCommands[1].role;\n      const projection = validateHookProjection(\n        await checked(() =>\n',
        oldSha256:
          "bacaea48d3b92ac38ece8aa6ff24574120ded55b22b4358dd9e639123f9c2786",
        newSha256:
          "ba6b2d7c37df928e194820b6f08d4ecf4866111b4080edd9c89590debd5d8b41",
      },
    ],
  },
  controller: {
    path: "native/windows-arm-full-sdk/full_sdk_control.mjs",
    bytes: 175516,
    sha256: "097a828c6d26648690c5fff05c7e59dfaa8de553262b2fca0a6fcb119c2d0659",
    newBytes: 175570,
    newSha256:
      "c15c97aa6e9e14b4b52f633e44419045273ca9645ba4cbcd3641396c95946012",
    rows: [
      {
        oldRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\nconst DATA_ROLES = Object.freeze([\n  "sdk-data",\n  "llvm-data",\n',
        newRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 10800000;\nconst ACQUISITION_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\nconst DATA_ROLES = Object.freeze([\n  "sdk-data",\n  "llvm-data",\n',
        oldSha256:
          "59bc4818dbd747a4969cf6fec8acea23d38fe475f345989fa0143a1740844670",
        newSha256:
          "d57bb706ff323933b2c22605f6468e22b7c464729e89079ba3a94175e387a955",
      },
      {
        oldRaw:
          '      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      4500000 - (Date.now() - owner.wallStart),\n      4500000 - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n',
        newRaw:
          '      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      ACQUISITION_MS - (Date.now() - owner.wallStart),\n      ACQUISITION_MS - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n',
        oldSha256:
          "d086e4a470813746ffc40f61e50d90cee2c94aab3cf89ccf8b258b29924270fc",
        newSha256:
          "cc47d02b196dbe63bf6a4e1b525485103c92a7f824cc3a0090454f41cd125127",
      },
      {
        oldRaw:
          "    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n",
        newRaw:
          "    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + ACQUISITION_MS) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n",
        oldSha256:
          "15eb5c4144c038ca4155db70e8d4079c504ae9259a8951e0a5575735ee32351f",
        newSha256:
          "c249b742fd964d7164995c252bfbe4b3cbc9eacd105333fb6e654cc1e9e94e51",
      },
    ],
  },
  python: {
    path: "native/windows-arm-full-sdk/full_sdk_source.py",
    bytes: 28553,
    sha256: "8aa85f3d3540081ad28e82103bef2267e4f2a45cf9d3a5d35d1e814ea78309b9",
    newBytes: 28553,
    newSha256:
      "a5ae8b06d54d4260461a437f4983b71234316dcd86d9d699e3b29629ca0c2ae1",
    rows: [
      {
        oldRaw:
          "\nMODE = 'full-sdk-source-gn'\nWORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'\nPOLICY = 'native/windows-arm-full-sdk/sdk-origin-review.json'\nPROFILE_SHA256 = 'ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b'\nFULL_SOURCE_ADMITTED = False\nSOURCE_QUALIFICATION_ALLOWED = True\nHEX = re.compile(r'[a-f0-9]{64}')\nROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\\.artifacts/windows-arm-full-sdk-'\n",
        newRaw:
          "\nMODE = 'full-sdk-source-gn'\nWORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'\nPOLICY = 'native/windows-arm-full-sdk/sdk-origin-review.json'\nPROFILE_SHA256 = '71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb'\nFULL_SOURCE_ADMITTED = False\nSOURCE_QUALIFICATION_ALLOWED = True\nHEX = re.compile(r'[a-f0-9]{64}')\nROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\\.artifacts/windows-arm-full-sdk-'\n",
        oldSha256:
          "e51860ea5340d05b729b6916aaa57afdc736162f436c3f7b8d90971fbdde19de",
        newSha256:
          "a020134c40a773d3aa2c37ed360cf9e95a0d67b456d8d223c58c5f905dabd586",
      },
      {
        oldRaw:
          "              mono_source_end, wall_now, mono_now)\n    need(all(type(value) in (int, float) and math.isfinite(value) for value in values), 'CLOCK')\n    whole = min(wall_whole_end - wall_now, mono_whole_end - mono_now)\n    source = min(wall_source_end - wall_now, mono_source_end - mono_now)\n    need(150 < whole <= 21600 and 150 < source <= 7200 and\n         wall_source_end <= wall_whole_end and mono_source_end <= mono_whole_end, 'DEADLINE')\n    return {'workSeconds': min(whole, source) - 150, 'cleanupSeconds': 30,\n            'finalReserveSeconds': 120, 'wallWholeEnd': wall_whole_end,\n            'monotonicWholeEnd': mono_whole_end, 'wallSourceEnd': wall_source_end,\n",
        newRaw:
          "              mono_source_end, wall_now, mono_now)\n    need(all(type(value) in (int, float) and math.isfinite(value) for value in values), 'CLOCK')\n    whole = min(wall_whole_end - wall_now, mono_whole_end - mono_now)\n    source = min(wall_source_end - wall_now, mono_source_end - mono_now)\n    need(150 < whole <= 21600 and 150 < source <= 10800 and\n         wall_source_end <= wall_whole_end and mono_source_end <= mono_whole_end, 'DEADLINE')\n    return {'workSeconds': min(whole, source) - 150, 'cleanupSeconds': 30,\n            'finalReserveSeconds': 120, 'wallWholeEnd': wall_whole_end,\n            'monotonicWholeEnd': mono_whole_end, 'wallSourceEnd': wall_source_end,\n",
        oldSha256:
          "8446808742ca2f3c15415501f3b12b8bc586532bf66974845f26c8d4be3fdc13",
        newSha256:
          "dc1bdd09f108d296192447f341cc20b436af870fe74bc69b907711faa8463c5f",
      },
      {
        oldRaw:
          "        producer.source_capacity(root, p, clock)\n        _host_closure(p, clock, c)\n        for role in (*_DATA_ROLES, _NODE):\n            _verified_active_sources(root)\n            # All acquisition roles share one original4500s end. The Node body\n            # receives the original source ends and uses its fixed2700s hook cap.\n            remaining = min(clock.remaining(), phase_end - time.monotonic(), wall_phase_end - time.time()) if role != _NODE else clock.remaining()\n            allotted = {'sdk-data': 1170, 'llvm-data': 300, 'rust-archive': 1200,\n                         'gn-archive': 180, 'siso-archive': 180, 'materialize': 600,\n                         'runtime-closure': 720}.get(role, 7200)\n            seconds = min(allotted, remaining - 150)\n            need(seconds > 0, 'PHASE_DEADLINE')\n            receipt = job.run_job(_worker_argv(role, root, p), str(root), root / 'jobs' / role,\n                                  seconds, cancel=state['native']['parent'],\n",
        newRaw:
          "        producer.source_capacity(root, p, clock)\n        _host_closure(p, clock, c)\n        for role in (*_DATA_ROLES, _NODE):\n            _verified_active_sources(root)\n            # All acquisition roles consume the same original7200s endpoint. The\n            # Node body debits data time and retains the fixed2700s hook cap.\n            remaining = min(clock.remaining(), phase_end - time.monotonic(), wall_phase_end - time.time()) if role != _NODE else clock.remaining()\n            allotted = {'sdk-data': 1170, 'llvm-data': 300, 'rust-archive': 1200,\n                         'gn-archive': 180, 'siso-archive': 180, 'materialize': 600,\n                         'runtime-closure': 720}.get(role, 10800)\n            seconds = min(allotted, remaining - 150)\n            need(seconds > 0, 'PHASE_DEADLINE')\n            receipt = job.run_job(_worker_argv(role, root, p), str(root), root / 'jobs' / role,\n                                  seconds, cancel=state['native']['parent'],\n",
        oldSha256:
          "329df2fb49872d57bd973c861c8b2bc33b695dd9f4265461835235ae6554c73b",
        newSha256:
          "7029b938edc9c0a2a170c661dcf6105a61a9c780b13325a013d24a24106489d2",
      },
    ],
  },
  profile: {
    path: "native/windows-arm-full-sdk/full-sdk-source-profile.json",
    bytes: 10635,
    sha256: "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b",
    newBytes: 10710,
    newSha256:
      "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb",
    rows: [
      {
        oldRaw:
          '    "sha256": "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",\n    "inverse": "Restore the single finite full-metadata shared-runner branch, then the three finite c9 source-program replacements, then remove the CLOSED FULL SDK SOURCE BODY and INACTIVE FULL SDK SOURCE INTERFACE marked blocks; whole b039 restores.",\n    "apache4D61Carried": true,\n    "sourceBodyOriginalSha256": "45055005b59ad90ff2be1695f1c30ddcd99d4da14ba8c1318ba134a11ac3d361",\n    "sourceBodyDerivedSha256": "01febb9ef9520235de8884fcabe49751ac3fab57f44d6ce1a247083b5bbaef90",\n    "sourceBodySubstitutions": 15,\n    "operationDerivative": "Explicit full-specific fixed-role acquisition loop with the same seven data bodies, original subcaps and original clock consumers; no old identity rewritten.",\n    "assemblyInverse": "Restore reviewed source-entry/footer, restore vector and pre-GN data/graph comparison blocks by exact finite inverse before prior2700/c9/b039 inverses."\n  },\n  "limits": {\n    "wholeSeconds": 21600,\n    "sourceSeconds": 7200,\n    "acquisitionSeconds": 4500,\n    "hooksSeconds": 2700,\n    "cleanupSeconds": 30,\n    "finalReserveSeconds": 120\n  },\n',
        newRaw:
          '    "sha256": "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",\n    "inverse": "Restore the single finite full-metadata shared-runner branch, then the three finite c9 source-program replacements, then remove the CLOSED FULL SDK SOURCE BODY and INACTIVE FULL SDK SOURCE INTERFACE marked blocks; whole b039 restores.",\n    "apache4D61Carried": true,\n    "sourceBodyOriginalSha256": "45055005b59ad90ff2be1695f1c30ddcd99d4da14ba8c1318ba134a11ac3d361",\n    "sourceBodyDerivedSha256": "7423e9a95b0b77b6293b264296466a3f16ff6e8e182e1e6e17094d77dc6db96a",\n    "sourceBodySubstitutions": 23,\n    "operationDerivative": "Explicit full-specific fixed-role acquisition loop with the same seven data bodies; original once-captured source10800/acquisition7200/hooks2700 consumers under the original21600 whole, without rewriting old source recipe identity.",\n    "assemblyInverse": "Restore reviewed source-entry/footer, restore vector and pre-GN data/graph comparison blocks by exact finite inverse before prior2700/c9/b039 inverses."\n  },\n  "limits": {\n    "wholeSeconds": 21600,\n    "sourceSeconds": 10800,\n    "acquisitionSeconds": 7200,\n    "hooksSeconds": 2700,\n    "cleanupSeconds": 30,\n    "finalReserveSeconds": 120\n  },\n',
        oldSha256:
          "ab7ddbb2e4d56eef29f9be566c29a4cfab3bd8e9e5737d0aab006073548a0ba5",
        newSha256:
          "5bb52917818fb3022b5d224c1d85b19d615001f06604811a79ad51a72b2f4584",
      },
    ],
  },
  workflow: {
    path: ".github/workflows/windows-arm-full-sdk.yml",
    bytes: 8411,
    sha256: "5b25ee82c670f3c8c1d95893b95d0f72b0e36bf8974d26a7ce1468ed4ecb0176",
    newBytes: 9925,
    newSha256:
      "4aa74d8ea85e2952b6ca69e7ad57b4cf24db34e68a7a302c5ce3f59de9eccb5d",
    rows: [
      {
        oldRaw:
          "            .artifacts/windows-arm-full-sdk-*/full-sdk-engine-*.log\n            .artifacts/windows-arm-full-sdk-*/jobs/*/receipt.json\n            .artifacts/windows-arm-full-sdk-*/jobs/*/stdout.log\n            .artifacts/windows-arm-full-sdk-*/jobs/*/stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/source-deadline.json\n",
        newRaw:
          "            .artifacts/windows-arm-full-sdk-*/full-sdk-engine-*.log\n            .artifacts/windows-arm-full-sdk-*/jobs/*/receipt.json\n            .artifacts/windows-arm-full-sdk-*/jobs/*/stdout.log\n            .artifacts/windows-arm-full-sdk-*/jobs/*/stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/sync.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/sync.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/hook-projection.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/hook-projection.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/dependency-hooks.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/dependency-hooks.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-x86.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-x86.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-x64.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-x64.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-arm64.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/setup-arm64.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/verify-setup.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/verify-setup.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/cef-gn.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/cef-gn.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/restore-checkpoint.stdout.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/restore-checkpoint.stderr.log\n            .artifacts/windows-arm-full-sdk-*/source-gn-logs/source-deadline.json\n",
        oldSha256:
          "5c5db3570bd3655915ca48b50ab516e4a666e05f42d0410508bc128da499dc0b",
        newSha256:
          "66714dd5b9d66952b2e49bebd9d6aea910c44a430410b79469da4995d95cb880",
      },
    ],
  },
};
// BEGIN EXACT FULL BOOTSTRAP CACHE INVERSE
const FULL_BOOTSTRAP_CACHE_HISTORY = {
  driver: {
    path: "native/windows-arm-full-sdk/full-sdk-source-driver.mjs",
    bytes: 286208,
    sha256: "3227c6e0863271864024d456125e28ca40dc5257306a35f866fbbbcb0a5097a8",
    newBytes: 289624,
    newSha256:
      "e9ed9951089d9b44b1b614bb3b1d56be8c78fc8e026f714927fed3645fac04ea",
    rows: [
      {
        oldRaw:
          "      \"--revision\",\n      `src@${p.sourceChromium}`,\n    ],\n  };\n  return Buffer.from(\n    String.raw`import sys,os,json,time,stat,hashlib,subprocess\nfrom pathlib import Path\nP=json.loads(${JSON.stringify(JSON.stringify(policy))})\nsys.path.insert(0,P['native'])\n",
        newRaw:
          "      \"--revision\",\n      `src@${p.sourceChromium}`,\n    ],\n  };\n  const program = Buffer.from(\n    String.raw`import sys,os,json,time,stat,hashlib,subprocess\nfrom pathlib import Path\nP=json.loads(${JSON.stringify(JSON.stringify(policy))})\nsys.path.insert(0,P['native'])\n",
        oldSha256:
          "bdfabeb2a65e01fea4e7bbbf8fd59ffd4a28ac5b6bf2e9f84f6da425217105c1",
        newSha256:
          "5015c9c48c4ece772112d7bc9048287c3735d8dfd85e98dc9a7b81e779c316f2",
      },
      {
        oldRaw:
          "if __name__=='__main__':sys.exit(main(sys.argv[1:]))\n`,\n    \"utf8\",\n  );\n}\n\nexport async function prepareBootstrap(root, p, contextSha, budget) {\n  const files = sourcePaths(root, p),\n",
        newRaw:
          'if __name__==\'__main__\':sys.exit(main(sys.argv[1:]))\n`,\n    "utf8",\n  );\n  if (!fullAuthority) return program; // Preserve every legacy emitted byte.\n  const old = "SETUP=DEPOT/\'sorng-cipd-setup.bat\'";\n  const text = program.toString("utf8");\n  need(text.split(old).length === 2, "FULL_BOOTSTRAP_SETUP_SOURCE");\n  return Buffer.from(\n    text.replace(old, `SETUP=DEPOT/\'${FULL_BOOTSTRAP_SETUP_BASENAME}\'`),\n  );\n}\n\nexport async function prepareBootstrap(root, p, contextSha, budget) {\n  const files = sourcePaths(root, p),\n',
        oldSha256:
          "0e69cd8a6cbfe0b6a6ef4faf4c244029fcb0d9c775b4e635184b8d6d75fe50f0",
        newSha256:
          "e856082ef717115cc9f54c6811c442d823747d268b88faa5f957f505c870a588",
      },
      {
        oldRaw:
          '  };\n}\n\nexport async function verifyBootstrap(root, p, bootstrap, budget, contextSha) {\n  const files = sourcePaths(root, p);\n  need(bootstrap.witnessPin !== null, "FULL_BOOTSTRAP_NOT_ATTESTED");\n  await held(bootstrap.file, 2 * 1024 ** 2, budget, bootstrap.pin);\n  const raw = await held(\n    bootstrap.witness,\n',
        newRaw:
          '  };\n}\n\nexport async function verifyBootstrap(root, p, bootstrap, budget, contextSha) {\n  const files = sourcePaths(root, p),\n    fullAuthority = fullBootstrapAuthority(root, p, contextSha);\n  need(bootstrap.witnessPin !== null, "FULL_BOOTSTRAP_NOT_ATTESTED");\n  await held(bootstrap.file, 2 * 1024 ** 2, budget, bootstrap.pin);\n  const raw = await held(\n    bootstrap.witness,\n',
        oldSha256:
          "f6749cf529eb98937cf356d034d79e50bb02bc2f38df5f2f19d930aabf3648f5",
        newSha256:
          "77542ebaf6984075f126fa5aa4967fec5efc344b0d352eea96c446b797da6641",
      },
      {
        oldRaw:
          '  }\n  const setup = deriveBootstrapSetup(setupSource);\n  need(setup.length <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");\n  await held(\n    path.join(files.depot, "sorng-cipd-setup.bat"),\n    setup.length,\n    budget,\n    { bytes: setup.length, sha256: sha(setup), nlink: 1 },\n    true,\n',
        newRaw:
          '  }\n  const setup = deriveBootstrapSetup(setupSource);\n  need(setup.length <= 512 * 1024 ** 2 - bytes, "FULL_BOOTSTRAP_BYTES");\n  await held(\n    path.join(\n      files.depot,\n      fullAuthority ? FULL_BOOTSTRAP_SETUP_BASENAME : "sorng-cipd-setup.bat",\n    ),\n    setup.length,\n    budget,\n    { bytes: setup.length, sha256: sha(setup), nlink: 1 },\n    true,\n',
        oldSha256:
          "ae3b909cad210e86a39d4f93b503431b59d70984ada65242f5c505a5ea530de1",
        newSha256:
          "5a530d24b4bcd067c27385a78c48519238dc8cbeee98cb70fa59cdc8a1423577",
      },
      {
        oldRaw:
          '}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\n',
        newRaw:
          '}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e";\nconst fullSourceProfiles = new WeakMap();\n// The reviewed generated setup is bootstrap cache, covered by c101 .cipd_client*.\n// No ignore file or clean-check exception is created or changed.\nconst FULL_BOOTSTRAP_SETUP_BASENAME = ".cipd_client_sorng_setup.bat";\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\n',
        oldSha256:
          "45b0a7a2bd7c6529f4f6ea944f8872fa22ee21cc5d4d4edf469040371929099d",
        newSha256:
          "c190d11eaf0177f2f62f6d8d31163d39a9f3cf24909ba75e82d73848a1728b43",
      },
      {
        oldRaw:
          '  }\n}\n// END SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\n\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n',
        newRaw:
          '  }\n}\n// END SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\n\n// Error details are bounded DATA only. Never read a getter or print raw text.\nfunction fullSourceErrorMessage(error) {\n  if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n    return null;\n  const descriptor = Object.getOwnPropertyDescriptor(error, "message");\n  return descriptor &&\n    Object.hasOwn(descriptor, "value") &&\n    typeof descriptor.value === "string" &&\n    descriptor.value.length <= 4096\n    ? descriptor.value\n    : null;\n}\nfunction fullSourceApplyDiagnostic(error) {\n  const diagnostic = {\n    kind: "windows-arm-source-apply-failure",\n    phase: "source-apply",\n    category: "unclassified",\n  };\n  const message = fullSourceErrorMessage(error);\n  if (message !== null) {\n    const repository =\n      /^(cef|chromium|depotTools): (clean checkout required; existing changes are never reset|checkout root required|source revision mismatch)$/.exec(\n        message,\n      );\n    if (repository) {\n      diagnostic.repository = repository[1];\n      diagnostic.category = repository[2].startsWith("clean checkout")\n        ? "dirty-checkout"\n        : repository[2] === "checkout root required"\n          ? "checkout-root"\n          : "source-revision";\n    } else if (message.startsWith("Digest/size mismatch: "))\n      diagnostic.category = "input-pin";\n    else if (message === "CEF checkout must be chromium/cef for upstream hooks")\n      diagnostic.category = "cef-placement";\n    else {\n      const patch =\n        /^Patch application failed; applied repositories: (none|cef|chromium|cef,chromium); current repository: (cef|chromium); completed patches: ([0-9]{1,2})\\. No rollback\\/reset performed\\./.exec(\n          message,\n        );\n      if (patch && Number(patch[3]) <= 64) {\n        diagnostic.category = "patch-application";\n        diagnostic.repository = patch[2];\n        diagnostic.completedPatches = Number(patch[3]);\n        diagnostic.appliedRepositories =\n          patch[1] === "none" ? [] : patch[1].split(",");\n      }\n    }\n    const code = Object.getOwnPropertyDescriptor(error, "code");\n    if (code && Object.hasOwn(code, "value")) {\n      if (Number.isInteger(code.value) && code.value >= 0 && code.value <= 255)\n        diagnostic.exitCode = code.value;\n      else if (\n        [\n          "ENOENT",\n          "EACCES",\n          "EPERM",\n          "ETIMEDOUT",\n          "ABORT_ERR",\n          "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",\n        ].includes(code.value)\n      )\n        diagnostic.code = code.value;\n    }\n  }\n  return diagnostic;\n}\n\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n',
        oldSha256:
          "b4b35e5f2356bf27cc7ce85b5004e40278b44294d2e93d83ab7c4678c78af79d",
        newSha256:
          "6d49e911ed9bf2cf99a780ab470157e051ce482ed3a7b22efb7285c3415b9b65",
      },
      {
        oldRaw:
          '  } finally {\n    fullSourceProfiles.delete(p);\n    retireQualificationSource(qualificationOwner);\n    currentProgress?.close();\n    const code =\n      typeof primary?.message === "string" &&\n      /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(primary.message)\n        ? primary.message\n        : failed\n          ? "FULL_SOURCE_FAILED"\n          : null;\n    const report = {\n      kind: "windows-arm-source-gn",\n      success,\n      stage: success ? "complete" : stage,\n      firstFailure: success ? null : code,\n      target: TARGET,\n      sourceId: p.sourceGn.sourceId,\n      graph,\n      generatedArguments,\n',
        newRaw:
          '  } finally {\n    fullSourceProfiles.delete(p);\n    retireQualificationSource(qualificationOwner);\n    currentProgress?.close();\n    const message = fullSourceErrorMessage(primary);\n    const code =\n      message !== null &&\n      /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(message)\n        ? message\n        : failed\n          ? "FULL_SOURCE_FAILED"\n          : null;\n    const report = {\n      kind: "windows-arm-source-gn",\n      success,\n      stage: success ? "complete" : stage,\n      firstFailure: success ? null : code,\n      ...(failed && stage === "source-apply"\n        ? { failureDiagnostic: fullSourceApplyDiagnostic(primary) }\n        : {}),\n      target: TARGET,\n      sourceId: p.sourceGn.sourceId,\n      graph,\n      generatedArguments,\n',
        oldSha256:
          "e8ef87cfcf244a9401b350e2e1f450f9dccdda644eb7bc0f81dabc25d53fcbef",
        newSha256:
          "384bc76ae4488d420ae749f560dd76bc7fbda8a25121f514c77f9e862713a24e",
      },
      {
        oldRaw:
          ') {\n  Promise.resolve()\n    .then(() => fullSdkSourceMain())\n    .catch((error) => {\n      const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,80}$/.test(\n        error?.message ?? "",\n      )\n        ? error.message\n        : "FULL_SDK_SOURCE_FAILED";\n      console.error(\n        JSON.stringify({\n          success: false,\n          firstFailure: code,\n',
        newRaw:
          ') {\n  Promise.resolve()\n    .then(() => fullSdkSourceMain())\n    .catch((error) => {\n      const message = fullSourceErrorMessage(error);\n      const code =\n        message !== null &&\n        /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,80}$/.test(message)\n          ? message\n          : "FULL_SDK_SOURCE_FAILED";\n      console.error(\n        JSON.stringify({\n          success: false,\n          firstFailure: code,\n',
        oldSha256:
          "791288ce45fb4921ed046f0dfcce36033e55704305ae4a0f02e06c6f87e7ee3e",
        newSha256:
          "9811f85cd655b5f4a65094f0b5d108248d48d06dbb8c91c00ebf47d387810e0a",
      },
    ],
  },
  controller: {
    path: "native/windows-arm-full-sdk/full_sdk_control.mjs",
    bytes: 175570,
    sha256: "c15c97aa6e9e14b4b52f633e44419045273ca9645ba4cbcd3641396c95946012",
    newBytes: 175570,
    newSha256:
      "97cb6430200bee3880651d6b597d2ee4f4886dfe6377b484c900a4e727edc294",
    rows: [
      {
        oldRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\n',
        newRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\n',
        oldSha256:
          "804b0eacf23d470d16906c8f7b81c08fa5610a991998b9b08680af341950e23d",
        newSha256:
          "b25479d0281e8d164381caab15ece3c0dd0b4dac079a8af9989d8f8061182153",
      },
    ],
  },
  python: {
    path: "native/windows-arm-full-sdk/full_sdk_source.py",
    bytes: 28553,
    sha256: "a5ae8b06d54d4260461a437f4983b71234316dcd86d9d699e3b29629ca0c2ae1",
    newBytes: 28553,
    newSha256:
      "6da8be5749d21ee22e4fb4a0ae464b7ff161d354c0177b86a98f96157759601a",
    rows: [
      {
        oldRaw:
          "\nMODE = 'full-sdk-source-gn'\nWORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'\nPOLICY = 'native/windows-arm-full-sdk/sdk-origin-review.json'\nPROFILE_SHA256 = '71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb'\nFULL_SOURCE_ADMITTED = False\nSOURCE_QUALIFICATION_ALLOWED = True\nHEX = re.compile(r'[a-f0-9]{64}')\nROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\\.artifacts/windows-arm-full-sdk-'\n",
        newRaw:
          "\nMODE = 'full-sdk-source-gn'\nWORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'\nPOLICY = 'native/windows-arm-full-sdk/sdk-origin-review.json'\nPROFILE_SHA256 = 'e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e'\nFULL_SOURCE_ADMITTED = False\nSOURCE_QUALIFICATION_ALLOWED = True\nHEX = re.compile(r'[a-f0-9]{64}')\nROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\\.artifacts/windows-arm-full-sdk-'\n",
        oldSha256:
          "a020134c40a773d3aa2c37ed360cf9e95a0d67b456d8d223c58c5f905dabd586",
        newSha256:
          "5f3454cece07e85601e98a55815ddad597bf5fddb2410ec96f8aa8269c02d0be",
      },
    ],
  },
  profile: {
    path: "native/windows-arm-full-sdk/full-sdk-source-profile.json",
    bytes: 10710,
    sha256: "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb",
    newBytes: 11144,
    newSha256:
      "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
    rows: [
      {
        oldRaw:
          '    "sha256": "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",\n    "inverse": "Restore the single finite full-metadata shared-runner branch, then the three finite c9 source-program replacements, then remove the CLOSED FULL SDK SOURCE BODY and INACTIVE FULL SDK SOURCE INTERFACE marked blocks; whole b039 restores.",\n    "apache4D61Carried": true,\n    "sourceBodyOriginalSha256": "45055005b59ad90ff2be1695f1c30ddcd99d4da14ba8c1318ba134a11ac3d361",\n    "sourceBodyDerivedSha256": "7423e9a95b0b77b6293b264296466a3f16ff6e8e182e1e6e17094d77dc6db96a",\n    "sourceBodySubstitutions": 23,\n    "operationDerivative": "Explicit full-specific fixed-role acquisition loop with the same seven data bodies; original once-captured source10800/acquisition7200/hooks2700 consumers under the original21600 whole, without rewriting old source recipe identity.",\n    "assemblyInverse": "Restore reviewed source-entry/footer, restore vector and pre-GN data/graph comparison blocks by exact finite inverse before prior2700/c9/b039 inverses."\n  },\n  "limits": {\n',
        newRaw:
          '    "sha256": "b039eac66b8da7f3bdf140f2fb812518c48665f4e7a1719bbb91268459f4b201",\n    "inverse": "Restore the single finite full-metadata shared-runner branch, then the three finite c9 source-program replacements, then remove the CLOSED FULL SDK SOURCE BODY and INACTIVE FULL SDK SOURCE INTERFACE marked blocks; whole b039 restores.",\n    "apache4D61Carried": true,\n    "sourceBodyOriginalSha256": "45055005b59ad90ff2be1695f1c30ddcd99d4da14ba8c1318ba134a11ac3d361",\n    "sourceBodyDerivedSha256": "f84609083f1f23c57ae206a96fe81fee7171a8b14870dbafc1bc6a05145c47b2",\n    "sourceBodySubstitutions": 25,\n    "operationDerivative": "Explicit full-specific fixed-role acquisition loop with the same seven data bodies; original once-captured source10800/acquisition7200/hooks2700 consumers under the original21600 whole, without rewriting old source recipe identity.",\n    "assemblyInverse": "Restore reviewed source-entry/footer, restore vector and pre-GN data/graph comparison blocks by exact finite inverse before prior2700/c9/b039 inverses."\n  },\n  "limits": {\n',
        oldSha256:
          "d2fa88d2b0449bdb854bccbaf1f46c7a261b1a3c6bc360158c6c1b2a9889e7ee",
        newSha256:
          "423b6f4ff044dd1f8ef1ee7cf51b83cdde35414b413bbf9c54bcc5c8bafa4dcb",
      },
      {
        oldRaw:
          '  "parentSdkVerificationImplemented": true,\n  "parentCheckpointVerificationImplemented": true,\n  "compiledCheckpointNativeQualified": false,\n  "sourceSentinelNormalizerImplemented": true,\n  "sourceSentinelNativeQualified": false\n}\n',
        newRaw:
          '  "parentSdkVerificationImplemented": true,\n  "parentCheckpointVerificationImplemented": true,\n  "compiledCheckpointNativeQualified": false,\n  "sourceSentinelNormalizerImplemented": true,\n  "sourceSentinelNativeQualified": false,\n  "sourceBootstrapCachePlacement": {\n    "implemented": true,\n    "fullOnly": true,\n    "basename": ".cipd_client_sorng_setup.bat",\n    "upstreamCommit": "c101dcbe0489c455fce7c2247bfee19680b116c3",\n    "gitignoreSha256": "4dba4a2ed70f50373d8260cc393d78c251a17ab52d47b629f3a94af268f6621d",\n    "setupBytes": 1390,\n    "setupSha256": "635209f2b2e2cfd928c73baa08e5f2e17c2f48124a7327b74ffd6b6b9c5e5ce5",\n    "nativeQualified": false\n  }\n}\n',
        oldSha256:
          "a46d37af460e418262ef8401ef6a5687a82d0d5a76ea48daccb3316acf8b3767",
        newSha256:
          "e022df5d5cecab9cfe6e489bbfd34dcdfcb536fa1efb8a0421ff931c23290804",
      },
    ],
  },
};
function fullSourceEnvironmentProducerInverse(text) {
  text = fullGraphDeadlineInverse(text, "producer");
  const spec = {
    begin: "    # BEGIN OWNED FULL SOURCE ENVIRONMENT OWNER\n",
    end: "    # END OWNED FULL SOURCE ENVIRONMENT OWNER\n",
    blockBytes: 367,
    blockSha256:
      "c3e7cdb7cae76d50749d5b2a56a6369844275f0bc45a655f44deec38f97d314b",
    bytes: 59773,
    sha256: "1d98a4ba7e6db89a49b45c1c1deb73075a381d9a4f5b263507547c8d5c2d5c52",
    blocks: [
      {
        begin: "    # BEGIN OWNED FULL SOURCE ENVIRONMENT OWNER\n",
        end: "    # END OWNED FULL SOURCE ENVIRONMENT OWNER\n",
        blockBytes: 367,
        blockSha256:
          "c3e7cdb7cae76d50749d5b2a56a6369844275f0bc45a655f44deec38f97d314b",
      },
      {
        begin: "            # BEGIN OWNED FULL SOURCE ENVIRONMENT BRIDGE\n",
        end: "            # END OWNED FULL SOURCE ENVIRONMENT BRIDGE\n",
        blockBytes: 306,
        blockSha256:
          "56be570b27f967fa9d3bd7431d2b48f515e868a9fc7901dc7b4763a7dc770fb6",
      },
      {
        begin:
          "        # BEGIN OWNED FULL SOURCE ENVIRONMENT RETENTION BEFORE PROGRESS\n",
        end: "        # END OWNED FULL SOURCE ENVIRONMENT RETENTION BEFORE PROGRESS\n",
        blockBytes: 446,
        blockSha256:
          "605aed3196c31bf255b4a5d8fbf81bacf91a4238024da630222301d39409c65d",
      },
      {
        begin:
          "        # BEGIN OWNED FULL SOURCE ENVIRONMENT RETENTION BEFORE REPORT\n",
        end: "        # END OWNED FULL SOURCE ENVIRONMENT RETENTION BEFORE REPORT\n",
        blockBytes: 431,
        blockSha256:
          "07eeeb00a9fa3ab545677f3ba827e5bd2b6b20c184ed51466a569cecfb705262",
      },
    ],
  };
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.blocks) {
    assert.equal(text.split(row.begin).length, 2, "ENVIRONMENT_INVERSE_COUNT");
    assert.equal(text.split(row.end).length, 2, "ENVIRONMENT_INVERSE_COUNT");
    const start = text.indexOf(row.begin);
    const finish = text.indexOf(row.end, start) + row.end.length;
    const block = text.slice(start, finish);
    assert.equal(
      Buffer.byteLength(block),
      row.blockBytes,
      "ENVIRONMENT_INVERSE_BLOCK",
    );
    assert.equal(hash(block), row.blockSha256, "ENVIRONMENT_INVERSE_BLOCK");
    text = text.slice(0, start) + text.slice(finish);
  }
  for (const [current, previous] of [
    [
      "        if progress is not None and environment_retention_allowed:\n",
      "        if progress is not None:\n",
    ],
    [
      '        if environment_retention_allowed:\n            retain(root, role + "-result.json", result)\n',
      '        retain(root, role + "-result.json", result)\n',
    ],
  ]) {
    assert.equal(text.split(current).length, 2, "ENVIRONMENT_INVERSE_COUNT");
    text = text.replace(current, previous);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ENVIRONMENT_INVERSE_WHOLE",
  );
  assert.equal(hash(text), spec.sha256, "ENVIRONMENT_INVERSE_WHOLE");
  return text;
}
function fullSourceEnvironmentInverse(text, name) {
  if (name !== "sourcepy" && name !== "python") return text;
  const spec = {
    begin: "# BEGIN OWNED FULL SOURCE ENVIRONMENT\n",
    end: "# END OWNED FULL SOURCE ENVIRONMENT\n\n\n",
    blockBytes: 6814,
    blockSha256:
      "5a49d5b5e6adac97655b9587fd31c639a54baf9a9ddd5977652ced3d7df7db3b",
    bytes: 28553,
    sha256: "6da8be5749d21ee22e4fb4a0ae464b7ff161d354c0177b86a98f96157759601a",
  };
  assert.equal(text.split(spec.begin).length, 2, "ENVIRONMENT_INVERSE_COUNT");
  assert.equal(text.split(spec.end).length, 2, "ENVIRONMENT_INVERSE_COUNT");
  const start = text.indexOf(spec.begin);
  const finish = text.indexOf(spec.end, start) + spec.end.length;
  const block = text.slice(start, finish);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(
    Buffer.byteLength(block),
    spec.blockBytes,
    "ENVIRONMENT_INVERSE_BLOCK",
  );
  assert.equal(hash(block), spec.blockSha256, "ENVIRONMENT_INVERSE_BLOCK");
  text = text.slice(0, start) + text.slice(finish);
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ENVIRONMENT_INVERSE_WHOLE",
  );
  assert.equal(hash(text), spec.sha256, "ENVIRONMENT_INVERSE_WHOLE");
  return text;
}
const FULL_GN_SHELL_TRANSPORT_INVERSE = {
  bytes: 289624,
  sha256: "e9ed9951089d9b44b1b614bb3b1d56be8c78fc8e026f714927fed3645fac04ea",
  rows: [
    {
      old: "",
      new: '  // c101 subprocess2 uses cmd on Windows; transport the unchanged body on one\n  // physical line, with safe whitespace forcing list2cmdline argument quoting.\n  const runnerTransport = `exec( bytes.fromhex(\'${Buffer.from(runner, "utf8").toString("hex")}\') )`;\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "f066cfd37df3fa678ea0c6ba91ea01fe2094788b4d7034ad6f583f54c8837e6a",
    },
    {
      old: "original=gclient_util.RunAction\n",
      new: "original=gclient_util.RunAction\nimport subprocess\n",
      oldSha256:
        "80746afb059fdab6f8dc4e2492328068d7df00960d31c2ca9f6102d227c15978",
      newSha256:
        "c74d004da81dec98663d5172d8e9fa8d00d9175f0acab1aea0f86fd0b2e70b80",
    },
    {
      old: "  command=[sys.executable,'-B','-c',${JSON.stringify(runner)},gn,expected,size,digest,*command[1:]]\n",
      new: "  command=[sys.executable,'-B','-c',${JSON.stringify(runnerTransport)},gn,expected,size,digest,*command[1:]]\n  if len(subprocess.list2cmdline(command))+64>8191:raise RuntimeError('FULL_GN_COMMAND_BOUND')\n",
      oldSha256:
        "807f7b4be8ed706024f6acdc96c83200653816fd6d4daefef6cf98d797fb1563",
      newSha256:
        "2b3565a2f7423a7586e9acc485d14a869754094a3b18b2358484c108817e9cfb",
    },
  ],
};
const FULL_GN_PROJECTION_DIGEST_INVERSE = {
  bytes: 290006,
  sha256: "27e6c073dab2b956c65aee7cd063e7114005077fe611fd99eb7a82326677e6e5",
  rows: [
    {
      old: "for name,digest in [('MergeDicts'",
      new: "for name,gn_projection_digest in [('MergeDicts'",
      oldSha256:
        "cb87b02fbb4713fb9afa918266b3267df97613761dbe9a572459fc33fee33421",
      newSha256:
        "67521573c8a1674cb8eec2f43ddf5794aa49f13d18a90640dc6234c1333411cf",
    },
    {
      old: "hashlib.sha256(inspect.getsource(function).encode('utf8')).hexdigest()!=digest:raise RuntimeError('FULL_GN_PROJECTION_FUNCTION')",
      new: "hashlib.sha256(inspect.getsource(function).encode('utf8')).hexdigest()!=gn_projection_digest:raise RuntimeError('FULL_GN_PROJECTION_FUNCTION')",
      oldSha256:
        "e19606c2c9ef51543d1b45fad14aedb8c19c16b137d784f1e5d4693530374774",
      newSha256:
        "e6b2f8527570716018b2f83f9e7fa8ef4f411190216b2d9195ca5949d253d04b",
    },
  ],
};
const FULL_HOOKS_3600_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
    rows: [
      {
        old: '"hooksSeconds": 2700',
        new: '"hooksSeconds": 3600',
        oldSha256:
          "e1295960e6724068f957bf7d2cc298f18a4e39d20890cb938f6c20d0281e8313",
        newSha256:
          "f9a082d2224b79d4b6491cc86260da7efddf5761901ab66889df6c2089aa06b7",
      },
    ],
  },
  driver: {
    bytes: 290034,
    sha256: "c204154a9a1ee9ad9fde6cb44d9a14c54d1491c60badcb8ebbb07497a07d104d",
    rows: [
      {
        old: 'stage === "source-hooks-gn" && maximumSeconds === 2700',
        new: 'stage === "source-hooks-gn" && maximumSeconds === 3600',
        oldSha256:
          "f1e3c9e04b5c87ef7e02a6e2f18edb8a19bf76f81df0a2d9be34cae004b0f6f7",
        newSha256:
          "ab823a3efa59ea09fcca8d67eb2f7891e3b4f87f4ef620eceeddfc8403e7942c",
      },
      {
        old: "limits.hooksSeconds === 2700",
        new: "limits.hooksSeconds === 3600",
        oldSha256:
          "ef03e51dc1df6a0932172ab6d4982193e7399b10ac1bef48a2454accfe78e8bc",
        newSha256:
          "2873474eb3737c287592c5194d69bfd530131c8730b801fc08a0b4ae499a4c82",
      },
      {
        old: 'await fullSourceStage(root, budget, "source-hooks-gn", 2700, async () => {',
        new: 'await fullSourceStage(root, budget, "source-hooks-gn", 3600, async () => {',
        oldSha256:
          "221b341a72b2425ff16bb9f2cd176d68be51a250860a3ca9d729c9d09242daca",
        newSha256:
          "a31f1d431befeb2772bcc32cbc2c4ce3fe591fdbee55f8de5f6f72f97b45a614",
      },
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "6188878262519d72bcfbcb121ca100a341eee0121093f0caab3216ecf4020038",
    rows: [
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
      {
        old: "# Node body debits data time and retains the fixed2700s hook cap.",
        new: "# Node body debits data time and retains the fixed3600s hook cap.",
        oldSha256:
          "ca05583192bd821c615365b66f9bc67bbf8e36a2adbf097993e1ff9ca8d739b0",
        newSha256:
          "d6b0d4f52a5048a17c2ac0f9989999b15c218583523903bfb94fb6e6636a965a",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "97cb6430200bee3880651d6b597d2ee4f4886dfe6377b484c900a4e727edc294",
    rows: [
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
    ],
  },
};
const FULL_GRAPH_SHAPE_HISTORY = {
  driver: {
    bytes: 297164,
    sha256: "19a14ac8024f8aa1f30c6df5906fea28a70a8163e6b1003beb0353454809fcc6",
    rows: [
      {
        old: "  qualificationShape(\n    action,\n    [\n",
        new: "  // Closed key set of the pinned GN150a9d6 src/gn/desc_builder.cc for an\n  // action: the core keys are always emitted, the role key is required by the\n  // reviewed policy, and the rest are emitted only when non-empty (the\n  // inherited public_configs/libs/... also appear, e.g. buildflags inherits a\n  // public config and the clang builtins lib through its public dep).\n  const gnCore = [\n",
        oldSha256:
          "60db788b61f9d2a1e270b9527c3dbba01d619065b92742807be54fd9a59db852",
        newSha256:
          "04784b6b4fc73fca6d5ca7acfb4e390c40c24aa546de3203f150acfb84e25dd8",
      },
      {
        old: '      "deps",\n      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),\n',
        new: '      "deps",\n',
        oldSha256:
          "15b3792b20ebeb1c8228a787a00296172b8420d8fea81201260dde65486e30e2",
        newSha256:
          "4c62f6037299260d2f14ca4a461f49c012e4d21c855a8486e965e0bfb4558759",
      },
      {
        old: '    "PRIVATE_GN_DESC_FIELDS",\n  );\n',
        new: '    gnRequired = [\n      ...gnCore,\n      role === "partitionAlloc" ? "response_file_contents" : "inputs",\n    ],\n    gnOptional = [\n      "data",\n      "sources",\n      "inputs",\n      "response_file_contents",\n      "depfile",\n      "output_name",\n      "output_dir",\n      "output_extension",\n      "gen_deps",\n      "validations",\n      "public_configs",\n      "all_dependent_configs",\n      "libs",\n      "lib_dirs",\n      "frameworks",\n      "weak_frameworks",\n      "weak_libraries",\n      "framework_dirs",\n    ];\n  const gnPlain =\n    action !== null &&\n    typeof action === "object" &&\n    !Array.isArray(action) &&\n    Object.getPrototypeOf(action) === Object.prototype;\n  if (\n    !gnPlain ||\n    !gnRequired.every((key) => Object.hasOwn(action, key)) ||\n    !Object.keys(action).every(\n      (key) => gnRequired.includes(key) || gnOptional.includes(key),\n    )\n  ) {\n    // Names and value types only, bounded; never values.\n    const failure = new Error("PRIVATE_GN_DESC_FIELDS");\n    failure.gnDescShape = gnPlain\n      ? Object.keys(action)\n          .slice(0, 64)\n          .map((key) => [\n            key.replace(/[^a-z0-9_]/g, "_").slice(0, 48),\n            action[key] === null\n              ? "null"\n              : Array.isArray(action[key])\n                ? "array"\n                : typeof action[key],\n          ])\n      : [];\n    throw failure;\n  }\n  for (const key of gnOptional)\n    if (Object.hasOwn(action, key))\n      need(\n        Array.isArray(action[key])\n          ? action[key].length <= 4096 &&\n              action[key].every(\n                (item) =>\n                  typeof item === "string" &&\n                  qualificationStringBound(item, 4096),\n              )\n          : typeof action[key] === "string" &&\n              qualificationStringBound(action[key], 4096),\n        "PRIVATE_GN_DESC_FIELDS",\n      );\n',
        oldSha256:
          "2b3ffec696ac3f114ed639094be49a81561a043d55f82f325e8c4c75651a2973",
        newSha256:
          "eb8260b105358b1ff3ece2975ec9f31cf8935e6505e83ef1441ace1920b0eeb7",
      },
      {
        old: "",
        new: '}\n// Observed GN desc action key names and value types only (bounded, no values).\nfunction fullGnDescDiagnostic(error) {\n  try {\n    if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n      return null;\n    const rows = fullGraphOwnValue(error, "gnDescShape");\n    if (!Array.isArray(rows) || rows.length > 64) return null;\n    const keys = [];\n    for (const row of rows) {\n      if (\n        !Array.isArray(row) ||\n        row.length !== 2 ||\n        typeof row[0] !== "string" ||\n        !/^[a-z0-9_]{1,48}$/.test(row[0]) ||\n        !["array", "string", "number", "boolean", "object", "null"].includes(\n          row[1],\n        )\n      )\n        return null;\n      keys.push([row[0], row[1]]);\n    }\n    return { kind: "windows-arm-source-gn-desc-shape", keys };\n  } catch {\n    return null;\n  }\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "13e226c3ded6e7978a4770842d14eb0d19b7b881e3c3b331b588b869cdf88ace",
      },
      {
        old: "",
        new: '    const gnDescDiagnostic =\n      failed && stage === "metadata-qualification"\n        ? fullGnDescDiagnostic(primary)\n        : null;\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "630a37f882334dba120c79073da8e79f8aa8bafef30380a99674d6a37f8c67cf",
      },
      {
        old: "",
        new: "      ...(gnDescDiagnostic ? { gnDescDiagnostic } : {}),\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "bfb08c042adca7e7b6e20c7b921b71ffb3b51f92547a2d76e4e3e13e1c22521e",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "62760e79a1076d07f3b8c00ebb26f631f9f0336bbb99b162a9dedc9f014e2c73",
    rows: [
      {
        old: "  parentMetadata_qualificationShape(\n    action,\n    [\n",
        new: "  // Closed key set of the pinned GN150a9d6 src/gn/desc_builder.cc for an\n  // action: the core keys are always emitted, the role key is required by the\n  // reviewed policy, and the rest are emitted only when non-empty (the\n  // inherited public_configs/libs/... also appear, e.g. buildflags inherits a\n  // public config and the clang builtins lib through its public dep).\n  const gnCore = [\n",
        oldSha256:
          "74ec9f82ff2b642045394e9b12bdaeeebadeceb72b54e6b8533d7f7463763738",
        newSha256:
          "04784b6b4fc73fca6d5ca7acfb4e390c40c24aa546de3203f150acfb84e25dd8",
      },
      {
        old: '      "deps",\n      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),\n',
        new: '      "deps",\n',
        oldSha256:
          "15b3792b20ebeb1c8228a787a00296172b8420d8fea81201260dde65486e30e2",
        newSha256:
          "4c62f6037299260d2f14ca4a461f49c012e4d21c855a8486e965e0bfb4558759",
      },
      {
        old: '    "PRIVATE_GN_DESC_FIELDS",\n  );\n',
        new: '    gnRequired = [\n      ...gnCore,\n      role === "partitionAlloc" ? "response_file_contents" : "inputs",\n    ],\n    gnOptional = [\n      "data",\n      "sources",\n      "inputs",\n      "response_file_contents",\n      "depfile",\n      "output_name",\n      "output_dir",\n      "output_extension",\n      "gen_deps",\n      "validations",\n      "public_configs",\n      "all_dependent_configs",\n      "libs",\n      "lib_dirs",\n      "frameworks",\n      "weak_frameworks",\n      "weak_libraries",\n      "framework_dirs",\n    ];\n  const gnPlain =\n    action !== null &&\n    typeof action === "object" &&\n    !Array.isArray(action) &&\n    Object.getPrototypeOf(action) === Object.prototype;\n  if (\n    !gnPlain ||\n    !gnRequired.every((key) => Object.hasOwn(action, key)) ||\n    !Object.keys(action).every(\n      (key) => gnRequired.includes(key) || gnOptional.includes(key),\n    )\n  ) {\n    // Names and value types only, bounded; never values.\n    const failure = new Error("PRIVATE_GN_DESC_FIELDS");\n    failure.gnDescShape = gnPlain\n      ? Object.keys(action)\n          .slice(0, 64)\n          .map((key) => [\n            key.replace(/[^a-z0-9_]/g, "_").slice(0, 48),\n            action[key] === null\n              ? "null"\n              : Array.isArray(action[key])\n                ? "array"\n                : typeof action[key],\n          ])\n      : [];\n    throw failure;\n  }\n  for (const key of gnOptional)\n    if (Object.hasOwn(action, key))\n      need(\n        Array.isArray(action[key])\n          ? action[key].length <= 4096 &&\n              action[key].every(\n                (item) =>\n                  typeof item === "string" &&\n                  parentMetadata_qualificationStringBound(item, 4096),\n              )\n          : typeof action[key] === "string" &&\n              parentMetadata_qualificationStringBound(action[key], 4096),\n        "PRIVATE_GN_DESC_FIELDS",\n      );\n',
        oldSha256:
          "2b3ffec696ac3f114ed639094be49a81561a043d55f82f325e8c4c75651a2973",
        newSha256:
          "41ae60b3f85c27d8a98d1bdcc5cc0ddaa01286be4bffdc65471ebde0b690f9d0",
      },
    ],
  },
};
function fullGraphShapeInverse(text, name) {
  const spec = FULL_GRAPH_SHAPE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_SHAPE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_SHAPE_WHOLE");
  return text;
}
const FULL_GRAPH_PATH_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2",
    rows: [
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
      {
        old: '  "metadataRecipeSha256": "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",\n',
        new: '  "metadataRecipeSha256": "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9",\n',
        oldSha256:
          "b0ef88f353d8e9fcfa993124a46dd862930f567836fee4fa2c9fc0e2e59890b8",
        newSha256:
          "fbd3be57898bb51552bab0d94d39d52f18c83d5561c6491fbed9c017aed6e223",
      },
    ],
  },
  driver: {
    bytes: 297164,
    sha256: "8ccbcf6ca6252e53bbd5e399521578c9665309c59120fdbf7380a3ffa6846850",
    rows: [
      {
        old: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        new: '  "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9";\n',
        oldSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
        newSha256:
          "91e9df48edca27254a67d45afe3654ea741d5d5f25381671373a76011f0ccc53",
      },
      {
        old: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        new: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        oldSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
        newSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "9f33c9695ab44d82fa38154f723a23e4ec61da2e9d5ef62e671e5a8d5563e8e9",
    rows: [
      {
        old: "PROFILE_SHA256 = '01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2'\n",
        new: "PROFILE_SHA256 = 'be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989'\n",
        oldSha256:
          "913451cc4e80d3aee1af4d27556b94f912ca4fbdf02e904b0094856d19be6a26",
        newSha256:
          "dc0050ef4c91357e662d8bf36a0c6508d03c5c8f547d66ad315e34ab17576b2e",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "6b26b4a0ac49b3ac16b5eda04098c39d2add168d99d106ca5f4e5fa72f98a0b4",
    rows: [
      {
        old: '    profile: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '    profile: "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "fb04d2d06d9b05e1856829ed5d047392836a657cf78bcecb3d323edec24e07be",
        newSha256:
          "7a4b48c068df36966d080ccd54963ef811afea526a5ffd2ee4ce54b5cdb2c9b2",
      },
      {
        old: '    profile: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '    profile: "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "85d1837fbce3019237bafe4ee930da1f784fff920d79299ac43fed76fc0284ea",
        newSha256:
          "cb1277140b776e89b1c8d1509f7ec286c62c32eaa6940f64e2e511431e212744",
      },
      {
        old: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        new: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        oldSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
        newSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
      },
      {
        old: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        new: '  "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9";\n',
        oldSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
        newSha256:
          "91e9df48edca27254a67d45afe3654ea741d5d5f25381671373a76011f0ccc53",
      },
    ],
  },
  producer: {
    bytes: 61403,
    sha256: "4643fd24aa78b607e698fd61663f18654c9b82abf755bc95da4bb68484b727b1",
    rows: [
      {
        old: "                    'sha256': '953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50',\n",
        new: "                    'sha256': 'e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05',\n",
        oldSha256:
          "8c82155f4ad72ec92aa25de8691a8f0cc5484d0409ade5128519c185c726f1ba",
        newSha256:
          "7e97d3d5ed4938715771575a4004f1cf3a5d77b41cc7e6d3ce9e10a7f250dd77",
      },
      {
        old: "                    'sha256': 'ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719',\n",
        new: "                    'sha256': '442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6',\n",
        oldSha256:
          "04a9c43d20ab002f500e2cfe55777269d36300b6e4f55e420ee409f1954c1d01",
        newSha256:
          "1250a67f483b0435f3e56b45d657c8f7535ef662cfbfac629bb26bc2aeca0f39",
      },
    ],
  },
  imageCurrent: {
    bytes: 34813,
    sha256: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",
    rows: [
      {
        old: '        "bytes": 195961,\n        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        new: '        "bytes": 196018,\n        "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2"\n',
        oldSha256:
          "44db50fc5f77ef0e9234680ede59f285fbd9344c9fd1d7eeb8eeb0859f6f3fb7",
        newSha256:
          "9331dc69c8aa53ab318120567a0f4d90040b4ed6760dbaf65e3429ce6f98ff15",
      },
      {
        old: '      "bytes": 195961,\n      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        new: '      "bytes": 196018,\n      "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",\n',
        oldSha256:
          "463fc86252bf42ff7786e6c99871c09cb4f1ea4274fc414a971badeced8d1932",
        newSha256:
          "78bc4392b6be991316efd8a7833e9043d11a132bf34b678c59726ba20b17ebd6",
      },
    ],
  },
  image20261021: {
    bytes: 35867,
    sha256: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",
    rows: [
      {
        old: '        "bytes": 195961,\n        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        new: '        "bytes": 196018,\n        "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2"\n',
        oldSha256:
          "44db50fc5f77ef0e9234680ede59f285fbd9344c9fd1d7eeb8eeb0859f6f3fb7",
        newSha256:
          "9331dc69c8aa53ab318120567a0f4d90040b4ed6760dbaf65e3429ce6f98ff15",
      },
      {
        old: '      "bytes": 195961,\n      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        new: '      "bytes": 196018,\n      "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",\n',
        oldSha256:
          "463fc86252bf42ff7786e6c99871c09cb4f1ea4274fc414a971badeced8d1932",
        newSha256:
          "78bc4392b6be991316efd8a7833e9043d11a132bf34b678c59726ba20b17ebd6",
      },
    ],
  },
  engineProfile: {
    bytes: 8903,
    sha256: "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",
    rows: [
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
    ],
  },
  privateProfile: {
    bytes: 22347,
    sha256: "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",
    rows: [
      {
        old: '  "baseCandidatePolicySha256": "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",\n',
        new: '  "baseCandidatePolicySha256": "9df48c9f1bfded6b7e9953aca9cc58ba5ada24ac0d70d25481b998bdfd80e7f5",\n',
        oldSha256:
          "de8999c3bad8e832f9f292e8361c65f6b0a1550f1d9da242c24eec3b160ace5c",
        newSha256:
          "8331b308187a0234b12e0200115b21e5132db20363889471c7ab09716f11e990",
      },
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
    ],
  },
  mirror: {
    bytes: 195961,
    sha256: "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",
    rows: [
      {
        old: "      candidates.push({ file, path: path.relative(root, file), metadata });\n",
        new: '      candidates.push({\n        file,\n        path: path.relative(root, file).split(path.sep).join("/"),\n        metadata,\n      });\n',
        oldSha256:
          "001ced507d2d3863d5e44a0a0bf10ddf4d23e0345255cb2a0377018df5f8ea2b",
        newSha256:
          "e9d92ab9f06e100c6bbc336393e43075e17407b9b254cf009f84b39b343e3648",
      },
    ],
  },
};
function fullGraphPathInverse(text, name) {
  text = fullGraphShapeInverse(text, name);
  const spec = FULL_GRAPH_PATH_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_PATH_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_PATH_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_PATH_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_PATH_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_PATH_WHOLE");
  return text;
}
const FULL_GRAPH_DEADLINE_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
    rows: [
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
      {
        old: '  "metadataRecipeSha256": "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",\n',
        new: '  "metadataRecipeSha256": "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",\n',
        oldSha256:
          "92ec62219f370c19a862ed1a69f28bea159078be990b9f421a1b59b36dc410a0",
        newSha256:
          "b0ef88f353d8e9fcfa993124a46dd862930f567836fee4fa2c9fc0e2e59890b8",
      },
    ],
  },
  driver: {
    bytes: 297164,
    sha256: "c8fb2c5d78dd9a38b015ba8e2c6e0d05e3f43c54da7f4848ce1bc4303af2d883",
    rows: [
      {
        old: '  "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052";\n',
        new: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        oldSha256:
          "2db5d8287d4c0f1b597da122f5d45f2d43dc637024b423f797dcf004bcc6e6c4",
        newSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
      },
      {
        old: "                Math.floor(Math.min(180000, state.end - performance.now())),\n",
        new: "                Math.floor(Math.min(900000, state.end - performance.now())),\n",
        oldSha256:
          "27ce0306ae1b6c93a31e647289e1245b785bde95e37eeac5d049bc2eb73e6476",
        newSha256:
          "c97fbb60c3981e3a359ad412fb45e14b027b179ef89408f428237709bc665159",
      },
      {
        old: "              1,\n              Math.floor(Math.min(180000, state.end - performance.now())),\n",
        new: "              1,\n              Math.floor(Math.min(900000, state.end - performance.now())),\n",
        oldSha256:
          "6ca640f847991ecf3d38b7255b2748db86c972a80b226101a4de751d37ac7770",
        newSha256:
          "eb65d76f99d5fc62ad2d87053255332fd56497024d472468cce4ca8287736501",
      },
      {
        old: '  "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332";\n',
        new: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        oldSha256:
          "c25dd24b51eff5245ab7dccd1eee3e195e2f1f5b301106d8e1c3dd1091501412",
        newSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
      },
      {
        old: "    elapsedMs > 180000\n",
        new: "    elapsedMs > 900000\n",
        oldSha256:
          "5e488a917f8f1d5ba65966bb601deab1db175d59890081c1b54347a5c878fd88",
        newSha256:
          "45192cdaab2e7fd6d291e578549a9125482f58931a7b9b35dbba2eca22e04d52",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "277fda994b94cec4de45331305104ae90a212e1ded739d7611116b3dbbfa16df",
    rows: [
      {
        old: "PROFILE_SHA256 = '2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332'\n",
        new: "PROFILE_SHA256 = '01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2'\n",
        oldSha256:
          "6f768c881308c6ee74744bfd648606a698d75efc300693d41458bb6032564ddc",
        newSha256:
          "913451cc4e80d3aee1af4d27556b94f912ca4fbdf02e904b0094856d19be6a26",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "74d50ee77552237fbc390d7e96fbbc695bdea883af2b0fcf02e393edafebfeb3",
    rows: [
      {
        old: '    profile: "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '    profile: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "6aad45f7a13f68438c22258fdb4aa2c91a402dfdceeac15916ea728044a7883c",
        newSha256:
          "fb04d2d06d9b05e1856829ed5d047392836a657cf78bcecb3d323edec24e07be",
      },
      {
        old: '    profile: "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '    profile: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "de5a32ece35acccfce8723e3e296d44fab1c4bcf5d65f4e572b0527f5f982e6a",
        newSha256:
          "85d1837fbce3019237bafe4ee930da1f784fff920d79299ac43fed76fc0284ea",
      },
      {
        old: '  "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332";\n',
        new: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        oldSha256:
          "c25dd24b51eff5245ab7dccd1eee3e195e2f1f5b301106d8e1c3dd1091501412",
        newSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
      },
      {
        old: '  "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052";\n',
        new: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        oldSha256:
          "2db5d8287d4c0f1b597da122f5d45f2d43dc637024b423f797dcf004bcc6e6c4",
        newSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
      },
      {
        old: "            Math.floor(Math.min(180000, checkLease(state.lease))),\n",
        new: "            Math.floor(Math.min(900000, checkLease(state.lease))),\n",
        oldSha256:
          "3fd7036e35ce5ede092abe0a7e8013fa6a1aa22c7557eacd480a5ebdd6d1053c",
        newSha256:
          "7c1e4cadb7e5f0b8ab018cd6538a26b5892003062687cc10cabcea2467758ac8",
      },
    ],
  },
  producer: {
    bytes: 61403,
    sha256: "870857c0f46283ff23238a239249a9a9b672a6995cc2de134fc79507560ec01f",
    rows: [
      {
        old: "                    'sha256': '55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041',\n",
        new: "                    'sha256': '953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50',\n",
        oldSha256:
          "7ca3858a9945354478fbadc4aeb7e88bf876935ebcf59ad74689f8c18e3cd75b",
        newSha256:
          "8c82155f4ad72ec92aa25de8691a8f0cc5484d0409ade5128519c185c726f1ba",
      },
      {
        old: "                    'sha256': '3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637',\n",
        new: "                    'sha256': 'ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719',\n",
        oldSha256:
          "62c637cb53b0cb3b51504f316ed6a8bc54d5e9052499ccf67eb6bae4c91d8f85",
        newSha256:
          "04a9c43d20ab002f500e2cfe55777269d36300b6e4f55e420ee409f1954c1d01",
      },
    ],
  },
  imageCurrent: {
    bytes: 34813,
    sha256: "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",
    rows: [
      {
        old: '        "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f"\n',
        new: '        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        oldSha256:
          "c4897e44d8b465913974cfed470766b84e463a1980556b4d74bd3ce75be5cffa",
        newSha256:
          "ad01cda05689e1ad02b6d286925ae775efa398ad842438f811439861455736e4",
      },
      {
        old: '      "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",\n',
        new: '      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        oldSha256:
          "219dfdc18c0997fac6912891bf0079adf363316b0352e0655686f2b7eab473f5",
        newSha256:
          "6279953bea63295575c7ded6c6517cade3d88a23fa72990b6f6f699bb5095002",
      },
    ],
  },
  image20261021: {
    bytes: 35867,
    sha256: "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
    rows: [
      {
        old: '        "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f"\n',
        new: '        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        oldSha256:
          "c4897e44d8b465913974cfed470766b84e463a1980556b4d74bd3ce75be5cffa",
        newSha256:
          "ad01cda05689e1ad02b6d286925ae775efa398ad842438f811439861455736e4",
      },
      {
        old: '      "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",\n',
        new: '      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        oldSha256:
          "219dfdc18c0997fac6912891bf0079adf363316b0352e0655686f2b7eab473f5",
        newSha256:
          "6279953bea63295575c7ded6c6517cade3d88a23fa72990b6f6f699bb5095002",
      },
    ],
  },
  engineProfile: {
    bytes: 8903,
    sha256: "a49d50f77ab89e9e15e18de99946e757b1478ea306dfc58c1bc6a8379a46d18f",
    rows: [
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
    ],
  },
  privateProfile: {
    bytes: 22347,
    sha256: "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",
    rows: [
      {
        old: '  "baseCandidatePolicySha256": "a49d50f77ab89e9e15e18de99946e757b1478ea306dfc58c1bc6a8379a46d18f",\n',
        new: '  "baseCandidatePolicySha256": "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",\n',
        oldSha256:
          "f6e84d9777c9203aa37b3306b23d0190a042490bc2af1a58e7663ff8ff66825f",
        newSha256:
          "de8999c3bad8e832f9f292e8361c65f6b0a1550f1d9da242c24eec3b160ace5c",
      },
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
    ],
  },
  mirror: {
    bytes: 195961,
    sha256: "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",
    rows: [
      {
        old: "  milliseconds: 180000,\n",
        new: "  milliseconds: 900000,\n",
        oldSha256:
          "e581dd0c4c13980fb976d093bf2ff7f1617ae8e9e09378f269fc74d2e373e952",
        newSha256:
          "24cdda4fecbe121c497c35ce7cf388c841b95b5eb7e6ebd458082237913e3024",
      },
    ],
  },
};
function fullGraphDeadlineInverse(text, name) {
  text = fullGraphPathInverse(text, name);
  const spec = FULL_GRAPH_DEADLINE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_DEADLINE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_DEADLINE_WHOLE");
  return text;
}
const FULL_GRAPH_DIAGNOSTICS_HISTORY = {
  bytes: 290034,
  sha256: "8f6ccea24cf9104e61ab26999dbec23a9fc90c346c018e8501252d68446b75c0",
  rows: [
    {
      old: "",
      new: "              ...fullGraphInventoryObserver(owner),\n",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "530c81351ac020444f04500e5c98f80612f84f58bfb00b1b06816ce05b24f482",
    },
    {
      old: "",
      new: '// BEGIN FULL GRAPH FAILURE OBSERVATIONS\n// Closed DATA only. The original graph helper, owner and every limit are unchanged.\nconst fullGraphObservations = new WeakMap();\nfunction fullGraphOwnValue(value, key) {\n  if (!value || typeof value !== "object" || utilTypes.isProxy(value))\n    return undefined;\n  const field = Object.getOwnPropertyDescriptor(value, key);\n  return field && Object.hasOwn(field, "value") ? field.value : undefined;\n}\nfunction fullGraphCounts(value) {\n  const files = fullGraphOwnValue(value, "files"),\n    bytes = fullGraphOwnValue(value, "bytes"),\n    visited = fullGraphOwnValue(value, "visited");\n  return Number.isSafeInteger(files) &&\n    files >= 0 &&\n    files <= 50001 &&\n    Number.isSafeInteger(bytes) &&\n    bytes >= 0 &&\n    bytes <= 50001 * 256 * 1024 ** 2 &&\n    Number.isSafeInteger(visited) &&\n    visited >= 0 &&\n    visited <= 300001\n    ? { files, bytes, visited }\n    : null;\n}\nfunction fullGraphProgress(value) {\n  const counts = fullGraphCounts(value),\n    phase = fullGraphOwnValue(value, "phase"),\n    active = fullGraphOwnValue(value, "active"),\n    completedHashedFiles = fullGraphOwnValue(value, "completedHashedFiles"),\n    completedHashedBytes = fullGraphOwnValue(value, "completedHashedBytes"),\n    elapsedMs = fullGraphOwnValue(value, "elapsedMs");\n  if (\n    !counts ||\n    !["metadata", "hashing", "complete", "stopped"].includes(phase) ||\n    !Number.isSafeInteger(active) ||\n    active < 0 ||\n    active > 4 ||\n    !Number.isSafeInteger(completedHashedFiles) ||\n    completedHashedFiles < 0 ||\n    completedHashedFiles > counts.files ||\n    !Number.isSafeInteger(completedHashedBytes) ||\n    completedHashedBytes < 0 ||\n    completedHashedBytes > counts.bytes ||\n    !Number.isSafeInteger(elapsedMs) ||\n    elapsedMs < 0 ||\n    elapsedMs > 180000\n  )\n    return null;\n  const supplied = fullGraphOwnValue(value, "categories"),\n    categories = {};\n  let files = 0,\n    bytes = 0;\n  for (const name of ["args", "build", "toolchain", "target"]) {\n    const row = fullGraphOwnValue(supplied, name),\n      count = fullGraphOwnValue(row, "files"),\n      size = fullGraphOwnValue(row, "bytes");\n    if (\n      !Number.isSafeInteger(count) ||\n      count < 0 ||\n      count > counts.files ||\n      !Number.isSafeInteger(size) ||\n      size < 0 ||\n      size > counts.bytes\n    )\n      return null;\n    categories[name] = Object.freeze({ files: count, bytes: size });\n    files += count;\n    bytes += size;\n  }\n  if (files !== counts.files || bytes !== counts.bytes) return null;\n  return Object.freeze({\n    phase,\n    ...counts,\n    active,\n    completedHashedFiles,\n    completedHashedBytes,\n    elapsedMs,\n    categories: Object.freeze(categories),\n  });\n}\nfunction fullGraphInventoryObserver(owner) {\n  const observation = fullGraphObservations.get(owner);\n  if (!observation) return {};\n  return {\n    observe(value) {\n      try {\n        if (\n          observation.closed ||\n          observation.state.retired ||\n          observation.state.epoch !== observation.epoch\n        )\n          return;\n        if (observation.progress.length >= 36) {\n          observation.discardedSamples = Math.min(\n            36,\n            observation.discardedSamples + 1,\n          );\n          return;\n        }\n        const sample = fullGraphProgress(value);\n        if (sample) observation.progress.push(sample);\n        else\n          observation.discardedSamples = Math.min(\n            36,\n            observation.discardedSamples + 1,\n          );\n      } catch {\n        // No diagnostic failure may retire an owner or replace the original cause.\n      }\n    },\n  };\n}\nfunction collectFullQualificationGraph(owner) {\n  const { state } = fullMetadataOwner(owner);\n  need(!fullGraphObservations.has(owner), "FULL_GRAPH_OBSERVATION_REPEAT");\n  const observation = {\n    state,\n    epoch: state.epoch,\n    progress: [],\n    discardedSamples: 0,\n    closed: false,\n  };\n  fullGraphObservations.set(owner, observation);\n  const pending = collectQualificationGraph(owner);\n  // Observe settlement without adding a new promise/adoption boundary.\n  void pending.then(\n    () => {\n      observation.closed = true;\n    },\n    () => {\n      observation.closed = true;\n    },\n  );\n  return pending;\n}\nfunction fullGraphFailureClassification(error) {\n  if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n    return { code: "UNKNOWN" };\n  const code = fullGraphOwnValue(error, "code");\n  if (code === "GRAPH_BOUND") {\n    const counts = fullGraphCounts(fullGraphOwnValue(error, "graphCounts"));\n    return { code: "GRAPH_BOUND", ...(counts ? { graphCounts: counts } : {}) };\n  }\n  if (\n    [\n      "ENOENT",\n      "EACCES",\n      "EPERM",\n      "EIO",\n      "EMFILE",\n      "ENFILE",\n      "ENOMEM",\n      "ENOSPC",\n      "ENOTDIR",\n      "EISDIR",\n      "ELOOP",\n      "EINVAL",\n      "EBADF",\n      "EBUSY",\n      "ETIMEDOUT",\n      "ENAMETOOLONG",\n      "EROFS",\n      "ENODEV",\n      "ECANCELED",\n      "ABORT_ERR",\n    ].includes(code)\n  )\n    return { code: "GRAPH_FS_ERROR", errno: code };\n  const known = new Map([\n    ["Invalid graph deadline", "GRAPH_INVALID_DEADLINE"],\n    ["Invalid graph inventory counters", "GRAPH_INVALID_COUNTERS"],\n    ["Checkpoint asset size", "GRAPH_ASSET_SIZE"],\n    ["Checkpoint asset changed", "GRAPH_ASSET_CHANGED"],\n    ["Fresh complete GN graph required", "GRAPH_INCOMPLETE"],\n    ["Complete graph pins required", "GRAPH_INCOMPLETE_PINS"],\n    ["Checkpoint links are not admitted", "GRAPH_LINK_REJECTED"],\n    ["Checkpoint path alias", "GRAPH_PATH_ALIAS"],\n    ["Invalid checkpoint object shape", "GRAPH_INVALID_PIN_SHAPE"],\n    ["Bounded graph pin count", "GRAPH_INVALID_PIN_COUNT"],\n    ["Bounded graph pin bytes", "GRAPH_INVALID_PIN_BYTES"],\n    ["Canonical relative graph pin", "GRAPH_INVALID_PIN_PATH"],\n    ["Declared graph pin kind", "GRAPH_INVALID_PIN_KIND"],\n    ["Bounded graph pin size", "GRAPH_INVALID_PIN_SIZE"],\n    ["Graph pin snapshot byte bound", "GRAPH_PIN_SNAPSHOT_BOUND"],\n    ["Complete graph snapshot digest", "GRAPH_PIN_SNAPSHOT_DIGEST"],\n  ]);\n  return { code: known.get(fullSourceErrorMessage(error)) ?? "UNKNOWN" };\n}\nfunction fullSourceGraphDiagnostic(owner, error) {\n  try {\n    const observation = fullGraphObservations.get(owner);\n    if (\n      !observation ||\n      !observation.closed ||\n      observation.state !== qualificationSourceOwners.get(owner)\n    )\n      return null;\n    const diagnostic = {\n      kind: "windows-arm-source-graph-failure",\n      phase: "graph-inventory",\n      progress: observation.progress.slice(),\n      discardedSamples: observation.discardedSamples,\n    };\n    return { ...diagnostic, ...fullGraphFailureClassification(error) };\n  } catch {\n    return null;\n  }\n}\n// END FULL GRAPH FAILURE OBSERVATIONS\n\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "70d60ee5d3dc3daa87e22ae0f466473bc944d29270dfb6bf993359564aa881d5",
    },
    {
      old: "      const capture = await collectQualificationGraph(qualificationOwner);\n",
      new: "      const capture = await collectFullQualificationGraph(qualificationOwner);\n",
      oldSha256:
        "8202e9fc8dd602f87c591d928af0e22e7a217086397b60ac42a4ad72846faa8c",
      newSha256:
        "1a8da4463c12c6b382a0d15794e33a8684191bfc292fc598a47854735d47259e",
    },
    {
      old: "",
      new: '    const graphDiagnostic =\n      failed && stage === "graph-inventory"\n        ? fullSourceGraphDiagnostic(qualificationOwner, primary)\n        : null;\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "4b9c8848aba05bd15c932be88c07b43af27e323bdf6dd9ff72d6f56b851d678c",
    },
    {
      old: '      message !== null &&\n      /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(message)\n        ? message\n        : failed\n          ? "FULL_SOURCE_FAILED"\n          : null;\n',
      new: '      graphDiagnostic?.code === "GRAPH_BOUND"\n        ? "GRAPH_BOUND"\n        : message !== null &&\n            /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(message)\n          ? message\n          : failed\n            ? "FULL_SOURCE_FAILED"\n            : null;\n',
      oldSha256:
        "5637d3e3263ca30a0b01b2dd972548930c0bbca034f36851ad458f8694734373",
      newSha256:
        "126a41b375c181fcd2fef86e2ddd52941ea8fa82e545a9e90e702388633eb5ec",
    },
    {
      old: "",
      new: "      ...(graphDiagnostic ? { graphDiagnostic } : {}),\n",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "9ec1d7264fe3d84caa1bc963407aefaa80ff503490d6dc047505c40be670df0d",
    },
  ],
};
function fullGraphDiagnosticsInverse(text, name) {
  return fullGraphDiagnosticsInverseFrom(
    fullGraphDeadlineInverse(text, name),
    name,
  );
}
function fullGraphDiagnosticsInverseFrom(text, name) {
  if (name !== "driver") return text;
  const spec = FULL_GRAPH_DIAGNOSTICS_HISTORY;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_WHOLE",
  );
  assert.equal(
    sha(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_WHOLE",
  );
  return text;
}

function fullHooks3600Inverse(text, name) {
  return fullHooks3600InverseFrom(
    fullGraphDiagnosticsInverse(text, name),
    name,
  );
}
function fullHooks3600InverseFrom(text, name) {
  const spec = FULL_HOOKS_3600_HISTORY[name];
  if (!spec) return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(
      hash(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_HOOKS_3600_PIN",
    );
    assert.equal(
      hash(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_HOOKS_3600_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_HOOKS_3600_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_HOOKS_3600_WHOLE",
  );
  assert.equal(hash(text), spec.sha256, "ASSEMBLY_INVERSE_HOOKS_3600_WHOLE");
  return text;
}
function fullGnProjectionDigestInverse(text, name) {
  text = fullHooks3600Inverse(text, name);
  if (name !== "driver") return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of FULL_GN_PROJECTION_DIGEST_INVERSE.rows) {
    assert.equal(
      hash(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GN_DIGEST_PIN",
    );
    assert.equal(
      hash(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GN_DIGEST_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GN_DIGEST_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    FULL_GN_PROJECTION_DIGEST_INVERSE.bytes,
    "ASSEMBLY_INVERSE_GN_DIGEST_WHOLE",
  );
  assert.equal(
    hash(text),
    FULL_GN_PROJECTION_DIGEST_INVERSE.sha256,
    "ASSEMBLY_INVERSE_GN_DIGEST_WHOLE",
  );
  return text;
}
function fullGnShellTransportInverse(text, name) {
  text = fullGnProjectionDigestInverse(text, name);
  if (name !== "driver") return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of FULL_GN_SHELL_TRANSPORT_INVERSE.rows) {
    assert.equal(hash(row.new), row.newSha256);
    assert.equal(hash(row.old), row.oldSha256);
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GN_TRANSPORT_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    FULL_GN_SHELL_TRANSPORT_INVERSE.bytes,
    "ASSEMBLY_INVERSE_GN_TRANSPORT_WHOLE",
  );
  assert.equal(
    hash(text),
    FULL_GN_SHELL_TRANSPORT_INVERSE.sha256,
    "ASSEMBLY_INVERSE_GN_TRANSPORT_WHOLE",
  );
  return text;
}
function fullBootstrapCacheInverse(text, name) {
  text = fullGnShellTransportInverse(text, name);
  text = fullSourceEnvironmentInverse(text, name);
  return fullBootstrapCacheBaselineInverse(text, name);
}
function fullBootstrapCacheBaselineInverse(text, name) {
  if (name === "workflow") return text; // This repair never changes workflow bytes.
  const spec = FULL_BOOTSTRAP_CACHE_HISTORY[name];
  assert(spec, "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_SCOPE");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_COUNT",
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_BYTES",
  );
  assert.equal(
    hash(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_WHOLE",
  );
  return text;
}
// END EXACT FULL BOOTSTRAP CACHE INVERSE

function sourceAcquisitionInverse(text, name) {
  return sourceAcquisitionBaselineInverse(
    fullBootstrapCacheInverse(text, name),
    name,
  );
}
function sourceAcquisitionBaselineInverse(text, name) {
  const spec = SOURCE_ACQUISITION_HISTORY[name];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_COUNT",
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_BYTES",
  );
  assert.equal(
    hash(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_WHOLE",
  );
  return text;
}
// END EXACT FULL SOURCE ACQUISITION INVERSE

function sourceFailureControllerInverse(text) {
  text = sourceAcquisitionInverse(text, "controller");
  const spec = SOURCE_FAILURE_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT SOURCE FAILURE DATA INVERSE

function sourceParentControllerInverse(text) {
  text = sourceFailureControllerInverse(text);
  const spec = SOURCE_PARENT_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT SOURCE PARENT INVERSE

function producerMetricControllerInverse(text) {
  text = sourceParentControllerInverse(text);
  const spec = PRODUCER_METRIC_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...spec.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}

function clockFailureControllerInverse(text) {
  text = producerMetricControllerInverse(text);
  const spec = CLOCK_FAILURE_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(spec.block), spec.blockSha256);
  assert.equal(text.split(spec.block).length, 2);
  assert.equal(text.split(spec.newPredicate).length, 2);
  text = text
    .replace(spec.block, "")
    .replace(spec.newPredicate, spec.oldPredicate);
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT CLOCK FAILURE ENUM INVERSE

// BEGIN EXACT STARTUP OBSERVABILITY INVERSE
const STARTUP_OBSERVABILITY_HISTORY = {
  rows: [
    {
      oldRaw:
        '  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n',
      newRaw:
        '  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\n// BEGIN BOUNDED STARTUP OBSERVABILITY\n// Diagnostic DATA only. No path/message/env/stack or capability is serialized.\nconst startupErrorContexts = new WeakMap();\nconst STARTUP_FILE_KINDS = Object.freeze({\n  initial: "none",\n  profile: "profile",\n  policy: "policy",\n  workflow: "workflow",\n  scope: "none",\n  node: "node",\n  python: "python",\n  "workflow-clock": "clock",\n  "parent-clock": "clock",\n  "root-module": "root-module",\n  "source-root": "source-root",\n  "source-input": "producer-input",\n  "source-context": "context",\n  "source-launch": "launcher",\n});\nconst STARTUP_ERROR_CODES = new Set([\n  "ENOENT",\n  "EACCES",\n  "EPERM",\n  "ENOTDIR",\n  "EISDIR",\n  "ELOOP",\n  "EMFILE",\n  "ENFILE",\n  "EBADF",\n  "EIO",\n  "EINVAL",\n  "ENOSPC",\n  "ERR_INVALID_ARG_TYPE",\n  "ERR_INVALID_ARG_VALUE",\n  "ERR_ACCESS_DENIED",\n]);\nconst STARTUP_SYSCALLS = new Set([\n  "open",\n  "lstat",\n  "stat",\n  "realpath",\n  "read",\n  "write",\n  "close",\n  "spawn",\n]);\nfunction observeStartupPhase(bootstrap, phase) {\n  const owner = bootstrapOwners.get(bootstrap);\n  need(owner && !owner.closed && owner.pid === process.pid, "BOOTSTRAP_BRAND");\n  need(Object.hasOwn(STARTUP_FILE_KINDS, phase), "BOOTSTRAP_PHASE");\n  owner.startupPhase = phase;\n}\nfunction captureStartupFailure(bootstrap, error) {\n  const owner = bootstrapOwners.get(bootstrap);\n  if (\n    !owner ||\n    owner.closed ||\n    owner.pid !== process.pid ||\n    utilTypes.isProxy(error) ||\n    !utilTypes.isNativeError(error) ||\n    startupErrorContexts.has(error)\n  )\n    return;\n  const phase = Object.hasOwn(STARTUP_FILE_KINDS, owner.startupPhase)\n    ? owner.startupPhase\n    : "initial";\n  startupErrorContexts.set(\n    error,\n    Object.freeze({ phase, fileKind: STARTUP_FILE_KINDS[phase] }),\n  );\n}\nfunction startupFailureReport(error) {\n  const native = !utilTypes.isProxy(error) && utilTypes.isNativeError(error);\n  const own = (key) =>\n    native ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;\n  const message = own("message");\n  const code =\n    typeof message === "string" &&\n    /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message)\n      ? message\n      : "FULL_SDK_CONTROL_FAILED";\n  let name = native ? "NativeError" : "ThrownValue";\n  if (native) {\n    const prototype = Object.getPrototypeOf(error);\n    for (const type of [\n      Error,\n      TypeError,\n      RangeError,\n      SyntaxError,\n      ReferenceError,\n      EvalError,\n      URIError,\n      AggregateError,\n    ])\n      if (prototype === type.prototype) name = type.name;\n  }\n  const diagnostic = {\n    ...((native ? startupErrorContexts.get(error) : undefined) ?? {\n      phase: "unknown",\n      fileKind: "none",\n    }),\n    name,\n  };\n  if (STARTUP_ERROR_CODES.has(own("code"))) diagnostic.code = own("code");\n  if (STARTUP_SYSCALLS.has(own("syscall"))) diagnostic.syscall = own("syscall");\n  return {\n    kind: "windows-arm-full-sdk-failure",\n    error: code,\n    diagnostic,\n    sdkBuilt: false,\n    nativeAcceptance: false,\n  };\n}\n// END BOUNDED STARTUP OBSERVABILITY\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  observeStartupPhase(bootstrap, "profile");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n',
      oldSha256:
        "b5669efdc9aa73d7d72b448e2d4274ec726170371ce18bd23deaf6121454fb9b",
      newSha256:
        "289a9cd9d16840dea9063266210737478507f0fb38079a7f2f70120ebccf0993",
    },
    {
      oldRaw:
        '  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n',
      newRaw:
        '  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  observeStartupPhase(bootstrap, "policy");\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n',
      oldSha256:
        "25023aececc507c239b67764e64ce9471aad02cad59548d54c23b776d990f66b",
      newSha256:
        "372513cdd4fa282ee8e6c530b045103dfad25f2a77747055ba6241f3bcb95e51",
    },
    {
      oldRaw:
        '    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n',
      newRaw:
        '    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  observeStartupPhase(bootstrap, "workflow");\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  observeStartupPhase(bootstrap, "scope");\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n',
      oldSha256:
        "a8d81a50a42c5180a48b6805f9dbeac74ea95b5a5e010335416061bfb790df2f",
      newSha256:
        "0e21a50f0ad5903b4f455e25246b4e4e1a9067c36b24a65af6608f400ade1b73",
    },
    {
      oldRaw:
        '    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n',
      newRaw:
        '    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  observeStartupPhase(bootstrap, "node");\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n',
      oldSha256:
        "2d31bf72ace606e3037cdda992674f899387738e55a7ba560f91e8301b55c8fe",
      newSha256:
        "7bd09df0695dc0442613d0cc3b8185c6ed081ebdb1ce176f16058e01506a6eea",
    },
    {
      oldRaw:
        '      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n',
      newRaw:
        '      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  observeStartupPhase(bootstrap, "python");\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n',
      oldSha256:
        "5ec854098dafcd7a34c3e11c05d4eccc473a3ec4afde7096e45b23bb6be2f73d",
      newSha256:
        "79683a7d9012e6cce6fd3dd73b0979f88e9e6604fd1b0b58f61cbb58e2570d4e",
    },
    {
      oldRaw:
        '  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n',
      newRaw:
        '  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  observeStartupPhase(bootstrap, "workflow-clock");\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n',
      oldSha256:
        "d7e588ddc913615bb313f88abfa027a9b67adf0084580a48bf9b5b80596b5e13",
      newSha256:
        "cbd3bf1edf4212950008304311a9b806b4fd8090f30379ed154b27cdcc12423c",
    },
    {
      oldRaw:
        "  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n",
      newRaw:
        '  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  observeStartupPhase(bootstrap, "parent-clock");\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n',
      oldSha256:
        "227f88f5e36a5f4648800b63ed53b47f3aff5c3e94a9052c0440903a5bae19c4",
      newSha256:
        "bd203f0add9cdc599870abf05898271a179e8b4e16507bc1a005971ad3969e7a",
    },
    {
      oldRaw:
        '  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n',
      newRaw:
        '  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  observeStartupPhase(bootstrap, "root-module");\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n',
      oldSha256:
        "e0c72a53dfa04f812f6ecd38811146e9ef212024ab4d38e4b1bab7096a51796b",
      newSha256:
        "2e0c150c9d2028d441c602849115a56ddd5eee5f4dc47fa23ef05868d3939172",
    },
    {
      oldRaw:
        '        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n',
      newRaw:
        '        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  observeStartupPhase(bootstrap, "source-root");\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n',
      oldSha256:
        "0bd0a1f8a17e82c7ff3b31ea66ad4c11c76ccbb9794cf91aee794937db9f4914",
      newSha256:
        "8f0b49f7a52c1aef8417665608f0f3793fc7f9c91c0509a4baf7a99f7b40a3c7",
    },
    {
      oldRaw:
        '        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n',
      newRaw:
        '        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      observeStartupPhase(bootstrap, "source-input");\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n',
      oldSha256:
        "04b7c2c970dba576879c5e8f7db429aaddeb5e9e847063d9a74468e7869df1ae",
      newSha256:
        "feaaf3b5a77e2515cdf5f4977dfc49d97caea5df60b441e93b6680c207a7fc1a",
    },
    {
      oldRaw:
        '        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n',
      newRaw:
        '        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    observeStartupPhase(bootstrap, "source-context");\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n',
      oldSha256:
        "a962286d0ab38b357c9126348cafba92a906c5c15a375cb79f3247f0ded55606",
      newSha256:
        "fefdec8264096b94411fc8368d3f69829298e2c585226dd3de5a6d8779ec289f",
    },
    {
      oldRaw:
        '    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n',
      newRaw:
        '    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    observeStartupPhase(bootstrap, "source-launch");\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n',
      oldSha256:
        "44d762a02933a6163361065e979b10d5901489563d3f9eb40dc81fe0356168ab",
      newSha256:
        "54f03cccc3dd4c89512c63d1fe805231c37ad368d33b6c7f7075d5e9069a19b5",
    },
    {
      oldRaw:
        '      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n',
      newRaw:
        '      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    captureStartupFailure(bootstrap, error);\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n',
      oldSha256:
        "58f2f5eee1725e7b0235090d8faf3f3372ad03f3a36cd8a629589428ca98db21",
      newSha256:
        "7adbc66c1bffeaf92d426485814d0a8099532c6ef0ee1b13efbcac06809c656c",
    },
    {
      oldRaw:
        '        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n',
      newRaw:
        '        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    captureStartupFailure(bootstrap, error);\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n',
      oldSha256:
        "1235478ea088c3230edadc8645fcd0f27863b41045926a4ef6e20e2ea0fb80f8",
      newSha256:
        "f490deea9e9da663e2751bed1447fcf99f8475f97d95c158f33c80a411ef04d5",
    },
    {
      oldRaw:
        '  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      const code = /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(error?.message ?? "")\n        ? error.message\n        : "FULL_SDK_CONTROL_FAILED";\n      console.error(\n        JSON.stringify({\n          kind: "windows-arm-full-sdk-failure",\n          error: code,\n          sdkBuilt: false,\n          nativeAcceptance: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n',
      newRaw:
        "  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      console.error(JSON.stringify(startupFailureReport(error)));\n      process.exitCode = 1;\n    });\n}\n",
      oldSha256:
        "113b9553e292fe11ac84d9d0644fc792a0f269b087115014f3d0b3e02c887944",
      newSha256:
        "9225655ad454e8be739ad29ed3760f091d9eebce4db246f82cb923fc8eabd0e7",
    },
  ],
  bytes: 161561,
  sha256: "43604b5ddf7c738270bb5bead62a1ae4f321176a4cbb77288ef4022818b2e9cf",
};
function startupControllerInverse(text) {
  text = clockFailureControllerInverse(text);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...STARTUP_OBSERVABILITY_HISTORY.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), STARTUP_OBSERVABILITY_HISTORY.bytes);
  assert.equal(hash(text), STARTUP_OBSERVABILITY_HISTORY.sha256);
  return text;
}
// END EXACT STARTUP OBSERVABILITY INVERSE

// BEGIN FINITE ASSEMBLY HISTORY
const ASSEMBLY_HISTORY = {
  controller: {
    rows: [
      {
        name: "finite-0",
        oldRaw:
          '// Closed source controller. Public admission, native qualification, engine,\n// package, transport and SDK record/publication authority remain unavailable.\nimport * as fs from "node:fs/promises";\nimport * as expectedDefaults from "./expected-defaults.mjs";\nimport { constants } from "node:fs";\nimport { randomBytes, randomUUID, createHash } from "node:crypto";\nimport { spawn, ChildProcess } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nimport * as checkpoint from "./current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";\nimport path from "node:path";\nimport * as custom from "./current-source-helpers/scripts/lib/browser-custom-runtime.mjs";\nimport {\n  WORKFLOW_CLOCK_ENV,\n  readWorkflowClock,\n  intersectWorkflowClock,\n} from "./workflow-clock.mjs";\n\n',
        newRaw:
          '// Owned full-SDK build qualification controller. Native acceptance, readiness\n// and publication require later independent evidence.\nimport * as fs from "node:fs/promises";\nimport * as expectedDefaults from "./expected-defaults.mjs";\nimport { fullSdkSourceRootName } from "./source-root.mjs";\nimport * as sdkRuntime from "./current-source-helpers/scripts/cef-runtime-ci.mjs";\nimport { inspectNativeSlice } from "./full-sdk-engine-worker.mjs";\nimport { constants } from "node:fs";\nimport { randomBytes, createHash } from "node:crypto";\nimport { spawn, ChildProcess } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nimport * as checkpoint from "./current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";\nimport path from "node:path";\nimport { types as utilTypes } from "node:util";\nimport * as custom from "./current-source-helpers/scripts/lib/browser-custom-runtime.mjs";\nimport {\n  WORKFLOW_CLOCK_ENV,\n  readWorkflowClock,\n  intersectWorkflowClock,\n} from "./workflow-clock.mjs";\n\n',
        oldSha256:
          "2e9dd3a92ecdf2b71a88c2c5f8f5ec727cc011624f0136761989eee0faa92aba",
        newSha256:
          "727e6f074e12a6d7a12d0d659e7227b208c1b8ef3d1a1d23974368e27c8d9cb9",
      },
      {
        name: "finite-1",
        oldRaw:
          "  );\n  state.cleanupWallEnd = Math.min(\n    Date.now() + CLEANUP_MS,\n    lease.wallEnd - FINAL_RESERVE_MS,\n  );\n  state.retirement = (async () => {\n    try {\n      if (state.marker) {\n        const marker = state.marker;\n        state.marker = null;\n        await cleanupStep(state, () => marker.close());\n      }\n      need(\n        state.pending.size === 0 &&\n",
        newRaw:
          "  );\n  state.cleanupWallEnd = Math.min(\n    Date.now() + CLEANUP_MS,\n    lease.wallEnd - FINAL_RESERVE_MS,\n  );\n  state.retirement = (async () => {\n    try {\n      for (const fd of [...(state.assetFds ?? [])]) {\n        await cleanupStep(state, () => fd.close());\n        state.assetFds.delete(fd);\n      }\n      if (state.marker) {\n        const marker = state.marker;\n        state.marker = null;\n        await cleanupStep(state, () => marker.close());\n      }\n      need(\n        state.pending.size === 0 &&\n",
        oldSha256:
          "364ef8c54489272bfc181a56f1499df12508695da8d6478ecfacc7a0d3e99dae",
        newSha256:
          "cef1c5fee6951ae96679b5f8b2165c2b67f9f8624e4bb275808042d8289a85df",
      },
      {
        name: "finite-2",
        oldRaw:
          '      executionAdmitted: false,\n    });\n  })();\n  return state.retirement;\n}\n\n// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false;\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\n',
        newRaw:
          '      executionAdmitted: false,\n    });\n  })();\n  return state.retirement;\n}\n\n// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\n',
        oldSha256:
          "ecf320013ed6ed086a817d424ac1299919f258ad6f4622c523578acf852d3759",
        newSha256:
          "b864bf890cf1ab62953da847b04d52f964673b672b09b02a168043fa787f9dfb",
      },
      {
        name: "finite-3",
        oldRaw:
          '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\nasync function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      source.metadataSnapshot === state.metadataSnapshot &&\n      state.metadataSnapshot &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n  need(!state.child, "SOURCE_LAUNCH_REUSE");\n  const child = spawn(state.plan.executable, state.plan.argv, {\n    cwd: state.root,\n    env: state.plan.environment,\n',
        newRaw:
          '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n  "include",\n  "atlmfc/include",\n  "lib/x64",\n  "lib/arm64",\n  "atlmfc/lib/x64",\n  "atlmfc/lib/arm64",\n  "bin/Hostx64/x64",\n  "bin/Hostx64/arm64",\n]);\nfunction inspectInstalledToolProof(raw, baseRaw) {\n  const proof = parentMetadata_qualificationBoundedJson(raw, 16 * 1024 ** 2),\n    base = JSON.parse(baseRaw);\n  parentMetadata_qualificationShape(\n    proof,\n    [\n      "kind",\n      "roots",\n      "files",\n      "bytes",\n      "visited",\n      "sha256",\n      "executed",\n      "previous14AreCompleteClosure",\n    ],\n    "TOOL_PROOF_FIELDS",\n  );\n  need(\n    proof.kind === "windows-arm-full-installed-source-inventory" &&\n      canonical(proof.roots) === canonical(TOOL_PROOF_ROOTS) &&\n      proof.executed === false &&\n      proof.previous14AreCompleteClosure === false &&\n      Array.isArray(proof.files) &&\n      proof.files.length > 0 &&\n      proof.files.length <= base.limits.installedFiles &&\n      Number.isSafeInteger(proof.visited) &&\n      proof.visited >= proof.files.length &&\n      proof.visited <= base.limits.installedFiles &&\n      Number.isSafeInteger(proof.bytes) &&\n      proof.bytes > 0 &&\n      proof.bytes <= base.limits.installedBytes,\n    "TOOL_PROOF_SCOPE",\n  );\n  let previous = "",\n    total = 0;\n  const folded = new Set(),\n    rows = new Map();\n  for (const row of proof.files) {\n    parentMetadata_qualificationShape(\n      row,\n      ["path", "bytes", "sha256"],\n      "TOOL_PROOF_ROW",\n    );\n    need(\n      typeof row.path === "string" &&\n        row.path.length > 0 &&\n        row.path.length <= 4096 &&\n        !/[\\x00-\\x1f\\x7f:\\\\]/.test(row.path) &&\n        row.path\n          .split("/")\n          .every((part) => part && part !== "." && part !== "..") &&\n        TOOL_PROOF_ROOTS.some((root) => row.path.startsWith(root + "/")) &&\n        row.path > previous &&\n        !folded.has(row.path.toLowerCase()) &&\n        Number.isSafeInteger(row.bytes) &&\n        row.bytes >= 0 &&\n        row.bytes <= base.limits.installedFileBytes &&\n        /^[a-f0-9]{64}$/.test(row.sha256),\n      "TOOL_PROOF_ROW_SCOPE",\n    );\n    previous = row.path;\n    folded.add(row.path.toLowerCase());\n    rows.set(row.path, row);\n    total += row.bytes;\n    need(total <= base.limits.installedBytes, "TOOL_PROOF_BYTES");\n  }\n  // Match Python\'s fixed json.dumps(...,sort_keys=True,separators=(\',\',\':\')).\n  const encoded = canonical(proof.files).replace(\n    /[\\x7f-\\uffff]/g,\n    (char) => "\\\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),\n  );\n  need(\n    total === proof.bytes && hashBytes(Buffer.from(encoded)) === proof.sha256,\n    "TOOL_PROOF_DIGEST",\n  );\n  const installed14 = Object.freeze({\n    "host-cl.exe": "bin/Hostx64/arm64/cl.exe",\n    "host-link.exe": "bin/Hostx64/arm64/link.exe",\n    "host-lib.exe": "bin/Hostx64/arm64/lib.exe",\n    "crt-libcmt.lib": "lib/arm64/libcmt.lib",\n    "crt-libcpmt.lib": "lib/arm64/libcpmt.lib",\n    "crt-libvcruntime.lib": "lib/arm64/libvcruntime.lib",\n    "crt-oldnames.lib": "lib/arm64/oldnames.lib",\n    "atl-atls.lib": "atlmfc/lib/arm64/atls.lib",\n    "atl-uafxcw.lib": "atlmfc/lib/arm64/uafxcw.lib",\n    "header-vcruntime.h": "include/vcruntime.h",\n    "header-vector": "include/vector",\n    "header-string": "include/string",\n    "header-atlbase.h": "atlmfc/include/atlbase.h",\n    "header-afxwin.h": "atlmfc/include/afxwin.h",\n  });\n  need(\n    Array.isArray(base.installedMsvc14) &&\n      base.installedMsvc14.length === 14 &&\n      new Set(base.installedMsvc14.map((row) => row.role)).size === 14,\n    "TOOL_PROOF_BASE",\n  );\n  for (const pin of base.installedMsvc14) {\n    const actual = rows.get(installed14[pin.role]);\n    need(\n      actual && actual.bytes === pin.bytes && actual.sha256 === pin.sha256,\n      "TOOL_PROOF_INSTALLED14",\n    );\n  }\n  return Object.freeze({\n    files: proof.files.length,\n    bytes: total,\n    sha256: proof.sha256,\n  });\n}\nasync function verifySourceToolProof(token) {\n  const state = operationState(token);\n  need(state.creationJoined && !state.toolProofSnapshot, "TOOL_PROOF_JOIN");\n  const input = state.plan.producerInputs.findIndex(\n    (row) => row.path === "native/windows-arm-full-sdk/profile.json",\n  );\n  need(\n    input >= 0 &&\n      state.plan.producerInputs[input].sha256 ===\n        "ccadcf1fc6f86fe11b922d93c11dc6192ccf571f03c485c610e89938c60b546a",\n    "TOOL_PROOF_BASE_PIN",\n  );\n  const baseRelative = "source-inputs/" + input,\n    base = await heldOperationFile(\n      token,\n      baseRelative,\n      65536,\n      state.plan.producerInputs[input],\n    );\n  const relative = "installed-source-inventory.json",\n    held = await heldOperationFile(token, relative, 16 * 1024 ** 2);\n  operationState(token);\n  const projection = inspectInstalledToolProof(held.raw, base.raw);\n  await operationFence(token);\n  operationState(token);\n  state.toolProofSnapshot = Object.freeze({\n    projection,\n    record: Object.freeze({\n      relative,\n      maximum: 16 * 1024 ** 2,\n      pin: Object.freeze({ ...held.pin }),\n      identity: held.identity,\n    }),\n    base: Object.freeze({\n      relative: baseRelative,\n      maximum: 65536,\n      pin: Object.freeze({ ...base.pin }),\n      identity: base.identity,\n    }),\n  });\n}\nasync function recheckSourceToolProof(token) {\n  const state = operationState(token, true),\n    snapshot = state.toolProofSnapshot;\n  need(\n    snapshot &&\n      state.sourceReceipt &&\n      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum,\n      row.pin,\n      true,\n    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n  }\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\nasync function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      source.metadataSnapshot === state.metadataSnapshot &&\n      state.metadataSnapshot &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n  await recheckSourceToolProof(source.operationToken);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n  need(!state.child, "SOURCE_LAUNCH_REUSE");\n  const child = spawn(state.plan.executable, state.plan.argv, {\n    cwd: state.root,\n    env: state.plan.environment,\n',
        oldSha256:
          "d5163d1a9a7571a260aab1e8661e5bd6dda73abece7b48e2666de85e8dc5721d",
        newSha256:
          "bbcfb38e04c2a441b4302d8395e6d56d994cd8710c1bc8e08c820241f32d4cd2",
      },
      {
        name: "finite-4",
        oldRaw:
          '        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    await verifySourceMetadata(token);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n',
        newRaw:
          '        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    await verifySourceMetadata(token);\n    await verifySourceToolProof(token);\n    await recheckSourceMetadata(token, false);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n',
        oldSha256:
          "442488085d852e3f9c6fb1301f106d4a71bf3195a176e319704f96fb32a5178c",
        newSha256:
          "417a3def6b370c53896151e9d310bdcee44a5ea2d2cac266ba236c5ebf5fd701",
      },
      {
        name: "finite-5",
        oldRaw:
          '      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n      metadataSnapshot: state.metadataSnapshot,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n',
        newRaw:
          '      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n      metadataSnapshot: state.metadataSnapshot,\n      toolProofSnapshot: state.toolProofSnapshot,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n',
        oldSha256:
          "3bc564f03576a4e40c3a6a3b7d74f1a83a2c9be54fe746d3b37f8da970c79074",
        newSha256:
          "8526313dd2ccfea34779f1a870fa2a4ddc61fdb75f6cfe1f496b9c2d09330865",
      },
      {
        name: "finite-6",
        oldRaw:
          '      if (!probe.joined) child.unref();\n    }\n    probe.child = null;\n    stdout = [];\n    stderr = [];\n  }\n}\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(CONTROLLER_ADMITTED, "EXECUTION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = await fs.readFile(\n    path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n  );\n  bootstrapState(bootstrap);\n  const profile = JSON.parse(profileRaw);\n  const policyRaw = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.policy),\n  );\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  const workflow = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.workflow),\n  );\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n',
        newRaw:
          '      if (!probe.joined) child.unref();\n    }\n    probe.child = null;\n    stdout = [];\n    stderr = [];\n  }\n}\n// BEGIN BOUNDED BOOTSTRAP FILE READER\n// Read-only, creation-owned FDs. These bytes never issue a source capability.\nasync function bootstrapHeldFile(bootstrap, file, maximum, expected) {\n  const owner = bootstrapState(bootstrap),\n    lease = leases.get(owner.lease);\n  need(\n    typeof file === "string" &&\n      path.isAbsolute(file) &&\n      Number.isSafeInteger(maximum) &&\n      maximum > 0 &&\n      maximum <= 268435456,\n    "BOOTSTRAP_FILE_SCOPE",\n  );\n  file = path.resolve(file);\n  const wallEnd = Math.min(\n      lease.wallEnd - CLEANUP_MS - FINAL_RESERVE_MS,\n      owner.wallStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,\n    ),\n    monoEnd = Math.min(\n      lease.monoEnd - CLEANUP_MS - FINAL_RESERVE_MS,\n      owner.monoStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,\n    );\n  owner.bootstrapFds ??= new Set();\n  owner.bootstrapPending ??= new Set();\n  let failed = false,\n    primary,\n    fd,\n    raw,\n    identity;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  const remaining = () => {\n    bootstrapState(bootstrap);\n    const left = Math.min(\n      wallEnd - Date.now(),\n      monoEnd - performance.now(),\n      checkLease(owner.lease),\n    );\n    need(left > 0, "BOOTSTRAP_READ_DEADLINE");\n    return left;\n  };\n  const wait = async (action, late) => {\n    const ms = remaining();\n    let timer,\n      abort,\n      settled = false,\n      received = false,\n      value;\n    const pending = Promise.resolve().then(() => {\n      remaining();\n      return action();\n    });\n    owner.bootstrapPending.add(pending);\n    pending.then(\n      (value) => {\n        owner.bootstrapPending.delete(pending);\n        if (settled && late)\n          Promise.resolve()\n            .then(() => late(value))\n            .catch(remember);\n      },\n      () => owner.bootstrapPending.delete(pending),\n    );\n    try {\n      value = await Promise.race([\n        pending,\n        new Promise((_, reject) => {\n          timer = setTimeout(\n            () => reject(new Error("FULL_SDK_CONTROL_BOOTSTRAP_READ_DEADLINE")),\n            ms,\n          );\n          abort = () => reject(lease.signal.reason);\n          lease.signal?.addEventListener("abort", abort, { once: true });\n          if (lease.signal?.aborted) abort();\n        }),\n      ]);\n      received = true;\n      remaining();\n      settled = true;\n      return value;\n    } catch (error) {\n      settled = true;\n      if (received && late)\n        Promise.resolve()\n          .then(() => late(value))\n          .catch(remember);\n      throw error;\n    } finally {\n      clearTimeout(timer);\n      lease.signal?.removeEventListener("abort", abort);\n    }\n  };\n  const ancestors = [];\n  const fence = async () => {\n    for (const entry of ancestors)\n      need(\n        operationDirectoryId(\n          await wait(() => fs.lstat(entry.path, { bigint: true })),\n        ) === entry.identity,\n        "BOOTSTRAP_ANCESTOR_CHANGED",\n      );\n    need(\n      (await wait(() => fs.realpath(file))) === file,\n      "BOOTSTRAP_FILE_ALIAS",\n    );\n  };\n  try {\n    for (let current = path.dirname(file); ; current = path.dirname(current)) {\n      ancestors.push({\n        path: current,\n        identity: operationDirectoryId(\n          await wait(() => fs.lstat(current, { bigint: true })),\n        ),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    await fence();\n    const named = await wait(() => fs.lstat(file, { bigint: true }));\n    identity = fileId(named);\n    need(\n      named.size >= 0n && named.size <= BigInt(maximum),\n      "BOOTSTRAP_FILE_BOUND",\n    );\n    const closeLate = async (value) => {\n      await value.close();\n      owner.bootstrapFds.delete(value);\n    };\n    fd = await wait(\n      () =>\n        fs\n          .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))\n          .then((value) => {\n            owner.bootstrapFds.add(value);\n            return value;\n          }),\n      closeLate,\n    );\n    const held = await wait(() => fd.stat({ bigint: true }));\n    need(\n      held.size >= 0n && held.size <= BigInt(maximum),\n      "BOOTSTRAP_FILE_BOUND",\n    );\n    need(\n      fileId(held) === identity &&\n        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,\n      "BOOTSTRAP_FILE_CHANGED",\n    );\n    // The bound is checked on the held FD BEFORE allocating. One sentinel byte\n    // detects growth; no request or allocation can exceed the original max+1.\n    const buffer = Buffer.alloc(Number(held.size) + 1);\n    let count = 0;\n    while (count < buffer.length) {\n      const value = await wait(() =>\n        fd.read(buffer, count, buffer.length - count, count),\n      );\n      if (!value.bytesRead) break;\n      count += value.bytesRead;\n    }\n    need(\n      count === Number(held.size) && count <= maximum,\n      "BOOTSTRAP_FILE_GROWTH",\n    );\n    need(\n      fileId(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,\n      "BOOTSTRAP_FILE_CHANGED",\n    );\n    raw = buffer.subarray(0, count);\n    if (expected)\n      need(\n        raw.length === expected.bytes && hashBytes(raw) === expected.sha256,\n        "BOOTSTRAP_FILE_PIN",\n      );\n    await fence();\n    remaining();\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (fd) {\n      const cleanup = owner.bootstrapFailureCleanup ?? {\n        cleanupEnd: Math.min(\n          performance.now() + CLEANUP_MS,\n          lease.monoEnd - FINAL_RESERVE_MS,\n        ),\n        cleanupWallEnd: Math.min(\n          Date.now() + CLEANUP_MS,\n          lease.wallEnd - FINAL_RESERVE_MS,\n        ),\n      };\n      if (failed) owner.bootstrapFailureCleanup ??= cleanup;\n      try {\n        await cleanupStep(cleanup, async () => {\n          await fd.close();\n          owner.bootstrapFds.delete(fd);\n        });\n      } catch (error) {\n        owner.bootstrapFailureCleanup ??= cleanup;\n        remember(error);\n      }\n    }\n  }\n  if (failed) throw primary;\n  await fence();\n  remaining();\n  need(owner.bootstrapFds.size === 0, "BOOTSTRAP_FD_JOIN");\n  return { raw, identity, pin: { bytes: raw.length, sha256: hashBytes(raw) } };\n}\n// END BOUNDED BOOTSTRAP FILE READER\n\n// BEGIN FIXED RESTORE HANDOFF\nfunction producerInputDigest(rows) {\n  need(\n    Array.isArray(rows) &&\n      rows.length > 0 &&\n      rows.length <= 128 &&\n      new Set(rows.map((row) => row.path.toLowerCase())).size === rows.length,\n    "PRODUCER_INPUTS",\n  );\n  return hashBytes(\n    Buffer.from(\n      canonical(\n        [...rows]\n          .map((row) => ({\n            path: row.path,\n            bytes: row.bytes,\n            sha256: row.sha256,\n          }))\n          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),\n      ),\n    ),\n  );\n}\nasync function readRestoreHandoff(bootstrap, rows, image, sourceId) {\n  bootstrapState(bootstrap);\n  const requested = process.env.CEF_FULLSDK_RESTORE_RUN;\n  if (requested === "0") return null;\n  need(/^[1-9][0-9]{0,19}$/.test(requested ?? ""), "RESTORE_RUN");\n  const temp = path.resolve(CONTROLLER_REPO, "../../_temp");\n  need(path.resolve(process.env.RUNNER_TEMP ?? "") === temp, "RESTORE_TEMP");\n  const directory = path.join(\n    temp,\n    `sorng-windows-arm-checkpoint-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,\n  );\n  need((await fs.realpath(directory)) === directory, "RESTORE_ALIAS");\n  bootstrapState(bootstrap);\n  for (let current = directory; ; current = path.dirname(current)) {\n    directoryId(await fs.lstat(current, { bigint: true }));\n    bootstrapState(bootstrap);\n    if (current === path.dirname(current)) break;\n  }\n  const file = path.join(directory, "ready.json"),\n    before = await fs.lstat(file, { bigint: true });\n  bootstrapState(bootstrap);\n  const identity = fileId(before);\n  need(\n    before.size > 0n && before.size <= 2n * 1024n ** 2n,\n    "RESTORE_READY_BOUND",\n  );\n  const heldReady = await bootstrapHeldFile(bootstrap, file, 2 * 1024 ** 2);\n  need(heldReady.identity === identity, "RESTORE_READY_CHANGED");\n  const raw = heldReady.raw;\n  bootstrapState(bootstrap);\n  need(\n    raw.length === Number(before.size) &&\n      fileId(await fs.lstat(file, { bigint: true })) === identity,\n    "RESTORE_READY_CHANGED",\n  );\n  bootstrapState(bootstrap);\n  const ready = JSON.parse(raw);\n  parentMetadata_qualificationShape(\n    ready,\n    [\n      "kind",\n      "schemaVersion",\n      "record",\n      "priorRunId",\n      "priorAttempt",\n      "currentRunId",\n      "currentAttempt",\n      "head",\n      "identity",\n      "sealArtifact",\n    ],\n    "RESTORE_READY_FIELDS",\n  );\n  need(\n    ready.kind === "windows-arm-full-sdk-checkpoint-download" &&\n      ready.schemaVersion === 1 &&\n      ready.priorRunId === requested &&\n      /^[1-9][0-9]{0,8}$/.test(ready.priorAttempt) &&\n      ready.currentRunId === process.env.GITHUB_RUN_ID &&\n      ready.currentAttempt === process.env.GITHUB_RUN_ATTEMPT &&\n      /^[a-f0-9]{40}$/.test(ready.head),\n    "RESTORE_READY_SCOPE",\n  );\n  parentMetadata_qualificationShape(\n    ready.sealArtifact,\n    ["id", "bytes", "sha256"],\n    "RESTORE_ARTIFACT_FIELDS",\n  );\n  need(\n    Number.isSafeInteger(ready.sealArtifact.id) &&\n      ready.sealArtifact.id > 0 &&\n      Number.isSafeInteger(ready.sealArtifact.bytes) &&\n      ready.sealArtifact.bytes > 0 &&\n      ready.sealArtifact.bytes <= 3 * 1024 ** 2 &&\n      /^[a-f0-9]{64}$/.test(ready.sealArtifact.sha256),\n    "RESTORE_ARTIFACT_PIN",\n  );\n  const source = ready.identity;\n  parentMetadata_qualificationShape(\n    source,\n    [\n      "image",\n      "sourceId",\n      "producerSha256",\n      "sourceDateEpoch",\n      "canonicalRoot",\n      "toolProofPin",\n      "graphPin",\n    ],\n    "RESTORE_IDENTITY_FIELDS",\n  );\n  need(\n    source.image === image &&\n      source.sourceId === sourceId &&\n      source.producerSha256 === producerInputDigest(rows) &&\n      source.canonicalRoot === fullSdkSourceRootName(image, sourceId) &&\n      canonical(source.sourceDateEpoch) ===\n        canonical({ present: false, value: null }),\n    "RESTORE_SOURCE_IDENTITY",\n  );\n  for (const [pin, max] of [\n    [ready.record, 2 * 1024 ** 2],\n    [source.toolProofPin, 16 * 1024 ** 2],\n    [source.graphPin, 16 * 1024 ** 2],\n  ]) {\n    parentMetadata_qualificationShape(\n      pin,\n      ["bytes", "sha256"],\n      "RESTORE_PIN_FIELDS",\n    );\n    need(\n      Number.isSafeInteger(pin.bytes) &&\n        pin.bytes > 0 &&\n        pin.bytes <= max &&\n        /^[a-f0-9]{64}$/.test(pin.sha256),\n      "RESTORE_PIN",\n    );\n  }\n  bootstrapState(bootstrap);\n  return Object.freeze({\n    runId: ready.priorRunId,\n    attempt: ready.priorAttempt,\n    readyPin: Object.freeze({ bytes: raw.length, sha256: hashBytes(raw) }),\n  });\n}\n// END FIXED RESTORE HANDOFF\n\nfunction sourceContextRecord(token, profile, policy, policyRaw, sample) {\n  const state = operationState(token),\n    owner = bootstrapState(state.bootstrap),\n    selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const wholeRemaining =\n    Math.min(\n      leases.get(owner.lease).wallEnd - Date.now(),\n      leases.get(owner.lease).monoEnd - performance.now(),\n    ) / 1000;\n  const sourceRemaining =\n    Math.min(\n      state.sourceWallEnd - Date.now(),\n      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      4500000 - (Date.now() - owner.wallStart),\n      4500000 - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n    mode: "full-sdk-source-gn",\n    workflow: profile.workflow,\n    policy: profile.policy,\n    ref: "refs/heads/main",\n    repository: "supermarsx/sortOfRemoteNG",\n    repositoryId: "1010282954",\n    event: "workflow_dispatch",\n    visibility: "public",\n    defaultBranch: "main",\n    inputs: { restore_run: process.env.CEF_FULLSDK_RESTORE_RUN },\n    checkpointRestore: owner.checkpointRestore ?? null,\n    image: process.env.ImageVersion,\n    target: "aarch64-pc-windows-msvc",\n    sourceId: selected.id,\n    sourceProfileSha256: selected.profile,\n    head: process.env.GITHUB_SHA,\n    workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n    runId: process.env.GITHUB_RUN_ID,\n    attempt: process.env.GITHUB_RUN_ATTEMPT,\n    sources: policy.producerInputs,\n    originPolicySha256: hashBytes(policyRaw),\n    wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n    "SOURCE_ORIGINAL_BUDGET",\n  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    profileRaw.length > 0 &&\n      profileRaw.length <= 65536 &&\n      hashBytes(profileRaw) === FULL_SOURCE_PROFILE_SHA256,\n    "SOURCE_PROFILE_PIN",\n  );\n  const profile = JSON.parse(profileRaw);\n  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  parentMetadata_qualificationShape(\n    policy,\n    [\n      "schemaVersion",\n      "kind",\n      "origin",\n      "target",\n      "workflow",\n      "workflowPin",\n      "sources",\n      "bridge",\n      "producerInputs",\n      "recordSchemaVersion",\n      "jobPolicy",\n    ],\n    "SOURCE_POLICY_FIELDS",\n  );\n  need(\n    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n',
        oldSha256:
          "e1dfa5aebd507c3b861c986127c12541c5040a8c11bea2a5bae8a1b9efb7f433",
        newSha256:
          "21e76f91b5daaab57440c8519ab31218ab5f444cc0926c805b06fe5ec989a4bd",
      },
      {
        name: "finite-7",
        oldRaw:
          '      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.nativeSourceEntryQualified === true &&\n      profile.sourceProgramCarryforwardQualified === true,\n    "SOURCE_NATIVE_UNQUALIFIED",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const pythonRaw = await fs.readFile(profile.python.path);\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n',
        newRaw:
          '      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.sourceQualificationAllowed === true &&\n      profile.fullModeBodyImplemented === true &&\n      profile.sourceSessionIssuerImplemented === true &&\n      profile.controllerCreationPathImplemented === true &&\n      profile.parentExpectedDefaultsImplemented === true &&\n      profile.firstWorkflowClockImplemented === true &&\n      profile.nativeSourceEntryQualified === false &&\n      profile.sourceProgramCarryforwardQualified === false,\n    "SOURCE_ATTEMPT_POLICY",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  need(\n    /^(?:0|[1-9][0-9]{0,19})$/.test(process.env.CEF_FULLSDK_RESTORE_RUN ?? ""),\n    "SOURCE_RESTORE_RUN",\n  );\n  // Resume authentication and fixed ready-file binding are completed before\n  // any source actor; a nonzero request cannot silently become a fresh build.\n  owner.checkpointRestore = await readRestoreHandoff(\n    bootstrap,\n    policy.producerInputs,\n    process.env.ImageVersion,\n    selected.id,\n  );\n  bootstrapState(bootstrap);\n  need(\n    process.env.CEF_FULLSDK_RESTORE_RUN === "0" || owner.checkpointRestore,\n    "SOURCE_RESTORE_AUTHENTICATION",\n  );\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n    "SOURCE_PARENT_NODE",\n  );\n  const nodeInfo = await fs.lstat(actualNode, { bigint: true });\n  bootstrapState(bootstrap);\n  need(\n    nodeInfo.isFile() &&\n      !nodeInfo.isSymbolicLink() &&\n      nodeInfo.nlink === 1n &&\n      nodeInfo.size === BigInt(profile.node.bytes),\n    "SOURCE_NODE_FILE",\n  );\n  const nodeRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      actualNode,\n      profile.node.bytes,\n      profile.node,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    nodeRaw.length === profile.node.bytes &&\n      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n      profile.python,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n',
        oldSha256:
          "2fb19f1baf1b1e2c1d9f64dbf7b5b6cf774c3257dd69397f48c2295c6426fbd0",
        newSha256:
          "1fdfc7986bf7d6900727cae2815c7c4ba4a0422e38c2d713bd38e9d1c8412840",
      },
      {
        name: "finite-8",
        oldRaw:
          '    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    "windows-arm-full-sdk-" + randomUUID(),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n',
        newRaw:
          '    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n      {\n        bytes: 1895,\n        sha256:\n          "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",\n      },\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    rootCode.length === 1895 &&\n      hashBytes(rootCode) ===\n        "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",\n    "SOURCE_ROOT_MODULE_PIN",\n  );\n  need(\n    policy.producerInputs.filter(\n      (row) =>\n        row.path === "native/windows-arm-full-sdk/source-root.mjs" &&\n        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n',
        oldSha256:
          "bb9184a0abaa2380db8092e8f78773cbf7685d561d625285e4bdeb0c2ebeeca8",
        newSha256:
          "c8b7797daf3f641438fc05e239936a27759b3afef7f40ad20bc3af83ccca679c",
      },
      {
        name: "finite-9",
        oldRaw:
          '    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = await operationWork(token, () =>\n        fs.readFile(path.join(CONTROLLER_REPO, row.path)),\n      );\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const wholeRemaining =\n      Math.min(\n        leases.get(owner.lease).wallEnd - Date.now(),\n        leases.get(owner.lease).monoEnd - performance.now(),\n      ) / 1000;\n    const sourceRemaining =\n      Math.min(\n        state.sourceWallEnd - Date.now(),\n        state.sourceMonoEnd - performance.now(),\n      ) / 1000;\n    const acquisitionRemaining =\n      Math.min(\n        4500000 - (Date.now() - owner.wallStart),\n        4500000 - (performance.now() - owner.monoStart),\n        sourceRemaining * 1000,\n      ) / 1000;\n    const c = {\n      kind: "windows-arm-full-sdk-context",\n      mode: "full-sdk-source-gn",\n      workflow: profile.workflow,\n      policy: profile.policy,\n      ref: "refs/heads/main",\n      repository: "supermarsx/sortOfRemoteNG",\n      repositoryId: "1010282954",\n      event: "workflow_dispatch",\n      visibility: "public",\n      defaultBranch: "main",\n      inputs: {},\n      image: process.env.ImageVersion,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: selected.id,\n      sourceProfileSha256: selected.profile,\n      head: process.env.GITHUB_SHA,\n      workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n      runId: process.env.GITHUB_RUN_ID,\n      attempt: process.env.GITHUB_RUN_ATTEMPT,\n      sources: policy.producerInputs,\n      originPolicySha256: hashBytes(policyRaw),\n      wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n      monotonicWholeEnd: sample.monotonic + wholeRemaining,\n      wallWorkEnd: state.sourceWallEnd / 1000,\n      monotonicWorkEnd: sample.monotonic + sourceRemaining,\n      wallAcquisitionEnd:\n        Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n      monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n    };\n    need(\n      sourceRemaining > 150 && acquisitionRemaining > 150,\n      "SOURCE_ORIGINAL_BUDGET",\n    );\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n',
        newRaw:
          '    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n            2097152,\n            row,\n          ),\n        )\n      ).raw;\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n',
        oldSha256:
          "a526f0be71e900196232e081c8a9c411f190177a1d8f2d090907afc0fefa726a",
        newSha256:
          "224ebdb529ac39f10dd58d999b0a7a4bf1af317a216b109783127098f26c6885",
      },
      {
        name: "finite-10",
        oldRaw:
          '      /^[1-9][0-9]{0,19}$/.test(launch.ownCreationFiletime) &&\n      launch.parentPid === process.pid &&\n      launch.parentCreationFiletime === packet.parentCreationFiletime &&\n      launch.contextSha256 === packetPin.sha256,\n    "ENGINE_LAUNCH_BINDING",\n  );\n  const jobRecord = await read(`jobs/${role}/receipt.json`),\n    job = inspectJob(jobRecord, true);\n  need(\n    job.rootPid !== launch.ownPid &&\n      job.rootCreationFiletime !== launch.ownCreationFiletime,\n    "ENGINE_JOB_IDENTITY",\n  );\n  const closed = parseRecord(await read(`full-sdk-engine-closed-${role}.json`));\n  need(\n',
        newRaw:
          '      /^[1-9][0-9]{0,19}$/.test(launch.ownCreationFiletime) &&\n      launch.parentPid === process.pid &&\n      launch.parentCreationFiletime === packet.parentCreationFiletime &&\n      launch.contextSha256 === packetPin.sha256,\n    "ENGINE_LAUNCH_BINDING",\n  );\n  const jobRecord = await read(`jobs/${role}/receipt.json`),\n    job = parseRecord(jobRecord);\n  need(\n    job.rootPid !== launch.ownPid &&\n      job.rootCreationFiletime !== launch.ownCreationFiletime,\n    "ENGINE_JOB_IDENTITY",\n  );\n  const closed = parseRecord(await read(`full-sdk-engine-closed-${role}.json`));\n  need(\n',
        oldSha256:
          "a53ca5fb80a2aacfca8524c284cabdb4ded4aff47ef1fdaae591ad5b7a80b040",
        newSha256:
          "a49d1a5162afdbfa53fd566567a52b330765bc3eb36a5e74deedfbb08f4a0f41",
      },
      {
        name: "finite-11",
        oldRaw:
          '      closed.parentPid === process.pid &&\n      closed.parentCreationFiletime === packet.parentCreationFiletime &&\n      closed.sourceContextSha256 === packet.sourceContextSha256 &&\n      closed.sdkBuilt === false &&\n      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  const resultRecord = await read(`full-sdk-engine-${role}-result.json`),\n    result = parseRecord(resultRecord);\n  need(\n    result.kind === "windows-arm-full-sdk-engine-worker-result" &&\n      result.role === role &&\n      result.sourceContextSha256 === packet.sourceContextSha256 &&\n      result.image === packet.image &&\n',
        newRaw:
          '      closed.parentPid === process.pid &&\n      closed.parentCreationFiletime === packet.parentCreationFiletime &&\n      closed.sourceContextSha256 === packet.sourceContextSha256 &&\n      closed.sdkBuilt === false &&\n      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n      closed.completion === "native-slice-ended" &&\n        closed.receiptPin?.bytes === jobRecord.pin.bytes &&\n        closed.receiptPin?.sha256 === jobRecord.pin.sha256 &&\n        phase.nativeWallEnd <= leases.get(state.leaseToken).wallEnd - 3600000 &&\n        phase.nativeMonoEnd <= leases.get(state.leaseToken).monoEnd - 3600000,\n      "ENGINE_SLICE_CLOSE",\n    );\n    await engineBoundary(token, phase);\n    engineState(token, phase);\n    const fact = Object.freeze({\n      role,\n      nativeSliceEnded: true,\n      result: null,\n      context: Object.freeze({ ...packetPin }),\n      receipt: Object.freeze({ ...jobRecord.pin }),\n      closure: Object.freeze({ ...records[2].pin }),\n      launch: Object.freeze({ ...records[0].pin }),\n      records: Object.freeze(records),\n      nativeAcceptance: false,\n    });\n    state.nativeSliceFact = fact; // Only this actual creator/readback path writes it.\n    return fact;\n  }\n  inspectJob(jobRecord, true);\n  if (role === "cef-engine")\n    need(closed.completion === "success", "ENGINE_CEF_COMPLETION");\n  const resultRecord = await read(`full-sdk-engine-${role}-result.json`),\n    result = parseRecord(resultRecord);\n  need(\n    result.kind === "windows-arm-full-sdk-engine-worker-result" &&\n      result.role === role &&\n      result.sourceContextSha256 === packet.sourceContextSha256 &&\n      result.image === packet.image &&\n',
        oldSha256:
          "0c693d2f3ff8ff9d7c248d015554dcba43804f3a405581c55bd5c9ee603bfdfc",
        newSha256:
          "dc2f9655950204fdd7db5aae524a18e5301911a04a3a16afc64b6ad7f03ec506",
      },
      {
        name: "finite-12",
        oldRaw:
          '}\nasync function runEnginePhase(token, role) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  state.engineResults ??= [];\n  const index = state.engineResults.length;\n  need(\n    index < ENGINE_ROLES.length &&\n      role === ENGINE_ROLES[index] &&\n      !state.enginePhase,\n    "ENGINE_SEQUENCE",\n  );\n  const lease = leases.get(state.leaseToken),\n    nowWall = Date.now(),\n    nowMono = performance.now();\n  if (index === 0)\n    state.probeEnds = Object.freeze({\n      wallEnd: Math.min(lease.wallEnd - 150000, nowWall + 900000),\n      monoEnd: Math.min(lease.monoEnd - 150000, nowMono + 900000),\n    });\n  const phase = {\n    role,\n    wallEnd:\n      index <= 1\n        ? state.probeEnds.wallEnd\n        : Math.min(lease.wallEnd - 150000, nowWall + ENGINE_CAPS_MS[index]),\n    monoEnd:\n      index <= 1\n        ? state.probeEnds.monoEnd\n        : Math.min(lease.monoEnd - 150000, nowMono + ENGINE_CAPS_MS[index]),\n    retired: false,\n    pending: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    cleanupConfirmed: false,\n  };\n  state.enginePhase = phase;\n  try {\n    await engineBoundary(token, phase);\n    const operation = operationState(state.source.operationToken, true),\n      root = state.source.root,\n      contextPin = operation.plan.rootPins.find(\n        (row) => row.relative === "context.json",\n      ),\n      sourceContext = parseRecord(\n        await engineRead(token, phase, "context.json", 131072, contextPin),\n',
        newRaw:
          '}\nasync function runEnginePhase(token, role) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  state.engineResults ??= [];\n  const index = state.engineResults.length;\n  const checkpoint =\n    role === "checkpoint-seal" &&\n    index === 3 &&\n    state.nativeSliceFact === state.engineResults[2] &&\n    state.nativeSliceFact?.nativeSliceEnded === true;\n  need(\n    index < ENGINE_ROLES.length &&\n      (checkpoint || role === ENGINE_ROLES[index]) &&\n      !state.enginePhase &&\n      (index !== 3 || checkpoint || !state.nativeSliceFact),\n    "ENGINE_SEQUENCE",\n  );\n  const lease = leases.get(state.leaseToken),\n    nowWall = Date.now(),\n    nowMono = performance.now();\n  if (index === 0)\n    state.probeEnds = Object.freeze({\n      wallEnd: Math.min(lease.wallEnd - 150000, nowWall + 900000),\n      monoEnd: Math.min(lease.monoEnd - 150000, nowMono + 900000),\n    });\n  const reserve = role === "cef-engine" ? 3600000 : 150000,\n    cap = checkpoint ? 3600000 : ENGINE_CAPS_MS[index];\n  const nativeWallEnd =\n      index <= 1\n        ? state.probeEnds.wallEnd\n        : Math.min(lease.wallEnd - reserve, nowWall + cap),\n    nativeMonoEnd =\n      index <= 1\n        ? state.probeEnds.monoEnd\n        : Math.min(lease.monoEnd - reserve, nowMono + cap);\n  const phase = {\n    role,\n    nativeWallEnd,\n    nativeMonoEnd,\n    wallEnd: Math.min(\n      lease.wallEnd - 150000,\n      nativeWallEnd + (role === "cef-engine" ? 90000 : 0),\n    ),\n    monoEnd: Math.min(\n      lease.monoEnd - 150000,\n      nativeMonoEnd + (role === "cef-engine" ? 90000 : 0),\n    ),\n    retired: false,\n    pending: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    cleanupConfirmed: false,\n  };\n  state.enginePhase = phase;\n  try {\n    await engineBoundary(token, phase);\n    if (index >= 2) compilerAdmission(token, phase);\n    const operation = operationState(state.source.operationToken, true),\n      root = state.source.root,\n      contextPin = operation.plan.rootPins.find(\n        (row) => row.relative === "context.json",\n      ),\n      sourceContext = parseRecord(\n        await engineRead(token, phase, "context.json", 131072, contextPin),\n',
        oldSha256:
          "d43d199e4e665d231cc7ed5678e9b02b96a388c2646c82bb91807fd49a3c5143",
        newSha256:
          "8cd00dffe5670710c22ae046067eeabba1fa115f9d3a8bee81f5589fd2d424dc",
      },
      {
        name: "finite-13",
        oldRaw:
          '        "ENGINE_GIT_PIN",\n      );\n      gitPolicyFiles.push({ relative, ...value.pin });\n    }\n    // Consume the original already-captured Python/Node endpoint projection.\n    // No second clock child and no now+whole lease are introduced here.\n    engineState(token, phase);\n    need(phase.monoEnd <= lease.monoEnd - 150000, "ENGINE_ORIGINAL_BUDGET");\n    const previous = state.engineResults.at(-1),\n      packet = {\n        schemaVersion: 1,\n        kind: "windows-arm-full-sdk-engine-context",\n        mode: "full-sdk-engine",\n        role,\n        sourceContextSha256: contextPin.sha256,\n        image: state.source.image,\n        sourceId: state.source.sourceId,\n        target: state.source.target,\n        wallWholeEnd: sourceContext.wallWholeEnd,\n        monotonicWholeEnd: sourceContext.monotonicWholeEnd,\n        wallPhaseEnd: phase.wallEnd / 1000,\n        monotonicPhaseEnd: Math.min(\n          sourceContext.monotonicWholeEnd - 150,\n          sourceContext.monotonicWholeEnd -\n            (lease.monoEnd - phase.monoEnd) / 1000,\n        ),\n        parentPid: process.pid,\n        parentCreationFiletime: operation.plan.parentCreationFiletime,\n        metadataFiles: state.source.metadataSnapshot.records.map((row) => ({\n          relative: row.relative,\n          ...row.pin,\n        })),\n        gitPolicyFiles,\n        prior: previous\n          ? { result: previous.result, receipt: previous.receipt }\n          : null,\n      };\n    const raw = Buffer.from(JSON.stringify(packet, null, 2) + "\\n"),\n      packetPin = { bytes: raw.length, sha256: hashBytes(raw) };\n    await engineSave(token, phase, `full-sdk-engine-${role}-context.json`, raw);\n    for (const name of ["stdout", "stderr"]) {\n      await engineWork(token, phase, () => currentRoot(token, state));\n      engineState(token, phase);\n',
        newRaw:
          '        "ENGINE_GIT_PIN",\n      );\n      gitPolicyFiles.push({ relative, ...value.pin });\n    }\n    // Consume the original already-captured Python/Node endpoint projection.\n    // No second clock child and no now+whole lease are introduced here.\n    engineState(token, phase);\n    need(\n      phase.nativeMonoEnd <= lease.monoEnd - 150000,\n      "ENGINE_ORIGINAL_BUDGET",\n    );\n    const previous = state.engineResults.at(-1),\n      packet = {\n        schemaVersion: 1,\n        kind: "windows-arm-full-sdk-engine-context",\n        mode: "full-sdk-engine",\n        role,\n        sourceContextSha256: contextPin.sha256,\n        image: state.source.image,\n        sourceId: state.source.sourceId,\n        target: state.source.target,\n        wallWholeEnd: sourceContext.wallWholeEnd,\n        monotonicWholeEnd: sourceContext.monotonicWholeEnd,\n        wallPhaseEnd: phase.nativeWallEnd / 1000,\n        monotonicPhaseEnd: Math.min(\n          sourceContext.monotonicWholeEnd - 150,\n          sourceContext.monotonicWholeEnd -\n            (lease.monoEnd - phase.nativeMonoEnd) / 1000,\n        ),\n        parentPid: process.pid,\n        parentCreationFiletime: operation.plan.parentCreationFiletime,\n        metadataFiles: state.source.metadataSnapshot.records.map((row) => ({\n          relative: row.relative,\n          ...row.pin,\n        })),\n        gitPolicyFiles,\n        prior: checkpoint\n          ? {\n              result: null,\n              receipt: previous.receipt,\n              closure: previous.closure,\n              launch: previous.launch,\n            }\n          : previous\n            ? { result: previous.result, receipt: previous.receipt }\n            : null,\n      };\n    const raw = Buffer.from(JSON.stringify(packet, null, 2) + "\\n"),\n      packetPin = { bytes: raw.length, sha256: hashBytes(raw) };\n    await engineSave(token, phase, `full-sdk-engine-${role}-context.json`, raw);\n    for (const name of ["stdout", "stderr"]) {\n      await engineWork(token, phase, () => currentRoot(token, state));\n      engineState(token, phase);\n',
        oldSha256:
          "c60894a9c8cc2f4fbc53daa128b0f3918a2ff992534e6a741709c7f27cad8a07",
        newSha256:
          "acd93a33a5232f0ea54875952d462d3859dba27ac85607c2a40cea167bb4f930",
      },
      {
        name: "finite-14",
        oldRaw:
          '  } finally {\n    await retireEnginePhase(token, phase);\n    if (state.failed) throw state.primary;\n  }\n}\n// END ACTUAL PARENT ENGINE CREATION\n\nasync function runFullSdkTransaction(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  let operation, control;\n  try {\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    return Object.freeze({\n      kind: "closed-full-sdk-source-controller",\n      executionAdmitted: false,\n      sdkBuilt: false,\n    });\n  } finally {\n    if (control) await retireControl(control);\n    if (operation) await retireSourceOperation(operation);\n    owner.closed = true;\n    bootstrapOwners.delete(bootstrap);\n    leases.get(owner.lease).closed = true;\n  }\n}\n// END CLOSED FULL SDK SOURCE CONTROLLER\n\nexport function main() {\n  // Deliberately do not inspect arguments, environment, paths or getters.\n  throw new Error("FULL_SDK_CONTROL_EXECUTION_CLOSED");\n}\n',
        newRaw:
          '  } finally {\n    await retireEnginePhase(token, phase);\n    if (state.failed) throw state.primary;\n  }\n}\n// END ACTUAL PARENT ENGINE CREATION\n\n// BEGIN PRIVATE COMPILER ADMISSION\nfunction compilerAdmission(token, phase) {\n  const state = engineState(token, phase),\n    source = sourceState(state.sourceReceipt, state.leaseToken);\n  if (!state.compilerAdmission) {\n    need(\n      phase.role === "cef-engine" &&\n        state.engineResults.length === 2 &&\n        state.engineResults[0].role === "probe-clang" &&\n        state.engineResults[1].role === "probe-link",\n      "COMPILER_CREATED_PROBES",\n    );\n    const matched = source.metadataSnapshot?.matchedExpectedDefaults;\n    need(\n      matched?.comparison.expectedMacroCount === 61 &&\n        matched.comparison.partitionAllocActionValuesMatch === true &&\n        matched.comparison.partitionAllocHeaderValuesMatch === true &&\n        matched.comparison.cefV8SandboxValue === 1 &&\n        source.toolProofSnapshot,\n      "COMPILER_SOURCE_FACTS",\n    );\n    state.compilerAdmission = Object.freeze({\n      sourceReceipt: state.sourceReceipt,\n      source,\n      metadataSnapshot: source.metadataSnapshot,\n      toolProofSnapshot: source.toolProofSnapshot,\n      expectedDefaults: matched,\n      clang: state.engineResults[0],\n      link: state.engineResults[1],\n      full61Qualified: true,\n      nativeAcceptance: false,\n    });\n  }\n  const fact = state.compilerAdmission;\n  need(\n    fact.sourceReceipt === state.sourceReceipt &&\n      fact.source === source &&\n      fact.metadataSnapshot === source.metadataSnapshot &&\n      fact.toolProofSnapshot === source.toolProofSnapshot &&\n      fact.expectedDefaults ===\n        source.metadataSnapshot.matchedExpectedDefaults &&\n      fact.clang === state.engineResults[0] &&\n      fact.link === state.engineResults[1] &&\n      fact.full61Qualified === true,\n    "COMPILER_RETAINED_FACT",\n  );\n  return fact;\n}\n// END PRIVATE COMPILER ADMISSION\n\n// BEGIN PRIVATE FINAL SDK VERIFICATION\nasync function sealSdkAsset(token, name, expected, kind = "sdk") {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    typeof name === "string" &&\n      /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name) &&\n      Number.isSafeInteger(expected?.size) &&\n      expected.size > 0 &&\n      expected.size <= 2 * 1024 ** 3 &&\n      /^[a-f0-9]{64}$/.test(expected.sha256),\n    "SDK_ASSET_SCOPE",\n  );\n  need(kind === "sdk" || kind === "checkpoint", "OUTPUT_KIND");\n  const file = path.join(\n    state.source.root,\n    kind === "sdk" ? "full-sdk-package/bundle" : "full-sdk-checkpoint-output",\n    name,\n  );\n  await currentRoot(token, state);\n  await physical(token, state, path.dirname(file));\n  state.assetFds ??= new Set();\n  const fd = await work(\n    token,\n    state,\n    () =>\n      fs\n        .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))\n        .then((value) => {\n          state.assetFds.add(value);\n          return value;\n        }),\n    async (late) => {\n      await late.close();\n      state.assetFds.delete(late);\n    },\n  );\n  let failed = false,\n    primary,\n    value;\n  try {\n    const info = await work(token, state, () => fd.stat({ bigint: true })),\n      identity = fileId(info);\n    need(info.size === BigInt(expected.size), "SDK_ASSET_SIZE");\n    need(\n      fileId(\n        await work(token, state, () => fs.lstat(file, { bigint: true })),\n      ) === identity,\n      "SDK_ASSET_CHANGED",\n    );\n    const digest = createHash("sha256"),\n      buffer = Buffer.alloc(1048576);\n    let total = 0;\n    while (total <= expected.size) {\n      const { bytesRead } = await work(token, state, () =>\n        fd.read(\n          buffer,\n          0,\n          Math.min(buffer.length, expected.size + 1 - total),\n          total,\n        ),\n      );\n      if (!bytesRead) break;\n      total += bytesRead;\n      digest.update(buffer.subarray(0, bytesRead));\n    }\n    need(\n      total === expected.size && digest.digest("hex") === expected.sha256,\n      "SDK_ASSET_PIN",\n    );\n    need(\n      fileId(await work(token, state, () => fd.stat({ bigint: true }))) ===\n        identity &&\n        fileId(\n          await work(token, state, () => fs.lstat(file, { bigint: true })),\n        ) === identity,\n      "SDK_ASSET_CHANGED",\n    );\n    value = Object.freeze({\n      name,\n      size: total,\n      sha256: expected.sha256,\n      identity,\n    });\n  } catch (error) {\n    failed = true;\n    primary = fail(state, error);\n  } finally {\n    try {\n      await work(token, state, () => fd.close());\n      state.assetFds.delete(fd);\n    } catch (error) {\n      if (!failed) {\n        failed = true;\n        primary = fail(state, error);\n      }\n    }\n  }\n  if (failed) throw primary;\n  await currentRoot(token, state);\n  retained(token, state);\n  return value;\n}\nasync function verifyProducedSdk(token) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    state.engineResults?.length === ENGINE_ROLES.length &&\n      !state.enginePhase &&\n      state.engineResults.every(\n        (row, index) => row.role === ENGINE_ROLES[index],\n      ),\n    "SDK_PHASES",\n  );\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  for (const phase of state.engineResults)\n    for (const row of phase.records) {\n      const actual = await work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          row.relative,\n          row.maximum,\n          row.pin,\n          true,\n        ),\n      );\n      need(actual.identity === row.identity, "SDK_PHASE_RECORD_CHANGED");\n    }\n  const result = parseRecord(\n    await work(token, state, () =>\n      heldOperationFile(\n        state.source.operationToken,\n        "full-sdk-engine-package-result.json",\n        131072,\n        state.engineResults[3].result,\n        true,\n      ),\n    ),\n  );\n  need(\n    result.sdkBuilt === true &&\n      result.role === "package" &&\n      result.output?.bundle === "full-sdk-package/bundle" &&\n      Array.isArray(result.output.assets) &&\n      result.output.assets.length === 5 &&\n      new Set(result.output.assets.map((row) => row.name)).size === 5,\n    "SDK_PACKAGE_RESULT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    lockRecord = await work(token, state, () =>\n      heldOperationFile(\n        state.source.operationToken,\n        "full-sdk-package/bundle/source-lock.json",\n        2 * 1024 ** 2,\n        undefined,\n        true,\n      ),\n    ),\n    lock = JSON.parse(lockRecord.raw);\n  need(\n    custom.identitySha256(lock) === state.source.sourceId,\n    "SDK_SOURCE_IDENTITY",\n  );\n  const identity = sdkRuntime.releaseIdentity(lock, state.source.target),\n    names = [\n      "runtime.json",\n      "source-lock.json",\n      "manifest.json",\n      "receipt.json",\n      identity.archive,\n    ];\n  need(\n    result.output.assets.every((row) => names.includes(row.name)),\n    "SDK_ASSET_SET",\n  );\n  const assets = [];\n  for (const name of names)\n    assets.push(\n      await sealSdkAsset(\n        token,\n        name,\n        result.output.assets.find((row) => row.name === name),\n      ),\n    );\n  const verified = await work(token, state, () =>\n    sdkRuntime.verifyBundle(\n      path.join(state.source.root, "full-sdk-package/bundle"),\n      "supermarsx/sortOfRemoteNG",\n    ),\n  );\n  retained(token, state);\n  need(\n    verified.descriptor.target === state.source.target &&\n      verified.identity.sourceLockSha256 === state.source.sourceId &&\n      verified.assets.length === 5 &&\n      verified.assets.every((row) =>\n        assets.some(\n          (asset) =>\n            asset.name === row.name &&\n            asset.size === row.size &&\n            asset.sha256 === row.sha256,\n        ),\n      ),\n    "SDK_BUNDLE_BINDING",\n  );\n  for (const asset of assets) {\n    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  need(\n    state.assetFds.size === 0 &&\n      operation.readFds.size === 0 &&\n      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n    image: state.source.image,\n    target: state.source.target,\n    sdkBuilt: true,\n    nativeAcceptance: false,\n    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n  return seal;\n}\nasync function verifyProducedCheckpoint(token) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    state.engineResults?.length === 4 &&\n      state.engineResults[2] === state.nativeSliceFact &&\n      state.nativeSliceFact?.nativeSliceEnded === true &&\n      state.engineResults[3].role === "checkpoint-seal" &&\n      !state.enginePhase &&\n      state.compilerAdmission?.full61Qualified === true,\n    "CHECKPOINT_PRIVATE_PHASES",\n  );\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  for (const phase of state.engineResults)\n    for (const row of phase.records) {\n      const value = await work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          row.relative,\n          row.maximum,\n          row.pin,\n          true,\n        ),\n      );\n      need(value.identity === row.identity, "CHECKPOINT_PHASE_CHANGED");\n    }\n  const actor = state.engineResults[3],\n    output = actor.output;\n  need(\n    output?.dataOnly === true &&\n      output.sealed === true &&\n      output.outcome === "quiet-deadline" &&\n      output.bundle === "full-sdk-checkpoint-output" &&\n      output.sourceContextSha256 ===\n        state.source.metadataSnapshot.matchedExpectedDefaults.contextSha256,\n    "CHECKPOINT_SEAL_RESULT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    read = (relative, maximum, pin) =>\n      work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          relative,\n          maximum,\n          pin,\n          true,\n        ),\n      );\n  const result = parseRecord(\n    await read("full-sdk-checkpoint-seal-result.json", 131072, output.result),\n  );\n  need(\n    canonical(result) ===\n      canonical(\n        Object.fromEntries(\n          Object.entries(output).filter(([key]) => key !== "result"),\n        ),\n      ),\n    "CHECKPOINT_ACTOR_RESULT",\n  );\n  const checkpoint = await read(\n      "full-sdk-checkpoint-output/checkpoint.json",\n      2 * 1024 ** 2,\n      output.checkpoint,\n    ),\n    record = parentMetadata_qualificationBoundedJson(\n      checkpoint.raw,\n      2 * 1024 ** 2,\n    );\n  parentMetadata_qualificationShape(\n    record,\n    [\n      "schemaVersion",\n      "kind",\n      "identity",\n      "workflow",\n      "producerInputs",\n      "outArchive",\n      "inputSidecar",\n      "rawChain",\n      "nativeEvidence",\n      "codec",\n      "sourceQualified",\n      "sdkBuilt",\n      "nativeAcceptance",\n      "executionAdmitted",\n    ],\n    "CHECKPOINT_RECORD_FIELDS",\n  );\n  const graph = await read(\n      "source-gn-logs/fresh-graph-pins.json",\n      16 * 1024 ** 2,\n    ),\n    sourceContext = parseRecord(\n      await read(\n        "context.json",\n        131072,\n        operation.plan.rootPins.find((row) => row.relative === "context.json"),\n      ),\n    );\n  need(\n    record.schemaVersion === 1 &&\n      record.kind === "windows-arm-full-sdk-compiled-checkpoint" &&\n      record.sourceQualified === false &&\n      record.sdkBuilt === false &&\n      record.nativeAcceptance === false &&\n      record.executionAdmitted === false &&\n      canonical(record.codec) ===\n        canonical({\n          bytes: 154847,\n          sha256:\n            "043659e63e1cfc50b5af8209a1e30fd924ed379e7355069fa654b657bc789113",\n        }) &&\n      canonical(record.producerInputs) ===\n        canonical(operation.plan.producerInputs),\n    "CHECKPOINT_RECORD_SCOPE",\n  );\n  const expectedIdentity = {\n    image: state.source.image,\n    sourceId: state.source.sourceId,\n    producerSha256: producerInputDigest(operation.plan.producerInputs),\n    sourceDateEpoch: { present: false, value: null },\n    canonicalRoot: path.basename(state.source.root),\n    toolProofPin: state.source.toolProofSnapshot.record.pin,\n    graphPin: graph.pin,\n  };\n  need(\n    canonical(record.identity) === canonical(expectedIdentity) &&\n      canonical(record.workflow) ===\n        canonical({\n          repository: "supermarsx/sortOfRemoteNG",\n          repositoryId: 1010282954,\n          path: ".github/workflows/windows-arm-full-sdk.yml",\n          ref: "refs/heads/main",\n          head: sourceContext.head,\n          runId: sourceContext.runId,\n          attempt: sourceContext.attempt,\n        }),\n    "CHECKPOINT_IDENTITY",\n  );\n  const mapping = {\n    sourceContext: "context.json",\n    engineContext: "full-sdk-engine-cef-engine-context.json",\n    launch: "full-sdk-engine-cef-engine-launch.json",\n    job: "jobs/cef-engine/receipt.json",\n    close: "full-sdk-engine-closed-cef-engine.json",\n    sourceJob: "jobs/full-source-operation/receipt.json",\n    sourceLauncher: "full-source-launcher-result.json",\n    sourceClose: "full-source-closed-launcher.json",\n  };\n  parentMetadata_qualificationShape(\n    record.rawChain,\n    ["outcome", ...Object.keys(mapping)],\n    "CHECKPOINT_CHAIN_FIELDS",\n  );\n  need(\n    record.rawChain.outcome === "quiet-deadline",\n    "CHECKPOINT_NATIVE_OUTCOME",\n  );\n  for (const [key, relative] of Object.entries(mapping))\n    await read(relative, 1048576, record.rawChain[key]);\n  need(\n    canonical(record.rawChain.engineContext) ===\n      canonical(state.nativeSliceFact.context) &&\n      canonical(record.rawChain.launch) ===\n        canonical(state.nativeSliceFact.launch) &&\n      canonical(record.rawChain.job) ===\n        canonical(state.nativeSliceFact.receipt) &&\n      canonical(record.rawChain.close) ===\n        canonical(state.nativeSliceFact.closure),\n    "CHECKPOINT_PRIVATE_CHAIN",\n  );\n  const archive = record.outArchive;\n  parentMetadata_qualificationShape(\n    archive,\n    [\n      "complete",\n      "chunks",\n      "inventory",\n      "rawBytes",\n      "compressedBytes",\n      "entries",\n      "linksIncluded",\n    ],\n    "CHECKPOINT_ARCHIVE_FIELDS",\n  );\n  need(\n    archive.complete === true &&\n      archive.linksIncluded === false &&\n      Number.isSafeInteger(archive.rawBytes) &&\n      archive.rawBytes >= 0 &&\n      archive.rawBytes <= 256 * 1024 ** 3 &&\n      Number.isSafeInteger(archive.entries) &&\n      archive.entries > 0 &&\n      archive.entries <= 300000 &&\n      Array.isArray(archive.chunks) &&\n      archive.chunks.length > 0 &&\n      archive.chunks.length <= 32 &&\n      archive.inventory?.name === "inventory.json",\n    "CHECKPOINT_ARCHIVE",\n  );\n  const rows = [\n    { name: "checkpoint.json", ...checkpoint.pin, maximum: 2 * 1024 ** 2 },\n    { name: "inputs.jsonl", ...record.inputSidecar, maximum: 1536 * 1024 ** 2 },\n    { name: "graph.json", ...graph.pin, maximum: 16 * 1024 ** 2 },\n    {\n      name: "tools.json",\n      ...state.source.toolProofSnapshot.record.pin,\n      maximum: 16 * 1024 ** 2,\n    },\n    {\n      name: "native-chain.json",\n      ...record.nativeEvidence,\n      maximum: 2 * 1024 ** 2,\n    },\n    { ...archive.inventory, maximum: 128 * 1024 ** 2 },\n  ];\n  let compressed = 0;\n  for (const [index, row] of archive.chunks.entries()) {\n    parentMetadata_qualificationShape(\n      row,\n      ["name", "bytes", "sha256"],\n      "CHECKPOINT_CHUNK_FIELDS",\n    );\n    need(\n      row.name === `checkpoint-${String(index).padStart(5, "0")}.bin`,\n      "CHECKPOINT_CHUNK_NAME",\n    );\n    compressed += row.bytes;\n    rows.push({ ...row, maximum: 1024 ** 3 });\n  }\n  need(\n    Number.isSafeInteger(compressed) &&\n      compressed === archive.compressedBytes &&\n      compressed <= 32 * 1024 ** 3,\n    "CHECKPOINT_COMPRESSED_BOUND",\n  );\n  const assets = [];\n  for (const row of rows) {\n    need(\n      Number.isSafeInteger(row.bytes) &&\n        row.bytes > 0 &&\n        row.bytes <= row.maximum &&\n        /^[a-f0-9]{64}$/.test(row.sha256),\n      "CHECKPOINT_ASSET_BOUND",\n    );\n    assets.push(\n      await sealSdkAsset(\n        token,\n        row.name,\n        { size: row.bytes, sha256: row.sha256 },\n        "checkpoint",\n      ),\n    );\n  }\n  for (const row of assets) {\n    const value = await sealSdkAsset(token, row.name, row, "checkpoint");\n    need(value.identity === row.identity, "CHECKPOINT_ASSET_CHANGED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  need(state.assetFds.size === 0, "CHECKPOINT_FD_JOIN");\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-checkpoint-produced",\n    image: state.source.image,\n    sourceId: state.source.sourceId,\n    target: state.source.target,\n    checkpointSealed: true,\n    sdkBuilt: false,\n    nativeAcceptance: false,\n    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-checkpoint-output",\n    checkpoint: Object.freeze({ ...checkpoint.pin }),\n    assets: Object.freeze(assets),\n  });\n  state.checkpointSeal = seal;\n  return seal;\n}\n\nasync function publishControllerOutcome(token, seal) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    (state.sdkSeal === seal && seal.sdkBuilt === true) ||\n      (state.checkpointSeal === seal && seal.checkpointSealed === true),\n    "RESULT_PRIVATE_FACT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    context = operation.plan.rootPins.find(\n      (row) => row.relative === "context.json",\n    );\n  await currentRoot(token, state);\n  retained(token, state);\n  const raw = Buffer.from(JSON.stringify(seal, null, 2) + "\\n");\n  need(raw.length <= 131072, "RESULT_BOUND");\n  await work(token, state, () =>\n    fs.writeFile(\n      path.join(state.source.root, "full-sdk-controller-result.json"),\n      raw,\n      { flag: "wx" },\n    ),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  const file = process.env.GITHUB_OUTPUT;\n  need(\n    typeof file === "string" &&\n      path.isAbsolute(file) &&\n      path.dirname(file) ===\n        path.join(\n          path.resolve(CONTROLLER_REPO, "../../_temp"),\n          "_runner_file_commands",\n        ) &&\n      /^set_output_[a-f0-9-]{36}$/.test(path.basename(file)),\n    "RESULT_OUTPUT_PATH",\n  );\n  await physical(token, state, path.dirname(file));\n  const record = Buffer.from(\n    `root=${state.source.root.replaceAll("\\\\", "/")}\\ncontext_sha256=${context.sha256}\\noutcome=${seal.sdkBuilt ? "sdk" : "checkpoint"}\\n`,\n  );\n  need(record.length <= 1024, "RESULT_OUTPUT_BOUND");\n  state.assetFds ??= new Set();\n  const fd = await work(\n    token,\n    state,\n    () =>\n      fs\n        .open(\n          file,\n          constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),\n        )\n        .then((value) => {\n          state.assetFds.add(value);\n          return value;\n        }),\n    async (late) => {\n      await late.close();\n      state.assetFds.delete(late);\n    },\n  );\n  try {\n    const before = await work(token, state, () => fd.stat({ bigint: true }));\n    need(\n      fileId(before) ===\n        fileId(\n          await work(token, state, () => fs.lstat(file, { bigint: true })),\n        ),\n      "RESULT_OUTPUT_CHANGED",\n    );\n    retained(token, state);\n    await work(token, state, () => fd.writeFile(record));\n    const after = await work(token, state, () => fd.stat({ bigint: true }));\n    need(\n      after.dev === before.dev &&\n        after.ino === before.ino &&\n        after.size === before.size + BigInt(record.length) &&\n        fileId(after) ===\n          fileId(\n            await work(token, state, () => fs.lstat(file, { bigint: true })),\n          ),\n      "RESULT_OUTPUT_CHANGED",\n    );\n    await work(token, state, () => fd.close());\n    state.assetFds.delete(fd);\n  } catch (error) {\n    throw fail(state, error);\n  }\n  await currentRoot(token, state);\n  retained(token, state);\n}\n// END PRIVATE FINAL SDK VERIFICATION\n\nasync function runFullSdkTransaction(bootstrap) {\n  const owner = bootstrapOwners.get(bootstrap);\n  need(owner && owner.pid === process.pid, "BOOTSTRAP_BRAND");\n  let operation,\n    control,\n    result,\n    failed = false,\n    primary;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n    const engine = await runEnginePhase(control, "cef-engine");\n    if (engine === controls.get(control).nativeSliceFact) {\n      await runEnginePhase(control, "checkpoint-seal");\n      result = await verifyProducedCheckpoint(control);\n    } else {\n      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n      if (control) await retireControl(control);\n    } catch (error) {\n      remember(error);\n    }\n    if (controlState && controlState.cleanupConfirmed !== true)\n      remember(\n        controlState.failed\n          ? controlState.primary\n          : new Error("FULL_SDK_CONTROL_CLEANUP_UNCONFIRMED"),\n      );\n    const sourceToken = operation ?? owner.operation,\n      source = sourceToken ? sourceOperations.get(sourceToken) : undefined;\n    try {\n      if (sourceToken) await retireSourceOperation(sourceToken);\n    } catch (error) {\n      remember(error);\n    }\n    if (source && source.cleanupConfirmed !== true)\n      remember(\n        source.failed\n          ? source.primary\n          : new Error("FULL_SDK_CONTROL_SOURCE_CLEANUP_UNCONFIRMED"),\n      );\n    const leaseBeforeClose = leases.get(owner.lease),\n      bootstrapCleanup = owner.bootstrapFailureCleanup ?? {\n        cleanupEnd: Math.min(\n          performance.now() + CLEANUP_MS,\n          leaseBeforeClose.monoEnd - FINAL_RESERVE_MS,\n        ),\n        cleanupWallEnd: Math.min(\n          Date.now() + CLEANUP_MS,\n          leaseBeforeClose.wallEnd - FINAL_RESERVE_MS,\n        ),\n      };\n    const closing = [...(owner.bootstrapFds ?? [])].map((fd) =>\n      Promise.resolve()\n        .then(() => fd.close())\n        .then(() => owner.bootstrapFds.delete(fd)),\n    );\n    try {\n      if (closing.length || owner.bootstrapPending?.size)\n        await cleanupStep(bootstrapCleanup, () =>\n          Promise.all([\n            ...closing,\n            ...[...(owner.bootstrapPending ?? [])].map((value) =>\n              value.catch(() => undefined),\n            ),\n          ]),\n        );\n    } catch (error) {\n      remember(error);\n    }\n    if (owner.bootstrapFds?.size || owner.bootstrapPending?.size)\n      remember(new Error("FULL_SDK_CONTROL_BOOTSTRAP_CLEANUP_UNCONFIRMED"));\n    // No awaited cleanup or falsy primary can skip these final revocations.\n    owner.closed = true;\n    bootstrapOwners.delete(bootstrap);\n    const lease = leases.get(owner.lease);\n    if (lease) lease.closed = true;\n  }\n  if (failed) throw primary;\n  return result;\n}\n// END CLOSED FULL SDK SOURCE CONTROLLER\n\nexport function main(argv = process.argv.slice(2)) {\n  const bootstrap = beginFullSdkBootstrap();\n  try {\n    need(\n      !utilTypes.isProxy(argv) &&\n        Array.isArray(argv) &&\n        Object.getPrototypeOf(argv) === Array.prototype &&\n        Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===\n          "0,length" &&\n        Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>\n          Object.hasOwn(row, "value"),\n        ) &&\n        argv.length === 1 &&\n        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n  }\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      const code = /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(error?.message ?? "")\n        ? error.message\n        : "FULL_SDK_CONTROL_FAILED";\n      console.error(\n        JSON.stringify({\n          kind: "windows-arm-full-sdk-failure",\n          error: code,\n          sdkBuilt: false,\n          nativeAcceptance: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n',
        oldSha256:
          "2c44896d97bdbb2af2ce1ede3e18e971414546258e5ddcf2eaa4f8d9e46243cb",
        newSha256:
          "f078a5a61b89dc3c766aabe1bc567e3da89cccf7f42c77f65d3aedfd1b8f7a09",
      },
    ],
    bytes: 113463,
    sha256: "9ef4d2b569e57b7483390a1ec922635526fc60f38ed102346b8541d4fffbd893",
  },
  driver: {
    rows: [
      {
        name: "finite-0",
        oldRaw:
          '  closeSync,\n  writeFileSync,\n  watch,\n  renameSync,\n  realpathSync,\n} from "node:fs";\nimport path from "node:path";\nimport { pathToFileURL, fileURLToPath } from "node:url";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\n\nconst HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst HELPER_ROOT = path.join(HERE, "current-source-helpers");\n',
        newRaw:
          '  closeSync,\n  writeFileSync,\n  watch,\n  renameSync,\n  realpathSync,\n} from "node:fs";\nimport path from "node:path";\nimport { types as utilTypes } from "node:util";\nimport { pathToFileURL, fileURLToPath } from "node:url";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\n\nconst HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst HELPER_ROOT = path.join(HERE, "current-source-helpers");\n',
        oldSha256:
          "5cc44095289854506159987e454b7ded8c92ab45536c35fb0ceb37c1876cec9e",
        newSha256:
          "87b766fa1c5c2775da7503b51d1c0c907a46e08cd47555c709e7b9440d2fa587",
      },
      {
        name: "finite-1",
        oldRaw:
          '    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = false;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "528dfa3b3a510f0fc9c5e5f48af8044e004ccd9f2b217b1943d2d67053be9aa2";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\nconst fullMetadataSources = new WeakMap();\nconst fullMetadataContexts = new WeakMap();\n',
        newRaw:
          '    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\nconst fullMetadataSources = new WeakMap();\nconst fullMetadataContexts = new WeakMap();\n',
        oldSha256:
          "e6906ec3134f45b283a317ed788887c0f6aec76ab08abac3b1651201f81dbabc",
        newSha256:
          "582f700f9a3b650f36924a1ec446d212fa2cf95ab1144fec41f5a048eeeace44",
      },
      {
        name: "finite-2",
        oldRaw:
          '      c.kind === "windows-arm-full-sdk-context" &&\n      c.head === c.workflowSha &&\n      /^[a-f0-9]{40}$/.test(c.head) &&\n      /^[1-9][0-9]*$/.test(c.runId) &&\n      /^[1-9][0-9]*$/.test(c.attempt) &&\n      c.inputs &&\n      Object.getPrototypeOf(c.inputs) === Object.prototype &&\n      Object.keys(c.inputs).length === 0,\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        newRaw:
          '      c.kind === "windows-arm-full-sdk-context" &&\n      c.head === c.workflowSha &&\n      /^[a-f0-9]{40}$/.test(c.head) &&\n      /^[1-9][0-9]*$/.test(c.runId) &&\n      /^[1-9][0-9]*$/.test(c.attempt) &&\n      c.inputs &&\n      Object.getPrototypeOf(c.inputs) === Object.prototype &&\n      Object.keys(c.inputs).length === 1 &&\n      typeof c.inputs.restore_run === "string" &&\n      /^(?:0|[1-9][0-9]{0,19})$/.test(c.inputs.restore_run),\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        oldSha256:
          "f010f710b669e91884f8538d269abbd21757ede2849a00073707d516ad8463dd",
        newSha256:
          "aadd9cef691bdcb830c3af465e47e9a1a9a3a4c7d761f9388a01ba91c1ef049a",
      },
      {
        name: "finite-3",
        oldRaw:
          '  need(sha(raw) === FULL_SOURCE_PROFILE_SHA256, "FULL_SDK_SOURCE_PROFILE_PIN");\n  const full = JSON.parse(raw);\n  need(\n    full.fullModeBodyImplemented === true &&\n      full.sourceSessionIssuerImplemented === true &&\n      full.executionAdmitted === false &&\n      full.sourceProgramCarryforwardQualified === false &&\n      full.fullArm64DefaultsQualified === false,\n    "FULL_SDK_SOURCE_PROFILE_CLOSED",\n  );\n  const pin = full.images[c.image];\n  need(\n    pin &&\n      c.sourceId === pin.sourceId &&\n      c.sourceProfileSha256 === pin.profileSha256,\n',
        newRaw:
          '  need(sha(raw) === FULL_SOURCE_PROFILE_SHA256, "FULL_SDK_SOURCE_PROFILE_PIN");\n  const full = JSON.parse(raw);\n  need(\n    full.fullModeBodyImplemented === true &&\n      full.sourceSessionIssuerImplemented === true &&\n      full.executionAdmitted === false &&\n      full.sourceProgramCarryforwardQualified === false &&\n      full.fullArm64DefaultsQualified === false &&\n      full.sourceQualificationAllowed === true,\n    "FULL_SDK_SOURCE_PROFILE_CLOSED",\n  );\n  const pin = full.images[c.image];\n  need(\n    pin &&\n      c.sourceId === pin.sourceId &&\n      c.sourceProfileSha256 === pin.profileSha256,\n',
        oldSha256:
          "0ebb57c69b0a2597ef5464cccbf655f30089ceed3d7075e4a92f60fb7506ca78",
        newSha256:
          "f55d43e3c391111c0b04d8c37e1a7a63647be6eaaccb5383828e1bf8f6978b0d",
      },
      {
        name: "finite-4",
        oldRaw:
          '  });\n  return { p, budget, tools, files, privatePolicyRaw: raw };\n}\nfunction fullSourceCommands(root, p, hooks, contextPin) {\n  const state = fullSourceProfiles.get(p);\n  need(state && state.root === root, "FULL_SDK_SOURCE_RECIPE_BRAND");\n  state.budget.remaining();\n  return Object.freeze(\n    sourceCommands(root, p, hooks, contextPin).map((row) => {\n      if (row.role !== "verify-setup") return row;\n      need(\n        row.args[2] === path.join(HERE, "producer.py") &&\n          row.args[3] === "--verify-source-setup",\n        "FULL_SDK_SOURCE_SETUP_VECTOR",\n      );\n',
        newRaw:
          '  });\n  return { p, budget, tools, files, privatePolicyRaw: raw };\n}\nfunction fullSourceCommands(root, p, hooks, contextPin) {\n  const state = fullSourceProfiles.get(p);\n  need(state && state.root === root, "FULL_SDK_SOURCE_RECIPE_BRAND");\n  state.budget.remaining();\n  const commands = Object.freeze(\n    sourceCommands(root, p, hooks, contextPin).map((row) => {\n      if (row.role !== "verify-setup") return row;\n      need(\n        row.args[2] === path.join(HERE, "producer.py") &&\n          row.args[3] === "--verify-source-setup",\n        "FULL_SDK_SOURCE_SETUP_VECTOR",\n      );\n',
        oldSha256:
          "3e8de510120ee0a1f7d757cbc7b5179aabee260f03c4944822a95a2c2ce5222d",
        newSha256:
          "d1223875fd0e72492cc6e038c4e027a19b0cf42fd240faf540c4e6b4cef0a49a",
      },
      {
        name: "finite-5",
        oldRaw:
          '          root,\n          contextPin,\n          "--execute",\n        ]),\n      });\n    }),\n  );\n}\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n      process.arch === "x64" &&\n      argv.length === 4 &&\n      argv[0] === "--full-sdk-source-gn" &&\n',
        newRaw:
          '          root,\n          contextPin,\n          "--execute",\n        ]),\n      });\n    }),\n  );\n  return Object.freeze([\n    ...commands,\n    Object.freeze({\n      role: "restore-checkpoint",\n      executable: p.python.path,\n      cwd: root,\n      args: Object.freeze([\n        "-I",\n        "-B",\n        path.join(HERE, "compiled_checkpoint.py"),\n        "--restore",\n        root,\n        contextPin,\n      ]),\n    }),\n  ]);\n}\n\n// BEGIN SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\nconst fullSourceSentinelOwners = new WeakSet();\nasync function normalizeFullSourceDepotToolsSentinel(root, p, contextPin) {\n  const binding = fullBootstrapAuthority(root, p, contextPin);\n  need(binding && !fullSourceSentinelOwners.has(p), "FULL_SENTINEL_OWNER");\n  const relative =\n      "source-checkout/src/third_party/depot_tools/.disable_auto_update",\n    file = path.join(root, relative),\n    script = path.join(path.dirname(file), "update_depot_tools_toggle.py"),\n    scriptPin = {\n      bytes: 1205,\n      sha256:\n        "6797d3ed046e32efbd48e044347dce7703559b76b4adaca1c874f69ff83c1c23",\n    };\n  const originalRemaining = binding.budget.remaining(),\n    began = performance.now(),\n    monoEnd = began + Math.min(30000, originalRemaining),\n    wallEnd = Math.min(\n      Date.now() + 30000,\n      binding.context.wallWholeEnd * 1000 - 150000,\n    );\n  let failed = false,\n    primary,\n    fd,\n    result,\n    retired = false;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  const owner = () => {\n    need(\n      fullBootstrapAuthority(root, p, contextPin) === binding,\n      "FULL_SENTINEL_RETIRED",\n    );\n    binding.budget.remaining();\n    need(\n      performance.now() < monoEnd && Date.now() < wallEnd,\n      "FULL_SENTINEL_DEADLINE",\n    );\n  };\n  const wait = async (action) => {\n    owner();\n    let timer;\n    try {\n      const value = await Promise.race([\n        Promise.resolve().then(() => {\n          owner();\n          return action();\n        }),\n        new Promise((_, reject) => {\n          timer = setTimeout(\n            () => reject(new Error("FULL_SENTINEL_DEADLINE")),\n            Math.max(\n              1,\n              Math.min(\n                monoEnd - performance.now(),\n                wallEnd - Date.now(),\n                binding.budget.remaining(),\n              ),\n            ),\n          );\n        }),\n      ]);\n      owner();\n      return value;\n    } finally {\n      clearTimeout(timer);\n    }\n  };\n  const dirId = (info) => {\n    need(\n      info.isDirectory() && !info.isSymbolicLink(),\n      "FULL_SENTINEL_DIRECTORY",\n    );\n    return [\n      info.dev,\n      info.ino,\n      info.mode,\n      info.uid,\n      info.gid,\n      info.birthtimeNs,\n    ].join(":");\n  };\n  const parents = [];\n  const fence = async () => {\n    for (const entry of parents)\n      need(\n        dirId(await wait(() => fs.lstat(entry.path, { bigint: true }))) ===\n          entry.identity,\n        "FULL_SENTINEL_ANCESTOR",\n      );\n    need((await wait(() => physical(file))) === file, "FULL_SENTINEL_ALIAS");\n    owner();\n  };\n  try {\n    await wait(() => held(script, scriptPin.bytes, binding.budget, scriptPin));\n    for (let current = path.dirname(file); ; current = path.dirname(current)) {\n      parents.push({\n        path: current,\n        identity: dirId(await wait(() => fs.lstat(current, { bigint: true }))),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    await fence();\n    const pendingOpen = wait(() =>\n      fs\n        .open(file, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))\n        .then(async (value) => {\n          if (retired) {\n            await value.close();\n            throw primary;\n          }\n          fd = value;\n          return value;\n        }),\n    );\n    await pendingOpen;\n    const before = await wait(() => fd.stat({ bigint: true }));\n    need(\n      before.isFile() &&\n        !before.isSymbolicLink() &&\n        before.nlink === 1n &&\n        before.size > 0n &&\n        before.size <= 4096n,\n      "FULL_SENTINEL_FILE",\n    );\n    const identity = signature(before);\n    need(\n      signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n        identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    const buffer = Buffer.alloc(Number(before.size) + 1);\n    let count = 0;\n    while (count < buffer.length) {\n      const read = await wait(() =>\n        fd.read(buffer, count, buffer.length - count, count),\n      );\n      if (!read.bytesRead) break;\n      count += read.bytesRead;\n    }\n    need(\n      count === Number(before.size) &&\n        signature(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n          identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    const raw = buffer.subarray(0, count),\n      prefix = Buffer.from("Disabled by " + script + " at ", "utf8");\n    need(\n      raw.length > prefix.length + 2 &&\n        raw.subarray(0, prefix.length).equals(prefix) &&\n        raw.subarray(-2).equals(Buffer.from("\\r\\n")),\n      "FULL_SENTINEL_GRAMMAR",\n    );\n    const timestampRaw = raw.subarray(prefix.length, -2);\n    need(\n      timestampRaw.every((byte) => byte >= 32 && byte <= 126),\n      "FULL_SENTINEL_GRAMMAR",\n    );\n    const timestamp = timestampRaw.toString("ascii"),\n      match =\n        /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.[0-9]{6})?$/.exec(\n          timestamp,\n        );\n    need(\n      match && (timestamp.length === 19 || timestamp.length === 26),\n      "FULL_SENTINEL_TIMESTAMP",\n    );\n    const [year, month, day, hour, minute, second] = match.slice(1).map(Number),\n      date = new Date(0);\n    date.setUTCFullYear(year, month - 1, day);\n    date.setUTCHours(hour, minute, second, 0);\n    need(\n      year >= 1 &&\n        year <= 9999 &&\n        date.getUTCFullYear() === year &&\n        date.getUTCMonth() === month - 1 &&\n        date.getUTCDate() === day &&\n        date.getUTCHours() === hour &&\n        date.getUTCMinutes() === minute &&\n        date.getUTCSeconds() === second,\n      "FULL_SENTINEL_TIMESTAMP",\n    );\n    const canonical = Buffer.concat([\n      prefix,\n      Buffer.from("1970-01-01 00:00:00\\r\\n"),\n    ]);\n    await fence();\n    need(\n      signature(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n          identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    owner();\n    fullSourceSentinelOwners.add(p); // This genuine source lifetime may normalize once.\n    if (!raw.equals(canonical)) {\n      owner();\n      const written = await wait(() =>\n        fd.write(canonical, 0, canonical.length, 0),\n      );\n      need(\n        written.bytesWritten === canonical.length,\n        "FULL_SENTINEL_PARTIAL_WRITE",\n      );\n      owner();\n      await wait(() => fd.truncate(canonical.length));\n      owner();\n      await wait(() => fd.sync());\n    }\n    const after = await wait(() => fd.stat({ bigint: true }));\n    need(\n      after.isFile() &&\n        after.nlink === 1n &&\n        after.dev === before.dev &&\n        after.ino === before.ino &&\n        after.size === BigInt(canonical.length) &&\n        signature(after) ===\n          signature(await wait(() => fs.lstat(file, { bigint: true }))),\n      "FULL_SENTINEL_CHANGED",\n    );\n    const check = Buffer.alloc(canonical.length + 1);\n    let size = 0;\n    while (size < check.length) {\n      const value = await wait(() =>\n        fd.read(check, size, check.length - size, size),\n      );\n      if (!value.bytesRead) break;\n      size += value.bytesRead;\n    }\n    need(\n      size === canonical.length &&\n        check.subarray(0, size).equals(canonical) &&\n        signature(await wait(() => fd.stat({ bigint: true }))) ===\n          signature(after),\n      "FULL_SENTINEL_READBACK",\n    );\n    await fence();\n    owner();\n    result = {\n      dataOnly: true,\n      relative,\n      bytes: canonical.length,\n      sha256: sha(canonical),\n    };\n  } catch (error) {\n    remember(error);\n    retired = true;\n    fullSourceProfiles.delete(p);\n  } finally {\n    // Poison before awaited close; no rollback/retry.\n    if (fd) {\n      let timer;\n      const close = Promise.resolve().then(() => fd.close());\n      try {\n        await Promise.race([\n          close,\n          new Promise((_, reject) => {\n            timer = setTimeout(\n              () => reject(new Error("FULL_SENTINEL_CLOSE_DEADLINE")),\n              Math.max(\n                1,\n                Math.min(monoEnd - performance.now(), wallEnd - Date.now()),\n              ),\n            );\n          }),\n        ]);\n      } catch (error) {\n        remember(error);\n        fullSourceProfiles.delete(p);\n      } finally {\n        clearTimeout(timer);\n      }\n    }\n  }\n  if (failed) throw primary;\n  try {\n    await fence();\n    owner();\n    return result;\n  } catch (error) {\n    retired = true;\n    fullSourceProfiles.delete(p);\n    throw error;\n  }\n}\n// END SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\n\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n      process.arch === "x64" &&\n      argv.length === 4 &&\n      argv[0] === "--full-sdk-source-gn" &&\n',
        oldSha256:
          "b1f528bb40e0f61b05798de6173717d48501a9cae6994b15fba4c84b4ae83195",
        newSha256:
          "b740a7e5b8e3532fd8ef25aebfb4c8c7cbaf86c0e691e528bca0c01715e5c473",
      },
      {
        name: "finite-6",
        oldRaw:
          '        custom.verifySourceCheckoutVersion(\n          p.python.path,\n          files.chromium,\n          lock.upstream.cef.version,\n        ),\n      );\n      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);\n      stage = "cef-gn";\n      await checked(() =>\n        executeCommand(\n          executionCommands[7],\n          executionCommands,\n          env,\n          files,\n',
        newRaw:
          '        custom.verifySourceCheckoutVersion(\n          p.python.path,\n          files.chromium,\n          lock.upstream.cef.version,\n        ),\n      );\n      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);\n      await normalizeFullSourceDepotToolsSentinel(root, p, argv[2]);\n      // BEGIN SOURCE OWNED CHECKPOINT RESTORE\n      let restoredCheckpoint;\n      if (c.inputs.restore_run !== "0") {\n        need(\n          c.checkpointRestore &&\n            c.checkpointRestore.runId === c.inputs.restore_run,\n          "FULL_RESTORE_CONTEXT",\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n        stage = "restore-checkpoint";\n        const rawRestore = await checked(() =>\n          executeCommand(\n            executionCommands[8],\n            executionCommands,\n            env,\n            files,\n            budget,\n            limits,\n            true,\n            { value: bootstrap, contextSha: argv[2] },\n          ),\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n        restoredCheckpoint = qualificationBoundedJson(\n          Buffer.from(rawRestore),\n          131072,\n        );\n        need(\n          restoredCheckpoint.dataOnly === true &&\n            restoredCheckpoint.restored === true &&\n            restoredCheckpoint.priorGraphFile ===\n              "full-sdk-checkpoint-import/graph.json",\n          "FULL_RESTORE_DATA",\n        );\n        await held(\n          path.join(root, restoredCheckpoint.priorGraphFile),\n          16 * 1024 ** 2,\n          budget,\n          restoredCheckpoint.graphPin,\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n      } else need(c.checkpointRestore === null, "FULL_RESTORE_UNREQUESTED");\n      // END SOURCE OWNED CHECKPOINT RESTORE\n      stage = "cef-gn";\n      await checked(() =>\n        executeCommand(\n          executionCommands[7],\n          executionCommands,\n          env,\n          files,\n',
        oldSha256:
          "f0e56389c86ee043a2f90cedd0bf9edfc8a78eccffce05d3c75302ff9c2bad88",
        newSha256:
          "d1b3792ca8eb4ba05145413eacc4ef5012df3a62c7344e32f52d408bf8c1994a",
      },
      {
        name: "finite-7",
        oldRaw:
          '        ),\n      );\n      stage = "graph-inventory";\n      currentProgress.phase("graph-inventory");\n      const capture = await collectQualificationGraph(qualificationOwner);\n      graph = capture.summary;\n      const snapshot = capture.diagnostic;\n      budget.remaining();\n      await qualificationOwnerAwait(\n        qualificationOwner,\n        fs.writeFile(\n          path.join(files.logs, "fresh-graph-pins.json"),\n          JSON.stringify(snapshot) + "\\n",\n          { flag: "wx" },\n',
        newRaw:
          '        ),\n      );\n      stage = "graph-inventory";\n      currentProgress.phase("graph-inventory");\n      const capture = await collectQualificationGraph(qualificationOwner);\n      graph = capture.summary;\n      const snapshot = capture.diagnostic;\n      // BEGIN FRESH RESTORED GRAPH COMPARISON\n      if (restoredCheckpoint) {\n        const priorGraph = qualificationBoundedJson(\n          await qualificationOwnerAwait(\n            qualificationOwner,\n            held(\n              path.join(root, "full-sdk-checkpoint-import/graph.json"),\n              16 * 1024 ** 2,\n              budget,\n              restoredCheckpoint.graphPin,\n            ),\n          ),\n          16 * 1024 ** 2,\n        );\n        fullMetadataOwner(qualificationOwner);\n        need(\n          staticProjectionEqual(snapshot, priorGraph),\n          "FULL_RESTORE_FRESH_GRAPH_MISMATCH",\n        );\n      }\n      // END FRESH RESTORED GRAPH COMPARISON\n      budget.remaining();\n      await qualificationOwnerAwait(\n        qualificationOwner,\n        fs.writeFile(\n          path.join(files.logs, "fresh-graph-pins.json"),\n          JSON.stringify(snapshot) + "\\n",\n          { flag: "wx" },\n',
        oldSha256:
          "9a0c929ca5ddc0400425b9afb2384cb8536db0ec155e60ea03c87410d36b3aca",
        newSha256:
          "a26c3978a0445ad052d0deb1a1b278e03719615e9e1371c5d60a7dab75f020ca",
      },
      {
        name: "finite-8",
        oldRaw:
          '      if (!failed) throw error;\n    }\n  }\n}\n// END CLOSED FULL SDK SOURCE BODY\n\n// BEGIN INACTIVE FULL SDK SOURCE INTERFACE\nexport function fullSdkSourceMain() {\n  // No caller argument, path, environment, report or callback can enable this.\n  // Exact b039 body retained; full-mode body adaptation is not implemented.\n  throw new Error("FULL_SDK_SOURCE_EXECUTION_CLOSED");\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n)\n  fullSdkSourceMain();\n// END INACTIVE FULL SDK SOURCE INTERFACE\n\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n)\n  main().catch((error) => {\n    const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(\n      error?.message ?? "",\n    )\n      ? error.message\n      : "PRIVATE_DRIVER_UNAVAILABLE";\n    console.error(\n      JSON.stringify({\n        success: false,\n        firstFailure: code,\n        executionAdmitted: false,\n      }),\n    );\n    process.exitCode = 1;\n  });\n',
        newRaw:
          '      if (!failed) throw error;\n    }\n  }\n}\n// END CLOSED FULL SDK SOURCE BODY\n\n// BEGIN INACTIVE FULL SDK SOURCE INTERFACE\n// Historical derivation marker; admission is a reviewed SOURCE attempt only.\nexport function fullSdkSourceMain(argv = process.argv.slice(2)) {\n  need(\n    !utilTypes.isProxy(argv) &&\n      Array.isArray(argv) &&\n      Object.getPrototypeOf(argv) === Array.prototype &&\n      Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===\n        "0,1,2,3,length" &&\n      Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>\n        Object.hasOwn(row, "value"),\n      ) &&\n      argv.length === 4 &&\n      argv.every((value) => typeof value === "string") &&\n      argv[0] === "--full-sdk-source-gn" &&\n      /^[a-f0-9]{64}$/.test(argv[2]) &&\n      argv[3] === "--execute",\n    "FULL_DRIVER_ARGV",\n  );\n  return runFullSourceBody(argv);\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n) {\n  Promise.resolve()\n    .then(() => fullSdkSourceMain())\n    .catch((error) => {\n      const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,80}$/.test(\n        error?.message ?? "",\n      )\n        ? error.message\n        : "FULL_SDK_SOURCE_FAILED";\n      console.error(\n        JSON.stringify({\n          success: false,\n          firstFailure: code,\n          executionAdmitted: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n// END INACTIVE FULL SDK SOURCE INTERFACE\n',
        oldSha256:
          "35780cc038c9d92b81d2afbc20db4cce92ec4343a2a16e16e6efdddbee3a8b61",
        newSha256:
          "602111a5158c9edc29851f9c6ed17d25603f306b9b7df785582c81aae49839bd",
      },
    ],
    bytes: 256606,
    sha256: "a1b9eb8eff5fb0e4a8e1719f1286e58147023fb77332b0a756c6c40303cf7b26",
  },
};
// BEGIN EXACT FULL SOURCE IMAGE INVERSE
const FULL_SOURCE_IMAGE_INVERSE = {
  bytes: 268520,
  sha256: "57b53672e18bd19503ae3dfde05b91b7bea577a863f7715089daf0a1419c6b36",
  rows: [
    {
      oldRaw:
        "  const value = p.sourceGn.hostClosure,\n    tools = reviewedHostTools(p);\n",
      newRaw:
        "  const value = p.sourceGn.hostClosure,\n    tools = reviewedHostTools(p),\n    imageData = sourceImageData(p);\n",
      oldSha256:
        "961ea3fa312334372f88297bf7d6d1146a0d6425de8bce973b8c5c86f92c636e",
      newSha256:
        "cfb1c1e3f05b521d4a582aff584c490cf84eb8ee08d42d3af38490c369439c65",
    },
    {
      oldRaw:
        "      privateImage(p).profileSha256 === p.privateSelectedSha256,\n",
      newRaw:
        "      imageData.profileSha256 === imageData.selectedProfileSha256,\n",
      oldSha256:
        "d4555a9a69a82fdf58d676995d8434f468a37b68bbfcdc3d5d505ac78761590a",
      newSha256:
        "f00b8467df5388f6f2bc9cbf30023238f5a69019477f2b4e155b3e38a12f5db2",
    },
    {
      oldRaw:
        'export function sourcePaths(root, p) {\n  need(\n    p.sourceGn.mode === "image-qualified-source-gn" &&\n      p.sourceGn.sourceId === privateImage(p).sourceId &&\n      p.sourceGn.namespace === privateImage(p).namespace &&\n      p.sourceGn.compilerAllowed === false &&\n      p.sourceGn.checkpointAllowed === false &&\n      p.sourceGn.restoreAllowed === false &&\n      p.sourceGn.sdkAllowed === false,\n    "FULL_SOURCE_POLICY",\n  );\n  need(path.isAbsolute(root) && !/\\s/.test(root), "FULL_SOURCE_WORKSPACE");\n  const workspace = path.join(root, "source-checkout");\n  return {\n    workspace,\n    chromium: path.join(workspace, "src"),\n    cef: path.join(workspace, "src/cef"),\n    depot: path.join(workspace, "depot_tools"),\n    logs: path.join(root, "source-gn-logs"),\n    commands: path.join(root, "source-commands"),\n    inputs: path.join(REPO, p.sourceGn.namespace),\n  };\n}\n\n',
      newRaw:
        'export function sourcePaths(root, p) {\n  const imageData = sourceImageData(p);\n  need(\n    p.sourceGn.mode === "image-qualified-source-gn" &&\n      p.sourceGn.sourceId === imageData.sourceId &&\n      p.sourceGn.namespace === imageData.namespace &&\n      p.sourceGn.compilerAllowed === false &&\n      p.sourceGn.checkpointAllowed === false &&\n      p.sourceGn.restoreAllowed === false &&\n      p.sourceGn.sdkAllowed === false,\n    "FULL_SOURCE_POLICY",\n  );\n  need(path.isAbsolute(root) && !/\\s/.test(root), "FULL_SOURCE_WORKSPACE");\n  const workspace = path.join(root, "source-checkout");\n  return {\n    workspace,\n    chromium: path.join(workspace, "src"),\n    cef: path.join(workspace, "src/cef"),\n    depot: path.join(workspace, "depot_tools"),\n    logs: path.join(root, "source-gn-logs"),\n    commands: path.join(root, "source-commands"),\n    inputs: path.join(REPO, p.sourceGn.namespace),\n  };\n}\n\n',
      oldSha256:
        "05853c7d28bd81fa932baa2fe2b045d255d49e02b11482b2d7b6e4f5cfe865a2",
      newSha256:
        "aa2cd83a2a561687f0ce7acd130282f1c20c4635af87f38edd712c4e373e8169",
    },
    {
      oldRaw: "",
      newRaw:
        '// BEGIN PRIVATE FULL SOURCE IMAGE DATA\nfunction sourceImageData(p) {\n  const binding = fullSourceProfiles.get(p);\n  if (!binding)\n    return {\n      ...privateImage(p),\n      selectedProfileSha256: p.privateSelectedSha256,\n    };\n  try {\n    need(\n      binding.profile === p && binding.sourceGn === p.sourceGn,\n      "FULL_IMAGE_PROFILE_BINDING",\n    );\n    need(\n      fullBootstrapAuthority(binding.root, p, binding.contextPin) === binding,\n      "FULL_IMAGE_OWNER",\n    );\n    const image = binding.imageData;\n    need(\n      image &&\n        image.image === p.image &&\n        binding.context.sourceId === image.sourceId &&\n        binding.context.sourceProfileSha256 === image.profileSha256 &&\n        p.sourceGn.sourceId === image.sourceId &&\n        p.sourceGn.namespace === image.namespace &&\n        binding.selectedProfileSha256 === image.profileSha256,\n      "FULL_IMAGE_CHANGED",\n    );\n    return Object.freeze({\n      ...image,\n      selectedProfileSha256: binding.selectedProfileSha256,\n    });\n  } catch (error) {\n    fullSourceProfiles.delete(p);\n    throw error;\n  }\n}\n// END PRIVATE FULL SOURCE IMAGE DATA\n\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "d5874bc6d35374b03d6385efb9de3376f1a49baa52ec0bc82940c8c700455963",
    },
    {
      oldRaw:
        '  const tools = reviewedHostTools(p),\n    files = sourcePaths(root, p);\n  need(/^[a-f0-9]{64}$/.test(contextPin), "FULL_CONTEXT_PIN");\n  const metadataRecipeRaw = await held(\n',
      newRaw:
        '  need(/^[a-f0-9]{64}$/.test(contextPin), "FULL_CONTEXT_PIN");\n  const metadataRecipeRaw = await held(\n',
      oldSha256:
        "a7461dcb0ac8950ebab19397e10790bc6d19f7eb881ddd7a06a3fe5ae998cd9c",
      newSha256:
        "62b208f3c73d6ff8fb651366a72ab9117b668e7cf507aeed465791861d98afdf",
    },
    {
      oldRaw:
        "  fullSourceProfiles.set(p, {\n    root,\n    context: c,\n    contextPin,\n    budget,\n    metadataRecipeRaw,\n  });\n  return { p, budget, tools, files, privatePolicyRaw: raw };\n",
      newRaw:
        '  // BEGIN HELD FULL SOURCE IMAGE REGISTRATION\n  const imageData = JSON.parse(metadataRecipeRaw).images[c.image];\n  requireFullSourceContext(c);\n  budget.remaining();\n  need(\n    imageData &&\n      c.image === p.image &&\n      c.sourceId === pin.sourceId &&\n      c.sourceProfileSha256 === pin.profileSha256 &&\n      imageData.profile === pin.profile &&\n      imageData.profileSha256 === pin.profileSha256 &&\n      imageData.sourceId === pin.sourceId &&\n      imageData.namespace === p.sourceGn.namespace,\n    "FULL_IMAGE_RECIPE_BINDING",\n  );\n  fullSourceProfiles.set(p, {\n    profile: p,\n    sourceGn: p.sourceGn,\n    root,\n    context: c,\n    contextPin,\n    budget,\n    metadataRecipeRaw,\n    imageData: Object.freeze({ image: c.image, ...imageData }),\n    selectedProfileSha256: sha(selectedRaw),\n  });\n  try {\n    const tools = reviewedHostTools(p),\n      files = sourcePaths(root, p);\n    reviewedHostClosure(p, c.image);\n    fullBootstrapAuthority(root, p, contextPin);\n    return { p, budget, tools, files, privatePolicyRaw: raw };\n  } catch (error) {\n    fullSourceProfiles.delete(p);\n    throw error;\n  }\n  // END HELD FULL SOURCE IMAGE REGISTRATION\n',
      oldSha256:
        "2a57f25defc0ed75e967d8330621c5f8be1d68649fb0849585a0c06b173198a8",
      newSha256:
        "8c98aa6381f9abbc4b808d1c5a69b6c230904f18ec1cfd088553d780d5f30785",
    },
  ],
};
function fullSourceImageInverse(text) {
  text = sourceAcquisitionInverse(text, "driver");
  for (const row of FULL_SOURCE_IMAGE_INVERSE.rows) {
    assert.equal(sha(row.newRaw), row.newSha256);
    assert.equal(sha(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), FULL_SOURCE_IMAGE_INVERSE.bytes);
  assert.equal(sha(text), FULL_SOURCE_IMAGE_INVERSE.sha256);
  return text;
}
// END EXACT FULL SOURCE IMAGE INVERSE

function assemblyInverse(text, name) {
  if (name === "driver") text = fullSourceImageInverse(text);
  if (name === "controller") text = startupControllerInverse(text);
  const spec = ASSEMBLY_HISTORY[name];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...spec.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE:" + row.name,
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END FINITE ASSEMBLY HISTORY

// BEGIN EXACT HISTORICAL CHECKOUT FIXTURE
// Only the unchanged historical row test models checkout's core.autocrlf=false.
// Every other test and every production reader still receives actual raw bytes.
const HISTORICAL_CHECKOUT_ROWS = [
  {
    path: "native/cef-hosted-recipe.json",
    bytes: 3302,
    sha256: "f7ce6e6821f43d3175912a64a2163c6243948c103f70ff3fe9b059041a7cce8e",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/native/cef-hosted-recipe.json",
  },
  {
    path: "scripts/browser-runtime-package.mjs",
    bytes: 45031,
    sha256: "6597617158786afe2c10bccea866f495a744c64b41cf0ab6c97c6e1cd73477ff",
    dataPath:
      "native/windows-arm-full-sdk/current-source-helpers/scripts/browser-runtime-package.mjs",
  },
  {
    path: "scripts/cef-custom-artifact-inventory.mjs",
    bytes: 19378,
    sha256: "cc80cc108ca2ac6b498a339f659ccaecd9e9510966aef63f484e8d28e7e4d6c8",
    dataPath:
      "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-custom-artifact-inventory.mjs",
  },
  {
    path: "scripts/cef-hosted-bootstrap.mjs",
    bytes: 25798,
    sha256: "b63eeefdebb7accb95a6926df4f253489e368d050738de9b1d6751ba3accc9e1",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/scripts/cef-hosted-bootstrap.mjs",
  },
  {
    path: "scripts/cef-hosted-provision.mjs",
    bytes: 26950,
    sha256: "421bd8df9d14c6395579307e649384e1edfe96911b82d518630c587d6924efc1",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/scripts/cef-hosted-provision.mjs",
  },
  {
    path: "scripts/cef-patched-runtime.mjs",
    bytes: 20059,
    sha256: "e0e43e52d72ff6d8fff11b28f05ba47bfc18f2b588aaa10b7206dee14aced896",
    dataPath:
      "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-patched-runtime.mjs",
  },
  {
    path: "scripts/cef-runtime-ci.mjs",
    bytes: 61372,
    sha256: "bd54b696f778c4cc042a432e42e1da6fc7085fb310fc4257322bda56c97e8141",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/scripts/cef-runtime-ci.mjs",
  },
  {
    path: "scripts/lib/browser-custom-runtime.mjs",
    bytes: 68713,
    sha256: "c55c1e013564cdc0f106decbb96dd22ae9a2e690749ecb709c2714246b79a13d",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/scripts/lib/browser-custom-runtime.mjs",
  },
  {
    path: "scripts/lib/browser-runtime-release.mjs",
    bytes: 6093,
    sha256: "3c2bb26011d020de68c3eb162116843cde3acf9e8b603e86d31c961da528d810",
    dataPath:
      "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-runtime-release.mjs",
  },
  {
    path: "scripts/lib/cef-engineering-checkpoint.mjs",
    bytes: 143553,
    sha256: "4a5ad24beba2391a93c2c64c939fcb269b39cd89ab78ad728db6dcc57aa2851a",
    dataPath:
      "tests/fixtures/cef/windows-arm-full-sdk-historical/scripts/lib/cef-engineering-checkpoint.mjs",
  },
  {
    path: "scripts/lib/cef-mac-sdk-inventory.mjs",
    bytes: 9975,
    sha256: "817d5d72db4c24cd1a3a49ff3413553df828a85b3bb22aa8db4de6839d671923",
    dataPath:
      "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-sdk-inventory.mjs",
  },
];
function historicalCheckoutBytes(file, raw) {
  const row = HISTORICAL_CHECKOUT_ROWS.find(
    (entry) => path.join(root, entry.path) === file,
  );
  assert(row, "HISTORICAL_CHECKOUT_PATH");
  const canonical = Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"));
  assert(
    raw.equals(canonical) ||
      raw.equals(
        Buffer.from(canonical.toString("utf8").replaceAll("\n", "\r\n")),
      ),
    "HISTORICAL_CHECKOUT_EOL",
  );
  assert.equal(canonical.length, row.bytes, "HISTORICAL_CHECKOUT_BYTES");
  assert.equal(sha(canonical), row.sha256, "HISTORICAL_CHECKOUT_PIN");
  return canonical;
}
test.beforeEach((context) => {
  if (
    context.name !==
    "reviewed same-image host bytes bind closed source GN without claiming runtime loader proof"
  )
    return;
  const original = fs.readFile;
  fs.readFile = async (file, ...args) => {
    const row = HISTORICAL_CHECKOUT_ROWS.find(
      (entry) => path.join(root, entry.path) === file,
    );
    if (!row) return original(file, ...args);
    const raw = await original(path.join(root, row.dataPath));
    assert.equal(args.length, 0, "HISTORICAL_CHECKOUT_RAW_ONLY");
    return historicalCheckoutBytes(file, raw);
  };
  context.after(() => {
    fs.readFile = original;
  });
});
test("exact historical checkout fixture accepts only eleven pinned LF or uniform CRLF files", async () => {
  assert.equal(HISTORICAL_CHECKOUT_ROWS.length, 11);
  for (const row of HISTORICAL_CHECKOUT_ROWS) {
    const file = path.join(root, row.path),
      raw = await fs.readFile(path.join(root, row.dataPath)),
      canonical = historicalCheckoutBytes(file, raw);
    assert.deepEqual(historicalCheckoutBytes(file, canonical), canonical);
    assert.deepEqual(
      historicalCheckoutBytes(
        file,
        Buffer.from(canonical.toString().replaceAll("\n", "\r\n")),
      ),
      canonical,
    );
    assert.throws(() =>
      historicalCheckoutBytes(file, Buffer.concat([raw, Buffer.from(" ")])),
    );
    assert.throws(
      () => historicalCheckoutBytes(file + ".other", raw),
      /HISTORICAL_CHECKOUT_PATH/,
    );
  }
});
// END EXACT HISTORICAL CHECKOUT FIXTURE

// Test-only maps cannot register a session in the actual production module.
async function inactiveControl(
  overrides = {},
  fixtureProfileSha,
  previousSourceParent = false,
) {
  const defaultsModule =
    await import("../../native/windows-arm-full-sdk/expected-defaults.mjs");
  let source = await read(prefix + "full_sdk_control.mjs");
  if (previousSourceParent) source = sourceParentControllerInverse(source);
  // Only this isolated lexical model may substitute local native-tool bytes.
  // Production pins/gates and its sole source-session writer stay untouched.
  if (fixtureProfileSha) {
    const declaration = source.match(
      /const FULL_SOURCE_PROFILE_SHA256 =\n  "[a-f0-9]{64}";/g,
    );
    assert.equal(declaration?.length, 1);
    source = source.replace(
      declaration[0],
      `const FULL_SOURCE_PROFILE_SHA256 =\n  "${fixtureProfileSha}";`,
    );
  }
  assert.equal((source.match(/sourceSessions\.set\(/g) ?? []).length, 1);
  const clockImport =
    'import {\n  WORKFLOW_CLOCK_ENV,\n  readWorkflowClock,\n  intersectWorkflowClock,\n} from "./workflow-clock.mjs";\n';
  assert.equal(source.split(clockImport).length, 2);
  const clock =
    await import("../../native/windows-arm-full-sdk/workflow-clock.mjs");
  const body = source
    .replace(clockImport, "")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(
      "const MODULE_URL = import.meta.url;",
      "const MODULE_URL = " +
        JSON.stringify(
          overrides.moduleURL ??
            new URL(
              "../../native/windows-arm-full-sdk/full_sdk_control.mjs",
              import.meta.url,
            ).href,
        ) +
        ";",
    )
    .replace(/^export function main/m, "function main");
  const context = {
    fs,
    constants: fsConstants,
    randomBytes,
    randomUUID,
    createHash,
    spawn,
    ChildProcess,
    fileURLToPath,
    checkpoint: controlCheckpoint,
    process,
    path,
    custom: controlCustom,
    Date,
    performance,
    setTimeout,
    clearTimeout,
    WORKFLOW_CLOCK_ENV: clock.WORKFLOW_CLOCK_ENV,
    readWorkflowClock: clock.readWorkflowClock,
    intersectWorkflowClock: clock.intersectWorkflowClock,
    utilTypes: (await import("node:util")).types,
    expectedDefaults: defaultsModule,
    fullSdkSourceRootName: (
      await import("../../native/windows-arm-full-sdk/source-root.mjs")
    ).fullSdkSourceRootName,
    sdkRuntime:
      await import("../../native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs"),
    inspectNativeSlice: (
      await import("../../native/windows-arm-full-sdk/full-sdk-engine-worker.mjs")
    ).inspectNativeSlice,
    ...overrides,
  };
  return new Function(
    ...Object.keys(context),
    body +
      "\nreturn {main,startupFailureReport,originalLease,checkLease,createControl,prepareFreshPolicy,retireControl,sourceSessions,leases,controls,directoryId,fileId,work,retained,beginFullSdkBootstrap,bootstrapState,bootstrapOwners,sourceOperations,runSourcePhase,startSourceChild,retireSourceOperation,operationDirectoryId,recheckSourceReceipt,verifySourceSnapshot,runFullSdkTransaction,samplePythonClock,verifySourceMetadata,recheckSourceMetadata,readRestoreHandoff,bootstrapHeldFile,sourceContextRecord,verifySourceToolProof,recheckSourceToolProof,inspectInstalledToolProof,sealSdkAsset,verifyProducedSdk,consumeCheckedInputObservation,publishControllerOutcome,engineState,engineWork,engineBoundary,engineRead,engineSave,startEngineChild,engineProbe,verifyEnginePhase,retireEnginePhase,runEnginePhase};",
  )(...Object.values(context));
}
async function controlFixture(t, overrides = {}) {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "inactive-full-sdk-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const api = await inactiveControl(overrides);
  const lease = api.originalLease(
    overrides.Date?.now() ?? Date.now(),
    overrides.performance?.now() ?? performance.now(),
    600000,
  );
  const receipt = Object.freeze({ kind: "synthetic-test-only-source-session" });
  const source = {
    lease,
    stage: "joined-success",
    pendingWriters: 0,
    creationJoined: true,
    image: "20261030.294.1",
    target: "aarch64-pc-windows-msvc",
    sourceId:
      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    profileSha256:
      "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",
    root: base,
    rootIdentity: api.directoryId(await fs.lstat(base, { bigint: true })),
  };
  api.sourceSessions.set(receipt, source);
  return { api, lease, receipt, source, base };
}
test("inactive full SDK public entry denies before getters or filesystem authority", async () => {
  let getters = 0;
  const input = new Proxy(
    {},
    {
      get() {
        getters++;
        throw Error("MUST_NOT_READ");
      },
      ownKeys() {
        getters++;
        throw Error("MUST_NOT_ENUMERATE");
      },
    },
  );
  assert.deepEqual(Object.keys(publicControl), ["main"]);
  assert.throws(() => publicControl.main(input), /FULL_SDK_CONTROL_ENTRY_ARGV/);
  assert.equal(getters, 0);
  let io = 0;
  const api = await inactiveControl({
    fs: {
      ...fs,
      lstat: async () => {
        io++;
        throw Error("MUST_NOT_IO");
      },
    },
  });
  const lease = api.originalLease(Date.now(), performance.now(), 600000);
  await assert.rejects(api.createControl({}, lease), /SOURCE_SESSION/);
  assert.equal(io, 0);
});
test("inactive full SDK original lease cannot refresh ends, forge brands or lose falsy cancellation", async () => {
  let wall = 1000,
    mono = 0;
  const api = await inactiveControl({
    Date: { now: () => wall },
    performance: { now: () => mono },
  });
  const lease = api.originalLease(wall, mono, 150020);
  assert.equal(api.checkLease(lease), 20);
  mono = 21;
  wall -= 100;
  let first;
  assert.throws(
    () => api.checkLease(lease),
    (error) => {
      first = error;
      return /DEADLINE/.test(error.message);
    },
  );
  mono = 0;
  wall = 1000;
  assert.throws(
    () => api.checkLease(lease),
    (error) => error === first,
  );
  assert.throws(() => api.checkLease({ ...lease }), /LEASE_BRAND/);
  for (const reason of [false, 0, null]) {
    const cancel = new AbortController();
    const token = api.originalLease(wall, mono, 600000, cancel.signal);
    cancel.abort(reason);
    let thrown = false,
      actual;
    try {
      api.checkLease(token);
    } catch (error) {
      thrown = true;
      actual = error;
    }
    assert.equal(thrown, true);
    assert.equal(actual, reason);
    assert.equal(api.leases.get(token).failed, true);
  }
});
test("inactive full SDK owned root records stable physical identity and retires before cleanup", async (t) => {
  const f = await controlFixture(t);
  const token = await f.api.createControl(f.receipt, f.lease);
  const state = f.api.controls.get(token);
  assert.equal((await fs.readFile(state.markerPath)).length, 32);
  assert.equal(state.gitToken, undefined);
  await assert.rejects(f.api.createControl(f.receipt, f.lease), /LEASE_REUSE/);
  const retired = await f.api.retireControl(token);
  assert.equal(retired.cleanupConfirmed, true);
  assert.equal(retired.executionAdmitted, false);
  assert.equal(f.api.controls.has(token), false);
  await assert.rejects(fs.lstat(state.directory), { code: "ENOENT" });
  await assert.rejects(f.api.prepareFreshPolicy(token), /CONTROL_BRAND/);
  assert.throws(() => publicControl.main(f.receipt), /ENTRY_ARGV/);
});
test("inactive full SDK actual root replacement during marker open denies before helper and leaves foreign entries", async (t) => {
  let prepared = 0,
    actualMarker;
  const f = await controlFixture(t, {
    custom: {
      ...controlCustom,
      prepareSourceGitIsolation: async () => {
        prepared++;
        throw Error("MUST_NOT_PREPARE");
      },
    },
    fs: {
      ...fs,
      open: async (...args) => {
        const directory = path.dirname(args[0]);
        await fs.rename(directory, directory + "-old");
        await fs.mkdir(directory);
        await fs.writeFile(
          path.join(directory, "foreign.txt"),
          "leave untouched",
        );
        actualMarker = await fs.open(...args);
        return actualMarker;
      },
    },
  });
  await assert.rejects(f.api.createControl(f.receipt, f.lease), /ROOT_CHANGED/);
  assert.equal(prepared, 0);
  assert.equal(
    await fs.readFile(
      path.join(f.base, "full-sdk-control/foreign.txt"),
      "utf8",
    ),
    "leave untouched",
  );
  await assert.rejects(actualMarker.stat(), { code: "EBADF" });
  assert.equal(f.api.leases.get(f.lease).closed, true);
});
test("inactive full SDK final cleanup preserves an empty foreign root replaced after marker unlink", async (t) => {
  let substituted = false;
  const f = await controlFixture(t, {
    fs: {
      ...fs,
      unlink: async (name) => {
        await fs.unlink(name);
        if (path.basename(name) === "owner.bin") {
          const directory = path.dirname(name);
          await fs.rename(directory, directory + "-owned-old");
          await fs.mkdir(directory);
          substituted = true;
        }
      },
    },
  });
  const token = await f.api.createControl(f.receipt, f.lease),
    state = f.api.controls.get(token);
  await assert.rejects(f.api.retireControl(token), /ROOT_CHANGED/);
  assert.equal(
    substituted,
    true,
    "replacement is introduced by the actual final marker-unlink boundary",
  );
  assert.equal((await fs.readdir(state.directory)).length, 0);
  assert.equal((await fs.lstat(state.directory)).isDirectory(), true);
  assert.equal(state.cleanupConfirmed, false);
  assert.equal(f.api.controls.has(token), false);
});
test("inactive full SDK real helper brand stays private and owns legitimate directory changes", async (t) => {
  const f = await controlFixture(t);
  const token = await f.api.createControl(f.receipt, f.lease),
    state = f.api.controls.get(token);
  if (process.platform === "win32") {
    const candidate = await f.api.prepareFreshPolicy(token);
    assert.equal(candidate.executionAdmitted, false);
    assert.equal(candidate.gitToken, undefined);
    assert.equal(state.helperValidated, true);
    const env = await controlCustom.sourceGitEnvironment(state.gitToken, {
      GIT_DIR: "must-drop",
    });
    assert.equal(env.GIT_DIR, undefined);
    await assert.rejects(
      controlCustom.sourceGitEnvironment({ ...state.gitToken }, {}),
      /SOURCE_GIT_POLICY_CAPABILITY/,
    );
    await f.api.retireControl(token);
    assert.equal(state.gitToken, undefined);
    assert.equal(state.cleanupConfirmed, true);
  } else {
    await assert.rejects(
      f.api.prepareFreshPolicy(token),
      /SOURCE_GIT_WINDOWS_LONGPATHS_OPTION/,
    );
    await assert.rejects(
      f.api.retireControl(token),
      /SOURCE_GIT_WINDOWS_LONGPATHS_OPTION/,
    );
    assert.equal(state.cleanupConfirmed, false);
    // The actual unchanged helper's benign native-host mode still proves its brand.
    const directory = path.join(f.base, "benign");
    await fs.mkdir(directory);
    const real = await controlCustom.prepareSourceGitIsolation(
      path.join(directory, "cef-source-git-policy"),
    );
    await controlCustom.sourceGitEnvironment(real, {});
    await assert.rejects(
      controlCustom.sourceGitEnvironment({ ...real }, {}),
      /SOURCE_GIT_POLICY_CAPABILITY/,
    );
  }
});
test("inactive full SDK post-await retirement cannot register even a late genuine helper token", async (t) => {
  let entered, release;
  const atPrepare = new Promise((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const f = await controlFixture(t, {
    custom: {
      ...controlCustom,
      prepareSourceGitIsolation: async (directory, options) => {
        const result = await controlCustom.prepareSourceGitIsolation(
          directory,
          process.platform === "win32" ? options : undefined,
        );
        entered();
        await delayed;
        return result;
      },
    },
  });
  const token = await f.api.createControl(f.receipt, f.lease),
    state = f.api.controls.get(token);
  const pending = f.api.prepareFreshPolicy(token);
  pending.catch(() => {});
  await atPrepare;
  await assert.rejects(f.api.retireControl(token), /CLEANUP_UNKNOWN/);
  release();
  await assert.rejects(pending, /CLEANUP_UNKNOWN/);
  assert.equal(f.api.controls.has(token), false);
  assert.equal(state.gitToken, undefined);
  assert.equal(state.cleanupConfirmed, false);
});
test("inactive full SDK late marker close is not reported joined after the original cleanup end", async (t) => {
  let finishClose, closeEntered;
  let closeJoined;
  const joined = new Promise((resolve) => {
    closeJoined = resolve;
  });
  const closing = new Promise((resolve) => {
    closeEntered = resolve;
  });
  const gate = new Promise((resolve) => {
    finishClose = resolve;
  });
  let mono = 0,
    wall = 1000;
  const clock = { Date: { now: () => wall }, performance: { now: () => mono } };
  const f = await controlFixture(t, {
    ...clock,
    fs: {
      ...fs,
      open: async (...args) => {
        const actual = await fs.open(...args);
        return {
          stat: actual.stat.bind(actual),
          writeFile: actual.writeFile.bind(actual),
          close: async () => {
            closeEntered();
            await gate;
            await actual.close();
            closeJoined();
          },
        };
      },
    },
  });
  // This test realm uses its original injected clock for construction as well.
  f.source.lease = f.api.originalLease(wall, mono, 180000);
  const token = await f.api.createControl(f.receipt, f.source.lease),
    state = f.api.controls.get(token);
  mono = 59990;
  wall = 60990;
  const pending = f.api.retireControl(token);
  pending.catch(() => {});
  await closing;
  assert.equal(f.api.controls.has(token), false);
  await assert.rejects(pending, /CLEANUP_DEADLINE/);
  assert.equal(state.cleanupConfirmed, false);
  finishClose();
  await joined;
  assert.equal(state.cleanupConfirmed, false);
});
test("inactive full SDK falsy first helper failure survives cleanup denial without retry authority", async (t) => {
  for (const reason of [false, 0, null, undefined]) {
    const f = await controlFixture(t, {
      custom: {
        ...controlCustom,
        prepareSourceGitIsolation: async () => {
          throw reason;
        },
      },
    });
    const token = await f.api.createControl(f.receipt, f.lease),
      state = f.api.controls.get(token);
    for (const operation of [
      () => f.api.prepareFreshPolicy(token),
      () => f.api.retireControl(token),
    ]) {
      let thrown = false,
        actual;
      try {
        await operation();
      } catch (error) {
        thrown = true;
        actual = error;
      }
      assert.equal(thrown, true);
      assert.equal(actual, reason);
    }
    assert.equal(state.failed, true);
    assert.equal(state.cleanupConfirmed, false);
    assert.equal(f.api.controls.has(token), false);
  }
});
test("inactive full SDK actual awaited continuation cannot outrun its original lease", async (t) => {
  let wall = 1000,
    mono = 0;
  const f = await controlFixture(t, {
    Date: { now: () => wall },
    performance: { now: () => mono },
  });
  const token = await f.api.createControl(f.receipt, f.lease),
    state = f.api.controls.get(token);
  await assert.rejects(
    f.api.work(token, state, async () => {
      mono = 450001;
      wall += 450001;
      return "too late";
    }),
    /DEADLINE/,
  );
  const first = state.primary;
  assert.equal(state.failed, true);
  await assert.rejects(f.api.retireControl(token), (error) => error === first);
  assert.equal(
    state.cleanupConfirmed,
    true,
    "owned resources can be joined while the original operation remains failed",
  );
  assert.equal(f.api.controls.has(token), false);
});

test("inactive full SDK source interface cannot read caller grants or enter its retained private body", async () => {
  const driver =
    await import("../../native/windows-arm-full-sdk/full-sdk-source-driver.mjs");
  let reads = 0;
  const grant = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error("MUST_NOT_READ");
      },
      ownKeys() {
        reads++;
        throw Error("MUST_NOT_ENUMERATE");
      },
    },
  );
  assert.throws(() => driver.fullSdkSourceMain(grant), /FULL_DRIVER_ARGV/);
  assert.equal(reads, 0);
  assert.equal(driver.PRIVATE_DRIVER_ADMITTED, false);
  const source = await read(prefix + "full-sdk-source-driver.mjs");
  assert.match(
    source,
    /throw new Error\("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED"\)/,
  );
  assert.equal((source.match(/sourceSessions\.set\(/g) ?? []).length, 0);
});

test("source qualification assembly pins the disjoint workflow and retains every native qualification blocker", async () => {
  const raw = await fs.readFile(
    path.join(root, prefix, "full-sdk-source-profile.json"),
  );
  const source = await read(prefix + "full_sdk_control.mjs");
  assert(source.includes(sha(raw)));
  const profile = JSON.parse(raw);
  assert.equal(profile.mode, "full-sdk-source-gn");
  assert.equal(profile.fullModeBodyImplemented, true);
  assert.equal(profile.sourceSessionIssuerImplemented, true);
  assert.equal(profile.controllerNativeQualified, false);
  assert.equal(profile.firstWorkflowClockImplemented, true);
  assert.equal(profile.nativeSourceEntryQualified, false);
  assert.equal(profile.workflow, ".github/workflows/windows-arm-full-sdk.yml");
  assert.equal(
    profile.policy,
    "native/windows-arm-full-sdk/sdk-origin-review.json",
  );
  assert.equal(profile.ref, "refs/heads/main");
  for (const key of [
    "executionAdmitted",
    "sourceProgramCarryforwardQualified",
    "fullArm64DefaultsQualified",
    "engineCompilationAllowed",
    "sdkAllowed",
    "nativeAcceptance",
    "runtimeReady",
    "publicationAllowed",
  ])
    assert.equal(profile[key], false, key);
  assert.deepEqual(profile.limits, {
    wholeSeconds: 21600,
    sourceSeconds: 10800,
    acquisitionSeconds: 7200,
    hooksSeconds: 3600,
    cleanupSeconds: 30,
    finalReserveSeconds: 120,
  });
  for (const name of [profile.workflow, profile.policy])
    assert((await fs.stat(path.join(root, name))).isFile());
  assert.equal(profile.sourceQualificationAllowed, true);
  assert.equal(profile.sourceSentinelNativeQualified, false);
});

test("inactive full SDK source body keeps full identity and a fixed setup vector in isolated fixture maps", async () => {
  const raw = assemblyInverse(
    await read(prefix + "full-sdk-source-driver.mjs"),
    "driver",
  );
  const begin = "// BEGIN CLOSED FULL SDK SOURCE BODY\n";
  const end = "// END CLOSED FULL SDK SOURCE BODY\n";
  assert.equal(raw.split(begin).length, 2);
  assert.equal(raw.split(end).length, 2);
  const block = raw.split(begin)[1].split(end)[0];
  const nativeDir = path.join(root, prefix);
  const verify = Object.freeze({
    role: "verify-setup",
    args: Object.freeze([
      "-I",
      "-B",
      path.join(nativeDir, "producer.py"),
      "--verify-source-setup",
      root,
      "a".repeat(64),
      "--execute",
    ]),
  });
  const other = Object.freeze({ role: "sync", args: Object.freeze(["fixed"]) });
  let io = 0;
  const api = new Function(
    "need",
    "path",
    "HERE",
    "sourceCommands",
    "held",
    block +
      "\nreturn {requireFullSourceContext,fullSourceCommands,runFullSourceBody,fullSourceProfiles};",
  )(
    (value, code) => assert(value, code),
    path,
    nativeDir,
    () => Object.freeze([other, verify]),
    async () => {
      io++;
      throw Error("MUST_NOT_IO");
    },
  );
  const context = {
    kind: "windows-arm-full-sdk-context",
    mode: "full-sdk-source-gn",
    workflow: ".github/workflows/windows-arm-full-sdk.yml",
    policy: "native/windows-arm-full-sdk/sdk-origin-review.json",
    ref: "refs/heads/main",
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    visibility: "public",
    event: "workflow_dispatch",
    defaultBranch: "main",
    head: "a".repeat(40),
    workflowSha: "a".repeat(40),
    runId: "1",
    attempt: "1",
    inputs: {},
  };
  api.requireFullSourceContext(context);
  assert.throws(
    () => api.requireFullSourceContext({ ...context, ref: "refs/heads/old" }),
    /FULL_SDK_SOURCE_CONTEXT/,
  );
  const recipe = {};
  assert.throws(
    () => api.fullSourceCommands(root, recipe, [], "a".repeat(64)),
    /RECIPE_BRAND/,
  );
  // This map belongs to the separate fixture module, never the production issuer.
  api.fullSourceProfiles.set(recipe, {
    root,
    budget: { remaining: () => 1000 },
  });
  const plan = api.fullSourceCommands(root, recipe, [], "a".repeat(64));
  assert.equal(plan[0], other);
  assert.equal(verify.args[2], path.join(nativeDir, "producer.py"));
  assert.equal(plan[1].args[2], path.join(nativeDir, "full_sdk_source.py"));
  assert.equal(plan[1].args[3], "--full-sdk-verify-source-setup");
  let reads = 0;
  await assert.rejects(
    api.runFullSourceBody(
      new Proxy(
        {},
        {
          get() {
            reads++;
            throw Error("MUST_NOT_READ");
          },
        },
      ),
    ),
    /EXECUTION_CLOSED/,
  );
  assert.equal(reads, 0);
  assert.equal(io, 0);
});

async function realisticExpectedDefaultsFixtureScript() {
  const { ARM64_EXPECTED_DEFAULTS_POLICY: policy } =
    await import("../../native/windows-arm-full-sdk/expected-defaults.mjs");
  return String.raw`expected=json.loads(${JSON.stringify(JSON.stringify(policy.values))})
import re
pa=observed['files']['partitionAlloc']
pa['raw']=re.sub(rb'(#define PA_BUILDFLAG_INTERNAL_([A-Z0-9_]+)\(\) \()([0-9]+)(\))',lambda m:m[1]+str(expected[m[2].decode()]).encode()+m[4],pa['raw'])
pa['pin'].update(bytes=len(pa['raw']),sha256=__import__('hashlib').sha256(pa['raw']).hexdigest())
desc=json.loads(observed['gnDescPartitionAlloc']);action=next(iter(desc.values()))
action['response_file_contents']=['--flags']+[name+'='+(str(value)if name=='USER_SPACE_ZERO_SEGMENT_SIZE_MB'else'true'if value else'false')for name,value in expected.items()]
observed['gnDescPartitionAlloc']=json.dumps(desc,separators=(',',':')).encode()
`;
}
let parentMetadataDataCache;
async function parentMetadataFixtureData() {
  if (!parentMetadataDataCache) {
    const script = String.raw`import sys,json,base64
sys.path.insert(0,${JSON.stringify(path.join(root, prefix))})
import test_private_qualification as t,private_qualification as p
context,observed=t.output_fixture('20261030.294.1')
${await realisticExpectedDefaultsFixtureScript()}
value=p.inspect_private_outputs(context,t.RAW,t.BASE_RAW,observed,wall_now=200,monotonic_now=200)
report={key:value[key]for key in ('metadata','literalArguments','partitionAllocMacros','cefHeader','policyMinimumsMet','completeMacroInventoryMatches','fullArm64DefaultsQualified','executionAdmitted')}
report.update(kind='windows-arm-full-source-metadata',compilerExecuted=False,cohortQuietProven=False,sourceId=t.POLICY['images']['20261030.294.1']['sourceId'],roleCount=4)
def encode(value):
 if type(value)is bytes:return {'__bytes':base64.b64encode(value).decode()}
 if type(value)is dict:return {k:encode(v)for k,v in value.items()}
 if type(value)is list or type(value)is tuple:return [encode(v)for v in value]
 return value
print(json.dumps(encode({'report':report,'observed':observed})))
`;
    parentMetadataDataCache = JSON.parse(
      execFileSync(
        await projectionFixturePython(),
        ["-I", "-B", "-c", script],
        {
          encoding: "utf8",
          timeout: 20000,
          maxBuffer: 16 * 1024 ** 2,
          windowsHide: true,
        },
      ),
    );
  }
  const decode = (value) =>
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, "__bytes")
      ? Buffer.from(value.__bytes, "base64")
      : Array.isArray(value)
        ? value.map(decode)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, item]) => [key, decode(item)]),
            )
          : value;
  return decode(parentMetadataDataCache);
}
async function createdSourceFixture(t, mode = "normal", overrides = {}) {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "created-source-controller-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const api = await inactiveControl(overrides);
  const bootstrap = api.beginFullSdkBootstrap();
  const owner = api.bootstrapState(bootstrap);
  const token = Object.freeze({
    kind: "isolated-created-source-operation-fixture",
  });
  const out = path.join(base, "source-checkout/src/out/Release_GN_arm64");
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(base, "source-gn-logs"));
  const metadataData = await parentMetadataFixtureData();
  if (mode === "wrong-defaults") {
    const observed = metadataData.observed,
      desc = JSON.parse(observed.gnDescPartitionAlloc),
      action = Object.values(desc)[0];
    action.response_file_contents = action.response_file_contents.map(
      (value) => (value === "IS_ANDROID=false" ? "IS_ANDROID=true" : value),
    );
    observed.gnDescPartitionAlloc = Buffer.from(JSON.stringify(desc));
    observed.files.partitionAlloc.raw = Buffer.from(
      observed.files.partitionAlloc.raw
        .toString()
        .replace(
          "PA_BUILDFLAG_INTERNAL_IS_ANDROID() (0)",
          "PA_BUILDFLAG_INTERNAL_IS_ANDROID() (1)",
        ),
    );
    const pa = metadataData.report.metadata.partitionAlloc;
    pa.evaluatedMacroValues.IS_ANDROID = 1;
    pa.bytes = observed.gnDescPartitionAlloc.length;
    pa.sha256 = sha(observed.gnDescPartitionAlloc);
    metadataData.report.partitionAllocMacros.IS_ANDROID = 1;
  }

  await fs.writeFile(
    path.join(out, "args.gn"),
    metadataData.observed.files.args.raw,
  );
  await fs.writeFile(
    path.join(out, "build.ninja"),
    "rule fixture\n  command = unused\n",
  );
  let graphSnapshot;
  const graph = await controlCheckpoint.graphInventory(out, {
    observePins(value) {
      graphSnapshot = JSON.parse(controlCheckpoint.graphPinSnapshot(value));
    },
  });
  await fs.writeFile(
    path.join(base, "source-gn-logs/fresh-graph-pins.json"),
    JSON.stringify(graphSnapshot),
  );
  const sourceId =
    "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90";
  const roles = [
    "sdk-data",
    "llvm-data",
    "rust-archive",
    "gn-archive",
    "siso-archive",
    "materialize",
    "runtime-closure",
    "full-sdk-source-gn",
  ];
  function receipt(pid, creation, large) {
    return {
      kind: "owned-job-proof",
      outcome: "success",
      success: true,
      started: true,
      jobCreated: true,
      assignedBeforeResume: true,
      resumed: true,
      assignedAtCreationVerified: true,
      assignmentMode: "creation-attribute",
      handleListOnly: true,
      jobHandleInheritable: false,
      jobHandleInStdioAllowlist: false,
      rootExit: 0,
      finalRootExit: 0,
      rootReaped: true,
      activeAtEnd: 0,
      cleanupVerified: true,
      logReadersStopped: true,
      cleanupBudgetMs: 30000,
      rootPid: pid,
      rootCreationFiletime: creation,
      policyReadback: {
        flags: 8712,
        activeProcessLimit: large ? 64 : 8,
        jobMemoryBytes: String(large ? 8589934592 : 536870912),
        cpuFlags: 5,
        cpuRate: 2500,
        inheritedHandles: 3,
        affinityChanged: false,
      },
    };
  }
  function closed(pid, creation, parent) {
    return {
      success: true,
      sdkBuilt: false,
      parentHandleClosed: true,
      ownHandleClosed: true,
      ownPid: pid,
      ownCreationFiletime: creation,
      parentCreationFiletime: parent,
    };
  }
  const outer = receipt(1001, "100100", true);
  const files = {
    "jobs/full-source-operation/receipt.json": outer,
    "full-source-launcher-result.json": {
      success: true,
      sdkBuilt: false,
      ownPid: "CHILD_PID",
      ownCreationFiletime: "888888",
      parentCreationFiletime: "777777",
      originalOperationJob: outer,
    },
    "full-source-closed-launcher.json": closed("CHILD_PID", "888888", "777777"),
    "full-source-closed-full-source-operation.json": closed(
      1001,
      "100100",
      "888888",
    ),
  };
  const jobs = [];
  for (const [index, role] of roles.entries()) {
    const value = receipt(
      2001 + index,
      String(200100 + index),
      role === "full-sdk-source-gn",
    );
    jobs.push({ role, originalJob: value });
    files[`jobs/${role}/receipt.json`] = value;
    if (role !== "full-sdk-source-gn")
      files[`full-source-closed-${role}.json`] = closed(
        value.rootPid,
        value.rootCreationFiletime,
        outer.rootCreationFiletime,
      );
  }
  files["full-source-closed-verify-setup.json"] = closed(
    9001,
    "900100",
    jobs.at(-1).originalJob.rootCreationFiletime,
  );
  files["full-source-operation-result.json"] = {
    kind: "windows-arm-full-source-operation",
    success: true,
    sourceGnVerified: true,
    sdkBuilt: false,
    buildAdmission: false,
    jobs,
  };
  files["full-source-gn-result.json"] = {
    kind: "windows-arm-source-gn",
    success: true,
    target: "aarch64-pc-windows-msvc",
    sourceId,
    sourceCloseFailure: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    engineCompilationRequested: false,
    outerJobCleanupNotInferred: true,
    graph,
  };
  files["full-metadata-result.json"] = metadataData.report;
  const producerInputs = [],
    rawFiles = {};
  for (const name of [
    "private-qualification-profile.json",
    "engine-qualification-profile.json",
    "expected-defaults.mjs",
    "profile.json",
  ]) {
    const raw = await fs.readFile(path.join(root, prefix, name)),
      index = producerInputs.length;
    producerInputs.push({
      path: prefix + name,
      bytes: raw.length,
      sha256: sha(raw),
    });
    rawFiles["source-inputs/" + index] = raw.toString("base64");
  }
  for (const [name, raw] of [
    [
      "private-qualification-logs/qual-gn-desc-pa.stdout.log",
      metadataData.observed.gnDescPartitionAlloc,
    ],
    [
      "private-qualification-logs/qual-gn-desc-cef.stdout.log",
      metadataData.observed.gnDescCef,
    ],
    [
      "private-qualification-logs/qual-gn-args.stdout.log",
      metadataData.observed.gnArgs,
    ],
    [
      "source-checkout/src/out/Release_GN_arm64/gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
      metadataData.observed.files.partitionAlloc.raw,
    ],
    [
      "source-checkout/src/out/Release_GN_arm64/gen/cef/include/cef_config.h",
      metadataData.observed.files.cefConfig.raw,
    ],
  ])
    rawFiles[name] = raw.toString("base64");
  if (mode === "wrong-module-saved")
    rawFiles["source-inputs/2"] =
      Buffer.from("wrong fixed module").toString("base64");
  if (mode === "wrong-module-pin") producerInputs[2].sha256 = "f".repeat(64);
  const baseProfile = JSON.parse(
      await fs.readFile(path.join(root, prefix, "profile.json")),
    ),
    installedPaths = {
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
    };
  const installedRows = baseProfile.installedMsvc14
    .map((pin) => ({
      bytes: pin.bytes,
      path: installedPaths[pin.role],
      sha256: pin.sha256,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files["installed-source-inventory.json"] = {
    kind: "windows-arm-full-installed-source-inventory",
    roots: [
      "include",
      "atlmfc/include",
      "lib/x64",
      "lib/arm64",
      "atlmfc/lib/x64",
      "atlmfc/lib/arm64",
      "bin/Hostx64/x64",
      "bin/Hostx64/arm64",
    ],
    files: installedRows,
    bytes: installedRows.reduce((n, row) => n + row.bytes, 0),
    visited: installedRows.length,
    sha256: sha(JSON.stringify(installedRows)),
    executed: false,
    previous14AreCompleteClosure: false,
  };
  files.__rawFiles = rawFiles;
  const payload = Buffer.from(JSON.stringify(files));
  await fs.writeFile(path.join(base, "fixture-payload.json"), payload);
  const program = `const fs=require('node:fs'),path=require('node:path');const root=process.argv[1],mode=process.argv[2];
  if(mode==='nonzero')process.exit(7);
  if(mode==='nonzero-hostile'){process.stderr.write('SECRET_TOKEN private/source/path\\n');process.exit(7);}
  function run(){const files=JSON.parse(fs.readFileSync(path.join(root,'fixture-payload.json'),'utf8'));
    function bind(value){if(value==='CHILD_PID')return process.pid;if(Array.isArray(value))return value.map(bind);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v)]));return value;}
    if(mode==='bad-job')files['jobs/full-sdk-source-gn/receipt.json'].logReadersStopped=false;
    if(mode==='missing-close')delete files['full-source-closed-verify-setup.json'];
    const rawFiles=files.__rawFiles;delete files.__rawFiles;
    if(mode==='wrong-source')files['full-metadata-result.json'].sourceId='f'.repeat(64);
    if(mode==='wrong-report')files['full-metadata-result.json'].partitionAllocMacros={};
    if(mode==='wrong-header')rawFiles['source-checkout/src/out/Release_GN_arm64/gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h']=Buffer.from('invalid header').toString('base64');
    for(const [name,value]of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(bind(value)));}
    for(const [name,value]of Object.entries(rawFiles)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(value,'base64'));}
    process.stdout.write('created-fixed-fixture\\n');
    if(mode==='held-pipe'){require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},200)'],{stdio:['ignore',process.stdout,process.stderr],windowsHide:true});}
  }
  if(mode==='wait')setTimeout(run,2000);else run();`;
  const context = Buffer.from('{"fixture":"non-production"}\n');
  await fs.writeFile(path.join(base, "context.json"), context);
  const rootFence = [];
  for (let current = base; ; current = path.dirname(current)) {
    rootFence.unshift({
      path: current,
      identity: api.operationDirectoryId(
        await fs.lstat(current, { bigint: true }),
      ),
    });
    if (current === path.dirname(current)) break;
  }
  const ownerPath = path.join(base, "owner.bin");
  const ownerFd = await fs.open(ownerPath, "wx+");
  await ownerFd.writeFile(randomBytes(32));
  const ownerIdentity = api.fileId(await ownerFd.stat({ bigint: true }));
  const state = {
    bootstrap,
    lease: owner.lease,
    root: base,
    rootFence,
    owner: ownerFd,
    ownerPath,
    ownerIdentity,
    rootIdentity: api.directoryId(await fs.lstat(base, { bigint: true })),
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
    sourceWallEnd: Date.now() + 600000,
    sourceMonoEnd: performance.now() + 600000,
    plan: Object.freeze({
      executable: process.execPath,
      argv: Object.freeze(["-e", program, base, mode]),
      environment: Object.freeze({
        SystemRoot: process.env.SystemRoot ?? "C:/Windows",
        PATH: process.env.SystemRoot
          ? path.join(process.env.SystemRoot, "System32")
          : "/usr/bin",
      }),
      image: mode === "wrong-image" ? "20261021.278.1" : "20261030.294.1",
      sourceId,
      profileSha256:
        "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",
      parentCreationFiletime: "777777",
      producerInputs: Object.freeze(
        producerInputs.map((row) => Object.freeze(row)),
      ),
      rootPins: Object.freeze([
        {
          relative: "context.json",
          bytes: context.length,
          sha256: sha(context),
        },
        {
          relative: "fixture-payload.json",
          bytes: payload.length,
          sha256: sha(payload),
        },
      ]),
    }),
  };
  // Only this lexical fixture's operation map is seeded. Its sourceSessions map
  // can be populated only by the real creation path, never a fake receipt setter.
  api.sourceOperations.set(token, state);
  owner.operation = token;
  t.after(() => api.retireSourceOperation(token));
  return { api, bootstrap, owner, token, state, base };
}
async function untilCreated(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < end, "bounded creation wait");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test("inactive full SDK created source real child joins kernel models and FDs before actual fresh helper", async (t) => {
  let f,
    prepares = 0;
  f = await createdSourceFixture(t, "normal", {
    custom: {
      ...controlCustom,
      async prepareSourceGitIsolation(...args) {
        assert.equal(f.state.creationJoined, true);
        assert.equal(f.state.childEvents.close, true);
        assert.equal(f.state.pendingWriters, 0);
        assert.equal(f.state.logFds.size, 0);
        assert.equal(f.state.readFds.size, 0);
        prepares++;
        return controlCustom.prepareSourceGitIsolation(...args);
      },
    },
  });
  const receipt = await f.api.runSourcePhase(f.token);
  assert(f.state.child instanceof ChildProcess);
  assert.equal(f.state.creationPid, f.state.child.pid);
  assert.equal(f.state.issued, true);
  assert.equal(prepares, 0);
  await assert.rejects(
    f.api.createControl({ ...receipt }, f.owner.lease),
    /SOURCE_SESSION/,
  );
  const control = await f.api.createControl(receipt, f.owner.lease);
  await f.api.prepareFreshPolicy(control);
  assert.equal(prepares, 1);
  await f.api.retireControl(control);
});
test("inactive full SDK created source root exit alone cannot issue before actual pipe closes", async (t) => {
  const f = await createdSourceFixture(t, "held-pipe");
  let settled = false;
  const pending = f.api.runSourcePhase(f.token).finally(() => {
    settled = true;
  });
  await untilCreated(() => f.state.childEvents?.exit);
  assert.equal(f.state.childEvents.code, 0);
  assert.equal(f.state.sourceReceipt, undefined);
  assert.equal(settled, false);
  await pending;
  assert.equal(f.state.childEvents.stdout, true);
  assert.equal(f.state.childEvents.stderr, true);
});
test("inactive full SDK created source denies nonzero missing native close and unjoined kernel outcome", async (t) => {
  for (const mode of ["nonzero", "missing-close", "bad-job"]) {
    const f = await createdSourceFixture(t, mode);
    await assert.rejects(f.api.runSourcePhase(f.token));
    assert.equal(f.state.sourceReceipt, undefined);
    assert.equal(f.state.closed, true);
    assert.equal(f.api.sourceOperations.has(f.token), false);
    assert.equal(f.state.readFds.size, 0);
    assert.equal(f.state.logFds.size, 0);
  }
});
test("inactive full SDK created source abort keeps falsy primary and cannot publish late child records", async (t) => {
  const f = await createdSourceFixture(t, "wait");
  const pending = f.api.runSourcePhase(f.token);
  await untilCreated(() => f.state.childEvents?.spawn);
  f.owner.cancel.abort(false);
  await assert.rejects(pending, (error) => error === false);
  assert.equal(f.state.sourceReceipt, undefined);
  assert.equal(f.state.closed, true);
  assert.equal(f.state.childEvents.close, true);
  assert.equal(f.state.pendingWriters, 0);
});
test("inactive full SDK created source receipt replacement denies before fresh issuer", async (t) => {
  let prepares = 0;
  const f = await createdSourceFixture(t, "normal", {
    custom: {
      ...controlCustom,
      prepareSourceGitIsolation() {
        prepares++;
        throw Error("MUST_NOT_PREPARE");
      },
    },
  });
  const receipt = await f.api.runSourcePhase(f.token);
  await fs.appendFile(
    path.join(f.base, "jobs/full-sdk-source-gn/receipt.json"),
    " ",
  );
  const control = await f.api.createControl(receipt, f.owner.lease);
  await assert.rejects(
    f.api.prepareFreshPolicy(control),
    /SOURCE_RECORD_PIN|SOURCE_RECEIPT_REPLACED|SOURCE_RECORD_BOUND/,
  );
  assert.equal(prepares, 0);
  await assert.rejects(f.api.retireControl(control));
});
test("full SDK bootstrap captures original six hour ends and denies expiry before factory IO", async () => {
  let wall = 1000,
    mono = 0,
    io = 0;
  const api = await inactiveControl({
    Date: { now: () => wall },
    performance: { now: () => mono },
    fs: {
      ...fs,
      readFile() {
        io++;
        throw Error("MUST_NOT_IO");
      },
    },
  });
  const bootstrap = api.beginFullSdkBootstrap(),
    owner = api.bootstrapState(bootstrap),
    lease = api.leases.get(owner.lease);
  assert.equal(lease.wallEnd, 21601000);
  assert.equal(lease.monoEnd, 21600000);
  wall += 21600001;
  mono += 21600001;
  assert.equal(lease.wallEnd, 21601000);
  assert.equal(lease.monoEnd, 21600000);
  await assert.rejects(api.runFullSdkTransaction(bootstrap), /DEADLINE/);
  assert.equal(io, 0);
});

test("inactive full SDK created source log FD close failure denies session after actual child exit", async (t) => {
  const primary = Error("MODELED_LOG_CLOSE_DENIED");
  let physicallyClosed = false;
  const f = await createdSourceFixture(t, "normal", {
    fs: {
      ...fs,
      async open(name, ...args) {
        const fd = await fs.open(name, ...args);
        if (path.basename(name) === "source-launcher.stdout.log") {
          const close = fd.close.bind(fd);
          fd.close = async () => {
            if (!physicallyClosed) {
              await close();
              physicallyClosed = true;
            }
            throw primary;
          };
        }
        return fd;
      },
    },
  });
  await assert.rejects(
    f.api.runSourcePhase(f.token),
    (error) => error === primary,
  );
  assert.equal(physicallyClosed, true);
  assert.equal(f.state.childEvents.close, true);
  assert.equal(f.state.sourceReceipt, undefined);
  assert.equal(f.state.closed, true);
  assert.equal(f.state.cleanupConfirmed, false);
  assert.equal(
    f.state.owner,
    null,
    "other owned FDs still close after the log-close denial",
  );
});

async function unlaunchedClockFixture(t) {
  const { PassThrough } = await import("node:stream");
  const child = new ChildProcess();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let wall = 1000,
    mono = 0,
    kills = 0,
    unrefs = 0;
  child.kill = () => {
    kills++;
    return false;
  };
  const unref = child.unref.bind(child);
  child.unref = () => {
    unrefs++;
    return unref();
  };
  const timer = (callback, ms) =>
    setTimeout(
      () => {
        wall += ms;
        mono += ms;
        callback();
      },
      ms > 1000 ? 8 : Math.max(0, ms),
    );
  const overrides = {
    spawn: () => child,
    Date: { now: () => wall },
    performance: { now: () => mono },
    setTimeout: timer,
  };
  const api = await inactiveControl(overrides),
    bootstrap = api.beginFullSdkBootstrap(),
    owner = api.bootstrapState(bootstrap);
  const lease = api.leases.get(owner.lease);
  // Isolated map only: shorten both original ends once, preserving the existing
  //150000ms reserve. Production cannot import this fixture or rewrite its lease.
  lease.wallEnd = wall + 150020;
  lease.monoEnd = mono + 150020;
  t.after(() => {
    child.stdout.destroy();
    child.stderr.destroy();
    child._handle?.close();
    child._handle = null;
  });
  return {
    api,
    bootstrap,
    owner,
    lease,
    child,
    overrides,
    get kills() {
      return kills;
    },
    get unrefs() {
      return unrefs;
    },
    advance(ms) {
      wall += ms;
      mono += ms;
    },
  };
}
test("inactive full SDK fixed clock no close returns finite unknown and releases owned observation", async (t) => {
  for (const knownExit of [false, true]) {
    const f = await unlaunchedClockFixture(t),
      started = Date.now();
    const pending = f.api.samplePythonClock(f.bootstrap, "fixed-python", {});
    if (knownExit) f.child.emit("exit", 0, null);
    await assert.rejects(pending, /CLOCK_DEADLINE/);
    assert(Date.now() - started < 1000);
    assert.equal(f.kills, knownExit ? 0 : 1);
    assert.equal(f.unrefs, 1);
    assert.equal(f.owner.clockProbe.joined, false);
    assert.equal(f.owner.clockProbe.cleanupConfirmed, false);
    assert.equal(f.owner.clockProbe.dataAccepted, false);
    assert.equal(f.owner.clockProbe.child, null);
    assert.equal(f.child.stdout.destroyed, true);
    assert.equal(f.child.stderr.destroyed, true);
    f.child.emit("close", 0, null);
    await Promise.resolve();
    assert.equal(
      f.owner.clockProbe.joined,
      false,
      "late close cannot promote a retired observation",
    );
  }
});
test("inactive full SDK fixed clock late close preserves deadline and never returns late data", async (t) => {
  const f = await unlaunchedClockFixture(t);
  const pending = f.api.samplePythonClock(f.bootstrap, "fixed-python", {});
  setTimeout(() => {
    f.child.stdout.write(
      JSON.stringify({
        monotonic: 1,
        parentPid: process.pid,
        parentCreationFiletime: "1",
      }),
    );
    f.child.emit("exit", 0, null);
    f.child.stdout.destroy();
    f.child.stderr.destroy();
    f.child.emit("close", 0, null);
  }, 23);
  await assert.rejects(pending, /CLOCK_DEADLINE/);
  assert.equal(f.owner.clockProbe.failed, true);
  assert.equal(f.owner.clockProbe.dataAccepted, false);
  assert.equal(f.owner.clockProbe.joined, true);
  assert.equal(f.owner.clockProbe.cleanupConfirmed, true);
});
test("inactive full SDK fixed clock cap discards bytes and preserves first bound failure", async (t) => {
  const f = await unlaunchedClockFixture(t);
  const pending = f.api.samplePythonClock(f.bootstrap, "fixed-python", {});
  f.child.stdout.write(Buffer.alloc(4096));
  f.child.stdout.write(Buffer.alloc(32768));
  f.child.stderr.write(Buffer.alloc(32768));
  await assert.rejects(pending, /CLOCK_BOUND/);
  assert.equal(f.owner.clockProbe.stdoutBytes, 2048);
  assert.equal(f.owner.clockProbe.stderrBytes, 0);
  assert.equal(f.owner.clockProbe.joined, false);
  assert.equal(f.owner.clockProbe.cleanupConfirmed, false);
});
test("inactive full SDK fixed clock spawn error preserves falsy primary without close", async (t) => {
  for (const primary of [false, Error("MODELED_SPAWN_ERROR")]) {
    const f = await unlaunchedClockFixture(t);
    const pending = f.api.samplePythonClock(f.bootstrap, "fixed-python", {});
    f.child.emit("error", primary);
    await assert.rejects(pending, (error) => error === primary);
    assert.equal(f.owner.clockProbe.primary, primary);
    assert.equal(f.owner.clockProbe.joined, false);
    assert.equal(f.owner.clockProbe.cleanupConfirmed, false);
    assert.equal(f.owner.clockProbe.retired, true);
  }
});
test("inactive full SDK unconfirmed source retirement releases only owned resources without a join", async (t) => {
  for (const knownExit of [false, true]) {
    const c = await unlaunchedClockFixture(t);
    const f = await createdSourceFixture(t, "normal", c.overrides);
    const lease = f.api.leases.get(f.owner.lease);
    // Capture a short original model lease before the actual creator path.
    lease.wallEnd = 1020 + 150000;
    lease.monoEnd = 20 + 150000;
    f.state.stdoutFd = await fs.open(
      path.join(f.base, "retirement.stdout.log"),
      "wx",
    );
    f.state.stderrFd = await fs.open(
      path.join(f.base, "retirement.stderr.log"),
      "wx",
    );
    f.state.logFds.add(f.state.stdoutFd);
    f.state.logFds.add(f.state.stderrFd);
    let foreignCloses = 0;
    const foreignClose = () => foreignCloses++;
    c.child.on("close", foreignClose);
    assert.equal(f.api.startSourceChild(f.token), c.child);
    if (knownExit) c.child.emit("exit", 0, null);
    f.state.failed = true;
    f.state.primary = false;
    c.advance(30015);
    await f.api.retireSourceOperation(f.token);
    assert.equal(f.state.primary, false);
    assert.equal(f.state.cleanupConfirmed, false);
    assert.equal(f.state.childEvents.close, false);
    assert.equal(f.state.creationJoined, false);
    assert.equal(f.state.child, null);
    assert.equal(f.state.owner, null);
    assert.equal(f.state.ownedListeners.length, 0);
    assert.equal(c.child.stdout.destroyed, true);
    assert.equal(c.child.stderr.destroyed, true);
    assert.equal(c.kills, knownExit ? 0 : 1);
    assert.equal(c.unrefs, 1);
    c.child.emit("close", 0, null);
    assert.equal(foreignCloses, 1);
    assert.equal(f.state.childEvents.close, false);
    assert.equal(f.state.cleanupConfirmed, false);
    assert.equal(f.state.sourceReceipt, undefined);
  }
});

// c9 portable primary-source replay: data generator only; no GN/compiler/vendor process.
const fullCarryDriver =
  await import("../../native/windows-arm-full-sdk/full-sdk-source-driver.mjs");
const { spawnSync } = await import("node:child_process");
test("inactive full SDK bootstrap requires privately bound full profile root context pin and original budget", async () => {
  const raw = assemblyInverse(
    await read(prefix + "full-sdk-source-driver.mjs"),
    "driver",
  );
  const body = raw
    .split("// BEGIN CLOSED FULL SDK SOURCE BODY\n")[1]
    .split("// END CLOSED FULL SDK SOURCE BODY\n")[0];
  const bootstrap = raw
    .slice(
      raw.indexOf("export function bootstrapProgram("),
      raw.indexOf("export async function prepareBootstrap("),
    )
    .trim()
    .replace(/^export /, "");
  let remaining = 1000,
    checks = 0;
  const api = new Function(
    "need",
    "sourcePaths",
    "HERE",
    "BOOTSTRAP_SOURCES",
    "CIPD_CLIENT_SHA",
    "VPYTHON_INSTANCE",
    "Buffer",
    "PRIVATE_DRIVER_ADMITTED",
    body +
      bootstrap +
      "\nreturn {bootstrapProgram,fullSourceProfiles,fullBootstrapAuthority};",
  )(
    (value, code) => assert(value, code),
    () => ({ depot: "depot", commands: "commands", workspace: "workspace" }),
    "native",
    [],
    "a".repeat(64),
    "instance",
    Buffer,
    false,
  );
  const context = {
    kind: "windows-arm-full-sdk-context",
    mode: "full-sdk-source-gn",
    workflow: ".github/workflows/windows-arm-full-sdk.yml",
    policy: "native/windows-arm-full-sdk/sdk-origin-review.json",
    ref: "refs/heads/main",
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    visibility: "public",
    event: "workflow_dispatch",
    defaultBranch: "main",
    head: "a".repeat(40),
    workflowSha: "a".repeat(40),
    runId: "1",
    attempt: "1",
    inputs: {},
    image: "20261030.294.1",
  };
  const recipe = {
    image: context.image,
    python: { path: "fixed" },
    sourceGn: { executionPolicy: { sync: true } },
    sourceChromium: "b".repeat(40),
  };
  // This separate map models binding only; the production map is inaccessible.
  const state = {
    root: "owned",
    context,
    contextPin: "c".repeat(64),
    budget: {
      remaining() {
        checks++;
        assert(remaining > 0, "ORIGINAL_EXPIRED");
        return remaining;
      },
    },
  };
  assert.equal(
    api.fullBootstrapAuthority("owned", recipe, state.contextPin),
    null,
  );
  api.fullSourceProfiles.set(recipe, state);
  assert.equal(
    api.fullBootstrapAuthority("owned", recipe, state.contextPin),
    state,
  );
  for (const [root, pin] of [
    ["replacement", state.contextPin],
    ["owned", "d".repeat(64)],
  ])
    assert.throws(() => api.bootstrapProgram(root, recipe, pin), /BINDING/);
  assert.equal(
    api.fullBootstrapAuthority("owned", { ...recipe }, state.contextPin),
    null,
  );
  const emitted = api
    .bootstrapProgram("owned", recipe, state.contextPin)
    .toString();
  const packet = JSON.parse(
    JSON.parse(emitted.match(/^P=json.loads\((.+)\)$/m)[1]),
  );
  assert.deepEqual(packet.fullContext, context);
  assert.equal(packet.enabled, false); // Real closed constant was never replaced in this fixture.
  assert.equal(packet.fullContext.mode, "full-sdk-source-gn");
  assert.equal(recipe.privatePolicy, undefined);
  assert(emitted.includes("value==P['fullContext']"));
  remaining = 0;
  assert.throws(
    () => api.bootstrapProgram("owned", recipe, state.contextPin),
    /ORIGINAL_EXPIRED/,
  );
  remaining = 1000;
  context.ref = "refs/heads/old";
  assert.throws(
    () => api.bootstrapProgram("owned", recipe, state.contextPin),
    /FULL_SDK_SOURCE_CONTEXT/,
  );
  context.ref = "refs/heads/main";
  api.fullSourceProfiles.delete(recipe);
  assert.equal(
    api.fullBootstrapAuthority("owned", recipe, state.contextPin),
    null,
  );
  assert(checks >= 3);
  // Exported production entry rejects an inexact vector before any IO.
  assert.throws(
    () => fullCarryDriver.fullSdkSourceMain([]),
    /FULL_DRIVER_ARGV/,
  );
});

async function projectionFixturePython() {
  try {
    const raw = await fs.readFile(profile.python.path);
    assert.equal(raw.length, profile.python.bytes);
    assert.equal(sha(raw), profile.python.sha256);
    return profile.python.path;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert(
      process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true",
      "Hosted Windows projection fixture requires the pinned Python",
    );
    return process.platform === "win32" ? "python" : "python3";
  }
}

// Complete, unchanged CEF tools/gn_args.py at 682c378d70d5780061e96644dca16ddd8fd157a9.
// Deflate only transports the pinned primary source; no network or vendor process.
const pinnedCefGnArgsDeflate =
  "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";
const gnArgumentProjectionFixture = String.raw`import ast,base64,contextlib,hashlib,importlib,io,json,os,pathlib,sys,tempfile,zlib
packet=json.loads(sys.stdin.read(65537))
raw=zlib.decompress(base64.b64decode(packet['source']))
assert len(raw)==26541 and hashlib.sha256(raw).hexdigest()=='ab94e3b3c214198b396c8b4858b5d5e9cb42be956bbc294d651dd86eac44df6e'
results=[]
class NativeFailure(Exception):pass
for case in packet['cases']:
 with tempfile.TemporaryDirectory(prefix='cef-gn-data-') as folder:
  workspace=pathlib.Path(folder).resolve(strict=True);tools=workspace/'source-checkout/src/cef/tools';tools.mkdir(parents=True)
  source=tools/'gn_args.py';source.write_bytes(raw)
  if case=='source-drift':source.write_bytes(raw+b'\n')
  vs=workspace/'custom-vs';(vs/'VC').mkdir(parents=True);(vs/'VC/vcvarsall.bat').write_text('')
  sdk=dict(visual_studio_path=str(vs),visual_studio_version='2026',visual_studio_runtime_dirs=str(workspace/'runtime/x64'),windows_sdk_path=str(workspace/'Windows Kits/10'),windows_sdk_version='10.0.28000.0')
  fixed={}
  for line in packet['fixed'].splitlines():
   key,value=line.split('=',1);fixed[key]=True if value=='true' else False if value=='false' else ast.literal_eval(value)
  definitions=' '.join("'"+key+'='+('true' if value is True else 'false' if value is False else json.dumps(value))+"'" for key,value in fixed.items())
  saved_env=dict(os.environ);saved_path=list(sys.path);saved_platform=sys.platform
  sys.path.insert(0,str(tools));sys.modules.pop('gn_args',None);sys.platform='win32'
  os.environ.update(GN_DEFINES=definitions,GN_OUT_CONFIGS='Release_GN_arm64',CEF_ENABLE_ARM64='1',DEPOT_TOOLS_WIN_TOOLCHAIN='0',GYP_MSVS_OVERRIDE_PATH=str(vs),GYP_MSVS_VERSION='2026',CEF_VCVARS='none',VS_CRT_ROOT=sdk['visual_studio_runtime_dirs'],SDK_ROOT=sdk['windows_sdk_path'],SDK_VERSION=sdk['windows_sdk_version'])
  scope={'os':os,'sys':sys,'hook':str(tools/'gclient_hook.py')};calls=[];error=None;error_location=None;output=None;before=dict(sdk)
  def profile(frame,event,value):
   if frame.f_code.co_filename!=str(source):return
   if frame.f_code.co_name=='GetConfigArgs' and event=='return':
    selected=frame.f_locals.get('cpu')=='arm64' and frame.f_locals.get('is_debug') is False
    if selected and case=='native-failure':raise NativeFailure('')
    if selected and case=='native-extra':value['unexpected']=True
    if selected and case=='native-other-drift':value['symbol_level']=2
    if selected and case=='native-tracer-drift':value['enable_backup_ref_ptr_instance_tracer']=False
    if selected and case=='native-type-drift':value['enable_rlz']=1
    if selected and case=='input-mutation':sdk['unexpected']=True
    calls.append(dict(cpu=frame.f_locals['cpu'],debug=frame.f_locals['is_debug'],result=dict(value)))
  try:
   with contextlib.redirect_stdout(io.StringIO()):
    if case=='baseline':
     native=importlib.import_module('gn_args');sys.setprofile(profile)
     try:output=native.GetAllPlatformConfigs(sdk)
     finally:sys.setprofile(None)
    else:
     if case=='function-drift':
      native=importlib.import_module('gn_args');native.GetConfigArgs=lambda *args:None
     exec(packet['program'],scope)
     native=scope['gn_args']
     if case in ('explicit-true','component','debug','cpu','numeric-false'):
      changed=dict(fixed)
      if case=='explicit-true':changed['enable_backup_ref_ptr_instance_tracer']=True
      elif case=='component':changed['is_component_build']=True
      elif case=='debug':changed['is_debug']=True
      elif case=='cpu':changed['target_cpu']='x64'
      else:changed['enable_backup_ref_ptr_instance_tracer']=0
      os.environ['GN_DEFINES']=' '.join("'"+key+'='+('true' if value is True else 'false' if value is False else json.dumps(value))+"'" for key,value in changed.items())
     if case=='other-selection':os.environ['GN_OUT_CONFIGS']='Release_GN_x64'
     if case=='sdk':sdk['windows_sdk_version']='10.0.28000.1'
     if case=='input-extra':sdk['unexpected']=True
     sys.setprofile(profile)
     try:output=native.GetAllPlatformConfigs(sdk)
     finally:sys.setprofile(None)
     if case=='repeat':native.GetAllPlatformConfigs(sdk)
  except BaseException as caught:
   error='EMPTY_NATIVE_FAILURE' if type(caught)is NativeFailure and str(caught)=='' else str(caught)
   location=caught.__traceback__
   while location.tb_next is not None:location=location.tb_next
   error_location=[location.tb_frame.f_code.co_name,location.tb_lineno]
  finally:
   sys.setprofile(None);sys.platform=saved_platform;sys.path[:]=saved_path;os.environ.clear();os.environ.update(saved_env);sys.modules.pop('gn_args',None)
  serialized=native.GetConfigFileContents(output['Release_GN_arm64']) if error is None and output is not None else None
  results.append(dict(case=case,error=error,errorLocation=error_location,calls=calls,inputUnchanged=sdk==before,output=output,serialized=serialized,modeledWindowsHost=True,nativeGnExecuted=False,compilerExecuted=False))
print(json.dumps(results))`;

async function gnArgumentProjectionCases(driver, cases) {
  const args = driver.boundGnArguments(
    [
      "-B",
      "-c",
      "unchanged-hook",
      "fixed-cef/tools/gclient_hook.py",
      "fixed-depot/gn.py",
    ],
    "fixed-gn.exe",
    {
      bytes: 2601472,
      sha256:
        "e398eefd1241ad44e98aececa6a260abac0fdcb80f41c23176944ad3f0e76486",
    },
  );
  const begin = args[2].indexOf("# BEGIN fixed ARM64 GN argument projection\n");
  const end = args[2].indexOf(
    "# END fixed ARM64 GN argument projection\n",
    begin,
  );
  assert(begin > 0 && end > begin);
  const program = args[2].slice(begin, end);
  const fixed = (
    await read(
      "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn",
    )
  )
    .toString()
    .trim();
  const result = spawnSync(
    await projectionFixturePython(),
    ["-I", "-B", "-c", gnArgumentProjectionFixture],
    {
      cwd: root,
      input: JSON.stringify({
        source: pinnedCefGnArgsDeflate,
        program,
        fixed,
        cases,
      }),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

test("inactive full SDK fixed ARM64 GN projection runs actual pinned native six-config generator: old RED, only selected tracer GREEN, neighboring native configurations unchanged", async () => {
  for (const driver of [fullCarryDriver]) {
    const [before, after] = await gnArgumentProjectionCases(driver, [
      "baseline",
      "positive",
    ]);
    assert.equal(before.error, null);
    assert.equal(after.error, null, JSON.stringify(after.errorLocation));
    assert.equal(
      before.output.Release_GN_arm64.enable_backup_ref_ptr_instance_tracer,
      true,
    );
    assert.equal(
      after.output.Release_GN_arm64.enable_backup_ref_ptr_instance_tracer,
      false,
    );
    assert.throws(
      () => driver.validateGeneratedArguments(Buffer.from(before.serialized)),
      /FULL_GN_CRITICAL_ARGUMENT/,
    );
    assert.equal(
      driver.validateGeneratedArguments(Buffer.from(after.serialized))
        .criticalArgumentsVerified,
      true,
    );
    assert.equal(before.calls.length, 6);
    assert.equal(after.calls.length, 6);
    const selected = after.calls.filter(
      (x) => x.cpu === "arm64" && x.debug === false,
    );
    assert.equal(selected.length, 1);
    assert.equal(
      selected[0].result.enable_backup_ref_ptr_instance_tracer,
      true,
    );
    // Dynamic SDK roots differ between independently owned fixtures.
    const stable = (calls) =>
      calls.map((x) => ({
        ...x,
        result: Object.fromEntries(
          Object.entries(x.result).filter(
            ([key]) =>
              ![
                "visual_studio_path",
                "visual_studio_runtime_dirs",
                "windows_sdk_path",
              ].includes(key),
          ),
        ),
      }));
    assert.deepEqual(stable(before.calls), stable(after.calls));
    assert.equal(after.inputUnchanged, true);
    assert.equal(after.modeledWindowsHost, true);
    assert.equal(after.nativeGnExecuted, false);
    assert.equal(after.compilerExecuted, false);
    const actual = {
      ...after.output.Release_GN_arm64,
      enable_backup_ref_ptr_instance_tracer: true,
    };
    assert.deepEqual(actual, selected[0].result);
  }
});

test("inactive full SDK fixed ARM64 GN projection denies near arguments, source/output/input drift and repeats, preserving actual first native failure", async () => {
  const cases = [
    "explicit-true",
    "component",
    "debug",
    "cpu",
    "numeric-false",
    "other-selection",
    "sdk",
    "input-extra",
    "native-extra",
    "native-other-drift",
    "native-tracer-drift",
    "native-type-drift",
    "input-mutation",
    "source-drift",
    "function-drift",
    "repeat",
    "native-failure",
  ];
  const errors = [
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "ARGUMENTS",
    "SELECTION",
    "INPUT",
    "INPUT",
    "OUTPUT",
    "OUTPUT",
    "OUTPUT",
    "OUTPUT",
    "INPUT",
    "SOURCE",
    "FUNCTION",
    "SELECTION",
    "EMPTY_NATIVE_FAILURE",
  ];
  for (const driver of [fullCarryDriver]) {
    const values = await gnArgumentProjectionCases(driver, cases);
    for (const [index, value] of values.entries()) {
      assert.equal(
        value.error,
        errors[index] === "EMPTY_NATIVE_FAILURE"
          ? errors[index]
          : "FULL_GN_PROJECTION_" + errors[index],
        value.case + JSON.stringify(value.errorLocation),
      );
      assert.equal(value.nativeGnExecuted, false);
      assert.equal(value.compilerExecuted, false);
    }
  }
});

async function fullMetadataFixture(options = {}) {
  const source = await read(prefix + "full-sdk-source-driver.mjs");
  const { default: ts } = await import("typescript");
  const ast = ts.createSourceFile(
    "fixture.mjs",
    source,
    99,
    true,
    ts.ScriptKind.JS,
  );
  const fn = (name) =>
    ast.statements
      .find((row) => ts.isFunctionDeclaration(row) && row.name?.text === name)
      .getText(ast)
      .replace(/^export /, "");
  const block = (begin, end) => source.split(begin + "\n")[1].split(end)[0];
  const joined = block(
    "// BEGIN INACTIVE JOINED OBSERVATION PRIMITIVES",
    "// END INACTIVE JOINED OBSERVATION PRIMITIVES",
  ).replace(
    'import { fstatSync as qualificationFdStat } from "node:fs";\n',
    "",
  );
  const pure = block(
    "// BEGIN INACTIVE PURE QUALIFICATION INSPECTORS",
    "// END INACTIVE PURE QUALIFICATION INSPECTORS",
  );
  const coordinator = block(
    "// BEGIN INACTIVE SOURCE OWNED COORDINATOR",
    "// END INACTIVE SOURCE OWNED COORDINATOR",
  );
  const full = block(
    "// BEGIN CLOSED FULL SDK SOURCE BODY",
    "// END CLOSED FULL SDK SOURCE BODY",
  );
  const recipeRaw = await fs.readFile(
      path.join(root, prefix, "private-qualification-profile.json"),
    ),
    recipe = JSON.parse(recipeRaw),
    candidateRaw = await fs.readFile(
      path.join(root, prefix, "engine-qualification-profile.json"),
    );
  const packetScript = String.raw`import sys,json,base64
sys.path.insert(0,${JSON.stringify(path.join(root, prefix))})
import test_private_qualification as t
def encode(value):
 if type(value)is bytes:return {'__bytes':base64.b64encode(value).decode()}
 if type(value)is dict:return {k:encode(v)for k,v in value.items()}
 if type(value)is list or type(value)is tuple:return [encode(v)for v in value]
 return value
context,observed=t.output_fixture('20261030.294.1')
${await realisticExpectedDefaultsFixtureScript()}
print(json.dumps(encode({'context':context,'observed':observed})))
`;
  const decode = (v) =>
    v &&
    typeof v === "object" &&
    Object.keys(v).length === 1 &&
    Object.hasOwn(v, "__bytes")
      ? Buffer.from(v.__bytes, "base64")
      : Array.isArray(v)
        ? v.map(decode)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, w]) => [k, decode(w)]),
            )
          : v;
  const packet = decode(
    JSON.parse(
      execFileSync(
        await projectionFixturePython(),
        ["-I", "-B", "-c", packetScript],
        {
          encoding: "utf8",
          timeout: 20000,
          windowsHide: true,
          maxBuffer: 16 * 1024 ** 2,
        },
      ),
    ),
  );
  delete packet.observed.files.coff;
  delete packet.observed.files.pe;
  const context = {
    kind: "windows-arm-full-sdk-context",
    mode: "full-sdk-source-gn",
    workflow: ".github/workflows/windows-arm-full-sdk.yml",
    policy: "native/windows-arm-full-sdk/sdk-origin-review.json",
    ref: "refs/heads/main",
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    visibility: "public",
    event: "workflow_dispatch",
    defaultBranch: "main",
    head: "a".repeat(40),
    workflowSha: "a".repeat(40),
    runId: "1",
    attempt: "1",
    inputs: { restore_run: "0" },
    image: "20261030.294.1",
    sources: [],
    wallWorkEnd: Date.now() / 1000 + 1000,
    monotonicWorkEnd: 1000,
  };
  context.sources = [
    {
      path: prefix + "full-sdk-source-driver.mjs",
      bytes: Buffer.byteLength(source),
      sha256: sha(source),
      canonicalBytes: Buffer.byteLength(source),
      canonicalSha256: sha(source),
      encoding: "exact",
    },
  ];
  const modelRoot = packet.context.root;
  let at = 0,
    left = 600000,
    mode = options.mode ?? "none";
  const directory = {
    dev: 1n,
    ino: 1n,
    size: 0n,
    mtimeNs: 0n,
    ctimeNs: 0n,
    birthtimeNs: 1n,
    mode: 0o40700n,
    nlink: 1n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  const calls = [],
    writes = [],
    events = [],
    seenVectors = [],
    mkdirAttempts = [],
    reportAttempts = [];
  const modelFs = {
    mkdir: async () => {
      mkdirAttempts.push({
        retired: api.qualificationSourceOwners.get(owner).retired,
      });
    },
    lstat: async () => ({
      ...directory,
      ino: mode === "post-root-drift" && calls.length === 4 ? 2n : 1n,
    }),
    writeFile: async (file, raw) => {
      reportAttempts.push({
        retired: api.qualificationSourceOwners.get(owner).retired,
      });
      events.push("report");
      writes.push({ file, value: JSON.parse(raw) });
    },
  };
  const argsRaw = packet.observed.files.args.raw;
  const graphPins = [
    { path: "args.gn", bytes: argsRaw.length, sha256: sha(argsRaw) },
    { path: "build.ninja", bytes: 1, sha256: sha(Buffer.from("n")) },
  ];
  const snapshot = {
    kind: "sorng-cef-fresh-graph-pins",
    complete: true,
    pins: graphPins,
    files: 2,
    bytes: argsRaw.length + 1,
    sha256: "e".repeat(64),
  };
  const summary = {
    files: 2,
    visited: 2,
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
  };
  const input = {
    root: modelRoot,
    c: context,
    p: {
      image: context.image,
      sourceGn: { sourceId: recipe.images[context.image].sourceId },
    },
    budget: { remaining: () => left },
    contextSha: "c".repeat(64),
    files: { chromium: modelRoot + "/source-checkout/src" },
    tools: {},
    output: { bytes: 0 },
    custom: { sourceGitEnvironment: async () => ({ MODEL: "data-only" }) },
    gitPolicy: {},
    env: { MODEL: "data-only" },
    privatePolicyRaw: Buffer.from("not private authority"),
    checked: async (action) => action(),
    checkpoint: {
      graphPinSnapshot: JSON.stringify,
      graphInventory: async (_out, args) => {
        args.observePins(snapshot);
        return structuredClone(summary);
      },
    },
  };
  if (mode === "action-invalid")
    packet.observed.gnDescPartitionAlloc = Buffer.from("{}");
  if (mode === "evaluated-invalid") packet.observed.gnArgs = Buffer.from("{}");
  if (mode === "header-invalid")
    packet.observed.files.partitionAlloc.raw = Buffer.from("invalid header");
  const testHooks = {
    observe: async (session, role) => ({ session, role }),
    run: async (session, role) => {
      const state = api.qualificationSessions.get(session);
      state.phase.before(role);
      const vector = api.fullMetadataCommand(state, role);
      seenVectors.push(vector);
      calls.push(role);
      events.push("start:" + role);
      await Promise.resolve();
      if (mode === "unjoined" && state.next === 1) throw 0;
      events.push("joined:" + role);
      state.phase.after(role);
      state.next++;
      state.epoch++;
      if (mode === "expires" && state.next === 3) left = 100000;
    },
    readLog: async (_owner, _session, index) => {
      events.push("read:" + index);
      return [
        packet.observed.gnDescPartitionAlloc,
        packet.observed.gnDescCef,
        packet.observed.gnArgs,
      ][index];
    },
    validate: async () => {
      if (mode === "source-drift") throw Error("SOURCE_DRIFT");
    },
    afterDirectoryFence: (activeOwner) => {
      if (
        (mode === "retire-before-mkdir" && calls.length === 0) ||
        (mode === "retire-before-report" && calls.length === 4)
      )
        queueMicrotask(() =>
          api.retireQualificationSource(activeOwner, true, false),
        );
    },
  };
  const held = async (file) => {
    if (file.endsWith("engine-qualification-profile.json"))
      return Buffer.from(candidateRaw);
    if (file.endsWith("args.gn")) return Buffer.from(argsRaw);
    for (const row of Object.values(packet.observed.files))
      if (file === row.pin.path) return Buffer.from(row.raw);
    throw Error("UNEXPECTED_HELD:" + file);
  };
  const globals = {
    fs: modelFs,
    utilTypes: (await import("node:util")).types,
    path,
    Buffer,
    structuredClone,
    performance: { now: () => at },
    setTimeout,
    clearTimeout,
    createHash,
    sha,
    need: (v, code) => {
      if (!v) throw Error(code);
    },
    REPO: root,
    HERE: path.join(root, prefix),
    TARGET: "aarch64-pc-windows-msvc",
    process: { platform: "win32", arch: "x64" },
    PRIVATE_MODE: recipe.mode,
    PRIVATE_REF: recipe.ref,
    PRIVATE_WORKFLOW: recipe.workflow,
    PRIVATE_ROLES: recipe.qualificationRoles,
    PRIVATE_PROFILE_SHA256: sha(recipeRaw),
    privateCommandProjections: () => {
      throw Error("OLD_IDENTITY_MUST_NOT_RUN");
    },
    held,
    testHooks,
    physical: async (file) => file,
    signature: (s) => [s.dev, s.ino, s.birthtimeNs, s.mode, s.nlink].join(":"),
    qualificationPhaseClock: fullCarryDriver.qualificationPhaseClock,
  };
  const rootDecl = ast.statements
    .find(
      (row) =>
        ts.isVariableStatement(row) &&
        row.declarationList.declarations.some(
          (d) => d.name.text === "PRIVATE_ROOT",
        ),
    )
    .getText(ast);
  let modelSource =
    rootDecl +
    "\n" +
    fn("staticProjectionEqual") +
    "\n" +
    joined +
    "\n" +
    pure +
    "\n" +
    coordinator +
    "\n" +
    full +
    String.raw`
issueActualObservation=testHooks.observe;
runFixedJoined=testHooks.run;
qualificationReadLog=testHooks.readLog;
validateQualificationSource=testHooks.validate;
const actualDirectories=qualificationSourceDirectories;
qualificationSourceDirectories=owner=>actualDirectories(owner).then(value=>{testHooks.afterDirectoryFence(owner);return value;});
return {beginFullMetadataSource,collectQualificationGraph,collectFullQualificationGraph,fullSourceGraphDiagnostic,fullGraphCounts,fullGraphProgress,commitFullMetadataGraph,coordinateFullMetadata,fullMetadataCommand,fullMetadataOwner,fullMetadataContext,fullMetadataInspect,fullMetadataInspectContext,fullMetadataSources,fullMetadataContexts,fullMetadataOwners,fullSourceProfiles,qualificationSessions,qualificationSourceOwners,qualificationSourceRuns,qualificationGraphReceipts,createQualificationSession,retireQualificationSource};
`;
  if (options.omitPostFenceGuards) {
    modelSource = modelSource
      .replaceAll(
        "await qualificationSourceDirectories(owner);\n      fullMetadataOwner(owner);",
        "await qualificationSourceDirectories(owner);",
      )
      .replaceAll(
        "await qualificationSourceDirectories(owner);\n    fullMetadataOwner(owner);",
        "await qualificationSourceDirectories(owner);",
      );
  }
  const api = new Function(...Object.keys(globals), modelSource)(
    ...Object.values(globals),
  );
  const profile = {
    root: modelRoot,
    context,
    contextPin: input.contextSha,
    budget: input.budget,
    metadataRecipeRaw: recipeRaw,
  };
  // Separate private fixture maps are not production/source/Job authority.
  api.fullSourceProfiles.set(input.p, profile);
  const owner = api.beginFullMetadataSource(input);
  return {
    api,
    input,
    profile,
    owner,
    packet,
    recipe,
    recipeRaw,
    candidateRaw,
    calls,
    seenVectors,
    writes,
    events,
    mkdirAttempts,
    reportAttempts,
    setMode: (value) => {
      mode = value;
    },
    expire: () => {
      left = 100000;
      at = 500000;
    },
  };
}

test("inactive full SDK metadata retirement between a real awaited fence and mutation prevents late mkdir or report and preserves false", async () => {
  for (const mode of ["retire-before-mkdir", "retire-before-report"]) {
    for (const omitPostFenceGuards of [true, false]) {
      const f = await fullMetadataFixture({ omitPostFenceGuards });
      await f.api.collectQualificationGraph(f.owner);
      const token = f.api.commitFullMetadataGraph(f.owner);
      f.setMode(mode);
      await assert.rejects(
        f.api.coordinateFullMetadata(token),
        (error) => error === false,
      );
      const attempts =
        mode === "retire-before-mkdir" ? f.mkdirAttempts : f.reportAttempts;
      assert.equal(attempts.length, omitPostFenceGuards ? 1 : 0);
      if (omitPostFenceGuards) assert.equal(attempts[0].retired, true);
      assert.equal(f.calls.length, mode === "retire-before-mkdir" ? 0 : 4);
      assert.equal(f.api.fullMetadataSources.has(token), false);
      assert.equal(f.api.qualificationSourceRuns.has(token), false);
      assert.equal(f.api.fullMetadataOwners.has(f.owner), false);
    }
  }
});

test("inactive full SDK actual four metadata coordinator keeps full authority and stops before clang despite matching61 fixture", async () => {
  const f = await fullMetadataFixture();
  assert.throws(() => f.api.commitFullMetadataGraph(f.owner), /GRAPH_COMMIT/);
  await f.api.collectQualificationGraph(f.owner);
  const token = f.api.commitFullMetadataGraph(f.owner);
  assert.equal(f.api.fullMetadataSources.has(token), true);
  assert.equal(await f.api.coordinateFullMetadata(token), undefined);
  assert.deepEqual(f.calls, f.recipe.qualificationRoles.slice(0, 4));
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].value.completeMacroInventoryMatches, true);
  assert.equal(f.writes[0].value.fullArm64DefaultsQualified, false);
  assert.equal(f.writes[0].value.compilerExecuted, false);
  assert.equal(f.seenVectors[3].argv[2], "--offline");
  assert.equal(f.seenVectors[3].argv[3], "-local_jobs=1");
  assert.equal(f.seenVectors[3].argv.length, 8);
  assert(
    f.events.indexOf("joined:qual-gn-desc-cef") < f.events.indexOf("read:1"),
  );
  assert(
    f.events.indexOf("joined:qual-generate-headers") <
      f.events.lastIndexOf("read:2"),
  );
  assert.equal(f.input.c.mode, "full-sdk-source-gn");
  assert.equal(f.input.c.ref, "refs/heads/main");
  assert.equal(f.input.p.privatePolicy, undefined);
  assert.equal(f.api.fullMetadataSources.has(token), false);
  assert.equal(f.api.qualificationSourceRuns.has(token), false);
  assert.equal(f.api.fullMetadataOwners.has(f.owner), false);
  await assert.rejects(
    f.api.coordinateFullMetadata(token),
    /FULL_METADATA_SOURCE_BINDING/,
  );
});

test("inactive full SDK four metadata source binding denies copied contexts tokens and compiler roles", async () => {
  const f = await fullMetadataFixture();
  assert.throws(
    () => f.api.beginFullMetadataSource({ ...f.input, c: { ...f.input.c } }),
    /SOURCE_BINDING/,
  );
  assert.throws(
    () =>
      f.api.beginFullMetadataSource({ ...f.input, contextSha: "d".repeat(64) }),
    /SOURCE_BINDING/,
  );
  assert.throws(
    () =>
      f.api.beginFullMetadataSource({
        ...f.input,
        root: f.input.root + "-replacement",
      }),
    /SOURCE_BINDING/,
  );
  await assert.rejects(
    f.api.coordinateFullMetadata({ ...f.owner }),
    /SOURCE_BINDING/,
  );
  await f.api.collectQualificationGraph(f.owner);
  const token = f.api.commitFullMetadataGraph(f.owner);
  const session = f.api.createQualificationSession(token),
    state = f.api.qualificationSessions.get(session);
  state.next = 4;
  assert.throws(
    () => f.api.fullMetadataCommand(state, "qual-clang-probe"),
    /ROLE_CLOSED/,
  );
  state.next = 5;
  assert.throws(
    () => f.api.fullMetadataCommand(state, "qual-link-probe"),
    /ROLE_CLOSED/,
  );
  assert.throws(
    () => f.api.fullMetadataContext({ ...f.packet.context }),
    /CONTEXT_BRAND/,
  );
  f.api.retireQualificationSource(f.owner, true, false);
  assert.throws(
    () => f.api.fullMetadataCommand(state, "qual-gn-desc-pa"),
    (error) => error === false,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});

test("inactive full SDK four metadata unjoined falsy failure or source drift retires before later roles or reports", async () => {
  for (const mode of ["unjoined", "source-drift"]) {
    const f = await fullMetadataFixture({ mode });
    await f.api.collectQualificationGraph(f.owner);
    const token = f.api.commitFullMetadataGraph(f.owner);
    await assert.rejects(f.api.coordinateFullMetadata(token), (error) =>
      mode === "unjoined" ? error === 0 : error.message === "SOURCE_DRIFT",
    );
    assert.equal(f.calls.includes("qual-generate-headers"), false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.api.fullMetadataSources.has(token), false);
    assert.equal(f.api.qualificationSourceRuns.has(token), false);
    assert.equal(f.api.qualificationSourceOwners.get(f.owner).retired, true);
  }
});

test("inactive full SDK four metadata action args headers expiry and root fences deny causally", async () => {
  for (const mode of [
    "action-invalid",
    "evaluated-invalid",
    "header-invalid",
    "expires",
    "post-root-drift",
  ]) {
    const f = await fullMetadataFixture({ mode });
    await f.api.collectQualificationGraph(f.owner);
    const token = f.api.commitFullMetadataGraph(f.owner);
    await assert.rejects(
      f.api.coordinateFullMetadata(token),
      (error) =>
        error instanceof Error &&
        error.message !== "PRIVATE_ARM64_DEFAULTS_UNQUALIFIED",
    );
    assert.equal(f.writes.length, 0, mode);
    if (["action-invalid", "evaluated-invalid", "expires"].includes(mode))
      assert.equal(f.calls.includes("qual-generate-headers"), false, mode);
    assert.equal(f.api.fullMetadataSources.has(token), false, mode);
    assert.equal(f.api.qualificationSourceRuns.has(token), false, mode);
  }
});

const FULL_METADATA_DERIVATIONS = [
  {
    name: "commitQualificationGraph",
    next: "commitFullMetadataGraph",
    originalSha256:
      "f3ee0b03a48f9c4f777ade5bfb066f5d947aca85177068604d984cabc92b88de",
    derivedSha256:
      "ff8735bbf7de8ba262c4b57bee18327c8e66aa4201362b4ad1d15d5beac4d3fe",
    substitutions: [
      [
        "const state = qualificationOwnerCheck(owner),",
        "const { state, binding } = fullMetadataOwner(owner),",
      ],
      ['kind: "private-fresh-graph"', 'kind: "full-metadata-fresh-graph"'],
      ['kind: "private-source-run"', 'kind: "full-metadata-source-run"'],
      [
        "  qualificationSourceRuns.set(sourceToken, source);",
        "  qualificationSourceRuns.set(sourceToken, source);\n  fullMetadataSources.set(sourceToken, { owner, state, binding });",
      ],
    ],
  },
  {
    name: "qualificationCandidatePolicy",
    next: "fullMetadataCandidatePolicy",
    originalSha256:
      "6dd6e82a83dd76bbaa6cffcaab2a83548b9f9e89ab3c649dc17fa5e184108152",
    derivedSha256:
      "3d520997b5d0f20d34722d09e6ec7b24c9e4710e210d0552d36f2ec62361b744",
    substitutions: [
      [
        "const state = qualificationOwnerCheck(owner);",
        "const { state, binding } = fullMetadataOwner(owner);",
      ],
      [
        "state.p.privatePolicy.baseCandidatePolicySha256",
        "binding.recipe.baseCandidatePolicySha256",
      ],
    ],
  },
  {
    name: "qualificationInspectContext",
    next: "fullMetadataInspectContext",
    originalSha256:
      "a707ef47ae8472425c69aa88854b830ecb2e8e849c2caf37d19d701e4855b57b",
    derivedSha256:
      "1c0089b465b00a9164fe24965c1c903b64bbf700359a2739d2900f6280152f70",
    substitutions: [
      [
        "  requirePrivateScope(context);",
        "  const full = fullMetadataContext(context);",
      ],
      [
        'context.kind === "windows-arm-private-input-projection"',
        'context.kind === "windows-arm-full-metadata-input-projection"',
      ],
      ["policy.sourcePaths.length", "full.state.c.sources.length"],
      [
        "row.path === policy.sourcePaths[index]",
        "staticProjectionEqual(row, full.state.c.sources[index])",
      ],
      [
        "policy.crlfPositions.includes(index)",
        'full.state.c.sources[index].encoding === "git-crlf"',
      ],
    ],
  },
  {
    name: "qualificationInspectMetadata",
    next: "fullMetadataInspect",
    originalSha256:
      "2e13f07eba46fb7513074a5c1963df68d862976789812b17e06676a56758dbe6",
    derivedSha256:
      "b5358573e3b6217ea780ccfc238d6fc94d6b6442196a52280ab9a96dc4ab012e",
    substitutions: [
      ["qualificationInspectContext(", "fullMetadataInspectContext("],
    ],
  },
  {
    name: "qualificationMetadataObservation",
    next: "fullMetadataObservation",
    originalSha256:
      "9765ce65b1de1cc77a7647900774595422307bf24e1f9a8e37539472e845ee7c",
    derivedSha256:
      "9463e2b9bf6ca2502b274775a10cd7944f5412567afff132638f0698c1482e9a",
    substitutions: [
      [
        "const state = qualificationOwnerCheck(owner),",
        "const { state, binding } = fullMetadataOwner(owner),",
      ],
      ["state.p.privatePolicy", "binding.recipe"],
      [
        'kind: "windows-arm-private-input-projection"',
        'kind: "windows-arm-full-metadata-input-projection"',
      ],
      [
        "qualificationCandidatePolicy(owner)",
        "fullMetadataCandidatePolicy(owner)",
      ],
      [
        "  return qualificationInspectMetadata(",
        "  fullMetadataContexts.set(context, { owner, session, epoch: qualificationSessions.get(session).epoch });\n  try {\n    return fullMetadataInspect(",
      ],
      [
        "    performance.now() / 1000,\n  );\n}",
        "    performance.now() / 1000,\n    );\n  } finally {\n    fullMetadataContexts.delete(context);\n  }\n}",
      ],
    ],
  },
];
test("inactive full SDK metadata helpers retain exact finite strict inspector derivations", async () => {
  const { default: ts } = await import("typescript"),
    prettier = await import("prettier");
  const source = sourceAcquisitionInverse(
      (await read(prefix + "full-sdk-source-driver.mjs")).replaceAll(
        "\r\n",
        "\n",
      ),
      "driver",
    ),
    ast = ts.createSourceFile(
      "subject.mjs",
      source,
      99,
      true,
      ts.ScriptKind.JS,
    );
  const fn = (name) =>
    ast.statements
      .find((x) => ts.isFunctionDeclaration(x) && x.name?.text === name)
      .getText(ast);
  for (const row of FULL_METADATA_DERIVATIONS) {
    assert.equal(sha(fn(row.name)), row.originalSha256, row.name);
    assert.equal(sha(fn(row.next)), row.derivedSha256, row.next);
    let raw = fn(row.name).replace(
      "function " + row.name + "(",
      "function " + row.next + "(",
    );
    for (const [before, after] of row.substitutions) {
      assert(raw.includes(before));
      raw = raw.replaceAll(before, after);
    }
    assert.equal(
      (await prettier.format(raw, { parser: "babel" })).trimEnd(),
      fn(row.next),
      row.next,
    );
  }
});

test("inactive full SDK parent metadata actual child stores held evidence before fresh Git without default admission", async (t) => {
  const f = await createdSourceFixture(t);
  await assert.rejects(
    f.api.verifySourceMetadata(f.token),
    /SOURCE_METADATA_JOIN/,
  );
  assert.equal(f.state.readFds.size, 0);
  const source = await f.api.runSourcePhase(f.token),
    issued = f.api.sourceSessions.get(source);
  assert.equal(issued.metadataSnapshot, f.state.metadataSnapshot);
  assert.equal(issued.metadataSnapshot.records.length, 9);
  assert.equal(issued.metadataSnapshot.full61Qualified, false);
  assert.equal(
    issued.metadataSnapshot.matchedExpectedDefaults.comparison
      .expectedMacroCount,
    61,
  );
  assert.equal(
    issued.metadataSnapshot.matchedExpectedDefaults.comparison.dataOnly,
    true,
  );
  assert.equal(
    issued.metadataSnapshot.matchedExpectedDefaults.full61Qualified,
    false,
  );
  assert(
    Object.isFrozen(issued.metadataSnapshot) &&
      Object.isFrozen(issued.metadataSnapshot.records),
  );
  assert.equal(f.state.childEvents.close, true);
  assert.equal(f.state.readFds.size, 0);
  const control = await f.api.createControl(source, f.owner.lease);
  await f.api.prepareFreshPolicy(control);
  assert.equal(f.api.controls.get(control).helperValidated, true);
  assert.equal(f.state.readFds.size, 0);
  await f.api.retireControl(control);
});

test("inactive full SDK parent metadata actual child denies wrong source report and physical header before issuance", async (t) => {
  for (const mode of ["wrong-source", "wrong-report", "wrong-header"]) {
    const f = await createdSourceFixture(t, mode);
    await assert.rejects(
      f.api.runSourcePhase(f.token),
      /SOURCE_METADATA_REPORT|PRIVATE_PA_HEADER|QUAL_HEADER/,
    );
    assert.equal(f.state.issued, false, mode);
    assert.equal(f.state.metadataSnapshot, undefined, mode);
    assert.equal(f.state.readFds.size, 0, mode);
    assert.equal(f.api.sourceOperations.has(f.token), false, mode);
  }
});

test("inactive full SDK parent metadata retained physical evidence rejects mutation before and during fresh Git", async (t) => {
  for (const relative of [
    "full-metadata-result.json",
    "source-checkout/src/out/Release_GN_arm64/gen/cef/include/cef_config.h",
    "source-inputs/2",
  ]) {
    const f = await createdSourceFixture(t);
    const source = await f.api.runSourcePhase(f.token);
    const control = await f.api.createControl(source, f.owner.lease);
    await fs.appendFile(path.join(f.base, relative), "\n");
    await assert.rejects(
      f.api.prepareFreshPolicy(control),
      /SOURCE_RECORD|SOURCE_METADATA/,
    );
    assert.equal(f.api.controls.get(control).helperValidated, false);
    await assert.rejects(
      f.api.retireControl(control),
      /SOURCE_RECORD|SOURCE_METADATA/,
    );
  }
  let f;
  const actual = {
    ...controlCustom,
    prepareSourceGitIsolation: async (...args) => {
      const token = await controlCustom.prepareSourceGitIsolation(...args);
      await fs.appendFile(path.join(f.base, "full-metadata-result.json"), "\n");
      return token;
    },
  };
  f = await createdSourceFixture(t, "normal", { custom: actual });
  const source = await f.api.runSourcePhase(f.token);
  const control = await f.api.createControl(source, f.owner.lease);
  await assert.rejects(
    f.api.prepareFreshPolicy(control),
    /SOURCE_RECORD|SOURCE_METADATA/,
  );
  assert.equal(f.api.controls.get(control).helperValidated, false);
  await assert.rejects(
    f.api.retireControl(control),
    /SOURCE_RECORD|SOURCE_METADATA/,
  );
});

test("inactive full SDK parent metadata close continuation cannot issue after original expiry or root replacement", async (t) => {
  for (const mode of ["expiry", "root"]) {
    let f,
      changed = false;
    const modelFs = {
      ...fs,
      lstat: async (name, ...args) => {
        const info = await fs.lstat(name, ...args);
        if (mode !== "root" || !changed || name !== f?.base) return info;
        // Modeled root replacement after actual held-FD close; no foreign root is renamed.
        return new Proxy(info, {
          get(target, key) {
            if (key === "ino") return target.ino + 1n;
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
      open: async (name, ...args) => {
        const handle = await fs.open(name, ...args);
        if (
          typeof name !== "string" ||
          !name.endsWith("full-metadata-result.json")
        )
          return handle;
        return {
          stat: (...a) => handle.stat(...a),
          read: (...a) => handle.read(...a),
          close: async () => {
            await handle.close();
            if (changed) return;
            changed = true;
            if (mode === "expiry")
              f.api.leases.get(f.owner.lease).monoEnd = performance.now() - 1;
          },
        };
      },
    };
    f = await createdSourceFixture(t, "normal", { fs: modelFs });
    await assert.rejects(
      f.api.runSourcePhase(f.token),
      /DEADLINE|ROOT|DIRECTORY|REPLACED/,
    );
    assert.equal(changed, true, mode);
    assert.equal(f.state.issued, false, mode);
    assert.equal(f.state.metadataSnapshot, undefined, mode);
  }
});

const PARENT_METADATA_READER_DERIVATIONS = [
  {
    name: "PRIVATE_PROFILE_SHA256",
    newName: "parentMetadata_PRIVATE_PROFILE_SHA256",
    oldSha256:
      "8fc607859ca61103c1c482323a7a0310665fec63add3ef020acd016c5924606f",
    newSha256:
      "bf3ba31260e38682dd61d5534da9a06714171f1ef852cec101440148ffaca2cf",
  },
  {
    name: "PRIVATE_MODE",
    newName: "parentMetadata_PRIVATE_MODE",
    oldSha256:
      "85db65267dfbac27b76b1ca2e01bfe92bceb21c771c86dfcd97679820a0a99e3",
    newSha256:
      "3452ea29db5b40018318e52982a57a34c026069a4a0fb2f6556693aaa069e1bd",
  },
  {
    name: "PRIVATE_REF",
    newName: "parentMetadata_PRIVATE_REF",
    oldSha256:
      "662b18b7c7ab14356c574878f3eac14da1d71f6bb2279e7e1d8c83e4bdc10ed9",
    newSha256:
      "fd6bb086557440a7d0c0503652626036ab0ed2666a0434cb41f22bd1c0203bd5",
  },
  {
    name: "PRIVATE_WORKFLOW",
    newName: "parentMetadata_PRIVATE_WORKFLOW",
    oldSha256:
      "83124ef4a7303105872e896fe485be075c83689ec1a327b5c5c4ebcc95b6c2ed",
    newSha256:
      "e8d5ca0a817139546b392cefa0c59db6fcec35b203b3b8caa912f05d4757d241",
  },
  {
    name: "PRIVATE_ROLES",
    newName: "parentMetadata_PRIVATE_ROLES",
    oldSha256:
      "218c675e8a3d951a3a197913ae325b7724cd2ce74d16e71f81d9fbf8191a3b7c",
    newSha256:
      "6f847f2974866f0d1cf4377032525c9677c93b4c1cd2a73b3b90a0f5447cb858",
  },
  {
    name: "staticProjectionEqual",
    newName: "parentMetadata_staticProjectionEqual",
    oldSha256:
      "494cbf0d7405b81d5e185290c4d58272c2a18388a4466bbbb769d92cbb00d049",
    newSha256:
      "2149f383348ef4a7cc24c6ab6d5f1a42322150270fb71d621d2dfd447d460db0",
  },
  {
    name: "QUALIFICATION_PA_GUARD",
    newName: "parentMetadata_QUALIFICATION_PA_GUARD",
    oldSha256:
      "bd816016602dd411b53153659c1f3ca039f253e85e1607a7b2d6670b15e9c678",
    newSha256:
      "a0f415bb97ce4b3c3f6c46daef30a3849ba89547a38b0dd8a06f7429abff5335",
  },
  {
    name: "QUALIFICATION_ARM_TOOLCHAIN",
    newName: "parentMetadata_QUALIFICATION_ARM_TOOLCHAIN",
    oldSha256:
      "701a5b2db0e3d449e699e3acc1fe70400d4ae36565e8058958c45ff03bb39ae9",
    newSha256:
      "18bae7dcfb9a5537010b0c12d76309d71690121e9045e5aede4d5b9ef49fd3bd",
  },
  {
    name: "QUALIFICATION_DECLARED_ARGS",
    newName: "parentMetadata_QUALIFICATION_DECLARED_ARGS",
    oldSha256:
      "05d72d5115b6ecbb8d8d51861d02d0fe800f17f02c45880778fb9d333f829446",
    newSha256:
      "710d7890e44a39f864a00c7fa6b9368f5a06692161bd0ac194b0bdfa3d6a844c",
  },
  {
    name: "QUALIFICATION_CPU_ARGS",
    newName: "parentMetadata_QUALIFICATION_CPU_ARGS",
    oldSha256:
      "657071e404fe08c20a793d26d9d9c4611c2c45a1d0f5dc27068c9f43f6846d83",
    newSha256:
      "3fe9e085abbc59556d8aaa94ee65b0bc3b3ac7b40c44bea2759dc247ddd4a430",
  },
  {
    name: "QUALIFICATION_PY_SPACE",
    newName: "parentMetadata_QUALIFICATION_PY_SPACE",
    oldSha256:
      "e7453e19a9f25d14221444f5d6d6baf00e7f84999862a2c2d516afee17858251",
    newSha256:
      "bfc1b6099740bef9e61d495cd9b64b952ca8e94e089d91d1685a642a69c5db35",
  },
  {
    name: "QUALIFICATION_GN_LITERAL",
    newName: "parentMetadata_QUALIFICATION_GN_LITERAL",
    oldSha256:
      "e1882f2d378c8e2da9771351df80eccd460bf6dd55fd8002c68bdcf452ce6db4",
    newSha256:
      "5ca0124fab8c21e23ad6de3bb55ffd6616279c06f2866e59c0e1182827385a8d",
  },
  {
    name: "qualificationShape",
    newName: "parentMetadata_qualificationShape",
    oldSha256:
      "90544385b7bcb8765b418fc2984fc08f1ab2f45d2beb0c0da19631cacf14e8ca",
    newSha256:
      "361898d27c9cc36f85e3c6b211e06d054ecdb0b6428cfec98b174866195a1802",
  },
  {
    name: "qualificationStringBound",
    newName: "parentMetadata_qualificationStringBound",
    oldSha256:
      "31ece79f74b50d54f08168bd87590dc843f341ce83ed50907c9a48ce7f5147c5",
    newSha256:
      "cf72a7b2457403a49fd19d158a36b8bb731712545d44e9820fc5acc29f877e9a",
  },
  {
    name: "qualificationCanonical",
    newName: "parentMetadata_qualificationCanonical",
    oldSha256:
      "4e150db1e6cabf7b37f01329a931427b7806c44bb0d30b7e853c558fa0bb2445",
    newSha256:
      "793e4ce9cc85d663f133e80726d2cdf9a22a96167f9ecb8a81e01dee172d1f36",
  },
  {
    name: "qualificationPolicy",
    newName: "parentMetadata_qualificationPolicy",
    oldSha256:
      "ba1165c774d36a9ad9423f6a727fe043c3d29e56736ad827ea7dcdbb1dbb2c03",
    newSha256:
      "5c627bc1e5ec73d8d23163adae361a34b645b016ce65d320d22bb293fbccf0c8",
  },
  {
    name: "qualificationBoundedJson",
    newName: "parentMetadata_qualificationBoundedJson",
    oldSha256:
      "3325bcc9305ffa169531f72fa4c98d0cc515eff6016a9aae53108acf7ce24680",
    newSha256:
      "346765b0f9228190ff163a743c140f5591f7b83142715a3b2ea0264670d40a4b",
  },
  {
    name: "qualificationInspectEvaluatedArgs",
    newName: "parentMetadata_qualificationInspectEvaluatedArgs",
    oldSha256:
      "2a4ea40bf62e2562befa292f941334db8c4686bc9ee227d65900e24b12c0a674",
    newSha256:
      "a3f409a3e1ad32c2fbcb30d510a5d26cf6f29ad29ca0177ac43e725fe1acf709",
  },
  {
    name: "qualificationInspectAction",
    newName: "parentMetadata_qualificationInspectAction",
    oldSha256:
      "a34b37964dc06914ff74fda5faeb69f79bc932b5fd6fe6176212821bdaf5dceb",
    newSha256:
      "e069b160d944737894ff38edc9398e1c5e4d32b04c46ade0e01921ef7350d3f4",
  },
  {
    name: "qualificationLines",
    newName: "parentMetadata_qualificationLines",
    oldSha256:
      "deafbbddcd3e5e77554c4e3dc212bee92a4837d9b58b9fa4891a04c0b8420838",
    newSha256:
      "82bc43bb0d8aa8119ec7722aa19fa92f9668670569127410ab2e7ce6edff39d7",
  },
  {
    name: "qualificationTrim",
    newName: "parentMetadata_qualificationTrim",
    oldSha256:
      "fc514b9a3f053b52a67b2c487b972331033493aab98c5bc408aa8f0212a2d8ae",
    newSha256:
      "2632602b0c986a32009bd91dc7a14cccbeaba29e6a423a5d5df11fd52a906f62",
  },
  {
    name: "qualificationParseLiteralArgs",
    newName: "parentMetadata_qualificationParseLiteralArgs",
    oldSha256:
      "cb113219c4e1e38fb93195250e02422f57b6f2c120c7bb014ab2291b134ecb08",
    newSha256:
      "3b291b387c9dd3c3794a3abc6bcbce4dd2e9f6cc0e05e7d4939d7ff93d767191",
  },
  {
    name: "qualificationHeaderText",
    newName: "parentMetadata_qualificationHeaderText",
    oldSha256:
      "e0ebf1fd1b15b7cf8669ed7fd03e67658adfed7f3cfc336ea452f084abf1b5a1",
    newSha256:
      "b7c2bf6d2e90881872654851421d7d8d72268eb0ff341954f2b1d48191f9c79b",
  },
  {
    name: "qualificationInspectCefHeader",
    newName: "parentMetadata_qualificationInspectCefHeader",
    oldSha256:
      "249fbf030d581531ad35f93fc1f374a456a7ec648949edfa31255f3b3adcfceb",
    newSha256:
      "5454bd10c851b280b2ab13f336507f0ae930a26c3b41a6d3791f09c4ef707e1d",
  },
  {
    name: "qualificationInspectPaHeader",
    newName: "parentMetadata_qualificationInspectPaHeader",
    oldSha256:
      "984c4f0485fe4715d107259045bd07e3d11ebaa3dd5171b4e12934672d35db44",
    newSha256:
      "2ee9079fac788e0574d24579990df8e704eedc6a20b539725a0ec778813677d5",
  },
];
test("inactive full SDK parent metadata readers are exact finite data-only copies", async () => {
  const { default: ts } = await import("typescript"),
    prettier = await import("prettier");
  const control = await read(prefix + "full_sdk_control.mjs"),
    driver = await read(prefix + "full-sdk-source-driver.mjs");
  const declarations = (raw) => {
    const tree = ts.createSourceFile(
      "copy.mjs",
      raw,
      99,
      true,
      ts.ScriptKind.JS,
    );
    return new Map(
      tree.statements.flatMap((n) =>
        ts.isFunctionDeclaration(n) && n.name
          ? [[n.name.text, n.getText(tree)]]
          : ts.isVariableStatement(n)
            ? n.declarationList.declarations
                .filter((d) => ts.isIdentifier(d.name))
                .map((d) => [d.name.text, n.getText(tree)])
            : [],
      ),
    );
  };
  const original = declarations(driver),
    actual = declarations(control),
    mapping = new Map(
      PARENT_METADATA_READER_DERIVATIONS.map((r) => [r.name, r.newName]),
    );
  mapping.set("sha", "hashBytes");
  for (const row of PARENT_METADATA_READER_DERIVATIONS) {
    const raw = original.get(row.name);
    assert.equal(sha(raw), row.oldSha256, row.name);
    assert.equal(sha(actual.get(row.newName)), row.newSha256, row.newName);
    const tree = ts.createSourceFile(
        "copy.mjs",
        raw,
        99,
        true,
        ts.ScriptKind.JS,
      ),
      edits = [];
    const visit = (n) => {
      if (
        ts.isIdentifier(n) &&
        mapping.has(n.text) &&
        !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
        !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
      )
        edits.push({
          start: n.getStart(tree),
          end: n.end,
          raw: mapping.get(n.text),
        });
      ts.forEachChild(n, visit);
    };
    visit(tree);
    let next = raw;
    for (const e of edits.sort((a, b) => b.start - a.start))
      next = next.slice(0, e.start) + e.raw + next.slice(e.end);
    assert.equal(
      (await prettier.format(next, { parser: "babel" })).trimEnd(),
      actual.get(row.newName),
      row.newName,
    );
  }
});

test("inactive full SDK parent metadata actual held report close preserves falsy primary and cannot publish", async (t) => {
  let failed = false;
  const modelFs = {
    ...fs,
    open: async (name, ...args) => {
      const handle = await fs.open(name, ...args);
      if (
        typeof name !== "string" ||
        !name.endsWith("full-metadata-result.json")
      )
        return handle;
      return {
        stat: (...a) => handle.stat(...a),
        read: (...a) => handle.read(...a),
        close: async () => {
          await handle.close();
          if (!failed) {
            failed = true;
            throw false;
          }
        },
      };
    },
  };
  const f = await createdSourceFixture(t, "normal", { fs: modelFs });
  await assert.rejects(
    f.api.runSourcePhase(f.token),
    (error) => error === false,
  );
  assert.equal(failed, true);
  assert.equal(f.state.primary, false);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.metadataSnapshot, undefined);
  assert.equal(f.state.readFds.size, 0);
  assert.equal(f.api.sourceOperations.has(f.token), false);
});

test("inactive full SDK fixed61 rejects mutually agreeing wrong Android defaults before any source session", async (t) => {
  const real =
    await import("../../native/windows-arm-full-sdk/expected-defaults.mjs");
  let compared = 0;
  const observed = {
    ...real,
    inspectExpectedArm64Defaults: (input) => {
      compared++;
      assert.equal(
        input.partitionAllocActionValues.find((r) => r[0] === "IS_ANDROID")[1],
        1,
      );
      assert.equal(
        input.partitionAllocHeaderValues.find((r) => r[0] === "IS_ANDROID")[1],
        1,
      );
      return real.inspectExpectedArm64Defaults(input);
    },
  };
  const f = await createdSourceFixture(t, "wrong-defaults", {
    expectedDefaults: observed,
  });
  await assert.rejects(
    f.api.runSourcePhase(f.token),
    /ARM64_DEFAULTS_MISMATCH/,
  );
  assert.equal(compared, 1);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.metadataSnapshot, undefined);
  assert.equal(f.state.readFds.size, 0);
});

test("inactive full SDK fixed61 rejects wrong image saved module and code policy bindings", async (t) => {
  for (const mode of [
    "wrong-image",
    "wrong-module-pin",
    "wrong-module-saved",
  ]) {
    const f = await createdSourceFixture(t, mode);
    await assert.rejects(
      f.api.runSourcePhase(f.token),
      /SOURCE_METADATA_IMAGE|SOURCE_DEFAULTS_INPUT_PIN|SOURCE_RECORD_PIN|SOURCE_RECORD_BOUND/,
    );
    assert.equal(f.state.issued, false, mode);
    assert.equal(f.state.metadataSnapshot, undefined, mode);
    assert.equal(f.state.readFds.size, 0, mode);
  }
  const real =
      await import("../../native/windows-arm-full-sdk/expected-defaults.mjs"),
    policy = JSON.parse(JSON.stringify(real.ARM64_EXPECTED_DEFAULTS_POLICY));
  policy.values.IS_ANDROID = 1;
  const f = await createdSourceFixture(t, "normal", {
    expectedDefaults: { ...real, ARM64_EXPECTED_DEFAULTS_POLICY: policy },
  });
  await assert.rejects(
    f.api.runSourcePhase(f.token),
    /SOURCE_DEFAULTS_POLICY_PIN/,
  );
  assert.equal(f.state.issued, false);
  assert.equal(f.state.metadataSnapshot, undefined);
});

test("inactive full SDK fixed61 reads real live module and denies altered bytes without mutating source", async (t) => {
  let altered = false;
  const modelFs = {
    ...fs,
    open: async (name, ...args) => {
      const handle = await fs.open(name, ...args);
      if (
        typeof name !== "string" ||
        !name.endsWith(
          path.join("native", "windows-arm-full-sdk", "expected-defaults.mjs"),
        )
      )
        return handle;
      return {
        stat: (...a) => handle.stat(...a),
        close: () => handle.close(),
        read: async (buffer, offset, ...a) => {
          const result = await handle.read(buffer, offset, ...a);
          if (result.bytesRead && !altered) {
            buffer[offset] ^= 1;
            altered = true;
          }
          return result;
        },
      };
    },
  };
  const f = await createdSourceFixture(t, "normal", { fs: modelFs });
  await assert.rejects(f.api.runSourcePhase(f.token), /SOURCE_RECORD_PIN/);
  assert.equal(altered, true);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.readFds.size, 0);
});

test("inactive full SDK fixed61 module close retirement preserves false and cannot publish a late fact", async (t) => {
  let f,
    retired = false;
  const modelFs = {
    ...fs,
    open: async (name, ...args) => {
      const handle = await fs.open(name, ...args);
      if (
        typeof name !== "string" ||
        !name.endsWith(
          path.join("native", "windows-arm-full-sdk", "expected-defaults.mjs"),
        )
      )
        return handle;
      return {
        stat: (...a) => handle.stat(...a),
        read: (...a) => handle.read(...a),
        close: async () => {
          await handle.close();
          if (!retired) {
            retired = true;
            f.state.failed = true;
            f.state.primary = false;
            void f.api.retireSourceOperation(f.token);
          }
        },
      };
    },
  };
  f = await createdSourceFixture(t, "normal", { fs: modelFs });
  await assert.rejects(
    f.api.runSourcePhase(f.token),
    (error) => error === false,
  );
  assert.equal(retired, true);
  assert.equal(f.state.primary, false);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.metadataSnapshot, undefined);
});

test("full SDK hooks stage carries the measured2700 cap with an exact prior-stage inverse and original reserve clipping", async () => {
  const { default: ts } = await import("typescript");
  const source = sourceAcquisitionInverse(
    (await read(prefix + "full-sdk-source-driver.mjs")).replace(/\r\n/g, "\n"),
    "driver",
  );
  const tree = ts.createSourceFile(
    "driver.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = (name) =>
    tree.statements
      .find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      )
      .getText(tree);
  const old = body("sourceStage"),
    current = body("fullSourceStage");
  assert.equal(
    current
      .replace("fullSourceStage(", "sourceStage(")
      .replace("maximumSeconds === 2700", "maximumSeconds === 1800"),
    old,
  );
  function fixture(program) {
    let now = 0,
      timer,
      cleared = 0;
    const fn = vm.runInNewContext("(" + program + ")", {
      need(value, code) {
        if (!value) throw new Error(code);
      },
      performance: { now: () => now },
      setTimeout(callback, milliseconds) {
        timer = { callback, milliseconds };
        return timer;
      },
      clearTimeout(value) {
        assert.equal(value, timer);
        cleared++;
      },
      writeFileSync() {
        assert.fail("no deadline report during successful action");
      },
      process: {
        exit() {
          assert.fail("no native exit during successful action");
        },
      },
    });
    return {
      fn,
      timer: () => timer,
      cleared: () => cleared,
      advance: (value) => {
        now += value;
      },
    };
  }
  const before = fixture(old);
  await assert.rejects(
    before.fn(
      "owned-root",
      { remaining: () => 7200000 },
      "source-hooks-gn",
      2700,
      async () => 1,
    ),
    /FULL_SOURCE_STAGE/,
  );
  assert.equal(before.timer(), undefined);
  for (const [remaining, expected] of [
    [7200000, 2700000],
    [1000000, 880000],
  ]) {
    const f = fixture(current);
    let checks = 0;
    assert.equal(
      await f.fn(
        "owned-root",
        {
          remaining() {
            checks++;
            return remaining;
          },
        },
        "source-hooks-gn",
        2700,
        async () => 7,
      ),
      7,
    );
    assert.equal(f.timer().milliseconds, expected);
    assert.equal(f.cleared(), 1);
    assert.equal(checks, 2);
  }
  const exhausted = fixture(current);
  await assert.rejects(
    exhausted.fn(
      "owned-root",
      { remaining: () => 120000 },
      "source-hooks-gn",
      2700,
      async () => 1,
    ),
    /FULL_SOURCE_RESERVE/,
  );
  assert.equal(exhausted.timer(), undefined);
  const expired = fixture(current);
  await assert.rejects(
    expired.fn(
      "owned-root",
      { remaining: () => 1000000 },
      "source-hooks-gn",
      2700,
      async () => expired.advance(880000),
    ),
    /FULL_SOURCE_STAGE_DEADLINE/,
  );
  assert.equal(expired.cleared(), 1);
  const falsy = fixture(current);
  await assert.rejects(
    falsy.fn(
      "owned-root",
      { remaining: () => 1000000 },
      "source-hooks-gn",
      2700,
      async () => {
        throw false;
      },
    ),
    (error) => error === false,
  );
  assert.equal(falsy.cleared(), 1);
});

test("full SDK hooks carryforward restores the whole prior8323 driver without changing the older1800 stage or private source body", async () => {
  const { default: ts } = await import("typescript");
  let source = (await read(prefix + "full-sdk-source-driver.mjs")).replace(
    /\r\n/g,
    "\n",
  );
  source = assemblyInverse(source, "driver");
  const tree = ts.createSourceFile(
    "driver.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const stage = tree.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "fullSourceStage",
    )
    .getText(tree);
  assert.equal(source.split(stage + "\n\n").length, 2);
  source = source.replace(stage + "\n\n", "");
  const start = source.indexOf("async function runFullSourceBody(argv) {"),
    end = source.indexOf("// END CLOSED FULL SDK SOURCE BODY", start);
  let body = source.slice(start, end);
  assert.equal(body.split("await fullSourceStage(").length, 2);
  assert.equal(body.split('"source-hooks-gn", 2700').length, 2);
  body = body
    .replaceAll("await fullSourceStage(", "await sourceStage(")
    .replace('"source-hooks-gn", 2700', '"source-hooks-gn", 1800');
  source = source.slice(0, start) + body + source.slice(end);
  const profile = await fs.readFile(
    path.join(root, prefix, "full-sdk-source-profile.json"),
  );
  assert.equal(
    source.split(
      "528dfa3b3a510f0fc9c5e5f48af8044e004ccd9f2b217b1943d2d67053be9aa2",
    ).length,
    2,
  );
  source = source.replace(
    "528dfa3b3a510f0fc9c5e5f48af8044e004ccd9f2b217b1943d2d67053be9aa2",
    "8019a93033819819d717a87f27806fd14d180ddc1e9ee2c899f0951d6af82e61",
  );
  assert.equal(Buffer.byteLength(source), 254968);
  assert.equal(
    sha(source),
    "83230fc12fb97cf77ad53f3a511a904d462f9241f83307aeccfadb07bee344c6",
  );
});

// These maps are isolated lexical models. The ChildProcess is real; native
// Windows creation/Job outcomes below are modeled and never mint production authority.
async function parentEngineFixture(t, mode = "normal", overrides = {}) {
  let f;
  const plans = [];
  const actualSpawn = (executable, argv, options) => {
    if (argv[2] === "-c") {
      const program = `process.stdout.write(JSON.stringify({wall:Date.now()/1000,monotonic:performance.now()/1000,parentPid:process.ppid,parentCreationFiletime:'777777'}));`;
      return spawn(process.execPath, ["-e", program], options);
    }
    if (argv[3] !== "--full-sdk-engine-launcher")
      return spawn(executable, argv, options);
    plans.push({ executable, argv: [...argv], options });
    if (argv[4] === "cef-engine") {
      const python = execFileSync(
        "python",
        ["-I", "-B", "-c", "import sys;print(sys.executable)"],
        { encoding: "utf8", timeout: 10000, windowsHide: true },
      ).trim();
      const program = `import sys,pathlib,json,types,os,stat,time as real_time
+sys.path.insert(0,sys.argv[1]);import full_sdk_engine as engine;import acquire as data
+root=pathlib.Path(sys.argv[2]);sha=sys.argv[3];mode=sys.argv[4];role='cef-engine'
+packet=json.loads((root/('full-sdk-engine-'+role+'-context.json')).read_bytes());profile=json.loads((pathlib.Path(sys.argv[1])/'full-sdk-source-profile.json').read_bytes())
+class Parent:
+ def is_set(self):return False
+ def close(self):pass
+birth=object();fence=[]
+for p in(root,*root.parents):
+ i=p.lstat();fence.append((p,(i.st_dev,i.st_ino,stat.S_IFMT(i.st_mode),getattr(i,'st_birthtime_ns',None))))
+engine.time=types.SimpleNamespace(time=real_time.time,monotonic=lambda:packet['monotonicWholeEnd']-(packet['wallWholeEnd']-real_time.time()))
+held=[(root/r['relative'],{'bytes':r['bytes'],'sha256':r['sha256']})for r in packet['metadataFiles']+packet['gitPolicyFiles']]
+state=dict(root=root,context=packet,profile=profile,node=profile['node'],sha=sha,clock=engine.OriginalClock(packet),data=data,held=held,fence=fence,parent=Parent(),pid=os.getpid(),birth=birth,closed=False,failed=False,primary=None,semantic=engine.digest(engine.canonical(packet)),profileSemantic=engine.digest(engine.canonical(profile)),own=object(),creation='888889')
+engine._ACTIVE[str(root)]=state;engine._BIRTHS[birth]=state
+def run(*args,**kwargs):
+ result=json.loads((root/'jobs/full-sdk-source-gn/receipt.json').read_bytes());result.update(rootPid=9002,rootCreationFiletime='900200',outputCapBytes=kwargs['cap'],capturedBytes=0,elapsedMs=args[3]*1000)
+ if mode=='native-deadline':result.update(success=False,outcome='deadline',rootExit=None,finalRootExit=124)
+ else:result.update(success=False,outcome='compiler-failure',rootExit=1,finalRootExit=1)
+ out=args[2];out.mkdir(parents=True);(out/'receipt.json').write_text(json.dumps(result,indent=2)+'\\n');return result
+sys.modules['job']=types.SimpleNamespace(run_job=run,close=lambda _:True,checked=lambda ok,*_:None if ok else engine.need(False,'MODELED_HANDLE'))
+engine._load=lambda *_:state
+raise SystemExit(engine.main(['--full-sdk-engine-launcher',role,str(root),sha,'--execute']))
+`.replace(/^\+/gm, "");
      return spawn(
        python,
        [
          "-I",
          "-B",
          "-c",
          program,
          path.join(root, prefix),
          argv[5],
          argv[6],
          mode,
        ],
        options,
      );
    }

    const program = `const fs=require('node:fs'),path=require('node:path');
      const role=process.argv[1],root=process.argv[2],sha=process.argv[3],mode=process.argv[4];
      const packet=JSON.parse(fs.readFileSync(path.join(root,'full-sdk-engine-'+role+'-context.json')));
      const receipt=JSON.parse(fs.readFileSync(path.join(root,'jobs/full-sdk-source-gn/receipt.json')));receipt.elapsedMs=1000;
      receipt.rootPid=9000+['probe-clang','probe-link','cef-engine','package'].indexOf(role);receipt.rootCreationFiletime=String(receipt.rootPid*100);
      if(mode==='bad-job')receipt.activeAtEnd=1;
      const birth='888889',launch={kind:'windows-arm-full-sdk-engine-launch',role,ownPid:process.pid,ownCreationFiletime:birth,parentPid:packet.parentPid,parentCreationFiletime:packet.parentCreationFiletime,contextSha256:sha};
      if(mode==='wrong-launch')launch.ownPid++;
      const close={kind:'windows-arm-full-sdk-engine-launcher-close',role,success:true,parentHandleClosed:true,ownHandleClosed:true,ownPid:process.pid,ownCreationFiletime:birth,parentPid:packet.parentPid,parentCreationFiletime:packet.parentCreationFiletime,sourceContextSha256:packet.sourceContextSha256,sdkBuilt:false,nativeAcceptance:false,jobSeconds:899};
      if(mode==='missing-close')close.ownHandleClosed=false;
      const raw=Buffer.alloc(role==='probe-clang'?60:400);
      if(role==='probe-clang'){raw.writeUInt16LE(0xaa64,0);raw.writeUInt16LE(1,2);}else{raw.write('MZ');raw.writeUInt32LE(64,60);raw.writeUInt32LE(0x4550,64);raw.writeUInt16LE(0xaa64,68);raw.writeUInt16LE(240,84);raw.writeUInt16LE(0x20b,88);}
      if(mode==='wrong-machine')raw[role==='probe-clang'?0:68]=0;
      const probe='full-sdk-engine-probe/probe.'+(role==='probe-clang'?'obj':'exe');fs.mkdirSync(path.dirname(path.join(root,probe)),{recursive:true});fs.writeFileSync(path.join(root,probe),raw);
      const output={bytes:raw.length,sha256:require('node:crypto').createHash('sha256').update(raw).digest('hex')};
      const result={kind:'windows-arm-full-sdk-engine-worker-result',role,sourceContextSha256:packet.sourceContextSha256,image:packet.image,sourceId:packet.sourceId,success:true,output,engineComplete:false,sdkBuilt:false,nativeAcceptance:false,runtimeReady:false};
      if(mode==='wrong-source')result.sourceId='f'.repeat(64);
      const rows={};rows['jobs/'+role+'/receipt.json']=receipt;
      rows['full-sdk-engine-'+role+'-launch.json']=launch;rows['full-sdk-engine-closed-'+role+'.json']=close;rows['full-sdk-engine-'+role+'-result.json']=result;
      for(const[name,value]of Object.entries(rows)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),JSON.stringify(value));}
      process.stdout.write('modeled-native-engine-fixture\\n');
    `;
    return spawn(
      process.execPath,
      ["-e", program, argv[4], argv[5], argv[6], mode],
      options,
    );
  };
  f = await createdSourceFixture(t, "normal", {
    spawn: actualSpawn,
    process: {
      ...process,
      env: {
        ...process.env,
        CEF_FULLSDK_RESTORE_RUN: "0",
        ImageVersion: "20261030.294.1",
        GITHUB_SHA: "a".repeat(40),
        GITHUB_WORKFLOW_SHA: "a".repeat(40),
        GITHUB_RUN_ID: "30",
        GITHUB_RUN_ATTEMPT: "1",
      },
    },
    ...overrides,
  });
  const profile = JSON.parse(
      await fs.readFile(
        path.join(root, prefix, "full-sdk-source-profile.json"),
      ),
    ),
    policy = {
      kind: "sorng-windows-arm64-sdk-origin-policy",
      origin: "owned-windows-arm64-full-sdk",
      workflow: profile.workflow,
      target: profile.target,
      producerInputs: f.state.plan.producerInputs,
    };
  const sourceRecord = f.api.sourceContextRecord(
    f.token,
    profile,
    policy,
    Buffer.from(JSON.stringify(policy)),
    { monotonic: performance.now() / 1000 },
  );
  const context = Buffer.from(JSON.stringify(sourceRecord, null, 2) + "\n");
  await fs.writeFile(path.join(f.base, "context.json"), context);
  f.state.plan = Object.freeze({
    ...f.state.plan,
    rootPins: Object.freeze(
      f.state.plan.rootPins.map((row) =>
        row.relative === "context.json"
          ? {
              relative: row.relative,
              bytes: context.length,
              sha256: sha(context),
            }
          : row,
      ),
    ),
  });
  const source = await f.api.runSourcePhase(f.token);
  const control = await f.api.createControl(source, f.owner.lease);
  await f.api.prepareFreshPolicy(control);
  t.after(async () => {
    const state = f.api.controls.get(control);
    try {
      await f.api.retireControl(control);
    } catch (error) {
      assert.equal(state.failed, true);
      assert.equal(error, state.primary);
    }
  });
  return { ...f, source, control, plans };
}

test("parent engine actual child joins modeled native chain and seals ARM object and image under one original probe budget", async (t) => {
  const f = await parentEngineFixture(t);
  const a = await f.api.runEnginePhase(f.control, "probe-clang"),
    state = f.api.controls.get(f.control),
    ends = state.probeEnds;
  assert.equal(a.role, "probe-clang");
  assert.equal(a.nativeAcceptance, false);
  assert.equal(state.enginePhase, null);
  const b = await f.api.runEnginePhase(f.control, "probe-link");
  assert.equal(b.role, "probe-link");
  assert.equal(state.probeEnds, ends);
  assert.equal(state.engineResults.length, 2);
  assert.equal(f.plans.length, 2);
  const first = JSON.parse(
      await fs.readFile(
        path.join(f.base, "full-sdk-engine-probe-clang-context.json"),
      ),
    ),
    second = JSON.parse(
      await fs.readFile(
        path.join(f.base, "full-sdk-engine-probe-link-context.json"),
      ),
    );
  assert.equal(first.wallPhaseEnd, second.wallPhaseEnd);
  assert.equal(first.wallWholeEnd, second.wallWholeEnd);
  assert.equal(first.monotonicWholeEnd, second.monotonicWholeEnd);
  assert.equal(first.metadataFiles.length, 9);
  assert.equal(second.prior.result.sha256, a.result.sha256);
  assert.equal(first.gitPolicyFiles[1].bytes, 0);
  assert.equal(f.state.logFds.size, 0);
  assert.equal(f.state.readFds.size, 0);
});

test("parent engine denies actual child wrong launcher source machine missing close or native cohort before private advancement", async (t) => {
  for (const mode of [
    "wrong-launch",
    "wrong-source",
    "wrong-machine",
    "missing-close",
    "bad-job",
  ]) {
    const f = await parentEngineFixture(t, mode);
    await assert.rejects(
      f.api.runEnginePhase(f.control, "probe-clang"),
      /ENGINE_|SOURCE_JOB_PROOF/,
    );
    const state = f.api.controls.get(f.control);
    assert.equal(state.engineResults.length, 0, mode);
    assert.equal(state.enginePhase, null, mode);
    assert.equal(state.failed, true, mode);
  }
});

test("parent engine reholds fixed metadata and predecessor identity before the next actual creation", async (t) => {
  for (const mode of ["header", "predecessor"]) {
    const f = await parentEngineFixture(t);
    const first = await f.api.runEnginePhase(f.control, "probe-clang");
    const file =
      mode === "header"
        ? path.join(
            f.base,
            f.api.sourceSessions.get(f.source).metadataSnapshot.records[6]
              .relative,
          )
        : path.join(f.base, first.records.at(-1).relative);
    await fs.appendFile(file, "tamper");
    await assert.rejects(
      f.api.runEnginePhase(f.control, "probe-link"),
      /SOURCE_RECORD_|ENGINE_PREDECESSOR/,
    );
    assert.equal(f.plans.length, 1);
    assert.equal(f.api.controls.get(f.control).engineResults.length, 1);
  }
});

test("parent engine strict object and image reader denies x64 and import tables independently", async () => {
  const api = await inactiveControl();
  const obj = Buffer.alloc(60);
  obj.writeUInt16LE(0xaa64, 0);
  obj.writeUInt16LE(1, 2);
  api.engineProbe(obj, "probe-clang");
  obj.writeUInt16LE(0x8664, 0);
  assert.throws(() => api.engineProbe(obj, "probe-clang"), /ENGINE_COFF/);
  const exe = Buffer.alloc(400);
  exe.write("MZ");
  exe.writeUInt32LE(64, 60);
  exe.writeUInt32LE(0x4550, 64);
  exe.writeUInt16LE(0xaa64, 68);
  exe.writeUInt16LE(240, 84);
  exe.writeUInt16LE(0x20b, 88);
  api.engineProbe(exe, "probe-link");
  exe.writeUInt32LE(1, 64 + 24 + 112 + 8);
  assert.throws(() => api.engineProbe(exe, "probe-link"), /ENGINE_PE_IMPORT/);
});

test("actual parent packets and actual Python close writer permit only native supervisor deadline checkpoint alternative", async (t) => {
  for (const mode of ["native-deadline", "compiler-failure"]) {
    const f = await parentEngineFixture(t, mode);
    await f.api.runEnginePhase(f.control, "probe-clang");
    await f.api.runEnginePhase(f.control, "probe-link");
    const state = f.api.controls.get(f.control);
    if (mode === "native-deadline") {
      const result = await f.api.runEnginePhase(f.control, "cef-engine");
      assert.equal(result, state.nativeSliceFact);
      assert.equal(result.nativeSliceEnded, true);
      assert.equal(result.result, null);
      assert.equal(state.compilerAdmission.full61Qualified, true);
      const source = await fs.readFile(path.join(f.base, "context.json")),
        packet = await fs.readFile(
          path.join(f.base, "full-sdk-engine-cef-engine-context.json"),
        );
      const program = `import sys,json;sys.path.insert(0,sys.argv[1]);import full_sdk_engine as e;import compiled_checkpoint as c;s=json.loads(sys.argv[2]);p=json.loads(sys.argv[3]);r=json.loads(sys.argv[4]);e.validate_packet(p,'cef-engine',s);c._job(r,True);print('actual-parent-python-codec-contract')`;
      const raw = await fs.readFile(
        path.join(f.base, "jobs/cef-engine/receipt.json"),
      );
      assert.match(
        execFileSync(
          "python",
          [
            "-I",
            "-B",
            "-c",
            program,
            path.join(root, prefix),
            source.toString(),
            packet.toString(),
            raw.toString(),
          ],
          { encoding: "utf8", timeout: 15000, windowsHide: true },
        ),
        /actual-parent-python-codec-contract/,
      );
      const value = JSON.parse(packet),
        context = JSON.parse(source);
      assert(value.wallPhaseEnd <= context.wallWholeEnd - 3600);
      assert(value.monotonicPhaseEnd <= context.monotonicWholeEnd - 3600);
      await assert.rejects(
        f.api.runEnginePhase(f.control, "package"),
        /ENGINE_SEQUENCE/,
      );
    } else {
      await assert.rejects(
        f.api.runEnginePhase(f.control, "cef-engine"),
        /ENGINE_CHILD_JOIN/,
      );
      assert.equal(state.nativeSliceFact, undefined);
      assert.equal(state.engineResults.length, 2);
    }
  }
});

test("parent engine actual unlaunched child no-close cleanup is finite and preserves falsy cap or cancellation primary", async (t) => {
  const { PassThrough } = await import("node:stream");
  for (const failure of ["deadline", false, "cap"]) {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let wall = 1000,
      mono = 0,
      kills = 0,
      unrefs = 0,
      armed = false,
      delayedSetup = false;
    const timers = new Set();
    const fireDeadline = () => {
      assert.equal(timers.size, 1);
      const timer = [...timers][0];
      timers.delete(timer);
      wall += timer.ms;
      mono += timer.ms;
      timer.callback();
    };
    child.kill = () => {
      kills++;
      return false;
    };
    child.unref = () => {
      unrefs++;
    };
    const f = await controlFixture(t, {
      fs: {
        ...fs,
        async lstat(...args) {
          if (!delayedSetup && !armed) {
            delayedSetup = true;
            // Deliberately exceed the old8ms artificial setup timer.
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          return fs.lstat(...args);
        },
      },
      spawn: () => child,
      Date: { now: () => wall },
      performance: { now: () => mono },
      setTimeout: (callback, ms) => {
        if (!armed) return setTimeout(callback, ms);
        const timer = { callback, ms };
        timers.add(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        if (timers.has(timer)) timers.delete(timer);
        else clearTimeout(timer);
      },
    });
    const control = await f.api.createControl(f.receipt, f.lease),
      state = f.api.controls.get(control);
    const stdoutFd = await fs.open(
        path.join(f.base, "engine-model.stdout"),
        "wx",
      ),
      stderrFd = await fs.open(path.join(f.base, "engine-model.stderr"), "wx");
    const phase = {
      role: "probe-clang",
      wallEnd: wall + 10,
      monoEnd: mono + 10,
      retired: false,
      pending: new Set(),
      logFds: new Set([stdoutFd, stderrFd]),
      stdoutFd,
      stderrFd,
      pendingWriters: 0,
      writeQueue: Promise.resolve(),
      outputBytes: 0,
      child: null,
    };
    state.enginePhase = phase;
    assert.equal(delayedSetup, true);
    armed = true; // Normal control/FS setup never uses accelerated timers.
    const originalEnds = { ...f.api.leases.get(f.lease) };
    f.api.startEngineChild(control, phase, {
      executable: "MODELED_ONLY",
      argv: [],
      environment: {},
    });
    let expected;
    if (failure === false) {
      child.emit("error", false);
      expected = false;
    }
    if (failure === "cap") {
      child.stdout.write(Buffer.alloc(131073));
      expected = state.primary;
      child.emit("error", false);
    }
    const began = performance.now();
    const pending = f.api.engineWork(control, phase, () => phase.childJoined);
    if (failure === "deadline") fireDeadline();
    await assert.rejects(pending, (error) =>
      failure === "deadline"
        ? /ENGINE_DEADLINE/.test(error.message)
        : error === expected,
    );
    const primary = state.primary;
    const retirement = f.api.retireEnginePhase(control, phase);
    // Observe actual owned FD closes before firing the modeled cleanup deadline.
    // The child never closes, so only the explicit original deadline ends join.
    await untilCreated(() => phase.logFds.size === 0);
    fireDeadline();
    await retirement;
    assert(performance.now() - began < 5000);
    assert.equal(f.api.leases.get(f.lease).wallEnd, originalEnds.wallEnd);
    assert.equal(f.api.leases.get(f.lease).monoEnd, originalEnds.monoEnd);
    assert.equal(state.primary, primary);
    assert.equal(phase.retired, true);
    assert.equal(phase.cleanupConfirmed, false);
    assert.equal(phase.childEvents.close, false);
    assert.equal(phase.logFds.size, 0);
    assert.equal(phase.child, null);
    assert.equal(phase.ownedListeners.length, 0);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert(kills >= 1);
    assert.equal(unrefs, 1);
    await assert.rejects(
      f.api.retireControl(control),
      (error) => error === primary,
    );
    child._handle?.close();
    child._handle = null;
  }
});

test("parent engine save rejects late retirement directly before mutation and never refreshes original phase ends", async (t) => {
  let f,
    phase,
    armed = false,
    writes = 0;
  f = await controlFixture(t, {
    fs: {
      ...fs,
      async realpath(name, ...args) {
        const value = await fs.realpath(name, ...args);
        if (armed && name === f.api.controls.get(control).directory) {
          armed = false;
          queueMicrotask(() => {
            phase.retired = true;
          });
        }
        return value;
      },
      async writeFile(...args) {
        if (String(args[0]).endsWith("engine-late.json")) writes++;
        return fs.writeFile(...args);
      },
    },
  });
  const control = await f.api.createControl(f.receipt, f.lease),
    state = f.api.controls.get(control);
  phase = {
    role: "probe-clang",
    wallEnd: Date.now() + 900000,
    monoEnd: performance.now() + 900000,
    retired: false,
    pending: new Set(),
  };
  state.enginePhase = phase;
  const ends = [phase.wallEnd, phase.monoEnd];
  armed = true;
  await assert.rejects(
    f.api.engineSave(control, phase, "engine-late.json", Buffer.from("{}")),
    /ENGINE_BRAND/,
  );
  assert.equal(writes, 0);
  assert.deepEqual([phase.wallEnd, phase.monoEnd], ends);
  await assert.rejects(
    fs.stat(path.join(f.base, "engine-late.json")),
    (error) => error.code === "ENOENT",
  );
  await assert.rejects(
    f.api.retireControl(control),
    (error) => error === state.primary,
  );
});

test("actual full transaction retires every owner independently and preserves a falsy original failure", async () => {
  const source = await read(prefix + "full_sdk_control.mjs");
  const { default: ts } = await import("typescript");
  const tree = ts.createSourceFile(
    "control.mjs",
    source,
    99,
    true,
    ts.ScriptKind.JS,
  );
  const body = tree.statements
    .find(
      (row) =>
        ts.isFunctionDeclaration(row) &&
        row.name?.text === "runFullSdkTransaction",
    )
    .getText(tree);
  for (const original of [false, undefined]) {
    const bootstrap = {},
      operation = {},
      control = {},
      lease = {},
      cancel = new AbortController(),
      calls = [];
    const owner = { pid: process.pid, lease, cancel, closed: false, operation },
      sourceState = { cleanupConfirmed: false },
      controlState = { cleanupConfirmed: false, failed: false };
    const bootstrapOwners = new WeakMap([[bootstrap, owner]]),
      sourceOperations = new WeakMap([[operation, sourceState]]),
      controls = new WeakMap([[control, controlState]]),
      leases = new WeakMap([
        [
          lease,
          {
            closed: false,
            wallEnd: Date.now() + 600000,
            monoEnd: performance.now() + 600000,
          },
        ],
      ]);
    const cleanupError = Error("ACTUAL_CONTROL_RETIRE_FAILURE");
    const context = {
      bootstrapOwners,
      sourceOperations,
      controls,
      leases,
      process,
      CLEANUP_MS: 30000,
      FINAL_RESERVE_MS: 120000,
      Date,
      performance,
      cleanupStep: async (_, action) => action(),
      need: (ok, code) => assert(ok, code),
      bootstrapState: () => owner,
      observeStartupPhase: () => {},
      captureStartupFailure: () => {},
      createSourceOperation: async () => operation,
      runSourcePhase: async () => ({}),
      createControl: async () => control,
      prepareFreshPolicy: async () => {},
      runEnginePhase: async () => {
        if (original === false) throw false;
        return {};
      },
      verifyProducedSdk: async () => ({ sdkBuilt: true }),
      verifyProducedCheckpoint: async () => {
        throw Error("unexpected checkpoint");
      },
      publishControllerOutcome: async () => calls.push("report"),
      retireControl: async () => {
        calls.push("control");
        throw cleanupError;
      },
      retireSourceOperation: async () => {
        calls.push("source");
        sourceState.cleanupConfirmed = true;
      },
    };
    const actual = new Function(
      ...Object.keys(context),
      body + ";return runFullSdkTransaction;",
    )(...Object.values(context));
    await assert.rejects(
      actual(bootstrap),
      (error) => error === (original === false ? false : cleanupError),
    );
    assert.deepEqual(
      calls,
      original === false
        ? ["control", "source"]
        : ["report", "control", "source"],
    );
    assert.equal(owner.closed, true);
    assert.equal(bootstrapOwners.has(bootstrap), false);
    assert.equal(leases.get(lease).closed, true);
    assert.equal(sourceState.cleanupConfirmed, true);
    if (original === false) {
      assert.equal(cancel.signal.aborted, true);
      assert.equal(cancel.signal.reason, false);
    }
  }
});

test("actual codec ready writer feeds the exact parent handoff reader including immutable artifact pin", async (t) => {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "actual-ready-protocol-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "a/sortOfRemoteNG/sortOfRemoteNG"),
    directory = path.join(base, "a/_temp/sorng-windows-arm-checkpoint-30-1");
  await fs.mkdir(directory, { recursive: true });
  const rows = [
    {
      path: "native/windows-arm-full-sdk/compiled_checkpoint.py",
      bytes: 100008,
      sha256:
        "a945464bead52c2d8413fd05fdc158f250749a8d85caab87a29782a5edeae2d9",
    },
  ];
  const program = `import ast,importlib.util,pathlib,sys,json
file=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('codec_ready_protocol',file);codec=importlib.util.module_from_spec(spec);spec.loader.exec_module(codec)
tree=ast.parse(file.read_text());function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='transport_download')
start=next(i for i,n in enumerate(function.body)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='ready'for t in n.targets))
statements=function.body[start:-1]
rows=json.loads(sys.argv[3]);image='20261030.294.1';source=codec.inputs.SOURCES[image]
identity=dict(image=image,sourceId=source,producerSha256=codec.producer_digest(rows),sourceDateEpoch=dict(present=False,value=None),canonicalRoot=codec.inputs.root_name(image,source),toolProofPin=dict(bytes=1,sha256='4'*64),graphPin=dict(bytes=1,sha256='5'*64))
scope=dict(codec.__dict__);scope.update(record_pin=dict(bytes=1,sha256='1'*64),prior_run='20',prior_attempt='1',current=dict(id=30,run_attempt=1),prior=dict(head_sha='c'*40),record=dict(identity=identity),artifact_pin=dict(id=901,bytes=31,sha256='2'*64),destination=pathlib.Path(sys.argv[2]))
exec(compile(ast.Module(body=statements,type_ignores=[]),str(file),'exec'),scope)
print('actual-ready-writer-complete')`;
  assert.match(
    execFileSync(
      "python",
      [
        "-I",
        "-B",
        "-c",
        program,
        path.join(root, prefix, "compiled_checkpoint.py"),
        directory,
        JSON.stringify(rows),
      ],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    ),
    /actual-ready-writer-complete/,
  );
  const codecReady = JSON.parse(
    await fs.readFile(path.join(directory, "ready.json")),
  );
  assert.equal(Object.keys(codecReady).length, 10);
  assert.equal(codecReady.sealArtifact.id, 901);
  const api = await inactiveControl({
    moduleURL: new URL(
      "file:///" +
        path
          .join(repo, "native/windows-arm-full-sdk/full_sdk_control.mjs")
          .replaceAll("\\", "/"),
    ).href,
    process: {
      ...process,
      env: {
        CEF_FULLSDK_RESTORE_RUN: "20",
        RUNNER_TEMP: path.join(base, "a/_temp"),
        GITHUB_RUN_ID: "30",
        GITHUB_RUN_ATTEMPT: "1",
      },
    },
  });
  const bootstrap = api.beginFullSdkBootstrap();
  const result = await api.readRestoreHandoff(
    bootstrap,
    rows,
    "20261030.294.1",
    codecReady.identity.sourceId,
  );
  assert.equal(result.runId, "20");
  assert.equal(result.attempt, "1");
  assert.equal(
    result.readyPin.sha256,
    sha(await fs.readFile(path.join(directory, "ready.json"))),
  );
  const bad = {
    ...codecReady,
    sealArtifact: { ...codecReady.sealArtifact, id: 0 },
  };
  await fs.writeFile(path.join(directory, "ready.json"), JSON.stringify(bad));
  await assert.rejects(
    api.readRestoreHandoff(
      bootstrap,
      rows,
      "20261030.294.1",
      codecReady.identity.sourceId,
    ),
    /RESTORE_ARTIFACT_PIN/,
  );
});

test("bounded bootstrap reader denies actual growth replacement and falsy read faults before oversized allocation", async (t) => {
  for (const mode of ["pre-open-growth", "read-growth", "replace", "false"]) {
    const base = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), "bootstrap-held-bound-")),
    );
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const file = path.join(base, "ready.json");
    await fs.writeFile(file, "{}");
    let grown = false,
      allocMax = 0,
      readMax = 0,
      closes = 0,
      readFileCalls = 0;
    const max = 2097152;
    const api = await inactiveControl({
      Buffer: new Proxy(Buffer, {
        get(target, key) {
          if (key === "alloc")
            return (size) => {
              allocMax = Math.max(allocMax, size);
              assert(size <= max + 1);
              return Buffer.alloc(size);
            };
          return Reflect.get(target, key);
        },
      }),
      fs: {
        ...fs,
        async readFile(...args) {
          readFileCalls++;
          return fs.readFile(...args);
        },
        async open(name, ...args) {
          if (name === file && !grown && mode === "pre-open-growth") {
            grown = true;
            await fs.writeFile(file, Buffer.alloc(max + 1));
          }
          if (name === file && !grown && mode === "replace") {
            grown = true;
            await fs.rename(file, path.join(base, "old.json"));
            await fs.writeFile(file, "{}");
          }
          const fd = await fs.open(name, ...args);
          return new Proxy(fd, {
            get(target, key) {
              if (key === "read")
                return async (...params) => {
                  readMax = Math.max(readMax, params[2]);
                  if (mode === "false") throw false;
                  if (!grown && mode === "read-growth") {
                    grown = true;
                    await fs.appendFile(file, Buffer.alloc(max));
                  }
                  return target.read(...params);
                };
              if (key === "close")
                return async () => {
                  closes++;
                  return target.close();
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      },
    });
    const bootstrap = api.beginFullSdkBootstrap(),
      owner = api.bootstrapState(bootstrap),
      ends = { ...api.leases.get(owner.lease) };
    await assert.rejects(
      api.bootstrapHeldFile(bootstrap, file, max),
      (error) =>
        mode === "false"
          ? error === false
          : /BOOTSTRAP_FILE_(?:BOUND|CHANGED|GROWTH)/.test(error.message),
    );
    assert.equal(readFileCalls, 0);
    assert(allocMax <= max + 1);
    assert(readMax <= max + 1);
    assert.equal(closes, 1);
    assert.equal(owner.bootstrapFds.size, 0);
    assert.equal(api.leases.get(owner.lease).wallEnd, ends.wallEnd);
    assert.equal(api.leases.get(owner.lease).monoEnd, ends.monoEnd);
    if (mode === "pre-open-growth" || mode === "replace")
      assert.equal(allocMax, 0);
  }
});

test("actual public bootstrap preserves native FS failures and emits only fixed startup context", async () => {
  const profileFile = path.join(root, prefix, "full-sdk-source-profile.json");
  for (const primary of [
    Object.assign(new TypeError("private path SECRET_TOKEN"), {
      code: "ERR_INVALID_ARG_TYPE",
      syscall: "lstat",
      path: "private/SECRET_TOKEN",
    }),
    Object.assign(new Error("private path SECRET_TOKEN"), {
      code: "ENOENT",
      syscall: "lstat",
      path: "private/SECRET_TOKEN",
    }),
  ]) {
    let actors = 0,
      writes = 0,
      owner,
      bootstrap;
    const api = await inactiveControl({
      spawn() {
        actors++;
        assert.fail("NO_ACTOR");
      },
      fs: {
        ...fs,
        async lstat(file, ...args) {
          if (file === profileFile) throw primary;
          return fs.lstat(file, ...args);
        },
        async writeFile() {
          writes++;
          assert.fail("NO_MUTATION");
        },
      },
    });
    const originalSet = api.bootstrapOwners.set.bind(api.bootstrapOwners);
    // Nonproduction lexical maps only; no real issuer/capability is injected.
    api.bootstrapOwners.set = (token, state) => {
      bootstrap = token;
      owner = state;
      return originalSet(token, state);
    };
    await assert.rejects(api.main(["--execute"]), (error) => error === primary);
    const report = api.startupFailureReport(primary);
    assert.deepEqual(report, {
      kind: "windows-arm-full-sdk-failure",
      error: "FULL_SDK_CONTROL_FAILED",
      diagnostic: {
        phase: "profile",
        fileKind: "profile",
        name: primary instanceof TypeError ? "TypeError" : "Error",
        code: primary.code,
        syscall: "lstat",
      },
      sdkBuilt: false,
      nativeAcceptance: false,
    });
    // The previous actual footer projected only this generic code; it could not
    // distinguish either observed filesystem failure or the owning phase.
    const old = ((error) => {
      const code = /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(error?.message ?? "")
        ? error.message
        : "FULL_SDK_CONTROL_FAILED";
      return {
        kind: "windows-arm-full-sdk-failure",
        error: code,
        sdkBuilt: false,
        nativeAcceptance: false,
      };
    })(primary);
    assert.equal(old.error, report.error);
    assert.equal(old.diagnostic, undefined);
    assert(!JSON.stringify(report).includes("SECRET_TOKEN"));
    assert.equal(owner.closed, true);
    assert.equal(api.bootstrapOwners.has(bootstrap), false);
    assert.equal(api.leases.get(owner.lease).closed, true);
    assert.equal(
      api.leases.get(owner.lease).wallEnd,
      owner.wallStart + 21600000,
    );
    assert.equal(
      api.leases.get(owner.lease).monoEnd,
      owner.monoStart + 21600000,
    );
    assert.equal(owner.bootstrapFds.size, 0);
    assert.equal(owner.bootstrapPending.size, 0);
    assert.equal(actors, 0);
    assert.equal(writes, 0);
  }
});

test("startup diagnostic preserves exactly the actual eleven public workflow clock errors", async () => {
  const { parse } = await import("acorn");
  const source = await read(prefix + "workflow-clock.mjs");
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const codes = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (
      value.type === "CallExpression" &&
      value.callee?.name === "need" &&
      value.arguments[1]?.type === "Literal" &&
      typeof value.arguments[1].value === "string"
    )
      codes.add("FULL_SDK_WORKFLOW_CLOCK_" + value.arguments[1].value);
    for (const item of Object.values(value))
      if (Array.isArray(item)) item.forEach(walk);
      else if (item && typeof item === "object") walk(item);
  }
  walk(tree);
  assert.equal(codes.size, 11);
  const api = await inactiveControl();
  for (const code of codes) {
    const result = api.startupFailureReport(new Error(code));
    assert.equal(result.error, code);
    assert.equal(result.sdkBuilt, false);
    assert.equal(result.nativeAcceptance, false);
  }
  for (const code of [
    "FULL_SDK_WORKFLOW_CLOCK_UNKNOWN",
    "FULL_SDK_WORKFLOW_CLOCK_HOST_PRIVATE",
    "FULL_SDK_WORKFLOW_CLOCK_HOST\nSECRET_TOKEN",
    "full_sdk_workflow_clock_host",
  ])
    assert.equal(
      api.startupFailureReport(new Error(code)).error,
      "FULL_SDK_CONTROL_FAILED",
    );
  const raw = await read(prefix + "full_sdk_control.mjs");
  clockFailureControllerInverse(raw);
  assert.throws(() =>
    clockFailureControllerInverse(raw + CLOCK_FAILURE_INVERSE.block),
  );
  assert.throws(() =>
    clockFailureControllerInverse(
      raw.replace(CLOCK_FAILURE_INVERSE.newPredicate, "/*tamper*/"),
    ),
  );
});

test("startup diagnostic omits hostile fields and preserves falsy public bootstrap failures", async () => {
  const profileFile = path.join(root, prefix, "full-sdk-source-profile.json");
  for (const primary of [
    false,
    0,
    null,
    Object.assign(new TypeError("SECRET_TOKEN/private/path"), {
      code: "SECRET_TOKEN",
      syscall: "PRIVATE_SYSCALL",
      path: "SECRET_TOKEN/private/path",
    }),
  ]) {
    const api = await inactiveControl({
      fs: {
        ...fs,
        async lstat(file, ...args) {
          if (file === profileFile) throw primary;
          return fs.lstat(file, ...args);
        },
      },
    });
    let caught = false;
    try {
      await api.main(["--execute"]);
    } catch (error) {
      caught = true;
      assert.equal(error, primary);
    }
    assert.equal(caught, true);
    const report = api.startupFailureReport(primary),
      raw = JSON.stringify(report);
    assert.equal(report.error, "FULL_SDK_CONTROL_FAILED");
    assert(!raw.includes("SECRET_TOKEN"));
    assert(!raw.includes("PRIVATE_SYSCALL"));
    assert(!Object.hasOwn(report.diagnostic, "code"));
    assert(!Object.hasOwn(report.diagnostic, "syscall"));
  }
  const api = await inactiveControl();
  let reads = 0;
  const hostile = new Error();
  for (const key of ["message", "code", "syscall", "path", "stack", "name"])
    Object.defineProperty(hostile, key, {
      get() {
        reads++;
        throw Error("HOSTILE_GETTER");
      },
      configurable: true,
    });
  assert.equal(
    api.startupFailureReport(hostile).error,
    "FULL_SDK_CONTROL_FAILED",
  );
  assert.equal(
    api.startupFailureReport(
      new Proxy(
        {},
        {
          get() {
            reads++;
            throw Error("HOSTILE_GETTER");
          },
          getOwnPropertyDescriptor() {
            reads++;
            throw Error("HOSTILE_GETTER");
          },
        },
      ),
    ).diagnostic.name,
    "ThrownValue",
  );
  assert.equal(reads, 0);
});

test("startup observability has an exact whole-controller inverse and rejects tampered or duplicate blocks", async () => {
  const raw = await read(prefix + "full_sdk_control.mjs");
  startupControllerInverse(raw);
  for (const row of STARTUP_OBSERVABILITY_HISTORY.rows) {
    const current = row.newRaw
      .replace(
        "const startupErrorContexts = new WeakMap();\n",
        "const startupErrorContexts = new WeakMap();\n" +
          SOURCE_FAILURE_INVERSE.rows[1].newRaw,
      )
      .replace(
        '  if (STARTUP_SYSCALLS.has(own("syscall"))) diagnostic.syscall = own("syscall");\n',
        '  if (STARTUP_SYSCALLS.has(own("syscall"))) diagnostic.syscall = own("syscall");\n' +
          SOURCE_FAILURE_INVERSE.rows[2].newRaw,
      )
      .replace(
        "const STARTUP_ERROR_CODES = new Set([",
        CLOCK_FAILURE_INVERSE.block + "const STARTUP_ERROR_CODES = new Set([",
      )
      .replace(
        CLOCK_FAILURE_INVERSE.oldPredicate,
        CLOCK_FAILURE_INVERSE.newPredicate,
      )
      .replace('  "spawn",\n]);\n', '  "spawn",\n  "mkdir",\n]);\n')
      .replace(
        "// END BOUNDED STARTUP OBSERVABILITY\n\nasync function createSourceOperation",
        "// END BOUNDED STARTUP OBSERVABILITY\n\n" +
          SOURCE_PARENT_INVERSE.rows[0].newRaw +
          "async function createSourceOperation",
      );
    assert.equal(raw.split(current).length, 2);
    assert.throws(() =>
      startupControllerInverse(raw.replace(current, current + "/*tamper*/")),
    );
    assert.throws(() => startupControllerInverse(raw + current));
  }
});

test("producer metric checked-input observations are actual held readbacks with fixed boundaries and single consumption", async (t) => {
  const f = await parentEngineFixture(t);
  const state = f.api.controls.get(f.control),
    before = state.checkedInputsBefore;
  assert.equal(before.boundary, "before-probe-clang");
  assert.equal(before.content.kind, "windows-arm-checked-input-closure");
  assert.ok(
    before.content.records.some((row) => row.relative === "context.json"),
  );
  assert.equal(
    before.content.records.filter(
      (row) => row.relative === "full-metadata-result.json",
    ).length,
    1,
  );
  const observation = await f.api.recheckSourceReceipt(f.source, f.owner.lease);
  const after = f.api.consumeCheckedInputObservation(
    f.control,
    state,
    observation,
    "after-package-before-sdk-seal",
  );
  assert.equal(after.boundary, "after-package-before-sdk-seal");
  assert.equal(after.sha256, before.sha256);
  assert.deepEqual(after.content, before.content);
  assert.notEqual(after.content, before.content);
  assert.throws(
    () =>
      f.api.consumeCheckedInputObservation(
        f.control,
        state,
        observation,
        "after-package-before-sdk-seal",
      ),
    /INPUT_CLOSURE_BRAND/,
  );
  assert.throws(
    () =>
      f.api.consumeCheckedInputObservation(
        f.control,
        state,
        { ...after },
        "after-package-before-sdk-seal",
      ),
    /INPUT_CLOSURE_BRAND/,
  );
  const file = path.join(f.base, "full-metadata-result.json"),
    raw = await fs.readFile(file);
  await fs.writeFile(file, Buffer.concat([raw, Buffer.from(" ")]));
  await assert.rejects(f.api.recheckSourceReceipt(f.source, f.owner.lease));
  assert.equal(state.checkedInputsBefore, before);
});

test("producer metric checked-input receipt cannot cross controls or survive final-await retirement and falsy cancellation", async (t) => {
  const f = await parentEngineFixture(t);
  const state = f.api.controls.get(f.control);
  const observation = await f.api.recheckSourceReceipt(f.source, f.owner.lease);
  assert.throws(
    () =>
      f.api.consumeCheckedInputObservation(
        f.control,
        { ...state, sourceReceipt: {} },
        observation,
        "after-package-before-sdk-seal",
      ),
    /RETIRED|INPUT_CLOSURE_BRAND/,
  );
  const next = await f.api
    .recheckSourceReceipt(f.source, f.owner.lease)
    .then((value) => {
      f.api.sourceSessions.delete(f.source); // Same-realm retirement before caller continuation.
      return value;
    });
  assert.throws(() =>
    f.api.consumeCheckedInputObservation(
      f.control,
      state,
      next,
      "after-package-before-sdk-seal",
    ),
  );
  // Original falsy cancellation remains the first cause, not a diagnostic error.
  const other = await parentEngineFixture(t);
  const original = await other.api.recheckSourceReceipt(
    other.source,
    other.owner.lease,
  );
  other.owner.cancel.abort(false);
  assert.throws(
    () =>
      other.api.consumeCheckedInputObservation(
        other.control,
        other.api.controls.get(other.control),
        original,
        "after-package-before-sdk-seal",
      ),
    (error) => error === false,
  );
});

// Real filesystem/public main; only native tool selection and the fixed clock
// ChildProcess leaf are modeled in isolated maps. No source session is minted.
async function sourceParentBootstrapFixture(t, mode) {
  const { PassThrough } = await import("node:stream");
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "fullsdk-clean-checkout-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "repo"),
    here = path.join(repo, prefix),
    parent = path.join(repo, ".artifacts");
  await fs.mkdir(here, { recursive: true });
  await fs.mkdir(path.join(repo, ".github/workflows"), { recursive: true });
  for (const name of ["sdk-origin-review.json", "source-root.mjs"])
    await fs.copyFile(path.join(root, prefix, name), path.join(here, name));
  // The fixed workflow checks out with core.autocrlf=false.
  await fs.writeFile(
    path.join(repo, ".github/workflows/windows-arm-full-sdk.yml"),
    (await read(".github/workflows/windows-arm-full-sdk.yml")).replaceAll(
      "\r\n",
      "\n",
    ),
  );
  // This isolated checkout models the exact current workflow/policy pairing.
  // No production policy or source-session authority is changed by the fixture.
  const fixturePolicyPath = path.join(here, "sdk-origin-review.json");
  const fixturePolicy = JSON.parse(await fs.readFile(fixturePolicyPath));
  const fixtureWorkflow = await fs.readFile(
    path.join(repo, ".github/workflows/windows-arm-full-sdk.yml"),
  );
  fixturePolicy.workflowPin = {
    bytes: fixtureWorkflow.length,
    sha256: sha(fixtureWorkflow),
  };
  await fs.writeFile(fixturePolicyPath, JSON.stringify(fixturePolicy));
  const p = JSON.parse(await read(prefix + "full-sdk-source-profile.json"));
  const python = await benignPython(t);
  if (!python) return;
  for (const [key, file] of [
    ["node", process.execPath],
    ["python", python],
  ]) {
    const canonical = await fs.realpath(file),
      raw = await fs.readFile(canonical);
    // Owned copies avoid local package-manager hardlink counts. They are DATA
    // stand-ins in this lexical model and are never executed.
    const copy = path.join(here, `${key}-fixture.exe`);
    await fs.writeFile(copy, raw, { flag: "wx" });
    p[key] = {
      ...p[key],
      path: copy.replaceAll("\\", "/"),
      bytes: raw.length,
      sha256: sha(raw),
    };
  }
  const profileBytes = Buffer.from(JSON.stringify(p));
  await fs.writeFile(
    path.join(here, "full-sdk-source-profile.json"),
    profileBytes,
  );
  const { fullSdkSourceRootName } =
    await import("../../native/windows-arm-full-sdk/source-root.mjs");
  const sourceId = JSON.parse(await read(prefix + "sdk-origin-review.json"))
    .sources["20261030.294.1"].sourceLockIdentity;
  // Source identity is fixed by the actual pure naming implementation.
  const sourceRoot = path.join(
    parent,
    fullSdkSourceRootName("20261030.294.1", sourceId),
  );
  const leaf = new Error("MODELED_NO_SOURCE_ACTOR");
  let owner,
    bootstrap,
    operation,
    operationToken,
    api,
    clockActors = 0,
    ownerOpens = 0,
    rootCreates = 0,
    parentCreates = 0,
    replaced = false,
    expired = false;
  if (["existing", "replace", "root-race"].includes(mode))
    await fs.mkdir(parent);
  if (mode === "file") await fs.writeFile(parent, "not a directory");
  if (mode === "junction") {
    await fs.mkdir(path.join(base, "other"));
    await fs.symlink(
      path.join(base, "other"),
      parent,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const existingIdentity =
    mode === "existing" ? await fs.lstat(parent, { bigint: true }) : null;
  const wall = Date.now() - 1000,
    head = "a".repeat(40);
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    CEF_DEFAULT_BRANCH: "main",
    CEF_FULLSDK_RESTORE_RUN: "0",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_JOB: "sdk",
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-full-sdk.yml@refs/heads/main",
    ImageVersion: "20261030.294.1",
  };
  env.SORNG_FULLSDK_FIRST_CLOCK = JSON.stringify({
    schemaVersion: 1,
    kind: "windows-arm-first-workflow-clock",
    clock: "windows-gettickcount64",
    dotnetMajor: 10,
    wallStartMs: wall,
    tickStartMs: 100000,
    wallEndMs: wall + 21600000,
    tickEndMs: 21700000,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    ref: env.GITHUB_REF,
    event: env.GITHUB_EVENT_NAME,
    runId: "1",
    attempt: "1",
    head,
    workflowSha: head,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    job: "sdk",
    image: env.ImageVersion,
  });
  api = await inactiveControl(
    {
      moduleURL: new URL(
        "file:///" +
          path.join(here, "full_sdk_control.mjs").replaceAll("\\", "/"),
      ).href,
      process: { ...process, env, execPath: p.node.path },
      Date: { now: () => Date.now() + (expired ? 21600000 : 0) },
      spawn() {
        clockActors++;
        assert.equal(clockActors, 1, "source/Job/compiler launches forbidden");
        const child = new ChildProcess();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => {
          child.stdout.write(
            JSON.stringify({
              monotonic: 101,
              parentPid: process.pid,
              parentCreationFiletime: "12345",
            }),
          );
          child.emit("exit", 0, null);
          child.stdout.destroy();
          child.stderr.destroy();
          child.emit("close", 0, null);
        });
        return child;
      },
      fs: {
        ...fs,
        async mkdir(name, ...args) {
          if (name === parent) {
            parentCreates++;
            assert.equal(args[0]?.recursive, undefined);
            if (mode === "parent-race") await fs.mkdir(parent);
          }
          if (name === sourceRoot) {
            rootCreates++;
            if (mode === "root-race") await fs.mkdir(sourceRoot);
          }
          const result = await fs.mkdir(name, ...args);
          if (name === sourceRoot && mode === "replace") {
            await fs.rename(parent, path.join(repo, "old-artifacts"));
            await fs.mkdir(parent);
            replaced = true;
          }
          return result;
        },
        async lstat(name, ...args) {
          try {
            return await fs.lstat(name, ...args);
          } finally {
            if (
              name === parent &&
              owner?.operation &&
              ["false", "expired"].includes(mode)
            ) {
              if (mode === "false") owner.cancel.abort(false);
              else expired = true;
            }
          }
        },
        async open(name, ...args) {
          if (path.basename(name) === "full-sdk-source-owner.bin") {
            ownerOpens++;
            throw leaf;
          }
          return fs.open(name, ...args);
        },
      },
    },
    sha(profileBytes),
    mode === "old-parent",
  );
  const setOwner = api.bootstrapOwners.set.bind(api.bootstrapOwners);
  api.bootstrapOwners.set = (token, state) => {
    bootstrap = token;
    owner = state;
    return setOwner(token, state);
  };
  const setOperation = api.sourceOperations.set.bind(api.sourceOperations);
  api.sourceOperations.set = (token, state) => {
    operationToken = token;
    operation = state;
    return setOperation(token, state);
  };
  let primary;
  try {
    await api.main(["--execute"]);
    assert.fail("NO_SOURCE_ACTOR");
  } catch (error) {
    primary = error;
  }
  assert.equal(clockActors, 1, primary?.stack);
  assert.equal(owner.closed, true);
  assert.equal(api.bootstrapOwners.has(bootstrap), false);
  assert.equal(api.leases.get(owner.lease).closed, true);
  assert.equal(operation.closed, true);
  assert.equal(api.sourceOperations.has(operationToken), false);
  assert.equal(operation.issued, false);
  assert.equal(operation.pending.size, 0);
  assert.equal(operation.readFds.size, 0);
  assert.equal(operation.owner, null);
  return {
    api,
    base,
    repo,
    parent,
    sourceRoot,
    leaf,
    primary,
    ownerOpens,
    rootCreates,
    parentCreates,
    replaced,
    existingIdentity,
  };
}

test("actual public bootstrap creates only its missing artifacts parent before exclusive fresh source root", async (t) => {
  const previous = await sourceParentBootstrapFixture(t, "old-parent");
  if (!previous) return;
  assert.equal(previous.primary.code, "ENOENT");
  assert.equal(previous.primary.syscall, "mkdir");
  assert.equal(previous.ownerOpens, 0);
  assert.equal(previous.rootCreates, 1);
  assert.equal(previous.parentCreates, 0);
  await assert.rejects(fs.lstat(previous.parent), { code: "ENOENT" });
  for (const mode of ["absent", "existing"]) {
    const f = await sourceParentBootstrapFixture(t, mode);
    if (!f) return;
    assert.equal(f.primary, f.leaf);
    assert.equal(f.ownerOpens, 1);
    assert.equal(f.rootCreates, 1);
    assert.equal(f.parentCreates, 1);
    assert.equal((await fs.lstat(f.sourceRoot)).isDirectory(), true);
    if (f.existingIdentity)
      assert.equal(
        (await fs.lstat(f.parent, { bigint: true })).ino,
        f.existingIdentity.ino,
      );
    // Exact previous mutation on the same kind of clean checkout is causally RED.
    const oldRepo = path.join(f.base, "old-repo");
    await fs.mkdir(oldRepo);
    await assert.rejects(
      fs.mkdir(path.join(oldRepo, ".artifacts", "source"), { mode: 0o700 }),
      { code: "ENOENT" },
    );
  }
});
test("actual public bootstrap rejects artifacts parent files junctions replacement and raced source roots", async (t) => {
  for (const mode of [
    "file",
    "junction",
    "replace",
    "parent-race",
    "root-race",
  ]) {
    const f = await sourceParentBootstrapFixture(t, mode);
    if (!f) return;
    assert.notEqual(f.primary, f.leaf);
    assert.equal(f.ownerOpens, 0);
    if (mode === "replace") {
      assert.equal(f.replaced, true);
      assert.match(f.primary.message, /SOURCE_PARENT_CHANGED/);
    } else if (mode === "root-race" || mode === "parent-race")
      assert.equal(f.primary.code, "EEXIST");
    else {
      assert.match(f.primary.message, /DIRECTORY/);
      assert.equal(f.rootCreates, 0);
      assert.equal(f.parentCreates, 0);
    }
  }
});
test("actual public bootstrap consumes original clock and preserves falsy cancellation before parent mutation", async (t) => {
  for (const mode of ["false", "expired"]) {
    const f = await sourceParentBootstrapFixture(t, mode);
    if (!f) return;
    if (mode === "false") assert.equal(f.primary, false);
    else assert.match(f.primary.message, /DEADLINE/);
    assert.equal(f.parentCreates, 0);
    assert.equal(f.rootCreates, 0);
    assert.equal(f.ownerOpens, 0);
    await assert.rejects(fs.lstat(f.parent), { code: "ENOENT" });
  }
});
test("source child failure diagnostic observes actual child exit without printing held private output or changing primary", async (t) => {
  const f = await createdSourceFixture(t, "nonzero-hostile");
  let primary;
  try {
    await f.api.runSourcePhase(f.token);
    assert.fail("must reject");
  } catch (error) {
    primary = error;
  }
  assert.equal(primary, f.state.primary);
  assert.match(primary.message, /^FULL_SDK_CONTROL_SOURCE_CHILD_JOIN$/);
  const report = f.api.startupFailureReport(primary),
    copied = report.diagnostic.sourceChild;
  assert.deepEqual(copied, {
    phase: "source-launch",
    spawned: true,
    exited: true,
    closed: true,
    stdoutClosed: true,
    stderrClosed: true,
    exitCode: 7,
    closeCode: 7,
    exitSignal: null,
    closeSignal: null,
    capturedBytes: Buffer.byteLength("SECRET_TOKEN private/source/path\n"),
  });
  assert(Object.isFrozen(copied));
  assert(!JSON.stringify(report).includes("SECRET_TOKEN"));
  assert(!JSON.stringify(report).includes("private/source/path"));
  assert.equal(report.sdkBuilt, false);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(f.state.cleanupConfirmed, true);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.logFds.size, 0);
  assert.equal(f.state.readFds.size, 0);
  f.state.childEvents.code = 99;
  assert.equal(
    f.api.startupFailureReport(primary).diagnostic.sourceChild.exitCode,
    7,
  );
  const log = await fs.readFile(
    path.join(f.base, "source-launcher.stderr.log"),
    "utf8",
  );
  assert.equal(log, "SECRET_TOKEN private/source/path\n");
});

test("source child diagnostic closed code signal and byte bounds remain DATA and falsy cancellation retires unchanged", async (t) => {
  const { PassThrough } = await import("node:stream");
  const child = new ChildProcess();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  let getters = 0;
  const hostile = Object.defineProperty({}, "toString", {
    get() {
      getters++;
      throw Error("PRIVATE");
    },
  });
  const f = await createdSourceFixture(t, "non-production-native-events", {
    spawn() {
      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", hostile, "SECRET_SIGNAL");
        child.stdout.destroy();
        child.stderr.destroy();
        child.emit("close", 4294967296, hostile);
      });
      return child;
    },
  });
  let primary;
  try {
    await f.api.runSourcePhase(f.token);
    assert.fail("must reject");
  } catch (error) {
    primary = error;
  }
  assert.equal(primary, f.state.primary);
  const copied = f.api.startupFailureReport(primary).diagnostic.sourceChild;
  assert.equal(copied.exitCode, null);
  assert.equal(copied.closeCode, null);
  assert.equal(copied.exitSignal, null);
  assert.equal(copied.closeSignal, null);
  assert.equal(getters, 0);
  assert.equal(copied.capturedBytes, 0);
  assert.equal(f.state.issued, false);
  assert.equal(f.state.cleanupConfirmed, true);
  const canceled = await createdSourceFixture(t, "wait");
  const pending = canceled.api.runSourcePhase(canceled.token);
  await untilCreated(() => canceled.state.childEvents?.spawn);
  canceled.owner.cancel.abort(false);
  await assert.rejects(pending, (error) => error === false);
  assert.equal(canceled.state.primary, false);
  assert.equal(canceled.state.closed, true);
  assert.equal(canceled.state.logFds.size, 0);
  assert.equal(canceled.state.pendingWriters, 0);
  assert.equal(
    Object.hasOwn(
      canceled.api.startupFailureReport(false).diagnostic,
      "sourceChild",
    ),
    false,
  );
});

test("full SDK retention includes hidden owned bounded source logs and immutable seal without broad source or environment capture", async () => {
  const workflow = (
    await read(".github/workflows/windows-arm-full-sdk.yml")
  ).replaceAll("\r\n", "\n");
  const anchor = workflow
    .split(
      "      - name: Anchor the exact completed raw seal in immutable Actions storage\n",
    )[1]
    .split("      - name: Retain bounded qualification records\n")[0];
  assert(
    anchor.includes(
      "          path: ${{ steps.transport.outputs.seal_path }}\n",
    ),
  );
  assert(anchor.includes("          include-hidden-files: true\n"));
  const records = workflow.split(
    "      - name: Retain bounded qualification records\n",
  )[1];
  assert(records.includes("        if: always()\n"));
  assert(records.includes("          include-hidden-files: true\n"));
  const paths = records
    .split("          path: |\n")[1]
    .trim()
    .split("\n")
    .map((s) => s.trim());
  assert.deepEqual(
    paths,
    [
      "full-sdk-controller-result.json",
      "full-source-*.json",
      "full-metadata-result.json",
      "sdk-data-result.json",
      "llvm-data-result.json",
      "rust-archive-result.json",
      "gn-archive-result.json",
      "siso-archive-result.json",
      "materialize-result.json",
      "runtime-closure-result.json",
      "runtime-progress-[0-9][0-9][0-9]-result.json",
      "source-setup-verification-result.json",
      "source-phase-result.json",
      "source-progress-metadata-result.json",
      "source-deadline-result.json",
      "source-gn-result.json",
      "source-launcher.stdout.log",
      "source-launcher.stderr.log",
      "full-sdk-engine-*.json",
      "full-sdk-engine-*.log",
      "jobs/*/receipt.json",
      "jobs/*/stdout.log",
      "jobs/*/stderr.log",
      "source-gn-logs/sync.stdout.log",
      "source-gn-logs/sync.stderr.log",
      "source-gn-logs/hook-projection.stdout.log",
      "source-gn-logs/hook-projection.stderr.log",
      "source-gn-logs/dependency-hooks.stdout.log",
      "source-gn-logs/dependency-hooks.stderr.log",
      "source-gn-logs/setup-x86.stdout.log",
      "source-gn-logs/setup-x86.stderr.log",
      "source-gn-logs/setup-x64.stdout.log",
      "source-gn-logs/setup-x64.stderr.log",
      "source-gn-logs/setup-arm64.stdout.log",
      "source-gn-logs/setup-arm64.stderr.log",
      "source-gn-logs/verify-setup.stdout.log",
      "source-gn-logs/verify-setup.stderr.log",
      "source-gn-logs/cef-gn.stdout.log",
      "source-gn-logs/cef-gn.stderr.log",
      "source-gn-logs/restore-checkpoint.stdout.log",
      "source-gn-logs/restore-checkpoint.stderr.log",
      "source-gn-logs/source-deadline.json",
    ].map((s) => ".artifacts/windows-arm-full-sdk-*/" + s),
  );
  assert(
    paths.every(
      (s) =>
        !s.includes("**") &&
        !s.includes("source-inputs") &&
        !s.includes("environment") &&
        !s.includes("context.json"),
    ),
  );
  const source = await read(prefix + "full_sdk_control.mjs");
  assert(source.includes("const SOURCE_LOG_CAP = 131072;"));
  sourceFailureControllerInverse(source);
  for (const row of SOURCE_FAILURE_INVERSE.rows) {
    assert.throws(() =>
      sourceFailureControllerInverse(
        source.replace(row.newRaw, row.newRaw + "/*tamper*/"),
      ),
    );
    assert.throws(() => sourceFailureControllerInverse(source + row.newRaw));
  }
});

test("full SDK artifact paths cover actual bounded data-worker and source diagnostic writers including a silent LLVM failure", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  // Execute the actual data-worker function in a disjoint data-only model. No
  // audit hook, acquisition, source issuer or native Job executes in this test.
  const program = String.raw`import ast,json,pathlib,re,sys,types
from urllib.error import HTTPError
here=pathlib.Path(sys.argv[1]);producer=ast.parse((here/'producer.py').read_text());full=ast.parse((here/'full_sdk_source.py').read_text())
roles=ast.literal_eval(next(n.value for n in full.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='_DATA_ROLES'for x in n.targets)))
worker=next(n for n in producer.body if isinstance(n,ast.FunctionDef)and n.name=='data_worker')
writer=next(n for n in ast.walk(worker)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='retain')
assert ast.unparse(writer.args[1])=="role + '-result.json'"
setup=next(n for n in producer.body if isinstance(n,ast.FunctionDef)and n.name=='verify_source_setup')
setupwriter=next(n for n in ast.walk(setup)if isinstance(n,ast.Call)and ast.unparse(n.func)=='data.save')
assert isinstance(setupwriter.args[0],ast.BinOp)and isinstance(setupwriter.args[0].op,ast.Div)
setupname=ast.literal_eval(setupwriter.args[0].right)
progress=next(n for n in producer.body if isinstance(n,ast.ClassDef)and n.name=='RuntimeProgress')
assert "self.count >= 128" in ast.unparse(progress)and "len(raw) <= 1024" in ast.unparse(progress)
assert 'runtime-progress-%03d-result.json' in ast.unparse(progress)
saved=[]
def fail(*args):
 e=HTTPError('https://invalid.example/PRIVATE',502,'SECRET_TOKEN',{},None);e._sorng_llvm_failure_stage=('upstream-witness',1);raise e
scope=dict(re=re,sys=types.SimpleNamespace(addaudithook=lambda _:None,modules={}),data=types.SimpleNamespace(acquire_llvm=fail,save=lambda path,value:saved.append((path.name,value))),verified_sources=lambda _:None,no_execution=lambda *args:None,COMMAND_INVENTORY_REPORTING_FAILURE=False)
names={'failure','llvm_failure_diagnostic','retain','data_worker'}
exec(compile(ast.Module(body=[n for n in producer.body if isinstance(n,ast.FunctionDef)and n.name in names],type_ignores=[]),'actual-producer-data-worker','exec'),scope)
status=scope['data_worker']('llvm-data',pathlib.Path('owned-model'),{}, {},types.SimpleNamespace(remaining=lambda:600))
assert type(status)is int and status==1 and len(saved)==1
name,result=saved[0];assert name=='llvm-data-result.json'and result['success']is False and result['sourcePostVerified']is True
assert result['firstFailure']=='BOOT_UNAVAILABLE'and result['failureDiagnostic']==dict(stage='upstream-witness',ordinal=1,category='http',httpStatus=502)
assert 'SECRET_TOKEN'not in json.dumps(result)and 'PRIVATE'not in json.dumps(result)
print(json.dumps(dict(roles=list(roles),setup=setupname,failureFile=name,failure=result,status=status,progressFiles=['runtime-progress-%03d-result.json'%i for i in range(128)])))`;
  const writers = JSON.parse(
    execFileSync(python, ["-I", "-B", "-c", program, path.join(root, prefix)], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    }),
  );
  assert.deepEqual(writers.roles, [
    "sdk-data",
    "llvm-data",
    "rust-archive",
    "gn-archive",
    "siso-archive",
    "materialize",
    "runtime-closure",
  ]);
  const workflow = (
    await read(".github/workflows/windows-arm-full-sdk.yml")
  ).replaceAll("\r\n", "\n");
  const records = workflow.split(
    "      - name: Retain bounded qualification records\n",
  )[1];
  const patterns = records
    .split("          path: |\n")[1]
    .trim()
    .split("\n")
    .map((s) => s.trim());
  const prefixPattern = ".artifacts/windows-arm-full-sdk-*/";
  const covered = (leaf) =>
    patterns.some((pattern) =>
      path.posix.matchesGlob(
        ".artifacts/windows-arm-full-sdk-owned/" + leaf,
        pattern,
      ),
    );
  const newLeaves = [
    ...writers.roles.map((role) => role + "-result.json"),
    "runtime-progress-[0-9][0-9][0-9]-result.json",
    writers.setup,
    "source-phase-result.json",
    "source-progress-metadata-result.json",
    "source-deadline-result.json",
    "source-gn-result.json",
  ];
  for (const leaf of newLeaves)
    assert(patterns.includes(prefixPattern + leaf), leaf);
  for (const leaf of [
    ...writers.progressFiles,
    writers.failureFile,
    writers.setup,
  ])
    assert(covered(leaf), leaf);
  const driver = await read(prefix + "full-sdk-source-driver.mjs");
  const actualJsWriters = new Set(
    [
      ...driver.matchAll(
        /path\.join\((?:this\.)?root,\s*"(source-(?:phase|progress-metadata|deadline|gn)-result\.json)"\)/g,
      ),
    ].map((match) => match[1]),
  );
  assert.deepEqual([...actualJsWriters].sort(), [
    "source-deadline-result.json",
    "source-gn-result.json",
    "source-phase-result.json",
    "source-progress-metadata-result.json",
  ]);
  for (const leaf of actualJsWriters) assert(covered(leaf), leaf);
  let previous = sourceAcquisitionInverse(workflow, "workflow");
  for (const leaf of newLeaves) {
    const line = "            " + prefixPattern + leaf + "\n";
    assert.equal(previous.split(line).length, 2);
    previous = previous.replace(line, "");
  }
  assert.equal(Buffer.byteLength(previous), 7450);
  assert.equal(
    sha(previous),
    "d2649a5120e313e2684df035f1dc32b64a3fffc4da88d8375358e04d8a34a836",
  );
  assert(!previous.includes(prefixPattern + writers.failureFile)); // Actual silent failure was previously lost.
  assert.equal(writers.status, 1);
  assert.equal(writers.failure.executed, false);
});
test("FULL environment fixture producer inverse restores the complete old source and rejects every tampered block", async () => {
  const current = (
    await fs.readFile(path.join(root, prefix, "producer.py"), "utf8")
  ).replaceAll("\r\n", "\n");
  const previous = fullSourceEnvironmentProducerInverse(current);
  assert.equal(Buffer.byteLength(previous), 59773);
  assert.equal(
    sha(previous),
    "1d98a4ba7e6db89a49b45c1c1deb73075a381d9a4f5b263507547c8d5c2d5c52",
  );
  for (const suffix of [
    "OWNER",
    "BRIDGE",
    "RETENTION BEFORE PROGRESS",
    "RETENTION BEFORE REPORT",
  ]) {
    const marker = "# BEGIN OWNED FULL SOURCE ENVIRONMENT " + suffix;
    assert.equal(current.split(marker).length, 2);
    assert.throws(() =>
      fullSourceEnvironmentProducerInverse(
        current.replace(marker, marker + " altered"),
      ),
    );
    assert.throws(() =>
      fullSourceEnvironmentProducerInverse(current + marker + "\n"),
    );
  }
  assert.throws(() => fullSourceEnvironmentProducerInverse(current + "\n"));
});
async function fullSourceImageFixture(
  t,
  { image = "20261030.294.1", previous = false, late = false } = {},
) {
  const firstWall = Date.now(),
    firstMono = performance.now();
  let clockAdvance = 0,
    actors = 0,
    metadataOpens = 0;
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "full-source-image-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "repo"),
    here = path.join(repo, prefix);
  let pRaw = await fs.readFile(
    path.join(root, prefix, "full-sdk-source-profile.json"),
  );
  if (previous)
    pRaw = Buffer.from(sourceAcquisitionInverse(pRaw.toString(), "profile"));
  const full = JSON.parse(pRaw);
  const policy = JSON.parse(await read(prefix + "sdk-origin-review.json"));
  fullSourceEnvironmentProducerInverse(
    (
      await fs.readFile(path.join(root, prefix, "producer.py"), "utf8")
    ).replaceAll("\r\n", "\n"),
  );
  const mutableFixtureRows = new Set([
    prefix + "producer.py",
    prefix + "full-sdk-source-driver.mjs",
    prefix + "full_sdk_control.mjs",
    prefix + "full_sdk_source.py",
    prefix + "full-sdk-source-profile.json",
    prefix + "test_full_sdk_source.py",
    "tests/tooling/windowsArmFullSdk.node-test.mjs",
    "tests/tooling/windowsArmFullSdkClock.node-test.mjs",
  ]);
  // Match the fixed workflow's core.autocrlf=false checkout. A canonical LF
  // substitution must match its existing pin, except the fixed current files
  // listed above whose modeled policy rows are refreshed to their actual bytes.
  for (const row of policy.producerInputs) {
    let raw =
      row.path === prefix + "full-sdk-source-profile.json"
        ? pRaw
        : await fs.readFile(path.join(root, row.path));
    // The old profile pins the previous image-profile bytes, so serve those.
    const imageName = previous
      ? {
          [prefix + "image-qualified-current-profile.json"]: "imageCurrent",
          [prefix + "image-qualified-20261021-profile.json"]: "image20261021",
          [prefix + "engine-qualification-profile.json"]: "engineProfile",
          [prefix + "private-qualification-profile.json"]: "privateProfile",
          [prefix +
          "current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs"]:
            "mirror",
        }[row.path]
      : undefined;
    if (imageName)
      raw = Buffer.from(
        fullGraphDeadlineInverse(
          raw.toString("utf8").replaceAll("\r\n", "\n"),
          imageName,
        ),
      );
    const mutable = mutableFixtureRows.has(row.path) || Boolean(imageName);
    if (raw.length !== row.bytes || sha(raw) !== row.sha256) {
      const lf = Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"));
      if (mutable) raw = lf;
      else {
        assert.equal(lf.length, row.bytes, row.path);
        assert.equal(sha(lf), row.sha256, row.path);
        raw = lf;
      }
    }
    if (mutable) {
      row.bytes = raw.length;
      row.sha256 = sha(raw);
    }
    const name = path.join(repo, row.path);
    await fs.mkdir(path.dirname(name), { recursive: true });
    await fs.writeFile(name, raw, { flag: "wx" });
  }
  const workflow = (await read(full.workflow)).replaceAll("\r\n", "\n");
  policy.workflowPin = {
    bytes: Buffer.byteLength(workflow),
    sha256: sha(workflow),
  };
  await fs.mkdir(path.dirname(path.join(repo, full.workflow)), {
    recursive: true,
  });
  await fs.writeFile(path.join(repo, full.workflow), workflow);
  const policyRaw = Buffer.from(JSON.stringify(policy, null, 2) + "\n");
  await fs.writeFile(path.join(repo, full.policy), policyRaw);
  const tuple = full.images[image];
  const { fullSdkSourceRootName } =
    await import("../../native/windows-arm-full-sdk/source-root.mjs");
  const sourceRoot = path.join(
    repo,
    ".artifacts",
    fullSdkSourceRootName(image, tuple.sourceId),
  );
  await fs.mkdir(path.join(sourceRoot, "source-inputs"), { recursive: true });
  for (const [i, row] of policy.producerInputs.entries())
    await fs.copyFile(
      path.join(repo, row.path),
      path.join(sourceRoot, "source-inputs", String(i)),
    );
  const head = "a".repeat(40);
  const context = {
    kind: "windows-arm-full-sdk-context",
    mode: "full-sdk-source-gn",
    workflow: full.workflow,
    policy: full.policy,
    ref: "refs/heads/main",
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: "1010282954",
    visibility: "public",
    event: "workflow_dispatch",
    defaultBranch: "main",
    head,
    workflowSha: head,
    runId: "1",
    attempt: "1",
    inputs: { restore_run: "0" },
    image,
    sourceId: tuple.sourceId,
    sourceProfileSha256: tuple.profileSha256,
    originPolicySha256: sha(policyRaw),
    sources: policy.producerInputs,
    wallWholeEnd: firstWall / 1000 + 21600,
    monotonicWholeEnd: firstMono / 1000 + 21600,
    wallWorkEnd: firstWall / 1000 + full.limits.sourceSeconds,
    monotonicWorkEnd: firstMono / 1000 + full.limits.sourceSeconds,
    wallAcquisitionEnd: firstWall / 1000 + full.limits.acquisitionSeconds,
    monotonicAcquisitionEnd: firstMono / 1000 + full.limits.acquisitionSeconds,
  };
  const contextRaw = Buffer.from(JSON.stringify(context) + "\n"),
    contextPin = sha(contextRaw);
  await fs.writeFile(path.join(sourceRoot, "context.json"), contextRaw);
  let text = await read(prefix + "full-sdk-source-driver.mjs");
  if (previous) text = fullSourceImageInverse(text);
  const ts = (await import("typescript")).default;
  const ast = ts.createSourceFile(
    "actual-full-source.mjs",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const previousCache = previous
    ? null
    : fullBootstrapCacheInverse(text, "driver");
  const previousTree =
    previousCache &&
    ts.createSourceFile(
      "previous-cache.mjs",
      previousCache,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
  const previousBootstrap = previousTree
    ? previousTree.statements
        .find(
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "bootstrapProgram",
        )
        .getText(previousTree)
        .replace(/^export /, "")
        .replace(
          "function bootstrapProgram(",
          "function previousBootstrapProgram(",
        )
    : "";
  let footers = 0;
  const statements = ast.statements.filter((n) => {
    if (ts.isImportDeclaration(n)) return false;
    if (ts.isIfStatement(n) && n.getText(ast).includes("process.argv[1]")) {
      footers++;
      return false;
    }
    return true;
  });
  assert.equal(footers, 1);
  const { pathToFileURL } = await import("node:url"),
    nativeFs = await import("node:fs");
  const { PassThrough } = await import("node:stream");
  let fixedClockProgram;
  const body =
    statements
      .map((n) => n.getText(ast).replace(/^export /, ""))
      .join("\n")
      .replace("pinRead = held(", "pinRead = testNativeClockPin(")
      .replaceAll(
        "import.meta.url",
        JSON.stringify(
          pathToFileURL(path.join(here, "full-sdk-source-driver.mjs")).href,
        ),
      ) +
    "\n" +
    previousBootstrap;
  const io = {
    ...fs,
    async open(name, ...args) {
      const fd = await fs.open(name, ...args);
      if (name !== path.join(here, "private-qualification-profile.json"))
        return fd;
      metadataOpens++;
      if (!late || metadataOpens !== 2) return fd;
      return new Proxy(fd, {
        get(target, key) {
          if (key === "close")
            return async () => {
              await target.close();
              context.ref = "refs/heads/foreign";
              throw false;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const scope = {
    fs: io,
    testNativeClockPin(file, bytes, budget, pin) {
      assert.equal(file, full.python.path);
      assert.equal(bytes, full.python.bytes);
      assert.equal(pin.sha256, full.python.sha256);
      budget.remaining();
      return Promise.resolve(Buffer.alloc(0)); // Modeled native leaf only; real128 held inputs remain unchanged.
    },
    path,
    constants: fsConstants,
    utilTypes: (await import("node:util")).types,
    fileURLToPath,
    pathToFileURL,
    createHash,
    spawn(executable, argv, options) {
      if (executable !== full.python.path || argv[3] !== fixedClockProgram) {
        actors++;
        assert.fail("NO_SOURCE_OR_NATIVE_ACTOR");
      }
      assert.equal(executable, full.python.path);
      assert.deepEqual(argv, ["-I", "-B", "-c", fixedClockProgram]);
      assert.deepEqual(options.env, {
        SystemRoot: "C:/Windows",
        WINDIR: "C:/Windows",
      });
      // Genuine ChildProcess instance and owned streams; no OS child/native
      // Job is created in this model, and clock data cannot mint authority.
      const child = new ChildProcess();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.emit("spawn");
        child.stdout.end(
          JSON.stringify({
            kind: "windows-arm-full-source-clock-data",
            wall: (Date.now() + clockAdvance) / 1000,
            monotonic: (performance.now() + clockAdvance) / 1000,
          }) + "\n",
        );
        child.stderr.end();
        setImmediate(() => {
          child.emit("exit", 0, null);
          child.emit("close", 0, null);
        });
      });
      return child;
    },
    process,
    Date: { now: () => Date.now() + clockAdvance },
    performance: { now: () => performance.now() + clockAdvance },
    openSync: nativeFs.openSync,
    writeSync: nativeFs.writeSync,
    closeSync: nativeFs.closeSync,
    writeFileSync: nativeFs.writeFileSync,
    watch: nativeFs.watch,
    renameSync: nativeFs.renameSync,
    realpathSync: nativeFs.realpathSync,
  };
  const api = new Function(
    ...Object.keys(scope),
    body +
      "\nreturn {loadFullSourceProfile,sourcePaths,reviewedHostClosure,fullSourceCommands,sourceEnvironment,bootstrapProgram,previousBootstrapProgram:typeof previousBootstrapProgram==='undefined'?null:previousBootstrapProgram,boundGnArguments,fullSourceProfiles,fullBootstrapAuthority,privateImage,beginFullMetadataSource,qualificationSourceOwners,qualificationOwnerCheck,retireQualificationSource,clockProgram:typeof FULL_SOURCE_CLOCK_PROGRAM==='undefined'?null:FULL_SOURCE_CLOCK_PROGRAM};",
  )(...Object.values(scope));
  fixedClockProgram = api.clockProgram;
  const state = {
    api,
    repo,
    here,
    root: sourceRoot,
    context,
    contextPin,
    full,
    actors: () => actors,
    advance: (milliseconds) => {
      clockAdvance += milliseconds;
    },
    expire: () => {
      clockAdvance = 21600001;
    },
  };
  state.load = () =>
    api.loadFullSourceProfile(
      sourceRoot,
      context,
      { remaining: () => 1 },
      contextPin,
    );
  return state;
}

test("actual full profile loader old PRIVATE_IMAGE denies and registered image data drives actual paths host and command vectors", async (t) => {
  const old = await fullSourceImageFixture(t, { previous: true });
  await assert.rejects(old.load(), /^Error: PRIVATE_IMAGE$/);
  assert.equal(old.actors(), 0);
  for (const image of ["20261030.294.1", "20261021.278.1"]) {
    const f = await fullSourceImageFixture(t, { image }),
      loaded = await f.load(),
      { p } = loaded;
    assert.equal(Object.hasOwn(p, "privatePolicy"), false);
    assert.equal(Object.hasOwn(p, "privateSelectedSha256"), false);
    assert.equal(f.api.fullSourceProfiles.has(p), true);
    const files = f.api.sourcePaths(f.root, p),
      closure = f.api.reviewedHostClosure(p, image);
    assert.equal(files.workspace, path.join(f.root, "source-checkout"));
    assert.equal(files.inputs, path.join(f.repo, p.sourceGn.namespace));
    assert.equal(closure.image, image);
    assert.equal(closure.rows.length, 18);
    const hooks = cefHookArguments(files.cef, files.depot),
      commands = f.api.fullSourceCommands(f.root, p, hooks, f.contextPin);
    assert.deepEqual(
      commands.map((x) => x.role),
      [
        "sync",
        "hook-projection",
        "dependency-hooks",
        "setup-x86",
        "setup-x64",
        "setup-arm64",
        "verify-setup",
        "cef-gn",
        "restore-checkpoint",
      ],
    );
    const setup = commands.find((x) => x.role === "verify-setup");
    assert.equal(setup.args[2], path.join(f.here, "full_sdk_source.py"));
    assert.equal(setup.args[3], "--full-sdk-verify-source-setup");
    assert.equal(setup.args[5], f.contextPin);
    const pin = p.cipd[0].members.find((x) => x.name === "gn.exe");
    assert(
      f.api
        .boundGnArguments(
          hooks,
          path.join(files.chromium, "buildtools/win/gn.exe"),
          pin,
        )[2]
        .includes("GetAllPlatformConfigs"),
    );
    const env = f.api.sourceEnvironment(f.root, p, {
      requiredHost: "win32",
      target: "aarch64-pc-windows-msvc",
      commands: [{ args: ["cef/tools/gclient_hook.py"] }, {}, {}],
      environment: {},
    });
    assert.equal(env.CEF_ENABLE_ARM64, "1");
    assert.equal(env.SDK_VERSION, p.sdkVersion);
    const bootstrap = f.api
      .bootstrapProgram(f.root, p, f.contextPin)
      .toString();
    assert(bootstrap.includes("full-sdk-source-gn"));
    assert(bootstrap.includes(f.contextPin));
    assert.equal(f.actors(), 0);
    f.api.fullSourceProfiles.delete(p);
  }
});

test("actual full image binding rejects clones foreign owners expired and revoked states without legacy authority", async (t) => {
  for (const mode of [
    "clone",
    "foreign-binding",
    "expired",
    "revoked",
    "namespace",
    "image",
    "context",
  ]) {
    const f = await fullSourceImageFixture(t),
      { p } = await f.load(),
      binding = f.api.fullSourceProfiles.get(p);
    let candidate = p;
    if (mode === "clone" || mode === "foreign-binding") {
      candidate = structuredClone(p);
      if (mode === "foreign-binding")
        f.api.fullSourceProfiles.set(candidate, binding);
    }
    if (mode === "expired") f.expire();
    if (mode === "revoked") f.api.fullSourceProfiles.delete(p);
    if (mode === "namespace") p.sourceGn.namespace += "foreign/";
    if (mode === "image") p.image = "unreviewed";
    if (mode === "context") f.context.ref = "refs/heads/foreign";
    assert.throws(
      () => f.api.sourcePaths(f.root, candidate),
      /PRIVATE_IMAGE|FULL_(?:IMAGE|SDK_BOOTSTRAP|SDK_SOURCE|DRIVER)_/,
    );
    assert.throws(
      () => f.api.fullSourceCommands(f.root, candidate, [], f.contextPin),
      /RECIPE_BRAND/,
    );
    assert.equal(f.api.fullSourceProfiles.has(candidate), false, mode);
    assert.equal(f.actors(), 0);
  }
});

test("actual full loader rejects wrong image profile namespace and late falsy close before image registration and preserves legacy data", async (t) => {
  for (const mode of ["image", "profile", "namespace", "late"]) {
    const f = await fullSourceImageFixture(t, { late: mode === "late" });
    if (mode === "image") f.context.image = "unreviewed";
    if (mode === "profile") f.context.sourceProfileSha256 = "0".repeat(64);
    if (mode === "namespace") {
      const file = path.join(f.here, f.full.images[f.context.image].profile);
      const value = JSON.parse(await fs.readFile(file));
      value.sourceGn.namespace += "foreign/";
      await fs.writeFile(file, JSON.stringify(value));
    }
    await assert.rejects(f.load(), (error) =>
      mode === "late"
        ? error === false
        : /FULL_SDK_SOURCE_(?:IMAGE|RECIPE_PIN)/.test(error.message),
    );
    assert.equal(f.actors(), 0);
  }
  const f = await fullSourceImageFixture(t),
    base = JSON.parse(await fs.readFile(path.join(f.here, "profile.json"))),
    selected = JSON.parse(
      await fs.readFile(
        path.join(f.here, f.full.images[f.context.image].profile),
      ),
    ),
    policy = JSON.parse(
      await fs.readFile(
        path.join(f.here, "private-qualification-profile.json"),
      ),
    );
  const legacy = {
    ...base,
    image: selected.image,
    sourceGn: selected.sourceGn,
    privatePolicy: policy,
    privateSelectedSha256: f.full.images[f.context.image].profileSha256,
  };
  assert.equal(f.api.reviewedHostClosure(legacy, legacy.image).rows.length, 18);
  assert.equal(
    f.api.sourcePaths(f.root, legacy).inputs,
    path.join(f.repo, selected.sourceGn.namespace),
  );
  assert.throws(
    () => f.api.fullSourceCommands(f.root, legacy, [], f.contextPin),
    /RECIPE_BRAND/,
  );
  assert.equal(f.actors(), 0);
});

test("actual full image registration revokes on synchronous selector failure and preserves false", async (t) => {
  for (const mode of ["image", "false"]) {
    const f = await fullSourceImageFixture(t);
    const set = f.api.fullSourceProfiles.set.bind(f.api.fullSourceProfiles);
    let actualProfile;
    // This observer belongs only to the isolated lexical module. The actual
    // loader remains its sole registration writer and no production map changes.
    f.api.fullSourceProfiles.set = (p, binding) => {
      actualProfile = p;
      set(p, binding);
      if (mode === "false")
        binding.budget.remaining = () => {
          throw false;
        };
      else p.sourceGn.namespace += "foreign/";
      return f.api.fullSourceProfiles;
    };
    await assert.rejects(f.load(), (error) =>
      mode === "false"
        ? error === false
        : /FULL_IMAGE_CHANGED/.test(error.message),
    );
    assert(actualProfile);
    assert.equal(f.api.fullSourceProfiles.has(actualProfile), false);
    assert.equal(f.actors(), 0);
  }
});

async function actualFullAcquisitionModel(overrides = {}) {
  const ts = (await import("typescript")).default;
  const text = await read(prefix + "full-sdk-source-driver.mjs");
  const tree = ts.createSourceFile(
    "actual-source.mjs",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const names = new Set([
    "sourceStage",
    "fullSourceStage",
    "fullSourceBudget",
    "SourceProgress",
    "FullSourceProgress",
    "sampleFullSourceClock",
    "held",
    "physical",
  ]);
  const body = tree.statements
    .filter(
      (node) =>
        (names.has(node.name?.text) &&
          !(node.name?.text === "held" && overrides.held)) ||
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((d) =>
            ["FULL_SOURCE_CLOCK_PROGRAM", "shared", "signature"].includes(
              d.name.getText(tree),
            ),
          )),
    )
    .map((node) =>
      node.name?.text === "fullSourceStage" && overrides.stageProgram
        ? overrides.stageProgram
        : node.getText(tree).replace(/^export /, ""),
    )
    .join("\n");
  let now = 850000,
    wall = 1000000 + now,
    timer,
    watchdog;
  const records = [],
    exit = new Error("modeled-owned-process-exit");
  const scope = {
    path,
    fs,
    constants: fsConstants,
    sha,
    sourceCloseFailure: false,
    Buffer,
    Number,
    Math,
    Object,
    Infinity,
    need(ok, code) {
      if (!ok) throw new Error(code);
    },
    performance: { now: () => now },
    Date: { now: () => wall },
    setTimeout(fn, ms) {
      timer = { fn, ms, cleared: false };
      return timer;
    },
    clearTimeout(value) {
      if (value) value.cleared = true;
    },
    setInterval(fn, ms) {
      watchdog = { fn, ms, cleared: false };
      return watchdog;
    },
    clearInterval(value) {
      if (value) value.cleared = true;
    },
    writeFileSync(_file, raw) {
      records.push(JSON.parse(raw));
    },
    writeSync() {
      assert.fail("no failure fallback expected");
    },
    process: {
      exit(code) {
        assert.equal(code, 124);
        throw exit;
      },
    },
    ...overrides,
  };
  const api = new Function(
    ...Object.keys(scope),
    body +
      "\nreturn {sourceStage,fullSourceStage,fullSourceBudget,SourceProgress,FullSourceProgress,sampleFullSourceClock,FULL_SOURCE_CLOCK_PROGRAM};",
  )(...Object.values(scope));
  const limits = JSON.parse(
    await read(prefix + "full-sdk-source-profile.json"),
  ).limits;
  const context = {
    wallWholeEnd: 22600,
    monotonicWholeEnd: 22600,
    wallWorkEnd: 11800,
    monotonicWorkEnd: 11800,
    wallAcquisitionEnd: 8200,
    monotonicAcquisitionEnd: 8200,
  };
  return {
    api,
    limits,
    context,
    records,
    exit,
    timer: () => timer,
    watchdog: () => watchdog,
    advance(ms, wallMs = ms) {
      now += ms;
      wall += wallMs;
    },
    budget(
      c = context,
      sample = {
        nodeMonoBefore: now,
        nodeWallBefore: wall,
        monotonic: 1000 + now / 1000,
      },
    ) {
      return api.fullSourceBudget(c, limits, sample);
    },
  };
}

test("FULL original acquisition debits data time and old actual4500 deadline is RED while the same bounded action completes under original120m", async () => {
  const old = await actualFullAcquisitionModel(),
    oldBudget = old.budget();
  assert.equal(oldBudget.acquisitionRemaining(), 6350000);
  await assert.rejects(
    old.api.sourceStage(
      "owned",
      oldBudget,
      "source-acquisition",
      4500,
      async () => {
        assert.equal(old.timer().ms, 4500000);
        old.advance(4500000);
        old.timer().fn();
      },
    ),
    (error) => error === old.exit,
  );
  assert.equal(old.records[0].stage, "source-acquisition");
  assert.equal(old.records[0].firstFailure, "FULL_SOURCE_STAGE_DEADLINE");
  assert(old.timer().cleared);
  const current = await actualFullAcquisitionModel(),
    budget = current.budget();
  assert.equal(budget.remaining(), 9950000);
  assert.equal(budget.acquisitionRemaining(), 6350000); // Original7200 minus actual850s data.
  assert.equal(
    await current.api.fullSourceStage(
      "owned",
      budget,
      "source-acquisition",
      7200,
      async () => {
        assert.equal(current.timer().ms, 6350000);
        current.advance(4500001);
        return "bounded-model-completion";
      },
    ),
    "bounded-model-completion",
  );
  assert.equal(budget.acquisitionRemaining(), 1849999);
  assert(current.timer().cleared);
  assert.deepEqual(current.records, []);
});

test("FULL source acquisition and whole expiry never renew and falsy stage failure retains its original timer cleanup", async () => {
  const f = await actualFullAcquisitionModel(),
    budget = f.budget();
  const first = budget.acquisitionRemaining();
  f.advance(1000, -5000);
  assert.equal(budget.acquisitionRemaining(), first - 1000);
  f.advance(first - 1000);
  assert.throws(
    () => budget.acquisitionRemaining(),
    /FULL_SDK_ACQUISITION_DEADLINE/,
  );
  let actions = 0;
  await assert.rejects(
    f.api.fullSourceStage(
      "owned",
      budget,
      "source-acquisition",
      7200,
      async () => {
        actions++;
      },
    ),
    /FULL_SDK_ACQUISITION_DEADLINE/,
  );
  assert.equal(actions, 0);
  const source = await actualFullAcquisitionModel(),
    original = source.budget();
  source.advance(9950000);
  assert.throws(() => original.remaining(), /FULL_SDK_SOURCE_DEADLINE/);
  const whole = await actualFullAcquisitionModel();
  const c = {
    ...whole.context,
    wallWholeEnd: 6000,
    monotonicWholeEnd: 6000,
    wallWorkEnd: 6000,
    monotonicWorkEnd: 6000,
    wallAcquisitionEnd: 5900,
    monotonicAcquisitionEnd: 5900,
  };
  const clipped = whole.budget(c);
  assert.equal(clipped.remaining(), 4150000);
  whole.advance(4150000);
  assert.throws(() => clipped.remaining(), /FULL_SDK_SOURCE_DEADLINE/);
  const falsy = await actualFullAcquisitionModel();
  await assert.rejects(
    falsy.api.fullSourceStage(
      "owned",
      falsy.budget(),
      "source-acquisition",
      7200,
      async () => {
        throw false;
      },
    ),
    (error) => error === false,
  );
  assert(falsy.timer().cleared);
  assert.deepEqual(falsy.records, []);
  const invalid = await actualFullAcquisitionModel();
  assert.throws(
    () => invalid.budget({ ...invalid.context, wallAcquisitionEnd: 11801 }),
    /ORIGINAL_ENDS/,
  );
});

test("FULL metadata projection starts once from genuine loaded source accounting and preserves the unchanged15m phase with revocation", async (t) => {
  const f = await fullSourceImageFixture(t),
    loaded = await f.load();
  const original = loaded.budget.remaining();
  assert(original > 7200000);
  const owner = f.api.beginFullMetadataSource({
    root: f.root,
    p: loaded.p,
    c: f.context,
    contextSha: f.contextPin,
    budget: loaded.budget,
  });
  const state = f.api.qualificationSourceOwners.get(owner),
    before = state.budget.remaining();
  assert(before > 7190000 && before <= 7200000);
  assert.equal(state.phase.maximumWorkMs, 900000);
  f.advance(1000);
  const later = state.budget.remaining();
  assert(later <= before - 1000);
  f.api.retireQualificationSource(owner, true, false);
  assert.equal(state.retired, true);
  assert.equal(state.primary, false);
  assert.throws(
    () => f.api.qualificationOwnerCheck(owner),
    (error) => error === false,
  );
  f.expire();
  assert.throws(() => state.budget.remaining(), /DEADLINE/);
  assert.equal(f.actors(), 0);
});

test("FULL diagnostic phase timing preserves actual phase start and covers180m with768 samples while legacy2h512 body stays exact", async (t) => {
  const nativeFs = await import("node:fs");
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "full-source-phase-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = 0;
  const f = await actualFullAcquisitionModel({
    performance: { now: () => now },
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    writeFileSync: nativeFs.writeFileSync,
    renameSync: nativeFs.renameSync,
    realpathSync: nativeFs.realpathSync,
    SOURCE_PHASES: new Set([
      "source-admission",
      "repository-fetch",
      "gclient-sync",
    ]),
  });
  const progress = new f.api.FullSourceProgress(directory, "a".repeat(64));
  now = 2000;
  progress.phase("gclient-sync");
  now = 5000;
  progress.flush();
  let value = JSON.parse(
    await fs.readFile(path.join(directory, "source-phase-result.json")),
  );
  assert.equal(value.elapsedMs, 5000);
  assert.equal(value.phaseStartedElapsedMs, 2000);
  assert.equal(value.phaseElapsedMs, 3000);
  progress.phase("gclient-sync");
  now = 7200001;
  progress.flush();
  value = JSON.parse(
    await fs.readFile(path.join(directory, "source-phase-result.json")),
  );
  assert.equal(value.phaseStartedElapsedMs, 2000);
  assert.equal(value.phaseElapsedMs, 7198001);
  assert.equal(progress.failed, false);
  for (let i = 0; i < 800; i++) progress.flush();
  assert.equal(progress.writes, 768);
  assert.equal(progress.failed, false);
  progress.close();
  const oldDirectory = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "legacy-source-phase-")),
  );
  t.after(() => fs.rm(oldDirectory, { recursive: true, force: true }));
  now = 0;
  const old = new f.api.SourceProgress(oldDirectory, "a".repeat(64));
  for (let i = 0; i < 600; i++) old.flush();
  assert.equal(old.writes, 512);
  old.close();
  now = 0;
  const horizon = new f.api.FullSourceProgress(directory, "a".repeat(64));
  now = 10800001;
  horizon.flush();
  assert.equal(horizon.failed, true);
  horizon.close();
  const text = (await read(prefix + "full-sdk-source-driver.mjs")).replaceAll(
    "\r\n",
    "\n",
  );
  const previous = sourceAcquisitionInverse(text, "driver");
  assert.equal(
    text.slice(
      text.indexOf("export class SourceProgress {"),
      text.indexOf("\nconst TARGET ="),
    ),
    previous.slice(
      previous.indexOf("export class SourceProgress {"),
      previous.indexOf("\nconst TARGET ="),
    ),
  );
});

test("FULL actual fixed command vector writers are all retained by exact allowlisted phase logs without environment or command plans", async (t) => {
  const f = await fullSourceImageFixture(t),
    loaded = await f.load();
  const commands = f.api.fullSourceCommands(
    f.root,
    loaded.p,
    cefHookArguments(loaded.files.cef, loaded.files.depot),
    f.contextPin,
  );
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
      "restore-checkpoint",
    ],
  );
  const workflow = (
    await read(".github/workflows/windows-arm-full-sdk.yml")
  ).replaceAll("\r\n", "\n");
  const retained = workflow.split(
    "      - name: Retain bounded qualification records\n",
  )[1];
  const patterns = retained
    .split("          path: |\n")[1]
    .trim()
    .split("\n")
    .map((line) => line.trim());
  const driver = await read(prefix + "full-sdk-source-driver.mjs");
  assert(
    driver.includes("path.join(files.logs, `${command.role}.stdout.log`)"),
  );
  assert(
    driver.includes("path.join(files.logs, `${command.role}.stderr.log`)"),
  );
  assert(driver.includes("limits.bytes <= limits.cap"));
  for (const row of commands)
    for (const stream of ["stdout", "stderr"]) {
      const exact = `.artifacts/windows-arm-full-sdk-*/source-gn-logs/${row.role}.${stream}.log`;
      assert.equal(patterns.filter((pattern) => pattern === exact).length, 1);
    }
  assert(
    !patterns.some((pattern) =>
      /source-gn-logs\/(?:\*|command-plan|environment|context)/.test(pattern),
    ),
  );
  assert(retained.includes("include-hidden-files: true"));
  assert.equal(f.actors(), 0);
});

test("FULL fixed clock probe holds actual benign Python and joins the actual child and both streams without inherited secrets", async (t) => {
  const python = await benignPython(t);
  if (!python) return;
  const raw = await fs.readFile(python),
    pin = { path: python, bytes: raw.length, sha256: sha(raw) };
  let actualChild;
  const f = await actualFullAcquisitionModel({
    setTimeout,
    clearTimeout,
    spawn(executable, argv, options) {
      assert.equal(executable, python);
      assert.deepEqual(argv.slice(0, 3), ["-I", "-B", "-c"]);
      assert(!argv[3].includes("subprocess"));
      assert.deepEqual(options.env, {
        SystemRoot: "C:/Windows",
        WINDIR: "C:/Windows",
      });
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      actualChild = spawn(executable, argv, options);
      assert(actualChild instanceof ChildProcess);
      return actualChild;
    },
  });
  const value = await f.api.sampleFullSourceClock(f.context, pin);
  assert.equal(value.kind, "windows-arm-full-source-clock-data");
  assert(Number.isFinite(value.monotonic));
  assert.equal(value.nodeMonoBefore, 850000);
  assert.equal(actualChild.exitCode, 0);
  assert.equal(actualChild.stdout.closed, true);
  assert.equal(actualChild.stderr.closed, true);
  assert.equal(actualChild.listenerCount("exit"), 0);
  assert.equal(actualChild.listenerCount("close"), 0);
  assert.equal(actualChild.stdout.listenerCount("data"), 0);
  assert.equal(actualChild.stderr.listenerCount("data"), 0);
  assert.deepEqual(Object.keys(value).sort(), [
    "kind",
    "monotonic",
    "nodeMonoBefore",
    "nodeWallBefore",
    "wall",
  ]);
  // DATA-only positive: no source profile map, native Job or SDK authority is issued.
});

test("FULL clock projection debits prior850s wall rollback and whole slow-probe time from the BEFORE anchor without refunds", async () => {
  const { PassThrough } = await import("node:stream");
  let f;
  f = await actualFullAcquisitionModel({
    held: async (_file, _cap, budget) => {
      budget.remaining();
      return Buffer.alloc(0);
    },
    spawn() {
      const child = new ChildProcess();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        f.advance(1000);
        child.emit("spawn");
        child.stdout.end(
          JSON.stringify({
            kind: "windows-arm-full-source-clock-data",
            wall: 1001,
            monotonic: 1851,
          }),
        );
        child.stderr.end();
        setImmediate(() => {
          child.emit("exit", 0, null);
          child.emit("close", 0, null);
        });
      });
      return child;
    },
  });
  f.advance(0, -850000); // Rollback occurred during prior data work, before this probe.
  const sample = await f.api.sampleFullSourceClock(f.context, {
    path: "modeled-pinned-python",
    bytes: 1,
    sha256: "a".repeat(64),
  });
  assert.equal(sample.nodeMonoBefore, 850000);
  assert.equal(sample.nodeWallBefore, 1000000);
  const budget = f.budget(f.context, sample);
  assert.equal(budget.acquisitionRemaining(), 6348000); //850s prior work +1000ms sample +1000ms entire before-anchor latency.
  assert.equal(budget.remaining(), 9948000);
  f.advance(0, -600000);
  assert.equal(budget.acquisitionRemaining(), 6348000);
  f.advance(6348000);
  assert.throws(() => budget.acquisitionRemaining(), /ACQUISITION_DEADLINE/);
  assert.throws(
    () => f.budget(f.context, { ...sample, monotonic: 8201 }),
    /ORIGINAL_BUDGET/,
  );
});

test("FULL fixed clock no-close spawn-error cap and late-pin models release only owned resources and preserve the first falsy failure", async () => {
  const { PassThrough } = await import("node:stream");
  for (const mode of ["no-close", "false-error", "cap", "late-pin"]) {
    let child,
      kills = 0,
      unrefs = 0,
      opened = 0,
      resolvePin;
    const foreign = new PassThrough();
    const f = await actualFullAcquisitionModel({
      held:
        mode === "late-pin"
          ? () =>
              new Promise((resolve) => {
                resolvePin = resolve;
              })
          : async () => Buffer.alloc(0),
      spawn() {
        opened++;
        child = new ChildProcess();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {
          kills++;
          return false;
        };
        child.unref = () => {
          unrefs++;
        };
        return child;
      },
    });
    const promise = f.api.sampleFullSourceClock(f.context, {
      path: "modeled-pinned-python",
      bytes: 1,
      sha256: "a".repeat(64),
    });
    const observed = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const workTimer = f.timer();
    assert.equal(workTimer.ms, 5000);
    if (mode === "false-error") {
      child.emit("error", false);
    } else if (mode === "cap") {
      child.emit("spawn");
      child.stdout.write(Buffer.alloc(513));
    } else {
      f.advance(5000);
      workTimer.fn();
    }
    await new Promise((resolve) => setImmediate(resolve));
    const cleanup = f.timer();
    assert(cleanup !== workTimer);
    assert(cleanup.ms > 0 && cleanup.ms <= 35000);
    f.advance(cleanup.ms);
    cleanup.fn();
    const result = await observed;
    assert.equal(Object.hasOwn(result, "value"), false);
    if (mode === "false-error") assert.equal(result.error, false);
    else
      assert.match(
        String(result.error),
        mode === "cap"
          ? /FULL_SOURCE_CLOCK_BOUND/
          : /FULL_SOURCE_CLOCK_DEADLINE/,
      );
    assert.equal(foreign.destroyed, false);
    foreign.destroy();
    if (mode === "late-pin") {
      assert.equal(opened, 0);
      resolvePin(Buffer.alloc(0));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(opened, 0);
    } else {
      assert.equal(kills, 1);
      assert.equal(unrefs, 1);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
      assert.equal(child.listenerCount("error"), 0);
      assert.equal(child.listenerCount("close"), 0);
      assert.equal(child.stdout.listenerCount("data"), 0);
      // A late result never becomes a fulfillment or source-session fact.
      child.emit("close", 0, null);
      assert.equal(Object.hasOwn(result, "value"), false);
    }
  }
});

test("FULL accounting inverse restores every prior whole file and rejects tamper duplicate and extra data", async () => {
  for (const [name, spec] of Object.entries(SOURCE_ACQUISITION_HISTORY)) {
    const current = (await read(spec.path)).replaceAll("\r\n", "\n");
    const old = sourceAcquisitionInverse(current, name);
    assert.equal(Buffer.byteLength(old), spec.bytes);
    assert.equal(sha(old), spec.sha256);
    const previousCache = fullBootstrapCacheInverse(current, name);
    for (const row of spec.rows) {
      assert.equal(previousCache.split(row.newRaw).length, 2);
      assert.throws(() =>
        sourceAcquisitionBaselineInverse(
          previousCache.replace(
            row.newRaw,
            "/*tampered*/" + row.newRaw.slice(1),
          ),
          name,
        ),
      );
      assert.throws(() =>
        sourceAcquisitionBaselineInverse(previousCache + row.newRaw, name),
      );
    }
    assert.throws(() =>
      sourceAcquisitionBaselineInverse(previousCache + "\n", name),
    );
    assert.throws(() => sourceAcquisitionInverse(current + "\n", name));
  }
});

const PRE_WATCHDOG_STAGE = {
  raw: 'async function fullSourceStage(root, budget, stage, maximumSeconds, action) {\n  need(\n    (stage === "source-acquisition" && maximumSeconds === 7200) ||\n      (stage === "source-hooks-gn" && maximumSeconds === 2700),\n    "FULL_SOURCE_STAGE",\n  );\n  const allowed = Math.min(\n    maximumSeconds * 1000,\n    budget.remaining() - 120000,\n    stage === "source-acquisition" ? budget.acquisitionRemaining() : Infinity,\n  );\n  need(allowed > 0, "FULL_SOURCE_RESERVE");\n  const began = performance.now();\n  const timer = setTimeout(\n    () => {\n      const report = {\n        kind: "windows-arm-source-stage-deadline",\n        success: false,\n        stage,\n        firstFailure: "FULL_SOURCE_STAGE_DEADLINE",\n        compilerExecuted: null,\n        engineCompilationRequested: false,\n        sdkBuilt: false,\n        cleanupNotInferred: true,\n      };\n      try {\n        writeFileSync(\n          path.join(root, "source-deadline-result.json"),\n          JSON.stringify(report) + "\\n",\n          { flag: "wx" },\n        );\n      } catch {\n        sourceReportingFailure = true;\n        try {\n          writeSync(\n            2,\n            Buffer.from(\n              JSON.stringify({\n                ...report,\n                reportingFailure: "FULL_SOURCE_REPORT",\n              }) + "\\n",\n            ),\n          );\n        } catch {\n          /* Preserve the deadline. */\n        }\n      }\n      process.exit(124); // Actual enclosing Job terminates/reaps only this owned cohort.\n    },\n    Math.max(1, allowed),\n  );\n  try {\n    const result = await action();\n    budget.remaining();\n    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n',
  sha256: "93a4faf289533f9c6a987eef51e0a2e94dd56a303005b966efda1c01d7f246a2",
};

test("FULL acquisition postawait rejects original wall expiry while source remains live and prior94a6 actual body is RED", async () => {
  assert.equal(sha(PRE_WATCHDOG_STAGE.raw), PRE_WATCHDOG_STAGE.sha256);
  const old = await actualFullAcquisitionModel({
      stageProgram: PRE_WATCHDOG_STAGE.raw,
    }),
    oldBudget = old.budget();
  assert.equal(
    await old.api.fullSourceStage(
      "owned",
      oldBudget,
      "source-acquisition",
      7200,
      async () => {
        old.advance(1000, 6350001);
        return "late-success-old-bug";
      },
    ),
    "late-success-old-bug",
  );
  assert(oldBudget.remaining() > 0);
  assert.throws(() => oldBudget.acquisitionRemaining(), /ACQUISITION_DEADLINE/);
  const current = await actualFullAcquisitionModel(),
    budget = current.budget();
  await assert.rejects(
    current.api.fullSourceStage(
      "owned",
      budget,
      "source-acquisition",
      7200,
      async () => {
        current.advance(1000, 6350001);
        return "late";
      },
    ),
    /ACQUISITION_DEADLINE/,
  );
  assert(budget.remaining() > 0);
  assert(current.timer().cleared);
  assert(current.watchdog().cleared);
});

test("FULL actual acquisition action consumes the scoped live provider after vendor awaits before every next command", async () => {
  const ts = (await import("typescript")).default;
  const source = await read(prefix + "full-sdk-source-driver.mjs");
  const tree = ts.createSourceFile(
    "actual-full-source.mjs",
    source,
    99,
    true,
    ts.ScriptKind.JS,
  );
  const body = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "runFullSourceBody",
  );
  let declaration, action;
  const walk = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "acquisitionBudget"
    )
      declaration = node.getText(tree);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "fullSourceStage" &&
      node.arguments[2]?.getText(tree) === '"source-acquisition"'
    )
      action = node.arguments[4].getText(tree);
    ts.forEachChild(node, walk);
  };
  walk(body);
  assert(declaration && action);
  for (const expiresAt of ["fetch", "host", "launcher", "none"]) {
    const f = await actualFullAcquisitionModel(),
      budget = f.budget();
    let nativeStarts = 0,
      launcherStarts = 0,
      model;
    const jump = (at) => {
      if (at === expiresAt) f.advance(1000, 6350001);
    };
    const scope = {
      budget,
      path,
      TARGET: "aarch64-pc-windows-msvc",
      currentProgress: { phase() {} },
      patched: {
        async acquireSources() {
          jump("fetch");
        },
      },
      async verifyHostClosure(_p, actual) {
        assert.equal(actual, model.acquisitionBudget);
        actual.remaining();
        jump("host");
      },
      runtime: {
        async prepareWindowsGitLauncher() {
          launcherStarts++;
          jump("launcher");
        },
      },
      executeCommand(_command, _commands, _env, _files, actual) {
        assert.equal(actual, model.acquisitionBudget);
        actual.remaining();
        nativeStarts++;
      },
      checked: (callback) => callback(),
      p: {},
      c: { image: "fixed" },
      tools: { git: { path: "fixed-pinned-git" } },
      files: { workspace: "owned", depot: "owned-depot", logs: "owned-logs" },
      gitPolicy: {},
      commands: [{ role: "sync" }],
      env: {},
      limits: {},
      bootstrap: {},
      argv: ["fixed", "owned", "a".repeat(64)],
    };
    // The actual FULL action/provider bodies, with modeled vendor/native leaves.
    // These copied data functions cannot write a production issuer registry.
    model = new Function(
      ...Object.keys(scope),
      `let stage; const ${declaration}; return {acquisitionBudget, action:${action}};`,
    )(...Object.values(scope));
    if (expiresAt === "none") {
      await f.api.fullSourceStage(
        "owned",
        budget,
        "source-acquisition",
        7200,
        model.action,
      );
      assert.equal(nativeStarts, 1);
    } else {
      await assert.rejects(
        f.api.fullSourceStage(
          "owned",
          budget,
          "source-acquisition",
          7200,
          model.action,
        ),
        /ACQUISITION_DEADLINE/,
      );
      assert.equal(nativeStarts, 0);
      assert(budget.remaining() > 0);
      if (expiresAt === "fetch" || expiresAt === "host")
        assert.equal(launcherStarts, 0);
    }
    assert(f.timer().cleared);
    assert(f.watchdog().cleared);
  }
});

test("FULL pending vendor acquisition watchdog consumes live original endpoints and late callbacks cannot override a falsy primary", async () => {
  const f = await actualFullAcquisitionModel(),
    budget = f.budget();
  let finish;
  const pending = f.api.fullSourceStage(
    "owned",
    budget,
    "source-acquisition",
    7200,
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const observed = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  assert.equal(f.watchdog().ms, 1000);
  assert.equal(f.timer().ms, 6350000);
  f.advance(1000, 6350001);
  assert(budget.remaining() > 0);
  assert.throws(
    () => f.watchdog().fn(),
    (error) => error === f.exit,
  );
  assert.equal(f.records[0].stage, "source-acquisition");
  assert.equal(f.records[0].firstFailure, "FULL_SOURCE_STAGE_DEADLINE");
  finish("late-modeled-vendor-completion");
  const denied = await observed;
  assert.equal(Object.hasOwn(denied, "value"), false);
  assert.match(String(denied.error), /ACQUISITION_DEADLINE/);
  assert(f.timer().cleared);
  assert(f.watchdog().cleared);
  f.watchdog().fn();
  assert.equal(f.records.length, 1);
  const falsy = await actualFullAcquisitionModel();
  await assert.rejects(
    falsy.api.fullSourceStage(
      "owned",
      falsy.budget(),
      "source-acquisition",
      7200,
      async () => {
        throw false;
      },
    ),
    (error) => error === false,
  );
  assert(falsy.timer().cleared);
  assert(falsy.watchdog().cleared);
  falsy.advance(1000, 6350001);
  falsy.watchdog().fn();
  assert.deepEqual(falsy.records, []);
});

const PINNED_DEPOT_GITIGNORE = {
  source:
    '# Ignore any python bytecode.\n*.pyc\n\n# ignore cipd client files\n/.cipd_bin/\n/.cipd_bin_cros_python2\n/.cipd_client*\n/.cipd_client_cache/\n/.versions/\n\n# Ignore "disable auto update" sentinel file.\n.disable_auto_update\n\n# Ignore the batch files produced by the Windows bootstrapping.\n/git-bash\n/git.bat\n/gitk.bat\n/.pylint.d/\n/python\n/python.bat\n/python3.bat\n/ssh.bat\n/ssh-keygen.bat\n/svn\n/svn.bat\n/svnversion.bat\n/.bleeding_edge\n/.codereview_upload_cookies\n/.gitconfig\n/.git_bleeding_edge\n/.git_cl_description_backup\n/.last_codereview_email_address\n/.ssh\n/.subversion\n\n# Ignore locations where third-party tools are placed during bootstrapping.\n/bootstrap*_bin\n/python*_bin\n/python_bin_reldir.txt\n/python3_bin_reldir.txt\n/win_tools*_bin\n/git_bin\n/git-*_bin\n/svn_bin\n/external_bin/\n/win_toolchain/vs2013_files\n/win_toolchain/vs_files\n/win_toolchain/*.timestamps\n/win_toolchain/.vspro\n/win_toolchain/data.json\n/win_toolchain/vs_files.ciopfs\n\n# Ignore ctags/cscope index files\n/TAGS\n/cscope.files\n/cscope.in.out\n/cscope.out\n/cscope.po.out\n/tags\n\n# Ignore unittest related files.\n/testing_support/_infra\n/testing_support/_rietveld\n/tests/git-svn-submodule/\n/tests/subversion_config/README.txt\n/tests/subversion_config/auth\n/tests/subversion_config/servers\n/tests/svn/\n/tests/svnrepo/\n\n# Ignore intermediate isolate files\n*.isolated\n*.isolated.state\n\n# Ignore recipe working directory.\n/.recipe_deps\n/infra/.recipe_deps\n/recipes/.recipe_deps\n\n# Ignore google AE downloaded for running testing only.\ntesting_support/google_appengine\n\n# Ignore emacs / vim backup files.\n*~\n*.swp\n\n# Ignore win/mac monitoring config. It is unique for each depot_tools checkout.\n/metrics.cfg\n/build_telemetry.cfg\n\n# Ignore git traces produced by git push on git-cl upload.\n/traces\n\n# Ignore VsChromium configuration file.\n/vs-chromium-project.txt\n\n# Ignore the file that logs Python 2 scripts run during presubmits.\n/python2_usage.txt\n\n# Ignore gemini-cli configs\n/.gemini/\n\n# Ignore coverage results file and htlp folder.\n.coverage\nhtmlcov/',
  sha256: "4dba4a2ed70f50373d8260cc393d78c251a17ab52d47b629f3a94af268f6621d",
};

test("FULL bootstrap cache uses only the genuine held profile and preserves every legacy emitted setup byte", async (t) => {
  for (const image of ["20261030.294.1", "20261021.278.1"]) {
    const f = await fullSourceImageFixture(t, { image }),
      loaded = await f.load();
    const current = f.api.bootstrapProgram(f.root, loaded.p, f.contextPin),
      previous = f.api.previousBootstrapProgram(f.root, loaded.p, f.contextPin);
    const old = "SETUP=DEPOT/'sorng-cipd-setup.bat'",
      next = "SETUP=DEPOT/'.cipd_client_sorng_setup.bat'";
    assert.equal(previous.toString().split(old).length, 2);
    assert.deepEqual(
      current,
      Buffer.from(previous.toString().replace(old, next)),
    );
    assert.equal(current.toString().split(next).length, 2);
    const base = JSON.parse(
        await fs.readFile(path.join(f.here, "profile.json")),
      ),
      selected = JSON.parse(
        await fs.readFile(path.join(f.here, f.full.images[image].profile)),
      ),
      policy = JSON.parse(
        await fs.readFile(
          path.join(f.here, "private-qualification-profile.json"),
        ),
      );
    const legacy = {
      ...base,
      image,
      sourceGn: selected.sourceGn,
      privatePolicy: policy,
      privateSelectedSha256: f.full.images[image].profileSha256,
    };
    assert.deepEqual(
      f.api.bootstrapProgram(f.root, legacy, f.contextPin),
      f.api.previousBootstrapProgram(f.root, legacy, f.contextPin),
    );
    assert(
      f.api
        .bootstrapProgram(f.root, legacy, f.contextPin)
        .toString()
        .includes(old),
    );
    assert.throws(
      () => f.api.bootstrapProgram(f.root, { ...loaded.p }, f.contextPin),
      /PRIVATE_IMAGE/,
    );
    assert.throws(
      () => f.api.bootstrapProgram(f.root, loaded.p, "0".repeat(64)),
      /BOOTSTRAP_BINDING/,
    );
    f.api.fullSourceProfiles.delete(loaded.p);
    assert.throws(
      () => f.api.bootstrapProgram(f.root, loaded.p, f.contextPin),
      /PRIVATE_IMAGE/,
    );
    assert.equal(f.actors(), 0);
  }
});

test("FULL actual generated cache placement is actual Git clean and the same strict preflight body rejects old placement and foreign dirt", async (t) => {
  const ts = (await import("typescript")).default;
  const source = await read(
      prefix + "current-source-helpers/scripts/lib/browser-custom-runtime.mjs",
    ),
    tree = ts.createSourceFile(
      "actual-preflight.mjs",
      source,
      99,
      true,
      ts.ScriptKind.JS,
    ),
    names = new Set([
      "shape",
      "relative",
      "within",
      "checkedPath",
      "verifyFile",
      "preflightSourceCheckout",
    ]),
    body = tree.statements
      .filter(
        (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
      )
      .map((node) => node.getText(tree).replace(/^export /, ""))
      .join("\n");
  assert.equal(
    sha(Buffer.from(PINNED_DEPOT_GITIGNORE.source)),
    PINNED_DEPOT_GITIGNORE.sha256,
  );
  assert.equal(
    sha(Buffer.from(PINNED_CIPD_SETUP.source)),
    "3607a1f703b59f213f7fff874cb8d6065b5af17144c66458a0a35e18137069fa",
  );
  const setup = deriveBootstrapSetup(Buffer.from(PINNED_CIPD_SETUP.source));
  assert.equal(setup.length, 1390);
  assert.equal(
    sha(setup),
    "635209f2b2e2cfd928c73baa08e5f2e17c2f48124a7327b74ffd6b6b9c5e5ce5",
  );
  const rootFixture = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "bootstrap-cache-git-")),
  );
  t.after(() => fs.rm(rootFixture, { recursive: true, force: true }));
  const checkouts = {
    cef: path.join(rootFixture, "src", "cef"),
    chromium: path.join(rootFixture, "src"),
    depotTools: path.join(rootFixture, "depot_tools"),
  };
  const empty = path.join(rootFixture, "empty-config"),
    hooks = path.join(rootFixture, "empty-hooks");
  await fs.writeFile(empty, "");
  await fs.mkdir(hooks);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (cwd, args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 ** 2,
      encoding: "utf8",
    }).trim();
  for (const [name, directory] of Object.entries(checkouts)) {
    await fs.mkdir(directory, { recursive: true });
    git(directory, ["init", "--quiet"]);
    git(directory, ["config", "user.name", "Fixture"]);
    git(directory, ["config", "user.email", "fixture@example.invalid"]);
    git(directory, ["config", "core.autocrlf", "false"]);
    git(directory, ["config", "core.hooksPath", hooks]);
    git(directory, ["config", "advice.addEmbeddedRepo", "false"]);
    await fs.writeFile(path.join(directory, "tracked.txt"), "owned fixture\n");
    if (name === "depotTools")
      await fs.writeFile(
        path.join(directory, ".gitignore"),
        PINNED_DEPOT_GITIGNORE.source,
      );
    git(directory, ["add", "."]);
    git(directory, ["commit", "--quiet", "-m", "Owned benign fixture"]);
  }
  const selected = JSON.parse(
      await read(prefix + "image-qualified-current-profile.json"),
    ),
    inputsRoot = path.join(root, selected.sourceGn.namespace),
    sourceLock = JSON.parse(
      await fs.readFile(path.join(inputsRoot, "source-lock.json")),
    );
  const simulations = [],
    scope = {
      path,
      realpath: fs.realpath,
      lstat: fs.lstat,
      createReadStream: (await import("node:fs")).createReadStream,
      createHash,
      repositories: { cef: "fixed", chromium: "fixed", depotTools: "fixed" },
      validateSourceLock: validateSourceLock,
      identitySha256,
      fail(message) {
        throw new Error(message);
      },
      async git(directory, args) {
        // Upstream revision observations only are modeled. Actual Git performs
        // every clean check; all source input pin reads use the actual readers.
        if (
          args.length === 2 &&
          args[0] === "rev-parse" &&
          args[1] === "HEAD"
        ) {
          const name = Object.keys(checkouts).find(
            (name) => checkouts[name] === directory,
          );
          return sourceLock.upstream[name].commit;
        }
        return git(directory, args);
      },
      async verifySourcePatchSeries(group) {
        simulations.push(group.repository);
      },
    };
  const preflight = new Function(
    ...Object.keys(scope),
    body + "\nreturn preflightSourceCheckout;",
  )(...Object.values(scope));
  const oldFile = path.join(checkouts.depotTools, "sorng-cipd-setup.bat"),
    newFile = path.join(checkouts.depotTools, ".cipd_client_sorng_setup.bat");
  await fs.writeFile(oldFile, setup, { flag: "wx" });
  assert.equal(
    git(checkouts.depotTools, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
    ]),
    "?? sorng-cipd-setup.bat",
  );
  await assert.rejects(
    preflight({ sourceLock, inputsRoot, checkouts }),
    /^Error: depotTools: clean checkout required; existing changes are never reset$/,
  );
  assert.deepEqual(simulations, []);
  await fs.rename(oldFile, newFile);
  assert.equal(
    git(checkouts.depotTools, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
    ]),
    "",
  );
  const data = await preflight({ sourceLock, inputsRoot, checkouts });
  assert.equal(data.patchesApplied, false);
  assert.deepEqual(simulations, ["cef", "chromium"]);
  assert.deepEqual(await fs.readFile(newFile), setup);
  await fs.writeFile(
    path.join(checkouts.depotTools, "foreign.bat"),
    "foreign\n",
    { flag: "wx" },
  );
  await assert.rejects(
    preflight({ sourceLock, inputsRoot, checkouts }),
    /depotTools: clean checkout required/,
  );
  // No real upstream source, patch simulation, vendor script or compiler ran.
});

test("FULL source apply diagnostics retain only closed facts and actual finally preserves falsy or hostile primary errors", async () => {
  const ts = (await import("typescript")).default,
    utilTypes = (await import("node:util")).types;
  const text = await read(prefix + "full-sdk-source-driver.mjs"),
    tree = ts.createSourceFile(
      "actual-error-boundary.mjs",
      text,
      99,
      true,
      ts.ScriptKind.JS,
    ),
    helpers = tree.statements
      .filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          ["fullSourceErrorMessage", "fullSourceApplyDiagnostic"].includes(
            node.name?.text,
          ),
      )
      .map((node) => node.getText(tree))
      .join("\n");
  const api = new Function(
    "utilTypes",
    helpers + "\nreturn {fullSourceErrorMessage, fullSourceApplyDiagnostic};",
  )(utilTypes);
  const error = new Error(
    "depotTools: clean checkout required; existing changes are never reset",
  );
  assert.deepEqual(api.fullSourceApplyDiagnostic(error), {
    kind: "windows-arm-source-apply-failure",
    phase: "source-apply",
    category: "dirty-checkout",
    repository: "depotTools",
  });
  const patch = new Error(
    "Patch application failed; applied repositories: cef; current repository: chromium; completed patches: 3. No rollback/reset performed. PRIVATE_PATH SECRET_TOKEN",
  );
  patch.code = 1;
  assert.deepEqual(api.fullSourceApplyDiagnostic(patch), {
    kind: "windows-arm-source-apply-failure",
    phase: "source-apply",
    category: "patch-application",
    repository: "chromium",
    completedPatches: 3,
    appliedRepositories: ["cef"],
    exitCode: 1,
  });
  let getters = 0;
  const hostile = new Error();
  Object.defineProperty(hostile, "message", {
    get() {
      getters++;
      throw new Error("PRIVATE_PATH");
    },
  });
  const proxy = new Proxy(new Error("SECRET_TOKEN"), {
    get() {
      getters++;
      throw false;
    },
    getOwnPropertyDescriptor() {
      getters++;
      throw false;
    },
  });
  for (const value of [
    false,
    null,
    hostile,
    proxy,
    {
      get message() {
        getters++;
        throw false;
      },
    },
  ])
    assert.equal(api.fullSourceApplyDiagnostic(value).category, "unclassified");
  assert.equal(getters, 0);
  const fn = tree.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "runFullSourceBody",
    ),
    finallyBody = fn.body.statements
      .find((node) => ts.isTryStatement(node))
      .finallyBlock.getText(tree);
  for (const primary of [false, null, error, hostile, proxy]) {
    const reports = [],
      scope = {
        primary,
        failed: true,
        stage: "source-apply",
        success: false,
        root: "owned",
        path,
        p: { sourceGn: { sourceId: "a".repeat(64) } },
        qualificationOwner: undefined,
        fullSourceProfiles: { delete() {} },
        retireQualificationSource() {},
        currentProgress: { close() {} },
        ...api,
        TARGET: "aarch64-pc-windows-msvc",
        graph: null,
        generatedArguments: null,
        sourceCloseFailure: false,
        sourceReportingFailure: false,
        gitPolicy: {},
        custom: { sourceGitIsolationEvidence: () => ({ fixtureOnly: true }) },
        fs: {
          async writeFile(_file, raw) {
            reports.push(JSON.parse(raw));
            throw new Error("owned report failure");
          },
        },
      };
    const run = new Function(
      ...Object.keys(scope),
      "return (async()=>{try { throw primary; } finally " +
        finallyBody +
        "})()",
    );
    let rejected = false,
      caught;
    try {
      await run(...Object.values(scope));
    } catch (error) {
      rejected = true;
      caught = error;
    }
    assert.equal(rejected, true);
    assert.equal(caught, primary);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].success, false);
    assert.equal(reports[0].stage, "source-apply");
    assert.equal(reports[0].sdkBuilt, false);
    assert.equal(JSON.stringify(reports[0]).includes("PRIVATE_PATH"), false);
    assert.equal(JSON.stringify(reports[0]).includes("SECRET_TOKEN"), false);
  }
  assert.equal(getters, 0);
});

test("FULL bootstrap cache inverse preserves complete previous module profiles and rejects tamper duplicates or extra bytes", async () => {
  for (const [name, spec] of Object.entries(FULL_BOOTSTRAP_CACHE_HISTORY)) {
    const raw = (await read(spec.path)).replaceAll("\r\n", "\n"),
      old = fullBootstrapCacheInverse(raw, name);
    assert.equal(sha(old), spec.sha256);
    assert.equal(Buffer.byteLength(old), spec.bytes);
    const baseline = fullSourceEnvironmentInverse(
      fullGnShellTransportInverse(raw, name),
      name,
    );
    assert.equal(fullBootstrapCacheBaselineInverse(baseline, name), old);
    for (const row of spec.rows) {
      assert.equal(
        baseline.split(row.newRaw).length,
        2,
        "historical mutation must change the decoded layer exactly once",
      );
      assert.throws(() =>
        fullBootstrapCacheBaselineInverse(
          baseline.replace(row.newRaw, "/*tamper*/" + row.newRaw.slice(1)),
          name,
        ),
      );
      assert.throws(() =>
        fullBootstrapCacheBaselineInverse(baseline + row.newRaw, name),
      );
    }
    assert.throws(() =>
      fullBootstrapCacheBaselineInverse(baseline + "\n", name),
    );
  }
});

// Pinned primary utility source is data-only test transport, never a vendor binary.
const GN_SHELL_PRIMARY_DEFLATE = {
  "c101-subprocess2.py":
    "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",
  "c101-gclient_utils.py":
    "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",
  "cef682-gclient_util.py":
    "eNqNVE1v2zAMvftXEC2K2EBmrD0WyCHLUqzAUBRrt6uhWHSsRZYMim7qfz9KcbakWLHdLH48ko+PvoSV70cy25Yhrwu4+Xh9Dc8twqol35mhg3W3Qa1Rwx2pDveedrAcuPUUyuwSHj2x8S5A/Q+YYw4srYUUGIAwIL2gjkDfA4JvgFsTIPiBahRIjSDPrX9BctLBZgQFn54+fwg8WgRranSSxq1iqJWDDQpQ4wenwTgxI3y9X60fntbQGItlljXSDFRVM/BAWFVgul76B7UJ3g6M1eH9XlhPxrFYXR1HziarD3MIY8gypvE2A7gEjb3nir23ATolPVtCpUdp79jWEVBxW0rK9NzW1qBUGNjYkOFrjT3DffKtiTyBCoCHEk+oqG4T1uPy+QugezHkXSfp8KLIqI3ww17mFi5i1GlPjbcaKRY+tS7gwTsUY+wqPn0oJ9hyi5zPYqFZUYbeGs7FmeKwLySlkebiM86XzLFLmauBKa7EVxM4HNPKn964PH7NYXY2dtmPs6I4pL/tL8ZPjo0wusuyVOI0SNQSpzjkp33ls8TdrahpsBqc5wMpZ1kusVjO5kkoC1lnGVg4oiIBxbcMwPlNkSX6l/ocQJh+s9KYkr5V36PT+Ul08d7GM1GvXKMRpScFTl6hBPpRrseliygzjQ18G9wyyTDXhubi6DrldCLu4uJCvCGtXaWYUkzimAQK52XLVYv1bqWsXTp9Zywj5RPLcMSVAnu9SJWU3asxVKH1+6oVWSMtnmnA+XQdQpsfOJninJOIzwueiznyGY9fgTahJmSEyDUEVjyEw09Afgw3iWSnTa14OnkFrfe7acYJqVGyQF1ChKTw549Sk5E+4jXuTWgjFouE+BQh5crBhwlKm6ZBkrbteNjHj9XvkPIvArsKM7iStinH4j+E9AuUq9eU",
};
const gnShellTransportFixture = String.raw`import base64, zlib, ast, contextlib, errno, hashlib, importlib.util, io, json, os, pathlib, shutil, subprocess, sys, tempfile, threading, time, types

packet = json.load(sys.stdin)
end = time.monotonic() + 20
def pinned(name, size, digest):
    raw = zlib.decompress(base64.b64decode(packet['primary'][name], validate=True))
    assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
    return raw
subprocess_raw = pinned('c101-subprocess2.py', 8205, 'b41c8adc9d67bbb04c7afdfe9fef3ad17f6a55f74361508c908ea8ba1722e518')
utils_raw = pinned('c101-gclient_utils.py', 54620, '88f335ab20d376688fb58480831167c66523f6b501fe21ad164c1302ae867278')
util_raw = pinned('cef682-gclient_util.py', 1402, 'da794cfb7b69bd56f3206efb2d7cb9f3b87032aca9c222a0b61df4b3f052a5db')
outer = ast.parse(packet['outer'])
action = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == 'reviewed_action')
assignment = next(n for n in ast.walk(action) if isinstance(n, ast.Assign) and isinstance(n.value, ast.List))
transport = ast.literal_eval(assignment.value.elts[3])
encoded = ast.parse(transport).body[0].value
assert isinstance(encoded, ast.Call) and isinstance(encoded.func, ast.Name) and encoded.func.id == 'exec' and len(encoded.args) == 1
hex_call = encoded.args[0]
assert isinstance(hex_call, ast.Call) and isinstance(hex_call.func, ast.Attribute) and isinstance(hex_call.func.value, ast.Name) and hex_call.func.value.id == 'bytes' and hex_call.func.attr == 'fromhex' and len(hex_call.args) == 1
payload = ast.literal_eval(hex_call.args[0])
assert type(payload) is str and payload and all(c in '0123456789abcdef' for c in payload)
body = bytes.fromhex(payload).decode('utf-8')
assert len(body.encode()) == 1761 and hashlib.sha256(body.encode()).hexdigest() == '505236ae9dc839b45bd36b3e96889e93124778493244785f65959ff8bac957d4'
assert body.startswith('import sys,os,hashlib,stat\n')
assert '\n' not in transport and '\r' not in transport and ' ' in transport and not any(c in transport for c in '&|<>^%!"')
# Execute only the actual command constructor with modeled outcome leaves.
constructed = []
class ModelSys: executable = packet['python']
namespace = dict(sys=ModelSys, subprocess=subprocess, gn_projection_calls=1,
                 gn=packet['argv'][4], expected=packet['argv'][5], size=packet['argv'][6], digest=packet['argv'][7],
                 original=lambda directory, command: constructed.append(command))
exec(compile(ast.Module(body=[action], type_ignores=[]), '<actual-fixed-vector-data-model>', 'exec'), namespace)
namespace['reviewed_action']('owned', ['gn', 'gen', 'out/Release_GN_arm64'])
assert len(constructed) == 1 and constructed[0][3] == transport and constructed[0][-2:] == ['gen', 'out/Release_GN_arm64']
line = subprocess.list2cmdline(constructed[0])
assert '"' + transport + '"' in line and len(line) + 64 <= 8191
outer_line = subprocess.list2cmdline([packet['python'], *packet['argv']])
assert len(outer_line) < 32767
namespace['gn'] += 'x' * 8192
try:
    namespace['reviewed_action']('owned', ['gn', 'gen', 'out/Release_GN_arm64'])
    raise AssertionError('overlong command reached dispatch')
except RuntimeError as error:
    assert str(error) == 'FULL_GN_COMMAND_BOUND'
assert len(constructed) == 1
facts = dict(kind='actual-Windows-cmd-GN-transport-causal', bodyBytes=len(body.encode()), bodySha256=hashlib.sha256(body.encode()).hexdigest(), byteIdenticalTransport=True, nestedCommandChars=len(line) + 64, nestedLimit=8191, outerCommandChars=len(outer_line), outerLimit=32767, tooLongDeniedBeforeDispatch=True, nativeGnExecuted=False, compilerExecuted=False)
if packet['mode'] == 'inspect':
    print(json.dumps(facts));sys.exit(0)
assert packet['mode'] == 'native' and os.name == 'nt'
sp = types.ModuleType('pinned_subprocess2')
exec(compile(subprocess_raw, '<pinned-c101-subprocess2>', 'exec'), sp.__dict__)
original_popen = sp.Popen
root = pathlib.Path(tempfile.mkdtemp(prefix='gn-shell-owned-')).resolve(strict=True)
owned = []
timers = []
timed_out = []
def launch(args, **kwargs):
    assert args[0] == sys.executable and args[1:3] == ['-B', '-c']
    assert time.monotonic() + 5 < end
    kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    child = original_popen(args, **kwargs)
    owned.append(child)
    def stop():
        if child.poll() is None:
            timed_out.append(True)
            child.kill()
    timer = threading.Timer(5, stop)
    timer.daemon = True
    timer.start()
    timers.append(timer)
    return child
subprocess_api = types.SimpleNamespace(Popen=launch, STDOUT=sp.STDOUT, CalledProcessError=sp.CalledProcessError)
utils_tree = ast.parse(utils_raw)
function = next(n for n in utils_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'CheckCallAndFilter')
children = set()
scope = dict(sys=sys, os=os, io=io, errno=errno, shutil=shutil, time=time, subprocess2=subprocess_api,
             RETRY_MAX=1, RETRY_INITIAL_SLEEP=2, GetOperatingSystem=lambda: 'win',
             GClientChildren=types.SimpleNamespace(add=children.add, remove=children.remove))
exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-c101-CheckCallAndFilter>', 'exec'), scope)
util_tree = ast.parse(util_raw)
run_action = next(n for n in util_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'RunAction')
util_scope = dict(sys=sys, gclient_utils=types.SimpleNamespace(CheckCallAndFilter=scope['CheckCallAndFilter'], Error=type('Error', (Exception,), {})))
exec(compile(ast.Module(body=[run_action], type_ignores=[]), '<actual-CEF682-RunAction>', 'exec'), util_scope)
records = []
try:
    expected = root / 'gn.exe'
    raw = b'BENIGN DATA; NEVER EXECUTED'
    expected.write_bytes(raw)
    marker = root / 'marker'
    alternate = root / 'alternate.exe'
    alternate.write_bytes(raw)
    for name, script, result in [('old-multiline', body, 0), ('single-line', transport, 0), ('single-line-nonzero', transport, 42), ('single-line-alternate', transport, 1), ('single-line-pin', transport, 1), ('single-line-hardlink', transport, 1)]:
        expected.write_bytes(raw)
        if name == 'single-line-pin':
            expected.write_bytes(b'X' * len(raw))
        if name == 'single-line-hardlink':
            os.link(expected, root / 'owned-hardlink.exe')
        candidate = alternate if name == 'single-line-alternate' else expected
        (root / 'gn.py').write_text('import pathlib\ndef FindGnTool(): return ' + repr(str(candidate)) + '\ndef main(args):\n assert FindGnTool() == ' + repr(str(expected)) + '\n assert args[1:] == ["gen", "out/owned"]\n pathlib.Path(' + repr(str(marker)) + ').write_text("owned",encoding="ascii")\n return ' + str(result) + '\n', encoding='utf-8', newline='\n')
        if marker.exists():
            marker.unlink()
        command = [sys.executable, '-B', '-c', script, str(root / 'gn.py'), str(expected), str(len(raw)), hashlib.sha256(raw).hexdigest(), 'gen', 'out/owned']
        assert len(subprocess.list2cmdline(command)) < 8191
        clean = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'COMSPEC': 'C:\\Windows\\System32\\cmd.exe', 'PATH': 'C:\\Windows\\System32'}
        saved_env = dict(os.environ)
        class Output(io.StringIO):
            def __init__(self):
                super().__init__();self.buffer = io.BytesIO()
        output = Output()
        status = 0
        try:
            os.environ.clear();os.environ.update(clean)
            with contextlib.redirect_stdout(output):
                try:
                    util_scope['RunAction'](str(root), command)
                except sp.CalledProcessError as error:
                    status = error.returncode
        finally:
            os.environ.clear();os.environ.update(saved_env)
            for timer in timers:
                timer.cancel()
        present = marker.exists()
        captured = output.buffer.getvalue() + output.getvalue().encode()
        assert len(captured) <= 8192
        codes = [code for code in ('FULL_GN_SELECTOR_PIN', 'FULL_GN_SELECTOR_FILE', 'FULL_GN_SELECTOR') if code.encode() in captured]
        records.append(dict(case=name, status=status, marker=present, capturedBytes=len(captured), diagnostic=codes[0] if codes else None, ownedClosed=all(c.poll() is not None for c in owned)))
        assert time.monotonic() < end and not timed_out and not children
        assert status == result
        assert present == (name in ('single-line', 'single-line-nonzero'))
    print(json.dumps(dict(facts, records=records)))
finally:
    for timer in timers:
        timer.cancel()
    if not timed_out and all(c.poll() is not None for c in owned):
        assert root.parent == pathlib.Path(tempfile.gettempdir()).resolve(strict=True)
        shutil.rmtree(root)
`;
async function fullGnShellFixture(t, mode) {
  let python;
  for (const candidate of [
    profile.python.path,
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Programs/Python/Python312/python.exe",
      ),
  ].filter(Boolean)) {
    try {
      const raw = await fs.readFile(candidate);
      assert.equal(raw.length, profile.python.bytes);
      assert.equal(sha(raw), profile.python.sha256);
      python = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!python) {
    assert.notEqual(
      process.platform,
      "win32",
      "Windows fixture requires the exact pinned Python",
    );
    python = await benignPython(t);
    if (!python) return;
  }
  const sourceRoot =
    "D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19";
  const cef = sourceRoot + "/source-checkout/src/cef",
    depot = sourceRoot + "/source-checkout/depot_tools";
  // Model Windows path spelling for this data-only vector on every test host.
  const hookArgumentsFor = (pathApi) =>
    new Function(
      "path",
      "fail",
      "return (" + cefHookArguments.toString() + ")",
    )(pathApi, (message) => assert.fail(message));
  assert.throws(
    () => hookArgumentsFor(path.posix)(cef, depot),
    /CEF hook requires absolute pinned checkout paths/,
  );
  const hooks = hookArgumentsFor(path.win32)(cef, depot);
  if (process.platform === "win32")
    assert.deepEqual(hooks, cefHookArguments(cef, depot));
  const argv = fullCarryDriver.boundGnArguments(
    hooks,
    sourceRoot + "/source-checkout/src/buildtools/win/gn.exe",
    { bytes: 1, sha256: "a".repeat(64) },
  );
  return JSON.parse(
    execFileSync(python, ["-I", "-B", "-c", gnShellTransportFixture], {
      input: JSON.stringify({
        mode,
        outer: argv[2],
        argv,
        python: profile.python.path,
        primary: GN_SHELL_PRIMARY_DEFLATE,
      }),
      encoding: "utf8",
      timeout: 25000,
      maxBuffer: 8192,
      windowsHide: true,
    }),
  );
}
test("FULL GN shell transport preserves identical selector bytes and fixed argv within both Windows command limits", async (t) => {
  const result = await fullGnShellFixture(t, "inspect");
  if (!result) return;
  assert.equal(
    result.bodySha256,
    "505236ae9dc839b45bd36b3e96889e93124778493244785f65959ff8bac957d4",
  );
  assert.equal(result.bodyBytes, 1761);
  assert.equal(result.byteIdenticalTransport, true);
  assert.equal(result.tooLongDeniedBeforeDispatch, true);
  assert(
    result.nestedCommandChars <= result.nestedLimit &&
      result.nestedLimit === 8191,
  );
  assert(
    result.outerCommandChars < result.outerLimit && result.outerLimit === 32767,
  );
});
test("FULL GN actual pinned Windows shell chain old multiline falsely succeeds while fixed transport executes and propagates nonzero", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Actual hidden Windows cmd proof");
    return;
  }
  const result = await fullGnShellFixture(t, "native");
  assert.deepEqual(
    result.records.map(({ case: name, status, marker, ownedClosed }) => ({
      name,
      status,
      marker,
      ownedClosed,
    })),
    [
      { name: "old-multiline", status: 0, marker: false, ownedClosed: true },
      { name: "single-line", status: 0, marker: true, ownedClosed: true },
      {
        name: "single-line-nonzero",
        status: 42,
        marker: true,
        ownedClosed: true,
      },
      {
        name: "single-line-alternate",
        status: 1,
        marker: false,
        ownedClosed: true,
      },
      { name: "single-line-pin", status: 1, marker: false, ownedClosed: true },
      {
        name: "single-line-hardlink",
        status: 1,
        marker: false,
        ownedClosed: true,
      },
    ],
  );
  assert.deepEqual(
    result.records.slice(-3).map((row) => row.diagnostic),
    ["FULL_GN_SELECTOR", "FULL_GN_SELECTOR_PIN", "FULL_GN_SELECTOR_FILE"],
  );
  assert.equal(result.nativeGnExecuted, false);
  assert.equal(result.compilerExecuted, false);
});
test("FULL GN shell transport exact inverse restores the whole previous source and denies missing duplicated or altered bytes", async () => {
  const current = (
    await fs.readFile(
      path.join(root, prefix, "full-sdk-source-driver.mjs"),
      "utf8",
    )
  ).replaceAll("\r\n", "\n");
  const old = fullGnShellTransportInverse(current, "driver");
  assert.equal(Buffer.byteLength(old), 289624);
  assert.equal(
    sha(old),
    "e9ed9951089d9b44b1b614bb3b1d56be8c78fc8e026f714927fed3645fac04ea",
  );
  for (const row of FULL_GN_SHELL_TRANSPORT_INVERSE.rows) {
    assert.throws(() =>
      fullGnShellTransportInverse(current.replace(row.new, ""), "driver"),
    );
    assert.throws(() =>
      fullGnShellTransportInverse(current + row.new, "driver"),
    );
    assert.throws(() =>
      fullGnShellTransportInverse(
        current.replace(row.new, row.new + "#changed"),
        "driver",
      ),
    );
  }
  assert.throws(() => fullGnShellTransportInverse(current + "\n", "driver"));
});

const gnProjectionDigestFixture = String.raw`import ast,base64,contextlib,hashlib,io,json,os,pathlib,shutil,subprocess,sys,tempfile,threading,time,types,zlib
packet=json.load(sys.stdin)
end=time.monotonic()+20
root=pathlib.Path(tempfile.mkdtemp(prefix='gn-digest-owned-')).resolve(strict=True)
owned=[];timers=[];timed_out=[];children=set();records=[]
saved_env=dict(os.environ);saved_path=list(sys.path);saved_argv=sys.argv[:];saved_platform=sys.platform
def pinned(name,size,digest):
 raw=zlib.decompress(base64.b64decode(packet['primary'][name],validate=True))
 assert len(raw)==size and hashlib.sha256(raw).hexdigest()==digest
 return raw
sp=types.ModuleType('pinned_subprocess2')
exec(compile(pinned('c101-subprocess2.py',8205,'b41c8adc9d67bbb04c7afdfe9fef3ad17f6a55f74361508c908ea8ba1722e518'),'<pinned-c101-subprocess2>','exec'),sp.__dict__)
def launch(args,**kwargs):
 assert args[0]==sys.executable and args[1:3]==['-B','-c'] and time.monotonic()+5<end
 kwargs['creationflags']=subprocess.CREATE_NO_WINDOW
 child=sp.Popen(args,**kwargs);owned.append(child)
 def stop():
  if child.poll() is None:timed_out.append(True);child.kill()
 timer=threading.Timer(5,stop);timer.daemon=True;timer.start();timers.append(timer)
 return child
utils_tree=ast.parse(pinned('c101-gclient_utils.py',54620,'88f335ab20d376688fb58480831167c66523f6b501fe21ad164c1302ae867278'))
check=next(n for n in utils_tree.body if isinstance(n,ast.FunctionDef) and n.name=='CheckCallAndFilter')
check_scope=dict(sys=sys,os=os,io=io,errno=__import__('errno'),shutil=shutil,time=time,subprocess2=types.SimpleNamespace(Popen=launch,STDOUT=sp.STDOUT,CalledProcessError=sp.CalledProcessError),RETRY_MAX=1,RETRY_INITIAL_SLEEP=2,GetOperatingSystem=lambda:'win',GClientChildren=types.SimpleNamespace(add=children.add,remove=children.remove))
exec(compile(ast.Module(body=[check],type_ignores=[]),'<actual-c101-CheckCallAndFilter>','exec'),check_scope)
util_tree=ast.parse(pinned('cef682-gclient_util.py',1402,'da794cfb7b69bd56f3206efb2d7cb9f3b87032aca9c222a0b61df4b3f052a5db'))
action=next(n for n in util_tree.body if isinstance(n,ast.FunctionDef) and n.name=='RunAction')
gn_raw=zlib.decompress(base64.b64decode(packet['gnArgs'],validate=True))
assert len(gn_raw)==26541 and hashlib.sha256(gn_raw).hexdigest()=='ab94e3b3c214198b396c8b4858b5d5e9cb42be956bbc294d651dd86eac44df6e'
fixed={}
for line in packet['fixed'].splitlines():
 key,value=line.split('=',1);fixed[key]=True if value=='true' else False if value=='false' else ast.literal_eval(value)
definitions=' '.join("'"+key+'='+('true' if value is True else 'false' if value is False else json.dumps(value))+"'" for key,value in fixed.items())
class Output(io.StringIO):
 def __init__(self):super().__init__();self.buffer=io.BytesIO()
try:
 for case in ['old-shadow','fixed','fixed-nonzero','fixed-wrong-pin','fixed-source-drift']:
  workspace=root/case;tools=workspace/'source-checkout/src/cef/tools';tools.mkdir(parents=True)
  source=tools/'gn_args.py';source.write_bytes(gn_raw+(b'\n' if case=='fixed-source-drift' else b''))
  vs=workspace/'custom-vs';(vs/'VC').mkdir(parents=True);(vs/'VC/vcvarsall.bat').write_bytes(b'')
  depot=workspace/'source-checkout/depot_tools';depot.mkdir()
  expected=workspace/'source-checkout/src/buildtools/win/gn.exe';expected.parent.mkdir(parents=True)
  data=b'BENIGN GN SELECTOR DATA; NEVER EXECUTED';expected.write_bytes(data)
  digest=hashlib.sha256(data).hexdigest();passed_digest='0'*64 if case=='fixed-wrong-pin' else digest
  marker=workspace/'marker';gn=depot/'gn.py';status=42 if case=='fixed-nonzero' else 0
  gn.write_text('import pathlib\ndef FindGnTool(): return '+repr(str(expected))+'\ndef main(args):\n assert FindGnTool()=='+repr(str(expected))+'\n assert args[1:]==["gen","out/owned"]\n pathlib.Path('+repr(str(marker))+').write_text("owned",encoding="ascii")\n return '+str(status)+'\n',encoding='utf-8',newline='\n')
  sdk=dict(visual_studio_path=str(vs),visual_studio_version='2026',visual_studio_runtime_dirs=str(workspace/'runtime/x64'),windows_sdk_path=str(workspace/'Windows Kits/10'),windows_sdk_version='10.0.28000.0')
  hook=tools/'gclient_hook.py'
  hook.write_text('import gn_args,gclient_util\nconfigs=gn_args.GetAllPlatformConfigs('+repr(sdk)+')\nassert list(configs)==["Release_GN_arm64"]\nassert configs["Release_GN_arm64"]["enable_backup_ref_ptr_instance_tracer"] is False\ngclient_util.RunAction('+repr(str(workspace/'source-checkout/src'))+',["gn","gen","out/owned"])\n',encoding='utf-8',newline='\n')
  vector=[];module=types.ModuleType('gclient_util')
  def dispatch(directory,command):
   vector.append(command[:]);assert command[0]==sys.executable and command[1:3]==['-B','-c']
   if os.name=='nt' and not packet['portable']:return actual_action(directory,command)
   # Portable outcome model executes the real selector body with a benign gn.main.
   old_argv=sys.argv[:]
   try:
    sys.argv=['-c',*command[4:]]
    try:exec(command[3],{})
    except SystemExit as error:
     if error.code not in (None,0):raise sp.CalledProcessError(error.code,command,directory,'','')
    except RuntimeError as error:
     assert str(error) in ('FULL_GN_SELECTOR_PIN','FULL_GN_SELECTOR_FILE','FULL_GN_SELECTOR')
     print(str(error));raise sp.CalledProcessError(1,command,directory,'','')
   finally:sys.argv=old_argv
  util_scope=dict(sys=sys,gclient_utils=types.SimpleNamespace(CheckCallAndFilter=check_scope['CheckCallAndFilter'],Error=type('Error',(Exception,),{})))
  exec(compile(ast.Module(body=[action],type_ignores=[]),'<actual-CEF682-RunAction>','exec'),util_scope)
  actual_action=util_scope['RunAction'];module.RunAction=dispatch;sys.modules['gclient_util']=module
  sys.modules.pop('gn_args',None);sys.modules.pop('gn',None)
  clean={'SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','COMSPEC':'C:\\Windows\\System32\\cmd.exe','PATH':'C:\\Windows\\System32'} if os.name=='nt' else {}
  os.environ.clear();os.environ.update(clean,GN_DEFINES=definitions,GN_OUT_CONFIGS='Release_GN_arm64',CEF_ENABLE_ARM64='1',DEPOT_TOOLS_WIN_TOOLCHAIN='0',GYP_MSVS_OVERRIDE_PATH=str(vs),GYP_MSVS_VERSION='2026',CEF_VCVARS='none',VS_CRT_ROOT=sdk['visual_studio_runtime_dirs'],SDK_ROOT=sdk['windows_sdk_path'],SDK_VERSION=sdk['windows_sdk_version'])
  sys.platform='win32';sys.argv=['actual-outer',str(hook),str(gn),str(expected),str(len(data)),passed_digest]
  output=Output();caught=None;scope={};outer=packet['old'] if case=='old-shadow' else packet['current']
  try:
   with contextlib.redirect_stdout(output):exec(compile(outer,'<actual-boundGnArguments>','exec'),scope)
  except sp.CalledProcessError as error:caught=error.returncode
  except RuntimeError as error:caught=str(error)
  except SystemExit as error:caught=error.code
  finally:sys.platform=saved_platform
  capture=output.buffer.getvalue()+output.getvalue().encode();assert len(capture)<=8192
  child_pin=vector[0][7] if vector else None
  diagnostic=next((c for c in ['FULL_GN_SELECTOR_PIN','FULL_GN_PROJECTION_SOURCE'] if c.encode() in capture),None)
  if type(caught)is str:diagnostic=caught
  records.append(dict(case=case,nestedPin=child_pin,expectedPin=passed_digest,marker=marker.exists(),status=caught or 0,diagnostic=diagnostic,projectionCalls=scope.get('gn_projection_calls'),ownedClosed=all(c.poll()is not None for c in owned),nativeWindowsChain=os.name=='nt' and not packet['portable']))
  assert not children and not timed_out and time.monotonic()<end
  sys.path[:]=saved_path;sys.modules.pop('gn_args',None);sys.modules.pop('gn',None);sys.modules.pop('gclient_util',None)
 print(json.dumps(dict(records=records,sourceGeneratorPinned=True,outerBodyExecuted=True,nativeGnExecuted=False,compilerExecuted=False)))
finally:
 sys.platform=saved_platform;sys.path[:]=saved_path;sys.argv=saved_argv;os.environ.clear();os.environ.update(saved_env)
 for timer in timers:timer.cancel()
 if not timed_out and all(c.poll()is not None for c in owned):
  assert root.parent==pathlib.Path(tempfile.gettempdir()).resolve(strict=True);shutil.rmtree(root)
`;

test("FULL GN whole outer projection preserves the binary pin through the real generator and controlled selector child", async () => {
  const current = fullCarryDriver.boundGnArguments(
    ["-B", "-c", "fixed-hook", "fixed/gclient_hook.py", "fixed/gn.py"],
    "fixed/gn.exe",
    {
      bytes: 2601472,
      sha256:
        "e398eefd1241ad44e98aececa6a260abac0fdcb80f41c23176944ad3f0e76486",
    },
  )[2];
  const old = FULL_GN_PROJECTION_DIGEST_INVERSE.rows.reduce((text, row) => {
    assert.equal(text.split(row.new).length, 2);
    return text.replace(row.new, () => row.old);
  }, current);
  const fixed = (
    await read(
      "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn",
    )
  )
    .toString()
    .trim();
  // Exercise the portable outcome model on Windows too; it cannot substitute
  // for the separately required actual native shell chain on this host.
  for (const portable of process.platform === "win32"
    ? [false, true]
    : [true]) {
    const result = JSON.parse(
      execFileSync(
        await projectionFixturePython(),
        ["-I", "-B", "-c", gnProjectionDigestFixture],
        {
          input: JSON.stringify({
            current,
            old,
            fixed,
            portable,
            primary: GN_SHELL_PRIMARY_DEFLATE,
            gnArgs: pinnedCefGnArgsDeflate,
          }),
          encoding: "utf8",
          timeout: 25000,
          maxBuffer: 16384,
          windowsHide: true,
        },
      ),
    );
    assert.equal(result.sourceGeneratorPinned, true);
    assert.equal(result.outerBodyExecuted, true);
    assert.equal(result.nativeGnExecuted, false);
    assert.equal(result.compilerExecuted, false);
    const [before, after, nonzero, wrong, drift] = result.records;
    assert.equal(
      before.nestedPin,
      "608d1c5ffb0e793e97c67db19af0fe0a14c9248d548ac5edde79c09c0ec34cb3",
    );
    assert.notEqual(before.nestedPin, before.expectedPin);
    assert.equal(before.marker, false);
    assert.equal(before.status, 1);
    assert.equal(before.diagnostic, "FULL_GN_SELECTOR_PIN");
    for (const row of [after, nonzero, wrong]) {
      assert.equal(row.nestedPin, row.expectedPin);
      assert.equal(row.projectionCalls, 1);
    }
    assert.equal(after.marker, true);
    assert.equal(after.status, 0);
    assert.equal(nonzero.marker, true);
    assert.equal(nonzero.status, 42);
    assert.equal(wrong.marker, false);
    assert.equal(wrong.status, 1);
    assert.equal(wrong.diagnostic, "FULL_GN_SELECTOR_PIN");
    assert.equal(drift.nestedPin, null);
    assert.equal(drift.marker, false);
    assert.equal(drift.diagnostic, "FULL_GN_PROJECTION_SOURCE");
    assert(result.records.every((row) => row.ownedClosed));
    assert(result.records.every((row) => row.nativeWindowsChain === !portable));
  }
});

test("FULL GN projection digest inverse restores the complete prior driver and rejects partial duplicate or altered layers", async () => {
  const current = (
    await fs.readFile(
      path.join(root, prefix, "full-sdk-source-driver.mjs"),
      "utf8",
    )
  ).replaceAll("\r\n", "\n");
  const old = fullGnProjectionDigestInverse(current, "driver");
  assert.equal(Buffer.byteLength(old), 290006);
  assert.equal(
    sha(old),
    "27e6c073dab2b956c65aee7cd063e7114005077fe611fd99eb7a82326677e6e5",
  );
  for (const row of FULL_GN_PROJECTION_DIGEST_INVERSE.rows) {
    assert.throws(() =>
      fullGnProjectionDigestInverse(current.replace(row.new, ""), "driver"),
    );
    assert.throws(() =>
      fullGnProjectionDigestInverse(current + row.new, "driver"),
    );
    assert.throws(() =>
      fullGnProjectionDigestInverse(
        current.replace(row.new, row.new + "#changed"),
        "driver",
      ),
    );
  }
  assert.throws(() => fullGnProjectionDigestInverse(current + "\n", "driver"));
});

async function fullHooks3600Program(previous = false) {
  const { default: ts } = await import("typescript");
  let source = (await read(prefix + "full-sdk-source-driver.mjs")).replaceAll(
    "\r\n",
    "\n",
  );
  if (previous) source = fullHooks3600Inverse(source, "driver");
  const tree = ts.createSourceFile(
    "driver.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  return tree.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "fullSourceStage",
    )
    .getText(tree);
}
function fullHooks3600Model(program, began = 5400000) {
  let now = began;
  const timers = [],
    intervals = [],
    cleared = [];
  const sourceEnd = 10800000,
    wholeEnd = 21600000;
  const budget = {
    remaining() {
      if (now >= wholeEnd) throw new Error("ORIGINAL_WHOLE_DEADLINE");
      if (now >= sourceEnd) throw new Error("ORIGINAL_SOURCE_DEADLINE");
      return Math.min(sourceEnd - now, wholeEnd - now);
    },
  };
  const stage = vm.runInNewContext("(" + program + ")", {
    need(value, code) {
      if (!value) throw new Error(code);
    },
    performance: { now: () => now },
    setTimeout(callback, milliseconds) {
      const value = { callback, milliseconds };
      timers.push(value);
      return value;
    },
    setInterval(callback, milliseconds) {
      const value = { callback, milliseconds };
      intervals.push(value);
      return value;
    },
    clearTimeout(value) {
      cleared.push(value);
    },
    clearInterval(value) {
      cleared.push(value);
    },
    writeFileSync() {
      assert.fail("no deadline report without firing the owned timer");
    },
    process: {
      exit() {
        assert.fail("no real actor in this private clock fixture");
      },
    },
    path,
    Buffer,
    writeSync() {
      assert.fail("no diagnostic fallback expected");
    },
    sourceReportingFailure: false,
  });
  return {
    stage,
    budget,
    timers,
    intervals,
    cleared,
    sourceEnd,
    wholeEnd,
    advance(ms) {
      now += ms;
    },
  };
}
test("FULL hooks3600 admits measured work beyond the old2700 endpoint without renewing either original lease", async () => {
  for (const previous of [true, false]) {
    const f = fullHooks3600Model(await fullHooks3600Program(previous));
    const action = async () => {
      f.advance(2800000);
      return "owned-source-work";
    };
    const promise = f.stage(
      "owned",
      f.budget,
      "source-hooks-gn",
      previous ? 2700 : 3600,
      action,
    );
    if (previous) await assert.rejects(promise, /FULL_SOURCE_STAGE_DEADLINE/);
    else assert.equal(await promise, "owned-source-work");
    assert.equal(f.timers.length, 1);
    assert.equal(f.timers[0].milliseconds, previous ? 2700000 : 3600000);
    assert.equal(f.intervals.length, 1);
    assert.equal(f.intervals[0].milliseconds, 1000);
    assert.equal(f.cleared.length, 2);
    assert.equal(f.budget.remaining(), 2600000);
    assert.equal(f.sourceEnd, 10800000);
    assert.equal(f.wholeEnd, 21600000);
  }
  const f = fullHooks3600Model(await fullHooks3600Program());
  await assert.rejects(
    f.stage("owned", f.budget, "source-hooks-gn", 3600, async () => {
      f.advance(1800000);
      await Promise.resolve();
      f.advance(1800001);
      return "late";
    }),
    /FULL_SOURCE_STAGE_DEADLINE/,
  );
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].milliseconds, 3600000);
  assert.equal(f.cleared.length, 2);
});
test("FULL hooks3600 clips spent source time and the unchanged reserve and rejects exhausted original source or whole clocks", async () => {
  const program = await fullHooks3600Program();
  const spent = fullHooks3600Model(program, 7200000);
  assert.equal(
    await spent.stage(
      "owned",
      spent.budget,
      "source-hooks-gn",
      3600,
      async () => "bounded",
    ),
    "bounded",
  );
  assert.equal(spent.timers[0].milliseconds, 3480000);
  const tail = fullHooks3600Model(program, 7200000);
  await assert.rejects(
    tail.stage("owned", tail.budget, "source-hooks-gn", 3600, async () => {
      tail.advance(3480001);
      return "late";
    }),
    /FULL_SOURCE_STAGE_DEADLINE/,
  );
  for (const [start, code] of [
    [10680000, "FULL_SOURCE_RESERVE"],
    [10800000, "ORIGINAL_SOURCE_DEADLINE"],
    [21600000, "ORIGINAL_WHOLE_DEADLINE"],
  ]) {
    const f = fullHooks3600Model(program, start);
    let actions = 0;
    await assert.rejects(
      f.stage("owned", f.budget, "source-hooks-gn", 3600, async () => {
        actions++;
      }),
      new RegExp(code),
    );
    assert.equal(actions, 0);
    assert.equal(f.timers.length, 0);
    assert.equal(f.intervals.length, 0);
  }
  const f = fullHooks3600Model(program);
  await assert.rejects(
    f.stage("owned", f.budget, "source-hooks-gn", 3600, async () => {
      f.advance(5400001);
      return "source-expired";
    }),
    /ORIGINAL_SOURCE_DEADLINE/,
  );
  assert.equal(f.cleared.length, 2);
  const cancelled = fullHooks3600Model(program);
  await assert.rejects(
    cancelled.stage(
      "owned",
      cancelled.budget,
      "source-hooks-gn",
      3600,
      async () => {
        throw false;
      },
    ),
    (value) => value === false,
  );
  assert.equal(cancelled.cleared.length, 2);
});
test("FULL hooks3600 finite inverses restore every whole907 source and reject missing duplicated or altered cap and profile pins", async () => {
  const names = {
    driver: "full-sdk-source-driver.mjs",
    controller: "full_sdk_control.mjs",
    python: "full_sdk_source.py",
    profile: "full-sdk-source-profile.json",
  };
  for (const [name, leaf] of Object.entries(names)) {
    const raw = (
      await fs.readFile(path.join(root, prefix, leaf), "utf8")
    ).replaceAll("\r\n", "\n");
    const mid = fullGraphDiagnosticsInverse(raw, name),
      old = fullHooks3600InverseFrom(mid, name),
      spec = FULL_HOOKS_3600_HISTORY[name];
    assert.equal(Buffer.byteLength(old), spec.bytes);
    assert.equal(sha(old), spec.sha256);
    for (const row of spec.rows) {
      assert.throws(() =>
        fullHooks3600InverseFrom(mid.replace(row.new, ""), name),
      );
      assert.throws(() => fullHooks3600InverseFrom(mid + row.new, name));
      assert.throws(() =>
        fullHooks3600InverseFrom(
          mid.replace(row.new, row.new + "#changed"),
          name,
        ),
      );
    }
    assert.throws(() => fullHooks3600Inverse(raw + "\n", name));
  }
});

async function frozenGraphDiagnosticModel(mode) {
  const ts = (await import("typescript")).default,
    { Readable } = await import("node:stream"),
    { finished } = await import("node:stream/promises");
  const source = await read(
      prefix +
        "current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs",
    ),
    ast = ts.createSourceFile(
      "actual-frozen-graph.mjs",
      source,
      99,
      true,
      ts.ScriptKind.JS,
    ),
    functions = ["assertGraphBudget", "noLinks", "graphInventory"]
      .map((name) =>
        ast.statements
          .find(
            (row) => ts.isFunctionDeclaration(row) && row.name?.text === name,
          )
          .getText(ast)
          .replace(/^export /, ""),
      )
      .join("\n");
  assert.equal(
    sha(source),
    "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",
  );
  assert.deepEqual(controlCheckpoint.GRAPH_LIMITS, {
    files: 50000,
    bytes: 8 * 1024 ** 3,
    visited: 300000,
    milliseconds: 900000,
    fileBytes: 256 * 1024 ** 2,
    readers: 4,
  });
  let now = 0,
    timers = 0,
    cleared = 0,
    opened = 0,
    closed = 0,
    observed;
  const names =
    mode === "files"
      ? Array.from({ length: 50001 }, (_, i) => i + ".ninja")
      : mode === "visited"
        ? Array.from({ length: 300001 }, (_, i) => i + ".ignored")
        : mode === "bytes"
          ? Array.from({ length: 33 }, (_, i) => i + ".ninja")
          : mode === "missing"
            ? ["only.ninja"]
            : ["args.gn", "build.ninja"];
  const inodeByName = new Map(names.map((name, index) => [name, index + 1]));
  const metadata = (file) => ({
    isFile: () => true,
    size: mode === "bytes" ? 256 * 1024 ** 2 : mode === "size" ? 0 : 1,
    mtimeMs: 1,
    ino: inodeByName.get(path.basename(file)),
    dev: 1,
  });
  const statCalls = new Map();
  const globals = {
    GRAPH_LIMITS: controlCheckpoint.GRAPH_LIMITS,
    performance: { now: () => now },
    AbortController,
    path,
    createHash,
    finished,
    canonical: controlCheckpoint.canonical,
    sha,
    assert: (ok, message) => {
      if (!ok) throw Error(message);
    },
    lstat: async () => ({ isSymbolicLink: () => mode === "links" }),
    realpath: async (file) => (mode === "alias" ? file + "-alias" : file),
    readdir: async () => {
      if (mode === "deadline") now = 900001;
      if (mode === "io") {
        const error = new Error("PRIVATE_PATH SECRET_TOKEN");
        error.code = "EIO";
        throw error;
      }
      return names.map((name) => ({
        name,
        isSymbolicLink: () => false,
        isDirectory: () => false,
      }));
    },
    stat: async (file) => {
      const count = (statCalls.get(file) ?? 0) + 1;
      statCalls.set(file, count);
      return {
        ...metadata(file),
        mtimeMs: mode === "changed" && count > 1 ? 2 : 1,
      };
    },
    open: async (file) => {
      opened++;
      return {
        stat: async () => metadata(file),
        createReadStream: () => Readable.from([Buffer.from("x")]),
        close: async () => {
          closed++;
        },
      };
    },
    setTimeout: (_fn, ms) => {
      assert.equal(ms, 450000);
      timers++;
      return 1;
    },
    clearTimeout: () => {
      cleared++;
    },
  };
  const graphInventory = vm.runInNewContext(
    functions + "\ngraphInventory",
    globals,
  );
  return {
    async run(out, options) {
      observed = options.observe;
      return graphInventory(out, options);
    },
    late: (value) => observed(value),
    counts: () => ({ timers, cleared, opened, closed }),
  };
}

async function actualFullGraphFailureReport(f, primary, failWriter = false) {
  const ts = (await import("typescript")).default,
    source = await read(prefix + "full-sdk-source-driver.mjs"),
    ast = ts.createSourceFile(
      "actual-full-finally.mjs",
      source,
      99,
      true,
      ts.ScriptKind.JS,
    ),
    body = ast.statements
      .find(
        (row) =>
          ts.isFunctionDeclaration(row) &&
          row.name?.text === "runFullSourceBody",
      )
      .body.statements.find((row) => ts.isTryStatement(row))
      .finallyBlock.getText(ast),
    helpers = ast.statements
      .filter(
        (row) =>
          ts.isFunctionDeclaration(row) &&
          ["fullSourceErrorMessage", "fullSourceApplyDiagnostic"].includes(
            row.name?.text,
          ),
      )
      .map((row) => row.getText(ast))
      .join("\n"),
    utilTypes = (await import("node:util")).types,
    safeHelpers = new Function(
      "utilTypes",
      helpers + "\nreturn {fullSourceErrorMessage,fullSourceApplyDiagnostic};",
    )(utilTypes),
    reports = [],
    scope = {
      primary,
      failed: true,
      stage: "graph-inventory",
      success: false,
      root: "owned",
      p: f.input.p,
      qualificationOwner: f.owner,
      fullSourceProfiles: f.api.fullSourceProfiles,
      retireQualificationSource: f.api.retireQualificationSource,
      currentProgress: { close() {} },
      ...safeHelpers,
      fullSourceGraphDiagnostic: f.api.fullSourceGraphDiagnostic,
      TARGET: "aarch64-pc-windows-msvc",
      graph: null,
      generatedArguments: null,
      sourceCloseFailure: false,
      sourceReportingFailure: false,
      gitPolicy: {},
      custom: { sourceGitIsolationEvidence: () => ({ fixtureOnly: true }) },
      fs: {
        async writeFile(file, raw, options) {
          assert.equal(path.basename(file), "full-source-gn-result.json");
          assert.equal(options.flag, "wx");
          reports.push(JSON.parse(raw));
          if (failWriter)
            throw Error("PRIVATE_PATH SECRET_TOKEN write failure");
        },
      },
      path,
    };
  const run = new Function(
    ...Object.keys(scope),
    "return (async()=>{try { throw primary; } finally " + body + "})()",
  );
  let failed = false,
    caught;
  try {
    await run(...Object.values(scope));
  } catch (error) {
    failed = true;
    caught = error;
  }
  assert.equal(failed, true);
  assert.equal(caught, primary);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].success, false);
  assert.equal(reports[0].graph, null);
  assert.equal(reports[0].sdkBuilt, false);
  assert.equal(reports[0].nativeAcceptance, false);
  assert.equal(reports[0].engineCompilationRequested, false);
  assert.equal(JSON.stringify(reports[0]).includes("PRIVATE_PATH"), false);
  assert.equal(JSON.stringify(reports[0]).includes("SECRET_TOKEN"), false);
  return reports[0];
}

test("FULL graph diagnostics preserve actual frozen deadline and file byte visited bound failures in the real source finally without graph authority", async () => {
  for (const mode of ["deadline", "files", "bytes", "visited"]) {
    const f = await fullMetadataFixture(),
      model = await frozenGraphDiagnosticModel(mode);
    f.input.checkpoint.graphInventory = (out, options) =>
      model.run(out, options);
    f.input.checkpoint.graphPinSnapshot = (value) =>
      controlCheckpoint.graphPinSnapshot(JSON.parse(JSON.stringify(value)));
    let failed = false,
      primary;
    try {
      await f.api.collectFullQualificationGraph(f.owner);
    } catch (error) {
      failed = true;
      primary = error;
    }
    assert.equal(failed, true, mode);
    assert.equal(primary.code, "GRAPH_BOUND", mode);
    const state = f.api.qualificationSourceOwners.get(f.owner);
    assert.equal(state.failed, true);
    assert.equal(state.primary, primary);
    assert.equal(state.retired, true);
    assert.equal(state.graphPending, null);
    assert.equal(state.graphReceipt, null);
    assert.equal(state.sourceToken, null);
    const before = f.api.fullSourceGraphDiagnostic(f.owner, primary),
      report = await actualFullGraphFailureReport(f, primary, true);
    assert.equal(report.firstFailure, "GRAPH_BOUND");
    assert.deepEqual(report.graphDiagnostic.graphCounts, {
      ...primary.graphCounts,
    });
    assert.deepEqual(report.graphDiagnostic, before);
    assert.equal(report.graphDiagnostic.phase, "graph-inventory");
    assert.ok(report.graphDiagnostic.progress.length <= 36);
    if (mode === "deadline")
      assert.equal(report.graphDiagnostic.progress.at(-1).elapsedMs, 900000);
    if (mode === "files") {
      assert.equal(report.graphDiagnostic.graphCounts.visited, 50001);
      assert.ok(report.graphDiagnostic.graphCounts.files >= 49996);
      assert.ok(report.graphDiagnostic.graphCounts.files <= 50000);
    }
    if (mode === "bytes")
      assert.ok(report.graphDiagnostic.graphCounts.bytes > 8 * 1024 ** 3);
    if (mode === "visited")
      assert.equal(report.graphDiagnostic.graphCounts.visited, 300001);
    const frozen = JSON.stringify(report.graphDiagnostic);
    model.late({
      phase: "complete",
      files: 0,
      bytes: 0,
      visited: 0,
      active: 0,
      completedHashedFiles: 0,
      completedHashedBytes: 0,
      elapsedMs: 1,
      categories: Object.fromEntries(
        ["args", "build", "toolchain", "target"].map((n) => [
          n,
          { files: 0, bytes: 0 },
        ]),
      ),
    });
    assert.equal(
      JSON.stringify(f.api.fullSourceGraphDiagnostic(f.owner, primary)),
      frozen,
    );
    assert.deepEqual(model.counts(), {
      timers: 1,
      cleared: 1,
      opened: 0,
      closed: 0,
    });
  }
});

test("FULL graph diagnostics keep actual frozen success parity and preserve every falsy first error without a late callback grant", async () => {
  const f = await fullMetadataFixture(),
    model = await frozenGraphDiagnosticModel("success");
  f.input.checkpoint.graphInventory = (out, options) => model.run(out, options);
  f.input.checkpoint.graphPinSnapshot = (value) =>
    controlCheckpoint.graphPinSnapshot(JSON.parse(JSON.stringify(value)));
  const result = await f.api.collectFullQualificationGraph(f.owner);
  assert.equal(result.summary.files, 2);
  assert.equal(result.summary.bytes, 2);
  assert.equal(f.api.qualificationSourceOwners.get(f.owner).retired, false);
  assert.equal(f.api.qualificationSourceOwners.get(f.owner).sourceToken, null);
  const observed = f.api.fullSourceGraphDiagnostic(f.owner, false);
  assert.ok(observed.progress.some((row) => row.phase === "complete"));
  assert.equal(observed.code, "UNKNOWN");
  assert.deepEqual(model.counts(), {
    timers: 1,
    cleared: 1,
    opened: 2,
    closed: 2,
  });
  for (const primary of [false, null, 0]) {
    const denied = await fullMetadataFixture();
    let late;
    denied.input.checkpoint.graphInventory = async (_out, options) => {
      late = options.observe;
      throw primary;
    };
    let failed = false,
      caught;
    try {
      await denied.api.collectFullQualificationGraph(denied.owner);
    } catch (error) {
      failed = true;
      caught = error;
    }
    assert.equal(failed, true);
    assert.equal(caught, primary);
    const report = await actualFullGraphFailureReport(denied, primary, true);
    assert.equal(report.firstFailure, "FULL_SOURCE_FAILED");
    assert.equal(report.graphDiagnostic.code, "UNKNOWN");
    const before = JSON.stringify(report.graphDiagnostic);
    late(
      new Proxy(
        {},
        {
          get() {
            throw Error("SECRET_TOKEN");
          },
          getOwnPropertyDescriptor() {
            throw false;
          },
        },
      ),
    );
    assert.equal(
      JSON.stringify(
        denied.api.fullSourceGraphDiagnostic(denied.owner, primary),
      ),
      before,
    );
    assert.equal(
      denied.api.qualificationSourceOwners.get(denied.owner).primary,
      primary,
    );
    assert.equal(
      denied.api.qualificationSourceOwners.get(denied.owner).sourceToken,
      null,
    );
  }
});

test("FULL graph diagnostics copy only closed own data without getters proxies unsafe counts or more than36 bounded samples", async () => {
  const f = await fullMetadataFixture(),
    utilTypes = (await import("node:util")).types;
  let getters = 0,
    late;
  const primary = new Error("PRIVATE_PATH SECRET_TOKEN raw text");
  primary.code = "GRAPH_BOUND";
  primary.graphCounts = { files: 1, bytes: 1, visited: 1 };
  const sample = {
    phase: "hashing",
    files: 1,
    bytes: 1,
    visited: 1,
    active: 1,
    completedHashedFiles: 0,
    completedHashedBytes: 0,
    elapsedMs: 1,
    categories: {
      args: { files: 1, bytes: 1 },
      build: { files: 0, bytes: 0 },
      toolchain: { files: 0, bytes: 0 },
      target: { files: 0, bytes: 0 },
    },
  };
  Object.defineProperty(sample, "privatePath", {
    get() {
      getters++;
      throw false;
    },
  });
  f.input.checkpoint.graphInventory = async (_out, options) => {
    late = options.observe;
    for (let i = 0; i < 37; i++) options.observe(sample);
    throw primary;
  };
  await assert.rejects(
    f.api.collectFullQualificationGraph(f.owner),
    (error) => error === primary,
  );
  const diagnostic = f.api.fullSourceGraphDiagnostic(f.owner, primary);
  assert.equal(diagnostic.progress.length, 36);
  assert.equal(diagnostic.discardedSamples, 1);
  assert.equal(JSON.stringify(diagnostic).includes("privatePath"), false);
  for (const key of ["files", "bytes", "visited"]) {
    const bad = { files: 1, bytes: 1, visited: 1 };
    Object.defineProperty(bad, key, {
      get() {
        getters++;
        throw false;
      },
    });
    assert.equal(f.api.fullGraphCounts(bad), null);
    for (const value of [-1, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER]) {
      assert.equal(
        f.api.fullGraphCounts({ files: 1, bytes: 1, visited: 1, [key]: value }),
        null,
      );
    }
  }
  for (const bad of [
    { ...sample, phase: "PRIVATE_PATH SECRET_TOKEN" },
    { ...sample, active: 5 },
    { ...sample, elapsedMs: 900001 },
    { ...sample, completedHashedFiles: 2 },
    {
      ...sample,
      categories: { ...sample.categories, args: { files: 0, bytes: 0 } },
    },
  ])
    assert.equal(f.api.fullGraphProgress(bad), null);
  const hostile = new Proxy(new Error("secret"), {
    get() {
      getters++;
      throw false;
    },
    getOwnPropertyDescriptor() {
      getters++;
      throw false;
    },
  });
  const accessor = new Error();
  Object.defineProperty(accessor, "code", {
    get() {
      getters++;
      throw false;
    },
  });
  const inherited = new Error();
  Object.setPrototypeOf(inherited, { code: "GRAPH_BOUND" });
  for (const error of [
    false,
    {},
    { code: "GRAPH_BOUND", graphCounts: primary.graphCounts },
    hostile,
    accessor,
    inherited,
  ]) {
    assert.equal(
      f.api.fullSourceGraphDiagnostic(f.owner, error).code,
      "UNKNOWN",
    );
  }
  const unsafe = new Error();
  unsafe.code = "GRAPH_BOUND";
  Object.defineProperty(unsafe, "graphCounts", {
    get() {
      getters++;
      throw false;
    },
  });
  assert.equal(
    f.api.fullSourceGraphDiagnostic(f.owner, unsafe).code,
    "GRAPH_BOUND",
  );
  assert.equal(
    f.api.fullSourceGraphDiagnostic(f.owner, unsafe).graphCounts,
    undefined,
  );
  assert.equal(utilTypes.isNativeError(primary), true);
  const before = JSON.stringify(diagnostic);
  late(sample);
  assert.equal(
    JSON.stringify(f.api.fullSourceGraphDiagnostic(f.owner, primary)),
    before,
  );
  assert.equal(getters, 0);
});

test("FULL graph diagnostic finite inverse restores the whole previous driver before cap history and denies missing altered duplicated or extra bytes", async () => {
  const raw = (await read(prefix + "full-sdk-source-driver.mjs")).replaceAll(
      "\r\n",
      "\n",
    ),
    mid = fullGraphDeadlineInverse(raw, "driver"),
    decoded = fullGraphDiagnosticsInverseFrom(mid, "driver");
  assert.equal(Buffer.byteLength(decoded), 290034);
  assert.equal(
    sha(decoded),
    "8f6ccea24cf9104e61ab26999dbec23a9fc90c346c018e8501252d68446b75c0",
  );
  for (const row of FULL_GRAPH_DIAGNOSTICS_HISTORY.rows) {
    assert.equal(mid.split(row.new).length, 2);
    assert.throws(() =>
      fullGraphDiagnosticsInverseFrom(mid.replace(row.new, ""), "driver"),
    );
    assert.throws(() =>
      fullGraphDiagnosticsInverseFrom(mid + row.new, "driver"),
    );
    assert.throws(() =>
      fullGraphDiagnosticsInverseFrom(
        mid.replace(row.new, "#changed" + row.new),
        "driver",
      ),
    );
  }
  assert.throws(() => fullGraphDiagnosticsInverse(raw + "\n", "driver"));
  assert.equal(
    sha(
      await fs.readFile(
        path.join(root, prefix, "full-sdk-source-profile.json"),
      ),
    ),
    "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989",
  );
  assert.equal(
    sha(
      await fs.readFile(
        path.join(
          root,
          prefix,
          "current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs",
        ),
      ),
    ),
    "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",
  );
});

test("FULL graph diagnostics classify actual frozen size changed missing graph link alias and IO failures without changing their original primary or progress", async () => {
  const cases = [
    ["size", "GRAPH_ASSET_SIZE"],
    ["changed", "GRAPH_ASSET_CHANGED"],
    ["missing", "GRAPH_INCOMPLETE"],
    ["links", "GRAPH_LINK_REJECTED"],
    ["alias", "GRAPH_PATH_ALIAS"],
    ["io", "GRAPH_FS_ERROR"],
  ];
  for (const [mode, code] of cases) {
    const f = await fullMetadataFixture(),
      model = await frozenGraphDiagnosticModel(mode);
    f.input.checkpoint.graphInventory = (out, options) =>
      model.run(out, options);
    let failed = false,
      primary;
    try {
      await f.api.collectFullQualificationGraph(f.owner);
    } catch (error) {
      failed = true;
      primary = error;
    }
    assert.equal(failed, true, mode);
    const state = f.api.qualificationSourceOwners.get(f.owner);
    assert.equal(state.failed, true);
    assert.equal(state.primary, primary);
    assert.equal(state.retired, true);
    assert.equal(state.graphPending, null);
    assert.equal(state.graphReceipt, null);
    assert.equal(state.sourceToken, null);
    const report = await actualFullGraphFailureReport(f, primary, true);
    assert.equal(report.graphDiagnostic.code, code, mode);
    assert.equal(report.graphDiagnostic.progress.at(-1).phase, "stopped", mode);
    assert.equal(report.graphDiagnostic.graphCounts, undefined);
    assert.equal(
      report.graphDiagnostic.errno,
      mode === "io" ? "EIO" : undefined,
    );
    assert.equal(report.firstFailure, "FULL_SOURCE_FAILED");
    assert.deepEqual(model.counts(), {
      timers: 1,
      cleared: 1,
      opened: 0,
      closed: 0,
    });
  }
});

test("FULL graph diagnostic known failure classes never copy hostile messages unknown errno inherited properties getters or proxy fields", async () => {
  const f = await fullMetadataFixture(),
    primary = new Error("unclassified original");
  f.input.checkpoint.graphInventory = async () => {
    throw primary;
  };
  await assert.rejects(
    f.api.collectFullQualificationGraph(f.owner),
    (error) => error === primary,
  );
  for (const [message, code] of [
    ["Invalid graph deadline", "GRAPH_INVALID_DEADLINE"],
    ["Complete graph pins required", "GRAPH_INCOMPLETE_PINS"],
  ]) {
    const error = new Error(message);
    assert.equal(f.api.fullSourceGraphDiagnostic(f.owner, error).code, code);
  }
  let actualIo;
  try {
    await fs.stat(
      path.join(tmpdir(), "sorng-PRIVATE_PATH-SECRET_TOKEN-" + randomUUID()),
    );
  } catch (error) {
    actualIo = error;
  }
  assert.equal(actualIo.code, "ENOENT");
  const io = f.api.fullSourceGraphDiagnostic(f.owner, actualIo);
  assert.equal(io.code, "GRAPH_FS_ERROR");
  assert.equal(io.errno, "ENOENT");
  let actualPin;
  try {
    controlCheckpoint.graphPinSnapshot({});
  } catch (error) {
    actualPin = error;
  }
  assert.equal(
    f.api.fullSourceGraphDiagnostic(f.owner, actualPin).code,
    "GRAPH_INVALID_PIN_SHAPE",
  );
  let getters = 0;
  const accessor = new Error();
  Object.defineProperty(accessor, "message", {
    get() {
      getters++;
      throw false;
    },
  });
  Object.defineProperty(accessor, "code", {
    get() {
      getters++;
      throw false;
    },
  });
  const inherited = new Error("unknown");
  Object.setPrototypeOf(inherited, { code: "ENOENT" });
  const nearMessage = new Error(
    "Checkpoint asset size PRIVATE_PATH SECRET_TOKEN",
  );
  const nearErrno = new Error("PRIVATE_PATH SECRET_TOKEN");
  nearErrno.code = "EIO PRIVATE_PATH";
  const unknown = new Error("PRIVATE_PATH SECRET_TOKEN");
  unknown.code = "UV_PRIVATE_TOKEN";
  const proxy = new Proxy(new Error(), {
    get() {
      getters++;
      throw false;
    },
    getOwnPropertyDescriptor() {
      getters++;
      throw false;
    },
  });
  for (const error of [
    accessor,
    inherited,
    nearMessage,
    nearErrno,
    unknown,
    proxy,
    { message: "Checkpoint asset size", code: "EIO" },
    new Error("Graph inventory bound"),
    new Error("checkpoint asset size"),
    false,
    null,
    0,
  ]) {
    const diagnostic = f.api.fullSourceGraphDiagnostic(f.owner, error);
    assert.equal(diagnostic.code, "UNKNOWN");
    assert.equal(diagnostic.errno, undefined);
    assert.equal(diagnostic.graphCounts, undefined);
    assert.equal(JSON.stringify(diagnostic).includes("PRIVATE_PATH"), false);
    assert.equal(JSON.stringify(diagnostic).includes("SECRET_TOKEN"), false);
  }
  assert.equal(getters, 0);
  assert.equal(f.api.qualificationSourceOwners.get(f.owner).primary, primary);
  assert.equal(f.api.qualificationSourceOwners.get(f.owner).sourceToken, null);
});

test("FULL graph diagnostic wrapper returns the original collector promise without a new await or adoption and preserves closure and false", async () => {
  const ts = (await import("typescript")).default,
    source = await read(prefix + "full-sdk-source-driver.mjs"),
    ast = ts.createSourceFile(
      "actual-graph-wrapper.mjs",
      source,
      99,
      true,
      ts.ScriptKind.JS,
    ),
    current = ast.statements
      .find(
        (row) =>
          ts.isFunctionDeclaration(row) &&
          row.name?.text === "collectFullQualificationGraph",
      )
      .getText(ast),
    previous =
      'async function collectFullQualificationGraph(owner) {\n  const { state } = fullMetadataOwner(owner);\n  need(!fullGraphObservations.has(owner), "FULL_GRAPH_OBSERVATION_REPEAT");\n  const observation = {\n    state,\n    epoch: state.epoch,\n    progress: [],\n    discardedSamples: 0,\n    closed: false,\n  };\n  fullGraphObservations.set(owner, observation);\n  try {\n    return await collectQualificationGraph(owner);\n  } finally {\n    observation.closed = true;\n  }\n}';
  assert.equal(
    sha(previous),
    "f4728dec86a09bf45f27124c671b7fa0351a4351590eb59fa065509f246a469a",
  );
  for (const [text, old] of [
    [previous, true],
    [current, false],
  ]) {
    for (const fail of [false, true]) {
      const f = await fullMetadataFixture(),
        observations = new WeakMap();
      let fulfill, reject;
      const original = new Promise((resolve, deny) => {
        fulfill = resolve;
        reject = deny;
      });
      const wrapper = new Function(
        "fullMetadataOwner",
        "fullGraphObservations",
        "collectQualificationGraph",
        "need",
        text + "\nreturn collectFullQualificationGraph;",
      )(
        f.api.fullMetadataOwner,
        observations,
        () => original,
        (ok, code) => {
          if (!ok) throw Error(code);
        },
      );
      const returned = wrapper(f.owner);
      if (old) assert.throws(() => assert.equal(returned, original));
      else assert.equal(returned, original);
      assert.equal(observations.get(f.owner).closed, false);
      if (fail) reject(false);
      else fulfill("bounded graph DATA");
      if (fail) {
        let failed = false,
          caught;
        try {
          await returned;
        } catch (error) {
          failed = true;
          caught = error;
        }
        assert.equal(failed, true);
        assert.equal(caught, false);
      } else assert.equal(await returned, "bounded graph DATA");
      assert.equal(observations.get(f.owner).closed, true);
      assert.equal(
        f.api.qualificationSourceOwners.get(f.owner).sourceToken,
        null,
      );
    }
  }
});

test("FULL GN desc shape diagnostic copies only bounded key names and value types from an own-data native error", async () => {
  const ts = (await import("typescript")).default,
    { types } = await import("node:util"),
    source = await read(prefix + "full-sdk-source-driver.mjs"),
    ast = ts.createSourceFile("diag.mjs", source, 99, true, ts.ScriptKind.JS),
    pick = (name) =>
      ast.statements
        .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
        .getText(ast),
    diagnostic = new Function(
      "utilTypes",
      pick("fullGraphOwnValue") +
        "\n" +
        pick("fullGnDescDiagnostic") +
        "\nreturn fullGnDescDiagnostic;",
    )(types);
  const error = (rows) =>
    Object.assign(new Error("PRIVATE_GN_DESC_FIELDS"), { gnDescShape: rows });
  assert.deepEqual(
    diagnostic(
      error([
        ["type", "string"],
        ["deps", "array"],
        ["metadata", "object"],
      ]),
    ),
    {
      kind: "windows-arm-source-gn-desc-shape",
      keys: [
        ["type", "string"],
        ["deps", "array"],
        ["metadata", "object"],
      ],
    },
  );
  for (const bad of [
    undefined,
    "x",
    [["Type", "string"]],
    [["a".repeat(49), "string"]],
    [["a", "function"]],
    [["a", "string", "extra"]],
    Array.from({ length: 65 }, () => ["a", "string"]),
  ])
    assert.equal(diagnostic(error(bad)), null);
  assert.equal(diagnostic({ gnDescShape: [] }), null);
  assert.equal(diagnostic(null), null);
  const getter = new Error("x");
  Object.defineProperty(getter, "gnDescShape", {
    get() {
      throw new Error("must not run");
    },
  });
  assert.equal(diagnostic(getter), null);
});
