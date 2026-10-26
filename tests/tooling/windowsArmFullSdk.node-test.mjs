import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  identitySha256,
  validateSourceLock,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { validateRunnerMap } from "../../scripts/cef-runtime-ci.mjs";

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

test("full input closure owns exactly ten files and no selected Unix producer input", () => {
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
    ].map((n) => prefix + n),
    "tests/tooling/windowsArmFullSdk.node-test.mjs",
  ]);
  assert.equal(new Set(profile.sourcePaths).size, 10);
  assert(profile.sourcePaths.every((p) => !p.startsWith("scripts/")));
  assert.deepEqual(profile.modes, ["input-closure"]);
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

test("full phase map keeps all executable and compiled checkpoint authority unavailable", () => {
  assert.deepEqual(profile.phaseAdmission, {
    "input-closure": true,
    "source-gn": false,
    "engine-pilot": false,
    "compiled-checkpoint": false,
    "compiled-restore": false,
    "sdk-package": false,
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
    /on:\n  workflow_dispatch:\npermissions:\n  contents: read\n/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  for (const required of [
    "github.event_name == 'workflow_dispatch'",
    "github.event.repository.visibility == 'public'",
    "github.repository_id == '1010282954'",
    "github.event.repository.default_branch == 'main'",
    "github.ref == 'refs/heads/codex/windows-arm-full-sdk-source-20261026'",
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
  const ref = "refs/heads/codex/windows-arm-full-sdk-source-20261026";
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
    inputs: null,
  };
  authority(env, event);
  authority(env, { ...event, inputs: {} });
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
