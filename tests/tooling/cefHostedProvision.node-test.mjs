import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RECIPE } from "../../scripts/cef-hosted-bootstrap.mjs";
import {
  acquirePinned,
  prepareMacMetalToolchain,
  macMetalEnvironment,
  macMetalFingerprint,
  assertProvisionHost,
  childEnvironment,
  LINUX_INSTALLER_OBSERVER,
  provision,
  provisionPlan,
  verifyInstallerSignature,
} from "../../scripts/cef-hosted-provision.mjs";

// Exact a654 upstream install_packages body; all command effects are synthetic.
const PINNED_INSTALL_PACKAGES = {
  sha256: "640dcbcaf76f631d6a00ce00cc71b529d370c3417d9ba2cc12a9c1fd0f3d6614",
  body: 'def install_packages(options):\n    try:\n        packages = find_missing_packages(options)\n        if packages:\n            cmd = ["apt-get", "install"]\n            if options.no_prompt:\n                cmd = [\n                    "DEBIAN_FRONTEND=noninteractive",\n                    *cmd,\n                    "-qq",\n                    "--allow-downgrades",\n                    "--assume-yes",\n                ]\n            subprocess.check_call(["sudo", *cmd, *packages])\n            logger.info("")\n        else:\n            logger.info("No missing packages, and the packages are up to date.")\n\n    except subprocess.CalledProcessError as e:\n        # An apt-get exit status of 100 indicates that a real error has occurred.\n        logger.error("`apt-get --just-print install ...` failed")\n        if e.stdout is not None:\n            logger.error("It produced the following output:\\n")\n            logger.error(e.stdout.decode("utf-8"))\n        logger.error("You will have to install the above packages yourself.\\n")\n        sys.exit(100)',
};

test("actual installer body clones only the pinned no-prompt APT vector with finite transport policy", async () => {
  assert.equal(
    createHash("sha256").update(PINNED_INSTALL_PACKAGES.body).digest("hex"),
    PINNED_INSTALL_PACKAGES.sha256,
  );
  const script = String.raw`
import hashlib,json,runpy,subprocess,sys,threading,types
calls=[]
waits=[]
constructor_error=RuntimeError('private-constructor-error')
wait_error=RuntimeError('private-wait-error')
fail_constructor=False
fail_wait=False
class Base:
    def __init__(self,args,*rest,**kwargs):
        calls.append((args,rest,kwargs));self.pid=4242
        if fail_constructor:raise constructor_error
    def wait(self,*args,**kwargs):
        waits.append((args,kwargs))
        if fail_wait:raise wait_error
        return 23
subprocess.Popen=Base
prefix=['sudo','DEBIAN_FRONTEND=noninteractive','apt-get','install','-qq','--allow-downgrades','--assume-yes']
packages=['libprivate+fixture-dev','zstd','libfixture:amd64']
options=['-o','Acquire::http::Timeout=30','-o','Acquire::https::Timeout=30','-o','Acquire::Retries=0']
original=prefix+packages
original_copy=original[:]
env={'PRIVATE_FIXTURE':'never-emit-value'}
stdout=object();stderr=object();stdin=object()
def run_fixture(file,run_name):
    global fail_constructor,fail_wait,read_fixed
    assert file=='owned-inert-installer.py' and run_name=='__main__'
    assert sys.argv==['owned-inert-installer.py','--no-prompt']
    pinned=[]
    primary=dict(find_missing_packages=lambda options:packages,subprocess=types.SimpleNamespace(check_call=lambda args:pinned.append(args),CalledProcessError=subprocess.CalledProcessError),logger=types.SimpleNamespace(info=lambda *args:None,error=lambda *args:None),sys=sys)
    exec(compile(PRIMARY,'actual-a654-install-packages','exec'),primary)
    primary['install_packages'](types.SimpleNamespace(no_prompt=True))
    primary['install_packages'](types.SimpleNamespace(no_prompt=False))
    assert pinned==[original,['sudo','apt-get','install',*packages]]
    observed=subprocess.Popen
    assert isinstance(observed,type) and observed.__mro__[1]is Base
    child=observed(original,11,env=env,stdin=stdin,stdout=stdout,stderr=stderr,cwd='owned-fixed',close_fds=True)
    command,rest,kwargs=calls[-1]
    assert command==original[:3]+options+original[3:] and command is not original
    assert original==original_copy and rest==(11,)
    assert kwargs==dict(env=env,stdin=stdin,stdout=stdout,stderr=stderr,cwd='owned-fixed',close_fds=True)
    assert kwargs['env']is env and kwargs['stdout']is stdout and kwargs['stderr']is stderr
    assert child.wait(5,timeout=9)==23 and waits[-1]==((5,),{'timeout':9})
    negatives=[tuple(original), 'sudo apt-get install private',
      ['/usr/bin/sudo']+original[1:], original[:2]+['/usr/bin/apt-get']+original[3:],
      ['sudo','-n']+original[2:], ['sudo','OTHER=1']+original[2:],
      original[:4]+['--just-print']+original[4:], original[:4]+original[5:],
      original[:4]+['--assume-yes','--allow-downgrades','-qq']+packages,
      ['sudo','DEBIAN_FRONTEND=noninteractive','apt-get','update'],
      ['apt-get','install',*packages], prefix]
    for args in negatives:
        before=list(args)if isinstance(args,(list,tuple))else args
        instance=observed(args,env=env,stdout=stdout,stderr=stderr)
        assert calls[-1][0]is args and calls[-1][2]['env']is env
        assert (list(args)if isinstance(args,(list,tuple))else args)==before
        assert instance.wait(timeout=7)==23 and waits[-1]==((),{'timeout':7})
    fail_constructor=True
    try:observed(original)
    except BaseException as error:assert error is constructor_error
    else:raise AssertionError('constructor failure lost')
    fail_constructor=False;fail_wait=True
    pending=observed(['not-apt','private-value'])
    try:pending.wait(timeout=3)
    except BaseException as error:assert error is wait_error
    else:raise AssertionError('wait failure lost')
    fail_wait=False
    for thread in threading.enumerate():
        if thread.name=='sorng-apt-progress':thread.join(1);assert not thread.is_alive()
    fixed=read_fixed
    def fake(file,limit):
        if file.endswith('/comm'):return 'apt-get\n'
        if file.endswith('/status'):return 'State: S (sleeping)\n'
        if file.endswith('/io'):return None
        return ''
    read_fixed=fake
    row,children=process_progress(4242)
    assert row['io']=={} and row['ioAvailable']is False
    read_fixed=lambda file,limit:'rchar: 0\n'if file.endswith('/io')else fake(file,limit)
    row,children=process_progress(4242)
    assert row['io']=={'rchar':0} and row['ioAvailable']is True
    read_fixed=fixed
    assert _records<256
    for _ in range(300):emit(None,'ignored',0)
    assert _records<256
    print('bounded-transport-fixture-complete')
runpy.run_path=run_fixture
sys.argv=['observer','owned-inert-installer.py','--no-prompt']
`;
  const { stdout, stderr } = await promisify(execFile)(
    process.platform === "win32" ? "python.exe" : "python3",
    [
      "-I",
      "-B",
      "-c",
      script +
        "\nPRIMARY=" +
        JSON.stringify(PINNED_INSTALL_PACKAGES.body) +
        "\nexec(compile(" +
        JSON.stringify(LINUX_INSTALLER_OBSERVER) +
        ", 'actual-installer-observer', 'exec'))",
    ],
    { timeout: 10000, maxBuffer: 1024 ** 2 },
  );
  assert.equal(stdout.trim(), "bounded-transport-fixture-complete");
  assert.doesNotMatch(
    stderr,
    /libprivate|zstd|libfixture|never-emit|private-value|private-constructor|private-wait/,
  );
  const records = stderr
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line.slice("SORNG_PREREQUISITE_PHASE ".length)));
  const selected = records.filter(
    (row) => row.selectedHttpTimeoutSeconds !== undefined,
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].selectedHttpTimeoutSeconds, 30);
  assert.equal(selected[0].selectedHttpsTimeoutSeconds, 30);
  assert.equal(selected[0].selectedRetries, 0);
  assert.equal(selected[0].packageCount, 3);
  assert.equal(
    selected[0].packageSha256,
    createHash("sha256")
      .update(
        JSON.stringify(["libprivate+fixture-dev", "zstd", "libfixture:amd64"]),
      )
      .digest("hex"),
  );
  assert.equal(records[0].state, "started");
  assert.equal(records[1].state, "finished");
  assert.equal(records[1].exitCode, 23);
  assert(records.length < 256);
});

