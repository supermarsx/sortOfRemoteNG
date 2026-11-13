import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import ts from "typescript";
import { withoutSourceMetadataDiagnostic } from "./helpers/cefWindowsEngineHostHistory.mjs";
import { withoutReviewedWindowsImage } from "./helpers/cefWindowsImageReviewedHistory.mjs";

// Actual production function bodies and real owned temporary files. The outer
// owner/lease, defaults-code binding and Job supervision are MODELED, not native
// Windows qualification. No production function body or rejection is rewritten.
const source = await fs.readFile(
  new URL(
    "../../native/windows-arm-full-sdk/full_sdk_control.mjs",
    import.meta.url,
  ),
  "utf8",
);
const ast = ts.createSourceFile(
  "control.mjs",
  source,
  99,
  true,
  ts.ScriptKind.JS,
);
const functions = [
  "need",
  "fail",
  "fileId",
  "directoryId",
  "heldOperationFile",
  "captureSourceMetadataFailure",
  "recheckSourceMetadata",
  "startupFailureReport",
];
const variables = [
  "hashBytes",
  "sourceMetadataFailures",
  "startupErrorContexts",
  "sourceChildFailures",
  "STARTUP_CLOCK_ERRORS",
  "STARTUP_ERROR_CODES",
  "STARTUP_SYSCALLS",
];
const selected = ast.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement)
    ? functions.includes(statement.name?.text)
    : ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((d) =>
        variables.includes(d.name.getText(ast)),
      ),
);
assert.equal(selected.length, functions.length + variables.length);
const actual = selected.map((statement) => statement.getText(ast)).join("\n");
const out = "source-checkout/src/out/Release_GN_arm64/";
const paths = [
  "source-inputs/0",
  "source-inputs/1",
  "private-qualification-logs/qual-gn-desc-pa.stdout.log",
  "private-qualification-logs/qual-gn-desc-cef.stdout.log",
  "private-qualification-logs/qual-gn-args.stdout.log",
  out + "args.gn",
  out +
    "gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h",
  out + "gen/cef/include/cef_config.h",
  "full-metadata-result.json",
];
const roles = [
  "private-policy",
  "engine-policy",
  "gn-partition-alloc",
  "gn-cef-config",
  "gn-arguments",
  "arguments",
  "partition-alloc-header",
  "cef-config-header",
  "metadata-report",
];
const binding = {
  saved: { identity: "saved" },
  live: { identity: "live" },
  policySha256: "policy",
};

async function fixture(t, brokenDiagnostic = false) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "metadata-diagnostic-")),
  );
  const token = Object.freeze({ modeledOwner: true });
  const state = {
    root,
    readFds: new Set(),
    failed: false,
    plan: {
      image: "image",
      sourceId: "source",
      rootPins: [{ relative: "context.json", sha256: "context" }],
      producerInputs: [
        "private-qualification-profile.json",
        "engine-qualification-profile.json",
      ].map((name) => ({ path: "native/windows-arm-full-sdk/" + name })),
    },
  };
  t.after(async () => {
    // Model the owner's later retirement: sticky failure defers held-FD close.
    for (const fd of state.readFds) await fd.close();
    state.readFds.clear();
    await fs.rm(root, { recursive: true, force: true });
  });
  function operationState(value) {
    assert.equal(value, token);
    if (state.failed) throw state.primary;
    return state;
  }
  const api = new Function(
    "fs",
    "path",
    "constants",
    "createHash",
    "utilTypes",
    "WeakMap",
    "operationState",
    "operationFence",
    "operationWork",
    "expectedDefaultsCodeBinding",
    "checkedInputRow",
    actual +
      "\nreturn {heldOperationFile,recheckSourceMetadata,captureSourceMetadataFailure,startupFailureReport,fail};",
  )(
    fs,
    path,
    constants,
    createHash,
    utilTypes,
    brokenDiagnostic
      ? class extends WeakMap {
          set() {
            throw false;
          }
        }
      : WeakMap,
    operationState,
    async () => operationState(token),
    async (value, action) => {
      operationState(value);
      return action();
    },
    async () => binding,
    (rows, relative, record) => rows.push({ relative, pin: record.pin }),
  );
  const records = [];
  for (const [i, relative] of paths.entries()) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "fixed non-secret metadata " + i);
    const read = await api.heldOperationFile(token, relative, 8192);
    records.push(
      Object.freeze({
        relative,
        maximum: 8192,
        identity: read.identity,
        pin: Object.freeze(read.pin),
      }),
    );
  }
  state.metadataSnapshot = Object.freeze({
    matchedExpectedDefaults: {
      contextSha256: "context",
      image: "image",
      sourceId: "source",
      full61Qualified: false,
      binding,
    },
    records: Object.freeze(records),
  });
  return { root, token, state, api, records };
}

