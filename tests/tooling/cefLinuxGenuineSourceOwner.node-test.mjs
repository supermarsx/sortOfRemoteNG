import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import {
  revalidateLinuxSourceOwner,
  assertLinuxSourceOwnerReceipt,
  assertLiveLinuxSourceContext,
  cefHookArguments,
  createHostedBuildBudget,
} from "../../scripts/cef-runtime-ci.mjs";
import {
  hostRemaining,
  LIMITS,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

// Actual source bodies/callsite in an isolated realm with a modeled command
// runner. No vendor tool, native GN, GitHub or production registry is exercised.
const url = new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url);
const source = (await readFile(url, "utf8")).replaceAll("\r\n", "\n");
assert.equal(Buffer.byteLength(source), 77173);
assert.equal(
  createHash("sha256").update(source).digest("hex"),
  "0b1e92b48812a697895f43a3310ac450fbecdc19c3dd1b2cc5619589bda31523",
);
function withoutMacOriginalSourceLease(text) {
  const current =
    '  // BEGIN fixed Linux engineering source budget\n  let budget =\n    runnerMode === "hosted"\n      ? createHostedBuildBudget(\n          engineering\n            ? (target === "x86_64-apple-darwin" ||\n              target === "aarch64-apple-darwin"\n                ? 180\n                : 120) * 60_000\n            : undefined,\n        )\n      : undefined;\n  // END fixed Linux engineering source budget';
  const prior =
    '  // BEGIN fixed Linux engineering source budget\n  let budget =\n    runnerMode === "hosted"\n      ? createHostedBuildBudget(engineering ? 120 * 60_000 : undefined)\n      : undefined;\n  // END fixed Linux engineering source budget';
  assert.equal(text.split(current).length, 2);
  const restored = text.replace(current, prior);
  assert.equal(Buffer.byteLength(restored), 77002);
  assert.equal(
    createHash("sha256").update(restored).digest("hex"),
    "cfd1b9a5ccc6c697e17ed9eba22478ae38e10eda2a584c3d2776554ce7a534f3",
  );
  return restored;
}

