import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import YAML from "yaml";

const workflow = await fs.readFile(
  new URL(
    "../../.github/workflows/windows-arm-job-benign.yml",
    import.meta.url,
  ),
  "utf8",
);
const parsed = YAML.parse(workflow);
const step = parsed.jobs.benign.steps.find((s) => s.id === "benign");
const code = step.run
  .split("node --input-type=module <<'NODE'\n")[1]
  .split("\nNODE")[0];
const entry =
  "// Closed production entry; tests load definitions only.\ntry { await run(); } catch { process.exitCode = 1; console.error('ARM_BENIGN_DIAGNOSTIC_FAILED'); }";
assert(code.includes(entry));
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(code.replace(entry, "")).toString("base64")
);
const base = new URL("../../native/windows-job-benign/", import.meta.url);
// Text fixtures model canonical committed Git blobs, including Windows checkouts.
const profileBytes = Buffer.from(
  (
    await fs.readFile(
      new URL("windows-checkpoint-job-interface.json", base),
      "utf8",
    )
  ).replace(/\r\n/g, "\n"),
);
const profile = mod.profileFromBytes(profileBytes);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const environment = () => ({
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  CEF_DEFAULT_BRANCH: "main",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF:
    "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-job-benign.yml@refs/heads/main",
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "1",
  SystemRoot: "C:\Windows",
});

test("workflow has only fixed read authority and native ARM command, no producer/tool download", () => {
  assert.deepEqual(Object.keys(parsed.on), ["workflow_dispatch"]);
  assert.deepEqual(parsed.permissions, { contents: "read" });
  assert.equal(parsed.concurrency["cancel-in-progress"], true);
  assert.equal(parsed.jobs.benign["runs-on"], "windows-11-arm");
  assert.equal(parsed.jobs.benign["timeout-minutes"], 10);
  assert.match(parsed.jobs.benign.if, /github\.repository_id == '1010282954'/);
  assert.equal(parsed.jobs.benign.steps[0].with["persist-credentials"], false);
  assert(
    parsed.jobs.benign.steps
      .filter((s) => s.uses)
      .every((s) => /@[a-f0-9]{40}$/.test(s.uses)),
  );
  assert.match(
    step.run,
    /\['-I', '-B', path\.join\(deployment, NAMES\[1\]\), '--suite', '--execute'\]/,
  );
  assert(
    !/npm |npx |setup-python|WinTrust|downloadComponent|workflow_call/.test(
      workflow,
    ),
  );
  const clean = mod.childEnvironment(path.resolve("/owned"));
  assert.equal(clean.PATH, "C:/Windows/System32");
  assert.equal(clean.USERNAME, "owned-benign");
  for (const name of [
    "HOMEDRIVE",
    "HOMEPATH",
    "LOGONSERVER",
    "PATH",
    "SYSTEMDRIVE",
    "SystemRoot",
    "TEMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
  ])
    assert(Object.hasOwn(clean, name));
  assert(!Object.hasOwn(clean, "GH_TOKEN"));
  assert(!Object.hasOwn(clean, "PYTHONPATH"));
});

test("actual authority denies wrong host/repository/ref/head/workflow/event/run without leaking values", () => {
  assert.equal(
    mod.authority(environment(), "win32", "arm64").nativeTarget,
    "aarch64-pc-windows-msvc",
  );
  const changes = {
    GITHUB_ACTIONS: "false",
    RUNNER_ENVIRONMENT: "self-hosted",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "foreign/secret",
    GITHUB_REPOSITORY_ID: "2",
    GITHUB_REPOSITORY_VISIBILITY: "private",
    GITHUB_REF: "refs/heads/other",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "foreign/secret",
    GITHUB_SHA: "secret",
    GITHUB_RUN_ID: "0",
    GITHUB_RUN_ATTEMPT: "secret",
    SystemRoot: "secret",
    CEF_DEFAULT_BRANCH: "../secret",
  };
  for (const [key, value] of Object.entries(changes))
    assert.throws(
      () => mod.authority({ ...environment(), [key]: value }, "win32", "arm64"),
      (error) =>
        !error.message.includes("secret") && /ARM_/.test(error.message),
    );
  assert.throws(
    () => mod.authority(environment(), "win32", "x64"),
    /ARM_NATIVE_NODE/,
  );
  assert.throws(
    () => mod.authority(environment(), "linux", "arm64"),
    /ARM_NATIVE_NODE/,
  );
});

