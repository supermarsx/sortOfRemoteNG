// Benign Linux process proof only. No source, GN, compiler or migration grant.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import vm from "node:vm";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "../../..");
const REF = "refs/heads/codex/linux-gn-supervision-proof-20261102";
const WORKFLOW = ".github/workflows/cef-linux-gn-supervision-proof.yml";
const FIXTURE = "tests/fixtures/cef/linux_gn_supervision_proof.mjs";
const TEST = "tests/tooling/cefLinuxGnSupervisionProof.node-test.mjs";
const RUNTIME = "scripts/cef-runtime-ci.mjs";
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
const PINS = [
  [
    "scripts/cef-hosted-bootstrap.mjs",
    28568,
    "f42de81eead9e5507e5484097bffad5f6a22c7472dddf2c5b4837a88d0e8d625",
  ],
  [
    "scripts/cef-hosted-provision.mjs",
    32293,
    "6237f11a57452bd40f957c3df06a8f22b784df547069498598a5d5264f94c8f1",
  ],
  [
    CORE,
    232441,
    "fa669f8e3bae755bcac623cbb9c567665405d58fbb5ca3d2130331101005947f",
  ],
  [
    "scripts/lib/cef-mac-sdk-inventory.mjs",
    9975,
    "817d5d72db4c24cd1a3a49ff3413553df828a85b3bb22aa8db4de6839d671923",
  ],
  [
    "scripts/lib/cef-mac-source-metadata.mjs",
    52286,
    "8b6fb0fc8f98eb6f5f7baf9cc66ec92ac86eb4bc3531865466fe628f65a76617",
  ],
  [
    RUNTIME,
    76797,
    "12fa593fb734ddbfad46e2a89c1d615c3542bf0f27bb64dce368de4a260e0831",
  ],
  [
    "scripts/browser-runtime-package.mjs",
    45031,
    "6597617158786afe2c10bccea866f495a744c64b41cf0ab6c97c6e1cd73477ff",
  ],
  [
    "scripts/cef-custom-artifact-inventory.mjs",
    19378,
    "cc80cc108ca2ac6b498a339f659ccaecd9e9510966aef63f484e8d28e7e4d6c8",
  ],
  [
    "scripts/lib/browser-custom-runtime.mjs",
    69294,
    "3c9a1b58222e234447a09c87c68e80247440d85b871f177758ee1ae5f879ee8b",
  ],
  [
    "scripts/lib/browser-runtime-release.mjs",
    6093,
    "3c2bb26011d020de68c3eb162116843cde3acf9e8b603e86d31c961da528d810",
  ],
];
const CASES = Object.freeze([
  "natural-zero",
  "nonzero",
  "timeout",
  "cancel",
  "detached-writer",
  "pipe-holder",
  "output-bound",
  "reserve",
  "setup-clock",
  "late-postcheck",
  "delayed-close",
  "direct-natural-zero",
  "direct-nonzero",
  "direct-output-bound",
]);
const ROLES = new Set([
  "natural-zero",
  "nonzero",
  "timeout",
  "cancel",
  "detached-writer",
  "pipe-holder",
  "output-bound",
  "foreign",
  "child-natural",
  "child-writer",
  "child-pipe",
  "child-hold",
]);
const FALSE_FLAGS = Object.freeze({
  vendorGnExecuted: false,
  sourceAcquisition: false,
  sourceRestarted: false,
  sourceInputsRevalidated: false,
  productionReadinessIssued: false,
  sourceMigrationAdmitted: false,
  compilerExecuted: false,
  sdkProduced: false,
  nativeAcceptance: false,
  runtimeReady: false,
  exactImageAdmission: false,
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ordinary = (s) =>
  s.isFile() && s.nlink === 1n && s.uid === BigInt(process.getuid());
const physical = (s) => [s.dev, s.ino, s.mode, s.uid].map(String).join(":");
const full = (s) =>
  physical(s) + ":" + [s.size, s.nlink, s.mtimeNs, s.ctimeNs].join(":");
let running = false,
  last = null;
// BEGIN fixed failure diagnostic state
let lastCaseDiagnostic = null;
// END fixed failure diagnostic state

export function authority(facts, platform, arch) {
  assert(platform === "linux" && arch === "x64", "PROOF_HOST");
  for (const [key, value] of Object.entries({
    ImageOS: "ubuntu24",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: REF,
    GITHUB_WORKFLOW_REF: `supermarsx/sortOfRemoteNG/${WORKFLOW}@${REF}`,
  }))
    assert.equal(facts[key], value, "PROOF_SCOPE");
  assert(
    /^[a-f0-9]{40}$/.test(facts.GITHUB_SHA ?? "") &&
      facts.GITHUB_WORKFLOW_SHA === facts.GITHUB_SHA,
    "PROOF_HEAD",
  );
  assert(
    /^[0-9]{8}\.[0-9]{1,6}\.[0-9]{1,6}$/.test(facts.ImageVersion ?? ""),
    "PROOF_IMAGE_OBSERVATION",
  );
  assert(
    /^[1-9][0-9]{0,15}$/.test(facts.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]{0,5}$/.test(facts.GITHUB_RUN_ATTEMPT ?? ""),
    "PROOF_RUN",
  );
  return Object.freeze({
    source: "process-and-runner-environment",
    platform,
    architecture: arch,
    imageOS: facts.ImageOS,
    imageVersion: facts.ImageVersion,
    runnerEnvironment: facts.RUNNER_ENVIRONMENT,
    githubActions: true,
  });
}

export function originalEnd(started, wall, monotonic) {
  assert(/^[0-9]{13}$/.test(started ?? ""), "PROOF_START");
  const start = Number(started);
  assert(Number.isSafeInteger(start) && start <= wall, "PROOF_START");
  const remaining = Math.min(160000, start + 300000 - wall - 30000);
  assert(remaining > 40000, "PROOF_LEASE");
  return monotonic + remaining;
}

export function kernelBlocks(source) {
  assert.equal(Buffer.byteLength(source), PINS[5][1], "PROOF_RUNTIME_BYTES");
  assert.equal(sha(source), PINS[5][2], "PROOF_RUNTIME_HASH");
  return [
    [
      "inactive Linux fixed GN supervision",
      "880cd49ba8101476b036fd9c2712c08a569136ae674af88dd96be21676caf15a",
    ],
    [
      "inactive Linux genuine source owner",
      "5a9c44c51a15f044f7c157569ad81ed17116b5957ce43a609972f54f62830758",
    ],
  ].map(([name, expected]) => {
    const a = `// BEGIN ${name}\n`,
      b = `// END ${name}\n`;
    assert.equal(source.split(a).length, 2);
    assert.equal(source.split(b).length, 2);
    const body = source.slice(source.indexOf(a), source.indexOf(b) + b.length);
    assert.equal(sha(body), expected, "PROOF_BODY_HASH");
    return body;
  });
}

function check(end) {
  assert(performance.now() < end, "PROOF_DEADLINE");
}
async function within(work, end) {
  check(end);
  let timer;
  const promise = Promise.resolve().then(work);
  void promise.catch(() => {});
  try {
    const value = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("PROOF_DEADLINE")),
          Math.max(1, end - performance.now()),
        );
      }),
    ]);
    check(end);
    return value;
  } finally {
    clearTimeout(timer);
  }
}
async function delay(ms, end) {
  await within(() => new Promise((resolve) => setTimeout(resolve, ms)), end);
}
async function held(file, cap, end) {
  return within(async () => {
    assert.equal(await fs.realpath(file), file, "PROOF_ALIAS");
    const before = await fs.lstat(file, { bigint: true });
    assert(ordinary(before) && before.size <= BigInt(cap), "PROOF_FILE");
    const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let failed = false;
    try {
      assert.equal(
        full(await fd.stat({ bigint: true })),
        full(before),
        "PROOF_FILE_ID",
      );
      const raw = await fd.readFile();
      assert(
        raw.length <= cap &&
          full(await fd.stat({ bigint: true })) === full(before) &&
          full(await fs.lstat(file, { bigint: true })) === full(before),
        "PROOF_CHANGED",
      );
      return raw;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await fd.close();
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }, end);
}

// Closed bootstrap witness / ownership oracle. These are the only non-Node children.
async function fixedChild(executable, args, env, input, cap, end) {
  check(end);
  const child = spawn(executable, args, {
    cwd: ROOT,
    env,
    shell: false,
    windowsHide: true,
    stdio: [input === null ? "ignore" : "pipe", "pipe", "ignore"],
  });
  let bytes = 0,
    code = null,
    exited = false,
    closed = false,
    failure,
    failed = false;
  const chunks = [],
    stop = (error) => {
      if (!failed) {
        failed = true;
        failure = error;
      }
      if (!exited) child.kill("SIGKILL");
    };
  child.on("error", stop);
  child.stdout.on("error", stop);
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > cap) stop(Error("PROOF_OUTPUT"));
    else chunks.push(chunk);
  });
  const joined = new Promise((resolve) =>
    child.once("close", (value) => {
      code = value;
      closed = true;
      resolve();
    }),
  );
  child.once("exit", () => {
    exited = true;
  });
  if (input !== null) {
    child.stdin.on("error", stop);
    child.stdin.end(input);
  }
  try {
    await within(() => joined, end);
    if (failed) throw failure;
    assert(closed && code === 0, "PROOF_CHILD");
    return Buffer.concat(chunks);
  } finally {
    if (!closed) {
      if (!exited) child.kill("SIGKILL");
      child.stdout.destroy();
      child.stdin?.destroy();
      child.unref();
    }
  }
}
const bootstrapEnv = () => ({ PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" });

async function sourceWitness(end) {
  const head = (
    await fixedChild(
      "/usr/bin/git",
      ["rev-parse", "HEAD"],
      bootstrapEnv(),
      null,
      128,
      Math.min(end, performance.now() + 2000),
    )
  )
    .toString()
    .trim();
  assert.equal(head, process.env.GITHUB_SHA, "PROOF_HEAD");
  const paths = [
    ...PINS.map((row) => row[0]),
    FIXTURE,
    TEST,
    WORKFLOW,
    ".node-version",
  ].sort();
  const input = paths.map((name) => `${head}:${name}\n`).join("");
  const body = await fixedChild(
    "/usr/bin/git",
    ["cat-file", "--batch"],
    bootstrapEnv(),
    input,
    2 * 1024 ** 2,
    Math.min(end, performance.now() + 5000),
  );
  let offset = 0;
  const rows = [],
    contents = new Map();
  for (const name of paths) {
    const newline = body.indexOf(10, offset);
    assert(newline >= offset && newline - offset < 128, "PROOF_BLOB_FRAME");
    const match = /^([a-f0-9]{40}) blob ([0-9]{1,7})$/.exec(
      body.subarray(offset, newline).toString("ascii"),
    );
    assert(match, "PROOF_BLOB_FRAME");
    const size = Number(match[2]);
    assert(size <= 1024 ** 2, "PROOF_BLOB_SIZE");
    offset = newline + 1;
    const raw = body.subarray(offset, offset + size);
    offset += size;
    assert(
      raw.length === size &&
        body[offset++] === 10 &&
        createHash("sha1")
          .update(Buffer.from(`blob ${size}\0`))
          .update(raw)
          .digest("hex") === match[1],
      "PROOF_BLOB_HASH",
    );
    const local = await held(path.join(ROOT, name), 1024 ** 2, end);
    assert(local.equals(raw), "PROOF_WORKING_BYTES");
    const pin = PINS.find((row) => row[0] === name);
    if (pin) assert(size === pin[1] && sha(raw) === pin[2], "PROOF_PIN");
    rows.push({ path: name, bytes: size, sha256: sha(raw) });
    contents.set(name, raw.toString("utf8"));
  }
  assert.equal(offset, body.length, "PROOF_BLOB_TRAILING");
  return { head, rows, contents, sha256: sha(JSON.stringify(rows)) };
}

async function ownedRoot(end) {
  const temp = process.env.RUNNER_TEMP;
  assert(
    typeof temp === "string" &&
      path.isAbsolute(temp) &&
      (await fs.realpath(temp)) === temp,
    "PROOF_TEMP",
  );
  const parent = await fs.lstat(temp, { bigint: true });
  assert(
    parent.isDirectory() && parent.uid === BigInt(process.getuid()),
    "PROOF_TEMP",
  );
  const root = path.join(temp, "cef-linux-gn-owned-proof-" + randomUUID());
  await fs.mkdir(root, { mode: 0o700 });
  const fd = await fs.open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    ),
    initial = await fd.stat({ bigint: true });
  const identity = physical(initial);
  assert((initial.mode & 0o777n) === 0o700n, "PROOF_ROOT");
  const directories = new Map([[root, identity]]);
  let active = true;
  const assertActive = () => {
    check(end);
    assert(active, "PROOF_RETIRED");
  };
  const physicalCurrent = async () => {
    check(end);
    assert(
      (await fs.realpath(temp)) === temp &&
        physical(await fs.lstat(temp, { bigint: true })) === physical(parent) &&
        (await fs.realpath(root)) === root &&
        physical(await fs.lstat(root, { bigint: true })) === identity &&
        physical(await fd.stat({ bigint: true })) === identity,
      "PROOF_ROOT_CHANGED",
    );
  };
  const directoryCurrent = async (directory) => {
    await physicalCurrent();
    let current = directory;
    while (current !== root) {
      assert(
        current.startsWith(root + "/") &&
          directories.has(current) &&
          (await fs.realpath(current)) === current &&
          physical(await fs.lstat(current, { bigint: true })) ===
            directories.get(current),
        "PROOF_DIRECTORY_CHANGED",
      );
      current = path.dirname(current);
    }
  };
  return {
    root,
    fd,
    identity,
    directories,
    observers: new Set(),
    async mkdir(directory) {
      assertActive();
      assert(
        directory.startsWith(root + "/") && !directories.has(directory),
        "PROOF_DIRECTORY_ROLE",
      );
      const parentPath = path.dirname(directory);
      await directoryCurrent(parentPath);
      assert(
        directories.get(parentPath) ===
          physical(await fs.lstat(parentPath, { bigint: true })),
        "PROOF_DIRECTORY_PARENT",
      );
      assertActive();
      await fs.mkdir(directory, { mode: 0o700 });
      const info = await fs.lstat(directory, { bigint: true });
      assert(
        info.isDirectory() &&
          info.uid === BigInt(process.getuid()) &&
          (info.mode & 0o777n) === 0o700n &&
          (await fs.realpath(directory)) === directory,
        "PROOF_DIRECTORY",
      );
      directories.set(directory, physical(info));
    },
    retire() {
      active = false;
    },
    assertActive,
    cleanupCurrent: physicalCurrent,
    directoryCurrent,
    async current() {
      assertActive();
      await physicalCurrent();
      assertActive();
    },
  };
}

async function actorMain(role, directory) {
  authority(process.env, process.platform, process.arch);
  assert(ROLES.has(role) && process.argv.length === 5, "PROOF_ACTOR_ARGS");
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert(
    directory === path.resolve(directory) &&
      directory.startsWith(temp + "/cef-linux-gn-owned-proof-") &&
      /^cef-linux-gn-owned-proof-[a-f0-9-]{36}\/case-[a-z-]+(?:\/attempt-(?:initial|revalidation))?$/.test(
        path.relative(temp, directory),
      ),
    "PROOF_ACTOR_ROOT",
  );
  assert.equal(await fs.realpath(directory), directory, "PROOF_ACTOR_ALIAS");
  const info = await fs.lstat(directory);
  assert(
    info.isDirectory() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o700,
    "PROOF_ACTOR_OWNER",
  );
  const end = Number(process.env.CEF_LINUX_GN_ACTOR_END_MS);
  assert(
    Number.isSafeInteger(end) && end > Date.now() && end - Date.now() <= 160000,
    "PROOF_ACTOR_END",
  );
  const expire = setTimeout(
    () => process.exit(97),
    Math.max(1, end - Date.now()),
  );
  const leaf = (name) => path.join(directory, name);
  const facts = { pid: process.pid, parent: process.ppid };
  await fs.writeFile(leaf(role + ".json"), JSON.stringify(facts), {
    flag: "wx",
    mode: 0o600,
  });
  if (role === "child-natural") {
    setInterval(async () => {
      try {
        await fs.access(leaf("release-child"));
        process.exit(0);
      } catch (error) {
        if (error.code !== "ENOENT") process.exit(92);
      }
    }, 10);
    return;
  }
  if (role.startsWith("child-") || role === "foreign") {
    let count = 0,
      busy = false;
    if (role === "child-writer")
      await fs.writeFile(leaf("counter"), "0", { flag: "wx", mode: 0o600 });
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        if (role === "child-writer") {
          await fs.writeFile(leaf("counter"), String(++count));
          if (process.ppid !== facts.parent)
            await fs
              .writeFile(leaf("reparented"), "yes", { flag: "wx" })
              .catch((error) => {
                if (error.code !== "EEXIST") throw error;
              });
        }
      } catch {
        process.exit(96);
      } finally {
        busy = false;
      }
    }, 10);
    return;
  }
  if (role === "output-bound") {
    const block = Buffer.alloc(65536, 120);
    let remaining = 64 * 1024 ** 2 + 1;
    while (remaining) {
      const chunk = block.subarray(0, Math.min(remaining, block.length));
      remaining -= chunk.length;
      if (!process.stdout.write(chunk))
        await new Promise((resolve) => process.stdout.once("drain", resolve));
    }
    return;
  }
  const childRole =
    role === "natural-zero"
      ? "child-natural"
      : role === "detached-writer"
        ? "child-writer"
        : role === "pipe-holder"
          ? "child-pipe"
          : "child-hold";
  if (role !== "nonzero") {
    const child = spawn(
      process.execPath,
      [SELF, "--actor", childRole, directory],
      {
        env: process.env,
        shell: false,
        detached: role === "detached-writer",
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    child.on("error", () => process.exit(95));
    if (role === "natural-zero") {
      child.once("close", (code) => process.exit(code === 0 ? 0 : 94));
      return;
    }
  }
  const tick = setInterval(async () => {
    try {
      await fs.access(leaf("release-root"));
      clearInterval(tick);
      clearTimeout(expire);
      process.exit(role === "nonzero" ? 7 : 0);
    } catch (error) {
      if (error.code !== "ENOENT") process.exit(93);
    }
  }, 10);
}

async function ps(core, end) {
  const raw = await fixedChild(
    "/bin/ps",
    ["-axo", "pid=,ppid=,lstart="],
    bootstrapEnv(),
    null,
    4 * 1024 ** 2,
    Math.min(end, performance.now() + 2000),
  );
  return core.processRows(raw.toString("utf8")); // Raw rows are never retained.
}
async function poll(work, end) {
  for (;;) {
    check(end);
    const value = await work();
    if (value) return value;
    await delay(10, end);
  }
}
async function optional(file, end) {
  try {
    return await held(file, 4096, end);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function diagnostic(message) {
  const prefix = "[cef-engineering-checkpoint] compile-supervision=";
  assert(
    typeof message === "string" &&
      message.startsWith(prefix) &&
      message.length < 16384,
    "PROOF_SUPERVISOR_DIAGNOSTIC",
  );
  const value = JSON.parse(message.slice(prefix.length));
  for (const key of [
    "rootExited",
    "pipeClosed",
    "monitorJoined",
    "probesJoined",
    "outputsJoined",
    "outputsSettled",
    "outputHandlesClosed",
    "cohortQuiet",
  ])
    assert(typeof value[key] === "boolean", "PROOF_SUPERVISOR_DIAGNOSTIC");
  assert(
    Number.isSafeInteger(value.observedProcesses) &&
      value.observedProcesses >= 0 &&
      value.observedProcesses <= 4096,
    "PROOF_SUPERVISOR_DIAGNOSTIC",
  );
  return value;
}
function joined(value) {
  return (
    value &&
    [
      "rootExited",
      "pipeClosed",
      "monitorJoined",
      "probesJoined",
      "outputsJoined",
      "outputsSettled",
      "outputHandlesClosed",
      "cohortQuiet",
    ].every((key) => value[key] === true)
  );
}

function outputBoundClosed(value) {
  return (
    value !== null &&
    value?.phase === "denied" &&
    value.failureStage === "output-bound" &&
    value.outputsJoined === false &&
    [
      "rootExited",
      "pipeClosed",
      "monitorJoined",
      "probesJoined",
      "outputsSettled",
      "outputHandlesClosed",
      "cohortQuiet",
    ].every((key) => value[key] === true)
  );
}

const DIRECT_ROLES = Object.freeze({
  "direct-natural-zero": "natural-zero",
  "direct-nonzero": "nonzero",
  "direct-output-bound": "output-bound",
});
function outputBoundCase(id) {
  return id === "output-bound" || id === "direct-output-bound";
}
async function directActorHandshake(role, attempt, owned, end, pids) {
  assert(Object.values(DIRECT_ROLES).includes(role), "PROOF_DIRECT_ROLE");
  const names = ["claimed", role + ".json"];
  if (role === "natural-zero") names.push("child-natural.json");
  const handles = [],
    witnesses = [];
  let failed = false,
    first,
    active = true;
  try {
    const operation = (async () => {
      await poll(async () => {
        await owned.current();
        await owned.directoryCurrent(attempt);
        try {
          for (const name of names) await fs.lstat(path.join(attempt, name));
          return true;
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      }, end);
      for (const name of names) {
        check(end);
        await owned.directoryCurrent(attempt);
        const file = path.join(attempt, name);
        assert.equal(await fs.realpath(file), file, "PROOF_DIRECT_ALIAS");
        const before = await fs.lstat(file, { bigint: true });
        assert(
          ordinary(before) && before.size > 0n && before.size <= 4096n,
          "PROOF_DIRECT_FILE",
        );
        const fd = await fs.open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        if (!active) {
          const closing = Promise.resolve().then(() => fd.close());
          closing.catch(() => {});
          throw Error("PROOF_DIRECT_EXPIRED");
        }
        handles.push(fd);
        assert.equal(
          full(await fd.stat({ bigint: true })),
          full(before),
          "PROOF_DIRECT_CHANGED",
        );
        const buffer = Buffer.alloc(4097);
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
        assert(bytesRead === Number(before.size), "PROOF_DIRECT_FILE");
        const raw = buffer.subarray(0, bytesRead);
        witnesses.push({ file, fd, stamp: full(before), raw });
      }
      const current = async () => {
        check(end);
        await owned.current();
        await owned.directoryCurrent(attempt);
        for (const row of witnesses)
          assert(
            full(await row.fd.stat({ bigint: true })) === row.stamp &&
              full(await fs.lstat(row.file, { bigint: true })) === row.stamp &&
              (await fs.realpath(row.file)) === row.file,
            "PROOF_DIRECT_CHANGED",
          );
        check(end);
      };
      await current();
      const claim = witnesses[0].raw.toString();
      assert(/^[1-9][0-9]{0,9}$/.test(claim), "PROOF_DIRECT_CLAIM");
      const root = JSON.parse(witnesses[1].raw);
      const actor = (value, parent) => {
        assert(
          value &&
            Object.keys(value).sort().join(":") === "parent:pid" &&
            Number.isSafeInteger(value.pid) &&
            value.pid > 1 &&
            value.parent === parent &&
            !pids.has(value.pid),
          "PROOF_DIRECT_LINEAGE",
        );
        pids.add(value.pid);
      };
      actor(root, process.pid);
      assert.equal(root.pid, Number(claim), "PROOF_DIRECT_CLAIM");
      if (role === "natural-zero")
        actor(JSON.parse(witnesses[2].raw), root.pid);
      if (role !== "output-bound") {
        // Scheduling only: the actual supervisor must independently prove every
        // join. This hold neither observes nor acknowledges its initial snapshot.
        await delay(2000, end);
        await current();
        await fs.writeFile(
          path.join(
            attempt,
            role === "natural-zero" ? "release-child" : "release-root",
          ),
          "release",
          { flag: "wx", mode: 0o600 },
        );
        await current();
      }
    })();
    operation.catch(() => {});
    await within(() => operation, end);
  } catch (error) {
    failed = true;
    first = error;
  } finally {
    active = false;
    // Close owners are attached even when the original work end has expired.
    const closing = Promise.allSettled(
      handles.reverse().map((fd) => Promise.resolve().then(() => fd.close())),
    );
    try {
      const results = await within(() => closing, end);
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
    }
  }
  if (failed) throw first;
}
async function directCompile(core, exe, args, options, coordinate, joins, end) {
  assert(
    ["observeRoot", "out", "censusFactory"].every(
      (key) => !Object.hasOwn(options, key),
    ),
    "PROOF_DIRECT_OPTIONS",
  );
  const work = Promise.resolve().then(() =>
    core.compileSlice(exe, args, {
      ...options,
      outputLedger: { ...options.outputLedger },
    }),
  );
  work.catch(() => {});
  const handshake = Promise.resolve().then(coordinate);
  handshake.catch(() => {});
  joins.push(handshake);
  const results = await within(
    () => Promise.allSettled([work, handshake]),
    end,
  );
  // A later fixture cleanup/coordinator error cannot replace the actual
  // supervisor's original rejection, including a falsy reason.
  if (results[0].status === "rejected") throw results[0].reason;
  if (results[1].status === "rejected") throw results[1].reason;
  return results[0].value;
}

async function caseRun(id, owned, witness, core, end, known) {
  const direct = Object.hasOwn(DIRECT_ROLES, id);
  await owned.current();
  const directory = path.join(owned.root, "case-" + id);
  await owned.mkdir(directory);
  const attempts = [
    path.join(directory, "attempt-initial"),
    path.join(directory, "attempt-revalidation"),
  ];
  for (const attempt of attempts) await owned.mkdir(attempt);
  let activeAttempt;
  const parentStamp = physical(await fs.lstat(directory, { bigint: true }));
  const logs = path.join(directory, "logs");
  await owned.mkdir(logs);
  const naturalRole = direct
    ? DIRECT_ROLES[id]
    : ["reserve", "setup-clock", "late-postcheck", "delayed-close"].includes(id)
      ? "natural-zero"
      : id;
  const phaseEnd = Math.min(
    end,
    performance.now() + (id === "timeout" ? 31500 : 36000),
  );
  const remaining = () => Math.min(end, phaseEnd) - performance.now();
  const env = {
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
    RUNNER_TEMP: process.env.RUNNER_TEMP,
    CEF_LINUX_GN_ACTOR_END_MS: String(
      Date.now() + Math.floor(end - performance.now()),
    ),
  };
  if (process.env.RUNNER_TRACKING_ID)
    env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
  // Public GitHub facts are required by fixed actor authority, not API tokens.
  for (const key of [
    "ImageOS",
    "ImageVersion",
    "GITHUB_ACTIONS",
    "RUNNER_ENVIRONMENT",
    "GITHUB_REPOSITORY_VISIBILITY",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
  ])
    env[key] = process.env[key];
  // The wrapper must reject GitHub-prefixed credentials. Actor facts instead
  // travel in a fixed file read by this proof-only Node launcher below.
  const factsPath = path.join(directory, "actor-environment.json");
  await fs.writeFile(factsPath, JSON.stringify(env), {
    flag: "wx",
    mode: 0o600,
  });
  const childEnv = {
    PATH: env.PATH,
    TZ: "UTC",
    RUNNER_TEMP: env.RUNNER_TEMP,
    CEF_LINUX_GN_ACTOR_END_MS: env.CEF_LINUX_GN_ACTOR_END_MS,
  };
  if (env.RUNNER_TRACKING_ID)
    childEnv.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID;
  let summary = null,
    diagnosticFailure,
    observerEntered = false,
    spawned = 0,
    closeAttempts = 0,
    releaseClose;
  // The original executed cases retain their supported creation observer.
  // Direct cases instead coordinate fixed actors through owned files only.
  const assisted = !direct && !["reserve", "setup-clock"].includes(id);
  const stateContext = {},
    events = [],
    fdJoins = [],
    directJoins = [],
    directPids = new Set();
  let actorHandshakeJoined = null;
  const capture = Object.freeze({
    python: process.execPath,
    args: Object.freeze([SELF, "--launch", naturalRole, directory]),
    cwd: ROOT,
    env: Object.freeze(childEnv),
    logs,
    remaining: id === "reserve" ? () => 30000 : remaining,
    hostClock: Object.freeze({
      CEF_ENGINEERING_JOB_STARTED_MS: process.env.CEF_LINUX_GN_PROOF_STARTED_MS,
    }),
    binding: Object.freeze({ proofOnly: true }),
  });
  const beforeConsole = console.error;
  const cancellation = Error("PROOF_FIXED_CANCEL");
  let rejectCallback,
    revokedBeforeAbort = false;
  const realmFs = {
    realpath: fs.realpath,
    mkdir: (directory) => owned.mkdir(directory),
    lstat: async (...args) => {
      if (id === "setup-clock" && !events.includes("setup-delay")) {
        events.push("setup-delay");
        await delay(Math.max(1, remaining() - 29990), end);
      }
      if (
        id === "late-postcheck" &&
        summary &&
        !events.includes("post-delay")
      ) {
        events.push("post-delay");
        await delay(Math.max(1, remaining() + 5), end);
      }
      return fs.lstat(...args);
    },
    open: async (...args) => {
      const handle = await fs.open(...args);
      let attempted = false;
      return {
        stat: (options) => handle.stat(options),
        close: () => {
          assert(!attempted, "PROOF_FD_CLOSE_ONCE");
          attempted = true;
          closeAttempts++;
          if (id !== "delayed-close") {
            const closing = handle.close();
            fdJoins.push(closing);
            void closing.catch(() => {});
            return closing;
          }
          const delayed = new Promise((resolve) => {
            releaseClose = async () => {
              await handle.close();
              resolve();
            };
          });
          fdJoins.push(delayed);
          void delayed.catch(() => {});
          return delayed;
        },
      };
    },
  };
  const captureRoot = async (root, lifecycle) => {
    owned.assertActive();
    observerEntered = true;
    known.set(root.pid, { ...root, source: "actual-supervisor-root" });
    if (!assisted) return;
    activeAttempt = await poll(
      async () => {
        owned.assertActive();
        assert(!lifecycle.signal.aborted, "PROOF_OBSERVER_RETIRED");
        for (const attempt of attempts) {
          const raw = await optional(
            path.join(attempt, naturalRole + ".json"),
            end,
          );
          if (!raw) continue;
          const own = JSON.parse(raw);
          if (own.pid === root.pid) {
            assert(own.parent === process.pid, "PROOF_ACTOR_LINEAGE");
            return attempt;
          }
        }
        return null;
      },
      Math.min(end, phaseEnd - 30000),
    );
    const childRole =
      naturalRole === "natural-zero"
        ? "child-natural"
        : naturalRole === "detached-writer"
          ? "child-writer"
          : naturalRole === "pipe-holder"
            ? "child-pipe"
            : "child-hold";
    if (!["nonzero", "output-bound"].includes(naturalRole)) {
      const child = await poll(
        async () => {
          owned.assertActive();
          assert(!lifecycle.signal.aborted, "PROOF_OBSERVER_RETIRED");
          const raw = await optional(
            path.join(activeAttempt, childRole + ".json"),
            end,
          );
          if (!raw) return null;
          const own = JSON.parse(raw);
          assert(
            own.parent === root.pid &&
              Number.isSafeInteger(own.pid) &&
              own.pid > 1,
            "PROOF_ACTOR_LINEAGE",
          );
          const row = (await ps(core, end)).find(
            (r) => r.pid === own.pid && r.parent === root.pid,
          );
          if (!row) return null;
          owned.assertActive();
          known.set(row.pid, { ...row, source: "creation-owned-descendant" });
          return row;
        },
        Math.min(end, phaseEnd - 30000),
      );
      assert(child.pid !== root.pid);
    }
    if (naturalRole === "cancel") {
      assert(rejectCallback, "PROOF_CANCEL_CALLBACK");
      rejectCallback(cancellation);
      return;
    }
    if (naturalRole === "natural-zero") {
      await owned.current();
      await fs.writeFile(path.join(activeAttempt, "release-child"), "release", {
        flag: "wx",
        mode: 0o600,
      });
      return;
    }
    if (["timeout", "output-bound"].includes(naturalRole)) return;
    if (naturalRole === "detached-writer" || naturalRole === "pipe-holder") {
      // Hold the actual live child through multiple normal sampling windows;
      // only the final real summary/outcome can prove it was observed.
      await delay(750, Math.min(end, phaseEnd - 30000));
    }
    assert(
      !lifecycle.signal.aborted && !lifecycle.rootExited(),
      "PROOF_ROOT_RETIRED",
    );
    await owned.current();
    await fs.writeFile(path.join(activeAttempt, "release-root"), "release", {
      flag: "wx",
      mode: 0o600,
    });
  };
  const realm = vm.createContext({
    ...realmFs,
    constants,
    path,
    process: { getuid: () => process.getuid() },
    AbortController,
    setTimeout,
    clearTimeout,
    hostRemaining: core.hostRemaining,
    fail: (message) => {
      throw Error(message);
    },
    compileSlice: async (exe, args, options) => {
      spawned++;
      assert(
        exe === capture.python &&
          JSON.stringify(args) === JSON.stringify(capture.args) &&
          options.out === undefined &&
          options.censusFactory === undefined,
        "PROOF_FIXED_COMMAND",
      );
      // Only realm-reconstructed plain data is copied: the real API rejects
      // another realm's Object.prototype. Values/bound remain exactly unchanged.
      if (direct) {
        const role = path.basename(options.logs);
        assert(
          ["source-gn-initial", "source-gn-revalidation"].includes(role),
          "PROOF_DIRECT_ATTEMPT",
        );
        const attempt = attempts[role === "source-gn-initial" ? 0 : 1];
        return directCompile(
          core,
          exe,
          args,
          options,
          () =>
            directActorHandshake(
              naturalRole,
              attempt,
              owned,
              Math.min(end, phaseEnd - 30000),
              directPids,
            ),
          directJoins,
          Math.min(end, phaseEnd),
        );
      }
      if (id === "cancel") {
        assert(options.stopSignal, "PROOF_OWNER_SIGNAL");
        options.stopSignal.addEventListener(
          "abort",
          () => {
            assert.throws(
              () => api.revalidateLinuxSourceOwner(stateContext),
              /REQUIRED/,
            );
            revokedBeforeAbort = true;
          },
          { once: true },
        );
      }
      const observe = (...values) => {
        owned.assertActive();
        const pending = captureRoot(...values);
        owned.observers.add(pending);
        void pending.then(
          () => owned.observers.delete(pending),
          () => owned.observers.delete(pending),
        );
        return pending;
      };
      return core.compileSlice(exe, args, {
        ...options,
        outputLedger: { ...options.outputLedger },
        ...(assisted ? { observeRoot: observe } : {}),
      });
    },
  });
  const [wrapper, owner] = kernelBlocks(witness.contents.get(RUNTIME));
  const api = vm.runInContext(
    wrapper +
      owner.replace(/^export /gm, "") +
      "\n({superviseLinuxSourceGn,withLinuxSourceOwner,revalidateLinuxSourceOwner,assertLinuxSourceOwnerReceipt})",
    realm,
  );
  let rejected = false,
    rejection,
    fulfilled = false,
    receiptDenied = false;
  try {
    console.error = (message) => {
      // The actual logger intentionally swallows sink failures. Keep a latch
      // and assert outside its callback rather than swallowing proof checks.
      try {
        assert(summary === null, "PROOF_SUMMARY_ONCE");
        summary = diagnostic(message);
        // BEGIN fixed failure diagnostic capture
        lastCaseDiagnostic = supervisorObservation(summary);
        // END fixed failure diagnostic capture
      } catch (error) {
        diagnosticFailure ??= error;
      }
    };
    try {
      if (id === "cancel") {
        await api.withLinuxSourceOwner(stateContext, capture, (context) => {
          void api.revalidateLinuxSourceOwner(context).catch(() => {});
          return new Promise((_, reject) => {
            rejectCallback = reject;
          });
        });
      } else await api.superviseLinuxSourceGn(capture, "initial");
      if (naturalRole === "natural-zero" && (id === "natural-zero" || direct)) {
        assert(joined(summary), "PROOF_FIRST_JOIN");
        summary = null;
        await api.withLinuxSourceOwner(
          stateContext,
          capture,
          async (context) => {
            const receipt = await api.revalidateLinuxSourceOwner(context);
            assert(
              api.assertLinuxSourceOwnerReceipt(context, receipt)
                .cohortQuietProven === true,
            );
            // The real runtime registry remains distinct and unpopulated.
            const production = await import(
              pathToFileURL(path.join(ROOT, RUNTIME))
            );
            assert.throws(
              () => production.assertLinuxSourceOwnerReceipt(context, receipt),
              /RECEIPT/,
            );
            receiptDenied = true;
          },
        );
      }
      fulfilled = true;
    } catch (error) {
      rejected = true;
      rejection = error;
    }
  } finally {
    console.error = beforeConsole;
    if (releaseClose) await within(releaseClose, end);
    // A negative wrapper result stays negative. This separate outer-lease join
    // merely prevents an outstanding owned FD from outliving the proof case.
    await within(() => Promise.all(fdJoins), end);
    if (direct) {
      const results = await within(
        () => Promise.allSettled(directJoins),
        Math.min(end, phaseEnd),
      );
      actorHandshakeJoined =
        results.length === spawned &&
        results.every((result) => result.status === "fulfilled");
    }
  }
  assert(
    physical(await fs.lstat(directory, { bigint: true })) === parentStamp,
    "PROOF_CASE_ROOT_CHANGED",
  );
  if (diagnosticFailure !== undefined) throw diagnosticFailure;
  if (direct)
    assert(
      actorHandshakeJoined === true && !observerEntered,
      "PROOF_DIRECT_JOIN",
    );
  if (id === "natural-zero" || id === "direct-natural-zero")
    assert(
      fulfilled &&
        !rejected &&
        spawned === 2 &&
        joined(summary) &&
        receiptDenied,
      "PROOF_NATURAL",
    );
  else assert(rejected && !fulfilled, "PROOF_DENIAL");
  if (!["reserve", "setup-clock"].includes(id))
    assert(
      outputBoundCase(id) ? outputBoundClosed(summary) : joined(summary),
      "PROOF_JOIN",
    );
  if (assisted) assert(observerEntered, "PROOF_ROOT_ADMISSION");
  if (id === "cancel") {
    assert.equal(rejection, cancellation, "PROOF_CANCEL_REASON");
    assert(revokedBeforeAbort, "PROOF_CANCEL_REVOCATION");
  }
  if (id === "timeout")
    assert(summary.ownTimerExpired === true, "PROOF_TIMEOUT");
  if (["detached-writer", "pipe-holder"].includes(id)) {
    const value = JSON.parse(
      await held(
        path.join(logs, "source-gn-initial/checkpoint-compile.outcome.json"),
        4096,
        end,
      ),
    );
    assert(
      value.outcome === "unsafe-natural-exit-descendants" &&
        summary.observedProcesses >= 2,
      "PROOF_OBSERVED_DESCENDANT",
    );
  }
  if (id === "detached-writer") {
    const reparented = await optional(
      path.join(activeAttempt, "reparented"),
      end,
    );
    assert(reparented?.toString() === "yes", "PROOF_REPARENT_UNOBSERVED");
    const counter = await held(path.join(activeAttempt, "counter"), 4096, end);
    await delay(250, end);
    assert(
      counter.equals(
        await held(path.join(activeAttempt, "counter"), 4096, end),
      ),
      "PROOF_LATE_WRITER",
    );
  }
  if (outputBoundCase(id))
    assert(
      rejected &&
        !fulfilled &&
        assertionFailureCode(rejection) === "COMPILE_OUTPUT_BOUND" &&
        outputBoundClosed(summary),
      "PROOF_OUTPUT_STAGE",
    );
  if (["reserve", "setup-clock"].includes(id))
    assert(
      spawned === 0 && /RESERVE/.test(rejection?.message ?? ""),
      "PROOF_PRESPAWN",
    );
  if (id === "late-postcheck")
    assert(/DEADLINE/.test(rejection?.message ?? ""), "PROOF_LATE_CHECK");
  if (id === "delayed-close")
    assert(
      closeAttempts === 1 && /CLOSE_DEADLINE/.test(rejection?.message ?? ""),
      "PROOF_CLOSE",
    );
  const current = await ps(core, end);
  for (const pid of directPids)
    assert(
      !current.some((row) => row.pid === pid),
      "PROOF_DIRECT_ACTOR_PRESENT",
    );
  for (const row of known.values())
    assert(
      !current.some((r) => r.pid === row.pid && r.start === row.start),
      "PROOF_ACTOR_SURVIVED",
    );
  await owned.current();
  return Object.freeze({
    id,
    complete: true,
    fulfilled,
    rejected,
    observerAssisted: assisted,
    executionMode: direct ? "direct" : assisted ? "observer-assisted" : "idle",
    actorHandshakeJoined,
    faultScheduling: [
      "setup-clock",
      "late-postcheck",
      "delayed-close",
    ].includes(id),
    supervisorJoined: summary ? joined(summary) : null,
    supervisorObservation: supervisorObservation(summary),
    expectedOutputRejection: outputBoundCase(id),
    spawned,
    closeAttempts,
    reparentWitness: id === "detached-writer",
    noLateWriter: id === "detached-writer",
    productionReceiptRejected: receiptDenied,
    heldFdJoined: true,
  });
}

async function claimActorDirectory(directory) {
  for (const name of ["attempt-initial", "attempt-revalidation"]) {
    const selected = path.join(directory, name);
    assert((await fs.realpath(selected)) === selected, "PROOF_ACTOR_ALIAS");
    const info = await fs.lstat(selected);
    assert(
      info.isDirectory() &&
        info.uid === process.getuid() &&
        (info.mode & 0o777) === 0o700,
      "PROOF_ACTOR_OWNER",
    );
    let fd;
    try {
      fd = await fs.open(
        path.join(selected, "claimed"),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error.code === "EEXIST") continue;
      throw error;
    }
    let failed = false;
    try {
      await fd.writeFile(String(process.pid));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await fd.close();
      } catch (error) {
        if (!failed) throw error;
      }
    }
    return selected;
  }
  throw Error("PROOF_ACTOR_INVOCATIONS");
}

async function launch(role, directory) {
  assert(process.argv.length === 5 && ROLES.has(role), "PROOF_LAUNCH");
  assert(
    typeof directory === "string" &&
      path.isAbsolute(directory) &&
      directory === path.resolve(directory) &&
      typeof process.env.RUNNER_TEMP === "string" &&
      directory.startsWith(
        process.env.RUNNER_TEMP + "/cef-linux-gn-owned-proof-",
      ),
    "PROOF_LAUNCH_PATH",
  );
  const raw = await held(
    path.join(directory, "actor-environment.json"),
    8192,
    performance.now() + 2000,
  );
  const env = JSON.parse(raw);
  authority(env, process.platform, process.arch);
  assert(
    Object.keys(env).sort().join(":") ===
      [
        ...(env.RUNNER_TRACKING_ID === undefined ? [] : ["RUNNER_TRACKING_ID"]),
        "PATH",
        "TZ",
        "RUNNER_TEMP",
        "CEF_LINUX_GN_ACTOR_END_MS",
        "ImageOS",
        "ImageVersion",
        "GITHUB_ACTIONS",
        "RUNNER_ENVIRONMENT",
        "GITHUB_REPOSITORY_VISIBILITY",
        "GITHUB_REPOSITORY",
        "GITHUB_REPOSITORY_ID",
        "GITHUB_EVENT_NAME",
        "GITHUB_REF",
        "GITHUB_WORKFLOW_REF",
        "GITHUB_SHA",
        "GITHUB_WORKFLOW_SHA",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
      ]
        .sort()
        .join(":"),
    "PROOF_ACTOR_ENV",
  );
  assert(
    Object.values(env).every(
      (value) => typeof value === "string" && value.length <= 4096,
    ),
    "PROOF_ACTOR_ENV",
  );
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  await actorMain(role, await claimActorDirectory(directory));
}

async function foreignActor(owned, core, end) {
  await owned.current();
  const directory = path.join(owned.root, "case-foreign-control");
  await owned.mkdir(directory);
  const env = {
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
    RUNNER_TEMP: process.env.RUNNER_TEMP,
    CEF_LINUX_GN_ACTOR_END_MS: String(
      Date.now() + Math.floor(end - performance.now()),
    ),
  };
  if (process.env.RUNNER_TRACKING_ID)
    env.RUNNER_TRACKING_ID = process.env.RUNNER_TRACKING_ID;
  for (const key of [
    "ImageOS",
    "ImageVersion",
    "GITHUB_ACTIONS",
    "RUNNER_ENVIRONMENT",
    "GITHUB_REPOSITORY_VISIBILITY",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
  ])
    env[key] = process.env[key];
  const child = spawn(
    process.execPath,
    [SELF, "--actor", "foreign", directory],
    { env, shell: false, detached: true, stdio: "ignore" },
  );
  let closed = false,
    failure,
    start;
  child.on("error", (error) => {
    failure = error;
  });
  const join = new Promise((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  return {
    async ready() {
      await poll(
        async () => {
          if (failure) throw failure;
          assert(!closed, "PROOF_FOREIGN_EXIT");
          const raw = await optional(path.join(directory, "foreign.json"), end);
          if (!raw) return false;
          const value = JSON.parse(raw);
          assert(
            value.pid === child.pid && value.parent === process.pid,
            "PROOF_FOREIGN_LINEAGE",
          );
          const row = (await ps(core, end)).find(
            (r) => r.pid === child.pid && r.parent === process.pid,
          );
          if (!row) return false;
          start = row.start;
          return true;
        },
        Math.min(end, performance.now() + 3000),
      );
    },
    async current() {
      assert(
        start &&
          !closed &&
          child.exitCode === null &&
          child.signalCode === null,
        "PROOF_FOREIGN_EXIT",
      );
      assert(
        (await ps(core, end)).some(
          (row) =>
            row.pid === child.pid &&
            row.start === start &&
            row.parent === process.pid,
        ),
        "PROOF_FOREIGN_CHANGED",
      );
    },
    async stop() {
      try {
        if (!closed) {
          const row = (await ps(core, end)).find((r) => r.pid === child.pid);
          if (row) {
            assert(
              (start === undefined || row.start === start) &&
                row.parent === process.pid,
              "PROOF_FOREIGN_CHANGED",
            );
            child.kill("SIGTERM");
          }
        }
        await within(() => join, Math.min(end, performance.now() + 2000));
        assert(closed, "PROOF_FOREIGN_JOIN");
      } finally {
        if (!closed) child.unref();
      }
    },
  };
}

async function cleanup(owned, end) {
  await owned.cleanupCurrent();
  async function contents(fd, before) {
    assert(
      ordinary(before) && before.size <= 64n * 1024n ** 2n,
      "PROOF_CLEANUP_FILE",
    );
    assert(
      full(await fd.stat({ bigint: true })) === full(before),
      "PROOF_CLEANUP_CHANGED",
    );
    const bytes = new Uint8Array(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(65536, bytes.length - offset);
      const { bytesRead } = await within(
        () => fd.read(bytes, offset, length, offset),
        end,
      );
      assert(
        Number.isSafeInteger(bytesRead) && bytesRead > 0 && bytesRead <= length,
        "PROOF_CLEANUP_CONTENT",
      );
      offset += bytesRead;
    }
    const extra = new Uint8Array(1);
    assert(
      (await within(() => fd.read(extra, 0, 1, bytes.length), end))
        .bytesRead === 0 &&
        full(await fd.stat({ bigint: true })) === full(before),
      "PROOF_CLEANUP_CONTENT",
    );
    return bytes;
  }
  async function remove(dir) {
    await owned.directoryCurrent(dir);
    const info = await fs.lstat(dir, { bigint: true });
    assert(
      info.isDirectory() &&
        info.uid === BigInt(process.getuid()) &&
        (info.mode & 0o777n) === 0o700n,
      "PROOF_CLEANUP_DIR",
    );
    const stamp = owned.directories.get(dir);
    assert(
      stamp !== undefined && physical(info) === stamp,
      "PROOF_CLEANUP_CREATION",
    );
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      await owned.cleanupCurrent();
      await owned.directoryCurrent(dir);
      assert(
        physical(await fs.lstat(dir, { bigint: true })) === stamp,
        "PROOF_CLEANUP_CHANGED",
      );
      const file = path.join(dir, entry.name);
      assert(
        /^(case-(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|reserve|setup-clock|late-postcheck|delayed-close|direct-natural-zero|direct-nonzero|direct-output-bound|foreign-control)|logs|source-gn-(?:initial|revalidation)|checkpoint-compile\.(?:stdout\.log|stderr\.log|outcome\.json)|actor-environment\.json|(?:natural-zero|nonzero|timeout|cancel|detached-writer|pipe-holder|output-bound|child-natural|child-writer|child-pipe|child-hold|foreign)\.json|counter|reparented|release-root|release-child|attempt-initial|attempt-revalidation|claimed)$/.test(
          entry.name,
        ),
        "PROOF_UNKNOWN_LEAF",
      );
      if (entry.isDirectory()) await remove(file);
      else {
        const before = await fs.lstat(file, { bigint: true });
        assert(ordinary(before), "PROOF_CLEANUP_FILE");
        // This read-only open is identity-bound before any content read. A
        // raced symlink or substituted file cannot be adopted as our leaf.
        const fd = await fs.open(file, "r");
        let failed = false;
        try {
          const baseline = await contents(fd, before);
          assert(
            full(await fs.lstat(file, { bigint: true })) === full(before),
            "PROOF_CLEANUP_CHANGED",
          );
          await owned.cleanupCurrent();
          await owned.directoryCurrent(dir);
          assert(
            physical(await fs.lstat(dir, { bigint: true })) === stamp,
            "PROOF_CLEANUP_CHANGED",
          );
          // All awaited parent/root checks precede the last held-content and
          // named-identity checks. This reduces the gap; it is not inode CAS.
          const current = await contents(fd, before);
          assert(
            current.length === baseline.length &&
              current.every((byte, index) => byte === baseline[index]),
            "PROOF_CLEANUP_CONTENT",
          );
          assert(
            full(await fs.lstat(file, { bigint: true })) === full(before),
            "PROOF_CLEANUP_CHANGED",
          );
          await fs.unlink(file);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          const closing = fd.close();
          void closing.catch(() => {});
          try {
            await within(() => closing, end);
          } catch (error) {
            if (!failed) throw error;
          }
        }
      }
    }
    assert(
      physical(await fs.lstat(dir, { bigint: true })) === stamp,
      "PROOF_CLEANUP_CHANGED",
    );
    await owned.directoryCurrent(dir);
    assert(
      physical(await fs.lstat(dir, { bigint: true })) === stamp,
      "PROOF_CLEANUP_CHANGED",
    );
    if (dir !== owned.root) await fs.rmdir(dir);
  }
  await remove(owned.root);
  await owned.cleanupCurrent();
  await within(() => owned.fd.close(), end);
  assert(
    physical(await fs.lstat(owned.root, { bigint: true })) === owned.identity,
    "PROOF_CLEANUP_CHANGED",
  );
  await fs.rmdir(owned.root);
}

export function validateReport(value) {
  assert(
    value &&
      value.kind === "linux-gn-benign-native-proof" &&
      value.complete === true &&
      value.cleanupConfirmed === true,
    "PROOF_REPORT",
  );
  const keys = [
    "kind",
    "attemptId",
    "head",
    "runId",
    "runAttempt",
    "sourceWitnessSha256",
    "observedHost",
    "cases",
    "foreignPreserved",
    "complete",
    "cleanupConfirmed",
    ...Object.keys(FALSE_FLAGS),
  ];
  assert(
    Object.keys(value).sort().join(":") === keys.sort().join(":"),
    "PROOF_REPORT_KEYS",
  );
  assert(
    /^[a-f0-9-]{36}$/.test(value.attemptId) &&
      /^[a-f0-9]{40}$/.test(value.head) &&
      /^[a-f0-9]{64}$/.test(value.sourceWitnessSha256),
    "PROOF_REPORT",
  );
  assert(
    /^[1-9][0-9]{0,15}$/.test(value.runId) &&
      /^[1-9][0-9]{0,5}$/.test(value.runAttempt),
    "PROOF_REPORT_RUN",
  );
  const host = value.observedHost;
  assert(
    host &&
      Object.keys(host).sort().join(":") ===
        [
          "source",
          "platform",
          "architecture",
          "imageOS",
          "imageVersion",
          "runnerEnvironment",
          "githubActions",
        ]
          .sort()
          .join(":") &&
      host.source === "process-and-runner-environment" &&
      host.platform === "linux" &&
      host.architecture === "x64" &&
      host.imageOS === "ubuntu24" &&
      /^[0-9]{8}\.[0-9]{1,6}\.[0-9]{1,6}$/.test(host.imageVersion) &&
      host.runnerEnvironment === "github-hosted" &&
      host.githubActions === true,
    "PROOF_OBSERVED_HOST",
  );
  assert(value.cases?.length === CASES.length, "PROOF_CASES");
  for (const [index, row] of value.cases.entries()) {
    assert(
      Object.keys(row).sort().join(":") ===
        [
          "id",
          "complete",
          "fulfilled",
          "rejected",
          "observerAssisted",
          "executionMode",
          "actorHandshakeJoined",
          "faultScheduling",
          "supervisorJoined",
          "supervisorObservation",
          "expectedOutputRejection",
          "spawned",
          "closeAttempts",
          "reparentWitness",
          "noLateWriter",
          "productionReceiptRejected",
          "heldFdJoined",
        ]
          .sort()
          .join(":"),
      "PROOF_CASE_KEYS",
    );
    const id = CASES[index],
      idle = ["reserve", "setup-clock"].includes(id),
      direct = Object.hasOwn(DIRECT_ROLES, id),
      positive = id === "natural-zero" || id === "direct-natural-zero";
    const observation = row.supervisorObservation;
    const copiedObservation = supervisorObservation(observation);
    assert(
      idle
        ? observation === null
        : observation !== null &&
            Object.keys(observation).sort().join(":") ===
              [
                "rootExited",
                "pipeClosed",
                "monitorJoined",
                "probesJoined",
                "outputsJoined",
                "outputsSettled",
                "outputHandlesClosed",
                "cohortQuiet",
                "observedProcesses",
                "phase",
                "failureStage",
              ]
                .sort()
                .join(":") &&
            copiedObservation !== null &&
            ["complete", "denied"].includes(observation.phase) &&
            copiedObservation.failureStage === observation.failureStage &&
            (!positive ||
              (observation.phase === "complete" &&
                observation.failureStage === "none")) &&
            (outputBoundCase(id)
              ? outputBoundClosed(observation)
              : observation.failureStage !== "output-bound" &&
                joined(observation)),
      "PROOF_CASE_JOINS",
    );
    assert(
      row.id === id &&
        row.complete === true &&
        row.fulfilled === positive &&
        row.rejected === !positive &&
        row.observerAssisted === (!idle && !direct) &&
        row.executionMode ===
          (direct ? "direct" : idle ? "idle" : "observer-assisted") &&
        row.actorHandshakeJoined === (direct ? true : null) &&
        row.faultScheduling ===
          ["setup-clock", "late-postcheck", "delayed-close"].includes(id) &&
        row.supervisorJoined ===
          (idle ? null : outputBoundCase(id) ? false : true) &&
        row.expectedOutputRejection === outputBoundCase(id) &&
        row.spawned === (idle ? 0 : positive ? 2 : 1) &&
        row.closeAttempts === (id === "reserve" ? 0 : positive ? 2 : 1) &&
        row.reparentWitness === (id === "detached-writer") &&
        row.noLateWriter === (id === "detached-writer") &&
        row.productionReceiptRejected === positive &&
        row.heldFdJoined === true,
      "PROOF_CASE_FACTS",
    );
  }
  for (const [key, flag] of Object.entries(FALSE_FLAGS))
    assert(value[key] === flag, "PROOF_CLAIM");
  assert(value.foreignPreserved === true, "PROOF_FOREIGN_UNQUALIFIED");
  assert(
    Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024,
    "PROOF_REPORT_BOUND",
  );
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function failureCode(error) {
  try {
    if (
      error &&
      typeof error === "object" &&
      Object.getOwnPropertyDescriptor(error, "message")?.value ===
        "PROOF_REPARENT_UNOBSERVED"
    )
      return "REPARENT_WITNESS_UNOBSERVED";
  } catch {
    /* A diagnostic observation never replaces the primary failure. */
  }
  return "PROOF_FAILED";
}

// BEGIN fixed failure diagnostic projection
function diagnosticOwn(value, key) {
  if (!value || typeof value !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
export function assertionFailureCode(error) {
  try {
    const message = diagnosticOwn(error, "message");
    for (const [expected, label] of [
      ["PROOF_DENIAL", "ASSERT_DENIAL"],
      ["PROOF_JOIN", "ASSERT_JOIN"],
      ["PROOF_ROOT_ADMISSION", "ASSERT_ROOT_ADMISSION"],
      ["PROOF_OUTPUT_STAGE", "ASSERT_OUTPUT_STAGE"],
      ["PROOF_SUMMARY_ONCE", "ASSERT_SUMMARY_ONCE"],
      ["PROOF_SUPERVISOR_DIAGNOSTIC", "ASSERT_SUPERVISOR_DIAGNOSTIC"],
      ["PROOF_CASE_ROOT_CHANGED", "ASSERT_CASE_ROOT_CHANGED"],
      ["PROOF_FIXED_COMMAND", "ASSERT_FIXED_COMMAND"],
      ["Shared compile output bound", "COMPILE_OUTPUT_BOUND"],
    ])
      if (message === expected) return label;
  } catch {
    /* Diagnostics never invoke a thrown object's getters. */
  }
  return failureCode(error);
}
export function supervisorObservation(value) {
  try {
    const result = {};
    for (const key of [
      "rootExited",
      "pipeClosed",
      "monitorJoined",
      "probesJoined",
      "outputsJoined",
      "cohortQuiet",
    ]) {
      const observed = diagnosticOwn(value, key);
      if (typeof observed !== "boolean") return null;
      result[key] = observed;
    }
    for (const key of ["outputsSettled", "outputHandlesClosed"]) {
      const observed = diagnosticOwn(value, key);
      result[key] = typeof observed === "boolean" ? observed : null;
    }
    const count = diagnosticOwn(value, "observedProcesses");
    if (!Number.isSafeInteger(count) || count < 0 || count > 4096) return null;
    result.observedProcesses = count;
    const phase = diagnosticOwn(value, "phase");
    result.phase = ["complete", "denied"].includes(phase) ? phase : "UNKNOWN";
    const stage = diagnosticOwn(value, "failureStage");
    result.failureStage = [
      "none",
      "output-bound",
      "writer",
      "writer-join",
      "output-close",
      "observer",
      "observer-join",
      "initial-snapshot",
      "stdio-close",
    ].includes(stage)
      ? stage
      : "OTHER";
    return Object.freeze(result);
  } catch {
    return null;
  }
}
function boundedFailureObservation(base, summary, cleanupFacts) {
  try {
    const observation = {
      ...base,
      supervisorObservation: supervisorObservation(summary),
      cleanupAttempted: cleanupFacts.attempted === true,
      cleanupCompleted: cleanupFacts.completed === true,
      knownOwnedActorsRemaining:
        Number.isSafeInteger(cleanupFacts.knownOwnedActorsRemaining) &&
        cleanupFacts.knownOwnedActorsRemaining >= 0 &&
        cleanupFacts.knownOwnedActorsRemaining <= 4096
          ? cleanupFacts.knownOwnedActorsRemaining
          : null,
      extraContainmentUsed: cleanupFacts.extraContainmentUsed === true,
    };
    if (Buffer.byteLength(JSON.stringify(observation)) <= 4096)
      return freeze(observation);
  } catch {
    /* Preserve the original fixed envelope and primary failure. */
  }
  return freeze(base);
}
// END fixed failure diagnostic projection

export async function runProof(...args) {
  last = null;
  assert(!running && args.length === 0, "PROOF_ENTRY");
  running = true;
  // BEGIN fixed failure diagnostic reset
  lastCaseDiagnostic = null;
  // END fixed failure diagnostic reset
  const attemptId = randomUUID();
  let owned,
    end,
    failed = false,
    first,
    report,
    core,
    foreign,
    phase = "authority",
    firstPhase,
    activeCase = null,
    completedCases = 0;
  const known = new Map();
  // BEGIN fixed failure diagnostic cleanup state
  const cleanupFacts = {
    attempted: false,
    completed: false,
    knownOwnedActorsRemaining: null,
    extraContainmentUsed: false,
  };
  // END fixed failure diagnostic cleanup state
  try {
    const observedHost = authority(process.env, process.platform, process.arch);
    phase = "clock";
    end = originalEnd(
      process.env.CEF_LINUX_GN_PROOF_STARTED_MS,
      Date.now(),
      performance.now(),
    );
    phase = "source";
    const witness = await sourceWitness(end);
    assert.equal(
      process.versions.node,
      witness.contents.get(".node-version").trim(),
      "PROOF_NODE_VERSION",
    );
    kernelBlocks(witness.contents.get(RUNTIME));
    phase = "module";
    core = await import(pathToFileURL(path.join(ROOT, CORE)));
    check(end);
    phase = "ownership";
    owned = await ownedRoot(end);
    const cases = [];
    phase = "foreign";
    foreign = await foreignActor(owned, core, end);
    await foreign.ready();
    for (const id of CASES) {
      phase = "case";
      activeCase = id;
      // BEGIN fixed failure diagnostic case reset
      lastCaseDiagnostic = null;
      // END fixed failure diagnostic case reset
      cases.push(await caseRun(id, owned, witness, core, end, known));
      completedCases++;
      await foreign.current();
    }
    await foreign.stop();
    foreign = null;
    phase = "source-recheck";
    const final = await sourceWitness(end);
    assert.equal(final.sha256, witness.sha256, "PROOF_SOURCE_CHANGED");
    report = {
      kind: "linux-gn-benign-native-proof",
      attemptId,
      head: witness.head,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      sourceWitnessSha256: witness.sha256,
      observedHost,
      cases,
      foreignPreserved: true,
      ...FALSE_FLAGS,
    };
  } catch (error) {
    failed = true;
    first = error;
    firstPhase = phase;
  } finally {
    owned?.retire();
    if (owned) {
      try {
        await within(() => Promise.allSettled([...owned.observers]), end);
        if (foreign) await foreign.stop();
        if (core && known.size) {
          const rows = await ps(core, end),
            alive = rows.filter(
              (row) => known.get(row.pid)?.start === row.start,
            );
          // BEGIN fixed failure diagnostic existing sample
          cleanupFacts.knownOwnedActorsRemaining = alive.length;
          // END fixed failure diagnostic existing sample
          if (alive.length) {
            // BEGIN fixed failure diagnostic containment
            cleanupFacts.extraContainmentUsed = true;
            // END fixed failure diagnostic containment
            // Extra fixture containment can never make this case successful.
            if (!failed) {
              failed = true;
              first = Error("PROOF_CLEANUP_UNCONFIRMED");
              firstPhase = "cleanup";
            }
            for (const row of alive) {
              check(end);
              process.kill(row.pid, "SIGKILL");
            }
            await poll(
              async () =>
                !(await ps(core, end)).some(
                  (row) => known.get(row.pid)?.start === row.start,
                ),
              Math.min(end, performance.now() + 2000),
            );
            // BEGIN fixed failure diagnostic containment result
            cleanupFacts.knownOwnedActorsRemaining = 0;
            // END fixed failure diagnostic containment result
          }
        }
        // BEGIN fixed failure diagnostic cleanup attempt
        cleanupFacts.attempted = true;
        // END fixed failure diagnostic cleanup attempt
        await cleanup(owned, end);
        // BEGIN fixed failure diagnostic cleanup completion
        cleanupFacts.completed = true;
        // END fixed failure diagnostic cleanup completion
      } catch (error) {
        if (!failed) {
          failed = true;
          first = error;
          firstPhase = "cleanup";
        }
      }
    }
    running = false;
  }
  if (failed) {
    // Exact fixed message only, through a data descriptor (never invoke a
    // thrown object's getters or serialize a raw exception/string/path).
    // BEGIN fixed failure diagnostic envelope
    const code = assertionFailureCode(first),
      unsupported = code === "REPARENT_WITNESS_UNOBSERVED";
    last = boundedFailureObservation(
      {
        kind: "linux-gn-benign-native-proof-failure",
        attemptId,
        complete: false,
        code,
        phase: firstPhase,
        activeCase,
        completedCases,
        incomplete: true,
        unsupported,
        ...FALSE_FLAGS,
      },
      lastCaseDiagnostic,
      cleanupFacts,
    );
    // END fixed failure diagnostic envelope
    throw first;
  }
  report.complete = true;
  report.cleanupConfirmed = true;
  validateReport(report);
  last = freeze(report);
  return last;
}
export function lastObservation(...args) {
  assert(args.length === 0, "PROOF_ENTRY");
  return last === null ? null : freeze(JSON.parse(JSON.stringify(last)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const mode = process.argv[2];
  const operation =
    mode === "--actor"
      ? () => actorMain(process.argv[3], process.argv[4])
      : mode === "--launch"
        ? () => launch(process.argv[3], process.argv[4])
        : () => {
            assert(process.argv.length === 2, "PROOF_ENTRY");
            return runProof();
          };
  try {
    const result = await operation();
    if (result) console.log(JSON.stringify(result));
  } catch {
    const failure = lastObservation();
    if (failure) console.log(JSON.stringify(failure));
    console.error("LINUX_GN_PROOF_FAILED");
    process.exitCode = 1;
  }
}
