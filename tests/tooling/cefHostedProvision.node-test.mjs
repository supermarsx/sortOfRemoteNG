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
  assertProvisionHost,
  childEnvironment,
  LINUX_INSTALLER_OBSERVER,
  provision,
  provisionPlan,
  verifyInstallerSignature,
} from "../../scripts/cef-hosted-provision.mjs";

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
