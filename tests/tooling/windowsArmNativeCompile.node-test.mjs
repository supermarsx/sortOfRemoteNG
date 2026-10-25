import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  writeFile,
  unlink,
  rmdir,
  realpath,
  lstat,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflow = await readFile(
  new URL(".github/workflows/windows-arm-native-compile.yml", root),
  "utf8",
);
const block = workflow.match(
  /          node --input-type=module <<'NODE'\r?\n([\s\S]*?)          NODE/,
);
assert(block, "closed inline workflow program exists");
const definitions = block[1]
  .split("\n")
  .map((line) => line.replace(/^          /, ""))
  .join("\n")
  .split("// Closed workflow entry")[0];
const api = await import(
  `data:text/javascript;base64,${Buffer.from(definitions).toString("base64")}`
);
const profileRaw = await readFile(
  new URL("native/windows-arm-native-compile/profile.json", root),
);
const profile = JSON.parse(profileRaw);

function environment() {
  return {
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
      "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-native-compile.yml@refs/heads/main",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
  };
}

test("closed native ARM authority rejects fork/ref/workflow/architecture drift", () => {
  assert.equal(api.authority(environment(), "win32", "arm64").runId, "123");
  for (const [field, value] of [
    ["GITHUB_REPOSITORY", "fork/repo"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_WORKFLOW_REF", "another.yml"],
  ])
    assert.throws(() =>
      api.authority({ ...environment(), [field]: value }, "win32", "arm64"),
    );
  assert.throws(() => api.authority(environment(), "win32", "x64"));
});

test("profile and exact seven fixed roles remain pinned without Setup/SDK claims", () => {
  assert.equal(
    createHash("sha256").update(profileRaw).digest("hex"),
    api.PROFILE_SHA,
  );
  assert.deepEqual(api.ROLES, [
    "c",
    "stl",
    "atl",
    "mfc",
    "link-c",
    "link-stl",
    "link-atl",
  ]);
  assert.equal(profile.files.length, 25);
  assert.equal(profile.claims.setupCompatibility, null);
  assert.equal(profile.claims.loadedModulesVerified, false);
  assert.equal(profile.claims.outputExecuted, false);
});

test("workflow provisions fixed SDK before genuine compilation and retains only owned evidence", () => {
  assert.match(workflow, /runs-on: windows-11-arm/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /architecture: arm64/);
  assert.match(workflow, /node-version-file: "\.node-version"/);
  assert(
    workflow.indexOf("cef-hosted-provision.mjs") <
      workflow.indexOf("const context="),
  );
  assert.match(workflow, /timeout:900000/);
  assert.doesNotMatch(
    workflow,
    /contents: write|publish=true|LoadLibrary|\.exe'\s*,\s*\[\]/,
  );
  const names = api.artifactNames(profile);
  assert.equal(new Set(names).size, names.length);
  assert(names.includes("objects/mfc.obj"));
  assert(!names.includes("bin/mfc.exe"));
  assert(!names.some((name) => name.includes("..") || name.startsWith("tmp/")));
});

test("native child environment uses explicit owned identity without ambient credential/proxy values", () => {
  const value = api.environment(path.resolve("owned-test-root"));
  assert.equal(value.USERNAME, "owned-benign");
  assert.equal(value.PROCESSOR_ARCHITECTURE, "ARM64");
  assert(!Object.hasOwn(value, "GITHUB_TOKEN"));
  assert(!Object.hasOwn(value, "HTTPS_PROXY"));
});

test("held reader supports empty declared logs but bounds and authenticates installed files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "arm-compile-data-"));
  try {
    const file = path.join(directory, "owned.log");
    await writeFile(file, "");
    assert.equal((await api.held(file, 32, true, true)).length, 0);
    await assert.rejects(api.held(file, 32));
    await writeFile(file, "owned-data-only");
    assert.equal((await api.held(file, 32)).toString(), "owned-data-only");
    await assert.rejects(api.held(file, 3));
  } finally {
    await unlink(path.join(directory, "owned.log"));
    await rmdir(directory);
  }
});

