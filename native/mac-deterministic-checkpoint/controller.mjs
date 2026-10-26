// Diagnostic only: fresh maintained GN, no compiler, restore, seal or publication.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  POLICY,
  applyMetadata,
  verifyMetadata,
  authoritativeGn,
} from "./metadata.mjs";
import {
  build,
  plan,
  releaseIdentity,
  run,
} from "../../scripts/cef-runtime-ci.mjs";
import {
  verifyToolchainFiles,
  identitySha256,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  canonical,
  checkpointHost,
  codeTreeDigest,
  compileSlice,
  graphInventory,
  graphPinSnapshot,
  workspace,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const BRANCH = "codex/ci-mac-deterministic-checkpoint-20261026";
export const PRODUCER =
  "dec3fecef4c2b5b70a5eeb49cc389340dbe141db65ca59772839afd319264639";
export const SOURCE =
  "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54";
export const OWN = [
  ".github/workflows/cef-sdk-layout-probe.yml",
  "native/mac-deterministic-checkpoint/controller.mjs",
  "native/mac-deterministic-checkpoint/metadata.mjs",
  "tests/tooling/macDeterministicCheckpoint.node-test.mjs",
];
export const NINJAS = [
  "toolchain.ninja",
  "clang_arm64_with_system_allocator/toolchain.ninja",
  "clang_x64/toolchain.ninja",
  "clang_x64_for_rust_host_build_tools/toolchain.ninja",
  "clang_x64_host_with_system_allocator/toolchain.ninja",
  "clang_x64_v8_arm64/toolchain.ninja",
];
export const TOOLS = [
  [
    "compile_xcassets.py",
    16540,
    "69d0de00e6bbcce0eae2dfb278876b0fd76d4f9430f2b1625c8bf6806ecfc5cd",
  ],
  [
    "filter_libtool.py",
    1766,
    "157d25b50057d3927dfcadfb24edf94ac7081b1802ccbbc54258360af9cad02f",
  ],
  [
    "linker_driver.py",
    21507,
    "0b0f5458b7f6d763a76285dd17494bf6a5ea0936c11cdcb193d6fa988bdc0ef5",
  ],
  [
    "swift_const_gather_protocols.json",
    181,
    "b78c534eaedb844857a208c60f627ea4c53845579169226844e8a9464734a23e",
  ],
  [
    "swiftc.py",
    25224,
    "ccd8d11da5523ba5960246ac90c1776c8e0545753926c63dde533178a1e97a97",
  ],
];
export const LIMIT = Object.freeze({
  member: 96 * 1024 ** 2,
  total: 128 * 1024 ** 2,
  line: 4 * 1024 ** 2,
  summary: 65536,
  context: 131072,
  scalarKinds: 16,
});
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const full = (s) =>
  [
    s.dev,
    s.ino,
    s.mode,
    s.nlink,
    s.size,
    s.mtimeNs,
    s.ctimeNs,
    s.birthtimeNs,
  ].join(":");
const shared = (s) =>
  [s.dev, s.ino, s.nlink, s.size, s.mtimeNs, s.birthtimeNs].join(":");
const closedCodes = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EEXIST",
  "EIO",
  "ENOSPC",
  "EMFILE",
  "ETIMEDOUT",
  "ERR_ASSERTION",
  "ABORT_ERR",
]);