function withoutMacPreparationBudget(text) {
  text = withoutMacOriginalSourceLease(text);
  for (const [current, prior] of [
    [
      '  // BEGIN fixed Linux engineering source budget\n  let budget =\n    runnerMode === "hosted"\n      ? createHostedBuildBudget(engineering ? 120 * 60_000 : undefined)\n      : undefined;\n  // END fixed Linux engineering source budget\n  if (engineering) {\n',
      '  // BEGIN fixed Linux engineering source budget\n  let budget =\n    runnerMode === "hosted"\n      ? createHostedBuildBudget(\n          engineering\n            ? target === "aarch64-unknown-linux-gnu"\n              ? 120 * 60_000\n              : 60 * 60_000\n            : undefined,\n        )\n      : undefined;\n  // END fixed Linux engineering source budget\n  if (engineering) {\n',
    ],
    [
      '    { flag: "wx" },\n  );\n  Object.assign(childEnv, recipe.environment);\n  // BEGIN retained original preparation budget diagnostic\n  const sourceBudget = budget;\n  // END retained original preparation budget diagnostic\n  const engineeringContext = {\n    // BEGIN retained original preparation budget diagnostic\n    sourceRemainingMilliseconds: () => sourceBudget?.remaining(),\n    // END retained original preparation budget diagnostic\n    sourceLockIdentity: identity.sourceLockSha256,\n    metal,\n    ...(macExternalInputs === undefined ? {} : { macExternalInputs }),\n',
      '    { flag: "wx" },\n  );\n  Object.assign(childEnv, recipe.environment);\n  const engineeringContext = {\n    sourceLockIdentity: identity.sourceLockSha256,\n    metal,\n    ...(macExternalInputs === undefined ? {} : { macExternalInputs }),\n',
    ],
  ]) {
    assert.equal(text.split(current).length, 2);
    text = text.replace(current, prior);
  }
  assert.equal(Buffer.byteLength(text), 76797);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "12fa593fb734ddbfad46e2a89c1d615c3542bf0f27bb64dce368de4a260e0831",
  );
  return text;
}
function withoutColdMetalRuntime(text) {
  text = withoutMacPreparationBudget(text);
  for (const [current, prior] of [
    [
      "  prepareMacMetalToolchain,\n  revalidateMacMetalToolchain,\n  macMetalCommandDiagnostic,\n",
      "  prepareMacMetalToolchain,\n",
    ],
    [
      "  const record = async (status, cause, metalCommand) => {",
      "  const record = async (status, cause) => {",
    ],
    ["      ...(metalCommand ? { metalCommand } : {}),\n", ""],
    [
      '      await record("failure", cause, macMetalCommandDiagnostic(error));',
      '      await record("failure", cause);',
    ],
    [
      "      const currentMetal = await revalidateMacMetalToolchain({",
      "      const currentMetal = await prepareMacMetalToolchain({",
    ],
  ]) {
    assert.equal(
      text.split(current).length,
      2,
      "one exact cold Metal runtime inverse",
    );
    text = text.replace(current, prior);
  }
  assert.equal(Buffer.byteLength(text), 76637);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "626a0c34481f18c5044be88c47ca72bf3312dfbe1a5858b69936b683a9bf3182",
  );
  return text;
}
function withoutLinuxSourceBudget(text) {
  text = withoutColdMetalRuntime(text);
  const begin = "  // BEGIN fixed Linux engineering source budget\n",
    end = "  // END fixed Linux engineering source budget\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  const previous =
    '  let budget =\n    runnerMode === "hosted"\n      ? createHostedBuildBudget(engineering ? 60 * 60_000 : undefined)\n      : undefined;\n';
  const restored = text.replace(
    text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
    previous,
  );
  assert.equal(Buffer.byteLength(restored), 76412);
  assert.equal(
    createHash("sha256").update(restored).digest("hex"),
    "8eaf57312438c26ed5bc8e58070bb685daf11aeaa83e06594cfb746c4d8b20fe",
  );
  return restored;
}
test("Linux120 and Mac180 engineering use one original preparation budget; ordinary300 and host fence remain", () => {
  const begin = source.indexOf(
      "  // BEGIN fixed Linux engineering source budget\n",
    ),
    end = source.indexOf(
      "  // END fixed Linux engineering source budget\n",
      begin,
    );
  const select = new Function(
    "runnerMode",
    "engineering",
    "target",
    "createHostedBuildBudget",
    source.slice(begin, end) + "\nreturn budget;",
  );
  for (const [engineering, target, minutes] of [
    [true, "aarch64-unknown-linux-gnu", 120],
    [true, "aarch64-apple-darwin", 180],
    [true, "x86_64-apple-darwin", 180],
    [false, "aarch64-unknown-linux-gnu", 300],
  ]) {
    let now = 10,
      calls = 0;
    const budget = select("hosted", engineering, target, (ms) => {
      calls++;
      return createHostedBuildBudget(ms, () => now);
    });
    assert.equal(calls, 1);
    assert.equal(budget.remaining(), minutes * 60000);
    now += 65 * 60000;
    assert.equal(budget.remaining(), (minutes - 65) * 60000);
    if (engineering && target.includes("apple")) {
      let oldNow = 10;
      const old = createHostedBuildBudget(60 * 60000, () => oldNow);
      oldNow += 65 * 60000;
      assert.equal(
        old.remaining(),
        0,
        "old60min lease is exhausted on measured65min path",
      );
      assert(
        budget.remaining() > 0,
        "actual65min source path remains inside original180min",
      );
    }
    now += minutes * 60000;
    assert.equal(budget.remaining(), 0);
    assert.throws(() => budget.assertRemaining());
  }
  assert.equal(
    select("dedicated", true, "aarch64-unknown-linux-gnu", () =>
      assert.fail("hosted-only"),
    ),
    undefined,
  );
  assert(source.includes("remaining: () => originalBudget.remaining()"));
  assert(supervision.includes("hostRemaining(capture.hostClock)"));
  withoutLinuxSourceBudget(source);
});
const begin = "// BEGIN inactive Linux genuine source owner\n";
const end = "// END inactive Linux genuine source owner\n";
const callBegin = "    // BEGIN inactive Linux genuine source owner callsite\n";
const callEnd = "    // END inactive Linux genuine source owner callsite\n";
const supervisionBegin = "// BEGIN inactive Linux fixed GN supervision\n";
const supervisionEnd = "// END inactive Linux fixed GN supervision\n";
const supervision = source.slice(
  source.indexOf(supervisionBegin),
  source.indexOf(supervisionEnd) + supervisionEnd.length,
);
const block = source.slice(
  source.indexOf(begin),
  source.indexOf(end) + end.length,
);
const callsite = source.slice(
  source.indexOf("    // BEGIN inactive Linux supervised GN dispatch\n"),
  source.indexOf(callEnd) + callEnd.length,
);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function model({
  run = async () => {},
  call = async () => {},
  body = block,
} = {}) {
  let remaining = 60000;
  const directories = new Map();
  const signals = [];
  const stamp = (name) => ({
    dev: 1n,
    ino: BigInt(directories.get(name) ?? 1),
    mode: name.endsWith("logs") ? 0o40755n : 0o40700n,
    uid: 0n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  });
  const childEnv = {
    PATH: "/reviewed/bin",
    SOURCE_DATE_EPOCH: "1790626028",
    TZ: "foreign-zone",
    HOME: "/owned/git/home",
    GIT_CONFIG_GLOBAL: "/owned/git/global",
    GIT_CONFIG_NOSYSTEM: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    RUNNER_TRACKING_ID: "owned-tracking",
  };
  const context = {
    env: childEnv,
    revalidateGn() {
      throw new Error("mutable legacy callback must not supply authority");
    },
  };
  const scope = vm.createContext({
    fail(message) {
      throw new Error(message);
    },
    hostRemaining,
    run,
    call,
    path: path.posix,
    process: { getuid: () => 0 },
    constants: { O_RDONLY: 0, O_NOFOLLOW: 1, O_DIRECTORY: 2 },
    realpath: async (name) => name,
    lstat: async (name) => stamp(name),
    mkdir: async (name) => {
      if (directories.has(name)) throw new Error("EEXIST");
      directories.set(name, directories.size + 2);
    },
    open: async (name) => ({
      stat: async () => stamp(name),
      close: async () => {},
    }),
    AbortController,
    setTimeout,
    clearTimeout,
    compileSlice: async (exe, args, options) => {
      if (options.stopSignal) signals.push(options.stopSignal);
      if (options.logs.endsWith("-initial")) await call(exe, args, options);
      else await run(exe, args, options);
      return {
        outcome: "compiler-complete",
        exitCode: 0,
        quiescent: true,
        quiescence: "observed-lineage-and-root-group",
      };
    },
    cefHookArguments,
    engineeringContext: context,
    index: 0,
    target: "aarch64-unknown-linux-gnu",
    python: "/reviewed/python3.12",
    cef: "/owned/source/src/cef",
    depot: "/owned/source/depot_tools",
    work: "/owned",
    toolsRoot: "/reviewed",
    logs: "/owned/logs",
    childEnv,
    step: { cwd: "/owned/source/src", args: ["cef/tools/gclient_hook.py"] },
    identity: { sourceLockSha256: "a".repeat(64) },
    env: { CEF_ENGINEERING_JOB_STARTED_MS: String(Date.now()) },
    budget: { remaining: () => remaining },
    engineering: { afterGn: async () => {} },
  });
  const api = vm.runInContext(
    supervision +
      body.replace(/^export /gm, "") +
      "\n({revalidateLinuxSourceOwner,assertLinuxSourceOwnerReceipt,assertLiveLinuxSourceContext})",
    scope,
  );
  const invoke = vm.runInContext("(async()=>{\n" + callsite + "\n})", scope);
  return {
    api,
    scope,
    context,
    invoke,
    directories,
    signals,
    setRemaining: (value) => (remaining = value),
    expire: () => (remaining = 0),
  };
}

