import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  revalidateLinuxSourceOwner,
  assertLinuxSourceOwnerReceipt,
  cefHookArguments,
} from "../../scripts/cef-runtime-ci.mjs";
import {
  hostRemaining,
  LIMITS,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

// Actual source bodies/callsite in an isolated realm with a modeled command
// runner. No vendor tool, native GN, GitHub or production registry is exercised.
const url = new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url);
const source = (await readFile(url, "utf8")).replaceAll("\r\n", "\n");
const begin = "// BEGIN inactive Linux genuine source owner\n";
const end = "// END inactive Linux genuine source owner\n";
const callBegin = "    // BEGIN inactive Linux genuine source owner callsite\n";
const callEnd = "    // END inactive Linux genuine source owner callsite\n";
const block = source.slice(
  source.indexOf(begin),
  source.indexOf(end) + end.length,
);
const callsite = source.slice(
  source.lastIndexOf(
    "    await call(\n      python,",
    source.indexOf(callBegin),
  ),
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
  const childEnv = { PATH: "/reviewed/bin", SOURCE_DATE_EPOCH: "1790626028" };
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
    body.replace(/^export /gm, "") +
      "\n({revalidateLinuxSourceOwner,assertLinuxSourceOwnerReceipt})",
    scope,
  );
  const invoke = vm.runInContext("(async()=>{\n" + callsite + "\n})", scope);
  return { api, scope, context, invoke, expire: () => (remaining = 0) };
}

test("actual public entries reject forged contexts and receipts before getters or IO", () => {
  let reads = 0;
  const foreign = new Proxy({}, { get: () => (reads++, undefined) });
  for (const candidate of [undefined, null, {}, foreign]) {
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
      "cohortQuietProven",
      "sourceInputsRevalidated",
      "productionReadinessIssued",
      "sourceMigrationAdmitted",
      "nativeAcceptance",
      "runtimeReady",
    ])
      assert.equal(result[field], false);
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
  assert.equal(
    commands[0].options.name,
    "checkpoint-linux-source-revalidation",
  );
  assert.throws(
    () => m.api.assertLinuxSourceOwnerReceipt(m.context, token),
    /RECEIPT/,
  );
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
    m.scope.env = {}; // Legacy callbacks do not acquire a new clock requirement.
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
  m.scope.engineering.afterGn = (context) => {
    operation = m.api.revalidateLinuxSourceOwner(context);
    throw cancellation;
  };
  const outer = m.invoke();
  await entered.promise;
  await Promise.resolve();
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
  m.scope.engineering.afterGn = (context) => {
    operation = m.api.revalidateLinuxSourceOwner(context);
  };
  const outer = m.invoke();
  await entered.promise;
  await Promise.resolve();
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
      run = () => ({then(resolve) { releaseCallback(); resolve(); }});
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
  const old = source
    .replace(block + "\n", "")
    .replace("  hostRemaining,\n", "")
    .replace(
      source.slice(
        source.indexOf(callBegin),
        source.indexOf(callEnd) + callEnd.length,
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
    /retirementReadiness|sourceMigrationAdmitted: true|cohortQuietProven: true/,
  );
});