test("Linux phase observer executes original script and preserves failure without disclosing child arguments", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-linux-phases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, "installer.py");
  await writeFile(
    script,
    String.raw`
import subprocess, sys
assert sys.argv[1:] == ['--no-prompt', 'private-argument']
for extra in [['update'], ['--just-print', 'install'], ['install']]:
    # Python executes the synthetic child; no apt executable is launched.
    subprocess.check_output(['apt-get', '-c', 'print("child-result")', *extra, 'https://private.invalid/secret'], executable=sys.executable)
print('original-installer-output')
sys.exit(17)
`,
  );
  await assert.rejects(
    promisify(execFile)(
      process.platform === "win32" ? "python.exe" : "python3",
      [
        "-I",
        "-u",
        "-c",
        LINUX_INSTALLER_OBSERVER,
        script,
        "--no-prompt",
        "private-argument",
      ],
    ),
    (error) => {
      assert.equal(error.code, 17);
      assert.equal(error.stdout.trim(), "original-installer-output");
      assert.doesNotMatch(
        error.stderr,
        /private|secret|https:|--no-prompt|child-result/,
      );
      const rows = error.stderr
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          assert.ok(line.startsWith("SORNG_PREREQUISITE_PHASE "));
          return JSON.parse(line.slice("SORNG_PREREQUISITE_PHASE ".length));
        });
      assert.deepEqual(
        rows.map((row) => [row.phase, row.state, row.exitCode]),
        [
          ["apt-update", "started", null],
          ["apt-update", "finished", 0],
          ["apt-simulation", "started", null],
          ["apt-simulation", "finished", 0],
          ["apt-install", "started", null],
          ["apt-install", "finished", 0],
        ],
      );
      assert.ok(
        rows.every((row) => Number.isSafeInteger(row.pid) && row.pid > 0),
      );
      return true;
    },
  );
});