test("actual held metadata accepts unchanged files without failure evidence", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.api.recheckSourceMetadata(f.token, false)).length, 9);
  assert.equal(f.state.readFds.size, 0);
  assert.equal(
    f.api.startupFailureReport(
      new Error("FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED"),
    ).diagnostic.sourceMetadata,
    undefined,
  );
});

test("actual same-byte inode replacements reject with one bounded fixed-row identity witness", async (t) => {
  for (let i = 0; i < paths.length; i++) {
    const f = await fixture(t),
      row = f.records[i],
      file = path.join(f.root, row.relative);
    const bytes = await fs.readFile(file);
    await fs.writeFile(file + ".replacement", bytes);
    await fs.rename(file + ".replacement", file);
    let primary;
    try {
      await f.api.recheckSourceMetadata(f.token, false);
    } catch (error) {
      primary = error;
    }
    assert.equal(primary?.message, "FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED");
    const report = f.api.startupFailureReport(primary),
      witness = report.diagnostic.sourceMetadata;
    assert.equal(witness.role, roles[i]);
    assert.equal(witness.relative, paths[i]);
    assert.equal(witness.rawPinVerified, true);
    assert.deepEqual(witness.rawPin, row.pin);
    assert(
      witness.changedFields.some(
        (field) => field.field === "ino" && field.before !== field.current,
      ),
    );
    assert(witness.changedFields.length <= 8);
    assert(JSON.stringify(report).length < 2048);
    assert(!JSON.stringify(report).includes(f.root));
    assert(!JSON.stringify(report).includes(bytes.toString()));
    assert(
      Object.isFrozen(witness) &&
        Object.isFrozen(witness.changedFields) &&
        Object.isFrozen(witness.rawPin),
    );
    assert(witness.changedFields.every(Object.isFrozen));
    assert.equal(f.state.metadataSnapshot.records[i], row);
    assert.equal(f.state.readFds.size, 0);
    assert.equal(f.api.fail(f.state, primary), primary);
    const later = new Error("later cleanup failure");
    assert.equal(f.api.fail(f.state, later), primary);
    await assert.rejects(
      f.api.recheckSourceMetadata(f.token, true),
      (error) => error === primary,
    );
  }
});

test("actual changed bytes fail the original raw pin before replacement diagnostics", async (t) => {
  const f = await fixture(t),
    row = f.records[6];
  await fs.appendFile(path.join(f.root, row.relative), "tamper");
  let primary;
  await assert.rejects(f.api.recheckSourceMetadata(f.token, false), (error) => {
    primary = error;
    return error.message === "FULL_SDK_CONTROL_SOURCE_RECORD_PIN";
  });
  assert.equal(f.state.primary, primary);
  assert.equal(
    f.api.startupFailureReport(primary).diagnostic.sourceMetadata,
    undefined,
  );
  assert.equal(f.state.readFds.size, 1);
  assert.equal(f.state.cleanupConfirmed, false);
});

