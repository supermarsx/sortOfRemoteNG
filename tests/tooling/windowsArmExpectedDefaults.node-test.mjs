import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { parse } from "acorn";
import {
  EXPECTED_DEFAULTS_INTEGRATION_ADMITTED,
  ARM64_EXPECTED_DEFAULTS_POLICY,
  inspectExpectedArm64Defaults,
} from "../../native/windows-arm-full-sdk/expected-defaults.mjs";

// Immutable independent reviewer DATA, never executable code or native evidence.
const reviewDataDeflate =
  "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";
const reviewRaw = inflateSync(Buffer.from(reviewDataDeflate, "base64"), {
  maxOutputLength: 93920,
});
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
assert.equal(reviewRaw.length, 93920);
assert.equal(
  hash(reviewRaw),
  "6e03a25cde0af18ef0c78201f0e240c78b8b75b764c800f521ea3a40f66939e5",
);
const review = JSON.parse(reviewRaw);
const expected = review.expected;
const prefix = new URL("../../native/windows-arm-full-sdk/", import.meta.url);
const policy = JSON.parse(
  await readFile(new URL("private-qualification-profile.json", prefix)),
);
const policyRaw = await readFile(
  new URL("private-qualification-profile.json", prefix),
);
const candidateRaw = await readFile(
  new URL("engine-qualification-profile.json", prefix),
);
const candidate = JSON.parse(candidateRaw);
const driver = (
  await readFile(new URL("private-source-driver.mjs", prefix), "utf8")
).replaceAll("\r\n", "\n");
const ast = parse(driver, { sourceType: "module", ecmaVersion: "latest" });
const equalityNode = ast.body.find(
  (node) =>
    node.type === "FunctionDeclaration" &&
    node.id.name === "staticProjectionEqual",
);
assert(equalityNode);
const begin = driver.indexOf(
  "// BEGIN INACTIVE PURE QUALIFICATION INSPECTORS\n",
);
const marker = "// END INACTIVE PURE QUALIFICATION INSPECTORS";
const end = driver.indexOf(marker, begin) + marker.length;
assert(begin > 0 && end > begin);
const strictReaders = driver.slice(begin, end);
assert.equal(
  hash(strictReaders),
  "ccfffb973a7c008feda1933c6e620d57778eb1bc8b440d3e92ac2d29596f43e8",
);
const readers = new Function(
  "Buffer",
  "sha",
  "need",
  "PRIVATE_PROFILE_SHA256",
  "PRIVATE_MODE",
  "PRIVATE_REF",
  "PRIVATE_WORKFLOW",
  "PRIVATE_ROLES",
  driver.slice(equalityNode.start, equalityNode.end) +
    "\n" +
    strictReaders +
    "\nreturn {qualificationInspectAction,qualificationInspectPaHeader,qualificationInspectCefHeader,qualificationBoundedJson};",
)(
  Buffer,
  hash,
  (ok, code) => {
    if (!ok) throw new Error(code);
  },
  hash(policyRaw),
  policy.mode,
  policy.ref,
  policy.workflow,
  policy.qualificationRoles,
);

