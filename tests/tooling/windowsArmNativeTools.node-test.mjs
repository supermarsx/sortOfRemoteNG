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
  assert.deepEqual(
    await fs.readFile(
      path.join(root, "native/windows-arm-native-tools/profile.json"),
    ),
    raw,
    "the hash-pinned profile must retain its canonical bytes after checkout",
  );
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
  assert.match(code, /state\.totalBytes<=512\*1024/);
  assert.match(code, /check\(files\.length<100,'ARM_COLLECT_FILES'\)/);
  assert.match(code, /check\(info\.size<=65536,'ARM_COLLECT_FILE_BYTES'\)/);
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

test("Producer code remains a separately attested subset and cannot substitute for seven new source pins", async () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const actual = await mod.producerPins(head);
  assert.equal(actual.rows.length, 129);
  assert.equal(
    actual.codeDigest,
    "a22e193e8eba5fc06a13aa169f46b4e8df06e0611bd5ca1bc2a3534ea44bb512",
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
    /bytes\.length<=65536&&bytes\.length\+\(collected\?\.totalBytes\?\?0\)<=512\*1024/,
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

async function collectorFixture(action) {
  const cache = path.join(root, ".orchestration", "cache");
  await fs.mkdir(cache, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(cache, "arm-collector-"));
  const operation = path.join(
    fixture,
    ".artifacts",
    "windows-arm-native-tools-00000000-0000-0000-0000-000000000000",
  );
  await fs.mkdir(operation, { recursive: true });
  const retained = await fs.mkdtemp(path.join(cache, "arm-retained-"));
  try {
    await action({ fixture, operation, retained });
  } finally {
    for (const directory of [fixture, retained]) {
      assert.equal(path.dirname(directory), cache);
      assert(path.basename(directory).startsWith("arm-"));
      assert.equal(
        (await fs.realpath(directory)).toLowerCase(),
        directory.toLowerCase(),
      );
      await fs.rm(directory, { recursive: true });
    }
  }
}

test("unknown member is not opened, named or copied; failed collection retains only safe summary", async () => {
  await collectorFixture(async ({ fixture, operation, retained }) => {
    const privateName = "private-signed-url-token.bin";
    await fs.writeFile(
      path.join(operation, privateName),
      "Bearer secret-provider-token",
    );
    await fs.writeFile(
      path.join(operation, "observation.json"),
      JSON.stringify(nativeFixture()),
    );
    let opens = 0,
      diagnostic;
    const api = {
      ...fs,
      open: async (...args) => {
        if (args[0] === path.join(operation, privateName)) opens++;
        return fs.open(...args);
      },
    };
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        api,
        onFailure: (record) => {
          diagnostic = record;
        },
      }),
      /ARM_COLLECT_MEMBER/,
    );
    assert.equal(opens, 0);
    assert.equal(diagnostic.stage, "file-admission");
    assert.equal(diagnostic.errorCode, "ARM_COLLECT_MEMBER");
    assert.equal(diagnostic.observations.memberAllowed, false);
    assert(!JSON.stringify(diagnostic).includes("private"));
    const summary = {
      success: false,
      collection: diagnostic,
      nativeProjection: await mod.readNativeProjection(operation),
    };
    await mod.retainArtifact(retained, summary, null);
    assert.deepEqual(await fs.readdir(retained), ["bootstrap-result.json"]);
    const raw = await fs.readFile(
      path.join(retained, "bootstrap-result.json"),
      "utf8",
    );
    assert(!raw.includes(privateName) && !raw.includes("Bearer"));
    assert(!raw.includes("secret-provider-url"));
    assert.equal(summary.nativeProjection.phase, "owned-role");
    assert.equal(summary.nativeProjection.jobs[0].winerror, 87);
  });
});

test("declared scratch directories stay opaque and never enter collected evidence", async () => {
  await collectorFixture(async ({ fixture, operation }) => {
    const scratch = [path.join(operation, "home"), path.join(operation, "tmp")];
    for (const directory of scratch) {
      await fs.mkdir(directory);
      await fs.writeFile(
        path.join(directory, "private-cache-token.bin"),
        Buffer.alloc(70000),
      );
    }
    await fs.writeFile(path.join(operation, "context.json"), "{}");
    const touched = [];
    const api = {
      ...fs,
      readdir: async (file, ...args) => {
        touched.push(file);
        assert(
          !scratch.includes(file),
          "scratch contents must not be enumerated",
        );
        return fs.readdir(file, ...args);
      },
      open: async (file, ...args) => {
        assert(
          !scratch.some((directory) => file.startsWith(directory + path.sep)),
        );
        return fs.open(file, ...args);
      },
    };
    const result = await mod.collectArtifact(fixture, operation, { api });
    assert.equal(result.diagnostic.status, "complete");
    assert.equal(result.files.length, 1);
    assert.equal(result.totalBytes, 2);
    assert(!JSON.stringify(result.files).includes("private-cache"));
    assert(touched.includes(operation));
  });
});

