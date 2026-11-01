import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = async (path) =>
  (await fs.readFile(new URL(path, root), "utf8")).replaceAll("\r\n", "\n");
const workflow = await read(
  ".github/workflows/windows-arm-source-preflight.yml",
);
const original = await read(".github/workflows/windows-x64-arm-toolchain.yml");
const raw = await fs.readFile(
  new URL("native/windows-arm-full-sdk/preflight-profile.json", root),
);
const selected = JSON.parse(raw);
const base = JSON.parse(await read("native/windows-arm-full-sdk/profile.json"));
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const ref = "refs/heads/codex/windows-arm-current-source-preflight-20261101";
const authorityBlock = workflow.slice(
  workflow.indexOf("// BEGIN FIXED CARRIER AUTHORITY"),
  workflow.indexOf("// END FIXED CARRIER AUTHORITY"),
);
const authority = vm.runInNewContext(authorityBlock + "\ncarrierAuthority;", {
  assert,
  Object,
});
const image = vm.runInNewContext(authorityBlock + "\ncarrierImage;", {
  assert,
  Object,
});
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
    "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-source-preflight.yml@" +
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
  inputs: { mode: "source-preflight" },
};

test("new carrier parses and retains bounded whole-work and cleanup timers", () => {
  const marker = "          node --input-type=module <<'NODE'\n";
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("          NODE\n", start);
  assert(start >= 0 && end > start);
  const script = workflow
    .slice(start + marker.length, end)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
  new vm.Script(
    "(async()=>{\n" + script.replace(/^import .*;\n/gm, "") + "\n})",
  );
  assert(script.includes("phase='authority', compilerExecutableInvoked=null"));
  assert(script.includes("remaining()+30000"));
  assert(
    script.includes(
      "Math.min(begin+workMs-Date.now(), workMs-(performance.now()-beginMono))",
    ),
  );
});