test("apt heartbeat arrives while a real child is pending and stops before its original failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-apt-heartbeat-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, "installer.py");
  const release = path.join(root, "release-child");
  await writeFile(
    script,
    String.raw`
import subprocess, sys, time, threading
code = '''import pathlib,time,sys
print("child-original", flush=True)
release = pathlib.Path(sys.argv[1])
deadline = time.monotonic() + 16
while not release.exists() and time.monotonic() < deadline:
    time.sleep(0.02)
sys.exit(23 if release.exists() else 24)
'''
try:
    subprocess.check_call(['apt-get', '-c', code, sys.argv[1], 'install', 'https://private.invalid/secret'], executable=sys.executable)
except subprocess.CalledProcessError as error:
    assert error.returncode == 23
    print('installer-original', flush=True)
    # A completed child must not retain its observer even if its installer lives.
    time.sleep(0.2)
    assert not any(thread.name == 'sorng-apt-progress' for thread in threading.enumerate())
    sys.exit(17)
`,
  );
  const completion = promisify(execFile)(
    process.platform === "win32" ? "python.exe" : "python3",
    ["-I", "-u", "-c", LINUX_INSTALLER_OBSERVER, script, release],
    { timeout: 20_000 },
  );
  let observedWhilePending = false;
  let releaseError;
  completion.child.stderr.on("data", (chunk) => {
    if (chunk.includes('"state":"progress"')) {
      observedWhilePending = completion.child.exitCode === null;
      void writeFile(release, "release").catch((error) => {
        releaseError = error;
      });
    }
  });
  await assert.rejects(completion, (error) => {
    assert.equal(error.code, 17);
    assert.deepEqual(error.stdout.trim().split(/\r?\n/), [
      "child-original",
      "installer-original",
    ]);
    assert.equal(observedWhilePending, true);
    assert.equal(releaseError, undefined);
    assert.doesNotMatch(error.stderr, /private|secret|https:|child-original/);
    const rows = error.stderr
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        assert.ok(line.startsWith("SORNG_PREREQUISITE_PHASE "));
        return JSON.parse(line.slice("SORNG_PREREQUISITE_PHASE ".length));
      });
    assert.deepEqual(
      rows.map((row) => row.state),
      ["started", "progress", "finished"],
    );
    assert.equal(rows.at(-1).exitCode, 23);
    const heartbeat = rows[1];
    assert.ok(Number.isSafeInteger(heartbeat.elapsedMs));
    assert.ok(heartbeat.elapsedMs >= 10_000);
    assert.ok(
      heartbeat.processes.length >= 1 && heartbeat.processes.length <= 32,
    );
    assert.equal(typeof heartbeat.processListTruncated, "boolean");
    for (const process of heartbeat.processes) {
      assert.deepEqual(Object.keys(process).sort(), [
        "io",
        "ioAvailable",
        "pid",
        "role",
        "state",
      ]);
      assert.ok(Number.isSafeInteger(process.pid) && process.pid > 0);
      assert.ok(
        [
          "sudo",
          "apt-get",
          "dpkg",
          "dpkg-deb",
          "http",
          "https",
          "gpgv",
          "debconf",
          "other",
        ].includes(process.role),
      );
      assert.ok(
        [
          "running",
          "sleeping",
          "disk-wait",
          "stopped",
          "zombie",
          "unknown",
        ].includes(process.state),
      );
      assert.equal(typeof process.ioAvailable, "boolean");
      if (!process.ioAvailable) assert.deepEqual(process.io, {});
      for (const [key, value] of Object.entries(process.io)) {
        assert.ok(
          [
            "rchar",
            "wchar",
            "read_bytes",
            "write_bytes",
            "syscr",
            "syscw",
          ].includes(key),
        );
        assert.ok(
          value === null || (Number.isSafeInteger(value) && value >= 0),
        );
      }
    }
    if (heartbeat.dpkg !== null) {
      assert.deepEqual(Object.keys(heartbeat.dpkg).sort(), [
        "action",
        "bytes",
        "modifiedMs",
      ]);
      assert.ok(
        [
          "startup",
          "status",
          "install",
          "upgrade",
          "configure",
          "unpack",
          "trigproc",
          "remove",
          "purge",
          "other",
        ].includes(heartbeat.dpkg.action),
      );
    }
    return true;
  });
});

test("Linux provisioning observes the pinned installer without changing arguments, deadline or failure status", async (t) => {
  const f = await sdkReceiptFixture(t);
  f.dependencies.platform = "linux";
  f.dependencies.architecture = "x64";
  f.dependencies.exec = async (exe, args, options) => {
    assert.equal(exe, "python3");
    assert.deepEqual(args.slice(0, 4), [
      "-I",
      "-u",
      "-c",
      LINUX_INSTALLER_OBSERVER,
    ]);
    assert.equal(path.basename(args[4]), "install-build-deps.py");
    assert.deepEqual(
      args.slice(5),
      RECIPE.provisioning.linuxDependencies.arguments,
    );
    assert.equal(options.timeout, 20 * 60_000);
    const error = new Error("private failure");
    error.code = 17;
    error.stderr = "fixed phase diagnostic";
    throw error;
  };
  await assert.rejects(
    provision(
      { target: "x86_64-unknown-linux-gnu", output: f.output, execute: true },
      f.env,
      f.dependencies,
    ),
    /install-linux-dependencies/,
  );
  const receipt = JSON.parse(
    await readFile(path.join(f.output, "provision.json"), "utf8"),
  );
  assert.equal(receipt.failure.exitCode, 17);
  assert.equal(receipt.completed, false);
  assert.equal(
    await readFile(path.join(f.output, "install-build-deps.py"), "utf8"),
    "inert test data, never executable",
  );
});

