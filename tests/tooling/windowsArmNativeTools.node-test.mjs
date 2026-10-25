import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import YAML from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => fs.readFile(path.join(root, name), "utf8");
const workflow = await read(".github/workflows/windows-arm-native-tools.yml");
const parsed = YAML.parse(workflow);
const step = parsed.jobs.benign.steps.find((row) => row.id === "observe");
const entry =
  "try { await run(); } catch { process.exitCode=1;console.error('ARM_NATIVE_TOOLS_DIAGNOSTIC_FAILED'); }";
const code = step.run
  .split("node --input-type=module <<'NODE'\n")[1]
  .split("\nNODE")[0];
assert(code.includes(entry));
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(code.replace(entry, "")).toString("base64")
);
const raw = Buffer.from(
  (await read("native/windows-arm-native-tools/profile.json")).replace(
    /\r\n/g,
    "\n",
  ),
);
const profile = mod.profileFromBytes(raw);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const env = () => ({
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
    "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-native-tools.yml@refs/heads/main",
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "1",
  SystemRoot: "C:" + String.fromCharCode(92) + "Windows",
});

test("first-class observer has closed public manual native ARM authority and fresh maintained provisioning", () => {
  assert.deepEqual(Object.keys(parsed.on), ["workflow_dispatch"]);
  assert.deepEqual(parsed.permissions, { contents: "read" });
  assert.equal(parsed.concurrency["cancel-in-progress"], true);
  assert.equal(parsed.jobs.benign["runs-on"], "windows-11-arm");
  assert.match(parsed.jobs.benign.if, /github.repository_id == '1010282954'/);
  assert.equal(parsed.jobs.benign.steps[0].with["persist-credentials"], false);
  const provision = parsed.jobs.benign.steps.findIndex((s) =>
    s.name?.startsWith("Provision"),
  );
  assert(provision > 1 && provision < parsed.jobs.benign.steps.indexOf(step));
  assert.match(
    parsed.jobs.benign.steps[provision].run,
    /cef-hosted-provision\.mjs --target aarch64-pc-windows-msvc --output "\$RUNNER_TEMP\/cef-hosted-provision" --execute/,
  );
  assert(
    parsed.jobs.benign.steps
      .filter((s) => s.uses)
      .every((s) => /@[a-f0-9]{40}$/.test(s.uses)),
  );
});

test("authority independently handles real backslash and denies aliases and foreign workflows", () => {
  assert.equal(
    mod.authority(env(), "win32", "arm64").nativeTarget,
    "aarch64-pc-windows-msvc",
  );
  for (const SystemRoot of [
    "C:Windows",
    "C:/Windows",
    "D:" + String.fromCharCode(92) + "Windows",
    "\\\\server\\Windows",
    env().SystemRoot + "\0",
  ])
    assert.throws(
      () => mod.authority({ ...env(), SystemRoot }, "win32", "arm64"),
      /ARM_SYSTEM_ROOT/,
    );
  for (const [key, value] of [
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_REPOSITORY_VISIBILITY", "private"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_WORKFLOW_REF", "foreign"],
  ])
    assert.throws(() =>
      mod.authority({ ...env(), [key]: value }, "win32", "arm64"),
    );
  assert.throws(() => mod.authority(env(), "win32", "x64"), /ARM_NATIVE_NODE/);
});

test("profile binds actual historical bytes without repinning or treating mixed roles as execution approval", async () => {
  assert.equal(digest(raw), mod.PROFILE_SHA);
  assert.equal(profile.files.length, 25);
  assert.equal(
    profile.files.reduce((n, row) => n + row.size, 0),
    83648151,
  );
  assert.equal(profile.files[1].nlink, 4);
  assert.equal(profile.files[23].machine, 0x8664);
  assert.equal(
    profile.python.sha256,
    "46851212e3a4fc1846086dc9c7be10aeb156320b1f68dfbd86eafa56a4b0d8b4",
  );
  assert.equal(
    profile.pythonDll.sha256,
    "b9452ab50e10771663d35b5461f495fd11c293f46f2807add150ac2676653e53",
  );
  for (const name of ["job.py", "observe.py"])
    assert(
      (await read("native/windows-arm-native-tools/" + name)).includes(
        mod.PROFILE_SHA,
      ),
    );
  assert.throws(
    () => mod.profileFromBytes(Buffer.concat([raw, Buffer.from(" ")])),
    /ARM_PROFILE_PIN/,
  );
  assert.equal(profile.closure.setupCompatibility, null);
  assert.equal(profile.closure.loadedModulesVerified, false);
  assert.equal(profile.closure.producerProvenanceIntegrationRequired, true);
});

