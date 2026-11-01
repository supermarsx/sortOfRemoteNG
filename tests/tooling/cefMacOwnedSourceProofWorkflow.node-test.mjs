import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const root = new URL("../../", import.meta.url);
const workflow = YAML.parse(
  await readFile(
    new URL(".github/workflows/cef-mac-owned-source-proof.yml", root),
    "utf8",
  ),
);
const step = workflow.jobs.proof.steps.find((row) => row.id === "proof");
const code = step.run
  .split("node --input-type=module <<'NODE'\n")[1]
  .split("\nNODE")[0];
const entry =
  "try { await runOwnedSourceProof(); } catch { console.error('OWNED_DARWIN_PROOF_FAILED'); process.exitCode = 1; }";
assert(code.includes(entry));
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(code.replace(entry, "")).toString("base64")
);
const env = () => ({
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  CEF_DEFAULT_BRANCH: "main",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF:
    "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-owned-source-proof.yml@refs/heads/main",
  ImageOS: "macos15",
  ImageVersion: "20260824.0482.1",
  RUNNER_TEMP: "/owned-temp",
  GITHUB_WORKSPACE: "/checkout",
});

test("proof uses only the intended reviewed Intel Mac ARM cross-build host and no compiler or Metal prerequisite", async () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.proof["runs-on"], "macos-15-intel");
  assert.equal(workflow.jobs.proof["timeout-minutes"], 5);
  assert.equal(step["timeout-minutes"], 3);
  assert.equal(workflow.jobs.proof.steps[0].with["persist-credentials"], false);
  assert(
    workflow.jobs.proof.steps
      .filter((row) => row.uses)
      .every((row) => /@[a-f0-9]{40}$/.test(row.uses)),
  );
  const folder =
    "native/cef-build-inputs/20261025-r5-owned-http3-macarm-sdk26-2-capture-compat/";
  const map = JSON.parse(
    await readFile(
      new URL(folder + "cef-ci-runner-aarch64-apple-darwin.json", root),
      "utf8",
    ),
  );
  const lock = JSON.parse(
    await readFile(
      new URL(folder + "tools/aarch64-apple-darwin.json", root),
      "utf8",
    ),
  );
  assert.equal(map.hosted.architecture, "x64");
  assert.equal(map.hosted.imageVersion, env().ImageVersion);
  assert.equal(map.target, "aarch64-apple-darwin");
  assert.equal(map.hosted.acceptanceRunner, "macos-15");
  const pin = lock.files.find((row) => row.path === map.python);
  assert.deepEqual(
    { path: mod.PYTHON, sha: mod.PYTHON_SHA, bytes: mod.PYTHON_BYTES },
    { path: "/" + pin.path, sha: pin.sha256, bytes: pin.size },
  );
  assert.doesNotMatch(
    code,
    /xcrun|xcodebuild|cef-hosted-provision|cef-engineering-checkpoint|npm |fetch\(|curl|wget/,
  );
  assert.match(
    code,
    /timeout: 120000, maxBuffer: 65536, killSignal: 'SIGKILL'/,
  );
  assert.match(
    code,
    /\['-I', '-B', 'tests\/fixtures\/cef\/mac_owned_source_proof.py', '--output', output\]/,
  );
  assert.equal(
    workflow.jobs.proof.steps.at(-1).with.path,
    "${{ steps.proof.outputs.root }}/proof.json",
  );
});