function fixture(image = "20261030.294.1") {
  return {
    target: "aarch64-pc-windows-msvc",
    image,
    sourceId: policy.images[image].sourceId,
    partitionAllocActionValues: Object.entries(expected),
    partitionAllocHeaderValues: Object.entries(expected),
    cefHeaderValues: [["CEF_V8_ENABLE_SANDBOX", 1]],
  };
}
function strictParsed() {
  const generated = candidate.generatedInputs.find(
    (row) => row.role === "partitionAlloc",
  );
  const label = generated.label,
    prefix = "//base/allocator/partition_allocator/src/partition_alloc";
  const action = {
    type: "action",
    toolchain: "//build/toolchain/win:win_clang_arm64",
    metadata: {},
    visibility: ["*"],
    testonly: false,
    check_includes_strict: true,
    public: "*",
    script: prefix + "/write_buildflag_header.py",
    args: [
      "--output",
      "base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
      "--rulename",
      label,
      "--gen-dir",
      "gen",
      "--definitions",
      "{{response_file_name}}",
    ],
    outputs: ["//out/Release_GN_arm64/" + generated.relativeOutput],
    deps: [prefix + ":buildflag_macro"],
    response_file_contents: [
      "--flags",
      ...candidate.partitionAllocMacros.map(
        (name) =>
          name +
          "=" +
          (name === "USER_SPACE_ZERO_SEGMENT_SIZE_MB"
            ? expected[name]
            : expected[name] === 1
              ? "true"
              : "false"),
      ),
    ],
  };
  const desc = Buffer.from(JSON.stringify({ [label]: action }));
  const header = Buffer.from(
    [
      "#ifndef BASE_ALLOCATOR_PARTITION_ALLOCATOR_SRC_PARTITION_ALLOC_BUILDFLAGS_H_",
      "#define BASE_ALLOCATOR_PARTITION_ALLOCATOR_SRC_PARTITION_ALLOC_BUILDFLAGS_H_",
      '#include "partition_alloc/buildflag.h"',
      ...candidate.partitionAllocMacros.map(
        (name) =>
          "#define PA_BUILDFLAG_INTERNAL_" +
          name +
          "() (" +
          expected[name] +
          ")",
      ),
      "#endif",
      "",
    ].join("\n"),
  );
  const cef = Buffer.from(
    "#ifndef CEF_INCLUDE_CEF_CONFIG_H_\n#define CEF_INCLUDE_CEF_CONFIG_H_\n#define CEF_V8_ENABLE_SANDBOX 1\n#endif\n",
  );
  const parsedAction = readers.qualificationInspectAction(
    desc,
    "partitionAlloc",
    policyRaw,
    candidateRaw,
  );
  const parsedHeader = readers.qualificationInspectPaHeader(
    header,
    candidate,
    parsedAction.evaluatedMacroValues,
  );
  const parsedCef = readers.qualificationInspectCefHeader(cef);
  return { desc, header, cef, parsedAction, parsedHeader, parsedCef };
}

test("fixed61 policy matches the pinned independent source derivations, patched mappings and conditional tracer projection", () => {
  const actual = ARM64_EXPECTED_DEFAULTS_POLICY;
  assert.equal(review.expectedMacroCount, 61);
  assert.equal(review.nativeValuesObserved, false);
  assert.equal(review.fullArm64DefaultsQualified, false);
  assert.equal(review.rows.length, 61);
  assert.deepEqual(actual.values, expected);
  assert.equal(actual.rows.length, 61);
  assert.deepEqual(actual.conditionalAssumptions, review.assumptions);
  assert.deepEqual(
    actual.requiredInactiveOverrides,
    review.inactiveOverrideBranches,
  );
  assert.deepEqual(actual.sourceReviewPin, {
    bytes: 93920,
    sha256: hash(reviewRaw),
  });
  for (const [index, row] of review.rows.entries()) {
    assert.equal(row.actualNativeValue, null);
    assert.equal(row.status, "SOURCE_EXPECTATION_ONLY_NOT_NATIVE");
    assert.equal(Number(row.derivation.conditionalValue), expected[row.name]);
    assert.equal(
      row.mappingSourceSha256,
      review.patchedInputs.partitionAlloc.patchedSha256,
    );
    assert.deepEqual(actual.rows[index], {
      name: row.name,
      value: row.expected,
      gnVariable: row.gnVariable,
      mappingLine: row.mappingLine,
      mappingSourceSha256: row.mappingSourceSha256,
      source: row.derivation.source,
      equation: row.derivation.reviewerBooleanEquation ?? null,
    });
  }
  assert.deepEqual(
    actual.sourcePins,
    review.sourcePins.map(({ label, bytes, sha256 }) => ({
      label,
      bytes,
      sha256,
    })),
  );
  assert.equal(actual.values.DCHECKS_ARE_ON, 1);
  assert.equal(actual.values.EXPENSIVE_DCHECKS_ARE_ON, 1);
  assert.equal(actual.values.USER_SPACE_ZERO_SEGMENT_SIZE_MB, 4097);
  assert.equal(actual.values.HAS_MEMORY_TAGGING, 0);
  assert.equal(actual.values.ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER, 0);
  assert.equal(review.tracerProjection.nativeGeneratorValue, true);
  assert.equal(actual.tracerProjection.projectedDeclaredValue, false);
  assert.equal(actual.tracerProjection.nativeExecutionObserved, false);
});