test("actual public entries reject forged contexts and receipts before getters or IO", () => {
  let reads = 0;
  const foreign = new Proxy({}, { get: () => (reads++, undefined) });
  for (const candidate of [undefined, null, {}, foreign]) {
    assert.throws(
      () => assertLiveLinuxSourceContext(candidate),
      /OWNER_REQUIRED/,
    );
    assert.throws(
      () => revalidateLinuxSourceOwner(candidate),
      /OWNER_REQUIRED/,
    );
    assert.throws(
      () => assertLinuxSourceOwnerReceipt(candidate, foreign),
      /OWNER_RECEIPT/,
    );
  }
  assert.equal(reads, 0);
});

test("live assertion is synchronous copied diagnostics of the actual interval and used revalidation", async () => {
  const m = model();
  m.scope.engineering.afterGn = async (context) => {
    const before = m.api.assertLiveLinuxSourceContext(context);
    assert.equal(before.revalidationUsed, false);
    assert.equal(before.initialCohortQuietProven, true);
    assert(Object.isFrozen(before));
    await m.api.revalidateLinuxSourceOwner(context);
    assert.equal(
      m.api.assertLiveLinuxSourceContext(context).revalidationUsed,
      true,
    );
    assert.equal(before.revalidationUsed, false);
  };
  await m.invoke();
  assert.throws(
    () => m.api.assertLiveLinuxSourceContext(m.context),
    /REQUIRED/,
  );
});

