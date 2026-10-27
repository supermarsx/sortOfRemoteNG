import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { EventEmitter } from "node:events";
import {
  SDK,
  TARGET,
  PRODUCT,
  FIXTURE,
  FIXTURE_REF,
  fixtureAuthority,
  fixtureBudget,
  validatePublishedSdk,
  packageFixturePlan,
  parseProcStat,
  namespaceAccepted,
  installedAuditProgram,
  main,
  observeFixture,
  fixtureActorCommand,
  waitActorFile,
} from "../../scripts/cef-linux-package-fixture.mjs";

test("closed public manual branch authority excludes normal and private invocations", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_REF: FIXTURE_REF,
    GITHUB_WORKFLOW_REF: `supermarsx/sortOfRemoteNG/.github/workflows/browser-native-packages.yml@${FIXTURE_REF}`,
  };
  const event = {
    repository: {
      id: 1010282954,
      full_name: env.GITHUB_REPOSITORY,
      private: false,
      visibility: "public",
      default_branch: "main",
    },
    inputs: {},
  };
  fixtureAuthority(env, event);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["RUNNER_ENVIRONMENT", "self-hosted"],
    ["GITHUB_REF", "refs/heads/main"],
    ["GITHUB_REPOSITORY_ID", "1"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_EVENT_NAME", "workflow_call"],
  ])
    assert.throws(
      () => fixtureAuthority({ ...env, [key]: value }, event),
      /LPF_AUTHORITY/,
    );
  assert.throws(
    () => fixtureAuthority(env, { ...event, inputs: { format: "arbitrary" } }),
    /LPF_AUTHORITY/,
  );
  assert.throws(
    () =>
      fixtureAuthority(env, {
        ...event,
        repository: { ...event.repository, private: true },
      }),
    /LPF_AUTHORITY/,
  );
});
test("only authenticated five published assets are accepted, never latest or repacked bytes", () => {
  const value = {
    id: SDK.releaseId,
    tag_name: SDK.tag,
    target_commitish: SDK.producerHead,
    draft: false,
    prerelease: true,
    assets: SDK.assets.map(([id, name, size, hash]) => ({
      id,
      name,
      size,
      digest: `sha256:${hash}`,
      state: "uploaded",
      browser_download_url: `https://github.com/supermarsx/sortOfRemoteNG/releases/download/${SDK.tag}/${name}`,
    })),
  };
  assert.equal(validatePublishedSdk(value), value);
  for (const key of [
    "id",
    "tag_name",
    "target_commitish",
    "draft",
    "prerelease",
  ]) {
    const bad = structuredClone(value);
    bad[key] = null;
    assert.throws(() => validatePublishedSdk(bad));
  }
  for (const key of ["id", "size", "digest", "state", "browser_download_url"]) {
    const bad = structuredClone(value);
    bad.assets[0][key] = "changed";
    assert.throws(() => validatePublishedSdk(bad), /LPF_ASSET/);
  }
  const bad = structuredClone(value);
  bad.assets.push(bad.assets[0]);
  assert.throws(() => validatePublishedSdk(bad), /LPF_RELEASE/);
});
test("one original work clock clamps stages and retains inside-post reserve", () => {
  let wall = 10000,
    mono = 500;
  const b = fixtureBudget(
    () => wall,
    () => mono,
  );
  assert.equal(b.phase(45 * 60000), 45 * 60000);
  wall += 110 * 60000 - 1;
  mono += 110 * 60000 - 1;
  assert.equal(b.phase(45 * 60000), 1);
  mono += 1;
  assert.throws(() => b.remaining(), /LPF_DEADLINE/);
  assert.equal(b.cleanupRemaining(), 10 * 60000 + 30000);
  wall += 11 * 60000;
  assert.equal(b.cleanupRemaining(), 0);
});
test("fixture builds only locked consumer/helper and never compiles the application", async () => {
  const root = path.resolve(".artifacts/synthetic-package-plan"),
    plan = packageFixturePlan(root);
  assert.equal(plan.target, TARGET);
  assert.equal(plan.productName, PRODUCT);
  assert.equal(plan.appName, FIXTURE);
  assert.notEqual(plan.cargo, plan.published);
  assert(
    plan.fixtureBuild.includes("--locked") && plan.fixtureBuild.includes("-j2"),
  );
  assert(
    plan.fixtureBuild.includes(
      "src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance/Cargo.toml",
    ),
  );
  assert(plan.helperBuild.includes("sorng-cef-helper"));
  assert(!plan.helperBuild.includes("app"));
  assert.deepEqual(plan.formats, ["deb", "rpm", "appimage"]);
  assert.equal(plan.fixtureOnly, true);
  assert.equal(plan.releaseAppAccepted, false);
  assert(plan.fetch.includes(SDK.descriptorSha256));
  assert.equal(plan.installedHelper, "/usr/lib/sortOfRemoteNG/chrome-sandbox");
  assert.deepEqual(
    await main(["plan"]),
    packageFixturePlan(path.resolve(".artifacts/linux-package-fixture-plan")),
  );
  await assert.rejects(main([]), /LPF_EXPLICIT_EXECUTE_REQUIRED/);
});
const proc = (pid, parent, start) =>
  `${pid} (owned fixture (worker)) S ${parent} ${pid} ` +
  Array(16).fill("0").join(" ") +
  ` ${start} 0 0\n`;