test("scratch exclusions require exact directories and do not admit lookalikes or linked roots", async () => {
  for (const name of ["home", "tmp"]) {
    await collectorFixture(async ({ fixture, operation }) => {
      const scratch = path.join(operation, name);
      await fs.writeFile(scratch, "not a directory");
      await assert.rejects(
        mod.collectArtifact(fixture, operation),
        /ARM_COLLECT_TYPE/,
      );
      await fs.unlink(scratch);
      await fs.mkdir(scratch);
      const api = {
        ...fs,
        lstat: async (file, ...args) => {
          const info = await fs.lstat(file, ...args);
          if (file === scratch) info.isSymbolicLink = () => true;
          return info;
        },
      };
      await assert.rejects(
        mod.collectArtifact(fixture, operation, { api }),
        /ARM_PATH_LINK/,
      );
    });
  }
  await collectorFixture(async ({ fixture, operation }) => {
    await fs.mkdir(path.join(operation, "home-copy"));
    await fs.writeFile(
      path.join(operation, "home-copy", "private.bin"),
      "private",
    );
    await assert.rejects(
      mod.collectArtifact(fixture, operation),
      /ARM_COLLECT_MEMBER/,
    );
  });
});

test("declared files keep their bytes and hashes only after complete collection", async () => {
  await collectorFixture(async ({ fixture, operation, retained }) => {
    await fs.writeFile(path.join(operation, "context.json"), "{}");
    const collected = await mod.collectArtifact(fixture, operation);
    assert.equal(collected.diagnostic.status, "complete");
    assert.equal(collected.files.length, 1);
    assert.equal(collected.totalBytes, 2);
    assert.equal(collected.files[0].sha256, digest(Buffer.from("{}")));
    const proof = await mod.retainArtifact(
      retained,
      { success: true },
      collected,
    );
    assert.equal(proof.retainedFiles, 2);
    assert.equal(
      await fs.readFile(path.join(retained, collected.files[0].path), "utf8"),
      "{}",
    );
  });
});

test("file byte, type, total byte and deadline denials have separate fixed numeric diagnoses", async () => {
  await collectorFixture(async ({ fixture, operation }) => {
    const file = path.join(operation, "context.json");
    await fs.writeFile(file, Buffer.alloc(65537));
    let diagnostic;
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        onFailure: (record) => {
          diagnostic = record;
        },
      }),
      /ARM_COLLECT_FILE_BYTES/,
    );
    assert.equal(diagnostic.observations.fileBytes, 65537);
    await fs.writeFile(file, "x");
    const api = {
      ...fs,
      lstat: async (name, options) => {
        const info = await fs.lstat(name, options);
        if (name === file && !options) {
          const changed = Object.create(info);
          changed.isFile = () => false;
          return changed;
        }
        return info;
      },
    };
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        api,
        onFailure: (record) => {
          diagnostic = record;
        },
      }),
      /ARM_COLLECT_TYPE/,
    );
    assert.equal(diagnostic.observations.isFile, false);
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        started: 0,
        now: () => 10000,
        onFailure: (record) => {
          diagnostic = record;
        },
      }),
      /ARM_COLLECT_DEADLINE/,
    );
    assert.equal(diagnostic.stage, "directory-bound");
    await fs.mkdir(path.join(operation, "source-inputs"));
    for (let i = 0; i < 7; i++)
      await fs.writeFile(
        path.join(operation, "source-inputs", String(i)),
        Buffer.alloc(65536),
      );
    await fs.writeFile(file, Buffer.alloc(65536));
    await fs.writeFile(
      path.join(operation, "observation.json"),
      Buffer.alloc(65536),
    );
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        onFailure: (record) => {
          diagnostic = record;
        },
      }),
      /ARM_COLLECT_TOTAL/,
    );
    assert.equal(diagnostic.observations.totalBytes, 9 * 65536);
    assert(!Object.hasOwn(diagnostic, "path"));
  });
});

