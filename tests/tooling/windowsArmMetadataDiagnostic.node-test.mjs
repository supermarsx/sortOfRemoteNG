import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import {
  zstdDecompressSync,
  zstdCompressSync,
  constants as zlibConstants,
} from "node:zlib";
import {
  withoutSourceMetadataDiagnostic,
  withoutSisoMetadataCache,
  sisoMetadataCachePrefix,
} from "./helpers/cefWindowsEngineHostHistory.mjs";
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
  "metadataSisoCacheData",
  "normalizeMetadataSisoCache",
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

// Independent protobuf writer for modeled cache DATA, using the exact pinned
// Siso state.proto/index ABI. Native producer regressions are recorded separately.
function cacheVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n > 127n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}
function cacheField(number, value) {
  return typeof value === "bigint" || typeof value === "number"
    ? Buffer.concat([cacheVarint(number * 8), cacheVarint(value)])
    : Buffer.concat([
        cacheVarint(number * 8 + 2),
        cacheVarint(Buffer.byteLength(value)),
        Buffer.from(value),
      ]);
}
function modelCache(f, change = () => {}, delta = 37n) {
  const entries = f.records.slice(5, 8).map((row) => ({
    name: path.join(f.root, row.relative).replaceAll("\\", "/"),
    bytes: row.pin.bytes,
    hash: row.pin.sha256,
    time: BigInt(row.identity.split(":")[6]) + delta,
    cmd: Buffer.alloc(32, 1),
    edge: Buffer.alloc(32, 2),
    local: 1,
  }));
  const settings = { version: 0x51500001, stateFields: [], entryFields: [] };
  change(entries, settings);
  const body = Buffer.concat([
    ...entries.map((e) =>
      cacheField(
        1,
        Buffer.concat([
          cacheField(1, cacheField(1, e.time)),
          cacheField(2, e.name),
          cacheField(
            3,
            Buffer.concat([cacheField(1, e.hash), cacheField(2, e.bytes)]),
          ),
          ...(e.cmd ? [cacheField(6, e.cmd)] : []),
          cacheField(8, e.time),
          ...(e.edge ? [cacheField(9, e.edge)] : []),
          cacheField(10, e.local),
          ...settings.entryFields,
        ]),
      ),
    ),
    ...settings.stateFields,
  ]);
  const compressed = zstdCompressSync(body),
    header = Buffer.alloc(29);
  Buffer.from("28b52ffd2000010000", "hex").copy(header);
  header.writeUInt32LE(0x184d2a50, 9);
  header.writeUInt32LE(12, 13);
  header.writeUInt32LE(settings.version, 17);
  header.writeUInt32LE(compressed.length, 21);
  header.writeUInt32LE(body.length, 25);
  return Buffer.concat([header, compressed]);
}
const cacheRelative = "source-checkout/src/out/Release_GN_arm64/.siso_fs_state";
async function cacheFixture(t, change, delta) {
  const f = await fixture(t, false, true);
  f.state.metadataSnapshot = undefined;
  const raw = modelCache(f, change, delta);
  await fs.writeFile(path.join(f.root, cacheRelative), raw);
  return { ...f, raw };
}

test("owned Siso cache changes only same100ns metadata timestamps and is idempotent", async (t) => {
  const f = await cacheFixture(t);
  const result = f.api.metadataSisoCacheData(
    f.raw,
    f.root,
    f.records,
    () => {},
  );
  assert.equal(result.changes.length, 3);
  assert.equal(result.entries, 3);
  assert(
    result.changes.every((x) => BigInt(x.before) - BigInt(x.current) === 37n),
  );
  assert.notDeepEqual(result.raw, f.raw);
  const again = f.api.metadataSisoCacheData(
    result.raw,
    f.root,
    f.records,
    () => {},
  );
  assert.deepEqual(again.changes, []);
  assert.equal(again.raw, result.raw);
});