test("live-assertion delta restores the complete committed GN2 runtime", () => {
  const first = "// BEGIN inactive Linux source live assertion\n";
  const last = "// END inactive Linux source live assertion\n";
  const section = source.slice(
    source.indexOf(first),
    source.indexOf(last) + last.length,
  );
  assert.equal(source.split(section + "\n").length, 2);
  const original = withoutLinuxSourceBudget(source).replace(section + "\n", "");
  assert.equal(Buffer.byteLength(original), 75872);
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "6e5245ff09fc15a2cbffd350f7b798ed3d7464b26e6fb0ec17f6c5d33ea5b65c",
  );
});

test("actual completed GN callsite registers only its afterGn interval and captures immutable authority", async () => {
  const commands = [],
    events = [];
  const m = model({
    call: async () => events.push("initial-GN-completed"),
    run: async (exe, args, options) => {
      commands.push({ exe, args, options });
      events.push("fixed-revalidation");
    },
  });
  let token;
  m.scope.engineering.afterGn = async (context) => {
    events.push("afterGn");
    assert.equal(context, m.context);
    context.env.PATH = "/foreign";
    context.python = "/foreign/python";
    context.cwd = "/foreign";
    context.toolsRoot = "/foreign";
    m.scope.step.cwd = "/foreign";
    token = await m.api.revalidateLinuxSourceOwner(context);
    const result = m.api.assertLinuxSourceOwnerReceipt(context, token);
    assert.equal(result.python, "/reviewed/python3.12");
    assert.equal(result.cwd, "/owned/source/src");
    assert.equal(result.toolsRoot, "/reviewed");
    assert.equal(result.sourceLockIdentity, "a".repeat(64));
    assert.equal(result.commandCompleted, true);
    for (const field of [
      "sourceInputsRevalidated",
      "productionReadinessIssued",
      "sourceMigrationAdmitted",
      "nativeAcceptance",
      "runtimeReady",
    ])
      assert.equal(result[field], false);
    assert.equal(result.cohortQuietProven, true);
    assert.equal(result.quiescence, "observed-lineage-and-root-group");
    assert(Object.isFrozen(result));
    assert.throws(
      () => m.api.revalidateLinuxSourceOwner(context),
      /ALREADY_USED/,
    );
    assert.throws(
      () => assertLinuxSourceOwnerReceipt(context, token),
      /RECEIPT/,
    );
  };
  await m.invoke();
  assert.deepEqual(events, [
    "initial-GN-completed",
    "afterGn",
    "fixed-revalidation",
  ]);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].exe, "/reviewed/python3.12");
  assert.deepEqual(
    [...commands[0].args],
    cefHookArguments("/owned/source/src/cef", "/owned/source/depot_tools"),
  );
  assert.equal(commands[0].options.env.PATH, "/reviewed/bin");
  assert(Object.isFrozen(commands[0].options.env));
  assert.equal(commands[0].options.logs, "/owned/logs/source-gn-revalidation");
  assert.equal(commands[0].options.env.TZ, "UTC");
  for (const key of [
    "HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "PYTHONDONTWRITEBYTECODE",
    "RUNNER_TRACKING_ID",
    "SOURCE_DATE_EPOCH",
  ])
    assert.equal(commands[0].options.env[key], m.scope.childEnv[key]);
  assert.equal(commands[0].options.milliseconds, 30000);
  assert.equal(commands[0].options.out, undefined);
  assert.equal(commands[0].options.censusFactory, undefined);
  assert.throws(
    () => m.api.assertLinuxSourceOwnerReceipt(m.context, token),
    /RECEIPT/,
  );
  assert.throws(() => m.api.revalidateLinuxSourceOwner(m.context), /REQUIRED/);
});