test("actual existing strict action and header readers supply matching data for both fixed source/image tuples without qualification", () => {
  const parsed = strictParsed();
  assert.deepEqual(parsed.parsedAction.evaluatedMacroValues, expected);
  assert.deepEqual(parsed.parsedHeader, expected);
  assert.equal(parsed.parsedCef.v8SandboxDeclared, true);
  for (const image of Object.keys(policy.images)) {
    const input = fixture(image);
    input.partitionAllocActionValues = Object.entries(
      parsed.parsedAction.evaluatedMacroValues,
    );
    input.partitionAllocHeaderValues = Object.entries(parsed.parsedHeader);
    input.cefHeaderValues = [
      ["CEF_V8_ENABLE_SANDBOX", Number(parsed.parsedCef.v8SandboxDeclared)],
    ];
    const before = structuredClone(input),
      result = inspectExpectedArm64Defaults(input);
    assert.deepEqual(input, before);
    assert.equal(result.sourceId, policy.images[image].sourceId);
    assert.equal(result.expectedMacroCount, 61);
    assert.equal(result.partitionAllocActionValuesMatch, true);
    assert.equal(result.partitionAllocHeaderValuesMatch, true);
    assert.equal(result.cefV8SandboxValue, 1);
    assert.equal(result.dataOnly, true);
    assert.equal(result.sourceDerivedConditionalExpectation, true);
    assert.equal(result.processProvenanceVerified, false);
    assert.equal(result.fullArm64DefaultsQualified, false);
    assert.equal(result.executionAdmitted, false);
    assert(Object.isFrozen(result));
  }
});

test("matching action/header tamper accepted by old inventory-only comparison is denied by fixed source expectations", () => {
  const parsed = strictParsed();
  const top = JSON.parse(parsed.desc),
    action = Object.values(top)[0];
  const index = candidate.partitionAllocMacros.indexOf("IS_ANDROID");
  assert(index >= 0);
  action.response_file_contents[index + 1] = "IS_ANDROID=true";
  const changedAction = readers.qualificationInspectAction(
    Buffer.from(JSON.stringify(top)),
    "partitionAlloc",
    policyRaw,
    candidateRaw,
  );
  const changedHeader = readers.qualificationInspectPaHeader(
    Buffer.from(
      parsed.header
        .toString()
        .replace(
          "PA_BUILDFLAG_INTERNAL_IS_ANDROID() (0)",
          "PA_BUILDFLAG_INTERNAL_IS_ANDROID() (1)",
        ),
    ),
    candidate,
    changedAction.evaluatedMacroValues,
  );
  assert.equal(changedHeader.IS_ANDROID, 1);
  const input = fixture();
  input.partitionAllocActionValues = Object.entries(
    changedAction.evaluatedMacroValues,
  );
  input.partitionAllocHeaderValues = Object.entries(changedHeader);
  assert.throws(
    () => inspectExpectedArm64Defaults(input),
    /ARM64_DEFAULTS_MISMATCH/,
  );
});

test("every independent expected macro is required in both action and header and each integer tamper denies", () => {
  for (const field of [
    "partitionAllocActionValues",
    "partitionAllocHeaderValues",
  ]) {
    for (const [name, expectedValue] of Object.entries(expected)) {
      const input = fixture();
      const row = input[field].find((row) => row[0] === name);
      row[1] = expectedValue === 4097 ? 4098 : 1 - expectedValue;
      assert.throws(
        () => inspectExpectedArm64Defaults(input),
        /ARM64_DEFAULTS_MISMATCH/,
        field + ":" + name,
      );
      const missing = fixture();
      missing[field] = missing[field].filter((row) => row[0] !== name);
      assert.throws(
        () => inspectExpectedArm64Defaults(missing),
        /ARM64_DEFAULTS_ROWS/,
        field + ":" + name,
      );
    }
  }
});

