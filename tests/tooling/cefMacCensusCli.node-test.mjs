import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { macSourceOperations } from "../../scripts/cef-engineering-checkpoint.mjs";
import * as metadata from "../../scripts/lib/cef-mac-source-metadata.mjs";

const source = await readFile("scripts/cef-engineering-checkpoint.mjs", "utf8");
const helper = source.slice(
  source.indexOf("export async function withMacCensusFactory("),
  source.indexOf("export function argumentsFor("),
);
const uuid = "11111111-1111-4111-8111-111111111111";
const profile = {
  platform: "darwin",
  target: "x86_64-apple-darwin",
  source: "a".repeat(64),
};
const options = {
  env: { RUNNER_TEMP: "/Users/runner/work/_temp" },
  profile,
  python: "/fixed/python",
  canonicalRoot: "/fixed/source",
};
const identity = {
  dev: 1n,
  ino: 2n,
  mode: 0o40700n,
  uid: 501n,
  gid: 20n,
  isDirectory: () => true,
  isSymbolicLink: () => false,
};

function fixture({
  drift = false,
  cleanupError,
  factoryError,
  alias = false,
} = {}) {
  const events = [],
    capability = Object.freeze({ testCapability: true });
  let stats = 0,
    selected;
  const run = vm.runInNewContext(
    "(" + helper.replace("export async", "async") + ")",
    {
      path: path.posix,
      performance: { now: () => 1000 },
      randomUUID: () => uuid,
      fail: (ok, message) => {
        if (!ok) throw Error(message);
      },
      hostRemaining: (env) => {
        assert.equal(env, options.env);
        return 73000;
      },
      noLinks: async (value) => {
        events.push(["noLinks", value]);
        return alias && value.includes(uuid) ? "/alias" : value;
      },
      mkdir: async (value, config) =>
        events.push(["mkdir", value, config.mode]),
      lstat: async () => {
        stats++;
        return drift && stats > 1 ? { ...identity, ino: 3n } : identity;
      },
      rmdir: async (value) => {
        events.push(["rmdir", value]);
        if (cleanupError) throw cleanupError;
      },
      createMacProcessCensusFactory: async (value) => {
        events.push(["factory"]);
        selected = value;
        if (factoryError) throw factoryError;
        return capability;
      },
    },
  );
  return { run, events, capability, selected: () => selected };
}

test("Linux never constructs a Mac helper or touches its filesystem", async () => {
  const f = fixture();
  assert.equal(
    await f.run({ profile: { platform: "linux" } }, (value) => {
      assert.equal(value, undefined);
      return 123;
    }),
    123,
  );
  assert.deepEqual(f.events, []);
});

test("Mac phase gets one fresh private live factory under the original host lease", async () => {
  const f = fixture();
  const result = await f.run(options, async (value) => {
    assert.equal(value, f.capability);
    assert(!f.events.some((row) => row[0] === "rmdir"));
    return 456;
  });
  assert.equal(result, 456);
  const selected = f.selected();
  assert.equal(selected.target, profile.target);
  assert.equal(selected.source, profile.source);
  assert.equal(selected.python, options.python);
  assert.equal(selected.canonicalRoot, options.canonicalRoot);
  assert.equal(selected.deadline, 74000);
  assert.equal(
    selected.scratch,
    options.env.RUNNER_TEMP + "/cef-mac-census-production-" + uuid,
  );
  assert.deepEqual(
    f.events.find((row) => row[0] === "mkdir"),
    ["mkdir", selected.scratch, 0o700],
  );
  assert.deepEqual(f.events.at(-1), ["rmdir", selected.scratch]);
});

test("foreign scratch identity and aliases deny cleanup instead of removing anything", async () => {
  for (const config of [{ drift: true }, { alias: true }]) {
    const f = fixture(config);
    await assert.rejects(
      f.run(options, () => true),
      /Census scratch identity changed/,
    );
    assert(!f.events.some((row) => row[0] === "rmdir"));
  }
});