test("provision commands are exact fixed reviewed SDK features or pinned native Linux dependencies", () => {
  const windows = provisionPlan("x86_64-pc-windows-msvc", "win32", "x64");
  assert.equal(
    windows.installer.sha256,
    "e9f1bde566381355e594e2f90daf4f714eb5c7ef2c45c501ce236afe2abea300",
  );
  assert.deepEqual(windows.arguments, [
    "/quiet",
    "/norestart",
    "/ceip",
    "off",
    "/features",
    "OptionId.DesktopCPPx64",
    "OptionId.DesktopCPParm64",
    "OptionId.WindowsDesktopDebuggers",
  ]);
  const linux = provisionPlan("aarch64-unknown-linux-gnu", "linux", "arm64");
  assert.equal(
    linux.installer.sha256,
    "a71e5ed8e3cbcaf87b255ff124c424cda73b48bcb3fd6a4d44bed2de42c68f19",
  );
  assert.ok(linux.installer.url.includes(RECIPE.chromiumCommit));
  assert.deepEqual(linux.arguments, [
    "--no-prompt",
    "--no-syms",
    "--no-chromeos-fonts",
    "--no-arm",
    "--no-backwards-compatible",
  ]);
  const mac = provisionPlan("x86_64-apple-darwin", "darwin", "x64");
  assert.equal(mac.installer, null);
  assert.deepEqual(mac.arguments, []);
  assert.equal(windows.execute, false);
  assert.equal(windows.publicationAllowed, false);
  assert.throws(
    () => provisionPlan("aarch64-apple-darwin", "darwin", "x64"),
    /native target/,
  );
});

test("no local, private, self-hosted, or automatic install execution", async () => {
  const good = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
  assert.doesNotThrow(() => assertProvisionHost(good));
  for (const patch of [
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ])
    assert.throws(
      () => assertProvisionHost({ ...good, ...patch }),
      /explicit public/,
    );
  const target = RECIPE.targets.find(
    (row) =>
      row.platform === process.platform && row.architecture === process.arch,
  ).target;
  assert.equal((await provision({ target }, {})).execute, false);
  await assert.rejects(
    provision({ target, execute: true, output: "never-created" }, {}),
    /explicit public/,
  );
});

test("upstream installers receive no GitHub or Actions credentials", () => {
  assert.deepEqual(
    childEnvironment({
      PATH: "tools",
      SystemRoot: "windows",
      GH_TOKEN: "private",
      GITHUB_TOKEN: "private",
      ACTIONS_RUNTIME_TOKEN: "private",
      INPUT_SECRET: "private",
    }),
    { PATH: "tools", SystemRoot: "windows" },
  );
});

test("only exact Valid Microsoft signer and pinned product identity authorize SDK invocation", () => {
  const good = {
    status: "Valid",
    thumbprint: RECIPE.provisioning.windowsSdk.signerThumbprint,
    subject:
      "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
    productVersion: "10.1.28000.2270",
  };
  verifyInstallerSignature(good);
  for (const patch of [
    { status: "NotSigned" },
    { status: "UnknownError" },
    { thumbprint: "OTHER" },
    { subject: "Microsoft-like publisher" },
    { productVersion: "10.1.26100.0" },
  ])
    assert.throws(
      () => verifyInstallerSignature({ ...good, ...patch }),
      /identity mismatch/,
    );
});

test("downloaded bytes are bounded and hash-verified before any executable can be written", async () => {
  const data = Buffer.from("synthetic data, not executable");
  const pin = {
    url: "https://example.invalid/fixture",
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
  let options;
  assert.deepEqual(
    await acquirePinned(pin, async (_url, opts) => {
      options = opts;
      return new Response(data);
    }),
    data,
  );
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  await assert.rejects(
    acquirePinned(pin, async () => new Response(Buffer.from("changed"))),
    /identity mismatch/,
  );
  await assert.rejects(
    acquirePinned(pin, async () => new Response(Buffer.alloc(data.length + 1))),
    /exceeds/,
  );
  await assert.rejects(
    acquirePinned(pin, async () => new Response("failure", { status: 503 })),
    /download failed/,
  );
  assert.deepEqual(
    await acquirePinned(
      { ...pin, encoding: "base64" },
      async () => new Response(data.toString("base64")),
    ),
    data,
  );
});

async function sdkReceiptFixture(t, exitCode = 0) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-provision-mock-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "result");
  const calls = [];
  let observations = 0;
  const signature = {
    status: "Valid",
    thumbprint: RECIPE.provisioning.windowsSdk.signerThumbprint,
    subject:
      "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
    productVersion: RECIPE.provisioning.windowsSdk.productVersion,
  };
  // All command/download/observer dependencies are synthetic. The .exe bytes
  // below are inert text and are NEVER executed by these tests.
  const dependencies = {
    platform: "win32",
    architecture: "x64",
    acquire: async () => Buffer.from("inert test data, never executable"),
    nativeShell: async () => "synthetic-shell-never-launched",
    observe: async () => {
      observations++;
      return {
        availableGiB: 120,
        blockers: observations === 1 ? [] : ["synthetic post-install blocker"],
      };
    },
    exec: async (exe, args) => {
      calls.push({ exe, args });
      if (args.includes("-File"))
        return { stdout: JSON.stringify(signature), stderr: "" };
      if (exitCode) {
        const error = new Error("raw installer error");
        error.code = exitCode;
        error.stdout = "retained installation diagnostic";
        throw error;
      }
      return { stdout: "synthetic installation completed", stderr: "" };
    },
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    RUNNER_TEMP: root,
  };
  return { output, calls, dependencies, env, observations: () => observations };
}