test("diagnostic refusal and failed WeakMap writes retain the original rejection", async (t) => {
  const f = await fixture(t),
    row = f.records[6];
  const changed = {
    identity: row.identity
      .split(":")
      .map((v, i) => (i === 1 ? String(BigInt(v) + 1n) : v))
      .join(":"),
    pin: row.pin,
  };
  const denied = [
    { ...row, relative: "../secret" },
    { ...row, relative: "source-inputs/99" },
    { ...row, identity: "1:2" },
    { ...row, identity: "1".repeat(41) + ":2:3:4:5:6:7:8" },
    { ...row, pin: { ...row.pin, bytes: 8388609 } },
    { ...row, pin: { ...row.pin, sha256: "secret" } },
  ];
  for (const invalid of denied) {
    const error = new Error("FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED");
    f.api.captureSourceMetadataFailure(error, f.state, invalid, changed);
    assert.equal(
      f.api.startupFailureReport(error).diagnostic.sourceMetadata,
      undefined,
    );
  }
  const error = new Error("FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED");
  f.api.captureSourceMetadataFailure(error, f.state, row, {
    ...changed,
    pin: { ...row.pin, bytes: row.pin.bytes + 1 },
  });
  assert.equal(
    f.api.startupFailureReport(error).diagnostic.sourceMetadata,
    undefined,
  );
  f.api.captureSourceMetadataFailure(error, f.state, row, changed);
  const first = f.api.startupFailureReport(error).diagnostic.sourceMetadata;
  assert(first);
  f.api.captureSourceMetadataFailure(error, f.state, f.records[7], changed);
  assert.equal(
    f.api.startupFailureReport(error).diagnostic.sourceMetadata,
    first,
  );
  const maximal = new Error("FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED");
  f.api.captureSourceMetadataFailure(
    maximal,
    f.state,
    { ...row, identity: Array(8).fill("9".repeat(40)).join(":") },
    { ...changed, identity: Array(8).fill("8".repeat(40)).join(":") },
  );
  const bounded = f.api.startupFailureReport(maximal);
  assert.equal(bounded.diagnostic.sourceMetadata.changedFields.length, 8);
  assert(JSON.stringify(bounded).length < 2048);
  const broken = await fixture(t, true),
    file = path.join(broken.root, paths[6]);
  await fs.writeFile(file + ".replacement", await fs.readFile(file));
  await fs.rename(file + ".replacement", file);
  await assert.rejects(
    broken.api.recheckSourceMetadata(broken.token, false),
    (failure) => {
      assert.equal(
        failure.message,
        "FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED",
      );
      assert.equal(
        broken.api.startupFailureReport(failure).diagnostic.sourceMetadata,
        undefined,
      );
      return true;
    },
  );
});

test("actual same-inode timestamp mutation rejects and prior falsy primary stays sticky", async (t) => {
  const f = await fixture(t),
    row = f.records[6],
    file = path.join(f.root, row.relative);
  const before = await fs.stat(file, { bigint: true });
  await fs.utimes(file, new Date(1000000000000), new Date(1000000000000));
  assert.equal((await fs.stat(file, { bigint: true })).ino, before.ino);
  await assert.rejects(f.api.recheckSourceMetadata(f.token, false), (error) => {
    const witness = f.api.startupFailureReport(error).diagnostic.sourceMetadata;
    assert(witness.changedFields.some((field) => field.field === "mtimeNs"));
    assert(!witness.changedFields.some((field) => field.field === "ino"));
    return error.message === "FULL_SDK_CONTROL_SOURCE_METADATA_REPLACED";
  });
  assert.equal(f.api.fail(f.state, false), false);
  assert.equal(f.api.fail(f.state, new Error("later cleanup")), false);
  await assert.rejects(
    f.api.recheckSourceMetadata(f.token, false),
    (error) => error === false,
  );
});

test("whole diagnostic controller and Q history restores exact old bodies and denies drift", async () => {
  const specs = JSON.parse(
    await fs.readFile(
      new URL(
        "../fixtures/cef/windows_metadata_diagnostic_inverse.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const image = JSON.parse(
    await fs.readFile(
      new URL(
        "../fixtures/cef/windows_image_refresh_inverse.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(Object.keys(specs).length, 2);
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  for (const [file, spec] of Object.entries(specs)) {
    const text = await fs.readFile(
      new URL("../../" + file, import.meta.url),
      "utf8",
    );
    const previous = withoutSourceMetadataDiagnostic(text, file);
    assert.equal(Buffer.byteLength(previous), spec.beforeBytes);
    assert.equal(digest(previous), spec.beforeSha256);
    const historical = withoutReviewedWindowsImage(text, file);
    assert.equal(Buffer.byteLength(historical), image[file].beforeBytes);
    assert.equal(digest(historical), image[file].beforeSha256);
    const pair = spec.pairs[0];
    const mutations = [
      text + "\n",
      text.replace(pair.current, pair.previous),
      text.replace(pair.current, pair.current + pair.current),
      text.replaceAll("\n", "\r\n"),
    ];
    for (const mutated of mutations) {
      assert.notEqual(mutated, text);
      assert.throws(() => withoutSourceMetadataDiagnostic(mutated, file));
      // The complete previous Q is already an admitted historical DATA body.
      // Only the strict new prefix must deny it; partial drift still denies.
      if (mutated === previous)
        assert.equal(withoutReviewedWindowsImage(mutated, file), historical);
      else assert.throws(() => withoutReviewedWindowsImage(mutated, file));
    }
    assert.throws(() => withoutSourceMetadataDiagnostic(text, "unknown"));
  }
});