for (const [name, change, code] of [
  ["wrong digest", (e) => (e[0].hash = "a".repeat(64)), "CONTENT_PIN"],
  ["wrong size", (e) => e[0].bytes++, "CONTENT_PIN"],
  ["missing generated command", (e) => (e[0].cmd = null), "GENERATED_ENTRY"],
  ["invalid command hash", (e) => (e[0].cmd = Buffer.alloc(31)), "ENTRY_HASH"],
  ["missing edge hash", (e) => (e[0].edge = null), "GENERATED_ENTRY"],
  ["nonlocal output", (e) => (e[0].local = 0), "GENERATED_ENTRY"],
  [
    "outside owned output",
    (e) => (e[0].name = e[0].name.replace("/source-checkout/", "/outside/")),
    "METADATA_MISSING",
  ],
  ["duplicate entry", (e) => e.push({ ...e[0] }), "ENTRY_DUPLICATE"],
  ["missing metadata", (e) => e.pop(), "METADATA_MISSING"],
  ["nonprecision timestamp drift", (e) => (e[0].time += 100n), "TIME_DELTA"],
  [
    "unknown entry schema",
    (e, s) => s.entryFields.push(cacheField(11, 1)),
    "PROTO_SCHEMA",
  ],
  [
    "unknown state schema",
    (e, s) => s.stateFields.push(cacheField(9, 1)),
    "PROTO_SCHEMA",
  ],
  [
    "unknown digest function",
    (e, s) => s.stateFields.push(cacheField(6, 2)),
    "DIGEST_FUNCTION",
  ],
  ["unknown index version", (e, s) => s.version++, "VERSION"],
])
  test("owned Siso cache denies " + name + " before writes", async (t) => {
    const f = await cacheFixture(t, change),
      file = path.join(f.root, cacheRelative);
    await assert.rejects(
      f.api.normalizeMetadataSisoCache(f.token, f.records),
      (e) => e.message.endsWith("_" + code),
    );
    assert.deepEqual(await fs.readFile(file), f.raw);
    assert.equal(f.state.metadataCache, undefined);
  });

test("owned Siso cache refuses truncation trailing frames and decompression bounds", async (t) => {
  const f = await cacheFixture(t);
  const badSize = Buffer.from(f.raw);
  badSize.writeUInt32LE(268435457, 25);
  for (const raw of [
    f.raw.subarray(0, 20),
    f.raw.subarray(0, -1),
    Buffer.concat([f.raw, Buffer.from([0])]),
    badSize,
  ])
    assert.throws(() =>
      f.api.metadataSisoCacheData(raw, f.root, f.records, () => {}),
    );
  const primary = false;
  assert.throws(
    () =>
      f.api.metadataSisoCacheData(f.raw, f.root, f.records, () => {
        throw primary;
      }),
    (value) => value === primary,
  );
});

test("actual owned Siso cache write keeps all nine live identity and raw guards", async (t) => {
  const f = await cacheFixture(t);
  await f.api.normalizeMetadataSisoCache(f.token, f.records);
  assert(f.state.metadataCache);
  assert.equal(f.state.readFds.size, 0);
  assert.equal(f.state.pendingWriters, 0);
  const cache = await f.api.heldOperationFile(
    f.token,
    cacheRelative,
    67108864,
    f.state.metadataCache.pin,
  );
  assert.equal(cache.identity, f.state.metadataCache.identity);
  assert.deepEqual(
    f.api.metadataSisoCacheData(cache.raw, f.root, f.records, () => {}).changes,
    [],
  );
  for (const row of f.records) {
    const read = await f.api.heldOperationFile(
      f.token,
      row.relative,
      row.maximum,
      row.pin,
    );
    assert.equal(read.identity, row.identity);
  }
  await assert.rejects(
    f.api.normalizeMetadataSisoCache(f.token, f.records),
    /SOURCE_SISO_CACHE_OWNER/,
  );
});

test("owned Siso cache rejects actual input edits before changing cache DATA", async (t) => {
  const f = await cacheFixture(t),
    file = path.join(f.root, cacheRelative);
  await fs.appendFile(path.join(f.root, f.records[5].relative), "changed");
  await assert.rejects(
    f.api.normalizeMetadataSisoCache(f.token, f.records),
    /SOURCE_RECORD_PIN/,
  );
  assert.deepEqual(await fs.readFile(file), f.raw);
});

test("owned Siso cache refuses owner loss and replacement before an in-place write", async (t) => {
  const f = await cacheFixture(t),
    file = path.join(f.root, cacheRelative);
  f.state.creationJoined = false;
  await assert.rejects(
    f.api.normalizeMetadataSisoCache(f.token, f.records),
    /SOURCE_SISO_CACHE_OWNER/,
  );
  assert.deepEqual(await fs.readFile(file), f.raw);
  f.state.creationJoined = true;
  f.state.beforeOperation = async (action) => {
    if (!String(action).includes("constants.O_RDWR")) return;
    f.state.beforeOperation = undefined;
    await fs.writeFile(file + ".replacement", f.raw);
    await fs.rename(file + ".replacement", file);
  };
  await assert.rejects(
    f.api.normalizeMetadataSisoCache(f.token, f.records),
    /SOURCE_SISO_CACHE_REPLACED/,
  );
  assert.deepEqual(await fs.readFile(file), f.raw);
  assert.equal(f.state.metadataCache, undefined);
});

test("owned Siso cache rejects a same-data inode replacement during its own write", async (t) => {
  const f = await cacheFixture(t),
    file = path.join(f.root, cacheRelative);
  f.state.beforeOperation = async (action) => {
    if (!String(action).includes("fd.truncate")) return;
    f.state.beforeOperation = undefined;
    await fs.rename(file, file + ".held-old");
    await fs.writeFile(file, await fs.readFile(file + ".held-old"));
  };
  await assert.rejects(
    f.api.normalizeMetadataSisoCache(f.token, f.records),
    /SOURCE_SISO_CACHE_REPLACED/,
  );
  assert.equal(f.state.metadataCache, undefined);
  assert.equal(f.state.pendingWriters, 0);
});