test("numeric proc identity parses parent/start without leaking process names", () => {
  assert.deepEqual(parseProcStat(proc(99, 10, 1234)), {
    pid: 99,
    parent: 10,
    group: 99,
    start: 1234,
  });
  for (const value of [
    "",
    proc(99, 10, 0),
    proc(99, -1, 1234),
    proc(99, 10, 1234).replace("1234", "9007199254740999"),
  ])
    assert.throws(() => parseProcStat(value), /LPF_PROC_STAT/);
});
test("AppImage namespace predicate needs actual loaded helper plus all namespaces and seccomp", () => {
  const row = {
    role: "renderer",
    uid: [1001, 1001, 1001, 1001],
    noNewPrivs: 1,
    seccomp: 2,
    userNamespaceDifferent: true,
    pidNamespaceDifferent: true,
    mountNamespaceDifferent: true,
    executableVerified: true,
    helperMode: 0o755,
    mountedAppImage: true,
  };
  assert(namespaceAccepted({ complete: true, facts: [row] }, 1001));
  for (const key of [
    "userNamespaceDifferent",
    "pidNamespaceDifferent",
    "mountNamespaceDifferent",
    "executableVerified",
    "mountedAppImage",
  ])
    assert(
      !namespaceAccepted(
        { complete: true, facts: [{ ...row, [key]: false }] },
        1001,
      ),
    );
  for (const bad of [
    { ...row, seccomp: 0 },
    { ...row, noNewPrivs: 0 },
    { ...row, helperMode: 0o4755 },
    { ...row, uid: [0, 0, 0, 0] },
  ])
    assert(!namespaceAccepted({ complete: true, facts: [bad] }, 1001));
  assert(!namespaceAccepted({ complete: false, facts: [row] }, 1001));
});