test("raw closed profile/PE guards reject replacement, malformed and emulated binaries", () => {
  assert.equal(
    profile.python.sha256,
    "46851212e3a4fc1846086dc9c7be10aeb156320b1f68dfbd86eafa56a4b0d8b4",
  );
  assert.equal(
    profile.pythonDll.sha256,
    "b9452ab50e10771663d35b5461f495fd11c293f46f2807add150ac2676653e53",
  );
  assert.equal(
    profile.ancestry.localActualReceiptSha256,
    "e005e5f264066f7f74360d91e57f448dc352a0d2e5a91909f5b75312ef0b4bb4",
  );
  assert.equal(sha(profileBytes), mod.PROFILE_SHA);
  assert.throws(
    () =>
      mod.profileFromBytes(
        Buffer.from(
          JSON.stringify({
            ...profile,
            python: { ...profile.python, path: "secret" },
          }),
        ),
      ),
    /ARM_PROFILE_PIN/,
  );
  const raw = Buffer.alloc(256);
  raw.write("MZ");
  raw.writeUInt32LE(64, 60);
  raw.writeUInt32LE(0x4550, 64);
  raw.writeUInt16LE(0xaa64, 68);
  raw.writeUInt16LE(0x20b, 88);
  mod.peArm64(raw);
  for (const machine of [0x8664, 0x14c, 0xa641, 0xa64e]) {
    const wrong = Buffer.from(raw);
    wrong.writeUInt16LE(machine, 68);
    assert.throws(() => mod.peArm64(wrong), /ARM_PE_NATIVE/);
  }
  raw.writeUInt32LE(0xffffffff, 60);
  assert.throws(() => mod.peArm64(raw), /ARM_PE_NATIVE/);
  assert.throws(() => mod.peArm64(Buffer.alloc(8)), /ARM_PE_DOS/);
});

test("committed Git blob source reader preserves LF bytes and stops dirty/mismatched checkouts", async () => {
  const data = {};
  for (const name of mod.NAMES)
    data[name] = await fs.readFile(new URL(name, base));
  const calls = [];
  const git = async (exe, args, options) => {
    calls.push(args);
    assert.equal(exe, "git");
    assert(options.windowsHide);
    if (args[0] === "rev-parse")
      return { stdout: Buffer.from("a".repeat(40) + "\n") };
    if (args[0] === "diff-index") return {};
    assert.equal(args[0], "cat-file");
    assert.equal(args[1], "blob");
    return { stdout: data[args[2].split("/").at(-1)] };
  };
  const result = await mod.gitSources("a".repeat(40), git, "/owned");
  assert.deepEqual(result, data);
  assert.equal(calls.length, 6);
  let count = 0;
  await assert.rejects(
    mod.gitSources("a".repeat(40), async (_exe, args) => {
      count++;
      if (args[0] === "rev-parse")
        return { stdout: Buffer.from("a".repeat(40)) };
      throw new Error("dirty");
    }),
    /dirty/,
  );
  assert.equal(count, 2);
  await assert.rejects(
    mod.gitSources("b".repeat(40), git),
    /ARM_CHECKOUT_HEAD/,
  );
});