test("completed provisioning retains actual post-install blockers and never claims build/publication readiness", async (t) => {
  const f = await sdkReceiptFixture(t);
  const receipt = await provision(
    { target: "x86_64-pc-windows-msvc", output: f.output, execute: true },
    f.env,
    f.dependencies,
  );
  assert.equal(receipt.completed, true);
  assert.deepEqual(receipt.blockers, ["synthetic post-install blocker"]);
  assert.equal(receipt.publicationAllowed, false);
  assert.equal(receipt.engineBuildAttempted, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.observations(), 2);
  assert.ok(f.calls[1].args.includes("/norestart"));
  assert.equal(
    JSON.parse(await readFile(path.join(f.output, "provision.json"), "utf8"))
      .completed,
    true,
  );
});

test("Linux adds the reviewed PipeWire and X11/XCB development packages after the pinned installer and before inventory", async (t) => {
  const f = await sdkReceiptFixture(t);
  const calls = [];
  const order = [];
  const receipt = await provision(
    { target: "x86_64-unknown-linux-gnu", output: f.output, execute: true },
    f.env,
    {
      ...f.dependencies,
      platform: "linux",
      observe: async (...args) => {
        order.push("observe");
        return f.dependencies.observe(...args);
      },
      exec: async (exe, args, options) => {
        order.push(exe);
        calls.push({ exe, args, timeout: options.timeout });
        return { stdout: "synthetic success", stderr: "" };
      },
    },
  );
  assert.equal(calls[0].exe, "python3");
  assert.ok(calls[0].args.includes(LINUX_INSTALLER_OBSERVER));
  assert.equal(calls[0].timeout, 20 * 60_000);
  assert.deepEqual(calls[0].args.slice(0, 4), [
    "-I",
    "-u",
    "-c",
    LINUX_INSTALLER_OBSERVER,
  ]);
  assert.deepEqual(calls[0].args.slice(5), [
    "--no-prompt",
    "--no-syms",
    "--no-chromeos-fonts",
    "--no-arm",
    "--no-backwards-compatible",
  ]);
  assert.deepEqual(calls[1], {
    exe: "sudo",
    args: [
      "-n",
      "apt-get",
      "-y",
      "--no-install-recommends",
      "install",
      "libpipewire-0.3-dev",
      "libx11-xcb-dev",
    ],
    timeout: 10 * 60_000,
  });
  assert.equal(calls[2].exe, "dpkg-query");
  assert.equal(calls.length, 3);
  assert.equal(f.observations(), 2);
  assert.deepEqual(order, [
    "observe",
    "python3",
    "sudo",
    "dpkg-query",
    "observe",
  ]);
  assert.equal(receipt.completed, true);
  assert.deepEqual(
    receipt.stages.map((stage) => stage.stage),
    [
      "install-linux-dependencies",
      "install-linux-supplemental-packages",
      "installed-packages",
    ],
  );
});

for (const failedExecutable of ["python3", "sudo"])
  test(`Linux prerequisite failure at ${failedExecutable} prevents later commands and post-install confirmation`, async (t) => {
    const f = await sdkReceiptFixture(t);
    const calls = [];
    await assert.rejects(
      provision(
        { target: "x86_64-unknown-linux-gnu", output: f.output, execute: true },
        f.env,
        {
          ...f.dependencies,
          platform: "linux",
          exec: async (exe) => {
            calls.push(exe);
            if (exe === failedExecutable) {
              const error = new Error("synthetic install failure");
              error.code = 17;
              throw error;
            }
            return { stdout: "synthetic success", stderr: "" };
          },
        },
      ),
      /install-linux-/,
    );
    assert.deepEqual(
      calls,
      failedExecutable === "python3" ? ["python3"] : ["python3", "sudo"],
    );
    assert.equal(f.observations(), 1);
    const receipt = JSON.parse(
      await readFile(path.join(f.output, "provision.json"), "utf8"),
    );
    assert.equal(receipt.completed, false);
    assert.equal(receipt.failure.exitCode, 17);
  });

test("Linux capacity guard prevents both pinned and supplemental installers", async (t) => {
  const f = await sdkReceiptFixture(t);
  let acquired = false;
  await assert.rejects(
    provision(
      { target: "x86_64-unknown-linux-gnu", output: f.output, execute: true },
      f.env,
      {
        ...f.dependencies,
        platform: "linux",
        observe: async () => ({ availableGiB: 99, blockers: [] }),
        acquire: async () => {
          acquired = true;
          throw new Error("must not download");
        },
      },
    ),
    /reviewed disk minimum/,
  );
  assert.equal(acquired, false);
  assert.equal(f.calls.length, 0);
});

test("provision rejects output outside the canonical runner workspace before commands or observations", async (t) => {
  const f = await sdkReceiptFixture(t);
  await assert.rejects(
    provision(
      {
        target: "x86_64-pc-windows-msvc",
        output: path.join(f.env.RUNNER_TEMP, "..", "outside-result"),
        execute: true,
      },
      f.env,
      f.dependencies,
    ),
    /beneath the ephemeral workspace/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.observations(), 0);
});

