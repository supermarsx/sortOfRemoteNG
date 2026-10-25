import assert from "node:assert/strict";
import { readFile, realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = await readFile(
  path.join(root, ".github/workflows/windows-x64-arm-clang-slice.yml"),
  "utf8",
);
const begin = workflow.indexOf("          import assert");
const end = workflow.indexOf("          // Closed entry;");
assert(begin >= 0 && end > begin);
const source = workflow
  .slice(begin, end)
  .split(/\r?\n/)
  .map((line) => line.slice(10))
  .join("\n");
const m = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const env = {
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
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_WORKFLOW_REF:
    "supermarsx/sortOfRemoteNG/.github/workflows/windows-x64-arm-clang-slice.yml@refs/heads/main",
};

test("inventory workflow admits only public default-branch manual x64 runs", () => {
  assert.equal(m.authority(env, "win32", "x64").mode, "inventory");
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "push",
    GITHUB_REPOSITORY_VISIBILITY: "private",
    GITHUB_REF: "refs/heads/foreign",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_RUN_ID: "0",
    RUNNER_ENVIRONMENT: "self-hosted",
    GITHUB_WORKFLOW_REF: "foreign",
  })) {
    assert.throws(() => m.authority({ ...env, [key]: value }, "win32", "x64"));
  }
  assert.throws(() => m.authority(env, "win32", "arm64"));
});

test("profile pins inventory only and fixed bounded installed paths", async () => {
  const raw = await readFile(path.join(root, m.SOURCES[1]));
  assert.equal(createHash("sha256").update(raw).digest("hex"), m.PROFILE_SHA);
  const p = JSON.parse(raw);
  assert.equal(p.mode, "inventory");
  assert.equal(p.limits.fileRows, 40);
  assert.equal(p.limits.outputBytes, 131072);
  assert.equal(p.limits.seconds, 180);
  assert.equal(p.toolset, "14.51.36231");
  assert.equal(p.sdk, "10.0.28000.0");
  assert.equal(m.SOURCES.length, 5);
  assert(m.SOURCES.every((s) => !s.startsWith("scripts/")));
  assert(workflow.includes("cancel-in-progress: true"));
  assert(!workflow.includes("cancel-in-progress: false"));
  assert(!workflow.includes("cef-hosted-provision"));
  assert(!workflow.includes("--execute"));
});

test("canonical Git and actual checkout identity retain closed CRLF distinction", () => {
  const raw = Buffer.from("fixed\n");
  assert.equal(m.canonicalSource(m.SOURCES[0], raw, raw), "exact");
  assert.equal(
    m.canonicalSource(m.SOURCES[0], raw, Buffer.from("fixed\r\n")),
    "git-crlf",
  );
  for (const s of m.SOURCES.slice(1, 4))
    assert.throws(() => m.canonicalSource(s, raw, Buffer.from("fixed\r\n")));
  for (const raw of [
    Buffer.from("fixed\r"),
    Buffer.from([255]),
    Buffer.from("tampered\n"),
  ])
    assert.throws(() =>
      m.canonicalSource(m.SOURCES[0], Buffer.from("fixed\n"), raw),
    );
});

test("child environment excludes credentials and arbitrary parent settings", () => {
  const values = Object.fromEntries(
    [
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "PROCESSOR_ARCHITECTURE",
      "ImageOS",
      "ImageVersion",
      "RUNNER_ARCH",
    ].map((k) => [k, "fixed"]),
  );
  const actual = m.environment({
    ...values,
    GITHUB_TOKEN: "never",
    USERPROFILE: "never",
    PATH: "never",
    HTTPS_PROXY: "never",
  });
  assert.equal(actual.PYTHONDONTWRITEBYTECODE, "1");
  assert(!Object.values(actual).includes("never"));
  assert.throws(() => m.environment({ ...values, TEMP: "" }));
});

test("bounded metadata result cannot claim execution or acceptance", () => {
  const value = {
    kind: "sorng-windows-x64-arm-inventory",
    mode: "inventory",
    success: true,
    compilerExecuted: false,
    installerExecuted: false,
    downloaded: false,
    nativeAcceptance: false,
    buildAdmission: false,
  };
  assert.equal(
    m.resultRecord(Buffer.from(JSON.stringify(value))).success,
    true,
  );
  for (const key of [
    "compilerExecuted",
    "installerExecuted",
    "downloaded",
    "nativeAcceptance",
    "buildAdmission",
  ])
    assert.throws(() =>
      m.resultRecord(Buffer.from(JSON.stringify({ ...value, [key]: true }))),
    );
  assert.throws(() => m.resultRecord(Buffer.from([255])));
  assert.throws(() => m.resultRecord(Buffer.alloc(131073)));
});

test("one work deadline includes all checks and keeps its reserve", () => {
  assert.equal(m.remainingBudget(180000, 0), 179000);
  assert.equal(m.remainingBudget(180000, 178999), 1);
  assert.throws(() => m.remainingBudget(180000, 179000));
  assert.throws(() => m.remainingBudget(180000, 181000));
  assert.throws(() => m.remainingBudget(180000, 0, 180000, 180001));
  assert.equal(m.remainingBudget(180000, 1000, 180000, 2000), 177000);
  assert(workflow.includes("phase='runtime-preflight'"));
  assert(
    workflow.includes("childStderrAvailable:Buffer.isBuffer(childStderr)"),
  );
  assert(workflow.includes("signal:abort.signal"));
  assert(workflow.includes("setTimeout(()=>process.exit(124),30000)"));
});

test("held read returns same bounded hashed physical bytes", async () => {
  const parent = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(parent, "x64-arm-inventory-"));
  try {
    const file = path.join(temp, "fixed");
    await writeFile(file, "fixed-public-data", { flag: "wx" });
    assert.equal((await m.held(file, 17)).toString(), "fixed-public-data");
    await assert.rejects(m.held(file, 16));
  } finally {
    await rm(temp, { recursive: true });
  }
});