test("PE diagnostic observes native machine without executing the image", () => {
  const data = Buffer.alloc(256);
  data.write("MZ");
  data.writeUInt32LE(64, 60);
  data.writeUInt32LE(0x4550, 64);
  data.writeUInt16LE(0xaa64, 68);
  assert.equal(api.peMachine(data), 0xaa64);
  assert.throws(() => api.peMachine(data.subarray(0, 80)));
});

test("real Git autocrlf checkout binds canonical and actual bytes separately", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "arm-compile-git-"));
  const canonicalRoot = await realpath(directory),
    original = await lstat(directory, { bigint: true });
  const env = {
    PATH: process.env.PATH ?? process.env.Path,
    SystemRoot: process.env.SystemRoot ?? "C:/Windows",
    HOME: directory,
    USERPROFILE: directory,
    TMP: directory,
    TEMP: directory,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: directory,
      env,
      input,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1048576,
    });
  try {
    git(["init", "--quiet"]);
    git(["config", "core.autocrlf", "true"]);
    const name = ".github/workflows/windows-arm-native-tools.yml",
      canonical = Buffer.from("name: owned\non: workflow_dispatch\n");
    const object = git(["hash-object", "-w", "--stdin"], canonical)
      .toString()
      .trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${object},${name}`]);
    git(["checkout-index", "--force", "--all"]);
    const actual = await readFile(path.join(directory, name)),
      blob = git(["cat-file", "blob", object]);
    assert.equal(
      actual.toString(),
      canonical.toString().replaceAll("\n", "\r\n"),
    );
    assert.throws(
      () => assert(actual.equals(blob)),
      "old exact-only guard rejects the legitimate checkout",
    );
    const value = api.sourceBinding(name, blob, actual);
    assert.equal(value.encoding, "git-crlf");
    assert.equal(value.bytes, actual.length);
    assert.equal(value.gitBytes, blob.length);
    assert.equal(
      value.sha256,
      createHash("sha256").update(actual).digest("hex"),
    );
    assert.equal(
      value.gitSha256,
      createHash("sha256").update(blob).digest("hex"),
    );
    assert.notEqual(value.sha256, value.gitSha256);
    assert.equal(api.sourceBinding(name, blob, blob).encoding, "exact");
  } finally {
    const current = await lstat(directory, { bigint: true });
    assert.equal(await realpath(directory), canonicalRoot);
    assert(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, original.dev);
    assert.equal(current.ino, original.ino);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true });
  }
});

test("closed source binding rejects tampering, mixed EOL, invalid UTF8 and native smudging", () => {
  const file = "scripts/cef-hosted-provision.mjs",
    canonical = Buffer.from("one\ntwo\n"),
    crlf = Buffer.from("one\r\ntwo\r\n");
  assert.equal(api.sourceBinding(file, canonical, crlf).encoding, "git-crlf");
  for (const actual of [
    Buffer.from("one\r\nTWO\r\n"),
    Buffer.from("one\r\ntwo\n"),
    Buffer.from("one\rtwo\r"),
    Buffer.from([0xff, 0x0a]),
  ])
    assert.throws(() => api.sourceBinding(file, canonical, actual));
  assert.throws(() =>
    api.sourceBinding(
      file,
      Buffer.from([0xff, 0x0a]),
      Buffer.from([0xff, 0x0d, 0x0a]),
    ),
  );
  assert.throws(() =>
    api.sourceBinding(file, crlf, Buffer.from("one\r\r\ntwo\r\r\n")),
  );
  for (const name of [
    "scripts/unknown.mjs",
    "native/windows-arm-native-compile/profile.json",
    "native/windows-arm-native-compile/compile.py",
    "native/windows-arm-native-tools/job.py",
  ]) {
    assert.throws(() => api.sourceBinding(name, canonical, crlf));
    assert.equal(
      api.sourceBinding(name, canonical, canonical).encoding,
      "exact",
    );
  }
  assert.match(
    workflow,
    /\['cat-file','blob',`\$\{provenance.head\}:\$\{file\}`\]/,
  );
  assert.match(workflow, /rows.push\(binding\)/);
  assert.match(
    workflow,
    /writeFile\(path.join\(root,'source-inputs',String\(n\)\),data/,
  );
});