test("both genuine GN stages require natural zero and exact observed-cohort quiet", async () => {
  for (const role of ["initial", "revalidation"]) {
    for (const change of [
      { outcome: "slice-ended" },
      { outcome: "compiler-failed", exitCode: 137 },
      { exitCode: null },
      { quiescent: false },
      { quiescence: "root-close-only" },
    ]) {
      const m = model();
      const supervised = m.scope.compileSlice;
      m.scope.compileSlice = async (...args) => {
        const result = await supervised(...args);
        return args[2].logs.endsWith(`-${role}`)
          ? { ...result, ...change }
          : result;
      };
      let callbacks = 0;
      m.scope.engineering.afterGn = async (context) => {
        callbacks++;
        await m.api.revalidateLinuxSourceOwner(context);
      };
      await assert.rejects(m.invoke(), /GN_COHORT_UNCONFIRMED/);
      assert.equal(callbacks, role === "initial" ? 0 : 1);
      assert.throws(
        () => m.api.revalidateLinuxSourceOwner(m.context),
        /REQUIRED/,
      );
    }
  }
});

test("credential prefixes are denied before GN or log creation while fixed source variables survive", async () => {
  for (const key of ["GH_TOKEN", "github_token", "ACTIONS_RUNTIME_TOKEN"]) {
    const m = model({ call: () => assert.fail("credential reached command") });
    m.scope.childEnv[key] = "fixture-only";
    await assert.rejects(m.invoke(), /GN_CREDENTIAL/);
    assert.equal(m.directories.size, 0);
  }
});

test("cleanup reserve and log setup consume the same original work lease", async () => {
  for (const milliseconds of [30000, 29999, 1]) {
    const m = model({ call: () => assert.fail("reserve reached GN") });
    m.setRemaining(milliseconds);
    await assert.rejects(m.invoke(), /GN_CLEANUP_RESERVE/);
    assert.equal(m.directories.size, 0);
  }
  const m = model({ call: () => assert.fail("setup exhausted GN work") });
  const create = m.scope.mkdir;
  m.scope.mkdir = async (...args) => {
    await create(...args);
    m.setRemaining(30000);
  };
  let closes = 0;
  const opened = m.scope.open;
  m.scope.open = async (...args) => {
    const handle = await opened(...args);
    handle.close = async () => {
      closes++;
    };
    return handle;
  };
  await assert.rejects(m.invoke(), /GN_CLEANUP_RESERVE/);
  assert.equal(closes, 1);
});

test("exclusive GN log namespaces reject collisions aliases and physical replacement", async () => {
  for (const kind of [
    "collision",
    "alias",
    "parent-replacement",
    "child-replacement",
    "opened-mismatch",
  ]) {
    const m = model();
    if (kind === "collision")
      m.directories.set("/owned/logs/source-gn-initial", 42);
    if (kind === "alias") m.scope.realpath = async () => "/foreign";
    if (kind.endsWith("replacement")) {
      const supervised = m.scope.compileSlice;
      m.scope.compileSlice = async (...args) => {
        const result = await supervised(...args);
        m.directories.set(
          kind === "parent-replacement" ? "/owned/logs" : args[2].logs,
          999,
        );
        return result;
      };
    }
    if (kind === "opened-mismatch") {
      const opened = m.scope.open;
      m.scope.open = async (...args) => {
        const handle = await opened(...args),
          stamp = await handle.stat();
        handle.stat = async () => ({ ...stamp, ino: 999n });
        return handle;
      };
    }
    await assert.rejects(m.invoke(), /EEXIST|GN_LOG_DIRECTORY/);
  }
});