export function reason(error) {
  if (
    typeof error?.message === "string" &&
    /^(?:MAC_GN|MAC_METAL|MAC_META)_[A-Z_]{1,48}$/.test(error.message)
  )
    return error.message;
  if (closedCodes.has(error?.code)) return error.code;
  return "MAC_GN_DENIED";
}
export function errorScalars(error) {
  return {
    code: closedCodes.has(error?.code)
      ? error.code
      : Number.isSafeInteger(error?.code) &&
          error.code >= 0 &&
          error.code <= 2147483647
        ? error.code
        : null,
    signal: new Set([
      "SIGKILL",
      "SIGTERM",
      "SIGABRT",
      "SIGSEGV",
      "SIGBUS",
      "SIGINT",
    ]).has(error?.signal)
      ? error.signal
      : null,
    killed: typeof error?.killed === "boolean" ? error.killed : null,
  };
}
export function remaining(c, wall = Date.now(), mono = performance.now()) {
  assert(
    Number.isFinite(c.wallEnd) && Number.isFinite(c.monoEnd),
    "MAC_GN_CLOCK",
  );
  const value = Math.min(c.wallEnd - wall, c.monoEnd - mono);
  assert(value > 0, "MAC_GN_DEADLINE");
  return value;
}
export function carriedBudget(
  wallEnd,
  milliseconds,
  wall = Date.now,
  mono = () => performance.now(),
) {
  assert(
    Number.isFinite(wallEnd) &&
      Number.isFinite(milliseconds) &&
      milliseconds > 0 &&
      milliseconds <= 3600000,
    "MAC_GN_CLOCK",
  );
  const began = mono(),
    available = Math.min(milliseconds, wallEnd - wall());
  const check = () => {
    const value = Math.min(wallEnd - wall(), available - (mono() - began));
    assert(value > 0, "MAC_GN_DEADLINE");
    return value;
  };
  return { remaining: check, assertRemaining: check };
}
export function authority(
  env,
  platform = process.platform,
  arch = process.arch,
) {
  assert(env.CEF_DEFAULT_BRANCH === "main", "MAC_GN_DEFAULT_BRANCH");
  assert(platform === "darwin" && arch === "x64", "MAC_GN_HOST");
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "MAC_GN_AUTHORITY",
  );
  assert(
    env.GITHUB_REF === "refs/heads/" + BRANCH &&
      env.GITHUB_REF !== "refs/heads/" + env.CEF_DEFAULT_BRANCH &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA,
    "MAC_GN_REF",
  );
  assert(
    env.GITHUB_WORKFLOW_REF ===
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/" +
        BRANCH,
    "MAC_GN_WORKFLOW",
  );
  assert(
    /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "MAC_GN_RUN",
  );
}
export function emptyInputs(event) {
  assert(
    event &&
      Object.hasOwn(event, "inputs") &&
      (event.inputs === null ||
        (typeof event.inputs === "object" &&
          !Array.isArray(event.inputs) &&
          Object.keys(event.inputs).length === 0)),
    "MAC_GN_INPUTS",
  );
}
export function eventRepository(event) {
  const r = event?.repository;
  assert(
    r &&
      !Array.isArray(r) &&
      r.id === 1010282954 &&
      r.full_name === "supermarsx/sortOfRemoteNG" &&
      r.private === false &&
      r.default_branch === "main" &&
      (r.visibility === undefined || r.visibility === "public"),
    "MAC_GN_EVENT_REPOSITORY",
  );
  return {
    id: r.id,
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
  };
}
export async function closeScope(fd, action, state) {
  let primary;
  try {
    return await action();
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await fd.close();
    } catch {
      state.cleanupFailure ??= "MAC_GN_CLOSE";
      if (!primary) throw Error("MAC_GN_CLOSE");
    }
  }
}
export async function physical(file, io = fs) {
  assert(
    path.isAbsolute(file) &&
      !file
        .replaceAll("\\", "/")
        .split("/")
        .some((x) => x === "." || x === ".."),
    "MAC_GN_PATH",
  );
  const real = await io.realpath(file);
  assert(
    process.platform === "win32"
      ? real.replaceAll("\\", "/").toLowerCase() ===
          file.replaceAll("\\", "/").toLowerCase()
      : real === file,
    "MAC_GN_ALIAS",
  );
  for (let p = file; ; p = path.dirname(p)) {
    assert(!(await io.lstat(p)).isSymbolicLink(), "MAC_GN_LINK");
    if (path.dirname(p) === p) break;
  }
  return file;
}
export async function held(file, cap, check, state, consume, io = fs) {
  check();
  await physical(file, io);
  const before = await io.lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(cap),
    "MAC_GN_FILE",
  );
  const fd = await io.open(file, "r");
  return closeScope(
    fd,
    async () => {
      const initial = await fd.stat({ bigint: true });
      assert(shared(before) === shared(initial), "MAC_GN_IDENTITY");
      const digest = createHash("sha256"),
        buffer = Buffer.alloc(65536);
      let size = 0;
      for (;;) {
        check();
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        assert(size <= cap && size <= Number(before.size), "MAC_GN_SIZE");
        const bytes = buffer.subarray(0, bytesRead);
        digest.update(bytes);
        await consume?.(bytes);
      }
      const end = await fd.stat({ bigint: true }),
        after = await io.lstat(file, { bigint: true });
      assert(
        full(before) === full(after) &&
          full(initial) === full(end) &&
          shared(after) === shared(end) &&
          size === Number(before.size),
        "MAC_GN_CHANGED",
      );
      check();
      return { bytes: size, sha256: digest.digest("hex"), identity: before };
    },
    state,
  );
}
export function numericLines() {
  let pending = "",
    lines = 0;
  const counts = new Map();
  const decode = new TextDecoder("utf-8", { fatal: true });
  function line(text) {
    assert(
      Buffer.byteLength(text) <= LIMIT.line && !text.includes("\0"),
      "MAC_GN_LINE_BOUND",
    );
    lines++;
    for (const match of text.matchAll(
      /\b(TOOL_VERSION|JSON_VERSION)=([^\s]+)/g,
    )) {
      assert(/^[0-9]{1,20}$/.test(match[2]), "MAC_GN_SCALAR");
      const candidates =
        match[1] === "JSON_VERSION"
          ? text.includes("swiftc.py")
            ? ["swift_const_gather_protocols.json"]
            : []
          : TOOLS.filter(
              ([name]) =>
                name !== "swift_const_gather_protocols.json" &&
                text.includes(name),
            ).map(([name]) => name);
      const role =
        candidates.length === 1
          ? candidates[0]
          : candidates.length === 0
            ? "_unclassified"
            : "_ambiguous";
      const key = match[1] + ":" + role + ":" + match[2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      assert(counts.size <= LIMIT.scalarKinds, "MAC_GN_SCALAR_BOUND");
    }
  }
  function append(text, final) {
    pending += text;
    for (;;) {
      const n = pending.indexOf("\n");
      if (n < 0) break;
      line(pending.slice(0, n));
      pending = pending.slice(n + 1);
    }
    assert(Buffer.byteLength(pending) <= LIMIT.line, "MAC_GN_LINE_BOUND");
    if (final && pending) {
      line(pending);
      pending = "";
    }
  }
  return {
    feed: (bytes) => append(decode.decode(bytes, { stream: true }), false),
    finish: () => {
      append(decode.decode(), true);
      return {
        lines,
        scalars: [...counts.entries()].map(([key, count]) => {
          const [field, role, value] = key.split(":");
          return role.startsWith("_")
            ? { field, role: null, value, count, classification: role.slice(1) }
            : { field, role, value, count };
        }),
      };
    },
  };
}
export async function save(file, value, maximum, state, io = fs) {
  const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  assert(raw.length <= maximum, "MAC_GN_REPORT_BOUND");
  try {
    await io.writeFile(file, raw, { flag: "wx", mode: 0o600 });
  } catch (error) {
    state.reportingFailure ??= "MAC_GN_REPORT_WRITE";
    throw error;
  }
}
export async function sourceTimes(chromium, check, state, io = fs) {
  const rows = [];
  for (const [name, bytes, expected] of TOOLS) {
    const relative = "build/toolchain/apple/" + name,
      row = await held(
        path.join(chromium, relative),
        2 * 1024 ** 2,
        check,
        state,
        undefined,
        io,
      );
    assert(
      row.bytes === bytes &&
        row.sha256 === expected &&
        row.identity.mtimeNs >= 0n,
      "MAC_GN_TOOL_PIN",
    );
    rows.push({
      path: relative,
      role: name,
      bytes,
      sha256: expected,
      mtimeNs: String(row.identity.mtimeNs),
      integerMtime: String(row.identity.mtimeNs / 1000000000n),
    });
  }
  return rows;
}
export async function copyNinja(
  source,
  target,
  check,
  state,
  io = fs,
  cap = LIMIT.member,
) {
  assert(
    Number.isSafeInteger(cap) && cap > 0 && cap <= LIMIT.member,
    "MAC_GN_TOTAL_BOUND",
  );
  await physical(path.dirname(target), io);
  const output = await io.open(target, "wx", 0o600),
    parser = numericLines();
  let copied,
    parseFailure = null,
    parsed;
  await closeScope(
    output,
    async () => {
      copied = await held(
        source,
        cap,
        check,
        state,
        async (raw) => {
          if (!parseFailure) {
            try {
              parser.feed(raw);
            } catch (error) {
              parseFailure =
                error?.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
                  ? "MAC_GN_UTF8"
                  : reason(error);
            }
          }
          let n = 0;
          while (n < raw.length) {
            check();
            const { bytesWritten } = await output.write(
              raw,
              n,
              raw.length - n,
              null,
            );
            assert(bytesWritten > 0, "MAC_GN_COPY_WRITE");
            n += bytesWritten;
          }
        },
        io,
      );
      await output.sync();
    },
    state,
  );
  const destination = await held(target, cap, check, state, undefined, io);
  assert(
    destination.bytes === copied.bytes &&
      destination.sha256 === copied.sha256 &&
      (destination.identity.dev !== copied.identity.dev ||
        destination.identity.ino !== copied.identity.ino),
    "MAC_GN_COPY_PIN",
  );
  if (!parseFailure) {
    try {
      parsed = parser.finish();
    } catch (error) {
      parseFailure =
        error?.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
          ? "MAC_GN_UTF8"
          : reason(error);
    }
  }
  return {
    bytes: copied.bytes,
    sha256: copied.sha256,
    ...(parsed ?? { lines: null, scalars: [] }),
    parseFailure,
  };
}
export async function capture(
  context,
  output,
  check,
  state,
  io = fs,
  inventory = graphInventory,
  sampleTimes = sourceTimes,
) {
  const out = path.join(context.chromium, "out/Release_GN_arm64");
  state.phase = "source-times";
  const tools = await sampleTimes(context.chromium, check, state, io),
    files = [];
  let total = 0;
  for (const [index, name] of NINJAS.entries()) {
    state.phase = "ninja-" + index;
    const row = await copyNinja(
      path.join(out, name),
      path.join(output, `ninja-${index}.bin`),
      check,
      state,
      io,
      Math.min(LIMIT.member, LIMIT.total - total),
    );
    total += row.bytes;
    assert(total <= LIMIT.total, "MAC_GN_TOTAL_BOUND");
    files.push({ path: name, retained: `ninja-${index}.bin`, ...row });
  }
  state.phase = "source-times-postcheck";
  assert(
    canonical(await sampleTimes(context.chromium, check, state, io)) ===
      canonical(tools),
    "MAC_GN_MTIME_CHANGED",
  );
  state.phase = "graph-snapshot";
  let pins, graph, callbackFailure, inventoryFailure;
  try {
    graph = await inventory(out, {
      observePins: async (value) => {
        try {
          check();
          const raw = graphPinSnapshot(value);
          try {
            await io.writeFile(
              path.join(output, "fresh-graph-pins.json"),
              raw,
              { flag: "wx", mode: 0o600 },
            );
          } catch (error) {
            state.reportingFailure ??= "MAC_GN_REPORT_WRITE";
            throw error;
          }
          pins = value.pins;
          check();
        } catch (error) {
          callbackFailure ??= error;
          throw error;
        }
      },
    });
  } catch (error) {
    inventoryFailure = error;
  }
  // The maintained graph API deliberately swallows optional observer failures.
  // This diagnostic requires its retained snapshot, so rethrow our FIRST error.
  if (callbackFailure) throw callbackFailure;
  if (inventoryFailure) throw inventoryFailure;
  check();
  assert(Array.isArray(pins), "MAC_GN_GRAPH_PINS");
  for (const row of files) {
    const pin = pins.find((p) => p.path === row.path);
    assert(
      pin?.bytes === row.bytes && pin.sha256 === row.sha256,
      "MAC_GN_GRAPH_CHANGED",
    );
  }
  const comparisons = files.flatMap((file) =>
    file.scalars.map((scalar) => ({
      path: file.path,
      ...scalar,
      matchesObservedSourceMtime:
        tools.find((t) => t.role === scalar.role)?.integerMtime ===
        scalar.value,
    })),
  );
  const result = {
    kind: "mac-gn-causal-evidence",
    diagnosticOnly: true,
    tools,
    files,
    graph,
    comparisons,
    numericClassificationComplete:
      files.every(
        (file) =>
          !file.parseFailure && file.scalars.every((row) => row.role !== null),
      ) && comparisons.length > 0,
    compilerExecuted: false,
    restoreAccepted: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    normalizationApplied: false,
  };
  await save(
    path.join(output, "gn-evidence.json"),
    result,
    LIMIT.summary,
    state,
    io,
  );
  check();
  // Unknown syntax/classification is a diagnostic denial AFTER all six exact
  // bodies, whole hashes and numeric observations have been retained.
  assert(
    result.numericClassificationComplete,
    "MAC_GN_CLASSIFICATION_INCOMPLETE",
  );
  return result;
}
export async function stopAfterGn(invokeBuild, options, collect) {
  const sentinel = Object.freeze({ kind: "private-after-GN-diagnostic-stop" });
  let captured = false;
  const engineering = {
    workspace: options.workspace,
    completeSdk: false,
    compile: async () => {
      throw Error("MAC_GN_COMPILE_DENIED");
    },
    packagingMilliseconds: () => {
      throw Error("MAC_GN_PACKAGE_DENIED");
    },
    afterGn: async (context) => {
      await collect(context);
      captured = true;
      throw sentinel;
    },
  };
  try {
    await invokeBuild({ ...options, engineering });
  } catch (error) {
    if (error === sentinel && captured)
      return { observedAfterGn: true, compilerExecuted: false };
    throw error;
  }
  throw Error("MAC_GN_STOP_NOT_OBSERVED");
}
function git(args, check) {
  check();
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "buffer",
    timeout: 10000,
    maxBuffer: 8 * 1024 ** 2,
    stdio: ["ignore", "pipe", "ignore"],
  });
}
export function diagnosticProducer(rows) {
  return identitySha256({ maintainedProducer: PRODUCER, policy: POLICY, rows });
}
export async function sourceState(check, state) {
  const head = git(["rev-parse", "HEAD"], check).toString().trim();
  const entries = git(["ls-tree", "-r", "--full-tree", head], check)
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      return m
        ? { mode: m[1], type: "blob", sha: m[2], path: m[3] }
        : { type: "tree" };
    });
  assert(codeTreeDigest(entries) === PRODUCER, "MAC_GN_PRODUCER");
  const selected = entries.filter(
    (r) =>
      r.type === "blob" &&
      (r.path.startsWith("scripts/") ||
        r.path === ".github/workflows/cef-engineering-checkpoint.yml" ||
        r.path === "native/cef-hosted-recipe.json" ||
        r.path === ".node-version" ||
        OWN.includes(r.path)),
  );
  assert(selected.length === 130, "MAC_GN_SOURCE_SET");
  const rows = [];
  for (const entry of selected) {
    assert(
      git(["hash-object", "--", entry.path], check).toString().trim() ===
        entry.sha,
      "MAC_GN_SOURCE_CHANGED",
    );
    const pin = await held(
      path.join(ROOT, entry.path),
      2 * 1024 ** 2,
      check,
      state,
    );
    rows.push({
      path: entry.path,
      gitBlob: entry.sha,
      bytes: pin.bytes,
      sha256: pin.sha256,
    });
  }
  return {
    head,
    maintainedProducer: PRODUCER,
    producer: diagnosticProducer(rows),
    policy: POLICY,
    rows,
  };
}
const PUBLIC = [
  "GITHUB_ACTIONS",
  "RUNNER_ENVIRONMENT",
  "GITHUB_EVENT_NAME",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_REPOSITORY_VISIBILITY",
  "GITHUB_REF",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW_SHA",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "CEF_DEFAULT_BRANCH",
  "ImageOS",
  "ImageVersion",
  "RUNNER_TEMP",
  "SORNG_CEF_TOOLS_ROOT",
];
export async function worker(c, output) {
  assert(
    Number.isFinite(c.workerMilliseconds) &&
      c.workerMilliseconds > 0 &&
      c.workerMilliseconds <= 3600000,
    "MAC_GN_CLOCK",
  );
  const state = {},
    budget = carriedBudget(c.wallEnd, c.workerMilliseconds),
    check = budget.remaining;
  // Actual parent-observed nonsecret GitHub facts are transported because the
  // unchanged process supervisor rejects all GH/GITHUB/ACTIONS env inheritance.
  assert(
    c.publicEnvironment &&
      Object.keys(c.publicEnvironment).sort().join() ===
        [...PUBLIC].sort().join(),
    "MAC_GN_CONTEXT_KEYS",
  );
  for (const name of PUBLIC) {
    assert(
      typeof c.publicEnvironment[name] === "string" &&
        c.publicEnvironment[name].length <= 4096,
      "MAC_GN_CONTEXT_VALUE",
    );
    process.env[name] = c.publicEnvironment[name];
  }
  authority(process.env);
  eventRepository({ repository: c.eventRepository });
  let primary, result, before;
  try {
    state.phase = "source-preflight";
    assert(
      output ===
        path.join(
          await physical(process.env.RUNNER_TEMP),
          "mac-deterministic-evidence",
        ),
      "MAC_GN_OUTPUT",
    );
    before = await sourceState(check, state);
    assert(before.head === process.env.GITHUB_SHA, "MAC_GN_CONTEXT_SOURCE");
    await save(
      path.join(output, "source-witness.json"),
      before,
      LIMIT.context,
      state,
    );
    state.phase = "native-prerequisites";
    await fs.mkdir(path.join(output, "provision"));
    await run(
      process.execPath,
      [
        path.join(ROOT, "scripts/cef-hosted-provision.mjs"),
        "--target",
        "x86_64-apple-darwin",
        "--output",
        path.join(output, "native-prerequisites"),
        "--execute",
      ],
      {
        cwd: ROOT,
        env: process.env,
        logs: path.join(output, "provision"),
        name: "native-prerequisites",
        budget,
      },
    );
    check();
    const profile = checkpointHost(
        "aarch64-apple-darwin",
        process.platform,
        process.arch,
      ),
      work = await workspace(process.env.RUNNER_TEMP, SOURCE, profile.target);
    const verifyInputs = async () => {
      check();
      const selected = await plan({
        inputs: profile.inputs,
        target: profile.target,
        checkout: ROOT,
        runnerMode: "hosted",
      });
      assert(
        releaseIdentity(selected.sourceLock, profile.target)
          .sourceLockSha256 === SOURCE,
        "MAC_GN_INPUT_NAMESPACE",
      );
      check();
      return selected;
    };
    state.phase = "input-admission";
    await verifyInputs();
    state.phase = "maintained-GN";
    result = await stopAfterGn(
      (options) => build(options, process.env),
      {
        inputs: profile.inputs,
        target: profile.target,
        repository: "supermarsx/sortOfRemoteNG",
        execute: true,
        checkout: ROOT,
        runnerMode: "hosted",
        workspace: work,
      },
      async (context) => {
        state.phase = "fixed-five-metadata";
        await authoritativeGn(context, {
          apply: async (ctx) => {
            const transition = await applyMetadata(ctx, check, state, physical);
            await save(
              path.join(output, "helper-metadata-transition.json"),
              transition,
              LIMIT.summary,
              state,
            );
            return transition;
          },
          verify: (ctx, transition) =>
            verifyMetadata(ctx, check, state, held, transition),
          collect: async (ctx, transition) => {
            state.phase = "authoritative-GN-capture";
            await capture(ctx, output, check, state);
            await verifyMetadata(ctx, check, state, held, transition);
            state.metadataPostVerified = true;
          },
        });
        state.phase = "input-tool-postcheck";
        const selected = await verifyInputs();
        await verifyToolchainFiles({
          sourceLock: selected.sourceLock,
          target: profile.target,
          inputsRoot: selected.inputsRoot,
          toolsRoot: context.toolsRoot,
          python: path.join(context.toolsRoot, context.runner.python),
          runnerMapFromInputs: true,
        });
        state.inputsPostVerified = true;
        state.toolsPostVerified = true;
        check();
        state.phase = "complete";
      },
    );
  } catch (error) {
    primary = error;
  } finally {
    try {
      if (before)
        assert(
          canonical(await sourceState(check, state)) === canonical(before),
          "MAC_GN_POST_SOURCE",
        );
      state.sourcePostVerified = Boolean(before);
    } catch (error) {
      state.postcheckFailure = reason(error);
      primary ??= error;
    }
    const receipt = {
      diagnosticOnly: true,
      success: !primary && !state.cleanupFailure && !state.reportingFailure,
      firstFailure: primary ? reason(primary) : null,
      originalFailureScalars: primary ? errorScalars(primary) : null,
      ...state,
      result: result ?? null,
      compilerExecuted: false,
      restoreAccepted: false,
      nativeAcceptance: false,
    };
    try {
      await save(
        path.join(output, "worker-result.json"),
        receipt,
        LIMIT.context,
        state,
      );
    } catch (error) {
      primary ??= error;
      console.error(
        JSON.stringify({
          kind: "mac-gn-worker-report-failure",
          firstFailure: reason(primary),
          reportingFailure: state.reportingFailure,
        }),
      );
    }
  }
  try {
    check();
  } catch (error) {
    primary ??= error;
  }
  if (primary || state.cleanupFailure || state.reportingFailure)
    throw primary ?? Error("MAC_GN_CLEANUP");
}
export async function parent(env = process.env) {
  authority(env);
  const began = Date.now(),
    mono = performance.now(),
    c = { wallEnd: began + 3600000, monoEnd: mono + 3600000 },
    check = () => remaining(c),
    state = {};
  const temp = await physical(env.RUNNER_TEMP),
    output = path.join(temp, "mac-deterministic-evidence");
  await fs.mkdir(output, { mode: 0o700 });
  let primary, originalSupervisor;
  try {
    const eventBytes = [];
    await held(env.GITHUB_EVENT_PATH, 65536, check, state, (b) =>
      eventBytes.push(Buffer.from(b)),
    );
    const event = JSON.parse(Buffer.concat(eventBytes));
    emptyInputs(event);
    c.eventRepository = eventRepository(event);
    c.publicEnvironment = Object.fromEntries(
      PUBLIC.map((name) => [name, env[name] ?? ""]),
    );
    await fs.mkdir(path.join(output, "home"));
    await fs.mkdir(path.join(output, "tmp"));
    await fs.mkdir(path.join(output, "supervisor"));
    c.workerMilliseconds = remaining(c) - 123000;
    assert(c.workerMilliseconds > 0, "MAC_GN_ADMISSION");
    await save(path.join(output, "context.json"), c, LIMIT.context, state);
    const raw = await fs.readFile(path.join(output, "context.json"));
    const clean = {
      PATH: env.PATH,
      HOME: path.join(output, "home"),
      TMPDIR: path.join(output, "tmp"),
    };
    if (env.RUNNER_TRACKING_ID)
      clean.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID;
    const milliseconds = remaining(c) - 123000;
    assert(milliseconds > 0, "MAC_GN_ADMISSION");
    state.supervisorInvoked = true;
    originalSupervisor = await compileSlice(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "--worker",
        path.join(output, "context.json"),
        sha(raw),
      ],
      {
        cwd: ROOT,
        env: clean,
        logs: path.join(output, "supervisor"),
        milliseconds,
      },
    );
    assert(
      originalSupervisor.exitCode === 0 &&
        originalSupervisor.quiescent === true &&
        originalSupervisor.outcome === "compiler-complete",
      "MAC_GN_SUPERVISOR",
    );
    assert(
      JSON.parse(
        await fs.readFile(path.join(output, "worker-result.json"), "utf8"),
      ).success === true,
      "MAC_GN_WORKER",
    );
  } catch (error) {
    primary = error;
  } finally {
    const receipt = {
      kind: "mac-gn-diagnostic-parent",
      success: !primary && !state.cleanupFailure && !state.reportingFailure,
      firstFailure: primary ? reason(primary) : null,
      originalFailureScalars: primary ? errorScalars(primary) : null,
      ...state,
      originalSupervisor: originalSupervisor ?? null,
      cleanupConfirmed: originalSupervisor?.quiescent === true,
      cleanupUnknown: Boolean(
        state.supervisorInvoked && originalSupervisor?.quiescent !== true,
      ),
      supervisorCompilerNamedOutcomeIsNotCompilerEvidence: true,
      compilerExecuted: false,
      restoreAccepted: false,
      sdkBuilt: false,
      nativeAcceptance: false,
    };
    try {
      await save(
        path.join(output, "parent-result.json"),
        receipt,
        LIMIT.context,
        state,
      );
    } catch (error) {
      primary ??= error;
      console.error(
        JSON.stringify({
          kind: "mac-gn-parent-report-failure",
          firstFailure: reason(primary),
          reportingFailure: state.reportingFailure,
        }),
      );
    }
  }
  try {
    check();
  } catch (error) {
    primary ??= error;
  }
  if (primary || state.cleanupFailure || state.reportingFailure)
    throw primary ?? Error("MAC_GN_CLEANUP");
}
async function entry(argv) {
  if (argv.length === 1 && argv[0] === "--execute") return parent();
  assert(
    argv.length === 3 &&
      argv[0] === "--worker" &&
      /^[a-f0-9]{64}$/.test(argv[2]),
    "MAC_GN_ARGV",
  );
  const state = {},
    bytes = [];
  await held(
    argv[1],
    LIMIT.context,
    () => {},
    state,
    (b) => bytes.push(Buffer.from(b)),
  );
  const raw = Buffer.concat(bytes);
  assert(sha(raw) === argv[2], "MAC_GN_CONTEXT_PIN");
  return worker(JSON.parse(raw), path.dirname(argv[1]));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  entry(process.argv.slice(2)).catch((error) => {
    console.error(
      JSON.stringify({
        success: false,
        failure: reason(error),
        diagnosticOnly: true,
        compilerExecuted: false,
      }),
    );
    process.exitCode = 1;
  });