test("entry, file-count and depth caps are retained without opening unknown payloads", async () => {
  await collectorFixture(async ({ fixture, operation }) => {
    await fs.mkdir(path.join(fixture, "empty"));
    let diagnostic;
    const entries = {
      ...fs,
      readdir: async (name) =>
        name === fixture ? Array(129).fill("empty") : [],
    };
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        api: entries,
        onFailure: (row) => {
          diagnostic = row;
        },
      }),
      /ARM_COLLECT_ENTRIES/,
    );
    assert.equal(diagnostic.observations.entries, 129);
    const cache = path.join(fixture, ".cache", "windows-arm-native-tools");
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, "job.py"), "x");
    const files = {
      ...fs,
      readdir: async (name) =>
        name === fixture
          ? [".cache"]
          : name === path.join(fixture, ".cache")
            ? ["windows-arm-native-tools"]
            : name === cache
              ? Array(101).fill("job.py")
              : [],
    };
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        api: files,
        onFailure: (row) => {
          diagnostic = row;
        },
      }),
      /ARM_COLLECT_FILES/,
    );
    assert.equal(diagnostic.observations.files, 100);
    const nested = path.join(fixture, ...Array(9).fill("nested"));
    await fs.mkdir(nested, { recursive: true });
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        onFailure: (row) => {
          diagnostic = row;
        },
      }),
      /ARM_COLLECT_DEPTH/,
    );
    assert.equal(diagnostic.observations.depth, 9);
  });
});

test("collector preserves the original error even when its diagnostic observer throws", async () => {
  await collectorFixture(async ({ fixture, operation }) => {
    const original = new Error("private URL and token");
    const api = {
      ...fs,
      readdir: async () => {
        throw original;
      },
    };
    await assert.rejects(
      mod.collectArtifact(fixture, operation, {
        api,
        onFailure: () => {
          throw new Error("sink failure");
        },
      }),
      (error) => error === original,
    );
  });
});

const nativeFixture = () => ({
  schemaVersion: 1,
  kind: "sorng-windows-arm-native-tools",
  phase: "owned-role",
  failure: "TOOLS_JOB_UNCONFIRMED",
  activeRole: "python",
  success: false,
  ownSourceIdentityVerified: true,
  files: [],
  roles: [
    {
      role: "python",
      job: {
        outcome: "launcher-failure",
        rootExit: null,
        winerror: 87,
        activeAtEnd: 0,
        cleanupVerified: true,
        rootReaped: true,
        logReadersStopped: true,
        parentHandleClosed: true,
        privatePath: "secret-provider-url",
      },
    },
  ],
  provenance: { private: "secret-provider-url" },
});

test("native projection retains closed cause and cleanup numbers without source context or unknown fields", () => {
  const projection = mod.projectNative(nativeFixture());
  assert.equal(projection.status, "available");
  assert.equal(projection.failure, "TOOLS_JOB_UNCONFIRMED");
  assert.equal(projection.jobs[0].winerror, 87);
  assert.equal(projection.jobs[0].cleanupVerified, true);
  assert(
    !JSON.stringify(projection).includes("secret") &&
      !JSON.stringify(projection).includes("provenance"),
  );
  for (const changed of [
    { phase: "private/token" },
    { failure: "private/token" },
    { activeRole: "private/token" },
    { success: "true" },
    { files: Array(33) },
  ])
    assert.deepEqual(mod.projectNative({ ...nativeFixture(), ...changed }), {
      status: "unavailable",
      reason: "SCHEMA_INVALID",
    });
  const invalid = nativeFixture();
  invalid.roles[0].job.activeAtEnd = 9;
  assert.equal(mod.projectNative(invalid).reason, "SCHEMA_INVALID");
});

test("only fixed bounded observation.json can supply the optional native projection", async () => {
  await collectorFixture(async ({ operation }) => {
    assert.equal((await mod.readNativeProjection(operation)).reason, "ABSENT");
    const file = path.join(operation, "observation.json");
    await fs.writeFile(file, JSON.stringify(nativeFixture()));
    assert.equal(
      (await mod.readNativeProjection(operation)).status,
      "available",
    );
    await fs.writeFile(file, "private invalid JSON");
    const invalid = await mod.readNativeProjection(operation);
    assert.equal(invalid.reason, "INVALID_JSON");
    assert(!JSON.stringify(invalid).includes("private"));
    await fs.writeFile(file, Buffer.alloc(65537));
    const tooLarge = await mod.readNativeProjection(operation);
    assert.equal(tooLarge.reason, "FILE_BOUND");
    assert.equal(tooLarge.fileBytes, 65537);
    assert.equal(
      (await mod.readNativeProjection(operation, {}, () => 10000, 10000))
        .reason,
      "DEADLINE",
    );
  });
});