test("source and provenance include all seven inputs and unchanged kernel ancestry/provision sources", async () => {
  assert.equal(mod.SOURCE_PATHS.length, 7);
  assert.equal(new Set(mod.SOURCE_PATHS).size, 7);
  const bytes = new Map(
    await Promise.all(
      mod.SOURCE_PATHS.map(async (name) => [
        name,
        Buffer.from((await read(name)).replace(/\r\n/g, "\n")),
      ]),
    ),
  );
  const calls = [];
  const git = async (_file, args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: Buffer.from("a".repeat(40)) };
    if (args[0] === "diff-index") return { stdout: Buffer.alloc(0) };
    return { stdout: bytes.get(args[2].slice(41)) };
  };
  const rows = await mod.sourceInputs("a".repeat(40), git);
  assert.deepEqual(
    rows.map((r) => r.path),
    mod.SOURCE_PATHS,
  );
  assert.equal(calls.filter((a) => a[0] === "cat-file").length, 7);
  assert.match(code, /native\/windows-job-benign\/windows-checkpoint-job\.py/);
  assert.match(code, /scripts\/cef-hosted-provision\.mjs/);
  assert.match(code, /native\/cef-hosted-recipe\.json/);
  assert.match(code, /producerProvenanceIntegrationRequired:true/);
  await assert.rejects(
    mod.sourceInputs("b".repeat(40), git),
    /ARM_CHECKOUT_HEAD/,
  );
});

test("native children have explicit credential-free environment and finite owned supervision", () => {
  const clean = mod.childEnvironment(path.resolve("/owned"));
  assert.equal(clean.PATH, "C:/Windows/System32");
  for (const name of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "PYTHONPATH",
    "CL",
    "_CL_",
    "LINK",
    "LIB",
    "INCLUDE",
  ])
    assert(!Object.hasOwn(clean, name));
  assert.match(code, /supervise\(child,150000,30000\)/);
  assert.match(code, /stdio:\['ignore',stdout\.fd,stderr\.fd\]/);
  assert.match(code, /supervision\.joined&&supervision\.code===0/);
  assert.match(code, /total<=512\*1024/);
  assert.match(code, /files\.length<100&&info\.size<=65536/);
});

test("preflight uses actual environment and preserves closed stages and failure redaction", async () => {
  assert.match(code, /report\('authority',\(\)=>authority\(process\.env\)\)/);
  const lines = [];
  const report = mod.createPreflightReporter((line) =>
    lines.push(JSON.parse(line)),
  );
  const failure = new Error("private provider data");
  await assert.rejects(
    report("source-inputs", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    lines.map((row) => [row.stage, row.status]),
    [
      ["source-inputs", "begin"],
      ["source-inputs", "fail"],
    ],
  );
  assert.equal(lines[1].errorCode, "UNAVAILABLE");
  assert(!JSON.stringify(lines).includes("private"));
  assert.match(code, /v\.completed===true&&v\.engineBuildAttempted===false/);
});

test("D45 remains a separately attested subset and cannot substitute for seven new source pins", async () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const actual = await mod.producerPins(head);
  assert.equal(actual.rows.length, 126);
  assert.equal(
    actual.codeDigest,
    "d45d68c07163f65ddbe2531d48aab99a15bb04244e63503169a8801f5b824654",
  );
  assert(
    !actual.rows.some((row) =>
      row.path.startsWith("native/windows-arm-native-tools/"),
    ),
  );
  for (const rows of [
    actual.rows.slice(1),
    actual.rows.map((row, index) =>
      index === 0 ? { ...row, sha: "0".repeat(40) } : row,
    ),
  ]) {
    const git = async () => ({
      stdout: Buffer.from(
        rows
          .map((row) => `${row.mode} blob ${row.sha}\t${row.path}`)
          .join("\n"),
      ),
    });
    await assert.rejects(mod.producerPins(head, git), /ARM_PROFILE/);
  }
});