test("installer exit3010 explicitly reports reboot required without retrying, rebooting or claiming confirmation", async (t) => {
  const f = await sdkReceiptFixture(t, 3010);
  await assert.rejects(
    provision(
      { target: "x86_64-pc-windows-msvc", output: f.output, execute: true },
      f.env,
      f.dependencies,
    ),
    /install-sdk/,
  );
  const receipt = JSON.parse(
    await readFile(path.join(f.output, "provision.json"), "utf8"),
  );
  assert.equal(receipt.completed, false);
  assert.equal(receipt.rebootRequired, true);
  assert.equal(receipt.failure.exitCode, 3010);
  assert.equal(receipt.failure.stage, "install-sdk");
  assert.equal(f.calls.length, 2);
  assert.equal(f.observations(), 1);
  assert.equal(receipt.blockers, undefined);
  assert.equal(
    await readFile(path.join(f.output, "install-sdk.log"), "utf8"),
    "retained installation diagnostic\n",
  );
});

function metalFixture(patch = {}) {
  const selected = {
    DEVELOPER_DIR: "/Applications/Xcode_26.3.app/Contents/Developer",
    SDKROOT:
      "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.2.sdk",
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    HOME: "/Users/runner",
    TMPDIR: "/private/tmp/owned/",
    GH_TOKEN: "do-not-inherit",
    GITHUB_TOKEN: "do-not-inherit",
    AWS_SECRET_ACCESS_KEY: "do-not-inherit",
    SSH_AUTH_SOCK: "do-not-inherit",
    TOOLCHAINS: "foreign",
    DYLD_INSERT_LIBRARIES: "foreign",
  };
  const calls = [];
  let missing = patch.missing ?? false;
  let time = 0;
  const rolePath = (role) =>
    `/private/var/run/Apple-component/Metal.xctoolchain/usr/bin/${role}`;
  const exec = async (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.deepEqual(Object.keys(options.env).sort(), [
      "DEVELOPER_DIR",
      "HOME",
      "PATH",
      "SDKROOT",
      "TMPDIR",
    ]);
    assert.equal(options.env.DEVELOPER_DIR, selected.DEVELOPER_DIR);
    assert.ok(options.timeout > 0 && options.timeout <= 600_000);
    assert.equal(options.maxBuffer, 65536);
    if (patch.advance) time += patch.advance;
    if (patch.failure)
      throw Object.assign(new Error("private origin/password"), {
        stderr: "private origin/password",
      });
    if (executable === "/usr/bin/xcodebuild") {
      assert.deepEqual(args, ["-downloadComponent", "MetalToolchain"]);
      missing = false;
      return { stdout: "", stderr: "" };
    }
    if (executable === "/usr/bin/codesign") {
      assert.deepEqual(args.slice(0, -1), [
        "--verify",
        "--strict",
        "--all-architectures",
        "-R=anchor apple",
      ]);
      if (patch.signingFailure) throw Error("private path/signing stderr");
      return {};
    }
    assert.equal(executable, "/usr/bin/xcrun");
    assert.equal(args[0], "--no-cache");
    assert.equal(args.filter((value) => value === "--no-cache").length, 1);
    if (args.includes("--find"))
      return { stdout: patch.path ?? rolePath(args.at(-1)) };
    assert.ok(
      !args.includes("metallib") || !args.includes("--version"),
      "no invented metallib version command",
    );
    if (missing)
      throw Object.assign(new Error("missing"), {
        stderr: "cannot execute tool 'metal' due to missing Metal Toolchain",
      });
    return { stdout: "Apple metal version 32023.104\n" };
  };
  let reads = 0;
  return {
    selected,
    env,
    calls,
    dependencies: {
      exec,
      now: () => time,
      realpath: async (file) => file,
      measure: async (file) => {
        reads++;
        return {
          physicalPath: file,
          bytes: 4096,
          sha256:
            patch.mutation && reads === 2 ? "b".repeat(64) : "a".repeat(64),
        };
      },
    },
  };
}

test("selected Mac prerequisite observes external Apple Metal without selecting global Xcode", async () => {
  const f = metalFixture();
  const result = await prepareMacMetalToolchain(
    { ...f, platform: "darwin" },
    f.dependencies,
  );
  assert.equal(result.downloaded, false);
  assert.equal(result.tools[1].version, null);
  assert.equal(result.tools[1].versionSource, "not-observed");
  assert.equal(result.tools[1].pairedCompilerVersion, result.tools[0].version);
  assert.equal(result.componentResourceClosureVerified, false);
  assert.equal(
    result.provenance,
    "newly-observed-apple-component-not-prepinned",
  );
  assert.ok(
    result.tools.every(
      (tool) =>
        tool.location === "external-metal-toolchain" &&
        tool.appleAnchorVerified,
    ),
  );
  assert.ok(f.calls.every((call) => call.executable !== "/usr/bin/xcodebuild"));
  assert.equal(
    f.calls.filter((call) => call.executable === "/usr/bin/codesign").length,
    2,
  );
  const firstVersion = f.calls.findIndex((call) =>
    call.args.includes("--version"),
  );
  const firstSignature = f.calls.findIndex(
    (call) => call.executable === "/usr/bin/codesign",
  );
  assert.ok(
    firstSignature >= 0 && firstSignature < firstVersion,
    "signing must precede any compiler execution",
  );
});