test("held GN log close is joined before success and preserves an identical primary failure", async () => {
  for (const marker of [
    undefined,
    null,
    false,
    0,
    "",
    new Error("first supervision failure"),
  ]) {
    const m = model({
      call: async () => {
        throw marker;
      },
    });
    const opened = m.scope.open;
    let closes = 0;
    m.scope.open = async (...args) => {
      const handle = await opened(...args);
      handle.close = async () => {
        closes++;
        throw new Error("later close failure");
      };
      return handle;
    };
    await m.invoke().then(
      () => assert.fail("lost first failure"),
      (error) => assert.equal(error, marker),
    );
    assert.equal(closes, 1);
  }
  const closeFailed = model();
  const opened = closeFailed.scope.open;
  closeFailed.scope.open = async (...args) => {
    const handle = await opened(...args);
    handle.close = async () => {
      throw new Error("close denied");
    };
    return handle;
  };
  await assert.rejects(closeFailed.invoke(), /close denied/);
  const late = model();
  const lateOpen = late.scope.open;
  late.scope.open = async (...args) => {
    const handle = await lateOpen(...args);
    handle.close = async () => late.expire();
    return handle;
  };
  await assert.rejects(late.invoke(), /OWNER_DEADLINE/);
});

test("a pending creation-owned close denies at its original lease and never admits a late close", async () => {
  const closing = deferred();
  const m = model();
  let attempts = 0,
    callbacks = 0;
  const opened = m.scope.open;
  m.scope.open = async (...args) => {
    const handle = await opened(...args);
    handle.close = () => {
      attempts++;
      return closing.promise;
    };
    return handle;
  };
  m.scope.engineering.afterGn = () => callbacks++;
  const scheduled = [];
  m.scope.setTimeout = (callback, milliseconds) => {
    scheduled.push(milliseconds);
    queueMicrotask(() => {
      m.expire();
      callback();
    });
    return 0;
  };
  m.scope.clearTimeout = () => {};
  await assert.rejects(m.invoke(), /GN_LOG_CLOSE_DEADLINE/);
  assert.deepEqual(scheduled, [30000]);
  assert.equal(attempts, 1);
  assert.equal(callbacks, 0);
  closing.resolve();
  await Promise.resolve();
  assert.equal(callbacks, 0);
  assert.throws(() => m.api.revalidateLinuxSourceOwner(m.context), /REQUIRED/);
});

test("failed initial GN never registers or calls afterGn and preserves falsy failures", async () => {
  for (const marker of [undefined, null, false, 0, ""]) {
    const m = model({
      call: async () => {
        throw marker;
      },
    });
    let callbacks = 0;
    m.scope.engineering.afterGn = () => callbacks++;
    await m.invoke().then(
      () => assert.fail("initial failure was lost"),
      (error) => assert.equal(error, marker),
    );
    assert.equal(callbacks, 0);
    assert.throws(
      () => m.api.revalidateLinuxSourceOwner(m.context),
      /REQUIRED/,
    );
  }
});

test("legacy callbacks and non-Linux callsites retain ordinary behavior without new authority", async () => {
  for (const target of ["aarch64-unknown-linux-gnu", "aarch64-apple-darwin"]) {
    const m = model();
    m.scope.target = target;
    if (target !== "aarch64-unknown-linux-gnu") m.scope.env = {};
    let calls = 0;
    m.scope.engineering.afterGn = async () => calls++;
    await m.invoke();
    assert.equal(calls, 1);
  }
});

test("concurrent revalidation cannot start a second command and foreign receipts do not cross owners", async () => {
  const gate = deferred();
  let commands = 0;
  const m = model({
    run: () => {
      commands++;
      return gate.promise;
    },
  });
  m.scope.engineering.afterGn = async (context) => {
    const operation = m.api.revalidateLinuxSourceOwner(context);
    assert.throws(
      () => m.api.revalidateLinuxSourceOwner(context),
      /ALREADY_USED/,
    );
    gate.resolve();
    const token = await operation;
    assert.throws(
      () => m.api.assertLinuxSourceOwnerReceipt({}, token),
      /RECEIPT/,
    );
  };
  await m.invoke();
  assert.equal(commands, 1);
});

test("original source and whole-job leases deny late success without a reset", async () => {
  const gate = deferred();
  const m = model({ run: () => gate.promise });
  m.scope.engineering.afterGn = async (context) => {
    const operation = m.api.revalidateLinuxSourceOwner(context);
    m.expire();
    gate.resolve();
    await assert.rejects(operation, /DEADLINE/);
  };
  await assert.rejects(m.invoke(), /DEADLINE/);
  const expired = model({ run: () => assert.fail("expired job spawned") });
  expired.scope.env.CEF_ENGINEERING_JOB_STARTED_MS = String(
    Date.now() - LIMITS.hostMs - 1,
  );
  expired.scope.engineering.afterGn = (context) =>
    expired.api.revalidateLinuxSourceOwner(context);
  await assert.rejects(expired.invoke(), /Engineering host clock required/);
});