test("cleanup failure denies a successful operation and preserves every primary failure", async () => {
  const cleanupError = Error("owned-session-still-present");
  await assert.rejects(
    fixture({ cleanupError }).run(options, () => true),
    (error) => error === cleanupError,
  );
  for (const primary of [Error("compile-denied"), null, 0, undefined]) {
    let caught = false;
    try {
      await fixture({ cleanupError }).run(options, () => {
        throw primary;
      });
    } catch (error) {
      caught = true;
      assert.equal(error, primary);
    }
    assert(caught);
  }
  const primary = Error("factory-denied"),
    f = fixture({ factoryError: primary });
  await assert.rejects(
    f.run(options, () => assert.fail("must not execute")),
    (error) => error === primary,
  );
  assert.equal(f.events.at(-1)[0], "rmdir");
});

test("actual CLI wraps compile and each upload with fresh authority and threads the capability", () => {
  const ast = ts.createSourceFile(
    "cli.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const calls = [],
    member = (node, name) =>
      node.properties?.find((prop) => prop.name?.getText(ast) === name);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "withMacCensusFactory"
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(calls.length, 3);
  const expected = ["build", "uploadSdkBundle", "uploadCheckpoint"];
  for (const [index, call] of calls.entries()) {
    const callback = call.arguments[1];
    assert(ts.isArrowFunction(callback));
    assert.equal(callback.parameters[0].name.text, "censusFactory");
    assert(ts.isCallExpression(callback.body));
    assert.equal(callback.body.expression.getText(ast), expected[index]);
    const object = callback.body.arguments[index === 0 ? 0 : 1];
    if (index === 0) {
      const compileCalls = [];
      const find = (node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(ast) === "compileSlice"
        )
          compileCalls.push(node);
        ts.forEachChild(node, find);
      };
      find(object);
      assert.equal(compileCalls.length, 1);
      assert(
        ts.isShorthandPropertyAssignment(
          member(compileCalls[0].arguments[2], "censusFactory"),
        ),
      );
    } else {
      assert(ts.isShorthandPropertyAssignment(member(object, "censusFactory")));
      const root = member(call.arguments[0], "canonicalRoot").initializer;
      assert(ts.isCallExpression(root));
      assert.equal(root.expression.getText(ast), "path.join");
      assert.deepEqual(
        root.arguments.map((arg) => arg.getText(ast)),
        ["temp", '"sorng-cef-engineering"', "TARGET", "SOURCE_ID"],
      );
    }
  }
  const uploadPythons = [];
  const findUploads = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "uploadPython"
    )
      uploadPythons.push(node.initializer);
    ts.forEachChild(node, findUploads);
  };
  findUploads(ast);
  assert.equal(uploadPythons.length, 2);
  for (const node of uploadPythons) {
    assert(ts.isConditionalExpression(node));
    assert.equal(
      node.condition.getText(ast).replace(/\s/g, ""),
      'profile.platform==="darwin"',
    );
    assert.equal(
      node.whenTrue.getText(ast),
      "(await tools(env, profile)).python",
    );
    assert.equal(node.whenFalse.getText(ast), "undefined");
  }
  assert.doesNotMatch(helper, /saved\.|manifest|JSON\.parse|recursive|rm\(/);
});