test("strict name/value rows deny duplicate-equivalent names unknown fields type coercions and sparse or extended arrays", () => {
  for (const field of [
    "partitionAllocActionValues",
    "partitionAllocHeaderValues",
  ]) {
    const duplicate = fixture();
    duplicate[field][1] = [...duplicate[field][0]];
    assert.throws(
      () => inspectExpectedArm64Defaults(duplicate),
      /ARM64_DEFAULTS_DUPLICATE/,
    );
    for (const name of [
      "IS_ANDROID ",
      "is_android",
      "PA_BUILDFLAG_INTERNAL_IS_ANDROID",
      "IS_ANDROİD",
      "__proto__",
    ]) {
      const unknown = fixture();
      unknown[field][0][0] = name;
      assert.throws(
        () => inspectExpectedArm64Defaults(unknown),
        /ARM64_DEFAULTS_NAME/,
      );
    }
    for (const value of [
      true,
      false,
      "1",
      "0",
      null,
      undefined,
      NaN,
      Infinity,
      0.5,
      -0,
      1n,
      {
        valueOf() {
          throw Error("must not coerce");
        },
      },
    ]) {
      const wrong = fixture();
      wrong[field][0][1] = value;
      assert.throws(
        () => inspectExpectedArm64Defaults(wrong),
        /ARM64_DEFAULTS_VALUE_TYPE/,
      );
    }
    for (const mutate of [
      (rows) => rows.push(["EXTRA", 1]),
      (rows) => {
        delete rows[0];
      },
      (rows) => {
        rows.extra = true;
      },
      (rows) => {
        rows[Symbol("extra")] = true;
      },
      (rows) => rows[0].push("extra"),
      (rows) => {
        rows[0] = { 0: rows[0][0], 1: rows[0][1], length: 2 };
      },
    ]) {
      const wrong = fixture();
      mutate(wrong[field]);
      assert.throws(
        () => inspectExpectedArm64Defaults(wrong),
        /ARM64_DEFAULTS_ROWS/,
      );
    }
  }
});

test("exact fixed target image/source pairing and CEF sandbox1 are mandatory and cannot be caller authority fields", () => {
  for (const change of [
    { target: "x86_64-pc-windows-msvc" },
    { target: "aarch64-pc-windows-msvc " },
    { image: "20261030.294.1 " },
    { image: "unknown" },
    { image: "__proto__" },
    { sourceId: "0".repeat(64) },
    { sourceId: policy.images["20261021.278.1"].sourceId },
  ])
    assert.throws(
      () => inspectExpectedArm64Defaults({ ...fixture(), ...change }),
      /ARM64_DEFAULTS_SCOPE/,
    );
  for (const cefHeaderValues of [
    [],
    [["CEF_V8_ENABLE_SANDBOX", 0]],
    [["CEF_V8_ENABLE_SANDBOX", true]],
    [["CEF_USE_SANDBOX", 1]],
    [
      ["CEF_V8_ENABLE_SANDBOX", 1],
      ["CEF_V8_ENABLE_SANDBOX", 1],
    ],
  ])
    assert.throws(
      () => inspectExpectedArm64Defaults({ ...fixture(), cefHeaderValues }),
      /ARM64_DEFAULTS_/,
    );
  for (const key of [
    "executionAdmitted",
    "fullArm64DefaultsQualified",
    "nativeValuesObserved",
    "issuer",
    "runId",
  ])
    assert.throws(
      () => inspectExpectedArm64Defaults({ ...fixture(), [key]: true }),
      /ARM64_DEFAULTS_FIELDS/,
    );
  for (const key of Object.keys(fixture())) {
    const missing = fixture();
    delete missing[key];
    assert.throws(
      () => inspectExpectedArm64Defaults(missing),
      /ARM64_DEFAULTS_FIELDS/,
    );
  }
});