test("native operation and callback failures keep the identical first falsy error", async () => {
  for (const marker of [undefined, null, false, 0, ""]) {
    const m = model({
      run: async () => {
        throw marker;
      },
    });
    m.scope.engineering.afterGn = async (context) => {
      await m.api.revalidateLinuxSourceOwner(context).catch(() => {});
      throw new Error("later callback failure");
    };
    await m.invoke().then(
      () => assert.fail("failure was erased"),
      (error) => assert.equal(error, marker),
    );
  }
});

test("used source context cannot finish its callback after the original lease expires", async () => {
  const m = model();
  m.scope.engineering.afterGn = async (context) => {
    const token = await m.api.revalidateLinuxSourceOwner(context);
    assert.equal(
      m.api.assertLinuxSourceOwnerReceipt(context, token).commandCompleted,
      true,
    );
    m.expire();
  };
  await assert.rejects(m.invoke(), /DEADLINE/);
});

test("callback cancellation revokes before joining and keeps its original reason", async () => {
  const gate = deferred(),
    entered = deferred();
  const cancellation = new Error("original caller cancellation");
  const m = model({
    run: () => {
      entered.resolve();
      return gate.promise;
    },
  });
  let operation;
  m.scope.engineering.afterGn = async (context) => {
    operation = m.api.revalidateLinuxSourceOwner(context);
    await entered.promise;
    throw cancellation;
  };
  const outer = m.invoke();
  await entered.promise;
  await new Promise((resolve) =>
    m.signals[0].aborted
      ? resolve()
      : m.signals[0].addEventListener("abort", resolve, { once: true }),
  );
  assert.throws(() => m.api.revalidateLinuxSourceOwner(m.context), /REQUIRED/);
  gate.resolve();
  for (const value of [outer, operation])
    await value.then(
      () => assert.fail("cancelled operation succeeded"),
      (error) => assert.equal(error, cancellation),
    );
});

test("retirement precedes an escaped operation join and prevents late branding", async () => {
  const gate = deferred(),
    entered = deferred();
  const m = model({
    run: () => {
      entered.resolve();
      return gate.promise;
    },
  });
  let operation;
  m.scope.engineering.afterGn = async (context) => {
    operation = m.api.revalidateLinuxSourceOwner(context);
    await entered.promise;
  };
  const outer = m.invoke();
  await entered.promise;
  await new Promise((resolve) =>
    m.signals[0].aborted
      ? resolve()
      : m.signals[0].addEventListener("abort", resolve, { once: true }),
  );
  assert.throws(() => m.api.revalidateLinuxSourceOwner(m.context), /REQUIRED/);
  let joined = false;
  void outer.catch(() => {
    joined = true;
  });
  await Promise.resolve();
  assert.equal(joined, false);
  gate.resolve();
  const failure = await outer.then(
    () => assert.fail("escaped command was admitted"),
    (error) => error,
  );
  assert.match(failure.message, /ESCAPED/);
  await operation.then(
    () => assert.fail("late command minted a receipt"),
    (error) => assert.equal(error, failure),
  );
});

test("same-realm final await retirement is causal: unguarded control mints, actual body denies", async () => {
  const guard =
    "      retainedLinuxSourceOwner(context, state, epoch);\n      const receipt";
  assert.equal(block.split(guard).length, 2);
  for (const guarded of [false, true]) {
    const m = model({
      body: guarded ? block : block.replace(guard, "      const receipt"),
    });
    vm.runInContext(
      `
      let releaseCallback;
      const callbackPromise = new Promise(resolve => { releaseCallback = resolve; });
      superviseLinuxSourceGn = (capture,role) => role === 'initial'
        ? Promise.resolve()
        : ({then(resolve) { releaseCallback(); resolve(); }});
      engineering.afterGn = context => {
        globalThis.racingOperation = revalidateLinuxSourceOwner(context);
        return callbackPromise;
      };
    `,
      m.scope,
    );
    await assert.rejects(m.invoke(), /ESCAPED/);
    if (guarded) await assert.rejects(m.scope.racingOperation, /ESCAPED/);
    else {
      const token = await m.scope.racingOperation;
      assert.equal(token.kind, "provisional-linux-source-owner-revalidation");
      assert.throws(
        () => m.api.assertLinuxSourceOwnerReceipt(m.context, token),
        /RECEIPT/,
      );
    }
  }
});