test("actual metadata worker argv keeps one exact trailing Mac policy and Linux has none", () => {
  const ast = ts.createSourceFile(
    "cli.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const arrays = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "archiveCommand" &&
      ts.isArrayLiteralExpression(node.arguments[2]) &&
      node.arguments[2].elements[0]?.getText(ast) === "selected.mode"
    )
      arrays.push(node.arguments[2]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(arrays.length, 1);
  for (const policy of [undefined, "mac-arm", "mac-intel"]) {
    const selected = {
      mode: "source-record",
      source: "/owned/source",
      sidecar: "/owned/source/src/out/sidecar",
      platformPolicy: policy,
    };
    const actual = vm.runInNewContext("(" + arrays[0].getText(ast) + ")", {
      selected,
      identityFile: "/owned/identity.json",
      helperSeconds: 15,
    });
    assert.deepEqual(Array.from(actual), [
      "source-record",
      "--input",
      selected.source,
      "--output",
      selected.sidecar,
      "--manifest",
      "/owned/identity.json",
      "--seconds",
      "15",
      ...(policy ? ["--platform-policy", policy] : []),
    ]);
  }
});

test("each Mac target selects only its own complete observation and authoritative GN operations", () => {
  for (const [target, mode, names] of [
    [
      "aarch64-apple-darwin",
      "mac-arm",
      [
        "macExternalObservationPlan",
        "readMacExternalObservation",
        "macExternalObservationEvidence",
        "macExternalToolsBinding",
        "prepareAuthoritativeMacGn",
      ],
    ],
    [
      "x86_64-apple-darwin",
      "mac-intel",
      [
        "macIntelExternalObservationPlan",
        "readMacIntelExternalObservation",
        "macIntelExternalObservationEvidence",
        "macIntelExternalToolsBinding",
        "prepareAuthoritativeMacIntelGn",
      ],
    ],
  ]) {
    const ops = macSourceOperations(target);
    assert(Object.isFrozen(ops));
    assert.equal(ops.mode, mode);
    assert.deepEqual(Object.keys(ops).sort(), [
      "binding",
      "evidence",
      "mode",
      "plan",
      "prepare",
      "read",
    ]);
    for (const [index, key] of [
      "plan",
      "read",
      "evidence",
      "binding",
      "prepare",
    ].entries())
      assert.equal(ops[key], metadata[names[index]]);
  }
  assert.equal(macSourceOperations("aarch64-unknown-linux-gnu"), null);
  for (const target of [
    undefined,
    "foreign",
    "aarch64-pc-windows-msvc",
    {},
    "mac-intel",
  ])
    assert.throws(
      () => macSourceOperations(target),
      /Reviewed source metadata target/,
    );
});

test("Intel enters the existing pre-acquisition, fixed-five, binding and complete sidecar lifecycle", () => {
  const ast = ts.createSourceFile(
    "cli.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const calls = [],
    objectDeclarations = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === "sourceMetadata"
    )
      objectDeclarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(objectDeclarations.length, 1);
  const policy = objectDeclarations[0].initializer.getText(ast);
  for (const [target, expected] of [
    ["aarch64-apple-darwin", "mac-arm"],
    ["x86_64-apple-darwin", "mac-intel"],
    ["aarch64-unknown-linux-gnu", true],
  ])
    assert.equal(
      vm.runInNewContext(policy, { macSource: macSourceOperations(target) }),
      expected,
    );
  for (const name of ["plan", "read", "evidence", "prepare"])
    assert.equal(
      calls.filter(
        (call) => call.expression.getText(ast) === "macSource." + name,
      ).length,
      1,
    );
  assert.equal(
    calls.filter((call) => call.expression.getText(ast) === "macSource.binding")
      .length,
    3,
  );
  const plan = calls.find(
    (call) => call.expression.getText(ast) === "macSource.plan",
  );
  const argument = plan.arguments[0].getText(ast);
  for (const mode of ["mac-arm", "mac-intel"]) {
    const result = vm.runInNewContext("(" + argument + ")", {
      verified: {},
      sdkRelation: {},
      context: { metal: {} },
      env: { RUNNER_TEMP: "/owned" },
      output: "/owned/output",
      hostRemaining: () => 1234,
      macSource: { mode },
      SOURCE_ID: "fixed-source",
    });
    assert.equal(
      result.sourceLockIdentity,
      mode === "mac-intel" ? "fixed-source" : undefined,
    );
  }
  const lifecycle = calls.filter(
    (call) =>
      call.expression.getText(ast) === "sourceMetadata" ||
      call.expression.getText(ast) === "context.checkpoint.sourceMetadata",
  );
  assert.deepEqual(lifecycle.map((call) => call.arguments[0].text).sort(), [
    "source-apply",
    "source-apply",
    "source-record",
    "source-verify",
  ]);
  const prepare = calls.find(
    (call) => call.expression.getText(ast) === "macSource.prepare",
  );
  const graph = calls.find(
    (call) => call.expression.getText(ast) === "graphInventory",
  );
  assert(prepare.pos < graph.pos);
  assert.match(
    source,
    /if \(macSource\) \{\s*const fresh = await context\.reobserveMacExternalInputs\(\)/,
  );
  assert.match(
    source,
    /if \(macSource \|\| TARGET === "aarch64-unknown-linux-gnu"\)/,
  );
});