test("actual authority rejects foreign source, event, host, image and repository before native execution", () => {
  assert.doesNotThrow(() => mod.authority(env(), "darwin", "x64"));
  for (const patch of [
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/other" },
    { CEF_DEFAULT_BRANCH: "other" },
    { GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_REPOSITORY_ID: "1" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_SHA: "bad" },
    { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
    { GITHUB_WORKFLOW_REF: "foreign" },
    { ImageOS: "macos14" },
    { ImageVersion: "future" },
  ])
    assert.throws(
      () => mod.authority({ ...env(), ...patch }, "darwin", "x64"),
      /OWNED_PROOF_/,
    );
  assert.throws(() => mod.authority(env(), "linux", "x64"), /HOST/);
  assert.throws(() => mod.authority(env(), "darwin", "arm64"), /HOST/);
});

test("actual child environment excludes credentials and inherited tool overrides", () => {
  const child = mod.childEnvironment({
    ...env(),
    GH_TOKEN: "secret",
    GITHUB_TOKEN: "secret",
    ACTIONS_RUNTIME_TOKEN: "secret",
    PYTHONPATH: "private",
    NODE_OPTIONS: "private",
    DEVELOPER_DIR: "private",
    SDKROOT: "private",
    PATH: "private",
  });
  assert.equal(child.PATH, "/usr/bin:/bin");
  assert.equal(child.RUNNER_TEMP, "/owned-temp");
  assert(!JSON.stringify(child).includes("private"));
  assert(!JSON.stringify(child).includes("secret"));
});

function fixture(raw = Buffer.from("owned")) {
  let closed = 0,
    opened = 0,
    calls = 0;
  const info = {
    dev: 1n,
    ino: 2n,
    mode: 0o100600n,
    nlink: 1n,
    size: BigInt(raw.length),
    mtimeNs: 3n,
    ctimeNs: 4n,
    uid: 5n,
    gid: 5n,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const handle = {
    stat: async () => info,
    read: async (buffer, offset, length, position) => {
      calls++;
      const bytesRead = raw.copy(buffer, offset, position, position + length);
      return { bytesRead };
    },
    close: async () => {
      closed++;
    },
  };
  const io = {
    lstat: async () => info,
    realpath: async (p) => p,
    open: async () => {
      opened++;
      return handle;
    },
  };
  return { raw, info, handle, io, counts: () => ({ opened, closed, calls }) };
}

test("held input reader retains exact bytes with a hard cap and closes the descriptor", async () => {
  const f = fixture();
  assert.deepEqual(await mod.heldBytes("/owned", 5, f.io), f.raw);
  assert.deepEqual(f.counts(), { opened: 1, closed: 1, calls: 2 });
  for (const patch of [
    { size: 6n },
    { size: 0n },
    { isFile: () => false },
    { isSymbolicLink: () => true },
  ]) {
    const bad = fixture();
    Object.assign(bad.info, patch);
    await assert.rejects(mod.heldBytes("/owned", 5, bad.io), /FILE/);
    assert.equal(bad.counts().opened, 0);
  }
  const alias = fixture();
  alias.io.realpath = async () => "/elsewhere";
  await assert.rejects(mod.heldBytes("/owned", 5, alias.io), /ALIAS/);
  assert.equal(alias.counts().opened, 0);
});

test("held reader denies changed identities and file growth without unbounded allocation", async () => {
  const changed = fixture();
  changed.handle.stat = async () => ({ ...changed.info, ino: 99n });
  await assert.rejects(mod.heldBytes("/owned", 5, changed.io), /IDENTITY/);
  assert.equal(changed.counts().closed, 1);
  const growth = fixture(Buffer.from("owned+"));
  growth.info.size = 5n;
  await assert.rejects(mod.heldBytes("/owned", 5, growth.io), /BYTES/);
  assert.equal(growth.counts().closed, 1);
  const after = fixture();
  let reads = 0;
  after.handle.stat = async () =>
    ++reads === 1 ? after.info : { ...after.info, ctimeNs: 99n };
  await assert.rejects(mod.heldBytes("/owned", 5, after.io), /CHANGED/);
  assert.equal(after.counts().closed, 1);
});

test("held reader preserves first failure when close also fails and propagates close-only failure", async () => {
  const f = fixture(),
    primary = new Error("primary"),
    secondary = new Error("secondary");
  f.handle.read = async () => {
    throw primary;
  };
  f.handle.close = async () => {
    throw secondary;
  };
  await assert.rejects(
    mod.heldBytes("/owned", 5, f.io),
    (error) => error === primary,
  );
  const close = fixture();
  close.handle.close = async () => {
    throw secondary;
  };
  await assert.rejects(
    mod.heldBytes("/owned", 5, close.io),
    (error) => error === secondary,
  );
});

test("same-sized changed Python bytes cannot pass the exact reviewed interpreter pin", async () => {
  const f = fixture(Buffer.alloc(mod.PYTHON_BYTES));
  await assert.rejects(mod.verifyPython(f.io), /PYTHON_PIN/);
  assert.equal(f.counts().closed, 1);
});

test("actual proof selector requires all native cases, cleanup and the ARM codec roundtrip", () => {
  const report = {
    complete: true,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    targetArchitecture: "arm64",
    image: "20260824.0482.1",
    sourceLockReference:
      "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    cleanupConfirmed: true,
    publicAdmissionDeniedBefore: true,
    publicAdmissionDisabledAfter: true,
    capability: {
      complete: true,
      cleanupConfirmed: true,
      objectsRemoved: true,
      handlesClosed: true,
      rows: ["file", "directory", "root", "symlink"].flatMap((role) =>
        ["no-op", "past", "future"].map((item) => ({
          role,
          case: item,
          exactMtimeReadback: true,
          symlinkTargetUnchanged: true,
          birthTransition: {
            kind: "owned-utime-birth-observation",
            before: ["darwin-birthtime-float-hex", "0x1.0p+30"],
            after: ["darwin-birthtime-float-hex", "0x1.0p+30"],
            changed: false,
          },
        })),
      ),
    },
    roundtrip: {
      sidecarKind: "sorng-macarm-source-metadata",
      complete: true,
      recorded: true,
      driftDetected: true,
      applied: true,
      verified: true,
      sidecarUnchanged: true,
      noLinuxStatCache: true,
      cleanupConfirmed: true,
    },
  };
  assert.doesNotThrow(() => mod.validateReport(report));
  for (const mutate of [
    (value) => {
      value.sourceWriteAdmitted = true;
    },
    (value) => {
      value.runtimeReady = true;
    },
    (value) => {
      value.nativeAcceptance = true;
    },
    (value) => {
      value.hostArchitecture = "arm64";
    },
    (value) => {
      value.targetArchitecture = "x86_64";
    },
    (value) => {
      value.publicAdmissionDeniedBefore = false;
    },
    (value) => {
      value.publicAdmissionDisabledAfter = false;
    },
    (value) => {
      value.image = "future";
    },
    (value) => {
      value.capability.handlesClosed = false;
    },
    (value) => {
      value.capability.rows.pop();
    },
    (value) => {
      value.capability.rows[0].exactMtimeReadback = false;
    },
    (value) => {
      value.capability.rows[0].symlinkTargetUnchanged = false;
    },
    (value) => {
      value.capability.rows[0].birthTransition.changed = true;
    },
    (value) => {
      value.capability.rows[0].birthTransition.before[0] = "invented-ns";
    },
    (value) => {
      value.capability.rows[0] = value.capability.rows[1];
    },
    (value) => {
      value.roundtrip.sidecarKind = "sorng-linuxarm-source-metadata";
    },
    (value) => {
      value.roundtrip.sidecarUnchanged = false;
    },
    (value) => {
      value.roundtrip.noLinuxStatCache = false;
    },
    (value) => {
      value.roundtrip.applied = false;
    },
    (value) => {
      value.roundtrip.cleanupConfirmed = false;
    },
  ]) {
    const invalid = structuredClone(report);
    mutate(invalid);
    assert.throws(() => mod.validateReport(invalid), /OWNED_PROOF_/);
  }
});