test("bounded inverse restores the complete old runtime producer and exposes no registry writer", () => {
  assert.equal(source.split(begin).length, 2);
  assert.equal(source.split(callBegin).length, 2);
  assert.equal(source.split("linuxSourceOwners.set(").length, 2);
  assert.equal(source.split("await withLinuxSourceOwner(").length, 2);
  const dispatchBegin = "    // BEGIN inactive Linux supervised GN dispatch\n";
  const dispatchEnd = "    // END inactive Linux supervised GN dispatch\n";
  const oldCommand =
    "    await call(\n      python,\n      index === 0 ? cefHookArguments(cef, depot) : step.args,\n      `build-${index}`,\n      step.cwd,\n    );\n";
  function inverse(text, from, to) {
    assert.equal(text.split(from).length, 2, "exact historical span");
    return text.replace(from, to);
  }
  let prior = inverse(withoutLinuxSourceBudget(source), supervision + "\n", "");
  const liveBegin = "// BEGIN inactive Linux source live assertion\n";
  const liveEnd = "// END inactive Linux source live assertion\n";
  prior = inverse(
    prior,
    source.slice(
      source.indexOf(liveBegin),
      source.indexOf(liveEnd) + liveEnd.length,
    ) + "\n",
    "",
  );
  prior = inverse(prior, "  compileSlice,\n", "");
  prior = inverse(
    prior,
    source.slice(
      source.indexOf(dispatchBegin),
      source.indexOf(dispatchEnd) + dispatchEnd.length,
    ),
    oldCommand,
  );
  prior = inverse(
    prior,
    '          env: Object.freeze({ ...childEnv, TZ: "UTC" }),',
    "          env: Object.freeze({ ...childEnv }),",
  );
  prior = inverse(
    prior,
    '        await superviseLinuxSourceGn(capture, "initial");\n',
    "",
  );
  prior = inverse(
    prior,
    "    context,\n    controller: new AbortController(),\n",
    "",
  );
  prior = inverse(prior, "    state.controller.abort(state.error);\n", "");
  prior = inverse(
    prior,
    '      await superviseLinuxSourceGn(fixed, "revalidation", state);',
    `      const commandBudget = Object.freeze({
        remaining: () => retainedLinuxSourceOwner(context, state, epoch),
        assertRemaining() {
          retainedLinuxSourceOwner(context, state, epoch);
        },
      });
      await run(fixed.python, fixed.args, {
        cwd: fixed.cwd,
        env: fixed.env,
        logs: fixed.logs,
        name: "checkpoint-linux-source-revalidation",
        budget: commandBudget,
      });`,
  );
  prior = inverse(
    prior,
    '          cohortQuietProven: true,\n          quiescence: "observed-lineage-and-root-group",',
    "          cohortQuietProven: false,",
  );
  assert.equal(Buffer.byteLength(prior), 71845);
  assert.equal(
    createHash("sha256").update(prior).digest("hex"),
    "6226fc3ba41339da03620d8b4b36be3d57c7b13a06fbdbe820651d7db6628e91",
  );
  const priorBlock = prior.slice(
    prior.indexOf(begin),
    prior.indexOf(end) + end.length,
  );
  const old = prior
    .replace(priorBlock + "\n", "")
    .replace("  hostRemaining,\n", "")
    .replace(
      prior.slice(
        prior.indexOf(callBegin),
        prior.indexOf(callEnd) + callEnd.length,
      ),
      "    if (engineering && index === 0)\n      await engineering.afterGn(engineeringContext);\n",
    );
  assert.equal(Buffer.byteLength(old), 66326);
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "d61a309ce4df33c2f458414d4ad6f9005523fa83743878b9dc7365c74468da3d",
  );
  assert.doesNotMatch(
    block,
    /retirementReadiness|sourceMigrationAdmitted: true|sourceInputsRevalidated: true/,
  );
});