async function fixture(t, brokenDiagnostic = false, canonicalTimes = false) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "metadata-diagnostic-")),
  );
  const token = Object.freeze({ modeledOwner: true });
  const state = {
    root,
    creationJoined: true,
    pendingWriters: 0,
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
    "zstdDecompressSync",
    "zstdCompressSync",
    "zlibConstants",
    actual +
      "\nreturn {heldOperationFile,recheckSourceMetadata,captureSourceMetadataFailure,startupFailureReport,fail,metadataSisoCacheData,normalizeMetadataSisoCache};",
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
      await state.beforeOperation?.(action);
      return action();
    },
    async () => binding,
    (rows, relative, record) => rows.push({ relative, pin: record.pin }),
    zstdDecompressSync,
    zstdCompressSync,
    zlibConstants,
  );
  const records = [];
  for (const [i, relative] of paths.entries()) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "fixed non-secret metadata " + i);
    if (canonicalTimes && i >= 5 && i <= 7)
      await fs.utimes(file, 1700000000, 1700000000);
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
    const diagnosticCurrent = sisoMetadataCachePrefix(text, file);
    const mutations = [
      diagnosticCurrent + "\n",
      diagnosticCurrent.replace(pair.current, pair.previous),
      diagnosticCurrent.replace(pair.current, pair.current + pair.current),
      diagnosticCurrent.replaceAll("\n", "\r\n"),
    ];
    for (const mutated of mutations) {
      assert.notEqual(mutated, diagnosticCurrent);
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

test("whole Siso cache DATA bridge retains old controller Q and lexical test and denies partial additions", async () => {
  const specs = JSON.parse(
    await fs.readFile(
      new URL(
        "../fixtures/cef/windows_siso_cache_inverse.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(Object.keys(specs).length, 3);
  for (const [file, spec] of Object.entries(specs)) {
    // This lexical fixture is pinned to immutable Git bytes. Its ordinary
    // Windows checkout may use CRLF; production/native byte guards stay exact.
    const current =
      file === "tests/tooling/windowsArmFullSdk.node-test.mjs"
        ? execFileSync("git", ["show", "HEAD:" + file], {
            cwd: new URL("../../", import.meta.url),
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 2 * 1024 ** 2,
          })
        : await fs.readFile(new URL("../../" + file, import.meta.url), "utf8");
    const previous = withoutSisoMetadataCache(current, file);
    assert.equal(Buffer.byteLength(previous), spec.beforeBytes);
    assert.equal(
      createHash("sha256").update(previous).digest("hex"),
      spec.beforeSha256,
    );
    for (const pair of spec.pairs) {
      for (const changed of [
        current.replace(pair.current, pair.previous),
        current.replace(pair.current, pair.current + pair.current),
      ]) {
        assert.notEqual(changed, current);
        assert.throws(() => withoutSisoMetadataCache(changed, file));
      }
    }
    for (const changed of [
      current + "\n",
      previous,
      ...(file === "tests/tooling/windowsArmFullSdk.node-test.mjs"
        ? []
        : [current.replaceAll("\n", "\r\n")]),
    ])
      assert.throws(() => withoutSisoMetadataCache(changed, file));
    assert.throws(() => withoutSisoMetadataCache(current, "unknown"));
    if (file.endsWith("sdk-origin-review.json")) {
      const q = JSON.parse(current),
        old = JSON.parse(previous);
      assert.equal(q.producerInputs.length, 128);
      const changed = q.producerInputs.filter(
        (row, i) =>
          JSON.stringify(row) !== JSON.stringify(old.producerInputs[i]),
      );
      assert.equal(changed.length, 2);
      assert.deepEqual(
        changed.map((x) => x.path),
        [
          "native/windows-arm-full-sdk/full_sdk_control.mjs",
          "tests/tooling/windowsArmFullSdk.node-test.mjs",
        ],
      );
      assert.equal(q.workflowPin.sha256, old.workflowPin.sha256);
    }
  }
  const baseline = withoutSisoMetadataCache(
    source,
    "native/windows-arm-full-sdk/full_sdk_control.mjs",
  );
  const oldAst = ts.createSourceFile(
    "old.mjs",
    baseline,
    99,
    true,
    ts.ScriptKind.JS,
  );
  const oldGuard = oldAst.statements.find(
    (x) =>
      ts.isFunctionDeclaration(x) && x.name?.text === "recheckSourceMetadata",
  );
  const guard = ast.statements.find(
    (x) =>
      ts.isFunctionDeclaration(x) && x.name?.text === "recheckSourceMetadata",
  );
  assert.equal(guard.getText(ast), oldGuard.getText(oldAst));
});