test("real own-cache junction or symlink cannot masquerade as the canonical directory", async () => {
  const cache = path.join(root, ".orchestration", "cache");
  await fs.mkdir(cache, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(cache, "arm-tools-link-"));
  const target = path.join(temporary, "target");
  const alias = path.join(temporary, "alias");
  await fs.mkdir(target);
  let linked = false;
  try {
    await fs.symlink(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    linked = true;
    await assert.rejects(
      mod.noLinks(alias),
      /ARM_CANONICAL_PATH|ARM_PATH_LINK/,
    );
    assert.equal(await mod.noLinks(target), path.resolve(target));
  } finally {
    if (linked) await fs.unlink(alias);
    assert.equal(path.dirname(temporary), cache);
    assert(path.basename(temporary).startsWith("arm-tools-link-"));
    await fs.rmdir(target);
    await fs.rmdir(temporary);
  }
});

test("only declared diagnostic files can reach an artifact-ready upload", () => {
  const operation =
    ".artifacts/windows-arm-native-tools-00000000-0000-0000-0000-000000000000";
  for (const relative of [
    "context.json",
    "observation.json",
    "source-inputs/0",
    "source-inputs/6",
    "jobs/cl/receipt.json",
    "jobs/python/stdout.log",
    "result-link.json",
  ])
    assert(mod.artifactAllowed(`${operation}/${relative}`, operation));
  assert(
    mod.artifactAllowed(".cache/windows-arm-native-tools/job.py", operation),
  );
  for (const relative of [
    "../outside",
    "home/private.txt",
    "tmp/cache",
    "source-inputs/7",
    "jobs/foreign/receipt.json",
    "jobs/cl/raw-secret.txt",
    "result-foreign.json",
  ])
    assert(!mod.artifactAllowed(`${operation}/${relative}`, operation));
  assert(
    !mod.artifactAllowed(
      ".cache/windows-arm-native-tools/extra/job.py",
      operation,
    ),
  );
  assert(!mod.artifactAllowed(`${operation}/context.json`, "foreign"));
  assert.match(parsed.jobs.benign.steps.at(-1).if, /artifact_ready == 'true'/);
  assert(
    code.indexOf("await report('artifact-collection'") <
      code.indexOf("artifact_ready=true"),
  );
  assert.match(
    code,
    /summaryBytes\.length<=65536&&total\+summaryBytes\.length<=512\*1024/,
  );
});

test("WinVerifyTrust source keeps documented ABI, no UI, cache-only and finally close", async () => {
  const text = await read("native/windows-arm-native-tools/observe.py");
  assert.match(text, /verify\.restype = W\.LONG/);
  assert.match(text, /C\.sizeof\(FileInfo\) == 32 and C\.sizeof\(Data\) == 88/);
  assert.match(
    text,
    /data\.size, data\.ui, data\.revocation, data\.choice = C\.sizeof\(Data\), 2, 1, 1/,
  );
  assert.match(
    text,
    /data\.info, data\.flags = C\.pointer\(info\), 0x1000 \| 0x80/,
  );
  assert.match(text, /finally:\n\s+data\.action = 2/);
  assert.match(text, /status == 0 and closed == 0/);
  assert.match(text, /verify\(W\.HWND\(-1\)/);
  assert.doesNotMatch(text, /shell=True|os\.walk|rglob\(/);
});

test("pure Python tests execute no Windows imports, kernels, vendor binaries or downloads", () => {
  const output = execFileSync(
    process.env.SORNG_PURE_PYTHON ??
      (process.platform === "win32" ? "python" : "python3"),
    ["-I", "-B", "native/windows-arm-native-tools/test_observe.py"],
    {
      cwd: root,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(output, "");
});