test("dedicated manual current-image branch cannot extend inventory or source-GN authority", () => {
  assert.equal(authority(env, event), "source-preflight");
  assert.equal(image("source-preflight", base), "20261030.294.1");
  for (const value of [
    "main",
    "codex/windows-arm-current-inventory-20261101",
    "codex/windows-arm-source-gn-20261026",
  ])
    assert.throws(() =>
      authority({ ...env, GITHUB_REF: "refs/heads/" + value }, event),
    );
  for (const mode of [
    "command-inventory",
    "source-gn",
    "input-closure",
    "compiler",
    "sdk",
  ]) {
    assert.throws(() => authority(env, { ...event, inputs: { mode } }));
    assert.throws(() => image(mode, base));
  }
  for (const [key, value] of [
    ["GITHUB_REPOSITORY", "other/repo"],
    ["GITHUB_SHA", "main"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_EVENT_NAME", "push"],
    ["CEF_DEFAULT_BRANCH", "feature"],
    [
      "GITHUB_WORKFLOW_REF",
      env.GITHUB_WORKFLOW_REF.replace(
        "source-preflight.yml",
        "x64-arm-toolchain.yml",
      ),
    ],
  ])
    assert.throws(() => authority({ ...env, [key]: value }, event));
  assert.throws(() =>
    authority(env, {
      ...event,
      inputs: { mode: "source-preflight", extra: "true" },
    }),
  );
  assert.throws(() =>
    authority(env, {
      ...event,
      repository: { ...event.repository, private: true },
    }),
  );
  assert(original.includes("event.inputs.mode==='command-inventory'"));
  assert(
    original.includes(
      "const ref='refs/heads/codex/windows-arm-current-inventory-20261101'",
    ),
  );
});

test("reviewed supplemental profile keeps original engine build admission closed", async () => {
  const producer = await read("native/windows-arm-full-sdk/preflight.py");
  assert(producer.includes('PROFILE_SHA = "' + sha(raw) + '"'));
  assert(
    workflow.includes("assert.equal(hash(preflightRaw),'" + sha(raw) + "')"),
  );
  assert.equal(selected.ref, ref);
  assert.equal(selected.mode, "source-preflight");
  assert.equal(selected.benignVersionExecutionAllowed, true);
  for (const key of [
    "sourceFetchAllowed",
    "gnAllowed",
    "engineCompilationAllowed",
    "sdkAllowed",
    "publicationAllowed",
  ])
    assert.equal(selected[key], false);
  assert.equal(base.image, "20261021.278.1");
  assert.equal(base.sourceGn.hostClosure.image, base.image);
  assert.equal(base.sourceGn.compilerAllowed, false);
  assert.equal(base.sourceGn.sdkAllowed, false);
  const delta = selected.hostClosure.rows.filter(
    (row, index) =>
      JSON.stringify(row) !==
      JSON.stringify(base.sourceGn.hostClosure.rows[index]),
  );
  assert.equal(delta.length, 7);
  assert.equal(selected.hostClosure.rows.length, 18);
  assert.equal(selected.hostClosure.peBytes, 113852732);
  assert.equal(selected.hostClosure.edgeCount, 242);
  assert.equal(
    selected.hostClosure.edgeSha256,
    base.sourceGn.hostClosure.edgeSha256,
  );
  assert.equal(selected.inventoryEvidence.runId, 41325335383);
  assert.equal(
    selected.inventoryEvidence.head,
    "bcf300cb68f5857420e210535f99a1117b985816",
  );
});

test("exact static clang PE imports require no private runtime PATH or guessed API sets", () => {
  assert.equal(selected.clang.bytes, 103794176);
  assert.equal(selected.clang.sha256, base.llvm.clangSha256);
  assert.deepEqual(selected.clang.argv, ["--version"]);
  assert.deepEqual(selected.clang.imports, [
    "KERNEL32.dll",
    "ADVAPI32.dll",
    "ntdll.dll",
    "VERSION.dll",
    "OLEAUT32.dll",
  ]);
  assert.deepEqual(selected.clang.delayImports, ["ole32.dll", "SHELL32.dll"]);
});

test("all sixteen canonical sources are closed and independent public commit witnesses", async () => {
  const allowed = JSON.parse(workflow.match(/const allowed=(\[[^;]+\]);/)[1]);
  const paths = JSON.parse(workflow.match(/const sourcePaths=(\[[^;]+\]);/)[1]);
  assert.deepEqual(paths, allowed);
  assert.deepEqual(paths.slice(0, 11), base.sourcePaths);
  assert.deepEqual(paths.slice(11), [
    ".github/workflows/windows-arm-source-preflight.yml",
    "native/windows-arm-full-sdk/preflight-profile.json",
    "native/windows-arm-full-sdk/preflight.py",
    "native/windows-arm-full-sdk/test_preflight.py",
    "tests/tooling/windowsArmSourcePreflight.node-test.mjs",
  ]);
  assert.equal(new Set(paths).size, 16);
  for (const path of paths) assert((await read(path)).length > 0);
  assert(!workflow.includes("execute('git'"));
  assert(workflow.includes("redirect:'error',credentials:'omit'"));
  assert(workflow.includes("sourceBytes<=16777216"));
  assert(workflow.includes("value.byteLength<=2097152-bytes"));
  assert(
    workflow.includes(
      "phase='owned-operation';await pinnedPython();child=spawn",
    ),
  );
});

test("version Jobs remain fixed bounded phases after strict runtime data, never source or engine build", async () => {
  const py = await read("native/windows-arm-full-sdk/preflight.py");
  assert(
    py.includes(
      "ROLES = ('sdk-data','llvm-data','runtime-closure','git-version','clang-version')",
    ),
  );
  assert(py.includes("return [executable,'--version']"));
  assert(py.includes("'git-version':15,'clang-version':15"));
  assert(py.includes("cap=32768 if version else 131072"));
  assert(py.includes("result['compilerExecutableInvoked']=None"));
  assert(
    workflow.includes(
      "actual.compilerExecutableInvoked===true&&actual.engineCompilationAttempted===false",
    ),
  );
  assert(workflow.includes("sourceFetched:false,gnExecuted:false"));
  assert(workflow.includes("nativeAcceptance:false,publicationAllowed:false"));
  assert(workflow.includes("workMs=3600000"));
  assert(
    workflow.includes(
      "activeAtEnd===0&&item.originalJob.rootReaped===true&&item.originalJob.logReadersStopped===true",
    ),
  );
  assert(
    !/CEF_BUILD_|--create-distrib|upload-release|contents: write|secrets\./.test(
      workflow,
    ),
  );
  assert(!workflow.includes("source-gn-logs/"));
  assert(workflow.includes("/jobs/git-version/*.log"));
  assert(workflow.includes("/jobs/clang-version/*.log"));
});