test("missing Metal is installed only by the fixed reviewed hosted component command", async () => {
  const f = metalFixture({ missing: true });
  const result = await prepareMacMetalToolchain(
    { ...f, platform: "darwin", allowDownload: true },
    f.dependencies,
  );
  assert.equal(result.downloaded, true);
  assert.equal(
    f.calls.filter((call) => call.executable === "/usr/bin/xcodebuild").length,
    1,
  );
  assert.equal(result.tools.length, 2);
  const forbidden = metalFixture({ missing: true });
  await assert.rejects(
    prepareMacMetalToolchain(
      { ...forbidden, platform: "darwin" },
      forbidden.dependencies,
    ),
    /MAC_METAL_PROBE_FAILED/,
  );
  assert.ok(
    forbidden.calls.every((call) => call.executable !== "/usr/bin/xcodebuild"),
  );
});

test("foreign tools, invalid signing, mutable bytes and expired budgets fail without private errors", async () => {
  for (const [patch, reason] of [
    [{ path: "/tmp/foreign/metal" }, "MAC_METAL_RESOLVED_PATH"],
    [{ signingFailure: true }, "MAC_METAL_COMMAND_FAILED"],
    [{ mutation: true }, "MAC_METAL_FILE_CHANGED"],
    [{ advance: 1001 }, "MAC_METAL_DEADLINE"],
    [{ failure: true }, "MAC_METAL_COMMAND_FAILED"],
  ]) {
    const f = metalFixture(patch);
    await assert.rejects(
      prepareMacMetalToolchain(
        { ...f, platform: "darwin", remainingMilliseconds: () => 1000 },
        f.dependencies,
      ),
      (error) =>
        error.message === reason &&
        !JSON.stringify(error).includes("private origin"),
    );
    assert.ok(
      f.calls.every((call) => call.executable !== "/usr/bin/xcodebuild"),
    );
  }
});

test("non-Mac paths have no tool side effects; selected env and hosted policy cannot inherit tokens", async () => {
  const f = metalFixture();
  assert.equal(
    await prepareMacMetalToolchain({ platform: "linux" }, f.dependencies),
    null,
  );
  assert.equal(
    await prepareMacMetalToolchain({ platform: "win32" }, f.dependencies),
    null,
  );
  assert.equal(f.calls.length, 0);
  assert.throws(
    () =>
      macMetalEnvironment({ ...f.selected, DEVELOPER_DIR: "relative" }, f.env),
    /SELECTED_ENV/,
  );
  await assert.rejects(
    prepareMacMetalToolchain(
      {
        ...f,
        platform: "darwin",
        allowDownload: true,
        env: { ...f.env, GITHUB_EVENT_NAME: "pull_request" },
      },
      f.dependencies,
    ),
    /MAC_METAL_UNAVAILABLE/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    provisionPlan("x86_64-apple-darwin", "darwin", "x64")
      .supplementalPrerequisite.prepared,
    false,
  );
});

test("stable Metal fingerprint excludes mount spelling but changes for tool bytes/version/signing", async () => {
  const f = metalFixture();
  const observation = await prepareMacMetalToolchain(
    { ...f, platform: "darwin" },
    f.dependencies,
  );
  const stable = macMetalFingerprint(observation);
  const moved = structuredClone(observation);
  moved.tools[0].physicalPath =
    "/another/Apple/Metal.xctoolchain/usr/bin/metal";
  assert.deepEqual(macMetalFingerprint(moved), stable);
  for (const field of ["sha256", "version", "bytes"]) {
    const changed = structuredClone(observation);
    changed.tools[0][field] =
      field === "sha256" ? "b".repeat(64) : field === "version" ? "999" : 8192;
    if (field === "version")
      changed.tools[1].pairedCompilerVersion = changed.tools[0].version;
    assert.notDeepEqual(macMetalFingerprint(changed), stable);
  }
  const mismatch = structuredClone(observation);
  mismatch.tools[1].pairedCompilerVersion = "999";
  assert.throws(() => macMetalFingerprint(mismatch), /MAC_METAL_OBSERVATION/);
  const unsigned = structuredClone(observation);
  unsigned.tools[0].appleAnchorVerified = false;
  assert.throws(() => macMetalFingerprint(unsigned), /MAC_METAL_OBSERVATION/);
});