test("retention cannot exceed existing byte limits or copy a forged path", async () => {
  await collectorFixture(async ({ retained }) => {
    await assert.rejects(
      mod.retainArtifact(retained, { text: "x".repeat(65536) }, null),
      /ARM_COLLECT_SUMMARY/,
    );
    assert.deepEqual(await fs.readdir(retained), []);
    await assert.rejects(
      mod.retainArtifact(
        retained,
        {},
        { totalBytes: 512 * 1024, files: [], buffers: [] },
      ),
      /ARM_COLLECT_SUMMARY/,
    );
    await assert.rejects(
      mod.retainArtifact(
        retained,
        {},
        {
          totalBytes: 1,
          files: [{ path: "../outside" }],
          buffers: [{ path: "../outside", raw: Buffer.from("x") }],
        },
      ),
      /ARM_COLLECT_SUMMARY/,
    );
    assert.deepEqual(await fs.readdir(retained), []);
  });
});

test("production uploads only the safe sibling and retains failures without changing native execution", () => {
  assert.match(code, /artifact_root='\+retained/);
  assert.match(code, /files:collected\?\.files\?\?\[\]/);
  assert.match(code, /if\(collectionError\)throw collectionError/);
  assert(
    code.indexOf("readNativeProjection(operation") <
      code.lastIndexOf("collectArtifact(root,operation"),
  );
  assert.match(code, /fixed\(nativePassed,'ARM_BENIGN_DIAGNOSTIC_FAILED'\)/);
  assert.match(
    code,
    /retained=path\.join\(temp,'owned-windows-arm-native-tools-safe-'/,
  );
});

test("exact production run reaches the outer provenance function before any native or provision operation", async () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const sources = mod.SOURCE_PATHS.map((name) => {
    const raw = execFileSync("git", ["cat-file", "blob", `${head}:${name}`], {
      cwd: root,
      windowsHide: true,
    });
    return { path: name, raw, size: raw.length, sha256: digest(raw) };
  });
  const sentinel = new Error("controlled provenance boundary");
  const stages = [],
    writes = [],
    directories = [];
  let reached = 0;
  const binding = { head };
  const fakeFs = {
    mkdir: async (name) => {
      directories.push(name);
    },
    appendFile: async () => {},
    writeFile: async (name, raw) => {
      writes.push({ name, raw });
    },
  };
  const injections = {
    createPreflightReporter: () => async (stage, action) => {
      stages.push(stage);
      return action();
    },
    authority: () => binding,
    fixed: (condition, message) => assert(condition, message),
    sourceInputs: async (actual) => {
      assert.equal(actual, head);
      return sources;
    },
    profileFromBytes: mod.profileFromBytes,
    pinnedTool: async (row) => ({
      bytes: row.bytes,
      sha256: row.sha256,
      machine: row.machine,
    }),
    noLinks: async (name) => name,
    path,
    randomUUID: () => "00000000-0000-0000-0000-000000000000",
    fs: fakeFs,
    process: {
      env: {
        ImageVersion: "20261022.194.1",
        RUNNER_TEMP: path.join(root, "virtual-only"),
        GITHUB_OUTPUT: "virtual-output",
      },
    },
    execute: () => {
      throw new Error("no subprocess allowed");
    },
    provenance: async (actual) => {
      reached++;
      assert.equal(actual, head);
      throw sentinel;
    },
  };
  // The body is the actual extracted workflow function, with no body rewrites.
  // All admission, filesystem and tool boundaries are fakes; clean HEAD blobs
  // are only input bytes. The sentinel prevents later provisioning/native work.
  const run = new Function(
    ...Object.keys(injections),
    `return (${mod.run.toString()});`,
  )(...Object.values(injections));
  await assert.rejects(run(), (error) => error === sentinel);
  assert.equal(reached, 1);
  assert.equal(writes.length, 11);
  assert.equal(directories.length, 8);
  assert(writes.every((row) => Buffer.isBuffer(row.raw)));
  assert(stages.includes("register-output"));
  assert(!stages.includes("provision-evidence"));
});