function procFixture(fault, currentStatError) {
  const handles = new Map(),
    opened = [],
    closed = [],
    helper = Buffer.from("owned inert executable bytes");
  let next = 7,
    statusReads = 0,
    childStats = 0,
    rootStats = 0,
    readFailed = false;
  const primary = new Error("OWNED_READ_PRIMARY"),
    secondary = new Error("OWNED_CLOSE_SECONDARY");
  const io = {
    async open(file) {
      const directory = /^\/proc\/(\d+)$/.exec(file);
      let pid, leaf;
      if (directory) {
        pid = Number(directory[1]);
        leaf = null;
      } else {
        const match = /^\/proc\/self\/fd\/(\d+)\/(.+)$/.exec(file);
        assert(match, file);
        assert(
          handles.has(Number(match[1])),
          "query stays under held proc directory",
        );
        pid = handles.get(Number(match[1])).pid;
        leaf = match[2];
      }
      const id = next++,
        record = { pid, leaf };
      handles.set(id, record);
      opened.push(record);
      let offset = 0;
      return {
        fd: id,
        async read(buffer, at, length) {
          let bytes;
          if (leaf === "stat") {
            if (pid === 101) rootStats++;
            if (fault === "current-falsy" && pid === 101 && rootStats > 1) {
              readFailed = true;
              throw currentStatError;
            }
            if (pid === 202) childStats++;
            bytes = Buffer.from(
              proc(
                pid,
                pid === 101 ? process.pid : fault === "foreign" ? 999 : 101,
                pid === 101
                  ? 100
                  : fault === "reused" && childStats > 1
                    ? 300
                    : 200,
              ),
            );
          } else if (leaf === "task/101/children")
            bytes = Buffer.from(
              fault === "count"
                ? Array.from({ length: 17 }, (_, i) => String(202 + i)).join(
                    " ",
                  )
                : "202\n",
            );
          else if (leaf === "status") {
            statusReads++;
            if (fault === "read-close") {
              readFailed = true;
              throw primary;
            }
            bytes = Buffer.from(
              "Uid:\t1001\t1001\t1001\t1001\nNoNewPrivs:\t1\nSeccomp:\t2\n",
            );
          } else if (leaf === "cmdline")
            bytes = Buffer.from(
              "fixture\0--type=renderer\0https://do-not-retain.invalid/\0",
            );
          else if (leaf === "exe") bytes = helper;
          else throw new Error("UNEXPECTED_PROC_LEAF:" + leaf);
          const count = Math.min(length, bytes.length - offset);
          bytes.copy(buffer, at, offset, offset + count);
          offset += count;
          return { bytesRead: count };
        },
        async stat() {
          return {
            isFile: () => true,
            dev: 1n,
            ino: 202n,
            size: BigInt(helper.length),
            mtimeNs: 1n,
            ctimeNs: 1n,
            nlink: 1n,
            mode: 0o100755n,
          };
        },
        async close() {
          assert(!closed.includes(id));
          closed.push(id);
          if (["read-close", "current-falsy"].includes(fault) && readFailed)
            throw secondary;
        },
      };
    },
    async readlink(file) {
      const match = /^\/proc\/self\/fd\/(\d+)\/(.+)$/.exec(file);
      assert(match);
      const pid = handles.get(Number(match[1])).pid;
      if (match[2] === "exe")
        return fault === "external"
          ? "/outside/foreign"
          : "/tmp/.mount_fixture/usr/lib/sortOfRemoteNG/sorng-cef-tls-acceptance.helper";
      const name = match[2].slice(3);
      assert(["user", "pid", "mnt"].includes(name));
      return `${name}:[${pid === 101 ? 1 : 2}]`;
    },
  };
  return {
    io,
    opened,
    closed,
    get statusReads() {
      return statusReads;
    },
    primary,
    expected: {
      format: "appimage",
      helper: {
        bytes: helper.length,
        sha256: createHash("sha256").update(helper).digest("hex"),
      },
    },
  };
}
test("actual owned proc observer holds admitted directories, pins executable and keeps only closed metadata", async () => {
  const fixture = procFixture();
  const report = await observeFixture(
    101,
    { remaining: () => 10000 },
    () => false,
    fixture.io,
    fixture.expected,
  );
  assert(report.complete);
  assert(namespaceAccepted(report, 1001));
  assert(report.bytesRead <= 65536);
  assert.equal(report.processes, 2);
  assert.equal(fixture.closed.length, fixture.opened.length);
  assert(!JSON.stringify(report).includes("do-not-retain.invalid"));
  assert.equal(
    report.facts[0].loadedHelperSha256,
    fixture.expected.helper.sha256,
  );
});
test("actual proc body denies foreign membership before status, reused identities and wrong loaded paths", async () => {
  for (const fault of ["foreign", "reused", "external", "count"]) {
    const fixture = procFixture(fault);
    await assert.rejects(
      observeFixture(
        101,
        { remaining: () => 10000 },
        () => false,
        fixture.io,
        fixture.expected,
      ),
      /LPF_/,
    );
    assert.equal(fixture.closed.length, fixture.opened.length, fault);
    if (fault === "foreign" || fault === "count")
      assert.equal(fixture.statusReads, 0, fault);
  }
});
test("actual proc read preserves the original error through all descriptor close failures", async () => {
  const fixture = procFixture("read-close");
  await assert.rejects(
    observeFixture(
      101,
      { remaining: () => 10000 },
      () => false,
      fixture.io,
      fixture.expected,
    ),
    (error) => error === fixture.primary,
  );
  assert.equal(fixture.closed.length, fixture.opened.length);
});
test("original budget denial joins every admitted proc handle without querying a child", async () => {
  const fixture = procFixture(),
    sentinel = new Error("ORIGINAL_DEADLINE");
  await assert.rejects(
    observeFixture(
      101,
      {
        remaining() {
          throw sentinel;
        },
      },
      () => false,
      fixture.io,
      fixture.expected,
    ),
    (error) => error === sentinel,
  );
  assert.equal(fixture.statusReads, 0);
  assert.equal(fixture.closed.length, fixture.opened.length);
});
test("read-only installed audit reuses genuine installer guards without invoking install", async (t) => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "package-audit-"),
  );
  try {
    const code = installedAuditProgram({ sha256: "a".repeat(64), bytes: 100 });
    assert(!code.includes("@@"));
    assert.match(code, /scope\['regular'\]\(s,\(0o4755,\)\)/);
    assert(!code.includes("scope['install']("));
    const python =
      process.platform === "win32"
        ? "C:/Users/Mariana/AppData/Local/Programs/Python/Python312/python.exe"
        : "python3";
    const file = path.join(root, "audit.py");
    await fs.writeFile(file, code);
    try {
      execFileSync(
        python,
        [
          "-I",
          "-B",
          "-c",
          "import ast,sys;ast.parse(open(sys.argv[1]).read());print('syntax')",
          file,
        ],
        { stdio: "pipe", timeout: 10000 },
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("owned Python unavailable");
        return;
      }
      throw error;
    }
    assert.throws(
      () => installedAuditProgram({ sha256: "forged", bytes: 100 }),
      /LPF_HELPER_PIN/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const repository = fileURLToPath(new URL("../..", import.meta.url));
const worker = path.join(repository, "scripts/cef-linux-package-fixture.mjs");
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
async function actualFixtureFunctions(dependencies = {}) {
  const source = await fs.readFile(worker, "utf8");
  const take = (start, end) =>
    source
      .slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
      .replace(/^export /, "")
      .replaceAll("fileURLToPath(import.meta.url)", JSON.stringify(worker));
  const functions = [
    take("async function physical(", "async function json("),
    take("async function measure(", "export function parseProcStat("),
    take("async function save(", "async function measure("),
    take("export async function command(", "async function publishedMetadata("),
    take("export async function fixtureActor(", "let commandQuiescent"),
  ];
  const values = {
    fs,
    constants,
    path,
    createHash,
    process,
    performance,
    ROOT: repository.replace(/[\\/]$/, ""),
    fixtureActorCommand,
    waitActorFile,
    observeFixture,
    need: (value, code) => {
      if (!value) throw new Error(code);
    },
    json: async (file) => JSON.parse(await fs.readFile(file, "utf8")),
    ...dependencies,
  };
  return new Function(
    ...Object.keys(values),
    `let reportBytes=0,commandQuiescent=false;${functions.join("\n")};return {command,fixtureActor,quiescent:()=>commandQuiescent};`,
  )(...Object.values(values));
}

test("fixed actor vectors deny arbitrary executable, role, package escape and unsupported formats", async () => {
  const root = path.resolve(".artifacts/closed-fixture");
  const plan = packageFixturePlan(root);
  assert.deepEqual(fixtureActorCommand(root, "sdk-fetch").args, plan.fetch);
  assert.deepEqual(
    fixtureActorCommand(root, "build-helper").args,
    plan.helperBuild,
  );
  assert.deepEqual(
    fixtureActorCommand(root, "build-tls").args,
    plan.fixtureBuild,
  );
  assert.equal(fixtureActorCommand(root, "deb-absent").expectedExit, 1);
  assert.equal(
    fixtureActorCommand(root, "audit-deb").executable,
    "/usr/bin/python3",
  );
  const pkg = {
    format: "deb",
    file: path.join(root, "packages/fixture.deb"),
    bytes: 1,
    sha256: "a".repeat(64),
  };
  assert.deepEqual(fixtureActorCommand(root, "install-deb", pkg).args, [
    "-n",
    "/usr/bin/apt-get",
    "install",
    "-y",
    pkg.file,
  ]);
  for (const bad of ["arbitrary", "../../outside", "native-rpm", "compiler"])
    assert.throws(() => fixtureActorCommand(root, bad), /LPF_ACTOR_ROLE/);
  for (const bad of [
    { ...pkg, file: path.join(root, "elsewhere.deb") },
    { ...pkg, format: "rpm" },
    { ...pkg, sha256: "bad" },
    { ...pkg, args: ["arbitrary"] },
  ])
    assert.throws(
      () => fixtureActorCommand(root, "install-deb", bad),
      /LPF_ACTOR_PACKAGE/,
    );
  assert.throws(
    () => fixtureActorCommand(root, "native-appimage", pkg, {}),
    /LPF_ACTOR_PACKAGE/,
  );
});

test("actual ready/gate wait handles immediate creation, abort, deadline and hardlink denial with closed watcher", async () => {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "fixture-gate-"),
  );
  try {
    const waiting = waitActorFile(directory, "ready.json", Date.now() + 2000);
    await fs.writeFile(
      path.join(directory, "ready.json"),
      JSON.stringify({ pid: 1 }),
    );
    assert.deepEqual(await waiting, { pid: 1 });
    const abort = new AbortController(),
      pending = waitActorFile(
        directory,
        "go.json",
        Date.now() + 2000,
        abort.signal,
      );
    abort.abort();
    await assert.rejects(pending, /LPF_ACTOR_ABORTED/);
    await assert.rejects(
      waitActorFile(directory, "go.json", Date.now() + 10),
      /LPF_ACTOR_DEADLINE/,
    );
    await assert.rejects(
      waitActorFile(directory, "other.json", Date.now() + 2000),
      /LPF_ACTOR_LEAF/,
    );
    await fs.link(
      path.join(directory, "ready.json"),
      path.join(directory, "go.json"),
    );
    await assert.rejects(
      waitActorFile(directory, "go.json", Date.now() + 2000),
      /LPF_FILE/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("actual consumer command uses the reviewed supervisor and real owned ready/gate files, preserving unknown-cleanup errors", async () => {
  for (const primary of [
    "success",
    null,
    0,
    undefined,
    new Error("original supervisor"),
  ]) {
    const root = await fs.mkdtemp(
      path.join(await fs.realpath(tmpdir()), "fixture-command-"),
    );
    try {
      await fs.mkdir(path.join(root, "actors"));
      await fs.mkdir(path.join(root, "logs"));
      const plan = packageFixturePlan(root),
        ledger = { bytes: 0, cap: 64 * 1024 ** 2 };
      let calls = 0;
      const actual = await actualFixtureFunctions({
        compileSlice: async (exe, args, options) => {
          calls++;
          assert.equal(exe, process.execPath);
          assert.equal(args[1], "--owned-actor");
          assert.equal(options.outputLedger, ledger);
          assert.ok(options.milliseconds > 0 && options.milliseconds <= 2000);
          if (primary !== "success") throw primary;
          const role = args[3],
            contextSha = args[4],
            directory = path.join(root, "actors", role),
            context = JSON.parse(
              await fs.readFile(path.join(directory, "context.json")),
            );
          assert.equal(
            contextSha,
            hash(await fs.readFile(path.join(directory, "context.json"))),
          );
          assert.equal(Object.hasOwn(context, "args"), false);
          assert.equal(Number.isSafeInteger(context.wallEnd), true);
          await fs.writeFile(
            path.join(directory, "ready.json"),
            JSON.stringify({ pid: 123, parent: process.pid, contextSha }),
          );
          await options.observeRoot(
            Object.freeze({
              pid: 123,
              parent: process.pid,
              start: "fixed-creation",
            }),
            { signal: new AbortController().signal, rootExited: () => false },
          );
          assert.equal(
            JSON.parse(await fs.readFile(path.join(directory, "go.json")))
              .contextSha,
            contextSha,
          );
          for (const suffix of ["stdout.log", "stderr.log", "outcome.json"])
            await fs.writeFile(
              path.join(options.logs, "checkpoint-compile." + suffix),
              "joined",
            );
          return { quiescent: true, exitCode: 0, outcome: "compiler-complete" };
        },
      });
      const run = actual.command(process.execPath, plan.fetch, {
        root,
        role: "sdk-fetch",
        env: {},
        budget: { phase: () => 2000, remaining: () => 2000 },
        maximum: 2000,
        ledger,
      });
      if (primary === "success") {
        await run;
        assert.equal(actual.quiescent(), true);
      } else {
        let caught = false;
        try {
          await run;
        } catch (error) {
          caught = true;
          assert.equal(error, primary);
        }
        assert.equal(caught, true);
        assert.equal(actual.quiescent(), false);
      }
      assert.equal(calls, 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  const source = await fs.readFile(worker, "utf8");
  assert.match(source, /!commandQuiescent\s*&&[\s\S]{0,120}throw error/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("export async function command("),
      source.indexOf("async function publishedMetadata("),
    ),
    /process\.kill|setTimeout|spawn\(/,
  );
});

test("actual fixed actor body preserves context/source/gate authority and only forwards the fixed tool vector", async () => {
  for (const mode of [
    "valid",
    "wrong-context",
    "extra-args",
    "changed-source",
    "wrong-gate",
    "hardlink",
  ]) {
    const parent = await fs.realpath(tmpdir()),
      root = path.join(parent, "sorng-linux-package-fixture-" + randomUUID());
    await fs.mkdir(root);
    try {
      const directory = path.join(root, "actors/sdk-fetch");
      await fs.mkdir(directory, { recursive: true });
      const fake = {
        platform: "linux",
        getuid: () => 1000,
        pid: 123,
        ppid: process.pid,
        env: { RUNNER_TEMP: parent },
        execPath: process.execPath,
      };
      const context = {
        root,
        role: "sdk-fetch",
        parentPid: process.pid,
        wallEnd: Date.now() + 2000,
        sourceSha: hash(await fs.readFile(worker)),
        pkg: null,
        lock: null,
        audit: null,
      };
      if (mode === "extra-args") context.args = ["arbitrary"];
      if (mode === "changed-source") context.sourceSha = "0".repeat(64);
      const file = path.join(directory, "context.json"),
        raw = Buffer.from(JSON.stringify(context));
      await fs.writeFile(file, raw);
      const contextSha = hash(raw);
      if (mode === "hardlink")
        await fs.link(file, path.join(directory, "alias"));
      await fs.writeFile(
        path.join(directory, "go.json"),
        JSON.stringify({
          pid: 123,
          parent: process.pid,
          start: "fixed-creation",
          contextSha: mode === "wrong-gate" ? "f".repeat(64) : contextSha,
        }),
      );
      let calls = 0;
      const actual = await actualFixtureFunctions({
        process: fake,
        spawn: (exe, args, options) => {
          calls++;
          const expected = fixtureActorCommand(root, "sdk-fetch");
          assert.equal(exe, expected.executable);
          assert.deepEqual(args, expected.args);
          assert.equal(options.shell, false);
          const child = new EventEmitter();
          queueMicrotask(() => child.emit("close", 7, null));
          return child;
        },
      });
      if (mode === "valid") {
        await actual.fixtureActor(root, "sdk-fetch", contextSha);
        assert.equal(fake.exitCode, 7);
        assert.equal(calls, 1);
      } else {
        await assert.rejects(
          actual.fixtureActor(
            root,
            "sdk-fetch",
            mode === "wrong-context" ? "0".repeat(64) : contextSha,
          ),
          /LPF_/,
        );
        assert.equal(calls, 0);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("actual ready waiter preserves falsy read errors through close failure and denies close-only failure", async () => {
  const source = await fs.readFile(worker, "utf8"),
    start = source.indexOf("export async function waitActorFile("),
    end = source.indexOf("export async function fixtureActor(", start);
  const body = source.slice(start, end).replace(/^export /, "");
  for (const primary of [
    null,
    0,
    undefined,
    new Error("private original read"),
  ]) {
    const secondary = new Error("private close"),
      watcher = new EventEmitter();
    watcher.close = () => {
      throw secondary;
    };
    const actual = new Function(
      "path",
      "watch",
      "json",
      "need",
      `return (${body})`,
    )(
      path,
      () => watcher,
      async () => {
        throw primary;
      },
      (value, code) => {
        if (!value) throw new Error(code);
      },
    );
    let caught = false;
    try {
      await actual("owned", "ready.json", Date.now() + 1000);
    } catch (error) {
      caught = true;
      assert.equal(error, primary);
    }
    assert.equal(caught, true);
  }
  const secondary = new Error("close-only"),
    watcher = new EventEmitter();
  watcher.close = () => {
    throw secondary;
  };
  const actual = new Function(
    "path",
    "watch",
    "json",
    "need",
    `return (${body})`,
  )(
    path,
    () => watcher,
    async () => ({ pid: 1 }),
    (value, code) => {
      if (!value) throw new Error(code);
    },
  );
  await assert.rejects(
    actual("owned", "ready.json", Date.now() + 1000),
    (error) => error === secondary,
  );
});

async function waiterJoinFixture(body, trigger) {
  const directory = await fs.mkdtemp(
      path.join(await fs.realpath(tmpdir()), "fixture-read-join-"),
    ),
    file = path.join(directory, "ready.json");
  await fs.writeFile(file, '{"pid":1}');
  let releaseRead, releaseClose, entered, readDone, fullyClosed, deadline;
  const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    }),
    closeGate = new Promise((resolve) => {
      releaseClose = resolve;
    }),
    started = new Promise((resolve) => {
      entered = resolve;
    }),
    readCompleted = new Promise((resolve) => {
      readDone = resolve;
    }),
    closedWitness = new Promise((resolve) => {
      fullyClosed = resolve;
    });
  let fdClosed = false,
    settled = false,
    error;
  const watcher = new EventEmitter();
  watcher.close = () => queueMicrotask(() => watcher.emit("close"));
  const actual = new Function(
    "path",
    "watch",
    "json",
    "need",
    "setTimeout",
    "clearTimeout",
    `return (${body})`,
  )(
    path,
    () => watcher,
    async () => {
      const fd = await fs.open(
        file,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      entered();
      try {
        await readGate;
        return JSON.parse(await fd.readFile("utf8"));
      } finally {
        readDone();
        await closeGate;
        await fd.close();
        fdClosed = true;
        fullyClosed();
      }
    },
    (value, code) => {
      if (!value) throw new Error(code);
    },
    (callback, milliseconds) => {
      assert(milliseconds > 0 && milliseconds <= 2000);
      deadline = callback;
      return 1;
    },
    () => {},
  );
  const abort = new AbortController(),
    pending = actual(directory, "ready.json", Date.now() + 1000, abort.signal);
  pending.then(
    () => {
      settled = true;
    },
    (caught) => {
      settled = true;
      error = caught;
    },
  );
  try {
    await started;
    if (trigger === "abort") abort.abort();
    else deadline();
    await new Promise((resolve) => setImmediate(resolve));
    const settledBeforeRead = settled;
    assert.equal(fdClosed, false);
    releaseRead();
    await readCompleted;
    await new Promise((resolve) => setImmediate(resolve));
    const settledBeforeClose = settled;
    assert.equal(fdClosed, false);
    releaseClose();
    await closedWitness;
    await pending.catch(() => {});
    return {
      settledBeforeRead,
      settledBeforeClose,
      fdClosed,
      firstCode: error?.message,
    };
  } finally {
    releaseRead();
    releaseClose();
    await closedWitness;
    await pending.catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("actual ready waiter never reports join before its in-flight read and held descriptor close after abort or deadline", async () => {
  const source = await fs.readFile(worker, "utf8"),
    start = source.indexOf("export async function waitActorFile("),
    end = source.indexOf("export async function fixtureActor(", start),
    body = source.slice(start, end).replace(/^export /, "");
  for (const trigger of ["abort", "deadline"]) {
    const result = await waiterJoinFixture(body, trigger);
    assert.equal(result.settledBeforeRead, false);
    assert.equal(result.settledBeforeClose, false);
    assert.equal(result.fdClosed, true);
    assert.equal(
      result.firstCode,
      trigger === "abort" ? "LPF_ACTOR_ABORTED" : "LPF_ACTOR_DEADLINE",
    );
  }
});

test("actual current-stat observer catch preserves falsy read errors through every descriptor close", async () => {
  for (const primary of [null, undefined, 0]) {
    const fixture = procFixture("current-falsy", primary);
    let caught = false;
    try {
      await observeFixture(
        101,
        { remaining: () => 1000 },
        () => false,
        fixture.io,
        fixture.expected,
      );
    } catch (error) {
      caught = true;
      assert.equal(error, primary);
    }
    assert.equal(caught, true);
    assert.equal(fixture.statusReads, 0);
    assert.equal(fixture.closed.length, fixture.opened.length);
  }
});