function metallibAliasFixture({ bundled = false } = {}) {
  const f = metalFixture();
  const bin = bundled
    ? `${f.selected.DEVELOPER_DIR}/Toolchains/XcodeDefault.xctoolchain/usr/bin`
    : "/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/058e-observed/Metal.xctoolchain/usr/bin";
  const original = f.dependencies.exec;
  f.dependencies.exec = async (executable, args, options) => {
    const result = await original(executable, args, options);
    return executable === "/usr/bin/xcrun" && args.includes("--find")
      ? { stdout: `${bin}/${args.at(-1)}` }
      : result;
  };
  f.dependencies.realpath = async (value) =>
    value === `${bin}/metallib` ? `${bin}/air-lld` : value;
  return { ...f, bin };
}
test("observed metallib to air-lld alias retains physical Apple signature and paired version in same component", async () => {
  for (const bundled of [false, true]) {
    const f = metallibAliasFixture({ bundled });
    const result = await prepareMacMetalToolchain(
      { ...f, platform: "darwin" },
      f.dependencies,
    );
    assert.equal(result.tools[1].physicalPath, `${f.bin}/air-lld`);
    assert.equal(result.tools[1].role, "metallib");
    assert.equal(result.tools[1].version, null);
    assert.equal(
      result.tools[1].pairedCompilerVersion,
      result.tools[0].version,
    );
    assert.equal(result.tools[1].appleAnchorVerified, true);
    assert(
      f.calls.some(
        (c) =>
          c.executable === "/usr/bin/codesign" &&
          c.args.at(-1) === `${f.bin}/air-lld`,
      ),
    );
    assert(f.calls.every((c) => c.executable !== "/usr/bin/xcodebuild"));
    assert.equal(result.componentResourceClosureVerified, false);
  }
});
test("metallib alias denies unknown target cross-component invalid signature and retarget without download", async () => {
  for (const fault of [
    "unknown",
    "cross-root",
    "signature",
    "retarget",
    "metal-role",
    "direct-air-lld",
  ]) {
    const f = metallibAliasFixture();
    const originalRealpath = f.dependencies.realpath,
      originalExec = f.dependencies.exec;
    let resolves = 0;
    f.dependencies.realpath = async (value) => {
      if (fault === "metal-role" && value === `${f.bin}/metal`)
        return `${f.bin}/air-lld`;
      if (value === `${f.bin}/metallib`) {
        resolves++;
        if (fault === "unknown") return `${f.bin}/other-lld`;
        if (fault === "cross-root")
          return "/private/foreign/Metal.xctoolchain/usr/bin/air-lld";
        if (fault === "retarget" && resolves > 1) return `${f.bin}/changed-lld`;
      }
      return originalRealpath(value);
    };
    f.dependencies.exec = async (executable, args, options) => {
      if (
        fault === "signature" &&
        executable === "/usr/bin/codesign" &&
        args.at(-1) === `${f.bin}/air-lld`
      )
        throw Error("private-signature-failure");
      const result = await originalExec(executable, args, options);
      return fault === "direct-air-lld" &&
        args.includes("--find") &&
        args.at(-1) === "metallib"
        ? { stdout: `${f.bin}/air-lld` }
        : result;
    };
    const expected = {
      unknown: "MAC_METAL_RESOLVED_PATH",
      "cross-root": "MAC_METAL_COMPONENT_DRIFT",
      signature: "MAC_METAL_COMMAND_FAILED",
      retarget: "MAC_METAL_FILE_CHANGED",
      "metal-role": "MAC_METAL_RESOLVED_PATH",
      "direct-air-lld": "MAC_METAL_RESOLVED_PATH",
    }[fault];
    await assert.rejects(
      prepareMacMetalToolchain(
        { ...f, platform: "darwin", allowDownload: true },
        f.dependencies,
      ),
      (e) => e.message === expected,
    );
    assert(f.calls.every((c) => c.executable !== "/usr/bin/xcodebuild"));
  }
});

test("selected Metal lookup and revalidation use exactly one documented no-cache flag without changing other command authority", async () => {
  const f = metalFixture();
  const result = await prepareMacMetalToolchain(
    { ...f, platform: "darwin", remainingMilliseconds: () => 12345 },
    f.dependencies,
  );
  const query = f.calls.filter((call) => call.executable === "/usr/bin/xcrun");
  assert.deepEqual(
    query.map((call) => call.args),
    [
      ["--no-cache", "--find", "metal"],
      ["--no-cache", "metal", "--version"],
      ["--no-cache", "--find", "metal"],
      ["--no-cache", "--find", "metallib"],
      ["--no-cache", "--find", "metallib"],
    ],
  );
  for (const call of f.calls) {
    assert.equal(call.options.timeout, 12345);
    assert.equal(call.options.maxBuffer, 65536);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.env.HOME, f.env.HOME);
    assert.equal(call.options.env.TMPDIR, f.env.TMPDIR);
    assert.equal(call.options.env.xcrun_nocache, undefined);
    if (call.executable !== "/usr/bin/xcrun")
      assert(!call.args.includes("--no-cache"));
  }
  assert.equal(result.componentResourceClosureVerified, false);
  assert.equal(result.nativeCompatibilityVerified, false);
  assert.equal(macMetalFingerprint(result).tools.length, 2);
});

test("selected Metal SDK environment overrides foreign ambient values and invalid selected roots deny before commands", async () => {
  const f = metalFixture();
  f.env.SDKROOT = "/foreign/ambient.sdk";
  f.env.DEVELOPER_DIR = "/foreign/Contents/Developer";
  const execute = f.dependencies.exec;
  f.dependencies.exec = async (file, args, options) => {
    assert.equal(options.env.SDKROOT, f.selected.SDKROOT);
    assert.equal(options.env.DEVELOPER_DIR, f.selected.DEVELOPER_DIR);
    assert(!args.includes("--sdk"));
    assert(!args.includes("macosx"));
    return execute(file, args, options);
  };
  await prepareMacMetalToolchain({ ...f, platform: "darwin" }, f.dependencies);
  assert.equal(
    f.calls.filter((c) => c.executable === "/usr/bin/xcrun").length,
    5,
  );
  for (const key of ["SDKROOT", "DEVELOPER_DIR"])
    for (const value of [
      undefined,
      null,
      true,
      17,
      "macosx",
      "relative.sdk",
      "/invalid\0path",
      "/" + "x".repeat(2048),
    ]) {
      const denied = metalFixture();
      denied.selected[key] = value;
      await assert.rejects(
        prepareMacMetalToolchain(
          { ...denied, platform: "darwin" },
          denied.dependencies,
        ),
        /MAC_METAL_SELECTED_ENV/,
      );
      assert.deepEqual(denied.calls, []);
    }
});
