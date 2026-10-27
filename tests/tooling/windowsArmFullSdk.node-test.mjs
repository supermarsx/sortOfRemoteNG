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
import { constants as fsConstants } from "node:fs";
import {
  identitySha256,
  validateSourceLock,
  prepareSourceGitIsolation,
  sourceGitEnvironment,
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
  reviewedHostClosure,
  verifyHostClosure,
  bootstrapProgram,
  prepareBootstrap,
  verifyBootstrap,
  bootstrapShim,
  deriveBootstrapSetup,
  bindBootstrapVector,
  gitPolicyMetadata,
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
const rawWorkflow = await read(workflowPath);
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
      start = body.indexOf("  const checked = async (action) => {"),
      end = body.indexOf("\n  try {\n    await sourceStage", start);
    const checked = vm.runInNewContext(
      `(async()=>{${body.slice(start, end)};return checked})()`,
      {
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