test("hostile accessors proxies inherited properties and boxed values deny without executing caller hooks", () => {
  let calls = 0;
  const hostile = () => {
    calls++;
    throw Error("caller hook must not run");
  };
  const accessor = fixture();
  Object.defineProperty(accessor, "image", { enumerable: true, get: hostile });
  const rowAccessor = fixture();
  Object.defineProperty(rowAccessor.partitionAllocActionValues[0], "1", {
    enumerable: true,
    get: hostile,
  });
  const inherited = Object.assign(Object.create(fixture()), {});
  const proxy = new Proxy(
    {},
    { ownKeys: hostile, getPrototypeOf: hostile, get: hostile },
  );
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  for (const value of [
    accessor,
    inherited,
    proxy,
    rowAccessor,
    { ...fixture(), partitionAllocActionValues: proxy },
    { ...fixture(), partitionAllocHeaderValues: revoked.proxy },
    { ...fixture(), image: new String("20261030.294.1") },
  ])
    assert.throws(() => inspectExpectedArm64Defaults(value), /ARM64_DEFAULTS_/);
  assert.equal(calls, 0);
});

test("actual strict readers reject duplicated raw macro or JSON evidence before any data comparison", () => {
  const parsed = strictParsed();
  const line = "#define PA_BUILDFLAG_INTERNAL_IS_ANDROID() (0)";
  assert.throws(
    () =>
      readers.qualificationInspectPaHeader(
        Buffer.from(parsed.header.toString().replace(line, line + "\n" + line)),
        candidate,
        parsed.parsedAction.evaluatedMacroValues,
      ),
    /PRIVATE_PA_MACRO/,
  );
  assert.throws(
    () =>
      readers.qualificationBoundedJson(
        Buffer.from('{"IS_ANDROID":0,"IS_ANDRO\\u0049D":0}'),
      ),
    /PRIVATE_JSON_DUPLICATE/,
  );
  assert.throws(
    () =>
      readers.qualificationInspectCefHeader(
        Buffer.from(
          parsed.cef
            .toString()
            .replace(
              "#define CEF_V8_ENABLE_SANDBOX 1",
              "#define CEF_V8_ENABLE_SANDBOX 0",
            ),
        ),
      ),
    /QUAL_CEF_CONFIG/,
  );
});

test("new module remains pure data-only with immutable false gate and original driver hardstop", async () => {
  assert.equal(EXPECTED_DEFAULTS_INTEGRATION_ADMITTED, false);
  assert.equal(
    ARM64_EXPECTED_DEFAULTS_POLICY.fullArm64DefaultsQualified,
    false,
  );
  assert.equal(ARM64_EXPECTED_DEFAULTS_POLICY.executionAdmitted, false);
  assert.throws(() => {
    ARM64_EXPECTED_DEFAULTS_POLICY.values.IS_ANDROID = 1;
  }, TypeError);
  assert.throws(() => {
    ARM64_EXPECTED_DEFAULTS_POLICY.rows[0].value = 0;
  }, TypeError);
  const source = await readFile(
    new URL("expected-defaults.mjs", prefix),
    "utf8",
  );
  const module = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  assert.deepEqual(
    module.body
      .filter((node) => node.type === "ImportDeclaration")
      .map((node) => node.source.value),
    ["node:util"],
  );
  const calls = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee.type === "Identifier")
      calls.add(node.callee.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(module);
  for (const name of [
    "spawn",
    "execFile",
    "fetch",
    "readFile",
    "held",
    "createSourceOperation",
    "qualificationOwnerCheck",
    "createQualificationSession",
    "setTimeout",
  ])
    assert(!calls.has(name), name);
  const full = await readFile(
    new URL("full-sdk-source-driver.mjs", prefix),
    "utf8",
  );
  assert(
    full.includes('throw new Error("PRIVATE_ARM64_DEFAULTS_UNQUALIFIED")'),
  );
});