test("held-byte reader hashes the actual handle bytes and denies links, hardlinks, size and mutation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arm-job-reader-"));
  try {
    const canonical = await fs.realpath(root),
      file = path.join(canonical, "record");
    await fs.writeFile(file, "whole");
    assert.equal((await mod.heldBytes(file, 5)).toString(), "whole");
    await assert.rejects(mod.heldBytes(file, 4), /ARM_FILE_BOUND/);
    const link = path.join(canonical, "linked");
    await fs.link(file, link);
    await assert.rejects(mod.heldBytes(file, 8), /ARM_FILE_BOUND/);
    await fs.unlink(link);
    const adapter = Object.create(fs);
    adapter.open = async (...args) => {
      const handle = await fs.open(...args);
      let reads = 0;
      return {
        stat: (...v) => handle.stat(...v),
        close: () => handle.close(),
        read: async (...v) => {
          const observed = await handle.read(...v);
          if (++reads === 1) await fs.appendFile(file, "!");
          return observed;
        },
      };
    };
    await assert.rejects(mod.heldBytes(file, 8, adapter), /ARM_FILE_CHANGED/);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Child extends EventEmitter {
  pid = 42;
  kills = 0;
  kill(signal) {
    assert.equal(signal, "SIGKILL");
    this.kills++;
    return true;
  }
}
test("owned supervisor preserves postspawn error, joins close and does not reset cleanup", async () => {
  const child = new Child(),
    promise = mod.supervise(child, 100, 80);
  child.emit("spawn");
  child.emit("error", new Error("secret"));
  child.emit("error", new Error("later"));
  let settled = false;
  promise.then(() => {
    settled = true;
  });
  await pause(5);
  assert.equal(settled, false);
  assert.equal(child.kills, 1);
  child.emit("close", 23, null);
  const result = await promise;
  assert.equal(result.joined, true);
  assert.equal(result.failure, "owned-child-error");
  assert.equal(result.code, 23);
});
test("owned supervisor bounds no-close expiry and separates failed spawn", async () => {
  const child = new Child(),
    started = performance.now(),
    pending = mod.supervise(child, 5, 15);
  child.emit("spawn");
  const result = await pending;
  assert.equal(result.failure, "host-deadline");
  assert.equal(result.joined, false);
  assert.equal(child.kills, 1);
  assert(performance.now() - started < 200);
  const missing = new Child();
  missing.pid = undefined;
  const noProcess = mod.supervise(missing, 100, 20);
  missing.emit("error", new Error("secret"));
  assert.equal((await noProcess).joined, true);
  assert.equal(missing.kills, 0);
});
test("artifact and source guard wiring rejects unconfirmed outcomes and retains original receipts", () => {
  assert.throws(
    () => mod.requireSuccess({}, {}, {}, profile, { joined: false }),
    /ARM_SUPERVISION_FAILED/,
  );
  assert.throws(
    () =>
      mod.requireSuccess(
        { success: true, childReaped: true, childExit: 0, elapsedMs: 300001 },
        {},
        {},
        profile,
        { joined: true, code: 0 },
      ),
    /ARM_OPERATION_FAILED/,
  );
  assert.match(code, /await pinnedTool\(profile\.python\)/);
  assert.match(code, /await pinnedTool\(profile\.pythonDll\)/);
  assert.match(
    code,
    /await publish\(path\.join\(root, 'bootstrap-result\.json'\), summary\)/,
  );
  assert.match(code, /flag: 'wx'/);
  assert.match(code, /visits <= 1000/);
  assert.match(code, /bytes <= 16 \* 1024 \*\* 2/);
  assert(!code.includes("process.kill("));
  assert(!code.includes("taskkill"));
  assert(!code.includes("GH_TOKEN"));
});

test("bounded artifact collector retains real empty logs and refuses outside case roots", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "arm-job-artifacts-"),
  );
  try {
    const root = await fs.realpath(temporary),
      artifacts = path.join(root, ".artifacts");
    await fs.mkdir(artifacts);
    const operation = path.join(
      artifacts,
      "windows-checkpoint-benign-00000000-0000-0000-0000-000000000000",
    );
    await fs.mkdir(operation);
    const cases = [];
    for (let index = 1; index <= 10; index++) {
      const own = path.join(
        artifacts,
        "windows-checkpoint-benign-" +
          String(index).padStart(8, "0") +
          "-0000-0000-0000-000000000000",
      );
      await fs.mkdir(own);
      await fs.writeFile(path.join(own, "empty.log"), "");
      cases.push({ root: own });
    }
    await fs.writeFile(
      path.join(operation, "actual-suite.json"),
      JSON.stringify({ cases }),
    );
    const result = await mod.collectOwned(root, operation, mod.NAMES);
    assert.equal(result.files.length, 11);
    assert.equal(result.files.filter((row) => row.bytes === 0).length, 10);
    cases[0].root = root;
    await fs.writeFile(
      path.join(operation, "actual-suite.json"),
      JSON.stringify({ cases }),
    );
    await assert.rejects(
      mod.collectOwned(root, operation, mod.NAMES),
      /ARM_ARTIFACT_SCOPE/,
    );
  } finally {
    await fs.rm(temporary, { recursive: true });
  }
});

test("held-byte reader denies real directory junction without reading its target", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "arm-job-link-"));
  try {
    const root = await fs.realpath(temporary),
      target = path.join(root, "target"),
      alias = path.join(root, "alias");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "sentinel"), "unchanged");
    await fs.symlink(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      mod.heldBytes(path.join(alias, "sentinel"), 20),
      /ARM_CANONICAL_PATH/,
    );
    assert.equal(
      await fs.readFile(path.join(target, "sentinel"), "utf8"),
      "unchanged",
    );
    await fs.unlink(alias);
  } finally {
    await fs.rm(temporary, { recursive: true });
  }
});

test("portable committed fixture pin is computed from canonical Git LF bytes", async () => {
  const fixture = (
    await fs.readFile(new URL("windows-checkpoint-job-benign.py", base), "utf8")
  ).replace(/\r\n/g, "\n");
  const driver = await fs.readFile(
    new URL("windows-checkpoint-job.py", base),
    "utf8",
  );
  assert(driver.includes("FIXTURE_SHA='" + sha(Buffer.from(fixture)) + "'"));
});
